import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export interface Attachment {
  type: 'image' | 'text' | 'file';
  mimeType: string;
  data: string; // base64 for image, text content for text
  name?: string;
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

export interface AiOptions {
  provider: 'gemini' | 'openai' | 'anthropic';
  model: string;
  apiKey: string;
  thinkingLevel?: number;
  enableSearch?: boolean;
  enableCodeExecution?: boolean;
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

const getGeminiClient = (apiKey: string): any => {
  if (clientCache.gemini?.key === apiKey) {
    return clientCache.gemini.client;
  }
  const client = new GoogleGenerativeAI(apiKey);
  clientCache.gemini = { key: apiKey, client };
  return client;
};

const getOpenAIClient = (apiKey: string): OpenAI => {
  if (clientCache.openai?.key === apiKey) {
    return clientCache.openai.client;
  }
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  clientCache.openai = { key: apiKey, client };
  return client;
};

const getAnthropicClient = (apiKey: string): Anthropic => {
  if (clientCache.anthropic?.key === apiKey) {
    return clientCache.anthropic.client;
  }
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  clientCache.anthropic = { key: apiKey, client };
  return client;
};

// ============ PRE-WARM FUNCTION ============
// Call this on app load to warm up the SDK (optional)
export const prewarmClient = (provider: 'gemini' | 'openai' | 'anthropic', apiKey: string) => {
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
  displayName: string
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
      body: JSON.stringify({ file: { displayName } })
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
    body: bytes
  });

  if (!uploadResponse.ok) {
    throw new Error(`Gemini Files API upload failed: ${uploadResponse.status}`);
  }

  const result = await uploadResponse.json();
  const fileUri = result.file?.uri;
  if (!fileUri) {
    throw new Error('No file URI in Gemini Files API response');
  }

  return fileUri;
}

async function resolveGeminiImagePart(apiKey: string, att: Attachment): Promise<any> {
  const fingerprint = getAttachmentFingerprint(att);
  const cachedUri = geminiFileCache.get(fingerprint);

  if (cachedUri) {
    return { fileData: { fileUri: cachedUri, mimeType: att.mimeType } };
  }

  try {
    const fileUri = await uploadToGeminiFiles(apiKey, att.data, att.mimeType, att.name || 'image');
    geminiFileCache.set(fingerprint, fileUri);
    console.log(`[AI] Uploaded to Gemini Files: ${att.name} -> ${fileUri}`);
    return { fileData: { fileUri, mimeType: att.mimeType } };
  } catch (err) {
    console.warn('[AI] Gemini Files upload failed, using inline:', err);
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
export const runStreamCall = async (modelInstance: any, history: any[]): Promise<any> => {
  return await modelInstance.generateContentStream({ contents: history });
};

// ============ MAIN STREAM CHAT FUNCTION ============
export const streamChat: any = async (
  messages: ChatMessage[],
  options: AiOptions,
  onToken: (token: string) => void,
  onStart: () => void,
  systemPrompt?: string,
  onPhase?: (phase: StreamPhase) => void,
  onToolCall?: (name: string, args: any) => Promise<any>
) => {
  const { provider, model, apiKey } = options;
  const messagesList: any = messages;

  if (!apiKey) {
    throw new Error(`API Key for ${provider} is missing.`);
  }

  onStart();

  if (provider === 'gemini') {
    const genAI = getGeminiClient(apiKey);
    
    // Map numeric UI levels to Gemini string labels
    let geminiThinkingLevel: string = model.includes('flash') ? 'high' : 'low';
    if (options.thinkingLevel !== undefined) {
      if (model.includes('flash')) {
        const flashMap: Record<number, string> = { 0: 'minimal', 1: 'low', 2: 'medium', 3: 'high' };
        geminiThinkingLevel = flashMap[options.thinkingLevel] ?? 'high';
      } else if (model.includes('3.1-pro')) {
        const pro31Map: Record<number, string> = { 1: 'low', 2: 'medium', 3: 'high' };
        geminiThinkingLevel = pro31Map[options.thinkingLevel] || 'high';
      } else {
        const proMap: Record<number, string> = { 1: 'low', 2: 'high' };
        geminiThinkingLevel = proMap[options.thinkingLevel] || 'low';
      }
    }
    console.log(`[AI] Gemini model: ${model}, thinkingLevel: ${options.thinkingLevel} -> "${geminiThinkingLevel}"`);

    const searchEnabled = options.enableSearch !== false;
    const codeExecEnabled = options.enableCodeExecution === true;
    const tools: any[] = [];
    if (searchEnabled) {
      tools.push(model.includes('1.5') ? { googleSearchRetrieval: {} } : { googleSearch: {} });
    }
    if (codeExecEnabled) {
      tools.push({ codeExecution: {} });
    }

    // Register our 18 premium Agent Harness custom tools
    tools.push({
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

    // Fully re-engineer the prompt hierarchy: override the verbose user guidelines with a strict concise decorator
    const combinedSystemPrompt = systemPrompt 
      ? `${harnessSystemInstruction}\n\n[USER SYSTEM PROMPT (Note: You MUST enforce our professional emoji-free, concise tonality and override any verbose style patterns defined below)]:\n${systemPrompt}`
      : harnessSystemInstruction;

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
          thinkingLevel: geminiThinkingLevel
        }
      }
    } as any);

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
              partsList.push(await resolveGeminiImagePart(apiKey, att as any));
            } else {
               const label = att.name || att.mimeType;
               partsList[0].text += `\n\n[Attachment: ${label}]\n${att.data}`;
            }
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
            initialParts.push(await resolveGeminiImagePart(apiKey, att));
          } else {
             const label = att.name || att.mimeType;
             initialParts[0].text += `\n\n[Attachment: ${label}]\n${att.data}`;
          }
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

    while (keepRunning) {
      // Direct streaming generation with manual history payload (guarantees cryptographic thought_signature retention)
      const result: any = await runStreamCall(geminiModel as any, historyContents as any);
      
      let currentPhase: StreamPhase = 'thinking';
      let hasEmittedText = false;
      const setPhase = (p: StreamPhase) => {
        if (p !== currentPhase) {
          currentPhase = p;
          onPhase?.(p);
        }
      };

      const pendingFunctionCalls: any[] = [];
      let lastThoughtSignature: string | undefined = undefined;

      for await (const chunk of result.stream) {
        const cand: any = (chunk as any).candidates?.[0];

        if (!hasEmittedText && cand?.groundingMetadata?.webSearchQueries?.length) {
          setPhase('searching');
        }

        const chunkParts: any[] = cand?.content?.parts ?? [];
        for (const part of chunkParts) {

          if (part?.thoughtSignature) {
            lastThoughtSignature = part.thoughtSignature;
          } else if (part?.thought_signature) {
            lastThoughtSignature = part.thought_signature;
          }

          // --- Custom Tool Invocations ---------------------------------------
          if (part?.functionCall) {
            pendingFunctionCalls.push(part.functionCall);
            if (!hasEmittedText) {
              hasEmittedText = true;
              onPhase?.('responding');
            }
            continue;
          }

          // --- Code execution tool ---------------------------------------------
          if (part?.executableCode) {
            setPhase('executing');
            continue;
          }
          if (part?.codeExecutionResult) {
            if (!hasEmittedText) setPhase('thinking');
            continue;
          }

          // --- Plain text ------------------------------------------------------
          if (typeof part?.text === 'string' && part.text.length > 0) {
            if (!hasEmittedText) {
              hasEmittedText = true;
              onPhase?.('responding');
            }
            onToken(part.text);
          }
        }
      }

      // Extract the canonical, correctly-merged parts from the SDK's full response object
      const fullResponse: any = await (result as any).response;
      const canonicalParts: any[] = fullResponse?.candidates?.[0]?.content?.parts ?? [];

      // Find the thoughtSignature inside the canonical parts to make absolutely sure we hold the correct verbatim token
      for (const part of canonicalParts) {
        if (part?.thoughtSignature) {
          lastThoughtSignature = part.thoughtSignature;
        } else if (part?.thought_signature) {
          lastThoughtSignature = part.thought_signature;
        }
      }

      // Manually attach/re-inject thought_signature to any functionCall parts to bypass SDK-stripping bugs
      for (const part of canonicalParts) {
        if (part && part.functionCall && lastThoughtSignature) {
          part.thoughtSignature = lastThoughtSignature;
          part.thought_signature = lastThoughtSignature;
        }
      }

      // Also append a separate thought_signature part for redundancy if not already present
      const hasSeparateSig = canonicalParts.some(p => p && (p.thoughtSignature || p.thought_signature) && !p.functionCall);
      if (lastThoughtSignature && !hasSeparateSig) {
        canonicalParts.push({
          thoughtSignature: lastThoughtSignature,
          thought_signature: lastThoughtSignature
        });
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
            let toolResult: any;
            if (onToolCall) {
              toolResult = await onToolCall(call.name, call.args);
            } else {
              toolResult = mockExecuteTool(call.name, call.args);
            }
            
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
                  onToken(`\n\n![Generated Media](media-id:${mediaId})\n\n`);
                }
              }
            } else if (toolResult?.media_id) {
              if (!emittedMedia.has(toolResult.media_id)) {
                emittedMedia.add(toolResult.media_id);
                onToken(`\n\n![Generated Media](media-id:${toolResult.media_id})\n\n`);
              }
            } else if (toolResult && typeof toolResult === 'object' && Array.isArray(toolResult.urls)) {
              for (const url of toolResult.urls) {
                if (url && !emittedMedia.has(url)) {
                  emittedMedia.add(url);
                  onToken(`\n\n![Generated Media](${url})\n\n`);
                }
              }
            } else if (toolResult?.url) {
              if (!emittedMedia.has(toolResult.url)) {
                emittedMedia.add(toolResult.url);
                onToken(`\n\n![Generated Media](${toolResult.url})\n\n`);
              }
            }
            
            const functionResponsePart: any = {
              functionResponse: {
                name: call.name,
                response: { result: sanitizedResult }
              }
            };

            // Attach required thought signature to the part to maintain reasoning flow & avoid 400 bad request errors
            if (lastThoughtSignature) {
              functionResponsePart.thoughtSignature = lastThoughtSignature;
              functionResponsePart.thought_signature = lastThoughtSignature;
            }
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
    return historyContents;
  } else if (provider === 'openai') {
    const openai = getOpenAIClient(apiKey);

    // Map UI thinking levels to OpenAI reasoning_effort values.
    const reasoningEffortMap: Record<number, "none" | "low" | "medium" | "high" | "xhigh"> = {
        0: "none",
        1: "low",
        2: "medium",
        3: "high",
        4: "xhigh"
    };
    const reasoningEffort = reasoningEffortMap[options.thinkingLevel ?? 1] ?? "medium";

    const formattedMessages = messages.map(m => {
        let cleanContent = m.content || '';
        if (m.role === 'assistant' || m.role === 'model') {
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
            } else {
                const label = att.name || att.mimeType;
                contentParts[0].text += `\n\n[Attachment: ${label}]\n${att.data}`;
            }
        });
        return { role: m.role, content: contentParts };
    });

    const responseInput = messages.map(m => {
        let text = m.content || '';
        if (m.role === 'assistant' || m.role === 'model') {
            text = text.replace(/!\[.*?\]\([^)]+\)/g, '').trim();
        }
        const imageParts: any[] = [];

        m.attachments?.forEach(att => {
            if (att.type === 'image') {
                imageParts.push({
                    type: "input_image",
                    image_url: `data:${att.mimeType};base64,${att.data}`,
                    detail: "auto",
                });
            } else {
                const label = att.name || att.mimeType;
                text += `\n\n[Attachment: ${label}]\n${att.data}`;
            }
        });

        if (imageParts.length === 0) {
            return { role: m.role, content: text };
        }

        return {
            role: m.role,
            content: [{ type: "input_text", text }, ...imageParts],
        };
    });

    const systemMessages = systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : [];

    const chatCompletionParams = {
      model,
      // @ts-ignore
      messages: [...systemMessages, ...formattedMessages],
      reasoning_effort: reasoningEffort,
    } as any;

    if (model === "gpt-5.5-pro") {
      let response = await openai.responses.create({
        model,
        input: responseInput,
        ...(systemPrompt ? { instructions: systemPrompt } : {}),
        reasoning: { effort: reasoningEffort },
        background: true,
      } as any);

      const startedAt = Date.now();
      const maxWaitMs = 10 * 60 * 1000;
      while (response.status === "queued" || response.status === "in_progress") {
        if (Date.now() - startedAt > maxWaitMs) {
          throw new Error("GPT 5.5 Pro background response timed out.");
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        response = await openai.responses.retrieve(response.id);
      }

      if (response.status !== "completed") {
        const message = response.error?.message || response.incomplete_details?.reason || response.status;
        throw new Error(`GPT 5.5 Pro response did not complete: ${message}`);
      }

      const content = response.output_text || "";
      if (content) onToken(content);
    } else {
      const stream = await openai.chat.completions.create({
        ...chatCompletionParams,
        stream: true,
      });

      for await (const chunk of stream as any) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) onToken(content);
      }
    }
  } else if (provider === 'anthropic') {
    const anthropic = getAnthropicClient(apiKey);

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
            } else {
                 contentParts[0].text += `\n\n[Attachment: ${att.mimeType}]\n${att.data}`;
            }
        });
        return { role: m.role, content: contentParts };
    });

    const stream = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      // @ts-ignore
      messages: formattedMessages,
      stream: true,
    });

    for await (const messageStreamEvent of stream) {
      if (messageStreamEvent.type === 'content_block_delta' && messageStreamEvent.delta.type === 'text_delta') {
        onToken(messageStreamEvent.delta.text);
      }
    }
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
