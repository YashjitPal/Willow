/**
 * The model picker.
 *
 * Lists every configured model across all providers, deduped by `modelId`, and
 * exposes a submenu of thinking-effort levels per model. Self-contained: props
 * in, no shared closure with the composer.
 *
 * Rendered in several places with different chrome — the caller passes
 * `geminiStyle` to flip the anchoring and default side.
 *
 * Lives here, not in Chat, because Chat and Code both render it: Code used to
 * import it *through* `@willow/chat/composer/Composer`, which made a shared
 * picker look like Code depending on Chat. It takes props and holds no chat
 * state, so `platform/ui` is where it belongs; both features now import it
 * sideways from here and neither owns it.
 *
 * The close animation is CSS (`animate-dropdown*`, declared app-wide in
 * apps/studio/index.html), so `handleClose` waits 150ms before calling
 * `onClose` — unmounting immediately would cut the animation off.
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Plus, Search, Settings } from "lucide-react";
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { collectSavedModelsInCatalogOrder, isChatCapableModel } from '@willow/core/model-catalog';
import {
  chooseMenuSide,
  chooseSubmenuSide,
  getViewportConstrainedOffset,
  type MenuSide,
  type SubmenuSide,
} from '@willow/ui/models/menu-position';
import {
  getModelGroupKey,
  getThinkingEffortLabel,
  ModelEffortRecord,
  modelSupportsNoThinking,
  sortModelEfforts,
} from '@willow/ai/models/efforts';

/**
 * The voice roster this picker can display.
 *
 * Declared structurally rather than imported: the picker lives in
 * `platform/ui`, which must never import from `features/`, and Chat's
 * `VoiceModelListing` (features/chat/src/voice-settings/voice-providers.ts) is
 * assignable to it field-for-field. Chat passes its own listings straight in;
 * this is the seam, and it is the reason the picker could move down here at all.
 */
export type ModelsMenuVoiceListing = {
  id: string;
  name: string;
  providerId: string;
  providerLabel: string;
};

type PickerModel = ModelEffortRecord;

export const ModelsMenu: React.FC<{
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  modelConfig: any;
  selectedId: string;
  onSelect: (id: string) => void;
  onAuthRequired?: () => void;
  geminiStyle?: boolean;
  /**
   * The live models to list instead of the text roster, set only while a voice
   * session is up. Passed in rather than read from the registry here so the two
   * outside importers (CodeHome, WorkbenchSidebar), which know nothing about
   * voice mode, keep their current behaviour by simply not passing it.
   */
  voiceModels?: ModelsMenuVoiceListing[];
  /**
   * Extra rows appended to the thinking-effort submenu.
   *
   * Opt-in and empty by default, so every existing caller renders exactly what
   * it did before. It exists for `features/code-beta`, whose harness adds an
   * effort — Ultra — that is not one of Willow's numeric levels and must not
   * appear anywhere else: upstream Codex treats it as a product-level selection
   * that turns on proactive sub-agent delegation rather than a value any
   * provider accepts, so it is meaningless on the surfaces that do not run that
   * harness.
   *
   * These rows carry their own selected state and their own callback rather
   * than going through `onSelect`, because they are not saved-model ids and
   * writing one into `selectedId` would leave the other tabs unable to resolve
   * the selection.
   */
  extraEfforts?: {
    id: string;
    label: string;
    /** Small trailing tag, e.g. "Sub-agents". */
    badge?: string;
    selected: boolean;
    onSelect: () => void;
  }[];
}> = ({ onClose, triggerRef, modelConfig, selectedId, onSelect, onAuthRequired, geminiStyle = false, voiceModels, extraEfforts }) => {
  const isVoiceRoster = !!voiceModels && voiceModels.length > 0;

  const providerLabels = {
    gemini: 'Google',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    moonshot: 'Moonshot AI',
    spacexai: 'SpaceXAI',
    zhipuai: 'Zhipu AI',
  } as const;
  const savedModels = collectSavedModelsInCatalogOrder(modelConfig).map((model) => ({
    ...model,
    provider: providerLabels[model.providerId],
  }));

  /**
   * The live roster as picker rows.
   *
   * `id` is the live model id itself, not a saved-model key, because that is
   * what the caller stores and what goes on the wire — a live model need not be
   * saved in Settings → Models at all. The saved entry is consulted only for its
   * display name, so a model the user has named keeps that name here. It scans
   * the unfiltered saved list on purpose: the text filter drops anything
   * containing "voice", which is exactly the roster being matched.
   */
  const voiceRows = (voiceModels || []).map((m) => {
    const saved = savedModels.find((s: any) => s.modelId === m.id);
    return { id: m.id, modelId: m.id, name: saved?.name || m.name, provider: m.providerLabel };
  });

  const rawModels = isVoiceRoster
    ? voiceRows
    : savedModels.filter(isChatCapableModel).filter((v, i, a) => a.findIndex(t => (t.modelId === v.modelId)) === i);

  const [isEffortHovered, setIsEffortHovered] = useState(false);
  const [isEffortPositionReady, setIsEffortPositionReady] = useState(false);
  const effortMenuWrapperRef = useRef<HTMLDivElement>(null);
  const effortMenuRef = useRef<HTMLDivElement>(null);
  const [effortOffset, setEffortOffset] = useState(0);
  const [effortSide, setEffortSide] = useState<SubmenuSide>('right');

  const seenModelKeys = new Set<string>();
  const ALL_MODELS = rawModels.filter((m: any) => {
    const key = m.modelId || m.id;
    if (seenModelKeys.has(key)) return false;
    seenModelKeys.add(key);
    return true;
  });

  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const preferredSide: MenuSide = geminiStyle ? 'bottom' : 'top';
  const [side, setSide] = useState<MenuSide>(preferredSide);
  const [isPositionReady, setIsPositionReady] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 150);
  };

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current || !menuRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current.offsetHeight;
    const viewportHeight = window.innerHeight;
    const spacing = geminiStyle ? 4 : 8;
    const spaceAbove = triggerRect.top;
    const spaceBelow = viewportHeight - triggerRect.bottom;

    const nextSide = chooseMenuSide({
      preferredSide,
      menuHeight,
      spacing,
      spaceAbove,
      spaceBelow,
    });
    setSide((currentSide) => currentSide === nextSide ? currentSide : nextSide);
  }, [geminiStyle, preferredSide, triggerRef]);

  useLayoutEffect(() => {
    calculatePosition();

    let firstFrameId = 0;
    let secondFrameId = 0;
    firstFrameId = window.requestAnimationFrame(() => {
      calculatePosition();
      secondFrameId = window.requestAnimationFrame(() => {
        calculatePosition();
        setIsPositionReady(true);
      });
    });

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(calculatePosition);
    if (menuRef.current) observer?.observe(menuRef.current);
    if (triggerRef.current) observer?.observe(triggerRef.current);

    return () => {
      window.cancelAnimationFrame(firstFrameId);
      window.cancelAnimationFrame(secondFrameId);
      observer?.disconnect();
    };
  }, [calculatePosition, triggerRef]);

  useLayoutEffect(() => {
    if (!isEffortHovered) {
      setEffortOffset(0);
      setIsEffortPositionReady(false);
      return;
    }

    const calculateEffortPosition = () => {
      const effortMenuWrapper = effortMenuWrapperRef.current;
      const effortMenu = effortMenuRef.current;
      const modelMenu = menuRef.current;
      if (!effortMenuWrapper || !effortMenu || !modelMenu) return;

      const modelRect = modelMenu.getBoundingClientRect();
      setEffortSide(chooseSubmenuSide({
        submenuWidth: effortMenu.offsetWidth,
        spacing: 8,
        spaceLeft: modelRect.left - 16,
        spaceRight: window.innerWidth - modelRect.right - 16,
      }));

      const previousTransform = effortMenuWrapper.style.transform;
      effortMenuWrapper.style.transform = 'none';
      const rect = effortMenu.getBoundingClientRect();
      effortMenuWrapper.style.transform = previousTransform;

      setEffortOffset(getViewportConstrainedOffset({
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
      }));
    };

    const modelMenu = menuRef.current;
    const handleModelMenuAnimationEnd = (event: AnimationEvent) => {
      if (event.target !== modelMenu) return;
      calculateEffortPosition();
      setIsEffortPositionReady(true);
    };
    modelMenu?.addEventListener('animationend', handleModelMenuAnimationEnd);
    window.addEventListener('resize', calculateEffortPosition);

    calculateEffortPosition();
    const frameId = window.requestAnimationFrame(() => {
      calculateEffortPosition();
      const isAnimating = modelMenu?.getAnimations().some((animation) => animation.playState === 'running');
      if (!isAnimating) setIsEffortPositionReady(true);
    });

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(calculateEffortPosition);
    if (effortMenuRef.current) observer?.observe(effortMenuRef.current);

    return () => {
      window.cancelAnimationFrame(frameId);
      modelMenu?.removeEventListener('animationend', handleModelMenuAnimationEnd);
      window.removeEventListener('resize', calculateEffortPosition);
      observer?.disconnect();
    };
  }, [isEffortHovered, side]);

  useEffect(() => {
    const handleScroll = () => calculatePosition();
    const scrollContainer = document.querySelector("main");
    if (scrollContainer)
      scrollContainer.addEventListener("scroll", handleScroll, {
        passive: true,
      });
    window.addEventListener("resize", handleScroll);
    return () => {
      if (scrollContainer)
        scrollContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [calculatePosition]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        // Click is outside menu - trigger animated close
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredModels = ALL_MODELS.filter((m: any) =>
    m.name.toLowerCase().includes(localSearchQuery.toLowerCase())
  );

  const groupMap = new Map<string, { key: string; variants: PickerModel[] }>();
  filteredModels.forEach((model: PickerModel) => {
    const key = getModelGroupKey(model);
    const group = groupMap.get(key) || { key, variants: [] };
    group.variants.push(model);
    groupMap.set(key, group);
  });

  const groupedModels = Array.from(groupMap.values()).map((group: { key: string; variants: PickerModel[] }) => ({
    ...group,
    variants: sortModelEfforts(group.variants),
  }));

  const getEffortsForGroup = (group: { key: string; variants: PickerModel[] } | undefined): PickerModel[] => {
    if (!group || group.variants.length === 0) return [];

    const base = group.variants[0];
    const provider = String(base.provider || '').toLowerCase();
    const modelId = String(base.modelId || base.id || base.name || '').toLowerCase();

    // Custom profiles can declare their own effort roster. Respect it before
    // falling back to Willow's provider defaults so a model with 2 or 7 levels
    // does not get an invented menu with the wrong wire values.
    if (Array.isArray((base as any).reasoningEfforts) && (base as any).reasoningEfforts.length > 0) {
      return [...(base as any).reasoningEfforts]
        .filter((effort: any) => Number.isFinite(Number(effort.level)))
        .sort((a: any, b: any) => Number(a.level) - Number(b.level))
        .map((effort: any) => ({
          ...base,
          id: `${base.id}::effort-${Number(effort.level)}`,
          thinkingLevel: Number(effort.level),
          thinkingLabel: effort.label,
          effortLabel: effort.label,
        }));
    }

    // A group with several saved variants already carries its own effort levels.
    // Only synthesise the "None" entry, and only when the model genuinely
    // supports it and no saved variant already covers level 0.
    if (group.variants.length > 1) {
      const variants = sortModelEfforts(group.variants);
      if (!modelSupportsNoThinking(base) || variants.some((v) => Number(v.thinkingLevel || 0) === 0)) {
        return variants;
      }
      const noneLabel = getThinkingEffortLabel({ ...base, thinkingLevel: 0, provider, modelId, thinkingLabel: undefined, effortLabel: undefined });
      return [
        {
          ...base,
          id: `${base.id}::effort-0`,
          thinkingLevel: 0,
          thinkingLabel: noneLabel,
          effortLabel: noneLabel,
        },
        ...variants,
      ];
    }

    let maxLevel = 3;
    if (provider.includes('openai') || modelId.includes('gpt')) {
      maxLevel = 6; // Low (1), Medium (2), High (3), Extra High (4), Max (5), Pro (6)
    } else if (provider.includes('anthropic') || modelId.includes('claude')) {
      maxLevel = 5; // Low (1), Medium (2), High (3), xHigh (4), Max (5)
    } else if (modelId.includes('kimi-k3')) {
      maxLevel = 4; // Low (1), Medium (2), High (3), Max (4)
    }

    // Level 0 is offered only where the request layer really sends "no thinking"
    // — see modelSupportsNoThinking. Gemini Pro and Grok deliberately have no
    // level-0 mapping, so they keep starting at Low.
    const minLevel = modelSupportsNoThinking(base) ? 0 : 1;

    const result: PickerModel[] = [];
    for (let lvl = minLevel; lvl <= maxLevel; lvl++) {
      const effortLabel = getThinkingEffortLabel({ ...base, thinkingLevel: lvl, provider, modelId, thinkingLabel: undefined, effortLabel: undefined });
      result.push({
        ...base,
        id: `${base.id}::effort-${lvl}`,
        thinkingLevel: lvl,
        thinkingLabel: effortLabel,
        effortLabel: effortLabel
      });
    }
    return result;
  };

  // `selectedId` is either a plain saved-model id or `<baseId>::effort-<n>`.
  // Everything that decides a checkmark has to compare against the base, or the
  // tick vanishes as soon as an effort level is picked.
  const selectedBaseId = selectedId ? selectedId.split('::effort-')[0] : '';
  const matchesSelection = (model: PickerModel) =>
    model.id === selectedId || model.id === selectedBaseId;

  const selectedGroup = groupedModels.find((group) =>
    group.variants.some(matchesSelection)
  ) || groupedModels[0];

  // A live model has no thinking levels, so the submenu is not merely hidden —
  // there is nothing to offer. Empty here also makes `selectedEffort` undefined,
  // which is what removes the separator and the row below the list.
  const selectedEfforts = isVoiceRoster ? [] : getEffortsForGroup(selectedGroup);
  // Falling back to level 3 keeps the previous default. `> 0` on the last
  // fallback stops a freshly added level-0 entry from being reported as the
  // default effort for models whose ceiling is below 3.
  const selectedEffort = selectedEfforts.find((model) => model.id === selectedId)
    || selectedEfforts.find((m) => m.thinkingLevel === 3)
    || selectedEfforts.find((m) => Number(m.thinkingLevel || 0) > 0)
    || selectedEfforts[0];

  const getModelDescription = (model: any) => {
    // Live models get the provider that runs them. The name-matching below is
    // about text-model capability ("Fastest answers"), which says nothing true
    // about a live model — and "…Flash Live" would otherwise match `flash`.
    if (isVoiceRoster) return String(model.provider || '');
    const name = String(model.name || '').toLowerCase();
    if (name.includes('flash lite')) return 'Fastest answers';
    if (name.includes('flash')) return 'All-around help';
    if (name.includes('pro')) return 'Advanced math & code';
    if (name.includes('reason') || name.includes('thinking')) return 'Complex problem solving';
    return `${model.provider || 'AI'} model`;
  };

  if (geminiStyle) {
    return (
      <div
        ref={menuRef}
        role="menu"
        aria-label="Choose a model"
        className={`absolute right-0 w-[241px] bg-[#1f1f1f] rounded-[20px] p-2 z-[100] overflow-visible shadow-[0_4px_24px_rgba(0,0,0,0.45),0_0_20px_rgba(255,255,255,0.05)] ${!isPositionReady ? 'invisible' : ''} ${side === "top" ? "bottom-[calc(100%+4px)] origin-bottom-right" : "top-[calc(100%+4px)] origin-top-right"} ${isClosing ? (side === "top" ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (side === "top" ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}
        style={{
          fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
          animationPlayState: isPositionReady ? undefined : 'paused',
        }}
      >
        <div
          className="max-h-[208px] overflow-y-auto no-scrollbar"
          style={{ willChange: 'transform', transform: 'translateZ(0)' }}
        >
          {groupedModels.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-white/55">
              No models configured
            </div>
          ) : (
            groupedModels.map((group) => {
              const model = group.variants.find(matchesSelection) || group.variants[0];
              const isSelected = group.variants.some(matchesSelection);
              return (
                <button
                  key={group.key}
                  role="menuitem"
                  onClick={() => {
                    onSelect(model.id);
                    handleClose();
                  }}
                  className="w-full min-h-[52px] rounded-xl flex items-center text-left transition-colors hover:bg-[#333537] focus-visible:bg-[#333537] focus-visible:outline-none"
                >
                  <span className="w-9 shrink-0 flex items-center justify-center text-[#e6e6e6]">
                    {isSelected && <MaterialSymbol family="luminous" name="check" size={20} weight={320} roundness={100} opticalSize={20} />}
                  </span>
                  <span className="min-w-0 flex-1 pr-2 py-2 flex flex-col">
                    <span className="truncate text-[13px] leading-[17px] font-normal text-[#e6e6e6] font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]">
                      {model.name.replace(/\s+Extended$/gi, '')}
                    </span>
                    <span className="truncate text-[13px] leading-[17px] font-normal text-white/55 font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]">
                      {getModelDescription(model)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {selectedEffort && (
          <>
            <div className="h-px bg-[#444746] my-2" role="separator" />
            <div 
              className="relative"
              onMouseEnter={() => {
                setIsEffortPositionReady(false);
                setIsEffortHovered(true);
              }}
              onMouseLeave={() => {
                setIsEffortPositionReady(false);
                setIsEffortHovered(false);
              }}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                className="flex h-[48px] w-full items-center rounded-xl text-left text-[13px] text-[#e6e6e6] transition-colors hover:bg-[#333537] focus-visible:bg-[#333537] focus-visible:outline-none font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]"
              >
                {effortSide === 'left' ? (
                  <MaterialSymbol family="luminous" name="keyboard_arrow_left" size={24} weight={300} roundness={100} className="ml-2 mr-1" />
                ) : (
                  <span className="w-9 shrink-0" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block leading-[17px]">Thinking Effort</span>
                  <span className="block truncate text-[12px] leading-4 text-white/55">
                    {getThinkingEffortLabel(selectedEffort)}
                  </span>
                </span>
                {effortSide === 'right' && (
                  <MaterialSymbol family="luminous" name="keyboard_arrow_right" size={24} weight={300} roundness={100} className="mr-2" />
                )}
              </button>

              {isEffortHovered && (
                <div 
                  ref={effortMenuWrapperRef}
                  className={`pointer-events-auto absolute ${effortSide === 'left' ? 'right-full -mr-2 pr-4' : 'left-full -ml-2 pl-4'} ${side === "top" ? "bottom-0" : "top-0"}`}
                  style={{ transform: `translateY(${effortOffset}px)` }}
                >
                  <div
                    ref={effortMenuRef}
                    role="menu"
                    aria-label="Thinking Effort"
                    className={`pointer-events-auto max-h-[calc(100vh-32px)] w-[220px] overflow-y-auto rounded-[20px] bg-[#1f1f1f] p-2 shadow-[0_4px_18px_rgba(0,0,0,0.32)] gemini-chat-scrollbar ${!isEffortPositionReady ? 'invisible' : ''}`}
                  >
                    {selectedEfforts.map((model) => {
                      const isSelected =
                        !(extraEfforts ?? []).some((extra) => extra.selected) &&
                        selectedEffort?.id === model.id;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          onClick={() => {
                            onSelect(model.id);
                            handleClose();
                          }}
                          className="flex h-12 w-full items-center rounded-xl text-left text-[13px] text-[#e6e6e6] transition-colors hover:bg-[#333537] focus-visible:bg-[#333537] focus-visible:outline-none"
                        >
                          <span className="flex w-9 shrink-0 items-center justify-center">
                            {isSelected && <MaterialSymbol family="luminous" name="check" size={20} weight={320} roundness={100} opticalSize={20} />}
                          </span>
                          <span className="truncate pr-3 font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]">
                            {getThinkingEffortLabel(model)}
                          </span>
                        </button>
                      );
                    })}

                    {(extraEfforts ?? []).map((extra) => (
                      <button
                        key={extra.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={extra.selected}
                        onClick={() => {
                          extra.onSelect();
                          handleClose();
                        }}
                        className="flex h-12 w-full items-center rounded-xl text-left text-[13px] text-[#e6e6e6] transition-colors hover:bg-[#333537] focus-visible:bg-[#333537] focus-visible:outline-none"
                      >
                        <span className="flex w-9 shrink-0 items-center justify-center">
                          {extra.selected && <MaterialSymbol family="luminous" name="check" size={20} weight={320} roundness={100} opticalSize={20} />}
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-2 pr-3 font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]">
                          <span className="truncate">{extra.label}</span>
                          {extra.badge && (
                            <span className="shrink-0 rounded bg-white/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-white/60">
                              {extra.badge}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className={`absolute right-0 w-[240px] bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden z-[100] ring-1 ring-black/50 ${!isPositionReady ? 'invisible' : ''} ${side === "top" ? "bottom-[calc(100%+8px)] origin-bottom-right" : "top-[calc(100%+8px)] origin-top-right"} ${isClosing ? (side === "top" ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (side === "top" ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}
      style={{ animationPlayState: isPositionReady ? undefined : 'paused' }}
    >
      <div className="relative flex items-center px-4 py-3.5 border-b border-white/5 bg-[#1c1c1c]">
        <Search
          className="text-zinc-500 shrink-0 mr-3"
          size={18}
          strokeWidth={2.5}
        />
        <input
          value={localSearchQuery}
          onChange={(e) => setLocalSearchQuery(e.target.value)}
          className="bg-transparent text-white text-[14px] placeholder-zinc-500 outline-none flex-1 leading-none font-normal"
          placeholder="Search models..."

        />
      </div>

      <div className="flex-1 overflow-y-auto max-h-[260px] p-2 pt-0 no-scrollbar bg-[#1c1c1c]">
        <div className="px-2 pt-3.5 pb-2 text-[10.5px] font-bold text-zinc-500 uppercase tracking-widest">
          AVAILABLE MODELS
        </div>
        <div className="space-y-0.5">
          {filteredModels.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-zinc-500">
              {ALL_MODELS.length === 0 ? "No models configured. Add them in Settings." : "No matching models found."}
            </div>
          ) : (
            filteredModels.map((model: any) => {
              const isSelected = matchesSelection(model);
              return (
                <button
                  key={model.id}
                  onClick={() => {
                    onSelect(model.id);
                    handleClose();
                  }}
                  className={`w-full flex items-center justify-between px-3 py-[7px] rounded-lg text-[13.5px] font-medium group
                    ${
                      isSelected
                        ? "bg-[#2563eb] text-white shadow-lg shadow-blue-500/10"
                        : "text-zinc-300 hover:bg-white/5 hover:text-white"
                    }`}
                >
                  <span>{model.name}</span>
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wider opacity-60 ${
                      isSelected ? "text-white" : "group-hover:text-zinc-400"
                    }`}
                  >
                    {model.provider}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex items-center h-[42px] border-t border-white/10 mt-0 bg-[#1c1c1c]">
        <button
          onClick={() => { onAuthRequired?.(); handleClose(); }}
          className="flex-1 flex items-center justify-center gap-2 text-[13px] font-medium text-white/70 hover:text-white hover:bg-white/5 h-full"
        >
          <Plus size={14} strokeWidth={2.5} />
          <span>Add new</span>
        </button>
        <div className="w-[1px] h-4 bg-white/10"></div>
        <button
          onClick={() => { onAuthRequired?.(); handleClose(); }}
          className="w-[42px] flex items-center justify-center text-white/60 hover:text-white hover:bg-white/5 h-full"
        >
          <Settings size={15} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
};
