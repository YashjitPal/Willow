import React from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  GripVertical,
  Image as ImageIcon,
  Music,
  Plus,
  Type,
  Video,
  X,
} from 'lucide-react';
import { AUTO_MODEL, resolveAutoModel } from '@willow/ai/models/auto-select';
import { useAuth } from '@willow/auth/AuthContext';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';
import { type ProviderId } from '@willow/ai/providers/endpoints';
import { DEFAULT_PROFILE_IDS, defaultApiFormatForProvider, defaultToolPolicyForProvider } from '@willow/ai/providers/profiles';
import { collectSavedModelsInCatalogOrder, getModelCatalogKey, getModelCategory, getNormalizedModelOrder } from '@willow/core/model-catalog';
import { CHROME_NATIVE_TRANSCRIPTION_MODEL, CHROME_NATIVE_TRANSCRIPTION_NAME, isLiveOnlyTranscriptionModel } from '@willow/ai/transcription';
import { useProviderSettings } from '../../use-provider-settings';
import {
  DEFAULT_CUSTOM_REASONING_EFFORTS,
  MOONSHOT_MODELS,
  PROVIDERS,
  PROVIDER_MODEL_OPTIONS,
  SPACEXAI_MODELS,
  buildSavedModel,
  getModelPricing,
  providerName,
  providerVendor,
} from '../../provider-models';
import { ProviderGlyph } from './ProviderGlyph';
import './ModelsApiPage.css';

/*
 * Models & API as a standalone page, reached from the sidebar's settings menu.
 *
 * The modal's `ModelsTab` is the other surface onto the same settings and stays
 * exactly as it is; this is a second view of the same state, drawn in the
 * language of the app's other full-page settings. Both read the shared provider
 * store (`provider-settings.ts`) and both write the one `modelConfig` App owns,
 * so anything changed here is already changed there.
 *
 * Every control the tab has is here, doing the same thing. The one thing that is
 * gone is the tab's two-page provider pager with its prev/next buttons — it
 * exists because six cards did not fit a dialog's content pane, and a page has
 * the room to list all six.
 */

const EMPTY_MODELS_MESSAGE = 'No models saved or no API keys configured. Manage a provider above.';

const API_FORMATS = [
  { value: 'native-gemini', label: 'Gemini Generate Content' },
  { value: 'openai-chat-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'xai-chat-completions', label: 'xAI tools + Chat Completions' },
];

const TOOL_POLICIES = [
  { value: 'provider-native', label: 'Provider-native' },
  { value: 'function-calling', label: 'Function calling' },
  { value: 'disabled', label: 'Disabled' },
];

/*
 * What the model deals in, as one glyph.
 *
 * Every category gets the icon for its modality, text included: `Type` rather
 * than a sparkle. The four-point star is already the app's mark for "a model" in
 * general (`ModelIcon` on the composer's picker button), so using it here said
 * "model" in a row where every entry is a model, and said nothing about the one
 * thing the glyph exists to distinguish.
 */
const CATEGORY_ICONS = {
  image: { Icon: ImageIcon, label: 'Image model' },
  video: { Icon: Video, label: 'Video model' },
  audio: { Icon: Music, label: 'Audio model' },
  embedding: { Icon: Database, label: 'Embedding model' },
  text: { Icon: Type, label: 'Text model' },
} as const;

const ModelCategoryIcon: React.FC<{ modelId: string; size?: number }> = ({ modelId, size = 14 }) => {
  const category = getModelCategory(modelId);
  const { Icon, label } = CATEGORY_ICONS[category as keyof typeof CATEGORY_ICONS] || CATEGORY_ICONS.text;
  // Labelled, not decorative: this glyph is the only thing separating an image
  // model from a text one in the catalogue list.
  return <Icon size={size} role="img" aria-label={label}><title>{label}</title></Icon>;
};

type DropdownItem = {
  key: string;
  label: string;
  note?: string;
  selected: boolean;
  dividerAfter?: boolean;
  onSelect: () => void;
};

/**
 * Open/close state for one menu, including which way it opens.
 *
 * The flip threshold and the 150ms close are the modal's, so a menu near the
 * bottom of the viewport behaves the same on both surfaces.
 */
const useDropdown = () => {
  const ref = React.useRef<HTMLDivElement>(null);
  const closeTimerRef = React.useRef<number | null>(null);
  const [open, setOpen] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [direction, setDirection] = React.useState<'down' | 'up'>('down');

  const close = React.useCallback(() => {
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
      setClosing(false);
    }, 150);
  }, []);

  React.useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const toggle = React.useCallback(() => {
    if (open) {
      close();
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setDirection(spaceBelow < 220 && spaceAbove > spaceBelow ? 'up' : 'down');
    }
    setOpen(true);
  }, [open, close]);

  React.useEffect(() => {
    if (!open || closing) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    // Capturing, because the page itself is the scroll container: a menu left
    // open while the column scrolls would float away from its trigger.
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && ref.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, closing, close]);

  return { ref, open, closing, direction, toggle, close };
};

const Dropdown: React.FC<{
  ariaLabel: string;
  value: React.ReactNode;
  items: DropdownItem[];
  emptyMessage?: string;
}> = ({ ariaLabel, value, items, emptyMessage = EMPTY_MODELS_MESSAGE }) => {
  const { ref, open, closing, direction, toggle, close } = useDropdown();

  return (
    <div className={`ma-dropdown${open ? ' ma-dropdown-open' : ''}`} ref={ref}>
      <button
        type="button"
        className="ma-dropdown-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="ma-dropdown-value">{value}</span>
        <ChevronDown size={18} className="ma-dropdown-chevron" />
      </button>

      {open && (
        <div
          role="listbox"
          className={`ma-dropdown-menu ma-dropdown-menu-${direction}${closing ? ' ma-dropdown-menu-closing' : ''}`}
        >
          {items.length === 0 ? (
            <div className="ma-dropdown-empty">{emptyMessage}</div>
          ) : (
            items.map((item) => (
              <React.Fragment key={item.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.selected}
                  className={`ma-dropdown-item${item.selected ? ' ma-dropdown-item-selected' : ''}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    item.onSelect();
                    close();
                  }}
                >
                  <span className="ma-dropdown-item-text">
                    <span>{item.label}</span>
                    {item.note && <span className="ma-dropdown-item-note">{item.note}</span>}
                  </span>
                  {item.selected && <Check size={16} className="ma-dropdown-item-check" />}
                </button>
                {item.dividerAfter && <div className="ma-dropdown-divider" />}
              </React.Fragment>
            ))
          )}
        </div>
      )}
    </div>
  );
};

/**
 * A labelled single-choice field.
 *
 * Uses the same `Dropdown` as the model and system-default pickers rather than a
 * native `<select>`. The modal's tab uses a native one for these two fields,
 * which on a page reading in the app's own menu language meant API format and
 * Tool translation dropped a light OS menu — system font, no checkmark, no
 * accent, no edge flip — into a dark column of custom ones.
 */
const ChoiceField: React.FC<{
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div className="ma-field">
    <label className="ma-field-label ma-label-s">{label}</label>
    <Dropdown
      ariaLabel={label}
      value={options.find((option) => option.value === value)?.label || value}
      items={options.map((option) => ({
        key: option.value,
        label: option.label,
        selected: option.value === value,
        onSelect: () => onChange(option.value),
      }))}
    />
  </div>
);

interface ModelsApiPageProps {
  modelConfig: any;
  setModelConfig: React.Dispatch<React.SetStateAction<any>>;
}

export const ModelsApiPage: React.FC<ModelsApiPageProps> = ({ modelConfig, setModelConfig }) => {
  const { providerState, handleUpdateConfig } = useProviderSettings(setModelConfig);
  /*
   * Accents follow the workspace colour, like the rest of the app: the pastel
   * `creamy` tone tints the configured providers, and the deeper `sendButton`
   * pair fills "Add to models" — the same two roles they play on the agent cards
   * and the composer's send button. Handed to the CSS as variables, which is how
   * the notebooks pages do it.
   */
  const { userProfile } = useAuth();
  const theme = getWorkspaceTheme(userProfile?.workspaceColor);

  const [managingProvider, setManagingProvider] = React.useState<ProviderId | null>(null);
  const [wasManaging, setWasManaging] = React.useState(false);
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
  const systemDefaults = modelConfig.systemDefaults || {};

  const exitManageProvider = () => {
    setWasManaging(true);
    setManagingProvider(null);
    setCustomModelExpanded(false);
    window.setTimeout(() => setWasManaging(false), 200);
  };

  /*
   * Keep the selected thinking level legal for the selected model.
   *
   * Picking a model with fewer levels than the current setting — or one with no
   * "off" step while the setting is off — leaves `modelConfig` holding a level
   * the provider will reject. The modal clamps Gemini in `SettingsModal` and
   * Moonshot/SpaceXAI in `ModelsTab`; this page selects models too, so it needs
   * all three. Both surfaces clamping to the same legal value is harmless.
   */
  /*
   * Written as a clamp rather than the modal's two `if` branches so it is
   * provably convergent. The branches settle for every model in the catalogue
   * today, but a `maxLevels: 0, hasNone: false` entry would make them alternate
   * between 0 and 1 forever, and unlike the modal these effects also watch the
   * level they write.
   */
  const clampThinkingLevel = (provider: 'gemini' | 'moonshot', options: typeof MOONSHOT_MODELS) => {
    const selected = options.find((model) => model.id === modelConfig[provider].model);
    if (!selected) return;
    const level = modelConfig[provider].thinkingLevel;
    const legal = Math.min(Math.max(level, selected.hasNone ? 0 : 1), selected.maxLevels);
    if (legal === level) return;
    setModelConfig((previous: any) => ({
      ...previous,
      [provider]: { ...previous[provider], thinkingLevel: legal },
    }));
  };

  React.useEffect(() => {
    clampThinkingLevel('gemini', PROVIDER_MODEL_OPTIONS.gemini);
  }, [modelConfig.gemini.model, modelConfig.gemini.thinkingLevel, setModelConfig]);

  React.useEffect(() => {
    clampThinkingLevel('moonshot', MOONSHOT_MODELS);
  }, [modelConfig.moonshot.model, modelConfig.moonshot.thinkingLevel, setModelConfig]);

  React.useEffect(() => {
    const selected = SPACEXAI_MODELS.find((model) => model.id === modelConfig.spacexai.model);
    if (!selected) return;
    const currentLevel = modelConfig.spacexai.thinkingLevel;
    if ((!selected.hasNone && currentLevel === 0) || currentLevel > selected.maxLevels) {
      setModelConfig((previous: any) => ({
        ...previous,
        spacexai: {
          ...previous.spacexai,
          thinkingLevel: selected.hasNone ? selected.maxLevels : selected.defaultThinkingLevel,
        },
      }));
    }
  }, [modelConfig.spacexai.model, modelConfig.spacexai.thinkingLevel, setModelConfig]);

  const catalogModels = React.useMemo(
    () => collectSavedModelsInCatalogOrder(modelConfig).map((model: any) => ({ ...model, provider: model.providerId })),
    [modelConfig],
  );

  const allSystemDefaultModels = React.useMemo(() => {
    const seen = new Set<string>();
    return catalogModels.filter((model: any) => {
      const key = `${model.provider}:${model.profileId || 'default'}:${model.modelId || model.id}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [catalogModels]);

  /** Saved models whose provider actually has a key, in provider order. */
  const keyedSystemDefaultModels = React.useMemo(
    () => PROVIDERS.flatMap(({ id }) => providerState[id]?.apiKey
      ? ((modelConfig[id]?.savedModels || []) as any[]).map((model) => ({ ...model, provider: id }))
      : []),
    [modelConfig, providerState],
  );

  const configuredSystemDefaultModels = React.useMemo(
    () => allSystemDefaultModels.filter((model: any) => Boolean(providerState?.[model.provider]?.apiKey)),
    [allSystemDefaultModels, providerState],
  );

  // Dictation sends a finished recording, so the live-only transcribe SKU is not
  // a choice this row can honour.
  const selectableTranscriptionModels = React.useMemo(
    () => configuredSystemDefaultModels.filter(
      (model: any) => !isLiveOnlyTranscriptionModel(model.modelId || model.id),
    ),
    [configuredSystemDefaultModels],
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
    const onlyText = /(image|banana|veo|lyria|tts|audio|speech|embedding|omni|realtime|whisper|sora|transcribe)/;
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
      systemDefaults.personalIntelligence,
      allSystemDefaultModels,
      (provider: any) => Boolean(providerState?.[provider]?.apiKey),
    ),
    [systemDefaults.personalIntelligence, allSystemDefaultModels, providerState],
  );

  const isPersonalAutomatic = (systemDefaults.personalIntelligence || AUTO_MODEL) === AUTO_MODEL;

  const setSystemDefault = (key: string, value: string) => {
    setModelConfig((previous: any) => ({
      ...previous,
      systemDefaults: { ...previous.systemDefaults, [key]: value },
    }));
  };

  const savedModelName = (modelId: string | undefined) => [
    ...(modelConfig.gemini?.savedModels || []),
    ...(modelConfig.openai?.savedModels || []),
    ...(modelConfig.anthropic?.savedModels || []),
  ].find((model: any) => model.modelId === modelId)?.name;

  const GEMINI_RENAMING_FALLBACKS: Record<string, string> = {
    'gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
    'gemini-3.5-flash-lite': 'Gemini 3.5 Flash Lite',
    'gemini-3.6-flash': 'Gemini 3.6 Flash',
  };

  const chatRenamingLabel = savedModelName(systemDefaults.chatRenaming)
    || GEMINI_RENAMING_FALLBACKS[systemDefaults.chatRenaming]
    || systemDefaults.chatRenaming
    || 'Select model';

  const computerUseLabel = savedModelName(systemDefaults.computerUse)
    || (systemDefaults.computerUse === 'claude-sonnet-4.5' ? 'Claude Sonnet 4.5' : systemDefaults.computerUse)
    || 'Select model';

  const TRANSCRIPTION_FALLBACKS: Record<string, string> = {
    [CHROME_NATIVE_TRANSCRIPTION_MODEL]: CHROME_NATIVE_TRANSCRIPTION_NAME,
    'gemini-3.5-transcribe': 'Gemini 3.5 Transcribe',
    'gemini-3.5-transcribe-live': 'Gemini 3.5 Transcribe Live',
    'gemini-3.5-flash-lite': 'Gemini 3.5 Flash Lite',
  };

  const transcriptionLabel = allSystemDefaultModels.find(
    (model: any) => model.modelId === systemDefaults.transcription,
  )?.name
    || TRANSCRIPTION_FALLBACKS[systemDefaults.transcription]
    || systemDefaults.transcription
    || 'Select model';

  const chatSearchLabel = selectableEmbeddingModels.find(
    (model: any) => model.modelId === systemDefaults.chatSearch,
  )?.name || 'Lexical search';

  /*
   * Falls back to the same "Lexical search" label as chat search when nothing is
   * chosen, and for the same reason: an unset value is not an error state, it is
   * the free, offline default. A notebook still retrieves without an embedding
   * model — it ranks passages by term overlap instead of by meaning.
   */
  const notebookSearchLabel = selectableEmbeddingModels.find(
    (model: any) => model.modelId === systemDefaults.notebookSearch,
  )?.name || 'Lexical search';

  const personalLabel = isPersonalAutomatic
    ? (personalSelection?.name
        ? `${personalSelection.name} · automatic`
        : 'Automatic · no eligible model yet')
    : allSystemDefaultModels.find(
        (model: any) => model.modelId === systemDefaults.personalIntelligence,
      )?.name || systemDefaults.personalIntelligence || 'Select model';

  const savedModelItems = (key: string, currentValue: string | undefined): DropdownItem[] =>
    keyedSystemDefaultModels.map((model: any) => ({
      key: `${model.provider}-${model.id}`,
      label: model.name,
      selected: currentValue === model.modelId,
      onSelect: () => setSystemDefault(key, model.modelId),
    }));

  const embeddingItems = (key: string, currentValue: string | undefined): DropdownItem[] => [
    {
      key: 'lexical',
      label: 'Lexical search',
      selected: !selectableEmbeddingModels.some((model: any) => model.modelId === currentValue),
      onSelect: () => setSystemDefault(key, 'linear'),
    },
    ...selectableEmbeddingModels.map((model: any) => ({
      key: `${key}-${model.provider}-${model.id || model.modelId}`,
      label: model.name,
      selected: currentValue === model.modelId,
      onSelect: () => setSystemDefault(key, model.modelId),
    })),
  ];

  const activeProfile = managingProvider
    ? providerProfiles.find((profile: any) => profile.id === DEFAULT_PROFILE_IDS[managingProvider])
    : undefined;

  const updateActiveProfile = (patch: Record<string, unknown>) => {
    if (!managingProvider) return;
    setModelConfig((previous: any) => ({
      ...previous,
      providerProfiles: (previous.providerProfiles || []).map((profile: any) => profile.id === DEFAULT_PROFILE_IDS[managingProvider]
        ? { ...profile, ...patch, updatedAt: Date.now() }
        : profile),
    }));
  };

  const managedModelOptions = managingProvider ? PROVIDER_MODEL_OPTIONS[managingProvider] : [];
  const managedSelectedId = managingProvider ? modelConfig[managingProvider]?.model : undefined;
  const managedSavedModels: any[] = managingProvider ? (modelConfig[managingProvider]?.savedModels || []) : [];
  const isManagedModelSaved = managedSavedModels.some((model) => model.modelId === managedSelectedId);

  const addSelectedModel = () => {
    if (!managingProvider || !managedSelectedId || isManagedModelSaved) return;
    // Null for a Gemini id that is not in the catalogue — there is no thinking
    // scale to copy. Every other provider saves an unlisted id at the top level,
    // which is what the modal does too.
    const record = buildSavedModel(managingProvider, managedSelectedId);
    if (!record) return;
    setModelConfig((previous: any) => ({
      ...previous,
      [managingProvider]: {
        ...previous[managingProvider],
        savedModels: [...(previous[managingProvider]?.savedModels || []), record],
      },
    }));
  };

  const addCustomModel = () => {
    if (!managingProvider) return;
    const name = customModelDraft.name.trim();
    const modelId = customModelDraft.modelId.trim();
    if (!name || !modelId) return;
    const profileId = DEFAULT_PROFILE_IDS[managingProvider];
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

    setModelConfig((previous: any) => ({
      ...previous,
      [managingProvider]: {
        ...previous[managingProvider],
        savedModels: [
          ...(previous[managingProvider]?.savedModels || []).filter((model: any) => !(model.modelId === modelId && model.profileId === profileId)),
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
      providerProfiles: (previous.providerProfiles || []).map((candidate: any) => candidate.id === profileId
        ? { ...candidate, modelIds: Array.from(new Set([...(candidate.modelIds || []), modelId])), updatedAt: Date.now() }
        : candidate),
    }));
    setCustomModelDraft((current) => ({ ...current, name: '', modelId: '' }));
    setCustomModelExpanded(false);
  };

  const reorderCatalogModel = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    setModelConfig((previous: any) => {
      const order = getNormalizedModelOrder(previous);
      const sourceIndex = order.indexOf(sourceKey);
      const targetIndex = order.indexOf(targetKey);
      if (sourceIndex < 0 || targetIndex < 0) return previous;
      const nextOrder = [...order];
      const [moved] = nextOrder.splice(sourceIndex, 1);
      nextOrder.splice(targetIndex, 0, moved);
      return { ...previous, modelOrder: nextOrder };
    });
  };

  const removeSavedModel = (saved: any, modelKey: string) => {
    setModelConfig((previous: any) => ({
      ...previous,
      modelOrder: (previous.modelOrder || []).filter((key: string) => key !== modelKey),
      [saved.provider]: {
        ...previous[saved.provider],
        savedModels: previous[saved.provider].savedModels.filter((model: any) => model.id !== saved.id),
      },
    }));
  };

  const renderSystemDefaults = () => (
    <div className="ma-section">
      <div className="ma-section-heading">
        <h2 className="ma-title-l">System defaults</h2>
      </div>
      <div className="ma-section-description ma-body-m">
        Which of your models Willow reaches for when it does a job on its own.
      </div>

      <div className="ma-row">
        <div className="ma-row-text">
          <div className="ma-title-m">Chat naming model</div>
          <div className="ma-label-m">Model used to automatically generate chat titles.</div>
        </div>
        <div className="ma-row-control">
          <Dropdown
            ariaLabel="Chat naming model"
            value={chatRenamingLabel}
            items={savedModelItems('chatRenaming', systemDefaults.chatRenaming)}
          />
        </div>
      </div>

      <div className="ma-row">
        <div className="ma-row-text">
          <div className="ma-title-m">Chat search model</div>
          <div className="ma-label-m">Embedding model used to rank chat search results.</div>
        </div>
        <div className="ma-row-control">
          <Dropdown
            ariaLabel="Chat search model"
            value={chatSearchLabel}
            items={embeddingItems('chatSearch', systemDefaults.chatSearch)}
          />
        </div>
      </div>

      <div className="ma-row">
        <div className="ma-row-text">
          <div className="ma-title-m">Notebook source search</div>
          <div className="ma-label-m">How notebook sources are searched for passages to ground on.</div>
        </div>
        <div className="ma-row-control">
          <Dropdown
            ariaLabel="Notebook source search model"
            value={notebookSearchLabel}
            items={embeddingItems('notebookSearch', systemDefaults.notebookSearch)}
          />
        </div>
      </div>

      <div className="ma-row">
        <div className="ma-row-text">
          <div className="ma-title-m">Computer use model</div>
          <div className="ma-label-m">Model used for the automated test agent.</div>
        </div>
        <div className="ma-row-control">
          <Dropdown
            ariaLabel="Computer use model"
            value={computerUseLabel}
            items={savedModelItems('computerUse', systemDefaults.computerUse)}
          />
        </div>
      </div>

      <div className="ma-row">
        <div className="ma-row-text">
          <div className="ma-title-m">Model for transcription</div>
          <div className="ma-label-m">Model used to transcribe recorded voice input.</div>
        </div>
        <div className="ma-row-control">
          <Dropdown
            ariaLabel="Transcription model"
            value={transcriptionLabel}
            emptyMessage="No API-backed models saved or no API keys configured. Manage a provider above."
            items={[
              {
                key: 'chrome-native',
                label: CHROME_NATIVE_TRANSCRIPTION_NAME,
                note: 'No API key · on-device when available',
                selected: systemDefaults.transcription === CHROME_NATIVE_TRANSCRIPTION_MODEL,
                dividerAfter: selectableTranscriptionModels.length > 0,
                onSelect: () => setSystemDefault('transcription', CHROME_NATIVE_TRANSCRIPTION_MODEL),
              },
              ...selectableTranscriptionModels.map((model: any) => ({
                key: `${model.provider}-${model.id || model.modelId}`,
                label: model.name,
                selected: systemDefaults.transcription === model.modelId,
                onSelect: () => setSystemDefault('transcription', model.modelId),
              })),
            ]}
          />
        </div>
      </div>

      <div className="ma-row">
        <div className="ma-row-text">
          <div className="ma-title-m">Model for Personal Intelligence</div>
          <div className="ma-label-m">
            Model used to build your profile from past chats. Automatic keeps this on the cheapest one you have.
          </div>
        </div>
        <div className="ma-row-control">
          <Dropdown
            ariaLabel="Personal Intelligence model"
            value={personalLabel}
            items={[
              {
                key: 'automatic',
                label: 'Automatic',
                note: personalSelection?.name
                  ? `Cheapest you have — currently ${personalSelection.name}`
                  : 'Cheapest capable model you have added',
                selected: isPersonalAutomatic,
                dividerAfter: true,
                onSelect: () => setSystemDefault('personalIntelligence', AUTO_MODEL),
              },
              ...selectablePersonalModels.map((model: any) => ({
                key: `${model.provider}-${model.id || model.modelId}`,
                label: model.name,
                selected: systemDefaults.personalIntelligence === model.modelId,
                onSelect: () => setSystemDefault('personalIntelligence', model.modelId),
              })),
            ]}
          />
        </div>
      </div>
    </div>
  );

  const renderOverview = () => (
    <div className={wasManaging ? 'ma-fade-in' : undefined}>
      <div className="ma-section">
        <div className="ma-section-heading">
          <h2 className="ma-title-l">Providers</h2>
        </div>
        <div className="ma-section-description ma-body-m">
          Add a key to a provider to use its models. Keys stay in this browser — they are never uploaded, and signing
          in does not change that.
        </div>

        <div className="ma-provider-list">
          {PROVIDERS.map((provider) => {
            const isConfigured = Boolean(providerState[provider.id]?.apiKey);
            return (
              <button
                type="button"
                key={provider.id}
                className={`ma-provider-row${isConfigured ? ' ma-provider-row-configured' : ''}`}
                onClick={() => setManagingProvider(provider.id)}
              >
                <span className="ma-provider-mark">
                  <ProviderGlyph provider={provider.id} size={22} />
                </span>
                <span className="ma-provider-text">
                  <span className="ma-title-m">{provider.name}</span>
                  <span className="ma-provider-status ma-label-s">
                    <span className="ma-status-dot" />
                    {isConfigured ? 'Configured' : 'Not configured'}
                  </span>
                </span>
                <ChevronRight size={20} className="ma-provider-chevron" />
              </button>
            );
          })}
        </div>
      </div>

      {renderSystemDefaults()}
    </div>
  );

  const renderModelCatalog = () => (
    <div className="ma-section">
      <div className="ma-section-heading">
        <h2 className="ma-title-l">Models</h2>
      </div>
      <div className="ma-section-description ma-body-m">
        Every model you have added, in the order the composer offers them. Drag to reorder.
      </div>

      {catalogModels.length === 0 ? (
        <div className="ma-model-list">
          <div className="ma-empty ma-body-m">No model presets configured yet. Add one above to get started.</div>
        </div>
      ) : (
        <div className="ma-model-list">
          {catalogModels.map((saved: any) => {
            const modelKey = getModelCatalogKey(saved);
            const isDropTarget = dragOverModelKey === modelKey && draggedModelKey !== modelKey;
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
                className={`ma-model-row${isDropTarget ? ' ma-model-row-drop-target' : ''}${draggedModelKey === modelKey ? ' ma-model-row-dragging' : ''}`}
              >
                <span className="ma-model-mark">
                  <ProviderGlyph provider={saved.provider} size={22} />
                </span>
                <span className="ma-model-text">
                  <div className="ma-title-m ma-model-name">{saved.name}</div>
                  <div className="ma-label-s">{providerVendor(saved.provider)}</div>
                </span>
                {/* No published rate (a custom model, or one the provider has
                    not priced yet) leaves the category badge on its own rather
                    than an empty pill. */}
                <span className="ma-model-price">
                  <ModelCategoryIcon modelId={saved.modelId} size={13} />
                  {getModelPricing(saved.modelId) ? <span>{getModelPricing(saved.modelId)}</span> : null}
                </span>
                <span className="ma-model-actions">
                  <button
                    type="button"
                    className="ma-icon-button ma-icon-button-danger"
                    aria-label={`Remove ${saved.name}`}
                    title="Remove model"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeSavedModel(saved, modelKey);
                    }}
                  >
                    <X size={18} />
                  </button>
                  <button
                    type="button"
                    draggable
                    className="ma-icon-button ma-drag-handle"
                    aria-label={`Reorder ${saved.name}`}
                    title="Reorder model"
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
                  >
                    <GripVertical size={18} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderManageProvider = (provider: ProviderId) => {
    const config = providerState[provider];
    const selectedOption = managedModelOptions.find((option) => option.id === managedSelectedId);

    return (
      <div className="ma-fade-in">
        <div className="ma-section">
          <div className="ma-section-heading">
            <h2 className="ma-title-l">API configuration</h2>
          </div>

          <div className="ma-field ma-stack-l">
            <label className="ma-field-label ma-label-s" htmlFor="ma-api-key">API keys</label>
            <input
              id="ma-api-key"
              type="password"
              autoComplete="off"
              className="ma-input ma-input-mono"
              placeholder={`Enter ${providerName(provider)} API keys, separated by commas...`}
              value={config.apiKey}
              onChange={(event) => handleUpdateConfig(provider, { ...config, apiKey: event.target.value })}
            />
            <p className="ma-field-hint ma-label-s">
              Separate multiple keys with commas. They are tried from left to right when authentication is rejected.
            </p>
          </div>

          <div className="ma-field">
            <label className="ma-field-label ma-label-s" htmlFor="ma-base-url">Base URL (optional)</label>
            <input
              id="ma-base-url"
              type="text"
              className="ma-input"
              placeholder="e.g., https://api.openai.com/v1"
              value={config.baseUrl}
              onChange={(event) => handleUpdateConfig(provider, { ...config, baseUrl: event.target.value })}
            />
          </div>

          <div className="ma-field-grid">
            <ChoiceField
              label="API format"
              value={activeProfile?.apiFormat || defaultApiFormatForProvider(provider)}
              options={API_FORMATS}
              onChange={(value) => updateActiveProfile({ apiFormat: value })}
            />
            <ChoiceField
              label="Tool translation"
              value={activeProfile?.toolPolicy || defaultToolPolicyForProvider(provider)}
              options={TOOL_POLICIES}
              onChange={(value) => updateActiveProfile({ toolPolicy: value })}
            />
          </div>

          <p className="ma-section-note ma-label-s">
            Keys are stored on this device only. They are never sent to Willow, and they go straight from your browser
            to the provider you are calling.
          </p>
        </div>

        <div className="ma-section">
          <div className="ma-section-heading">
            <h2 className="ma-title-l">{providerName(provider)} models</h2>
          </div>
          <div className="ma-section-description ma-body-m">
            Pick a model and add it to your catalog to make it selectable in the composer.
          </div>

          <div className="ma-field ma-stack-l">
            <label className="ma-field-label ma-label-s">Model</label>
            <Dropdown
              ariaLabel={`${providerName(provider)} model`}
              value={selectedOption ? (
                <>
                  {selectedOption.name}
                  <ModelCategoryIcon modelId={selectedOption.id} size={14} />
                </>
              ) : 'Select model'}
              items={managedModelOptions.map((option) => ({
                key: option.id,
                label: option.name,
                selected: managedSelectedId === option.id,
                onSelect: () => setModelConfig((previous: any) => ({
                  ...previous,
                  [provider]: { ...previous[provider], model: option.id },
                })),
              }))}
              emptyMessage="No models listed for this provider yet."
            />
          </div>

          <button
            type="button"
            className="ma-button-filled ma-button-block ma-stack-l"
            disabled={!managedSelectedId || isManagedModelSaved}
            onClick={addSelectedModel}
          >
            {isManagedModelSaved ? 'Already added' : 'Add to models'}
          </button>

          <button
            type="button"
            className={`ma-expander-trigger${customModelExpanded ? ' ma-expander-open' : ''}`}
            aria-expanded={customModelExpanded}
            onClick={() => setCustomModelExpanded((expanded) => !expanded)}
          >
            <span className="ma-expander-trigger-label">
              <Plus size={18} /> Add custom model
            </span>
            <ChevronDown size={18} className="ma-dropdown-chevron" />
          </button>

          {customModelExpanded && (
            <div className="ma-expander-body">
              <p className="ma-label-m">
                Add an unlisted model and define the reasoning choices Willow should show.
              </p>
              <div className="ma-field-grid">
                <div className="ma-field">
                  <label className="ma-field-label ma-label-s" htmlFor="ma-custom-name">Display name</label>
                  <input
                    id="ma-custom-name"
                    className="ma-input"
                    value={customModelDraft.name}
                    placeholder="Display name"
                    onChange={(event) => setCustomModelDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </div>
                <div className="ma-field">
                  <label className="ma-field-label ma-label-s" htmlFor="ma-custom-id">Model ID</label>
                  <input
                    id="ma-custom-id"
                    className="ma-input ma-input-mono"
                    value={customModelDraft.modelId}
                    placeholder="Model ID"
                    onChange={(event) => setCustomModelDraft((current) => ({ ...current, modelId: event.target.value }))}
                  />
                </div>
              </div>
              <div className="ma-field">
                <label className="ma-field-label ma-label-s" htmlFor="ma-custom-caps">Capabilities</label>
                <input
                  id="ma-custom-caps"
                  className="ma-input"
                  value={customModelDraft.capabilities}
                  placeholder="text, vision, tools"
                  onChange={(event) => setCustomModelDraft((current) => ({ ...current, capabilities: event.target.value }))}
                />
              </div>

              <div className="ma-effort-header">
                <div>
                  <div className="ma-title-m">Reasoning efforts</div>
                  <div className="ma-label-s">These choices appear under the model in Willow's selector.</div>
                </div>
                <button
                  type="button"
                  className="ma-icon-button"
                  title="Add reasoning effort"
                  aria-label="Add reasoning effort"
                  onClick={() => setCustomReasoningEfforts((current) => [
                    ...current,
                    { id: `effort-${Date.now().toString(36)}`, level: String(current.length), label: '', value: '' },
                  ])}
                >
                  <Plus size={18} />
                </button>
              </div>

              {customReasoningEfforts.map((effort) => (
                <div key={effort.id} className="ma-effort-row">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="ma-input"
                    aria-label="Reasoning level"
                    placeholder="Level"
                    value={effort.level}
                    onChange={(event) => setCustomReasoningEfforts((current) => current.map((candidate) => candidate.id === effort.id
                      ? { ...candidate, level: event.target.value }
                      : candidate))}
                  />
                  <input
                    className="ma-input"
                    aria-label="Reasoning label"
                    placeholder="Label"
                    value={effort.label}
                    onChange={(event) => setCustomReasoningEfforts((current) => current.map((candidate) => candidate.id === effort.id
                      ? { ...candidate, label: event.target.value }
                      : candidate))}
                  />
                  <input
                    className="ma-input ma-input-mono"
                    aria-label="Provider reasoning value"
                    placeholder="API value"
                    value={effort.value}
                    onChange={(event) => setCustomReasoningEfforts((current) => current.map((candidate) => candidate.id === effort.id
                      ? { ...candidate, value: event.target.value }
                      : candidate))}
                  />
                  <button
                    type="button"
                    className="ma-icon-button ma-icon-button-danger"
                    title="Remove reasoning effort"
                    aria-label="Remove reasoning effort"
                    disabled={customReasoningEfforts.length === 1}
                    onClick={() => setCustomReasoningEfforts((current) => current.filter((candidate) => candidate.id !== effort.id))}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="ma-button-filled ma-stack-xl"
                disabled={!customModelDraft.name.trim() || !customModelDraft.modelId.trim()}
                onClick={addCustomModel}
              >
                <Plus size={16} /> Add to model catalog
              </button>
            </div>
          )}
        </div>

        {renderModelCatalog()}
      </div>
    );
  };

  return (
    <div
      className="models-api-container gemini-chat-scrollbar"
      style={{
        '--ma-primary': theme.creamy.hex,
        '--ma-accent-button-bg': theme.sendButton.bg,
        '--ma-accent-button-hover': theme.sendButton.hover,
      } as React.CSSProperties}
    >
      <div className="ma-page-content">
        <div className={`ma-page-header${managingProvider ? ' ma-page-header-standalone' : ''}`}>
          {managingProvider && (
            <button
              type="button"
              className="ma-back-button"
              aria-label="Back to Models & API"
              title="Back"
              onClick={exitManageProvider}
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div className="ma-page-headline-group">
            <h1 className="ma-display-s">
              {managingProvider ? `Manage ${providerName(managingProvider)}` : 'Models & API'}
            </h1>
          </div>
        </div>

        {!managingProvider && (
          <div className="ma-page-description ma-body-l">
            Connect your AI providers and configure model settings.
          </div>
        )}

        {managingProvider ? renderManageProvider(managingProvider) : renderOverview()}
      </div>
    </div>
  );
};
