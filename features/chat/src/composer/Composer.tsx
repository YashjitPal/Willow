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
import { liveModelStore, setLiveModelId } from '../voice-settings/live-model-store';
import { profileStore, setProfileEnabled } from '@willow/personal';
import { useAuth } from '@willow/auth/AuthContext';
import { listVoiceModels } from '../voice-settings/voice-providers';
import { useComposerDictation } from './use-composer-dictation';
import { useComposerModels } from './use-composer-models';
import { useComposerTextareaAutosize } from './use-composer-textarea-autosize';
import { useCollapsedChatPaddingRight, useFullscreenShellCentering } from './use-composer-chat-layout';

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

/**
 * The attached-tool chip's two typography readings, taken off Gemini's live chip.
 *
 * Glyph: `lm-icon-s`, 16px Luminous Symbols. `opsz` is 16 here, not the 20 the plus
 * menu's rows use -- the chip's glyph is a size smaller than the menu's, so the optical
 * size axis differs and they cannot share one constant.
 *
 * Label: `.gds-body-s` at 13px/17px weight 400. Same axis set as the menu labels and the
 * sidebar body text, which is Gemini's shared body token rather than a coincidence.
 *
 * The family has to be stated explicitly. Gemini resolves this label to Google Sans Flex,
 * whose `wdth` axis is live -- "Music" measures 35.29px at `wdth 92` against 36.67px at
 * 100. Without the family the chip inherits Inter, which has no `wdth` axis at all, so
 * the 92 is silently ignored and every chip renders ~1.6px too wide.
 */
export const CHIP_GLYPH_AXES = '"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 16, "wght" 330';

export const CHIP_LABEL_STYLE: React.CSSProperties = {
  fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
  fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
};

/**
 * Transform from background glow accent to send/live button color in OKLCh space.
 * Measured and calibrated from the reference pair:
 *   Blue Background Glow (#14204f) -> Blue Button (#1b3f95).
 *
 * Lightness multiplier: ~1.5055 (L_btn = L_glow * 1.505535)
 * Chroma multiplier:    ~1.6820 (C_btn = C_glow * 1.682025)
 * Hue shift:            -5.0729° (h_btn = h_glow - 5.072855°)
 */
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

/** The host-facing handle behind `composerRef`. */
export interface ComposerHandle {
  setPrompt: (text: string) => void;
  focus: () => void;
}

export const InputBar: React.FC<{
  currentMode: Mode;
  onModeChange: (mode: Mode) => void;
  /** `tool` is whichever chip was attached from the plus menu, or null. Chat ignores
   *  it — it reads the tool off its own state — but Spark stores it on the task. */
  onSubmit?: (prompt: string, mode: Mode, attachments?: Attachment[], tool?: ToolId | null) => void;
  modelConfig: any;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  onAuthRequired?: () => void;
  isAuthenticated?: boolean;
  /** When true, hides the Ship/Chat/Design/Proto mode selector and forces submissions
   *  to use mode="chat". Used by the standalone studio chat view. */
  chatVariant?: boolean;
  /** Uses Spark's upload-only Gemini plus menu without changing normal Chat. */
  sparkMode?: boolean;
  /** Opts Spark into its agent-mode rows. Removing this restores upload-only Spark. */
  sparkToolsEnabled?: boolean;
  /** Shows the AI disclaimer beneath the bottom-docked composer after a chat starts. */
  showDisclaimer?: boolean;
  /** Workspace swatch color to style the send / live button. */
  workspaceColor?: string;
  /** Chat live-voice session wiring. When `liveActive`, the empty-state send
   *  button becomes a stop control; otherwise it starts the session. Only
   *  consulted in `chatVariant` — Develop / Workbench input is untouched. */
  liveActive?: boolean;
  onStartLive?: () => void;
  onStopLive?: () => void;
  /** Live mic mute. While `liveActive`, the dictation button becomes this toggle
   *  — dictation and a live session both want the mic, so the two can never be
   *  useful at the same time and the slot is free to be repurposed. */
  liveMicMuted?: boolean;
  onToggleLiveMicMute?: () => void;
  /** A reply is streaming. Gemini reuses the send slot as a stop control for the
   *  whole generation, so this outranks both the send and the live states. */
  isGenerating?: boolean;
  /** The model has finished, but the response text is still being revealed. The
   *  stop slot remains mounted while this is true, without becoming an abort
   *  action or allowing a draft to submit through it. */
  isResponseRevealing?: boolean;
  onStopGenerating?: () => void;
  /** Whether the user has added the Gemini Live model. When false and the
   *  prompt is empty, a dulled send button is shown instead of the live icon. */
  liveAvailable?: boolean;
  /** Overrides the resting placeholder. Spark asks for a task rather than a
   *  question, so it reads "Describe a task" there. Dictation still takes
   *  precedence — its own placeholder announces that the mic is listening. */
  placeholder?: string;
  /** Locks the whole box: the textarea, the plus menu, the mic and the send slot. Spark's
   *  follow-up composer uses it while a task is running, when a reply cannot be accepted
   *  yet. Distinct from `isGenerating`, which keeps the box live and turns send into stop. */
  disabled?: boolean;
  /** Lets the host write into the box. The draft is local state, so a surface that
   *  fills the composer from outside — Spark's Suggested cards — needs a way in. */
  composerRef?: React.MutableRefObject<ComposerHandle | null>;
  /** Harness-only effort rows. Omitted by normal Chat and every non-agent surface. */
  extraEfforts?: React.ComponentProps<typeof ModelsMenu>['extraEfforts'];
  /** Product modes such as Ultra replace the numeric effort segment in the pill. */
  effortDisplayOverride?: string;
}> = ({ currentMode, onModeChange, onSubmit, modelConfig, selectedModelId, setSelectedModelId, onAuthRequired, isAuthenticated, chatVariant = false, sparkMode = false, sparkToolsEnabled = false, showDisclaimer = false, workspaceColor, liveActive = false, onStartLive, onStopLive, liveMicMuted = false, onToggleLiveMicMute, isGenerating = false, isResponseRevealing = false, onStopGenerating, liveAvailable = false, placeholder, disabled = false, composerRef, extraEfforts, effortDisplayOverride }) => {
  const { userProfile } = useAuth();
  const effectiveWorkspaceColor = workspaceColor || userProfile?.workspaceColor || 'green';
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
  /*
   * Gemini shows Personal Intelligence as a toggle inside the plus menu's "More
   * tools" submenu, and this is the same switch as the one on the Personal
   * Intelligence settings tab — not a second, chat-local copy of it.
   *
   * It was a `useState(false)` while there was no app-level state to bind to,
   * which made it cosmetic: it moved, and nothing read it. Now it reads and
   * writes `profileStore.enabled`, the flag that actually gates the profile block
   * in the system prompt, the automatic builds and the retrieval tool. Default is
   * on, from `PROFILE_DEFAULTS` — personalization is opt-out, and this row is one
   * of the two places to opt out.
   */
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

  /*
   * Publish the host handle. An effect rather than a render-time assignment so the ref is
   * never left pointing at a component that has since unmounted.
   */
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

  // Gemini detaches instantly. Measured on the live app: every element in the strip —
  // `uploader-file-preview`, `.file-preview-container`, the tile, `.attachment-preview-wrapper`
  // and `.text-input-field` — computes `transition: all 0s`, there are no `@keyframes`
  // matching /attach|chip|preview/, and the strip carries no `ng-trigger-*` class, so there
  // is no Angular runtime animation either. The tile is removed and the flex row reflows.
  //
  // So there is no fade-out to wait for, and `removingIds` no longer gates rendering — it
  // is kept only so `hasActiveAttachments` stays correct within the same tick.
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
  const displayedPillEffortLabel = effortDisplayOverride ?? pillEffortLabel;
  const pillModelAndEffortLabel = [pillModelLabel, displayedPillEffortLabel].filter(Boolean).join(' ');

  /**
   * While a live session is up the mic button mutes that session instead of
   * starting dictation. Gated on `onToggleLiveMicMute` as well as `liveActive`
   * so a caller that opts into live mode without wiring mute keeps the dictation
   * behaviour rather than getting a dead button.
   */
  const isMicMuteToggle = chatVariant && liveActive && !!onToggleLiveMicMute;
  const handleToggleLiveMicMute = useCallback(() => {
    // Press earcon fires on pointerdown in ChatGPT, but the release tone depends
    // on the direction we are moving in, so both are scheduled together here
    // off the state we are leaving.
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

  // Submit prompt internally
  const handleSubmit = () => {
    // Enter reaches here too, so both guards have to live in the submit path rather than
    // only on the button.
    if (isGenerating) return;
    if (isResponseRevealing) return;
    if (disabled) return;
    if (promptText.trim() || attachments.length > 0 || selectedTool) {
      // Leave fullscreen in its OWN commit, before submitting.
      //
      // The composer is now a single persistent node, so nothing unmounts here
      // and there is no `layoutId` morph left to protect — but this call is
      // still load-bearing, for the surviving half of the original reason.
      // Submitting flips `isThreadDocked`, which is the composer's
      // `layoutDependency`, so Framer re-measures the box on that commit.
      // Batched into one commit with the submit, the "from" box it measures is
      // still the fullscreen rectangle, and the slide would ease a
      // full-viewport box down to a 64px bar — scaling every child on the way,
      // which is exactly the squash the single-node rewrite removed.
      // Collapsing first means it measures the ordinary composer instead.
      //
      // `flushSync` is the whole point: without it React batches this with the
      // submit below and the separation is lost. Cheap — it only does work when
      // fullscreen is actually open.
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
    }
  };

  /**
   * Gemini's attached-tool chip, measured off the live app rather than styled by eye.
   *
   * This used to be `#bae6fd` ("Refined light blue color (sky-200)") on `bg-sky-500/10`,
   * which is where the blue tint came from. Gemini's chip has no blue in it at all — it is
   * a neutral tonal button. Every value below is a reading off
   * `toolbox-drawer gem-button.selected-item-gem-button`:
   *
   *   host gem-button   padding 0 0 0 8px          (the gap from the plus button)
   *   button            24px tall, radius 9999px, bg rgba(255,255,255,0.12),
   *                     colour rgb(230,230,230), padding 0 8px 0 4px, cursor default
   *   content           display flex, gap 4px, align centre
   *   glyph             16px Luminous Symbols, "FILL" 0 "GRAD" 0 "ROND" 100 "opsz" 16 "wght" 330
   *   label             .gds-body-s, 13px/17px, weight 400, "wdth" 92
   *
   * Two behaviours that are easy to get wrong and are both measured, not assumed:
   *
   * 1. The close glyph is APPENDED on hover, it does not replace the tool glyph. Gemini
   *    keeps both — `.on-focus-secondary-icon` is `display: none` until
   *    `button:hover, button:focus`. The old code swapped the icon out, which is why the
   *    chip appeared to change identity under the cursor.
   * 2. The chip grows by exactly 16px on hover, because the right padding drops 8px -> 4px
   *    as the 16px glyph and its 4px gap arrive: rest 4+16+4+43.9+8 = 75.9, hover
   *    4+16+4+43.9+4+16+4 = 91.9. Both verified against the live rects.
   *
   * There is deliberately NO transition. Gemini's only authored one is
   * `box-shadow 0.28s`, and box-shadow never changes here, so the growth is instant.
   * `transition-all duration-200` would ease the padding and the width — an animation
   * Gemini does not have.
   *
   * The whole chip is one button labelled "Deselect <label>", which is Gemini's own
   * accessible name; the close glyph is decoration inside it, not a separate control.
   */
  const ToolChip = ({ toolId, onRemove }: { toolId: ToolId, onRemove: () => void }) => {
    const tool = (sparkMode ? SPARK_TOOLS[toolId as keyof typeof SPARK_TOOLS] : TOOLS[toolId as keyof typeof TOOLS]) ?? TOOLS[toolId as keyof typeof TOOLS];
    const Icon = tool.icon;
    const glyph = TOOL_SYMBOLS[toolId];

    return (
      <button
        type="button"
        aria-label={`Deselect ${tool.chipLabel}`}
        onClick={onRemove}
        className="group flex h-6 shrink-0 cursor-default select-none items-center justify-center rounded-full bg-[rgba(255,255,255,0.12)] pl-1 pr-2 hover:pr-1 focus-visible:pr-1"
      >
        <span className="flex items-center gap-1">
          {chatVariant && glyph
            ? <MaterialSymbol
                name={glyph}
                family={sparkMode ? 'google-symbols' : 'luminous'}
                size={16}
                weight={330}
                variationSettings={sparkMode ? '"wght" 330' : CHIP_GLYPH_AXES}
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
    hasAttachments: hasActiveAttachments,
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
  const responseControlActive = isGenerating || isResponseRevealing;

  // Gemini mounts its send button only when there is something to send. With an
  // empty box the trailing cluster is [model pill][mic] and no send node exists
  // in the DOM at all — not hidden, absent. Measured: on the first character
  // `input-buttons-wrapper-bottom` gains
  // `div.mat-mdc-tooltip-trigger.send-button-container`, and on the last delete
  // it loses it again; 4 mount/unmount pairs in one capture, no exceptions.
  //
  // Willow's slot is dual-purpose, so this is not a straight copy. With a live
  // model added the empty-box slot is the Live toggle and has to stay. It is
  // only with no live model that an empty box leaves the slot with nothing to
  // say — that is the case that used to render a dulled, inert send button, and
  // the case Gemini renders as nothing.
  //
  // `isTranscribingDictation` is excluded deliberately: that state owns the
  // slot as a progress spinner, and it is reached with the box still empty.
  const showSubmitControl = !(
    chatVariant
    && !hasContent
    && !liveAvailable
    && !responseControlActive
    && !isTranscribingDictation
  );

  // True when this slot is the one that mounts and unmounts with the draft, so
  // the entrance below applies only where Gemini actually plays it. With a live
  // model the button is permanent and animating it on composer mount would be
  // an entrance Gemini has no equivalent for.
  const isSubmitControlContentGated = chatVariant && !liveAvailable;

  // Synchronous expand flag for the LEFT CLUSTER ONLY: when a tool is picked, the
  // chip mounts in the same render, so the left group's bottom/py must flip now
  // (not 1 frame later via useEffect) or the taller chip shoves Plus upward.
  // An attachment is the same case — the tile row mounts in the same render.
  // Container pb + textarea padding intentionally stay on isSolidExpanded so the
  // RAF sets them next frame and the collapsed→multiline padding transition
  // still plays without disturbing the attachment-row expansion.
  const solidExpanded = isDictationActive
    ? false
    : isSolidExpanded || !!selectedTool || hasActiveAttachments || (chatVariant && isComposerMaximized);
  const composerPaddingExpanded = isDictationActive ? false : isSolidExpanded;
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
          
          {/*
            * Attachment strip.
            *
            * The negative inline margin is not decoration — it is what puts the first tile
            * 12px from the composer's outer edge. Measured on Gemini: fieldset x=582, first
            * tile x=594. It gets there because `.attachment-preview-wrapper` carries
            * `margin-inline: -12px` to cancel `.text-input-field`'s own `padding: 12px`,
            * then `padding-inline: 12px` to place the tile. Ours cancels this shell's
            * `pl-[14px]`/`pr-[15px]` the same way; without it tiles sat at 26px, which is
            * the extra left gap that was reported.
            *
            * Spanning the full shell width also puts the mask's 12px fade exactly on the
            * tile edge, which is the other thing the negative margin buys.
            *
            * Rendered conditionally rather than collapsed with `grid-rows-[0fr]` inside an
            * `overflow-hidden` wrapper. That wrapper existed only to animate the height,
            * and once the animation went (Gemini has none) it was left clipping the strip
            * at its own narrower box — 588.4 against the strip's 574.4 — which sliced 2.4px
            * off the first tile's left edge and showed as a dark strip under the corner
            * radius. Gemini renders no such wrapper either: its `row-gap` rule keys off
            * `:has(.attachment-preview-wrapper)`, which only means anything if the wrapper
            * is absent when nothing is attached.
            * Uses symmetric 12px padding (`px-3`) matching Gemini's layout and mask fade.
            *
            * Vertical rhythm matches by construction: pt-3 + 112 + pb-2 == Gemini's
            * `padding-top: 12px` + 112 tile + `row-gap: 8px`.
            */}
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

          {/*
            * Main input row. This wrapper's padding IS the box height: it swings
            * 40px (`py-[20px]`) to 78px (`pt-4 pb-[62px]`) on expand, so anything
            * transitioning `padding` here animates the whole composer growing and
            * shrinking.
            *
            * The chat variant does not transition it, because Gemini doesn't.
            * Every element in Gemini's size chain computes to
            * `transition-duration: 0s` — `.input-area`, `.text-input-field`,
            * `.text-input-field_textarea-wrapper`, `rich-textarea`,
            * `.leading-actions-wrapper`, `.trailing-actions-wrapper` are all
            * `all / 0s`, and `.ql-editor` / `.text-input-field_textarea-inner`
            * are `none / 0s`. The only authored height transitions in the whole
            * composer are on `.text-input-field_textarea-wrapper.pre-fullscreen`
            * and `.fullscreen` (`height 0.4s cubic-bezier(0.2,0,0,1)`), which
            * govern the near-fullscreen toggle and not ordinary wrapping. There
            * is a `.ui-improvements-phase-1 .text-input-field_textarea-inner
            * { transition: height 0.25s }` in the cascade, but it is overridden
            * and computes to `none`.
            *
            * So Gemini's box snaps to its new size on wrap, on unwrap, on send
            * and on paste. Ours does too. Gemini's remaining composer transitions
            * are opacity/transform only (send button, mic, placeholder,
            * fullscreen control) plus `box-shadow 0.1s` on `input-area-v2` and
            * `padding-inline 0.2s` on `input-container`; none of those is size.
            */}
          <div className={`textarea-wrapper flex flex-col w-full relative ${chatVariant ? '' : 'transition-all duration-200'} ${isComposerMaximized && chatVariant ? 'flex-1 min-h-0 pt-4 pb-[62px]' : composerPaddingExpanded ? chatVariant ? 'pt-4 pb-[62px]' : 'pt-4 pb-[52px]' : chatVariant ? 'py-[20px] min-h-[64px]' : 'py-[16px] min-h-[56px]'}`}>
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
            {/*
              * Collapsed `pl` tracks the plus button: Gemini's single-line row is a
              * grid with `column-gap: 8px`, so its text sits 8px past the 32px icon
              * — 20+32+8 = 60px from the box. Ours is 14 (box) + 46 = 60, which is
              * why this moves with left-[6px] above and not independently of it.
              * It also lands on the dictation waveform's own left-[46px], which the
              * old 40px missed by the same 6px.
              */}
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
              placeholder={dictationPlaceholder || placeholder || (chatVariant ? "Ask Willow" : "Ask anything")}
              style={{
                height: '24px',
                minHeight: '24px',
                scrollbarGutter: solidExpanded ? 'auto' : 'stable',
                fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400',
              }}
              /*
               * No scrollbar, because Gemini's composer shows none. Its rules are authored
               * (12px bar, 8px thumb, #444746 on thumb hover) but Chromium never repaints
               * that layer for this scroller — four renders of the live app confirmed it,
               * so the prompt box scrolls with nothing visible in the gutter. Hiding the
               * bar reproduces what is on screen; the default black strip did not.
               */
              className={`willow-dictation-textarea w-full bg-transparent text-white outline-none font-normal resize-none overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${isComposerMaximized && chatVariant ? 'flex-1 min-h-0' : ''} ${chatVariant ? "text-[17px] leading-6 placeholder-[#bdc1c6] font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]" : 'transition-[padding,opacity] duration-200 text-[15.5px] placeholder-[#8e8e8e]'} ${chatVariant && isDictationActive ? 'dictation-hidden' : chatVariant && isExitingDictation ? 'exiting-dictation' : ''} ${isComposerMaximized && chatVariant ? 'pl-[10px] pr-[24px]' : composerPaddingExpanded ? chatVariant ? 'pl-[10px] pr-[24px]' : 'pl-[0px] pr-[0px]' : `${chatVariant ? 'pl-[46px] pr-[var(--chat-collapsed-right-padding)]' : 'pl-[40px] pr-[76px]'}`}`}
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
            {/*
              * Leading actions. `left` is measured off Gemini's real composer,
              * recorded while it was typed into a line at a time and held.
              *
              * Gemini's single-line offset is three authored pieces
              * (@media min-width:768px):
              *
              *   .text-input-field                padding: 12px
              *   .leading-actions-wrapper         margin-inline-start: 2px
              *                                      — but only :where(.simplified-input-area)
              *   .simplified-input-menu-container margin-inline-start: 6px
              *
              * = 20px. At two lines Gemini DROPS `simplified-input-area` (picking
              * up `height-expanded-past-single-line with-toolbox-drawer`), so the
              * 2px rule stops matching and the plus lands at 12+0+6 = 18px. Our
              * box pads 14px where Gemini's pads 12, so those are left-[6px] and
              * left-[4px]. Measured settled dwells: 20px @ h=64, 18px @ h=126 and
              * h=150.
              *
              * MEASURING THIS IS DELICATE. Pasting a large block animates the
              * height from 64px to ~208px in one sweep while Angular's class flip
              * lags several frames; sampling during that reads 20px at heights it
              * never actually rests at, which looks like "no horizontal movement".
              * Type a line at a time and let it settle, or don't trust the number.
              */}
            <div className={`absolute shrink-0 flex items-center gap-2 z-[60] ${solidExpanded && chatVariant ? 'bottom-[5px] left-[4px]' : solidExpanded ? 'bottom-[6px] left-[0px]' : `bottom-[16px] ${chatVariant ? 'left-[6px]' : 'left-[0px]'}`}`}>
              <div className={`${chatVariant ? 'w-8' : 'w-[30px]'} flex items-center justify-center ${solidExpanded ? 'py-2.5' : ''}`}>
                <button 
                  ref={solidPlusRef}
                  onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
                  disabled={disabled}
                  aria-label="Upload & tools"
                  aria-expanded={isPlusMenuOpen}
                  className={`${chatVariant ? 'w-8 h-8 rounded-full text-[#e6e6e6] hover:bg-[#333537]' : 'text-[#a0a0a0] hover:text-white'} flex items-center justify-center transition-colors outline-none disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent`}
                >
                  {chatVariant
                    ? (
                      /*
                       * Open turns the plus into a cross by rotating it, which
                       * is what Gemini does — it is the same glyph, not a swap
                       * to a `close` symbol. 45deg is exact rather than chosen:
                       * a plus has 90deg rotational symmetry, so 45deg is the
                       * unique angle that lands its arms on the diagonals.
                       * Duration/easing reuse the app's Gemini-derived motion
                       * token rather than being freshly measured.
                       */
                      <span
                        className="flex items-center justify-center"
                        style={{
                          transform: isPlusMenuOpen ? 'rotate(45deg)' : 'rotate(0deg)',
                          transition: 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
                        }}
                      >
                        <MaterialSymbol family="luminous" name="plus" size={24} weight={300} roundness={100} opticalSize={24} />
                      </span>
                    )
                    : <Plus size={22} strokeWidth={2.5} />}
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
              {/* No entrance/exit animation: measured against Gemini, both directions are
                  instant. rAF traces of the attach (70 frames) and detach (71 frames) show
                  the field snapping 64<->102px in a single frame with getAnimations() empty
                  on the field, input area, leading cluster and toolbox-drawer throughout —
                  against a passing positive control. The Angular ng-trigger-toolboxDrawerEnter
                  attribute is present but declares no animation that runs here. */}
              {selectedTool && (
                <div className="mt-[1px]">
                  <ToolChip toolId={selectedTool} onRemove={() => setSelectedTool(null)} />
                </div>
              )}
            </div>
            
            {/* The trailing controls are right-anchored to `.textarea-wrapper`,
              * whose right edge never moves — the shell's `pr-[15px]` is constant
              * and the wrapper is `w-full`. So this `right` value is the ONLY
              * thing that can shift them horizontally, and it must not change
              * with `solidExpanded`. It used to go 0 -> 1px on expand, which rode
              * invisibly on the 400ms ease; with the ease gone (Gemini doesn't
              * have one) the same 1px became a visible sideways jerk on every
              * wrap and unwrap. Keep it constant. */}
            <div ref={rightControlsRef} className={`absolute flex items-center h-10 shrink-0 ${chatVariant ? 'gap-1' : 'gap-3 transition-all duration-200'} ${chatVariant ? 'bottom-[12px] right-[0px]' : 'bottom-[10px] right-[0px]'}`}>
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
                  // ChatGPT transitions only the colour group, over 200ms on
                  // cubic-bezier(0.4, 0, 0.2, 1) — measured off its own button.
                  isMicMuteToggle
                    ? 'transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]'
                    : 'transition-all duration-200'
                } ${
                  // Muted is the only state that recolours the button: ChatGPT's
                  // ramp is #ff002a rest / #fa423e hover / #ba2623 active, with
                  // the glyph white and dimming to #cdcdcd on hover. Unmuted it
                  // is the ordinary composer mic, unchanged.
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
                {/* Laid over the existing glyph rather than swapping the icon —
                    same colour, so the two merge into one shape the way
                    ChatGPT's purpose-drawn muted glyph does. Sized to the icon,
                    not the button, since the slash spans the glyph's box. */}
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
                  // Stop outranks send: while a reply streams this slot is the
                  // stop control, so a click here must never submit the draft.
                  if (isGenerating) return onStopGenerating?.();
                  // Keep the stop slot inert while the finished response's
                  // reveal drains; it must not submit a draft in this phase.
                  if (isResponseRevealing) return;
                  if (hasContent) return handleSubmit();
                  if (!chatVariant) return;
                  if (!liveAvailable) return;
                  if (isComposerMaximized) setIsComposerMaximized(false);
                  // Empty input in chat → the AudioLines button is the Live
                  // toggle. Same 34×34 circle so footer height is unchanged
                  // and the Chat spacing math stays valid.
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
                    ? // Measured, not inferred from the aria-label: Gemini's send
                      // button is aria-label="Send message" but its tooltip reads
                      // "Submit". Below-placed, gap 8 (trigger bottom 428.8 ->
                      // surface 436.8), centred (surface centre 1210.05 vs
                      // trigger centre 1210).
                      'Submit'
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
                className={`${chatVariant ? 'w-8 h-8' : 'w-[34px] h-[34px]'} rounded-full flex items-center justify-center shrink-0 transition-[background-color] duration-200 shadow-sm outline-none disabled:opacity-40 disabled:cursor-default ${isSubmitControlContentGated ? 'willow-composer-send-enter' : ''} ${isDictationActive && !isGenerating ? 'cursor-default' : 'cursor-pointer'} ${isTranscribingDictation && !isGenerating ? 'willow-transcription-spinner' : ''} ${
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
  }

  return (
    <div className="w-full max-w-2xl mx-auto relative z-20">
      {githubImportDialog}
      <div className={`${promptBoxBg} backdrop-blur-2xl border border-white/5 rounded-[1.75rem] p-2 shadow-2xl flex flex-col gap-1 ring-1 ring-white/5`}>
        {/* Attachments Area. Same construction as the chat variant above; this shell pads
            with `p-2`, so that is what the negative margin cancels before the 12px inset. */}
        {attachments.length > 0 && (
          <div className="-mx-2 flex max-h-[168px] gap-2 overflow-x-auto px-3 pb-2 pt-3 [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent_0,#000_12px,#000_calc(100%_-_12px),transparent_100%)] [&::-webkit-scrollbar]:hidden">
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

        {/* No scrollbar — see the chat-variant textarea for the measured reason. */}
        <textarea
          ref={textareaRef}
          placeholder="Ask Willow to create an internal tool that..."
          className="w-full bg-transparent text-white placeholder-zinc-500 px-4 pt-2.5 pb-2 outline-none resize-none text-[15px] font-light leading-relaxed overflow-y-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                  selectedTool={selectedTool}
                personalIntelligence={personalIntelligence}
                onTogglePersonalIntelligence={setProfileEnabled}
                sparkMode={sparkMode}
                sparkToolsEnabled={sparkToolsEnabled}
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


