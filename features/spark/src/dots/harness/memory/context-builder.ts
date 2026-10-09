/**
 * Assembles what the model reads for one request.
 *
 * Order is chosen for stability: what changes least comes first, so providers
 * that cache a prompt prefix reuse as much of it as possible between wakes.
 *
 *   system prompt      (changes only when the bot's tools change)
 *   <memory> packet    (about the user, notebook, episodes — changes occasionally)
 *   verbatim window    (append-only between compactions)
 *   <now>              (the clock and what is new — changes every request, so last)
 *
 * The window is every item the episodes do not yet cover. Compaction keeps that
 * tail under the budget in the background; if it ever falls behind far enough
 * that the request would overflow, the oldest uncovered items are left out of
 * this request (never out of the record) and the bot is told how to recall them.
 */
import type { ChatMessage } from '@willow/ai/chat';
import type { DotBudgets } from './budgets';
import { notebookProjection } from './notebook';
import { formatAgo, formatLongDate, formatStamp, renderInput, renderOutput, transcriptMessages } from './render';
import { estimateTokens } from './tokens';
import { INPUT_KINDS, visibleEpisodes, type DotItem, type DotThread } from '../thread/thread-types';
import { describeTrigger } from '../triggers/trigger-spec';
import { describePlan } from '../runtime/plan';
import { pacingLine, quietHoursLine } from '../runtime/proactive';

export interface DotContextInputs {
  thread: DotThread;
  systemPrompt: string;
  /** What Willow already knows about the user (Saved Info, profile, rules). Empty when Memory is off. */
  about: string;
  /** What this bot has learned about the user itself (`learnedBlock`). Empty when Memory is off. */
  learned?: string;
  budgets: DotBudgets;
  now: number;
  timeZone: string;
  /** Items after this seq are new to the dot in this turn. */
  seenSeq: number;
  /** One line per piece of delegated work still worth mentioning. */
  delegations: string[];
  /** The turn this request belongs to: when it began, and the last item handled before it. */
  turn?: { id: string; startedAt: number; sinceSeq: number };
}

export interface DotContext {
  systemPrompt: string;
  messages: ChatMessage[];
  /** Total characters sent, for calibrating token estimates against provider usage. */
  promptChars: number;
  tokens: { system: number; memory: number; window: number; total: number };
  /** Set when uncovered items had to be left out of this request. */
  omitted?: { fromSeq: number; toSeq: number };
}

const itemTokens = (item: DotItem, maskBeforeSeq: number, timeZone: string, cpt: number | undefined): number =>
  estimateTokens(INPUT_KINDS.has(item.kind) ? renderInput(item, { timeZone, maskBeforeSeq }) : renderOutput(item), cpt) + 4;

/** The first item seq whose results stay unmasked: everything within `maskAfter` tokens of the end. */
const maskLine = (items: DotItem[], budgets: DotBudgets, timeZone: string, cpt: number | undefined): number => {
  let used = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    used += itemTokens(items[index]!, -1, timeZone, cpt);
    if (used > budgets.maskAfter) return items[index]!.seq + 1;
  }
  return items[0]?.seq ?? 0;
};

const episodesBlock = (thread: DotThread, timeZone: string): string => {
  const episodes = visibleEpisodes(thread);
  if (episodes.length === 0) return '';
  const blocks = episodes.map((episode) => {
    const span = `${formatStamp(episode.fromAt, timeZone)} → ${formatStamp(episode.toAt, timeZone)}`;
    const kind = episode.level > 1 ? 'chapter' : 'episode';
    return `### ${kind} ${episode.id} · items i${episode.fromSeq}–i${episode.toSeq} · ${span}\n${episode.text.trim()}`;
  });
  return `<episodes>\nThe conversation before the recent window, condensed oldest first. Recall exact wording or details by item id.\n\n${blocks.join('\n\n')}\n</episodes>`;
};

const memoryPacket = (inputs: DotContextInputs, omitted: DotContext['omitted']): string => {
  const { thread, budgets, timeZone } = inputs;
  const parts: string[] = [];
  if (inputs.about.trim()) parts.push(`<about_user source="Willow">\n${inputs.about.trim()}\n</about_user>`);
  if (inputs.learned?.trim()) parts.push(inputs.learned.trim());
  parts.push(`<notebook>\n${notebookProjection(thread.notebook, budgets.notebook, thread.runtime.charsPerToken, timeZone)}\n</notebook>`);
  const episodes = episodesBlock(thread, timeZone);
  if (episodes) parts.push(episodes);
  if (omitted) {
    parts.push(`<gap>Items i${omitted.fromSeq}–i${omitted.toSeq} are not summarised yet and are left out of this view to fit your context. They are intact in the record; read them with recall when you need them.</gap>`);
  }
  return `<memory>\n${parts.join('\n\n')}\n</memory>`;
};

/** A stretch of time as a person would say it, to the second while it is short. */
export const formatSpan = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest} minute${rest === 1 ? '' : 's'}` : ''}`;
};

/** Steps taken since the user last heard from the bot, before the view says how long ago that was. */
const SINCE_WORD_STEPS = 3;

/**
 * Where the bot stands in the turn it is taking, once it has taken a step: how long it has been at it, when the user
 * last heard from it in this turn, and what the user wrote that has had no word from it since — no message after it,
 * no reaction on it. A model in a run of tool calls has no sense of time passing; a person working for someone always
 * knows how long they have kept them waiting.
 */
const turnLines = (thread: DotThread, turn: NonNullable<DotContextInputs['turn']>, now: number): string[] => {
  const mine = thread.items.filter((item) => item.turnId === turn.id);
  const steps = mine.filter((item) => item.kind === 'call').length;
  if (steps === 0) return [];
  const lines = [`You are ${formatSpan(now - turn.startedAt)} and ${steps} step${steps === 1 ? '' : 's'} into this turn.`];
  const word = mine.filter((item) => (item.kind === 'dot' && !item.streaming) || item.kind === 'reaction').at(-1);
  if (word) {
    const since = mine.filter((item) => item.kind === 'call' && item.seq > word.seq).length;
    if (since >= SINCE_WORD_STEPS) lines.push(`The user last heard from you ${formatSpan(now - word.at)} ago, ${word.kind === 'dot' ? 'in a message' : 'in a reaction'}, ${since} steps back.`);
  }
  const unheard = thread.items.filter((item) => item.kind === 'user' && item.seq > turn.sinceSeq
    && !thread.items.some((other) => (other.kind === 'dot' && !other.streaming && other.seq > item.seq) || (other.kind === 'reaction' && other.target === item.id)));
  if (unheard.length) {
    const ids = unheard.map((item) => item.id);
    lines.push(`${ids.length === 1 ? `${ids[0]} has` : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)} have`} had no word from you yet; the user wrote ${ids.length === 1 ? 'it' : 'the first'} ${formatSpan(now - unheard[0]!.at)} ago.`);
  }
  return lines;
};

/** Where the user's latest message was written, when that changes where the bot's answer goes and who reads it. */
const whereTheyWrote = (item: DotItem): string => {
  if (item.via === 'telegram') return ', on Telegram from their phone: your messages reach them there too, so keep them easy to read on a phone';
  if (item.via !== 'discord') return '';
  return item.discord?.guildId
    ? `, on Discord in ${item.discord.where ?? 'a server channel'}: your messages are posted in that channel too, where everyone in it reads them`
    : ', on Discord in your DM: your messages reach them there too';
};

/** How many of the user's messages may arrive with the notebook untouched before it is worth a look. */
export const NOTEBOOK_STALE_AFTER = 15;

/**
 * When what the bot was told should be written down: the oldest stretch of its window is about to be condensed into an
 * episode, which keeps the gist and may drop the detail, or the user has written a good deal with the notebook untouched.
 */
const notebookLine = (inputs: DotContextInputs): string | null => {
  const { thread, budgets, timeZone } = inputs;
  if (uncoveredTailTokens(thread, budgets, timeZone) > budgets.verbatimHigh * 0.9) {
    return 'The oldest stretch of your recent conversation will soon be condensed into a summary that can drop detail: if it holds a commitment, a preference or a decision your notebook does not have, write it there now.';
  }
  const changed = Math.max(0, ...Object.values(thread.notebook).map((file) => file.updatedAt));
  const since = thread.items.filter((item) => item.kind === 'user' && item.at > changed).length;
  return since >= NOTEBOOK_STALE_AFTER
    ? `The user has written ${since} times since your notebook last changed: if anything they said should outlast this stretch — a preference, a commitment, a decision — save it.`
    : null;
};

const nowBlock = (inputs: DotContextInputs, windowItems: DotItem[], tokens: { total: number }): string => {
  const { thread, now, timeZone, seenSeq, budgets } = inputs;
  const runtime = thread.runtime;
  const lines = [`Local time: ${formatLongDate(now, timeZone)} (${timeZone}).`];

  const lastUser = [...thread.items].reverse().find((item) => item.kind === 'user');
  const lastDot = [...thread.items].reverse().find((item) => item.kind === 'dot' && !item.streaming);
  if (lastUser) lines.push(`The user last wrote ${formatAgo(now - lastUser.at)} (${lastUser.id})${whereTheyWrote(lastUser)}.`);
  else lines.push('The user has not written to you yet.');
  if (lastDot) lines.push(`You last sent them a message ${formatAgo(now - lastDot.at)}.`);
  const pacing = pacingLine(thread, now);
  if (pacing) lines.push(pacing);
  const quiet = quietHoursLine(runtime, now, timeZone);
  if (quiet) lines.push(quiet);
  if (inputs.turn) lines.push(...turnLines(thread, inputs.turn, now));

  const fresh = thread.items.filter((item) => item.seq > seenSeq && (item.kind === 'user' || item.kind === 'user-reaction' || (item.kind === 'event' && !item.quiet)));
  if (fresh.length) {
    const users = fresh.filter((item) => item.kind === 'user').map((item) => item.id);
    const reactions = fresh.filter((item) => item.kind === 'user-reaction').map((item) => item.id);
    const events = fresh.filter((item) => item.kind === 'event').map((item) => item.id);
    const parts = [
      users.length ? `${users.length === 1 ? 'a message' : `${users.length} messages`} from the user (${users.slice(-12).join(', ')})` : '',
      reactions.length ? `${reactions.length === 1 ? 'a reaction' : `${reactions.length} reactions`} from the user (${reactions.slice(-12).join(', ')})` : '',
      events.length ? `${events.length === 1 ? 'an event' : `${events.length} events`} (${events.slice(-12).join(', ')})` : '',
    ].filter(Boolean);
    lines.push(`New since you last acted: ${parts.join(' and ')}.`);
    // Said where the model looks last, while someone waits: an answer written outside an envelope reaches nobody.
    if (users.length) lines.push('They see only what you put in a message or a reaction.');
  } else {
    lines.push('Nothing new has arrived since you last acted.');
  }
  const keep = notebookLine(inputs);
  if (keep) lines.push(keep);

  if (runtime.upNext) lines.push(`Your current "Up next": ${runtime.upNext}`);
  if (runtime.plan?.steps.length) lines.push(describePlan(runtime.plan));
  if (inputs.delegations.length) lines.push(`Delegated work:\n${inputs.delegations.map((line) => `- ${line}`).join('\n')}`);
  const triggers = (runtime.triggers ?? []).filter((trigger) => trigger.status !== 'ended');
  if (triggers.length) lines.push(`Your triggers:\n${triggers.map((trigger) => `- ${describeTrigger(trigger, 160)}`).join('\n')}`);
  lines.push(`Context in use: about ${Math.round(tokens.total / 1000)}k of ${Math.round(budgets.hardCap / 1000)}k tokens; ${windowItems.length} recent items verbatim.`);
  return `<now>\n${lines.join('\n')}\n</now>`;
};

export const buildDotContext = (inputs: DotContextInputs): DotContext => {
  const { thread, budgets, timeZone } = inputs;
  const cpt = thread.runtime.charsPerToken;
  const systemTokens = estimateTokens(inputs.systemPrompt, cpt);

  // Everything the episodes do not cover yet.
  let window = thread.items.filter((item) => item.seq > thread.runtime.lastCompactedSeq && !(item.kind === 'dot' && item.streaming));
  const masking = maskLine(window, budgets, timeZone, cpt);

  // Leave room for the memory packet before deciding how much window fits.
  const memoryEstimate = estimateTokens(memoryPacket(inputs, undefined), cpt);
  const room = budgets.hardCap - systemTokens - memoryEstimate - 2_000;
  let windowTokens = window.reduce((sum, item) => sum + itemTokens(item, masking, timeZone, cpt), 0);
  let omitted: DotContext['omitted'];
  if (windowTokens > room && window.length > 1) {
    let dropUntil = 0;
    while (windowTokens > room && dropUntil < window.length - 1) {
      windowTokens -= itemTokens(window[dropUntil]!, masking, timeZone, cpt);
      dropUntil += 1;
    }
    // Never start the view on a result whose call was dropped.
    while (dropUntil < window.length - 1 && window[dropUntil]!.kind === 'result') {
      windowTokens -= itemTokens(window[dropUntil]!, masking, timeZone, cpt);
      dropUntil += 1;
    }
    omitted = { fromSeq: window[0]!.seq, toSeq: window[dropUntil - 1]!.seq };
    window = window.slice(dropUntil);
  }

  const memory = memoryPacket(inputs, omitted);
  const memoryTokens = estimateTokens(memory, cpt);
  // Inputs sit where the model met them (see `DotItem.order`).
  const ordered = window.slice().sort((a, b) => (a.order ?? a.seq) - (b.order ?? b.seq));
  const transcript = transcriptMessages(ordered, { timeZone, maskBeforeSeq: masking });
  const total = systemTokens + memoryTokens + windowTokens;
  const now = nowBlock(inputs, window, { total });

  const messages: ChatMessage[] = [{ role: 'user', content: memory }];
  for (const message of transcript) {
    const last = messages.at(-1)!;
    if (last.role === message.role) last.content += `\n\n${message.content}`;
    else messages.push({ ...message });
  }
  const last = messages.at(-1)!;
  if (last.role === 'user') last.content += `\n\n${now}`;
  else messages.push({ role: 'user', content: now });

  const promptChars = inputs.systemPrompt.length + messages.reduce((sum, message) => sum + message.content.length, 0);
  return {
    systemPrompt: inputs.systemPrompt,
    messages,
    promptChars,
    tokens: { system: systemTokens, memory: memoryTokens, window: windowTokens, total: total + estimateTokens(now, cpt) },
    omitted,
  };
};

/**
 * Estimated tokens in the uncovered tail as the model reads it, old tool output
 * already collapsed — what compaction watches. Counting collapsed results at
 * full size would compact a conversation early just because it once ran a big
 * search.
 */
export const uncoveredTailTokens = (thread: DotThread, budgets: DotBudgets, timeZone: string): number => {
  const cpt = thread.runtime.charsPerToken;
  const tail = thread.items.filter((item) => item.seq > thread.runtime.lastCompactedSeq && !(item.kind === 'dot' && item.streaming));
  const masking = maskLine(tail, budgets, timeZone, cpt);
  return tail.reduce((sum, item) => sum + itemTokens(item, masking, timeZone, cpt), 0);
};

/** Tokens of one item as the window renders it, for compaction's cut planning. */
export const windowItemTokens = itemTokens;
export const windowMaskLine = maskLine;
