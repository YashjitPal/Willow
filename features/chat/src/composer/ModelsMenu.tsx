/**
 * The model picker.
 *
 * Lists every configured model across all providers, deduped by `modelId`, and
 * exposes a submenu of thinking-effort levels per model. Self-contained: props
 * in, no shared closure with the composer.
 *
 * Rendered in two places with different chrome — the composer passes
 * `geminiStyle` to flip the anchoring and default side. Moved out of
 * Composer.tsx verbatim; Composer re-exports it so the two outside importers
 * (CodeHome, WorkbenchSidebar) are unaffected.
 *
 * The close animation is CSS (`animate-dropdown*`, declared app-wide in
 * apps/studio/index.html), so `handleClose` waits 150ms before calling
 * `onClose` — unmounting immediately would cut the animation off.
 */

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Plus, Search, Settings } from "lucide-react";
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  getModelGroupKey,
  getThinkingEffortLabel,
  ModelEffortRecord,
  modelSupportsNoThinking,
  sortModelEfforts,
} from '@willow/ai/models/efforts';

type PickerModel = ModelEffortRecord;

export const ModelsMenu: React.FC<{
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  modelConfig: any;
  selectedId: string;
  onSelect: (id: string) => void;
  onAuthRequired?: () => void;
  geminiStyle?: boolean;
}> = ({ onClose, triggerRef, modelConfig, selectedId, onSelect, onAuthRequired, geminiStyle = false }) => {
  const isMediaModel = (m: any) => {
    const id = (m.modelId || m.id || '').toLowerCase();
    const name = (m.name || '').toLowerCase();
    if (['grok-imagine', 'grok-voice', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview', 'gemini-3.1-flash-lite-image', 'veo-3.1-fast', 'veo-3.1', 'veo-3.1-lite', 'omni-flash', 'lyria-3-pro'].includes(id)) return true;
    if (id.includes('imagine') || id.includes('voice') || id.includes('banana') || id.includes('veo') || id.includes('lyria')) return true;
    if (name.includes('imagine') || name.includes('voice') || name.includes('banana') || name.includes('veo') || name.includes('lyria')) return true;
    return false;
  };

  // Combine all saved models from all providers and deduplicate by modelId
  const rawModels = [
    ...modelConfig.gemini.savedModels.map((m: any) => ({ ...m, provider: 'Google' })),
    ...modelConfig.openai.savedModels.map((m: any) => ({ ...m, provider: 'OpenAI' })),
    ...modelConfig.anthropic.savedModels.map((m: any) => ({ ...m, provider: 'Anthropic' })),
    ...(modelConfig.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'Moonshot AI' })),
    ...(modelConfig.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'SpaceXAI' })),
    ...(modelConfig.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'Zhipu AI' }))
  ].filter(m => !isMediaModel(m)).filter((v, i, a) => a.findIndex(t => (t.modelId === v.modelId)) === i);

  const [isEffortHovered, setIsEffortHovered] = useState(false);
  const effortMenuRef = useRef<HTMLDivElement>(null);
  const [effortOffset, setEffortOffset] = useState(0);

  useLayoutEffect(() => {
    if (isEffortHovered && effortMenuRef.current) {
      const rect = effortMenuRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      if (rect.bottom > viewportHeight - 16) {
        setEffortOffset(viewportHeight - 16 - rect.bottom);
      } else {
        setEffortOffset(0);
      }
    } else {
      setEffortOffset(0);
    }
  }, [isEffortHovered]);

  const seenModelKeys = new Set<string>();
  const ALL_MODELS = rawModels.filter((m: any) => {
    const key = m.modelId || m.id;
    if (seenModelKeys.has(key)) return false;
    seenModelKeys.add(key);
    return true;
  });

  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [side, setSide] = useState<"top" | "bottom">(geminiStyle ? "bottom" : "top");
  const [isClosing, setIsClosing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 150);
  };

  const calculatePosition = () => {
    if (!triggerRef.current || !menuRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current.offsetHeight;
    const viewportHeight = window.innerHeight;
    const spacing = geminiStyle ? 4 : 8;
    const spaceAbove = triggerRect.top;
    const spaceBelow = viewportHeight - triggerRect.bottom;

    if (side === "top") {
      if (spaceAbove < menuHeight + spacing && spaceBelow > spaceAbove)
        setSide("bottom");
    } else {
      if (spaceBelow < menuHeight + spacing && spaceAbove > spaceBelow)
        setSide("top");
    }
  };

  useLayoutEffect(() => {
    calculatePosition();
  }, []);

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
  }, [side]);

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

  const selectedEfforts = getEffortsForGroup(selectedGroup);
  // Falling back to level 3 keeps the previous default. `> 0` on the last
  // fallback stops a freshly added level-0 entry from being reported as the
  // default effort for models whose ceiling is below 3.
  const selectedEffort = selectedEfforts.find((model) => model.id === selectedId)
    || selectedEfforts.find((m) => m.thinkingLevel === 3)
    || selectedEfforts.find((m) => Number(m.thinkingLevel || 0) > 0)
    || selectedEfforts[0];

  const getModelDescription = (model: any) => {
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
        className={`absolute right-0 w-[241px] bg-[#1f1f1f] rounded-[20px] p-2 z-[100] overflow-visible shadow-[0_4px_24px_rgba(0,0,0,0.45),0_0_20px_rgba(255,255,255,0.05)] ${side === "top" ? "bottom-[calc(100%+4px)] origin-bottom-right" : "top-[calc(100%+4px)] origin-top-right"} ${isClosing ? (side === "top" ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (side === "top" ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}
        style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
      >
        <div className="max-h-[208px] overflow-y-auto no-scrollbar">
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
              onMouseEnter={() => setIsEffortHovered(true)}
              onMouseLeave={() => setIsEffortHovered(false)}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                className="flex h-[48px] w-full items-center rounded-xl text-left text-[13px] text-[#e6e6e6] transition-colors hover:bg-[#333537] focus-visible:bg-[#333537] focus-visible:outline-none font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]"
              >
                <span className="w-9 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block leading-[17px]">Thinking Effort</span>
                  <span className="block truncate text-[12px] leading-4 text-white/55">
                    {getThinkingEffortLabel(selectedEffort)}
                  </span>
                </span>
                <MaterialSymbol family="luminous" name="keyboard_arrow_right" size={24} weight={300} roundness={100} className="mr-2" />
              </button>

              {isEffortHovered && (
                <div 
                  className={`pointer-events-auto absolute left-full -ml-2 pl-4 ${side === "top" ? "bottom-0" : "top-0"}`}
                  style={{ transform: `translateY(${effortOffset}px)` }}
                >
                  <div
                    ref={effortMenuRef}
                    role="menu"
                    aria-label="Thinking Effort"
                    className="pointer-events-auto max-h-[calc(100vh-32px)] w-[220px] overflow-y-auto rounded-[20px] bg-[#1f1f1f] p-2 shadow-[0_4px_18px_rgba(0,0,0,0.32)] gemini-chat-scrollbar"
                  >
                  {selectedEfforts.map((model) => {
                    // Compare against the *resolved* effort, not the raw
                    // selectedId. When only the model has been picked the id
                    // carries no `::effort-` suffix, so a raw comparison ticks
                    // nothing even though a default level is in force.
                    const isSelected = selectedEffort?.id === model.id;
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
      className={`absolute right-0 w-[240px] bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden z-[100] ring-1 ring-black/50 ${side === "top" ? "bottom-[calc(100%+8px)] origin-bottom-right" : "top-[calc(100%+8px)] origin-top-right"} ${isClosing ? (side === "top" ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (side === "top" ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}
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
