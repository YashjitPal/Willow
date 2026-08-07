import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useStore } from '@nanostores/react';
import { PlusDropdownMenu } from './PlusDropdownMenu';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { GeminiAttachmentCard } from '@willow/ui/GeminiAttachmentCard';
import { GithubImportDialog } from '@willow/code/github/GithubImportDialog';
import './Composer.css';
import { ComposerAttachment, createComposerAttachment } from '@willow/core/attachments';
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
import { DictationWaveform } from './DictationWaveform';
import { ModelIcon } from './composer-icons';
import {
  MODES,
  TOOLS,
  TOOL_SYMBOLS,
  type Mode,
  type ToolId,
} from './composer-options';
import { ModesMenu } from './ModesMenu';
import { ThemesMenu } from './ThemesMenu';
import { ModelsMenu } from './ModelsMenu';
import { liveModelStore, setLiveModelId } from '../voice-settings/live-model-store';
import { listVoiceModels } from '../voice-settings/voice-providers';
import { useComposerDictation } from './use-composer-dictation';
import { useComposerModels } from './use-composer-models';
import { useComposerTextareaAutosize } from './use-composer-textarea-autosize';
import { useCollapsedChatPaddingRight, useFullscreenShellCentering } from './use-composer-chat-layout';

// Re-exported so this module's public surface is unchanged: CodeHome and
// WorkbenchSidebar import ModelsMenu from here.
export { ModelsMenu };

/**
 * Stop glyph, measured off the live Gemini composer during generation.
 *
 * It is a different font from the send arrow -- send is "Luminous Symbols",
 * stop is filled "Google Symbols" -- so the axes cannot be shared between the
 * two states. MaterialSymbol's google-symbols branch emits only ROND/slnt/wdth/
 * wght, which drops the FILL that makes this a solid square, hence the explicit
 * variationSettings override.
 */
export const STOP_BUTTON_ICON = {
  size: 24,
  variationSettings: '"FILL" 1, "GRAD" 0, "ROND" 100, "opsz" 24, "wght" 300',
} as const;

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
   *  to use mode="chat". Used by the standalone studio chat view. */
  chatVariant?: boolean;
  /** Shows the AI disclaimer beneath the bottom-docked composer after a chat starts. */
  showDisclaimer?: boolean;
  /** Chat live-voice session wiring. When `liveActive`, the empty-state send
   *  button becomes a stop control; otherwise it starts the session. Only
   *  consulted in `chatVariant` — Develop / Workbench input is untouched. */
  liveActive?: boolean;
  onStartLive?: () => void;
  onStopLive?: () => void;
  /** A reply is streaming. Gemini reuses the send slot as a stop control for the
   *  whole generation, so this outranks both the send and the live states. */
  isGenerating?: boolean;
  onStopGenerating?: () => void;
}> = ({ currentMode, onModeChange, onSubmit, modelConfig, selectedModelId, setSelectedModelId, onAuthRequired, isAuthenticated, chatVariant = false, showDisclaimer = false, liveActive = false, onStartLive, onStopLive, isGenerating = false, onStopGenerating }) => {
  const [isThemesOpen, setIsThemesOpen] = useState(false);
  const [isModesOpen, setIsModesOpen] = useState(false);
  const [isModelsOpen, setIsModelsOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [isComposerMaximized, setIsComposerMaximized] = useState(false);
  const [canMaximizeComposer, setCanMaximizeComposer] = useState(false);
  const [collapsedChatPaddingRight, setCollapsedChatPaddingRight] = useState(204);
  // Hoisted above useComposerDictation: the hook receives both, and arguments
  // are evaluated at the call site, so their declarations must come first.
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Recording, transcription and caret restoration live in
  // ./use-composer-dictation. The JSX that reads these flags is unchanged.
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
  const [isSolidExpanded, setIsSolidExpanded] = useState(false);
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
  
  // Model resolution and the pill labels live in ./use-composer-models.
  const {
    activeModel,
    getShortName,
    activeModelDisplayLabel,
    activeEffortDisplayLabel,
  } = useComposerModels({ modelConfig, selectedModelId, setSelectedModelId });

  /**
   * While a live session is up, the pill edits the live model instead of the
   * text one — roster, tick, label and target store all switch together.
   *
   * They are two separate selections on purpose: voice mode running does not
   * mean the next typed message should go to a live model, so `selectedModelId`
   * is left exactly as the user left it and restored the moment live ends.
   *
   * The roster comes from the voice-provider registry rather than the user's
   * saved models because those are the ids voice mode actually opens a socket
   * with; a live model can be absent from Settings → Models and still be the one
   * that runs.
   */
  const voiceModels = useMemo(() => listVoiceModels(), []);
  const liveModelId = useStore(liveModelStore);
  const showVoiceModels = chatVariant && liveActive && voiceModels.length > 0;
  const liveModel = voiceModels.find((m) => m.id === liveModelId) || voiceModels[0];
  // Shortened the same way as a text model, so "Gemini 3.1 Flash Live" reads
  // "3.1 Flash Live" and the pill keeps one naming convention.
  const pillModelLabel = showVoiceModels
    ? getShortName(liveModel?.name || '')
    : activeModelDisplayLabel;
  // No effort segment while live: a live model has no thinking levels.
  const pillEffortLabel = showVoiceModels ? '' : activeEffortDisplayLabel;
  const pillModelAndEffortLabel = [pillModelLabel, pillEffortLabel].filter(Boolean).join(' ');

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

  // Submit prompt internally
  const handleSubmit = () => {
    // Enter reaches here too, so the generation guard has to live in the
    // submit path rather than only on the button.
    if (isGenerating) return;
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

  // Textarea measurement and sizing lives in
  // ./use-composer-textarea-autosize; it drives the two flags below.
  useComposerTextareaAutosize({
    textareaRef,
    promptText,
    selectedTool,
    chatVariant,
    effectiveBackground,
    isComposerMaximized,
    collapsedChatPaddingRight,
    isDictationActive,
    setIsSolidExpanded,
    setCanMaximizeComposer,
  });

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

  // Both chat-variant layout measurements live in
  // ./use-composer-chat-layout, called in their original order.
  useCollapsedChatPaddingRight({
    chatVariant,
    solidExpanded,
    isDictationActive,
    rightControlsRef,
    modelButtonRef,
    micButtonRef,
    // The pill's label, not the text model's: entering live mode changes it, and
    // with it the width the collapsed editor has to stop short of.
    activeModelAndEffortLabel: pillModelAndEffortLabel,
    setCollapsedChatPaddingRight,
  });

  useFullscreenShellCentering({
    composerShellRef,
    chatVariant,
    isComposerMaximized,
    showDisclaimer,
  });

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
                    aria-label={`Open model picker, currently ${pillModelAndEffortLabel}`}
                    aria-expanded={isModelsOpen}
                    className={`h-10 pl-4 pr-3 rounded-full flex items-center justify-center gap-2 text-[15px] leading-5 font-normal whitespace-nowrap text-[#c4c7c5] hover:text-[#e3e3e3] hover:bg-[#303134] transition-colors outline-none cursor-pointer font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif] ${isModelsOpen ? 'bg-[#303134] text-[#e3e3e3]' : ''}`}
                    style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
                  >
                    <span className="-mr-1 flex min-w-0 items-center">
                      <span className="text-[#e6e6e6]">{pillModelLabel}</span>
                      {pillEffortLabel && (
                        <span className="ml-1 text-white/55">{pillEffortLabel}</span>
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
                  // Stop outranks send: while a reply streams this slot is the
                  // stop control, so a click here must never submit the draft.
                  if (isGenerating) return onStopGenerating?.();
                  if (hasContent) return handleSubmit();
                  if (!chatVariant) return;
                  if (isComposerMaximized) setIsComposerMaximized(false);
                  // Empty input in chat → the AudioLines button is the Live
                  // toggle. Same 34×34 circle so footer height is unchanged
                  // and the Chat spacing math stays valid.
                  liveActive ? onStopLive?.() : onStartLive?.();
                }}
                disabled={isDictationActive && !isGenerating}
                title={
                  isGenerating
                    ? 'Stop response'
                    : isTranscribingDictation
                    ? 'Transcribing voice'
                    : hasContent
                    ? undefined
                    : chatVariant
                      ? liveActive ? 'Stop live mode' : 'Start live voice chat'
                      : undefined
                }
                aria-label={isGenerating ? 'Stop response' : isTranscribingDictation ? 'Transcribing voice' : hasContent ? 'Send message' : liveActive ? 'Stop live mode' : 'Start live voice chat'}
                className={`${chatVariant ? 'w-8 h-8' : 'w-[34px] h-[34px]'} rounded-full flex items-center justify-center shrink-0 transition-[background-color] duration-200 shadow-sm outline-none ${isDictationActive && !isGenerating ? 'cursor-default' : 'cursor-pointer'} ${isTranscribingDictation && !isGenerating ? 'willow-transcription-spinner' : ''} ${
                  chatVariant
                    ? isGenerating
                      // Gemini swaps the accent fill for a neutral surface while
                      // stopping is offered. #282828 is its MDC hover layer
                      // (#e6e6e6 at 0.08) composited over #171717.
                      ? 'bg-[#171717] hover:bg-[#282828]'
                      : isTranscribingDictation
                      ? 'bg-[#4a7c59]'
                      : !hasContent && liveActive
                      ? 'bg-[#4a7c59] hover:bg-[#3f694a] ring-2 ring-[#4a7c59]/40 animate-pulse'
                      : 'bg-[#4a7c59] hover:bg-[#3f694a]'
                    : isGenerating
                      ? 'bg-[#171717] hover:bg-[#282828]'
                      : isTranscribingDictation
                      ? 'bg-white'
                      : !hasContent && liveActive
                      ? 'bg-white hover:bg-zinc-200 ring-2 ring-white/30 animate-pulse'
                      : 'bg-white hover:bg-zinc-200'
                }`}
              >
                {isGenerating ? (
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


