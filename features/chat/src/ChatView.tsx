import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, LayoutGroup, motion, useAnimationControls } from 'framer-motion';
import { InputBar, type Attachment as ComposerAttachment, type ComposerHandle } from './composer/Composer';
import type { ToolId } from './composer/composer-options';
import {
  $expandedCanvasCards,
  $openCanvas,
  applyCanvasEdit,
  buildCanvasDocs,
  canvasCardKey,
  canvasSliceCitations,
  canvasSplitOffset,
  collapseCanvasCardsFor,
  collapseCanvasToCard,
  setCanvasCardExpanded,
  toggleCanvasCard,
  type CanvasRef,
} from './canvas/canvas-store';
import { decodeCanvasHistory, encodeCanvasHistory } from './canvas/canvas-diff';
import { CanvasCard } from './canvas/CanvasCard';
import { CanvasPanel } from './canvas/CanvasPanel';
import { CanvasPromptFab } from './canvas/CanvasPrompt';
import { floatingTurns } from './canvas/canvas-floating';
import { GeneratedMediaCard } from './media/GeneratedMediaCard';
import { SentImageViewer } from './media/SentImageViewer';
import { isThreadImage, newestThreadImage } from './media/previous-image';
import { shareMedia } from './media/GeneratedImage';
import { MediaGallery } from './media/MediaGallery';
import { isGalleryTool, type MediaTemplate } from './media/media-templates';
import { markVideoDiscoverySeen, VideoDiscoveryCard, videoDiscoverySeen } from './media/VideoDiscoveryCard';
import { ImagesPage } from './media/ImagesPage';
import type { ImagesPageTemplate } from './media/images-page-templates';
import { $chatCreationPage, $chatCreationPageRequest, creationPageTool, type ChatCreationPage } from './chat-page-store';
import { usePhone } from './composer/ComposerCompanion';
import { ResearchCard, ResearchPlanCard } from './research/ResearchCards';
import { ResearchPanel, type ResearchCreateKind } from './research/ResearchPanel';
import { cancelResearch, researchJob, startResearch, subscribeResearch } from './research/research-runner';
import { RESEARCH_DONE_REPLY, RESEARCH_STARTED_REPLY, type ResearchRecord } from './research/research-types';
import { apiKeysForBinding, resolveProviderBinding } from '@willow/ai/providers/profiles';
import { generatingStatusFor, sanitizeSavedMedia, type GeneratedMedia } from './media/generated-media';
import { blobToInlineImage, type InlineImage } from './media/media-clients';
import type { ChatMediaStore } from './media/media-host';
import type { MediaToolOptions } from './media/media-tools';
import {
  $chatNotebookId,
  $notebookHandoff,
  consumeNotebookHandoff,
} from '@willow/notebooks/notebook-chat-store';
import { notebooksStore } from '@willow/notebooks/notebooks-store';
import { $chatGemId, gemStartingTool } from '@willow/gems/gem-chat-store';
import { gemIdForChat, gemsStore, hydrateGems, recordGemChat, resolveGem } from '@willow/gems/gems-store';
import { GemZeroState } from '@willow/gems/GemZeroState';
import { gemLogoSpec } from '@willow/gems/GemLogo';
import { useNotebookDisk } from '@willow/notebooks/useNotebookDisk';
import { HeroSection, PinnedChatGreeting, useGreetingReady } from '@willow/media/MediaHome';
import { BottomPanel } from '@willow/media/MediaShowcase';
import { TextShimmer } from '@willow/ui/text-shimmer';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { StreamingMarkdown } from '@willow/ui/StreamingMarkdown';
import { CodeExecutionPanel } from '@willow/ui/CodeExecutionPanel';
import { GeminiDialog, GeminiDialogPill } from '@willow/ui/GeminiDialog';
import { GeminiAttachmentCard } from '@willow/ui/GeminiAttachmentCard';
import { RichResource, RichResourcePanel } from '@willow/ui/RichResourcePreview';
import { MobileModelPicker } from './MobileModelPicker';
import { ResponseActions, ShowCodeToggle, SourcesSidebar, ThinkingStepsSidebar } from './ChatResponseChrome';
import { GeminiThinkingVisualizer } from './GeminiThinkingVisualizer';
import { ThoughtSummaryLine, connectingHeading, latestThoughtHeading } from './ThoughtSummaryLine';
import { ChatMentions } from './composer/mentions/ChatMentions';
import { useChatMentionOptions } from './composer/mentions/use-chat-mention-options';
import { mentionsIn, type MentionOption } from './composer/mentions/mentions';
import { chatApp } from './composer/mentions/chat-apps';
import { skillLibrary } from '@willow/core/skill-library';
import { takeChatSeed } from '@willow/core/shell-request';
import { ChatCreatedCard } from './library/ChatCreatedCards';
import { UserMessageBubble } from './UserMessageBubble';
import { ResponseInfoLine } from './ResponseInfoLine';
import { streamChat, isAbortError, ChatMessage as AiChatMessage, StreamPhase } from '@willow/ai/chat';
import type { MessageCitations } from '@willow/ai/grounding';
import type { CodeExecution } from '@willow/ai/code-execution';
import {
  GeminiLiveSession,
  LiveHistoryTurn,
  LIVE_MODEL_ID,
  playLiveSessionCue,
  primeLiveSessionCues,
} from '@willow/ai/live';
import { useAuth } from '@willow/auth/AuthContext';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { useLocalFS, isTempChatId } from '@willow/storage/local-fs/LocalFSContext';
import { chatSelectionEpoch } from '@willow/storage/local-fs/chat-selection-store';
import { isCodeChat, isCodeChatBody, markCodeChat } from '@willow/storage/code-chat-storage';
import { requestCodeChatOpen } from '@willow/storage/code-chat-open-store';
import { finishTopLoadingReason, startTopLoadingReason } from '@willow/ui/top-loading-store';
import { showCopyToast } from '@willow/ui/copy-toast-store';
import { ChatAttachment, toPersistedChatAttachment } from '@willow/core/attachments';
import { deriveFallbackTitle, FALLBACK_CHAT_TITLE } from '@willow/core/fallback-title';
import { useThemeMode } from '@willow/core/theme-mode';
import { ChatMsg, hasSavedMessageContent, restoreSavedChatMessage, sanitizeSavedAttachment, serializeChatMessage } from './chat-message';
import {
  attachChatTurnListener,
  chatTurnsVersion,
  countRunningChatTurns,
  detachChatTurnListener,
  getChatTurn,
  getChatTurnByChatId,
  hasRunningTurnForChat,
  registerChatTurn,
  rebindChatTurnChatId,
  removeChatTurn,
  type ChatTurnListener,
  type ChatTurnRecord,
} from './chat-turn-store';
import { runChatTurn } from './chat-turn-runner';
import { buildChatTurnSetup, resolveChatTurnGrounding } from './chat-turn-setup';
import { startChatTurnJob } from './chat-turn-takeover';
import { friendlyChatErrorFor } from './chat-errors';
import { buildAiHistory as buildChatAiHistory } from './chat-history';
import { getShortModelName, resolveChatModel } from './chat-model';
import { voiceAgentSystemPrompt } from './voice-agent-prompt';
import { useOffscreenMessageSkip } from './offscreen-message-skip';
import { MARKDOWN_BLOCK_BLEED_PX } from '@willow/ui/streaming-markdown-styles';
import { waitForBrowserPaint } from './chat-timing';
import { useCompactViewport } from './use-compact-viewport';
import { findDeepBlockAnchor } from './scroll-anchor';
import { $chatPanelOpen, $voiceModeActive } from './chat-panel-store';
import { useStore } from '@nanostores/react';

import { VoiceFocusSurface, focusModeAtom } from './voice-orb/VoiceFocusSurface';
import { resolveFocusSurfaceAttributes } from './voice-orb/focus-surface-constants';
import type { WorkspaceColorName } from './voice-orb/orb-palette';
import { VoiceSettingsButton } from './voice-settings/VoiceSettingsButton';
import { VoiceSettingsDialog } from './voice-settings/VoiceSettingsDialog';
import { findVoiceProvider, listVoiceModels } from './voice-settings/voice-providers';
import { liveModelStore } from './voice-settings/live-model-store';
import {
  buildLiveVoiceOptions,
  getVoiceSelection,
  setLanguage,
  setVoice,
  voiceSettingsSignature,
  voiceSettingsStore,
} from './voice-settings/voice-settings-store';

/**
 * How long a voice/language/model change waits before it reopens the socket.
 *
 * See the effect that uses it. A policy value, not a captured one — voice rides
 * the Live API setup frame, so a change can only take effect on reconnect, and
 * this is the window in which a burst of presses counts as one decision.
 */
const LIVE_RESTART_DEBOUNCE_MS = 400;
/**
 * How long a seeded chat's thinking row shows before its fixed reply reveals. Gemini's is
 * still thinking 1.2s after the click and done by 3.5s; the chat surface's own arrival
 * takes the first few hundred milliseconds of it.
 */
const SEEDED_REPLY_THINKING_MS = 1600;

/**
 * Ceiling on simultaneous background turns.
 *
 * Not a memory bound — it is a provider one. Each turn holds an SSE connection,
 * and browsers cap concurrent connections per host; exhausting the pool would
 * stall unrelated requests, including the chat saves these very turns depend on.
 */
const MAX_CONCURRENT_CHAT_TURNS = 4;

/**
 * Strip blob URLs from a message before it is stored on a turn record.
 *
 * `createAttachmentObjectUrl` ties each URL to the ChatView that made it and
 * revokes it on unmount. A record outliving that unmount would hold URLs that
 * render as broken images, so it keeps metadata only — exactly what the load
 * path already expects, since a chat read from disk arrives without URLs too.
 */
const stripAttachmentObjectUrls = (message: ChatMsg): ChatMsg => {
  if (!message.attachments?.length) return message;
  return {
    ...message,
    attachments: message.attachments.map(({ url, ...rest }) => rest),
  };
};

/**
 * A function whose identity never changes but which always runs the latest
 * render's body. Lets the load effect call into logic that reads a lot of state
 * without that state joining the effect's dep array — which matters here because
 * the load effect's deps are load-bearing and adding to them re-runs chat loads.
 * Same helper as MediaView's and the Sidebar's.
 */
function useEventCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useMemo(() => ((...args: any[]) => ref.current(...args)) as T, []);
}

/**
 * How long the thinking-steps / sources panel animates the scroller's width.
 * Mirrors the `duration-300` on the container at the bottom of this file; it is
 * only ever read to know when the width has stopped moving.
 */
const PANEL_TRANSITION_MS = 300;

/**
 * A ResizeObserver that fires only when an observed box changes HEIGHT.
 *
 * Every ResizeObserver in this file exists for a height concern — the composer
 * growing a line, a user bubble collapsing, a reply outgrowing its reserve — but
 * a ResizeObserver fires on width too, and the thinking-steps / sources panel
 * animates the scroller's width over 300ms. So each of them used to run on all
 * ~18 frames of that animation, one of them under `flushSync`, re-rendering the
 * whole message list synchronously every frame.
 *
 * That cost two separate things. The obvious one is the jank on open/close. The
 * subtle one: Chrome's scroll anchoring (`overflow-anchor`, on by default) picks
 * a node near the top of the viewport and repays any height change above it by
 * adjusting scrollTop, which is exactly what keeps Gemini's thread from sliding
 * when its panel re-wraps the text. Measured on the live app, Gemini's scrollTop
 * moves by itself — 1904.8 -> 1856.8 for a 48px shrink — and the tracked element
 * holds position to the pixel. Willow got no such repayment, because the
 * synchronous re-render churn kept invalidating the anchor the browser had
 * chosen. Gating on height lets the browser do that work for us.
 *
 * Width-driven callbacks are dropped, not deferred: nothing here reads a width.
 *
 * The height gate alone isn't enough for the panel, though. Narrowing the column
 * re-wraps the text, and re-wrapped text is a real height change (measured: 288px
 * on a long reply), so the gate passes on every frame of the animation anyway.
 * `deferMs` covers that: while it returns a positive number the callback is
 * coalesced into a single trailing run once the window closes, instead of forcing
 * a synchronous layout of the whole thread ~18 times. Every callback here is
 * idempotent and reads only current DOM state, so one run at the end lands on the
 * same values the per-frame runs would have converged to.
 */
const observeHeight = (
  callback: () => void,
  deferMs?: () => number,
): ResizeObserver => {
  const seen = new WeakMap<Element, number>();
  let trailing: ReturnType<typeof setTimeout> | null = null;
  const observer = new ResizeObserver((entries) => {
    let heightChanged = false;
    for (const entry of entries) {
      const height = entry.contentRect.height;
      const previous = seen.get(entry.target);
      // Must track sub-pixel changes strictly: user-bubble collapse is a CSS
      // max-height transition. Filtering small delta jumps drops frames, which
      // causes the container scrollHeight to dip before the observer catches up.
      if (previous !== height) {
        seen.set(entry.target, height);
        heightChanged = true;
      }
    }
    if (!heightChanged) return;

    const remaining = deferMs ? deferMs() : 0;
    if (remaining <= 0) {
      if (trailing !== null) { clearTimeout(trailing); trailing = null; }
      callback();
      return;
    }
    if (trailing !== null) clearTimeout(trailing);
    trailing = setTimeout(() => { trailing = null; callback(); }, remaining);
  });

  const disconnect = observer.disconnect.bind(observer);
  observer.disconnect = () => {
    if (trailing !== null) { clearTimeout(trailing); trailing = null; }
    disconnect();
  };
  return observer;
};

/**
 * How long the scroll pin keeps correcting after the panel's width has settled.
 *
 * The observers above coalesce their work to the trailing edge of the panel
 * window, and one of them writes the response reserve — so a real height change
 * lands ~360ms in, AFTER the animation is visually over. A pin that stopped with
 * the transition would fix 300ms of drift and then let that last step through.
 */
const PANEL_PIN_TAIL_MS = 120;

/**
 * Sampler for the app's emphasised curve, `cubic-bezier(0.2, 0, 0, 1)`.
 *
 * The new-turn entrance drives a transform AND a scrollTop off one timeline, so
 * the easing has to be evaluated in JS instead of handed to CSS. Newton-Raphson
 * to invert x(u), then evaluate y(u); the curve is steep early, so a handful of
 * iterations from a linear guess lands well inside a pixel.
 */
const sampleEmphasisedEase = (t: number): number => {
  const axis = (c1: number, c2: number, u: number) => {
    const a = 3 * c1;
    const b = 3 * (c2 - c1) - a;
    const c = 1 - a - b;
    return ((c * u + b) * u + a) * u;
  };
  const axisSlope = (c1: number, c2: number, u: number) => {
    const a = 3 * c1;
    const b = 3 * (c2 - c1) - a;
    const c = 1 - a - b;
    return (3 * c * u + 2 * b) * u + a;
  };
  let u = t;
  for (let i = 0; i < 5; i += 1) {
    const slope = axisSlope(0.2, 0, u);
    if (Math.abs(slope) < 1e-6) break;
    u -= (axis(0.2, 0, u) - t) / slope;
  }
  return axis(0, 1, Math.min(1, Math.max(0, u)));
};

interface ChatViewProps {
  modelConfig: any;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  isAuthenticated?: boolean;
  onAuthRequired?: () => void;
  onOpenDriveSettings?: () => void;
  isIncognito?: boolean;
  onChatStartedChange?: (started: boolean) => void;
  isSidebarCollapsed?: boolean;
  onCollapseSidebar?: () => void;
  /**
   * Resets to an empty chat. Owned by `App` (it holds the reset key and the
   * has-active-chat / incognito flags), and needed here only for the
   * "Start new chat" button on the prompt-copy snackbar — Gemini raises that
   * snackbar from the prompt Copy button, which lives in this tree.
   */
  onNewChat?: () => void;
  /** Workspace colour from the profile; tints the voice orb. */
  workspaceColor?: WorkspaceColorName;
}

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────
export const ChatView: React.FC<ChatViewProps> = ({
  modelConfig,
  selectedModelId,
  setSelectedModelId,
  isAuthenticated,
  onAuthRequired,
  onOpenDriveSettings,
  isIncognito = false,
  onChatStartedChange,
  isSidebarCollapsed = true,
  onCollapseSidebar,
  onNewChat,
  workspaceColor,
}) => {
  const { isLight } = useThemeMode();
  const isCompact = useCompactViewport();
  const { loading: isAuthResolving } = useAuth();
  const { apiKeys, loading: areKeysLoading } = useUserDataContext();
  const {
    isLocalFolderConnected,
    saveLocalFSChat,
    saveLocalFSChatAttachment,
    loadLocalFSChatAttachment,
    generateChatTitle,
    activeChatId,
    loadLocalFSChat,
    localChats,
    chatScopeId,
    selectLocalFSInboxChat,
    // Fast flag: the chat registry is on screen and `activeChatId` has settled.
    // Drives the boot dock (see `isBootHydrating`), NOT any disk work.
    isChatListHydrated,
  } = useLocalFS();

  // Filing a notebook chat has a registry half and a disk half; this hook owns both.
  // Wrapped for a stable identity so the filing effect below can key on the chat id
  // alone — `fileChat` closes over a context callback, and re-firing the effect on
  // every provider re-render would put an idempotent disk probe behind each one.
  const { fileChat: fileChatLatest } = useNotebookDisk();
  const fileChat = useEventCallback(fileChatLatest);

  // A background turn outlives this component, so the runner cannot call through
  // the context — by the time it saves, this ChatView may be gone. Both are safe
  // to capture: `saveLocalFSChat` reads all its state through refs, and the scope
  // is re-read at write time so a turn whose scope changed declines to write.
  const saveLocalFSChatRef = useRef(saveLocalFSChat);
  useEffect(() => { saveLocalFSChatRef.current = saveLocalFSChat; }, [saveLocalFSChat]);
  const chatScopeIdRef = useRef(chatScopeId);
  useEffect(() => { chatScopeIdRef.current = chatScopeId; }, [chatScopeId]);
  // Chat shows a new chat, and the shell opens the Code chat in Code.
  const handOverCodeChat = useEventCallback((chatId: string) => {
    selectLocalFSInboxChat(null);
    requestCodeChatOpen(chatId);
  });

  // Unique session ID for auto-saving chats locally
  const [chatSessionId, setChatSessionId] = useState(() => {
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    return `${dateStr}_${Math.random().toString(36).slice(2, 8)}`;
  });

  const [chatTitle, setChatTitle] = useState<string | null>(null);


  // ── State ──────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const attachmentObjectUrlsRef = useRef<Set<string>>(new Set());
  const attachmentBlobsRef = useRef<Map<string, Blob>>(new Map());
  const [externalReloadVersion, setExternalReloadVersion] = useState(0);
  const forceExternalReloadRef = useRef(false);
  const pendingExternalReloadRef = useRef<string | null>(null);
  // Bumped on entry to every chat load. A load that finds its generation
  // superseded must not touch state: clicking A -> B -> C runs three loads that
  // are NOT mutually ordered (enqueueChatOperation serialises per chat id, so
  // each id has its own queue), and whichever resolves last used to win. That
  // lost race also corrupted disk, because autosave keys on
  // `chatTitle || chatSessionId` — a stale winner set those to its own id and
  // the next save wrote the CURRENT chat's messages under it.
  const loadGenerationRef = useRef(0);
  // True while a user-selected chat's body is being read. The conversation area
  // renders nothing in this window (the composer stays pinned) instead of leaving
  // the PREVIOUS chat painted, which is what it used to do for the whole
  // lock + IndexedDB + disk + JSON.parse + per-attachment-read round trip.
  const [isChatLoading, setIsChatLoading] = useState(false);
  const selectionEpoch = useStore(chatSelectionEpoch);
  const consumedSelectionEpochRef = useRef(selectionEpoch);

  /*
   * The Gem this chat is with, if any — set by the `/gem/<id>` route, or restored below
   * when a chat is reopened. It changes the zero state, the composer's starting tool and
   * the system prompt; everything else is an ordinary chat.
   */
  const activeGemId = useStore($chatGemId);
  const gemList = useStore(gemsStore);
  const activeGem = resolveGem(activeGemId, gemList);
  useEffect(() => { hydrateGems(); }, []);

  /*
   * A chat the user opens brings its own Gem and notebook back. Keyed on the selection
   * epoch, which only a real selection moves — renames and temp-id adoption change
   * `activeChatId` too, and must not clear a context mid-conversation.
   */
  const contextSelectionEpochRef = useRef(selectionEpoch);
  useEffect(() => {
    if (selectionEpoch === contextSelectionEpochRef.current) return;
    contextSelectionEpochRef.current = selectionEpoch;
    if (!activeChatId) return;
    $chatGemId.set(gemIdForChat(activeChatId));
    const owner = notebooksStore.get().find((notebook) => notebook.chatIds.includes(activeChatId));
    $chatNotebookId.set(owner?.id ?? null);
  }, [selectionEpoch, activeChatId]);
  // The reason string currently held on the shared top-loading store, so it can
  // be released from a `finally`, from a superseded load, and on unmount. The
  // store is module-level and survives ChatView's `key={chatResetKey}` remount:
  // dropping a reason leaves the green bar running forever.
  const topLoadingReasonRef = useRef<string | null>(null);
  const releaseChatLoading = useCallback(() => {
    if (topLoadingReasonRef.current) {
      finishTopLoadingReason(topLoadingReasonRef.current);
      topLoadingReasonRef.current = null;
    }
    setIsChatLoading(false);
  }, []);
  useEffect(() => () => {
    if (topLoadingReasonRef.current) finishTopLoadingReason(topLoadingReasonRef.current);
  }, []);

  const createAttachmentObjectUrl = useCallback((blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    attachmentObjectUrlsRef.current.add(url);
    return url;
  }, []);

  /**
   * `keepBlobs` is for a reload of the chat already on screen. Object URLs must
   * still be revoked and remade — they are what the tiles render — but the blob
   * cache behind them is this view's only copy of an attachment whose IndexedDB
   * write has not landed yet, and dropping it makes that attachment
   * unrecoverable for the rest of the session. A real chat switch still clears
   * it, so the cache stays bounded by the chat you are actually in.
   */
  const revokeAllAttachmentObjectUrls = useCallback((options?: { keepBlobs?: boolean }) => {
    for (const url of attachmentObjectUrlsRef.current) URL.revokeObjectURL(url);
    attachmentObjectUrlsRef.current.clear();
    if (!options?.keepBlobs) attachmentBlobsRef.current.clear();
  }, []);

  const hydrateSavedAttachments = useCallback(async (
    values: unknown,
    chatId?: string | null,
  ): Promise<ChatAttachment[] | undefined> => {
    if (!Array.isArray(values) || values.length === 0) return undefined;
    const metadata = values
      .map(sanitizeSavedAttachment)
      .filter((attachment): attachment is ChatAttachment => !!attachment);
    const hydrated = await Promise.all(metadata.map(async (attachment) => {
      // Memory first, disk second — the same precedence `handleOpenAttachment`
      // uses, and for the same reason. The two writes a sent attachment needs
      // are not ordered against each other: the chat body reaches disk as soon
      // as the turn settles (the autosave effect owns that save and does not
      // await `attachmentPersistence`), while the bytes go to IndexedDB on their
      // own promise. The disk-sync reload that follows the body save therefore
      // routinely reads this store before the blob exists. Falling straight
      // through to url-less metadata there is what turned a sent image into a
      // generic file chip the moment a response completed, and it was permanent:
      // nothing re-hydrates an already-rendered tile.
      // Then the copy kept beside the chat in the folder, for when the browser's is gone.
      const cached = attachmentBlobsRef.current.get(attachment.id);
      const blob = cached ?? (await loadLocalFSChatAttachment(
        attachment.id,
        chatId ? { chatId, attachment } : undefined,
      ))?.blob;
      // A repository is its link, so it never reads as missing.
      if (!blob) return attachment.kind === 'github' ? attachment : { ...attachment, unavailable: true };
      attachmentBlobsRef.current.set(attachment.id, blob);
      return { ...attachment, url: createAttachmentObjectUrl(blob) };
    }));
    return hydrated.length > 0 ? hydrated : undefined;
  }, [createAttachmentObjectUrl, loadLocalFSChatAttachment]);

  const hydrateSavedMedia = useCallback(async (
    values: unknown,
    chatId?: string | null,
  ): Promise<GeneratedMedia[] | undefined> => {
    const media = sanitizeSavedMedia(values);
    if (!media) return undefined;
    const hydrateOne = async (attachment: ChatAttachment | undefined) =>
      attachment ? (await hydrateSavedAttachments([attachment], chatId))?.[0] : undefined;
    return Promise.all(media.map(async (item) => {
      const [attachment, cover] = await Promise.all([hydrateOne(item.attachment), hydrateOne(item.cover)]);
      return { ...item, ...(attachment ? { attachment } : {}), ...(cover ? { cover } : {}) };
    }));
  }, [hydrateSavedAttachments]);

  /** Where a generated image, video or track lands: this view's blob cache, and the chat folder. */
  const keepGeneratedMedia = useCallback<ChatMediaStore['keep']>(async ({ blob, mimeType, name, kind }) => {
    const id = `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const subtype = (mimeType.split('/')[1] || '').split(/[+;]/)[0].toLowerCase();
    const extension = ({ jpeg: 'jpg', mpeg: 'mp3', 'x-wav': 'wav', wave: 'wav', quicktime: 'mov' } as Record<string, string>)[subtype] ?? subtype;
    const attachment: ChatAttachment = {
      id,
      name: extension ? `${name}.${extension}` : name,
      mimeType,
      size: blob.size,
      kind,
      extension,
    };
    attachmentBlobsRef.current.set(id, blob);
    if (!isIncognito && isLocalFolderConnected) await saveLocalFSChatAttachment(attachment, blob);
    return { ...attachment, url: createAttachmentObjectUrl(blob) };
  }, [createAttachmentObjectUrl, saveLocalFSChatAttachment, isIncognito, isLocalFolderConnected]);
  const mediaStore = useMemo<ChatMediaStore>(() => ({ keep: keepGeneratedMedia }), [keepGeneratedMedia]);

  useEffect(() => () => {
    revokeAllAttachmentObjectUrls();
  }, [revokeAllAttachmentObjectUrls]);

  useEffect(() => {
    const handleBodyUpdate = (event: Event) => {
      const chatId = (event as CustomEvent<{ chatId?: string }>).detail?.chatId;
      if (!chatId || chatId !== activeChatId) return;
      pendingExternalReloadRef.current = chatId;
      if (isGeneratingRef.current || isLiveRef.current) return;
      pendingExternalReloadRef.current = null;
      forceExternalReloadRef.current = true;
      setExternalReloadVersion((version) => version + 1);
    };
    window.addEventListener('willow_chat_body_updated', handleBodyUpdate);
    return () => window.removeEventListener('willow_chat_body_updated', handleBodyUpdate);
  }, [activeChatId]);

  // A turn for this chat that this view did not start: another tab closed
  // mid-reply and this tab picked it up. Reloading is what attaches to it
  // (`commitLoadedChat`), in the same commit as the thread.
  const turnsVersion = useStore(chatTurnsVersion);
  useEffect(() => {
    if (!activeChatId || attachedTurnIdRef.current || sendInFlightRef.current) return;
    if (getChatTurnByChatId(activeChatId)?.status !== 'running') return;
    forceExternalReloadRef.current = true;
    setExternalReloadVersion((version) => version + 1);
  }, [turnsVersion, activeChatId]);

  /**
   * Stop mirroring whatever turn this view was showing.
   *
   * Load-bearing on unmount. A detached record has no listener, so the runner
   * claims settlement as `'runner'` and writes the result to disk itself. Leave
   * a dead listener attached and it claims `'view'` instead, calls into an
   * unmounted tree, and drops the turn without ever saving it.
   */
  const detachTurn = useEventCallback(() => {
    const turnId = attachedTurnIdRef.current;
    const listener = attachedListenerRef.current;
    if (turnId && listener) detachChatTurnListener(turnId, listener);
    attachedListenerRef.current = null;
    attachedTurnIdRef.current = null;
  });

  const attachTurn = useEventCallback((turnId: string) => {
    detachTurn();
    const listener = buildTurnListener(turnId);
    attachedListenerRef.current = listener;
    attachedTurnIdRef.current = turnId;
    setAttachedTurnId(turnId);
    attachChatTurnListener(turnId, listener);
  });

  useEffect(() => () => { detachTurn(); }, [detachTurn]);

  /**
   * Adopt a freshly-loaded chat, resuming its turn if one is still running.
   *
   * Returns true when a live turn was picked back up, which the caller uses to
   * decide whether the "nothing on disk" bookkeeping applies.
   *
   * The resume has to happen in the SAME commit as the messages. Split across
   * two effects, React would paint the saved thread with no generating row, and
   * a turn that settled in between would land its result into a listener that
   * had not been attached yet — the tokens would be on the record but never on
   * screen, which is exactly the bug this whole change exists to remove.
   */
  const commitLoadedChat = useEventCallback((chatId: string, saved: ChatMsg[]): boolean => {
    const record = getChatTurnByChatId(chatId);
    // Whatever we were mirroring belongs to the chat we are leaving. Detaching
    // before the commit means that turn falls back to the runner for its save.
    detachTurn();
    setAttachedTurnId(null);

    // A settle in the outgoing chat may have queued a frame to blank `streaming`.
    // Left pending it lands after this commit and wipes whatever we paint below.
    if (streamingClearRafRef.current !== null) {
      cancelAnimationFrame(streamingClearRafRef.current);
      streamingClearRafRef.current = null;
    }

    // Same commit as the messages, never a separate effect: any commit that
    // paired a full thread with a stale count would paint the whole thread and
    // defeat the chunked reveal.
    setRevealCount(REVEAL_INITIAL_COUNT);
    // `chatTitle` means "the human name this chat is saved under" — a temp id is
    // not one. Writing a temp id here would close the title-effect's `!chatTitle`
    // gate permanently, so the chat could never be named and the sidebar
    // skeleton would shimmer forever. chatSessionId still adopts the id, which
    // is what keeps the already-active guard above sound.
    setChatTitle(isTempChatId(chatId) ? null : chatId);
    setChatSessionId(chatId);

    if (!record) {
      setMessages(saved);
      /*
       * Nothing is running in the chat being opened, so tear down the state that
       * was mirroring the turn we just detached from.
       *
       * This is the only place that teardown can happen. `onSettled` clears the
       * same values, but it fires only for `owner === 'view'` — a turn the user
       * walked away from settles through `owner === 'runner'` and never calls
       * the listener at all. So without this, leaving a chat mid-response
       * strands all of it for the life of the component:
       *
       *  - `isGenerating` keeps the composer's send slot rendering Stop, and
       *    `handleSubmit` refuses to submit while it is true.
       *  - `generationAbortRef` still points at the OTHER chat's controller, so
       *    pressing that Stop kills a turn the user cannot even see. That is the
       *    "my background reply silently died" report.
       *  - `sendInFlightRef` makes `handleSend` return early, forever.
       *
       * Clearing, never aborting. The backgrounded turn keeps streaming and the
       * runner still owns its save.
       */
      generationAbortRef.current = null;
      sendInFlightRef.current = false;
      setIsGenerating(false);
      setStreaming('');
      setIsThinking(false);
      isThinkingRef.current = false;
      setThinkSeconds(0);
      thinkSecondsRef.current = 0;
      return false;
    }

    // Rebuilt from the record, and it OUTRANKS the copy on disk under this same
    // id. See the reconcile below for why that direction matters here and not
    // for the user message.
    const assistant: ChatMsg = {
      id: record.assistantId,
      role: 'assistant',
      content: record.status === 'settled' ? record.finalContent : '',
      isGenerating: record.status === 'running',
      isNew: record.status === 'running',
      thinkingText: record.thinkingText || undefined,
      thinkingTime: record.isError ? undefined : record.thinkSeconds || undefined,
      modelSnapshot: record.modelSnapshot,
      isError: record.isError,
      errorDetail: record.errorDetail,
      wasStopped: record.status === 'settled' ? record.wasStopped : undefined,
      citations: record.status === 'settled' ? record.citations : undefined,
      // Saved while the user was away, and saved for good: the card is due now, not at the next tick.
      created: record.created?.length ? record.created : undefined,
    };
    /*
     * Reconcile the record against the saved thread. Neither message is
     * necessarily on disk — the user message can predate the first save, and the
     * placeholder is dropped from every save by `hasSavedMessageContent` while
     * its content is still empty — but after one checkpoint both are. The two
     * then resolve in OPPOSITE directions, and that asymmetry is the point.
     *
     * **The assistant message: the record wins.** The runner checkpoints a
     * partial response as `wasStopped: true`, which is the right shape for a tab
     * that dies mid-stream, but it means the saved thread carries this id while
     * the turn is still running. Deferring to disk, as this once did, painted
     * that checkpoint verbatim: a truncated reply under a "You stopped this
     * response" divider, for a turn that was still streaming, which then rewrote
     * itself in front of the user when the answer landed. The record is the live
     * truth; the checkpoint is a crash artefact of it. It matters for a settled
     * record too — if the runner exhausted its save retries, deferring here
     * would commit the stale checkpoint permanently through the autosave path.
     *
     * **The user message: disk wins**, and only an absent one is appended. The
     * record's copy went through `stripAttachmentObjectUrls`, because its blob
     * URLs belong to the ChatView that created them and are revoked on unmount.
     * The load path's freshly hydrated copy is the one whose images render.
     *
     * The assistant is replaced in place rather than re-appended, or a thread
     * whose checkpoint is already saved reorders itself on open.
     */
    const savedIds = new Set(saved.map((message) => message.id));
    setMessages([
      ...saved.map((message) => (message.id === assistant.id ? assistant : message)),
      ...[record.userMessage, assistant].filter((message) => !savedIds.has(message.id)),
    ]);

    if (record.status === 'settled') {
      // Settled while we were away, and the runner could not persist it (or we
      // beat its save). Committing it here without advancing
      // `lastSavedMessagesRef` lets the normal autosave effect write it.
      removeChatTurn(record.turnId);
      return true;
    }

    // Still running. Re-point every piece of component state the stop button and
    // the shimmer row read, then attach so subsequent deltas land here.
    //
    // MAX, never REVEAL_INITIAL_COUNT: the reveal effect force-collapses its
    // window the instant `isGenerating` is true, and that path has no scroll
    // compensation — a small window here would mount the whole history above the
    // viewport in one uncompensated commit and shove the thread down.
    setRevealCount(Number.MAX_SAFE_INTEGER);
    // The turn started minutes ago; it must not run the new-turn entrance glide.
    //
    // Armed only when the scroll effect will actually reach this turn. Re-entering
    // a chat whose running turn was already scrolled for makes that effect bail on
    // its `lastScrolledUserId` guard, which never consumes the flag — and a flag
    // left armed sends the NEXT real send to scrollTop 0 instead of running its
    // own entrance. Same latch as the first-scroll jump above, same cure: decide
    // it here, where "is this turn new to the scroller" is still answerable.
    if (record.userMessage.id !== lastScrolledUserId.current) {
      skipNextNativeScrollRef.current = true;
    }
    setIsGenerating(true);
    setStreaming(record.content);
    setThinkingPhase(record.phase);
    setIsThinking(record.isThinking);
    isThinkingRef.current = record.isThinking;
    setThinkSeconds(record.thinkSeconds);
    thinkSecondsRef.current = record.thinkSeconds;
    generationAbortRef.current = record.abort;
    sendInFlightRef.current = true;
    attachTurn(record.turnId);
    return true;
  });

  // Listen to activeChatId and load the chat when it changes
  useEffect(() => {
    // Consume the selection epoch FIRST, before any early return. This effect
    // also runs for internal id moves (rename, temp-id adoption) and for a
    // repeat click on the chat already open, both of which bail at the identity
    // guard below. Consuming after the guard would leave a bump unclaimed and
    // the NEXT internal move would read as a user selection and blank the thread.
    const isUserSelection = selectionEpoch !== consumedSelectionEpochRef.current;
    consumedSelectionEpochRef.current = selectionEpoch;

    if (isLocalFolderConnected && activeChatId) {
      // Prevent reloading and overwriting if the selected chat is already active in memory
      const forceReload = forceExternalReloadRef.current;
      forceExternalReloadRef.current = false;
      if (!forceReload && (activeChatId === chatTitle || activeChatId === chatSessionId)) {
        return;
      }
      // Chat cannot show a Code chat, and its next save would strip the Code fields:
      // however one became the open chat, it opens in Code instead.
      if (isCodeChat(chatScopeIdRef.current, activeChatId)) {
        handOverCodeChat(activeChatId);
        return;
      }
      // Reaching here with the ids still matching means `forceReload` — a disk
      // sync of the chat already on screen, not an open. Arming the first-scroll
      // jump for it is what produced the send-time teleport: the reload commits
      // the SAME thread, so the scroll effect bails on its `lastScrolledUserId`
      // guard and never consumes the flag, leaving it armed for a send minutes
      // later. That send then runs the open-a-chat reposition — a hard jump
      // straight to the anchor — instead of its own entrance.
      //
      // Clearing it at that early return instead is NOT equivalent: a chat
      // switch loads asynchronously while a still-attached turn from the
      // previous chat keeps committing messages, and every one of those commits
      // hits the same guard. The flag would be gone before the real load landed
      // and the chat would open at the top.
      const isSameChatReload = activeChatId === chatTitle || activeChatId === chatSessionId;
      if (!isSameChatReload) isFirstScrollRef.current = true;
      const wasInitialLoad = initialLoadRef.current;
      initialLoadRef.current = true; // Block auto-save on load when switching chats

      // Bump on ENTRY only — never in an effect cleanup. This effect's deps
      // include `chatTitle`/`chatSessionId`, which `loadChat` itself writes
      // below, so a cleanup-based invalidation would make every load cancel
      // itself. Re-entry for unrelated deps is already a no-op via the
      // identity guard above.
      const generation = ++loadGenerationRef.current;
      const isCurrent = () => generation === loadGenerationRef.current;

      // Blank the conversation area only for a real user selection.
      //
      // `!forceReload` is the load-bearing term. forceExternalReloadRef
      // deliberately bypasses the identity guard above and is set by the
      // `willow_chat_body_updated` listener, which already filters to the chat
      // you are on — so forceReload means "same chat, background disk sync".
      // Blanking there would wipe a live conversation every time the 3s poll
      // finds a change. The epoch covers the other direction: rename and temp-id
      // adoption move `activeChatId` without the user asking for a new chat.
      if (isUserSelection && !forceReload && !isGeneratingRef.current && !isLiveRef.current) {
        const reason = `chat-load:${activeChatId}`;
        if (topLoadingReasonRef.current && topLoadingReasonRef.current !== reason) {
          finishTopLoadingReason(topLoadingReasonRef.current);
        }
        topLoadingReasonRef.current = reason;
        startTopLoadingReason(reason);
        setIsChatLoading(true);
      }

      const loadChat = async () => {
        try {
          const msgs = await loadLocalFSChat(activeChatId);
          // Must come BEFORE revokeAllAttachmentObjectUrls(): a superseded load
          // reaching that call revokes the WINNER's object URLs and every image
          // in the freshly-loaded thread goes blank.
          if (!isCurrent()) return;
          // A Code chat without its marker: one saved before a sign-in or sign-out,
          // or never marked. Its messages say what it is.
          if (isCodeChatBody(msgs)) {
            initialLoadRef.current = wasInitialLoad;
            markCodeChat(chatScopeIdRef.current, activeChatId);
            handOverCodeChat(activeChatId);
            return;
          }
          if (msgs && msgs.length > 0) {
            revokeAllAttachmentObjectUrls({ keepBlobs: isSameChatReload });
            // If a save happened mid-generation, the assistant placeholder
            // will have isGenerating:true and empty content — drop those.
            const withCanvasHistory = decodeCanvasHistory(msgs);
            const sanitized: ChatMsg[] = (await Promise.all(withCanvasHistory
              .map(async (m: any) => {
                const restored = restoreSavedChatMessage(
                  m,
                  await hydrateSavedAttachments(m.attachments, activeChatId),
                );
                const media = await hydrateSavedMedia(m.media, activeChatId);
                // A research run still going (or finished) in this session beats its saved snapshot.
                const live = restored.id ? researchJob(restored.id) : undefined;
                return {
                  ...restored,
                  ...(media ? { media } : {}),
                  ...(live ? { research: live, ...(live.status === 'done' ? { content: RESEARCH_DONE_REPLY } : {}) } : {}),
                };
              }))).filter((m: ChatMsg) => hasSavedMessageContent(m));

            // Attachment hydration awaits one IndexedDB read per attachment, so
            // a faster chat can overtake us here. These three setters must
            // commit together behind ONE check — `chatTitle`/`chatSessionId`
            // are what autosave persists under.
            if (!isCurrent()) return;
            if (sanitized.length > 0) {
              commitLoadedChat(activeChatId, sanitized);
              return;
            }
          }
          // Load yielded nothing usable. Don't leave the PREVIOUS chat's
          // messages on screen under the newly-selected id — adopt the id
          // with an empty thread instead (and release the load guard so the
          // first real message saves normally).
          if (!isCurrent()) return;
          revokeAllAttachmentObjectUrls({ keepBlobs: isSameChatReload });
          // Still route through the commit: a brand-new chat whose very first
          // turn is generating in the background has nothing on disk yet, and
          // dropping to an empty thread here would erase it from view.
          if (!commitLoadedChat(activeChatId, [])) {
            lastSavedMessagesRef.current = [];
            initialLoadRef.current = false;
          }
        } catch {
          // Swallowed as before, but the release below is now unconditional. A
          // corrupt blob or a revoked directory handle used to leave the thread
          // blank and the progress bar spinning with no way back.
        } finally {
          if (isCurrent()) releaseChatLoading();
        }
      };
      void loadChat();

    }
  }, [activeChatId, isLocalFolderConnected, loadLocalFSChat, chatTitle, chatSessionId, externalReloadVersion, hydrateSavedAttachments, hydrateSavedMedia, revokeAllAttachmentObjectUrls, selectionEpoch, releaseChatLoading]);

  // Handle the case where the currently active chat is deselected/deleted.
  // We must ONLY clear when an EXISTING active chat goes away (a non-null ->
  // null transition) AND it STAYS null. A brand-new chat legitimately has
  // activeChatId === null the whole time, and internal renames/syncs can briefly
  // flip it; clearing on either would wipe the user's live conversation. So we
  // (a) track the previous id, and (b) re-check after a short delay so a transient
  // null can't wipe the chat — only a sustained deselect clears it.
  const prevActiveChatIdRef = useRef<string | null>(activeChatId);
  const activeChatIdRef = useRef<string | null>(activeChatId);
  // Mirrors of isLive/isGenerating for the clear-effect's delayed re-check (they
  // are declared later in the component, so we read them via refs at fire time).
  const isLiveRef = useRef(false);
  const isGeneratingRef = useRef(false);
  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);
  useEffect(() => {
    const prev = prevActiveChatIdRef.current;
    prevActiveChatIdRef.current = activeChatId;
    if (prev !== null && activeChatId === null && messages.length > 0) {
      const t = setTimeout(() => {
        // Only a SUSTAINED, idle deselect clears the view. Never clear during a
        // live session or while generating (live mode toggles activeChatId/
        // isGenerating rapidly and can briefly read null), and never if the chat
        // became active again in the meantime.
        if (activeChatIdRef.current !== null || isLiveRef.current || isGeneratingRef.current) return;
        revokeAllAttachmentObjectUrls();
        setMessages([]);
        setChatTitle(null);
        const dateStr = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
        setChatSessionId(`${dateStr}_${Math.random().toString(36).slice(2, 8)}`);
      }, 500);
      return () => clearTimeout(t);
    }
  }, [activeChatId, messages.length, revokeAllAttachmentObjectUrls]);

  // Name the chat from the first user prompt, as soon as there is one.
  //
  // This used to wait for the first assistant reply to finish. That made naming
  // depend on something the user controls independently: stopping the very first
  // response left the chat on its temp id forever, and the sidebar renders a
  // skeleton for exactly `isTempChatId(id) && activeChatId === id`, so it
  // shimmered for the rest of the session. The prompt is enough to name a chat —
  // the reply was never needed — so the dependency is gone rather than patched
  // with another special case for stopped turns.
  //
  // Firing mid-stream is safe, and both halves of that are load-bearing:
  //   - `setChatTitle` runs before the await that flips activeChatId temp→title,
  //     so the load effect's `activeChatId === chatTitle` guard still holds and
  //     it never reloads over the live thread.
  //   - the forced external reload defers itself while isGeneratingRef is set,
  //     so the disk-sync path cannot land mid-generation either.
  // Naming is background work on its own fetch and never joins the reply's
  // critical path.
  //
  // localChats is read via a ref (not a dep) so poll-driven list reorders can't
  // re-trigger this effect, and an in-flight ref guards against a second
  // generation firing while the first is still awaiting the naming model.
  const localChatsRef = useRef(localChats);
  useEffect(() => { localChatsRef.current = localChats; }, [localChats]);
  const titleGenInFlightRef = useRef(false);
  useEffect(() => {
    if (isIncognito) return;
    const firstUser = messages.find((message) => message.role === 'user');

    if (
      isLocalFolderConnected
      && firstUser
      && !chatTitle
      && !titleGenInFlightRef.current
    ) {
      titleGenInFlightRef.current = true;
      const userMsg = firstUser.content.trim()
        || firstUser.attachments?.map((attachment) => attachment.name).join(', ')
        || 'Attached file';

      const fetchTitle = async () => {
        let title = '';
        try {
          title = await generateChatTitle(userMsg);
        } catch (err) {
          // Fallback handled below
        }

        // `generateChatTitle` returns '' rather than throwing, so this branch —
        // not the catch above — is what runs when the naming model is slow, out
        // of quota, or has no key. The prompt it was handed names the chat
        // instead, and only a prompt too long to read as a label falls through
        // to FALLBACK_CHAT_TITLE.
        if (!title) {
          title = deriveFallbackTitle(userMsg, FALLBACK_CHAT_TITLE);
        }

        if (title) {
          // A generated title can collide with an EXISTING chat's name (two
          // conversations about the same topic name identically) — and
          // saveLocalFSChat would then silently overwrite that older chat's
          // body in IndexedDB and on disk. Uniquify against every chat id we
          // can see: the in-memory list PLUS the persisted list and timestamp
          // keys (a chat created in another tab, or seconds ago, may not have
          // reached `localChats` state yet).
          const taken = new Set<string>(localChatsRef.current);
          taken.delete(chatSessionId);
          let uniqueTitle = title;
          let suffix = 1;
          while (taken.has(uniqueTitle)) {
            uniqueTitle = `${title} (${suffix})`;
            suffix++;
          }
          setChatTitle(uniqueTitle);
          // Follow the id move immediately, ahead of the storage-layer event.
          // `chatTitle` is already the new id on the very next render, so the
          // autosave key has moved too; a turn still registered under the temp id
          // would be unfindable in that window. The rebind is idempotent, so the
          // event firing later is harmless.
          rebindChatTurnChatId(chatSessionId, uniqueTitle);
          // NOTE: deliberately do NOT setChatSessionId(uniqueTitle) here.
          // The load effect short-circuits on `activeChatId === chatSessionId`;
          // during the async temp→title rename there's a render where
          // activeChatId is still the temp id. If chatSessionId had already
          // flipped to the title, that guard would miss, the effect would load
          // the just-deleted temp body, get nothing, and the empty-load branch
          // would wipe the live thread. saveLocalFSChat's oldChatId handling
          // makes the lingering temp id harmless.
          // Persist from the LIVE messages ref, not this effect's closure.
          // The `await generateChatTitle` above can span a whole extra user
          // turn; saving the stale closure snapshot under the title (while
          // saveLocalFSChat deletes the temp body it renames from) silently
          // dropped that turn from persistence. Strip runtime flags and any
          // still-streaming placeholder (empty content) exactly like the
          // load path does.
          // Read the ref ONCE and mark that exact array as saved. Reading it
          // again after the await would mark a newer array as persisted than the
          // one actually written: naming now overlaps the first response by
          // design, so the reply routinely finalizes mid-save, and crediting the
          // post-finalize array would make the autosave effect dedup away the
          // save that carries the reply.
          const snapshot = messagesRef.current;
          // `messagesRef` is frozen at unmount, and naming outlives unmount (it
          // has no cancellation). If this view is gone, the ref still holds the
          // empty placeholder, which `hasSavedMessageContent` drops — so the save
          // would be the user message alone. Landing after the runner's save,
          // that ERASES the reply. The turn record is the live source in that
          // case, so prefer it whenever one is running for this chat.
          const runningTurn = getChatTurnByChatId(uniqueTitle) ?? getChatTurnByChatId(chatSessionId);
          const source = runningTurn?.status === 'running'
            ? [...runningTurn.historyBefore, runningTurn.userMessage]
            : snapshot;
          const latest = encodeCanvasHistory(source
            .map(serializeChatMessage)
            .filter((message) => hasSavedMessageContent(message)));
          if (latest.length > 0) {
            const saved = await saveLocalFSChat(uniqueTitle, latest, chatSessionId);
            if (saved) {
              // Only credit the array we actually wrote. Crediting the record's
              // reconstruction would make the autosave effect dedup away the
              // save that carries the reply.
              if (!runningTurn) lastSavedMessagesRef.current = snapshot;
            } else {
              // A cross-tab or on-disk collision may have appeared after our
              // optimistic uniqueness check. Keep the temp chat intact and let
              // the effect retry with the now-refreshed chat list.
              setChatTitle(null);
              titleGenInFlightRef.current = false;
            }
          }
        }
      };
      void fetchTitle();
    }
  }, [messages, chatTitle, chatSessionId, isLocalFolderConnected, generateChatTitle, saveLocalFSChat, isIncognito]);

  const [streaming, setStreaming] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  // The model stream and the visual response reveal have separate lifecycles.
  // Keep the composer stop slot mounted until StreamingMarkdown drains the
  // completed turn, without extending the abortable generation state.
  const [revealingResponseId, setRevealingResponseId] = useState<string | null>(null);
  const [errorDialog, setErrorDialog] = useState<{ detail: string } | null>(null);
  const [isErrorDialogClosing, setIsErrorDialogClosing] = useState(false);
  const errorDialogCloseTimerRef = useRef<number | null>(null);
  const sendInFlightRef = useRef(false);
  // The turn this view is currently mirroring, if any. Set both when this view
  // starts a turn and when it re-attaches to one already running in the chat it
  // just opened.
  const [attachedTurnId, setAttachedTurnId] = useState<string | null>(null);
  const attachedTurnIdRef = useRef<string | null>(null);
  useEffect(() => { attachedTurnIdRef.current = attachedTurnId; }, [attachedTurnId]);
  // The exact listener object handed to the store, so detach can compare-and-clear
  // rather than blindly nulling one a later attach may have installed.
  const attachedListenerRef = useRef<ChatTurnListener | null>(null);
  // Aborts the in-flight typed turn when the composer's stop button is pressed.
  const generationAbortRef = useRef<AbortController | null>(null);
  // React 19 may batch rapid SDK stream callbacks with the completion cleanup.
  // Track the deferred clear so a new turn can cancel it before accepting text.
  const streamingClearRafRef = useRef<number | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  // Pre-response activity label. Stays on the shimmer row until the first real
  // text token streams ('responding'), so tool calls (search / code exec) don't
  // prematurely flip the row to "Thought for Ns".
  const [thinkingPhase, setThinkingPhase] = useState<StreamPhase>('thinking');
  const [thinkSeconds, setThinkSeconds] = useState(0);
  // The connected app whose tool the attached turn is running: "Connecting to <app>".
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  // The composer's "@" menu (models, apps) and "/" menu (enabled skills).
  const mentionOptions = useChatMentionOptions({ modelConfig, scopeId: chatScopeId, personalize: !isIncognito });
  const mentionOptionsRef = useRef(mentionOptions);
  useEffect(() => { mentionOptionsRef.current = mentionOptions; }, [mentionOptions]);
  const pickMention = useCallback((option: MentionOption) => {
    if (option.kind === 'model') setSelectedModelId(option.value);
  }, [setSelectedModelId]);

  const openErrorDialog = useCallback((detail: string) => {
    if (errorDialogCloseTimerRef.current !== null) {
      window.clearTimeout(errorDialogCloseTimerRef.current);
      errorDialogCloseTimerRef.current = null;
    }
    setIsErrorDialogClosing(false);
    setErrorDialog({ detail });
  }, []);

  const closeErrorDialog = useCallback(() => {
    if (!errorDialog) return;
    setIsErrorDialogClosing(true);
    if (errorDialogCloseTimerRef.current !== null) window.clearTimeout(errorDialogCloseTimerRef.current);
    errorDialogCloseTimerRef.current = window.setTimeout(() => {
      errorDialogCloseTimerRef.current = null;
      setErrorDialog(null);
      setIsErrorDialogClosing(false);
    }, 125);
  }, [errorDialog]);

  useEffect(() => () => {
    if (errorDialogCloseTimerRef.current !== null) window.clearTimeout(errorDialogCloseTimerRef.current);
  }, []);
  const [reactions, setReactions] = useState<Record<string, 'like' | 'dislike' | null>>({});
  // New replies keep their action row collapsed until StreamingMarkdown has
  // drained its pending suffix and completed the final word fade. Persisted
  // messages are already settled and do not need an entry here.
  const [responseRevealComplete, setResponseRevealComplete] = useState<Record<string, boolean>>({});
  const [listeningId, setListeningId] = useState<string | null>(null);
  // Which turns currently have their code panels shown. Keyed by message id
  // because the toggle is per response, not per block — Gemini's control sits in
  // the response header and reveals every block in that turn at once. Collapsed
  // is the default, matching the live app.
  const [codeShown, setCodeShown] = useState<Record<string, boolean>>({});
  const [openThinkingMessageId, setOpenThinkingMessageId] = useState<string | null>(null);
  const [openSourcesMessageId, setOpenSourcesMessageId] = useState<string | null>(null);
  // ── Panel quiet window ─────────────────────────────────────────────────────
  // Opening or closing the context panel animates the scroller's width for 300ms.
  // That re-wraps every reply, and re-wrapping changes height, so the height-gated
  // observers below would otherwise fire on each of the ~18 frames — each one
  // forcing a synchronous layout of the whole thread, one of them under flushSync.
  // While this timestamp is in the future they coalesce into a single trailing run
  // instead. Derived from the two ids rather than `contextSidebarOpen`, which is
  // declared far below the effects that need this.
  const panelSettleUntilRef = useRef(0);
  const panelIsOpen = openThinkingMessageId !== null || openSourcesMessageId !== null;
  const panelWasOpenRef = useRef(panelIsOpen);
  // Scroll-pin across the panel transition: the scroller's width animates, the
  // text re-wraps and grows, and Chrome's native anchoring is suppressed by that
  // very animation (a padding/width change every frame disables it), so the
  // thread slides down under the viewport. This drives the per-frame corrective
  // scroll in the pin hook below. Ref, not state: it is read and written every
  // rAF while the transition runs and must never force a render.
  const panelTransitionPhaseRef = useRef<'idle' | 'captured' | 'running'>('idle');
  const panelBottomPinnedRef = useRef(false);
  const panelDeferMs = useCallback(
    () => Math.max(0, panelSettleUntilRef.current - performance.now()),
    [],
  );
  useLayoutEffect(() => {
    // Only an open<->closed flip animates the width. Mount doesn't, and neither
    // does swapping thinking-steps for sources while the panel stays open.
    if (panelWasOpenRef.current === panelIsOpen) return;
    panelWasOpenRef.current = panelIsOpen;
    // Small margin past the transition so the settling frame is covered too.
    panelSettleUntilRef.current = performance.now() + PANEL_TRANSITION_MS + 60;
    // Snapshot where the viewport is before the width animation starts. The
    // pin hook owns every frame of the transition; it reads these two refs.
    panelTransitionPhaseRef.current = 'captured';
    const container = chatScrollRef.current;
    if (container) {
      panelBottomPinnedRef.current =
        container.scrollHeight - container.clientHeight - container.scrollTop <= 2;
    }
  }, [panelIsOpen]);

  // The `$chatPanelOpen` publish lives further down, next to `openResource` — it has
  // to account for that panel too, and it is declared below. See `anyRightPanelOpen`.

  /**
   * Hold the reading position still across the panel transition.
   *
   * The reflow itself is wanted: the text should re-wrap live as the column
   * narrows. What is not wanted is the thread sliding, and that happens because
   * re-wrapped text above the viewport is taller than it was. Chrome normally
   * repays exactly this via scroll anchoring — but a computed padding/width
   * change on an ancestor inside the scroller is a suppression trigger, and this
   * transition animates both for 300ms, so anchoring is off for precisely the
   * window in which it was needed. The coalescing above fixed the React half of
   * that; this fixes the part the browser will not do for us.
   *
   * Measure-and-correct per frame rather than computing a total up front: the
   * re-wrap arrives progressively over the animation, the reserve lands after
   * it, and a frame that reads where the anchor IS cannot be stale.
   */
  useLayoutEffect(() => {
    if (panelTransitionPhaseRef.current !== 'captured') return;
    panelTransitionPhaseRef.current = 'running';

    const container = chatScrollRef.current;
    const release = () => { panelTransitionPhaseRef.current = 'idle'; };
    if (!container) { release(); return; }

    // Streaming owns the scroll position — the follow logic below writes it on
    // every token — and two writers on one scroller is the jerk this removes.
    if (isGeneratingRef.current || isLiveRef.current) { release(); return; }

    const bottomPinned = panelBottomPinnedRef.current;
    const anchor = bottomPinned
      ? null
      : findDeepBlockAnchor(container, container.getBoundingClientRect().top + 1);
    if (!bottomPinned && !anchor) { release(); return; }
    const anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;

    // Exactly one writer for the duration. Native anchoring is suppressed on
    // most of these frames but not provably all of them, and a browser
    // adjustment landing on top of ours would overshoot — self-correcting on
    // the next frame, which is visible as jitter rather than as a jump.
    const previousOverflowAnchor = container.style.overflowAnchor;
    container.style.overflowAnchor = 'none';

    let raf: number | null = null;
    let cancelled = false;

    // The pin writes scrollTop, which fires `scroll`, so a scroll listener would
    // see its own work. Listen for the INPUT instead — same reasoning as the
    // turn entrance below.
    const interrupt = () => {
      if (cancelled) return;
      cancelled = true;
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
      finish();
    };
    const finish = () => {
      container.style.overflowAnchor = previousOverflowAnchor;
      container.removeEventListener('wheel', interrupt);
      container.removeEventListener('touchstart', interrupt);
      container.removeEventListener('keydown', interrupt);
      release();
    };
    container.addEventListener('wheel', interrupt, { passive: true });
    container.addEventListener('touchstart', interrupt, { passive: true });
    container.addEventListener('keydown', interrupt);

    const step = () => {
      if (cancelled) return;
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      if (bottomPinned) {
        container.scrollTop = maxScrollTop;
      } else if (anchor) {
        // A regenerate or an edit can unmount the anchor mid-transition; its
        // rect then reads all zeros, which would look like a huge upward move.
        if (!anchor.isConnected) { finish(); return; }
        const delta = anchor.getBoundingClientRect().top - anchorTop;
        // Sub-pixel moves are layout noise, and writing scrollTop for them would
        // round-trip the scroller every frame for nothing.
        if (Math.abs(delta) > 0.5) {
          container.scrollTop = Math.min(maxScrollTop, Math.max(0, container.scrollTop + delta));
        }
      }
      if (performance.now() < panelSettleUntilRef.current + PANEL_PIN_TAIL_MS) {
        raf = requestAnimationFrame(step);
      } else {
        raf = null;
        finish();
      }
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelled = true;
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
      finish();
    };
  }, [panelIsOpen]);
  const [openResource, setOpenResource] = useState<RichResource | null>(null);
  /*
   * The open canvas is in a STORE, not in this component's state, because the
   * canvas runtime (canvas-runtime.ts) opens one the moment a document is created,
   * from inside the turn runner — nowhere near this tree. `collapseCanvasToCard`
   * likewise reaches in from the panel. Reading it back here with `useStore` keeps
   * that single writer while still driving the layout below.
   */
  const openCanvas = useStore($openCanvas);
  const expandedCanvasCards = useStore($expandedCanvasCards);
  /* Every canvas in this chat, folded out of the message log — a document is the
   * sum of every ref naming its id, so this is also the version history. */
  const canvasDocsInChat = useMemo(() => buildCanvasDocs(messages), [messages]);
  const openCanvasDoc = openCanvas ? canvasDocsInChat.get(openCanvas.docId) : undefined;
  /* The Deep Research run in the side panel: the id of the message carrying it. */
  const [openResearchId, setOpenResearchId] = useState<string | null>(null);
  const openResearch = openResearchId ? messages.find((m) => m.id === openResearchId)?.research : undefined;
  const [isFirstTurnEntranceActive, setIsFirstTurnEntranceActive] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const syncEditTextareaHeight = useCallback(() => {
    const textarea = editTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = '24px';
    textarea.style.height = `${Math.min(288, Math.max(24, Math.ceil(textarea.scrollHeight)))}px`;
  }, []);

  useLayoutEffect(() => {
    if (!editingUserId) return;
    syncEditTextareaHeight();
  }, [editDraft, editingUserId, syncEditTextareaHeight]);

  useEffect(() => {
    if (!editingUserId) return;
    window.addEventListener('resize', syncEditTextareaHeight);
    return () => window.removeEventListener('resize', syncEditTextareaHeight);
  }, [editingUserId, syncEditTextareaHeight]);

  const stopListening = useCallback(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setListeningId(null);
  }, []);

  useEffect(() => {
    stopListening();
  }, [activeChatId, stopListening]);

  useEffect(() => {
    setOpenThinkingMessageId(null);
    setOpenSourcesMessageId(null);
    setOpenResource(null);
    /* The canvas store outlives this component, so switching chats has to clear it
     * explicitly or chat B opens showing chat A's document. The expanded-card set is
     * keyed by `messageId:docId` and is therefore already chat-scoped. */
    $openCanvas.set(null);
    canvasRefCountRef.current = null;
  }, [activeChatId]);

  // The three right-hand panels share one slot, so opening any one closes the
  // other two. Gemini's `context-sidebar` is a single host for the same reason.

  /*
   * The chat column's immersive slide.
   *
   * Measured off Gemini with scrapers/canvas/20-recorder.cjs; the raw keyframes are
   * in captures/canvas/recording/gemini-0.jsonl and the writeup in
   * captures/canvas/IMMERSIVE-TRANSITION-SPEC.md. Its `.chat-container` runs:
   *
   *   open:   transform translateX(80%)  -> translateX(0)   500ms cubic-bezier(0.2,0,0,1)
   *   close:  transform translateX(-20%) -> translateX(0)   500ms cubic-bezier(0.2,0,0,1)
   *   both:   opacity   0 -> 1                              200ms linear
   *
   * The asymmetry is Gemini's, not a mistake: the column is never animated OUT, only
   * in, from whichever side the incoming layout arrives from. Cross-checked against
   * the geometry timeline — 80% of the measured 470.7px column is 376.56px, and the
   * first sampled transform was `matrix(1, 0, 0, 1, 376.53, 0)`.
   *
   * Imperative controls, because this must fire on a STATE CHANGE and never on
   * mount — otherwise every chat you open slides in from -20%. A `key` remount would
   * also trigger it and is wrong: the scroll container is inside this element and
   * would lose its scroll position.
   *
   * Skipped below 960px, where the panel is a fullscreen overlay over a single-column
   * grid so there is no sideways move to make. That bound is Willow's own layout
   * breakpoint; Gemini's narrow layout was not measured.
   */
  /*
   * Hide the shell's ConversationActionsMenu while ANY right-hand panel is open.
   *
   * `StudioLayout` gates that menu on `!chatPanelOpen`, so thinking-steps and sources
   * already make the top-right three-dot disappear and come back on close. The
   * resource panel has its own controls in that same corner, so it belongs in the
   * same gate.
   *
   * Deliberately a SEPARATE value rather than folding `openResource` into
   * `panelIsOpen` above. That one also drives the scroll-pin and the observer
   * coalescing, both built for the thinking sidebar's 300ms WIDTH animation — it
   * snapshots scroll position and corrects it per frame while the text re-wraps. The
   * resource panel snaps its grid and moves by transform instead, so nothing re-wraps
   * and arming that machinery would be correcting for a reflow that never happens.
   *
   * It also has to live here rather than beside `panelIsOpen`: `openResource` is
   * declared below those effects, which is the same reason the note up there gives for
   * not using `contextSidebarOpen`.
   */
  const anyRightPanelOpen = panelIsOpen || !!openResource || !!openCanvasDoc || !!openResearch;
  useEffect(() => {
    $chatPanelOpen.set(anyRightPanelOpen);
    return () => { $chatPanelOpen.set(false); };
  }, [anyRightPanelOpen]);

  const immersiveControls = useAnimationControls();
  /*
   * Gated on the panel state ACTUALLY CHANGING, not on a "first run" flag.
   *
   * The flag version shipped a bug: StrictMode double-invokes effects on mount in
   * development, so the first pass cleared the flag and returned and the second pass
   * ran the animation — with `openResource` still null, i.e. the CLOSE keyframes,
   * `translateX(-20%) -> 0`. Opening a new chat therefore slid the composer and the
   * text above it to the right, with no panel anywhere in sight.
   *
   * Comparing against the previous value is immune to that: two invocations with the
   * same state are a no-op however many times they run, and it also stops a chat
   * switch that clears an already-closed panel from animating.
   *
   * The canvas shares the same slot and the same grid, so it shares this: what the
   * effect tracks is whether the RIGHT-HAND COLUMN is occupied, not which component
   * occupies it. Swapping a resource for a canvas while both are open moves nothing
   * and correctly animates nothing.
   */
  const prevImmersiveOpenRef = useRef(false);
  const immersiveOpen = !!openResource || !!openCanvasDoc || !!openResearch;
  /*
   * A canvas opens FULL WIDTH, not beside the chat: Gemini's `full-width-immersive`.
   * Its grid holds the panel alone, and the chat column is laid over it with the
   * thread hidden and the composer replaced by the "Ask Willow" fab. The resource
   * panel keeps the split layout above.
   */
  const canvasFullWidth = !!openCanvasDoc;
  /* The thread narrows to its split-view column only beside the resource panel; behind a
     full-width canvas it is hidden at its own width, so collapsing re-lays out nothing. */
  const splitThread = immersiveOpen && !canvasFullWidth;
  /* Every question and its answer, for the full-screen fab's floating window. */
  const canvasFloatingTurns = useMemo(
    () => (canvasFullWidth ? floatingTurns(messages, streaming, isGenerating) : []),
    [canvasFullWidth, messages, streaming, isGenerating],
  );
  useEffect(() => {
    const wasOpen = prevImmersiveOpenRef.current;
    prevImmersiveOpenRef.current = immersiveOpen;
    if (wasOpen === immersiveOpen) return;
    if (typeof window === 'undefined' || window.innerWidth < 960) return;
    immersiveControls.set({ x: immersiveOpen ? '80%' : '-20%', opacity: 0 });
    void immersiveControls.start({
      x: 0,
      opacity: 1,
      transition: {
        x: { duration: 0.5, ease: [0.2, 0, 0, 1] },
        opacity: { duration: 0.2, ease: 'linear' },
      },
    });
  }, [immersiveOpen, immersiveControls]);

  const handleOpenResource = useCallback((resource: RichResource) => {
    if (!isSidebarCollapsed) onCollapseSidebar?.();
    setOpenThinkingMessageId(null);
    setOpenSourcesMessageId(null);
    $openCanvas.set(null);
    setOpenResource(resource);
  }, [isSidebarCollapsed, onCollapseSidebar]);

  /*
   * Open a document in the full-bleed panel — the `Open` pill and `expand_content`
   * on a card.
   *
   * AT THE CARD'S OWN VERSION when it names one. Every chip in the thread is a
   * snapshot of the turn that wrote it, and pressing Open on an old one used to
   * land on the newest text: "if I scroll through the session and open any of the
   * past version of the code via the open button, then i noticed that it still
   * opens the latest version". The version nav still walks the whole history from
   * wherever it lands, so nothing is unreachable — it just starts where the user
   * pressed. Absent (a call with no version) still means the newest.
   */
  const handleOpenCanvas = useCallback((docId: string, version?: number) => {
    if (!isSidebarCollapsed) onCollapseSidebar?.();
    setOpenThinkingMessageId(null);
    setOpenSourcesMessageId(null);
    setOpenResource(null);
    /*
     * Clear any card for THIS document that a previous `collapse_content` left
     * marked expanded.
     *
     * The bug this fixes, reported as "the preview appears in the sidebar and also
     * within the response": collapsing the panel sets the card expanded and opening
     * the panel again never unset it, so the same document rendered twice — once in
     * the panel, once as a full expanded card mid-reply. The card block also skips
     * the open document entirely (see the thread body), and both are needed: this
     * one stops the stale flag surviving the next close.
     */
    collapseCanvasCardsFor(docId);
    const doc = canvasDocsInChat.get(docId);
    const newest = doc ? doc.versions.length - 1 : 0;
    $openCanvas.set({
      docId,
      version: Number.isFinite(version) ? Math.max(0, Math.min(version, newest)) : newest,
    });
  }, [isSidebarCollapsed, onCollapseSidebar, canvasDocsInChat]);

  const handleOpenThinking = useCallback((messageId: string) => {
    setOpenResource(null);
    $openCanvas.set(null);
    setOpenSourcesMessageId(null);
    setOpenThinkingMessageId(messageId);
  }, []);

  const handleOpenSources = useCallback((messageId: string) => {
    setOpenResource(null);
    $openCanvas.set(null);
    setOpenThinkingMessageId(null);
    setOpenSourcesMessageId(messageId);
  }, []);

  /*
   * Write an edit back into the message log.
   *
   * The document IS its `CanvasRef`s, so editing is a message-log rewrite and
   * needs no store of its own: `applyCanvasEdit` rewrites the newest ref for the
   * document, `setMessages` re-renders the panel and every card off the same fold,
   * and the existing autosave effect (below) persists it — which is the "stored
   * locally in realtime" half of the request, with no new save path.
   *
   * Undefined WHILE GENERATING, which is what makes the panel and cards read-only
   * for the duration: the turn runner owns `messages` then and holds its own
   * `canvasRefs` array for the in-flight turn, so an edit committed mid-turn would
   * be overwritten at settle without warning.
   */
  const handleCanvasEdit = useCallback((docId: string, content: string) => {
    /* A hand edit always lands on the document's CURRENT text, so an edit made while
       scrubbed back to an older revision carries that text forward. The panel has to
       follow it to the end or the user's own keystroke appears to vanish into a
       version they are not looking at — see the effect below. */
    canvasEditedDocRef.current = docId;
    setMessages((prev) => applyCanvasEdit(prev, docId, content));
  }, []);
  const canvasEdit = isGenerating ? undefined : handleCanvasEdit;

  /*
   * A viewer parked on the newest version STAYS on the newest version.
   *
   * Two things insert a version under an open panel: a follow-up turn rewriting
   * the document, and the first hand edit of a revision — which moves the model's
   * text into its own version behind the user's (see `applyCanvasEdit`). Both
   * would otherwise leave `$openCanvas.version` pointing at the entry that used to
   * be last, so the panel would scrub back a version while the user typed.
   *
   * Only when it WAS last. A panel deliberately opened at an old version — which
   * pressing Open on an old chip now does — must stay where it was put.
   */
  const canvasVersionCountsRef = useRef<Record<string, number>>({});
  const canvasEditedDocRef = useRef<string | null>(null);
  useEffect(() => {
    const before = canvasVersionCountsRef.current;
    const after: Record<string, number> = {};
    canvasDocsInChat.forEach((doc, docId) => { after[docId] = doc.versions.length; });
    canvasVersionCountsRef.current = after;
    const edited = canvasEditedDocRef.current;
    canvasEditedDocRef.current = null;
    const open = $openCanvas.get();
    if (!open) return;
    const was = before[open.docId];
    const now = after[open.docId];
    if (!now) return;
    /* An edit the user just made wins over the parked-at-the-end rule: they were
       looking at whatever they typed, and after the commit that text is the newest
       version. Anything else scrubs the panel out from under the caret. */
    if (edited === open.docId) {
      if (open.version !== now - 1) $openCanvas.set({ docId: open.docId, version: now - 1 });
      return;
    }
    if (!was || now <= was || open.version !== was - 1) return;
    $openCanvas.set({ docId: open.docId, version: now - 1 });
  }, [canvasDocsInChat]);

  /*
   * Where each document's ONE card lives: the turn that first wrote it.
   *
   * A revision does not get a card of its own ("every time it makes the code changes,
   * I notice that the document reappears, but it should not"), and the card stays at
   * the first appearance rather than moving to the newest turn — the expanded set is
   * keyed `messageId:docId`, so a card that moved would be a new key and would
   * collapse itself on every edit.
   */
  const canvasCardHomes = useMemo(() => {
    const homes = new Map<string, { messageId: string; refIndex: number }>();
    for (const message of messages) {
      (message.canvasRefs ?? []).forEach((ref, refIndex) => {
        if (!homes.has(ref.docId)) homes.set(ref.docId, { messageId: message.id, refIndex });
      });
    }
    return homes;
  }, [messages]);

  /* Which turns draw a card. Read where paint containment is decided — an expanded
   * card bleeds far past the compensation there, so a turn holding one opts out. */
  const canvasCardMessageIds = useMemo(
    () => new Set([...canvasCardHomes.values()].map((home) => home.messageId)),
    [canvasCardHomes],
  );

  /*
   * A turn that writes a canvas OPENS it — AS AN INLINE CARD.
   *
   * Two halves of one request, and they were misread as one on the first pass. The
   * document must not be left behind a chip the user has to find ("it should open
   * automatically"), and it must not arrive as the right-hand panel either ("when it
   * opens, it should open in the inline response form rather than fixed sidebar
   * right side way"). So the new revision's own card expands in place, inside the
   * reply that wrote it, at the offset the model put it at — and `$openCanvas`, the
   * panel, stays something only a press reaches.
   *
   * Gated on a LIVE turn. The refs are folded out of the whole message log, so
   * loading a saved chat also grows the count from zero; the first pass after a chat
   * switch adopts the count silently (`null` sentinel, reset beside the other panel
   * state above) or every reload would expand a card in an old thread.
   *
   * A LAYOUT effect, and that is the whole of the reported flash: "it still flashes
   * the card before showing the opened view for a bit". A card's first commit is its
   * collapsed chip — expansion is store state, and the store cannot be written
   * during render — so flipping it in a passive effect lets the browser paint the
   * chip once before the expanded card replaces it. `useLayoutEffect` runs in the
   * same commit, before that paint, so the chip is never on screen at all.
   *
   * WITH THE PANEL OPEN it swaps the panel instead, which is the other half of the
   * request: "if the user is viewing the canvas in the right sidebar fixed mode…
   * it should show the new one in place of the old one… and it should open". The
   * document that was in the panel then reappears in the thread as its chip, because
   * only the OPEN document's card is hidden and `handleOpenCanvas` clears the
   * expanded flag of the one it opens.
   *
   * A revision of the document already on screen needs neither: its card is a live
   * view (one card per document) and the panel follows the version in the effect
   * above, so there is nothing to expand or swap.
   */
  const canvasRefCountRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    let count = 0;
    let newest: { messageId: string; docId: string } | null = null;
    for (const message of messages) {
      for (const ref of message.canvasRefs ?? []) {
        count += 1;
        newest = { messageId: message.id, docId: ref.docId };
      }
    }
    const seen = canvasRefCountRef.current;
    canvasRefCountRef.current = count;
    if (seen === null || count <= seen || !newest) return;
    if (!isGenerating) return;
    const open = $openCanvas.get();
    if (open) {
      if (open.docId !== newest.docId) handleOpenCanvas(newest.docId);
      return;
    }
    /* The card lives at the document's FIRST turn, so that is the key to expand —
       expanding the newest turn's would mark a card that no longer renders. */
    const home = canvasCardHomes.get(newest.docId);
    setCanvasCardExpanded(home ? home.messageId : newest.messageId, newest.docId, true);
  }, [messages, isGenerating, canvasCardHomes, handleOpenCanvas]);

  // Auto-save chat history locally in real-time when messages change.
  // Skip saving while generating — partial messages have empty content that
  // would corrupt the stored file. The final save fires once isGenerating
  // flips to false (which triggers a setMessages → re-render → this effect).
  // Also, we use a ref to prevent saving the exact same messages we just loaded,
  // which would bump the "last edited" timestamp to Date.now() simply by clicking on a chat.
  const initialLoadRef = useRef(true);
  const lastSavedMessagesRef = useRef<ChatMsg[]>([]);
  const inFlightSaveRef = useRef<ChatMsg[] | null>(null);

  useEffect(() => {
    if (isIncognito) return;
    
    if (initialLoadRef.current && messages.length > 0) {
       initialLoadRef.current = false;
       lastSavedMessagesRef.current = messages;
       return;
    }

    if (messages === lastSavedMessagesRef.current || messages === inFlightSaveRef.current) {
        return; // Already saved, or a save for this exact array is in flight
    }

    if (isLocalFolderConnected && messages.length > 0 && !isGenerating && !initialLoadRef.current) {
      const activeId = chatTitle || chatSessionId;
      // Strip runtime flags before persisting, then squeeze the canvas history:
      // older revisions are written as reverse patches against the newest text, so
      // a seven-revision document costs one copy plus six diffs instead of seven
      // copies. Encoding LAST is what keeps the chain honest — it runs over exactly
      // the messages being written, after `hasSavedMessageContent` has dropped any.
      const toSave = encodeCanvasHistory(messages.map(serializeChatMessage).filter(hasSavedMessageContent));
      const attempted = messages;
      // Dedup marker, set synchronously so a re-render for an unrelated dep
      // (chatTitle landing, say) cannot stack a second write for the same
      // array while the first is still in flight.
      inFlightSaveRef.current = attempted;
      // `lastSavedMessagesRef` only advances once the write reports success.
      // saveLocalFSChat can decline — it no-ops while the chat storage scope is
      // switching and returns false on a name collision — and advancing
      // regardless meant this effect never retried, silently losing the turn.
      // Every save writes the whole conversation, so the next successful save
      // subsumes anything a failed one missed.
      void (async () => {
        const saved = await saveLocalFSChat(activeId, toSave, chatTitle ? chatSessionId : null);
        if (saved) lastSavedMessagesRef.current = attempted;
        if (inFlightSaveRef.current === attempted) inFlightSaveRef.current = null;
      })();
    }
  }, [messages, chatTitle, chatSessionId, isLocalFolderConnected, saveLocalFSChat, isGenerating, isIncognito]);

  // ── Live voice mode (Gemini Live API) ──────────────────────────────────────
  const [isLive, setIsLive] = useState(false);
  const liveSessionRef = useRef<GeminiLiveSession | null>(null);
  // Model, voice and language the running session was opened with, so a change
  // can be detected without re-running the reconnect on unrelated store writes.
  // The model is part of it because it rides the setup frame too — switching it
  // needs the same teardown-and-reopen a voice change does.
  const liveSettingsSignatureRef = useRef('');
  const isReconnectingRef = useRef(false);
  // Voice-orb state. Always active during live sessions.
  // Connected flips on the socket ACK, which is when the orb reveals itself;
  // before that it shows the pre-connection dot.
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  // Mic mute, owned here rather than read back off the session so the button stays
  // correct across the reconnect a voice/model change does — the new session
  // re-applies it from `setMicMuted` once its stream exists.
  const [isMicMuted, setIsMicMuted] = useState(false);
  // Read by `openLiveSession` to seed a freshly built session. A ref, not the
  // state, so toggling mute does not change that callback's identity — it feeds
  // `restartLiveSession`, so a new identity would reconnect the socket on every
  // mute press.
  const micMutedRef = useRef(false);
  // Propagating the mute lives here rather than in the toggle handler so the state
  // updater stays pure — StrictMode double-invokes updaters, which would call
  // `setMicMuted` twice per press. Reaching a null ref is the ordinary case: mute
  // is allowed to lead a session, and `openLiveSession` seeds the next one.
  useEffect(() => {
    micMutedRef.current = isMicMuted;
    liveSessionRef.current?.setMicMuted(isMicMuted);
  }, [isMicMuted]);
  // Analysers are read off the session once its audio graph exists.
  const [liveAnalysers, setLiveAnalysers] = useState<{
    mic: AnalyserNode | null;
    output: AnalyserNode | null;
  }>({ mic: null, output: null });
  // Keep the clear-effect's refs in sync with live/generation state.
  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);
  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);
  useEffect(() => {
    // Nothing parked = nothing to replay. Without this the guard below reads
    // `null !== null` on a brand-new chat (no reload pending AND no chat
    // selected), falls through, and latches forceExternalReloadRef with no
    // event having occurred. Because the only reset (line ~152) lives inside
    // the `activeChatId` branch of the load effect, that latch survives until
    // the first send flips activeChatId — where it bypasses the identity guard
    // and reloads the user-message-only body over the live streaming thread.
    if (!pendingExternalReloadRef.current) return;
    if (isLive || isGenerating || pendingExternalReloadRef.current !== activeChatId) return;
    pendingExternalReloadRef.current = null;
    forceExternalReloadRef.current = true;
    setExternalReloadVersion((version) => version + 1);
  }, [activeChatId, isGenerating, isLive]);
  // Current in-flight live turn: the user + assistant message ids we're
  // writing into. `acc` mirrors `streaming` so finalize can read it without a
  // stale-closure round-trip.
  const liveTurnRef = useRef<{ userId: string; assistantId: string; acc: string } | null>(null);

  // The composer's picked tool, mirrored up for the creation galleries, and the template picked from one.
  const [composerTool, setComposerTool] = useState<ToolId | null>(null);
  const [mediaTemplate, setMediaTemplate] = useState<MediaTemplate | null>(null);
  const [videoIntroSeen, setVideoIntroSeen] = useState(videoDiscoverySeen);
  // The sidebar's creation page (`/images`, `/videos`) this new chat was opened on.
  const [creationPage, setCreationPage] = useState<ChatCreationPage | null>(null);
  useEffect(() => { setMediaTemplate(null); }, [composerTool]);
  const clearMediaTemplate = useCallback(() => setMediaTemplate(null), []);
  const dismissVideoIntro = useCallback(() => { markVideoDiscoverySeen(); setVideoIntroSeen(true); }, []);

  const hasStarted = messages.length > 0 || isGenerating || isLive;
  /*
   * Boot: empty thread, composer docked, until we know whether a chat restores.
   *
   * The pre-React shell in `index.html` paints a docked composer over an empty
   * surface, because that is the position the composer holds in every loaded
   * conversation — so a refresh that lands back in a chat moves nothing. Without
   * this, React's first commit centred the composer (no messages yet, so
   * `hasStarted` is false), and the handoff jumped it from the bottom to the
   * middle and, if a chat then restored, straight back down.
   *
   * `isChatListHydrated` is the right signal because it is exactly the moment
   * the question is answerable: the registry is on screen and `activeChatId` has
   * settled, so either a load is now in flight (`isChatLoading` takes over
   * below, composer stays put) or there is nothing to restore and the composer
   * may rise to centre. It is the fast flag — one synchronous localStorage read
   * — not `isInitializingLocalFS`, which additionally waits on folder
   * permission and a per-file disk reconcile.
   *
   * `useGreetingReady` is the second half, and it is what keeps the three
   * arrivals in ONE frame: the composer rises, the glow grows, and the heading
   * fades in together, rather than the box centring over blank space while the
   * profile is still in flight. On every browser that supports the File System
   * Access API this term is already satisfied by the time hydration lands —
   * `LocalFSContext`'s restore is itself gated on auth — so it costs nothing
   * there; it earns its place on the browsers where it is not, because
   * `isChatListHydrated` is set immediately when the API is missing.
   *
   * The other three terms are escape hatches, not theory: a send, a background
   * turn finishing, or a live session starting before hydration all mean the
   * thread has real content, and it must not be blanked to wait on a list.
   */
  const isGreetingReady = useGreetingReady(!!isAuthenticated);
  const isBootHydrating =
    (!isChatListHydrated || !isGreetingReady) && messages.length === 0 && !isGenerating && !isLive;
  // The third state: a user-selected chat whose body has not arrived yet. The
  // thread area renders nothing, but the composer must stay exactly where it is.
  //
  // This is why `hasStarted` is NOT forced false to blank the view — it also
  // drives the composer's docked-vs-centred layout, and the docked->zero
  // direction is a deliberate 0-duration snap, so flipping it would teleport the
  // composer to screen centre and slide it back on every chat open.
  const showBlankThread = isChatLoading || isBootHydrating;
  // Images from the sidebar is a page of its own (Gemini's /images): the hero over the centred
  // composer and the templates under it, rather than the tool's gallery.
  const imagesPage = !hasStarted && !showBlankThread && !activeGem && creationPage === 'images' && composerTool === 'images';
  // A creation tool picked on the zero state opens its gallery, the composer docked under it.
  const galleryTool = !hasStarted && !showBlankThread && !activeGem && !imagesPage && isGalleryTool(composerTool) ? composerTool : null;
  // A Gem's zero state is its card in the thread, with the composer already docked.
  const isThreadDocked = hasStarted || showBlankThread || !!activeGem || !!galleryTool;
  /*
   * The disclaimer does NOT ride the boot dock.
   *
   * It is the one thing under the docked composer that the boot shell has no
   * copy of, so including it here would have it appear at the React handoff and
   * then leave again the instant the composer rose to centre — a line of text
   * flashing in the middle of a sequence whose whole point is that nothing
   * moves. `hasStarted || isChatLoading` is the original meaning: show it when
   * there is, or is about to be, a conversation.
   */
  const showComposerDisclaimer = hasStarted || isChatLoading;
  const lastUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id;
  // A live turn marks the user's bubble `isTranscribing` for exactly as long as
  // they are being listened to, which is the orb's listening signal.
  const isUserSpeaking = isLive && messages.some((message) => message.isTranscribing);
  const showVoiceOrb = isLive;

  // Whether the user has added a Gemini Live model to their saved models.
  // Live mode is gated on this — users must explicitly add it from Settings → Models.
  const hasLiveModel = useMemo(() => {
    const geminiModels = modelConfig?.gemini?.savedModels || [];
    const allSaved = [
      ...geminiModels,
      ...(modelConfig?.openai?.savedModels || []),
      ...(modelConfig?.anthropic?.savedModels || []),
      ...(modelConfig?.moonshot?.savedModels || []),
      ...(modelConfig?.spacexai?.savedModels || []),
      ...(modelConfig?.zhipuai?.savedModels || []),
    ];
    return allSaved.some((m: any) => {
      const id = (m.modelId || m.id || '').toLowerCase();
      const name = (m.name || '').toLowerCase();
      return id.includes('live') || id.includes('realtime') || name.includes('live');
    });
  }, [modelConfig]);

  // ...but a temporary chat never offers live voice, however the saved models
  // are configured. Kept separate from `hasLiveModel` on purpose: that one is a
  // statement about what the user has added, and `handleStartLive`'s "add it
  // from Settings → Models" error would be wrong if a temporary chat folded
  // into it.
  //
  // Downstream this is also what keeps the composer's empty-box slot empty:
  // with no live button to occupy it, an empty draft renders no button at all,
  // which is Gemini's own behaviour (see `showSubmitControl` in Composer.tsx).
  // So in a temporary chat that rule holds permanently rather than only until a
  // live model is added.
  const liveAvailable = hasLiveModel && !isIncognito;
  const isResponseRevealing = revealingResponseId !== null
    && messages.some((message) => message.id === revealingResponseId);

  // ── Voice + language for the live session ──────────────────────────────────
  // The panel is the orb's settings, and it draws the orb, so it should not
  // exist while the orb does not.
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);
  const voiceSettings = useStore(voiceSettingsStore);
  // The live model the composer's picker has selected. Everything downstream —
  // the provider lookup, the voice/language options, the socket, the error
  // copy — reads this rather than the registry default, so adding a second live
  // model needs no change here. With one registered model it *is* LIVE_MODEL_ID.
  const liveModelId = useStore(liveModelStore);
  const voiceProvider = useMemo(() => findVoiceProvider(liveModelId), [liveModelId]);
  // Shortened the same way a text turn's snapshot label is, so the two read
  // alike in saved history: "Gemini 3.1 Flash Live" → "3.1 Flash Live".
  const liveModelLabel = useMemo(
    () => {
      const baseId = liveModelId.split('::effort-')[0];
      const found = listVoiceModels().find((m) => m.id === liveModelId || m.id === baseId);
      return getShortModelName(found?.name || liveModelId);
    },
    [liveModelId],
  );
  const voiceSelection = useMemo(
    () => (voiceProvider ? getVoiceSelection(voiceProvider, voiceSettings) : null),
    [voiceProvider, voiceSettings],
  );

  // Close the panel whenever voice mode ends, so it cannot outlive the session
  // that gives it an orb to draw.
  useEffect(() => {
    if (!showVoiceOrb) setIsVoiceSettingsOpen(false);
  }, [showVoiceOrb]);

  useEffect(() => {
    $voiceModeActive.set(showVoiceOrb);
    return () => { $voiceModeActive.set(false); };
  }, [showVoiceOrb]);

  useEffect(() => {
    onChatStartedChange?.(hasStarted);
  }, [hasStarted, onChatStartedChange]);

  /*
   * A chat the shell opened already holding one exchange (`@willow/core/shell-request`):
   * Spark's Skills page "Create with Gemini". It plays as Gemini's does — the prompt, the
   * thinking row, then the reply revealing — but no model runs for it, and the user's
   * answer is the chat's first real turn. The reply is held in a ref rather than the
   * effect's closure so StrictMode's second run re-arms it instead of losing it.
   */
  const [seedRevealId, setSeedRevealId] = useState<string | null>(null);
  const pendingSeedReplyRef = useRef<{ assistantId: string; reply: string } | null>(null);
  useEffect(() => {
    const seed = takeChatSeed();
    if (seed) {
      const assistantId = newId();
      setMessages([
        { id: newId(), role: 'user', content: seed.prompt },
        { id: assistantId, role: 'assistant', content: '', isGenerating: true, isNew: true },
      ]);
      pendingSeedReplyRef.current = { assistantId, reply: seed.reply };
    }
    const pending = pendingSeedReplyRef.current;
    if (!pending) return undefined;
    const timer = window.setTimeout(() => {
      pendingSeedReplyRef.current = null;
      setMessages((prev) => prev.map((message) => (
        message.id === pending.assistantId ? { ...message, content: pending.reply, isGenerating: false } : message
      )));
      setSeedRevealId(pending.assistantId);
    }, SEEDED_REPLY_THINKING_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // ── Scroll-to-top + dynamic response-area sizing (ported from Workbench) ───
  // When you send, your bubble animates to `TARGET_VISUAL_OFFSET` from the top
  // and the assistant block below it is given exactly enough min-height to fill
  // the remaining visible viewport, so you can't scroll into empty space before
  // the reply fills it. The gap below the 👍👎Copy row and the top of the input
  // box matches the Workbench's gap to its suggestions row (both = the 32px gradient).
  const DESKTOP_TARGET_VISUAL_OFFSET = 72; // Gemini's settled first-query top edge
  // Measured off the live Gemini app: `infinite-scroller.chat-history` is a
  // flex column with `row-gap: 52px`, and the same 52px separates a query
  // bubble from its response inside a turn. So every turn boundary is 52 --
  // both user->assistant and assistant->next user. Gemini's action row lives
  // inside `model-response` (36px, opacity 0 on non-last turns) rather than in
  // the gap, which is also how our assistant wrapper is built, so the visible
  // blank from response text to the next bubble comes out at 88px on both.
  const DESKTOP_MESSAGE_GAP = 52;  // Any user/assistant turn boundary
  // At <=960px Gemini's geometry changes, measured at 390 and 800:
  // - A sent turn settles with its bubble at 112: the latest turn's min-height
  //   is the scrollport minus 56, which leaves its top 36px under the header's
  //   68 and the query's own 8px padding on top of that.
  // - A query sits 44px above its response, because the copy/edit row is in
  //   the flow there (4 + 36 + 4) rather than hanging off the bubble.
  // - Turns are 110px apart (the scroller's row-gap) plus that 8px padding,
  //   counted from the bottom of the 48px action row.
  const COMPACT_TARGET_VISUAL_OFFSET = 112;
  const COMPACT_QUERY_GAP = 44;
  const COMPACT_TURN_GAP = 118;
  const TARGET_VISUAL_OFFSET = isCompact ? COMPACT_TARGET_VISUAL_OFFSET : DESKTOP_TARGET_VISUAL_OFFSET;
  const MESSAGE_GAP = isCompact ? COMPACT_QUERY_GAP : DESKTOP_MESSAGE_GAP;
  const TURN_GAP = isCompact ? COMPACT_TURN_GAP : DESKTOP_MESSAGE_GAP;
  // Read by the scroll callbacks and observers, whose closures outlive a render.
  const threadGeometryRef = useRef({ targetOffset: TARGET_VISUAL_OFFSET, messageGap: MESSAGE_GAP });
  threadGeometryRef.current = { targetOffset: TARGET_VISUAL_OFFSET, messageGap: MESSAGE_GAP };
  const THREAD_GAP = 32;           // The incognito banner only
  // The thread column's own `pb-[20px]`, mirrored here the way
  // TARGET_VISUAL_OFFSET mirrors its `pt-[72px]`. The reserve below fills the
  // viewport from the anchored bubble down to the scrollport's bottom edge, but
  // this padding sits *below* that, so leaving it out makes the page exactly
  // this much taller than the anchor needs — which is scrollable slop before
  // the reply has filled anything. Subtracting it is what keeps the thread
  // pinned until the response actually overflows.
  const THREAD_BOTTOM_PADDING = 20;

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Records each message's real rendered height and hands back the style that
  // lets Chrome skip layout for the ones scrolled out of view. See the module
  // for why the height is remembered rather than estimated.
  const { measureRef: measureMessageRef, skipStyle: messageSkipStyle } = useOffscreenMessageSkip();
  const userBubbleCollapsePinnedToBottomRef = useRef(false);
  // Inner content of the last assistant block — measured for the overflow
  // check so it's independent of the outer minHeight/paddingBottom we apply.
  const lastAssistantContentRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledUserId = useRef<string | null>(null);
  const isFirstScrollRef = useRef(false);
  // ── Chunked thread reveal ──────────────────────────────────────────────────
  // A freshly-opened chat paints its newest messages first, then walks backwards
  // over the rest a chunk per frame. Every message costs a remark parse, a
  // highlight.js pass and a per-word span tree, and the list is not virtualized,
  // so a long thread used to land as one synchronous commit.
  //
  // The first chunk must stay >= 8: the open-scroll reposition below anchors on
  // the last USER message, and the rest of that turn has to be mounted with it
  // or `scrollHeight` is short and the chat opens scrolled to the TOP of the
  // thread. (It used to hard-jump to `messages[length - 1 - 4]` and glide down
  // from there, which is where the 4 in that bound came from.)
  const REVEAL_INITIAL_COUNT = 12;
  const REVEAL_CHUNK_SIZE = 10;
  const [revealCount, setRevealCount] = useState(Number.MAX_SAFE_INTEGER);
  const revealRafRef = useRef<number | null>(null);
  const skipNextNativeScrollRef = useRef(false);
  const turnEntranceRafRef = useRef<number | null>(null);
  const turnEntranceCleanupRef = useRef<(() => void) | null>(null);

  const stopTurnEntrance = useCallback(() => {
    if (turnEntranceRafRef.current !== null) {
      cancelAnimationFrame(turnEntranceRafRef.current);
      turnEntranceRafRef.current = null;
    }
    turnEntranceCleanupRef.current?.();
    turnEntranceCleanupRef.current = null;
  }, []);

  /**
   * Glide the new turn up through the blank space the previous reply left behind.
   *
   * The reserve that keeps the thread scrollable only ever sits under the LAST
   * assistant message, so sending hands it to the new placeholder and the old
   * reply snaps back to its true height in the same commit. After a long reply
   * that costs nothing — it had outgrown the reserve and was really that tall,
   * so the new bubble still lands far below the fold and native smooth scrolling
   * has a viewport of runway. After a SHORT one almost all of that height was
   * the reserve, so it evaporates, and the bubble is inserted ~200px down with
   * nowhere left to travel. Native smooth scrolling is distance-aware, so it
   * finishes in a snap. That is the "no animation" case, and the animation was
   * never the thing that differed.
   *
   * So we animate the distance the geometry no longer provides: the turn keeps
   * its real position and is only DRAWN low, by however much blank space is
   * showing beneath it, then eased home. Nothing is propped open and no layout
   * is held, which is what makes a mid-flight scroll survivable — the offset is
   * pure paint, so surrendering it costs one short settle and never a reflow.
   *
   * Transform and scroll ride ONE timeline rather than running back to back:
   * split into "glide, then scroll" the bubble decelerates into the handover and
   * re-accelerates out of it, which reads as a hitch precisely when both stages
   * are long. Weighting them by distance keeps on-screen velocity continuous, so
   * the turn covers the empty space and the thread's own travel as one ramp.
   */
  const runTurnEntrance = useCallback((
    container: HTMLDivElement,
    elements: HTMLElement[],
    anchorEl: HTMLElement,
    offset: number,
  ) => {
    stopTurnEntrance();
    const startScrollTop = container.scrollTop;
    // Re-derive the destination from LIVE geometry instead of trusting a value
    // captured at send time.
    //
    // A scroll animation advances on wall-clock, so a long frame — a heavy
    // Recents list re-rendering is the one that does it here — can take progress
    // from a fraction straight past 1. The frame that lands after the stall then
    // applies the animation's END state in one step. If that end state is a
    // scrollTop computed before the reply existed, it is stale by exactly the
    // layout the reply added, and applying it drags the thread visibly DOWN.
    // Measured at 144px = TARGET_VISUAL_OFFSET + MESSAGE_GAP + THREAD_BOTTOM_PADDING,
    // the constant in the reserve this target is derived from, on every occurrence.
    //
    // Recomputing per frame means a dropped frame costs smoothness, never
    // correctness: however late the frame arrives, it targets where the anchor
    // is NOW. Clamping to the live max matters for the same reason — the reserve
    // is still settling while the first tokens arrive.
    const liveTarget = () => Math.max(0, Math.min(
      anchorEl.offsetTop - threadGeometryRef.current.targetOffset,
      container.scrollHeight - container.clientHeight,
    ));
    const total = offset + Math.max(0, liveTarget() - startScrollTop);
    // Distance-matched to the browser's own smooth-scroll pacing, so a turn that
    // needs no glide still feels like the scroll it replaces.
    const duration = Math.min(520, Math.max(240, 240 + total * 0.28));

    for (const el of elements) el.style.transform = `translateY(${offset}px)`;

    let currentOffset = offset;
    let cancelled = false;
    // The animation writes scrollTop, which fires `scroll` — so we listen for
    // the INPUT instead. A wheel tick or a drag means the user has taken over.
    const interrupt = () => {
      if (cancelled) return;
      cancelled = true;
      if (turnEntranceRafRef.current !== null) {
        cancelAnimationFrame(turnEntranceRafRef.current);
        turnEntranceRafRef.current = null;
      }
      // Dropping the offset outright would teleport the turn up by whatever is
      // left of it. Hand it back over a short settle instead, so an interrupt
      // during a big glide resolves rather than cuts.
      const handoverFrom = currentOffset;
      const handoverStart = performance.now();
      const HANDOVER_MS = 120;
      const settle = (now: number) => {
        const t = Math.min(1, (now - handoverStart) / HANDOVER_MS);
        const value = handoverFrom * (1 - sampleEmphasisedEase(t));
        for (const el of elements) {
          el.style.transform = t >= 1 ? '' : `translateY(${value}px)`;
        }
        turnEntranceRafRef.current = t >= 1 ? null : requestAnimationFrame(settle);
      };
      turnEntranceRafRef.current = requestAnimationFrame(settle);
      detach();
    };
    const detach = () => {
      container.removeEventListener('wheel', interrupt);
      container.removeEventListener('touchstart', interrupt);
      container.removeEventListener('keydown', interrupt);
    };
    container.addEventListener('wheel', interrupt, { passive: true });
    container.addEventListener('touchstart', interrupt, { passive: true });
    container.addEventListener('keydown', interrupt);

    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = sampleEmphasisedEase(progress);
      const travelled = total * eased;
      // Spend the offset first, then the scroll: the bubble crosses the empty
      // space and only pushes the thread once it has caught up to it.
      currentOffset = Math.max(0, offset - travelled);
      for (const el of elements) {
        el.style.transform = progress >= 1 || currentOffset === 0
          ? ''
          : `translateY(${currentOffset}px)`;
      }
      // Fraction of the SCROLL leg completed, applied to the target as it stands
      // this frame. `startScrollTop` is a floor, never a destination: the reserve
      // shrinks as the reply fills it, so re-reading the target is what keeps a
      // late frame from rewinding the thread.
      const scrollLeg = Math.max(0, total - offset);
      const scrollEased = scrollLeg === 0 ? 1 : Math.min(1, Math.max(0, travelled - offset) / scrollLeg);
      const destination = liveTarget();
      const next = destination <= startScrollTop
        ? startScrollTop
        : startScrollTop + (destination - startScrollTop) * scrollEased;
      // Never rewind. This entrance only travels DOWN the document, so a frame
      // that computes a SMALLER scrollTop than the one already on screen is wrong
      // by definition — and that write is the teleport. The old line pinned
      // scrollTop to `startScrollTop` for the whole glide phase, so any scroll
      // layout had already applied (content inserted above the viewport, the
      // reserve collapsing as the reply lands) was forced back on the next frame.
      // A long frame makes it visible rather than causing it: the stall gives
      // layout room to move first, then one write undoes it in a single step.
      if (next > container.scrollTop) container.scrollTop = next;
      if (progress < 1) {
        turnEntranceRafRef.current = requestAnimationFrame(step);
      } else {
        turnEntranceRafRef.current = null;
        detach();
      }
    };
    turnEntranceCleanupRef.current = () => {
      cancelled = true;
      detach();
      for (const el of elements) el.style.transform = '';
    };
    turnEntranceRafRef.current = requestAnimationFrame(step);
  }, [stopTurnEntrance]);

  const [responseAreaMinHeight, setResponseAreaMinHeight] = useState<number | undefined>(undefined);
  const [needsScrollPadding, setNeedsScrollPadding] = useState(false);

  /**
   * Main content rect for the voice focus surface, measured from the scroll
   * container.
   *
   * Null until the first measurement, and the surface is not rendered until it is.
   * It used to initialise to a viewport-sized guess, which meant the orb mounted
   * against the guess and then framer-motion *animated* `top`/`left` to the
   * correction — the orb visibly slid in from the north-east (right by half the
   * container's left inset, up by half the header/composer difference). Rendering
   * nothing until there is a real measurement removes the wrong position rather
   * than hiding it.
   *
   * The value deliberately survives the orb closing: `AnimatePresence` replays the
   * last rendered surface on the way out, so clearing it here would be clearing a
   * rect the exit is still using. A reopen therefore renders once against the
   * previous session's rect before the layout effect below corrects it, which is
   * the second half of the same slide — `VoiceFocusSurface` suppresses the
   * transition for that first frame.
   */
  const [mainContentRect, setMainContentRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  // useLayoutEffect, not useEffect: this runs before the browser paints, so the
  // first frame the orb appears in already has the measured rect. With useEffect
  // the surface could paint once against a stale rect from a previous session.
  useLayoutEffect(() => {
    if (!showVoiceOrb) return;
    const measure = () => {
      const container = chatScrollRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // This is the same element `voice-focus-surface.css` lifts by -56px in the
      // expanded state, and getBoundingClientRect reports the post-transform box —
      // so the lift has to come back out or the orb is placed against a rect that
      // is 56px high. Normally the lift transitions from 0 and this reads ~0, but
      // an empty chat mounts the whole active tree *with* the expanded attribute
      // already set: nothing transitions, and the very first measurement is fully
      // lifted. Subtracting the live translation gives the layout box in both
      // cases, and mid-transition too.
      const { m41: translateX, m42: translateY } = new DOMMatrix(
        getComputedStyle(container).transform,
      );
      setMainContentRect({
        top: rect.top - translateY,
        left: rect.left - translateX,
        width: rect.width,
        height: rect.height,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    // The scroller can settle after this effect runs — the composer's shared-layout
    // move on the empty-state → active swap is the case that matters — and a stale
    // rect would strand the orb wherever the first frame put it.
    const observer = new ResizeObserver(measure);
    if (chatScrollRef.current) observer.observe(chatScrollRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [showVoiceOrb]);

  // Transcript fade. Upstream hides the conversation behind the expanded orb and
  // reveals it once the orb collapses, which is the behaviour these attributes
  // drive: `voice-focus-surface.css` keys the opacity, the lift and the scroll
  // lock off them. The surface attribute only exists while the orb does — the
  // shipped resolver returns undefined when the surface is hidden, so a chat
  // with the experiment off carries no attributes and no transition at all.
  const isVoiceFocusExpanded = useStore(focusModeAtom);
  const voiceFocusSurfaceAttributes = showVoiceOrb
    ? resolveFocusSurfaceAttributes(isVoiceFocusExpanded)
    : undefined;

  const handleUserBubbleToggleStart = useCallback((willExpand: boolean) => {
    const container = chatScrollRef.current;
    if (!container || willExpand) {
      userBubbleCollapsePinnedToBottomRef.current = false;
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.clientHeight - container.scrollTop;
    userBubbleCollapsePinnedToBottomRef.current = distanceFromBottom <= 2;
  }, []);

  const handleUserBubbleToggleEnd = useCallback(() => {
    const container = chatScrollRef.current;
    if (container && userBubbleCollapsePinnedToBottomRef.current) {
      container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    }
    userBubbleCollapsePinnedToBottomRef.current = false;
  }, []);

  // Walk the reveal window backwards over the remaining history, one chunk per
  // frame, compensating scroll as we go.
  //
  // Mounting older messages ABOVE the viewport grows scrollHeight at the top, so
  // without the compensation every chunk shoves the conversation down. This is
  // the same class of jerk the ResizeObservers below fight, and it needs the same
  // cure: measure, commit synchronously via flushSync, then correct scrollTop
  // inside the one frame. A batched setState would paint the taller content
  // before the correction landed.
  useEffect(() => {
    if (revealCount >= messages.length) return;
    // Never compete with a live stream for frames.
    if (isGenerating || isLive) {
      setRevealCount(messages.length);
      return;
    }
    revealRafRef.current = requestAnimationFrame(() => {
      revealRafRef.current = null;
      const container = chatScrollRef.current;
      if (!container) {
        setRevealCount((count) => count + REVEAL_CHUNK_SIZE);
        return;
      }
      const before = container.scrollHeight;
      flushSync(() => setRevealCount((count) => count + REVEAL_CHUNK_SIZE));
      container.scrollTop += container.scrollHeight - before;
    });
    return () => {
      if (revealRafRef.current !== null) {
        cancelAnimationFrame(revealRafRef.current);
        revealRafRef.current = null;
      }
    };
  }, [revealCount, messages.length, isGenerating, isLive]);

  // `messages` shrinks on regenerate and on editing an earlier turn, so the
  // window is clamped at read time rather than trusted.
  const revealOffset = Math.max(0, messages.length - Math.min(revealCount, messages.length));
  const visibleMessages = revealOffset > 0 ? messages.slice(revealOffset) : messages;

  // Mirror messages in a ref so resize-driven recomputes can read the latest
  // list without re-running (and racing) on every setMessages.
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useLayoutEffect(() => {
    const c = chatScrollRef.current;
    if (!c) return;
    const sync = () => {
      setResponseAreaMinHeight((prev) => {
        if (prev === undefined) return prev;
        const msgs = messagesRef.current;
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
        const msgEl = lastUser ? messageRefs.current[lastUser.id] : null;
        if (!msgEl) return prev;
        const { targetOffset, messageGap } = threadGeometryRef.current;
        return Math.max(
          0,
          c.clientHeight
            - targetOffset
            - msgEl.offsetHeight
            - (editingUserId === lastUser?.id ? 0 : messageGap)
            - THREAD_BOTTOM_PADDING
        );
      });
    };
    sync();
    // The composer is a SIBLING of this scroller, not a child, so every time it
    // grows or shrinks — a line wraps, backspace unwraps one, the fullscreen
    // toggle fires — this container's clientHeight changes by the same amount
    // and the reserve has to move with it. The two cancel exactly: the viewport
    // gains N px at the bottom, the spacer under the last response gains N px,
    // scrollHeight and maxScrollTop both hold, nothing appears to move.
    //
    // They only cancel IF THEY LAND IN THE SAME FRAME. A bare setState from a
    // ResizeObserver is batched and can paint after the resize, so for one frame
    // the viewport is taller and the spacer is not: scrollHeight dips, the
    // browser clamps scrollTop, and the whole thread above the composer jerks
    // and settles back. Same failure the user-bubble collapse hits below, same
    // cure — see the flushSync at the end of handleUserBubbleToggle.
    //
    // Height only: the panel toggle animates this scroller's WIDTH, and a
    // flushSync per frame of that is what made opening the panel feel laggy.
    // Re-wrapped text still changes height, so the panel window also coalesces
    // this into one run once the width stops moving.
    const ro = observeHeight(() => flushSync(sync), panelDeferMs);
    ro.observe(c);
    return () => ro.disconnect();
  }, [hasStarted, editingUserId, isCompact]);

  // ── Refs ───────────────────────────────────────────────────────────────────
  // The elapsed-seconds ticker itself lives on the turn record, driven by the
  // runner, so it survives this component and cannot be shared by two turns.
  // These mirror the DISPLAYED turn's thinking state for the render path.
  const isThinkingRef = useRef(false);
  const thinkSecondsRef = useRef(0);

  useEffect(() => { isThinkingRef.current = isThinking; }, [isThinking]);
  useEffect(() => { thinkSecondsRef.current = thinkSeconds; }, [thinkSeconds]);

  useEffect(() => () => {
    if (streamingClearRafRef.current !== null) {
      cancelAnimationFrame(streamingClearRafRef.current);
    }
    stopTurnEntrance();
  }, [stopTurnEntrance]);

  // ── Scroll-to-top animation on each new user turn ──────────────────────────
  // Gemini reserves the response area first, then lets the browser smoothly
  // scroll the new turn to its anchor. Native smooth scrolling preserves the
  // browser's distance-aware timing instead of stacking another easing curve
  // on top of the sent-message entrance.
  useLayoutEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;

    const userMsgs = messages.filter((m) => m.role === 'user');
    const lastUser = userMsgs[userMsgs.length - 1];
    if (!lastUser || lastUser.id === lastScrolledUserId.current) return;
    lastScrolledUserId.current = lastUser.id;
    // A send landing mid-glide retargets everything; drop the previous turn's
    // offset now so it can't outlive the geometry it was measured against.
    stopTurnEntrance();

    requestAnimationFrame(() => {
      const msgEl = messageRefs.current[lastUser.id];
      if (!msgEl || !chatScrollRef.current) return;
      const c = chatScrollRef.current;

      // Reserve response-area height on the new placeholder BEFORE scrolling so
      // there's enough scrollHeight to reach the target.
      const preMinH =
        c.clientHeight - threadGeometryRef.current.targetOffset - msgEl.offsetHeight
          - threadGeometryRef.current.messageGap - THREAD_BOTTOM_PADDING;
      flushSync(() => {
        setResponseAreaMinHeight(Math.max(0, preMinH));
        setNeedsScrollPadding(false);
      });

      // `isFirstScrollRef` means "this run is a chat OPENING, not a turn
      // arriving" — it is armed only by a real chat load (see the load effect).
      const isChatOpen = isFirstScrollRef.current;
      isFirstScrollRef.current = false;

       // The first query already has one movement authority: the 500ms thread
       // entrance below. Starting native smooth scrolling while that transform
       // is shrinking the scrollable overflow makes scrollTop rise and then
       // ease back to zero, which is the visible first-send jerk. Later turns
       // do not remount the thread, so they continue to use native scrolling.
       //
       // Checked BEFORE the open case below on purpose: re-entering a chat whose
       // turn is still running arms both flags, and that path has always landed
       // at scrollTop 0 rather than on the anchor.
       if (skipNextNativeScrollRef.current) {
         skipNextNativeScrollRef.current = false;
         c.scrollTop = 0;
         return;
       }

       // Opening a chat is not a turn entering the thread, so there is nothing
       // to animate: the content is already there and the user asked for it by
       // name. Land on the anchor in this same frame.
       //
       // This is the exact position both animated paths below settle on
       // (`liveTarget()` in runTurnEntrance, and `scrollIntoView({block:'start'})`
       // against the `scrollMarginTop: TARGET_VISUAL_OFFSET` on each message), so
       // the chat now opens where the animation used to finish. It replaces a
       // hard jump to `messages[length - 1 - 4]` that existed only to give the
       // glide somewhere to travel FROM.
       //
       // A send never reaches here: `isFirstScrollRef` is armed only by the load
       // effect, and cleared above on the very run it was armed for.
       if (isChatOpen) {
         c.scrollTop = Math.max(0, Math.min(
           msgEl.offsetTop - threadGeometryRef.current.targetOffset,
           c.scrollHeight - c.clientHeight,
         ));
         return;
       }

       const startTop = c.scrollTop;
       // Blank viewport below the incoming bubble. A long previous reply is
       // genuinely tall enough to push it past the bottom edge (offset <= 0),
       // leaving nothing to glide through — that turn keeps native smooth
       // scrolling, which already covers the full distance and is what the
       // comment above is about. Only a turn that would otherwise barely move
       // gets the glide, and it gets exactly the distance it was short by.
       const entranceOffset = Math.round(c.clientHeight - (msgEl.offsetTop - startTop));

       if (entranceOffset <= 0) {
         msgEl.scrollIntoView({
           behavior: 'smooth',
           block: 'start',
           inline: 'nearest',
         });
         return;
       }

       // The placeholder trails the bubble, so it has to carry the same offset —
       // left behind, the bubble would slide down across it.
       const enteringIndex = messages.findIndex((m) => m.id === lastUser.id);
       const entering = messages
         .slice(enteringIndex)
         .map((m) => messageRefs.current[m.id])
         .filter((el): el is HTMLDivElement => el !== null);

       runTurnEntrance(c, entering, msgEl, entranceOffset);
     });
  }, [messages, runTurnEntrance, stopTurnEntrance]);

  // ── Recalculate reserved height when the viewport OR footer height changes.
  //    Intentionally NOT keyed on `messages` — the scroll-to-top RAF is the
  //    single authority for per-turn recompute; this effect only corrects for
  //    real size changes (window resize, InputBar grow/shrink between turns).
  useEffect(() => {
    const c = chatScrollRef.current;
    if (!c) return;
    const recompute = () => {
      const updateReservedHeight = () => setResponseAreaMinHeight((prev) => {
        if (prev === undefined) return prev;
        const msgs = messagesRef.current;
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
        const msgEl = lastUser ? messageRefs.current[lastUser.id] : null;
        if (!msgEl) return prev;
        const { targetOffset, messageGap } = threadGeometryRef.current;
        return Math.max(
          0,
          c.clientHeight
            - targetOffset
            - msgEl.offsetHeight
            - (editingUserId === lastUser?.id ? 0 : messageGap)
            - THREAD_BOTTOM_PADDING
        );
      });

      if (userBubbleCollapsePinnedToBottomRef.current) {
        // During the user-bubble max-height transition, update the inverse
        // assistant reserve in the same frame. Otherwise scrollHeight dips for
        // one paint, the browser clamps scrollTop, and the thread bounces down
        // before returning upward on the next ResizeObserver tick.
        flushSync(updateReservedHeight);
        c.scrollTop = Math.max(0, c.scrollHeight - c.clientHeight);
      } else {
        updateReservedHeight();
      }
    };
    recompute();
    // Height only: `updateReservedHeight` reads clientHeight and offsetHeight and
    // nothing else, so a width-driven run can only ever recompute the same number.
    // Coalesced during the panel window for the same reason as the sync above.
    const ro = observeHeight(recompute, panelDeferMs);
    ro.observe(c);
    const lastUserEl = lastUserMessageId ? messageRefs.current[lastUserMessageId] : null;
    if (lastUserEl) ro.observe(lastUserEl);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStarted, lastUserMessageId, editingUserId, isCompact]);

  // ── Keep needsScrollPadding in sync with whether the reply CONTENT fits
  //    above the footer. Bidirectional: flips true when content outgrows the
  //    reserve (long reply, or footer grew), and flips back false when it fits
  //    again (footer shrank / tool chip removed). Measures the inner content
  //    wrapper so the comparison is independent of the minHeight/paddingBottom
  //    we conditionally apply to the outer block — avoids feedback loops.
  useEffect(() => {
    if (responseAreaMinHeight === undefined) return;
    const el = lastAssistantContentRef.current;
    if (!el) return;
    const check = () => {
      const contentH = el.offsetHeight;
      const fits = contentH <= responseAreaMinHeight + 5;
      setNeedsScrollPadding((prev) => (prev === !fits ? prev : !fits));
    };
    // Height only: `check` compares offsetHeight against the reserve. Reading
    // offsetHeight forces a layout flush, so a per-frame width run is not free
    // even though the state update itself bails out. The re-wrap during the panel
    // transition does change height, so that window is coalesced too — and this is
    // the worst offender to leave un-coalesced, because flipping
    // needsScrollPadding changes the height that fed the measurement.
    const ro = observeHeight(check, panelDeferMs);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [messages, responseAreaMinHeight, streaming]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const stopThinking = useCallback(() => {
    isThinkingRef.current = false;
    setIsThinking(false);
  }, []);

  const resolveModel = useCallback(
    () => resolveChatModel({ modelConfig, selectedModelId, apiKeys }),
    [modelConfig, selectedModelId, apiKeys],
  );

  const newId = () => crypto.randomUUID?.() || Math.random().toString(36).slice(2);

  const finalizeAssistant = (
    id: string,
    content: string,
    thinkingTime?: number,
    isError = false,
    wasStopped = false,
    citations?: MessageCitations,
    errorDetail?: string,
    media?: GeneratedMedia[],
    research?: ResearchRecord,
    codeExecutions?: CodeExecution[],
    /*
     * Passed explicitly rather than left to the mid-stream mirror below.
     *
     * Every field here is assigned unconditionally, so omitting one does NOT
     * preserve it — `{ ...m, canvasRefs: undefined }` is what an omitted
     * parameter means. That is correct on the error path (the runner clears its
     * own refs there) and it is why the successful path has to hand them back.
     * The same holds for `media` and `research` above.
     */
    canvasRefs?: CanvasRef[],
  ) => {
    // `created` is not in this list, so the cards the mid-stream mirror below put on the
    // message survive settling — on an error too: what a turn saved stays saved.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, content, thinkingTime, isError, isGenerating: false, wasStopped, citations, errorDetail, media, research, codeExecutions, canvasRefs }
          : m
      )
    );
  };

  /**
   * Mirror one turn into this view's state.
   *
   * Only an attached listener touches React — an unwatched turn just grows its
   * accumulators. That is what keeps two concurrent turns from fighting over
   * `streaming`, which is a single component-wide value: at most one record can
   * be attached, and it is always the displayed chat's.
   */
  const buildTurnListener = useCallback((turnId: string): ChatTurnListener => ({
    onText: (content) => {
      if (attachedTurnIdRef.current !== turnId) return;
      if (isThinkingRef.current) {
        const record = getChatTurn(turnId);
        if (record) {
          thinkSecondsRef.current = record.thinkSeconds;
          setThinkSeconds(record.thinkSeconds);
        }
        stopThinking();
      }
      // Provider callbacks can drain an already-buffered SSE response in a tight
      // microtask chain. Force each accumulated value into React before the
      // final message/cleanup updates can absorb it.
      flushSync(() => setStreaming(content));
    },
    onThinking: (record) => {
      if (attachedTurnIdRef.current !== turnId) return;
      setMessages((prev) => prev.map((message) =>
        message.id === record.assistantId
          ? { ...message, thinkingText: record.thinkingText }
          : message
      ));
    },
    onPhase: (record) => {
      if (attachedTurnIdRef.current !== turnId) return;
      // Keep the shimmer row live with the right label until real text streams.
      // 'responding' is handled by the onText branch above.
      if (record.phase !== 'responding') setThinkingPhase(record.phase);
      setConnectingApp(record.connectingApp ?? null);
      if (record.isThinking) {
        thinkSecondsRef.current = record.thinkSeconds;
        setThinkSeconds(record.thinkSeconds);
      }
      // Code panels land mid-stream, so they reach the message here rather than
      // waiting for `finalizeAssistant` the way citations do — Gemini shows the
      // toggle as soon as the first block arrives. The runner republishes a fresh
      // array on every change, so identity is a sound change test, and returning
      // `prev` unchanged lets React bail out of the once-a-second phase ticks.
      const executions = record.codeExecutions;
      if (executions) {
        setMessages((prev) => (
          prev.some((m) => m.id === record.assistantId && m.codeExecutions !== executions)
            ? prev.map((m) => (m.id === record.assistantId ? { ...m, codeExecutions: executions } : m))
            : prev
        ));
      }
      // A generated image's placeholder shows the moment its tool call starts.
      const media = record.media;
      if (media) {
        setMessages((prev) => (
          prev.some((m) => m.id === record.assistantId && m.media !== media)
            ? prev.map((m) => (m.id === record.assistantId ? { ...m, media } : m))
            : prev
        ));
      }
      // So does a research plan's card.
      const research = record.research;
      if (research) {
        setMessages((prev) => (
          prev.some((m) => m.id === record.assistantId && m.research !== research)
            ? prev.map((m) => (m.id === record.assistantId ? { ...m, research } : m))
            : prev
        ));
      }
      // And a saved scheduled action's or skill's.
      const created = record.created;
      if (created) {
        setMessages((prev) => (
          prev.some((m) => m.id === record.assistantId && m.created !== created)
            ? prev.map((m) => (m.id === record.assistantId ? { ...m, created } : m))
            : prev
        ));
      }
      /*
       * Canvas revisions ride the same channel, for the same reason: the runner
       * publishes a ref the instant the tool call executes, mid-stream, and the
       * card is supposed to appear then — a turn that wrote a document and shows
       * nothing until it settles reads as a turn that failed.
       *
       * `publish` replaces the array rather than mutating it, so identity is a
       * sound change test and the once-a-second phase ticks bail out.
       */
      const refs = record.canvasRefs;
      if (refs) {
        setMessages((prev) => (
          prev.some((m) => m.id === record.assistantId && m.canvasRefs !== refs)
            ? prev.map((m) => (m.id === record.assistantId ? { ...m, canvasRefs: refs } : m))
            : prev
        ));
      }
    },
    onSettled: (record) => {
      if (attachedTurnIdRef.current !== turnId) return;
      if (record.isError) {
        const detail = record.errorDetail || 'No additional error details were provided by the service.';
        showCopyToast('Something went wrong', {
          label: 'Show error',
          onClick: () => openErrorDialog(detail),
        });
      }
      // Give the browser one generating-state paint after the final delta. If
      // finalisation happens in the same task, React can otherwise replace the
      // streaming buffer with the completed message before it was ever shown.
      void waitForBrowserPaint().then(() => {
        if (attachedTurnIdRef.current !== turnId) return;
        finalizeAssistant(
          record.assistantId,
          record.finalContent,
          record.isError ? undefined : record.thinkSeconds,
          record.isError,
          record.wasStopped,
          record.citations,
          record.errorDetail,
          record.media,
          record.research,
          record.codeExecutions,
          record.canvasRefs,
        );
        setRevealingResponseId(record.finalContent ? record.assistantId : null);
        setAttachedTurnId(null);
        attachedTurnIdRef.current = null;
        attachedListenerRef.current = null;
        // Compare-and-clear throughout: a turn settling in ANOTHER chat must not
        // null the controller behind the displayed chat's stop button, nor clear
        // its streaming buffer mid-response.
        if (generationAbortRef.current === record.abort) generationAbortRef.current = null;
        sendInFlightRef.current = false;
        stopThinking();
        setConnectingApp(null);
        // Keep the final streaming value alive through the completion commit.
        // The completed message now owns the same text, so clearing next frame
        // is visually lossless and cannot erase the last delta before paint.
        if (streamingClearRafRef.current !== null) cancelAnimationFrame(streamingClearRafRef.current);
        streamingClearRafRef.current = requestAnimationFrame(() => {
          streamingClearRafRef.current = null;
          setStreaming('');
        });
        setIsGenerating(false);
      });
    },
  }), [openErrorDialog, stopThinking]);

  // ── Send ───────────────────────────────────────────────────────────────────
  const buildAiHistory = useCallback(
    (sourceMessages: ChatMsg[]) => buildChatAiHistory({
      sourceMessages,
      attachmentBlobs: attachmentBlobsRef.current,
      loadAttachment: loadLocalFSChatAttachment,
    }),
    [loadLocalFSChatAttachment],
  );

  const handleSend = useCallback(
    async (
      text: string,
      historyOverride?: ChatMsg[],
      attachmentSources: Array<ComposerAttachment | ChatAttachment> = [],
      tool?: ToolId | null,
      toolOptions?: MediaToolOptions,
    ) => {
      const trimmed = text.trim();
      // Re-entrancy is per chat, not per component: a turn may still be running
      // in ANOTHER chat, and blocking the foreground on it would make
      // "background" pointless. Within one chat a second turn is meaningless.
      if (!trimmed && attachmentSources.length === 0) return;
      if (hasRunningTurnForChat(chatTitle || chatSessionId) || sendInFlightRef.current) return;
      if (countRunningChatTurns() >= MAX_CONCURRENT_CHAT_TURNS) return;

      const resolvedModel = resolveModel();
      const { provider, model, thinkingLevel, apiKey, modelLabel } = resolvedModel;
      sendInFlightRef.current = true;
      // A send lands at the bottom of the thread, so anything still hidden by a
      // mid-flight reveal must be materialised now — otherwise the reply streams
      // into a thread that is visibly missing its older half.
      setRevealCount(Number.MAX_SAFE_INTEGER);
      if (streamingClearRafRef.current !== null) {
        cancelAnimationFrame(streamingClearRafRef.current);
        streamingClearRafRef.current = null;
      }
       const isBrandNewConversation = historyOverride === undefined && messages.length === 0;

       if (isBrandNewConversation) {
         // Keep the first query/composer choreography independent from the
         // normal per-turn smooth-scroll path. The thinking row is revealed
         // only after this entrance completes, matching Gemini's sequencing.
         skipNextNativeScrollRef.current = true;
         setIsFirstTurnEntranceActive(true);
       }

      const attachmentSavePromises: Promise<boolean>[] = [];
      const preparedAttachments = attachmentSources.map((source): ChatAttachment => {
        if ('file' in source && source.file instanceof Blob) {
          const metadata = toPersistedChatAttachment(source);
          attachmentBlobsRef.current.set(metadata.id, source.file);
          const sentAttachment = {
            ...metadata,
            url: createAttachmentObjectUrl(source.file),
          };
          if (!isIncognito && isLocalFolderConnected) {
            attachmentSavePromises.push(saveLocalFSChatAttachment(metadata, source.file));
          }
          return sentAttachment;
        }
        return source;
      });

      const attachmentPersistence = Promise.all(attachmentSavePromises);

      const userMsg: ChatMsg = {
        id: newId(),
        role: 'user',
        content: trimmed,
        isNew: true,
        ...(preparedAttachments.length ? { attachments: preparedAttachments } : {}),
      };
      const assistantId = newId();
      const assistantPlaceholder: ChatMsg = {
        id: assistantId,
        role: 'assistant',
        content: '',
        isGenerating: true,
        isNew: true,
        modelSnapshot: {
          provider,
          modelId: model,
          label: modelLabel,
          thinkingLevel,
        },
        // Marks the turn for the status row ("Generating research plan") until the plan lands.
        ...(tool === 'research'
          ? { research: { id: `planning_${assistantId}`, title: '', query: trimmed, steps: [], status: 'planning' as const, thoughts: [], sources: [] } }
          : {}),
      };

      const prevMessages = historyOverride ?? messages;
      setMessages([...prevMessages, userMsg, assistantPlaceholder]);

      if (!isIncognito && isLocalFolderConnected && isBrandNewConversation) {
        // Initialize the local chat with the temporary ID so it shows up as a skeleton loader in the sidebar immediately!
        void saveLocalFSChat(chatSessionId, [serializeChatMessage(userMsg)], null);
      }

      setIsGenerating(true);
      setIsThinking(true);
      setThinkingPhase('thinking');
      isThinkingRef.current = true;
      setThinkSeconds(0);
      thinkSecondsRef.current = 0;
      setStreaming('');
      setRevealingResponseId(null);
      // The elapsed-seconds ticker lives on the turn record now, driven by the
      // runner: two concurrent turns would otherwise share one interval handle,
      // and stopping either would kill the other's thinking row.

      if (!apiKey) {
        sendInFlightRef.current = false;
        stopThinking();
        setIsGenerating(false);
        const missingKeyError = `API key for ${provider} is missing. Add one in Settings > Models to start chatting.`;
        showCopyToast('Something went wrong', {
          label: 'Show error',
          onClick: () => openErrorDialog(missingKeyError),
        });
        finalizeAssistant(
          assistantId,
          friendlyChatErrorFor(prevMessages),
          undefined,
          true,
          false,
          undefined,
          missingKeyError,
        );
        return;
      }

      const chatKey = chatTitle || chatSessionId;
      const record: ChatTurnRecord = {
        turnId: assistantId,
        chatId: chatKey,
        chatIdHistory: [],
        scopeId: chatScopeId,
        isIncognito,
        // Blob URLs belong to this ChatView instance and are revoked on its
        // unmount, so the record keeps metadata only. A resumed thread reloads
        // its attachments from disk like any other chat open.
        historyBefore: prevMessages.map(stripAttachmentObjectUrls),
        userMessage: stripAttachmentObjectUrls(userMsg),
        assistantId,
        modelSnapshot: assistantPlaceholder.modelSnapshot,
        content: '',
        thinkingText: '',
        citations: undefined,
        phase: 'thinking',
        isThinking: true,
        thinkStartedAt: Date.now(),
        thinkSeconds: 0,
        abort: new AbortController(),
        status: 'running',
        settledBy: null,
        wasStopped: false,
        isError: false,
        errorDetail: undefined,
        finalContent: '',
        persisted: false,
        lastCheckpointAt: Date.now(),
        listener: null,
      };
      generationAbortRef.current = record.abort;
      registerChatTurn(record);
      attachTurn(record.turnId);

      const notebookId = $chatNotebookId.get();
      const gemId = $chatGemId.get();
      // Only a saved turn can carry on in another tab: it resumes from the chat
      // file, and a temporary chat or an unconnected folder writes none.
      const job = !isIncognito && isLocalFolderConnected
        ? startChatTurnJob(record, { selectedModelId, notebookId, gemId, tool: tool ?? null })
        : null;
      try {
        let history: AiChatMessage[] = [];
        try {
          history = await buildAiHistory([...prevMessages, userMsg]);
        } catch {
          history = [];
        }
        const { notebookGrounding, gemPrompt } = await resolveChatTurnGrounding({
          text,
          notebookId,
          gemId,
          modelConfig,
          apiKeys,
        });
        // Images sent with an image or video request are what it starts from. A message with
        // no tool may still ask for one ("animate this"), so its images go along too.
        const mediaInputImages: InlineImage[] = [];
        if (tool === 'images' || tool === 'video' || !tool) {
          for (const attachment of preparedAttachments) {
            const blob = attachment.kind === 'image' ? attachmentBlobsRef.current.get(attachment.id) : undefined;
            if (blob) mediaInputImages.push(await blobToInlineImage(blob));
          }
        }
        // "Make it cuter" sends no image; the call says it means the newest one in the thread.
        // An image from the thread sent again (the image card's Edit) is already the one to change.
        const mediaPreviousImage = async (): Promise<InlineImage | null> => {
          if (preparedAttachments.some((attachment) => isThreadImage(prevMessages, attachment.id))) return null;
          const image = newestThreadImage(prevMessages);
          if (!image) return null;
          let blob = attachmentBlobsRef.current.get(image.id);
          if (!blob) {
            blob = (await loadLocalFSChatAttachment(image.id))?.blob;
            if (blob) attachmentBlobsRef.current.set(image.id, blob);
          }
          return blob ? blobToInlineImage(blob) : null;
        };
        // "/skill" brings that skill's instructions to this turn; "@App" points it at that app.
        const mentioned = mentionsIn(trimmed, mentionOptionsRef.current).map(({ option }) => option);
        const mentionedSkillIds = new Set(mentioned.filter((option) => option.kind === 'skill').map((option) => option.value));
        const mentionedSkills = skillLibrary.get().filter((skill) => skill.enabled && mentionedSkillIds.has(skill.id));
        const mentionedApps = mentioned.filter((option) => option.kind === 'app').map((option) => option.label);
        await runChatTurn(record, {
          ...buildChatTurnSetup({
            model: resolvedModel,
            apiKey,
            prevMessages,
            tool,
            isIncognito,
            chatKey,
            modelConfig,
            apiKeys,
            notebookGrounding,
            gemPrompt,
            mediaOptions: toolOptions,
            mediaStore,
            mediaScopeId: chatScopeIdRef.current ?? '',
            mediaInputImages,
            mediaPreviousImage,
            researchQuery: trimmed,
            libraryScopeId: chatScopeIdRef.current || 'guest',
            mentionedSkills,
            mentionedApps,
          }),
          history,
          attachmentPersistence,
          currentScopeId: () => chatScopeIdRef.current,
          saveChat: saveLocalFSChatRef.current,
        });
      } finally {
        job?.finish();
      }
    },
    [messages, resolveModel, selectedModelId, apiKeys, isIncognito, isLocalFolderConnected, saveLocalFSChat, saveLocalFSChatAttachment, loadLocalFSChatAttachment, chatSessionId, chatTitle, chatScopeId, modelConfig, buildAiHistory, createAttachmentObjectUrl, buildTurnListener, openErrorDialog, mediaStore]
  );

  /*
   * ── Deep Research ─────────────────────────────────────────────────────────
   *
   * Start research is not a model turn. It posts "Start research" and the reply, opens the
   * panel, and hands the plan to the background runner (research-runner.ts); the runner's
   * updates land on the reply for as long as this view shows the chat.
   */
  const composerHandleRef = useRef<ComposerHandle | null>(null);

  /*
   * The sidebar's Images and Videos, and an address opened at /images or /videos, ask for a
   * creation page. Once the chat on show is a new one, this picks the page's tool and keeps the
   * page; `none` (New chat from a page) clears both. The composer can mount a beat after the
   * request, so the pick waits for its handle.
   */
  const creationPageRequest = useStore($chatCreationPageRequest);
  useEffect(() => {
    if (!creationPageRequest || hasStarted || showBlankThread) return undefined;
    let cancelled = false;
    let attempts = 0;
    const pick = () => {
      if (cancelled) return;
      const handle = composerHandleRef.current;
      if (!handle) {
        attempts += 1;
        if (attempts < 40) window.setTimeout(pick, 50);
        return;
      }
      if (creationPageRequest === 'none') {
        handle.selectTool(null);
        setCreationPage(null);
      } else {
        handle.selectTool(creationPageTool(creationPageRequest));
        setCreationPage(creationPageRequest);
      }
      $chatCreationPageRequest.set(null);
    };
    pick();
    return () => { cancelled = true; };
  }, [creationPageRequest, hasStarted, showBlankThread]);

  // A page lasts while its tool stays picked on the new chat: removing the chip, picking
  // another tool or sending leaves it, and Gemini's address goes back to /app.
  // Which page's tool has reached the composer: going from one page to the other, the old
  // tool is still picked for a render, and that must not read as the chip coming off.
  const creationToolSeenRef = useRef<ChatCreationPage | null>(null);
  useEffect(() => {
    if (!creationPage) {
      creationToolSeenRef.current = null;
      return;
    }
    if (hasStarted) {
      setCreationPage(null);
      return;
    }
    if (composerTool === creationPageTool(creationPage)) creationToolSeenRef.current = creationPage;
    else if (creationToolSeenRef.current === creationPage) setCreationPage(null);
  }, [creationPage, composerTool, hasStarted]);
  useEffect(() => { $chatCreationPage.set(creationPage); }, [creationPage]);
  useEffect(() => () => { $chatCreationPage.set(null); }, []);

  /*
   * The /images page leaves room for the composer between its hero and its templates, so it
   * needs the composer's height; and once the page scrolls (the whole set open), the composer
   * scrolls with it, as Gemini's does, instead of staying pinned over the cards. On a phone
   * Gemini docks the composer at the bottom, so neither applies there.
   */
  const isPhone = usePhone();
  const composerBoxRef = useRef<HTMLDivElement | null>(null);
  // The "@" and "/" menus listen on the composer box, so they need it as state.
  const [composerBox, setComposerBox] = useState<HTMLDivElement | null>(null);
  const attachComposerBox = useCallback((box: HTMLDivElement | null) => {
    composerBoxRef.current = box;
    setComposerBox(box);
  }, []);
  const composerLayerRef = useRef<HTMLDivElement | null>(null);
  const [composerBoxHeight, setComposerBoxHeight] = useState(150);
  useEffect(() => {
    const box = composerBoxRef.current;
    if (!imagesPage || !box) return undefined;
    const measure = () => setComposerBoxHeight(box.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [imagesPage]);
  useEffect(() => {
    const scroller = chatScrollRef.current;
    const layer = composerLayerRef.current;
    if (!imagesPage || isPhone || !scroller || !layer) return undefined;
    const follow = () => {
      layer.style.top = `${-scroller.scrollTop}px`;
      layer.style.bottom = `${scroller.scrollTop}px`;
    };
    follow();
    scroller.addEventListener('scroll', follow, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', follow);
      layer.style.top = '';
      layer.style.bottom = '';
    };
  }, [imagesPage, isPhone]);
  // The page centres in the scroller's content box, which leaves out the gutter it keeps for
  // its scrollbar (`.gm-images-scroller`); this layer spans that gutter, so it gives the same
  // width back on its right, and the composer stays on the page's centre line as Gemini's does.
  useLayoutEffect(() => {
    const scroller = chatScrollRef.current;
    const layer = composerLayerRef.current;
    if (!imagesPage || !scroller || !layer) return undefined;
    const align = () => {
      layer.style.paddingRight = '';
      const inset = parseFloat(getComputedStyle(layer).paddingRight) || 0;
      layer.style.paddingRight = `${inset + scroller.offsetWidth - scroller.clientWidth}px`;
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(scroller);
    return () => {
      observer.disconnect();
      layer.style.paddingRight = '';
    };
  }, [imagesPage]);
  // "Choose photo": the template's prompt and the photo, sent with Images picked.
  const chooseImagesTemplatePhoto = useCallback((template: ImagesPageTemplate, file: File) => {
    composerHandleRef.current?.sendWith(template.prompt, [file]);
  }, []);

  const startResearchFor = useCallback((planMessageId: string) => {
    const plan = messages.find((m) => m.id === planMessageId)?.research;
    if (!plan || plan.status !== 'plan' || plan.started) return;
    const binding = resolveProviderBinding(modelConfig, 'gemini');
    const geminiKey = apiKeysForBinding(binding, 'gemini', apiKeys)[0];
    if (!geminiKey) {
      showCopyToast('Add a Gemini API key in Settings to run Deep Research');
      return;
    }
    const resolved = resolveModel();
    const replyId = newId();
    const run: ResearchRecord = {
      ...plan,
      id: newId(),
      status: 'running',
      phase: 'starting',
      started: undefined,
      thoughts: [],
      sources: [],
      report: undefined,
      startedAt: Date.now(),
    };
    setMessages((prev) => [
      ...prev.map((m) => (m.id === planMessageId && m.research ? { ...m, research: { ...m.research, started: true } } : m)),
      { id: newId(), role: 'user', content: 'Start research', isNew: true },
      { id: replyId, role: 'assistant', content: RESEARCH_STARTED_REPLY, isNew: true, research: run },
    ]);
    setOpenResource(null);
    $openCanvas.set(null);
    setOpenResearchId(replyId);
    startResearch(replyId, run, {
      apiKey: geminiKey,
      model: resolved.provider === 'gemini' ? resolved.model : 'gemini-3.5-flash-lite',
      baseUrl: binding.baseUrl,
    });
  }, [messages, modelConfig, apiKeys, resolveModel]);

  const editResearchPlan = useCallback(() => {
    composerHandleRef.current?.setPrompt('Change the research plan: ');
  }, []);

  const createFromResearch = useCallback((record: ResearchRecord, kind: ResearchCreateKind) => {
    const what = { web: 'a web page', infographic: 'an infographic', quiz: 'a quiz', flashcards: 'flashcards' }[kind];
    setOpenResearchId(null);
    void handleSend(`Create ${what} from my research report "${record.title}".`, undefined, [], 'canvas');
  }, [handleSend]);

  const runningResearchIds = useMemo(
    () => messages.filter((m) => m.research?.status === 'running').map((m) => m.id).join(' '),
    [messages],
  );
  const researchRunning = runningResearchIds.length > 0;
  useEffect(() => {
    if (!runningResearchIds) return undefined;
    const offs = runningResearchIds.split(' ').map((id) => subscribeResearch(id, (record) => {
      setMessages((prev) => prev.map((m) => (m.id === id
        ? { ...m, research: record, ...(record.status === 'done' ? { content: RESEARCH_DONE_REPLY } : {}) }
        : m)));
    }));
    return () => offs.forEach((off) => off());
  }, [runningResearchIds]);
  const stopResearch = useCallback(() => {
    runningResearchIds.split(' ').filter(Boolean).forEach(cancelResearch);
  }, [runningResearchIds]);

  // The panel belongs to the chat it was opened in, and gives way to the other panels.
  useEffect(() => { setOpenResearchId(null); }, [activeChatId]);
  useEffect(() => { if (openResource || openCanvasDoc) setOpenResearchId(null); }, [openResource, openCanvasDoc]);

  /*
   * ── Notebook hand-off ─────────────────────────────────────────────────────
   *
   * A notebook page cannot run a turn: streaming, persistence, history and title
   * generation all live here. So sending from a notebook queues the prompt on
   * `$notebookHandoff` and switches to this surface, and this effect performs the
   * send as if the user had typed it.
   *
   * Two things make that safe in an effect:
   *
   *  - `consumeNotebookHandoff()` flips a `consumed` flag rather than clearing the
   *    atom, so StrictMode's double-invoked effects send once, not twice. A plain
   *    read-then-clear duplicates the turn in dev only — exactly the class of bug
   *    that survives to production unnoticed.
   *  - Only the user's prompt is sent. The notebook's sources go into the per-turn
   *    system prompt (see `resolveChatTurnGrounding`), which keeps them out
   *    of the visible bubble and keeps every later turn grounded too.
   */
  const pendingNotebookHandoff = useStore($notebookHandoff);
  useEffect(() => {
    /*
     * Wait for the key set to settle before consuming.
     *
     * Sending does not require an account, but it does require a key, and
     * `handleSend` gives up when it has none. Firing this on mount therefore
     * dropped the message whenever identity or the stored keys had not resolved
     * yet — and because the handoff was already marked consumed it never
     * retried, so the notebook composer looked like it did nothing at all.
     * Both flags settle on their own within a tick or two, signed in or not.
     *
     * Re-running as `handleSend` changes identity is harmless and deliberate —
     * `consumeNotebookHandoff` returns null once taken, so the send happens once.
     */
    if (isAuthResolving || areKeysLoading) return;
    if (!pendingNotebookHandoff || pendingNotebookHandoff.consumed) return;
    const handoff = consumeNotebookHandoff();
    if (!handoff) return;
    void handleSend(handoff.prompt);
  }, [pendingNotebookHandoff, isAuthResolving, areKeysLoading, handleSend]);

  /*
   * Record the chat on the notebook it was started from, so the notebook's "Past
   * chats" list can find it. Keyed on the id so it runs when the chat is first
   * persisted rather than on every render.
   *
   * `fileChat` and not `addChatToNotebook`: filing has a disk half, and the chat's
   * file has to end up in `Notebooks/<name>/Chats/` rather than the global folder.
   * Whichever lands first is fine — if the first save beat this, the file is moved;
   * if this won, the save writes straight into the notebook's folder and the move
   * is a no-op. It runs again for the generated title because that id is a new file
   * (see `renameLocalFSChat`, which carries the notebook across).
   */
  useEffect(() => {
    const notebookId = $chatNotebookId.get();
    const id = chatTitle || chatSessionId;
    if (!notebookId || !id) return;
    void fileChat(id, notebookId);
  }, [chatTitle, chatSessionId, fileChat]);

  /*
   * Remember the Gem under every id the chat is saved as — the temporary one, then the
   * generated title — so reopening it from Recents brings the Gem back. Only once there
   * is a message: an untouched Gem chat is never saved, so it has nothing to remember.
   */
  useEffect(() => {
    const gemId = $chatGemId.get();
    if (!gemId || !hasStarted) return;
    if (chatSessionId) recordGemChat(chatSessionId, gemId);
    if (chatTitle) recordGemChat(chatTitle, gemId);
  }, [chatTitle, chatSessionId, hasStarted]);

  // ── Live mode ──────────────────────────────────────────────────────────────
  // A live "turn" maps onto the exact same message shape as a typed turn:
  //   • onTurnStart    → push user bubble (isTranscribing) + assistant placeholder
  //                       in ONE setMessages — same as handleSend — so the
  //                       scroll-to-top useLayoutEffect + flushSync reserve fire
  //                       identically and all spacing rules hold.
  //   • onUserTranscript → fill the user bubble's `content`, drop isTranscribing
  //   • onModelText      → append to `streaming` (same render path as typed)
  //   • onTurnComplete   → finalizeAssistant + clear streaming, ready for next
  //                       utterance; session stays open.
  const openLiveTurn = useCallback(() => {
    if (streamingClearRafRef.current !== null) {
      cancelAnimationFrame(streamingClearRafRef.current);
      streamingClearRafRef.current = null;
    }
    const userId = newId();
    const assistantId = newId();
    liveTurnRef.current = { userId, assistantId, acc: '' };

    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: '', isTranscribing: true, isNew: true },
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        isGenerating: true,
        isNew: true,
        isLive: true,
        modelSnapshot: {
          provider: voiceProvider?.id ?? 'gemini',
          modelId: liveModelId,
          label: liveModelLabel,
          thinkingLevel: 0,
        },
      },
    ]);

    // Live turns are real-time: no "Thinking" shimmer, no "Thought for Xs".
    // Keep isGenerating so the streaming render path + action-row gate work,
    // but leave the think timer alone.
    setIsGenerating(true);
    setIsThinking(false);
    isThinkingRef.current = false;
    setStreaming('');
    setRevealingResponseId(null);
  }, []);

  const closeLiveTurn = useCallback(
    (opts?: { error?: string; aborted?: boolean }) => {
      const turn = liveTurnRef.current;
      liveTurnRef.current = null;
      stopThinking();
      setIsGenerating(false);
      if (!turn) return;
      // If neither a transcript nor a model token ever arrived (e.g. mic blip),
      // drop the empty pair rather than leave dangling bubbles.
      if (!opts?.error && turn.acc.length === 0) {
        let hadTranscript = false;
        setMessages((prev) => {
          hadTranscript = !!prev.find((m) => m.id === turn.userId)?.content;
          return hadTranscript
            ? prev
            : prev.filter((m) => m.id !== turn.userId && m.id !== turn.assistantId);
        });
        // If we removed them, also drop the reserve + scroll bookkeeping so the
        // next real turn re-runs the sweep from scratch.
        if (!hadTranscript) {
          lastScrolledUserId.current = null;
          setResponseAreaMinHeight(undefined);
        }
        if (!hadTranscript) {
          streamingClearRafRef.current = requestAnimationFrame(() => {
            streamingClearRafRef.current = null;
            setStreaming('');
          });
          return;
        }
      }
      // Interrupted: the text released so far is exactly what was *spoken*
      // (the audio-synced drain dropped everything after the barge-in point).
      // Append an em-dash so it reads as cut-off, and flag the message so the
      // render skips the like/dislike/copy row — and so any later typed turn
      // sends only the spoken-so-far text as context.
      const finalText = opts?.error
        ? opts.error
        : opts?.aborted && turn.acc
          ? `${turn.acc.replace(/\s+$/, '')} —`
          : turn.acc;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === turn.userId
            ? { ...m, isTranscribing: false, content: m.content || '…' }
            : m.id === turn.assistantId
              ? {
                  ...m,
                  content: finalText,
                  isGenerating: false,
                  isError: !!opts?.error,
                  wasInterrupted: !!opts?.aborted,
                  wasStopped: !!opts?.aborted,
                  thinkingTime: undefined,
                }
              : m
        )
      );
      streamingClearRafRef.current = requestAnimationFrame(() => {
        streamingClearRafRef.current = null;
        setStreaming('');
      });
    },
    [stopThinking]
  );

  /**
   * Mic mute for the running live session.
   *
   * Mutes at the track (`track.enabled = false`), so the browser/OS mic indicator
   * goes off and the orb stops reacting for free — its analyser is a leaf tap off
   * the same source node. The socket stays open and keeps receiving silence, which
   * keeps the model's turn-detection timeline continuous instead of looking like a
   * dropped connection.
   *
   * Only flips the flag; the effect above is what reaches the session, so two
   * presses inside one render still net out correctly.
   */
  const handleToggleMicMute = useCallback(() => {
    setIsMicMuted((prev) => !prev);
  }, []);

  const handleStopLive = useCallback(() => {
    // Falling fifth into an A open fifth = "done listening". Only on explicit
    // user stop — error closes stay silent.
    playLiveSessionCue('end');
    liveSessionRef.current?.stop();
    liveSessionRef.current = null;
    setIsLive(false);
    // Drop the orb's inputs with the session: the analysers belong to audio
    // contexts that are now closed.
    setIsLiveConnected(false);
    setIsAssistantSpeaking(false);
    setLiveAnalysers({ mic: null, output: null });
    // Mute is per-session, not a preference: re-entering voice mode should start
    // listening, not come up silently muted from a session the user already ended.
    setIsMicMuted(false);
    // If the model was mid-reply, treat stop as an interruption: `turn.acc` is
    // exactly what was *heard* (audio-synced release already dropped anything
    // unspoken), so finalise with the trailing `—` just like a barge-in.
    if (liveTurnRef.current) closeLiveTurn({ aborted: true });
  }, [closeLiveTurn]);

  /**
   * Composer stop button. Aborting the stream is enough: the catch path in the
   * send effect owns finalisation, so the partial text and the `wasStopped`
   * marker are written in exactly one place.
   */
  const handleStopGenerating = useCallback(() => {
    /*
     * Stop may only ever reach the turn this view is attached to.
     *
     * `commitLoadedChat` now nulls `generationAbortRef` on the way out of a
     * chat, so the ref alone would be correct — but resolving through the store
     * makes it structural instead of a convention two distant functions have to
     * keep agreeing on. Stop is the one control wired directly to an
     * AbortController, and a stale one here kills a background reply in a chat
     * the user is not even looking at.
     *
     * The fallback covers the window inside `handleSend` before the record is
     * registered, where there is no attached turn to find yet.
     */
    // With no turn running, the button belongs to a Deep Research run (it shows for one).
    if (!isGeneratingRef.current && runningResearchIds) {
      stopResearch();
      return;
    }
    const attachedTurnId = attachedTurnIdRef.current;
    const attached = attachedTurnId ? getChatTurn(attachedTurnId) : undefined;
    if (attached) attached.abort.abort();
    else generationAbortRef.current?.abort();
    if (isLiveRef.current || liveSessionRef.current) {
      handleStopLive();
    }
    setIsGenerating(false);
  }, [handleStopLive, runningResearchIds, stopResearch]);

  /**
   * Opens a live session against the current voice/language selection.
   *
   * Split out of `handleStartLive` so a voice or language change can reopen the
   * socket without re-running the entry guards — `speechConfig` is fixed in the
   * setup frame, so a change only lands on reconnect.
   */
  const openLiveSession = useCallback((apiKey: string) => {
    // Prime the live model with everything already in the thread so a mid-chat
    // voice session has full context. Read from the ref (fresh) not the
    // closed-over `messages`.
    const history: LiveHistoryTurn[] = messagesRef.current
      .filter((m) => m.content)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        text: m.content,
      }));

    // Voice, and either a `languageCode` or a prompt directive depending on what
    // the provider accepts. With no provider match this returns the prompt
    // untouched and neither field set, i.e. exactly the pre-existing request.
    const voiceOptions = buildLiveVoiceOptions(
      liveModelId,
      voiceAgentSystemPrompt({ personalize: !isIncognito }),
    );
    liveSettingsSignatureRef.current = `${liveModelId}|${voiceSettingsSignature(liveModelId)}`;

    // Every callback below is late-bound to the ref, so a session that has been
    // replaced goes quiet instead of tearing down its successor.
    const isCurrentSession = () => liveSessionRef.current === session;

    const session = new GeminiLiveSession({
      apiKey,
      model: liveModelId,
      systemPrompt: voiceOptions.systemPrompt,
      voiceName: voiceOptions.voiceName,
      languageCode: voiceOptions.languageCode,
      history,
      // Rising fifth into a C#-minor fragment, the moment the socket ACKs setup
      // + mic is hot — i.e. the exact instant it's actually listening. This is
      // the "connected" event the cue was measured against, not the click.
      onOpen: () => {
        if (!isCurrentSession()) return;
        if (!isReconnectingRef.current) {
          playLiveSessionCue('connect');
        }
        isReconnectingRef.current = false;
        // Socket ACKed and mic is hot: the orb reveals from here.
        setIsLiveConnected(true);
        setLiveAnalysers({
          mic: session.micAnalyser ?? null,
          output: session.outputAnalyser ?? null,
        });
      },
      onTurnStart: () => { if (isCurrentSession()) openLiveTurn(); },
      onUserTranscript: (full) => {
        if (!isCurrentSession()) return;
        const turn = liveTurnRef.current;
        if (!turn) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === turn.userId ? { ...m, content: full, isTranscribing: false } : m
          )
        );
      },
      onModelText: (chunk) => {
        if (!isCurrentSession()) return;
        const turn = liveTurnRef.current;
        if (!turn) return;
        // `chunk` is released by live.ts only when its audio is actually being
        // spoken, so `turn.acc` == what the user has *heard* so far. That makes
        // it the right signal for the orb's speaking state too.
        turn.acc += chunk;
        setIsAssistantSpeaking(true);
        flushSync(() => setStreaming(turn.acc));
      },
      onTurnComplete: ({ aborted }) => {
        if (!isCurrentSession()) return;
        setIsAssistantSpeaking(false);
        closeLiveTurn({ aborted });
      },
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.error('[ChatView] live error', err);
        if (!isCurrentSession()) return;
        if (liveTurnRef.current) {
          // Mid-turn failure → finalise the in-flight assistant bubble with the error.
          closeLiveTurn({ error: `Live session error: ${err.message}` });
        } else {
          // Connect/setup failed before any speech. closeLiveTurn() would
          // early-return (no turn), leaving the user staring at a silent
          // bounce back to the empty state. Push an explicit error pair so
          // the scroll/reserve machinery has something to anchor on AND the
          // user can read what went wrong.
          const uId = newId();
          const aId = newId();
          setMessages((prev) => [
            ...prev,
            { id: uId, role: 'user', content: 'Start live voice chat', isNew: true },
            {
              id: aId,
              role: 'assistant',
              isNew: true,
              isError: true,
              content:
                `Couldn't start live mode (\`${liveModelId}\`).\n\n` +
                `> ${err.message}\n\n` +
                'Check that your Gemini key has **Live API** access and that ' +
                'microphone permission was granted.',
            },
          ]);
        }
        liveSessionRef.current = null;
        setIsLive(false);
        setIsLiveConnected(false);
        setIsAssistantSpeaking(false);
        setLiveAnalysers({ mic: null, output: null });
        setIsMicMuted(false);
      },
      onClose: () => {
        // onError (above) already handled the unhappy path; a clean close just
        // drops back to typed mode.
        if (!isCurrentSession()) return;
        liveSessionRef.current = null;
        setIsLive(false);
        setIsLiveConnected(false);
        setIsAssistantSpeaking(false);
        setLiveAnalysers({ mic: null, output: null });
        setIsMicMuted(false);
      },
    });
    liveSessionRef.current = session;
    // Carry an active mute onto the new session: a voice/model change reconnects,
    // and the fresh instance would otherwise come up with a live mic while the
    // button still reads muted. Set before `start()` so it is in place whenever
    // the mic is acquired.
    session.setMicMuted(micMutedRef.current);
    void session.start();
  }, [openLiveTurn, closeLiveTurn, liveModelId, liveModelLabel, voiceProvider, isIncognito]);

  const handleStartLive = useCallback(() => {
    if (isLive || isGenerating) return;

    // Temporary chats have no live voice. Silent rather than an inline error,
    // because there is no control to reach this from — `liveAvailable` is false
    // here, so the composer renders no live button — and an error message would
    // be answering a question the user was never given a way to ask.
    if (isIncognito) return;

    // Gate on the user having added the live model from Settings → Models.
    if (!hasLiveModel) {
      const uId = newId();
      const aId = newId();
      setMessages((prev) => [
        ...prev,
        { id: uId, role: 'user', content: 'Start live voice chat', isNew: true },
        {
          id: aId,
          role: 'assistant',
          isNew: true,
          content:
            'Live voice mode requires a **Gemini Live** model. ' +
            'Add it from **Settings → Models → Google → Gemini 3.8 Live** to enable live voice chat.',
          isError: true,
        },
      ]);
      return;
    }

    const apiKey: string | undefined = apiKeys?.gemini?.[0];
    if (!apiKey) {
      // Surface the same friendly inline error style as typed chat.
      const uId = newId();
      const aId = newId();
      setMessages((prev) => [
        ...prev,
        { id: uId, role: 'user', content: 'Start live voice chat', isNew: true },
        {
          id: aId,
          role: 'assistant',
          isNew: true,
          content:
            'A **Gemini** API key is required for live voice mode ' +
            `(\`${liveModelId}\`). Add one in **Settings → Models**.`,
          isError: true,
        },
      ]);
      return;
    }

    // Still inside the click gesture: create/resume the cue AudioContext, so the
    // connect cue is not swallowed as autoplay when onOpen fires later.
    isReconnectingRef.current = false;
    primeLiveSessionCues();

    setIsLive(true);
    openLiveSession(apiKey);
  }, [
    isLive,
    isGenerating,
    isIncognito,
    hasLiveModel,
    apiKeys,
    openLiveSession,
  ]);

  /**
   * Reopen the socket after a voice or language change.
   *
   * Voice and language ride the setup frame, so there is no way to change them on
   * a running session — it has to be torn down and reopened. `stop()` reaches
   * `ws.onclose` unconditionally, which is why every callback above is guarded on
   * `liveSessionRef.current === session`: without that, the outgoing session's
   * close would null the ref the incoming one just claimed and drop the user out
   * of voice mode entirely.
   *
   * The end chime is skipped deliberately — voice mode is not ending, and the
   * start chime on the new socket already marks the transition.
   *
   * `isLiveConnected` is deliberately left alone for the same reason. It drives the
   * orb's reveal ramp, so dropping it to false across the swap would fade the orb
   * out and play the connect reveal again on every voice change — which is visible
   * as the settings panel "affecting" the orb behind it, since the panel is where
   * voice changes come from. Voice mode does not end here, so the flag should not
   * say it did; a reopen that fails still lands on `onError`/`onClose`, which clear
   * it, and a reopen that succeeds sets it true again on `onOpen`.
   */
  const restartLiveSession = useCallback(() => {
    if (!liveSessionRef.current) return;
    const apiKey: string | undefined = apiKeys?.gemini?.[0];
    if (!apiKey) return;

    isReconnectingRef.current = true;
    liveSessionRef.current.stop();
    liveSessionRef.current = null;
    setIsAssistantSpeaking(false);
    setLiveAnalysers({ mic: null, output: null });
    openLiveSession(apiKey);
  }, [apiKeys, openLiveSession]);

  // A change while live reconnects; a change while idle just waits for the next
  // session, which will read the stores when it opens. Picking a different live
  // model from the composer lands here too — same setup frame, same reconnect.
  //
  // Debounced: this is on the voice-settings store, so every dot click in the
  // settings panel lands here, and an immediate reconnect would tear the socket
  // down and re-run getUserMedia for *every single press* — the panel visibly
  // fought back: the orb behind it reset and the new choice was applied over a
  // fresh connect, so it looked broken and felt laggy. Collecting a burst of
  // presses into one restart makes the panel read instantly and reconnect once,
  // with the user's final choice. 400ms is a policy value (no upstream to copy —
  // the shipped app reconnects on an explicit commit, not a debounce): shorter
  // than an arrow-press cadence, long enough to swallow the burst.
  //
  // `restartLiveSession` is deliberately reached through a ref: it changes
  // identity whenever `apiKeys` or the turn callbacks do, and as a dependency it
  // would cancel and re-arm the timer on every such change for no reason.
  const restartLiveSessionRef = useRef(restartLiveSession);
  restartLiveSessionRef.current = restartLiveSession;
  useEffect(() => {
    if (!isLive || !liveSessionRef.current) return;
    if (`${liveModelId}|${voiceSettingsSignature(liveModelId)}` === liveSettingsSignatureRef.current) return;
    const id = window.setTimeout(() => restartLiveSessionRef.current(), LIVE_RESTART_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [isLive, liveModelId, voiceSettings]);

  // Tear down the socket + mic if the component unmounts mid-session.
  useEffect(() => () => { liveSessionRef.current?.stop(); }, []);

  const [sentImagePreview, setSentImagePreview] = useState<{ id: string; url: string; name: string } | null>(null);
  // Its image belongs to the chat it was opened from, whose object URLs go when another loads.
  // `chatSessionId`, not `activeChatId`: a new chat's id moves when it is named, mid-preview.
  useEffect(() => { setSentImagePreview(null); }, [chatSessionId]);
  const handleOpenAttachment = useCallback(async (attachment: ChatAttachment) => {
    if (attachment.kind === 'github' && attachment.sourceUrl) {
      const sourceLink = document.createElement('a');
      sourceLink.href = attachment.sourceUrl;
      sourceLink.target = '_blank';
      sourceLink.rel = 'noopener noreferrer';
      sourceLink.click();
      return;
    }

    let url = attachment.url;
    if (!url) {
      let blob = attachmentBlobsRef.current.get(attachment.id);
      if (!blob) {
        const stored = await loadLocalFSChatAttachment(
          attachment.id,
          activeChatId ? { chatId: activeChatId, attachment } : undefined,
        );
        blob = stored?.blob;
      }
      if (!blob) return;
      attachmentBlobsRef.current.set(attachment.id, blob);
      url = createAttachmentObjectUrl(blob);
      const hydratedUrl = url;
      setMessages((current) => current.map((message) => ({
        ...message,
        attachments: message.attachments?.map((item) => (
          item.id === attachment.id ? { ...item, url: hydratedUrl, unavailable: undefined } : item
        )),
      })));
    }

    // A sent image opens in Gemini's lightbox, over the chat; the rest open as they did.
    if (attachment.kind === 'image') {
      setSentImagePreview({ id: attachment.id, url, name: attachment.name });
      return;
    }

    const opensInline = attachment.kind === 'pdf'
      || attachment.kind === 'audio'
      || attachment.kind === 'video'
      || attachment.kind === 'text'
      || attachment.kind === 'code';
    const link = document.createElement('a');
    link.href = url;
    link.rel = 'noopener noreferrer';
    if (opensInline) link.target = '_blank';
    else link.download = attachment.name;
    link.click();
  }, [activeChatId, createAttachmentObjectUrl, loadLocalFSChatAttachment]);

  /*
   * Gemini's feedback for a copy is the bottom-left snackbar and nothing else.
   * Measured before and after the click, the Copy button's own glyph is
   * unchanged — `icon: "copy"` both times, same family, size, weight and
   * colour — so there is deliberately no tick swap here any more.
   */
  const handleCopy = (msg: ChatMsg) => {
    navigator.clipboard.writeText(msg.content);
    showCopyToast('Copied to clipboard');
  };

  /*
   * Copying a *prompt* raises a different snackbar in Gemini: "Prompt copied"
   * with a trailing "Start new chat" pill. Same box, same enter/exit, so
   * `CopyToast` renders both and only the payload differs.
   */
  const handleCopyPrompt = (msg: ChatMsg) => {
    navigator.clipboard.writeText(msg.content);
    showCopyToast('Prompt copied', {
      label: 'Start new chat',
      onClick: () => {
        selectLocalFSInboxChat(null);
        onNewChat?.();
      },
    });
  };

  const handleListen = (msg: ChatMsg) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    if (listeningId === msg.id) {
      setListeningId(null);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(msg.content);
    utterance.onend = () => setListeningId((id) => (id === msg.id ? null : id));
    utterance.onerror = () => setListeningId((id) => (id === msg.id ? null : id));
    setListeningId(msg.id);
    window.speechSynthesis.speak(utterance);
  };

  const handleRegenerate = (assistantId: string) => {
    if (isGenerating) return;
    const assistantIndex = messages.findIndex((message) => message.id === assistantId);
    if (assistantIndex < 1) return;
    const userIndex = messages.slice(0, assistantIndex).map((message) => message.role).lastIndexOf('user');
    if (userIndex < 0) return;

    const userMessage = messages[userIndex];
    stopListening();
    setOpenThinkingMessageId(null);
    void handleSend(userMessage.content, messages.slice(0, userIndex), userMessage.attachments ?? []);
  };

  const startEditing = (msg: ChatMsg) => {
    if (isGenerating) return;
    setEditingUserId(msg.id);
    setEditDraft(msg.content);
  };

  const cancelEditing = () => {
    const container = chatScrollRef.current;
    const previousScrollTop = container?.scrollTop ?? 0;
    const wasPinnedToBottom = container
      ? container.scrollHeight - container.clientHeight - container.scrollTop <= 2
      : false;

    // Closing the tall editor and restoring the normal user-to-response gap
    // changes both halves of the thread layout. Commit that DOM change first,
    // then restore its inverse response reserve before the browser can paint a
    // transient shorter page and clamp the current scroll position.
    flushSync(() => {
      setEditingUserId(null);
      setEditDraft('');
    });

    if (!container) return;

    const lastUser = [...messagesRef.current].reverse().find((message) => message.role === 'user');
    const messageElement = lastUser ? messageRefs.current[lastUser.id] : null;
    if (messageElement) {
      const nextReserve = Math.max(
        0,
        container.clientHeight
          - threadGeometryRef.current.targetOffset
          - messageElement.offsetHeight
          - threadGeometryRef.current.messageGap
          - THREAD_BOTTOM_PADDING
      );

      flushSync(() => {
        setResponseAreaMinHeight((current) => (current === undefined ? current : nextReserve));
      });
    }

    const maximumScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = wasPinnedToBottom
      ? maximumScrollTop
      : Math.min(previousScrollTop, maximumScrollTop);
  };

  const submitEdit = (messageId: string) => {
    const trimmed = editDraft.trim();
    if (!trimmed || isGenerating) return;
    const userIndex = messages.findIndex((message) => message.id === messageId);
    if (userIndex < 0) return;

    stopListening();
    setEditingUserId(null);
    setEditDraft('');
    setOpenThinkingMessageId(null);
    void handleSend(trimmed, messages.slice(0, userIndex), messages[userIndex].attachments ?? []);
  };

  useEffect(() => () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  // ONE tree for both states, and in particular one composer node.
  //
  // This used to early-return an entirely separate zero-state tree whose
  // `HeroSection` rendered its own `<InputBar>`, bridged to the docked one by a
  // shared `layoutId`. That meant two composers: on send React tore one down and
  // built the other, and Framer papered over the seam by inverse-scaling a
  // wrapper whose children are not themselves layout nodes — so for the length
  // of the morph the text, the model pill and the icons visibly squashed.
  //
  // Gemini has exactly one `fieldset.input-area-container`, permanently in the
  // bottom bar; its zero state only adds `position:absolute; bottom:50vh;
  // transform:translateY(50%)`. Nothing is ever destroyed. Doing the same here
  // means the composer's measured box differs between the two states in
  // *position only*, so the projection degrades to a pure translate and there is
  // no scale left to distort anything.
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const latestConversationMessageId = [...messages]
    .reverse()
    .find((m) => m.role === 'user' || m.role === 'assistant')?.id;
  const thinkingMessage = openThinkingMessageId
    ? messages.find((message) => message.id === openThinkingMessageId && message.role === 'assistant')
    : undefined;
  const sourcesMessage = openSourcesMessageId
    ? messages.find((message) => message.id === openSourcesMessageId && message.role === 'assistant')
    : undefined;
  // Both panels occupy the same 428px slot, so the layout gates on either.
  const contextSidebarOpen = !!thinkingMessage || !!sourcesMessage;
  const shouldAnimateFirstPromptEntrance =
    messages.length === 2 &&
    messages[0]?.role === 'user' &&
    messages[0].isNew === true;

  return (
    <LayoutGroup id="willow-chat-layout">
    <div
      /*
       * With a resource open this is Gemini's `chat-window.immersives-mode`, taken
       * from its own authored rule rather than fitted to a screenshot
       * (`CSS.getMatchedStylesForNode` — tools/ui-research/captures/canvas/):
       *
       *   grid-template-columns: minmax(360px, 1fr) minmax(0, 2fr);
       *   gap: var(--gem-sys-spacing--xxl);            // 24px
       *   max-width: 1800px;
       *   margin: 0 max(var(--gem-sys-spacing--xxl), 50% - 1800px/2);
       *
       * THE COLUMN RATIO AND SIDE MARGIN ARE DELIBERATELY NOT REPRODUCED HERE.
       *
       * Gemini insets this grid by `max(24px, 50% - 900px)`, caps it at 1800px, and
       * splits it `minmax(360px,1fr) minmax(0,2fr)` — which would put the prose's
       * first content at 104 in a 1536 viewport instead of Willow's 80, and is the
       * "text starts too far left" report. It was implemented and then reverted,
       * twice, because both attempts broke the panel:
       *
       *   1. `mx-…` on top of the base `w-full` made the grid 48px wider than its
       *      parent and switched on horizontal scrolling across the whole shell.
       *   2. Fixing that with `w-auto` collapsed the SECOND track instead — the
       *      panel measured 2x754 pinned to the right edge, with its close button
       *      inside a 2px-wide box. `minmax(0, 2fr)` permits a zero-width track, so
       *      any error in the free-space calculation lands there rather than being
       *      caught.
       *
       * `1.03fr / 1.97fr` is therefore kept: it is what shipped working. Anyone
       * retrying the measured values must verify the PANEL's rendered width at
       * several viewports, not just the prose's left edge — the panel collapsing is
       * silent, and it reads as "the close animation lags" because the button is
       * still nominally there. Gemini's authored rule is recorded in
       * captures/canvas/03-gemini-matched-styles.json.
       *
       * THE LAYOUT SNAPS — there is deliberately no transition on this element.
       *
       * Measured: Gemini's chat column is `w=470.7` on every one of the 25 samples
       * through the 500ms open, and `w=1484` through the close. Nothing about its
       * width interpolates; the grid changes in one frame and the visible motion is
       * `translateX` on the column (see `immersiveControls` above) plus `scale` on
       * the panel. This element used to transition `grid-template-columns` over
       * 500ms, which interpolated the column's WIDTH — so the prose re-wrapped
       * continuously for half a second. That was the jerkiness; easing could never
       * have fixed it, because the problem was that text reflow was being animated.
       */
      className={`relative grid h-full min-h-0 w-full overflow-hidden grid-cols-[minmax(0,1fr)] ${
        canvasFullWidth
          /* One track: the panel and the chat column share it (see `canvasFullWidth`). */
          ? 'min-[960px]:grid-cols-[minmax(0,1fr)] min-[960px]:gap-x-0'
          : immersiveOpen
            ? 'min-[960px]:grid-cols-[minmax(0,1.03fr)_minmax(0,1.97fr)] min-[960px]:gap-x-6'
            : 'min-[960px]:grid-cols-[minmax(0,1fr)_0fr] min-[960px]:gap-x-0'
      }`}
    >
      {/*
        * Gemini's `.chat-container`. `immersiveControls` slides it; the transform is
        * written by Framer, so nothing here may set one of its own or the two fight.
        * The `transition-[margin-right,width]` below is the unrelated thinking/sources
        * sidebar, which is a different mechanism and is left alone.
        */}
      <motion.div
        animate={immersiveControls}
        className={`relative flex h-full min-h-0 min-w-0 w-full ${
          contextSidebarOpen ? 'min-[1024px]:w-[calc(100%_-_428px)]' : ''
        } flex-col transition-[margin-right,width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
          contextSidebarOpen ? 'min-[1024px]:mr-[428px]' : 'mr-0'
        } ${
          /* Gemini's `.full-width-immersive .chat-container`: laid over the panel in the
             same grid cell, inert, at the width it already had — so nothing re-wraps. */
          canvasFullWidth ? 'min-[960px]:z-[2] min-[960px]:pointer-events-none min-[960px]:[grid-area:1/1]' : ''
        }`}
      >
        {/* Mobile/tablet top-bar model picker; a notebook page mounts the same one. */}
        <MobileModelPicker
          modelConfig={modelConfig}
          selectedModelId={selectedModelId}
          setSelectedModelId={setSelectedModelId}
          onAuthRequired={onAuthRequired}
        />
      {/* Scrollable message thread
          scrollbar-gutter:stable keeps the mx-auto column from nudging left
          the moment streamed content grows tall enough to spawn a scrollbar. */}
      <div
        ref={chatScrollRef}
        className={`gemini-chat-scrollbar min-h-0 flex-1 ${
          !hasStarted && !showBlankThread && !galleryTool && !imagesPage
            ? 'overflow-y-hidden min-[961px]:overflow-y-auto'
            : 'overflow-y-auto'
        } ${imagesPage ? 'gm-images-scroller' : ''} ${
          /* Hidden, not unmounted or `display:none`: either would lose the scroll
             position the thread comes back to when the canvas collapses. */
          canvasFullWidth ? 'min-[960px]:invisible' : ''
        }`}
        style={{
          // A Gem's zero state sits in Gemini's scrolling thread, gutter and all.
          scrollbarGutter: hasStarted || showBlankThread || activeGem ? 'stable' : 'auto',
          // Gemini's gallery scrolls with no bar, so it centres on the composer.
          ...(galleryTool ? { scrollbarWidth: 'none' as const } : {}),
          // Gemini's <=960px `.chat-history-scroll-container` mask: the thread fades
          // in over 40px under the 68px header instead of sliding beneath it. This
          // scroller starts at the top of the screen, so the fade starts at 68.
          ...(isCompact && isThreadDocked
            ? {
                maskImage: 'linear-gradient(to bottom, transparent 68px, #000 108px)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 68px, #000 108px)',
              }
            : {}),
        }}
        {...voiceFocusSurfaceAttributes}
      >
        {/* Zero state lives in the same scroller as the thread, so the two
            states share one scroll container instead of the app shell's for one
            and this for the other. The greeting scrolls with the recent-chats
            list; only the composer is pinned, which is Gemini's behaviour — its
            input never scrolls.

            `h-full` gives the hero exactly one chat-area's worth of height, so
            recent chats begin right below the fold as before. It resolves
            because this scroller has a definite height (`flex-1` + `min-h-0`). */}
        {!hasStarted && !showBlankThread && activeGem && (
          <GemZeroState
            logo={gemLogoSpec(activeGem, isLight)}
            name={activeGem.gem.name}
            description={activeGem.gem.description}
            experiment={activeGem.kind === 'premade' && !!activeGem.gem.experiment}
            starters={activeGem.kind === 'premade' ? activeGem.gem.starters : undefined}
            onStarter={(prompt) => { void handleSend(prompt); }}
          />
        )}
        {galleryTool && (
          <>
            <MediaGallery tool={galleryTool} onPick={setMediaTemplate} />
            {galleryTool === 'video' && !videoIntroSeen && <VideoDiscoveryCard onDismiss={dismissVideoIntro} />}
          </>
        )}
        {imagesPage && (
          <ImagesPage composerSpace={isPhone ? 32 : 52 + composerBoxHeight + 32} onChoosePhoto={chooseImagesTemplatePhoto} />
        )}
        {!hasStarted && !showBlankThread && !activeGem && (galleryTool || imagesPage ? null : (
          <>
            <div className="h-full w-full">
              <HeroSection
                initialMode="chat"
                pinnedComposer
                onPromptSubmit={(prompt, _mode, attachments, tool) => handleSend(prompt, undefined, attachments, tool)}
                onStartLive={handleStartLive}
                modelConfig={modelConfig}
                selectedModelId={selectedModelId}
                setSelectedModelId={setSelectedModelId}
                onAuthRequired={onAuthRequired}
                isAuthenticated={isAuthenticated}
                isIncognito={isIncognito}
              />
            </div>
            {/* On mobile viewports (<= 960px), recents live in the sidebar drawer
                matching Gemini mobile; suppressing BottomPanel here guarantees
                the zero state height matches the viewport with no stray overflow. */}
            <div className="hidden min-[961px]:block pb-20 empty:pb-0">
              <BottomPanel onOpenDriveSettings={onOpenDriveSettings} />
            </div>
          </>
        ))}
        {hasStarted && !showBlankThread && (
        <motion.div
          // At <=960px Gemini's first turn also fades in, on the curve it rises on.
          initial={shouldAnimateFirstPromptEntrance ? { y: 200, ...(isCompact ? { opacity: 0 } : {}) } : false}
          animate={{ y: 0, opacity: 1 }}
          transition={shouldAnimateFirstPromptEntrance
            ? { duration: 0.5, ease: [0.2, 0, 0, 1] }
            : undefined}
          onAnimationComplete={() => {
            if (isFirstTurnEntranceActive) setIsFirstTurnEntranceActive(false);
          }}
          /*
           * A 24px inset while a resource is open puts the prose's first content at
           * 104 in a 1536 viewport, which is where Gemini's `.conversation-container`
           * starts (measured; Willow's own is 80 without it). With the base `pl-7`
           * that is 28 + 24, and the content box is the same 397px it was when this
           * was written as `pl-[52px]`.
           *
           * The inset is applied HERE rather than on the grid, and that is the whole
           * point. Gemini gets its 24px by insetting the grid, but the panel lives in
           * that same grid, so every attempt to move it dragged the panel too —
           * first overflowing the shell horizontally, then collapsing the panel to
           * 2px wide. An inset on this column cannot do either: it changes no track
           * sizing and the panel's right edge does not move. Willow's right edge
           * already agrees with Gemini's to within a pixel anyway (its 15px scrollbar
           * gutter plus the panel's 32px margin comes to Gemini's 48px inset), so
           * left is the only side that was ever wrong.
           *
           * The cost, accepted deliberately: the column becomes asymmetric (52 left,
           * 28 right) and ~11px narrower than Gemini's 414.66, where Gemini keeps
           * symmetry by shifting the whole column instead.
           *
           * IT IS A TRANSPARENT BORDER AND NOT PADDING, AND THAT IS LOAD-BEARING.
           *
           * `transition-[padding-left]` below belongs to the thinking/sources
           * sidebar, which eases `pl-7 -> pl-9` alongside its 300ms width animation.
           * It is present in the CLOSED state — it has to be, or closing that sidebar
           * would snap. But "resource closed" and "sidebar closed" are the same
           * state, so a transition that is mounted for one is mounted for the other,
           * and while this inset was padding the resource close changed padding-left
           * from 52 to 28 with that transition live. Measured against the compiled
           * CSS (scrapers/canvas/41-css-mechanism.cjs): closing stepped
           * 52 -> 38.77 -> 36.30 -> ... -> 28 over 270ms while opening snapped, which
           * is the open/close asymmetry that was reported. Padding-left is the text
           * measure, so that re-wrapped every line of every reply on every frame for
           * 300ms, on top of the column's own slide — the same "animating text
           * reflow" defect that removing the grid's `grid-template-columns`
           * transition fixed. Layout events ran 9-15 per 50ms for exactly that
           * window and fell to the sampler's floor of 3 the moment it ended.
           *
           * A border-left is the same geometry and the same box model, but it is not
           * named by `transition-property`, so it snaps in both directions no matter
           * which state the transition is mounted in. Moving this back to padding
           * reintroduces the stutter; changing it to margin or transform does not
           * work either (margin fights `mx-auto`, transform makes this a containing
           * block for any fixed-position descendant).
           */
          /*
           * At <=960px Gemini insets the thread by max(24px, (width - 708px) / 2):
           * 24 on a phone, a centred 708 column on a tablet. A 756 cap with 24px of
           * padding is that formula. The first bubble lands at 92: header 68, its
           * scroller's 16px padding and the query's own 8.
           */
          className={`mx-auto flex w-full max-w-[760px] max-[960px]:max-w-[756px] flex-col border-l-transparent px-6 min-[961px]:px-7 pt-[92px] min-[961px]:pt-[72px] pb-[20px] ${
            splitThread
              ? 'min-[960px]:border-l-[24px]'
              : 'transition-[padding-left] duration-300 ease-[cubic-bezier(0.2,0,0,1)]'
          } ${contextSidebarOpen ? 'min-[1024px]:pl-9' : ''}`}
        >
          {visibleMessages.map((msg, visibleIndex) => {
            // Index into the FULL array, not the slice. Reading `gapBefore` off
            // the slice would make slice-index 0 take the `messageIndex === 0`
            // branch below and lose its 52px top gap, so every revealed chunk
            // would shift the thread by 52px.
            const messageIndex = revealOffset + visibleIndex;
            const previousMessage = messages[messageIndex - 1];
            // Every message boundary is MESSAGE_GAP. Gemini's scroller applies
            // its 52px row-gap to each `.conversation-container` uniformly, and
            // once both real turn boundaries moved to 52 a same-role run left at
            // THREAD_GAP was the only 32 left in the thread -- visibly tighter
            // than every other gap around it. Same-role runs are reachable
            // (a split/live turn, or a reload where the contentless message
            // between two turns was dropped by hasSavedMessageContent), so they
            // have to match. THREAD_GAP now covers the incognito banner only.
            // On desktop TURN_GAP is that same 52; at <=960px it is Gemini's wider
            // gap between turns (see the geometry constants).
            const gapBefore = messageIndex === 0
              ? (isIncognito ? THREAD_GAP : 0)
              : previousMessage?.role === 'user' && msg.role === 'assistant'
                ? (editingUserId === previousMessage.id ? 0 : MESSAGE_GAP)
                : TURN_GAP;

            if (msg.role === 'user') {
              const isLastUser = msg.id === lastUserMessageId;
              return (
                <div
                  key={msg.id}
                  ref={(el) => { messageRefs.current[msg.id] = el; }}
                  className="group relative flex justify-end"
                  style={{ marginTop: gapBefore, scrollMarginTop: TARGET_VISUAL_OFFSET }}
                >
                  {editingUserId === msg.id ? (
                    <form
                      className="w-full max-w-[508px] pb-3 font-['Google_Sans_Flex','Google_Sans_Text','Google_Sans',sans-serif]"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitEdit(msg.id);
                      }}
                    >
                      {!!msg.attachments?.length && (
                        <div className="mb-2 flex w-full max-w-[516px] flex-nowrap justify-end gap-2 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          {msg.attachments.map((attachment) => (
                            <GeminiAttachmentCard
                              key={attachment.id}
                              attachment={attachment}
                              variant="message"
                              previewing={sentImagePreview?.id === attachment.id}
                              onOpen={() => { void handleOpenAttachment(attachment); }}
                            />
                          ))}
                        </div>
                      )}
                      <div className={`relative ml-4 mr-2 rounded-[40px] px-7 py-5 ${isLight ? 'bg-[#f2f0f0]' : ''}`}>
                        <div
                          aria-hidden="true"
                          className={`pointer-events-none absolute inset-0 rounded-[40px] border-[0.8px] ${
                            isLight ? 'border-[color:var(--sync-0b57d0,#0b57d0)]' : 'border-[color:var(--sync-1f3b9b,#1f3b9b)]'
                          }`}
                        />
                        <textarea
                          ref={editTextareaRef}
                          autoFocus
                          value={editDraft}
                          onChange={(event) => setEditDraft(event.target.value)}
                          rows={1}
                          maxLength={1000000}
                          enterKeyHint="send"
                          className={`relative z-10 block min-h-6 max-h-72 w-full resize-none overflow-y-auto bg-transparent p-0 font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif] text-[17px] font-normal leading-6 outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                            isLight ? 'text-[#1f1f1f] caret-[color:var(--sync-0b57d0,#0b57d0)]' : 'text-[#e6e6e6] caret-[#e6e6e6]'
                          }`}
                          style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
                          aria-label="Edit prompt"
                        />
                      </div>
                      <div className="mt-4 flex h-12 justify-end">
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className={`relative mx-1 flex h-12 min-w-[72px] items-center justify-center overflow-hidden rounded-full px-4 text-[14px] font-medium ${
                            isLight
                              ? 'text-[#1f1f1f] hover:bg-black/5 before:bg-black focus-visible:ring-black/25'
                              : 'text-[#e6e6e6] before:bg-[#e6e6e6] focus-visible:ring-white/25'
                          } before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:opacity-0 before:transition-opacity hover:before:opacity-[0.08] focus-visible:outline-none focus-visible:ring-2`}
                        >
                          <span className="relative z-10">Cancel</span>
                        </button>
                        <button
                          type="submit"
                          disabled={!editDraft.trim() || editDraft === msg.content || isGenerating}
                          className={`relative ml-1 flex h-12 items-center justify-center overflow-hidden rounded-full px-4 text-[14px] font-medium ${
                            isLight
                              ? 'bg-[color:var(--sync-0b57d0,#0b57d0)] text-white hover:bg-[color:var(--sync-0842a0,#0842a0)] before:bg-white focus-visible:ring-black/25 disabled:bg-[rgba(31,31,31,0.12)] disabled:text-[rgba(31,31,31,0.38)]'
                              : 'bg-[color:var(--sync-1f3b9b,#1f3b9b)] text-[#e6e6e6] before:bg-[#e6e6e6] focus-visible:ring-white/25 disabled:bg-[rgba(230,230,230,0.12)] disabled:text-[rgba(230,230,230,0.38)]'
                          } before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:opacity-0 before:transition-opacity hover:before:opacity-[0.08] focus-visible:outline-none focus-visible:ring-2 disabled:cursor-default disabled:before:opacity-0`}
                        >
                          <span className="relative z-10">Update</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    /*
                     * <=960px: Gemini's `.query-content` keeps the bubble 52px off the
                     * column's left edge and 8px off its right, so the bubble (508px at
                     * most) grows with the screen until that cap.
                     */
                    <div className="flex min-w-0 w-full max-[960px]:pl-[52px] max-[960px]:pr-2 min-[961px]:w-auto min-[961px]:max-w-[516px] flex-col items-end">
                      {!!msg.attachments?.length && (
                        <div className={`flex w-full max-w-[516px] flex-nowrap justify-end gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${msg.content || msg.isTranscribing ? 'mb-2' : ''}`}>
                          {msg.attachments.map((attachment) => (
                            <GeminiAttachmentCard
                              key={attachment.id}
                              attachment={attachment}
                              variant="message"
                              previewing={sentImagePreview?.id === attachment.id}
                              onOpen={() => { void handleOpenAttachment(attachment); }}
                            />
                          ))}
                        </div>
                      )}
                      {(msg.content || msg.isTranscribing) && (
                        <UserMessageBubble
                          content={msg.content}
                          isTranscribing={msg.isTranscribing}
                          onToggleStart={handleUserBubbleToggleStart}
                          onToggleEnd={handleUserBubbleToggleEnd}
                        />
                      )}
                      {!msg.isTranscribing && !!msg.content && (
                        <>
                          <div
                            aria-hidden="true"
                            className="pointer-events-auto absolute inset-x-0 top-full z-0 bg-transparent"
                            style={{ height: MESSAGE_GAP }}
                          />
                          {/*
                            * Hover only, plus keyboard focus — see the
                            * `.gemini-user-actions:has(:focus-visible)` rule in
                            * `apps/studio/index.html`.
                            *
                            * This row used to carry `group-focus-within:`, which
                            * matches plain `:focus`. Clicking a <button> focuses
                            * it, so pressing Copy pinned the row open until the
                            * user clicked somewhere else — the row is meant to
                            * track the pointer and stopped doing that the moment
                            * it was used. `:focus-visible` keeps the reason the
                            * focus variant was here (tabbing to a button inside
                            * an `opacity-0` row has to reveal it) without a mouse
                            * click ever latching it, because a clicked button
                            * does not match `:focus-visible`.
                            *
                            * It lives in CSS rather than as an arbitrary Tailwind
                            * variant because this class already has hand-written
                            * rules there, and keyboard reveal must not depend on
                            * the CDN JIT emitting a `:has()` selector.
                            */}
                          <div className="gemini-user-actions pointer-events-none absolute right-3 max-[960px]:right-5 top-full z-10 mt-1 flex h-9 items-start opacity-0 transition-opacity duration-[250ms] group-hover:pointer-events-auto group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => handleCopyPrompt(msg)}
                              className={`relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full ${
                                isLight
                                  ? 'bg-white/80 text-[#1f1f1f] shadow-sm border border-black/5 hover:bg-white focus-visible:ring-black/25'
                                  : 'bg-[rgba(31,31,31,0.34)] text-[#e6e6e6] focus-visible:ring-white/25'
                              } backdrop-blur-[14px] before:pointer-events-none before:absolute before:inset-0 before:rounded-full ${
                                isLight ? 'before:bg-[#000000]' : 'before:bg-[#e0e0e0]'
                              } before:opacity-0 before:transition-opacity hover:before:opacity-10 focus-visible:outline-none focus-visible:ring-2`}
                              aria-label="Copy prompt"
                              title="Copy prompt"
                            >
                              <MaterialSymbol
                                family="luminous"
                                name="copy"
                                size={20}
                                weight={320}
                                roundness={100}
                                opticalSize={20}
                                className="relative z-10"
                              />
                            </button>
                            {isLastUser && !!msg.content && (
                              <button
                                type="button"
                                onClick={() => startEditing(msg)}
                                className={`relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full ${
                                  isLight
                                    ? 'bg-white/80 text-[#1f1f1f] shadow-sm border border-black/5 hover:bg-white focus-visible:ring-black/25'
                                    : 'bg-[rgba(31,31,31,0.34)] text-[#e6e6e6] focus-visible:ring-white/25'
                                } backdrop-blur-[14px] before:pointer-events-none before:absolute before:inset-0 before:rounded-full ${
                                  isLight ? 'before:bg-[#000000]' : 'before:bg-[#e0e0e0]'
                                } before:opacity-0 before:transition-opacity hover:before:opacity-10 focus-visible:outline-none focus-visible:ring-2`}
                                aria-label="Edit"
                                title="Edit"
                              >
                                <MaterialSymbol family="luminous" name="edit" size={20} weight={320} roundness={100} opticalSize={20} className="relative z-10" />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            }

            // Assistant — single persistent element across thinking → streaming → done.
            const generating = !!msg.isGenerating;
            // While generating, body comes from the live `streaming` buffer; once
            // finalised, `msg.content` holds the full text. Using `||` (not a
            // ternary) means the instant generation flips off we keep rendering
            // the same string, so StreamingMarkdown's pending reveal queue can
            // finish draining without a content swap.
            // `streaming` is a single thread-wide buffer belonging to whichever
            // turn is generating now, so a finished turn must never fall back to
            // it. A turn stopped before its first token has empty content, and
            // the old fallback to `streaming` here made such a turn mirror the
            // NEXT turn's text as soon as that began streaming.
            const bodyText = generating ? streaming : msg.content;
            // A seeded chat's reply reveals as a streamed one does (see `seedRevealId`).
            const playsSeed = seedRevealId === msg.id && !!msg.isNew;
            const responseRevealPending = revealingResponseId === msg.id;
            const actionsReady =
              !generating &&
              !responseRevealPending &&
              (!msg.isNew || !bodyText || responseRevealComplete[msg.id] === true);
            // Live turns: no "Thinking" shimmer, no "Thought for Xs" — the
            // voice starts near-instantly so the row is noise.
            // A finished image or track stands in for the row while the model
            // closes the turn, as Gemini's does — not bare dots above it.
            const mediaSettled = !!msg.media?.length && msg.media.every((item) => item.status !== 'generating');
            const showThinkingRow =
              !msg.isError &&
              !msg.isLive &&
              generating &&
              !mediaSettled &&
              bodyText.trim().length === 0;
            /*
             * A generated image sits where its call happened, as a Canvas card does: what the
             * model wrote before the call is above it, what it wrote after is under it.
             * `index` is the reply's length when the call ran, snapped forward to a line
             * break. An image with nothing written after it, and every video and track, stay
             * after the text — Gemini's "Your video is ready!" and a track's introduction
             * sit above their players.
             */
            const inlineMedia: { at: number; items: GeneratedMedia[] }[] = [];
            for (const item of msg.media ?? []) {
              if (item.kind !== 'image' || !bodyText) continue;
              const at = canvasSplitOffset(bodyText, item.index);
              if (!bodyText.slice(at).trim()) continue;
              const group = inlineMedia.find((candidate) => candidate.at === at);
              if (group) group.items.push(item);
              else inlineMedia.push({ at, items: [item] });
            }
            const trailingMedia = (msg.media ?? []).filter((item) => !inlineMedia.some((group) => group.items.includes(item)));
            const mediaCard = (item: GeneratedMedia) => (
              <GeneratedMediaCard
                key={item.id}
                item={item}
                onEditImage={(image, instruction) => {
                  void handleSend(
                    instruction,
                    undefined,
                    image.attachment ? [image.attachment] : [],
                    'images',
                    image.aspectRatio ? { aspectRatio: image.aspectRatio } : undefined,
                  );
                }}
              />
            );
            const isLastAssistant = msg.id === lastAssistantId;
            const isLatestCompletedTurn = !generating && msg.id === latestConversationMessageId;

            // Containment is suppressed for the whole thread while a turn is in
            // flight, not just on the generating message.
            //
            // Two measured facts make the send path hostile to flipping this on: applying `content-visibility` to an already-laid-out element makes
            // the FIRST layout after the flip report its intrinsic size, not its
            // real one (measured: 1152px -> 240px, recovering the next frame);
            // and a send is exactly when the previous reply stops being
            // `isLastAssistant`, so it would gain containment at the same moment
            // the entrance animation measures `offsetTop` to size its glide. Any
            // error there lands straight in `entranceOffset`, which is why a
            // stale height showed up as "starts partway up", "far too fast", and
            // at the extreme "teleports" — all one bug.
            //
            // The panel toggle this optimisation exists for happens when the
            // thread is idle, so nothing is given up by standing down here.
            //
            // A TURN HOLDING A CANVAS CARD IS EXCLUDED OUTRIGHT, and that is the
            // reported "why does the left side and right side of it disappear".
            // `content-visibility` implies paint containment, which clips to this
            // element's padding box; the expanded card deliberately bleeds 122.8px
            // past the column on each side, and the compensation below is 16px —
            // enough for a code block, ~107px short for this. The card came back
            // from the clip with its text cut mid-word and its 40px corners
            // chiselled square. Widening the compensation to the canvas bleed was
            // the alternative and it is worse: it would move the padding box of
            // every assistant turn, and every cached intrinsic height with it.
            // A turn with a document in it is one the user is reading, so the
            // layout skip is the cheaper thing to give up.
            const skip = messageSkipStyle(
              msg.id,
              !isLastAssistant && !generating && !isGenerating && !canvasCardMessageIds.has(msg.id),
            );

            return (
              <div
                key={msg.id}
                ref={(el) => { messageRefs.current[msg.id] = el; }}
                className="group/assistant-response"
                style={{
                  marginTop: gapBefore,
                  // Skip layout while scrolled out of view. Excluded: the last
                  // assistant turn (it carries the response reserve and is
                  // re-measured every streaming frame) and anything generating.
                  // `content-visibility` also implies paint containment, which
                  // is why this is on assistant turns only — a user bubble's
                  // hover actions are positioned at `top-full`, outside its box,
                  // and would be clipped.
                  ...skip,
                  // Paint containment clips to THIS element's padding box, and
                  // `.smd-code-block` deliberately bleeds MARKDOWN_BLOCK_BLEED_PX
                  // past the column on each side. Without this the clip cut
                  // through the widest part of its 40px radius and the block read
                  // as having chiselled-flat sides. The padding and the negative
                  // margin cancel, so the content box — and therefore the text
                  // measure and every height already cached — is unchanged; only
                  // the clip rectangle grows. Applied only alongside the skip, so
                  // a turn without containment keeps exactly its old box.
                  ...(skip.contentVisibility
                    ? {
                        paddingInline: MARKDOWN_BLOCK_BLEED_PX,
                        marginInline: -MARKDOWN_BLOCK_BLEED_PX,
                      }
                    : {}),
                  ...(isLastAssistant && responseAreaMinHeight !== undefined
                    ? {
                        // Reserve exactly the visible area below the user bubble.
                        minHeight: !needsScrollPadding
                          ? responseAreaMinHeight
                          : undefined,
                      }
                    : {}),
                }}
              >
                {/* Inner wrapper = pure content height, unaffected by the outer
                    minHeight/paddingBottom. Measured for the overflow check —
                    and for the intrinsic size, which MUST be read here rather
                    than off the outer box. The outer box of the last assistant
                    turn carries the response reserve (`responseAreaMinHeight`),
                    so measuring it cached "content + reserve". The instant a send
                    made that turn no longer last it lost the reserve and gained
                    containment carrying that inflated number as its intrinsic
                    size, which inflates `offsetTop` for everything below and
                    drives the entrance animation's `entranceOffset` negative —
                    sending it down the scrollIntoView path instead of gliding.
                    Worst after a SHORT reply, where nearly all of the cached
                    height was reserve. This wrapper never holds the reserve, so
                    its height is what the outer box really becomes once the turn
                    stops being last. */}
                <div
                  ref={(el) => {
                    // The old `isLastAssistant ? ref : undefined` form let React
                    // null this out on its own when a turn stopped being last.
                    // A single callback has to do that by hand, or the overflow
                    // check keeps measuring the previous turn forever. Sibling
                    // refs run in tree order, so this clears before the new last
                    // turn sets itself.
                    if (isLastAssistant) lastAssistantContentRef.current = el;
                    else if (lastAssistantContentRef.current === el) lastAssistantContentRef.current = null;
                    measureMessageRef(msg.id)(el);
                  }}
                  className={`w-full space-y-3 ${splitThread ? 'ml-auto max-w-[476px]' : ''}`}
                >
                {/* Code-execution toggle. Gemini puts this in the response
                    header, right-aligned above the body, and it appears only
                    once the thinking dots give way to output — never alongside
                    them — which is what `!showThinkingRow` encodes.

                    20px to whatever paints underneath, measured off the live app
                    in both states (it splits there as 4px + 16px). Set as a
                    bottom margin so it collapses against the wrapper's 12px
                    `space-y-3` rhythm to exactly 20 rather than adding to it. */}
                {!!msg.codeExecutions?.length && !showThinkingRow && (
                  <div style={{ marginBottom: 20 }}>
                    <ShowCodeToggle
                      open={!!codeShown[msg.id]}
                      onToggle={() => setCodeShown((current) => ({
                        ...current,
                        [msg.id]: !current[msg.id],
                      }))}
                    />
                  </div>
                )}

                {showThinkingRow && !isFirstTurnEntranceActive && (() => {
                  const active = generating && isThinking;
                  /* `executing` is the code sandbox and nothing else. A Canvas or
                     personalization call runs on `tooling`, which has no
                     app-written label — claiming "Running code" for a document
                     write is simply false, and Gemini's own label for a custom
                     tool was never captured. */
                  const mediaStatus = generatingStatusFor(msg.media)
                    ?? (msg.research?.status === 'planning' ? 'Generating research plan' : null);
                  // A connected app's tool running: Gemini's "Connecting to <logo> <app>".
                  const app = active && isLastAssistant ? chatApp(connectingApp) : null;
                  const statusHeading = mediaStatus ?? (app ? connectingHeading(app.label) : null) ?? (active
                    ? thinkingPhase === 'searching' ? 'Searching the web'
                      : thinkingPhase === 'executing' ? 'Running code'
                      : null
                    : null);
                  /* `tooling` reads the heading too, so the row holds the last
                     thought heading while the tool runs rather than falling back
                     to bare dots for the seconds a document takes to write. */
                  const thoughtHeading = active && (thinkingPhase === 'thinking' || thinkingPhase === 'tooling')
                    ? latestThoughtHeading(msg.thinkingText || '')
                    : null;
                  // Gemini replaces the label with the newest section heading of
                  // its own thought stream. Only a stream that actually arrives
                  // sectioned can do that, so a provider emitting bare prose
                  // (Grok, Claude — measured) keeps the shimmering label.
                  // Tool states use the same animated status channel in Gemini;
                  // they are app-generated labels, not model-written thoughts.
                  const summaryHeading = statusHeading ?? thoughtHeading;
                  // Gemini shows no generic label at any point: its row is the
                  // dots alone until the first heading arrives, then the heading.
                  // Keyed off the turn's own recorded provider rather than off
                  // "no heading yet", because those two differ precisely in the
                  // window this controls — a Gemini stream that has not emitted
                  // its first heading is indistinguishable from a Grok one.
                  // Scoped to the thinking phase: tool states have their own
                  // animated headings and therefore never reach this fallback.
                  const suppressLabel =
                    msg.modelSnapshot?.provider === 'gemini' && thinkingPhase === 'thinking';
                  return (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                      // The video status runs to two lines; Gemini keeps the dots on the first.
                      className={`flex ${mediaStatus ? 'items-start' : 'items-center'}`}
                      style={{
                        color: '#81888f',
                        // Gemini's row: 12px (--gem-sys-spacing--m) after the
                        // dots, 24px min-height (body-l line-height). Its dots
                        // sit at x=550 and its text at x=586 — a 36px delta that
                        // is 24px of dots plus that 12px.
                        gap: summaryHeading ? '12px' : '10px',
                        // Held for the whole Gemini row, not just once a heading
                        // exists, so the dots do not shift when one arrives.
                        minHeight: summaryHeading || suppressLabel ? 24 : undefined,
                        // On a desktop Gemini's row drops 4px once it carries a
                        // heading (192 against the bare dots' 188, under the same
                        // bubble). At 960 and below this row already lands where
                        // Gemini's heading row does.
                        marginTop: summaryHeading && !isCompact ? 4 : undefined,
                      }}
                    >
                      <GeminiThinkingVisualizer />
                      {summaryHeading ? (
                        <ThoughtSummaryLine
                          // Tool statuses are app-owned priority messages. A
                          // separate key lets them take over immediately,
                          // without waiting for the thought-heading hold, and
                          // lets the latest thought resume immediately when
                          // the tool finishes.
                          key={statusHeading ? `status:${statusHeading}` : 'thought-summary'}
                          app={app ?? undefined}
                          heading={summaryHeading}
                        />
                      ) : suppressLabel ? null : active ? (
                        <TextShimmer className="text-[15.15px] font-medium" duration={1.5}>
                          Thinking
                        </TextShimmer>
                      ) : (
                        <span className="text-[15.15px] font-medium">Thinking</span>
                      )}
                    </motion.div>
                  );
                })()}

                {/* Code-execution panels, in emission order.
                    `display: contents` so the wrapper generates no box: the
                    turn's `space-y-3` targets IT rather than the panels, which
                    means a collapsed panel (display:none) contributes no phantom
                    gap and the toggle's own 20px margin reaches the panel
                    directly.

                    They render as a group here rather than being spliced into
                    `bodyText` at each `position`. For a Gemini turn those
                    offsets are all 0 (the code parts precede the answer text),
                    so this is the same result; a turn that wrote prose, ran
                    code, then continued would show its panels above the prose.
                    Splicing would mean slicing the body into several
                    StreamingMarkdown instances, which would misalign citation
                    offsets — the offsets are kept on disk so true interleaving
                    can be added later without a data migration. */}
                {!!msg.codeExecutions?.length && (
                  <div className="contents">
                    {[...msg.codeExecutions]
                      .sort((a, b) => a.position - b.position)
                      .map((execution, index) => (
                        <CodeExecutionPanel
                          key={`${msg.id}:${index}`}
                          language={execution.language}
                          code={execution.code}
                          output={execution.output}
                          open={!!codeShown[msg.id]}
                        />
                      ))}
                  </div>
                )}

                {/* Body text and Canvas cards, INTERLEAVED.
                    A card renders where the model put it — at the character offset
                    the runtime captured when the tool call ran — so a turn that
                    writes two paragraphs, a document, then a closing line shows
                    exactly that. Appending them all after the body was the old
                    behaviour and the user filed it: "it should appear in whichever
                    paragraph the ai puts it in… instead of making it appear at the
                    end."

                    THE SPLIT IS ONLY TAKEN ON A SETTLED TURN. Slicing `bodyText`
                    into several StreamingMarkdown instances mid-reveal would restart
                    the reveal state machine per slice and the offsets move on every
                    token, so while generating (or while a fresh reply is still
                    revealing) this falls back to one body followed by the cards, and
                    they slot into place on the frame the turn settles.

                    Citations are re-based per slice: their indices are offsets into
                    the turn's text, so a slice starting at 400 needs every chip
                    moved back 400. `canvasSliceCitations` keeps the WHOLE `sources`
                    array on each slice — `sourceIndices` index into it, so trimming
                    it would repoint every chip in the turn. */}
                {(() => {
                  const refs = msg.canvasRefs || [];
                  /*
                   * A card is skipped entirely while its own document is open in the
                   * panel: the panel and the card are two views of one document, and
                   * showing both is what the user filed as "the preview appears in the
                   * sidebar and also within the response… this is a serious bug",
                   * along with "the canvas card should not even appear when it is in
                   * the sidebar". `handleOpenCanvas` clears the stale expanded flag a
                   * previous collapse left behind; this hides the chip as well, so the
                   * open document has exactly one view on screen.
                   */
                  const visible = refs
                    .map((ref, refIndex) => ({ ref, refIndex }))
                    /*
                     * ONE CARD PER DOCUMENT, at the turn that first wrote it.
                     *
                     * Gemini appends a chip per turn — a 2-document / 7-edit thread
                     * held nine — and copying that is what the user filed: "every
                     * time it makes the code changes, I notice that the document
                     * reappears, but it should not… it should just change in the
                     * first place where it appeared". So a revision has no card of
                     * its own; the document's one card shows the current text (see
                     * `version` below), and only a NEW document adds a card.
                     *
                     * Keeping the card where the document STARTED is what makes an
                     * expanded card survive a revision: the expanded set is keyed
                     * `messageId:docId`, so a card that moved to the newest turn
                     * would be a different key and would collapse on every edit.
                     */
                    .filter(({ ref, refIndex }) => {
                      const home = canvasCardHomes.get(ref.docId);
                      return !!home && home.messageId === msg.id && home.refIndex === refIndex;
                    })
                    .filter((entry) => !openCanvas || entry.ref.docId !== openCanvas.docId);
                  /* Gemini appends a chip per TURN. Willow appends one per DOCUMENT —
                     see the filter above for why. */
                  const renderCard = (entry: { ref: CanvasRef; refIndex: number }) => {
                    const { ref } = entry;
                    const doc = canvasDocsInChat.get(ref.docId);
                    if (!doc) return null;
                    /*
                     * The CURRENT text, not the text this turn wrote.
                     *
                     * One card per document means the card is a live view of it, so a
                     * revision changes what the existing card shows instead of adding
                     * a second one. The card's own Undo/Redo still walks the whole
                     * history from here — see `CanvasCard`, which re-seeds its local
                     * index whenever this prop moves.
                     */
                    const version = doc.versions.length - 1;
                    const cardKey = canvasCardKey(msg.id, ref.docId);
                    return (
                      <CanvasCard
                        key={cardKey}
                        doc={doc}
                        version={version}
                        expanded={expandedCanvasCards.has(cardKey)}
                        onToggleExpanded={() => toggleCanvasCard(msg.id, ref.docId)}
                        onOpen={() => handleOpenCanvas(ref.docId, version)}
                        /* Read-only while a turn is in flight — see `canvasEdit`. */
                        onEditContent={
                          canvasEdit ? (content: string) => canvasEdit(ref.docId, content) : undefined
                        }
                        onPrompt={(text: string) => { void handleSend(text, undefined, [], 'canvas'); }}
                        /* The overhang is only safe in a full-width thread. With a
                         * panel open the column is 476px, so a 949px card would switch
                         * on horizontal scrolling across the shell — the exact failure
                         * that broke the grid twice. */
                        bleed={!splitThread}
                      />
                    );
                  };
                  /*
                   * WHERE THE CARD SITS, WHILE THE TURN IS STILL WRITING.
                   *
                   * The card belongs at the offset the tool call happened at, and it
                   * used to get there only once the turn settled: "while generating
                   * response, it would generate the first paragraph normally and the
                   * canvas would appear but for the last paragraph it would start
                   * appearing above the canvas shifting it down and once response
                   * generation is done, the third paragraph moves below the canvas".
                   * One split, deferred, and the card visibly jumped at the end.
                   *
                   * It can be done live because `ref.index` is captured when the call
                   * runs and never moves afterwards, so the only thing that shifts is
                   * where `canvasSplitOffset` snaps it to — forward to the next line
                   * break, or past an unclosed fence. Both resolve as soon as the text
                   * that resolves them arrives, and then stay put. The reveal survives
                   * it because only the LAST slice streams: the head is text that has
                   * already been revealed, so it renders settled and looks identical,
                   * and the tail is a token or two old at the moment of the split.
                   *
                   * The live guard is that a split needs SOMETHING under it. A cut the
                   * snap clamped to the end of the text is a card at the end, which the
                   * unsplit branch below already draws — and splitting there would hand
                   * the streaming instance an empty tail, which is worse than cosmetic:
                   * `onRevealComplete` lives on that instance, and it is what clears
                   * `revealingResponseId` and lets `actionsReady` ever become true.
                   */
                  /* An image with text after it is a cut too (`inlineMedia`); one at the end of
                     the reply is drawn after it, below. */
                  type Cut =
                    | { at: number; entry: { ref: CanvasRef; refIndex: number }; media?: undefined }
                    | { at: number; media: GeneratedMedia[]; entry?: undefined };
                  const cuts = bodyText
                    ? [
                      ...visible
                        .map((entry): Cut => ({ entry, at: canvasSplitOffset(bodyText, entry.ref.index) }))
                        .filter(({ at }) => actionsReady || bodyText.slice(at).trim().length > 0),
                      ...inlineMedia.map((group): Cut => ({ media: group.items, at: group.at })),
                    ].sort((a, b) => a.at - b.at)
                    : [];

                  if (!cuts.length) {
                    return (
                      <>
                        {bodyText && (
                          <StreamingMarkdown
                            text={bodyText}
                            isStreaming={generating}
                            animate={generating || playsSeed || (!!msg.isError && !!msg.isNew)}
                            reveal={generating || playsSeed || (!!msg.isError && !!msg.isNew)}
                            revealAsSingleChunk={!!msg.isError && !!msg.isNew}
                            onRevealComplete={() => {
                              setResponseRevealComplete((current) => (
                                current[msg.id] === true
                                  ? current
                                  : { ...current, [msg.id]: true }
                              ));
                              setRevealingResponseId((current) => (
                                current === msg.id ? null : current
                              ));
                            }}
                            onOpenResource={handleOpenResource}
                            citations={msg.citations}
                          />
                        )}
                        {visible.length > 0 && (
                          <div className="space-y-3">{visible.map(renderCard)}</div>
                        )}
                      </>
                    );
                  }
                  /* One `space-y-3` wrapper around the whole sequence rather than
                     letting the slices be direct children of the turn: the turn's own
                     `space-y-3` would then put its 12px between a paragraph and the
                     card that follows it, which is the same 12px — but the wrapper
                     keeps the turn's child count stable whether or not a card is
                     present, and the reveal/entrance code above reads that tree. */
                  const blocks: React.ReactNode[] = [];
                  let cursor = 0;
                  let afterMedia = false;
                  /*
                   * `live` marks the one slice that is still being written — the tail.
                   * It carries every streaming prop the unsplit branch above uses,
                   * including `onRevealComplete`, and the head slices carry none: text
                   * that has already been revealed must not re-animate when a card
                   * lands in front of it.
                   */
                  const slice = (start: number, end: number, live: boolean) => {
                    const text = bodyText.slice(start, end);
                    if (!text.trim()) return;
                    const streaming = live && generating;
                    // Text under an image keeps the 16px an image keeps under text.
                    const underImage = afterMedia;
                    afterMedia = false;
                    const push = (body: React.ReactElement) => blocks.push(
                      underImage ? <div key={`body-${start}`} style={{ marginTop: 16 }}>{body}</div> : body,
                    );
                    push(
                      <StreamingMarkdown
                        key={`body-${start}`}
                        text={text}
                        isStreaming={streaming}
                        animate={streaming || (!!msg.isError && !!msg.isNew)}
                        reveal={streaming || (!!msg.isError && !!msg.isNew)}
                        revealAsSingleChunk={!!msg.isError && !!msg.isNew}
                        onRevealComplete={() => {
                          setResponseRevealComplete((current) => (
                            current[msg.id] === true
                              ? current
                              : { ...current, [msg.id]: true }
                          ));
                          setRevealingResponseId((current) => (
                            current === msg.id ? null : current
                          ));
                        }}
                        onOpenResource={handleOpenResource}
                        citations={canvasSliceCitations(msg.citations, start, end)}
                      />,
                    );
                  };
                  cuts.forEach((cut) => {
                    const end = Math.max(cursor, Math.min(cut.at, bodyText.length));
                    slice(cursor, end, false);
                    cursor = end;
                    if (cut.media !== undefined) {
                      // 16px under the text or the status row above it, as after the body.
                      blocks.push(
                        <div
                          key={`media-${cut.media[0]!.id}`}
                          className="flex flex-col gap-2"
                          style={{ marginTop: blocks.length || showThinkingRow ? 16 : 0 }}
                        >
                          {cut.media.map(mediaCard)}
                        </div>,
                      );
                      afterMedia = true;
                    } else {
                      blocks.push(renderCard(cut.entry));
                      afterMedia = false;
                    }
                  });
                  slice(cursor, bodyText.length, true);
                  /* A card whose cut was held back — the snap has not found a line
                     break after the call yet — still has to be on screen. It goes
                     where it went before any of this: after the body. */
                  const split = new Set(cuts.map(({ entry }) => entry));
                  visible
                    .filter((entry) => !split.has(entry))
                    .forEach((entry) => blocks.push(renderCard(entry)));
                  return <div className="space-y-3">{blocks}</div>;
                })()}

                {/* Generated media, after the text the way Gemini lays it out
                    ("Your video is ready!" above the player). Measured: 16px under
                    the status row or the text, not the turn's 12; and the action
                    row's glyphs 12px under an image or a video, 6px closer than
                    after prose. */}
                {trailingMedia.length > 0 && (
                  <div
                    className="flex flex-col gap-2"
                    style={{ marginBottom: -6, ...(showThinkingRow || bodyText.trim() ? { marginTop: 16 } : {}) }}
                  >
                    {trailingMedia.map(mediaCard)}
                  </div>
                )}

                {/* Deep Research: the plan card 16px under its sentence, or the run's
                    card 12px under "I'm on it" — Gemini's measured margins. */}
                {msg.research && msg.research.status !== 'planning' && (
                  <div style={{ marginTop: msg.research.status === 'plan' ? 16 : 12 }}>
                    {msg.research.status === 'plan' ? (
                      <ResearchPlanCard
                        record={msg.research}
                        busy={isGenerating || researchRunning}
                        onStart={() => startResearchFor(msg.id)}
                        onEdit={editResearchPlan}
                      />
                    ) : (
                      <ResearchCard
                        record={msg.research}
                        selected={openResearchId === msg.id}
                        onOpen={() => {
                          setOpenResource(null);
                          $openCanvas.set(null);
                          setOpenResearchId((id) => (id === msg.id ? null : msg.id));
                        }}
                      />
                    )}
                  </div>
                )}

                {/* A saved scheduled action or skill, under the sentence about it. Measured on
                    Gemini: a scheduled action's card 16px under the text and 20px over the
                    action row's glyphs, a skill's 24px and 28px. Inline, as the research
                    card's is, to beat the turn's own `space-y-3`. */}
                {!!msg.created?.length && (
                  <div
                    className="chat-created-items"
                    style={{
                      marginTop: msg.created[0]!.kind === 'skill' ? 24 : 16,
                      paddingBottom: msg.created[msg.created.length - 1]!.kind === 'skill' ? 16 : 8,
                    }}
                  >
                    {msg.created.map((item) => (
                      <ChatCreatedCard key={item.id} item={item} scopeId={chatScopeId || 'guest'} />
                    ))}
                  </div>
                )}

                {/* Stopped turn: Gemini inserts the notice between the body and
                    the action row. Measured on both stopped turns in the live
                    app: body bottom -> 8px -> 20px notice -> 4px -> 32px button
                    row. (An earlier pass read that last gap as 0 because it
                    measured to `message-actions`, whose own 4px inset sits above
                    the buttons; the notice-to-button distance is 4px.) The
                    notice sits outside the wrapper's space-y-3 rhythm, so both
                    margins are set explicitly. */}
                {msg.wasStopped && actionsReady && (
                  <div style={{ marginTop: 8, marginBottom: 0 }}>
                    <ResponseInfoLine />
                  </div>
                )}

                {/* Action row — fades in only after completion to avoid layout jump */}
                <motion.div
                  initial={false}
                  animate={{
                    height: actionsReady ? 'auto' : 0,
                  }}
                  transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
                  // Gemini leaves 4px between the notice and the button row,
                  // replacing the wrapper's 12px rhythm for this one case. At
                  // <=960px it leaves the same 4px under every response.
                  style={msg.wasStopped || isCompact ? { marginTop: 4 } : undefined}
                  /*
                   * Keep a mouse click off the focus ring.
                   *
                   * On a non-latest turn this row is revealed by hover OR by
                   * `focus-within`, so clicking Like left the button focused and
                   * the row stayed visible after the pointer left — until you
                   * clicked elsewhere. Suppressing mousedown's default action
                   * stops the click focusing anything without touching the click
                   * handlers, so keyboard Tab still focuses and still reveals the
                   * row, which is the whole point of the `focus-within` branch.
                   * Safe here because nothing in this row reads focus: the
                   * overflow menu closes on a document `pointerdown`, not a blur.
                   */
                  onMouseDown={(event) => event.preventDefault()}
                  className={`overflow-visible transition-opacity duration-[240ms] ease-[cubic-bezier(0.2,0,0,1)] ${
                    !actionsReady
                      ? 'pointer-events-none opacity-0'
                      : isLatestCompletedTurn
                        ? 'opacity-100'
                        : 'pointer-events-none opacity-0 group-hover/assistant-response:pointer-events-auto group-hover/assistant-response:opacity-100 group-focus-within/assistant-response:pointer-events-auto group-focus-within/assistant-response:opacity-100'
                  }`}
                >
                  <ResponseActions
                    reaction={reactions[msg.id] || null}
                    listening={listeningId === msg.id}
                    canRedo={isLastAssistant}
                    canShowThinking={!msg.isError || !!msg.errorDetail}
                    canShowSources={!!msg.citations?.sources?.length}
                    isStopped={!!msg.wasStopped}
                    onLike={() => setReactions((current) => ({
                      ...current,
                      [msg.id]: current[msg.id] === 'like' ? null : 'like',
                    }))}
                    onDislike={() => setReactions((current) => ({
                      ...current,
                      [msg.id]: current[msg.id] === 'dislike' ? null : 'dislike',
                    }))}
                    onRedo={() => handleRegenerate(msg.id)}
                    onCopy={() => handleCopy(msg)}
                    media={(() => {
                      const shared = msg.media?.find((item) => item.status === 'done' && item.attachment?.url);
                      const file = shared?.attachment;
                      return shared && file?.url
                        ? { kind: shared.kind, onShare: () => { void shareMedia(file.url!, file.name, file.mimeType); } }
                        : undefined;
                    })()}
                    onListen={() => handleListen(msg)}
                    onShowThinking={() => handleOpenThinking(msg.id)}
                    onShowSources={() => handleOpenSources(msg.id)}
                    compact={isCompact}
                  />
                </motion.div>
                {/* <=768px Gemini moves "…can make mistakes" from under the composer
                    to 12px under the latest finished response (the wrapper's
                    space-y-3), and drops it from that turn when the next starts. */}
                {isLatestCompletedTurn && actionsReady && (
                  <p
                    className={`hidden max-[768px]:block text-[13px] font-normal leading-[17px] ${isLight ? 'text-[#444746]' : 'text-[#c4c7c5]'} font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif]`}
                    style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
                  >
                    Willow is AI and can make mistakes.
                  </p>
                )}
                </div>
              </div>
            );
          })}
        </motion.div>
        )}
      </div>

      {/* Bottom-docked input (footer). Position relative makes it a sibling in the
          flex column, ensuring the scroller above it terminates correctly instead
          of spanning under it.

          It drops to `static` in the zero state on purpose: the composer inside
          is lifted out of flow and centred on the *chat area*, so it must resolve
          its containing block against the column above, not against this 49px
          strip. Nothing else here needs the positioning context — the orb and the
          settings trigger are `fixed`, and the dialog is a top-layer `<dialog>`. */}
      <div
        ref={footerRef}
        className={`${isThreadDocked ? 'relative' : ''} z-30 flex shrink-0 flex-col items-center`}
      >
        {/* Gemini's native 28px fading gradient overlay that covers the bottom edge of the scroller */}
        {isThreadDocked && !canvasFullWidth && (
          <div
            className="pointer-events-none absolute bottom-full left-0 right-0 h-[28px] w-full"
            style={{
              // At <=960px the page behind the thread is black, not desktop's
              // #0f0f0f, and a #0f0f0f fade showed there as a grey band. The
              // surface variable is whichever of the two is painted.
              background: isCompact
                ? 'linear-gradient(to bottom, transparent 0px, color-mix(in srgb, var(--studio-surface) 50%, transparent) 50%, color-mix(in srgb, var(--studio-surface) 85%, transparent) 75%, color-mix(in srgb, var(--studio-surface) 99%, transparent) 95%, var(--studio-surface) 100%)'
                : isLight
                ? 'linear-gradient(to bottom, transparent 0px, rgba(250,249,249, 0.5) 50%, rgba(250,249,249, 0.85) 75%, rgba(250,249,249, 0.99) 95%, rgba(250,249,249, 1) 100%)'
                : 'linear-gradient(to bottom, transparent 0px, rgba(15,15,15, 0.5) 50%, rgba(15,15,15, 0.85) 75%, rgba(15,15,15, 0.99) 95%, rgba(15,15,15, 1) 100%)',
            }}
          />
        )}
        {/* Voice orb — live sessions only. The focus surface is
            fixed-positioned and owns its own placement, so it sits outside the
            footer's flow. AnimatePresence lets the scale-out exit run before the
            node unmounts. */}
        <AnimatePresence>
          {showVoiceOrb && mainContentRect && (
            <VoiceFocusSurface
              connected={isLiveConnected}
              isUserSpeaking={isUserSpeaking}
              isAssistantSpeaking={isAssistantSpeaking}
              analyser={liveAnalysers.mic}
              assistantAnalyser={liveAnalysers.output}
              mainContentRect={mainContentRect}
              workspaceColor={workspaceColor}
            />
          )}
        </AnimatePresence>
        {/* Voice settings — the trigger rides the same live-session gate as
            the orb, and the panel draws the orb itself, so neither exists
            outside a live session. */}
        {showVoiceOrb && voiceProvider && voiceSelection && (
          <>
            <VoiceSettingsButton
              onClick={() => setIsVoiceSettingsOpen(true)}
              expanded={isVoiceSettingsOpen}
            />
            <VoiceSettingsDialog
              open={isVoiceSettingsOpen}
              onClose={() => setIsVoiceSettingsOpen(false)}
              provider={voiceProvider}
              voice={voiceSelection.voice}
              language={voiceSelection.language}
              onVoiceChange={(voiceId) => setVoice(voiceProvider, voiceId)}
              onLanguageChange={(code) => setLanguage(voiceProvider, code)}
              orbProps={{ workspaceColor }}
            />
          </>
        )}
        {/* Full screen's "Ask Willow" fab. Desktop only: below 960px Gemini's panel covers
            the app and offers no prompt, the back arrow returns to the chat. */}
        {canvasFullWidth && !isCompact && (
          <CanvasPromptFab
            onSend={(text) => { void handleSend(text, undefined, [], 'canvas'); }}
            isGenerating={isGenerating}
            turns={canvasFloatingTurns}
          />
        )}
        {/* The lift. This wrapper owns POSITION ONLY and never a transform:
            Framer's projection writes `transform` on the node below, so putting
            our own translate there would have the two fight and the animation
            jump on frame one.

            Zero state centres the composer on the chat area with `inset-0` +
            `items-center` rather than Gemini's `bottom:50vh; translateY(50%)`.
            The geometry is identical — Gemini's fieldset centre measures exactly
            viewport/2 — but flex centring needs no transform on an ancestor of a
            projection node, and it stays centred as the composer grows instead
            of depending on a frozen half-height. `pointer-events-none` lets the
            recent-chats list underneath stay clickable through the gap. */}
        <div
          ref={composerLayerRef}
          className={isThreadDocked
            ? `w-full flex justify-center px-4 max-[960px]:pt-3 pb-[12px] min-[769px]:pb-[49px] pointer-events-auto ${isLight ? 'bg-[#faf9f9]' : 'bg-[var(--studio-surface,#0f0f0f)]'} transition-[opacity,visibility] duration-500 ease-[cubic-bezier(0.2,0,0,1)] ${
              /* Full screen fades the composer out over 500ms on the fab's own curve
                 (Gemini's `.input-area-container.hide-input`), and back in on collapse. */
              canvasFullWidth ? 'min-[960px]:pointer-events-none min-[960px]:invisible min-[960px]:opacity-0 min-[960px]:!bg-transparent' : ''
            }`
            /* /images: the composer's top is Gemini's — 379 under its 215px hero, 447 on a
               tablet under the 68px bar — and a phone docks it, as the zero state does. */
            : imagesPage
              ? 'absolute inset-0 flex items-start justify-center px-4 pt-[379px] max-[960px]:pt-[447px] max-[600px]:items-end max-[600px]:pt-0 max-[600px]:pb-[12px] pointer-events-none'
              : 'absolute inset-0 flex max-[960px]:items-end items-center justify-center px-4 pb-[12px] min-[769px]:pb-[16px] min-[961px]:pb-0 pointer-events-none'}
        >
          <motion.div
            ref={attachComposerBox}
            layout
            // One node now, so this is `layout` rather than a `layoutId` pair.
            // The old shared-element morph existed only to fake continuity
            // between two composers; with a single persistent node the two
            // measured boxes differ in position and nothing else, so the
            // projection resolves to a pure translate — no scale, so the text,
            // the model pill and the icons no longer squash mid-flight.
            //
            // `layoutDependency` is still required, and for the original reason:
            // `layout` turns the feature on (`motion/features/definitions`:
            // `layout: ["layout", "layoutId"]`) and with it left undefined
            // MeasureLayout hits the `layoutDependency === undefined` branch and
            // snapshots the box on EVERY commit, animating any delta as an
            // inverse scale eased back to identity. That is what made
            // send-from-fullscreen squash: `handleSubmit` calls
            // `setIsComposerMaximized(false)`, so the shell goes from
            // `calc(100dvh - 114px)` to ~64px inside one React commit and Framer
            // animates the whole drop. Same for adding an attachment.
            //
            // Binding it to `isThreadDocked` means the box is re-measured for
            // the one transition that should animate — centre to dock — and for
            // nothing else. It tracks `hasStarted` except that opening a chat
            // docks the composer when the load STARTS rather than when the
            // messages land, so the slide runs once, up front, instead of
            // waiting on disk and then competing with the thread's own reveal.
            layoutDependency={isThreadDocked}
            // The slide is ONE-DIRECTIONAL, because Gemini's is. Recorded at
            // 55fps off the live app across four transitions:
            //
            //   zero -> docked (open a chat, or send): the fieldset animates
            //     `bottom: 50vh -> 0` with `translateY(50%) -> translateY(-50%)`
            //     over 250ms on cubic-bezier(0.2, 0, 0, 1). 14 sampled frames
            //     spanning 253ms, y travelling 380.8 -> 712.6.
            //
            //   docked -> zero (New chat): the fieldset does NOT move. It reads
            //     [582, 380.8, 660, 64] on the first frame of the segment and
            //     on every frame after — position, bottom and transform all
            //     constant. Only the greeting animates, and it does that with
            //     its own `willow-lm-fade-in-up` (which already matches the
            //     captured `lm-fade-in-up`: translateY(40px)->0, opacity 0->1,
            //     300ms, 250ms delay, same curve).
            //
            // So the duration is read off the direction we are travelling.
            // `isThreadDocked` is already false on the render that commits the
            // move back to centre, which makes it snap — exactly Gemini. It must
            // stay paired with `layoutDependency` above; binding one to
            // `hasStarted` and the other to `isThreadDocked` re-introduces the
            // squash, because the box would be re-measured on a commit whose
            // transition says "animate".
            //
            // The boot settle (see `isBootHydrating`) travels the same
            // docked -> zero direction and so lands in the snap branch too. That
            // is deliberate, not an oversight: it is the same visual event New
            // chat is, and the capture above says Gemini does not move the box
            // for it. The motion the eye follows is the greeting's fade-in-up
            // and the glow's grow, both of which start in that same commit.
            transition={{
              layout: isThreadDocked
                ? { duration: 0.25, ease: [0.2, 0, 0, 1] as const }
                : { duration: 0 },
            }}
            className="relative w-full max-[768px]:max-w-full min-[769px]:max-w-[660px] pointer-events-auto"
          >
            {/* The greeting hangs off this box rather than off the page, which
                is what makes it rise as the composer wraps — Gemini's
                `.top-section-container` is `justify-content: flex-end` with a
                height Angular shrinks as the composer grows, and its bottom
                edge measures 380.8 against a composer top of 381. Anchoring to
                the box instead gets the same result with no measurement.

                It is `absolute`, so it stays out of the measured box and the
                centre-to-dock projection remains a pure translate. */}
            {!isThreadDocked && !imagesPage && (
              <PinnedChatGreeting isIncognito={isIncognito} isAuthenticated={isAuthenticated} />
            )}
            <InputBar
              chatVariant
              draftKey={`chat:${chatScopeId}:${activeChatId || 'new'}`}
              workspaceColor={workspaceColor}
              // Zero state has no disclaimer, matching Gemini, which keeps its
              // own in the bottom bar and out of the centred composer. It costs
              // no layout either way — the line is `absolute top-full`.
              showDisclaimer={showComposerDisclaimer}
              docked={isThreadDocked}
              conversation={hasStarted || showBlankThread}
              currentMode="chat"
              onModeChange={() => {}}
              onSubmit={(prompt, _mode, attachments, tool, toolOptions) => {
                // Typing + Enter while live implicitly ends the voice session and
                // falls back to the regular typed path.
                if (isLive) handleStopLive();
                handleSend(prompt, undefined, attachments, tool, toolOptions);
              }}
              liveActive={isLive}
              onStartLive={handleStartLive}
              onStopLive={handleStopLive}
              liveMicMuted={isMicMuted}
              onToggleLiveMicMute={handleToggleMicMute}
              // A research run holds the stop button, as Gemini's does, and stops it.
              isGenerating={isGenerating || researchRunning}
              isResponseRevealing={isResponseRevealing}
              onStopGenerating={handleStopGenerating}
              modelConfig={modelConfig}
              selectedModelId={selectedModelId}
              setSelectedModelId={setSelectedModelId}
              onAuthRequired={onAuthRequired}
              liveAvailable={liveAvailable}
              // A Gem's default tool, selected as a chat with it starts.
              defaultTool={hasStarted ? undefined : gemStartingTool(activeGem)}
              template={mediaTemplate}
              onTemplateClear={clearMediaTemplate}
              onSelectedToolChange={setComposerTool}
              composerRef={composerHandleRef}
            />
            <ChatMentions host={composerBox} options={mentionOptions} onPick={pickMention} disabled={isLive} />
          </motion.div>
        </div>
      </div>
      </motion.div>

      {/*
        * One presence for all three right-hand panels, not one each.
        *
        * They occupy the same corner and animate along the same axis — each
        * slides in from x:424 and back out to x:424. Given a presence per
        * panel, swapping one for another ran both animations at once: the
        * outgoing panel slid right while the incoming one slid left across it,
        * which reads as a flicker rather than a transition. Opening "Show
        * thinking steps" over the resource preview is the case that shows it,
        * because `handleOpenThinking` clears the resource and sets the thinking
        * id in the same commit.
        *
        * `mode="wait"` is the whole fix: the outgoing panel finishes leaving
        * before the incoming one starts arriving, so the corner is empty in
        * between and the swap reads as two deliberate movements.
        *
        * Keys are prefixed by kind because two different panels can belong to
        * the same message id, and an unchanged key would swap the contents
        * without animating at all.
        */}
      <AnimatePresence mode="wait">
        {thinkingMessage ? (
          <ThinkingStepsSidebar
            key={`thinking-${thinkingMessage.id}`}
            thinkingText={thinkingMessage.isError
              ? thinkingMessage.errorDetail || 'No additional error details were provided by the service.'
              : thinkingMessage.thinkingText || ''}
            modelLabel={thinkingMessage.modelSnapshot?.label || 'Model'}
            isError={!!thinkingMessage.isError}
            onClose={() => setOpenThinkingMessageId(null)}
          />
        ) : sourcesMessage ? (
          <SourcesSidebar
            key={`sources-${sourcesMessage.id}`}
            sources={sourcesMessage.citations?.sources || []}
            onClose={() => setOpenSourcesMessageId(null)}
          />
        ) : openResource ? (
          <RichResourcePanel
            key="willow-rich-resource-panel"
            resource={openResource}
            onClose={() => setOpenResource(null)}
          />
        ) : openResearch && openResearchId ? (
          <ResearchPanel
            key={`research-${openResearchId}`}
            record={openResearch}
            onClose={() => setOpenResearchId(null)}
            onCreate={(kind) => createFromResearch(openResearch, kind)}
          />
        ) : openCanvasDoc && openCanvas ? (
          /* Keyed by document, so opening a SECOND canvas replays the enter
             animation instead of silently swapping the contents — the same reason
             the keys above are kind-prefixed. */
          <CanvasPanel
            key={`canvas-${openCanvasDoc.docId}`}
            doc={openCanvasDoc}
            version={openCanvas.version}
            onVersionChange={(version) => $openCanvas.set({ docId: openCanvasDoc.docId, version })}
            onCollapse={() => {
              /* The card that gets expanded is the NEWEST turn that wrote this
                 document — the one whose chip sits at the bottom of the thread,
                 which is where the user's eye already is. */
              const versions = openCanvasDoc.versions;
              const last = versions[versions.length - 1];
              if (last) collapseCanvasToCard(last.messageId, openCanvasDoc.docId);
              else $openCanvas.set(null);
            }}
            onPrompt={(text) => { void handleSend(text, undefined, [], 'canvas'); }}
            onEditContent={
              canvasEdit ? (content) => canvasEdit(openCanvasDoc.docId, content) : undefined
            }
          />
        ) : null}
      </AnimatePresence>

      {errorDialog && (
        <GeminiDialog
          headingAs="h1"
          title="Something went wrong"
          width={600}
          closing={isErrorDialogClosing}
          onDismiss={closeErrorDialog}
          actions={
            <>
              <GeminiDialogPill
                onClick={() => {
                  void navigator.clipboard.writeText(errorDialog.detail);
                }}
              >
                Copy
              </GeminiDialogPill>
              <GeminiDialogPill onClick={closeErrorDialog}>Close</GeminiDialogPill>
            </>
          }
        >
          <p
            style={{
              maxHeight: '45vh',
              overflowY: 'auto',
              overflowWrap: 'anywhere',
              whiteSpace: 'pre-wrap',
            }}
          >
            {errorDialog.detail}
          </p>
        </GeminiDialog>
      )}
      {sentImagePreview && (
        <SentImageViewer
          url={sentImagePreview.url}
          name={sentImagePreview.name}
          onClose={() => setSentImagePreview(null)}
        />
      )}
    </div>
    </LayoutGroup>
  );
};

export default ChatView;
