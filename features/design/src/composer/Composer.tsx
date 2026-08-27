import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { flushSync } from 'react-dom';
import { useStore } from '@nanostores/react';
import { PlusDropdownMenu } from './PlusDropdownMenu';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { GeminiAttachmentCard } from '@willow/ui/GeminiAttachmentCard';
import { GithubImportDialog } from '@willow/ui/github/GithubImportDialog';
import './Composer.css';
import { ComposerAttachment, createComposerAttachment } from '@willow/core/attachments';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';
import {
  Plus,
  FileText,
  AudioLines,
  ArrowUp,
  ChevronDown,
  Rocket,
  X,
  Mic,
  Square,
  Check,
} from "lucide-react";

export type Attachment = ComposerAttachment;
import { useBackground } from "@willow/studio/shell/BackgroundContext";
import { StitchBorderBeam } from '../StitchBorderBeam';
import { DictationWaveform } from './DictationWaveform';
import { ModelIcon } from './composer-icons';
import {
  MODES,
  TOOLS,
  SPARK_TOOLS,
  TOOL_SYMBOLS,
  type Mode,
  type ToolId,
} from './composer-options';
import { ModesMenu } from './ModesMenu';
import { ThemesMenu } from './ThemesMenu';
import { ModelsMenu } from '@willow/ui/models/ModelsMenu';
import { MicMutedSlash } from './MicMutedSlash';
import { playMicToggleEarcon } from './mic-earcon';
import { liveModelStore, setLiveModelId } from '@willow/chat/voice-settings/live-model-store';
import { profileStore, setProfileEnabled } from '@willow/personal';
import { useAuth } from '@willow/auth/AuthContext';
import { listVoiceModels } from '@willow/chat/voice-settings/voice-providers';
import { useComposerDictation } from './use-composer-dictation';
import { useComposerModels } from './use-composer-models';
import { useComposerTextareaAutosize } from './use-composer-textarea-autosize';
import { useCollapsedChatPaddingRight, useFullscreenShellCentering } from './use-composer-chat-layout';

/**
 * Stop glyph, measured off the live Gemini composer during generation.
 */
export const STOP_BUTTON_ICON = {
  size: 24,
  variationSettings: '"FILL" 1, "GRAD" 0, "ROND" 100, "opsz" 24, "wght" 300',
} as const;

export const CHIP_GLYPH_AXES = '"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 16, "wght" 330';

export const CHIP_LABEL_STYLE: React.CSSProperties = {
  fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
  fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
};

export const GLOW_TO_BUTTON_TRANSFORM = {
  lightnessRatio: 1.5055348233608743,
  chromaRatio: 1.6820248383608614,
  hueShiftDeg: -5.072855244339735,
} as const;

export const CHAT_BUTTON_COLORS = {
  blue: { bg: '#1b3f95', hover: '#153277' },
  pink: { bg: '#8c064b', hover: '#70053c' },
  yellow: { bg: '#7c6100', hover: '#634e00' },
  orange: { bg: '#863e00', hover: '#6b3200' },
  green: { bg: '#127352', hover: '#0d5c41' },
  purple: { bg: '#512192', hover: '#450e83' },
  lilac: { bg: '#6f3c92', hover: '#5f2c81' },
  coral: { bg: '#900021', hover: '#78001a' },
  teal: { bg: '#00625c', hover: '#00514c' },
} as const;

export const getChatSubmitBg = (color?: string) => {
  const theme = getWorkspaceTheme(color);
  return `bg-[${theme.sendButton.bg}] hover:bg-[${theme.sendButton.hover}]`;
};

export const getChatTranscribingBg = (color?: string) => {
  const theme = getWorkspaceTheme(color);
  return `bg-[${theme.sendButton.bg}]`;
};

export interface ComposerHandle {
  setPrompt: (text: string) => void;
  focus: () => void;
}

export const InputBar: React.FC<{
  currentMode?: Mode;
  onModeChange?: (mode: Mode) => void;
  onSubmit?: (prompt: string, mode: Mode, attachments?: Attachment[], tool?: ToolId | null) => void;
  modelConfig?: any;
  selectedModelId?: string;
  setSelectedModelId?: (id: string) => void;
  onAuthRequired?: () => void;
  isAuthenticated?: boolean;
  chatVariant?: boolean;
  sparkMode?: boolean;
  sparkToolsEnabled?: boolean;
  showDisclaimer?: boolean;
  workspaceColor?: string;
  liveActive?: boolean;
  onStartLive?: () => void;
  onStopLive?: () => void;
  liveMicMuted?: boolean;
  onToggleLiveMicMute?: () => void;
  isGenerating?: boolean;
  isResponseRevealing?: boolean;
  onStopGenerating?: () => void;
  liveAvailable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  composerRef?: React.MutableRefObject<ComposerHandle | null>;
  extraEfforts?: React.ComponentProps<typeof ModelsMenu>['extraEfforts'];
  effortDisplayOverride?: string;
}> = ({
  currentMode = 'chat',
  onModeChange,
  onSubmit,
  modelConfig,
  selectedModelId = '',
  setSelectedModelId = () => {},
  onAuthRequired,
  isAuthenticated,
  chatVariant = true,
  sparkMode = false,
  sparkToolsEnabled = false,
  showDisclaimer = false,
  workspaceColor,
  liveActive = false,
  onStartLive,
  onStopLive,
  liveMicMuted = false,
  onToggleLiveMicMute,
  isGenerating = false,
  isResponseRevealing = false,
  onStopGenerating,
  liveAvailable = false,
  placeholder,
  disabled = false,
  composerRef,
  extraEfforts,
  effortDisplayOverride,
}) => {
  const { userProfile } = useAuth();
  const effectiveWorkspaceColor = workspaceColor || userProfile?.workspaceColor || 'green';
  const [isThemesOpen, setIsThemesOpen] = useState(false);
  const [isModesOpen, setIsModesOpen] = useState(false);
  const [isModelsOpen, setIsModelsOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [isComposerMaximized, setIsComposerMaximized] = useState(false);
  const [canMaximizeComposer, setCanMaximizeComposer] = useState(false);
  const [collapsedChatPaddingRight, setCollapsedChatPaddingRight] = useState(204);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    dictationStream,
    dictationPlaceholder,
    isMicRippling,
    isDictating,
    isTranscribingDictation,
    isDictationActive,
    isExitingDictation,
    handleToggleDictation,
  } = useComposerDictation({
    promptText,
    setPromptText,
    textareaRef,
    modelConfig,
    isComposerMaximized,
    setIsComposerMaximized,
    setIsModelsOpen,
    setIsPlusMenuOpen,
  });

  const [isSolidExpanded, setIsSolidExpanded] = useState(true);
  const { enabled: personalIntelligence } = useStore(profileStore);
  const [isGithubImportOpen, setIsGithubImportOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<ToolId | null>(null);
  const solidPlusRef = useRef<HTMLButtonElement>(null);
  const normalPlusRef = useRef<HTMLButtonElement>(null);
  
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasActiveAttachments = attachments.length > 0;

  const addFilesAsAttachments = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const newAttachments = files.map(createComposerAttachment);
    setAttachments(prev => [...prev, ...newAttachments]);
  }, []);

  useEffect(() => {
    if (!composerRef) return undefined;
    composerRef.current = {
      setPrompt: (text: string) => {
        setPromptText(text);
        window.requestAnimationFrame(() => textareaRef.current?.focus());
      },
      focus: () => textareaRef.current?.focus(),
    };
    return () => {
      composerRef.current = null;
    };
  }, [composerRef]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    addFilesAsAttachments(Array.from(e.target.files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => {
      const removed = prev.find(att => att.id === id);
      if (removed?.url) URL.revokeObjectURL(removed.url);
      return prev.filter(att => att.id !== id);
    });
  };

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => () => {
    for (const attachment of attachmentsRef.current) {
      if (attachment.url) URL.revokeObjectURL(attachment.url);
    }
  }, []);
  
  const { background } = useBackground();
  const effectiveBackground = isAuthenticated ? background : 'lines';
  
  const {
    activeModel,
    getShortName,
    activeModelDisplayLabel,
    activeEffortDisplayLabel,
  } = useComposerModels({ modelConfig, selectedModelId, setSelectedModelId });

  const voiceModels = useMemo(() => listVoiceModels(), []);
  const liveModelId = useStore(liveModelStore);
  const showVoiceModels = chatVariant && liveActive && voiceModels.length > 0;
  const liveModel = voiceModels.find((m) => m.id === liveModelId) || voiceModels[0];
  const pillModelLabel = showVoiceModels
    ? getShortName(liveModel?.name || '')
    : activeModelDisplayLabel;
  const pillEffortLabel = showVoiceModels ? '' : activeEffortDisplayLabel;
  const displayedPillEffortLabel = effortDisplayOverride ?? pillEffortLabel;
  const pillModelAndEffortLabel = [pillModelLabel, displayedPillEffortLabel].filter(Boolean).join(' ');

  const isMicMuteToggle = chatVariant && liveActive && !!onToggleLiveMicMute;
  const handleToggleLiveMicMute = useCallback(() => {
    playMicToggleEarcon(!liveMicMuted);
    onToggleLiveMicMute?.();
  }, [liveMicMuted, onToggleLiveMicMute]);

  const themeButtonRef = useRef<HTMLButtonElement>(null);
  const modeButtonRef = useRef<HTMLButtonElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const rightControlsRef = useRef<HTMLDivElement>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);

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

  const handleSubmit = () => {
    if (isGenerating) return;
    if (isResponseRevealing) return;
    if (disabled) return;
    if (promptText.trim() || attachments.length > 0 || selectedTool) {
      if (isComposerMaximized) {
        flushSync(() => {
          setIsComposerMaximized(false);
          setCanMaximizeComposer(false);
        });
      }
      const submittedAttachments = attachments;
      onSubmit?.(promptText.trim(), chatVariant ? 'chat' : currentMode, submittedAttachments, selectedTool);
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
      if (textareaRef.current) {
        textareaRef.current.style.height = '24px';
      }
    }
  };

  const ToolChip = ({ toolId, onRemove }: { toolId: ToolId, onRemove: () => void }) => {
    const tool = (sparkMode ? SPARK_TOOLS[toolId as keyof typeof SPARK_TOOLS] : TOOLS[toolId as keyof typeof TOOLS]) ?? TOOLS[toolId as keyof typeof TOOLS];
    const Icon = tool.icon;
    const glyph = TOOL_SYMBOLS[toolId];
    const useSparkIcon = sparkMode && (toolId === 'plan' || toolId === 'goal' || toolId === 'create-pet');

    const isGoogleSymbol = toolId === 'mobile';
    const useComponentIcon = toolId === 'plan' || toolId === 'components';

    return (
      <button
        type="button"
        aria-label={`Deselect ${tool.chipLabel}`}
        onClick={onRemove}
        className="group flex h-6 shrink-0 cursor-default select-none items-center justify-center rounded-full bg-[rgba(255,255,255,0.12)] pl-1 pr-2 hover:pr-1 focus-visible:pr-1"
      >
        <span className="flex items-center gap-1">
          {chatVariant && glyph && !useSparkIcon && !useComponentIcon
            ? <MaterialSymbol
                name={glyph}
                family={isGoogleSymbol || sparkMode ? 'google-symbols' : 'luminous'}
                size={16}
                weight={330}
                variationSettings={isGoogleSymbol || sparkMode ? '"wght" 330' : CHIP_GLYPH_AXES}
                className="text-[#e6e6e6]"
              />
            : <Icon size={16} className="text-[#e6e6e6]" strokeWidth={2.2} />}
          <span
            className="whitespace-nowrap text-[13px] font-normal leading-[17px] text-[#e6e6e6]"
            style={CHIP_LABEL_STYLE}
          >
            {tool.chipLabel}
          </span>
          <span className="hidden group-hover:flex group-focus-visible:flex">
            {chatVariant
              ? <MaterialSymbol
                  name="close"
                  family="luminous"
                  size={16}
                  weight={330}
                  variationSettings={CHIP_GLYPH_AXES}
                  className="text-[#e6e6e6]"
                />
              : <X size={12} className="text-[#e6e6e6]" strokeWidth={2.2} />}
          </span>
        </span>
      </button>
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useComposerTextareaAutosize({
    textareaRef,
    promptText,
    selectedTool,
    hasAttachments: hasActiveAttachments,
    chatVariant,
    effectiveBackground,
    isComposerMaximized,
    collapsedChatPaddingRight,
    isDictationActive,
    setIsSolidExpanded,
    setCanMaximizeComposer,
  });

  const promptBoxBg = effectiveBackground === 'lines' 
    ? 'bg-[#1e1f21]/70' 
    : 'bg-[#1e1f21]';
  
  const hasContent = promptText.trim() || hasActiveAttachments || selectedTool;
  const responseControlActive = isGenerating || isResponseRevealing;

  const showSubmitControl = !(
    chatVariant
    && !hasContent
    && !liveAvailable
    && !responseControlActive
    && !isTranscribingDictation
  );

  const isSubmitControlContentGated = chatVariant && !liveAvailable;

  // Solid expanded form: controls on bottom row, textarea at top
  const solidExpanded = isDictationActive ? false : true;
  const composerPaddingExpanded = isDictationActive ? false : true;
  const showComposerMaximizeToggle = chatVariant
    && !isDictationActive
    && !disabled
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

  useCollapsedChatPaddingRight({
    chatVariant,
    solidExpanded,
    isDictationActive,
    rightControlsRef,
    modelButtonRef,
    micButtonRef,
    activeModelAndEffortLabel: pillModelAndEffortLabel,
    setCollapsedChatPaddingRight,
  });

  useFullscreenShellCentering({
    composerShellRef,
    chatVariant,
    isComposerMaximized,
    showDisclaimer,
  });

  return (
    <div
      ref={composerShellRef}
      className={`w-full max-w-[660px] mx-auto relative ${isComposerMaximized && chatVariant ? 'z-[120]' : 'z-20'}`}
      style={{
        '--chat-collapsed-right-padding': `${collapsedChatPaddingRight}px`,
      } as React.CSSProperties}
    >
      {githubImportDialog}
      <div className="relative w-full flex flex-col justify-center bg-[#1e1f21]/80 backdrop-blur-2xl backdrop-saturate-150 rounded-[32px] pl-[14px] pr-[15px] shadow-[0_12px_40px_-8px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.06)]">
        <StitchBorderBeam duration={3.4} borderRadius="32px" />
        
        {hasActiveAttachments && (
          <div className="-ml-[14px] -mr-[15px] flex max-h-[168px] gap-2 overflow-x-auto pb-2 px-3 pt-3 [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent_0,#000_12px,#000_calc(100%_-_12px),transparent_100%)] [&::-webkit-scrollbar]:hidden">
            {attachments.map((att) => (
              <div key={att.id} className="group relative flex-shrink-0">
                <GeminiAttachmentCard
                  attachment={att}
                  variant="composer"
                  onRemove={() => removeAttachment(att.id)}
                />
              </div>
            ))}
          </div>
        )}

        <div className={`textarea-wrapper flex flex-col w-full relative ${isComposerMaximized ? 'flex-1 min-h-0 pt-4 pb-[62px]' : 'pt-4 pb-[62px]'}`}>
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
            disabled={disabled}
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
            placeholder={dictationPlaceholder || placeholder || "What native mobile app shall we design?"}
            style={{
              height: '24px',
              minHeight: '24px',
              scrollbarGutter: 'auto',
              fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
            }}
            className={`willow-dictation-textarea w-full bg-transparent text-white outline-none font-normal resize-none overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden text-[17px] leading-6 placeholder-[#bdc1c6] font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif] pl-[10px] pr-[24px] ${isComposerMaximized && chatVariant ? 'flex-1 min-h-0' : ''} ${chatVariant && isDictationActive ? 'dictation-hidden' : chatVariant && isExitingDictation ? 'exiting-dictation' : ''}`}
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
          <div className="willow-composer-leading-actions absolute shrink-0 flex items-center gap-2 z-[60] bottom-[5px] left-[4px]">
            <div className="w-8 flex items-center justify-center py-2.5">
              <button 
                ref={solidPlusRef}
                onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
                disabled={disabled}
                aria-label="Upload & tools"
                aria-expanded={isPlusMenuOpen}
                className="w-8 h-8 rounded-full text-[#e6e6e6] hover:bg-[#333537] flex items-center justify-center transition-colors outline-none disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span
                  className="flex items-center justify-center"
                  style={{
                    transform: isPlusMenuOpen ? 'rotate(45deg)' : 'rotate(0deg)',
                    transition: 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
                  }}
                >
                  <MaterialSymbol family="luminous" name="plus" size={24} weight={300} roundness={100} opticalSize={24} />
                </span>
              </button>
              <PlusDropdownMenu 
                isOpen={isPlusMenuOpen} 
                onClose={() => setIsPlusMenuOpen(false)} 
                onFileSelect={() => fileInputRef.current?.click()} 
                onImportCode={() => setIsGithubImportOpen(true)}
                buttonRef={solidPlusRef} 
                onToolSelect={(id) => setSelectedTool(id as ToolId)}
                selectedTool={selectedTool}
                personalIntelligence={personalIntelligence}
                onTogglePersonalIntelligence={setProfileEnabled}
                geminiStyle={chatVariant}
                sparkMode={sparkMode}
                sparkToolsEnabled={sparkToolsEnabled}
              />
            </div>
            {selectedTool && (
              <div className="mt-[1px]">
                <ToolChip toolId={selectedTool} onRemove={() => setSelectedTool(null)} />
              </div>
            )}
          </div>
          
          <div ref={rightControlsRef} className="willow-composer-trailing-actions absolute flex items-center h-10 shrink-0 gap-1 bottom-[12px] right-[0px]">
            {chatVariant && !isDictationActive && (
              <div className="relative flex items-center shrink-0">
                <button
                  ref={modelButtonRef}
                  onClick={() => setIsModelsOpen(!isModelsOpen)}
                  aria-label={`Open model picker, currently ${pillModelAndEffortLabel}`}
                  aria-expanded={isModelsOpen}
                  className={`h-10 pl-4 pr-3 rounded-full flex items-center justify-center gap-2 text-[15px] leading-5 font-normal whitespace-nowrap text-[#c4c7c5] hover:text-[#e3e3e3] hover:bg-[#303134] transition-colors outline-none cursor-pointer font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif] ${isModelsOpen ? 'bg-[#303134] text-[#e3e3e3]' : ''}`}
                  style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
                >
                  <span className="-mr-1 flex min-w-0 items-center">
                    <span className="text-[#e6e6e6]">{pillModelLabel}</span>
                    {displayedPillEffortLabel && (
                      <span className="ml-1 text-white/55">{displayedPillEffortLabel}</span>
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
                    selectedId={showVoiceModels ? liveModelId : selectedModelId}
                    onSelect={showVoiceModels ? setLiveModelId : setSelectedModelId}
                    onAuthRequired={onAuthRequired}
                    geminiStyle
                    voiceModels={showVoiceModels ? voiceModels : undefined}
                    extraEfforts={showVoiceModels ? undefined : extraEfforts}
                  />
                )}
              </div>
            )}
            <button
              ref={micButtonRef}
              onClick={isMicMuteToggle ? handleToggleLiveMicMute : handleToggleDictation}
              disabled={disabled || (isTranscribingDictation && !isMicMuteToggle)}
              aria-label={isMicMuteToggle ? (liveMicMuted ? "Turn on microphone" : "Turn off microphone") : isTranscribingDictation ? "Transcribing voice" : isDictating ? "Stop listening" : "Microphone"}
              aria-pressed={isMicMuteToggle ? liveMicMuted : undefined}
              title={isMicMuteToggle ? (liveMicMuted ? "Turn on microphone" : "Turn off microphone") : isTranscribingDictation ? "Transcribing voice" : isDictating ? "Stop voice dictation" : "Start voice dictation"}
              className={`relative outline-none flex items-center justify-center w-8 h-8 rounded-full disabled:opacity-40 disabled:cursor-default ${isTranscribingDictation && !isMicMuteToggle ? 'cursor-default' : 'cursor-pointer'} ${
                isMicMuteToggle
                  ? 'transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]'
                  : 'transition-all duration-200'
              } ${
                isMicMuteToggle && liveMicMuted
                  ? 'bg-[#ff002a] hover:bg-[#fa423e] active:bg-[#ba2623] text-white hover:text-[#cdcdcd]'
                  : isDictationActive && chatVariant
                  ? 'bg-[#282a2d] hover:bg-[#383a3d] text-[#e3e3e3] shadow-sm'
                  : isDictationActive
                  ? 'text-blue-500 hover:text-blue-400 bg-blue-500/10 animate-pulse'
                  : chatVariant ? 'text-[#e6e6e6] hover:bg-white/[0.08]' : 'text-[#a0a0a0] hover:text-white'
              }`}
            >
              {isMicRippling && !isMicMuteToggle && <span className="gemini-mic-ripple-effect" />}
              {isDictationActive && chatVariant && !isMicMuteToggle ? (
                <span className="w-2.5 h-2.5 rounded-[1.5px] bg-[#e3e3e3]" aria-hidden="true" />
              ) : chatVariant ? (
                <MaterialSymbol family="luminous" name="mic" size={24} weight={300} roundness={100} opticalSize={24} />
              ) : (
                <Mic size={20} strokeWidth={1.8} />
              )}
              {isMicMuteToggle && liveMicMuted && (
                <MicMutedSlash
                  size={chatVariant ? 24 : 20}
                  className="absolute inset-0 m-auto pointer-events-none"
                />
              )}
            </button>
            {showSubmitControl && (
            <button
              onClick={() => {
                if (isDictationActive) return;
                if (isGenerating) return onStopGenerating?.();
                if (isResponseRevealing) return;
                if (hasContent) return handleSubmit();
                if (!chatVariant) return;
                if (!liveAvailable) return;
                if (isComposerMaximized) setIsComposerMaximized(false);
                liveActive ? onStopLive?.() : onStartLive?.();
              }}
              disabled={disabled || (isDictationActive && !isGenerating)}
              title={
                isGenerating
                  ? 'Stop response'
                  : isResponseRevealing
                  ? 'Finishing response'
                  : isTranscribingDictation
                  ? 'Transcribing voice'
                  : hasContent
                  ? 'Submit'
                  : chatVariant
                    ? liveActive ? 'Stop live mode' : 'Start live voice chat'
                    : undefined
              }
              aria-label={isGenerating ? 'Stop response' : isResponseRevealing ? 'Finishing response' : isTranscribingDictation ? 'Transcribing voice' : hasContent ? 'Send message' : liveActive ? 'Stop live mode' : 'Start live voice chat'}
              style={
                chatVariant && !responseControlActive && !liveActive && !isTranscribingDictation
                  ? { backgroundColor: getWorkspaceTheme(effectiveWorkspaceColor).sendButton.bg }
                  : undefined
              }
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-[background-color] duration-200 shadow-sm outline-none disabled:opacity-40 disabled:cursor-default ${isSubmitControlContentGated ? 'willow-composer-send-enter' : ''} ${isDictationActive && !isGenerating ? 'cursor-default' : 'cursor-pointer'} ${isTranscribingDictation && !isGenerating ? 'willow-transcription-spinner' : ''} ${
                chatVariant
                  ? responseControlActive || liveActive
                    ? 'bg-[#171717] hover:bg-[#282828]'
                    : isTranscribingDictation
                    ? getChatTranscribingBg(effectiveWorkspaceColor)
                    : getChatSubmitBg(effectiveWorkspaceColor)
                  : responseControlActive || liveActive
                    ? 'bg-[#171717] hover:bg-[#282828]'
                    : isTranscribingDictation
                    ? 'bg-white'
                    : 'bg-white hover:bg-zinc-200'
              }`}
            >
              {responseControlActive ? (
                <MaterialSymbol
                  family="google-symbols"
                  name="stop"
                  size={STOP_BUTTON_ICON.size}
                  variationSettings={STOP_BUTTON_ICON.variationSettings}
                  className="text-[#e6e6e6]"
                />
              ) : isTranscribingDictation ? (
                <MaterialSymbol name="progress_activity" size={20} weight={400} className={chatVariant ? 'text-white' : 'text-black'} />
              ) : hasContent ? (
                chatVariant
                  ? <MaterialSymbol family="luminous" name="arrow_upward" size={24} weight={300} roundness={100} opticalSize={24} className="text-white" />
                  : <ArrowUp size={22} className="text-black stroke-[2]" />
              ) : chatVariant && liveActive ? (
                <MaterialSymbol name="stop" size={18} weight={600} fill className="text-white" />
              ) : chatVariant ? (
                <svg width="24" height="24" viewBox="0 0 24 24" focusable="false" aria-hidden="true" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="text-white">
                  <path d="M10 3.1a.9.9 0 0 1 .9.9v16a.9.9 0 0 1-1.8 0V4a.9.9 0 0 1 .9-.9M15 5.6a.9.9 0 0 1 .9.9v10a.9.9 0 0 1-1.8 0v-10a.9.9 0 0 1 .9-.9M5 8.6a.9.9 0 0 1 .9.9v5a.9.9 0 0 1-1.8 0v-5a.9.9 0 0 1 .9-.9M20 9.1a.9.9 0 0 1 .9.9v4a.9.9 0 0 1-1.8 0v-4a.9.9 0 0 1 .9-.9"/>
                </svg>
              ) : liveActive ? (
                <Square size={14} className="text-black fill-black" />
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" focusable="false" aria-hidden="true" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="text-black">
                  <path d="M10 3.1a.9.9 0 0 1 .9.9v16a.9.9 0 0 1-1.8 0V4a.9.9 0 0 1 .9-.9M15 5.6a.9.9 0 0 1 .9.9v10a.9.9 0 0 1-1.8 0v-10a.9.9 0 0 1 .9-.9M5 8.6a.9.9 0 0 1 .9.9v5a.9.9 0 0 1-1.8 0v-5a.9.9 0 0 1 .9-.9M20 9.1a.9.9 0 0 1 .9.9v4a.9.9 0 0 1-1.8 0v-4a.9.9 0 0 1 .9-.9"/>
                </svg>
              )}
            </button>
            )}
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
};

export default InputBar;
