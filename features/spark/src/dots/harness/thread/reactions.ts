/**
 * Reactions in a bot's conversation, both ways, as in a messenger: one reaction per person per
 * message, a new one replacing the old, any emoji. The bot's (`reaction` items) are on the user's
 * messages; the user's (`user-reaction` items) on the bot's also come back off when the same one is
 * chosen again. Both are folded from the append-only record, never edited in place.
 */
import type { DotItem, DotThread } from './thread-types';

/** The bot's reaction on each of the user's messages — its latest — by message id. */
export const dotReactionsByMessage = (thread: Pick<DotThread, 'items'>): Map<string, DotItem[]> => {
  const reactions = new Map<string, DotItem[]>();
  for (const item of thread.items) {
    if (item.kind === 'reaction' && item.target) reactions.set(item.target, [item]);
  }
  return reactions;
};

/** The user's current reaction on each of the bot's messages, by message id. */
export const userReactionsByMessage = (thread: Pick<DotThread, 'items'>): Map<string, string> => {
  const current = new Map<string, string>();
  for (const item of thread.items) {
    if (item.kind !== 'user-reaction' || !item.target || !item.emoji) continue;
    if (!item.removed) current.set(item.target, item.emoji);
    else if (current.get(item.target) === item.emoji) current.delete(item.target);
  }
  return current;
};

/** A message's Markdown as one line of plain text. */
export const plainMessageText = (markdown: string): string => markdown
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
  .replace(/[*_~`]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const EXCERPT_CHARS = 120;

/** The start of a message, as a reaction on it quotes it to the bot. */
export const messageExcerpt = (markdown: string): string => {
  const text = plainMessageText(markdown);
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : text;
};

/** The emoji that says the user is unsure about a message — worth the bot's attention whatever it said. */
const UNSURE = '🤔';

/**
 * Whether a reaction may be the user's answer, and so should wake the dot: the message asks the
 * user something and they have not written since, or the emoji says they are unsure. Anything
 * else is an acknowledgement, which the bot reads the next time it acts.
 */
export const reactionMayAnswer = (thread: Pick<DotThread, 'items'>, message: DotItem, emoji: string): boolean => {
  if (emoji === UNSURE) return true;
  if (!plainMessageText(message.text).includes('?')) return false;
  return !thread.items.some((item) => item.kind === 'user' && item.seq > message.seq);
};
