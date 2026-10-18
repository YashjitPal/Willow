/**
 * Gemini's conversation statuses: the mark at the end of a drawer row (`remy-goal-status-badge`)
 * and the drawer's filter by them (All, Ready, Needs attention, In progress). Measured in
 * tools/ui-research/captures/gemini/sort/.
 *
 * A row shows one mark, in Gemini's order: Needs input (a flag), else In progress (a turning
 * spinner), else Unread (a dot). Gemini's come from its server; Willow's from what it knows:
 *
 * - In progress: a reply still being written for the chat (`chat-turn-store`), or a Deep
 *   Research run still going for it.
 * - Unread: a reply or a research report that finished while the chat was not on screen.
 * - Needs input: one that failed while the chat was not on screen.
 *
 * Unread and Needs input are kept per chat scope (account and folder) until the chat is opened.
 * The filter on show is not kept across a reload, as Gemini's is not.
 */
import { atom } from 'nanostores';
import { getChatTurnByChatId } from './chat-turn-store';

export type ChatStatus = 'needs-input' | 'in-progress' | 'unread';

export type ChatStatusFilter = 'ALL' | 'READY' | 'NEEDS_ATTENTION' | 'IN_PROGRESS';

/** The menu's rows, in Gemini's order. */
export const CHAT_STATUS_FILTERS: readonly ChatStatusFilter[] = ['ALL', 'READY', 'NEEDS_ATTENTION', 'IN_PROGRESS'];

const FILTER_LABELS: Record<ChatStatusFilter, string> = {
  ALL: 'All',
  READY: 'Ready',
  NEEDS_ATTENTION: 'Needs attention',
  IN_PROGRESS: 'In progress',
};

/** The menu row's label, which is also the chat section's heading while the filter is on. */
export const chatStatusFilterLabel = (filter: ChatStatusFilter): string => FILTER_LABELS[filter];

/** Gemini's Ready lists the chats with something new in them: Willow's Unread. */
export const matchesChatStatusFilter = (status: ChatStatus | null, filter: ChatStatusFilter): boolean =>
  filter === 'ALL'
  || (filter === 'READY' && status === 'unread')
  || (filter === 'NEEDS_ATTENTION' && status === 'needs-input')
  || (filter === 'IN_PROGRESS' && status === 'in-progress');

/** The badge's tooltip, as Gemini words it. */
export const chatStatusLabel = (status: ChatStatus): string =>
  status === 'needs-input' ? 'Needs input' : status === 'in-progress' ? 'In progress' : 'Unread';

export const $chatStatusFilter = atom<ChatStatusFilter>('ALL');

/** Bumped whenever a mark may have changed (flags, research runs). Turns have `chatTurnsVersion`. */
export const chatStatusVersion = atom(0);
const bump = () => chatStatusVersion.set(chatStatusVersion.get() + 1);

// ── Unread and Needs input, kept per scope ──────────────────────────────────────

type Flag = 'unread' | 'needs-input';
type Flags = Record<string, Flag>;

const STORAGE_PREFIX = 'willow_chat_status:';
const storageKey = (scopeId: string): string => `${STORAGE_PREFIX}${encodeURIComponent(scopeId)}`;
const flagsByScope = new Map<string, Flags>();

const readFlags = (scopeId: string): Flags => {
  let flags = flagsByScope.get(scopeId);
  if (flags) return flags;
  flags = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(scopeId)) || '{}');
    if (parsed && typeof parsed === 'object') {
      for (const [chatId, flag] of Object.entries(parsed)) {
        if (flag === 'unread' || flag === 'needs-input') flags[chatId] = flag;
      }
    }
  } catch {
    // Unreadable or no storage: no marks.
  }
  flagsByScope.set(scopeId, flags);
  return flags;
};

const writeFlags = (scopeId: string, flags: Flags): void => {
  flagsByScope.set(scopeId, flags);
  try {
    if (Object.keys(flags).length) localStorage.setItem(storageKey(scopeId), JSON.stringify(flags));
    else localStorage.removeItem(storageKey(scopeId));
  } catch {
    // Kept for this session only.
  }
  bump();
};

const setFlag = (scopeId: string, chatId: string, flag: Flag | null): void => {
  if (!scopeId || !chatId) return;
  const current = readFlags(scopeId);
  if ((current[chatId] ?? null) === flag) return;
  const next = { ...current };
  if (flag) next[chatId] = flag;
  else delete next[chatId];
  writeFlags(scopeId, next);
};

// ── What is on screen ───────────────────────────────────────────────────────────

/** Whether Chat is the surface on show. App owns that and keeps this in step. */
export const $chatSurfaceOnShow = atom(false);

/** The ids ChatView has open (a chat being named moves between two) and the scope they are in. */
let onScreen: { scopeId: string; ids: readonly string[] } = { scopeId: '', ids: [] };

export const isChatOnScreen = (chatId: string): boolean =>
  $chatSurfaceOnShow.get() && onScreen.ids.includes(chatId);

const clearOnScreen = (): void => {
  if (!$chatSurfaceOnShow.get()) return;
  for (const chatId of onScreen.ids) setFlag(onScreen.scopeId, chatId, null);
};

/** ChatView reports what it has open; a chat on screen is a chat seen. */
export const reportChatOnScreen = (scopeId: string, ids: readonly (string | null | undefined)[]): void => {
  onScreen = { scopeId, ids: [...new Set(ids.filter((id): id is string => !!id))] };
  clearOnScreen();
};

$chatSurfaceOnShow.listen(() => { clearOnScreen(); });

// ── Marks from turns and research runs ──────────────────────────────────────────

/** A reply finished. One the user stopped, or an incognito one, leaves no mark. */
export const noteChatTurnSettled = (turn: {
  scopeId: string;
  chatId: string;
  chatIdHistory: readonly string[];
  isIncognito: boolean;
  isError: boolean;
  wasStopped: boolean;
}): void => {
  if (turn.isIncognito || turn.wasStopped) return;
  if ([turn.chatId, ...turn.chatIdHistory].some(isChatOnScreen)) return;
  setFlag(turn.scopeId, turn.chatId, turn.isError ? 'needs-input' : 'unread');
};

type ResearchStatus = 'running' | 'done' | 'error' | 'canceled' | string;

/** Research runs by key (the run's message id): which chat and scope each belongs to, and how it is going. */
const research = new Map<string, { scopeId: string; chatId: string; status: ResearchStatus }>();

/** ChatView starts a run: say which chat it is for, so its marks land there. */
export const trackResearchChat = (key: string, scopeId: string, chatId: string): void => {
  const current = research.get(key);
  research.set(key, { scopeId, chatId, status: current?.status ?? 'running' });
  bump();
};

/** The research runner reports each change of a run's status. */
export const noteResearchStatus = (key: string, status: ResearchStatus): void => {
  const entry = research.get(key);
  if (!entry || entry.status === status) return;
  entry.status = status;
  if (!isChatOnScreen(entry.chatId)) {
    if (status === 'done') setFlag(entry.scopeId, entry.chatId, 'unread');
    else if (status === 'error') setFlag(entry.scopeId, entry.chatId, 'needs-input');
  }
  bump();
};

const isChatInProgress = (chatId: string): boolean => {
  if (getChatTurnByChatId(chatId)?.status === 'running') return true;
  for (const entry of research.values()) if (entry.chatId === chatId && entry.status === 'running') return true;
  return false;
};

/** The chat's mark, in Gemini's order of precedence. */
export const chatStatusOf = (scopeId: string, chatId: string): ChatStatus | null => {
  const flag = readFlags(scopeId)[chatId];
  if (flag === 'needs-input') return 'needs-input';
  if (isChatInProgress(chatId)) return 'in-progress';
  return flag === 'unread' ? 'unread' : null;
};

// ── Following the storage layer ─────────────────────────────────────────────────

const moveChat = (from: string, to: string): void => {
  for (const [scopeId, flags] of flagsByScope) {
    if (!(from in flags)) continue;
    const next = { ...flags, [to]: flags[from] };
    delete next[from];
    writeFlags(scopeId, next);
  }
  for (const entry of research.values()) if (entry.chatId === from) entry.chatId = to;
  bump();
};

const forgetChat = (chatId: string): void => {
  for (const [scopeId, flags] of flagsByScope) {
    if (!(chatId in flags)) continue;
    const next = { ...flags };
    delete next[chatId];
    writeFlags(scopeId, next);
  }
};

const forgetCachedScope = (key: string): void => {
  flagsByScope.delete(decodeURIComponent(key.slice(STORAGE_PREFIX.length)));
  bump();
};

if (typeof window !== 'undefined') {
  // Subscribed once per page; the handlers are this evaluation's, so after an HMR
  // re-evaluation events reach the module that is current, not the first one.
  const HANDLERS_KEY = Symbol.for('willow.chatStatus.handlers');
  const globalScope = globalThis as unknown as Record<symbol, {
    moveChat: typeof moveChat;
    forgetChat: typeof forgetChat;
    forgetCachedScope: typeof forgetCachedScope;
  } | undefined>;
  const subscribed = !!globalScope[HANDLERS_KEY];
  globalScope[HANDLERS_KEY] = { moveChat, forgetChat, forgetCachedScope };
  if (!subscribed) {
    const handlers = () => globalScope[HANDLERS_KEY]!;
    window.addEventListener('willow_chat_id_moved', (event: Event) => {
      const detail = (event as CustomEvent<{ from?: string; to?: string }>).detail;
      if (detail?.from && detail?.to && detail.from !== detail.to) handlers().moveChat(detail.from, detail.to);
    });
    window.addEventListener('willow_chat_deleted', (event: Event) => {
      const chatId = (event as CustomEvent<{ chatId?: string }>).detail?.chatId;
      if (chatId) handlers().forgetChat(chatId);
    });
    // Another tab marked or opened a chat.
    window.addEventListener('storage', (event: StorageEvent) => {
      if (event.key?.startsWith(STORAGE_PREFIX)) handlers().forgetCachedScope(event.key);
    });
  }
}
