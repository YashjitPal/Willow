import React from 'react';
import { ChevronDown, Check, X, Lightbulb, ChevronLeft, ChevronRight, Loader2, Sparkles, Image as ImageIcon, Video, Music, Plus, GripVertical, Database } from 'lucide-react';
import { AUTO_MODEL, resolveAutoModel } from '@willow/ai/models/auto-select';
import { type ProviderId } from '@willow/ai/providers/endpoints';
import { DEFAULT_PROFILE_IDS, defaultApiFormatForProvider, defaultToolPolicyForProvider } from '@willow/ai/providers/profiles';
import { collectSavedModelsInCatalogOrder, getModelCatalogKey, getModelCategory, getNormalizedModelOrder } from '@willow/core/model-catalog';
import { CHROME_NATIVE_TRANSCRIPTION_MODEL, CHROME_NATIVE_TRANSCRIPTION_NAME } from '@willow/ai/transcription';

const ModelCategoryIcon: React.FC<{ modelId: string; className?: string; size?: number }> = ({ modelId, className = "text-zinc-500", size = 14 }) => {
  const category = getModelCategory(modelId);
  if (category === 'image') return <ImageIcon size={size} className={className} />;
  if (category === 'video') return <Video size={size} className={className} />;
  if (category === 'audio') return <Music size={size} className={className} />;
  if (category === 'embedding') return <Database size={size} className={className} />;
  return <Sparkles size={size} className={className} />;
};

const DEFAULT_CUSTOM_REASONING_EFFORTS = [
  { id: 'effort-none', level: '0', label: 'None', value: 'none' },
  { id: 'effort-low', level: '1', label: 'Low', value: 'low' },
  { id: 'effort-medium', level: '2', label: 'Medium', value: 'medium' },
  { id: 'effort-high', level: '3', label: 'High', value: 'high' },
];

const MOONSHOT_MODELS = [
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    maxLevels: 4,
    hasNone: true,
    levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Max' }
  }
];

const SPACEXAI_MODELS: Array<GeminiModel & { defaultThinkingLevel: number }> = [
  {
    id: 'grok-4.6',
    name: 'Grok 4.6',
    maxLevels: 3,
    hasNone: false,
    defaultThinkingLevel: 3,
    levelLabels: { 1: 'Low', 2: 'Medium', 3: 'High' }
  },
  {
    id: 'grok-voice',
    name: 'Grok Voice',
    maxLevels: 0,
    hasNone: true,
    defaultThinkingLevel: 0
  },
  {
    id: 'grok-imagine',
    name: 'Grok Imagine',
    maxLevels: 0,
    hasNone: true,
    defaultThinkingLevel: 0
  }
];

const STANDARD_THINKING_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Medium',
  3: 'High'
};

const getConfiguredThinkingLabel = (
  level: number,
  levelLabels: Record<number, string> = STANDARD_THINKING_LABELS,
  noneLabel = 'None'
) => level === 0 ? noneLabel : levelLabels[level] || `Level ${level}`;

// Custom Bulb Icon: Uses standard Lightbulb but fills it when active (Reasoning On)
const ReasoningBulb = ({ isActive, className, strokeWidth }: { isActive: boolean, className?: string, strokeWidth?: number }) => {
    return (
        <Lightbulb 
            className={`${className} ${isActive ? "fill-current" : ""}`} 
            strokeWidth={2} 
        />
    );
};

export const getModelPricing = (modelId: string, provider: string): string => {
  const prices: Record<string, string> = {
    // Gemini
    'gemini-3.7-flash': '$0.15/$0.60',
    'gemini-3.6-flash': '$0.15/$0.60',
    'gemini-3.5-flash': '$0.15/$0.60',
    'gemini-3.5-flash-lite': '$0.075/$0.30',
    'gemini-3.1-pro-preview': '$2.50/$10.00',
    'gemini-2.5-flash-lite': '$0.075/$0.30',
    'gemini-3-pro-image-preview': '$1.25/$5.00',
    'gemini-3.1-flash-image-preview': '$0.15/$0.60',
    'gemini-3.1-flash-lite-image': '$0.075/$0.30',
    'omni-flash': '$0.15/$0.60',
    'lyria-3-pro': '$1.00/$4.00',
    'lyria-3': '$0.50/$2.00',
    'veo-3.1-fast': '$2.00/$8.00',
    'veo-3.1': '$3.00/$12.00',
    'veo-3.1-lite': '$1.00/$4.00',
    'gemini-3.1-flash-live-preview': '$0.15/$0.60',
    // OpenAI
    'gpt-5.2-thinking': '$5.00/$25.00',
    'gpt-5.2-pro': '$5.00/$25.00',
    'gpt-5.1-codex-high-max': '$3.00/$15.00',
    'gpt-5.2-codex': '$3.00/$15.00',
    'gpt-image-2': '$0.50/$2.00',
    // Anthropic
    'claude-opus-5': '$15.00/$75.00',
    'claude-sonnet-5': '$3.00/$15.00',
    'claude-fable-5': '$0.25/$1.25',
    'claude-3-5-sonnet-20241022': '$3.00/$15.00',
    'claude-sonnet-4.5': '$3.00/$15.00',
    // Moonshot
    'kimi-k3': '$1.00/$3.00',
    'kimi-k2.6': '$0.80/$2.40',
    'kimi-k2.7-code': '$1.00/$3.00',
    'moonshot-v1-8k': '$0.50/$1.50',
    'moonshot-v1-32k': '$0.80/$2.40',
    'moonshot-v1-128k': '$1.50/$4.50',
    // SpaceXAI / xAI
    'grok-4.6': '$3.00/$15.00',
    'grok-voice': '$2.00/$8.00',
    'grok-imagine': '$2.00/$8.00',
    // Zhipu
    'glm-5.2': '$1.00/$3.00',
    'glm-4-plus': '$1.00/$3.00',
    'glm-4-flash': '$0.10/$0.30',
    'glm-4': '$0.50/$1.50',
  };

  if (prices[modelId]) return prices[modelId];

  switch (provider) {
    case 'gemini': return '$0.15/$0.60';
    case 'openai': return '$2.50/$10.00';
    case 'anthropic': return '$3.00/$15.00';
    case 'moonshot': return '$1.00/$3.00';
    case 'spacexai': return '$3.00/$15.00';
    case 'zhipuai': return '$1.00/$3.00';
    default: return '$1.00/$4.00';
  }
};

interface GeminiModel {
  id: string;
  name: string;
  maxLevels: number;
  hasNone: boolean;
  noneLabel?: string;
  levelLabels?: Record<number, string>;
  capabilities?: string[];
}

interface ModelsTabProps {
  modelConfig: any;
  setModelConfig: React.Dispatch<React.SetStateAction<any>>;
  managingProvider: any;
  setManagingProvider: (v: any) => void;
  wasManagingKeys: boolean;
  handleExitManageKeys: () => void;
  providerState: any;
  handleUpdateConfig: (provider: any, config: { apiKey: string; baseUrl: string }) => Promise<void>;
  GEMINI_MODELS: GeminiModel[];
  // Gemini dropdown
  geminiRef: React.RefObject<HTMLDivElement | null>;
  geminiDropdownOpen: boolean;
  setGeminiDropdownOpen: (v: boolean) => void;
  geminiDropdownClosing: boolean;
  geminiDirection: 'down' | 'up';
  setGeminiDirection: (v: 'down' | 'up') => void;
  closeGeminiDropdown: () => void;
  // OpenAI dropdown
  openaiRef: React.RefObject<HTMLDivElement | null>;
  openaiDropdownOpen: boolean;
  setOpenaiDropdownOpen: (v: boolean) => void;
  openaiDropdownClosing: boolean;
  openaiDirection: 'down' | 'up';
  setOpenaiDirection: (v: 'down' | 'up') => void;
  closeOpenaiDropdown: () => void;
  // Anthropic dropdown
  anthropicRef: React.RefObject<HTMLDivElement | null>;
  anthropicDropdownOpen: boolean;
  setAnthropicDropdownOpen: (v: boolean) => void;
  anthropicDropdownClosing: boolean;
  anthropicDirection: 'down' | 'up';
  setAnthropicDirection: (v: 'down' | 'up') => void;
  closeAnthropicDropdown: () => void;
  // Helpers
  determineDirection: (ref: React.RefObject<HTMLDivElement>) => 'down' | 'up';
}

export const ModelsTab: React.FC<ModelsTabProps> = ({
  modelConfig,
  setModelConfig,
  managingProvider,
  setManagingProvider,
  wasManagingKeys,
  handleExitManageKeys,
  providerState,
  handleUpdateConfig,
  GEMINI_MODELS,
  geminiRef,
  geminiDropdownOpen,
  setGeminiDropdownOpen,
  geminiDropdownClosing,
  geminiDirection,
  setGeminiDirection,
  closeGeminiDropdown,
  openaiRef,
  openaiDropdownOpen,
  setOpenaiDropdownOpen,
  openaiDropdownClosing,
  openaiDirection,
  setOpenaiDirection,
  closeOpenaiDropdown,
  anthropicRef,
  anthropicDropdownOpen,
  setAnthropicDropdownOpen,
  anthropicDropdownClosing,
  anthropicDirection,
  setAnthropicDirection,
  closeAnthropicDropdown,
  determineDirection,
}) => {
  const [providerPage, setProviderPage] = React.useState(1);
  const [moonshotDropdownOpen, setMoonshotDropdownOpen] = React.useState(false);
  const [spacexaiDropdownOpen, setSpacexaiDropdownOpen] = React.useState(false);
  const [zhipuaiDropdownOpen, setZhipuaiDropdownOpen] = React.useState(false);
  const [transcriptionDropdownOpen, setTranscriptionDropdownOpen] = React.useState(false);
  const [transcriptionDirection, setTranscriptionDirection] = React.useState<'down' | 'up'>('down');
  const transcriptionRef = React.useRef<HTMLDivElement>(null);
  const [chatSearchDropdownOpen, setChatSearchDropdownOpen] = React.useState(false);
  const [chatSearchDirection, setChatSearchDirection] = React.useState<'down' | 'up'>('down');
  const chatSearchRef = React.useRef<HTMLDivElement>(null);
  const [notebookSearchDropdownOpen, setNotebookSearchDropdownOpen] = React.useState(false);
  const [notebookSearchDirection, setNotebookSearchDirection] = React.useState<'down' | 'up'>('down');
  const notebookSearchRef = React.useRef<HTMLDivElement>(null);
  const [personalDropdownOpen, setPersonalDropdownOpen] = React.useState(false);
  const [personalDirection, setPersonalDirection] = React.useState<'down' | 'up'>('down');
  const personalRef = React.useRef<HTMLDivElement>(null);
  const [customModelExpanded, setCustomModelExpanded] = React.useState(false);
  const [draggedModelKey, setDraggedModelKey] = React.useState<string | null>(null);
  const [dragOverModelKey, setDragOverModelKey] = React.useState<string | null>(null);
  const [customModelDraft, setCustomModelDraft] = React.useState({
    name: '',
    modelId: '',
    capabilities: 'text, tools',
  });
  const [customReasoningEfforts, setCustomReasoningEfforts] = React.useState(DEFAULT_CUSTOM_REASONING_EFFORTS);

  const providerProfiles = Array.isArray(modelConfig.providerProfiles) ? modelConfig.providerProfiles : [];
  const catalogModels = collectSavedModelsInCatalogOrder(modelConfig).map((model) => ({
    ...model,
    provider: model.providerId,
  }));
  const addCustomModel = () => {
    if (!managingProvider) return;
    const name = customModelDraft.name.trim();
    const modelId = customModelDraft.modelId.trim();
    if (!name || !modelId) return;
    const profileId = DEFAULT_PROFILE_IDS[managingProvider as keyof typeof DEFAULT_PROFILE_IDS];
    const profile = providerProfiles.find((candidate: any) => candidate.id === profileId);
    const reasoningEfforts = Array.from(new Map(customReasoningEfforts
      .map((effort) => ({
        id: `${modelId}-effort-${Number(effort.level)}`,
        level: Number(effort.level),
        label: effort.label.trim(),
        value: effort.value.trim(),
      }))
      .filter((effort) => Number.isFinite(effort.level) && effort.label)
      .sort((a, b) => a.level - b.level)
      .map((effort) => [effort.level, {
        ...effort,
        ...(effort.value ? { value: effort.value } : {}),
      }])).values());
    const defaultEffort = reasoningEfforts.find((effort) => effort.level > 0) || reasoningEfforts[0];
    const capabilities = customModelDraft.capabilities.split(',').map((item) => item.trim()).filter(Boolean);

    setModelConfig((prev: any) => ({
      ...prev,
      [managingProvider]: {
        ...prev[managingProvider],
        savedModels: [
          ...(prev[managingProvider]?.savedModels || []).filter((model: any) => !(model.modelId === modelId && model.profileId === profileId)),
          {
            id: `custom-model-${Date.now().toString(36)}`,
            name,
            modelId,
            profileId,
            thinkingLevel: defaultEffort?.level ?? 0,
            thinkingLabel: defaultEffort?.label,
            effortLabel: defaultEffort?.label,
            reasoningEfforts,
            capabilities,
            baseUrl: profile?.baseUrl,
            apiFormat: profile?.apiFormat,
            toolPolicy: profile?.toolPolicy,
          },
        ],
      },
      providerProfiles: (prev.providerProfiles || []).map((profile: any) => profile.id === profileId
        ? { ...profile, modelIds: Array.from(new Set([...(profile.modelIds || []), modelId])), updatedAt: Date.now() }
        : profile),
    }));
    setCustomModelDraft((current) => ({ ...current, name: '', modelId: '' }));
    setCustomModelExpanded(false);
  };

  const reorderCatalogModel = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    setModelConfig((prev: any) => {
      const order = getNormalizedModelOrder(prev);
      const sourceIndex = order.indexOf(sourceKey);
      const targetIndex = order.indexOf(targetKey);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const nextOrder = [...order];
      const [moved] = nextOrder.splice(sourceIndex, 1);
      nextOrder.splice(targetIndex, 0, moved);
      return { ...prev, modelOrder: nextOrder };
    });
  };

  const allSystemDefaultModels = React.useMemo(() => {
    const models = collectSavedModelsInCatalogOrder(modelConfig).map((model) => ({
      ...model,
      provider: model.providerId,
    }));
    const seen = new Set<string>();
    return models.filter((model: any) => {
      const key = `${model.provider}:${model.profileId || 'default'}:${model.modelId || model.id}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [modelConfig]);

  const configuredSystemDefaultModels = React.useMemo(
    () => allSystemDefaultModels.filter(
      (model: any) => Boolean(providerState?.[model.provider]?.apiKey),
    ),
    [allSystemDefaultModels, providerState],
  );

  const selectableEmbeddingModels = React.useMemo(
    () => allSystemDefaultModels.filter((model: any) => (
      Boolean(providerState?.[model.provider]?.apiKey?.trim()) &&
      model.provider === 'gemini' &&
      (
        model.capabilities?.includes('embedding') ||
        model.category === 'embedding' ||
        /embed/i.test((model.modelId || model.id) || '')
      )
    )),
    [allSystemDefaultModels, providerState],
  );

  // Models this screen can actually offer: has a key, and a provider this code
  // can send requests to. Kimi, Grok and GLM saved models exist but no consumer
  // of a system default can call them, so they would be dead choices.
  const selectablePersonalModels = React.useMemo(() => {
    const onlyText = /(image|banana|veo|lyria|tts|audio|speech|embedding|omni|realtime|whisper|sora)/;
    return allSystemDefaultModels.filter(
      (model: any) =>
        Boolean(providerState?.[model.provider]?.apiKey) &&
        /^(gemini|claude|gpt-|o1|o3)/.test((model.modelId || model.id) || '') &&
        !onlyText.test(((model.modelId || model.id) || '').toLowerCase()),
    );
  }, [allSystemDefaultModels, providerState]);

  // The model Personal Intelligence routes to right now, resolved the same way
  // the builder resolves it. Undefined means "no key, no saved model, no job".
  const personalSelection = React.useMemo(
    () => resolveAutoModel(
      modelConfig.systemDefaults?.personalIntelligence,
      allSystemDefaultModels,
      (provider: any) => Boolean(providerState?.[provider]?.apiKey),
    ),
    [modelConfig.systemDefaults?.personalIntelligence, allSystemDefaultModels, providerState],
  );

  const isPersonalAutomatic = (modelConfig.systemDefaults?.personalIntelligence || AUTO_MODEL) === AUTO_MODEL;

  const selectedTranscriptionModelName = allSystemDefaultModels.find(
    (model: any) => model.modelId === modelConfig.systemDefaults?.transcription,
  )?.name || (modelConfig.systemDefaults?.transcription === CHROME_NATIVE_TRANSCRIPTION_MODEL
    ? CHROME_NATIVE_TRANSCRIPTION_NAME
    : modelConfig.systemDefaults?.transcription === 'gemini-3.5-flash-lite'
    ? 'Gemini 3.5 Flash Lite'
    : modelConfig.systemDefaults?.transcription) || 'Select model';

  const selectedChatSearchModelName = selectableEmbeddingModels.find(
    (model: any) => model.modelId === modelConfig.systemDefaults?.chatSearch,
  )?.name || 'Lexical search';

  /*
   * Falls back to the same "Lexical search" label as chat search when nothing is
   * chosen, and for the same reason: an unset value is not an error state, it is
   * the free, offline default. A notebook still retrieves without an embedding
   * model — it ranks passages by term overlap instead of by meaning.
   */
  const selectedNotebookSearchModelName = selectableEmbeddingModels.find(
    (model: any) => model.modelId === modelConfig.systemDefaults?.notebookSearch,
  )?.name || 'Lexical search';

  const selectedPersonalModelName = isPersonalAutomatic
    ? (personalSelection?.name
        ? `${personalSelection.name} · automatic`
        : 'Automatic · no eligible model yet')
    : allSystemDefaultModels.find(
        (model: any) => model.modelId === modelConfig.systemDefaults?.personalIntelligence,
      )?.name || modelConfig.systemDefaults?.personalIntelligence || 'Select model';

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-dropdown="moonshot"]')) setMoonshotDropdownOpen(false);
      if (!target.closest('[data-dropdown="spacexai"]')) setSpacexaiDropdownOpen(false);
      if (!target.closest('[data-dropdown="zhipuai"]')) setZhipuaiDropdownOpen(false);
      if (!target.closest('[data-dropdown="transcription-model"]')) setTranscriptionDropdownOpen(false);
      if (!target.closest('[data-dropdown="chat-search-model"]')) setChatSearchDropdownOpen(false);
      if (!target.closest('[data-dropdown="personal-intelligence-model"]')) setPersonalDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  React.useEffect(() => {
    const selected = MOONSHOT_MODELS.find(m => m.id === modelConfig.moonshot.model);
    if (selected) {
        if (!selected.hasNone && modelConfig.moonshot.thinkingLevel === 0) {
            setModelConfig((prev: any) => ({ ...prev, moonshot: { ...prev.moonshot, thinkingLevel: 1 } }));
        } else if (modelConfig.moonshot.thinkingLevel > selected.maxLevels) {
            setModelConfig((prev: any) => ({ ...prev, moonshot: { ...prev.moonshot, thinkingLevel: selected.maxLevels } }));
        }
    }
  }, [modelConfig.moonshot.model]);

  React.useEffect(() => {
    const selected = SPACEXAI_MODELS.find(m => m.id === modelConfig.spacexai.model);
    if (!selected) return;

    const currentLevel = modelConfig.spacexai.thinkingLevel;
    if ((!selected.hasNone && currentLevel === 0) || currentLevel > selected.maxLevels) {
      setModelConfig((prev: any) => ({
        ...prev,
        spacexai: {
          ...prev.spacexai,
          thinkingLevel: selected.hasNone ? selected.maxLevels : selected.defaultThinkingLevel
        }
      }));
    }
  }, [modelConfig.spacexai.model, modelConfig.spacexai.thinkingLevel, setModelConfig]);

  return (
  <div className="w-full h-full px-12 py-10 overflow-y-auto relative">
    {/* Header */}
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-4">
        {managingProvider && (
          <button 
            onClick={handleExitManageKeys}
            className="p-1.5 -ml-2 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <ChevronDown className="rotate-90" size={20} />
          </button>
        )}
        <h1 className="text-[24px] font-bold text-white">
          {managingProvider ? `Manage ${managingProvider.charAt(0).toUpperCase() + managingProvider.slice(1)}` : 'Models & API'}
        </h1>
      </div>
    </div>
    
    {!managingProvider && (
      <div className="pb-6 border-b border-white/5 mb-8">
        <p className="text-[14px] text-zinc-400">
          Connect your AI providers and configure model settings.
        </p>
      </div>
    )}

    {/* Manage Keys View */}
    {managingProvider ? (
      <div className="animate-[fadeIn_150ms_ease-out] flex flex-col space-y-6 mt-8">
        <div className="bg-[#1c1c1c] border border-white/5 rounded-xl p-6">
          <h3 className="text-[14px] font-bold text-white mb-4">API Configuration</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[12px] font-semibold text-zinc-400">API keys</label>
              <input
                type="password"
                autoComplete="off"
                placeholder={`Enter ${managingProvider.charAt(0).toUpperCase() + managingProvider.slice(1)} API keys, separated by commas...`}
                className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 font-mono text-[13px] text-white focus:outline-none focus:border-white/20 transition-colors shadow-inner"
                value={providerState[managingProvider].apiKey}
                onChange={(e) => handleUpdateConfig(managingProvider, { ...providerState[managingProvider], apiKey: e.target.value })}
              />
              <p className="text-[11px] text-zinc-500">Separate multiple keys with commas. They are tried from left to right when authentication is rejected.</p>
            </div>
            <div className="space-y-2">
              <label className="text-[12px] font-semibold text-zinc-400">Base URL (Optional)</label>
              <input 
                type="text" 
                placeholder="e.g., https://api.openai.com/v1"
                className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors shadow-inner"
                value={providerState[managingProvider].baseUrl}
                onChange={(e) => handleUpdateConfig(managingProvider, { ...providerState[managingProvider], baseUrl: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-zinc-400">API format</label>
                <select
                  value={providerProfiles.find((profile: any) => profile.id === DEFAULT_PROFILE_IDS[managingProvider])?.apiFormat || defaultApiFormatForProvider(managingProvider as ProviderId)}
                  onChange={(event) => setModelConfig((prev: any) => ({
                    ...prev,
                    providerProfiles: (prev.providerProfiles || []).map((profile: any) => profile.id === DEFAULT_PROFILE_IDS[managingProvider]
                      ? { ...profile, apiFormat: event.target.value, updatedAt: Date.now() }
                      : profile),
                  }))}
                  className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 text-[13px] text-white focus:outline-none focus:border-white/20"
                >
                  <option value="native-gemini">Gemini Generate Content</option>
                  <option value="openai-chat-completions">OpenAI Chat Completions</option>
                  <option value="openai-responses">OpenAI Responses</option>
                  <option value="anthropic-messages">Anthropic Messages</option>
                  <option value="xai-chat-completions">xAI tools + Chat Completions</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-zinc-400">Tool translation</label>
                <select
                  value={providerProfiles.find((profile: any) => profile.id === DEFAULT_PROFILE_IDS[managingProvider])?.toolPolicy || defaultToolPolicyForProvider(managingProvider as ProviderId)}
                  onChange={(event) => setModelConfig((prev: any) => ({
                    ...prev,
                    providerProfiles: (prev.providerProfiles || []).map((profile: any) => profile.id === DEFAULT_PROFILE_IDS[managingProvider]
                      ? { ...profile, toolPolicy: event.target.value, updatedAt: Date.now() }
                      : profile),
                  }))}
                  className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 text-[13px] text-white focus:outline-none focus:border-white/20"
                >
                  <option value="provider-native">Provider-native</option>
                  <option value="function-calling">Function calling</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>
          </div>
          <p className="text-[12px] text-zinc-500 mt-4">
            Keys are stored locally in your browser session for security and synced securely via Firestore.
          </p>
        </div>

        {/* Active Provider Config */}
        <div className="pt-8">
          <div className="h-[12px] w-full text-white/10 mb-8 overflow-hidden">
            <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="wave-pattern" width="32" height="12" patternUnits="userSpaceOnUse">
                  <path 
                    d="M 0 6 C 4 2, 12 2, 16 6 C 20 10, 28 10, 32 6" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="1.5" 
                    strokeLinecap="round" 
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#wave-pattern)" />
            </svg>
          </div>
          <h2 className="text-[14px] font-bold text-zinc-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            {managingProvider === 'gemini' && "Gemini Settings"}
            {managingProvider === 'openai' && "OpenAI Settings"}
            {managingProvider === 'anthropic' && "Anthropic Settings"}
          </h2>

          <div className="bg-[#141414] border border-white/5 rounded-xl shadow-2xl shadow-black/50">
            {/* Gemini Provider Settings */}
            {managingProvider === 'gemini' && (
              <div className="p-6 space-y-6">
                {/* Model Selection */}
                <div className="space-y-3">
                  <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                  <div className="relative" ref={geminiRef} data-dropdown="gemini">
                       {/* Custom Dropdown Trigger */}
                       <button
                           onClick={() => {
                               if (geminiDropdownOpen) {
                                   closeGeminiDropdown();
                               } else {
                                   setGeminiDirection(determineDirection(geminiRef));
                                   setGeminiDropdownOpen(true);
                               }
                           }}
                           className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3.5 text-[15px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                       >
                           <span>{GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model)?.name || 'Select model'}</span>
                           <ChevronDown size={16} className={`text-zinc-500 transition-transform duration-200 ${geminiDropdownOpen ? 'rotate-180' : ''}`} />
                       </button>

                       {/* Custom Dropdown Menu */}
                       {geminiDropdownOpen && (
                           <div className={`absolute ${geminiDirection === 'up' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden ${geminiDropdownClosing ? (geminiDirection === 'up' ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (geminiDirection === 'up' ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}>
                               {/* Corner Border Glow Effects */}
                               <div className="absolute -top-px -left-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -top-px -left-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -bottom-px -right-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -bottom-px -right-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="max-h-[280px] overflow-y-auto custom-scrollbar">
                                 {GEMINI_MODELS.map((model, index) => (
                                   <button
                                       key={model.id}
                                       onClick={() => {
                                           setModelConfig(prev => ({ ...prev, gemini: { ...prev.gemini, model: model.id } }));
                                           closeGeminiDropdown();
                                       }}
                                       className={`
                                           relative w-full px-4 py-3 text-left text-[14px] transition-all flex items-center justify-between group
                                           ${modelConfig.gemini.model === model.id 
                                               ? 'bg-white/10 text-white' 
                                               : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                           }
                                           ${index === 0 ? 'rounded-t-lg' : ''}
                                           ${index === GEMINI_MODELS.length - 1 ? 'rounded-b-lg' : ''}
                                       `}
                                   >
                                       <span className="font-medium">{model.name}</span>
                                       {modelConfig.gemini.model === model.id && (
                                           <Check size={16} className="text-white" />
                                       )}
                                   </button>
                                 ))}
                               </div>
                           </div>
                       )}
                  </div>
                </div>

                {/* Add Button */}
                <button 
                  onClick={() => {
                    const selectedModel = GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model);
                    if (selectedModel) {
                      const isDuplicate = modelConfig.gemini.savedModels.some(
                        m => m.modelId === selectedModel.id
                      );
                      if (isDuplicate) return;
                      
                      setModelConfig(prev => ({
                        ...prev,
                        gemini: {
                          ...prev.gemini,
                          savedModels: [
                            ...prev.gemini.savedModels,
                            {
                              id: Math.random().toString(36).substr(2, 9),
                              modelId: selectedModel.id,
                              name: selectedModel.name,
                              thinkingLevel: selectedModel.maxLevels > 0 ? 3 : 0,
                              thinkingLabel: selectedModel.maxLevels > 0 ? 'High' : 'None',
                              capabilities: selectedModel.capabilities
                            }
                          ]
                        }
                      }));
                    }
                  }}
                  disabled={(() => {
                    const selectedModel = GEMINI_MODELS.find(m => m.id === modelConfig.gemini.model);
                    if (!selectedModel) return true;
                    return modelConfig.gemini.savedModels.some(
                      m => m.modelId === selectedModel.id
                    );
                  })()}
                  className="w-full py-3 bg-white text-black font-semibold text-[13px] rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {modelConfig.gemini.savedModels.some(m => m.modelId === modelConfig.gemini.model) ? 'Already Added' : 'Add to Models'}
                </button>
              </div>
            )}

            {/* OpenAI Provider Settings */}
            {managingProvider === 'openai' && (
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                  <div className="relative" ref={openaiRef} data-dropdown="openai">
                        <button
                            onClick={() => {
                                if (openaiDropdownOpen) {
                                    closeOpenaiDropdown();
                                } else {
                                    setOpenaiDirection(determineDirection(openaiRef));
                                    setOpenaiDropdownOpen(true);
                                }
                            }}
                            className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3.5 text-[15px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                        >
                            <span className="flex items-center gap-2">
                                <span>{
                                    {
                                        'gpt-5.6-sol': 'GPT 5.6 Sol',
                                        'gpt-5.6-terra': 'GPT 5.6 Terra',
                                        'gpt-5.6-luna': 'GPT 5.6 Luna',
                                        'gpt-image-2': 'GPT Image 2'
                                    }[modelConfig.openai.model] || 'Select model'
                                }</span>
                                <ModelCategoryIcon modelId={modelConfig.openai.model} size={14} className="text-zinc-400" />
                            </span>
                            <ChevronDown size={16} className={`text-zinc-500 transition-transform duration-200 ${openaiDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        
                        {openaiDropdownOpen && (
                            <div className={`absolute ${openaiDirection === 'up' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden ${openaiDropdownClosing ? (openaiDirection === 'up' ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (openaiDirection === 'up' ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}>
                                <div className="absolute -top-px -left-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.4), transparent)' }} />
                                <div className="absolute -top-px -left-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.4), transparent)' }} />
                                <div className="absolute -bottom-px -right-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(255,255,255,0.4), transparent)' }} />
                                <div className="absolute -bottom-px -right-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.4), transparent)' }} />
                                <div className="max-h-[280px] overflow-y-auto custom-scrollbar">
                                    {[
                                        { id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
                                        { id: 'gpt-5.6-terra', name: 'GPT 5.6 Terra' },
                                        { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna' },
                                        { id: 'gpt-image-2', name: 'GPT Image 2' }
                                    ].map((model, index, arr) => (
                                        <button
                                            key={model.id}
                                            onClick={() => {
                                                setModelConfig(prev => ({ ...prev, openai: { ...prev.openai, model: model.id } }));
                                                closeOpenaiDropdown();
                                            }}
                                            className={`
                                                relative w-full px-4 py-3 text-left text-[14px] transition-all flex items-center justify-between group
                                                ${modelConfig.openai.model === model.id 
                                                    ? 'bg-white/10 text-white' 
                                                    : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                                }
                                                ${index === 0 ? 'rounded-t-lg' : ''}
                                                ${index === arr.length - 1 ? 'rounded-b-lg' : ''}
                                            `}
                                        >
                                            <span className="flex items-center gap-2">
                                                <span className="font-medium">{model.name}</span>
                                                <ModelCategoryIcon modelId={model.id} size={13} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />
                                            </span>
                                            {modelConfig.openai.model === model.id && (
                                                <Check size={16} className="text-white" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                   </div>
                 </div>

                <button 
                  onClick={() => {
                    const modelNames: Record<string, string> = {
                      'gpt-5.6-sol': 'GPT 5.6 Sol',
                      'gpt-5.6-terra': 'GPT 5.6 Terra',
                      'gpt-5.6-luna': 'GPT 5.6 Luna',
                      'gpt-image-2': 'GPT Image 2'
                    };
                    const modelName = modelNames[modelConfig.openai.model] || modelConfig.openai.model.split('-').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

                    if (modelConfig.openai.savedModels.some((m: any) => m.modelId === modelConfig.openai.model)) return;

                    setModelConfig((prev: any) => ({
                      ...prev,
                      openai: {
                        ...prev.openai,
                        savedModels: [
                          ...prev.openai.savedModels,
                          {
                            id: Math.random().toString(36).substr(2, 9),
                            modelId: prev.openai.model,
                            name: modelName,
                            thinkingLevel: 3,
                            thinkingLabel: 'High'
                          }
                        ]
                      }
                    }));
                  }}
                  disabled={modelConfig.openai.savedModels.some((m: any) => m.modelId === modelConfig.openai.model)}
                  className="w-full py-3 bg-white text-black font-semibold text-[13px] rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {modelConfig.openai.savedModels.some((m: any) => m.modelId === modelConfig.openai.model) ? 'Already Added' : 'Add to Models'}
                </button>
              </div>
            )}

            {/* Anthropic Provider Settings */}
            {managingProvider === 'anthropic' && (
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                  <div className="relative" ref={anthropicRef} data-dropdown="anthropic">
                       <button
                           onClick={() => {
                               if (anthropicDropdownOpen) {
                                   closeAnthropicDropdown();
                               } else {
                                   setAnthropicDirection(determineDirection(anthropicRef));
                                   setAnthropicDropdownOpen(true);
                               }
                           }}
                           className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3.5 text-[15px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                       >
                           <span className="flex items-center gap-2">
                               <span>{
                                   {
                                       'claude-opus-5': 'Claude Opus 5',
                                       'claude-sonnet-5': 'Claude Sonnet 5',
                                       'claude-fable-5': 'Claude Fable 5'
                                   }[modelConfig.anthropic.model] || 'Select model'
                               }</span>
                               <ModelCategoryIcon modelId={modelConfig.anthropic.model} size={14} className="text-zinc-400" />
                           </span>
                           <ChevronDown size={16} className={`text-zinc-500 transition-transform duration-200 ${anthropicDropdownOpen ? 'rotate-180' : ''}`} />
                       </button>
                       
                       {anthropicDropdownOpen && (
                           <div className={`absolute ${anthropicDirection === 'up' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden ${anthropicDropdownClosing ? (anthropicDirection === 'up' ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (anthropicDirection === 'up' ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}>
                               <div className="absolute -top-px -left-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -top-px -left-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -bottom-px -right-px w-16 h-[1px] pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="absolute -bottom-px -right-px w-[1px] h-16 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.4), transparent)' }} />
                               <div className="max-h-[280px] overflow-y-auto custom-scrollbar">
                                 {[
                                     { id: 'claude-opus-5', name: 'Claude Opus 5' },
                                     { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
                                     { id: 'claude-fable-5', name: 'Claude Fable 5' }
                                 ].map((model, index, arr) => (
                                     <button
                                         key={model.id}
                                         onClick={() => {
                                             setModelConfig(prev => ({ ...prev, anthropic: { ...prev.anthropic, model: model.id } }));
                                             closeAnthropicDropdown();
                                         }}
                                         className={`
                                             relative w-full px-4 py-3 text-left text-[14px] transition-all flex items-center justify-between group
                                             ${modelConfig.anthropic.model === model.id 
                                                 ? 'bg-white/10 text-white' 
                                                 : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                             }
                                             ${index === 0 ? 'rounded-t-lg' : ''}
                                             ${index === arr.length - 1 ? 'rounded-b-lg' : ''}
                                         `}
                                     >
                                         <span className="flex items-center gap-2">
                                             <span className="font-medium">{model.name}</span>
                                             <ModelCategoryIcon modelId={model.id} size={13} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />
                                         </span>
                                         {modelConfig.anthropic.model === model.id && (
                                             <Check size={16} className="text-white" />
                                         )}
                                     </button>
                                 ))}
                               </div>
                           </div>
                       )}
                  </div>
                </div>

                <button 
                  onClick={() => {
                    const modelNames: Record<string, string> = {
                      'claude-opus-5': 'Claude Opus 5',
                      'claude-sonnet-5': 'Claude Sonnet 5',
                      'claude-fable-5': 'Claude Fable 5'
                    };
                    const modelName = modelNames[modelConfig.anthropic.model] || modelConfig.anthropic.model.split('-').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

                    if (modelConfig.anthropic.savedModels.some((m: any) => m.modelId === modelConfig.anthropic.model)) return;

                    setModelConfig((prev: any) => ({
                      ...prev,
                      anthropic: {
                        ...prev.anthropic,
                        savedModels: [
                          ...prev.anthropic.savedModels,
                          {
                            id: Math.random().toString(36).substr(2, 9),
                            modelId: prev.anthropic.model,
                            name: modelName,
                            thinkingLevel: 3,
                            thinkingLabel: 'High'
                          }
                        ]
                      }
                    }));
                  }}
                  disabled={modelConfig.anthropic.savedModels.some((m: any) => m.modelId === modelConfig.anthropic.model)}
                  className="w-full py-3 bg-white text-black font-semibold text-[13px] rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {modelConfig.anthropic.savedModels.some((m: any) => m.modelId === modelConfig.anthropic.model) ? 'Already Added' : 'Add to Models'}
                </button>
              </div>
            )}

            {/* Moonshot Provider Settings */}
            {managingProvider === 'moonshot' && (
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                  <div className="relative" data-dropdown="moonshot">
                       <button
                           onClick={() => setMoonshotDropdownOpen(!moonshotDropdownOpen)}
                           className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3.5 text-[15px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                       >
                           <span>{
                               MOONSHOT_MODELS.find(m => m.id === modelConfig.moonshot.model)?.name || 'Select model'
                           }</span>
                           <ChevronDown size={16} className={`text-zinc-500 transition-transform duration-200 ${moonshotDropdownOpen ? 'rotate-180' : ''}`} />
                       </button>
                       
                       {moonshotDropdownOpen && (
                           <div className="absolute top-full mt-2 left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
                               {MOONSHOT_MODELS.map((model, index, arr) => (
                                   <button
                                       key={model.id}
                                       onClick={() => {
                                           setModelConfig((prev: any) => ({ ...prev, moonshot: { ...prev.moonshot, model: model.id } }));
                                           setMoonshotDropdownOpen(false);
                                       }}
                                       className={`
                                           relative w-full px-4 py-3 text-left text-[14px] transition-all flex items-center justify-between group
                                           ${modelConfig.moonshot.model === model.id 
                                               ? 'bg-white/10 text-white' 
                                               : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                           }
                                           ${index === 0 ? 'rounded-t-lg' : ''}
                                           ${index === arr.length - 1 ? 'rounded-b-lg' : ''}
                                       `}
                                   >
                                       <span className="font-medium">{model.name}</span>
                                       {modelConfig.moonshot.model === model.id && (
                                           <Check size={16} className="text-white" />
                                       )}
                                   </button>
                               ))}
                           </div>
                       )}
                  </div>
                </div>

                <button 
                  onClick={() => {
                    const selectedModel = MOONSHOT_MODELS.find(m => m.id === modelConfig.moonshot.model);
                    const modelName = selectedModel?.name || modelConfig.moonshot.model;
                    if ((modelConfig.moonshot?.savedModels || []).some((m: any) => m.modelId === modelConfig.moonshot.model)) return;

                    setModelConfig((prev: any) => ({
                      ...prev,
                      moonshot: {
                        ...prev.moonshot,
                        savedModels: [
                          ...prev.moonshot.savedModels,
                          {
                            id: Math.random().toString(36).substr(2, 9),
                            modelId: prev.moonshot.model,
                            name: modelName,
                            thinkingLevel: 3,
                            thinkingLabel: 'High'
                          }
                        ]
                      }
                    }));
                  }}
                  disabled={(modelConfig.moonshot?.savedModels || []).some((m: any) => m.modelId === modelConfig.moonshot.model)}
                  className="w-full py-3 bg-white text-black font-semibold text-[13px] rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {(modelConfig.moonshot?.savedModels || []).some((m: any) => m.modelId === modelConfig.moonshot.model) ? 'Already Added' : 'Add to Models'}
                </button>
              </div>
            )}

            {/* SpaceXAI Provider Settings */}
            {managingProvider === 'spacexai' && (
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                  <div className="relative" data-dropdown="spacexai">
                       <button
                           onClick={() => setSpacexaiDropdownOpen(!spacexaiDropdownOpen)}
                           className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3.5 text-[15px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                       >
                           <span>{
                               SPACEXAI_MODELS.find(m => m.id === modelConfig.spacexai.model)?.name || 'Select model'
                           }</span>
                           <ChevronDown size={16} className={`text-zinc-500 transition-transform duration-200 ${spacexaiDropdownOpen ? 'rotate-180' : ''}`} />
                       </button>

                       {spacexaiDropdownOpen && (
                           <div className="absolute top-full mt-2 left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
                               {SPACEXAI_MODELS.map((model, index, arr) => (
                                   <button
                                       key={model.id}
                                       onClick={() => {
                                           setModelConfig((prev: any) => ({ ...prev, spacexai: { ...prev.spacexai, model: model.id } }));
                                           setSpacexaiDropdownOpen(false);
                                       }}
                                       className={`
                                           relative w-full px-4 py-3 text-left text-[14px] transition-all flex items-center justify-between group
                                           ${modelConfig.spacexai.model === model.id
                                               ? 'bg-white/10 text-white'
                                               : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                           }
                                           ${index === 0 ? 'rounded-t-lg' : ''}
                                           ${index === arr.length - 1 ? 'rounded-b-lg' : ''}
                                       `}
                                   >
                                       <span className="font-medium">{model.name}</span>
                                       {modelConfig.spacexai.model === model.id && (
                                           <Check size={16} className="text-white" />
                                       )}
                                   </button>
                               ))}
                           </div>
                       )}
                  </div>
                </div>

                <button
                  onClick={() => {
                    const selectedModel = SPACEXAI_MODELS.find(m => m.id === modelConfig.spacexai.model);
                    const modelName = selectedModel?.name || modelConfig.spacexai.model;
                    if ((modelConfig.spacexai?.savedModels || []).some((m: any) => m.modelId === modelConfig.spacexai.model)) return;

                    setModelConfig((prev: any) => ({
                      ...prev,
                      spacexai: {
                        ...prev.spacexai,
                        savedModels: [
                          ...prev.spacexai.savedModels,
                          {
                            id: Math.random().toString(36).substr(2, 9),
                            modelId: prev.spacexai.model,
                            name: modelName,
                            thinkingLevel: 3,
                            thinkingLabel: 'High'
                          }
                        ]
                      }
                    }));
                  }}
                  disabled={(modelConfig.spacexai?.savedModels || []).some((m: any) => m.modelId === modelConfig.spacexai.model)}
                  className="w-full py-3 bg-white text-black font-semibold text-[13px] rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {(modelConfig.spacexai?.savedModels || []).some((m: any) => m.modelId === modelConfig.spacexai.model) ? 'Already Added' : 'Add to Models'}
                </button>
              </div>
            )}

            {/* Zhipu AI Provider Settings */}
            {managingProvider === 'zhipuai' && (
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <label className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                  <div className="relative" data-dropdown="zhipuai">
                       <button
                           onClick={() => setZhipuaiDropdownOpen(!zhipuaiDropdownOpen)}
                           className="w-full bg-transparent border border-white/10 rounded-xl px-4 py-3.5 text-[15px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                       >
                           <span>{'GLM 5.2'}</span>
                           <ChevronDown size={16} className={`text-zinc-500 transition-transform duration-200 ${zhipuaiDropdownOpen ? 'rotate-180' : ''}`} />
                       </button>
                       
                       {zhipuaiDropdownOpen && (
                           <div className="absolute top-full mt-2 left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
                               {[
                                   { id: 'glm-5.2', name: 'GLM 5.2' }
                               ].map((model, index, arr) => (
                                   <button
                                       key={model.id}
                                       onClick={() => {
                                           setModelConfig((prev: any) => ({ ...prev, zhipuai: { ...prev.zhipuai, model: model.id } }));
                                           setZhipuaiDropdownOpen(false);
                                       }}
                                       className={`
                                           relative w-full px-4 py-3 text-left text-[14px] transition-all flex items-center justify-between group
                                           ${modelConfig.zhipuai.model === model.id 
                                               ? 'bg-white/10 text-white' 
                                               : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                                           }
                                           ${index === 0 ? 'rounded-t-lg' : ''}
                                           ${index === arr.length - 1 ? 'rounded-b-lg' : ''}
                                       `}
                                   >
                                       <span className="font-medium">{model.name}</span>
                                       {modelConfig.zhipuai.model === model.id && (
                                           <Check size={16} className="text-white" />
                                       )}
                                   </button>
                               ))}
                           </div>
                       )}
                  </div>
                </div>

                <button 
                  onClick={() => {
                    const modelName = 'GLM 5.2';

                    if ((modelConfig.zhipuai?.savedModels || []).some((m: any) => m.modelId === 'glm-5.2')) return;

                    setModelConfig((prev: any) => ({
                      ...prev,
                      zhipuai: {
                        ...prev.zhipuai,
                        savedModels: [
                          ...prev.zhipuai.savedModels,
                          {
                            id: Math.random().toString(36).substr(2, 9),
                            modelId: prev.zhipuai.model,
                            name: modelName,
                            thinkingLevel: 3,
                            thinkingLabel: 'High'
                          }
                        ]
                      }
                    }));
                  }}
                  disabled={(modelConfig.zhipuai?.savedModels || []).some((m: any) => m.modelId === modelConfig.zhipuai.model)}
                  className="w-full py-3 bg-white text-black font-semibold text-[13px] rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {(modelConfig.zhipuai?.savedModels || []).some((m: any) => m.modelId === modelConfig.zhipuai.model) ? 'Already Added' : 'Add to Models'}
                </button>
              </div>
            )}
          </div>

          <div className="mt-5">
            <button
              type="button"
              onClick={() => setCustomModelExpanded((expanded) => !expanded)}
              aria-expanded={customModelExpanded}
              className="w-full min-h-12 px-4 py-3 flex items-center justify-between gap-4 border border-white/10 rounded-xl text-left text-zinc-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              <span className="flex items-center gap-3 text-[13px] font-semibold">
                <Plus size={17} /> Add custom model
              </span>
              <ChevronDown size={17} className={`text-zinc-500 transition-transform duration-200 ${customModelExpanded ? 'rotate-180' : ''}`} />
            </button>

            {customModelExpanded && (
              <div className="mt-3 border border-white/10 rounded-xl bg-[#141414] p-5 space-y-4 animate-[fadeIn_150ms_ease-out]">
                <p className="text-[12px] text-zinc-500">Add an unlisted model and define the reasoning choices Willow should show.</p>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    value={customModelDraft.name}
                    onChange={(event) => setCustomModelDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Display name"
                    className="bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 text-[13px] text-white focus:outline-none focus:border-white/20"
                  />
                  <input
                    value={customModelDraft.modelId}
                    onChange={(event) => setCustomModelDraft((current) => ({ ...current, modelId: event.target.value }))}
                    placeholder="Model ID"
                    className="bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 text-[13px] text-white font-mono focus:outline-none focus:border-white/20"
                  />
                  <input
                    value={customModelDraft.capabilities}
                    onChange={(event) => setCustomModelDraft((current) => ({ ...current, capabilities: event.target.value }))}
                    placeholder="text, vision, tools"
                    className="col-span-2 bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3 text-[13px] text-white focus:outline-none focus:border-white/20"
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[12px] font-semibold text-zinc-300">Reasoning efforts</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">These choices appear under the model in Willow's selector.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCustomReasoningEfforts((current) => [
                        ...current,
                        { id: `effort-${Date.now().toString(36)}`, level: String(current.length), label: '', value: '' },
                      ])}
                      className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:bg-white/5"
                      title="Add reasoning effort"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {customReasoningEfforts.map((effort) => (
                      <div key={effort.id} className="grid grid-cols-[72px_1fr_1fr_40px] gap-2">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          aria-label="Reasoning level"
                          value={effort.level}
                          onChange={(event) => setCustomReasoningEfforts((current) => current.map((candidate) => candidate.id === effort.id
                            ? { ...candidate, level: event.target.value }
                            : candidate))}
                          className="min-w-0 bg-[#1c1c1c] border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white focus:outline-none focus:border-white/20"
                          placeholder="Level"
                        />
                        <input
                          aria-label="Reasoning label"
                          value={effort.label}
                          onChange={(event) => setCustomReasoningEfforts((current) => current.map((candidate) => candidate.id === effort.id
                            ? { ...candidate, label: event.target.value }
                            : candidate))}
                          className="min-w-0 bg-[#1c1c1c] border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white focus:outline-none focus:border-white/20"
                          placeholder="Label"
                        />
                        <input
                          aria-label="Provider reasoning value"
                          value={effort.value}
                          onChange={(event) => setCustomReasoningEfforts((current) => current.map((candidate) => candidate.id === effort.id
                            ? { ...candidate, value: event.target.value }
                            : candidate))}
                          className="min-w-0 bg-[#1c1c1c] border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white font-mono focus:outline-none focus:border-white/20"
                          placeholder="API value"
                        />
                        <button
                          type="button"
                          onClick={() => setCustomReasoningEfforts((current) => current.filter((candidate) => candidate.id !== effort.id))}
                          disabled={customReasoningEfforts.length === 1}
                          className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-500 hover:text-red-400 hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none"
                          title="Remove reasoning effort"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addCustomModel}
                  disabled={!customModelDraft.name.trim() || !customModelDraft.modelId.trim()}
                  className="flex items-center gap-2 rounded-xl bg-white text-black px-4 py-2.5 text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={16} /> Add to model catalog
                </button>
              </div>
            )}
          </div>

          {/* Unified Global Models List */}
          <div className="mt-8 pt-8">
            <div className="h-[12px] w-full text-white/10 mb-8 overflow-hidden">
              <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <pattern id="wave-pattern-2" width="32" height="12" patternUnits="userSpaceOnUse">
                    <path 
                      d="M 0 6 C 4 2, 12 2, 16 6 C 20 10, 28 10, 32 6" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="1.5" 
                      strokeLinecap="round" 
                    />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#wave-pattern-2)" />
              </svg>
            </div>
            <h2 className="text-[14px] font-bold text-zinc-400 uppercase tracking-widest mb-4">Models:</h2>
            <div className="space-y-4">
              {catalogModels.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-white/10 rounded-2xl text-zinc-500 text-[13px]">
                  No model presets configured yet. Add one above to get started.
                </div>
              ) : (
                catalogModels.map((saved) => {
                  const modelKey = getModelCatalogKey(saved);
                  return (
                  <div
                    key={modelKey}
                    onDragEnter={() => draggedModelKey && setDragOverModelKey(modelKey)}
                    onDragOver={(event) => {
                      if (!draggedModelKey) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceKey = draggedModelKey || event.dataTransfer.getData('text/plain');
                      if (sourceKey) reorderCatalogModel(sourceKey, modelKey);
                      setDraggedModelKey(null);
                      setDragOverModelKey(null);
                    }}
                    className={`group relative bg-[#1c1c1c] border rounded-xl px-5 py-4 flex items-center justify-between transition-all hover:bg-white/5 shadow-sm ${
                      dragOverModelKey === modelKey && draggedModelKey !== modelKey
                        ? 'border-white/35 translate-y-[1px]'
                        : 'border-white/10'
                    } ${draggedModelKey === modelKey ? 'opacity-55' : ''}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={saved.provider === 'gemini' ? "text-[#fbbf24]" : "text-white"}>
                        {saved.provider === 'gemini' && (
                          <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor">
                            <path d="M256 0C256 0 292 200 512 256C292 312 256 512 256 512C256 512 220 312 0 256C220 200 256 0 256 0Z"/>
                          </svg>
                        )}
                        {saved.provider === 'openai' && (
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>
                        )}
                        {saved.provider === 'anthropic' && (
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                            <path d="M16.9 18.9h-1.9l-3.9-10.4h-0.1l-3.9 10.4h-1.9l5-12.8h1.7L16.9 18.9z M9.2 13h5.7L12 5.5h-0.1L9.2 13z" />
                          </svg>
                        )}
                        {saved.provider === 'moonshot' && (
                          <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className="w-6 h-6 text-white">
                            <path d="M1.052 16.916l9.539 2.552a21.007 21.007 0 00.06 2.033l5.956 1.593a11.997 11.997 0 01-5.586.865l-.18-.016-.044-.004-.084-.009-.094-.01a11.605 11.605 0 01-.157-.02l-.107-.014-.11-.016a11.962 11.962 0 01-.32-.051l-.042-.008-.075-.013-.107-.02-.07-.015-.093-.019-.075-.016-.095-.02-.097-.023-.094-.022-.068-.017-.088-.022-.09-.024-.095-.025-.082-.023-.109-.03-.062-.02-.084-.025-.093-.028-.105-.034-.058-.019-.08-.026-.09-.031-.066-.024a6.293 6.293 0 01-.044-.015l-.068-.025-.101-.037-.057-.022-.08-.03-.087-.035-.088-.035-.079-.032-.095-.04-.063-.028-.063-.027a5.655 5.655 0 01-.041-.018l-.066-.03-.103-.047-.052-.024-.096-.046-.062-.03-.084-.04-.086-.044-.093-.047-.052-.027-.103-.055-.057-.03-.058-.032a6.49 6.49 0 01-.046-.026l-.094-.053-.06-.034-.051-.03-.072-.041-.082-.05-.093-.056-.052-.032-.084-.053-.061-.039-.079-.05-.07-.047-.053-.035a7.785 7.785 0 01-.054-.036l-.044-.03-.044-.03a6.066 6.066 0 01-.04-.028l-.057-.04-.076-.054-.069-.05-.074-.054-.056-.042-.076-.057-.076-.059-.086-.067-.045-.035-.064-.052-.074-.06-.089-.073-.046-.039-.046-.039a7.516 7.516 0 01-.043-.037l-.045-.04-.061-.053-.07-.062-.068-.06-.062-.058-.067-.062-.053-.05-.088-.084a13.28 13.28 0 01-.099-.097l-.029-.028-.041-.042-.069-.07-.05-.051-.05-.053a6.457 6.457 0 01-.168-.179l-.08-.088-.062-.07-.071-.08-.042-.049-.053-.062-.058-.068-.046-.056a7.175 7.175 0 01-.027-.033l-.045-.055-.066-.082-.041-.052-.05-.064-.02-.025a11.99 11.99 0 01-1.44-2.402zm-1.02-5.794l11.353 3.037a20.468 20.468 0 00-.469 2.011l10.817 2.894a12.076 12.076 0 01-1.845 2.005L.657 15.923l-.016-.046-.035-.104a11.965 11.965 0 01-.05-.153l-.007-.023a11.896 11.896 0 01-.207-.741l-.03-.126-.018-.08-.021-.097-.018-.081-.018-.09-.017-.084-.018-.094c-.026-.141-.05-.283-.071-.426l-.017-.118-.011-.083-.013-.102a12.01 12.01 0 01-.019-.161l-.005-.047a12.12 12.12 0 01-.034-2.145zm1.593-5.15l11.948 3.196c-.368.605-.705 1.231-1.01 1.875l11.295 3.022c-.142.82-.368 1.612-.668 2.365l-11.55-3.09L.124 10.26l.015-.1.008-.049.01-.067.015-.087.018-.098c.026-.148.056-.295.088-.442l.028-.124.02-.085.024-.097c.022-.09.045-.18.07-.268l.028-.102.023-.083.03-.1.025-.082.03-.096.026-.082.031-.095a11.896 11.896 0 011.01-2.232zm4.442-4.4L17.352 4.59a20.77 20.77 0 00-1.688 1.721l7.823 2.093c.267.852.442 1.744.513 2.665L2.106 5.213l.045-.065.027-.04.04-.055.046-.065.055-.076.054-.072.064-.086.05-.065.057-.073.055-.07.06-.074.055-.069.065-.077.054-.066.066-.077.053-.06.072-.082.053-.06.067-.074.054-.058.073-.078.058-.06.063-.067.168-.17.1-.098.059-.056.076-.071a12.084 12.084 0 012.272-1.677zM12.017 0h.097l.082.001.069.001.054.002.068.002.046.001.076.003.047.002.06.003.054.002.087.005.105.007.144.011.088.007.044.004.077.008.082.008.047.005.102.012.05.006.108.014.081.01.042.006.065.01.207.032.07.012.065.011.14.026.092.018.11.022.046.01.075.016.041.01L14.7.3l.042.01.065.015.049.012.071.017.096.024.112.03.113.03.113.032.05.015.07.02.078.024.073.023.05.016.05.016.076.025.099.033.102.036.048.017.064.023.093.034.11.041.116.045.1.04.047.02.06.024.041.018.063.026.04.018.057.025.11.048.1.046.074.035.075.036.06.028.092.046.091.045.102.052.053.028.049.026.046.024.06.033.041.022.052.029.088.05.106.06.087.051.057.034.053.032.096.059.088.055.098.062.036.024.064.041.084.056.04.027.062.042.062.043.023.017c.054.037.108.075.161.114l.083.06.065.048.056.043.086.065.082.064.04.03.05.041.086.069.079.065.085.071c.712.6 1.353 1.283 1.909 2.031L7.222.994l.062-.027.065-.028.081-.034.086-.035c.113-.045.227-.09.341-.131l.096-.035.093-.033.084-.03.096-.031c.087-.03.176-.058.264-.085l.091-.027.086-.025.102-.03.085-.023.1-.026L9.04.37l.09-.023.091-.022.095-.022.09-.02.098-.021.091-.02.095-.018.092-.018.1-.018.091-.016.098-.017.092-.014.097-.015.092-.013.102-.013.091-.012.105-.012.09-.01.105-.01c.093-.01.186-.018.28-.024l.106-.008.09-.005.11-.006.093-.004.1-.004.097-.002.099-.002.197-.002z" />
                          </svg>
                        )}
                        {saved.provider === 'spacexai' && (
                          <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className="w-6 h-6 text-white">
                            <path d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z" />
                          </svg>
                        )}
                        {saved.provider === 'zhipuai' && (
                          <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className="w-6 h-6 text-white">
                            <path d="M11.991 23.503a.24.24 0 00-.244.248.24.24 0 00.244.249.24.24 0 00.245-.249.24.24 0 00-.22-.247l-.025-.001zM9.671 5.365a1.697 1.697 0 011.099 2.132l-.071.172-.016.04-.018.054c-.07.16-.104.32-.104.498-.035.71.47 1.279 1.186 1.314h.366c1.309.053 2.338 1.173 2.286 2.523-.052 1.332-1.152 2.38-2.478 2.327h-.174c-.715.018-1.274.64-1.239 1.368 0 .124.018.23.053.337.209.373.54.658.96.8.75.23 1.517-.125 1.9-.782l.018-.035c.402-.64 1.17-.96 1.92-.711.854.284 1.378 1.226 1.099 2.167a1.661 1.661 0 01-2.077 1.102 1.711 1.711 0 01-.907-.711l-.017-.035c-.2-.323-.463-.58-.851-.711l-.056-.018a1.646 1.646 0 00-1.954.746 1.66 1.66 0 01-1.065.764 1.677 1.677 0 01-1.989-1.279c-.209-.906.332-1.83 1.257-2.043a1.51 1.51 0 01.296-.035h.018c.68-.071 1.151-.622 1.116-1.333a1.307 1.307 0 00-.227-.693 2.515 2.515 0 01-.366-1.403 2.39 2.39 0 01.366-1.208c.14-.195.21-.444.227-.693.018-.71-.506-1.261-1.186-1.332l-.07-.018a1.43 1.43 0 01-.299-.07l-.05-.019a1.7 1.7 0 01-1.047-2.114 1.68 1.68 0 012.094-1.101zm-5.575 10.11c.26-.264.639-.367.994-.27.355.096.633.379.728.74.095.362-.007.748-.267 1.013-.402.41-1.053.41-1.455 0a1.062 1.062 0 010-1.482zm14.845-.294c.359-.09.738.024.992.297.254.274.344.665.237 1.025-.107.36-.396.634-.756.718-.551.128-1.1-.22-1.23-.781a1.05 1.05 0 01.757-1.26zm-.064-4.39c.314.32.49.753.49 1.206 0 .452-.176.886-.49 1.206-.315.32-.74.5-1.185.5-.444 0-.87-.18-1.184-.5a1.727 1.727 0 010-2.412 1.654 1.654 0 012.369 0zm-11.243.163c.364.484.447 1.128.218 1.691a1.665 1.665 0 01-2.188.923c-.855-.36-1.26-1.358-.907-2.228a1.68 1.68 0 011.33-1.038c.593-.08 1.183.169 1.547.652zm11.545-4.221c.368 0 .708.2.892.524.184.324.184.724 0 1.048a1.026 1.026 0 01-.892.524c-.568 0-1.03-.47-1.03-1.048 0-.579.462-1.048 1.03-1.048zm-14.358 0c.368 0 .707.2.891.524.184.324.184.724 0 1.048a1.026 1.026 0 01-.891.524c-.569 0-1.03-.47-1.03-1.048 0-.579.461-1.048 1.03-1.048zm10.031-1.475c.925 0 1.675.764 1.675 1.706s-.75 1.705-1.675 1.705-1.674-.763-1.674-1.705c0-.942.75-1.706 1.674-1.706zm-2.626-.684c.362-.082.653-.356.761-.718a1.062 1.062 0 00-.238-1.028 1.017 1.017 0 00-.996-.294c-.547.14-.881.7-.752 1.257.13.558.675.907 1.225.783zm0 16.876c.359-.087.644-.36.75-.72a1.062 1.062 0 00-.237-1.019 1.018 1.018 0 00-.985-.301 1.037 1.037 0 00-.762.717c-.108.361-.017.754.239 1.028.245.263.606.377.953.305l.043-.01zM17.19 3.5a.631.631 0 00.628-.64c0-.355-.279-.64-.628-.64a.631.631 0 00-.628.64c0 .355.28.64.628.64zm-10.38 0a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64a.631.631 0 00-.628.64c0 .355.279.64.628.64zm-5.182 7.852a.631.631 0 00-.628.64c0 .354.28.639.628.639a.63.63 0 00.627-.606l.001-.034a.62.62 0 00-.628-.64zm5.182 9.13a.631.631 0 00-.628.64c0 .355.279.64.628.64a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64zm10.38.018a.631.631 0 00-.628.64c0 .355.28.64.628.64a.631.631 0 00.628-.64c0-.355-.279-.64-.628-.64zm5.182-9.148a.631.631 0 00-.628.64c0 .354.279.639.628.639a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64zm-.384-4.992a.24.24 0 00.244-.249.24.24 0 00-.244-.249.24.24 0 00-.244.249c0 .142.122.249.244.249zM11.991.497a.24.24 0 00.245-.248A.24.24 0 0011.99 0a.24.24 0 00-.244.249c0 .133.108.236.223.247l.021.001zM2.011 6.36a.24.24 0 00.245-.249.24.24 0 00-.244-.249.24.24 0 00-.244.249.24.24 0 00.244.249zm0 11.263a.24.24 0 00-.243.248.24.24 0 00.244.249.24.24 0 00.244-.249.252.252 0 00-.244-.248zm19.995-.018a.24.24 0 00-.245.248.24.24 0 00.245.25.24.24 0 00.244-.25.252.252 0 00-.244-.248z" />
                          </svg>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[14px] font-semibold text-white">{saved.name}</span>
                        <span className="text-[11px] font-medium text-zinc-500 uppercase">
                          {saved.provider === 'gemini' ? 'Google' : saved.provider === 'openai' ? 'OpenAI' : saved.provider === 'anthropic' ? 'Anthropic' : saved.provider === 'moonshot' ? 'Moonshot AI' : saved.provider === 'spacexai' ? 'SpaceXAI' : 'Zhipu AI'}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[13px] font-mono font-medium text-zinc-300">
                        <ModelCategoryIcon modelId={saved.modelId} size={13} className="text-zinc-400" />
                        <span>{getModelPricing(saved.modelId, saved.provider)}</span>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setModelConfig((prev: any) => {
                            const provider = saved.provider;
                            return {
                              ...prev,
                              modelOrder: (prev.modelOrder || []).filter((key: string) => key !== modelKey),
                              [provider]: {
                                ...prev[provider],
                                savedModels: prev[provider].savedModels.filter((m: any) => m.id !== saved.id)
                              }
                            };
                          });
                        }}
                        className="p-2 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded-full hover:bg-white/5 cursor-pointer"
                      >
                        <X size={18} />
                      </button>
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', modelKey);
                          setDraggedModelKey(modelKey);
                          setDragOverModelKey(modelKey);
                        }}
                        onDragEnd={() => {
                          setDraggedModelKey(null);
                          setDragOverModelKey(null);
                        }}
                        className="p-2 -mr-2 text-zinc-500 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-white hover:bg-white/5 rounded-lg cursor-grab active:cursor-grabbing transition-all"
                        title="Reorder model"
                        aria-label={`Reorder ${saved.name}`}
                      >
                        <GripVertical size={19} />
                      </button>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      
      </div>
    ) : (
      // Overview Mode
      <div className={`space-y-10 ${wasManagingKeys ? 'animate-[fadeIn_150ms_ease-out]' : ''}`}>
        {/* Provider Cards with Horizontal Pagination Wrapper */}
        <div className="relative">
          <div className="grid grid-cols-3 gap-4">
            {providerPage === 1 ? (
              <>
                {/* Gemini Card */}
                <div 
                  className={`
                    relative rounded-2xl p-5 border cursor-pointer group
                    bg-gradient-to-b from-[#1c1c1c] to-[#141414]
                    ${providerState.gemini.apiKey ? 'border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 hover:border-white/10'}
                  `}
                  onClick={() => setManagingProvider('gemini')}
                >
                  <div className="flex items-start justify-between mb-8">
                    <div className="w-10 h-10 rounded-xl bg-black border border-white/10 flex items-center justify-center text-white shadow-lg">
                      <svg width="24" height="24" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                        <path d="M256 0C256 0 292 200 512 256C292 312 256 512 256 512C256 512 220 312 0 256C220 200 256 0 256 0Z"/>
                      </svg>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setManagingProvider('gemini'); }}
                      className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors border border-white/5"
                    >
                      Manage
                    </button>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-[16px] font-bold text-white group-hover:text-zinc-200 transition-colors">Google Gemini</h3>
                    <p className="text-[12px] text-zinc-500">
                      {providerState.gemini.apiKey ? 'Configured' : 'Not configured'}
                    </p>
                  </div>
                  {providerState.gemini.apiKey && (
                    <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent" />
                  )}
                </div>

                {/* OpenAI Card */}
                <div 
                  className={`
                    relative rounded-2xl p-5 border cursor-pointer group
                    bg-gradient-to-b from-[#1c1c1c] to-[#141414]
                    ${providerState.openai.apiKey ? 'border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 hover:border-white/10'}
                  `}
                  onClick={() => setManagingProvider('openai')}
                >
                  <div className="flex items-start justify-between mb-8">
                    <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center text-white border border-white/10 shadow-lg">
                         <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setManagingProvider('openai'); }}
                      className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors border border-white/5"
                    >
                      Manage
                    </button>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-[16px] font-bold text-white group-hover:text-zinc-200 transition-colors">OpenAI</h3>
                    <p className="text-[12px] text-zinc-500">
                      {providerState.openai.apiKey ? 'Configured' : 'Not configured'}
                    </p>
                  </div>
                  {providerState.openai.apiKey && (
                    <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent" />
                  )}
                </div>

                {/* Anthropic Card */}
                <div 
                  className={`
                    relative rounded-2xl p-5 border cursor-pointer group
                    bg-gradient-to-b from-[#1c1c1c] to-[#141414]
                    ${providerState.anthropic.apiKey ? 'border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 hover:border-white/10'}
                  `}
                  onClick={() => setManagingProvider('anthropic')}
                >
                  <div className="flex items-start justify-between mb-8">
                    <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center text-white border border-white/10 shadow-lg">
                      <svg viewBox="0 0 512 509.64" fill="currentColor" className="w-6 h-6">
                        <path fillRule="nonzero" d="M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474-.101.102.024.101z"/>
                      </svg>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setManagingProvider('anthropic'); }}
                      className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors border border-white/5"
                    >
                      Manage
                    </button>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-[16px] font-bold text-white group-hover:text-zinc-200 transition-colors">Anthropic</h3>
                    <p className="text-[12px] text-zinc-500">
                      {providerState.anthropic.apiKey ? 'Configured' : 'Not configured'}
                    </p>
                  </div>
                  {providerState.anthropic.apiKey && (
                    <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent" />
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Moonshot Card */}
                <div 
                  className={`
                    relative rounded-2xl p-5 border cursor-pointer group
                    bg-gradient-to-b from-[#1c1c1c] to-[#141414]
                    ${providerState.moonshot?.apiKey ? 'border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 hover:border-white/10'}
                  `}
                  onClick={() => setManagingProvider('moonshot')}
                >
                  <div className="flex items-start justify-between mb-8">
                    <div className="w-10 h-10 rounded-xl bg-black border border-white/10 flex items-center justify-center text-white shadow-lg">
                      <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className="w-6 h-6">
                        <path d="M1.052 16.916l9.539 2.552a21.007 21.007 0 00.06 2.033l5.956 1.593a11.997 11.997 0 01-5.586.865l-.18-.016-.044-.004-.084-.009-.094-.01a11.605 11.605 0 01-.157-.02l-.107-.014-.11-.016a11.962 11.962 0 01-.32-.051l-.042-.008-.075-.013-.107-.02-.07-.015-.093-.019-.075-.016-.095-.02-.097-.023-.094-.022-.068-.017-.088-.022-.09-.024-.095-.025-.082-.023-.109-.03-.062-.02-.084-.025-.093-.028-.105-.034-.058-.019-.08-.026-.09-.031-.066-.024a6.293 6.293 0 01-.044-.015l-.068-.025-.101-.037-.057-.022-.08-.03-.087-.035-.088-.035-.079-.032-.095-.04-.063-.028-.063-.027a5.655 5.655 0 01-.041-.018l-.066-.03-.103-.047-.052-.024-.096-.046-.062-.03-.084-.04-.086-.044-.093-.047-.052-.027-.103-.055-.057-.03-.058-.032a6.49 6.49 0 01-.046-.026l-.094-.053-.06-.034-.051-.03-.072-.041-.082-.05-.093-.056-.052-.032-.084-.053-.061-.039-.079-.05-.07-.047-.053-.035a7.785 7.785 0 01-.054-.036l-.044-.03-.044-.03a6.066 6.066 0 01-.04-.028l-.057-.04-.076-.054-.069-.05-.074-.054-.056-.042-.076-.057-.076-.059-.086-.067-.045-.035-.064-.052-.074-.06-.089-.073-.046-.039-.046-.039a7.516 7.516 0 01-.043-.037l-.045-.04-.061-.053-.07-.062-.068-.06-.062-.058-.067-.062-.053-.05-.088-.084a13.28 13.28 0 01-.099-.097l-.029-.028-.041-.042-.069-.07-.05-.051-.05-.053a6.457 6.457 0 01-.168-.179l-.08-.088-.062-.07-.071-.08-.042-.049-.053-.062-.058-.068-.046-.056a7.175 7.175 0 01-.027-.033l-.045-.055-.066-.082-.041-.052-.05-.064-.02-.025a11.99 11.99 0 01-1.44-2.402zm-1.02-5.794l11.353 3.037a20.468 20.468 0 00-.469 2.011l10.817 2.894a12.076 12.076 0 01-1.845 2.005L.657 15.923l-.016-.046-.035-.104a11.965 11.965 0 01-.05-.153l-.007-.023a11.896 11.896 0 01-.207-.741l-.03-.126-.018-.08-.021-.097-.018-.081-.018-.09-.017-.084-.018-.094c-.026-.141-.05-.283-.071-.426l-.017-.118-.011-.083-.013-.102a12.01 12.01 0 01-.019-.161l-.005-.047a12.12 12.12 0 01-.034-2.145zm1.593-5.15l11.948 3.196c-.368.605-.705 1.231-1.01 1.875l11.295 3.022c-.142.82-.368 1.612-.668 2.365l-11.55-3.09L.124 10.26l.015-.1.008-.049.01-.067.015-.087.018-.098c.026-.148.056-.295.088-.442l.028-.124.02-.085.024-.097c.022-.09.045-.18.07-.268l.028-.102.023-.083.03-.1.025-.082.03-.096.026-.082.031-.095a11.896 11.896 0 011.01-2.232zm4.442-4.4L17.352 4.59a20.77 20.77 0 00-1.688 1.721l7.823 2.093c.267.852.442 1.744.513 2.665L2.106 5.213l.045-.065.027-.04.04-.055.046-.065.055-.076.054-.072.064-.086.05-.065.057-.073.055-.07.06-.074.055-.069.065-.077.054-.066.066-.077.053-.06.072-.082.053-.06.067-.074.054-.058.073-.078.058-.06.063-.067.168-.17.1-.098.059-.056.076-.071a12.084 12.084 0 012.272-1.677zM12.017 0h.097l.082.001.069.001.054.002.068.002.046.001.076.003.047.002.06.003.054.002.087.005.105.007.144.011.088.007.044.004.077.008.082.008.047.005.102.012.05.006.108.014.081.01.042.006.065.01.207.032.07.012.065.011.14.026.092.018.11.022.046.01.075.016.041.01L14.7.3l.042.01.065.015.049.012.071.017.096.024.112.03.113.03.113.032.05.015.07.02.078.024.073.023.05.016.05.016.076.025.099.033.102.036.048.017.064.023.093.034.11.041.116.045.1.04.047.02.06.024.041.018.063.026.04.018.057.025.11.048.1.046.074.035.075.036.06.028.092.046.091.045.102.052.053.028.049.026.046.024.06.033.041.022.052.029.088.05.106.06.087.051.057.034.053.032.096.059.088.055.098.062.036.024.064.041.084.056.04.027.062.042.062.043.023.017c.054.037.108.075.161.114l.083.06.065.048.056.043.086.065.082.064.04.03.05.041.086.069.079.065.085.071c.712.6 1.353 1.283 1.909 2.031L7.222.994l.062-.027.065-.028.081-.034.086-.035c.113-.045.227-.09.341-.131l.096-.035.093-.033.084-.03.096-.031c.087-.03.176-.058.264-.085l.091-.027.086-.025.102-.03.085-.023.1-.026L9.04.37l.09-.023.091-.022.095-.022.09-.02.098-.021.091-.02.095-.018.092-.018.1-.018.091-.016.098-.017.092-.014.097-.015.092-.013.102-.013.091-.012.105-.012.09-.01.105-.01c.093-.01.186-.018.28-.024l.106-.008.09-.005.11-.006.093-.004.1-.004.097-.002.099-.002.197-.002z" />
                      </svg>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setManagingProvider('moonshot'); }}
                      className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors border border-white/5"
                    >
                      Manage
                    </button>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-[16px] font-bold text-white group-hover:text-zinc-200 transition-colors">Moonshot AI</h3>
                    <p className="text-[12px] text-zinc-500">
                      {providerState.moonshot?.apiKey ? 'Configured' : 'Not configured'}
                    </p>
                  </div>
                  {providerState.moonshot?.apiKey && (
                    <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent" />
                  )}
                </div>

                {/* SpaceXAI Card */}
                <div 
                  className={`
                    relative rounded-2xl p-5 border cursor-pointer group
                    bg-gradient-to-b from-[#1c1c1c] to-[#141414]
                    ${providerState.spacexai?.apiKey ? 'border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 hover:border-white/10'}
                  `}
                  onClick={() => setManagingProvider('spacexai')}
                >
                  <div className="flex items-start justify-between mb-8">
                    <div className="w-10 h-10 rounded-xl bg-black border border-white/10 flex items-center justify-center text-white shadow-lg">
                      <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className="w-6 h-6">
                        <path d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z" />
                      </svg>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setManagingProvider('spacexai'); }}
                      className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors border border-white/5"
                    >
                      Manage
                    </button>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-[16px] font-bold text-white group-hover:text-zinc-200 transition-colors">SpaceXAI</h3>
                    <p className="text-[12px] text-zinc-500">
                      {providerState.spacexai?.apiKey ? 'Configured' : 'Not configured'}
                    </p>
                  </div>
                  {providerState.spacexai?.apiKey && (
                    <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent" />
                  )}
                </div>

                {/* Zhipu AI Card */}
                <div 
                  className={`
                    relative rounded-2xl p-5 border cursor-pointer group
                    bg-gradient-to-b from-[#1c1c1c] to-[#141414]
                    ${providerState.zhipuai?.apiKey ? 'border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.05)]' : 'border-white/5 hover:border-white/10'}
                  `}
                  onClick={() => setManagingProvider('zhipuai')}
                >
                  <div className="flex items-start justify-between mb-8">
                    <div className="w-10 h-10 rounded-xl bg-black border border-white/10 flex items-center justify-center text-white shadow-lg">
                      <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className="w-6 h-6">
                        <path d="M11.991 23.503a.24.24 0 00-.244.248.24.24 0 00.244.249.24.24 0 00.245-.249.24.24 0 00-.22-.247l-.025-.001zM9.671 5.365a1.697 1.697 0 011.099 2.132l-.071.172-.016.04-.018.054c-.07.16-.104.32-.104.498-.035.71.47 1.279 1.186 1.314h.366c1.309.053 2.338 1.173 2.286 2.523-.052 1.332-1.152 2.38-2.478 2.327h-.174c-.715.018-1.274.64-1.239 1.368 0 .124.018.23.053.337.209.373.54.658.96.8.75.23 1.517-.125 1.9-.782l.018-.035c.402-.64 1.17-.96 1.92-.711.854.284 1.378 1.226 1.099 2.167a1.661 1.661 0 01-2.077 1.102 1.711 1.711 0 01-.907-.711l-.017-.035c-.2-.323-.463-.58-.851-.711l-.056-.018a1.646 1.646 0 00-1.954.746 1.66 1.66 0 01-1.065.764 1.677 1.677 0 01-1.989-1.279c-.209-.906.332-1.83 1.257-2.043a1.51 1.51 0 01.296-.035h.018c.68-.071 1.151-.622 1.116-1.333a1.307 1.307 0 00-.227-.693 2.515 2.515 0 01-.366-1.403 2.39 2.39 0 01.366-1.208c.14-.195.21-.444.227-.693.018-.71-.506-1.261-1.186-1.332l-.07-.018a1.43 1.43 0 01-.299-.07l-.05-.019a1.7 1.7 0 01-1.047-2.114 1.68 1.68 0 012.094-1.101zm-5.575 10.11c.26-.264.639-.367.994-.27.355.096.633.379.728.74.095.362-.007.748-.267 1.013-.402.41-1.053.41-1.455 0a1.062 1.062 0 010-1.482zm14.845-.294c.359-.09.738.024.992.297.254.274.344.665.237 1.025-.107.36-.396.634-.756.718-.551.128-1.1-.22-1.23-.781a1.05 1.05 0 01.757-1.26zm-.064-4.39c.314.32.49.753.49 1.206 0 .452-.176.886-.49 1.206-.315.32-.74.5-1.185.5-.444 0-.87-.18-1.184-.5a1.727 1.727 0 010-2.412 1.654 1.654 0 012.369 0zm-11.243.163c.364.484.447 1.128.218 1.691a1.665 1.665 0 01-2.188.923c-.855-.36-1.26-1.358-.907-2.228a1.68 1.68 0 011.33-1.038c.593-.08 1.183.169 1.547.652zm11.545-4.221c.368 0 .708.2.892.524.184.324.184.724 0 1.048a1.026 1.026 0 01-.892.524c-.568 0-1.03-.47-1.03-1.048 0-.579.462-1.048 1.03-1.048zm-14.358 0c.368 0 .707.2.891.524.184.324.184.724 0 1.048a1.026 1.026 0 01-.891.524c-.569 0-1.03-.47-1.03-1.048 0-.579.461-1.048 1.03-1.048zm10.031-1.475c.925 0 1.675.764 1.675 1.706s-.75 1.705-1.675 1.705-1.674-.763-1.674-1.706zm-2.626-.684c.362-.082.653-.356.761-.718a1.062 1.062 0 00-.238-1.028 1.017 1.017 0 00-.996-.294c-.547.14-.881.7-.752 1.257.13.558.675.907 1.225.783zm0 16.876c.359-.087.644-.36.75-.72a1.062 1.062 0 00-.237-1.019 1.018 1.018 0 00-.985-.301 1.037 1.037 0 00-.762.717c-.108.361-.017.754.239 1.028.245.263.606.377.953.305l.043-.01zM17.19 3.5a.631.631 0 00.628-.64c0-.355-.279-.64-.628-.64a.631.631 0 00-.628.64c0 .355.28.64.628.64zm-10.38 0a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64a.631.631 0 00-.628.64c0 .355.279.64.628.64zm-5.182 7.852a.631.631 0 00-.628.64c0 .354.28.639.628.639a.63.63 0 00.627-.606l.001-.034a.62.62 0 00-.628-.64zm5.182 9.13a.631.631 0 00-.628.64c0 .355.279.64.628.64a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64zm10.38.018a.631.631 0 00-.628.64c0 .355.28.64.628.64a.631.631 0 00.628-.64c0-.355-.279-.64-.628-.64zm5.182-9.148a.631.631 0 00-.628.64c0 .354.279.639.628.639a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64zm-.384-4.992a.24.24 0 00.244-.249.24.24 0 00-.244-.249.24.24 0 00-.244.249c0 .142.122.249.244.249zM11.991.497a.24.24 0 00.245-.248A.24.24 0 0011.99 0a.24.24 0 00-.244.249c0 .133.108.236.223.247l.021.001zM2.011 6.36a.24.24 0 00.245-.249.24.24 0 00-.244-.249.24.24 0 00-.244.249.24.24 0 00.244.249zm0 11.263a.24.24 0 00-.243.248.24.24 0 00.244.249.24.24 0 00.244-.249.252.252 0 00-.244-.248zm19.995-.018a.24.24 0 00-.245.248.24.24 0 00.245.25.24.24 0 00.244-.25.252.252 0 00-.244-.248z" />
                      </svg>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setManagingProvider('zhipuai'); }}
                      className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors border border-white/5"
                    >
                      Manage
                    </button>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-[16px] font-bold text-white group-hover:text-zinc-200 transition-colors">Zhipu AI</h3>
                    <p className="text-[12px] text-zinc-500">
                      {providerState.zhipuai?.apiKey ? 'Configured' : 'Not configured'}
                    </p>
                  </div>
                  {providerState.zhipuai?.apiKey && (
                    <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-white to-transparent" />
                  )}
                </div>
              </>
            )}
          </div>

          {/* Apple-Style Pagination Switcher Controls */}
          <div className="absolute top-[calc(100%_+_20px)] right-0 flex items-center gap-2 z-10">
            <button
              onClick={() => setProviderPage(1)}
              disabled={providerPage === 1}
              className={`p-1.5 rounded-full border transition-all ${
                providerPage === 1
                  ? 'border-white/5 text-zinc-600 cursor-not-allowed'
                  : 'border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 hover:border-white/20'
              }`}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setProviderPage(2)}
              disabled={providerPage === 2}
              className={`p-1.5 rounded-full border transition-all ${
                providerPage === 2
                  ? 'border-white/5 text-zinc-600 cursor-not-allowed'
                  : 'border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 hover:border-white/20'
              }`}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* System Default Models Section */}
        <div className="pt-8 mt-4">
          <div className="h-[12px] w-full text-white/10 mb-8 overflow-hidden">
            <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="wave-pattern-3" width="32" height="12" patternUnits="userSpaceOnUse">
                  <path 
                    d="M 0 6 C 4 2, 12 2, 16 6 C 20 10, 28 10, 32 6" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="1.5" 
                    strokeLinecap="round" 
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#wave-pattern-3)" />
            </svg>
          </div>
          <h2 className="text-[14px] font-bold text-zinc-400 uppercase tracking-widest mb-6">System Defaults</h2>
          <div className="space-y-4">
            {/* Chat Renaming Model */}
            <div className="flex items-center justify-between py-2">
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold text-white">Chat Naming Model</span>
                <span className="text-[12px] text-zinc-500">Model used to automatically generate chat titles.</span>
              </div>
              <div className="relative w-64" ref={geminiRef} data-dropdown="chat-renaming">
                <button
                  onClick={() => {
                    if (geminiDropdownOpen) closeGeminiDropdown();
                    else {
                      setGeminiDirection(determineDirection(geminiRef));
                      setGeminiDropdownOpen(true);
                    }
                  }}
                  className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                >
                  <span>
                    {[
                      ...modelConfig.gemini.savedModels,
                      ...modelConfig.openai.savedModels,
                      ...modelConfig.anthropic.savedModels
                    ].find(m => m.modelId === modelConfig.systemDefaults?.chatRenaming)?.name
                      || (modelConfig.systemDefaults?.chatRenaming === 'gemini-3.7-flash'
                        ? 'Gemini 3.7 Flash'
                        : modelConfig.systemDefaults?.chatRenaming === 'gemini-3.1-flash-lite'
                          ? 'Gemini 3.1 Flash Lite'
                          : modelConfig.systemDefaults?.chatRenaming === 'gemini-3.5-flash-lite'
                            ? 'Gemini 3.5 Flash Lite'
                            : modelConfig.systemDefaults?.chatRenaming === 'gemini-3.6-flash'
                              ? 'Gemini 3.6 Flash'
                              : modelConfig.systemDefaults?.chatRenaming)
                      || 'Select model'}
                  </span>
                  <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-200 ${geminiDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {geminiDropdownOpen && (
                  <div className={`absolute ${geminiDirection === 'up' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden ${geminiDropdownClosing ? (geminiDirection === 'up' ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (geminiDirection === 'up' ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                      {[
                        ...(providerState.gemini.apiKey ? modelConfig.gemini.savedModels.map(m => ({ ...m, provider: 'gemini' })) : []),
                        ...(providerState.openai.apiKey ? modelConfig.openai.savedModels.map(m => ({ ...m, provider: 'openai' })) : []),
                        ...(providerState.anthropic.apiKey ? modelConfig.anthropic.savedModels.map(m => ({ ...m, provider: 'anthropic' })) : []),
                        ...(providerState.moonshot?.apiKey ? (modelConfig.moonshot?.savedModels || []).map(m => ({ ...m, provider: 'moonshot' })) : []),
                        ...(providerState.spacexai?.apiKey ? (modelConfig.spacexai?.savedModels || []).map(m => ({ ...m, provider: 'spacexai' })) : []),
                        ...(providerState.zhipuai?.apiKey ? (modelConfig.zhipuai?.savedModels || []).map(m => ({ ...m, provider: 'zhipuai' })) : [])
                      ].length === 0 ? (
                        <div className="px-4 py-3 text-[13px] text-zinc-500 text-center">
                          No models saved or no API keys configured. Manage a provider above.
                        </div>
                      ) : (
                        [
                          ...(providerState.gemini.apiKey ? modelConfig.gemini.savedModels.map(m => ({ ...m, provider: 'gemini' })) : []),
                          ...(providerState.openai.apiKey ? modelConfig.openai.savedModels.map(m => ({ ...m, provider: 'openai' })) : []),
                          ...(providerState.anthropic.apiKey ? modelConfig.anthropic.savedModels.map(m => ({ ...m, provider: 'anthropic' })) : []),
                          ...(providerState.moonshot?.apiKey ? (modelConfig.moonshot?.savedModels || []).map(m => ({ ...m, provider: 'moonshot' })) : []),
                          ...(providerState.spacexai?.apiKey ? (modelConfig.spacexai?.savedModels || []).map(m => ({ ...m, provider: 'spacexai' })) : []),
                          ...(providerState.zhipuai?.apiKey ? (modelConfig.zhipuai?.savedModels || []).map(m => ({ ...m, provider: 'zhipuai' })) : [])
                        ].map((model) => (
                          <button
                            key={`${model.provider}-${model.id}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setModelConfig(prev => ({ 
                                ...prev, 
                                systemDefaults: { 
                                  ...prev.systemDefaults, 
                                  chatRenaming: model.modelId 
                                } 
                              }));
                              closeGeminiDropdown();
                            }}
                            className={`
                              w-full px-4 py-2.5 text-left text-[13px] transition-all flex items-center justify-between group
                              ${modelConfig.systemDefaults?.chatRenaming === model.modelId 
                                ? 'bg-white/10 text-white' 
                                : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                              }
                            `}
                          >
                            <span className="font-medium">{model.name}</span>
                            {modelConfig.systemDefaults?.chatRenaming === model.modelId && (
                              <Check size={14} className="text-white" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Chat Search Model */}
            <div className="flex items-center justify-between py-2">
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold text-white">Chat Search Model</span>
                <span className="text-[12px] text-zinc-500">Embedding model used to rank chat search results.</span>
              </div>
              <div
                className="relative w-64"
                ref={chatSearchRef}
                data-dropdown="chat-search-model"
              >
                <button
                  onClick={() => {
                    if (chatSearchDropdownOpen) {
                      setChatSearchDropdownOpen(false);
                    } else {
                      setChatSearchDirection(determineDirection(chatSearchRef));
                      setChatSearchDropdownOpen(true);
                    }
                  }}
                  className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                >
                  <span>{selectedChatSearchModelName}</span>
                  <ChevronDown
                    size={14}
                    className={`text-zinc-500 transition-transform duration-200 ${chatSearchDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {chatSearchDropdownOpen && (
                  <div className={`absolute ${chatSearchDirection === 'up' ? 'bottom-full mb-2 origin-bottom animate-dropdownOpenUp' : 'top-full mt-2 origin-top animate-dropdownOpen'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden`}>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                      <button
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setModelConfig((previous: any) => ({
                            ...previous,
                            systemDefaults: {
                              ...previous.systemDefaults,
                              chatSearch: 'linear',
                            },
                          }));
                          setChatSearchDropdownOpen(false);
                        }}
                        className={`w-full px-4 py-2.5 text-left text-[13px] transition-all flex items-center justify-between group ${!selectableEmbeddingModels.some((model: any) => model.modelId === modelConfig.systemDefaults?.chatSearch) ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                      >
                        <span className="font-medium">Lexical search</span>
                        {!selectableEmbeddingModels.some((model: any) => model.modelId === modelConfig.systemDefaults?.chatSearch) && (
                          <Check size={14} className="text-white" />
                        )}
                      </button>
                      {selectableEmbeddingModels.map((model: any) => (
                        <button
                          key={`${model.provider}-${model.id || model.modelId}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setModelConfig((previous: any) => ({
                              ...previous,
                              systemDefaults: {
                                ...previous.systemDefaults,
                                chatSearch: model.modelId,
                              },
                            }));
                            setChatSearchDropdownOpen(false);
                          }}
                          className={`w-full px-4 py-2.5 text-left text-[13px] transition-all flex items-center justify-between group ${modelConfig.systemDefaults?.chatSearch === model.modelId ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                        >
                          <span className="font-medium">{model.name}</span>
                          {modelConfig.systemDefaults?.chatSearch === model.modelId && (
                            <Check size={14} className="text-white" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/*
              * Notebook Source Search — the same control as Chat Search Model above,
              * deliberately, so there is one mental model for "how does Willow
              * search". Unset means term-overlap ranking over the notebook's
              * passages: no key, no cost, works offline. Choosing a model ranks by
              * meaning instead, at one embedding call per passage (cached for the
              * session) plus one per question.
              */}
            <div className="flex items-center justify-between py-2">
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold text-white">Notebook Source Search</span>
                <span className="text-[12px] text-zinc-500">How notebook sources are searched for passages to ground on.</span>
              </div>
              <div
                className="relative w-64"
                ref={notebookSearchRef}
                data-dropdown="notebook-search-model"
              >
                <button
                  onClick={() => {
                    if (notebookSearchDropdownOpen) {
                      setNotebookSearchDropdownOpen(false);
                    } else {
                      setNotebookSearchDirection(determineDirection(notebookSearchRef));
                      setNotebookSearchDropdownOpen(true);
                    }
                  }}
                  className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                >
                  <span>{selectedNotebookSearchModelName}</span>
                  <ChevronDown
                    size={14}
                    className={`text-zinc-500 transition-transform duration-200 ${notebookSearchDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {notebookSearchDropdownOpen && (
                  <div className={`absolute ${notebookSearchDirection === 'up' ? 'bottom-full mb-2 origin-bottom animate-dropdownOpenUp' : 'top-full mt-2 origin-top animate-dropdownOpen'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden`}>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                      <button
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setModelConfig((previous: any) => ({
                            ...previous,
                            systemDefaults: {
                              ...previous.systemDefaults,
                              notebookSearch: 'linear',
                            },
                          }));
                          setNotebookSearchDropdownOpen(false);
                        }}
                        className={`w-full px-4 py-2.5 text-left text-[13px] transition-all flex items-center justify-between group ${!selectableEmbeddingModels.some((model: any) => model.modelId === modelConfig.systemDefaults?.notebookSearch) ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                      >
                        <span className="font-medium">Lexical search</span>
                        {!selectableEmbeddingModels.some((model: any) => model.modelId === modelConfig.systemDefaults?.notebookSearch) && (
                          <Check size={14} className="text-white" />
                        )}
                      </button>
                      {selectableEmbeddingModels.map((model: any) => (
                        <button
                          key={`notebook-${model.provider}-${model.id || model.modelId}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setModelConfig((previous: any) => ({
                              ...previous,
                              systemDefaults: {
                                ...previous.systemDefaults,
                                notebookSearch: model.modelId,
                              },
                            }));
                            setNotebookSearchDropdownOpen(false);
                          }}
                          className={`w-full px-4 py-2.5 text-left text-[13px] transition-all flex items-center justify-between group ${modelConfig.systemDefaults?.notebookSearch === model.modelId ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                        >
                          <span className="font-medium">{model.name}</span>
                          {modelConfig.systemDefaults?.notebookSearch === model.modelId && (
                            <Check size={14} className="text-white" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Computer Use Model */}
            <div className="flex items-center justify-between py-2">
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold text-white">Computer Use Model</span>
                <span className="text-[12px] text-zinc-500">Model used for the automated test agent.</span>
              </div>
              <div className="relative w-64" ref={openaiRef} data-dropdown="computer-use">
                <button
                  onClick={() => {
                    if (openaiDropdownOpen) closeOpenaiDropdown();
                    else {
                      setOpenaiDirection(determineDirection(openaiRef));
                      setOpenaiDropdownOpen(true);
                    }
                  }}
                  className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                >
                  <span>
                    {[
                      ...modelConfig.gemini.savedModels,
                      ...modelConfig.openai.savedModels,
                      ...modelConfig.anthropic.savedModels
                    ].find(m => m.modelId === modelConfig.systemDefaults?.computerUse)?.name || (modelConfig.systemDefaults?.computerUse === 'claude-sonnet-4.5' ? 'Claude Sonnet 4.5' : modelConfig.systemDefaults?.computerUse) || 'Select model'}
                  </span>
                  <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-200 ${openaiDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {openaiDropdownOpen && (
                  <div className={`absolute ${openaiDirection === 'up' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden ${openaiDropdownClosing ? (openaiDirection === 'up' ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (openaiDirection === 'up' ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                      {[
                        ...(providerState.gemini.apiKey ? modelConfig.gemini.savedModels.map(m => ({ ...m, provider: 'gemini' })) : []),
                        ...(providerState.openai.apiKey ? modelConfig.openai.savedModels.map(m => ({ ...m, provider: 'openai' })) : []),
                        ...(providerState.anthropic.apiKey ? modelConfig.anthropic.savedModels.map(m => ({ ...m, provider: 'anthropic' })) : []),
                        ...(providerState.moonshot?.apiKey ? (modelConfig.moonshot?.savedModels || []).map(m => ({ ...m, provider: 'moonshot' })) : []),
                        ...(providerState.spacexai?.apiKey ? (modelConfig.spacexai?.savedModels || []).map(m => ({ ...m, provider: 'spacexai' })) : []),
                        ...(providerState.zhipuai?.apiKey ? (modelConfig.zhipuai?.savedModels || []).map(m => ({ ...m, provider: 'zhipuai' })) : [])
                      ].length === 0 ? (
                        <div className="px-4 py-3 text-[13px] text-zinc-500 text-center">
                          No models saved or no API keys configured. Manage a provider above.
                        </div>
                      ) : (
                        [
                          ...(providerState.gemini.apiKey ? modelConfig.gemini.savedModels.map(m => ({ ...m, provider: 'gemini' })) : []),
                          ...(providerState.openai.apiKey ? modelConfig.openai.savedModels.map(m => ({ ...m, provider: 'openai' })) : []),
                          ...(providerState.anthropic.apiKey ? modelConfig.anthropic.savedModels.map(m => ({ ...m, provider: 'anthropic' })) : []),
                          ...(providerState.moonshot?.apiKey ? (modelConfig.moonshot?.savedModels || []).map(m => ({ ...m, provider: 'moonshot' })) : []),
                          ...(providerState.spacexai?.apiKey ? (modelConfig.spacexai?.savedModels || []).map(m => ({ ...m, provider: 'spacexai' })) : []),
                          ...(providerState.zhipuai?.apiKey ? (modelConfig.zhipuai?.savedModels || []).map(m => ({ ...m, provider: 'zhipuai' })) : [])
                        ].map((model) => (
                          <button
                            key={`${model.provider}-${model.id}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setModelConfig(prev => ({ 
                                ...prev, 
                                systemDefaults: { 
                                  ...prev.systemDefaults, 
                                  computerUse: model.modelId 
                                } 
                              }));
                              closeOpenaiDropdown();
                            }}
                            className={`
                              w-full px-4 py-2.5 text-left text-[13px] transition-all flex items-center justify-between group
                              ${modelConfig.systemDefaults?.computerUse === model.modelId 
                                ? 'bg-white/10 text-white' 
                                : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                              }
                            `}
                          >
                            <span className="font-medium">{model.name}</span>
                            {modelConfig.systemDefaults?.computerUse === model.modelId && (
                              <Check size={14} className="text-white" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Voice Transcription Model */}
            <div className="flex items-center justify-between py-2">
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold text-white">Model for transcription</span>
                <span className="text-[12px] text-zinc-500">Model used to transcribe recorded voice input.</span>
              </div>
              <div
                className="relative w-64"
                ref={transcriptionRef}
                data-dropdown="transcription-model"
              >
                <button
                  onClick={() => {
                    if (transcriptionDropdownOpen) {
                      setTranscriptionDropdownOpen(false);
                    } else {
                      setTranscriptionDirection(determineDirection(transcriptionRef));
                      setTranscriptionDropdownOpen(true);
                    }
                  }}
                  className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                >
                  <span>{selectedTranscriptionModelName}</span>
                  <ChevronDown
                    size={14}
                    className={`text-zinc-500 transition-transform duration-200 ${transcriptionDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {transcriptionDropdownOpen && (
                  <div className={`absolute ${transcriptionDirection === 'up' ? 'bottom-full mb-2 origin-bottom animate-dropdownOpenUp' : 'top-full mt-2 origin-top animate-dropdownOpen'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden`}>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                      <button
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setModelConfig((previous: any) => ({
                            ...previous,
                            systemDefaults: {
                              ...previous.systemDefaults,
                              transcription: CHROME_NATIVE_TRANSCRIPTION_MODEL,
                            },
                          }));
                          setTranscriptionDropdownOpen(false);
                        }}
                        className={`w-full px-4 py-2.5 text-left transition-all flex items-center justify-between group ${modelConfig.systemDefaults?.transcription === CHROME_NATIVE_TRANSCRIPTION_MODEL ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                      >
                        <span className="flex flex-col">
                          <span className="font-medium">{CHROME_NATIVE_TRANSCRIPTION_NAME}</span>
                          <span className="text-[11px] text-zinc-500">No API key · on-device when available</span>
                        </span>
                        {modelConfig.systemDefaults?.transcription === CHROME_NATIVE_TRANSCRIPTION_MODEL && (
                          <Check size={14} className="text-white" />
                        )}
                      </button>
                      {configuredSystemDefaultModels.length === 0 ? (
                        <div className="px-4 py-3 text-[13px] text-zinc-500 text-center">
                          No API-backed models saved or no API keys configured. Manage a provider above.
                        </div>
                      ) : configuredSystemDefaultModels.map((model: any) => (
                        <button
                          key={`${model.provider}-${model.id || model.modelId}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setModelConfig((previous: any) => ({
                              ...previous,
                              systemDefaults: {
                                ...previous.systemDefaults,
                                transcription: model.modelId,
                              },
                            }));
                            setTranscriptionDropdownOpen(false);
                          }}
                          className={`w-full px-4 py-2.5 text-left text-[13px] transition-all flex items-center justify-between group ${modelConfig.systemDefaults?.transcription === model.modelId ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                        >
                          <span className="font-medium">{model.name}</span>
                          {modelConfig.systemDefaults?.transcription === model.modelId && (
                            <Check size={14} className="text-white" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Personal Intelligence Model */}
            <div className="flex items-center justify-between py-2">
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold text-white">Model for Personal Intelligence</span>
                <span className="text-[12px] text-zinc-500">Model used to build your profile from past chats. Automatic keeps this on the cheapest one you have.</span>
              </div>
              <div
                className="relative w-64"
                ref={personalRef}
                data-dropdown="personal-intelligence-model"
              >
                <button
                  onClick={() => {
                    if (personalDropdownOpen) {
                      setPersonalDropdownOpen(false);
                    } else {
                      setPersonalDirection(determineDirection(personalRef));
                      setPersonalDropdownOpen(true);
                    }
                  }}
                  className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white text-left focus:outline-none focus:border-white/25 cursor-pointer transition-all hover:border-white/20 flex items-center justify-between"
                >
                  <span>{selectedPersonalModelName}</span>
                  <ChevronDown
                    size={14}
                    className={`text-zinc-500 transition-transform duration-200 ${personalDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {personalDropdownOpen && (
                  <div className={`absolute ${personalDirection === 'up' ? 'bottom-full mb-2 origin-bottom animate-dropdownOpenUp' : 'top-full mt-2 origin-top animate-dropdownOpen'} left-0 right-0 z-50 bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden`}>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                      <button
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setModelConfig((previous: any) => ({
                            ...previous,
                            systemDefaults: {
                              ...previous.systemDefaults,
                              personalIntelligence: AUTO_MODEL,
                            },
                          }));
                          setPersonalDropdownOpen(false);
                        }}
                        className={`w-full px-4 py-2.5 text-left text-[13px] transition-all flex items-center justify-between group border-b border-white/5 ${isPersonalAutomatic ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                      >
                        <span className="flex flex-col">
                          <span className="font-medium">Automatic</span>
                          <span className="text-[11px] text-zinc-500">
                            {personalSelection?.name
                              ? `Cheapest you have — currently ${personalSelection.name}`
                              : 'Cheapest capable model you have added'}
                          </span>
                        </span>
                        {isPersonalAutomatic && <Check size={14} className="text-white shrink-0" />}
                      </button>
                      {selectablePersonalModels.length === 0 ? (
                        <div className="px-4 py-3 text-[13px] text-zinc-500 text-center">
                          No models saved or no API keys configured. Manage a provider above.
                        </div>
                      ) : selectablePersonalModels.map((model: any) => (
                        <button
                          key={`${model.provider}-${model.id || model.modelId}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setModelConfig((previous: any) => ({
                              ...previous,
                              systemDefaults: {
                                ...previous.systemDefaults,
                                personalIntelligence: model.modelId,
                              },
                            }));
                            setPersonalDropdownOpen(false);
                          }}
                          className={`w-full px-4 py-2.5 text-left text-[13px] transition-all flex items-center justify-between group ${modelConfig.systemDefaults?.personalIntelligence === model.modelId ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                        >
                          <span className="font-medium">{model.name}</span>
                          {modelConfig.systemDefaults?.personalIntelligence === model.modelId && (
                            <Check size={14} className="text-white" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
);
};
