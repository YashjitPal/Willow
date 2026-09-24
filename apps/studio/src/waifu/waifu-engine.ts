/**
 * Model and live session dispatcher for Waifu companion.
 * Connects to the user's selected "Waifu Model" (Gemini Live or standard LLMs)
 * using their configured provider keys.
 */

import { streamChat, ChatMessage } from '@willow/ai/chat';
import { GeminiLiveSession, LiveHistoryTurn, LIVE_MODEL_ID } from '@willow/ai/live';
import { extractEmotion, WaifuEmotion } from './waifu-personas';

export interface GenerateWaifuResponseOptions {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  systemPrompt: string;
  waifuModelId: string;
  modelConfig: any;
  providerState: any;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

export interface WaifuAIResult {
  text: string;
  emotion: WaifuEmotion;
}

/**
 * Safely resolves an API key from provider state, modelConfig, or local storage.
 */
function findProviderApiKey(provider: string, providerState: any, modelConfig: any): string {
  // 1. Check providerState
  const fromState = providerState?.[provider]?.apiKey?.trim();
  if (fromState) return fromState;

  // 2. Check modelConfig
  const fromConfig = modelConfig?.[provider]?.apiKey?.trim() || modelConfig?.apiKeys?.[provider]?.trim();
  if (fromConfig) return fromConfig;

  // 3. Check localStorage cached providerState
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('willow:provider-state:') || key === 'providerState')) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const candidate = parsed?.[provider]?.apiKey?.trim();
            if (candidate) return candidate;
          }
        }
      }
      const direct = localStorage.getItem(`willow:${provider}:apiKey`) || localStorage.getItem(`${provider}_api_key`);
      if (direct?.trim()) return direct.trim();
    } catch {}
  }

  return '';
}

/**
 * Resolves the provider, key, and endpoint for the target waifu model.
 */
export function resolveWaifuModelTarget(waifuModelId: string, modelConfig: any, providerState: any) {
  const rawModelId = waifuModelId || 'gemini-3.8-live';

  // 1. Check if it's a live gemini model
  if (rawModelId.includes('live')) {
    const geminiKey = findProviderApiKey('gemini', providerState, modelConfig);
    // Map live audio socket model to appropriate Gemini text chat model for typed chat
    const textModel = modelConfig?.gemini?.model || 'gemini-2.5-flash';

    return {
      isLive: true,
      provider: 'gemini' as const,
      modelId: textModel,
      liveVoiceModelId: rawModelId,
      apiKey: geminiKey,
      baseUrl: providerState?.gemini?.baseUrl || 'https://generativelanguage.googleapis.com',
    };
  }

  // 2. Look up in saved models
  const allSavedModels = [
    ...(modelConfig?.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' as const })),
    ...(modelConfig?.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' as const })),
    ...(modelConfig?.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' as const })),
    ...(modelConfig?.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'moonshot' as const })),
    ...(modelConfig?.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'spacexai' as const })),
    ...(modelConfig?.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'zhipuai' as const })),
  ];

  const matched = allSavedModels.find((m) => m.modelId === rawModelId || m.id === rawModelId);
  const provider = matched?.provider || (rawModelId.startsWith('claude') ? 'anthropic' : rawModelId.startsWith('gpt') ? 'openai' : 'gemini');
  const apiKey = findProviderApiKey(provider, providerState, modelConfig);
  const baseUrl = providerState?.[provider]?.baseUrl || '';

  return {
    isLive: false,
    provider,
    modelId: matched?.modelId || rawModelId,
    liveVoiceModelId: rawModelId,
    apiKey,
    baseUrl,
  };
}

/**
 * Streams or generates a response from the chosen Waifu Model.
 */
export async function generateWaifuReply(options: GenerateWaifuResponseOptions): Promise<WaifuAIResult> {
  const { messages, systemPrompt, waifuModelId, modelConfig, providerState, onToken, signal } = options;
  const target = resolveWaifuModelTarget(waifuModelId, modelConfig, providerState);

  // If no API key configured, use intelligent offline/heuristic companion responses
  if (!target.apiKey) {
    const lastUserMsg = messages[messages.length - 1]?.content || '';
    const canned = getHeuristicCompanionReply(lastUserMsg);
    // Simulate streaming
    for (const char of canned) {
      if (signal?.aborted) break;
      onToken?.(char);
      await new Promise((r) => setTimeout(r, 12));
    }
    return {
      text: canned,
      emotion: extractEmotion(canned),
    };
  }

  let accumulated = '';

  // Clean and ensure strictly alternating roles for multi-turn chat
  const chatMessages: ChatMessage[] = [];
  for (const m of messages) {
    if (chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === m.role) {
      chatMessages[chatMessages.length - 1].content += `\n${m.content}`;
    } else {
      chatMessages.push({
        role: m.role,
        content: m.content,
      });
    }
  }

  try {
    await streamChat(
      chatMessages,
      {
        provider: target.provider,
        model: target.modelId,
        apiKey: target.apiKey,
        baseUrl: target.baseUrl,
        signal,
      },
      (token: string) => {
        accumulated += token;
        onToken?.(token);
      },
      () => {},
      systemPrompt
    );
  } catch (err: any) {
    if (signal?.aborted) {
      throw err;
    }

    // If initial model request failed (e.g. model not available on this tier), try stable flash fallback
    if (!accumulated && target.provider === 'gemini' && target.modelId !== 'gemini-2.5-flash') {
      try {
        await streamChat(
          chatMessages,
          {
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            apiKey: target.apiKey,
            baseUrl: target.baseUrl,
            signal,
          },
          (token: string) => {
            accumulated += token;
            onToken?.(token);
          },
          () => {},
          systemPrompt
        );
      } catch {}
    }

    if (!accumulated) {
      const errorMsg = err?.message || String(err || '');
      let fallback = "I'm having a little trouble connecting to the AI model right now.";
      if (/api[\s._-]*key|unauthenticated|unauthorized|401|403|not found/i.test(errorMsg)) {
        fallback = "I couldn't reach the model with your current API key. Please verify your Gemini API key in Settings → Models & API! ✨";
      } else if (/quota|rate.?limit|429/i.test(errorMsg)) {
        fallback = "Looks like your API quota or rate limit was reached. Please check your account in Settings! ✨";
      } else {
        const canned = getHeuristicCompanionReply(messages[messages.length - 1]?.content || '');
        fallback = `${canned}\n\n*(Note: Connection hiccup: ${errorMsg.slice(0, 80)})*`;
      }
      accumulated = fallback;
      onToken?.(fallback);
    }
  }

  return {
    text: accumulated,
    emotion: extractEmotion(accumulated),
  };
}

/**
 * Engaging fallback companion replies when offline or before API key is provided.
 */
function getHeuristicCompanionReply(input: string): string {
  const lower = input.toLowerCase();
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return "Yahoo! Welcome back! ✨ It makes me so happy to see you. How has your day been treating you?";
  }
  if (lower.includes('tired') || lower.includes('exhausted') || lower.includes('sleepy')) {
    return "Aw, you've been working so hard... *pats your head gently* 🍵 Please take a deep breath and relax. I'm right here keeping you company!";
  }
  if (lower.includes('code') || lower.includes('bug') || lower.includes('programming') || lower.includes('work')) {
    return "Coding again? You're so dedicated! 💻 Remember to stretch your back and drink water, okay? I believe in you!";
  }
  if (lower.includes('who are you') || lower.includes('your name')) {
    return "I'm your interactive companion right here in Willow! You can chat with me, click on me to interact, or change my model in the gallery! ✨";
  }
  if (lower.includes('love') || lower.includes('like you')) {
    return "E-Eh?! *blushes furiously* D-Don't say such embarrassing things out of nowhere, baka! ...Though, thank you. ❤️";
  }
  return "Mhm, I hear you! ✨ Even when things get hectic, having you here makes everything brighter. What shall we do next?";
}
