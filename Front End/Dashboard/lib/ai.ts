import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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

// ============ MAIN STREAM CHAT FUNCTION ============
export const streamChat = async (
  messages: ChatMessage[],
  options: AiOptions,
  onToken: (token: string) => void,
  onStart: () => void
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
      // Strictly matching Gemini 3 Developer Guide
      generationConfig: {
        // @ts-ignore
        thinkingConfig: {
          thinkingLevel: geminiThinkingLevel
        }
      }
    });

    const chat = geminiModel.startChat({
      history: messages.slice(0, -1).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      })),
    });

    const result = await chat.sendMessageStream(messages[messages.length - 1].content);

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

    const stream = await openai.chat.completions.create({
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
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

    const stream = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    });

    for await (const messageStreamEvent of stream) {
      if (messageStreamEvent.type === 'content_block_delta' && messageStreamEvent.delta.type === 'text_delta') {
        onToken(messageStreamEvent.delta.text);
      }
    }
  }
};
