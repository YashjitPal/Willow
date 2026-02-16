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

export interface AiOptions {
  provider: 'gemini' | 'openai' | 'anthropic';
  model: string;
  apiKey: string;
  thinkingLevel?: number;
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
  systemPrompt?: string
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
      } else {
        const proMap: Record<number, string> = { 1: 'low', 2: 'high' };
        geminiThinkingLevel = proMap[options.thinkingLevel] || 'low';
      }
    }
    console.log(`[AI] Gemini model: ${model}, thinkingLevel: ${options.thinkingLevel} -> "${geminiThinkingLevel}"`);

    const geminiModel = genAI.getGenerativeModel({ 
      model,
      ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
      // Strictly matching Gemini 3 Developer Guide
      generationConfig: {
        // @ts-ignore
        thinkingConfig: {
          thinkingLevel: geminiThinkingLevel
        }
      }
    });

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

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      onToken(chunkText);
    }
  } else if (provider === 'openai') {
    const openai = getOpenAIClient(apiKey);

    // Map 1, 2, 3 to low, medium, high for o1/o3 models
    const reasoningEffortMap: Record<number, "low" | "medium" | "high"> = {
        1: "low",
        2: "medium",
        3: "high"
    };

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

    const systemMessages = systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : [];

    const stream = await openai.chat.completions.create({
      model,
      // @ts-ignore
      messages: [...systemMessages, ...formattedMessages],
      // @ts-ignore - reasoning_effort is used for o1 series
      reasoning_effort: options.thinkingLevel ? reasoningEffortMap[options.thinkingLevel] : "low",
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) onToken(content);
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
