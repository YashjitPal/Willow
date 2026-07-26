import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { PlusDropdownMenu } from './PlusDropdownMenu';
import { GeminiLiveSession, primeLiveChimes, playLiveChime } from '../lib/live';
import { useUserDataContext } from '../context/UserDataContext';
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
  Globe,
  X,
  Mic,
  Square,
  Lightbulb,
  ImagePlus,
  Telescope,
  BookOpen,
  SquarePen,
  Github,
  Copy,
} from "lucide-react";

const SpotifyIcon = ({ size = 20, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#1ed760" className={className}>
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.54.659.3 1.02zm1.44-3.3c-.301.42-.84.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
  </svg>
);

type ToolId = 'thinking' | 'images' | 'research' | 'web' | 'learn' | 'canvas' | 'github' | 'quizzes' | 'spotify';

interface ToolMetadata {
  id: ToolId;
  label: string;
  chipLabel: string;
  icon: React.ElementType;
}

const TOOLS: Record<ToolId, ToolMetadata> = {
  thinking: { id: 'thinking', label: 'Thinking', chipLabel: 'Think', icon: Lightbulb },
  images: { id: 'images', label: 'Create image', chipLabel: 'Image', icon: ImagePlus },
  research: { id: 'research', label: 'Deep research', chipLabel: 'Research', icon: Telescope },
  web: { id: 'web', label: 'Web search', chipLabel: 'Search', icon: Globe },
  learn: { id: 'learn', label: 'Study and learn', chipLabel: 'Learn', icon: BookOpen },
  canvas: { id: 'canvas', label: 'Canvas', chipLabel: 'Canvas', icon: SquarePen },
  github: { id: 'github', label: 'GitHub', chipLabel: 'GitHub', icon: Github },
  quizzes: { id: 'quizzes', label: 'Quizzes', chipLabel: 'Quizzes', icon: Copy },
  spotify: { id: 'spotify', label: 'Spotify', chipLabel: 'Spotify', icon: SpotifyIcon as any },
};

export interface Attachment {
  id: string;
  type: 'image' | 'file';
  url: string;
  name: string;
  extension: string;
  file: File;
}
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
  agentSwarmEnabled?: boolean;
  onSwarmToggle?: (enabled: boolean) => void;
}> = ({ onClose, triggerRef, modelConfig, selectedId, onSelect, onAuthRequired, agentSwarmEnabled, onSwarmToggle }) => {
  // Combine all saved models from all providers
  const ALL_MODELS = [
    ...modelConfig.gemini.savedModels.map((m: any) => ({ ...m, provider: 'Google' })),
      ...modelConfig.openai.savedModels.map((m: any) => ({ ...m, provider: 'OpenAI' })),
      ...modelConfig.anthropic.savedModels.map((m: any) => ({ ...m, provider: 'Anthropic' })),
      ...(modelConfig.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'Moonshot AI' })),
      ...(modelConfig.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'SpaceXAI' })),
      ...(modelConfig.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'Zhipu AI' }))
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

      {/* Agent Swarm Toggle */}
      <div className="px-3 py-2.5 border-t border-white/5 flex items-center justify-between bg-[#1c1c1c]">
        <div className="flex items-center gap-2.5">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="text-purple-400">
            <circle cx="12" cy="12" r="3"/>
            <circle cx="5" cy="5" r="2"/>
            <circle cx="19" cy="5" r="2"/>
            <circle cx="5" cy="19" r="2"/>
            <line x1="7" y1="7" x2="10" y2="10"/>
            <line x1="17" y1="7" x2="14" y2="10"/>
            <line x1="7" y1="17" x2="10" y2="14"/>
          </svg>
          <span className="text-[13px] font-medium text-zinc-300">Agent Swarm</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onSwarmToggle?.(!agentSwarmEnabled); }}
          className={`relative w-8 h-[18px] rounded-full transition-colors ${
            agentSwarmEnabled ? 'bg-purple-500' : 'bg-zinc-700'
          }`}
        >
          <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
            agentSwarmEnabled ? 'translate-x-[16px]' : 'translate-x-[2px]'
          }`} />
        </button>
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
  onSubmit?: (prompt: string, mode: Mode, attachments?: Attachment[]) => void;
  modelConfig: any;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  onAuthRequired?: () => void;
  isAuthenticated?: boolean;
  agentSwarmEnabled?: boolean;
  onSwarmToggle?: (enabled: boolean) => void;
  /** When true, hides the Ship/Chat/Design/Proto mode selector and forces submissions
   *  to use mode="chat". Used by the standalone Dashboard chat view. */
  chatVariant?: boolean;
  /** Chat live-voice session wiring. When `liveActive`, the empty-state send
   *  button becomes a stop control; otherwise it starts the session. Only
   *  consulted in `chatVariant` — Develop / Staging input is untouched. */
  liveActive?: boolean;
  onStartLive?: () => void;
  onStopLive?: () => void;
}> = ({ currentMode, onModeChange, onSubmit, modelConfig, selectedModelId, setSelectedModelId, onAuthRequired, isAuthenticated, agentSwarmEnabled, onSwarmToggle, chatVariant = false, liveActive = false, onStartLive, onStopLive }) => {
  const [isThemesOpen, setIsThemesOpen] = useState(false);
  const [isModesOpen, setIsModesOpen] = useState(false);
  const [isModelsOpen, setIsModelsOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const { apiKeys } = useUserDataContext();
  const [isDictating, setIsDictating] = useState(false);
  const dictationSessionRef = useRef<GeminiLiveSession | null>(null);
  const dictationPrevPromptRef = useRef<string>("");
  const promptTextRef = useRef(promptText);

  useEffect(() => {
    promptTextRef.current = promptText;
  }, [promptText]);

  useEffect(() => {
    return () => {
      dictationSessionRef.current?.stop();
    };
  }, []);

  const handleToggleDictation = () => {
    if (isDictating) {
      dictationSessionRef.current?.stop();
      dictationSessionRef.current = null;
      setIsDictating(false);
    } else {
      if (!isAuthenticated) {
        onAuthRequired?.();
        return;
      }
      const apiKey = apiKeys?.gemini?.[0];
      if (!apiKey) {
        alert("A Gemini API key is required for voice dictation. Please add one in Settings → Models.");
        return;
      }

      setIsDictating(true);
      dictationPrevPromptRef.current = promptText;

      const session = new GeminiLiveSession({
        apiKey,
        model: 'gemini-3.1-flash-live-preview',
        transcribeOnly: true,
        onUserTranscript: (full) => {
          const separator = dictationPrevPromptRef.current.trim() ? " " : "";
          setPromptText(dictationPrevPromptRef.current + separator + full);
        },
        onTurnComplete: () => {
          dictationPrevPromptRef.current = promptTextRef.current;
        },
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.error('[InputBar] Dictation error', err);
          setIsDictating(false);
          dictationSessionRef.current = null;
        },
        onClose: () => {
          setIsDictating(false);
          dictationSessionRef.current = null;
        }
      });

      dictationSessionRef.current = session;
      void session.start();
    }
  };
  const [isSolidExpanded, setIsSolidExpanded] = useState(false);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<ToolId | null>(null);
  const solidPlusRef = useRef<HTMLButtonElement>(null);
  const normalPlusRef = useRef<HTMLButtonElement>(null);
  
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const hasActiveAttachments = attachments.length > 0 && !attachments.every(att => removingIds.has(att.id));

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    
    const newAttachments: Attachment[] = Array.from(e.target.files).map(file => ({
      id: Math.random().toString(36).substring(7),
      type: file.type.startsWith('image/') ? 'image' : 'file',
      url: URL.createObjectURL(file),
      name: file.name,
      extension: file.name.split('.').pop() || 'file',
      file
    }));
    
    setAttachments(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setRemovingIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      setAttachments(prev => prev.filter(att => att.id !== id));
      setRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  };
  
  // Get background type for conditional styling
  const { background } = useBackground();
  // Non-auth users always see 'lines' background, so styling should match
  const effectiveBackground = isAuthenticated ? background : 'lines';
  
  // Combine models to find the active one
  const ALL_MODELS = [
    ...modelConfig.gemini.savedModels.map((m: any) => ({ ...m, provider: 'Google' })),
      ...modelConfig.openai.savedModels.map((m: any) => ({ ...m, provider: 'OpenAI' })),
      ...modelConfig.anthropic.savedModels.map((m: any) => ({ ...m, provider: 'Anthropic' })),
      ...(modelConfig.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'Moonshot AI' })),
      ...(modelConfig.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'SpaceXAI' })),
      ...(modelConfig.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'Zhipu AI' }))
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
    if (promptText.trim() || attachments.length > 0 || selectedTool) {
      onSubmit?.(promptText.trim(), chatVariant ? 'chat' : currentMode, attachments);
      setPromptText("");
      setAttachments([]);
      setSelectedTool(null);
    }
  };

  const ToolChip = ({ toolId, onRemove }: { toolId: ToolId, onRemove: () => void }) => {
    const tool = TOOLS[toolId];
    const Icon = tool.icon;
    const [isHovered, setIsHovered] = useState(false);

    // Refined light blue color (sky-200)
    const lightBlue = "#bae6fd"; 

    return (
      <div 
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`flex items-center gap-2 px-2.5 py-2.5 rounded-full transition-all duration-200 cursor-default select-none border-transparent ${
          isHovered 
            ? "bg-sky-500/10" 
            : "bg-transparent"
        }`}
      >
        {isHovered ? (
          <div 
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="w-4 h-4 rounded-full bg-sky-500/20 flex items-center justify-center hover:bg-sky-500/30 transition-colors cursor-pointer"
          >
            <X size={10} className="text-[#bae6fd]" strokeWidth={3} />
          </div>
        ) : (
          <Icon size={16} className="text-[#bae6fd]" strokeWidth={2.2} />
        )}
        <span className="text-[13.5px] font-medium leading-none text-[#bae6fd]">
          {tool.chipLabel}
        </span>
      </div>
    );
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
          const isSolid = effectiveBackground === 'solid';
          const baseHeight = isSolid ? 24 : 48;
          
          if (isSolid) {
            // Disable padding transition during measurement so scrollHeight reads are exact
            textareaRef.current.style.transition = 'none';

            const paddingRightVal = chatVariant ? '148px' : '76px';
            // Force narrow padding for measurement to see if it wraps inline
            textareaRef.current.style.paddingLeft = '38px';
            textareaRef.current.style.paddingRight = paddingRightVal;
            textareaRef.current.style.height = `${baseHeight}px`;
            
            const hypotheticalScrollHeight = textareaRef.current.scrollHeight;
            const shouldExpand = (hypotheticalScrollHeight > baseHeight) || !!selectedTool;
            
            setIsSolidExpanded(shouldExpand);
            
            // To prevent height glitch before React re-renders, 
            // force the target padding before calculating final height
            textareaRef.current.style.paddingLeft = shouldExpand ? '0px' : '38px';
            textareaRef.current.style.paddingRight = shouldExpand ? '0px' : paddingRightVal;
            
            textareaRef.current.style.height = `${baseHeight}px`;
            const scrollHeight = textareaRef.current.scrollHeight;
            
            if (scrollHeight > baseHeight) {
              const newHeight = Math.min(scrollHeight, 300);
              textareaRef.current.style.height = `${newHeight}px`;
            }
            
            // Clean up inline styles so Tailwind classes take over smoothly
            textareaRef.current.style.paddingLeft = '';
            textareaRef.current.style.paddingRight = '';
            // Re-enable transition (reflow first so the class padding is the "from" frame)
            void textareaRef.current.offsetHeight;
            textareaRef.current.style.transition = '';
          } else {
            textareaRef.current.style.height = `${baseHeight}px`;
            const scrollHeight = textareaRef.current.scrollHeight;
            if (scrollHeight > baseHeight) {
              const newHeight = Math.min(scrollHeight, 300);
              textareaRef.current.style.height = `${newHeight}px`;
            }
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
  }, [promptText, selectedTool]);

  // Conditional background class: full opacity for 'waves' and 'solid', semi-transparent for 'lines'
  const promptBoxBg = effectiveBackground === 'lines' 
    ? 'bg-[#18181b]/70' 
    : 'bg-[#18181b]';
  
  const hasContent = promptText.trim() || hasActiveAttachments || selectedTool;

  // Synchronous expand flag for the LEFT CLUSTER ONLY: when a tool is picked, the
  // chip mounts in the same render, so the left group's bottom/py must flip now
  // (not 1 frame later via useEffect) or the taller chip shoves Plus upward.
  // Container pb + textarea padding intentionally stay on isSolidExpanded so the
  // RAF sets them next frame and the 38→0 padding transition still plays.
  const solidExpanded = isSolidExpanded || !!selectedTool;

  if (effectiveBackground === 'solid') {
    return (
      <div className="w-full max-w-[760px] mx-auto relative z-20">
        <div className="w-full bg-[#2a2a2a] rounded-[28px] pl-4 pr-3 flex flex-col justify-center transition-all duration-200">
          
          {/* Attachments Area */}
          <div className={`grid transition-[grid-template-rows] duration-[250ms] ease-in-out ${hasActiveAttachments ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className={`flex gap-3 overflow-x-auto no-scrollbar pb-1 pt-4 px-1`}>
                {attachments.map((att) => (
                  <div key={att.id} className={`relative group flex-shrink-0 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}>
                    {att.type === 'image' ? (
                      <div className="relative">
                        <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1c]">
                           {/* eslint-disable-next-line @next/next/no-img-element */}
                           <img src={att.url} alt={att.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <button 
                          onClick={() => removeAttachment(att.id)}
                          className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10"
                        >
                            <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="h-16 min-w-[180px] bg-[#1c1c1c] rounded-2xl flex items-center px-4 gap-3.5 relative border border-white/5 hover:border-white/10 transition-colors">
                         <div className="text-gray-400">
                            <Globe size={24} strokeWidth={1.5} />
                         </div>
                         <div className="flex flex-col min-w-0">
                            <span className="text-[13px] font-semibold text-gray-200 truncate max-w-[120px] leading-tight">{att.name}</span>
                            <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">{att.extension}</span>
                         </div>
                         <button 
                           onClick={() => removeAttachment(att.id)}
                           className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10"
                         >
                            <X size={12} />
                         </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main Input Row */}
          <div className={`flex flex-col w-full relative transition-all duration-200 ${isSolidExpanded ? 'pt-4 pb-[52px]' : 'py-[16px] min-h-[56px]'}`}>
            <textarea 
              ref={textareaRef}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={(e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                const imageFiles: File[] = [];
                for (let i = 0; i < items.length; i++) {
                  if (items[i].type.startsWith('image/')) {
                    const file = items[i].getAsFile();
                    if (file) imageFiles.push(file);
                  }
                }
                if (imageFiles.length > 0) {
                  e.preventDefault();
                  const newAttachments: Attachment[] = imageFiles.map(file => ({
                    id: Math.random().toString(36).substring(7),
                    type: 'image' as const,
                    url: URL.createObjectURL(file),
                    name: file.name || `pasted-image.${file.type.split('/')[1] || 'png'}`,
                    extension: file.name?.split('.').pop() || file.type.split('/')[1] || 'png',
                    file
                  }));
                  setAttachments(prev => [...prev, ...newAttachments]);
                }
              }}
              placeholder="Ask anything" 
              style={{ height: '24px', minHeight: '24px', scrollbarGutter: 'stable' }}
              className={`w-full bg-transparent text-white placeholder-[#8e8e8e] outline-none text-[15.5px] font-normal resize-none overflow-y-auto transition-[padding] duration-200 ${isSolidExpanded ? 'pl-[0px] pr-[0px]' : `pl-[38px] ${chatVariant ? 'pr-[148px]' : 'pr-[76px]'}`}`}
            />

            <input 
              type="file" 
              multiple 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileSelect} 
            />
            <div className={`absolute shrink-0 flex items-center gap-2 z-[60] ${solidExpanded ? 'bottom-[6px] left-[0px]' : 'bottom-[16px] left-[0px]'}`}>
              <div className={`w-[30px] flex items-center justify-center ${solidExpanded ? 'py-2.5' : ''}`}>
                <button 
                  ref={solidPlusRef}
                  onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
                  className="text-[#a0a0a0] hover:text-white transition-colors outline-none"
                >
                  <Plus size={22} className="stroke-[2.5]" />
                </button>
                <PlusDropdownMenu 
                  isOpen={isPlusMenuOpen} 
                  onClose={() => setIsPlusMenuOpen(false)} 
                  onFileSelect={() => fileInputRef.current?.click()} 
                  buttonRef={solidPlusRef} 
                  onToolSelect={(id) => setSelectedTool(id as ToolId)}
                />
              </div>
              {selectedTool && (
                <div className="mt-[1px] animate-in fade-in zoom-in-95 duration-200">
                  <ToolChip toolId={selectedTool} onRemove={() => setSelectedTool(null)} />
                </div>
              )}
            </div>
            
            <div className={`absolute flex items-center gap-3 shrink-0 transition-all duration-200 ${solidExpanded ? 'bottom-[10px] right-[0px]' : 'bottom-[10px] right-[0px]'}`}>
              {chatVariant && (
                <div className="relative flex items-center shrink-0">
                  <button
                    ref={modelButtonRef}
                    onClick={() => setIsModelsOpen(!isModelsOpen)}
                    className="flex items-center gap-1.5 text-[14px] font-medium text-[#a0a0a0] hover:text-white transition-colors outline-none cursor-pointer"
                  >
                    <span>{activeModel ? getShortName(activeModel.name) : "Model"}</span>
                    <ChevronDown size={14} className={`stroke-[2.5] transition-transform duration-200 ${isModelsOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isModelsOpen && (
                    <ModelsMenu
                      triggerRef={modelButtonRef}
                      onClose={() => setIsModelsOpen(false)}
                      modelConfig={modelConfig}
                      selectedId={selectedModelId}
                      onSelect={setSelectedModelId}
                      onAuthRequired={onAuthRequired}
                      agentSwarmEnabled={agentSwarmEnabled}
                      onSwarmToggle={onSwarmToggle}
                    />
                  )}
                </div>
              )}
              <button 
                onClick={handleToggleDictation}
                title={isDictating ? "Stop voice dictation" : "Start voice dictation"}
                className={`transition-colors outline-none flex items-center justify-center mr-[2px] w-8 h-8 rounded-full cursor-pointer ${
                  isDictating 
                    ? 'text-blue-500 hover:text-blue-400 bg-blue-500/10 animate-pulse' 
                    : 'text-[#a0a0a0] hover:text-white'
                }`}
              >
                <Mic size={20} strokeWidth={1.8} />
              </button>
              <button
                onClick={() => {
                  if (hasContent) return handleSubmit();
                  if (!chatVariant) return;
                  // Empty input in chat → the AudioLines button is the Live
                  // toggle. Same 34×34 circle so footer height is unchanged
                  // and the Chat spacing math stays valid.
                  liveActive ? onStopLive?.() : onStartLive?.();
                }}
                title={
                  hasContent
                    ? undefined
                    : chatVariant
                      ? liveActive ? 'Stop live mode' : 'Start live voice chat'
                      : undefined
                }
                className={`w-[34px] h-[34px] rounded-full flex items-center justify-center shrink-0 transition-colors shadow-sm outline-none cursor-pointer ${
                  !hasContent && chatVariant && liveActive
                    ? 'bg-white hover:bg-zinc-200 ring-2 ring-white/30 animate-pulse'
                    : 'bg-white hover:bg-zinc-200'
                }`}
              >
                {hasContent ? (
                  <ArrowUp size={18} className="text-black stroke-[3]" />
                ) : chatVariant && liveActive ? (
                  <Square size={14} className="text-black fill-black" />
                ) : (
                  <AudioLines size={16} className="text-black stroke-[2.5]" />
                )}
              </button>
            </div>
          </div>
          
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto relative z-20">
      <div className={`${promptBoxBg} backdrop-blur-2xl border border-white/5 rounded-[1.75rem] p-2 shadow-2xl flex flex-col gap-1 ring-1 ring-white/5`}>
        {/* Attachments Area */}
        <div className={`grid transition-[grid-template-rows] duration-[250ms] ease-in-out ${attachments.length > 0 ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            <div className={`flex gap-3 overflow-x-auto no-scrollbar pb-3 px-3 pt-2`}>
              {attachments.map((att) => (
                <div key={att.id} className={`relative group flex-shrink-0 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}>
                  {att.type === 'image' ? (
                    <div className="relative">
                      <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1c]">
                         {/* eslint-disable-next-line @next/next/no-img-element */}
                         <img src={att.url} alt={att.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <button 
                        onClick={() => removeAttachment(att.id)}
                        className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10"
                      >
                          <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="h-16 min-w-[180px] bg-[#1c1c1c] rounded-2xl flex items-center px-4 gap-3.5 relative border border-white/5 hover:border-white/10 transition-colors">
                       <div className="text-gray-400">
                          <Globe size={24} strokeWidth={1.5} />
                       </div>
                       <div className="flex flex-col min-w-0">
                          <span className="text-[13px] font-semibold text-gray-200 truncate max-w-[120px] leading-tight">{att.name}</span>
                          <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">{att.extension}</span>
                       </div>
                       <button 
                         onClick={() => removeAttachment(att.id)}
                         className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10"
                       >
                          <X size={12} />
                       </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <textarea
          ref={textareaRef}
          placeholder="Ask Willow to create an internal tool that..."
          className="w-full bg-transparent text-white placeholder-zinc-500 px-4 pt-2.5 pb-2 outline-none resize-none text-[15px] font-light leading-relaxed overflow-y-auto pr-2"
          style={{ height: '48px', minHeight: '48px', scrollbarGutter: 'stable' }}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            const imageFiles: File[] = [];
            for (let i = 0; i < items.length; i++) {
              if (items[i].type.startsWith('image/')) {
                const file = items[i].getAsFile();
                if (file) imageFiles.push(file);
              }
            }

            if (imageFiles.length > 0) {
              e.preventDefault();
              const newAttachments: Attachment[] = imageFiles.map(file => ({
                id: Math.random().toString(36).substring(7),
                type: 'image' as const,
                url: URL.createObjectURL(file),
                name: file.name || `pasted-image.${file.type.split('/')[1] || 'png'}`,
                extension: file.name?.split('.').pop() || file.type.split('/')[1] || 'png',
                file
              }));
              setAttachments(prev => [...prev, ...newAttachments]);
            }
          }}
        />

        <div className="flex items-center justify-between px-2 pb-1">
          <div className="flex items-center gap-1.5">
            <input 
              type="file" 
              multiple 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileSelect} 
            />
            <div className="relative flex items-center gap-1.5 z-[60]">
              <button 
                ref={normalPlusRef}
                onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
                className="w-9 h-9 rounded-full border border-white/10 hover:border-white/20 bg-transparent hover:bg-white/5 flex items-center justify-center text-zinc-400 transition-all group">
                <Plus
                  size={18}
                  strokeWidth={2.5}
                  className="group-hover:text-white"
                />
              </button>
              <PlusDropdownMenu 
                isOpen={isPlusMenuOpen} 
                onClose={() => setIsPlusMenuOpen(false)} 
                onFileSelect={() => fileInputRef.current?.click()} 
                buttonRef={normalPlusRef} 
                onToolSelect={(id) => setSelectedTool(id as ToolId)}
              />
              {selectedTool && (
                <div className="ml-2">
                  <ToolChip toolId={selectedTool} onRemove={() => setSelectedTool(null)} />
                </div>
              )}
            </div>

            {/* Modes Selector Button (hidden in standalone chat variant) */}
            {!chatVariant && (
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
            )}

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
                  agentSwarmEnabled={agentSwarmEnabled}
                  onSwarmToggle={onSwarmToggle}
                />
              )}
            </div>

            <button className="text-zinc-400 hover:text-white p-2.5 transition-all active:scale-90">
              <AudioLines size={20} strokeWidth={2} />
            </button>
            <button
              onClick={() => {
                if (promptText.trim() || attachments.length > 0) return handleSubmit();
                if (!chatVariant) return;
                liveActive ? onStopLive?.() : onStartLive?.();
              }}
              title={
                !promptText.trim() && attachments.length === 0 && chatVariant
                  ? liveActive ? 'Stop live mode' : 'Start live voice chat'
                  : undefined
              }
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 shadow-lg
                      ${
                        promptText.trim() || attachments.length > 0
                          ? "bg-zinc-200 hover:bg-white text-black cursor-pointer"
                          : chatVariant
                            ? liveActive
                              ? "bg-zinc-200 hover:bg-white text-black cursor-pointer ring-2 ring-white/20 animate-pulse"
                              : "bg-zinc-200 hover:bg-white text-black cursor-pointer"
                            : "bg-zinc-600 text-zinc-400 cursor-not-allowed"
                      }`}
              disabled={!chatVariant && !promptText.trim() && attachments.length === 0}
            >
              {promptText.trim() || attachments.length > 0 ? (
                <ArrowUp size={20} strokeWidth={3} />
              ) : chatVariant ? (
                liveActive ? (
                  <Square size={14} className="fill-current" />
                ) : (
                  <AudioLines size={18} strokeWidth={2.2} />
                )
              ) : (
                <ArrowUp size={20} strokeWidth={3} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
