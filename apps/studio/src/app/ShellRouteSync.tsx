import React from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useStore } from '@nanostores/react';
import type { StudioExperience } from '@willow/core/types';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { chatSelectionEpoch } from '@willow/storage/local-fs/chat-selection-store';
import { checkCodeChat } from '@willow/storage/code-chat-storage';
import { pendingCodeChatOpen, requestCodeChatOpen } from '@willow/storage/code-chat-open-store';
import { $codeScreenChats } from '@willow/code/workbench/code-turn-activity';
import { replaceSparkLocation, sparkHydrationScope, sparkLocation } from '@willow/spark/spark-store';
import { sparkPathFor } from '@willow/spark/spark-routes';
import { $chatCreationPage, $chatCreationPageRequest } from '@willow/chat/chat-page-store';
import type { ViewType } from '../shell/sidebar/Sidebar';
import { isShellPath, parseShellPath, shellPathFor, shellSearch, type ShellRoute } from './shell-routes';

type StudioMode = 'chat' | 'develop' | 'media';

interface ShellRouteSyncProps {
  currentView: ViewType;
  studioExperience: StudioExperience;
  studioMode: StudioMode;
  isIncognito: boolean;
  /** The Code home on show, whose conversation `/code/<chat>` names. */
  codeHomeKey: string;
  setStudioExperience: (experience: StudioExperience) => void;
  setStudioMode: (mode: StudioMode) => void;
  /** What New chat does after clearing the open chat. */
  onNewChat: () => void;
}

/** An address the URL named that is still opening: its chat list, chat or Spark state is being read. */
interface Pending {
  route: ShellRoute;
  /** Set once its chat has been asked to open; the address waits until it has. */
  asked?: boolean;
}

/* A named chat that never opens (deleted, renamed elsewhere) stops holding the address. */
const PENDING_OPEN_MS = 10_000;
/* How long a click's chat has to open for its address to be a step of its own. */
const PUSH_INTENT_MS = 2_000;

/**
 * Keeps the address bar on the surface on show (`shell-routes.ts`), and opens
 * the surface an address names. Renders nothing.
 *
 * The URL decides on a page load and on Back/Forward (a POP navigation); the
 * shell decides the rest of the time, and this writes the URL to match. A user
 * step — another surface, a chat picked, a Code chat opened — is a history entry
 * of its own; anything else (a chat taking its title, `/` becoming `/app`, an
 * address that named a chat that is not there) replaces the entry it is on.
 * Only the shell's own paths are rewritten: a Gem, a notebook, a settings page
 * and the Media and Code project editors keep theirs.
 */
export const ShellRouteSync: React.FC<ShellRouteSyncProps> = ({
  currentView,
  studioExperience,
  studioMode,
  isIncognito,
  codeHomeKey,
  setStudioExperience,
  setStudioMode,
  onNewChat,
}) => {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const { activeChatId, chatScopeId, isChatListHydrated, localChats, loadLocalFSChat, selectLocalFSInboxChat } = useLocalFS();
  const codeChatId = useStore($codeScreenChats)[codeHomeKey] ?? null;
  const spark = useStore(sparkLocation);
  const isSparkHydrated = useStore(sparkHydrationScope) !== null;
  const selectionEpoch = useStore(chatSelectionEpoch);
  const codeOpenRequest = useStore(pendingCodeChatOpen);
  const creationPage = useStore($chatCreationPage);
  const shownChatId = isIncognito ? null : activeChatId;

  const route: ShellRoute | null = currentView !== 'home'
    ? null
    : studioExperience === 'spark'
      ? { surface: 'spark', location: spark }
      : studioMode === 'chat'
        ? (shownChatId === null && creationPage ? { surface: 'chat', chatId: null, page: creationPage } : { surface: 'chat', chatId: shownChatId })
        : studioMode === 'develop'
          ? { surface: 'code', chatId: codeChatId }
          : { surface: 'media' };

  const pendingRef = React.useRef<Pending | null>(null);
  const [pendingVersion, setPendingVersion] = React.useState(0);
  const settle = () => {
    pendingRef.current = null;
    setPendingVersion((version) => version + 1);
  };
  // The next write corrects the address to what opened; it is not a step of its own.
  const replaceNextRef = React.useRef(false);
  // The surface the address just switched to. The switch lands a render later, and
  // the writer, running beside it with the state from before, waits for it.
  const expectedSurfaceRef = React.useRef<ShellRoute['surface'] | null>(null);

  const showSurface = (surface: ShellRoute['surface']) => {
    expectedSurfaceRef.current = surface;
    if (surface === 'spark') {
      if (studioExperience !== 'spark') setStudioExperience('spark');
      return;
    }
    if (studioExperience !== 'chat') setStudioExperience('chat');
    const mode: StudioMode = surface === 'chat' ? 'chat' : surface === 'code' ? 'develop' : 'media';
    if (studioMode !== mode) setStudioMode(mode);
  };

  // ── The URL decides: a page load, or Back/Forward ──────────────────────────
  // Each navigation is its own `location` object, the same one across renders. Not
  // its key: Spark's own entries copy the key of the entry they came from, and an
  // entry loaded with the page has none — going Back to it twice would look like one.
  const handledLocationRef = React.useRef<typeof location | null>(null);
  React.useEffect(() => {
    if (navigationType !== 'POP' || handledLocationRef.current === location) return;
    handledLocationRef.current = location;
    const wanted = parseShellPath(window.location.pathname);
    if (!wanted) return;
    showSurface(wanted.surface);
    pendingRef.current = wanted.surface === 'media' ? null : { route: wanted };
    replaceNextRef.current = true;
    setPendingVersion((version) => version + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, navigationType]);

  // Opens what the address names, once what it needs has been read.
  const checkSequenceRef = React.useRef(0);
  React.useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return undefined;
    const wanted = pending.route;

    // Each case acts once (`asked`) and settles on the render where the shell shows what the
    // address named: the writer runs beside the act, with the state from before it.
    const giveUpLater = () => {
      const timer = window.setTimeout(() => {
        if (pendingRef.current === pending) settle();
      }, PENDING_OPEN_MS);
      return () => window.clearTimeout(timer);
    };

    if (wanted.surface === 'spark') {
      // Spark reads its last page back as it starts, into the entry's state too; the
      // address's page goes on top of it, in both. On Back/Forward Spark reads the
      // entry's state before the router hands over the address, so the two must agree.
      if (!isSparkHydrated) return undefined;
      if (sparkPathFor(spark) === sparkPathFor(wanted.location)) {
        settle();
        return undefined;
      }
      if (!pending.asked) {
        pending.asked = true;
        replaceSparkLocation(wanted.location);
      }
      return giveUpLater();
    }
    if (wanted.surface === 'media') {
      settle();
      return undefined;
    }

    // A chat, Chat's or Code's. `/` with no chat named is a new one, or the Code home as it is.
    if (!isChatListHydrated) return undefined;
    const chatId = wanted.chatId;
    if (chatId === null) {
      // `/images` and `/videos` are a new chat with a tool picked: the chat view picks it.
      if (wanted.surface === 'chat' && wanted.page && !pending.asked) $chatCreationPageRequest.set(wanted.page);
      if (wanted.surface !== 'chat' || activeChatId === null) {
        settle();
        return undefined;
      }
      if (!pending.asked) {
        pending.asked = true;
        selectLocalFSInboxChat(null);
        onNewChat();
      }
      return giveUpLater();
    }
    if (!localChats.includes(chatId)) {
      settle();
      return undefined;
    }
    const isOpen = wanted.surface === 'chat' ? activeChatId === chatId : codeChatId === chatId;
    if (isOpen) {
      settle();
      return undefined;
    }
    if (!pending.asked) {
      pending.asked = true;
      const sequence = ++checkSequenceRef.current;
      // Code or Chat by what the chat is, whichever path named it.
      void checkCodeChat(chatScopeId, chatId, loadLocalFSChat).then((isCode) => {
        if (sequence !== checkSequenceRef.current || pendingRef.current !== pending) return;
        pending.route = isCode ? { surface: 'code', chatId } : { surface: 'chat', chatId };
        showSurface(pending.route.surface);
        replaceNextRef.current = true;
        if (isCode) requestCodeChatOpen(chatId);
        else selectLocalFSInboxChat(chatId);
        setPendingVersion((version) => version + 1);
      });
    }
    return giveUpLater();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVersion, isChatListHydrated, activeChatId, localChats, codeChatId, isSparkHydrated, spark]);

  // ── The shell decides: the URL follows ─────────────────────────────────────
  const lastSurfaceRef = React.useRef<ShellRoute['surface'] | null>(null);
  const desired = route ? shellPathFor(route) : null;
  // A chat picked (or New chat), and a Code chat opened, are steps of their own in the
  // history. The signal and the chat it opens can land renders apart, so the step is
  // the next address change, if it comes soon.
  const pushIntentAtRef = React.useRef<number | null>(null);
  const seenSelectionRef = React.useRef(selectionEpoch);
  React.useEffect(() => {
    if (seenSelectionRef.current === selectionEpoch) return;
    seenSelectionRef.current = selectionEpoch;
    pushIntentAtRef.current = Date.now();
  }, [selectionEpoch]);
  React.useEffect(() => {
    if (codeOpenRequest) pushIntentAtRef.current = Date.now();
  }, [codeOpenRequest]);
  React.useEffect(() => {
    if (!route || !desired) return;
    const expected = expectedSurfaceRef.current;
    if (expected) {
      if (route.surface !== expected) return;
      expectedSurfaceRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      // Still opening what the address named: leave the address be, unless the user moved on.
      if (pending.route.surface === route.surface) return;
      pendingRef.current = null;
    }
    const actual = window.location.pathname;
    if (!isShellPath(actual)) return;
    const search = shellSearch(window.location.search);
    const isSurfaceChange = lastSurfaceRef.current !== null && lastSurfaceRef.current !== route.surface;
    lastSurfaceRef.current = route.surface;
    const intentAt = pushIntentAtRef.current;
    const isUserStep = intentAt !== null && Date.now() - intentAt < PUSH_INTENT_MS;
    // `/` names nothing of its own: it becomes the surface's address in place.
    const replace = replaceNextRef.current || actual === '/' || !(isUserStep || isSurfaceChange);
    replaceNextRef.current = false;
    pushIntentAtRef.current = null;
    if (actual === desired && search === window.location.search) return;
    if (route.surface === 'spark') {
      // Spark pushes its own entries and keeps its page in their state: only the address changes.
      window.history.replaceState(window.history.state, '', desired + search);
      return;
    }
    navigate(desired + search, { replace });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desired, location, pendingVersion]);

  return null;
};

export default ShellRouteSync;
