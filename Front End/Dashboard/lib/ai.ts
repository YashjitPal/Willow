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
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
}

/**
 * Coarse-grained lifecycle phases surfaced to the UI so the "Thinking" shimmer
 * can change label ("Searching", "Running code") instead of prematurely
 * flipping to "Thought for Ns" the moment a non-text (tool) chunk arrives.
 *
 *   thinking   – waiting on the model (default / between tool calls)
 *   searching  – Gemini invoked the native Google Search grounding tool
 *   executing  – Gemini invoked the native Code Execution tool
 *   responding – first real text token is about to stream
 */
export type StreamPhase = 'thinking' | 'searching' | 'executing' | 'responding';

export interface AiOptions {
  provider: 'gemini' | 'openai' | 'anthropic';
  model: string;
  apiKey: string;
  thinkingLevel?: number;
  /**
   * Enable Gemini's native Google Search grounding tool. Defaults to `true`.
   * Only applies when `provider === 'gemini'`; ignored for other providers.
   */
  enableSearch?: boolean;
  /**
   * Enable Gemini's native Code Execution tool (server-side Python sandbox).
   * Defaults to `false`. Only applies when `provider === 'gemini'`.
   */
  enableCodeExecution?: boolean;
}

// ============ CLIENT CACHING FOR FASTER COLD STARTS ============
// Cache SDK clients to avoid re-initialization overhead
const clientCache: {
  gemini: { key: string; client: GoogleGenerativeAI } | null;
  openai: { key: string; client: OpenAI } | null;
  anthropic: { key: string; client: Anthropic } | null;
} = {
  gemini: null,
  openai: null,
  anthropic: null,
};

const getGeminiClient = (apiKey: string): GoogleGenerativeAI => {
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
export const streamChat = async (
  messages: ChatMessage[],
  options: AiOptions,
  onToken: (token: string) => void,
  onStart: () => void,
  systemPrompt?: string,
  onPhase?: (phase: StreamPhase) => void
) => {
  const { provider, model, apiKey } = options;

  if (!apiKey) {
    throw new Error(`API Key for ${provider} is missing.`);
  }

  onStart();

  if (provider === 'gemini') {
    const genAI = getGeminiClient(apiKey);
    
    // Map numeric UI levels to Gemini string labels
    // Pro: 1=low, 2=high
    // Flash: 0=minimal (none), 1=low, 2=medium, 3=high
    // Default to 'high' for Flash, 'low' for Pro
    let geminiThinkingLevel: string = model.includes('flash') ? 'high' : 'low';
    if (options.thinkingLevel !== undefined) {
      if (model.includes('flash')) {
        const flashMap: Record<number, string> = { 0: 'minimal', 1: 'low', 2: 'medium', 3: 'high' };
        geminiThinkingLevel = flashMap[options.thinkingLevel] ?? 'high';
      } else if (model.includes('3.1-pro')) {
        // Gemini 3.1 Pro supports 3 thinking levels: low, medium, high
        const pro31Map: Record<number, string> = { 1: 'low', 2: 'medium', 3: 'high' };
        geminiThinkingLevel = pro31Map[options.thinkingLevel] || 'high';
      } else {
        const proMap: Record<number, string> = { 1: 'low', 2: 'high' };
        geminiThinkingLevel = proMap[options.thinkingLevel] || 'low';
      }
    }
    console.log(`[AI] Gemini model: ${model}, thinkingLevel: ${options.thinkingLevel} -> "${geminiThinkingLevel}"`);

    // Native tools. Gemini 2.0+/3.x use `googleSearch`; legacy 1.5 models used
    // `googleSearchRetrieval`. Code execution is the server-side Python sandbox.
    // Both are *offered* to the model — it decides per-prompt whether to call them.
    const searchEnabled = options.enableSearch !== false;
    const codeExecEnabled = options.enableCodeExecution === true;
    const tools: any[] = [];
    if (searchEnabled) {
      tools.push(model.includes('1.5') ? { googleSearchRetrieval: {} } : { googleSearch: {} });
    }
    if (codeExecEnabled) {
      tools.push({ codeExecution: {} });
    }

    const geminiModel = genAI.getGenerativeModel({
      model,
      ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      // Strictly matching Gemini 3 Developer Guide
      generationConfig: {
        // @ts-ignore
        thinkingConfig: {
          thinkingLevel: geminiThinkingLevel
        }
      }
    } as any);

    const chat = geminiModel.startChat({
      history: await Promise.all(messages.slice(0, -1).map(async m => {
        const parts: any[] = [{ text: m.content }];
        if (m.attachments) {
          for (const att of m.attachments) {
            if (att.type === 'image') {
              parts.push(await resolveGeminiImagePart(apiKey, att));
            } else {
               const label = att.name || att.mimeType;
               parts[0].text += `\n\n[Attachment: ${label}]\n${att.data}`;
            }
          }
        }
        return {
          role: m.role === 'user' ? 'user' : 'model',
          parts,
        };
      })),
    });

    const lastMessage = messages[messages.length - 1];
    const parts: any[] = [{ text: lastMessage.content }];

    if (lastMessage.attachments) {
      for (const att of lastMessage.attachments) {
        if (att.type === 'image') {
          parts.push(await resolveGeminiImagePart(apiKey, att));
        } else {
           const label = att.name || att.mimeType;
           parts[0].text += `\n\n[Attachment: ${label}]\n${att.data}`;
        }
      }
    }

    const result = await chat.sendMessageStream(parts);

    // Track phase transitions so we only emit each signal once per contiguous
    // run and never flip to "Thought for Ns" on an empty/tool-only chunk.
    let currentPhase: StreamPhase = 'thinking';
    let hasEmittedText = false;
    const setPhase = (p: StreamPhase) => {
      if (p !== currentPhase) {
        currentPhase = p;
        onPhase?.(p);
      }
    };

    for await (const chunk of result.stream) {
      const cand: any = (chunk as any).candidates?.[0];

      // Grounding metadata (Google Search). The SDK surfaces the queries it
      // ran here; when present before any text, the model is/was searching.
      if (!hasEmittedText && cand?.groundingMetadata?.webSearchQueries?.length) {
        setPhase('searching');
      }

      const chunkParts: any[] = cand?.content?.parts ?? [];
      for (const part of chunkParts) {
        // --- Code execution tool ---------------------------------------------
        if (part?.executableCode) {
          setPhase('executing');
          const lang = (part.executableCode.language || 'python').toLowerCase();
          const code = part.executableCode.code ?? '';
          // Surface the executed code inline so the user sees what ran.
          if (code) {
            if (!hasEmittedText) { hasEmittedText = true; onPhase?.('responding'); }
            onToken(`\n\`\`\`${lang}\n${code}\n\`\`\`\n`);
          }
          continue;
        }
        if (part?.codeExecutionResult) {
          const out = part.codeExecutionResult.output ?? '';
          if (out) {
            if (!hasEmittedText) { hasEmittedText = true; onPhase?.('responding'); }
            onToken(`\n\`\`\`text\n${out}\n\`\`\`\n`);
          }
          // After a tool result the model typically resumes reasoning before
          // the final answer — show the shimmer again until real text arrives.
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

      // Some chunks carry *only* groundingMetadata / finishReason with no parts.
      // We intentionally do NOT call onToken('') for those — that was the bug
      // that made the UI drop the "Thinking" shimmer the instant search fired.
    }
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
        if (!m.attachments || m.attachments.length === 0) {
            return { role: m.role, content: m.content };
        }

        const contentParts: any[] = [{ type: "text", text: m.content }];
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
        let text = m.content;
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

      for await (const chunk of stream) {
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
