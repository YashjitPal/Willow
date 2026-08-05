/**
 * Resolves which model the composer is currently using, and the labels its
 * pill shows.
 *
 * Moved out of Composer.tsx verbatim, indentation included — a hook body sits
 * at the same depth as a component body, so nothing had to be reflowed and the
 * one `useEffect` keeps its exact dependency array.
 *
 * Two behaviours here are deliberate and load-bearing:
 *
 *  - `ALL_MODELS` is rebuilt on every render, so the selection-sync effect
 *    listing it as a dependency runs on every render too. It is idempotent
 *    (it only calls `setSelectedModelId` when the current id is absent from
 *    the list), which is what stops that from looping. Memoising the array
 *    would change when the fallback selection is applied.
 *  - An id of the form `<modelId>::effort-<n>` encodes a thinking-effort
 *    choice made in ModelsMenu. The base id before the separator is what
 *    matches a saved model; the suffix supplies `currentThinkingLevel`. Both
 *    lookups have to stay, or picking an effort level deselects the model.
 *
 * Image, video and audio models are filtered out: this list feeds the text
 * composer only.
 */

import { useEffect } from 'react';
import { getThinkingEffortLabel, isNonThinkingEffort } from '@willow/ai/models/efforts';

export interface UseComposerModelsOptions {
  /** Provider settings from user data; shape is provider-defined. */
  modelConfig: any;
  /** Either a plain model id or `<modelId>::effort-<n>`. */
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
}

export interface ComposerModels {
  /** The saved model matching the selection, or undefined while none is. */
  activeModel: any;
  /** "Gemini 3 Pro" -> "3 Pro". Exposed because the non-chat composer
   *  formats its own label inline. */
  getShortName: (name: string) => string;
  activeModelDisplayLabel: string;
  /** Empty string when the model has no thinking effort selected. */
  activeEffortDisplayLabel: string;
  /** The two above joined, for the pill and its aria-label. */
  activeModelAndEffortLabel: string;
}

export const useComposerModels = ({
  modelConfig,
  selectedModelId,
  setSelectedModelId,
}: UseComposerModelsOptions): ComposerModels => {
  // Combine models to find the active one
  const ALL_MODELS = [
    ...modelConfig.gemini.savedModels.map((m: any) => ({ ...m, provider: 'Google' })),
      ...modelConfig.openai.savedModels.map((m: any) => ({ ...m, provider: 'OpenAI' })),
      ...modelConfig.anthropic.savedModels.map((m: any) => ({ ...m, provider: 'Anthropic' })),
      ...(modelConfig.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'Moonshot AI' })),
      ...(modelConfig.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'SpaceXAI' })),
      ...(modelConfig.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'Zhipu AI' }))
  ].filter((m: any) => {
    const id = (m.modelId || m.id || '').toLowerCase();
    const name = (m.name || '').toLowerCase();
    if (['grok-imagine', 'grok-voice', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview', 'gemini-3.1-flash-lite-image', 'veo-3.1-fast', 'veo-3.1', 'veo-3.1-lite', 'omni-flash', 'lyria-3-pro'].includes(id)) return false;
    if (id.includes('imagine') || id.includes('voice') || id.includes('banana') || id.includes('veo') || id.includes('lyria')) return false;
    if (name.includes('imagine') || name.includes('voice') || name.includes('banana') || name.includes('veo') || name.includes('lyria')) return false;
    return true;
  });

  // Sync selection with available models
  useEffect(() => {
    if (ALL_MODELS.length > 0) {
      const baseId = selectedModelId ? selectedModelId.split('::effort-')[0] : '';
      if (!selectedModelId || !ALL_MODELS.find(m => m.id === selectedModelId || m.id === baseId)) {
        setSelectedModelId(ALL_MODELS[0].id);
      }
    } else {
      setSelectedModelId("");
    }
  }, [ALL_MODELS, selectedModelId]);

  const activeModel = ALL_MODELS.find(m => m.id === selectedModelId) || ALL_MODELS.find(m => m.id === (selectedModelId ? selectedModelId.split('::effort-')[0] : ''));

  // Helper to shorten names: "Gemini 3 Pro" -> "3 Pro", "Gemini 2.5 Flash Lite" -> "2.5 Lite"
  const getShortName = (name: string) => {
    if (!name) return "Model";
    if (name.includes("2.5 Flash Lite")) return "2.5 Lite";
    return name
      .replace(/Gemini\s+/gi, '')
      .replace(/Claude\s+/gi, '')
      .replace(/GPT\s+/gi, '')
      .replace(/\s+Extended$/gi, '')
      .trim();
  };

  let currentThinkingLevel = activeModel?.thinkingLevel ?? 0;
  if (selectedModelId?.includes('::effort-')) {
    currentThinkingLevel = Number(selectedModelId.split('::effort-')[1]);
  }

  const activeModelDisplayLabel = activeModel ? getShortName(activeModel.name) : 'Model';
  // A no-thinking selection contributes nothing to the pill — "Opus 5", not
  // "Opus 5 None". `isNonThinkingEffort` also catches labels that already mean
  // off (Gemini flash's `minimal`), so those read as just the model too.
  const activeEffortRecord = activeModel
    ? { ...activeModel, thinkingLevel: currentThinkingLevel }
    : undefined;
  const activeEffortDisplayLabel = activeEffortRecord && !isNonThinkingEffort(activeEffortRecord)
    ? getThinkingEffortLabel(activeEffortRecord, true)
    : '';
  const activeModelAndEffortLabel = [activeModelDisplayLabel, activeEffortDisplayLabel]
    .filter(Boolean)
    .join(' ');

  return {
    activeModel,
    getShortName,
    activeModelDisplayLabel,
    activeEffortDisplayLabel,
    activeModelAndEffortLabel,
  };
};
