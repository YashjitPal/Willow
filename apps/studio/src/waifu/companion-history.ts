/**
 * The Labs companion's conversation, kept in this browser (`COMPANION_HISTORY_KEY`) and, through
 * `register-companion-history.ts`, as `Labs/Companion/history.json` in the user's folder. Shared by
 * the store and the folder's registration, which loads at startup and so must not pull the
 * companion in.
 */

export const COMPANION_HISTORY_KEY = 'willow:waifu:history';
/** Raised in this tab when the folder's history replaces this browser's; `detail` is the history. */
export const COMPANION_HISTORY_EVENT = 'willow:companion-history';
/** The newest messages kept: enough for any conversation worth going back to, well inside localStorage. */
export const COMPANION_HISTORY_LIMIT = 500;

export interface CompanionMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  emotion?: string;
  timestamp: number;
}

const isMessage = (value: unknown): value is CompanionMessage => {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return typeof message.id === 'string'
    && (message.role === 'user' || message.role === 'assistant')
    && typeof message.text === 'string'
    && typeof message.timestamp === 'number'
    && (message.emotion === undefined || typeof message.emotion === 'string');
};

/** The messages in `value`, or `null` when it is not a history at all. */
export const parseCompanionHistory = (value: unknown): CompanionMessage[] | null =>
  Array.isArray(value) ? value.filter(isMessage).slice(-COMPANION_HISTORY_LIMIT) : null;

/** This browser's history, or `null` when it has none. */
export const readCompanionHistory = (): CompanionMessage[] | null => {
  try {
    const stored = localStorage.getItem(COMPANION_HISTORY_KEY);
    return stored === null ? null : parseCompanionHistory(JSON.parse(stored));
  } catch {
    return null;
  }
};

/** Anything past the persona's greeting, which every new conversation starts with. */
export const hasConversation = (history: readonly CompanionMessage[]): boolean =>
  history.some((message) => message.role === 'user' || !message.id.startsWith('welcome'));
