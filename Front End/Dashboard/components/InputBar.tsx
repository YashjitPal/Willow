import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import {
  Plus,
  FileText,
  AudioLines,
  ArrowUp,
  ChevronDown,
  Search,
  Settings,
  Rocket,
  Palette,
  Zap,
  MessageSquare,
} from "lucide-react";
import { useBackground } from "../context/BackgroundContext";

const ModelIcon = ({ size = 18, ...props }: any) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 512 512"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d="M256 0C256 0 292 200 512 256C292 312 256 512 256 512C256 512 220 312 0 256C220 200 256 0 256 0Z" />
  </svg>
);

interface Theme {
  id: string;
  name: string;
  colors: string[];
}

const THEMES: Theme[] = [
  { id: "default", name: "Default", colors: ["#ffffff", "#a78bfa", "#94a3b8"] },
  { id: "glacier", name: "Glacier", colors: ["#38bdf8", "#94a3b8", "#bae6fd"] },
  { id: "harvest", name: "Harvest", colors: ["#fb923c", "#fcd34d", "#fef08a"] },
  {
    id: "lavender",
    name: "Lavender",
    colors: ["#c084fc", "#e879f9", "#ddd6fe"],
  },
  {
    id: "brutalist",
    name: "Brutalist",
    colors: ["#ffffff", "#3b82f6", "#10b981"],
  },
  {
    id: "obsidian",
    name: "Obsidian",
    colors: ["#94a3b8", "#cbd5e1", "#f1f5f9"],
  },
  { id: "orchid", name: "Orchid", colors: ["#f47226", "#fb7185", "#fbcfe8"] },
  { id: "solar", name: "Solar", colors: ["#facc15", "#fde047", "#fef9c3"] },
];



type Mode = "ship" | "design" | "proto" | "chat";

interface ModeOption {
  id: Mode;
  label: string;
  icon: React.ElementType;
}

const MODES: ModeOption[] = [
  { id: "ship", label: "Ship", icon: Rocket },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "design", label: "Design", icon: Palette },
  { id: "proto", label: "Proto", icon: Zap },
];

const ModelsMenu: React.FC<{
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  modelConfig: any;
  selectedId: string;
  onSelect: (id: string) => void;
  onAuthRequired?: () => void;
}> = ({ onClose, triggerRef, modelConfig, selectedId, onSelect, onAuthRequired }) => {
  // Combine all saved models from all providers
  const ALL_MODELS = [
    ...modelConfig.gemini.savedModels.map((m: any) => ({ ...m, provider: 'Google' })),
    ...modelConfig.openai.savedModels.map((m: any) => ({ ...m, provider: 'OpenAI' })),
    ...modelConfig.anthropic.savedModels.map((m: any) => ({ ...m, provider: 'Anthropic' }))
  ].filter(m => m.name !== "Nano Banana Pro"); // Filter out Nano Banana Pro

  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [side, setSide] = useState<"top" | "bottom">("top");
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
    const spacing = 8;
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

  return (
    <div
      ref={menuRef}
      className={`absolute right-0 w-[240px] bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden z-[100] ring-1 ring-black/50 ${side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"} ${isClosing ? (side === "top" ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (side === "top" ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}
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
              const isSelected = selectedId === model.id;
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

      <div className="flex items-center h-[42px] border-t border-white/10 mt-1 bg-[#1c1c1c]">
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

const ModesMenu: React.FC<{
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  currentMode: Mode;
  onModeSelect: (mode: Mode) => void;
}> = ({ onClose, triggerRef, currentMode, onModeSelect }) => {
  const [side, setSide] = useState<"top" | "bottom">("top");
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
    const spacing = 8;
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

  return (
    <div
      ref={menuRef}
      className={`absolute left-0 w-[160px] bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden z-[100] ring-1 ring-black/50 p-1.5 ${side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"} ${isClosing ? (side === "top" ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (side === "top" ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}
    >
      {MODES.map((mode) => (
        <button
          key={mode.id}
          onClick={() => {
            onModeSelect(mode.id);
            handleClose();
          }}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium
            ${
              currentMode === mode.id
                ? "bg-[#2563eb] text-white"
                : "text-zinc-300 hover:bg-white/5 hover:text-white"
            }`}
        >
          <mode.icon size={16} strokeWidth={2.2} />
          <span>{mode.label}</span>
        </button>
      ))}
    </div>
  );
};

const ThemesMenu: React.FC<{
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onAuthRequired?: () => void;
}> = ({ onClose, triggerRef, onAuthRequired }) => {
  const [selectedId, setSelectedId] = useState("default");
  const [searchQuery, setSearchQuery] = useState("");
  const [side, setSide] = useState<"top" | "bottom">("top");
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
    const spacing = 8;
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

  const filteredThemes = THEMES.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      ref={menuRef}
      className={`absolute left-0 w-[240px] bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden z-[100] ring-1 ring-black/50 ${side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"} ${isClosing ? (side === "top" ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (side === "top" ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}
    >
      <div className="relative flex items-center px-4 py-3.5 border-b border-white/5 bg-[#1c1c1c]">
        <Search
          className="text-zinc-500 shrink-0 mr-3"
          size={18}
          strokeWidth={2.5}
        />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-transparent text-white text-[14px] placeholder-zinc-500 outline-none flex-1 leading-none font-normal"
          placeholder="Search themes..."

        />
      </div>

      <div className="flex-1 overflow-y-auto max-h-[260px] p-2 pt-0 no-scrollbar bg-[#1c1c1c]">
        <div className="px-2 pt-3.5 pb-2 text-[10.5px] font-bold text-zinc-500 uppercase tracking-widest">
          DEFAULT THEMES
        </div>
        <div className="space-y-0.5">
          {filteredThemes.map((theme) => {
            const isSelected = selectedId === theme.id;
            return (
              <button
                key={theme.id}
                onClick={() => setSelectedId(theme.id)}
                className={`w-full flex items-center justify-between px-3 py-[7px] rounded-lg text-[13.5px] font-medium group
                  ${
                    isSelected
                      ? "bg-[#2563eb] text-white shadow-lg shadow-blue-500/10"
                      : "text-zinc-300 hover:bg-white/5 hover:text-white"
                  }`}
              >
                <span>{theme.name}</span>
                <div className="flex items-center -space-x-1.5">
                  {theme.colors.map((color, i) => (
                    <div
                      key={i}
                      className={`w-[14px] h-[14px] rounded-full ring-[1.5px] relative
                        ${
                          isSelected
                            ? "ring-[#2563eb]"
                            : "ring-[#1c1c1c] group-hover:ring-[#2a2a2a]"
                        }`}
                      style={{ backgroundColor: color, zIndex: 3 - i }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center h-[42px] border-t border-white/10 mt-1 bg-[#1c1c1c]">
        <button 
          onClick={() => { onAuthRequired?.(); handleClose(); }}
          className="flex-1 flex items-center justify-center gap-2 text-[13px] font-medium text-white/70 hover:text-white hover:bg-white/5 h-full"
        >
          <Plus size={14} strokeWidth={2.5} />
          <span>Create new</span>
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

export const InputBar: React.FC<{
  currentMode: Mode;
  onModeChange: (mode: Mode) => void;
  onSubmit?: (prompt: string, mode: Mode) => void;
  modelConfig: any;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  onAuthRequired?: () => void;
  isAuthenticated?: boolean;
}> = ({ currentMode, onModeChange, onSubmit, modelConfig, selectedModelId, setSelectedModelId, onAuthRequired, isAuthenticated }) => {
  const [isThemesOpen, setIsThemesOpen] = useState(false);
  const [isModesOpen, setIsModesOpen] = useState(false);
  const [isModelsOpen, setIsModelsOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  
  // Get background type for conditional styling
  const { background } = useBackground();
  // Non-auth users always see 'lines' background, so styling should match
  const effectiveBackground = isAuthenticated ? background : 'lines';
  
  // Combine models to find the active one
  const ALL_MODELS = [
    ...modelConfig.gemini.savedModels.map((m: any) => ({ ...m, provider: 'Google' })),
    ...modelConfig.openai.savedModels.map((m: any) => ({ ...m, provider: 'OpenAI' })),
    ...modelConfig.anthropic.savedModels.map((m: any) => ({ ...m, provider: 'Anthropic' }))
  ].filter(m => m.name !== "Nano Banana Pro");

  // Sync selection with available models
  useEffect(() => {
    if (ALL_MODELS.length > 0) {
      if (!selectedModelId || !ALL_MODELS.find(m => m.id === selectedModelId)) {
        setSelectedModelId(ALL_MODELS[0].id);
      }
    } else {
      setSelectedModelId("");
    }
  }, [ALL_MODELS, selectedModelId]);

  const activeModel = ALL_MODELS.find(m => m.id === selectedModelId);

  // Helper to shorten names: "Gemini 3 Pro" -> "3 Pro", "Gemini 2.5 Flash Lite" -> "2.5 Lite"
  const getShortName = (name: string) => {
    if (!name) return "Model";
    if (name.includes("2.5 Flash Lite")) return "2.5 Lite";
    return name
      .replace(/Gemini\s+/g, '')
      .trim();
  };

  const themeButtonRef = useRef<HTMLButtonElement>(null);
  const modeButtonRef = useRef<HTMLButtonElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaResizeRafRef = useRef<number | null>(null);

  const CurrentModeIcon =
    MODES.find((m) => m.id === currentMode)?.icon || Rocket;

  // Submit prompt internally
  const handleSubmit = () => {
    if (promptText.trim()) {
      onSubmit?.(promptText.trim(), currentMode);
    }
  };

  // Handle Enter key press - Enter submits, Shift+Enter for new line
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    // Shift+Enter allows default behavior (new line)
  };

  // Auto-expand textarea - throttled with RAF to prevent lag
  useEffect(() => {
    if (textareaRef.current) {
      // Cancel any pending resize to avoid stacking
      if (textareaResizeRafRef.current) {
        cancelAnimationFrame(textareaResizeRafRef.current);
      }

      // Throttle resize to once per frame
      textareaResizeRafRef.current = requestAnimationFrame(() => {
        if (textareaRef.current) {
          // Revert to original static height (48px) to check if content overflows
          textareaRef.current.style.height = '48px';

          const scrollHeight = textareaRef.current.scrollHeight;
          if (scrollHeight > 48) {
            const newHeight = Math.min(scrollHeight, 300);
            textareaRef.current.style.height = `${newHeight}px`;
          }
        }
        textareaResizeRafRef.current = null;
      });
    }

    return () => {
      if (textareaResizeRafRef.current) {
        cancelAnimationFrame(textareaResizeRafRef.current);
      }
    };
  }, [promptText]);

  // Conditional background class: full opacity for 'waves' and 'solid', semi-transparent for 'lines'
  const promptBoxBg = effectiveBackground === 'lines' 
    ? 'bg-[#18181b]/70' 
    : 'bg-[#18181b]';
  
  // Conditional hover shadow: only for waves and lines, not solid
  const hoverShadow = effectiveBackground === 'solid' ? '' : 'hover:shadow-pink-500/5';

  return (
    <div className="w-full max-w-2xl mx-auto relative z-20">
      <div className={`${promptBoxBg} backdrop-blur-2xl border border-white/5 rounded-[1.75rem] p-2 shadow-2xl flex flex-col gap-1 ring-1 ring-white/5`}>
        <textarea
          ref={textareaRef}
          placeholder="Ask Willow to create an internal tool that..."
          className="w-full bg-transparent text-white placeholder-zinc-500 px-4 pt-2.5 pb-2 outline-none resize-none text-[15px] font-light leading-relaxed overflow-y-auto pr-2"
          style={{ height: '48px', minHeight: '48px', scrollbarGutter: 'stable' }}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="flex items-center justify-between px-2 pb-1">
          <div className="flex items-center gap-1.5">
            <button className="w-9 h-9 rounded-full border border-white/10 hover:border-white/20 bg-transparent hover:bg-white/5 flex items-center justify-center text-zinc-400 transition-all group">
              <Plus
                size={18}
                strokeWidth={2.5}
                className="group-hover:text-white"
              />
            </button>

            {/* Modes Selector Button */}
            <div className="relative">
              <button
                ref={modeButtonRef}
                onClick={() => setIsModesOpen(!isModesOpen)}
                className={`flex items-center gap-2 h-9 px-4 rounded-full text-[13px] font-semibold transition-all group border
                            ${
                              isModesOpen
                                ? "border-white/20 bg-white/5 text-white"
                                : "border-white/10 bg-transparent text-zinc-400 hover:border-white/20 hover:bg-white/5"
                            }`}
              >
                <CurrentModeIcon
                  size={16}
                  strokeWidth={2.2}
                  className={
                    isModesOpen ? "text-white" : "group-hover:text-white"
                  }
                />
                <span
                  className={
                    isModesOpen ? "text-white" : "group-hover:text-white"
                  }
                >
                  {MODES.find((m) => m.id === currentMode)?.label}
                </span>
                <ChevronDown
                  size={12}
                  className={`ml-0.5 ${
                    isModesOpen
                      ? "rotate-180 text-white"
                      : "group-hover:text-white opacity-60"
                  }`}
                />
              </button>
              {isModesOpen && (
                <ModesMenu
                  triggerRef={modeButtonRef}
                  currentMode={currentMode}
                  onModeSelect={onModeChange}
                  onClose={() => setIsModesOpen(false)}
                />
              )}
            </div>

            {/* Theme Selector Button */}
            <div className="relative">
              <button
                ref={themeButtonRef}
                onClick={() => setIsThemesOpen(!isThemesOpen)}
                className={`flex items-center gap-2 h-9 px-4 rounded-full text-[13px] font-semibold group transition-all border
                            ${
                              isThemesOpen
                                ? "border-white/20 bg-white/5 text-white"
                                : "border-white/10 bg-transparent text-zinc-400 hover:border-white/20 hover:bg-white/5"
                            }`}
              >
                <FileText
                  size={16}
                  strokeWidth={2.2}
                  className={
                    isThemesOpen ? "text-white" : "group-hover:text-white"
                  }
                />
                <span
                  className={
                    isThemesOpen ? "text-white" : "group-hover:text-white"
                  }
                >
                  Theme
                </span>
                <ChevronDown
                  size={12}
                  className={`ml-0.5 ${
                    isThemesOpen
                      ? "rotate-180 text-white"
                      : "group-hover:text-white opacity-60"
                  }`}
                />
              </button>

              {isThemesOpen && (
                <ThemesMenu
                  triggerRef={themeButtonRef}
                  onClose={() => setIsThemesOpen(false)}
                  onAuthRequired={onAuthRequired}
                />
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Model Selector Button */}
            <div className="relative">
              <button
                ref={modelButtonRef}
                onClick={() => setIsModelsOpen(!isModelsOpen)}
                className={`flex items-center gap-2 h-9 px-4 rounded-full text-[13px] font-semibold transition-all group border
                           ${
                             isModelsOpen
                               ? "border-white/20 bg-white/5 text-white"
                               : "border-white/10 bg-transparent text-zinc-400 hover:border-white/20 hover:bg-white/5"
                           }`}
              >
                <ModelIcon
                  size={16}
                  strokeWidth={2.2}
                  className={
                    isModelsOpen ? "text-white" : "group-hover:text-white"
                  }
                />
                <span
                  className={
                    isModelsOpen ? "text-white" : "group-hover:text-white"
                  }
                >
                  {activeModel ? getShortName(activeModel.name) : "Model"}
                </span>
                <ChevronDown
                  size={12}
                  className={`ml-0.5 ${
                    isModelsOpen
                      ? "rotate-180 text-white"
                      : "group-hover:text-white opacity-60"
                  }`}
                />
              </button>

              {isModelsOpen && (
                <ModelsMenu
                  triggerRef={modelButtonRef}
                  onClose={() => setIsModelsOpen(false)}
                  modelConfig={modelConfig}
                  selectedId={selectedModelId}
                  onSelect={setSelectedModelId}
                  onAuthRequired={onAuthRequired}
                />
              )}
            </div>

            <button className="text-zinc-400 hover:text-white p-2.5 transition-all active:scale-90">
              <AudioLines size={20} strokeWidth={2} />
            </button>
            <button
              onClick={handleSubmit}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 shadow-lg
                      ${
                        promptText.trim()
                          ? "bg-zinc-200 hover:bg-white text-black cursor-pointer"
                          : "bg-zinc-600 text-zinc-400 cursor-not-allowed"
                      }`}
              disabled={!promptText.trim()}
            >
              <ArrowUp size={20} strokeWidth={3} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
