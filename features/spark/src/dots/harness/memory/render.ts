/**
 * How thread items read to the model.
 *
 * Inputs (the user's messages, events, tool results) become user-role text, each
 * stamped with its id and local time. The bot's own output becomes
 * assistant-role text written back in the protocol it used, so the model sees
 * its earlier messages, reactions and calls exactly as it emitted them and keeps
 * using the protocol the same way.
 *
 * Only inputs carry ids in the transcript. Stamping the bot's own output with
 * ids would put ids in front of the model in its own voice, and models imitate
 * their own voice: it starts writing ids into its messages.
 */
import type { ChatMessage } from '@willow/ai/chat';
import { CALL_BEGIN, CALL_END, MESSAGE_BEGIN, MESSAGE_END, REACT_BEGIN, STATUS_BEGIN } from '../runtime/protocol';
import { INPUT_KINDS, type DotItem } from '../thread/thread-types';

const STAMP_FORMATS = new Map<string, Intl.DateTimeFormat>();

/** `Mon 5 Oct 14:02` in the user's time zone. */
export const formatStamp = (at: number, timeZone: string): string => {
  let format = STAMP_FORMATS.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      format = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    }
    STAMP_FORMATS.set(timeZone, format);
  }
  return format.format(new Date(at)).replace(',', '');
};

/** `Monday 5 October 2026, 14:02`. */
export const formatLongDate = (at: number, timeZone: string): string => {
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).format(new Date(at)).replace(' at ', ', ');
  } catch {
    return new Intl.DateTimeFormat('en-GB', options).format(new Date(at)).replace(' at ', ', ');
  }
};

/** `3 minutes ago`, `2 days ago`. */
export const formatAgo = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

/** A reaction from the user, as the bot reads it: what they did, to which of its messages. */
const userReactionSentence = (item: DotItem): string => (item.removed
  ? `The user took back their ${item.emoji} on your message “${item.text}”.`
  : `The user reacted ${item.emoji} to your message “${item.text}”.`);

/** Where a message from the user was written, when not in Willow. */
const viaWords = (item: DotItem): string => {
  if (item.via === 'telegram') return ' · on Telegram';
  if (item.via === 'discord') return item.discord?.guildId ? ` · on Discord, in ${item.discord.where ?? 'a server channel'}` : ' · on Discord, in your DM';
  return '';
};

export interface RenderOptions {
  timeZone: string;
  /** Results with a seq below this, and longer than the threshold, collapse to a stub. */
  maskBeforeSeq?: number;
}

/** Tool output longer than this is collapsed once it falls behind the masking line. */
const MASK_THRESHOLD_CHARS = 1_200;

export const renderInput = (item: DotItem, options: RenderOptions): string => {
  const stamp = `${item.id} · ${formatStamp(item.at, options.timeZone)}`;
  switch (item.kind) {
    case 'user': {
      const files = item.attachments?.length ? `\n(attached: ${item.attachments.map((file) => file.name).join(', ')})` : '';
      return `[${stamp}${viaWords(item)}] ${item.text}${files}`;
    }
    case 'user-reaction':
      return `[${stamp}] ${userReactionSentence(item)}`;
    case 'event': {
      // A quiet step only records, for the user's card, what the tool's own result already told the bot.
      if (item.quiet) return '';
      // A finished command carries its output, which ages like any other tool output.
      const masked = item.approvalStep === 'finished' && options.maskBeforeSeq !== undefined && item.seq < options.maskBeforeSeq && item.text.length > MASK_THRESHOLD_CHARS;
      const body = masked
        ? `${item.text.split('\n')[0]}\n[Its output, ${item.text.length.toLocaleString('en-US')} characters, is collapsed. Read it in full with recall {"ids": ["${item.id}"]}.]`
        : item.text;
      return `[${stamp} · event: ${item.event ?? 'notice'}] ${body}`;
    }
    case 'result': {
      const attrs = `id="${item.id}" call="${item.callId ?? ''}" tool="${item.tool ?? ''}"${item.failed ? ' failed="true"' : ''}`;
      const masked = options.maskBeforeSeq !== undefined && item.seq < options.maskBeforeSeq && item.text.length > MASK_THRESHOLD_CHARS;
      const body = masked
        ? `[Earlier tool output, ${item.text.length.toLocaleString('en-US')} characters, collapsed. Read it in full with recall {"ids": ["${item.id}"]}.]`
        : item.text;
      return `<result ${attrs}>\n${body}\n</result>`;
    }
    default:
      return item.text;
  }
};

export const renderOutput = (item: DotItem): string => {
  switch (item.kind) {
    case 'work':
      return item.text.trim();
    case 'dot':
      return `${MESSAGE_BEGIN}\n${item.text.trim()}\n${MESSAGE_END}`;
    case 'reaction':
      return `${REACT_BEGIN} ${item.target} ${item.emoji} ${item.label ?? ''}`.trimEnd();
    case 'call':
      return `${CALL_BEGIN} ${item.tool}\n${JSON.stringify(item.args ?? {})}\n${CALL_END}`;
    case 'status':
      return `${STATUS_BEGIN} ${item.text}`;
    // Each request, and each trigger card, already reads as the call that made it and that call's result.
    case 'approval':
    case 'machine':
    case 'help':
    case 'trigger-card':
    case 'outgoing':
    case 'edit':
    case 'plan-card':
    case 'screen':
      return '';
    default:
      return item.text;
  }
};

/** One item as plain text, for recall results and compaction transcripts. */
export const renderForRecord = (item: DotItem, timeZone: string, maxResultChars = Infinity): string => {
  const stamp = `${item.id} · ${formatStamp(item.at, timeZone)}`;
  switch (item.kind) {
    case 'user':
      return `[${stamp} · user${viaWords(item)}] ${item.text}${item.attachments?.length ? ` (attached: ${item.attachments.map((file) => file.name).join(', ')})` : ''}`;
    case 'dot':
      return `[${stamp} · you, message] ${item.text}`;
    case 'reaction':
      return `[${stamp} · you reacted to ${item.target}] ${item.emoji} ${item.label ?? ''}`.trimEnd();
    case 'user-reaction':
      return `[${stamp} · user] ${userReactionSentence(item)}`;
    case 'work':
      return `[${stamp} · your private note] ${item.text}`;
    case 'call':
      return `[${stamp} · you called ${item.tool}] ${JSON.stringify(item.args ?? {})}`;
    case 'result': {
      const text = item.text.length > maxResultChars
        ? `${item.text.slice(0, maxResultChars)}… [${(item.text.length - maxResultChars).toLocaleString('en-US')} more characters]`
        : item.text;
      return `[${stamp} · ${item.tool ?? 'tool'} result${item.failed ? ', failed' : ''}] ${text}`;
    }
    case 'event': {
      const text = item.approvalStep === 'finished' && item.text.length > maxResultChars
        ? `${item.text.slice(0, maxResultChars)}… [${(item.text.length - maxResultChars).toLocaleString('en-US')} more characters]`
        : item.text;
      return `[${stamp} · event: ${item.event ?? 'notice'}] ${text}`;
    }
    case 'status':
      return `[${stamp} · your status] ${item.text}`;
    case 'approval':
      return `[${stamp} · you asked to run on the user's computer] ${item.approval?.command ?? ''} (in ${item.approval?.root ?? ''}${item.approval?.cwd && item.approval.cwd !== '.' ? `/${item.approval.cwd}` : ''}) — ${item.approval?.reason ?? ''}`;
    case 'machine':
      return `[${stamp} · you asked the user to set up your computer] ${item.text}`;
    case 'trigger-card':
      return `[${stamp} · you set up trigger ${item.ref ?? ''}] ${item.text}`;
    case 'plan-card':
      return `[${stamp} · you set plan ${item.ref ?? ''}] ${item.text.replace(/\n/g, '; ')}`;
    case 'edit':
      if (item.edit?.proposed?.copy || item.edit?.files.some((file) => file.bytes !== undefined)) {
        return `[${stamp} · ${item.edit.proposed ? 'you proposed copying' : 'you copied'} a file from your computer to ${item.edit.root}] ${item.edit.files.map((file) => file.path).join('; ')}`;
      }
      return `[${stamp} · ${item.edit?.proposed ? 'you proposed changing' : 'you changed'} files in ${item.edit?.root ?? 'the connected folder'}] ${(item.edit?.files ?? []).map((file) => `${file.path} +${file.added} −${file.removed}`).join('; ')}`;
    case 'screen':
      return `[${stamp} · you asked to see and use the user's screen] ${item.screen?.reason ?? item.text}`;
    case 'outgoing':
      if (item.discordPost) {
        return `[${stamp} · ${item.discordPost.standing ? 'you posted' : 'you asked to post'} on Discord in ${item.discordPost.where}] ${item.discordPost.text}${item.outgoingStep === 'failed' ? ` — not posted: ${item.problem ?? ''}` : ''}`;
      }
      return `[${stamp} · ${item.outgoing?.standing ? 'you emailed' : 'you asked to email'} ${[...(item.outgoing?.to ?? []), ...(item.outgoing?.cc ?? [])].join(', ')}] “${item.outgoing?.subject ?? item.text}”${item.outgoingStep === 'failed' ? ` — not sent: ${item.problem ?? ''}` : ''}`;
    case 'help':
      return item.help?.kind === 'secret'
        ? `[${stamp} · you asked the user to enter ${item.help.label ?? 'a secret'} on your computer] ${item.help.reason}`
        : `[${stamp} · ${item.help?.source === 'model' ? 'you asked the user to take over your computer' : 'a page on your computer asked for a person'}] ${item.help?.reason ?? item.text}`;
  }
};

/**
 * The verbatim window as chat messages: consecutive inputs merge into one user
 * message, consecutive outputs into one assistant message, so roles always
 * alternate (some providers reject anything else).
 */
export const transcriptMessages = (items: DotItem[], options: RenderOptions): ChatMessage[] => {
  const messages: ChatMessage[] = [];
  for (const item of items) {
    if (item.kind === 'dot' && item.streaming) continue;
    const role: ChatMessage['role'] = INPUT_KINDS.has(item.kind) ? 'user' : 'assistant';
    const text = role === 'user' ? renderInput(item, options) : renderOutput(item);
    if (!text) continue;
    const last = messages.at(-1);
    if (last?.role === role) last.content += role === 'user' ? `\n\n${text}` : `\n${text}`;
    else messages.push({ role, content: text });
  }
  return messages;
};
