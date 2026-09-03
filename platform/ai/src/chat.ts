import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_BASE_URLS, isOfficialEndpoint, resolveEndpointTransport, type ProviderId } from "./providers/endpoints";
import { defaultApiFormatForProvider, nativeToolFormatForProvider, type ProviderApiFormat, type ProviderToolPolicy } from './providers/profiles';
import { geminiFlashStartsAtLow } from './models/efforts';
import { mergeCitations, namesUrlCitation, namesWebSearch, pickGroundingMetadata, resolveAnthropicCitations, resolveCitations, resolveCompatCitations, type AnthropicCitedBlock, type CompatSearchHarvest, type GroundingCitation, type MessageCitations } from "./grounding";
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

/**
 * Life-cycle phases of one streamed turn.
 *
 * `executing` means the *code execution* tool specifically — the UI labels it
 * "Running code", so anything else routed through it lies about what is
 * happening. `tooling` is every other tool call: a declared function the app
 * executes itself (Canvas, personalization). It carries no app-written label,
 * because Gemini's own label for a custom tool was never captured and inventing
 * one is worse than the row it already has.
 */
export type StreamPhase = 'thinking' | 'searching' | 'executing' | 'tooling' | 'responding';

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
  /**
   * Further keys for the same bucket, tried in order if `apiKey` is rejected as
   * a credential. This is what makes the Settings field's "separate multiple keys
   * with commas" promise true; see the rotation loop in `streamChat`.
   */
  apiKeyFallbacks?: string[];
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
 * Does this error name a particular request parameter?
 *
 * The narrow sibling of `namesSearchToolRejection`, for the same reason it exists:
 * this app is routinely pointed at a relay, and a relay implements whatever subset
 * of the API it feels like. Rather than gate an optional parameter on endpoint
 * identity — which tests who is answering rather than what they support — each one
 * is sent once and dropped if it comes back named in the rejection.
 */
const namesRejectedParameter = (error: any, parameter: RegExp): boolean => {
  const parts = [
    error?.message,
    error?.error?.message,
    error?.error?.param,
    error?.error?.code,
    error?.response?.data?.error?.message,
  ].filter((part) => typeof part === 'string');
  return parts.length ? parameter.test(parts.join(' ')) : false;
};

/**
 * Drop the space a model puts at the front of a continuation.
 *
 * Used only where a paragraph break has just been inserted between two rounds of
 * a tool loop. A model that narrates before calling a tool ends round one with
 * `…look that up.` and opens round two with `` Done — …`` — that leading space is
 * its attempt to join the two into one sentence, which is precisely what the break
 * replaces. Left in, it renders as an indented second paragraph.
 */
const stripLeadingSpace = (text: string): string => text.replace(/^[^\S\r\n]+/, '');

/**
 * True when a failure means "this credential is finished", and not merely that
 * this request failed.
 *
 * Drives the key rotation in `streamChat`, so the bar is deliberately high: a
 * false positive spends one of the user's other keys on a problem that key does
 * not fix. Status is checked first because it is unambiguous where it is present,
 * and Gemini is the reason the message test exists at all — it reports a bad key
 * as a 400 `API_KEY_INVALID` rather than a 401. Rate limits and quota exhaustion
 * are explicitly NOT auth failures: the key is valid and the next one is likely
 * to be throttled too, so those surface as-is rather than burning the rotation.
 */
const namesAuthRejection = (error: any): boolean => {
  const status = Number(error?.status ?? error?.response?.status ?? 0);
  const parts = [
    error?.message,
    error?.error?.message,
    error?.error?.status,
    error?.error?.code,
    error?.response?.data?.error?.message,
  ].filter((part) => typeof part === 'string');
  const text = parts.join(' ');
  if (/quota|rate.?limit|too many requests|overloaded|429/i.test(text)) return false;
  if (status === 401 || status === 403) return true;
  return /api[\s._-]*key|unauthenticated|unauthorized|invalid.{0,20}credential|permission[\s._-]*denied/i.test(text);
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
  if (!searchRequested) {
    console.warn('[AI] Server-side search was not requested for this turn — see `openaiSearchEnabled`.');
    return attempt(false);
  }
  try {
    return await attempt(true);
  } catch (error: any) {
    throwIfAborted(signal);
    if (isAbortError(error) || !namesSearchToolRejection(error)) throw error;
    /* Logged because the degrade is otherwise invisible: the retry succeeds, the
       answer looks normal, and the only symptom is a model that says it has no
       search tool. Every other degrade path in this file announces itself. */
    console.warn(
      '[AI] Endpoint rejected the server-side search tool; retrying without it.',
      String(error?.message ?? error),
    );
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
export const getGeminiRequestOptions = (baseUrl?: string, endpointProvider: ProviderId = 'gemini'): Record<string, unknown> => {
  if (isOfficialEndpoint(endpointProvider, baseUrl)) return {};
  const { url, headers } = resolveEndpointTransport(endpointProvider, baseUrl, 'origin');
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

const getAnthropicClient = (
  apiKey: string,
  baseUrl?: string,
  endpointProvider: ProviderId = 'anthropic',
): Anthropic => {
  const cacheKey = `${endpointProvider}::${apiKey}::${baseUrl || ''}`;
  if (clientCache.anthropic?.key === cacheKey) {
    return clientCache.anthropic.client;
  }
  /* The SDK appends `/v1/messages` itself, so hand it a bare origin.
   *
   * `endpointProvider` is the profile's transport, NOT the format's own provider:
   * a Zhipu or Moonshot profile switched to `anthropic-messages` must fall back to
   * that provider's base URL, not to api.anthropic.com with a key it will reject. */
  const { url, headers } = resolveEndpointTransport(endpointProvider, baseUrl, 'origin');
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

/**
 * Where the Files API lives for this turn.
 *
 * Both calls below used to name `generativelanguage.googleapis.com` outright, so
 * attaching a file on a profile pointed at a private gateway sent the key and the
 * file to Google anyway — the one direct call a custom base URL exists to prevent.
 * It also could not work against a relay that does proxy the Files API. Resolved
 * from the profile now, exactly like every other Gemini request; a relay that does
 * not implement it fails the upload and `resolveGeminiFilePart` falls back inline.
 */
const geminiFilesOrigin = (baseUrl: string | undefined, endpointProvider: ProviderId): string =>
  resolveEndpointTransport(endpointProvider, baseUrl, 'origin').url;

async function uploadToGeminiFiles(
  apiKey: string,
  base64Data: string,
  mimeType: string,
  displayName: string,
  signal?: AbortSignal,
  filesOrigin: string = DEFAULT_BASE_URLS.gemini,
): Promise<string> {
  // Convert base64 to bytes
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Step 1: Start resumable upload
  const startResponse = await fetch(
    `${filesOrigin}/upload/v1beta/files?key=${apiKey}`,
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
      `${filesOrigin}/v1beta/${resourceName}?key=${apiKey}`,
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

async function resolveGeminiFilePart(
  apiKey: string,
  att: Attachment,
  signal?: AbortSignal,
  filesOrigin: string = DEFAULT_BASE_URLS.gemini,
): Promise<any> {
  throwIfAborted(signal);
  if (att.type === 'text') {
    const label = att.name || att.mimeType || 'text attachment';
    return { text: `\n\n[Contents of ${label}]\n${att.data}` };
  }
  if (!att.data) throw new Error(`Attachment data is unavailable for ${att.name || att.mimeType}`);
  /* Keyed by origin as well as content: a `files/...` URI is issued by one
     endpoint and means nothing to another, so a cache hit carried across a base-URL
     change would reference a file the new endpoint has never seen. */
  const fingerprint = `${filesOrigin}::${getAttachmentFingerprint(att)}`;
  const cachedUri = geminiFileCache.get(fingerprint);

  if (cachedUri) {
    return { fileData: { fileUri: cachedUri, mimeType: att.mimeType } };
  }

  try {
    const fileUri = await uploadToGeminiFiles(apiKey, att.data, att.mimeType, att.name || 'attachment', signal, filesOrigin);
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

/**
 * The same declarations, in Anthropic's shape.
 *
 * Callers write ONE tool list, in Gemini's `functionDeclarations` form, and every
 * adapter translates. Until this existed the Anthropic branch sent `tools` for web
 * search and nothing else, so a model selected from the Models tab was told about
 * Canvas in the system prompt and given no way to call it — reported as "I tried
 * changing the model and asked claude opus 5 to do another change, and I noticed
 * that instead of doing the change, it started outputting html code". That is
 * exactly what a model does when it has been asked to write a document, told a tool
 * exists, and handed no tool: it writes the document into the reply.
 *
 * `input_schema` rather than `parameters`, and the schema goes through
 * `interactionJsonSchema` because Gemini spells its types in caps (`OBJECT`,
 * `STRING`) and JSON Schema does not. A declaration with no `parameters` still
 * needs a schema — Anthropic rejects a tool without one — so it gets the empty
 * object.
 */
const anthropicFunctionTools = (
  blocks: { functionDeclarations: any[] }[] | undefined,
): any[] => (blocks ?? []).flatMap((block) =>
  (block?.functionDeclarations ?? []).flatMap((declaration: any) =>
    typeof declaration?.name === 'string'
      ? [{
          name: declaration.name,
          ...(typeof declaration.description === 'string' ? { description: declaration.description } : {}),
          input_schema: declaration.parameters
            ? interactionJsonSchema(declaration.parameters)
            : { type: 'object', properties: {} },
        }]
      : []),
);

/**
 * The same declarations again, in the two OpenAI shapes.
 *
 * Chat Completions nests the function under a `function` key; the Responses API
 * flattened it. Both lowercase their JSON Schema types, so both go through
 * `interactionJsonSchema` — a Gemini-shaped `OBJECT` reaches OpenAI as a 400.
 *
 * Same gap this fixes as `anthropicFunctionTools`: these branches sent server-side
 * search and nothing else, so Canvas and the personalization tools were declared in
 * the system prompt and unavailable in the request. A model in that position writes
 * the document into the reply.
 */
const openAIChatFunctionTools = (
  blocks: { functionDeclarations: any[] }[] | undefined,
): any[] => (blocks ?? []).flatMap((block) =>
  (block?.functionDeclarations ?? []).flatMap((declaration: any) =>
    typeof declaration?.name === 'string'
      ? [{
          type: 'function',
          function: {
            name: declaration.name,
            ...(typeof declaration.description === 'string' ? { description: declaration.description } : {}),
            parameters: declaration.parameters
              ? interactionJsonSchema(declaration.parameters)
              : { type: 'object', properties: {} },
          },
        }]
      : []),
);

const openAIResponsesFunctionTools = (
  blocks: { functionDeclarations: any[] }[] | undefined,
): any[] => (blocks ?? []).flatMap((block) =>
  (block?.functionDeclarations ?? []).flatMap((declaration: any) =>
    typeof declaration?.name === 'string'
      ? [{
          type: 'function',
          name: declaration.name,
          ...(typeof declaration.description === 'string' ? { description: declaration.description } : {}),
          parameters: declaration.parameters
            ? interactionJsonSchema(declaration.parameters)
            : { type: 'object', properties: {} },
        }]
      : []),
);

/**
 * `{}` rather than a throw.
 *
 * `input_json_delta` fragments are concatenated as they arrive, so a stream cut
 * mid-object leaves invalid JSON. An empty object reaches the executor, which
 * answers with the error it already has for a call it cannot satisfy — the turn
 * survives and the model is told, which is strictly better than the turn dying on
 * a `SyntaxError` the user sees as a failed request.
 */
const safeParseToolInput = (json: string): any => {
  if (!json || !json.trim()) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/** What a tool hands back, as the wire wants it: text, not an object. */
const toolResultText = (result: any): string => (
  typeof result === 'string' ? result : JSON.stringify(result ?? { status: 'ok' })
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
  /*
   * Grounding on the Interactions transport, and why it needs its own bookkeeping.
   *
   * The legacy `generateContentStream` path reads `groundingMetadata`, which carries
   * the sources and the supports together at the end of the response. Interactions
   * streams the same information as `text_annotation_delta` events instead —
   * `{ annotations: [{ start_index, end_index, url, title, type: 'url_citation' }] }`
   * — and this adapter did not read them, so on every Interactions turn the source
   * pill and the per-sentence chips silently stopped appearing. Measured on
   * gemini-3.7-flash: `google_search_result` now carries `search_suggestions` HTML
   * and no URLs at all, so the old reader found nothing to report.
   *
   * Sources are deduplicated by URL because one page is usually cited by several
   * sentences, and `sourceIndices` has to point at ONE entry per page or the cards
   * repeat. Spans are keyed by range for the same reason in the other direction: two
   * pages citing the same sentence are one chip with two sources.
   */
  const sourceIndexByUrl = new Map<string, number>();
  const spansByRange = new Map<string, GroundingCitation>();
  /** Length of the answer as streamed, so a stale offset can be clamped to it. */
  let answerLength = 0;
  const emitCode = () => onCodeExecutions?.(codeExecutions.map((entry) => ({ ...entry })));
  let interactionId = '';
  let interactionStatus = '';
  let latestUsage: TokenUsage | null = null;
  /*
   * Two argument buffers per call, deliberately never merged.
   *
   * `deltas` is the concatenation of `arguments_delta` fragments — a JSON
   * document being streamed in pieces, meaningless until the last piece lands.
   * `whole` is a complete value absorbed off a step or delta that carried one.
   *
   * Holding both in one string is a bug with a very quiet failure: a
   * `function_call` step opens with a placeholder `arguments: {}`, so the buffer
   * starts as the two characters `{}`, and the fragments then append to it —
   * producing `{}{"content":"…"}`, which does not parse. The call reaches the
   * executor with `{}` and Canvas rejects it for having no content, which is
   * exactly the error the model reported back. Kept apart, each buffer is parsed
   * on its own and the better of the two wins.
   */
  let functionCalls = new Map<number, { id: string; name: string; deltas: string; whole: string }>();
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

  /*
   * Function-call arguments arrive in more than one shape.
   *
   * The documented one is a `function_call` step opened by `step.start` and
   * filled by a run of `arguments_delta` events. But the same stream also
   * carries them complete — as an object or a pre-serialised string — on the
   * step itself, on `step.start` for a short call and on `step.done` for any
   * call whose deltas were coalesced upstream. Reading only the deltas is how a
   * tool gets invoked with `{}`: the executor then rejects it for a missing
   * required field, and the turn ends looking like the model simply stopped.
   *
   * So a complete value is *absorbed* into `whole`, and only when it is at least
   * as long as what is already there — a later placeholder `arguments: {}` must
   * not erase a set that already arrived in full.
   */
  const absorbCallArguments = (index: number, step: any): void => {
    const call = functionCalls.get(index);
    if (!call || !step) return;
    if (!call.name && typeof step.name === 'string') call.name = step.name;
    if (!call.id && typeof step.id === 'string') call.id = step.id;
    const raw = step.arguments ?? step.args ?? step.input;
    if (raw === undefined || raw === null) return;
    let text = '';
    if (typeof raw === 'string') text = raw;
    else if (typeof raw === 'object') {
      try { text = JSON.stringify(raw); } catch { text = ''; }
    }
    if (text.length > call.whole.length) call.whole = text;
  };

  /*
   * The arguments, as an object, from whichever buffer actually holds them.
   *
   * Both are tried and the richer parse wins, measured by key count: a streamed
   * `deltas` run is normally the complete set and a `whole` absorbed from the
   * opening step is normally the empty placeholder, but a coalesced stream
   * inverts that — it sends no deltas at all and puts everything on `step.done`.
   * Neither buffer can be trusted to be the good one, and an unparseable buffer
   * (a fragment run cut short by an abort) simply loses to the other.
   */
  const callArguments = (call: { deltas: string; whole: string }): any => {
    const parse = (text: string): any => {
      const trimmed = (text || '').trim();
      if (!trimmed) return null;
      try {
        const value = JSON.parse(trimmed);
        return value && typeof value === 'object' ? value : null;
      } catch { return null; }
    };
    const fromDeltas = parse(call.deltas);
    const fromWhole = parse(call.whole);
    if (!fromDeltas) return fromWhole ?? {};
    if (!fromWhole) return fromDeltas;
    return Object.keys(fromDeltas).length >= Object.keys(fromWhole).length ? fromDeltas : fromWhole;
  };

  /*
   * `function_call` is the name this API uses; `tool_call` is the name every
   * neighbouring API uses. Accepting both costs nothing and means a rename
   * upstream degrades into "the tool ran" rather than "the turn stopped".
   */
  const isFunctionCallStep = (step: any): boolean =>
    !!step && (step.type === 'function_call' || step.type === 'tool_call');

  /** Open a call if this is the first event for it, then absorb its arguments. */
  const registerCall = (index: number, step: any): void => {
    if (!functionCalls.has(index)) {
      functionCalls.set(index, {
        id: typeof step?.id === 'string' ? step.id : '',
        name: typeof step?.name === 'string' ? step.name : '',
        deltas: '',
        whole: '',
      });
    }
    absorbCallArguments(index, step);
  };

  /*
   * Last net under the step events: the interaction object itself.
   *
   * `requires_action` means the model is blocked on a tool result, so the calls
   * it is waiting on are listed on the interaction — and a deployment that
   * coalesces its stream can deliver them there and nowhere else. Reading them
   * is what stops the "one sentence of preamble and no document" turn: without
   * it, an unrecognised step shape ends the turn silently.
   *
   * Keyed at a 1000 offset so a repeated terminal event lands in the same slot
   * (`absorbCallArguments` only ever widens) and never collides with an SSE
   * index. A call the steps already gave us in full is not duplicated.
   */
  const sweepInteractionCalls = (interaction: any): void => {
    if (!interaction) return;
    const lists = [interaction.output, interaction.steps, interaction.required_action?.function_calls];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      list.forEach((entry: any, position: number) => {
        const call = entry?.function_call || entry?.tool_call || entry;
        if (!call || typeof call.name !== 'string' || !call.name) return;
        /*
         * A nested `function_call` / `tool_call` field, or a matching `type`, is
         * proof. A bare `{ name, arguments }` — which is the shape
         * `required_action.function_calls` uses — carries no type at all, so it
         * is accepted on the absence of a *contradicting* one; a `thought` or
         * `text` step naming itself would otherwise be mistaken for a call.
         */
        const nested = !!(entry?.function_call || entry?.tool_call);
        const typed = isFunctionCallStep(entry) || isFunctionCallStep(call);
        const untyped = typeof entry?.type !== 'string' && typeof call?.type !== 'string';
        if (!nested && !typed && !untyped) return;
        const slot = 1000 + position;
        if (functionCalls.has(slot)) { absorbCallArguments(slot, call); return; }
        const raw = call.arguments ?? call.args ?? call.input;
        const length = typeof raw === 'string'
          ? raw.length
          : (raw && typeof raw === 'object' ? JSON.stringify(raw).length : 0);
        for (const seen of functionCalls.values()) {
          const held = Math.max(seen.deltas.length, seen.whole.length);
          if (seen.name === call.name && held >= length) return;
        }
        registerCall(slot, call);
      });
    }
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
    if (event.interaction) sweepInteractionCalls(event.interaction);
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
      } else if (isFunctionCallStep(step)) {
        onPhase?.('tooling');
        // A short call can arrive complete on the opening event, with no deltas.
        registerCall(Number(event.index) || 0, step);
      }
    }

    /*
     * `step.done` closes a call. It repeats the step, and for a coalesced stream
     * it is the ONLY event carrying the arguments — so it is read even though
     * nothing else here needs it. A done event for a call we never saw open is
     * still registered: losing the call entirely is worse than a missing phase.
     */
    if (type === 'step.done' || type === 'content.done') {
      if (isFunctionCallStep(step)) registerCall(Number(event.index) || 0, step);
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
        answerLength += delta.text.length;
        onToken(delta.text);
      } else if (delta.type === 'text_annotation_delta' && Array.isArray(delta.annotations)) {
        /* The grounding, as this transport reports it — see the note at
           `sourceIndexByUrl`. `url_citation` is the only type observed; anything
           else is ignored rather than guessed at, since a shape we cannot read is
           better dropped than turned into a chip pointing somewhere wrong. */
        for (const annotation of delta.annotations) {
          if (annotation?.type && annotation.type !== 'url_citation') continue;
          const uri = typeof annotation?.url === 'string' ? annotation.url : '';
          if (!uri) continue;
          let index = sourceIndexByUrl.get(uri);
          if (index === undefined) {
            index = sources.length;
            sourceIndexByUrl.set(uri, index);
            /* The redirect URL hides the real host, so the title is all there is —
               and it IS the host on this API ("youtube.com"). Deriving the domain
               from the URI instead would label every chip
               `vertexaisearch.cloud.google.com`, which is the redirector rather than
               the publisher. Same rule `grounding.ts` applies to a 1.5-era chunk
               with no `domain`: take the title when it looks like a hostname. */
            const title = typeof annotation.title === 'string' && annotation.title ? annotation.title : uri;
            const looksLikeHost = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title);
            sources.push({
              uri,
              title,
              domain: looksLikeHost
                ? title
                : (() => { try { return new URL(uri).hostname; } catch { return ''; } })(),
            });
          }
          const start = Math.floor(Number(annotation.start_index));
          const end = Math.floor(Number(annotation.end_index));
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) continue;
          const key = `${start}:${end}`;
          const existing = spansByRange.get(key);
          if (existing) {
            if (!existing.sourceIndices.includes(index)) existing.sourceIndices.push(index);
          } else {
            spansByRange.set(key, { startIndex: start, endIndex: end, sourceIndices: [index] });
          }
        }
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
        /*
         * Registered on first sight rather than looked up: a stream that opens
         * the call with a bare `step.start` we did not recognise would otherwise
         * drop every fragment, and the name still arrives on `step.done`.
         */
        if (!functionCalls.has(index)) registerCall(index, { id: '', name: '' });
        const call = functionCalls.get(index);
        if (call && typeof delta.arguments === 'string') call.deltas += delta.arguments;
        // A delta that carries the whole object rather than a JSON fragment goes
        // to the other buffer — appending it would corrupt the fragment run.
        else if (call && delta.arguments && typeof delta.arguments === 'object') {
          absorbCallArguments(index, delta);
        }
      } else if (isFunctionCallStep(delta)) {
        // Some deployments deliver the call itself as a delta, complete.
        const index = Number(event.index) || 0;
        if (!functionCalls.has(index)) onPhase?.('tooling');
        registerCall(index, delta);
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

    /*
     * One rescue before the calls are run: an index mismatch.
     *
     * `event.index` is what ties a fragment run to the call it belongs to, and a
     * stream that omits it on one event kind and sets it on another splits a
     * single call across two slots — the name in one, the arguments in the
     * other. The named half then executes with `{}` while the half holding the
     * document is thrown away for having no name, which is indistinguishable
     * from the model calling the tool wrongly.
     *
     * Only the unambiguous case is repaired: exactly one named call with nothing
     * in either buffer, and exactly one nameless entry that has something. With
     * two of either there is no way to say which belongs to which, and guessing
     * would write one document's text into another's call.
     */
    const starved = calls.filter((call) => !call.deltas && !call.whole);
    const orphans = [...functionCalls.values()].filter((call) => !call.name && (call.deltas || call.whole));
    if (starved.length === 1 && orphans.length === 1) {
      starved[0].deltas = orphans[0].deltas;
      starved[0].whole = orphans[0].whole;
    }

    /*
     * A call the stream showed us is RUN even when the interaction did not end in
     * `requires_action`.
     *
     * The documented handshake is: status `requires_action`, we execute, we post
     * the results back with `previous_interaction_id`. When any part of that is
     * missing — a terminal status we do not recognise, a deployment that omits
     * the interaction id — the old code broke out of the loop and dropped the
     * call on the floor. For a side-effecting tool that is the worst possible
     * outcome: the model announced what it was about to do, the tool never ran,
     * and the turn ended looking like the model simply stopped mid-thought. That
     * is exactly how a Canvas turn failed — one sentence of preamble and no
     * document anywhere.
     *
     * So the results are only fed back when the handshake is complete; the calls
     * themselves run either way. Executing without a feedback round means the
     * model never learns the outcome, which is the lesser cost — its turn is over
     * by then, and every executor here already reports into the UI itself.
     */
    const canFeedResultsBack = interactionStatus === 'requires_action' && !!interactionId;
    if (!calls.length || !onFunctionCall) break;
    if (!canFeedResultsBack) {
      for (const call of calls) {
        const args = callArguments(call);
        onToolCallStart?.(call.name, args);
        await onFunctionCall(call.name, args);
      }
      break;
    }

    nextInput = await Promise.all(calls.map(async (call) => {
      const args = callArguments(call);
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
  /*
   * One emit, with the spans this time.
   *
   * `citations: []` was what made a grounded Interactions turn render source cards
   * and no inline chips even when the annotations were there — the sources were
   * reported and the ranges thrown away. Offsets are clamped to the answer actually
   * streamed, because an annotation that arrives for text a later error truncated
   * would otherwise point past the end of the message.
   */
  if (sources.length) {
    const citations = [...spansByRange.values()]
      .map((span) => ({
        ...span,
        startIndex: Math.min(span.startIndex, answerLength),
        endIndex: Math.min(span.endIndex, answerLength),
      }))
      .filter((span) => span.endIndex > span.startIndex)
      .sort((a, b) => a.startIndex - b.startIndex);
    onCitations?.({ sources, citations });
  }
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
  /*
   * Server-side built-ins — search, code execution, x_search — as opposed to
   * Willow's own function declarations.
   *
   * `function-calling` is the Tool translation setting for an endpoint that speaks
   * plain function calling and nothing else: a relay that would 400 on
   * `googleSearch` or reject Anthropic's `web_search` tool type. It means one thing
   * on every provider now. It used to mean nothing at all on Gemini and Anthropic,
   * and on OpenAI it was read as "no search" with xAI exempted — three behaviours
   * from one dropdown.
   */
  const nativeToolsAllowed = toolsAllowed && options.toolPolicy !== 'function-calling';
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
    /* Attachments upload to whichever endpoint this profile names, not to Google
       regardless of it — see `geminiFilesOrigin`. */
    const filesOrigin = geminiFilesOrigin(options.baseUrl, provider as ProviderId);
    
    // Map numeric UI levels to Gemini string labels
    let geminiThinkingLevel: string = model.includes('flash') ? 'high' : 'low';
    if (typeof options.reasoningEffort === 'string' && options.reasoningEffort.trim()) {
      geminiThinkingLevel = options.reasoningEffort.trim();
    } else if (options.thinkingLevel !== undefined) {
      if (model.includes('flash')) {
        const flashMap: Record<number, string> = { 0: 'minimal', 1: 'low', 2: 'medium', 3: 'high' };
        // Releases with no `minimal` step floor at Low rather than sending one.
        // The picker hides level 0 for these too — same list, see efforts.ts.
        const requestedLevel = geminiFlashStartsAtLow(model) && options.thinkingLevel === 0
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

    /* Built-ins, so the Tool translation setting governs them — see
       `nativeToolsAllowed`. The function declarations below are separate. */
    const searchEnabled = nativeToolsAllowed && options.enableSearch !== false;
    const codeExecEnabled = nativeToolsAllowed && options.enableCodeExecution === true;
    const tools: any[] = [];
    if (searchEnabled) {
      tools.push(model.includes('1.5') ? { googleSearchRetrieval: {} } : { googleSearch: {} });
    }
    if (codeExecEnabled) {
      tools.push({ codeExecution: {} });
    }

    /* Personalization tools (retrieval + connected-product actions), built by
       @willow/personal and passed in ready to push. Empty blocks are filtered so
       the array never holds a promise of tools that were deliberately skipped.

       Gated on `toolsAllowed`, like the OpenAI and Anthropic paths below. Without
       the gate `disabled` withheld only the built-ins here, so the one dropdown
       meant "no tools at all" on two providers and "no search" on this one — the
       exact per-provider divergence `nativeToolsAllowed` was written to end. */
    if (toolsAllowed) {
      for (const block of options.personalTools ?? []) {
        if (block?.functionDeclarations?.length) tools.push(block);
      }
      for (const block of options.toolDeclarations ?? []) {
        if (block?.functionDeclarations?.length) tools.push(block);
      }
    }

    // The media-agent harness tools, offered only when the caller can execute
    // them. Chat mode leaves this off so the model reaches for search instead of
    // announcing an image generation nothing is wired to perform.
    const mediaToolsEnabled = toolsAllowed && options.enableMediaTools === true;
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
    } as any, getGeminiRequestOptions(options.baseUrl, provider as ProviderId) as any);

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
            partsList.push(await resolveGeminiFilePart(apiKey, att as any, signal, filesOrigin));
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
          initialParts.push(await resolveGeminiFilePart(apiKey, att, signal, filesOrigin));
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
    /* Turn-level, unlike the per-iteration flags inside the loop. */
    let hasEmittedAnyAnswerText = false;
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
      /* Distinct from `hasEmittedText`, which a bare `functionCall` part also sets
         — that flag means "something happened", not "the answer has text in it". */
      let hasEmittedTextThisIteration = false;

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
            /* New paragraph when a later iteration speaks after an earlier one did
               — same rule as the thought summaries above. A model that narrates
               before a function call answers in the next iteration, and without
               this the two run together as one sentence. */
            const separator = hasEmittedAnyAnswerText && !hasEmittedTextThisIteration ? '\n\n' : '';
            if (!hasEmittedText) {
              hasEmittedText = true;
              onPhase?.('responding');
            }
            hasEmittedTextThisIteration = true;
            hasEmittedAnyAnswerText = true;
            const emitted = separator ? separator + stripLeadingSpace(part.text) : part.text;
            iterationText += emitted;
            emitToken(emitted);
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
        // A declared function, not the code sandbox — see `StreamPhase`.
        setPhase('tooling');
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
    /*
     * Kimi and GLM take this field too, but not the whole vocabulary: `xhigh` is
     * OpenAI's own and 400s there. They were served by a dedicated branch that
     * could never run — both default to `openai-chat-completions`, which is handled
     * here — so their request shape came here with them rather than being lost.
     */
    const compatReasoningEffortMap: Record<number, "none" | "low" | "medium" | "high" | "max"> = {
        0: "none",
        1: "low",
        2: "medium",
        3: "high",
        4: "max",
        5: "max",
        6: "max"
    };
    const isCompatProvider = provider === 'moonshot' || provider === 'zhipuai';
    const reasoningEffort = usesXaiAdapter
      ? ((options.reasoningEffort as any) || xaiReasoningEffortMap[options.thinkingLevel ?? 3] || "high")
      : isCompatProvider
        ? ((options.reasoningEffort as any) || compatReasoningEffortMap[options.thinkingLevel ?? 1] || "medium")
        : (options.reasoningEffort || reasoningEffortMap[options.thinkingLevel ?? 1] || "medium");
    /* GLM takes it on its reasoning model only; every other GLM 400s on the field. */
    const sendsReasoningEffort = usesXaiAdapter
      ? model.startsWith('grok-4')
      : provider === 'zhipuai'
        ? model === 'glm-5.3'
        : true;
    /* GLM's reasoning switch is separate from the effort, and it is its own field. */
    const sendsGlmThinking = provider === 'zhipuai' && model === 'glm-5.3' && (options.thinkingLevel ?? 0) > 0;

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
    const openaiSearchEnabled = nativeToolsAllowed
      && options.enableSearch !== false
      /* Moonshot is the one provider with no search tool here: its `$web_search`
         builtin could not be verified against current docs, and a guessed schema
         sent to a relay turns a working turn into a 400. Its replies are still
         read for sources. */
      && !!nativeToolFormatForProvider(provider as ProviderId, configuredFormat);
    /*
     * The built-ins each format understands — and for xAI, WHICH ENDPOINT.
     *
     * `web_search` and `x_search` are Responses-API vocabulary. Sending them on
     * Chat Completions is a 422 before the model ever runs, measured in the user's
     * own gateway log against grok-4.6:
     *
     *     tools[0].type: unknown variant `web_search`,
     *                    expected `function` or `live_search`
     *
     * `createWithSearchFallback` then retried without search and got a clean 200,
     * which is why this looked like it worked for weeks: every Grok turn answered,
     * none of them searched, and the only trace was one wasted round trip.
     *
     * So the chat path asks for `live_search` — the variant the endpoint's own error
     * names — and `xaiChatSearchTools` degrades from there. The Responses path keeps
     * the agentic pair, which is where they were always correct.
     *
     * Zhipu nests its configuration and needs `search_result` before results come
     * back at all — and those strings really are `'True'`, not booleans. This used
     * to live in a provider branch that could never run (both compat providers
     * default to `openai-chat-completions`, which is served above), so GLM search
     * silently degraded to OpenAI's flat shape.
     */
    /*
     * xAI's tools follow the CREDENTIAL as well as the format.
     *
     * `x_search` is xAI's alone — nobody else has an index of X to search — so an
     * xAI profile pointed at the Responses format must still get the pair, and the
     * `xai-chat-completions` flag cannot express that: it is a format, and that
     * profile is no longer on it. Keying on either means "this endpoint is xAI",
     * which is the actual question.
     */
    const isXaiEndpoint = usesXaiAdapter || provider === 'spacexai';
    const openaiResponsesSearchTools = isXaiEndpoint
      ? [{ type: 'web_search' }, { type: 'x_search' }]
      : provider === 'zhipuai'
        ? [{ type: 'web_search', web_search: { enable: 'True', search_result: 'True' } }]
        : [{ type: 'web_search' }];
    /*
     * Two spellings of xAI's Live Search, tried in order, because which one an
     * endpoint accepts is not knowable in advance: `live_search` is what api.x.ai
     * named in its rejection, and `search_parameters` is the long-documented
     * top-level block that gateways implemented first. A relay may have either.
     * Both are dropped by the same fallback if neither lands.
     */
    let xaiSearchAttempt = 0;
    const XAI_SEARCH_SHAPES: { tools?: any[]; extra?: Record<string, any> }[] = [
      { tools: [{ type: 'live_search' }] },
      { extra: { search_parameters: { mode: 'auto', return_citations: true } } },
    ];

    /* Canvas and the personalization tools, in both OpenAI shapes. Same executor
       as every other provider — `onToolCall` knows nothing about wire formats. */
    const openaiDeclarations = toolsAllowed
      ? [...(options.personalTools ?? []), ...(options.toolDeclarations ?? [])]
      : [];
    const openaiChatFunctions = openAIChatFunctionTools(openaiDeclarations);
    const openaiResponsesFunctions = openAIResponsesFunctionTools(openaiDeclarations);

    const chatCompletionParams = {
      model,
      ...(sendsReasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(sendsGlmThinking ? { thinking: { type: 'enabled' } } : {}),
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

    /* One line saying what this turn is actually asking for. A model reporting
       that it has no search tool is indistinguishable, from the outside, between
       "Willow never sent one", "the endpoint rejected it" and "the endpoint
       accepted it and ignored it" — and those have three different fixes. */
    console.log('[AI] %s turn: format=%s toolPolicy=%s search=%s builtIns=%s functions=%d', provider, configuredFormat,
      options.toolPolicy ?? '(default)',
      openaiSearchEnabled,
      openaiSearchEnabled
        ? (configuredFormat === 'openai-responses' ? openaiResponsesSearchTools : XAI_SEARCH_SHAPES[0].tools ?? [])
          .map((tool: any) => tool.type).join('+') || '(top-level params)'
        : 'none',
      openaiDeclarations.reduce((total, block: any) => total + (block?.functionDeclarations?.length ?? 0), 0));

    if (configuredFormat === 'openai-responses' || model === "gpt-5.5-pro" || hasOpenAIFileInput) {
      /*
       * The Responses path, in two modes and one loop.
       *
       * `background: true` is gpt-5.5-pro's own requirement and it cannot stream — the
       * response is polled until it completes. Everything else STREAMS now: it used to
       * await the whole response and emit `output_text` in one `onToken`, so a long
       * answer sat on a blank screen and then appeared at once, while the Chat
       * Completions path beside it streamed token by token. Same API, same app, two
       * different feelings.
       *
       * The loop is the tool handshake: this API continues a turn by appending the
       * model's own `function_call` item and a `function_call_output` carrying the
       * result, keyed by `call_id`.
       */
      const background = model === 'gpt-5.5-pro';
      const responsesInput: any[] = Array.isArray(responseInput) ? [...responseInput] : responseInput;
      /* Turn-level, unlike `hasEmittedResponseText` inside each round. */
      let hasEmittedAnyResponseText = false;

      for (let round = 0; ; round += 1) {
        const pendingCalls: { id: string; callId: string; name: string; args: string }[] = [];
        let response: any = null;

        if (background) {
          response = await createWithSearchFallback(
            (searchEnabled) => openai.responses.create({
              model,
              input: responsesInput,
              ...(systemPrompt ? { instructions: systemPrompt } : {}),
              ...(sendsReasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
              ...((searchEnabled ? openaiResponsesSearchTools : []).concat(openaiResponsesFunctions).length
                ? { tools: [...(searchEnabled ? openaiResponsesSearchTools : []), ...openaiResponsesFunctions] }
                : {}),
              background: true,
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

          const content = response.output_text || "";
          if (content) {
            onPhase?.('responding');
            const emitted = hasEmittedAnyResponseText ? `\n\n${stripLeadingSpace(content)}` : content;
            hasEmittedAnyResponseText = true;
            onToken(emitted);
            openaiAnswerText += emitted;
          }
        } else {
          const stream = await createWithSearchFallback(
            (searchEnabled) => openai.responses.create({
              model,
              input: responsesInput,
              ...(systemPrompt ? { instructions: systemPrompt } : {}),
              ...(sendsReasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
              ...((searchEnabled ? openaiResponsesSearchTools : []).concat(openaiResponsesFunctions).length
                ? { tools: [...(searchEnabled ? openaiResponsesSearchTools : []), ...openaiResponsesFunctions] }
                : {}),
              stream: true,
            } as any, signal ? { signal } : undefined),
            openaiSearchEnabled,
            signal,
          );

          let hasEmittedResponseText = false;
          /* Every event this loop does not recognise is dropped on the floor, so a
             stream in an unexpected shape ends the turn with an empty reply and no
             error anywhere. Recording the types is the only way to tell that apart
             from a model that genuinely said nothing. */
          const seenEventTypes = new Set<string>();
          for await (const rawEvent of stream as any) {
            throwIfAborted(signal);
            const event = rawEvent as any;
            const type = String(event?.type ?? '');
            seenEventTypes.add(type || '(untyped)');
            if (type === 'response.output_text.delta') {
              const delta = typeof event.delta === 'string' ? event.delta : '';
              if (!delta) continue;
              const separator = !hasEmittedResponseText && hasEmittedAnyResponseText ? '\n\n' : '';
              if (!hasEmittedResponseText) {
                hasEmittedResponseText = true;
                onPhase?.('responding');
              }
              hasEmittedAnyResponseText = true;
              const emitted = separator ? separator + stripLeadingSpace(delta) : delta;
              onToken(emitted);
              openaiAnswerText += emitted;
            } else if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
              /* The only reasoning this API exposes is its summary; a model that
                 emits none simply never sends these. */
              if (typeof event.delta === 'string' && event.delta) {
                onPhase?.('thinking');
                onThought?.(event.delta);
              }
            } else if (type === 'response.output_item.added' && event.item?.type === 'web_search_call') {
              onPhase?.('searching');
            } else if (type === 'response.output_item.done' && event.item?.type === 'function_call') {
              onPhase?.('tooling');
              pendingCalls.push({
                id: String(event.item.id ?? ''),
                callId: String(event.item.call_id ?? ''),
                name: String(event.item.name ?? ''),
                args: typeof event.item.arguments === 'string' ? event.item.arguments : '',
              });
            } else if (type === 'response.completed' || type === 'response.incomplete') {
              response = event.response;
            } else if (type === 'error') {
              throw new Error(String(event.message || event.error?.message || 'The response stream failed.'));
            }
          }

          if (!hasEmittedResponseText && !pendingCalls.length) {
            console.warn(
              '[AI] Responses stream produced no answer text and no tool call. Event types seen: %s',
              [...seenEventTypes].join(', ') || '(the stream was empty)',
            );
          }
        }

        if (response) {
          reportUsage(response.usage);
          // On the Responses API the citations hang off each `output_text` part
          // rather than off the response, so the annotations have to be gathered
          // from the output tree. `web_search_call` items are skipped: they record
          // that a search happened, not what it found.
          for (const item of Array.isArray(response.output) ? response.output : []) {
            for (const part of Array.isArray(item?.content) ? item.content : []) {
              if (Array.isArray(part?.annotations)) openaiHarvest.annotations.push(...part.annotations);
            }
            /* The polled path never saw `output_item.done`, so its calls are read
               off the finished response instead. */
            if (background && item?.type === 'function_call') {
              pendingCalls.push({
                id: String(item.id ?? ''),
                callId: String(item.call_id ?? ''),
                name: String(item.name ?? ''),
                args: typeof item.arguments === 'string' ? item.arguments : '',
              });
            }
          }
        }

        if (!pendingCalls.length || !onToolCall || round >= maxToolIterations - 1) {
          if (pendingCalls.length && onToolCall) {
            for (const call of pendingCalls) {
              const args = safeParseToolInput(call.args);
              options.onToolCallStart?.(call.name, args);
              await onToolCall(call.name, args);
            }
          }
          break;
        }

        for (const call of pendingCalls) {
          const args = safeParseToolInput(call.args);
          options.onToolCallStart?.(call.name, args);
          const result = await onToolCall(call.name, args);
          /* Both halves go back: the call as the model made it, then its output.
             `call_id` is what pairs them — `id` identifies the item, not the call. */
          responsesInput.push({
            type: 'function_call',
            call_id: call.callId,
            name: call.name,
            arguments: JSON.stringify(args),
          });
          responsesInput.push({
            type: 'function_call_output',
            call_id: call.callId,
            output: toolResultText(result),
          });
        }
      }
    } else {
      /*
       * Chat Completions, with the same tool loop the other adapters have.
       *
       * The protocol here is the oldest of the three and the fiddliest to stream: a
       * call arrives as `delta.tool_calls`, an array of PARTIAL entries keyed by
       * `index`, whose `function.arguments` is a fragment to concatenate. The name
       * can arrive on the first fragment only, and the id with it — so entries are
       * merged by index rather than pushed.
       */
      const chatMessages: any[] = [...systemMessages, ...formattedMessages];
      /*
       * Chat Completions sends NO usage on a streamed response unless it is asked to,
       * so the token counts this app shows were absent on every OpenAI and Grok turn
       * while Gemini and Anthropic reported theirs.
       *
       * Asked for on EVERY endpoint and dropped if one names it in a rejection — the
       * same rule the search tool follows, and for the reason stated there: gating on
       * `!options.baseUrl` tests who is answering rather than what they support, and
       * a relay that does implement the field would lose its token counts for
       * nothing. The cost of being wrong is one retried request before a token has
       * been emitted.
       */
      let sendsStreamOptions = true;
      /*
       * One ladder for the whole chat path, rather than `createWithSearchFallback`
       * plus a nested retry.
       *
       * It has to be one, because the steps interact: xAI's Live Search has two
       * possible spellings, and the generic "drop search" fallback would have fired
       * on the first rejection and never tried the second. Each step drops exactly
       * what the endpoint named, and every rejection here arrives before a token has
       * been emitted, so no retry can duplicate output.
       */
      let searchWanted = openaiSearchEnabled;
      /* Turn-level, unlike `hasEmittedText` below, which resets every round. */
      let hasEmittedAnyAnswerText = false;

      for (let round = 0; ; round += 1) {
        const openChatStream = async (): Promise<any> => {
          for (;;) {
            const searchShape = isXaiEndpoint ? XAI_SEARCH_SHAPES[xaiSearchAttempt] : null;
            const builtIns = !searchWanted
              ? []
              : isXaiEndpoint
                ? (searchShape?.tools ?? [])
                : openaiResponsesSearchTools;
            const extra = searchWanted && searchShape?.extra ? searchShape.extra : {};
            try {
              return await openai.chat.completions.create({
                ...chatCompletionParams,
                messages: chatMessages,
                ...(builtIns.concat(openaiChatFunctions).length
                  ? { tools: [...builtIns, ...openaiChatFunctions] }
                  : {}),
                ...extra,
                stream: true,
                ...(sendsStreamOptions ? { stream_options: { include_usage: true } } : {}),
              } as any, signal ? { signal } : undefined);
            } catch (error: any) {
              throwIfAborted(signal);
              if (isAbortError(error)) throw error;
              /* xAI first: try its other Live Search spelling before giving search up.
                 The 422 names the offending member, so this only fires on a rejection
                 that mentions one of the two. */
              if (
                isXaiEndpoint
                && searchWanted
                && xaiSearchAttempt < XAI_SEARCH_SHAPES.length - 1
                && namesRejectedParameter(error, /live_search|search_parameters|web_search|x_search|tools/i)
              ) {
                xaiSearchAttempt += 1;
                console.warn(
                  `[AI] xAI rejected search shape ${xaiSearchAttempt} of ${XAI_SEARCH_SHAPES.length}; trying the next spelling.`,
                  String(error?.message ?? error),
                );
                continue;
              }
              if (searchWanted && namesSearchToolRejection(error)) {
                searchWanted = false;
                console.warn(
                  '[AI] Endpoint rejected the server-side search tool; continuing without search.',
                  String(error?.message ?? error),
                );
                continue;
              }
              if (sendsStreamOptions && namesRejectedParameter(error, /stream_options|include_usage/i)) {
                sendsStreamOptions = false;
                continue;
              }
              throw error;
            }
          }
        };
        const stream = await openChatStream();

        let hasEmittedText = false;
        let hasEmittedThought = false;
        let roundText = '';
        const calls = new Map<number, { id: string; name: string; args: string }>();

        for await (const chunk of stream as any) {
          throwIfAborted(signal);
          harvestCompatSearchChunk(chunk, openaiHarvest);
          reportUsage(chunk?.usage);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          const reasoningContent = delta.reasoning_content;
          if (reasoningContent) {
            if (!hasEmittedThought) {
              hasEmittedThought = true;
              onPhase?.('thinking');
            }
            onThought?.(reasoningContent);
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const part of delta.tool_calls) {
              const index = Number(part?.index) || 0;
              const existing = calls.get(index) ?? { id: '', name: '', args: '' };
              if (typeof part?.id === 'string' && part.id) existing.id = part.id;
              if (typeof part?.function?.name === 'string' && part.function.name) {
                if (!existing.name) onPhase?.('tooling');
                existing.name = part.function.name;
              }
              if (typeof part?.function?.arguments === 'string') existing.args += part.function.arguments;
              calls.set(index, existing);
            }
          }

          const content = delta.content || "";
          if (content) {
            /* A round that speaks after an earlier round already spoke starts a new
               paragraph. Models that narrate before calling a tool ("I'll look that
               up.") answer in the NEXT round, and the two arrive as one unbroken
               string — `…look that up.Here is what I found` — because each round
               streams straight through `onToken`. Same rule the thought summaries
               above already use. Counted into `openaiAnswerText` as well, since the
               annotation offsets index the answer the user actually reads. */
            const separator = !hasEmittedText && hasEmittedAnyAnswerText ? '\n\n' : '';
            if (!hasEmittedText) {
              hasEmittedText = true;
              onPhase?.('responding');
            }
            hasEmittedAnyAnswerText = true;
            const emitted = separator ? separator + stripLeadingSpace(content) : content;
            onToken(emitted);
            /* `roundText` is the assistant message echoed back to the endpoint for
               this round, so it holds the model's own text without the break. */
            roundText += content;
            // Accumulated because the annotation offsets index into the answer,
            // and they arrive at the end of the stream when the text is complete.
            openaiAnswerText += emitted;
          }
        }

        const pendingCalls = [...calls.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, call]) => call)
          .filter((call) => call.name);

        if (!pendingCalls.length || !onToolCall || round >= maxToolIterations - 1) {
          if (pendingCalls.length && onToolCall) {
            for (const call of pendingCalls) {
              const args = safeParseToolInput(call.args);
              options.onToolCallStart?.(call.name, args);
              await onToolCall(call.name, args);
            }
          }
          break;
        }

        /* `content: null`, not `''`: an empty string is a message the model did not
           send, and some endpoints reject one alongside `tool_calls`. */
        chatMessages.push({
          role: 'assistant',
          content: roundText || null,
          tool_calls: pendingCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(safeParseToolInput(call.args)) },
          })),
        });
        for (const call of pendingCalls) {
          const args = safeParseToolInput(call.args);
          options.onToolCallStart?.(call.name, args);
          const result = await onToolCall(call.name, args);
          chatMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: toolResultText(result),
          });
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
    const anthropic = getAnthropicClient(apiKey, options.baseUrl, provider as ProviderId);

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
    const anthropicSearchEnabled = nativeToolsAllowed && options.enableSearch !== false;
    /* Set by the degrade ladder below when the endpoint rejects the search tool, so
       the retry rebuilds `tools` without it. Rebuilt per attempt rather than
       computed once for exactly that reason. */
    let anthropicSearchDropped = false;
    const buildAnthropicTools = () => [
      ...(anthropicSearchEnabled && !anthropicSearchDropped
        ? [{ type: 'web_search_20250305', name: 'web_search' }]
        : []),
      /* Personal tools AND the canvas tools: both arrive as Gemini-shaped
         declarations and both are executed by the same provider-agnostic
         `onFunctionCall`, so there is nothing provider-specific left to gate on. */
      ...(toolsAllowed ? anthropicFunctionTools([
        ...(options.personalTools ?? []),
        ...(options.toolDeclarations ?? []),
      ]) : []),
    ];

    /* Citations accumulate across every round of the tool loop below, because the
       offsets they carry index the answer the user ends up reading — which is the
       concatenation of the text from all of them. */
    const anthropicSearchResults: any[] = [];
    const anthropicBlocks: AnthropicCitedBlock[] = [];
    let anthropicTextLength = 0;
    let currentBlock: AnthropicCitedBlock | null = null;
    let hasEmittedAnthropicText = false;

    /*
     * The tool loop.
     *
     * Anthropic's protocol is: the model stops with `stop_reason: 'tool_use'`, the
     * caller runs the tools, and the conversation continues with the assistant's own
     * content blocks followed by a user turn of `tool_result`s. The assistant turn
     * has to be echoed back VERBATIM — the `tool_use` blocks in it are what the
     * results are matched against by id — so the blocks are rebuilt as they stream.
     */
    const conversation: any[] = [...formattedMessages];
    /*
     * ## The request, and the three things it degrades
     *
     * `max_tokens` is REQUIRED by the Messages API and is a hard ceiling on the whole
     * turn, tool arguments included. 4096 was the old value and it is a canvas-sized
     * problem: `update_canvas` sends the WHOLE document as its input, so a 20KB app
     * cannot fit — the stream is cut mid-argument, the JSON never closes, and the
     * executor is handed nothing, which is indistinguishable from the model refusing
     * to work.
     *
     * `thinking` is how the UI's thinking slider reaches Claude at all. Without it
     * `thinkingLevel` was simply dropped on this provider: the app offered a control
     * that did nothing, and the thoughts panel stayed empty on every Claude turn
     * while Gemini filled it. Budget is a floor-and-ceiling calculation rather than a
     * table lookup because the API requires `budget_tokens < max_tokens`, and
     * `max_tokens` is itself degradable.
     *
     * `cache_control` on the system prompt is the cheap professional win. Willow's
     * system prompt is long — the Canvas instructions alone run to thousands of
     * tokens — and it is byte-identical on every turn of a chat, so marking it
     * ephemeral turns those input tokens into a cache read for five minutes.
     *
     * All three are DEGRADED RATHER THAN ASSUMED, because this provider is commonly
     * pointed at a gateway and an older model can be typed into the Models tab by
     * hand. Each retry drops exactly the feature the error names, keeping everything
     * else, and a 400 nobody recognises is re-thrown untouched.
     */
    let anthropicMaxTokens = 32000;
    let anthropicThinking = (options.thinkingLevel ?? 0) > 0 && options.includeThoughts !== false;
    let anthropicCacheSystem = !!systemPrompt;
    const anthropicThinkingBudget = () => {
      const wanted = { 1: 4000, 2: 10000, 3: 16000, 4: 24000, 5: 32000, 6: 32000 }[
        Math.min(6, Math.max(1, options.thinkingLevel ?? 1))
      ] ?? 10000;
      /* The API requires room for an answer after the thinking budget, so this is a
         share of `max_tokens` rather than an absolute — and at the 4096 fallback
         there is no room worth having, which `openAnthropicStream` reads as off. */
      return Math.min(wanted, anthropicMaxTokens - 8000);
    };
    const openAnthropicStream = async (): Promise<any> => {
      for (let attempt = 0; ; attempt += 1) {
        const budget = anthropicThinkingBudget();
        const thinking = anthropicThinking && budget >= 1024;
        const body = {
          model,
          max_tokens: anthropicMaxTokens,
          ...(systemPrompt
            ? {
              system: anthropicCacheSystem
                ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
                : systemPrompt,
            }
            : {}),
          // @ts-ignore
          messages: conversation,
          ...((() => {
            const tools = buildAnthropicTools();
            return tools.length ? { tools: tools as any } : {};
          })()),
          ...(thinking ? { thinking: { type: 'enabled', budget_tokens: budget } } : {}),
          stream: true as const,
        };
        try {
          return await anthropic.messages.create(body as any, signal ? { signal } : undefined);
        } catch (error: any) {
          const message = String(error?.message ?? '');
          /* Only a request the endpoint rejected as malformed is worth degrading; a
             401, a 429 or a network failure means try nothing different. */
          const status = Number(error?.status ?? 0);
          const malformed = status === 400 || status === 422;
          let dropped = '';
          if (malformed && attempt < 4) {
            /* The search tool comes off FIRST, because it is the one thing here a
               relay is most likely not to implement: `web_search_20250305` is a
               server-side tool, not a request field, and an endpoint that merely
               proxies the Messages shape has nothing behind it. Without this step a
               relay that 400s on the tool type failed the whole turn, where every
               other unsupported feature degraded — so Claude on a custom base URL
               was the one configuration that could not answer at all. */
            if (anthropicSearchEnabled && !anthropicSearchDropped && /web_search|server_tool|tool.{0,20}type|tools\[/i.test(message)) {
              anthropicSearchDropped = true;
              dropped = 'server-side web search';
            } else if (anthropicCacheSystem && /cache|ephemeral|system/i.test(message)) {
              anthropicCacheSystem = false;
              dropped = 'prompt caching';
            } else if (thinking && /thinking|budget|reasoning/i.test(message)) {
              anthropicThinking = false;
              dropped = 'extended thinking';
            } else if (anthropicMaxTokens > 4096 && /max_tokens|token/i.test(message)) {
              anthropicMaxTokens = 4096;
              dropped = 'the 32k output ceiling';
            }
          }
          if (!dropped) throw error;
          console.warn(`[AI] Anthropic endpoint rejected ${dropped}; retrying without it. ${message}`);
        }
      }
    };

    for (let round = 0; ; round += 1) {
      const stream = await openAnthropicStream();

      /*
       * This round's assistant turn, rebuilt block by block as it streams.
       *
       * VERBATIM matters: continuing a turn means posting the assistant's own
       * content back, and Anthropic matches tool results to the `tool_use` blocks
       * inside it by id. Server-side blocks (`server_tool_use`, the search results)
       * are kept too — a paused turn is resumed by echoing the whole thing, so
       * dropping them loses the search the model already ran.
       */
      const assistantBlocks: any[] = [];
      const blocksByIndex = new Map<number, any>();
      const argumentJson = new Map<number, string>();
      /* `hasEmittedAnthropicText` is turn-level, so this is the per-round half the
         paragraph rule needs — see the same rule on the other two adapters. */
      let hasEmittedTextThisRound = false;
      const toolUses: { index: number; id: string; name: string }[] = [];
      let stopReason: string | null = null;
      let textBlock: { type: 'text'; text: string } | null = null;

      for await (const messageStreamEvent of stream) {
        throwIfAborted(signal);
        const event = messageStreamEvent as any;
        reportUsage(event.usage ?? event.message?.usage ?? event.delta?.usage);

        if (event.type === 'content_block_start') {
          const block = event.content_block;
          const index = Number(event.index) || 0;
          if (block && typeof block === 'object') {
            const copy = { ...block };
            assistantBlocks.push(copy);
            blocksByIndex.set(index, copy);
          }
          if (block?.type === 'text') {
            textBlock = blocksByIndex.get(index);
            if (textBlock) textBlock.text = '';
            currentBlock = { start: anthropicTextLength, end: anthropicTextLength, citations: [] };
            // A non-streaming path can deliver a whole block's citations here
            // rather than as deltas.
            if (Array.isArray(block.citations)) currentBlock.citations.push(...block.citations);
          } else if (block?.type === 'tool_use') {
            /* A DECLARED tool, not the server-side search: `server_tool_use` is
               Anthropic's own and is answered by Anthropic. This one is ours to run.
               `input` arrives as `input_json_delta` fragments, so the block is held
               open and parsed at `content_block_stop`. */
            toolUses.push({ index, id: String(block.id ?? ''), name: String(block.name ?? '') });
            argumentJson.set(index, '');
            onPhase?.('tooling');
          } else if (block?.type === 'server_tool_use') {
            /* Anthropic runs this one. The fragments are still collected, because a
               paused turn is resumed by posting the block back with its input. */
            argumentJson.set(index, '');
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
            /* New paragraph when a later round speaks after an earlier one did.
               Counted into `anthropicTextLength` too, because the citation spans
               index the answer the user reads and would otherwise sit two
               characters upstream of the text they underline. */
            const separator = hasEmittedAnthropicText && !hasEmittedTextThisRound && delta.text ? '\n\n' : '';
            if (!hasEmittedAnthropicText && delta.text) {
              hasEmittedAnthropicText = true;
              onPhase?.('responding');
            }
            if (delta.text) hasEmittedTextThisRound = true;
            const emitted = separator ? separator + stripLeadingSpace(delta.text) : delta.text;
            onToken(emitted);
            /* The block is echoed back to Anthropic verbatim, so it keeps the
               model's own text; only what the reader sees carries the break. */
            if (textBlock) textBlock.text += delta.text;
            anthropicTextLength += emitted.length;
            if (currentBlock) currentBlock.end = anthropicTextLength;
          } else if (delta?.type === 'thinking_delta') {
            if (!hasEmittedAnthropicText) onPhase?.('thinking');
            onThought?.(delta.thinking);
            const block = blocksByIndex.get(Number(event.index) || 0);
            if (block && typeof delta.thinking === 'string') {
              block.thinking = `${block.thinking ?? ''}${delta.thinking}`;
            }
          } else if (delta?.type === 'signature_delta') {
            /* Extended thinking is not requested on this path, but a gateway can
               send one anyway — and a thinking block echoed back without its
               signature is rejected, so it rides along if it arrives. */
            const block = blocksByIndex.get(Number(event.index) || 0);
            if (block && typeof delta.signature === 'string') block.signature = delta.signature;
          } else if (delta?.type === 'input_json_delta') {
            const index = Number(event.index) || 0;
            if (argumentJson.has(index) && typeof delta.partial_json === 'string') {
              argumentJson.set(index, `${argumentJson.get(index)}${delta.partial_json}`);
            }
          } else if (delta?.type === 'citations_delta' && delta.citation) {
            if (currentBlock) currentBlock.citations.push(delta.citation);
          }
        } else if (event.type === 'content_block_stop') {
          /* The fragments are the input now: parsing here rather than at use means a
             block echoed back to the API always carries valid JSON. */
          const index = Number(event.index) || 0;
          const block = blocksByIndex.get(index);
          if (block && argumentJson.has(index)) block.input = safeParseToolInput(argumentJson.get(index) as string);
          if (currentBlock && currentBlock.citations.length) anthropicBlocks.push(currentBlock);
          currentBlock = null;
          textBlock = null;
        } else if (event.type === 'message_delta') {
          if (typeof event.delta?.stop_reason === 'string') stopReason = event.delta.stop_reason;
        }
      }
      if (currentBlock && currentBlock.citations.length) anthropicBlocks.push(currentBlock);
      currentBlock = null;

      const toolInput = (call: { index: number }) => {
        const block = blocksByIndex.get(call.index);
        return block && block.input && typeof block.input === 'object' ? block.input : {};
      };

      /*
       * A PAUSED turn is resumed, not ended.
       *
       * Anthropic pauses a long server-tool sequence with `stop_reason: 'pause_turn'`
       * and expects the conversation to continue with the partial assistant turn
       * posted back — no results to add, because the tool it is running is its own.
       * Without this, a search-heavy question ends wherever the pause landed, which
       * reads as the model stopping mid-sentence. Bounded by the same iteration
       * limit as the tool loop, so a pause that never resolves cannot spin.
       */
      if (stopReason === 'pause_turn' && !toolUses.length && assistantBlocks.length && round < maxToolIterations - 1) {
        conversation.push({ role: 'assistant', content: assistantBlocks });
        continue;
      }

      /*
       * Run them whatever the stop reason says.
       *
       * `tool_use` is the documented one, and a gateway that reports something else
       * — or nothing — while still emitting the blocks is the case that used to lose
       * the call silently. The Gemini adapter learned the same lesson the same way
       * (see the note at `canFeedResultsBack`): the blocks arriving is the fact, the
       * stop reason is a claim about it.
       */
      if (!toolUses.length || !onToolCall || round >= maxToolIterations - 1) {
        if (toolUses.length && onToolCall) {
          for (const call of toolUses) {
            const args = toolInput(call);
            options.onToolCallStart?.(call.name, args);
            await onToolCall(call.name, args);
          }
        }
        break;
      }

      const results = await Promise.all(toolUses.map(async (call) => {
        const args = toolInput(call);
        options.onToolCallStart?.(call.name, args);
        const result = await onToolCall(call.name, args);
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          content: [{
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result),
          }],
        };
      }));

      /* `assistantBlocks` already holds every block in arrival order, each with its
         parsed `input` — including the `tool_use` blocks these results answer. */
      conversation.push({ role: 'assistant', content: assistantBlocks });
      conversation.push({ role: 'user', content: results });
    }

    if (anthropicBlocks.length || anthropicSearchResults.length) {
      const resolved = resolveAnthropicCitations(anthropicSearchResults, anthropicBlocks);
      // Fired on sources, not citations. An endpoint that returns real
      // `web_search_tool_result` blocks and no `citations_delta` -- measured on a
      // relay -- still has sources worth showing; it gets the sources panel and
      // no inline chips instead of losing the search entirely.
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
  const options = args[1] ?? {};
  const signal: AbortSignal | undefined = options.signal;

  /*
   * Keys are tried left to right when one is rejected — the behaviour the Settings
   * field has always described and never had.
   *
   * Safe only while nothing has been emitted. An auth rejection arrives with the
   * response head, before the first token, so a second attempt cannot duplicate
   * output; `emitted` enforces that rather than assuming it, so a 401 that somehow
   * arrives mid-stream is rethrown instead of replayed. An abort is never a
   * rejected credential and is rethrown untouched.
   *
   * `onStart` is fired at most once across the whole rotation: it raises the
   * caller's thinking state, and a retry is not a second turn.
   */
  const rotation = [options.apiKey, ...(options.apiKeyFallbacks ?? [])]
    .map((key: unknown) => (typeof key === 'string' ? key.trim() : ''))
    .filter(Boolean);
  const attempts: string[] = rotation.length ? rotation : [options.apiKey];

  let started = false;
  for (let index = 0; index < attempts.length; index += 1) {
    let emitted = false;
    const forwarded = [...args];
    forwarded[1] = { ...options, apiKey: attempts[index] };
    forwarded[2] = (token: string) => { emitted = true; args[2]?.(token); };
    forwarded[3] = () => { if (!started) { started = true; args[3]?.(); } };

    try {
      return await streamChatImpl(...forwarded);
    } catch (error) {
      if (signal?.aborted && !isAbortError(error)) {
        throw Object.assign(
          new DOMException('The AI request was cancelled.', 'AbortError'),
          { cause: error },
        );
      }
      const isLastKey = index === attempts.length - 1;
      if (emitted || isLastKey || isAbortError(error) || !namesAuthRejection(error)) throw error;
      console.warn(`[AI] API key ${index + 1} of ${attempts.length} was rejected; trying the next one.`);
    }
  }

  // Unreachable: the loop either returns or throws on its last attempt.
  throw new Error(`API Key for ${options.provider} is missing.`);
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
