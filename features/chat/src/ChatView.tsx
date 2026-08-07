import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Glasses } from 'lucide-react';
import { InputBar, type Attachment as ComposerAttachment } from './composer/Composer';
import { HeroSection } from '@willow/media/MediaHome';
import { BottomPanel } from '@willow/media/MediaShowcase';
import { TextShimmer } from '@willow/ui/text-shimmer';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { StreamingMarkdown } from '@willow/ui/StreamingMarkdown';
import { GeminiAttachmentCard } from '@willow/ui/GeminiAttachmentCard';
import { RichResource, RichResourcePanel } from '@willow/ui/RichResourcePreview';
import { ResponseActions, ThinkingStepsSidebar } from './ChatResponseChrome';
import { GeminiThinkingVisualizer } from './GeminiThinkingVisualizer';
import { UserMessageBubble } from './UserMessageBubble';
import { ResponseInfoLine } from './ResponseInfoLine';
import { streamChat, isAbortError, ChatMessage as AiChatMessage, StreamPhase } from '@willow/ai/chat';
import {
  GeminiLiveSession,
  LIVE_MODEL_ID,
  LiveHistoryTurn,
  playLiveChime,
  primeLiveChimes,
} from '@willow/ai/live';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { useLocalFS, isTempChatId } from '@willow/storage/local-fs/LocalFSContext';
import { ChatAttachment, toPersistedChatAttachment } from '@willow/core/attachments';
import { ChatMsg, hasSavedMessageContent, sanitizeSavedAttachment, serializeChatMessage } from './chat-message';
import { buildAiHistory as buildChatAiHistory } from './chat-history';
import { CHAT_SYSTEM_PROMPT, resolveChatModel } from './chat-model';
import { waitForBrowserPaint } from './chat-timing';
import { useStore } from '@nanostores/react';
import { experimentsStore } from '@willow/core/experiments-store';
import { VoiceFocusSurface, focusModeAtom } from './voice-orb/VoiceFocusSurface';
import { resolveFocusSurfaceAttributes } from './voice-orb/focus-surface-constants';
import type { WorkspaceColorName } from './voice-orb/orb-palette';
import { VoiceSettingsButton } from './voice-settings/VoiceSettingsButton';
import { VoiceSettingsDialog } from './voice-settings/VoiceSettingsDialog';
import { findVoiceProvider } from './voice-settings/voice-providers';
import {
  buildLiveVoiceOptions,
  getVoiceSelection,
  setLanguage,
  setVoice,
  voiceSettingsSignature,
  voiceSettingsStore,
} from './voice-settings/voice-settings-store';

const CHAT_COMPOSER_LAYOUT_ID = 'willow-chat-composer';

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
  workspaceColor,
}) => {
  const { apiKeys } = useUserDataContext();
  const {
    isLocalFolderConnected,
    saveLocalFSChat,
    saveLocalFSChatAttachment,
    loadLocalFSChatAttachment,
    generateChatTitle,
    activeChatId,
    loadLocalFSChat,
    localChats,
  } = useLocalFS();

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

  const createAttachmentObjectUrl = useCallback((blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    attachmentObjectUrlsRef.current.add(url);
    return url;
  }, []);

  const revokeAllAttachmentObjectUrls = useCallback(() => {
    for (const url of attachmentObjectUrlsRef.current) URL.revokeObjectURL(url);
    attachmentObjectUrlsRef.current.clear();
    attachmentBlobsRef.current.clear();
  }, []);

  const hydrateSavedAttachments = useCallback(async (
    values: unknown,
  ): Promise<ChatAttachment[] | undefined> => {
    if (!Array.isArray(values) || values.length === 0) return undefined;
    const metadata = values
      .map(sanitizeSavedAttachment)
      .filter((attachment): attachment is ChatAttachment => !!attachment);
    const hydrated = await Promise.all(metadata.map(async (attachment) => {
      const stored = await loadLocalFSChatAttachment(attachment.id);
      if (!stored?.blob) return attachment;
      attachmentBlobsRef.current.set(attachment.id, stored.blob);
      return { ...attachment, url: createAttachmentObjectUrl(stored.blob) };
    }));
    return hydrated.length > 0 ? hydrated : undefined;
  }, [createAttachmentObjectUrl, loadLocalFSChatAttachment]);

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

  // Listen to activeChatId and load the chat when it changes
  useEffect(() => {
    if (isLocalFolderConnected && activeChatId) {
      // Prevent reloading and overwriting if the selected chat is already active in memory
      const forceReload = forceExternalReloadRef.current;
      forceExternalReloadRef.current = false;
      if (!forceReload && (activeChatId === chatTitle || activeChatId === chatSessionId)) {
        return;
      }
      isFirstScrollRef.current = true;
      initialLoadRef.current = true; // Block auto-save on load when switching chats

      const loadChat = async () => {
        try {
          const msgs = await loadLocalFSChat(activeChatId);
          if (msgs && msgs.length > 0) {
            revokeAllAttachmentObjectUrls();
            // Strip runtime-only flags that should never be persisted.
            // If a save happened mid-generation, the assistant placeholder
            // will have isGenerating:true and empty content — drop those.
            //
            // Every flag `serializeChatMessage` writes must be read back here.
            // This list previously omitted `wasStopped`, so a stopped turn lost
            // its "You stopped this response" notice on any reload — including
            // the disk-sync reload that fires after the next turn is saved,
            // which is why the notice vanished mid-conversation rather than only
            // on refresh. `chat-message.ts` owns which flags are runtime-only;
            // the load path has to agree with it.
            const sanitized: ChatMsg[] = (await Promise.all(msgs
              .map(async (m: any) => ({
                id: m.id || crypto.randomUUID?.() || Math.random().toString(36).slice(2),
                role: m.role,
                content: m.content || '',
                attachments: await hydrateSavedAttachments(m.attachments),
                thinkingTime: m.thinkingTime,
                thinkingText: typeof m.thinkingText === 'string' ? m.thinkingText : undefined,
                modelSnapshot: m.modelSnapshot,
                isError: m.isError,
                // Clear all runtime flags
                isGenerating: false,
                isTranscribing: false,
                isLive: false,
                wasInterrupted: m.wasInterrupted,
                wasStopped: m.wasStopped,
              })))).filter((m: ChatMsg) => hasSavedMessageContent(m));

            if (sanitized.length > 0) {
              setMessages(sanitized);
              // `chatTitle` means "the human name this chat is saved under" —
              // a temp id is not one. Writing it here closes the title-effect's
              // `!chatTitle` gate permanently, so the chat can never be named
              // and the sidebar skeleton shimmers forever. chatSessionId still
              // adopts the id, which is what keeps the guard at ~line 153 sound.
              setChatTitle(isTempChatId(activeChatId) ? null : activeChatId);
              setChatSessionId(activeChatId);
              return;
            }
          }
          // Load yielded nothing usable. Don't leave the PREVIOUS chat's
          // messages on screen under the newly-selected id — adopt the id
          // with an empty thread instead (and release the load guard so the
          // first real message saves normally).
          setMessages([]);
          revokeAllAttachmentObjectUrls();
          setChatTitle(isTempChatId(activeChatId) ? null : activeChatId);
          setChatSessionId(activeChatId);
          lastSavedMessagesRef.current = [];
          initialLoadRef.current = false;
        } catch {}
      };
      void loadChat();
    }
  }, [activeChatId, isLocalFolderConnected, loadLocalFSChat, chatTitle, chatSessionId, externalReloadVersion, hydrateSavedAttachments, revokeAllAttachmentObjectUrls]);

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

        // Fallback: If Gemini naming is slow, fails, or has no key, use the first 5 words of the user prompt
        if (!title) {
          const words = userMsg.trim().split(/\s+/);
          const rawFallback = words.slice(0, 5).join(' ') + (words.length > 5 ? '...' : '');
          title = rawFallback.replace(/[\/:*?"<>|]/g, '').trim().slice(0, 80) || 'Untitled Chat';
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
          const latest = snapshot
            .map(serializeChatMessage)
            .filter((message) => hasSavedMessageContent(message));
          if (latest.length > 0) {
            const saved = await saveLocalFSChat(uniqueTitle, latest, chatSessionId);
            if (saved) {
              lastSavedMessagesRef.current = snapshot;
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
  const sendInFlightRef = useRef(false);
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
  const [reactions, setReactions] = useState<Record<string, 'like' | 'dislike' | null>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [listeningId, setListeningId] = useState<string | null>(null);
  const [openThinkingMessageId, setOpenThinkingMessageId] = useState<string | null>(null);
  const [openResource, setOpenResource] = useState<RichResource | null>(null);
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
    setOpenResource(null);
  }, [activeChatId]);

  const handleOpenResource = useCallback((resource: RichResource) => {
    if (!isSidebarCollapsed) onCollapseSidebar?.();
    setOpenThinkingMessageId(null);
    setOpenResource(resource);
  }, [isSidebarCollapsed, onCollapseSidebar]);

  const handleOpenThinking = useCallback((messageId: string) => {
    setOpenResource(null);
    setOpenThinkingMessageId(messageId);
  }, []);

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
      // Strip runtime flags before persisting
      const toSave = messages.map(serializeChatMessage).filter(hasSavedMessageContent);
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
  // Voice/language the running session was opened with, so a change can be
  // detected without re-running the reconnect on unrelated store writes.
  const liveSettingsSignatureRef = useRef('');
  // Voice-orb state. Behind the Labs experiment, so it stays inert by default.
  const { voiceOrb: isVoiceOrbEnabled } = useStore(experimentsStore);
  // Connected flips on the socket ACK, which is when the orb reveals itself;
  // before that it shows the pre-connection dot.
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
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

  const hasStarted = messages.length > 0 || isGenerating || isLive;
  const lastUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id;
  // A live turn marks the user's bubble `isTranscribing` for exactly as long as
  // they are being listened to, which is the orb's listening signal.
  const isUserSpeaking = isLive && messages.some((message) => message.isTranscribing);
  const showVoiceOrb = isVoiceOrbEnabled && isLive;

  // ── Voice + language for the live session ──────────────────────────────────
  // The panel rides the same experiment as the orb: it is the orb's settings, and
  // it draws the orb, so it should not exist while the orb does not.
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);
  const voiceSettings = useStore(voiceSettingsStore);
  const voiceProvider = useMemo(() => findVoiceProvider(LIVE_MODEL_ID), []);
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
    onChatStartedChange?.(hasStarted);
  }, [hasStarted, onChatStartedChange]);

  // ── Scroll-to-top + dynamic response-area sizing (ported from Workbench) ───
  // When you send, your bubble animates to `TARGET_VISUAL_OFFSET` from the top
  // and the assistant block below it is given exactly enough min-height to fill
  // the remaining visible viewport, so you can't scroll into empty space before
  // the reply fills it. The gap below the 👍👎Copy row and the top of the input
  // box matches the Workbench's gap to its suggestions row (both = the 32px gradient).
  const TARGET_VISUAL_OFFSET = 72; // Gemini's settled first-query top edge
  // Measured off the live Gemini app: `infinite-scroller.chat-history` is a
  // flex column with `row-gap: 52px`, and the same 52px separates a query
  // bubble from its response inside a turn. So every turn boundary is 52 --
  // both user->assistant and assistant->next user. Gemini's action row lives
  // inside `model-response` (36px, opacity 0 on non-last turns) rather than in
  // the gap, which is also how our assistant wrapper is built, so the visible
  // blank from response text to the next bubble comes out at 88px on both.
  const MESSAGE_GAP = 52;          // Any user/assistant turn boundary
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
  const userBubbleCollapsePinnedToBottomRef = useRef(false);
  // Inner content of the last assistant block — measured for the overflow
  // check so it's independent of the outer minHeight/paddingBottom we apply.
  const lastAssistantContentRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledUserId = useRef<string | null>(null);
  const isFirstScrollRef = useRef(false);
  const skipNextNativeScrollRef = useRef(false);

  const [responseAreaMinHeight, setResponseAreaMinHeight] = useState<number | undefined>(undefined);
  const [needsScrollPadding, setNeedsScrollPadding] = useState(false);

  // Main content rect for the voice focus surface — measured from the scroll container
  const [mainContentRect, setMainContentRect] = useState({
    top: 0,
    left: 0,
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
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
        return Math.max(
          0,
          c.clientHeight
            - TARGET_VISUAL_OFFSET
            - msgEl.offsetHeight
            - (editingUserId === lastUser?.id ? 0 : MESSAGE_GAP)
            - THREAD_BOTTOM_PADDING
        );
      });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(c);
    return () => ro.disconnect();
  }, [hasStarted, editingUserId]);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const thinkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkStart = useRef<number>(0);
  const isThinkingRef = useRef(false);
  const thinkSecondsRef = useRef(0);

  useEffect(() => { isThinkingRef.current = isThinking; }, [isThinking]);
  useEffect(() => { thinkSecondsRef.current = thinkSeconds; }, [thinkSeconds]);

  useEffect(() => () => {
    if (thinkTimer.current) clearInterval(thinkTimer.current);
    if (streamingClearRafRef.current !== null) {
      cancelAnimationFrame(streamingClearRafRef.current);
    }
  }, []);

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

    requestAnimationFrame(() => {
      const msgEl = messageRefs.current[lastUser.id];
      if (!msgEl || !chatScrollRef.current) return;
      const c = chatScrollRef.current;

      // Reserve response-area height on the new placeholder BEFORE scrolling so
      // there's enough scrollHeight to reach the target.
      const preMinH =
        c.clientHeight - TARGET_VISUAL_OFFSET - msgEl.offsetHeight - MESSAGE_GAP
          - THREAD_BOTTOM_PADDING;
      flushSync(() => {
        setResponseAreaMinHeight(Math.max(0, preMinH));
        setNeedsScrollPadding(false);
      });

      const N = 4;
      if (isFirstScrollRef.current && messages.length > N) {
        const targetIndex = messages.length - 1 - N;
        const jumpMessage = messages[targetIndex];
        const jumpEl = jumpMessage ? messageRefs.current[jumpMessage.id] : null;
        if (jumpEl) {
          c.scrollTop = Math.max(0, jumpEl.offsetTop - TARGET_VISUAL_OFFSET);
        }
      }
      isFirstScrollRef.current = false;

       // The first query already has one movement authority: the 500ms thread
       // entrance below. Starting native smooth scrolling while that transform
       // is shrinking the scrollable overflow makes scrollTop rise and then
       // ease back to zero, which is the visible first-send jerk. Later turns
       // do not remount the thread, so they continue to use native scrolling.
       if (skipNextNativeScrollRef.current) {
         skipNextNativeScrollRef.current = false;
         c.scrollTop = 0;
       } else {
         msgEl.scrollIntoView({
           behavior: 'smooth',
           block: 'start',
           inline: 'nearest',
         });
       }
     });
  }, [messages]);

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
        return Math.max(
          0,
          c.clientHeight
            - TARGET_VISUAL_OFFSET
            - msgEl.offsetHeight
            - (editingUserId === lastUser?.id ? 0 : MESSAGE_GAP)
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
    const ro = new ResizeObserver(recompute);
    ro.observe(c);
    const lastUserEl = lastUserMessageId ? messageRefs.current[lastUserMessageId] : null;
    if (lastUserEl) ro.observe(lastUserEl);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStarted, lastUserMessageId, editingUserId]);

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
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [messages, responseAreaMinHeight, streaming]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const stopThinking = useCallback(() => {
    if (thinkTimer.current) { clearInterval(thinkTimer.current); thinkTimer.current = null; }
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
    wasStopped = false
  ) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, content, thinkingTime, isError, isGenerating: false, wasStopped }
          : m
      )
    );
  };

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
    ) => {
      const trimmed = text.trim();
      if ((!trimmed && attachmentSources.length === 0) || isGenerating || sendInFlightRef.current) return;
      if (!isAuthenticated) { onAuthRequired?.(); return; }

      const { provider, model, thinkingLevel, apiKey, modelLabel } = resolveModel();
      sendInFlightRef.current = true;
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
        modelSnapshot: {
          provider,
          modelId: model,
          label: modelLabel,
          thinkingLevel,
        },
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
      thinkStart.current = Date.now();
      if (thinkTimer.current) clearInterval(thinkTimer.current);
      thinkTimer.current = setInterval(() => {
        const s = Math.ceil((Date.now() - thinkStart.current) / 1000);
        thinkSecondsRef.current = s;
        setThinkSeconds(s);
      }, 1000);

      if (!apiKey) {
        sendInFlightRef.current = false;
        stopThinking();
        setIsGenerating(false);
        finalizeAssistant(
          assistantId,
          `API key for **${provider}** is missing. Add one in **Settings → Models** to start chatting.`,
          undefined,
          true
        );
        return;
      }

      let acc = '';
      let thoughtAcc = '';
      const abort = new AbortController();
      generationAbortRef.current = abort;
      try {
        await attachmentPersistence;
        const history = await buildAiHistory([...prevMessages, userMsg]);
        await streamChat(
          history,
          // Chat mode: search grounding + native code execution both offered.
          {
            provider,
            model,
            apiKey,
            thinkingLevel,
            includeThoughts: thinkingLevel > 0,
            enableSearch: true,
            enableCodeExecution: true,
            baseUrl: (modelConfig as any)?.[provider]?.baseUrl,
            signal: abort.signal,
          },
          (token) => {
            if (isThinkingRef.current) {
              const elapsed = Math.max(1, Math.ceil((Date.now() - thinkStart.current) / 1000));
              thinkSecondsRef.current = elapsed;
              setThinkSeconds(elapsed);
              stopThinking();
            }
            acc += token;
            // The provider callbacks can be drained from an already-buffered SSE
            // response in a tight microtask chain. Force each accumulated value
            // into React before the final message/cleanup updates can absorb it.
            flushSync(() => setStreaming(acc));
          },
          () => {},
          CHAT_SYSTEM_PROMPT,
          (phase) => {
            // Keep the shimmer row live with the right label until real text
            // streams. 'responding' is handled by the onToken branch above.
            if (phase !== 'responding') setThinkingPhase(phase);
          },
          undefined,
          (thoughtChunk) => {
            thoughtAcc += thoughtChunk;
            setMessages((prev) => prev.map((message) =>
              message.id === assistantId
                ? { ...message, thinkingText: thoughtAcc }
                : message
            ));
          },
        );
        // Give the browser one generating-state paint after the final delta. If
        // finalisation happens in the same task, React can otherwise replace the
        // streaming buffer with the completed message before it was ever shown.
        await waitForBrowserPaint();
        // Some SDKs swallow the abort and return normally instead of throwing,
        // so a clean return is not proof the turn ran to completion.
        finalizeAssistant(assistantId, acc, thinkSecondsRef.current, false, abort.signal.aborted);
      } catch (e: any) {
        // A stop is not a failure. Gemini keeps whatever streamed before the
        // press and marks the turn, so the partial text is the final content
        // rather than being replaced by an error.
        //
        // The signal is the test, not the error's shape: providers rewrap an
        // abort into their own type, losing the AbortError name and code. The
        // Gemini SDK reports "[GoogleGenerativeAI Error]: Error reading from
        // the stream", which isAbortError alone cannot recognise. Checking the
        // signal we own works the same way for every provider.
        if (abort.signal.aborted || isAbortError(e)) {
          await waitForBrowserPaint();
          finalizeAssistant(assistantId, acc, thinkSecondsRef.current, false, true);
        } else {
          finalizeAssistant(
            assistantId,
            `Something went wrong: ${e?.message || 'Unknown error.'}`,
            undefined,
            true
          );
        }
      } finally {
        generationAbortRef.current = null;
        sendInFlightRef.current = false;
        stopThinking();
        // Keep the final streaming value alive through the completion commit.
        // The completed message now owns the same text, so clearing next frame is
        // visually lossless and cannot erase the last delta before paint.
        streamingClearRafRef.current = requestAnimationFrame(() => {
          streamingClearRafRef.current = null;
          setStreaming('');
        });
        setIsGenerating(false);
      }
    },
    [messages, isGenerating, isAuthenticated, onAuthRequired, resolveModel, stopThinking, isIncognito, isLocalFolderConnected, saveLocalFSChat, saveLocalFSChatAttachment, chatSessionId, modelConfig, buildAiHistory, createAttachmentObjectUrl]
  );

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
        isLive: true,
        modelSnapshot: {
          provider: 'gemini',
          modelId: LIVE_MODEL_ID,
          label: '3.1 Flash Live',
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

  const handleStopLive = useCallback(() => {
    // Falling two-note earcon = "done listening". Only on explicit user stop —
    // error closes stay silent.
    playLiveChime('end');
    liveSessionRef.current?.stop();
    liveSessionRef.current = null;
    setIsLive(false);
    // Drop the orb's inputs with the session: the analysers belong to audio
    // contexts that are now closed.
    setIsLiveConnected(false);
    setIsAssistantSpeaking(false);
    setLiveAnalysers({ mic: null, output: null });
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
    generationAbortRef.current?.abort();
  }, []);

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
    const voiceOptions = buildLiveVoiceOptions(LIVE_MODEL_ID, CHAT_SYSTEM_PROMPT);
    liveSettingsSignatureRef.current = voiceSettingsSignature(LIVE_MODEL_ID);

    // Every callback below is late-bound to the ref, so a session that has been
    // replaced goes quiet instead of tearing down its successor.
    const isCurrentSession = () => liveSessionRef.current === session;

    const session = new GeminiLiveSession({
      apiKey,
      model: LIVE_MODEL_ID,
      systemPrompt: voiceOptions.systemPrompt,
      voiceName: voiceOptions.voiceName,
      languageCode: voiceOptions.languageCode,
      history,
      // Rising two-note earcon the moment the socket ACKs setup + mic is hot —
      // i.e. the exact instant it's actually listening.
      onOpen: () => {
        if (!isCurrentSession()) return;
        playLiveChime('start');
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
              isError: true,
              content:
                `Couldn't start live mode (\`${LIVE_MODEL_ID}\`).\n\n` +
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
      },
    });
    liveSessionRef.current = session;
    void session.start();
  }, [openLiveTurn, closeLiveTurn]);

  const handleStartLive = useCallback(() => {
    if (isLive || isGenerating) return;
    if (!isAuthenticated) { onAuthRequired?.(); return; }

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
          content:
            'A **Gemini** API key is required for live voice mode ' +
            `(\`${LIVE_MODEL_ID}\`). Add one in **Settings → Models**.`,
          isError: true,
        },
      ]);
      return;
    }

    // Still inside the click gesture: create/resume the chime AudioContext and
    // kick off both fetches so the start cue is decoded before onOpen fires.
    primeLiveChimes();

    setIsLive(true);
    openLiveSession(apiKey);
  }, [
    isLive,
    isGenerating,
    isAuthenticated,
    onAuthRequired,
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

    liveSessionRef.current.stop();
    liveSessionRef.current = null;
    setIsAssistantSpeaking(false);
    setLiveAnalysers({ mic: null, output: null });
    openLiveSession(apiKey);
  }, [apiKeys, openLiveSession]);

  // A change while live reconnects; a change while idle just waits for the next
  // session, which will read the store when it opens.
  useEffect(() => {
    if (!isLive || !liveSessionRef.current) return;
    if (voiceSettingsSignature(LIVE_MODEL_ID) === liveSettingsSignatureRef.current) return;
    restartLiveSession();
  }, [isLive, restartLiveSession, voiceSettings]);

  // Tear down the socket + mic if the component unmounts mid-session.
  useEffect(() => () => { liveSessionRef.current?.stop(); }, []);

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
        const stored = await loadLocalFSChatAttachment(attachment.id);
        blob = stored?.blob;
      }
      if (!blob) return;
      attachmentBlobsRef.current.set(attachment.id, blob);
      url = createAttachmentObjectUrl(blob);
      const hydratedUrl = url;
      setMessages((current) => current.map((message) => ({
        ...message,
        attachments: message.attachments?.map((item) => (
          item.id === attachment.id ? { ...item, url: hydratedUrl } : item
        )),
      })));
    }

    const opensInline = attachment.kind === 'image'
      || attachment.kind === 'pdf'
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
  }, [createAttachmentObjectUrl, loadLocalFSChatAttachment]);

  const handleCopy = (msg: ChatMsg) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId((id) => (id === msg.id ? null : id)), 1600);
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
          - TARGET_VISUAL_OFFSET
          - messageElement.offsetHeight
          - MESSAGE_GAP
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
  // EMPTY STATE — render the *actual* HeroSection + BottomPanel so the layout
  // is literally the same component tree as Develop mode (single source of
  // truth for prompt-box position). Only `onPromptSubmit` differs: it starts
  // an in-studio chat instead of navigating to the Workbench.
  if (!hasStarted) {
    return (
      <LayoutGroup id="willow-chat-layout">
        <div className="flex flex-col min-h-full">
          <HeroSection
            initialMode="chat"
            onPromptSubmit={(prompt, _mode, attachments) => handleSend(prompt, undefined, attachments)}
            onStartLive={handleStartLive}
            modelConfig={modelConfig}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            onAuthRequired={onAuthRequired}
            isAuthenticated={isAuthenticated}
            isIncognito={isIncognito}
            composerLayoutId={CHAT_COMPOSER_LAYOUT_ID}
          />
          {isAuthenticated && (
            <div className="pb-20">
              <BottomPanel onOpenDriveSettings={onOpenDriveSettings} />
            </div>
          )}
        </div>
      </LayoutGroup>
    );
  }

  // ACTIVE STATE — ChatGPT-style thread with bottom-docked input
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const latestConversationMessageId = [...messages]
    .reverse()
    .find((m) => m.role === 'user' || m.role === 'assistant')?.id;
  const thinkingMessage = openThinkingMessageId
    ? messages.find((message) => message.id === openThinkingMessageId && message.role === 'assistant')
    : undefined;
  const shouldAnimateFirstPromptEntrance =
    messages.length === 2 &&
    messages[0]?.role === 'user' &&
    messages[0].isNew === true;

  return (
    <LayoutGroup id="willow-chat-layout">
    <div
      className={`relative grid h-full min-h-0 w-full overflow-hidden grid-cols-[minmax(0,1fr)] ${
        openResource
          ? 'min-[960px]:grid-cols-[minmax(0,1.03fr)_minmax(0,1.97fr)] min-[960px]:gap-x-6'
          : 'min-[960px]:grid-cols-[minmax(0,1fr)_0fr] min-[960px]:gap-x-0'
      }`}
      style={{
        transitionProperty: 'grid-template-columns, column-gap',
        transitionDuration: '500ms',
        transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
      }}
    >
      <div
        className={`relative flex h-full min-h-0 min-w-0 w-full ${
          thinkingMessage ? 'min-[1024px]:w-[calc(100%_-_428px)]' : ''
        } flex-col transition-[margin-right,width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
          thinkingMessage ? 'min-[1024px]:mr-[428px]' : 'mr-0'
        }`}
      >
      {/* Scrollable message thread
          scrollbar-gutter:stable keeps the mx-auto column from nudging left
          the moment streamed content grows tall enough to spawn a scrollbar. */}
      <div
        ref={chatScrollRef}
        className="gemini-chat-scrollbar min-h-0 flex-1 overflow-y-auto"
        style={{ scrollbarGutter: 'stable' }}
        {...voiceFocusSurfaceAttributes}
      >
        <motion.div
          initial={shouldAnimateFirstPromptEntrance ? { y: 200 } : false}
          animate={{ y: 0 }}
          transition={shouldAnimateFirstPromptEntrance
            ? { duration: 0.5, ease: [0.2, 0, 0, 1] }
            : undefined}
          onAnimationComplete={() => {
            if (isFirstTurnEntranceActive) setIsFirstTurnEntranceActive(false);
          }}
          className={`mx-auto flex w-full max-w-[760px] flex-col pl-7 pr-7 pt-[72px] pb-[20px] transition-[padding-left] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
            thinkingMessage ? 'min-[1024px]:pl-9' : ''
          }`}
        >
          {isIncognito && (
            <div className="flex items-center justify-center gap-1.5 py-1.5 px-3 bg-white/5 border border-white/5 text-zinc-400 text-[12px] font-medium rounded-full w-fit mx-auto select-none backdrop-blur-md">
              <Glasses size={13} className="text-zinc-400" />
              <span>Incognito Mode — Temporary Session</span>
            </div>
          )}
          {messages.map((msg, messageIndex) => {
            const previousMessage = messages[messageIndex - 1];
            // Every message boundary is MESSAGE_GAP. Gemini's scroller applies
            // its 52px row-gap to each `.conversation-container` uniformly, and
            // once both real turn boundaries moved to 52 a same-role run left at
            // THREAD_GAP was the only 32 left in the thread -- visibly tighter
            // than every other gap around it. Same-role runs are reachable
            // (a split/live turn, or a reload where the contentless message
            // between two turns was dropped by hasSavedMessageContent), so they
            // have to match. THREAD_GAP now covers the incognito banner only.
            const gapBefore = messageIndex === 0
              ? (isIncognito ? THREAD_GAP : 0)
              : previousMessage?.role === 'user' && msg.role === 'assistant'
                ? (editingUserId === previousMessage.id ? 0 : MESSAGE_GAP)
                : MESSAGE_GAP;

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
                              onOpen={() => { void handleOpenAttachment(attachment); }}
                            />
                          ))}
                        </div>
                      )}
                      <div className="relative ml-4 mr-2 rounded-[40px] px-7 py-5">
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 rounded-[40px] border-[0.8px] border-[#1f3b9b]"
                        />
                        <textarea
                          ref={editTextareaRef}
                          autoFocus
                          value={editDraft}
                          onChange={(event) => setEditDraft(event.target.value)}
                          rows={1}
                          maxLength={1000000}
                          enterKeyHint="send"
                          className="relative z-10 block min-h-6 max-h-72 w-full resize-none overflow-y-auto bg-transparent p-0 font-['Google_Sans_Flex','Google_Sans','Helvetica_Neue',sans-serif] text-[17px] font-normal leading-6 text-[#e6e6e6] outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                          style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
                          aria-label="Edit prompt"
                        />
                      </div>
                      <div className="mt-4 flex h-12 justify-end">
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="relative mx-1 flex h-12 min-w-[72px] items-center justify-center overflow-hidden rounded-full px-4 text-[14px] font-medium text-[#e6e6e6] before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-[#e6e6e6] before:opacity-0 before:transition-opacity hover:before:opacity-[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                        >
                          <span className="relative z-10">Cancel</span>
                        </button>
                        <button
                          type="submit"
                          disabled={!editDraft.trim() || editDraft === msg.content || isGenerating}
                          className="relative ml-1 flex h-12 items-center justify-center overflow-hidden rounded-full bg-[#1f3b9b] px-4 text-[14px] font-medium text-[#e6e6e6] before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-[#e6e6e6] before:opacity-0 before:transition-opacity hover:before:opacity-[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-default disabled:bg-[rgba(230,230,230,0.12)] disabled:text-[rgba(230,230,230,0.38)] disabled:before:opacity-0"
                        >
                          <span className="relative z-10">Update</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex min-w-0 max-w-[516px] flex-col items-end">
                      {!!msg.attachments?.length && (
                        <div className={`flex w-full max-w-[516px] flex-nowrap justify-end gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${msg.content || msg.isTranscribing ? 'mb-2' : ''}`}>
                          {msg.attachments.map((attachment) => (
                            <GeminiAttachmentCard
                              key={attachment.id}
                              attachment={attachment}
                              variant="message"
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
                          <div className="gemini-user-actions pointer-events-none absolute right-3 top-full z-10 mt-1 flex h-9 items-start opacity-0 transition-opacity duration-[250ms] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={() => handleCopy(msg)}
                              className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[rgba(31,31,31,0.34)] text-[#e6e6e6] backdrop-blur-[14px] before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-[#e0e0e0] before:opacity-0 before:transition-opacity hover:before:opacity-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                              aria-label="Copy prompt"
                              title="Copy prompt"
                            >
                              <MaterialSymbol
                                family="luminous"
                                name={copiedId === msg.id ? 'check' : 'copy'}
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
                                className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[rgba(31,31,31,0.34)] text-[#e6e6e6] backdrop-blur-[14px] before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-[#e0e0e0] before:opacity-0 before:transition-opacity hover:before:opacity-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
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
            // the same string, so StreamingMarkdown's RAF buffer can finish
            // draining without a content swap.
            // `streaming` is a single thread-wide buffer belonging to whichever
            // turn is generating now, so a finished turn must never fall back to
            // it. A turn stopped before its first token has empty content, and
            // the old fallback to `streaming` here made such a turn mirror the
            // NEXT turn's text as soon as that began streaming.
            const bodyText = generating ? streaming : msg.content;
            // Live turns: no "Thinking" shimmer, no "Thought for Xs" — the
            // voice starts near-instantly so the row is noise.
            const showThinkingRow =
              !msg.isError &&
              !msg.isLive &&
              generating &&
              bodyText.trim().length === 0;
            const isLastAssistant = msg.id === lastAssistantId;
            const isLatestCompletedTurn = !generating && msg.id === latestConversationMessageId;

            return (
              <div
                key={msg.id}
                ref={(el) => { messageRefs.current[msg.id] = el; }}
                className="group/assistant-response"
                style={{
                  marginTop: gapBefore,
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
                    minHeight/paddingBottom. Measured for the overflow check. */}
                <div
                  ref={isLastAssistant ? lastAssistantContentRef : undefined}
                  className={`w-full space-y-3 ${openResource ? 'ml-auto max-w-[476px]' : ''}`}
                >
                {showThinkingRow && !isFirstTurnEntranceActive && (() => {
                  const active = generating && isThinking;
                  const phaseSymbol =
                    active && thinkingPhase === 'searching' ? 'search'
                    : active && thinkingPhase === 'executing' ? 'terminal'
                    : 'lightbulb';
                  const phaseLabel =
                    thinkingPhase === 'searching' ? 'Searching'
                    : thinkingPhase === 'executing' ? 'Running code'
                    : 'Thinking';
                  return (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                      className="flex items-center gap-2.5"
                      style={{ color: '#81888f' }}
                    >
                      {thinkingPhase === 'thinking' ? (
                        <GeminiThinkingVisualizer />
                      ) : (
                        <MaterialSymbol name={phaseSymbol} size={18} opticalSize={20} />
                      )}
                      {active ? (
                        <TextShimmer className="text-[15.15px] font-medium" duration={1.5}>
                          {phaseLabel}
                        </TextShimmer>
                      ) : (
                        <span className="text-[15.15px] font-medium">{phaseLabel}</span>
                      )}
                    </motion.div>
                  );
                })()}

                {bodyText && (
                  <StreamingMarkdown
                    text={bodyText}
                    isStreaming={generating}
                    animate={generating && !msg.isError}
                    onOpenResource={handleOpenResource}
                  />
                )}

                {/* Stopped turn: Gemini inserts the notice between the body and
                    the action row. Measured on both stopped turns in the live
                    app: body bottom -> 8px -> 20px notice -> 4px -> 32px button
                    row. (An earlier pass read that last gap as 0 because it
                    measured to `message-actions`, whose own 4px inset sits above
                    the buttons; the notice-to-button distance is 4px.) The
                    notice sits outside the wrapper's space-y-3 rhythm, so both
                    margins are set explicitly. */}
                {msg.wasStopped && !generating && (
                  <div style={{ marginTop: 8, marginBottom: 0 }}>
                    <ResponseInfoLine />
                  </div>
                )}

                {/* Action row — fades in only after completion to avoid layout jump */}
                <motion.div
                  initial={false}
                  animate={{
                    height: generating ? 0 : 'auto',
                  }}
                  transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
                  // Gemini leaves 4px between the notice and the button row,
                  // replacing the wrapper's 12px rhythm for this one case.
                  style={msg.wasStopped ? { marginTop: 4 } : undefined}
                  className={`overflow-visible transition-opacity duration-[240ms] ease-[cubic-bezier(0.2,0,0,1)] ${
                    generating
                      ? 'pointer-events-none opacity-0'
                      : isLatestCompletedTurn
                        ? 'opacity-100'
                        : 'pointer-events-none opacity-0 group-hover/assistant-response:pointer-events-auto group-hover/assistant-response:opacity-100 group-focus-within/assistant-response:pointer-events-auto group-focus-within/assistant-response:opacity-100'
                  }`}
                >
                  <ResponseActions
                    reaction={reactions[msg.id] || null}
                    copied={copiedId === msg.id}
                    listening={listeningId === msg.id}
                    canRedo={isLastAssistant}
                    canShowThinking={!msg.isError}
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
                    onListen={() => handleListen(msg)}
                    onShowThinking={() => handleOpenThinking(msg.id)}
                  />
                </motion.div>
                </div>
              </div>
            );
          })}
        </motion.div>
      </div>

      {/* Bottom-docked input (footer). Position relative makes it a sibling in the
          flex column, ensuring the scroller above it terminates correctly instead
          of spanning under it. */}
      <div
        ref={footerRef}
        className="relative z-30 flex shrink-0 flex-col items-center"
      >
        {/* Gemini's native 28px fading gradient overlay that covers the bottom edge of the scroller */}
        <div
          className="pointer-events-none absolute bottom-full left-0 right-0 h-[28px] w-full"
          style={{
            background: 'linear-gradient(to bottom, transparent 0px, rgba(15,15,15, 0.5) 50%, rgba(15,15,15, 0.85) 75%, rgba(15,15,15, 0.99) 95%, rgba(15,15,15, 1) 100%)',
          }}
        />
        {/* Voice orb — Labs experiment, live sessions only. The focus surface is
            fixed-positioned and owns its own placement, so it sits outside the
            footer's flow. AnimatePresence lets the scale-out exit run before the
            node unmounts. */}
        <AnimatePresence>
          {showVoiceOrb && (
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
        {/* Voice settings — the trigger rides the same experiment and the same
            live-session gate as the orb, and the panel draws the orb itself, so
            neither exists outside a live session. */}
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
              orbProps={{
                connected: isLiveConnected,
                isUserSpeaking,
                isAssistantSpeaking,
                analyser: liveAnalysers.mic,
                assistantAnalyser: liveAnalysers.output,
                workspaceColor,
              }}
            />
          </>
        )}
        <div
          className="w-full flex justify-center px-4 pb-[49px] pointer-events-auto bg-[#0f0f0f]"
        >
          <motion.div
            layoutId={CHAT_COMPOSER_LAYOUT_ID}
            transition={{
              layout: {
                duration: 0.25,
                ease: [0.2, 0, 0, 1] as const,
              },
            }}
            className="w-full max-w-[660px]"
          >
            <InputBar
              chatVariant
              showDisclaimer
              currentMode="chat"
              onModeChange={() => {}}
              onSubmit={(prompt, _mode, attachments) => {
                // Typing + Enter while live implicitly ends the voice session and
                // falls back to the regular typed path.
                if (isLive) handleStopLive();
                handleSend(prompt, undefined, attachments);
              }}
              liveActive={isLive}
              onStartLive={handleStartLive}
              onStopLive={handleStopLive}
              isGenerating={isGenerating}
              onStopGenerating={handleStopGenerating}
              modelConfig={modelConfig}
              selectedModelId={selectedModelId}
              setSelectedModelId={setSelectedModelId}
              onAuthRequired={onAuthRequired}
              isAuthenticated={isAuthenticated}
            />
          </motion.div>
        </div>
      </div>
      </div>

      <AnimatePresence>
        {thinkingMessage && (
          <ThinkingStepsSidebar
            key={thinkingMessage.id}
            thinkingText={thinkingMessage.thinkingText || ''}
            modelLabel={thinkingMessage.modelSnapshot?.label || 'Model'}
            onClose={() => setOpenThinkingMessageId(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {openResource && (
          <RichResourcePanel
            key="willow-rich-resource-panel"
            resource={openResource}
            onClose={() => setOpenResource(null)}
          />
        )}
      </AnimatePresence>
    </div>
    </LayoutGroup>
  );
};

export default ChatView;
