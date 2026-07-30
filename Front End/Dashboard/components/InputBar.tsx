import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { PlusDropdownMenu } from './PlusDropdownMenu';
import { useUserDataContext } from '../context/UserDataContext';
import { MaterialSymbol } from './ui/MaterialSymbol';
import { GeminiAttachmentCard } from './ui/GeminiAttachmentCard';
import { GithubImportDialog } from './GithubImportDialog';
import './InputBar.css';
import { transcribeRecordedAudio } from '../lib/transcription';
import { ComposerAttachment, createComposerAttachment } from '../lib/chatAttachments';
import {
  getModelGroupKey,
  getThinkingEffortLabel,
  ModelEffortRecord,
  sortModelEfforts,
} from '../lib/model-efforts';
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
  Copy,
  Check,
} from "lucide-react";

const SpotifyIcon = ({ size = 20, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#1ed760" className={className}>
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.54.659.3 1.02zm1.44-3.3c-.301.42-.84.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
  </svg>
);

type ToolId = 'thinking' | 'images' | 'research' | 'web' | 'learn' | 'canvas' | 'quizzes' | 'spotify';

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
  quizzes: { id: 'quizzes', label: 'Quizzes', chipLabel: 'Quizzes', icon: Copy },
  spotify: { id: 'spotify', label: 'Spotify', chipLabel: 'Spotify', icon: SpotifyIcon as any },
};

const TOOL_SYMBOLS: Partial<Record<ToolId, string>> = {
  thinking: 'lightbulb',
  images: 'add_photo_alternate',
  research: 'travel_explore',
  web: 'language',
  learn: 'school',
  canvas: 'draw',
  quizzes: 'quiz',
};

export type Attachment = ComposerAttachment;
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

type PickerModel = ModelEffortRecord;

const DICTATION_WAVE_MIN_HEIGHT = 4;
const DICTATION_WAVE_BAR_PITCH = 7;

const getDictationWaveHeight = (canvasHeight: number, normalizedLevel: number) => {
  const threeQuarterHeight = canvasHeight * 0.75;

  if (normalizedLevel <= 0.1) return DICTATION_WAVE_MIN_HEIGHT;
  if (normalizedLevel < 0.75) {
    return DICTATION_WAVE_MIN_HEIGHT
      + ((normalizedLevel - 0.1) / 0.65)
      * (threeQuarterHeight - DICTATION_WAVE_MIN_HEIGHT);
  }

  return threeQuarterHeight
    + ((normalizedLevel - 0.75) / 0.25)
    * (canvasHeight - threeQuarterHeight);
};

const drawDictationWaveBar = (
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  height: number,
  color: string,
) => {
  context.fillStyle = color;

  const x = centerX - 0.5;
  const y = centerY - height / 2;
  const width = 1;
  const radius = Math.min(0.5, height / 2);

  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
  context.fill();
};

const DictationWaveform = ({ stream }: { stream: MediaStream | null }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!container || !canvas || !context) return;

    let disposed = false;
    let animationFrame = 0;
    let sampleTimer = 0;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let audioSamples: Float32Array | null = null;

    let barsPerSide = 0;
    let targetHistory: number[] = [];
    let renderedHeights: number[] = [];
    let queuedLevels: number[] = [];
    let lastLevel = 0;
    let missedLevelUpdates = 0;
    let lastHistoryUpdate = 0;
    let audioMeterReady = false;
    const visualizerStartedAt = performance.now();

    const resizeCanvas = (width: number, height: number) => {
      const sideInset = window.matchMedia('(max-width: 767px)').matches ? 24 : 48;
      const nextWidth = Math.max(3, Math.floor(width - sideInset * 2));
      const nextHeight = Math.max(1, Math.floor(height || 24));
      const nextBarsPerSide = Math.floor(nextWidth / 2 / DICTATION_WAVE_BAR_PITCH);
      const dimensionsChanged = canvas.width !== nextWidth || canvas.height !== nextHeight;
      const waveBuffersMissing = targetHistory.length !== nextBarsPerSide + 1
        || renderedHeights.length !== nextBarsPerSide * 2 + 1;

      if (!dimensionsChanged && !waveBuffersMissing) return;

      if (dimensionsChanged) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      barsPerSide = nextBarsPerSide;
      targetHistory = Array(barsPerSide + 1).fill(DICTATION_WAVE_MIN_HEIGHT);
      renderedHeights = Array(barsPerSide * 2 + 1).fill(DICTATION_WAVE_MIN_HEIGHT);
    };

    const initialRect = container.getBoundingClientRect();
    resizeCanvas(initialRect.width || 200, initialRect.height || 24);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            resizeCanvas(entry.contentRect.width, entry.contentRect.height);
          }
        })
      : null;
    resizeObserver?.observe(container);

    const sampleAudio = () => {
      if (!analyser || !audioSamples) return;

      analyser.getFloatTimeDomainData(audioSamples);
      let sumOfSquares = 0;
      for (let index = 0; index < audioSamples.length; index += 1) {
        const sample = audioSamples[index];
        sumOfSquares += sample * sample;
      }

      queuedLevels.push(Math.sqrt(sumOfSquares / audioSamples.length));
    };

    const updateWaveHistory = (now: number) => {
      let level: number;

      if (queuedLevels.length > 0) {
        level = queuedLevels.shift() ?? 0;
        lastLevel = level;
        missedLevelUpdates = 0;
      } else if (!audioMeterReady) {
        // The browser can take a moment to initialize its analyser after the
        // microphone stream is acquired. Gemini still renders
        // its butterfly immediately, so keep a quiet living waveform on screen
        // during that warm-up rather than showing an apparently blank state.
        const elapsed = (now - visualizerStartedAt) / 1000;
        level = 0.022
          + Math.max(0, Math.sin(elapsed * 3.1)) * 0.012
          + Math.max(0, Math.sin(elapsed * 5.7 + 1.2)) * 0.006;
      } else {
        missedLevelUpdates += 1;
        level = missedLevelUpdates <= 3 ? lastLevel : 0;
      }

      const centerHeight = level > 0
        ? getDictationWaveHeight(
            canvas.height,
            Math.min(1, Math.max(0, level * 15)),
          )
        : DICTATION_WAVE_MIN_HEIGHT;

      targetHistory = [centerHeight, ...targetHistory];
      if (targetHistory.length > barsPerSide + 1) targetHistory.pop();
    };

    const render = (now: number) => {
      if (disposed) return;

      if (now - lastHistoryUpdate >= 30) {
        updateWaveHistory(now);
        lastHistoryUpdate = now;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);

      const centerY = canvas.height / 2;
      const barCount = barsPerSide * 2 + 1;
      const occupiedWidth = barCount + (barCount - 1) * 6;
      const startX = (canvas.width - occupiedWidth) / 2 + 0.5;
      const color = getComputedStyle(canvas)
        .getPropertyValue('--willow-dictation-wave-color')
        .trim() || '#e0e0e0';

      for (let index = 0; index < barCount; index += 1) {
        const distanceFromCenter = Math.abs(index - barsPerSide);
        const targetHeight = Math.max(
          DICTATION_WAVE_MIN_HEIGHT,
          (targetHistory[distanceFromCenter] || DICTATION_WAVE_MIN_HEIGHT)
            * (1 - distanceFromCenter / (barsPerSide + 1)),
        );

        renderedHeights[index] += (targetHeight - renderedHeights[index]) * 0.25;
        drawDictationWaveBar(
          context,
          startX + index * DICTATION_WAVE_BAR_PITCH,
          centerY,
          renderedHeights[index],
          color,
        );
      }

      animationFrame = requestAnimationFrame(render);
    };

    async function initAudio() {
      if (!stream) return;
      try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        audioSamples = new Float32Array(analyser.fftSize);
        await audioCtx.resume().catch(() => undefined);
        audioMeterReady = true;
      } catch {
        // Keep the immediate low-amplitude butterfly when metering is unavailable.
      }
    }

    sampleTimer = window.setInterval(sampleAudio, 50);
    animationFrame = requestAnimationFrame(render);
    initAudio();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      window.clearInterval(sampleTimer);
      resizeObserver?.disconnect();
      if (audioCtx) void audioCtx.close();
    };
  }, [stream]);

  return (
    <div
      ref={containerRef}
      className="willow-butterfly-wave-view entering-dictation"
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="willow-butterfly-wave-canvas" />
    </div>
  );
};

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
    if (group.variants.length > 1) return sortModelEfforts(group.variants);

    const base = group.variants[0];
    const provider = String(base.provider || '').toLowerCase();
    const modelId = String(base.modelId || base.id || base.name || '').toLowerCase();

    let maxLevel = 3;
    if (provider.includes('openai') || modelId.includes('gpt')) {
      maxLevel = 6; // Low (1), Medium (2), High (3), Extra High (4), Max (5), Pro (6)
    } else if (modelId.includes('kimi-k3')) {
      maxLevel = 4; // Low (1), Medium (2), High (3), Max (4)
    }

    const result: PickerModel[] = [];
    for (let lvl = 1; lvl <= maxLevel; lvl++) {
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

  const selectedGroup = groupedModels.find((group) =>
    group.variants.some((model) => model.id === selectedId || selectedId.startsWith(`${model.id}::effort-`))
  ) || groupedModels[0];

  const selectedEfforts = getEffortsForGroup(selectedGroup);
  const selectedEffort = selectedEfforts.find((model) => model.id === selectedId) || selectedEfforts.find((m) => m.thinkingLevel === 3) || selectedEfforts[0];

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
              const model = group.variants.find((variant) => variant.id === selectedId) || group.variants[0];
              const isSelected = group.variants.some((variant) => variant.id === selectedId);
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
                    const isSelected = selectedId === model.id;
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
      className={`absolute left-0 w-[160px] bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden z-[100] ring-1 ring-black/50 p-1.5 ${side === "top" ? "bottom-[calc(100%+8px)] origin-bottom-left" : "top-[calc(100%+8px)] origin-top-left"} ${isClosing ? (side === "top" ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (side === "top" ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}
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
      className={`absolute left-0 w-[240px] bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden z-[100] ring-1 ring-black/50 ${side === "top" ? "bottom-[calc(100%+8px)] origin-bottom-left" : "top-[calc(100%+8px)] origin-top-left"} ${isClosing ? (side === "top" ? 'animate-dropdownCloseUp' : 'animate-dropdownClose') : (side === "top" ? 'animate-dropdownOpenUp' : 'animate-dropdownOpen')}`}
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
  /** When true, hides the Ship/Chat/Design/Proto mode selector and forces submissions
   *  to use mode="chat". Used by the standalone Dashboard chat view. */
  chatVariant?: boolean;
  /** Shows the AI disclaimer beneath the bottom-docked composer after a chat starts. */
  showDisclaimer?: boolean;
  /** Chat live-voice session wiring. When `liveActive`, the empty-state send
   *  button becomes a stop control; otherwise it starts the session. Only
   *  consulted in `chatVariant` — Develop / Staging input is untouched. */
  liveActive?: boolean;
  onStartLive?: () => void;
  onStopLive?: () => void;
}> = ({ currentMode, onModeChange, onSubmit, modelConfig, selectedModelId, setSelectedModelId, onAuthRequired, isAuthenticated, chatVariant = false, showDisclaimer = false, liveActive = false, onStartLive, onStopLive }) => {
  const [isThemesOpen, setIsThemesOpen] = useState(false);
  const [isModesOpen, setIsModesOpen] = useState(false);
  const [isModelsOpen, setIsModelsOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [isComposerMaximized, setIsComposerMaximized] = useState(false);
  const [canMaximizeComposer, setCanMaximizeComposer] = useState(false);
  const [collapsedChatPaddingRight, setCollapsedChatPaddingRight] = useState(204);
  const { apiKeys } = useUserDataContext();
  const [dictationPhase, setDictationPhaseState] = useState<'idle' | 'recording' | 'processing' | 'revealing'>('idle');
  const [dictationStream, setDictationStream] = useState<MediaStream | null>(null);
  const [dictationPlaceholder, setDictationPlaceholder] = useState<string | null>(null);
  const [isMicRippling, setIsMicRippling] = useState(false);
  const dictationPrevPromptRef = useRef<string>("");
  const dictationSelectionRef = useRef({ start: 0, end: 0 });
  const dictationPhaseRef = useRef(dictationPhase);
  const dictationRequestIdRef = useRef(0);
  const dictationRecorderRef = useRef<MediaRecorder | null>(null);
  const dictationStreamRef = useRef<MediaStream | null>(null);
  const dictationAbortRef = useRef<AbortController | null>(null);
  const dictationRevealTimerRef = useRef<number | null>(null);
  const dictationPlaceholderTimerRef = useRef<number | null>(null);
  const promptTextRef = useRef(promptText);
  const isDictating = dictationPhase === 'recording';
  const isTranscribingDictation = dictationPhase === 'processing';
  const isDictationActive = isDictating || isTranscribingDictation;
  const isExitingDictation = dictationPhase === 'revealing';

  const setDictationPhase = useCallback((phase: typeof dictationPhase) => {
    dictationPhaseRef.current = phase;
    setDictationPhaseState(phase);
  }, []);

  useEffect(() => {
    promptTextRef.current = promptText;
  }, [promptText]);

  const releaseDictationStream = useCallback((stream?: MediaStream | null) => {
    const targetStream = stream || dictationStreamRef.current;
    targetStream?.getTracks().forEach((track) => track.stop());
    if (!stream || dictationStreamRef.current === stream) {
      dictationStreamRef.current = null;
    }
    setDictationStream((current) => current === targetStream ? null : current);
  }, []);

  const surfaceDictationError = useCallback((message: string) => {
    console.warn('[Dictation]', message);
    setDictationPlaceholder(message);
    if (dictationPlaceholderTimerRef.current) {
      window.clearTimeout(dictationPlaceholderTimerRef.current);
    }
    dictationPlaceholderTimerRef.current = window.setTimeout(() => {
      setDictationPlaceholder(null);
      dictationPlaceholderTimerRef.current = null;
    }, 3200);
  }, []);

  const revealDictationResult = useCallback((
    requestId: number,
    rawTranscript: string,
    errorMessage?: string,
  ) => {
    if (dictationRequestIdRef.current !== requestId) return;

    dictationAbortRef.current = null;
    const transcript = rawTranscript.trim();
    const basePrompt = dictationPrevPromptRef.current;
    const selectionStart = Math.max(0, Math.min(dictationSelectionRef.current.start, basePrompt.length));
    const selectionEnd = Math.max(selectionStart, Math.min(dictationSelectionRef.current.end, basePrompt.length));
    let nextPrompt = basePrompt;
    let nextCaret = selectionStart;

    if (transcript) {
      const before = basePrompt.slice(0, selectionStart);
      const after = basePrompt.slice(selectionEnd);
      const leadingSpace = before && !/\s$/.test(before) ? ' ' : '';
      const trailingSpace = after && !/^\s/.test(after) ? ' ' : '';
      nextPrompt = `${before}${leadingSpace}${transcript}${trailingSpace}${after}`;
      nextCaret = before.length + leadingSpace.length + transcript.length;
      promptTextRef.current = nextPrompt;
      setPromptText(nextPrompt);
      setDictationPlaceholder(null);
    } else if (errorMessage) {
      surfaceDictationError(errorMessage);
    }

    setDictationPhase('revealing');
    if (dictationRevealTimerRef.current) {
      window.clearTimeout(dictationRevealTimerRef.current);
    }
    dictationRevealTimerRef.current = window.setTimeout(() => {
      if (dictationRequestIdRef.current !== requestId) return;
      setDictationPhase('idle');
      dictationRevealTimerRef.current = null;
    }, 350);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });
    });
  }, [setDictationPhase, surfaceDictationError]);

  const stopDictationRecording = useCallback(() => {
    if (dictationPhaseRef.current !== 'recording') return;
    setDictationPhase('processing');

    const recorder = dictationRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
        return;
      } catch {
        // Fall through to the empty-result recovery below.
      }
    }

    releaseDictationStream();
    revealDictationResult(
      dictationRequestIdRef.current,
      '',
      "Didn't catch that. Try speaking again.",
    );
  }, [releaseDictationStream, revealDictationResult, setDictationPhase]);

  const startDictationRecording = useCallback(async () => {
    const requestId = ++dictationRequestIdRef.current;
    if (dictationRevealTimerRef.current) {
      window.clearTimeout(dictationRevealTimerRef.current);
      dictationRevealTimerRef.current = null;
    }
    dictationAbortRef.current?.abort();
    dictationAbortRef.current = null;
    releaseDictationStream();
    setDictationPlaceholder(null);
    setIsModelsOpen(false);
    setIsPlusMenuOpen(false);
    if (isComposerMaximized) setIsComposerMaximized(false);

    const textarea = textareaRef.current;
    const basePrompt = promptTextRef.current;
    dictationPrevPromptRef.current = basePrompt;
    dictationSelectionRef.current = {
      start: textarea?.selectionStart ?? basePrompt.length,
      end: textarea?.selectionEnd ?? basePrompt.length,
    };
    setDictationPhase('recording');

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Voice recording is not supported in this browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (
        dictationRequestIdRef.current !== requestId
        || dictationPhaseRef.current !== 'recording'
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      dictationStreamRef.current = stream;
      setDictationStream(stream);
      const preferredMimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
      ].find((mimeType) => MediaRecorder.isTypeSupported?.(mimeType));
      const recorder = new MediaRecorder(stream, preferredMimeType ? { mimeType: preferredMimeType } : undefined);
      const recordedChunks: Blob[] = [];
      dictationRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
      };

      recorder.onerror = () => {
        if (dictationRequestIdRef.current !== requestId) return;
        dictationRecorderRef.current = null;
        releaseDictationStream(stream);
        revealDictationResult(requestId, '', 'Voice recording stopped unexpectedly. Try again.');
      };

      recorder.onstop = async () => {
        if (dictationRecorderRef.current === recorder) dictationRecorderRef.current = null;
        const audio = new Blob(recordedChunks, {
          type: recorder.mimeType || preferredMimeType || 'audio/webm',
        });
        releaseDictationStream(stream);

        if (dictationRequestIdRef.current !== requestId) return;
        if (dictationPhaseRef.current === 'revealing' || dictationPhaseRef.current === 'idle') return;
        if (dictationPhaseRef.current === 'recording') setDictationPhase('processing');
        if (!audio.size) {
          revealDictationResult(requestId, '', "Didn't catch that. Try speaking again.");
          return;
        }

        const controller = new AbortController();
        dictationAbortRef.current = controller;
        try {
          const transcript = await transcribeRecordedAudio({
            audio,
            apiKeys,
            modelConfig,
            signal: controller.signal,
          });
          revealDictationResult(
            requestId,
            transcript,
            transcript ? undefined : "Didn't catch that. Try speaking again.",
          );
        } catch (error) {
          if (controller.signal.aborted || dictationRequestIdRef.current !== requestId) return;
          revealDictationResult(
            requestId,
            '',
            error instanceof Error ? error.message : 'Voice transcription failed. Try again.',
          );
        }
      };

      recorder.start();
    } catch (error) {
      releaseDictationStream();
      revealDictationResult(
        requestId,
        '',
        error instanceof Error ? error.message : 'Voice recording could not be started.',
      );
    }
  }, [apiKeys, isComposerMaximized, modelConfig, releaseDictationStream, revealDictationResult, setDictationPhase]);

  useEffect(() => () => {
    dictationRequestIdRef.current += 1;
    dictationAbortRef.current?.abort();
    if (dictationRevealTimerRef.current) window.clearTimeout(dictationRevealTimerRef.current);
    if (dictationPlaceholderTimerRef.current) window.clearTimeout(dictationPlaceholderTimerRef.current);
    const recorder = dictationRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    }
    releaseDictationStream();
  }, [releaseDictationStream]);

  const handleToggleDictation = () => {
    if (isTranscribingDictation) return;
    setIsMicRippling(true);
    window.setTimeout(() => setIsMicRippling(false), 400);

    if (isDictating) {
      stopDictationRecording();
    } else {
      void startDictationRecording();
    }
  };
  const [isSolidExpanded, setIsSolidExpanded] = useState(false);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [isGithubImportOpen, setIsGithubImportOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<ToolId | null>(null);
  const solidPlusRef = useRef<HTMLButtonElement>(null);
  const normalPlusRef = useRef<HTMLButtonElement>(null);
  
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const hasActiveAttachments = attachments.length > 0 && !attachments.every(att => removingIds.has(att.id));

  const addFilesAsAttachments = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const newAttachments = files.map(createComposerAttachment);
    setAttachments(prev => [...prev, ...newAttachments]);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    addFilesAsAttachments(Array.from(e.target.files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setRemovingIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      setAttachments(prev => {
        const removed = prev.find(att => att.id === id);
        if (removed?.url) URL.revokeObjectURL(removed.url);
        return prev.filter(att => att.id !== id);
      });
      setRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  };

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => () => {
    for (const attachment of attachmentsRef.current) {
      if (attachment.url) URL.revokeObjectURL(attachment.url);
    }
  }, []);
  
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
      .replace(/Gemini\s+/gi, '')
      .replace(/\s+Extended$/gi, '')
      .trim();
  };

  const activeModelDisplayLabel = activeModel ? getShortName(activeModel.name) : 'Model';
  const activeEffortDisplayLabel = activeModel && Number(activeModel.thinkingLevel || 0) > 0
    ? getThinkingEffortLabel(activeModel)
    : '';
  const activeModelAndEffortLabel = [activeModelDisplayLabel, activeEffortDisplayLabel]
    .filter(Boolean)
    .join(' ');

  const themeButtonRef = useRef<HTMLButtonElement>(null);
  const modeButtonRef = useRef<HTMLButtonElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const rightControlsRef = useRef<HTMLDivElement>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaResizeRafRef = useRef<number | null>(null);

  const toggleComposerMaximized = () => {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? promptText.length;
    const selectionEnd = textarea?.selectionEnd ?? promptText.length;

    setIsModelsOpen(false);
    setIsPlusMenuOpen(false);
    setIsComposerMaximized((current) => !current);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const nextTextarea = textareaRef.current;
        if (!nextTextarea) return;
        nextTextarea.focus();
        nextTextarea.setSelectionRange(selectionStart, selectionEnd);
      });
    });
  };

  useEffect(() => {
    if (!isComposerMaximized) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isComposerMaximized]);

  useEffect(() => {
    if (!isComposerMaximized) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isModelsOpen || isPlusMenuOpen) return;
      event.preventDefault();
      toggleComposerMaximized();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isComposerMaximized, isModelsOpen, isPlusMenuOpen]);

  const CurrentModeIcon =
    MODES.find((m) => m.id === currentMode)?.icon || Rocket;

  // Submit prompt internally
  const handleSubmit = () => {
    if (promptText.trim() || attachments.length > 0 || selectedTool) {
      const submittedAttachments = attachments;
      onSubmit?.(promptText.trim(), chatVariant ? 'chat' : currentMode, submittedAttachments);
      setPromptText("");
      setAttachments([]);
      attachmentsRef.current = [];
      window.setTimeout(() => {
        for (const attachment of submittedAttachments) {
          if (attachment.url) URL.revokeObjectURL(attachment.url);
        }
      }, 0);
      setSelectedTool(null);
      setIsComposerMaximized(false);
      setCanMaximizeComposer(false);
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
            {chatVariant
              ? <MaterialSymbol name="close" size={12} weight={500} className="text-[#bae6fd]" />
              : <X size={10} className="text-[#bae6fd]" strokeWidth={3} />}
          </div>
        ) : (
          chatVariant && TOOL_SYMBOLS[toolId]
            ? <MaterialSymbol name={TOOL_SYMBOLS[toolId]!} size={18} className="text-[#bae6fd]" />
            : <Icon size={16} className="text-[#bae6fd]" strokeWidth={2.2} />
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
          if (isDictationActive) {
            textareaRef.current.style.transition = 'none';
            textareaRef.current.style.height = '24px';
            textareaRef.current.style.overflowY = 'hidden';
            textareaRef.current.style.scrollbarGutter = 'stable';
            setIsSolidExpanded(false);
            setCanMaximizeComposer(false);
            textareaResizeRafRef.current = null;
            return;
          }

          const isSolid = chatVariant || effectiveBackground === 'solid';
          const baseHeight = isSolid ? 24 : 48;
          
          if (isSolid) {
            // Disable padding transition during measurement so scrollHeight reads are exact
            textareaRef.current.style.transition = 'none';
            // Never let the temporary one-row measurement create a scrollbar.
            // A scrollbar narrows the editor, which can make scrollHeight report
            // one more wrapped line than the final, scrollbar-free textarea uses.
            textareaRef.current.style.overflowY = 'hidden';

            const collapsedPaddingLeftVal = '40px';
            const collapsedPaddingRightVal = chatVariant ? `${collapsedChatPaddingRight}px` : '76px';
            // Gemini's multiline editor begins 24px inside the prompt shell.
            // Willow's shell already contributes 14px left / 15px right, so
            // only the remaining inset belongs on the expanded textarea.
            const expandedPaddingLeftVal = chatVariant ? '10px' : '0px';
            // Gemini permanently reserves the same compact right-side inset,
            // including before its fullscreen control becomes visible. This
            // prevents the editor width (and therefore wrapping) from jumping
            // when the third line reveals the control.
            const expandedPaddingRightVal = chatVariant ? '24px' : '0px';
            // Force narrow padding for measurement to see if it wraps inline
            textareaRef.current.style.scrollbarGutter = 'stable';
            textareaRef.current.style.paddingLeft = collapsedPaddingLeftVal;
            textareaRef.current.style.paddingRight = collapsedPaddingRightVal;
            textareaRef.current.style.height = `${baseHeight}px`;
            
            const hypotheticalScrollHeight = textareaRef.current.scrollHeight;
            const shouldExpand = (chatVariant && isComposerMaximized)
              || (hypotheticalScrollHeight > baseHeight)
              || !!selectedTool;
            
            setIsSolidExpanded(shouldExpand);
            textareaRef.current.style.scrollbarGutter = shouldExpand ? 'auto' : 'stable';
            
            // To prevent height glitch before React re-renders, 
            // force the target padding before calculating final height
            textareaRef.current.style.paddingLeft = shouldExpand
              ? expandedPaddingLeftVal
              : collapsedPaddingLeftVal;
            textareaRef.current.style.paddingRight = shouldExpand
              ? expandedPaddingRightVal
              : collapsedPaddingRightVal;

            textareaRef.current.style.height = `${baseHeight}px`;
            const naturalExpandedScrollHeight = textareaRef.current.scrollHeight;
            const nextCanMaximizeComposer = chatVariant
              && shouldExpand
              && naturalExpandedScrollHeight >= baseHeight * 3;
            setCanMaximizeComposer(nextCanMaximizeComposer);

            textareaRef.current.style.paddingRight = shouldExpand
              ? expandedPaddingRightVal
              : collapsedPaddingRightVal;
            textareaRef.current.style.height = `${baseHeight}px`;
            const scrollHeight = textareaRef.current.scrollHeight;
            const maxTextareaHeight = chatVariant ? 168 : 300;

            if (chatVariant && isComposerMaximized) {
              textareaRef.current.style.height = '100%';
              textareaRef.current.style.overflowY = 'auto';
            } else if (scrollHeight > baseHeight) {
              const newHeight = Math.min(scrollHeight, maxTextareaHeight);
              textareaRef.current.style.height = `${newHeight}px`;
              textareaRef.current.style.overflowY = scrollHeight > maxTextareaHeight ? 'auto' : 'hidden';
            } else {
              textareaRef.current.style.overflowY = 'hidden';
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
  }, [promptText, selectedTool, chatVariant, effectiveBackground, isComposerMaximized, collapsedChatPaddingRight, isDictationActive]);

  // Conditional background class: full opacity for 'waves' and 'solid', semi-transparent for 'lines'
  const promptBoxBg = effectiveBackground === 'lines' 
    ? 'bg-[#1e1f21]/70' 
    : 'bg-[#1e1f21]';
  
  const hasContent = promptText.trim() || hasActiveAttachments || selectedTool;

  // Synchronous expand flag for the LEFT CLUSTER ONLY: when a tool is picked, the
  // chip mounts in the same render, so the left group's bottom/py must flip now
  // (not 1 frame later via useEffect) or the taller chip shoves Plus upward.
  // Container pb + textarea padding intentionally stay on isSolidExpanded so the
  // RAF sets them next frame and the collapsed→multiline padding transition
  // still plays without disturbing the attachment-row expansion.
  const solidExpanded = isDictationActive
    ? false
    : isSolidExpanded || !!selectedTool || (chatVariant && isComposerMaximized);
  const composerPaddingExpanded = isDictationActive ? false : isSolidExpanded;
  const showComposerMaximizeToggle = chatVariant
    && !isDictationActive
    && (canMaximizeComposer || isComposerMaximized);

  const githubImportDialog = (
    <GithubImportDialog
      open={isGithubImportOpen}
      onClose={() => setIsGithubImportOpen(false)}
      onImported={(attachment) => {
        setAttachments((current) => [...current, attachment]);
        setSelectedTool(null);
      }}
      onFolderSelected={addFilesAsAttachments}
    />
  );

  // The single-line editor must end before the model pill, regardless of how
  // long the selected model/effort label becomes. Measure the rendered control
  // group instead of relying on the previous fixed 204px reservation.
  useLayoutEffect(() => {
    if (!chatVariant || solidExpanded || isDictationActive) return;

    const controls = rightControlsRef.current;
    const modelButton = modelButtonRef.current;
    const micButton = micButtonRef.current;
    if (!controls || !modelButton || !micButton) return;

    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const controlsRect = controls.getBoundingClientRect();
      const modelRect = modelButton.getBoundingClientRect();
      const micRect = micButton.getBoundingClientRect();

      const occupiedWidthFromModelPill = controlsRect.right - modelRect.left;
      const modelToMicControlGap = Math.max(0, micRect.left - modelRect.right);
      // Account for the mic glyph's side bearing so this is an optical gap,
      // matching the visible pill-to-mic distance rather than button boxes.
      const opticalGap = Math.max(12, modelToMicControlGap + (micRect.width - 24) / 2);
      const nextPadding = Math.ceil(occupiedWidthFromModelPill + opticalGap);

      setCollapsedChatPaddingRight((current) => current === nextPadding ? current : nextPadding);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    observer.observe(modelButton);
    observer.observe(micButton);
    void document.fonts?.ready.then(measure);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [chatVariant, solidExpanded, isDictationActive, activeModelAndEffortLabel]);

  // The empty-state composer intentionally sits slightly above the viewport's
  // vertical center while collapsed. Once fullscreen is opened, Gemini centers
  // the enlarged shell itself instead, leaving equal space above and below it.
  // Translate only that one state so closing fullscreen restores the existing
  // elevated empty-state position and the active-chat footer is unaffected.
  useLayoutEffect(() => {
    const shell = composerShellRef.current;
    if (!shell) return;

    if (!chatVariant || !isComposerMaximized || showDisclaimer) {
      shell.style.translate = '';
      return;
    }

    const centerFullscreenShell = () => {
      // Measure from the shell's unshifted flow position on every pass so a
      // viewport resize cannot compound the previous centering offset.
      shell.style.translate = '0 0';
      const shellRect = shell.getBoundingClientRect();
      const centeredTop = (window.innerHeight - shellRect.height) / 2;
      shell.style.translate = `0 ${Math.round(centeredTop - shellRect.top)}px`;
    };

    centerFullscreenShell();
    window.addEventListener('resize', centerFullscreenShell);

    return () => {
      window.removeEventListener('resize', centerFullscreenShell);
      shell.style.translate = '';
    };
  }, [chatVariant, isComposerMaximized, showDisclaimer]);

  if (chatVariant || effectiveBackground === 'solid') {
    return (
      <div
        ref={composerShellRef}
        className={`w-full mx-auto relative ${isComposerMaximized && chatVariant ? 'z-[120]' : 'z-20'} ${chatVariant ? 'max-w-[660px]' : 'max-w-[760px]'}`}
        style={{
          '--chat-collapsed-right-padding': `${collapsedChatPaddingRight}px`,
        } as React.CSSProperties}
      >
        {githubImportDialog}
        <div className={`relative w-full flex flex-col ${chatVariant ? `willow-gemini-composer ${isComposerMaximized ? 'willow-gemini-composer--fullscreen min-h-0 justify-start' : 'justify-center'}` : 'transition-all duration-200 justify-center'} ${chatVariant ? 'bg-[#1e1f21] rounded-[32px] pl-[14px] pr-[15px] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.16)]' : 'bg-[#1e1f21] rounded-[28px] pl-4 pr-3'}`}>
          
          {/* Attachments Area */}
          <div className={`grid transition-[grid-template-rows] duration-[250ms] ease-in-out ${hasActiveAttachments ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="flex max-h-[168px] gap-2 overflow-x-auto px-3 pb-2 pt-3 pr-[54px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {attachments.map((att) => (
                  <div key={att.id} className={`relative group flex-shrink-0 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}>
                    <GeminiAttachmentCard
                      attachment={att}
                      variant="composer"
                      onRemove={() => removeAttachment(att.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main Input Row */}
          <div className={`textarea-wrapper flex flex-col w-full relative ${chatVariant ? 'transition-[padding] duration-[400ms] ease-[cubic-bezier(0.2,0,0,1)]' : 'transition-all duration-200'} ${isComposerMaximized && chatVariant ? 'flex-1 min-h-0 pt-4 pb-[62px]' : composerPaddingExpanded ? chatVariant ? 'pt-4 pb-[62px]' : 'pt-4 pb-[52px]' : chatVariant ? 'py-[20px] min-h-[64px]' : 'py-[16px] min-h-[56px]'}`}>
            {chatVariant && !isDictationActive && (
              <button
                type="button"
                onClick={toggleComposerMaximized}
                className={`absolute right-[-7px] top-[8px] z-[70] flex h-10 w-10 items-center justify-center rounded-full p-2 text-[#c4c7c5] transition-[opacity,transform,background-color] duration-[300ms] delay-[100ms] ease-[cubic-bezier(0.2,0,0,1)] hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${showComposerMaximizeToggle ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-[0.8] opacity-0'}`}
                aria-label="Expand input to Fullscreen"
                aria-pressed={isComposerMaximized}
                aria-hidden={!showComposerMaximizeToggle}
                tabIndex={showComposerMaximizeToggle ? 0 : -1}
                title="Expand input to Fullscreen"
              >
                <MaterialSymbol
                  family="google-symbols"
                  name={isComposerMaximized ? 'collapse_content' : 'expand_content'}
                  size={20}
                  weight={400}
                  roundness={0}
                />
              </button>
            )}
            <textarea 
              ref={textareaRef}
              value={promptText}
              aria-hidden={chatVariant && isDictationActive ? true : undefined}
              aria-busy={chatVariant && isTranscribingDictation ? true : undefined}
              tabIndex={chatVariant && isDictationActive ? -1 : undefined}
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
                  const newAttachments = imageFiles.map(createComposerAttachment);
                  setAttachments(prev => [...prev, ...newAttachments]);
                }
              }}
              placeholder={dictationPlaceholder || (chatVariant ? "Ask Willow" : "Ask anything")}
              style={{
                height: '24px',
                minHeight: '24px',
                scrollbarGutter: solidExpanded ? 'auto' : 'stable',
                fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
              }}
              className={`willow-dictation-textarea w-full bg-transparent text-white outline-none font-normal resize-none overflow-y-auto transition-[padding,opacity] ${isComposerMaximized && chatVariant ? 'flex-1 min-h-0' : ''} ${chatVariant ? "duration-[400ms] ease-[cubic-bezier(0.2,0,0,1)] text-[17px] leading-6 placeholder-[#bdc1c6] font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]" : 'duration-200 text-[15.5px] placeholder-[#8e8e8e]'} ${chatVariant && isDictationActive ? 'dictation-hidden' : chatVariant && isExitingDictation ? 'exiting-dictation' : ''} ${isComposerMaximized && chatVariant ? 'pl-[10px] pr-[24px]' : composerPaddingExpanded ? chatVariant ? 'pl-[10px] pr-[24px]' : 'pl-[0px] pr-[0px]' : `pl-[40px] ${chatVariant ? 'pr-[var(--chat-collapsed-right-padding)]' : 'pr-[76px]'}`}`}
            />

            {chatVariant && isDictationActive && (
              <div className="absolute left-[46px] right-[86px] top-1/2 -translate-y-1/2">
                <DictationWaveform stream={dictationStream} />
              </div>
            )}

            <input 
              type="file" 
              multiple 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileSelect} 
            />
            <div className={`absolute shrink-0 flex items-center gap-2 z-[60] ${solidExpanded && chatVariant ? 'bottom-[5px] left-[4px]' : solidExpanded ? 'bottom-[6px] left-[0px]' : 'bottom-[16px] left-[0px]'}`}>
              <div className={`${chatVariant ? 'w-8' : 'w-[30px]'} flex items-center justify-center ${solidExpanded ? 'py-2.5' : ''}`}>
                <button 
                  ref={solidPlusRef}
                  onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
                  aria-label="Upload & tools"
                  aria-expanded={isPlusMenuOpen}
                  className={`${chatVariant ? `w-8 h-8 rounded-full text-[#e6e6e6] hover:bg-[#333537] ${isPlusMenuOpen ? 'bg-[#333537]' : ''}` : 'text-[#a0a0a0] hover:text-white'} flex items-center justify-center transition-colors outline-none`}
                >
                  {chatVariant
                    ? <MaterialSymbol family="luminous" name="plus" size={24} weight={300} roundness={100} opticalSize={24} />
                    : <Plus size={22} strokeWidth={2.5} />}
                </button>
                <PlusDropdownMenu 
                  isOpen={isPlusMenuOpen} 
                  onClose={() => setIsPlusMenuOpen(false)} 
                  onFileSelect={() => fileInputRef.current?.click()} 
                  onImportCode={() => setIsGithubImportOpen(true)}
                  buttonRef={solidPlusRef} 
                  onToolSelect={(id) => setSelectedTool(id as ToolId)}
                  geminiStyle={chatVariant}
                />
              </div>
              {selectedTool && (
                <div className="mt-[1px] animate-in fade-in zoom-in-95 duration-200">
                  <ToolChip toolId={selectedTool} onRemove={() => setSelectedTool(null)} />
                </div>
              )}
            </div>
            
            <div ref={rightControlsRef} className={`absolute flex items-center h-10 shrink-0 ${chatVariant ? 'gap-1 transition-all duration-[400ms] ease-[cubic-bezier(0.2,0,0,1)]' : 'gap-3 transition-all duration-200'} ${chatVariant ? `bottom-[12px] ${solidExpanded ? 'right-[1px]' : 'right-[0px]'}` : 'bottom-[10px] right-[0px]'}`}>
              {chatVariant && !isDictationActive && (
                <div className="relative flex items-center shrink-0">
                  <button
                    ref={modelButtonRef}
                    onClick={() => setIsModelsOpen(!isModelsOpen)}
                    aria-label={`Open model picker, currently ${activeModelAndEffortLabel}`}
                    aria-expanded={isModelsOpen}
                    className={`h-10 pl-4 pr-3 rounded-full flex items-center justify-center gap-2 text-[15px] leading-5 font-normal whitespace-nowrap text-[#c4c7c5] hover:text-[#e3e3e3] hover:bg-[#303134] transition-colors outline-none cursor-pointer font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif] ${isModelsOpen ? 'bg-[#303134] text-[#e3e3e3]' : ''}`}
                    style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
                  >
                    <span className="-mr-1 flex min-w-0 items-center">
                      <span className="text-[#e6e6e6]">{activeModelDisplayLabel}</span>
                      {activeEffortDisplayLabel && (
                        <span className="ml-1 text-white/55">{activeEffortDisplayLabel}</span>
                      )}
                    </span>
                    <MaterialSymbol
                      family="luminous"
                      name="keyboard_arrow_down"
                      size={24}
                      weight={300}
                      roundness={100}
                      opticalSize={24}
                      className={`transition-transform duration-200 ${isModelsOpen ? 'rotate-180' : ''}`}
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
                      geminiStyle
                    />
                  )}
                </div>
              )}
              <button 
                ref={micButtonRef}
                onClick={handleToggleDictation}
                disabled={isTranscribingDictation}
                aria-label={isTranscribingDictation ? "Transcribing voice" : isDictating ? "Stop listening" : "Microphone"}
                title={isTranscribingDictation ? "Transcribing voice" : isDictating ? "Stop voice dictation" : "Start voice dictation"}
                className={`relative transition-all duration-200 outline-none flex items-center justify-center w-8 h-8 rounded-full ${isTranscribingDictation ? 'cursor-default' : 'cursor-pointer'} ${
                  isDictationActive && chatVariant
                    ? 'bg-[#282a2d] hover:bg-[#383a3d] text-[#e3e3e3] shadow-sm'
                    : isDictationActive
                    ? 'text-blue-500 hover:text-blue-400 bg-blue-500/10 animate-pulse' 
                    : chatVariant ? 'text-[#e6e6e6] hover:bg-white/[0.08]' : 'text-[#a0a0a0] hover:text-white'
                }`}
              >
                {isMicRippling && <span className="gemini-mic-ripple-effect" />}
                {isDictationActive && chatVariant ? (
                  <span className="w-2.5 h-2.5 rounded-[1.5px] bg-[#e3e3e3]" aria-hidden="true" />
                ) : chatVariant ? (
                  <MaterialSymbol family="luminous" name="mic" size={24} weight={300} roundness={100} opticalSize={24} />
                ) : (
                  <Mic size={20} strokeWidth={1.8} />
                )}
              </button>
              <button
                onClick={() => {
                  if (isDictationActive) return;
                  if (hasContent) return handleSubmit();
                  if (!chatVariant) return;
                  if (isComposerMaximized) setIsComposerMaximized(false);
                  // Empty input in chat → the AudioLines button is the Live
                  // toggle. Same 34×34 circle so footer height is unchanged
                  // and the Chat spacing math stays valid.
                  liveActive ? onStopLive?.() : onStartLive?.();
                }}
                disabled={isDictationActive}
                title={
                  isTranscribingDictation
                    ? 'Transcribing voice'
                    : hasContent
                    ? undefined
                    : chatVariant
                      ? liveActive ? 'Stop live mode' : 'Start live voice chat'
                      : undefined
                }
                aria-label={isTranscribingDictation ? 'Transcribing voice' : hasContent ? 'Send message' : liveActive ? 'Stop live mode' : 'Start live voice chat'}
                className={`${chatVariant ? 'w-8 h-8' : 'w-[34px] h-[34px]'} rounded-full flex items-center justify-center shrink-0 transition-[background-color] duration-200 shadow-sm outline-none ${isDictationActive ? 'cursor-default' : 'cursor-pointer'} ${isTranscribingDictation ? 'willow-transcription-spinner' : ''} ${
                  chatVariant
                    ? isTranscribingDictation
                      ? 'bg-[#4a7c59]'
                      : !hasContent && liveActive
                      ? 'bg-[#4a7c59] hover:bg-[#3f694a] ring-2 ring-[#4a7c59]/40 animate-pulse'
                      : 'bg-[#4a7c59] hover:bg-[#3f694a]'
                    : isTranscribingDictation
                      ? 'bg-white'
                      : !hasContent && liveActive
                      ? 'bg-white hover:bg-zinc-200 ring-2 ring-white/30 animate-pulse'
                      : 'bg-white hover:bg-zinc-200'
                }`}
              >
                {isTranscribingDictation ? (
                  <MaterialSymbol name="progress_activity" size={20} weight={400} className={chatVariant ? 'text-white' : 'text-black'} />
                ) : hasContent ? (
                  chatVariant
                    ? <MaterialSymbol name="arrow_upward" size={24} weight={400} className="text-white" />
                    : <ArrowUp size={22} className="text-black stroke-[2]" />
                ) : chatVariant && liveActive ? (
                  <MaterialSymbol name="stop" size={18} weight={600} fill className="text-white" />
                ) : chatVariant ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white">
                    <line x1="7" y1="8" x2="7" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="17" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                ) : liveActive ? (
                  <Square size={14} className="text-black fill-black" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-black">
                    <line x1="7" y1="8" x2="7" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    <line x1="17" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          
        </div>
        {chatVariant && showDisclaimer && (
          <p
            className="pointer-events-none absolute left-0 right-0 top-full mt-4 text-center text-[13px] font-normal leading-[17px] text-[#c4c7c5] font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]"
            style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
          >
            Willow is AI and can make mistakes.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto relative z-20">
      {githubImportDialog}
      <div className={`${promptBoxBg} backdrop-blur-2xl border border-white/5 rounded-[1.75rem] p-2 shadow-2xl flex flex-col gap-1 ring-1 ring-white/5`}>
        {/* Attachments Area */}
        <div className={`grid transition-[grid-template-rows] duration-[250ms] ease-in-out ${attachments.length > 0 ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            <div className="flex max-h-[168px] gap-2 overflow-x-auto px-3 pb-2 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {attachments.map((att) => (
                <div key={att.id} className={`relative group flex-shrink-0 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}>
                  <GeminiAttachmentCard
                    attachment={att}
                    variant="composer"
                    onRemove={() => removeAttachment(att.id)}
                  />
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
              const newAttachments = imageFiles.map(createComposerAttachment);
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
                onImportCode={() => setIsGithubImportOpen(true)}
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
                />
              )}
            </div>


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
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90
                      ${
                        promptText.trim() || attachments.length > 0
                          ? chatVariant
                            ? "bg-[#a8c7fa] hover:bg-[#b4d0fc] text-[#062e6f] cursor-pointer"
                            : "bg-zinc-200 hover:bg-white text-black cursor-pointer"
                          : chatVariant
                            ? liveActive
                              ? "bg-[#1e1f20] hover:bg-[#333639] text-[#c4c7c5] cursor-pointer"
                              : "bg-transparent hover:bg-white/5 text-[#c4c7c5] cursor-pointer"
                            : "bg-zinc-600 text-zinc-400 cursor-not-allowed"
                      }`}
              disabled={!chatVariant && !promptText.trim() && attachments.length === 0}
            >
              {promptText.trim() || attachments.length > 0 ? (
                <MaterialSymbol name="arrow_upward" size={24} opticalSize={24} />
              ) : chatVariant ? (
                liveActive ? (
                  <Square size={14} className="fill-current" />
                ) : (
                  <MaterialSymbol name="mic" size={24} opticalSize={24} />
                )
              ) : (
                <MaterialSymbol name="arrow_upward" size={24} opticalSize={24} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
