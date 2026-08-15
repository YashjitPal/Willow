import { atom } from 'nanostores';
import type { StreamPhase } from '@willow/ai/chat';
import type { MessageCitations } from '@willow/ai/grounding';
import type { ChatMsg } from './chat-message';

/**
 * In-flight chat turns, owned outside React so a response survives the user
 * leaving the chat.
 *
 * Leaving used to destroy the reply. The stream kept running, but `onThought`
 * and `finalizeAssistant` both located their target with
 * `prev.map(m => m.id === assistantId ? ... : m)` against a `messages` array the
 * load effect had already replaced — no match, no error, tokens dropped. And
 * ChatView is genuinely unmounted by the Code/Media tabs, New Chat and
 * Incognito, so nothing component-scoped can hold a turn across those.
 *
 * So a turn lives here instead. Leaving detaches a listener; it does not stop a
 * turn. Returning re-attaches and the text keeps arriving.
 *
 * Shape follows Spark, which solved the same problem for background tasks:
 * a module-level controller map plus an identity guard re-validated on every
 * callback (`features/spark/src/SparkWorkspace.tsx` `sparkRunControllers` /
 * `isCurrentRun`).
 */

/** What an attached ChatView needs told. At most one listener per turn. */
export interface ChatTurnListener {
  /** Streamed body text so far. */
  onText: (content: string) => void;
  /** Thinking transcript grew. */
  onThinking: (record: ChatTurnRecord) => void;
  /** Phase / thinking-row state changed. */
  onPhase: (record: ChatTurnRecord) => void;
  /** Terminal. Fires exactly once, and may fire before the listener attaches. */
  onSettled: (record: ChatTurnRecord) => void;
}

export interface ChatTurnRecord {
  /**
   * Stable for the turn's whole life — this is the map key. Deliberately NOT the
   * chat id: a chat is renamed out from under a running turn (temp id -> real
   * title) and the turn must stay findable. `assistantId` is used, so the record
   * and the message it fills in share one identity.
   */
  turnId: string;

  // ── identity ───────────────────────────────────────────────────────────────
  /** Current chat id. Rewritten by `rebindChatTurnChatId` on rename/adoption. */
  chatId: string;
  /** Every id this turn has lived under, newest last. Lookup fallback, so a
   *  missed rebind event degrades to stale-but-findable rather than lost. */
  chatIdHistory: string[];
  /** Chat storage scope at start. A turn whose scope moved must never write —
   *  it would land in another account's namespace. */
  scopeId: string;
  /** Incognito turns never persist, so they never checkpoint or save. */
  isIncognito: boolean;

  // ── the turn ───────────────────────────────────────────────────────────────
  /** The thread BEFORE this turn. Attachment blob URLs are stripped: they belong
   *  to the ChatView instance that created them and are revoked on its unmount. */
  historyBefore: ChatMsg[];
  userMessage: ChatMsg;
  assistantId: string;
  modelSnapshot: ChatMsg['modelSnapshot'];

  // ── accumulators (what used to be `acc` / `thoughtAcc` / `citationsAcc`) ────
  content: string;
  thinkingText: string;
  citations?: MessageCitations;

  // ── thinking row (was thinkTimer / thinkStart / thinkSecondsRef) ────────────
  phase: StreamPhase;
  isThinking: boolean;
  thinkStartedAt: number;
  thinkSeconds: number;

  // ── lifecycle ──────────────────────────────────────────────────────────────
  abort: AbortController;
  status: 'running' | 'settled';
  /** Who owns writing the result to disk. Claimed synchronously at settle time
   *  so an attached view and the runner can never both save. */
  settledBy: 'runner' | 'view' | null;
  wasStopped: boolean;
  isError: boolean;
  /** Raw final provider error, never persisted or rendered in the assistant bubble. */
  errorDetail?: string;
  /** Final content, set at settle. Lets a late-attaching view render the result. */
  finalContent: string;
  /** False until the result reached disk. A settled-but-unpersisted record is
   *  retried by the next view that attaches, then removed. */
  persisted: boolean;
  lastCheckpointAt: number;

  listener: ChatTurnListener | null;
}

/**
 * Vite re-evaluates this module on HMR, which would orphan every running turn:
 * its AbortController becomes unreachable and its listener dangles against a
 * component that has since re-rendered. Parking the map on globalThis keeps one
 * instance across reloads. (Spark's equivalent map does not do this and pays for
 * it in dev.)
 */
const TURNS_KEY = Symbol.for('willow.chatTurns');
const globalScope = globalThis as unknown as Record<symbol, Map<string, ChatTurnRecord>>;
const turnsById: Map<string, ChatTurnRecord> =
  globalScope[TURNS_KEY] ?? (globalScope[TURNS_KEY] = new Map());

/**
 * Coarse signal only — start, rebind, settle, remove. Deliberately NOT bumped
 * per token: streamed text reaches the UI through `record.listener`, so nothing
 * subscribes to this on the hot path.
 */
export const chatTurnsVersion = atom(0);
const bump = () => chatTurnsVersion.set(chatTurnsVersion.get() + 1);

export const registerChatTurn = (record: ChatTurnRecord): void => {
  turnsById.set(record.turnId, record);
  bump();
};

export const getChatTurn = (turnId: string): ChatTurnRecord | undefined =>
  turnsById.get(turnId);

/** Newest matching record for a chat, preferring a running one. */
export const getChatTurnByChatId = (chatId: string | null | undefined): ChatTurnRecord | undefined => {
  if (!chatId) return undefined;
  let stale: ChatTurnRecord | undefined;
  for (const record of turnsById.values()) {
    // The history fallback matters when a rebind event was missed: the record is
    // still reachable under the id the turn started on.
    const matches = record.chatId === chatId || record.chatIdHistory.includes(chatId);
    if (!matches) continue;
    if (record.status === 'running') return record;
    stale = record;
  }
  return stale;
};

export const hasRunningTurnForChat = (chatId: string | null | undefined): boolean =>
  getChatTurnByChatId(chatId)?.status === 'running';

export const countRunningChatTurns = (): number => {
  let count = 0;
  for (const record of turnsById.values()) if (record.status === 'running') count += 1;
  return count;
};

/**
 * Follow a chat id move. Idempotent, so the storage-layer event and the title
 * effect's eager call can both fire.
 */
export const rebindChatTurnChatId = (from: string, to: string): void => {
  if (!from || !to || from === to) return;
  let changed = false;
  for (const record of turnsById.values()) {
    if (record.chatId !== from) continue;
    if (!record.chatIdHistory.includes(from)) record.chatIdHistory.push(from);
    record.chatId = to;
    changed = true;
  }
  if (changed) bump();
};

/**
 * Decide, in one synchronous tick, who writes the result to disk. Returns null
 * if the turn already settled.
 *
 * The claim cannot span an await: a view detaching between "is anyone watching?"
 * and the write would leave the turn saved by nobody, and one attaching would
 * have it saved twice — and `saveLocalFSChat` is a whole-file replace, so the
 * loser's array wins.
 */
export const claimChatTurnSettlement = (turnId: string): 'runner' | 'view' | null => {
  const record = turnsById.get(turnId);
  if (!record || record.status === 'settled') return null;
  record.status = 'settled';
  record.settledBy = record.listener ? 'view' : 'runner';
  return record.settledBy;
};

/**
 * Attach the displayed ChatView. Returns the record so the caller can sync any
 * state that landed between its render commit and this effect.
 */
export const attachChatTurnListener = (
  turnId: string,
  listener: ChatTurnListener,
): ChatTurnRecord | null => {
  const record = turnsById.get(turnId);
  if (!record) return null;
  record.listener = listener;
  return record;
};

/** Compare-and-clear: StrictMode double-invokes effects, so a blind clear here
 *  would drop the listener the second attach just installed. */
export const detachChatTurnListener = (turnId: string, listener: ChatTurnListener): void => {
  const record = turnsById.get(turnId);
  if (record && record.listener === listener) record.listener = null;
};

export const removeChatTurn = (turnId: string): void => {
  if (turnsById.delete(turnId)) bump();
};

/**
 * Abort every turn for a chat and forget them without saving.
 *
 * Used for delete, where saving would be actively harmful: `saveLocalFSChat`
 * writes `tombstone: false` and pushes the id back into the chat list, so a
 * completion landing after a delete resurrects the deleted chat in IndexedDB,
 * in Recents and on disk.
 */
export const abortChatTurnsForChat = (chatId: string): void => {
  let changed = false;
  for (const record of turnsById.values()) {
    if (record.chatId !== chatId && !record.chatIdHistory.includes(chatId)) continue;
    record.abort.abort();
    turnsById.delete(record.turnId);
    changed = true;
  }
  if (changed) bump();
};

/** Sign-out, account/workspace switch, disconnect. Nothing may outlive a scope
 *  change: `chatStorageScopeRef` is reassigned, so a late write lands in the
 *  next scope's namespace under this scope's chat name. */
export const abortAllChatTurns = (): void => {
  if (turnsById.size === 0) return;
  for (const record of turnsById.values()) record.abort.abort();
  turnsById.clear();
  bump();
};

/**
 * Follow chat id moves and deletions from the storage layer.
 *
 * Subscribed at module scope, not from a component, because the whole point is
 * that this keeps working while ChatView is unmounted.
 */
if (typeof window !== 'undefined') {
  const MOVED = 'willow_chat_id_moved';
  const DELETED = 'willow_chat_deleted';
  const SCOPE_CHANGING = 'willow_chat_scope_changing';
  // Guard against double-subscription across an HMR re-eval.
  const SUBSCRIBED_KEY = Symbol.for('willow.chatTurns.subscribed');
  const scope = globalThis as unknown as Record<symbol, boolean>;
  if (!scope[SUBSCRIBED_KEY]) {
    scope[SUBSCRIBED_KEY] = true;
    window.addEventListener(MOVED, (event: Event) => {
      const detail = (event as CustomEvent<{ from?: string; to?: string }>).detail;
      if (detail?.from && detail?.to) rebindChatTurnChatId(detail.from, detail.to);
    });
    window.addEventListener(DELETED, (event: Event) => {
      const chatId = (event as CustomEvent<{ chatId?: string }>).detail?.chatId;
      if (chatId) abortChatTurnsForChat(chatId);
    });
    window.addEventListener(SCOPE_CHANGING, () => { abortAllChatTurns(); });
  }
}
