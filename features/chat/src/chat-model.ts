// ──────────────────────────────────────────────────────────────────────────────
// Which model a chat turn runs on, and the prompt it runs with.
// ──────────────────────────────────────────────────────────────────────────────

import { getThinkingEffortLabel, isNonThinkingEffort } from '@willow/ai/models/efforts';

/** Pure conversational system prompt (no code-gen artifacts). */
export const CHAT_SYSTEM_PROMPT =
  'You are Willow, a friendly and highly capable AI assistant. ' +
  'Respond conversationally and helpfully. Use markdown for formatting ' +
  '(bold, bullet lists, fenced code blocks, tables) when it improves clarity. ' +
  'For simple math or chemistry, prefer plain Unicode (e.g. CO₂, x², →, π) over LaTeX. ' +
  'Only use $$...$$ for genuinely complex equations. ' +
  'Do not wrap responses in boltArtifact or any XML tags.';

export type ChatProvider =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'moonshot'
  | 'spacexai'
  | 'zhipuai';

export interface ResolvedChatModel {
  provider: ChatProvider;
  model: string;
  thinkingLevel: number;
  apiKey: string | undefined;
  /** Short display name plus effort suffix, e.g. `3.6 Flash Thinking`. */
  modelLabel: string;
}

export interface ResolveChatModelInput {
  modelConfig: any;
  selectedModelId: string;
  apiKeys?: Partial<Record<ChatProvider, string[]>>;
}

const getShortModelName = (name: string) => {
  if (!name) return 'Model';
  if (name.includes('2.5 Flash Lite')) return '2.5 Lite';
  return name.replace(/Gemini\s+/gi, '').replace(/\s+Extended$/gi, '').trim();
};

/**
 * Pick the saved model the id points at and flatten it into everything a turn
 * needs to start. `selectedModelId` may carry an `::effort-N` suffix, which
 * overrides the saved thinking level for that one turn.
 */
export const resolveChatModel = ({
  modelConfig,
  selectedModelId,
  apiKeys,
}: ResolveChatModelInput): ResolvedChatModel => {
  const all = [
    ...(modelConfig?.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' as const })),
    ...(modelConfig?.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' as const })),
    ...(modelConfig?.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' as const })),
    ...(modelConfig?.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'moonshot' as const })),
    ...(modelConfig?.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'spacexai' as const })),
    ...(modelConfig?.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'zhipuai' as const })),
  ];
  let sel = all.find((m) => m.id === selectedModelId);
  let explicitThinkingLevel: number | undefined;

  if (!sel && selectedModelId?.includes('::effort-')) {
    const parts = selectedModelId.split('::effort-');
    const baseId = parts[0];
    explicitThinkingLevel = Number(parts[1]);
    sel = all.find((m) => m.id === baseId || m.modelId === baseId);
  }

  const provider = (sel?.provider ?? 'gemini') as ChatProvider;
  const rawModel = sel?.modelId ?? modelConfig?.gemini?.model ?? 'gemini-3.6-flash';
  const thinkingLevel: number = explicitThinkingLevel ?? sel?.thinkingLevel ?? modelConfig?.[provider]?.thinkingLevel ?? 0;

  let model = rawModel;
  if (provider === 'openai' && (thinkingLevel === 6 || rawModel.endsWith('-pro'))) {
    if (!rawModel.endsWith('-pro')) {
      model = `${rawModel}-pro`;
    }
  }

  const apiKey: string | undefined = apiKeys?.[provider]?.[0];
  const dummyObj = { ...sel, thinkingLevel, provider };
  // No-thinking selections add nothing to the label — see use-composer-models.
  const effortLabel = sel && !isNonThinkingEffort(dummyObj) ? getThinkingEffortLabel(dummyObj) : '';
  const baseLabel = getShortModelName(sel?.name || model);
  const modelLabel = `${baseLabel}${effortLabel ? ` ${effortLabel}` : ''}`;
  return { provider, model, thinkingLevel, apiKey, modelLabel };
};
