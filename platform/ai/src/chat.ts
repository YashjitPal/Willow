import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { isOfficialEndpoint, resolveEndpointTransport, type ProviderId } from "./providers/endpoints";
import { defaultApiFormatForProvider, type ProviderApiFormat, type ProviderToolPolicy } from './providers/profiles';
import { mergeCitations, namesUrlCitation, namesWebSearch, pickGroundingMetadata, resolveAnthropicCitations, resolveCitations, resolveCompatCitations, type AnthropicCitedBlock, type CompatSearchHarvest, type MessageCitations } from "./grounding";
import type { CodeExecution } from "./code-execution";

export interface Attachment {
  type: 'image' | 'text' | 'file';
  mimeType: string;
  data: string; // base64 for image, text content for text
  name?: string;
  size?: number;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  parts?: any[];
  history?: any[];
  isTranscribing?: boolean;
  isNew?: boolean;
  createdAt?: number;
  isError?: boolean;
}

// StreamPhase specifies life cycle phases
export type StreamPhase = 'thinking' | 'searching' | 'executing' | 'responding';

/** Provider-reported usage for a single model response/request. */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

const normalizeTokenUsage = (raw: any): TokenUsage | null => {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = Number(raw[key]);
      if (Number.isFinite(value) && value >= 0) return Math.floor(value);
    }
    return undefined;
  };
  const inputTokens = pick('inputTokens', 'input_tokens', 'promptTokenCount', 'prompt_tokens');
  const outputTokens = pick('outputTokens', 'output_tokens', 'candidatesTokenCount', 'completion_tokens');
  const totalTokens = pick('totalTokens', 'total_tokens');
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return null;
  return { inputTokens, outputTokens, totalTokens };
};

export interface AiOptions {
  provider: 'gemini' | 'openai' | 'anthropic' | 'moonshot' | 'spacexai' | 'zhipuai';
  model: string;
  apiKey: string;
  thinkingLevel?: number;
  includeThoughts?: boolean;
  enableSearch?: boolean;
  enableCodeExecution?: boolean;
  baseUrl?: string;
  apiFormat?: ProviderApiFormat;
  toolPolicy?: ProviderToolPolicy;
  profileId?: string;
  reasoningEffort?: string;
  signal?: AbortSignal;
  maxToolIterations?: number;
  /**
   * Opt in to the media-agent harness: the generate_image / generate_video tool
   * suite and its system instruction. Off by default, and it must stay that way.
   * Normal chat has no executor for these tools, so offering them just makes the
   * model announce generations that never happen. Only the media agent, which
   * passes a real `onToolCall`, may turn this on.
   */
  enableMediaTools?: boolean;
  /**
   * Declare the personalization tools: `retrieve_personal_data`, plus the action
   * tools for whichever Google products are connected.
   *
   * Same rule as `enableMediaTools` and for the same reason — a declared tool
   * with no executor behind it produces a model that announces work it never
   * did. The caller passes the already-built declarations rather than a boolean
   * so this file keeps knowing nothing about profiles, connectors or OAuth;
   * `@willow/personal` builds them and `chat-turn-runner` executes them.
   */
  personalTools?: { functionDeclarations: any[] }[];
  /** Called when the provider emits a tool/app activity before execution. */
  onToolCallStart?: (name: string, args?: any) => void;
  /** Native function declarations supplied by a focused agent harness. */
  toolDeclarations?: { functionDeclarations: any[] }[];
}

export const isAbortError = (error: unknown): boolean =>
  !!error && typeof error === 'object' &&
  (/(abort|cancel)/i.test(String((error as any).name || '')) || /(abort|cancel)/i.test(String((error as any).code || '')));

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException('The AI request was cancelled.', 'AbortError');
}

function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('The AI request was cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function normalizeOpenAICompatibleApiKey(apiKey: string): string {
  const trimmedKey = apiKey.trim();

  // Some gateways distribute their underlying sk-* credential Base64-wrapped.
  // Decode only when the result clearly looks like an API key; ordinary keys
  // remain untouched. The decoded value is held in memory and is never stored.
  if (!trimmedKey.startsWith('sk-')) {
    try {
      const decodedKey = globalThis.atob?.(trimmedKey).trim();
      if (decodedKey?.startsWith('sk-')) return decodedKey;
    } catch {
      // Not valid Base64, so use the credential exactly as entered.
    }
  }

  return trimmedKey;
}

// ============ CLIENT CACHING FOR FASTER COLD STARTS ============
// Cache SDK clients to avoid re-initialization overhead
const clientCache: {
  gemini: { key: string; client: any } | null;
  openai: { key: string; client: OpenAI } | null;
  anthropic: { key: string; client: Anthropic } | null;
} = {
  gemini: null,
  openai: null,
  anthropic: null,
};

/**
 * True when a failed request looks like the endpoint refusing the search tool
 * rather than failing for its own reasons.
 *
 * Every provider here except Gemini is configured against a relay, and a relay
 * is free not to implement a server-side tool its upstream documents. Sending
 * one it does not know can fail the whole turn, which is strictly worse than
 * having no search -- so the request is retried once without it.
 *
 * Matching is on the message naming a tool or search parameter, not on the
 * status code, because the observed relays are inconsistent about which code
 * they use for an unsupported parameter. Requiring the tool to be named is what
 * keeps an unrelated 401 or 429 from burning a second request: those say
 * "invalid api key" and "rate limit", neither of which mentions a tool. A false
 * positive costs one retry and still surfaces the original error if it repeats.
 */
const namesSearchToolRejection = (error: any): boolean => {
  const parts = [
    error?.message,
    error?.error?.message,
    error?.error?.param,
    error?.error?.code,
    error?.response?.data?.error?.message,
  ].filter((part) => typeof part === 'string');
  if (!parts.length) return false;
  const text = parts.join(' ');
  return /web[\s._-]*search|x[\s._-]*search|search_parameters|\bweb_search_options\b|\btools?\b|422|Unprocessable/i.test(text);
};

/**
 * Runs a streaming request with server-side search attached, and once more
 * without it if the endpoint rejects the search parameter.
 *
 * Safe to retry only because it wraps the *create* call: an OpenAI-compatible
 * `create` with `stream: true` resolves once the response head arrives, so a
 * rejection throws before a single token has been handed to `onToken`. Retrying
 * after tokens had been emitted would duplicate the answer.
 *
 * An abort is rethrown untouched -- the user pressing stop must not be read as
 * an unsupported parameter and quietly retried.
 */
const createWithSearchFallback = async <T>(
  attempt: (searchEnabled: boolean) => Promise<T>,
  searchRequested: boolean,
  signal?: AbortSignal,
): Promise<T> => {
  if (!searchRequested) return attempt(false);
  try {
    return await attempt(true);
  } catch (error: any) {
    throwIfAborted(signal);
    if (isAbortError(error) || !namesSearchToolRejection(error)) throw error;
    return attempt(false);
  }
};

/**
 * Pulls every search-shaped field off one OpenAI-compatible stream chunk.
 *
 * Four providers, four spellings of the same two ideas, none of them agreeing
 * with the OpenAI base shape they all claim:
 *
 *  - `delta.annotations` -- OpenAI's documented Chat Completions shape, entries
 *    of `{type: 'url_citation', url_citation: {url, title, start_index,
 *    end_index}}`. xAI's Responses API sends the same fields inline instead of
 *    nested, and both are accepted.
 *  - `chunk.citations` -- xAI's chat path, a flat array of URL strings.
 *  - `chunk.web_search` -- Zhipu's, an array of `{title, link, content,
 *    publish_date, refer}` sitting beside `choices` rather than inside it.
 *
 * Names are matched through `namesWebSearch`/`namesUrlCitation` rather than
 * compared literally, for the same reason the Anthropic reader is: a relay is
 * under no obligation to copy the upstream spelling, and an unrecognised field
 * is dropped in silence -- the search would run, be paid for, and show nothing.
 */
const harvestCompatSearchChunk = (chunk: any, harvest: CompatSearchHarvest): void => {
  if (!chunk || typeof chunk !== 'object') return;

  const message = chunk.choices?.[0]?.delta ?? chunk.choices?.[0]?.message;
  for (const container of [chunk, message]) {
    if (!container || typeof container !== 'object') continue;
    for (const [key, value] of Object.entries(container)) {
      if (!Array.isArray(value) || !value.length) continue;
      if (/^annotations$/i.test(key) || namesUrlCitation(key)) {
        harvest.annotations.push(...value);
      } else if (/^citations$/i.test(key) || namesWebSearch(key)) {
        // Zhipu's `web_search` and xAI's `citations` are both bare lists. An
        // entry carrying offsets is still routed to `annotations` so its span
        // survives, since a relay may put annotation objects under either name.
        for (const entry of value) {
          const hasSpan = !!entry && typeof entry === 'object'
            && ((entry as any).start_index !== undefined || (entry as any).startIndex !== undefined);
          if (hasSpan) harvest.annotations.push(entry);
          else harvest.sources.push(entry);
        }
      }
    }
  }
};

// The Gemini SDK takes its endpoint per-request rather than at construction,
// so callers merge this into the `requestOptions` argument of
// `getGenerativeModel`. Returns `{}` for the official endpoint so the SDK keeps
// its own default.
export const getGeminiRequestOptions = (baseUrl?: string): Record<string, unknown> => {
  if (isOfficialEndpoint('gemini', baseUrl)) return {};
  const { url, headers } = resolveEndpointTransport('gemini', baseUrl, 'origin');
  return { baseUrl: url, ...(headers ? { customHeaders: headers } : {}) };
};

export const getGeminiClient = (apiKey: string): any => {
  if (clientCache.gemini?.key === apiKey) {
    return clientCache.gemini.client;
  }
  const client = new GoogleGenerativeAI(apiKey);
  clientCache.gemini = { key: apiKey, client };
  return client;
};

const getOpenAIClient = (apiKey: string, baseUrl?: string, endpointProvider: ProviderId = 'openai'): OpenAI => {
  const cacheKey = `${endpointProvider}::${apiKey}::${baseUrl || ''}`;
  if (clientCache.openai?.key === cacheKey) {
    return clientCache.openai.client;
  }
  const { url, headers } = resolveEndpointTransport(endpointProvider, baseUrl, 'v1');
  const client = new OpenAI({
    apiKey: normalizeOpenAICompatibleApiKey(apiKey),
    baseURL: url,
    // A relayed turn at high reasoning effort with a server-side search can run
    // well past the SDK's 10 minute default. api.openai.com is left on the
    // default because it is the one endpoint here that is not relay-fronted.
    ...(endpointProvider === 'openai' ? {} : { timeout: 60 * 60 * 1000 }),
    dangerouslyAllowBrowser: true,
    ...(headers ? { defaultHeaders: headers } : {})
  });
  clientCache.openai = { key: cacheKey, client };
  return client;
};

const getAnthropicClient = (apiKey: string, baseUrl?: string): Anthropic => {
  const cacheKey = `${apiKey}::${baseUrl || ''}`;
  if (clientCache.anthropic?.key === cacheKey) {
    return clientCache.anthropic.client;
  }
  // The SDK appends `/v1/messages` itself, so hand it a bare origin.
  const { url, headers } = resolveEndpointTransport('anthropic', baseUrl, 'origin');
  const client = new Anthropic({
    apiKey,
    baseURL: url,
    dangerouslyAllowBrowser: true,
    ...(headers ? { defaultHeaders: headers } : {})
  });
  clientCache.anthropic = { key: cacheKey, client };
  return client;
};

// ============ PRE-WARM FUNCTION ============
// Call this on app load to warm up the SDK (optional)
export const prewarmClient = (provider: string, apiKey: string) => {
  if (!apiKey) return;
  if (provider === 'gemini') getGeminiClient(apiKey);
  else if (provider === 'openai') getOpenAIClient(apiKey);
  else if (provider === 'anthropic') getAnthropicClient(apiKey);
};

// ============ GEMINI FILES API ============
// Upload files once, reference by URI in subsequent messages
const geminiFileCache = new Map<string, string>(); // fingerprint -> fileUri

function getAttachmentFingerprint(att: Attachment): string {
  return `${att.mimeType}:${att.data.length}:${att.data.substring(0, 32)}`;
}

async function uploadToGeminiFiles(
  apiKey: string,
  base64Data: string,
  mimeType: string,
  displayName: string,
  signal?: AbortSignal
): Promise<string> {
  // Convert base64 to bytes
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Step 1: Start resumable upload
  const startResponse = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'X-Goog-Upload-Header-Content-Length': String(bytes.length),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { displayName } }),
      signal
    }
  );

  if (!startResponse.ok) {
    throw new Error(`Gemini Files API start failed: ${startResponse.status}`);
  }

  const uploadUrl = startResponse.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new Error('No upload URL returned from Gemini Files API');
  }

  // Step 2: Upload file data and finalize
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: bytes,
    signal
  });

  if (!uploadResponse.ok) {
    throw new Error(`Gemini Files API upload failed: ${uploadResponse.status}`);
  }

  const result = await uploadResponse.json();
  let uploadedFile = result.file;
  const fileUri = uploadedFile?.uri;
  if (!fileUri) {
    throw new Error('No file URI in Gemini Files API response');
  }

  // Audio/video and larger documents can remain PROCESSING briefly after the
  // upload request finishes. Gemini rejects them until the file becomes ACTIVE.
  const startedAt = Date.now();
  while (uploadedFile?.state === 'PROCESSING') {
    if (Date.now() - startedAt > 2 * 60 * 1000) {
      throw new Error(`Gemini file processing timed out for ${displayName}`);
    }
    await waitWithAbort(800, signal);
    const resourceName = uploadedFile.name;
    if (!resourceName) break;
    const statusResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${resourceName}?key=${apiKey}`,
      { signal },
    );
    if (!statusResponse.ok) {
      throw new Error(`Gemini file status failed: ${statusResponse.status}`);
    }
    uploadedFile = await statusResponse.json();
  }
  if (uploadedFile?.state === 'FAILED') {
    throw new Error(`Gemini could not process ${displayName}`);
  }

  return fileUri;
}

async function resolveGeminiFilePart(apiKey: string, att: Attachment, signal?: AbortSignal): Promise<any> {
  throwIfAborted(signal);
  if (att.type === 'text') {
    const label = att.name || att.mimeType || 'text attachment';
    return { text: `\n\n[Contents of ${label}]\n${att.data}` };
  }
  if (!att.data) throw new Error(`Attachment data is unavailable for ${att.name || att.mimeType}`);
  const fingerprint = getAttachmentFingerprint(att);
  const cachedUri = geminiFileCache.get(fingerprint);

  if (cachedUri) {
    return { fileData: { fileUri: cachedUri, mimeType: att.mimeType } };
  }

  try {
    const fileUri = await uploadToGeminiFiles(apiKey, att.data, att.mimeType, att.name || 'attachment', signal);
    geminiFileCache.set(fingerprint, fileUri);
    console.log(`[AI] Uploaded to Gemini Files: ${att.name} -> ${fileUri}`);
    return { fileData: { fileUri, mimeType: att.mimeType } };
  } catch (err) {
    const approximateBytes = Math.floor(att.data.length * 0.75);
    if (approximateBytes > 20 * 1024 * 1024) throw err;
    console.warn('[AI] Gemini Files upload failed, using inline data:', err);
    return { inlineData: { mimeType: att.mimeType, data: att.data } };
  }
}

// ============ MAIN STREAM CHAT FUNCTION ============
// ============ AGENT HARNESS MOCK EXECUTION LAYER ============
export const mockExecuteTool = (name: string, args: any): any => {
  console.log(`[Agent Harness] Executing tool: ${name}`, args);
  switch (name) {
    case "generate_image":
      return {
        media_id: `img_gen_${Math.random().toString(16).substring(2, 10)}`,
        status: "success",
        url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=600",
        aspect_ratio: args.aspect_ratio || "16:9",
        generator: args.model === "gemini-3-pro-image-preview" ? "Nano Banana Pro" :
                   args.model === "gemini-3.1-flash-lite-image" ? "Nano Banana Lite" : "Nano Banana 2",
        batch_size: args.batch_size || "1x",
        credits_spent: args.model === "gemini-3-pro-image-preview" ? 2 : 1,
        lineage: args.references && args.references.length > 0 ? "forked_from_reference" : "original"
      };

    case "generate_video_from_text":
      return {
        media_id: `vid_gen_${Math.random().toString(16).substring(2, 10)}`,
        status: "pending",
        duration: args.duration || "10s",
        aspect_ratio: args.aspect_ratio || "16:9",
        generator: args.model || "Omni Flash",
        credits_spent: args.model === "omni-flash" ? 15 : 10,
        camera_movement: args.camera_movement || "none",
        audio_attached: args.audio_track_id ? "yes" : "no"
      };

    case "generate_video_with_first_frame":
      return {
        media_id: `vid_i2v_${Math.random().toString(16).substring(2, 10)}`,
        status: "pending",
        first_frame_id: args.first_frame_id,
        generator: args.model || "Omni Flash",
        credits_spent: 12,
        prompt_influence: args.prompt || "default motion"
      };

    case "generate_video_with_interpolation":
      return {
        media_id: `vid_interp_${Math.random().toString(16).substring(2, 10)}`,
        status: "pending",
        start_frame_id: args.start_frame_id,
        end_frame_id: args.end_frame_id,
        generator: "Veo 3.1",
        credits_spent: 18,
        interpolation_guidance: args.prompt || "smooth morphing"
      };

    case "generate_video_with_references":
      return {
        media_id: `vid_ref_${Math.random().toString(16).substring(2, 10)}`,
        status: "pending",
        visual_references_used: args.visual_references?.length || 0,
        audio_references_used: args.audio_references?.length || 0,
        generator: "Omni Flash",
        credits_spent: 20
      };

    case "generate_video_edit_video":
      return {
        media_id: `vid_v2v_${Math.random().toString(16).substring(2, 10)}`,
        status: "pending",
        source_video_id: args.video_id,
        generator: "Omni Flash",
        credits_spent: 15,
        instruction_applied: args.prompt
      };

    case "check_video_generation_status":
      return {
        media_id: args.media_id,
        status: "completed",
        url: "https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-background-1611-large.mp4",
        duration_actual: "10.0s",
        resolution: "1080p",
        aspect_ratio: "16:9",
        message: "Video generated successfully after 1 step polling."
      };

    case "storyboard_writer": {
      const scenesCount = args.num_scenes || 2;
      const concept = args.concept || "Unknown Theme";
      const scenes = [];
      for (let i = 1; i <= scenesCount; i++) {
        scenes.push({
          scene_number: i,
          visual_description: `Detailed scene ${i} rendering the concept: ${concept}`,
          camera_movement: i % 2 === 0 ? "Slow pan left to right with slight tilt" : "Macro zoom-in focus onto key focal elements",
          estimated_duration: `${4 + i}s`,
          prompt_directive: `cinematic photorealistic masterpiece, concept of ${concept}, scene ${i}, 8k resolution`
        });
      }
      return {
        concept_summary: `Storyboard Plan: ${concept}`,
        total_scenes: scenesCount,
        scenes
      };
    }

    case "analyze_artifact":
      return {
        media_id: args.media_id,
        query_processed: args.query,
        dimensions: "1024x576 (16:9)",
        dominant_color_palette: ["deep indigo", "vibrant magenta", "neon teal"],
        visual_elements_detected: [
          { label: "mystical atmospheric dust", confidence: 0.95 },
          { label: "high fidelity volumetric light ray", confidence: 0.92 }
        ],
        composition_analysis: "Stunning modern visual composition showcasing strong contrasts and beautiful cinematic grading. Highly detailed textures."
      };

    case "list_project_artifacts":
      return {
        project_id: "proj_willow_dashboard",
        total_assets: 4,
        assets: [
          { id: "img_kai_ref", type: "image", aspect_ratio: "16:9", source: "user_upload", created_at: "2026-06-29" },
          { id: "img_luna_ref", type: "image", aspect_ratio: "16:9", source: "user_upload", created_at: "2026-06-29" },
          { id: "img_neon_forest", type: "image", aspect_ratio: "16:9", source: "generated", created_at: "2026-06-29" },
          { id: "vid_cyberpunk_street", type: "video", duration: "10s", source: "generated", created_at: "2026-06-29" }
        ],
        collections: [
          { id: "coll_concept_art", name: "Concept Art", item_count: 2 }
        ]
      };

    case "list_character_entities":
      return {
        characters: [
          { id: "char_kai_shadow", name: "Kai Shadow", description: "Cyberpunk protagonist with glowing blue scars and black trench coat.", visual_ref_id: "img_kai_ref", voice_ref_id: "voice_kai_deep" },
          { id: "char_luna_star", name: "Luna", description: "Ethereal astronaut with a helmet reflecting distant nebulae.", visual_ref_id: "img_luna_ref", voice_ref_id: "voice_luna_soft" }
        ]
      };

    case "list_voice_ingredients":
      return {
        voices: [
          { id: "voice_kai_deep", name: "Kai Deep", gender: "male", tone: "gravelly, stoic, slow-paced" },
          { id: "voice_luna_soft", name: "Luna Soft", gender: "female", tone: "whispery, calm, melodious" }
        ]
      };

    case "list_likeness_avatars":
      return {
        regional_eligibility: "eligible",
        country: "US",
        avatars: [
          { id: "avatar_yashjit_cyber", name: "Yashjit Cyber", registered_at: "2026-06-28", status: "active" }
        ]
      };

    case "get_geo_grounding_image":
      return {
        location: args.location,
        streetview_id: `sv_ground_${Math.floor(Math.random() * 9000 + 1000)}`,
        image_url: "https://images.unsplash.com/photo-1518391846015-55a9cc003b25?q=80&w=600",
        attribution_required: "Street View imagery © 2026 Google",
        grounding_status: "grounded_successfully"
      };

    case "update_collection_membership":
      return {
        collection_id: args.collection_id || "coll_concept_art",
        action: args.action || "add",
        items_affected: args.item_ids?.length || 0,
        status: "success",
        message: "Successfully synchronized collection memberships. Items are organized properly."
      };

    case "rename_workflow":
      return {
        workflow_id: args.workflow_id,
        new_name: args.new_name,
        status: "success"
      };

    case "rename_collection":
      return {
        collection_id: args.collection_id,
        new_name: args.new_name,
        status: "success"
      };

    case "get_help_center_article":
      return {
        query: args.topic,
        articles: [
          {
            title: `Understanding ${args.topic}`,
            content: `The ${args.topic} feature is fully integrated with the creative co-pilot. For advanced capabilities, select the premium tiers (Pro/Ultra).`
          }
        ]
      };

    case "get_changelog_updates":
      return {
        version: "v2.5.0",
        release_date: "2026-06-29",
        updates: [
          "Seamless client-side Agent Harness with custom tool-calling fully operational.",
          "Enhanced sandbox execution environment for storyboard outputs and grounding imagery."
        ]
      };

    case "open_chat_panel":
      return {
        panel_triggered: "chat_panel",
        status: "opened"
      };

    default:
      return {
        status: "unknown_tool",
        message: `Tool ${name} called but is not registered in mock harness.`
      };
  }
};

// Separate generator caller helper to stop the tsc flow-type analyzer from walking and overflowing on the loop body
export const runStreamCall = async (modelInstance: any, history: any[], signal?: AbortSignal): Promise<any> => {
  throwIfAborted(signal);
  return await modelInstance.generateContentStream({ contents: history }, signal ? { signal } : undefined);
};

class GeminiInteractionsUnsupportedError extends Error {
  constructor() {
    super('Gemini Interactions API is unavailable for this request.');
    this.name = 'GeminiInteractionsUnsupportedError';
  }
}

const geminiInteractionInput = (history: any[]): any[] | null => {
  const turns: any[] = [];
  for (const entry of history) {
    const parts = Array.isArray(entry?.parts) ? entry.parts : [];
    if (parts.some((part: any) => typeof part?.text !== 'string')) return null;
    const content = parts
      .map((part: any) => ({ type: 'text', text: part.text }))
      .filter((part: any) => part.text.length > 0);
    if (!content.length) continue;
    turns.push({
      type: entry?.role === 'model' ? 'model_output' : 'user_input',
      content,
    });
  }
  return turns;
};

const interactionJsonSchema = (value: any): any => {
  if (Array.isArray(value)) return value.map(interactionJsonSchema);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = key === 'type' && typeof entry === 'string'
      ? entry.toLowerCase()
      : interactionJsonSchema(entry);
  }
  return result;
};

const interactionFunctionTools = (
  blocks: { functionDeclarations: any[] }[] | undefined,
): any[] => (blocks ?? []).flatMap((block) =>
  (block?.functionDeclarations ?? []).flatMap((declaration: any) =>
    typeof declaration?.name === 'string'
      ? [{
          type: 'function',
          name: declaration.name,
          ...(typeof declaration.description === 'string' ? { description: declaration.description } : {}),
          ...(declaration.parameters ? { parameters: interactionJsonSchema(declaration.parameters) } : {}),
        }]
      : []),
);

const streamGeminiInteractions = async ({
  apiKey,
  model,
  systemInstruction,
  history,
  enableSearch,
  enableCodeExecution,
  functionTools,
  thinkingLevel,
  includeThoughts,
  signal,
  onToken,
  onPhase,
  onThought,
  onCitations,
  onCodeExecutions,
  onUsage,
  onToolCallStart,
  onFunctionCall,
}: {
  apiKey: string;
  model: string;
  systemInstruction?: string;
  history: any[];
  enableSearch: boolean;
  enableCodeExecution: boolean;
  functionTools: any[];
  thinkingLevel: string;
  includeThoughts: boolean;
  signal?: AbortSignal;
  onToken: (text: string) => void;
  onPhase?: (phase: StreamPhase) => void;
  onThought?: (text: string) => void;
  onCitations?: (citations: MessageCitations) => void;
  onCodeExecutions?: (executions: CodeExecution[]) => void;
  onUsage?: (usage: TokenUsage) => void;
  onToolCallStart?: (name: string, args?: any) => void;
  onFunctionCall?: (name: string, args: any) => Promise<any>;
}): Promise<void> => {
  const input = geminiInteractionInput(history);
  if (!input) throw new GeminiInteractionsUnsupportedError();

  const tools = [
    ...(enableSearch ? [{ type: 'google_search' }] : []),
    ...(enableCodeExecution ? [{ type: 'code_execution' }] : []),
    ...functionTools,
  ];
  let answerStarted = false;
  const codeExecutions: CodeExecution[] = [];
  const sources: MessageCitations['sources'] = [];
  const emitCode = () => onCodeExecutions?.(codeExecutions.map((entry) => ({ ...entry })));
  let interactionId = '';
  let interactionStatus = '';
  let latestUsage: TokenUsage | null = null;
  let functionCalls = new Map<number, { id: string; name: string; arguments: string }>();
  // Interactions streams may repeat a step delta while a server-side tool is
  // being assembled. Keep the UI event one-per-search-step; a real second
  // search still gets through when Gemini gives it a different step id/index.
  const reportedInteractionSearches = new Set<string>();
  const interactionStepKey = (event: any, step: any): string | null => {
    const identity = step?.id ?? event.step_id ?? event.stepId ?? event.step_index ?? event.index;
    if (identity !== undefined && identity !== null && String(identity) !== '') {
      return `step:${String(identity)}`;
    }
    return null;
  };
  const reportInteractionSearch = (event: any, step: any, query?: string): void => {
    const key = interactionStepKey(event, step);
    if (key !== null) {
      if (reportedInteractionSearches.has(key)) return;
      reportedInteractionSearches.add(key);
    }
    onToolCallStart?.('web_search', query ? { query } : undefined);
  };

  const handleEvent = (name: string, raw: string): boolean => {
    if (!raw || raw === '[DONE]') return false;
    let event: any;
    try { event = JSON.parse(raw); } catch { return false; }
    // `event_type` is the current discriminator. A few Gemini deployments
    // still expose the transitional `type` field, so accept it as well.
    const type = event.event_type || event.type || name;
    if (type === 'error') throw new Error(event.error?.message || 'Gemini Interactions request failed.');
    if (event.interaction?.id) interactionId = event.interaction.id;
    if (event.interaction?.status) interactionStatus = event.interaction.status;
    latestUsage = normalizeTokenUsage(
      event.usage_metadata ?? event.usage ?? event.interaction?.usage_metadata ?? event.interaction?.usage,
    ) ?? latestUsage;

    const step = event.step || event.content;
    const isStepStart = type === 'step.start' || type === 'content.start';
    if (isStepStart) {
      if (step?.type === 'google_search_call') {
        onPhase?.('searching');
        reportInteractionSearch(event, step);
        return true;
      } else if (step?.type === 'code_execution_call') {
        onPhase?.('executing');
        onToolCallStart?.('code_execution');
        return true;
      } else if (step?.type === 'thought') {
        onPhase?.('thinking');
      } else if (step?.type === 'function_call') {
        onPhase?.('executing');
        functionCalls.set(Number(event.index) || 0, {
          id: typeof step.id === 'string' ? step.id : '',
          name: typeof step.name === 'string' ? step.name : '',
          arguments: '',
        });
      }
    }

    const delta = event.delta;
    const isStepDelta = type === 'step.delta' || type === 'content.delta';
    if (isStepDelta && delta) {
      if (delta.type === 'google_search_call') {
        onPhase?.('searching');
        const queries = Array.isArray(delta.arguments?.queries) ? delta.arguments.queries : [];
        reportInteractionSearch(
          event,
          step,
          typeof queries[0] === 'string' && queries[0] ? queries[0] : undefined,
        );
        return true;
      } else if (delta.type === 'code_execution_call') {
        onPhase?.('executing');
        const code = delta.arguments?.code;
        if (typeof code === 'string' && code.length) {
          codeExecutions.push({
            language: typeof delta.arguments?.language === 'string' ? delta.arguments.language : 'python',
            code,
            position: 0,
          });
          emitCode();
        }
        return true;
      } else if (delta.type === 'code_execution_result') {
        const open = [...codeExecutions].reverse().find((entry) => entry.output === undefined);
        if (open) {
          open.output = typeof delta.result === 'string' ? delta.result : '';
          emitCode();
        }
      } else if (delta.type === 'thought_summary') {
        const text = typeof delta.text === 'string'
          ? delta.text
          : delta.content?.text;
        if (typeof text === 'string' && text.length) onThought?.(text);
      } else if (delta.type === 'text' && typeof delta.text === 'string' && delta.text.length) {
        if (!answerStarted) {
          answerStarted = true;
          onPhase?.('responding');
        }
        onToken(delta.text);
      } else if (delta.type === 'google_search_result' && Array.isArray(delta.result)) {
        for (const result of delta.result) {
          if (typeof result?.url !== 'string' || !result.url) continue;
          sources.push({
            uri: result.url,
            title: typeof result.title === 'string' ? result.title : result.url,
            domain: (() => { try { return new URL(result.url).hostname; } catch { return ''; } })(),
            ...(typeof result.rendered_content === 'string' && result.rendered_content
              ? { snippet: result.rendered_content }
              : {}),
          });
        }
      } else if (delta.type === 'arguments_delta') {
        const index = Number(event.index) || 0;
        const call = functionCalls.get(index);
        if (call && typeof delta.arguments === 'string') call.arguments += delta.arguments;
      }
    }
    return false;
  };

  let nextInput: any = input;
  let previousInteractionId: string | undefined;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    reportedInteractionSearches.clear();
    interactionStatus = '';
    interactionId = '';
    latestUsage = null;
    functionCalls = new Map();
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model,
        input: nextInput,
        stream: true,
        ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
        ...(!previousInteractionId && systemInstruction ? { system_instruction: systemInstruction } : {}),
        ...(tools.length ? { tools } : {}),
        generation_config: {
          thinking_level: thinkingLevel,
          thinking_summaries: includeThoughts ? 'auto' : 'none',
        },
      }),
      signal,
    });
    if (response.status === 400 || response.status === 401 || response.status === 403
      || response.status === 404 || response.status === 405 || response.status === 501) {
      throw new GeminiInteractionsUnsupportedError();
    }
    if (!response.ok || !response.body) {
      throw new Error(`Gemini Interactions request failed with status ${response.status}.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = '';
    let eventData = '';
    while (true) {
      throwIfAborted(signal);
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) eventData += `${line.slice(5).trim()}\n`;
        else if (!line.trim() && eventData) {
          const toolStarted = handleEvent(eventName, eventData.trim());
          eventName = '';
          eventData = '';
          // A search/code step can be followed by another step in the same
          // buffered SSE chunk. Yield once so React paints the live tool label
          // before a later thought or model-output event changes the phase.
          if (toolStarted) await waitWithAbort(0, signal);
        }
      }
      if (done) break;
    }
    if (eventData) {
      const toolStarted = handleEvent(eventName, eventData.trim());
      if (toolStarted) await waitWithAbort(0, signal);
    }
    if (latestUsage) onUsage?.(latestUsage);

    const calls = [...functionCalls.values()].filter((call) => call.name);
    if (interactionStatus !== 'requires_action' || !calls.length || !interactionId || !onFunctionCall) break;
    nextInput = await Promise.all(calls.map(async (call) => {
      let args: any = {};
      try { args = JSON.parse(call.arguments || '{}'); } catch { args = {}; }
      onToolCallStart?.(call.name, args);
      const result = await onFunctionCall(call.name, args);
      return {
        type: 'function_result',
        name: call.name,
        call_id: call.id,
        result: {
          content: [{
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result),
          }],
        },
      };
    }));
    previousInteractionId = interactionId;
  }
  if (sources.length) onCitations?.({ sources, citations: [] });
};

// ============ MAIN STREAM CHAT FUNCTION ============
// Wrapped by `streamChat` below, which normalises aborts across providers.
const streamChatImpl: any = async (
  messages: ChatMessage[],
  options: AiOptions,
  onToken: (token: string) => void,
  onStart: () => void,
  systemPrompt?: string,
  onPhase?: (phase: StreamPhase) => void,
  onToolCall?: (name: string, args: any) => Promise<any>,
  onThought?: (thought: string) => void,
  onCitations?: (citations: MessageCitations) => void,
  onCodeExecutions?: (executions: CodeExecution[]) => void,
  onUsage?: (usage: TokenUsage) => void,
) => {
  const { provider, model, apiKey } = options;
  const messagesList: any = messages;
  const signal = options.signal;
  const maxToolIterations = Math.max(1, options.maxToolIterations ?? 32);
  // A profile's wire format is authoritative. Provider names identify the
  // credential/transport bucket; they must not override an explicit adapter
  // choice (for example, an xAI-format model routed through an OpenAI key).
  const configuredFormat = options.apiFormat || defaultApiFormatForProvider(provider as ProviderId);
  const usesGeminiAdapter = configuredFormat === 'native-gemini';
  const usesAnthropicAdapter = configuredFormat === 'anthropic-messages';
  // xAI speaks OpenAI's Chat Completions wire format. The only differences are
  // which server-side tools it accepts and which models take reasoning_effort,
  // so it shares the OpenAI-compatible request path rather than owning one.
  const usesXaiAdapter = configuredFormat === 'xai-chat-completions';
  const usesOpenAIAdapter = configuredFormat === 'openai-chat-completions'
    || configuredFormat === 'openai-responses'
    || usesXaiAdapter;
  const toolsAllowed = options.toolPolicy !== 'disabled';
  const reportUsage = (raw: any): void => {
    const usage = normalizeTokenUsage(raw);
    if (usage) onUsage?.(usage);
  };

  if (!apiKey) {
    throw new Error(`API Key for ${provider} is missing.`);
  }
  if (!messagesList.length) {
    throw new Error('At least one chat message is required.');
  }
  throwIfAborted(signal);

  onStart();

  if (usesGeminiAdapter) {
    const genAI = getGeminiClient(apiKey);
    
    // Map numeric UI levels to Gemini string labels
    let geminiThinkingLevel: string = model.includes('flash') ? 'high' : 'low';
    if (typeof options.reasoningEffort === 'string' && options.reasoningEffort.trim()) {
      geminiThinkingLevel = options.reasoningEffort.trim();
    } else if (options.thinkingLevel !== undefined) {
      if (model.includes('flash')) {
        const flashMap: Record<number, string> = { 0: 'minimal', 1: 'low', 2: 'medium', 3: 'high' };
        const requestedLevel = model === 'gemini-3.7-flash' && options.thinkingLevel === 0
          ? 1
          : options.thinkingLevel;
        geminiThinkingLevel = flashMap[requestedLevel] ?? 'high';
      } else if (model.startsWith('gemma-4-')) {
        const gemmaMap: Record<number, string> = { 0: 'minimal', 1: 'high' };
        geminiThinkingLevel = gemmaMap[options.thinkingLevel] ?? 'high';
      } else if (model.includes('3.1-pro')) {
        const pro31Map: Record<number, string> = { 1: 'low', 2: 'medium', 3: 'high' };
        geminiThinkingLevel = pro31Map[options.thinkingLevel] || 'high';
      } else {
        const proMap: Record<number, string> = { 1: 'low', 2: 'high' };
        geminiThinkingLevel = proMap[options.thinkingLevel] || 'low';
      }
    }
    console.log(`[AI] Gemini model: ${model}, thinkingLevel: ${options.thinkingLevel} -> "${geminiThinkingLevel}"`);

    const searchEnabled = toolsAllowed && options.enableSearch !== false;
    const codeExecEnabled = toolsAllowed && options.enableCodeExecution === true;
    const tools: any[] = [];
    if (searchEnabled) {
      tools.push(model.includes('1.5') ? { googleSearchRetrieval: {} } : { googleSearch: {} });
    }
    if (codeExecEnabled) {
      tools.push({ codeExecution: {} });
    }

    // Personalization tools (retrieval + connected-product actions), built by
    // @willow/personal and passed in ready to push. Empty blocks are filtered so
    // the array never holds a promise of tools that were deliberately skipped.
    for (const block of options.personalTools ?? []) {
      if (block?.functionDeclarations?.length) tools.push(block);
    }
    for (const block of options.toolDeclarations ?? []) {
      if (block?.functionDeclarations?.length) tools.push(block);
    }

    // The media-agent harness tools, offered only when the caller can execute
    // them. Chat mode leaves this off so the model reaches for search instead of
    // announcing an image generation nothing is wired to perform.
    const mediaToolsEnabled = options.enableMediaTools === true;
    if (mediaToolsEnabled) tools.push({
      functionDeclarations: [
        {
          name: "generate_image",
          description: "Handles text-to-image (T2I), image-to-image (I2I/editing), and reference-to-image (R2I/style transfer) workflows.",
          parameters: {
            type: "OBJECT",
            properties: {
              prompt: { type: "STRING", description: "The descriptive text prompt for generating the image." },
              aspect_ratio: { type: "STRING", description: "The aspect ratio for the image, e.g., '16:9', '1:1', '9:16', '4:3', '3:4'. Defaults to '16:9'." },
              model: { type: "STRING", description: "Which model to use ('gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview', or 'gemini-3.1-flash-lite-image')." },
              batch_size: { type: "STRING", description: "Number of assets to generate: '1x', 'x2', 'x3', 'x4'." },
              references: {
                type: "ARRAY",
                description: "List of style, character, or composition reference image IDs.",
                items: { type: "STRING" }
              }
            },
            required: ["prompt"]
          }
        },
        {
          name: "generate_video_from_text",
          description: "Text-to-video (T2V) generation with style, camera, and audio conditioning.",
          parameters: {
            type: "OBJECT",
            properties: {
              prompt: { type: "STRING", description: "Text description of the video." },
              aspect_ratio: { type: "STRING", description: "Target aspect ratio: '16:9', '9:16'." },
              model: { type: "STRING", description: "Video model to use: 'veo-3.1-fast', 'veo-3.1', 'veo-3.1-lite', 'omni-flash'." },
              duration: { type: "STRING", description: "Video duration: '5s', '8s', '10s'." },
              camera_movement: { type: "STRING", description: "Dynamic camera movement directives (e.g., pan, zoom, tilt, orbit)." },
              audio_track_id: { type: "STRING", description: "Optional background audio or voice reference ID." }
            },
            required: ["prompt"]
          }
        },
        {
          name: "generate_video_with_first_frame",
          description: "Image-to-video (I2V) animation using a starting frame image.",
          parameters: {
            type: "OBJECT",
            properties: {
              first_frame_id: { type: "STRING", description: "The media ID of the starting image frame." },
              prompt: { type: "STRING", description: "A detailed motion directive or text prompt for the animation." },
              model: { type: "STRING", description: "Video model to use." }
            },
            required: ["first_frame_id"]
          }
        },
        {
          name: "generate_video_with_interpolation",
          description: "Veo-only tool to interpolate/morph between a defined start and end frame.",
          parameters: {
            type: "OBJECT",
            properties: {
              start_frame_id: { type: "STRING", description: "The media ID of the starting frame image." },
              end_frame_id: { type: "STRING", description: "The media ID of the ending frame image." },
              prompt: { type: "STRING", description: "Text directive guiding the transition interpolation." }
            },
            required: ["start_frame_id", "end_frame_id"]
          }
        },
        {
          name: "generate_video_with_references",
          description: "Reference-to-video (R2V) for subject/character consistency and style transfer using images or audio.",
          parameters: {
            type: "OBJECT",
            properties: {
              prompt: { type: "STRING", description: "Text instructions guiding the motion/scene." },
              visual_references: {
                type: "ARRAY",
                description: "Array of image/video IDs to keep subject or style consistent.",
                items: { type: "STRING" }
              },
              audio_references: {
                type: "ARRAY",
                description: "Array of audio track/voice IDs to keep speech or audio consistent.",
                items: { type: "STRING" }
              }
            },
            required: ["prompt"]
          }
        },
        {
          name: "generate_video_edit_video",
          description: "Omni Flash exclusive: Video-to-video (V2V) transformation based on text descriptions.",
          parameters: {
            type: "OBJECT",
            properties: {
              video_id: { type: "STRING", description: "The source video media ID to edit." },
              prompt: { type: "STRING", description: "Text description of the styling/editing changes to make." }
            },
            required: ["video_id", "prompt"]
          }
        },
        {
          name: "check_video_generation_status",
          description: "Polls the status of asynchronous video generation tasks.",
          parameters: {
            type: "OBJECT",
            properties: {
              media_id: { type: "STRING", description: "The unique ID of the pending video asset." }
            },
            required: ["media_id"]
          }
        },
        {
          name: "storyboard_writer",
          description: "Generates structured markdown and JSON scene plans for cinematic or informational content.",
          parameters: {
            type: "OBJECT",
            properties: {
              concept: { type: "STRING", description: "Main theme, script concept, or video outline." },
              num_scenes: { type: "INTEGER", description: "Number of scenes to write." }
            },
            required: ["concept"]
          }
        },
        {
          name: "analyze_artifact",
          description: "Performs visual analysis or answers specific queries about image/video artifacts via media ID.",
          parameters: {
            type: "OBJECT",
            properties: {
              media_id: { type: "STRING", description: "The media ID of the asset to analyze." },
              query: { type: "STRING", description: "Specific question or analysis request about the asset." }
            },
            required: ["media_id", "query"]
          }
        },
        {
          name: "list_project_artifacts",
          description: "Fetches inventory of all assets, workflows, and collections in the current project.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "list_character_entities",
          description: "Retrieves defined character entities including visual and voice reference IDs.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "list_voice_ingredients",
          description: "Lists available audio references for speech characteristics.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "list_likeness_avatars",
          description: "Checks regional eligibility and lists registered user avatars.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "get_geo_grounding_image",
          description: "Fetches US-based StreetView imagery for location-specific scene grounding.",
          parameters: {
            type: "OBJECT",
            properties: {
              location: { type: "STRING", description: "US location name, street address, or landmark." }
            },
            required: ["location"]
          }
        },
        {
          name: "update_collection_membership",
          description: "Batch operation for moving, adding, or deleting media and entities within collections.",
          parameters: {
            type: "OBJECT",
            properties: {
              item_ids: { type: "ARRAY", items: { type: "STRING" }, description: "Array of media/entity IDs to modify." },
              action: { type: "STRING", description: "Action to perform: 'add', 'remove', 'move'." },
              collection_id: { type: "STRING", description: "Target collection ID." }
            },
            required: ["item_ids", "action"]
          }
        },
        {
          name: "rename_workflow",
          description: "Modifies display names for workflows/assets.",
          parameters: {
            type: "OBJECT",
            properties: {
              workflow_id: { type: "STRING", description: "ID of the workflow." },
              new_name: { type: "STRING", description: "New display name." }
            },
            required: ["workflow_id", "new_name"]
          }
        },
        {
          name: "rename_collection",
          description: "Modifies display names for collections.",
          parameters: {
            type: "OBJECT",
            properties: {
              collection_id: { type: "STRING", description: "ID of the collection." },
              new_name: { type: "STRING", description: "New display name." }
            },
            required: ["collection_id", "new_name"]
          }
        },
        {
          name: "get_help_center_article",
          description: "Fetches product documentation or feature specifications.",
          parameters: {
            type: "OBJECT",
            properties: {
              topic: { type: "STRING", description: "Help topic or feature keyword (e.g., 'veo', 'credits', 'v2v')." }
            },
            required: ["topic"]
          }
        },
        {
          name: "get_changelog_updates",
          description: "Fetches recent build updates and product changelogs.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "open_chat_panel",
          description: "Triggers the visibility of the primary chat interface.",
          parameters: { type: "OBJECT", properties: {} }
        }
      ]
    });

    const harnessSystemInstruction = `
=== AGENT HARNESS SYSTEM INSTRUCTIONS ===
You are equipped with a state-of-the-art multimedia generation tool suite. You have direct access to image generation, video animation, and metadata management tools.
Adhere to the following rules and guidelines:

1. TONALITY & STYLE (CRITICAL):
   - You must output clean, concise, premium, and professional text.
   - Do NOT use emojis under any circumstances. Emojis are strictly prohibited.
   - Keep outputs short, structured, and highly relevant. Avoid wordy, verbose explanations. Use standard bullet points or bold markers.
   - NEVER print or output raw asset, media, or image IDs (e.g., "item-xxxx" or similar string keys) anywhere in your visible text response. These IDs are strictly for backend tool calling and must remain completely invisible to the user. Always refer to images or videos descriptively (e.g., "the 16:9 landscape", "the second 1:1 illustration") instead.

2. MODEL CAPABILITIES & CONSTRAINTS:
   - "omni-flash": Premium video engine. Exclusive capability for Video-to-Video (V2V) editing (generate_video_edit_video). Supports durations up to 10 seconds. Supports high-fidelity reference-to-video (R2V) with up to 7 image and 5 audio references.
   - "veo-3.1-fast" / "veo-3.1" / "veo-3.1-lite": Specialized for interpolation (first + last frame) and consistent 8s reference-to-video generations. "veo-3.1" (Quality tier) does NOT support reference-based workflows.
   - "gemini-3-pro-image-preview" (Nano Banana Pro), "gemini-3.1-flash-image-preview" (Nano Banana 2), & "gemini-3.1-flash-lite-image" (Nano Banana Lite): Image generation backbone. Nano Banana Pro supports up to 10 style/composition references. Nano Banana 2 and Nano Banana Lite are faster.

3. ASSET STATE & LINEAGE:
   - Lineage Tracking: When editing an image or video, use a ":base" suffix on the ID to maintain version history (media stack) or ":reference" suffix to fork into a new creation.
   - Collection Membership: Move items between root project and nested collections using update_collection_membership. Ensure no item exists in two collections at once.
   - Character Entities: When @character is mentioned, resolve character names to their defined visual and voice reference IDs by calling list_character_entities.

4. EXECUTION WORKFLOWS:
   - Foundation-First: Prioritize building a "creative foundation" (story text, character designs, location references) before triggering expensive media generation tools.
   - Grounding Logic: For specific US locations, first call get_geo_grounding_image, then use its output image as a scene anchor, deblurring and inpainting it.
   - Async Polling: Video generation is asynchronous. Call the tool, retrieve the temporary media_id, and instruct the user that you will check the status or call check_video_generation_status to poll.

5. CREDIT & SUBSCRIPTION TIERS:
   - Free: 50 credits/day, basic model access.
   - Pro/Plus: 200-1000 credits/month, premium models.
   - Ultra: Up to 25,000 credits/month, access to 0-credit lower priority generation queue and 4K upscaling.

6. TOOL CALLING PROTOCOLS:
   - Call tools whenever the user requests image/video generation, edits, storyboards, character lists, grounding, or collection organization.
   - Always announce tool calls clearly or invoke them automatically. Ensure parameters strictly match the schemas.
   - When generating media, inform the user universally when you start the process (e.g., "I am generating..."), and confirm when the generation is complete (e.g., "I have completed generation..."). Do NOT use these exact phrases repetitively; vary your wording naturally each time.
   - Prioritize explicit quantities or counts mentioned in the user's prompt (e.g., "generate one image", "make 2 of them") over the "Active Workspace Generation Settings" default batch size. Only use the default workspace settings if the user does not specify a desired quantity.
   - When the user asks you to edit or modify existing images, you MUST invoke the "generate_image" tool SEPARATELY for each image they want to edit. Each tool call must reference a single specific image ID in the "references" array parameter. If the user asks to edit a specific image (e.g. "the second one", "the one with the red car"), ONLY edit that specific image. If the user asks for a general edit without specifying which image, edit ALL relevant recently generated images by creating a separate tool call for each. The "prompt" argument for each edit call MUST be a highly focused edit instruction describing ONLY the specific changes relative to the referenced image.
   - You HAVE direct visual access to the active images on the canvas via hidden image attachments sent in the user's prompt. Each image attachment is preceded by its Media ID (e.g., "[Visual Context for Canvas Image ID: <id>]"). When the user asks you to edit or describe a specific image (e.g., "edit the one with the orange car"), you can simply look at the images in your context to identify the correct Media ID and proceed. You do not need to use the analyze_artifact tool for images that are already on the canvas.
=========================================
`;

    // With the harness on, it prefixes the caller's prompt and overrides its
    // style rules. With it off, the caller's prompt stands alone — chat mode's
    // own instructions are not something the media harness should be rewriting.
    const combinedSystemPrompt = mediaToolsEnabled
      ? (systemPrompt
          ? `${harnessSystemInstruction}\n\n[USER SYSTEM PROMPT (Note: You MUST enforce our professional emoji-free, concise tonality and override any verbose style patterns defined below)]:\n${systemPrompt}`
          : harnessSystemInstruction)
      : systemPrompt;

    const geminiModel: any = genAI.getGenerativeModel({
      model,
      ...(combinedSystemPrompt ? { systemInstruction: combinedSystemPrompt } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      toolConfig: {
        functionCallingConfig: {
          mode: 'AUTO'
        },
        include_server_side_tool_invocations: true
      },
      generationConfig: {
        // @ts-ignore
        thinkingConfig: {
          thinkingLevel: geminiThinkingLevel,
          includeThoughts: options.includeThoughts === true,
        }
      }
    } as any, getGeminiRequestOptions(options.baseUrl) as any);

    // Reconstruct the full conversation history as a list of raw Content objects manually (bypasses SDK history-stripping bugs)
    let historyContents: any[] = [];
    let foundCachedHistory = false;

    // Search backward to find the most recent assistant message with history
    for (let i = messagesList.length - 2; i >= 0; i--) {
      const m = messagesList[i];
      if (m && m.role === 'assistant' && m.history && m.history.length > 0) {
        historyContents = [...m.history];
        foundCachedHistory = true;
        break;
      }
    }

    if (!foundCachedHistory) {
      // Fall back to building it from scratch if no cached history exists yet (first turn)
      for (const m of (messagesList.slice(0, -1) as any[])) {
        if (m.parts && m.parts.length > 0) {
          historyContents.push({
            role: m.role === 'user' ? 'user' : 'model',
            parts: m.parts,
          });
          continue;
        }
        
        let cleanContent = m.content || '';
        if (m.role === 'assistant' || m.role === 'model') {
          cleanContent = cleanContent.replace(/!\[.*?\]\([^)]+\)/g, '').trim();
        }
        const partsList: any[] = [{ text: cleanContent }];
        if (m.attachments) {
          for (const att of m.attachments) {
            if (att.type === 'image') {
              if (att.id || att.name) {
                partsList.push({ text: `\n\n[Visual Context for Canvas Image ID: ${att.id || att.name.replace('media-id: ', '')}]\n` });
              }
            }
            partsList.push(await resolveGeminiFilePart(apiKey, att as any, signal));
          }
        }
        historyContents.push({
          role: m.role === 'user' ? 'user' : 'model',
          parts: partsList,
        });
      }
    }

    const lastMessage = messagesList[messagesList.length - 1];
    let initialParts: any[] = [];
    if (lastMessage.parts && lastMessage.parts.length > 0) {
      initialParts = lastMessage.parts;
    } else {
      initialParts = [{ text: lastMessage.content }];
      if (lastMessage.attachments) {
        for (const att of lastMessage.attachments) {
          if (att.type === 'image') {
            if (att.id || att.name) {
              initialParts.push({ text: `\n\n[Visual Context for Canvas Image ID: ${att.id || att.name.replace('media-id: ', '')}]\n` });
            }
          }
          initialParts.push(await resolveGeminiFilePart(apiKey, att, signal));
        }
      }
    }

    // Push the active prompt as the latest turn of conversation
    historyContents.push({
      role: 'user',
      parts: initialParts
    });

    // Iterative processing loop to handle arbitrary sequential tool calls without recursion (prevents compiler/runtime stack overflow)
    let keepRunning = true;
    let toolIterations = 0;
    let hasEmittedAnyThought = false;
    // Grounding metadata can be repeated across streamed responses. Report each
    // native Google Search query once, while still retaining every metadata
    // object below for the final citation pass.
    const reportedSearchQueries = new Set<string>();

    // Grounding metadata -> inline source chips. Collected per tool-loop
    // iteration: a support's `groundingChunkIndices` only mean anything within
    // the response that produced them, so the iterations are merged (and their
    // indices re-based) once at the end rather than accumulated in place.
    const citationParts: MessageCitations[] = [];
    // Code-execution blocks accumulate across tool-loop iterations, because a
    // turn can run code, call a custom tool, then run more code. Each change
    // re-emits the whole array (like `onCitations`), so a consumer only ever
    // holds one authoritative list and never has to merge deltas itself.
    const codeExecutions: CodeExecution[] = [];
    const emitCodeExecutions = () => {
      if (codeExecutions.length) onCodeExecutions?.(codeExecutions.map((e) => ({ ...e })));
    };
    let answerText = '';
    const emitToken = (text: string) => {
      answerText += text;
      onToken(text);
    };

    // The Interactions stream is the only Gemini API surface that exposes
    // native server-side tools as typed live steps (`google_search_call`,
    // `code_execution_call`, and their result steps). Use it for ordinary
    // text-only Chat turns; specialized turns keep the legacy path because
    // they need its attachment and custom-tool history handling.
    const interactionsEligible = isOfficialEndpoint('gemini', options.baseUrl)
      && toolsAllowed
      && !options.enableMediaTools
      && (searchEnabled || codeExecEnabled)
      && !!geminiInteractionInput(historyContents);
    if (interactionsEligible) {
      try {
        await streamGeminiInteractions({
          apiKey,
          model,
          systemInstruction: combinedSystemPrompt,
          history: historyContents,
          enableSearch: searchEnabled,
          enableCodeExecution: codeExecEnabled,
          functionTools: [
            ...interactionFunctionTools(options.personalTools),
            ...interactionFunctionTools(options.toolDeclarations),
          ],
          thinkingLevel: geminiThinkingLevel,
          includeThoughts: options.includeThoughts === true,
          signal,
          onToken,
          onPhase,
          onThought,
          onCitations,
          onCodeExecutions,
          onUsage,
          onToolCallStart: options.onToolCallStart,
          onFunctionCall: onToolCall,
        });
        return;
      } catch (error) {
        if (!(error instanceof GeminiInteractionsUnsupportedError)) throw error;
        // Older accounts/models may not expose Interactions yet. Fall through
        // to the existing GenerateContent stream rather than failing Chat.
      }
    }

    while (keepRunning) {
      throwIfAborted(signal);
      if (++toolIterations > maxToolIterations) {
        throw new Error(`AI tool loop exceeded the ${maxToolIterations}-iteration safety limit.`);
      }
      // Direct streaming generation with manual history payload (guarantees cryptographic thought_signature retention)
      const result: any = await runStreamCall(geminiModel as any, historyContents as any, signal);
      
      let currentPhase: StreamPhase = 'thinking';
      let hasEmittedText = false;
      const setPhase = (p: StreamPhase) => {
        if (p !== currentPhase) {
          currentPhase = p;
          onPhase?.(p);
        }
      };

      const pendingFunctionCalls: any[] = [];
      const rawResponseParts: any[] = [];
      let hasEmittedThoughtThisIteration = false;

      // Segment offsets are relative to *this* response's own text, so the
      // iteration's start in the combined answer is the shift to apply.
      const iterationStart = answerText.length;
      let iterationText = '';
      const groundingSeen: any[] = [];
      let reportedSearchWithoutQuery = false;

      const reportLegacySearch = (queries: readonly string[]): void => {
        const freshQueries = queries.filter((query) => !reportedSearchQueries.has(query));
        if (!freshQueries.length && reportedSearchWithoutQuery) return;
        freshQueries.forEach((query) => reportedSearchQueries.add(query));
        reportedSearchWithoutQuery = true;
        options.onToolCallStart?.('web_search', freshQueries[0] ? { query: freshQueries[0] } : undefined);
        setPhase('searching');
      };

      for await (const chunk of result.stream) {
        throwIfAborted(signal);
        const cand: any = (chunk as any).candidates?.[0];

        if (cand?.groundingMetadata) {
          const groundingMetadata = cand.groundingMetadata;
          groundingSeen.push(groundingMetadata);
          const searchQueries = Array.isArray(groundingMetadata.webSearchQueries)
            ? groundingMetadata.webSearchQueries.filter(
                (query: unknown): query is string =>
                  typeof query === 'string'
                  && query.length > 0
                  && !reportedSearchQueries.has(query),
              )
            : [];
          const hasWebGrounding = Array.isArray(groundingMetadata.groundingChunks)
            && groundingMetadata.groundingChunks.some((groundingChunk: any) => !!groundingChunk?.web);
          const hasSearchGrounding = searchQueries.length > 0
            || hasWebGrounding
            || !!groundingMetadata.searchEntryPoint;
          if (hasSearchGrounding) reportLegacySearch(searchQueries);
        }

        const chunkParts: any[] = cand?.content?.parts ?? [];
        for (const part of chunkParts) {
          // The legacy SDK's response aggregator drops newer Part fields such as
          // `thought` and `thoughtSignature`. Retain each streamed delta verbatim
          // for the model history used by subsequent tool-loop requests.
          rawResponseParts.push({ ...part });

          // --- Custom Tool Invocations ---------------------------------------
          if (part?.functionCall) {
            pendingFunctionCalls.push(part.functionCall);
            if (!hasEmittedText) {
              hasEmittedText = true;
              onPhase?.('responding');
            }
            continue;
          }

          // Some newer server-side invocation payloads expose the native search
          // call as a raw part before grounding metadata is attached.
          const nativeSearchCall = part?.googleSearchCall;
          if (nativeSearchCall) {
            const queries = Array.isArray(nativeSearchCall.queries)
              ? nativeSearchCall.queries.filter((query: unknown): query is string => typeof query === 'string' && query.length > 0)
              : Array.isArray(nativeSearchCall.arguments?.queries)
                ? nativeSearchCall.arguments.queries.filter((query: unknown): query is string => typeof query === 'string' && query.length > 0)
                : [];
            reportLegacySearch(queries);
            continue;
          }

          // --- Code execution tool ---------------------------------------------
          // The two halves arrive as separate parts, so the code is published
          // immediately (the panel renders it while the sandbox is still running)
          // and the result is attached to the newest block still awaiting one.
          if (part?.executableCode) {
            setPhase('executing');
            options.onToolCallStart?.('code_execution');
            const code = typeof part.executableCode.code === 'string' ? part.executableCode.code : '';
            if (code) {
              codeExecutions.push({
                language: typeof part.executableCode.language === 'string'
                  ? part.executableCode.language
                  : '',
                code,
                position: iterationStart + iterationText.length,
              });
              emitCodeExecutions();
            }
            continue;
          }
          if (part?.codeExecutionResult) {
            // Search backwards: with parallel blocks the open one is the last.
            // Keep the executing phase through the result. The legacy Gemini
            // stream can deliver executableCode and codeExecutionResult before
            // React gets a paint; switching back to thinking here makes the
            // "Running code" row disappear and repeats the previous thought
            // heading. The next thought/text delta, or turn settlement, owns
            // the transition away from the tool state.
            const open = [...codeExecutions].reverse().find((e) => e.output === undefined);
            if (open) {
              const raw = part.codeExecutionResult.output;
              open.output = typeof raw === 'string' ? raw : '';
              if (typeof part.codeExecutionResult.outcome === 'string') {
                open.outcome = part.codeExecutionResult.outcome;
              }
              emitCodeExecutions();
            }
            continue;
          }

          // Gemini exposes displayable thought summaries as text parts marked
          // with `thought: true`. Keep those out of the answer stream.
          if (part?.thought === true && typeof part?.text === 'string' && part.text.length > 0) {
            const separator = hasEmittedAnyThought && !hasEmittedThoughtThisIteration ? '\n\n' : '';
            onThought?.(`${separator}${part.text}`);
            hasEmittedAnyThought = true;
            hasEmittedThoughtThisIteration = true;
            continue;
          }

          // --- Plain text ------------------------------------------------------
          if (typeof part?.text === 'string' && part.text.length > 0) {
            if (!hasEmittedText) {
              hasEmittedText = true;
              onPhase?.('responding');
            }
            iterationText += part.text;
            emitToken(part.text);
          }
        }
      }

      // Await the SDK's final response so stream-level errors still propagate,
      // but do not use its aggregated parts: v0.24.1 strips thought metadata.
      const fullResponse: any = await (result as any).response;
      reportUsage(fullResponse?.usageMetadata ?? fullResponse?.usage ?? fullResponse?.response?.usageMetadata);
      const canonicalParts: any[] = rawResponseParts.length > 0
        ? rawResponseParts
        : fullResponse?.candidates?.[0]?.content?.parts ?? [];

      // The aggregated response carries the completed grounding metadata; the
      // streamed chunks sometimes carry a more complete one. `pickGroundingMetadata`
      // takes whichever has the most supports rather than merging, because a
      // support's chunk indices are only valid inside its own metadata object.
      const grounding = pickGroundingMetadata([
        ...groundingSeen,
        fullResponse?.candidates?.[0]?.groundingMetadata,
      ]);
      if (grounding) {
        const resolved = resolveCitations(grounding, iterationText, iterationStart);
        if (resolved.citations.length) citationParts.push(resolved);
      }

      // Record the model's actual response parts (including functionCall and thought_signature) verbatim in the conversation history
      historyContents.push({
        role: 'model',
        parts: canonicalParts
      });

      // Execute and feed back custom tool results (including the required thought_signature)
      if (pendingFunctionCalls.length > 0) {
        setPhase('executing');
        const emittedMedia = new Set<string>();

        const responseParts = await Promise.all(
          pendingFunctionCalls.map(async (call) => {
            throwIfAborted(signal);
            options.onToolCallStart?.(call.name, call.args);
            let toolResult: any;
            if (onToolCall) {
              toolResult = await onToolCall(call.name, call.args);
            } else {
              // No executor. Say so rather than falling back to mockExecuteTool,
              // whose canned success payloads let the model report media it never
              // produced. A caller that wants the mock passes it in explicitly.
              toolResult = {
                status: 'error',
                error: `The tool "${call.name}" is not available in this context. Do not claim it ran; use another approach or tell the user plainly.`,
              };
            }
            throwIfAborted(signal);
            
            let sanitizedResult: any = { ...toolResult };
            if (toolResult && typeof toolResult === 'object') {
              if (typeof toolResult.url === 'string' && toolResult.url.startsWith('data:')) {
                sanitizedResult.url = '[Base64 Data URI Rendered in UI]';
              }
              if (Array.isArray(toolResult.urls)) {
                sanitizedResult.urls = toolResult.urls.map(u => 
                  (typeof u === 'string' && u.startsWith('data:')) ? '[Base64 Data URI Rendered in UI]' : u
                );
              }
            }
            
            if (toolResult && typeof toolResult === 'object' && toolResult.already_rendered) {
              // Already rendered inside toolCallback! Skip appending here to prevent duplicates.
            } else if (toolResult && typeof toolResult === 'object' && Array.isArray(toolResult.media_ids)) {
              for (const mediaId of toolResult.media_ids) {
                if (mediaId && !emittedMedia.has(mediaId)) {
                  emittedMedia.add(mediaId);
                  emitToken(`\n\n![Generated Media](media-id:${mediaId})\n\n`);
                }
              }
            } else if (toolResult?.media_id) {
              if (!emittedMedia.has(toolResult.media_id)) {
                emittedMedia.add(toolResult.media_id);
                emitToken(`\n\n![Generated Media](media-id:${toolResult.media_id})\n\n`);
              }
            } else if (toolResult && typeof toolResult === 'object' && Array.isArray(toolResult.urls)) {
              for (const url of toolResult.urls) {
                if (url && !emittedMedia.has(url)) {
                  emittedMedia.add(url);
                  emitToken(`\n\n![Generated Media](${url})\n\n`);
                }
              }
            } else if (toolResult?.url) {
              if (!emittedMedia.has(toolResult.url)) {
                emittedMedia.add(toolResult.url);
                emitToken(`\n\n![Generated Media](${toolResult.url})\n\n`);
              }
            }
            
            const functionResponsePart: any = {
              functionResponse: {
                name: call.name,
                response: { result: sanitizedResult }
              }
            };
            return functionResponsePart;
          })
        );

        setPhase('thinking');

        // Append the user's tool results as the next conversation Content block
        historyContents.push({
          role: 'user',
          parts: responseParts
        });
      } else {
        keepRunning = false;
      }
    }

    if (citationParts.length) {
      const merged = mergeCitations(citationParts);
      if (merged.citations.length) onCitations?.(merged);
    }
    return historyContents;
  } else if (usesOpenAIAdapter) {
    const openai = getOpenAIClient(apiKey, options.baseUrl, provider as ProviderId);

    // Map UI thinking levels to OpenAI reasoning_effort values.
    const reasoningEffortMap: Record<number, "none" | "low" | "medium" | "high" | "xhigh" | "max"> = {
        0: "none",
        1: "low",
        2: "medium",
        3: "high",
        4: "xhigh",
        5: "max",
        6: "max"
    };
    // xAI accepts only low/medium/high, and only on the grok-4 family; sending
    // the field to anything else is a 400. The ceiling belongs to the wire
    // format rather than to the provider, so a Grok model reached through an
    // OpenAI-shaped relay is capped the same way.
    const xaiReasoningEffortMap: Record<number, "low" | "medium" | "high"> = {
        0: "low",
        1: "low",
        2: "medium",
        3: "high",
        4: "high",
    };
    const reasoningEffort = usesXaiAdapter
      ? ((options.reasoningEffort as any) || xaiReasoningEffortMap[options.thinkingLevel ?? 3] || "high")
      : (options.reasoningEffort || reasoningEffortMap[options.thinkingLevel ?? 1] || "medium");
    const sendsReasoningEffort = !usesXaiAdapter || model.startsWith('grok-4');

    const formattedMessages = messages.map(m => {
        let cleanContent = m.content || '';
        if (m.role === 'assistant' || (m.role as any) === 'model') {
            cleanContent = cleanContent.replace(/!\[.*?\]\([^)]+\)/g, '').trim();
        }

        if (!m.attachments || m.attachments.length === 0) {
            return { role: m.role, content: cleanContent };
        }

        const contentParts: any[] = [{ type: "text", text: cleanContent }];
        m.attachments.forEach(att => {
            if (att.type === 'image') {
                contentParts.push({
                    type: "image_url",
                    image_url: {
                        url: `data:${att.mimeType};base64,${att.data}`
                    }
                });
            } else if (att.type === 'text') {
                const label = att.name || att.mimeType;
                contentParts[0].text += `\n\n[Contents of ${label}]\n${att.data}`;
            } else {
                const label = att.name || att.mimeType;
                contentParts[0].text += `\n\n[Attached file: ${label} (${att.mimeType})]`;
            }
        });
        return { role: m.role, content: contentParts };
    });

    const responseInput = messages.map(m => {
        let text = m.content || '';
        if (m.role === 'assistant' || (m.role as any) === 'model') {
            text = text.replace(/!\[.*?\]\([^)]+\)/g, '').trim();
        }
        const attachmentParts: any[] = [];

        m.attachments?.forEach(att => {
            if (att.type === 'image') {
                attachmentParts.push({
                    type: "input_image",
                    image_url: `data:${att.mimeType};base64,${att.data}`,
                    detail: "auto",
                });
            } else if (att.type === 'text') {
                const label = att.name || att.mimeType;
                text += `\n\n[Contents of ${label}]\n${att.data}`;
            } else if (
                att.mimeType === 'application/pdf'
                || /word|document|spreadsheet|excel|presentation|powerpoint|csv|rtf|epub/i.test(att.mimeType)
            ) {
                attachmentParts.push({
                    type: "input_file",
                    filename: att.name || 'attachment',
                    file_data: `data:${att.mimeType};base64,${att.data}`,
                });
            } else {
                const label = att.name || att.mimeType;
                text += `\n\n[Attached file: ${label} (${att.mimeType}). This model endpoint cannot directly inspect this media format.]`;
            }
        });

        if (attachmentParts.length === 0) {
            return { role: m.role, content: text };
        }

        return {
            role: m.role,
            content: [{ type: "input_text", text }, ...attachmentParts],
        };
    });

    const systemMessages = systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : [];

    // Same `enableSearch` toggle as Gemini and Anthropic: the tool runs on the
    // provider's side in all three, so there is nothing extra to configure.
    //
    // `{ type: 'web_search' }` is the shape OpenAI documents for new
    // integrations on the Responses API; `web_search_preview` is its legacy
    // spelling and is not sent. Chat Completions is the awkward half -- OpenAI
    // itself only offers search there through dedicated always-searching models
    // (`gpt-5-search-api`, the deprecated `gpt-4o*-search-preview`), so
    // api.openai.com rejects this tool on an ordinary model. It is sent anyway
    // because this provider is commonly pointed at a relay that does accept it,
    // and `createWithSearchFallback` turns the rejection into one wasted request
    // rather than a failed turn. The rejection arrives before any token, so the
    // retry cannot duplicate output.
    const openaiSearchEnabled = toolsAllowed
      // `function-calling` asks for provider tools to be re-declared as client
      // function declarations, and chat mode has no executor for a search
      // function -- so for OpenAI, whose relay may genuinely want that shape,
      // the policy means no server-side search. xAI is exempt for the same
      // reason Gemini and Anthropic are: search is the only tool it offers
      // here, so honouring the policy just turns search off. Every xAI profile
      // stored before this change still carries `function-calling` from an
      // older default, and a stale default must not silently disable search.
      && (usesXaiAdapter || options.toolPolicy !== 'function-calling')
      && options.enableSearch !== false;
    // xAI exposes two server-side search tools and needs both declared to reach
    // X (Twitter) as well as the open web. Declaring them as client-executed
    // `function` tools instead is what used to make Grok answer in two turns:
    // the model has no results on the first pass, so it narrates the gap.
    const openaiSearchTools = usesXaiAdapter
      ? [{ type: 'web_search' }, { type: 'x_search' }]
      : [{ type: 'web_search' }];

    const chatCompletionParams = {
      model,
      // @ts-ignore
      messages: [...systemMessages, ...formattedMessages],
      ...(sendsReasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    } as any;

    const hasOpenAIFileInput = messages.some((message) => message.attachments?.some((attachment) => (
      attachment.type === 'file'
      && (
        attachment.mimeType === 'application/pdf'
        || /word|document|spreadsheet|excel|presentation|powerpoint|csv|rtf|epub/i.test(attachment.mimeType)
      )
    )));

    const openaiHarvest: CompatSearchHarvest = { annotations: [], sources: [] };
    let openaiAnswerText = '';

    if (configuredFormat === 'openai-responses' || model === "gpt-5.5-pro" || hasOpenAIFileInput) {
      let response = await createWithSearchFallback(
        (searchEnabled) => openai.responses.create({
          model,
          input: responseInput,
          ...(systemPrompt ? { instructions: systemPrompt } : {}),
          ...(sendsReasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
          ...(searchEnabled ? { tools: openaiSearchTools } : {}),
          ...(model === "gpt-5.5-pro" ? { background: true } : {}),
        } as any, signal ? { signal } : undefined),
        openaiSearchEnabled,
        signal,
      );

      const startedAt = Date.now();
      const maxWaitMs = 10 * 60 * 1000;
      while (response.status === "queued" || response.status === "in_progress") {
        throwIfAborted(signal);
        if (Date.now() - startedAt > maxWaitMs) {
          throw new Error(`${model} file response timed out.`);
        }

        await waitWithAbort(2000, signal);
        response = await openai.responses.retrieve(response.id, undefined, signal ? { signal } : undefined);
      }

      if (response.status !== "completed") {
        const message = response.error?.message || response.incomplete_details?.reason || response.status;
        throw new Error(`${model} response did not complete: ${message}`);
      }

      reportUsage((response as any).usage);

      const content = response.output_text || "";
      if (content) onToken(content);
      openaiAnswerText = content;
      // On the Responses API the citations hang off each `output_text` part
      // rather than off the response, so the annotations have to be gathered
      // from the output tree. `web_search_call` items are skipped: they record
      // that a search happened, not what it found.
      for (const item of Array.isArray((response as any).output) ? (response as any).output : []) {
        for (const part of Array.isArray(item?.content) ? item.content : []) {
          if (Array.isArray(part?.annotations)) openaiHarvest.annotations.push(...part.annotations);
        }
      }
    } else {
      const stream = await createWithSearchFallback(
        (searchEnabled) => openai.chat.completions.create({
          ...chatCompletionParams,
          ...(searchEnabled ? { tools: openaiSearchTools } : {}),
          stream: true,
        } as any, signal ? { signal } : undefined),
        openaiSearchEnabled,
        signal,
      );

      let hasEmittedText = false;
      let hasEmittedThought = false;

      for await (const chunk of stream as any) {
        throwIfAborted(signal);
        harvestCompatSearchChunk(chunk, openaiHarvest);
        reportUsage(chunk?.usage);
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        const reasoningContent = delta.reasoning_content;
        if (reasoningContent) {
          if (!hasEmittedThought) {
            hasEmittedThought = true;
          }
          onThought?.(reasoningContent);
        }

        const content = delta.content || "";
        if (content) {
          if (!hasEmittedText) {
            hasEmittedText = true;
            onPhase?.('responding');
          }
          onToken(content);
          // Accumulated because the annotation offsets index into the answer,
          // and they arrive at the end of the stream when the text is complete.
          openaiAnswerText += content;
        }
      }
    }

    if (openaiHarvest.annotations.length || openaiHarvest.sources.length) {
      const resolved = resolveCompatCitations(openaiHarvest, openaiAnswerText);
      if (resolved.sources.length) onCitations?.(resolved);
    }
  } else if (usesAnthropicAdapter) {
    // Both native Anthropic and custom gateways speak the Messages API; the
    // client resolves whether to call upstream directly or via the dev proxy.
    const anthropic = getAnthropicClient(apiKey, options.baseUrl);

    const formattedMessages = messages.map(m => {
        if (!m.attachments || m.attachments.length === 0) {
             return { role: m.role, content: m.content };
        }
        
        const contentParts: any[] = [{ type: "text", text: m.content }];
        m.attachments.forEach(att => {
            if (att.type === 'image') {
                contentParts.push({
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: att.mimeType as any,
                        data: att.data
                    }
                });
            } else if (att.type === 'text') {
                 const label = att.name || att.mimeType;
                 contentParts[0].text += `\n\n[Contents of ${label}]\n${att.data}`;
            } else if (att.mimeType === 'application/pdf') {
                 contentParts.push({
                   type: "document",
                   source: {
                     type: "base64",
                     media_type: "application/pdf",
                     data: att.data,
                   },
                 });
            } else {
                 const label = att.name || att.mimeType;
                 contentParts[0].text += `\n\n[Attached file: ${label} (${att.mimeType}). This Anthropic endpoint cannot directly inspect this media format.]`;
            }
        });
        return { role: m.role, content: contentParts };
    });

    // Anthropic runs search server-side, like Gemini's `googleSearch`, so the
    // same `enableSearch` toggle governs both and no separate key is needed.
    //
    // `web_search_20250305` rather than a newer version on purpose: from
    // `web_search_20260209` onward `allowed_callers` defaults to
    // `["code_execution_20260120"]`, which routes the search through the code
    // execution tool (dynamic filtering) and returns a 400 on models that cannot
    // call tools programmatically. This version calls directly on every model
    // that supports the tool at all, which is what a chat turn wants.
    //
    // Sent to whatever endpoint is configured, official or not: a custom base URL
    // is taken to mean its owner supplies the tool natively. That is a deliberate
    // choice, so the one measured failure mode is worth recording. A New
    // API-family relay accepted `tools` without validating it —
    // `web_search_20250305` and a nonexistent `web_search_29999999` returned
    // byte-identical responses, where api.anthropic.com 400s on an unknown type —
    // then ran its own search and returned the result list *as* the reply (`I'll
    // search for "<prompt>".Here are the search results …`) with zero
    // `citations_delta`. The model never answers, and since the template only
    // echoes the prompt, every turn renders as the same message with no error. If
    // replies through a gateway ever look templated and identical, turn search off
    // before looking anywhere else.
    const anthropicSearchEnabled = toolsAllowed && options.enableSearch !== false;
    const anthropicTools = anthropicSearchEnabled
      ? [{ type: 'web_search_20250305', name: 'web_search' }]
      : [];

    const stream = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      // @ts-ignore
      messages: formattedMessages,
      ...(anthropicTools.length ? { tools: anthropicTools as any } : {}),
      stream: true,
    }, signal ? { signal } : undefined);

    // Citations arrive per content block and carry no offsets into the answer,
    // so the span each block occupies has to be tracked as it streams. See
    // `AnthropicCitedBlock`.
    const anthropicSearchResults: any[] = [];
    const anthropicBlocks: AnthropicCitedBlock[] = [];
    let anthropicTextLength = 0;
    let currentBlock: AnthropicCitedBlock | null = null;

    for await (const messageStreamEvent of stream) {
      throwIfAborted(signal);
      const event = messageStreamEvent as any;
      reportUsage(event.usage ?? event.message?.usage ?? event.delta?.usage);

      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block?.type === 'text') {
          currentBlock = { start: anthropicTextLength, end: anthropicTextLength, citations: [] };
          // A non-streaming path can deliver a whole block's citations here
          // rather than as deltas.
          if (Array.isArray(block.citations)) currentBlock.citations.push(...block.citations);
        } else if (namesWebSearch(block?.type) || namesWebSearch(block?.name)) {
          // `content` is the result list on success and a single error object
          // when the search failed (rate limits, `max_uses_exceeded`); the API
          // still returns HTTP 200 either way, so the shape is the only signal.
          //
          // The block is matched by `namesWebSearch` rather than against the
          // literal `web_search_tool_result` so that an endpoint spelling its own
          // search tool differently (`Web_Search`, `WebSearch`, `websearch`) still
          // lands here with nothing configured. `name` is checked alongside `type`
          // because a relay can put the tool's name in either field. The array
          // guard is what keeps the matching invocation block -- `server_tool_use`
          // named `web_search`, which carries `input`, not `content` -- from
          // being read as though it were a result.
          if (Array.isArray(block.content)) anthropicSearchResults.push(...block.content);
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta?.type === 'text_delta') {
          onToken(delta.text);
          anthropicTextLength += delta.text.length;
          if (currentBlock) currentBlock.end = anthropicTextLength;
        } else if (delta?.type === 'thinking_delta') {
          onThought?.(delta.thinking);
        } else if (delta?.type === 'citations_delta' && delta.citation) {
          if (currentBlock) currentBlock.citations.push(delta.citation);
        }
      } else if (event.type === 'content_block_stop') {
        if (currentBlock && currentBlock.citations.length) anthropicBlocks.push(currentBlock);
        currentBlock = null;
      }
    }
    if (currentBlock && currentBlock.citations.length) anthropicBlocks.push(currentBlock);

    if (anthropicBlocks.length || anthropicSearchResults.length) {
      const resolved = resolveAnthropicCitations(anthropicSearchResults, anthropicBlocks);
      // Fired on sources, not citations. An endpoint that returns real
      // `web_search_tool_result` blocks and no `citations_delta` -- measured on a
      // relay -- still has sources worth showing; it gets the sources panel and
      // no inline chips instead of losing the search entirely.
      if (resolved.sources.length) onCitations?.(resolved);
    }
  } else if (provider === 'moonshot' || provider === 'zhipuai') {
    // OpenAI-compatible providers (Moonshot/Kimi, Zhipu AI/GLM)
    const { url: compatibleBaseUrl, headers: compatibleHeaders } =
      resolveEndpointTransport(provider, options.baseUrl, 'v1');

    const compatibleApiKey = normalizeOpenAICompatibleApiKey(apiKey);
    const client = new OpenAI({
        apiKey: compatibleApiKey,
        baseURL: compatibleBaseUrl,
        timeout: 60 * 60 * 1000,
        dangerouslyAllowBrowser: true,
        ...(compatibleHeaders ? { defaultHeaders: compatibleHeaders } : {})
    });

    const compatibleReasoningEffortMap: Record<number, 'none' | 'low' | 'medium' | 'high' | 'max'> = {
      0: 'none',
      1: 'low',
      2: 'medium',
      3: 'high',
      4: 'max',
    };
    const reasoningEffort = (options.reasoningEffort as any) || compatibleReasoningEffortMap[options.thinkingLevel ?? 0] || 'medium';

    const formattedMessages = messages.map(m => {
        let cleanContent = m.content || '';
        if (m.role === 'assistant' || (m.role as any) === 'model') {
            cleanContent = cleanContent.replace(/!\[.*?\]\([^)]+\)/g, '').trim();
        }
        if (!m.attachments || m.attachments.length === 0) {
            return { role: m.role, content: cleanContent };
        }
        const contentParts: any[] = [{ type: "text", text: cleanContent }];
        m.attachments.forEach(att => {
            if (att.type === 'image') {
                contentParts.push({
                    type: "image_url",
                    image_url: {
                        url: `data:${att.mimeType};base64,${att.data}`
                    }
                });
            } else if (att.type === 'text') {
                const label = att.name || att.mimeType;
                contentParts[0].text += `\n\n[Contents of ${label}]\n${att.data}`;
            } else {
                const label = att.name || att.mimeType;
                contentParts[0].text += `\n\n[Attached file: ${label} (${att.mimeType}). This compatible chat endpoint cannot directly inspect the binary contents.]`;
            }
        });
        return { role: m.role, content: contentParts };
    });

    const systemMessages = systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : [];

    const compatSearchTools: Record<string, any[]> = {
      zhipuai: [{
        type: 'web_search',
        web_search: { enable: 'True', search_result: 'True' },
      }],
    };
    const compatSearchEnabled = toolsAllowed && options.enableSearch !== false
      && !!compatSearchTools[provider];

    const stream = await createWithSearchFallback<any>(
      (searchEnabled) => client.chat.completions.create({
        model,
        // @ts-ignore
        messages: [...systemMessages, ...formattedMessages],
        ...(provider === 'moonshot' || (provider === 'zhipuai' && model === 'glm-5.3')
          ? { reasoning_effort: reasoningEffort }
          : {}),
        ...(provider === 'zhipuai' && model === 'glm-5.3'
          ? { thinking: { type: 'enabled' } }
          : {}),
        ...(searchEnabled ? { tools: compatSearchTools[provider] } : {}),
        stream: true,
      } as any, signal ? { signal } : undefined) as any,
      compatSearchEnabled,
      signal,
    );

    let hasEmittedText = false;
    let hasEmittedThought = false;
    const compatHarvest: CompatSearchHarvest = { annotations: [], sources: [] };
    let compatAnswerText = '';

    for await (const chunk of stream) {
      throwIfAborted(signal);
      harvestCompatSearchChunk(chunk, compatHarvest);
      reportUsage(chunk?.usage);
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      const reasoningContent = delta.reasoning_content;
      if (reasoningContent) {
        if (!hasEmittedThought) {
          hasEmittedThought = true;
        }
        onThought?.(reasoningContent);
      }

      const content = delta.content;
      if (content) {
        if (!hasEmittedText) {
          hasEmittedText = true;
          onPhase?.('responding');
        }
        onToken(content);
        compatAnswerText += content;
      }
    }

    if (compatHarvest.annotations.length || compatHarvest.sources.length) {
      const resolved = resolveCompatCitations(compatHarvest, compatAnswerText);
      if (resolved.sources.length) onCitations?.(resolved);
    }
  }
};

/**
 * Every provider's stream, with one guarantee added: if the caller aborted, the
 * error that comes out is a real `AbortError`.
 *
 * SDKs rewrap a mid-stream abort into their own error type and lose the name and
 * code that identify it — the Gemini SDK surfaces "[GoogleGenerativeAI Error]:
 * Error reading from the stream", the OpenAI-compatible clients surface their own
 * connection errors. Callers that classified by error shape therefore showed a
 * failure when the user had simply pressed stop, and each new provider brought a
 * new error string to special-case.
 *
 * The signal is authoritative and provider-independent, so the translation belongs
 * here — once — rather than in every call site. `isAbortError` at any caller now
 * works for all providers. The original error is kept as `cause` so a genuine
 * failure that happens to race an abort is still debuggable.
 */
export const streamChat: any = async (...args: any[]) => {
  const signal: AbortSignal | undefined = args[1]?.signal;
  try {
    return await streamChatImpl(...args);
  } catch (error) {
    if (signal?.aborted && !isAbortError(error)) {
      throw Object.assign(
        new DOMException('The AI request was cancelled.', 'AbortError'),
        { cause: error },
      );
    }
    throw error;
  }
};

// Fast session title generator using gemini-3.1-flash-lite with minimal thinking effort.
export const generateSessionTitle = async (firstPrompt: string, apiKey: string): Promise<string> => {
  if (!apiKey) return 'Untitled session';
  try {
    const genAI = getGeminiClient(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      generationConfig: {
        // @ts-ignore
        thinkingConfig: {
          thinkingLevel: 'minimal'
        }
      }
    } as any);

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          text: `You are a session titling bot. Generate a short, punchy 2-4 word title for a chat session based on this first user prompt. Respond ONLY with the title itself, no quotes, no markdown, no punctuation at the end, and no other text.
Prompt: "${firstPrompt}"`
        }]
      }]
    });

    const text = result.response.text().trim().replace(/^["']|["']$/g, '');
    return text || 'Untitled session';
  } catch (e) {
    console.error('Failed to generate session title:', e);
    return 'Untitled session';
  }
};
