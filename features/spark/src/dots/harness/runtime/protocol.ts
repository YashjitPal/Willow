/**
 * The bot harness's wire format and event vocabulary.
 *
 * A bot writes its response in the same plain-text protocol family as Spark
 * (`runtime/protocol.ts` in the Spark harness, itself a port of Codex's freeform
 * tools), and Spark's call and patch envelopes are reused byte for byte. What a
 * bot adds are *actions*: envelopes that take effect the moment they close,
 * without a round trip.
 *
 *     *** Message
 *     The message, in Markdown, delivered to the user as it is written.
 *     *** End Message
 *
 *     *** React: i482 👍 Sounds good to me
 *
 *     *** Status: Comparing the three venues
 *
 * ## Why messages are actions, not calls
 *
 * A call stops the stream and costs a model round trip before the turn can go
 * on. If sending a message were a call, the most common turn of all — read the
 * user's message, answer it — would take two model requests: one to write the
 * answer, one to decide there is nothing more to do. As an action it takes one,
 * the message streams to the user while it is being written, and the same
 * response can also react or set a status before it ends.
 *
 * ## Why prose outside an envelope is private
 *
 * Because a bot lives in a messenger, staying quiet has to be as easy to express
 * as replying. If ordinary prose were the reply, a model that only wanted to
 * acknowledge the user would still have to produce text, and it would — a
 * filler "Got it!" is exactly the failure this design exists to prevent. With
 * messages explicit, a response with no message envelope is silence, and a
 * reaction on its own is a reaction on its own.
 */
import type { Attachment } from '@willow/ai/chat';
import type { ToolCall } from '../../../harness/runtime/protocol';

export { CALL_BEGIN, CALL_END, PATCH_BEGIN, PATCH_END } from '../../../harness/runtime/protocol';

export const MESSAGE_BEGIN = '*** Message';
export const MESSAGE_END = '*** End Message';
export const REACT_BEGIN = '*** React:';
export const STATUS_BEGIN = '*** Status:';

/** One emoji as Unicode recommends it — skin tones, ZWJ sequences, flags and keycaps included. */
const RGI_EMOJI = (() => {
  try {
    return new RegExp('^\\p{RGI_Emoji}$', 'v');
  } catch {
    return null;
  }
})();
const PICTOGRAPH = /^\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic}\uFE0F?)*$/u;
const isEmoji = (text: string): boolean => (RGI_EMOJI ? RGI_EMOJI.test(text) : PICTOGRAPH.test(text));

/**
 * A reaction is any one emoji, as in a messenger, in its emoji form: models add or drop the variation selector at
 * will (`❤` and `❤️`), and one shown as text would not read as a reaction. Anything else is not a reaction.
 */
export const normalizeReactionEmoji = (raw: string): string | null => {
  const text = raw.trim();
  if (!text || text.length > 40) return null;
  const bare = text.replace(/\uFE0F/g, '');
  for (const candidate of [text, `${bare}\uFE0F`, bare]) if (isEmoji(candidate)) return candidate;
  return null;
};

export interface ParsedReaction {
  target: string;
  emoji: string;
  label: string;
}

/** `i482 👍 Sounds good` (an optional `id:` prefix and brackets are tolerated). */
export const parseReaction = (rest: string): ParsedReaction | null => {
  const match = /^\s*\[?(?:id:\s*)?(i\d+)\]?\s+(\S+)\s*(.*)$/u.exec(rest);
  if (!match) return null;
  return { target: match[1]!, emoji: match[2]!, label: match[3]!.trim().replace(/^[-—:]\s*/, '') };
};

/* ------------------------------------------------------------------------ */
/* Tools                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * What a bot tool receives. A superset of the Spark harness's `ToolContext`, so
 * Spark's file tools and capability tools run here unchanged.
 */
export interface DotToolContext {
  dotId: string;
  turnId: string;
  readFiles: () => Record<string, string>;
  writeFiles: (files: Record<string, string>) => void;
  signal?: AbortSignal;
  emit: (call: ToolCall) => string;
  patch: (id: string, patch: Partial<ToolCall>) => void;
  /** Ends the turn once this call's result is recorded. */
  stopTurn: (response: string) => void;
  /** What the user sees the bot doing while this call runs, when that changes — waiting on them, say. */
  activity?: (label: string | null) => void;
}

export interface DotToolResult {
  observation: string;
  failed?: boolean;
  /** Pictures for the model — a screenshot — sent with the next request only: a screen is current once. */
  images?: Attachment[];
}

export interface DotToolHandler {
  id: string;
  run: (args: Record<string, unknown>, context: DotToolContext) => Promise<DotToolResult>;
}

/** How a tool is described to the model in the protocol section. */
export interface DotToolDoc {
  name: string;
  /** One-line JSON shape of the arguments. */
  args: string;
  /** What it does and when to use it. */
  description: string;
}

/* ------------------------------------------------------------------------ */
/* Events                                                                    */
/* ------------------------------------------------------------------------ */

export type DotTurnEndReason =
  /** The bot stopped with nothing pending: it waits for the next event. */
  | 'idle'
  /** The bot chose to sleep until a time. */
  | 'sleeping'
  | 'cancelled'
  | 'error'
  /** The turn hit the harness's iteration ceiling. */
  | 'limit';

export type DotHarnessEvent =
  /** Private prose, as it streams. Shown only in the bot's activity view. */
  | { type: 'work'; chunk: string }
  | { type: 'message-start'; itemId: string }
  | { type: 'message-delta'; itemId: string; chunk: string }
  | { type: 'message-end'; itemId: string }
  | { type: 'reaction'; itemId: string }
  | { type: 'status'; text: string }
  | { type: 'call-start'; itemId: string; tool: string }
  | { type: 'call-end'; itemId: string; failed: boolean }
  | { type: 'activity'; label: string | null }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  /** The model has a request in hand — its first sign of life — and with it the thread up to `seq`. */
  | { type: 'read'; seq: number }
  | { type: 'turn-end'; reason: DotTurnEndReason; error?: string };
