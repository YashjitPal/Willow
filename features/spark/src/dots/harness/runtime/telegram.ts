/**
 * A bot on Telegram: the user talks to one bot from their phone through a bot of their own (made with @BotFather),
 * and the bot answers there — Hermes's messaging gateway, for the times the user is away from this computer.
 *
 * Telegram's API refuses browsers, so it is reached through Willow's companion (`relay.telegram`). One window
 * polls, holding a lock. The bot answers one chat only: the one that sent the pairing code Willow showed, so
 * nobody else who finds the bot can reach the bot.
 */
import { atom } from 'nanostores';

export interface TelegramLink {
  token: string;
  dotId: string;
  /** What the user sends the bot to pair their chat. */
  code: string;
  chatId?: number;
  chatName?: string;
  /** The next update to read. */
  offset?: number;
}

/** Telegram's API, as Willow's companion relays it. */
export interface TelegramRelay {
  call: <T>(token: string, method: 'getMe' | 'getUpdates' | 'sendMessage' | 'sendChatAction' | 'setMessageReaction', params: Record<string, unknown>) => Promise<T>;
}

interface TelegramUpdate {
  update_id: number;
  message?: { message_id?: number; text?: string; chat: { id: number }; from?: { first_name?: string; username?: string } };
}

const STORAGE_KEY = 'willow:dots:telegram';
const TOKEN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const MAX_MESSAGE = 4_000;

const read = (): TelegramLink | null => {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null') as TelegramLink | null;
    return saved && TOKEN.test(saved.token) && typeof saved.dotId === 'string' && typeof saved.code === 'string' ? saved : null;
  } catch {
    return null;
  }
};

export const telegramLink = atom<TelegramLink | null>(read());

export const setTelegramLink = (next: TelegramLink | null): void => {
  telegramLink.set(next);
  try {
    if (next) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private or embedded contexts; the link lasts for the session.
  }
};

export const isTelegramToken = (value: string): boolean => TOKEN.test(value.trim());

export const newPairingCode = (): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (byte) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte % 32]).join('');

const nameOf = (message: NonNullable<TelegramUpdate['message']>): string => message.from?.first_name || message.from?.username || 'you';

/**
 * One look at the bot: pairs the chat that sends the code, hands what that chat writes to `deliver`, and returns
 * the link as it should be remembered (where to read from next, and the chat once paired).
 */
export const readTelegram = async (
  link: TelegramLink,
  relay: TelegramRelay,
  deliver: (dotId: string, text: string, messageId?: number) => void,
  waitSeconds = 25,
): Promise<TelegramLink> => {
  const reply = await relay.call<{ ok?: boolean; result?: TelegramUpdate[]; description?: string }>(link.token, 'getUpdates', {
    ...(link.offset !== undefined ? { offset: link.offset } : {}),
    timeout: waitSeconds,
    allowed_updates: ['message'],
  });
  if (!reply.ok) throw new Error(reply.description || 'Telegram refused the request.');
  let next: TelegramLink = { ...link };
  for (const update of reply.result ?? []) {
    next = { ...next, offset: update.update_id + 1 };
    const message = update.message;
    const text = message?.text?.trim();
    if (!message || !text) continue;
    if (next.chatId === undefined) {
      if (text.replace(/^\/start\s*/i, '').trim().toUpperCase() !== link.code) continue;
      next = { ...next, chatId: message.chat.id, chatName: nameOf(message) };
      await relay.call(link.token, 'sendMessage', { chat_id: message.chat.id, text: 'Paired with Willow. Write here to reach your bot.' });
      continue;
    }
    if (message.chat.id !== next.chatId || /^\/start\b/i.test(text)) continue;
    deliver(link.dotId, text, message.message_id);
  }
  return next;
};

/** A bot's message, to the paired chat. */
export const sendTelegram = async (link: TelegramLink, relay: TelegramRelay, text: string): Promise<boolean> => {
  if (link.chatId === undefined || !text.trim()) return false;
  try {
    const reply = await relay.call<{ ok?: boolean }>(link.token, 'sendMessage', {
      chat_id: link.chatId,
      text: text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text,
    });
    return Boolean(reply.ok);
  } catch {
    return false;
  }
};

/** The emoji Telegram lets a bot react with (the Bot API's `ReactionTypeEmoji`), written as Telegram writes them. */
const TELEGRAM_EMOJI: ReadonlySet<string> = new Set([
  '👍', '👎', '❤', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊', '🤡',
  '🥱', '🥴', '😍', '🐳', '❤‍🔥', '🌚', '🌭', '💯', '🤣', '⚡', '🍌', '🏆', '💔', '🤨', '😐', '🍓', '🍾', '💋', '🖕', '😈',
  '😴', '😭', '🤓', '👻', '👨‍💻', '👀', '🎃', '🙈', '😇', '😨', '🤝', '✍', '🤗', '🫡', '🎅', '🎄', '☃', '💅', '🤪', '🗿',
  '🆒', '💘', '🙉', '🦄', '😘', '💊', '🙊', '😎', '👾', '🤷‍♂', '🤷', '🤷‍♀', '😡',
]);

/** The nearest Telegram has for emoji it lacks; an emoji with no near one is left off Telegram rather than changed. */
const NEAREST: Record<string, string> = {
  '✅': '👌', '✔': '👌', '😂': '🤣', '😆': '😁', '😄': '😁', '😃': '😁', '😀': '😁', '😊': '😇', '🙂': '😇', '🥳': '🎉',
  '🚀': '⚡', '✨': '🤩', '⭐': '🤩', '🌟': '🤩', '😮': '🤯', '😲': '🤯', '📌': '✍', '📝': '✍', '⏳': '👀', '💡': '🤓',
  '🧠': '🤓', '🙌': '👏', '💪': '🔥', '🫶': '❤', '💙': '❤', '💜': '❤', '💚': '❤', '🧡': '❤', '💛': '❤', '🤍': '❤', '🖤': '❤',
  '😅': '😁', '🤞': '🙏', '✌': '👌', '🆗': '👌', '❌': '👎', '😞': '😢', '😔': '😢', '🥲': '😢', '🙃': '🤪', '😜': '🤪',
};

export const telegramReaction = (emoji: string): string | undefined => {
  const bare = emoji.replace(/\uFE0F/g, '');
  return TELEGRAM_EMOJI.has(bare) ? bare : NEAREST[bare];
};

/** The bot's reaction on one of the user's Telegram messages: it replaces the bot's earlier one there, as in Willow. */
export const reactOnTelegram = async (link: TelegramLink, relay: TelegramRelay, messageId: number, emoji: string): Promise<boolean> => {
  const shown = telegramReaction(emoji);
  if (link.chatId === undefined || !shown) return false;
  try {
    const reply = await relay.call<{ ok?: boolean }>(link.token, 'setMessageReaction', { chat_id: link.chatId, message_id: messageId, reaction: [{ type: 'emoji', emoji: shown }] });
    return Boolean(reply.ok);
  } catch {
    return false;
  }
};

/** "Typing…" in the paired chat, while the bot writes a message there: Telegram shows it for about five seconds. */
export const showTelegramTyping = (link: TelegramLink, relay: TelegramRelay): void => {
  if (link.chatId === undefined) return;
  relay.call(link.token, 'sendChatAction', { chat_id: link.chatId, action: 'typing' }).catch(() => undefined);
};
