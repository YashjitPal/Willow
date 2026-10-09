/**
 * One turn of a dot: from being woken to going quiet again.
 *
 * The structure is Codex's open turn loop as the Spark harness ports it — each
 * iteration streams one model response, envelopes are recognised mid-stream,
 * calls run once the stream ends and their results feed the next iteration —
 * with three changes that make it a messenger's loop rather than a task's:
 *
 * 1. **Actions apply as they close.** Messages stream to the user while they are
 *    written; reactions, statuses and patches land the moment their line or
 *    envelope ends. None of them costs a round trip.
 * 2. **Every step is recorded in the thread.** Private prose, messages,
 *    reactions, calls and results are appended as items as they happen, so the
 *    turn's state is never only in memory: if the tab closes mid-turn, the next
 *    turn reads exactly what happened.
 * 3. **The world can steer mid-turn.** Each iteration rebuilds its context from
 *    the thread, so a message the user sends while the bot works is in front of
 *    the model on its very next request. A response with no calls ends the turn
 *    only if nothing new arrived meanwhile; otherwise the loop goes round again
 *    so the bot can take the new message into account.
 *
 * A turn ends when the bot stops with nothing pending (idle), chooses to sleep,
 * is cancelled, hits an error, or reaches the iteration ceiling.
 */
import type { AiOptions, Attachment, ChatMessage, StreamPhase, TokenUsage } from '@willow/ai/chat';
import { applyPatch, parsePatch } from '../../../harness/runtime/apply-patch';
import type { DotContext } from '../memory/context-builder';
import { appendDotItem, getDotThread, updateDotItem, updateDotRuntime } from '../thread/thread-store';
import { wakesDot, type DotItem } from '../thread/thread-types';
import {
  normalizeReactionEmoji,
  parseReaction,
  type DotHarnessEvent,
  type DotToolContext,
  type DotToolHandler,
  type DotTurnEndReason,
} from './protocol';
import { DotStreamParser, parseCallBody } from './stream-parser';

export type DotTransport = (
  messages: ChatMessage[],
  options: AiOptions,
  onToken: (token: string) => void,
  onStart: () => void,
  systemPrompt: string,
  onPhase: (phase: StreamPhase) => void,
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  onThought: (thought: string) => void,
  onUsage: (usage: TokenUsage) => void,
) => Promise<unknown>;

export const defaultDotTransport: DotTransport = async (messages, options, onToken, onStart, systemPrompt, onPhase, onToolCall, onThought, onUsage) => {
  const { streamChat } = await import('@willow/ai/chat');
  return streamChat(messages, options, onToken, onStart, systemPrompt, onPhase, onToolCall, onThought, undefined, undefined, onUsage);
};

export interface DotTurnOptions {
  dotId: string;
  turnId: string;
  model: { options: Omit<AiOptions, 'signal'>; label: string };
  transport?: DotTransport;
  tools: Map<string, DotToolHandler>;
  /** Builds the request context from the thread as it stands right now. */
  context: () => DotContext;
  workspace: { readFiles: () => Record<string, string>; writeFiles: (files: Record<string, string>) => void };
  signal: AbortSignal;
  onEvent: (event: DotHarnessEvent) => void;
  /** Provider usage for one request, with the prompt size that produced it. */
  onUsage?: (usage: TokenUsage, promptChars: number) => void;
  /**
   * Awaited before every request of the turn: where the runtime compacts mid-turn when the window passes its line,
   * so a turn can run as long as its work does.
   */
  beforeRequest?: () => Promise<void>;
  /** A ceiling on requests in one turn, for tests. Bots have none: a turn ends when its work does. */
  maxIterations?: number;
  /** How long work may run unannounced to a waiting user before the bot is told a word is due (`QUIET_WORK_MS`). */
  quietWorkMs?: number;
}

export interface DotTurnResult {
  reason: DotTurnEndReason;
  error?: string;
  iterations: number;
  messagesSent: number;
}

/** Raised when the provider rejects a request as too long; the runtime compacts and retries. */
export class DotContextOverflowError extends Error {}

const CONTEXT_OVERFLOW = /context[_ ]?(length|window)|too many tokens|maximum context|input (is )?too long|request (is )?too large|token limit|exceeds? the (maximum|limit)/i;
const MESSAGE_FLUSH_MS = 40;

const PHASE_LABELS: Partial<Record<StreamPhase, string>> = {
  thinking: 'Thinking',
  searching: 'Searching the web',
  executing: 'Running code',
};

/** What the user sees while one of the bot's own tools runs. Others read "Using <tool>". */
const TOOL_LABELS: Record<string, string> = {
  memory: 'Updating its notes',
  recall: 'Looking back',
  open_attachment: 'Looking at what you sent',
  sleep: 'Planning a wake-up',
  routine: 'Setting up a routine',
  retrieve_personal_data: 'Checking what it knows about you',
  user_run_command: 'Asking to run a command',
  user_start_job: 'Asking to start a job',
  user_check_job: 'Checking a job',
  user_stop_job: 'Stopping a job',
  user_files: 'Looking at your files',
  computer_navigate: 'Browsing',
  computer_read: 'Reading the page',
  computer_snapshot: 'Looking at the page',
  computer_click: 'Clicking',
  computer_type: 'Typing',
  computer_key: 'Pressing a key',
  computer_scroll: 'Scrolling',
  computer_screenshot: 'Looking at its screen',
  computer_desktop_click: 'Clicking',
  computer_desktop_type: 'Typing',
  computer_desktop_key: 'Pressing a key',
  computer_desktop_scroll: 'Scrolling',
  computer_desktop_drag: 'Dragging',
  computer_request_help: 'Asking for your help',
  computer_request_secret: 'Asking for a secret',
  computer_list_files: 'Looking through its computer',
  computer_read_file: 'Reading a file on its computer',
  computer_write_file: 'Saving a file on its computer',
  computer_run_command: 'Running a command on its computer',
  assign_spark_task: 'Assigning a Spark task',
  check_spark_task: 'Checking a Spark task',
  start_helper: 'Starting a helper',
  read_file: 'Reading a file',
  list_files: 'Looking through its files',
  search_files: 'Searching its files',
};

const maxSeq = (dotId: string): number => getDotThread(dotId)?.items.at(-1)?.seq ?? 0;

/**
 * Pictures a call returned go out with the next request, on its last message —
 * the one carrying that call's result — and with no later one: the record keeps
 * the text, and a screen is current once.
 */
const withImages = (messages: ChatMessage[], images: Attachment[]): ChatMessage[] => {
  const last = messages.at(-1);
  if (!images.length || !last || last.role !== 'user') return messages;
  return [...messages.slice(0, -1), { ...last, attachments: [...(last.attachments ?? []), ...images] }];
};

/** Inputs from outside the bot (the user, events) that arrived after `seq`. */
const arrivedSince = (dotId: string, seq: number): DotItem[] =>
  (getDotThread(dotId)?.items ?? []).filter((item) => item.seq > seq && (item.kind === 'user' || item.kind === 'event'));

/** The user's latest message, when it has had nothing from the bot since — no message, and no reaction — else null. */
const waitingOn = (dotId: string): DotItem | null => {
  const items = getDotThread(dotId)?.items ?? [];
  const latest = [...items].reverse().find((item) => item.kind === 'user');
  if (!latest) return null;
  return items.some((item) => item.seq > latest.seq && ((item.kind === 'dot' && !item.streaming) || item.kind === 'reaction')) ? null : latest;
};
const userWaiting = (dotId: string): boolean => waitingOn(dotId) !== null;

/** How long work may run with the user hearing nothing before a word is due. */
export const QUIET_WORK_MS = 10_000;

/** What a bot hears, once a turn, when it has been working that long without a word to the user who is waiting. */
export const quietWorkNotice = (seconds: number): string =>
  `The user wrote ${seconds} seconds ago and has had no word from you while you work. Unless your next step is your answer, let them know you are on it first — a reaction or a short message, whichever fits — then carry on.`;

/**
 * What a response that reached nobody is told, once a turn: text outside a message is private, so an answer written as
 * plain prose — or an empty response — would leave the user with a read receipt and silence.
 */
export const UNHEARD_NOTICE = {
  prose: 'Nothing you just wrote reached the user: text outside a message is private, and their latest message has had no answer from you. If you meant to say something to them, send it as a message now. If saying nothing is right, end your turn again.',
  empty: 'Your response was empty, and the user\'s latest message has had no answer from you. If you meant to say something to them, send it as a message now. If saying nothing is right, end your turn again.',
};

type PreparedCall = { name: string; body: string; args: Record<string, unknown>; problem?: string };
type CallOutcome = { observation: string; failed: boolean; images?: Attachment[] };

/**
 * Tools that only look, so a run of them in one response can go out at once. The bot's own computer is left out: each
 * call there may start it, and starting is one at a time.
 */
const CONCURRENT_TOOLS = new Set([
  'recall', 'read_web_page', 'use_skill', 'open_attachment', 'retrieve_personal_data', 'read_file', 'list_files', 'search_files',
  'user_files', 'check_spark_task', 'list_spark_tasks', 'check_helper', 'user_check_job',
]);

/**
 * Tools whose same call can rightly come again and again — looking at a screen or page that changes, moving through it a
 * step at a time, checking on work that is running — left out of the count of repeated calls, which they also reset.
 */
const REPEATABLE_TOOLS = new Set([
  'user_screenshot', 'user_zoom', 'user_apps', 'user_elements', 'user_desktop_scroll', 'user_desktop_key',
  'computer_screenshot', 'computer_zoom', 'computer_snapshot', 'computer_read', 'computer_scroll', 'computer_key',
  'computer_desktop_scroll', 'computer_desktop_key', 'user_check_job', 'user_send_to_job', 'check_spark_task', 'list_spark_tasks', 'check_helper',
]);

/** The same call this many times in a row gets a word; at the second count it is no longer run. */
export const REPEAT_NOTICE_AT = 3;
export const REPEAT_STOP_AT = 6;

/** Calls that can check a change to files: whatever runs a program. */
const CHECKS_CHANGES = ['user_run_command', 'user_start_job', 'computer_run_command'];

const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b))) : inner);

/** How many times in a row this exact call has now come, nothing else between. */
const countRepeat = (repeat: { key: string; count: number }, call: PreparedCall): number => {
  if (REPEATABLE_TOOLS.has(call.name)) {
    repeat.key = '';
    repeat.count = 0;
    return 0;
  }
  const key = `${call.name} ${stableJson(call.args)}`;
  repeat.count = repeat.key === key ? repeat.count + 1 : 1;
  repeat.key = key;
  return repeat.count;
};

export const repeatNotice = (tool: string, times: number): string =>
  `You have made the same ${tool} call, with the same arguments, ${times} times in a row. Making it again will most likely bring back the same thing: change the approach, or if something is in the way, tell the user what it is.`;

const repeatRefusal = (tool: string, times: number): string =>
  `Not run: this same ${tool} call already ran ${times} times in a row. Take a different route, or tell the user what is stopping you.`;

const repeatEndNotice = (tool: string): string =>
  `This turn was ended: the same ${tool} call kept coming after it was refused. If the work is not done, take a different route in your next turn, or tell the user what is stopping you.`;

/** What a bot hears, once a turn, when it changed files and ran nothing since that could show the change works. */
export const CHECK_CHANGE_NOTICE =
  'You changed files this turn and have run nothing since to check that the change works. If it can be checked — by its tests, a build or running it — check it now, and tell the user if what you find changes what you told them. If it cannot be checked, or needs no check, end your turn again.';

export const runDotTurn = async (options: DotTurnOptions): Promise<DotTurnResult> => {
  const { dotId, turnId, signal, onEvent } = options;
  const transport = options.transport ?? defaultDotTransport;
  const maxIterations = options.maxIterations ?? Infinity;
  let messagesSent = 0;
  let iteration = 0;
  let images: Attachment[] = [];
  let toldUnheard = false;
  let toldQuiet = false;
  let toldCheck = false;
  const repeat = { key: '', count: 0 };
  const changes = { made: false, checked: false };
  const quietWorkMs = options.quietWorkMs ?? QUIET_WORK_MS;

  try {
    for (; iteration < maxIterations; iteration += 1) {
      if (signal.aborted) return { reason: 'cancelled', iterations: iteration, messagesSent };
      await options.beforeRequest?.();
      if (signal.aborted) return { reason: 'cancelled', iterations: iteration, messagesSent };
      const seenUpTo = maxSeq(dotId);
      const context = options.context();
      const messages = withImages(context.messages, images);
      images = [];

      let prose = '';
      let message: { itemId: string | null; text: string; timer?: ReturnType<typeof setTimeout> } | null = null;
      const calls: { name: string; body: string }[] = [];
      let needsAnotherLook = false;
      let wroteProse = false;
      let acted = false;
      // The model has this request in hand at its first sign of life — thinking, writing or reporting — not when it was
      // sent: that is when what it was given counts as read.
      let read = false;
      const markRead = () => {
        if (read) return;
        read = true;
        onEvent({ type: 'read', seq: seenUpTo });
      };

      const flushProse = () => {
        const text = prose.trim();
        prose = '';
        if (text) appendDotItem(dotId, { kind: 'work', text, turnId });
      };
      const flushMessage = () => {
        if (!message?.itemId) return;
        clearTimeout(message.timer);
        message.timer = undefined;
        updateDotItem(dotId, message.itemId, { text: message.text, streaming: true });
      };
      const notice = (text: string) => {
        appendDotItem(dotId, { kind: 'event', event: 'notice', text, turnId });
        needsAnotherLook = true;
      };

      const parser = new DotStreamParser({
        onText: (chunk) => {
          prose += chunk;
          if (chunk.trim()) wroteProse = true;
          onEvent({ type: 'work', chunk });
        },
        onMessageOpen: () => {
          flushProse();
          acted = true;
          message = { itemId: null, text: '' };
        },
        onMessageText: (chunk) => {
          if (!message) return;
          message.text += chunk;
          if (!message.itemId) {
            if (!message.text.trim()) return;
            message.text = message.text.replace(/^\s+/, '');
            const item = appendDotItem(dotId, { kind: 'dot', text: message.text, turnId, streaming: true });
            message.itemId = item.id;
            onEvent({ type: 'message-start', itemId: item.id });
            onEvent({ type: 'activity', label: null });
            return;
          }
          onEvent({ type: 'message-delta', itemId: message.itemId, chunk });
          message.timer ??= setTimeout(flushMessage, MESSAGE_FLUSH_MS);
        },
        onMessageClose: () => {
          const open = message;
          message = null;
          if (!open?.itemId) return;
          clearTimeout(open.timer);
          updateDotItem(dotId, open.itemId, { text: open.text.trim(), streaming: false });
          messagesSent += 1;
          onEvent({ type: 'message-end', itemId: open.itemId });
        },
        onReact: (rest) => {
          flushProse();
          acted = true;
          const parsed = parseReaction(rest);
          if (!parsed) {
            notice(`Your reaction "${rest}" could not be read. Write it as: *** React: <message id> <emoji> <short label>.`);
            return;
          }
          const target = getDotThread(dotId)?.items.find((item) => item.id === parsed.target);
          if (!target || target.kind !== 'user') {
            notice(`You can react only to the user's messages; ${parsed.target} is not one.`);
            return;
          }
          const emoji = normalizeReactionEmoji(parsed.emoji);
          if (!emoji) {
            notice(`"${parsed.emoji}" is not a reaction: a reaction is one emoji.`);
            return;
          }
          const item = appendDotItem(dotId, { kind: 'reaction', target: target.id, emoji, label: parsed.label.slice(0, 48), text: '', turnId });
          onEvent({ type: 'reaction', itemId: item.id });
        },
        onStatus: (text) => {
          flushProse();
          appendDotItem(dotId, { kind: 'status', text, turnId });
          updateDotRuntime(dotId, { upNext: text });
          onEvent({ type: 'status', text });
        },
        onPatchOpen: () => onEvent({ type: 'activity', label: 'Writing a file' }),
        onPatchLine: () => undefined,
        onPatchClose: (patch) => {
          flushProse();
          const call = appendDotItem(dotId, { kind: 'call', tool: 'apply_patch', args: { patch }, text: '', turnId });
          let text: string;
          let failed = false;
          try {
            const result = applyPatch(options.workspace.readFiles(), parsePatch(patch));
            options.workspace.writeFiles(result.files);
            text = `Patch applied: ${result.changes.map((change) => `${change.kind} ${change.path}`).join(', ') || 'no changes'}.`;
          } catch (error) {
            failed = true;
            text = `ERROR apply_patch: ${error instanceof Error ? error.message : String(error)}`;
            needsAnotherLook = true;
          }
          appendDotItem(dotId, { kind: 'result', tool: 'apply_patch', callId: call.id, text, failed, turnId });
        },
        onCall: (name, body) => calls.push({ name, body }),
      });

      try {
        await transport(
          messages,
          { ...options.model.options, signal } as AiOptions,
          (token) => {
            markRead();
            parser.push(token);
          },
          () => undefined,
          context.systemPrompt,
          (phase) => {
            markRead();
            onEvent({ type: 'activity', label: PHASE_LABELS[phase] ?? null });
          },
          // The bot declares no native functions; its tools are text calls.
          async () => ({ error: 'Use the text protocol to call tools.' }),
          // Provider reasoning is private and never part of the record.
          () => markRead(),
          (usage) => {
            markRead();
            onEvent({ type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
            options.onUsage?.(usage, context.promptChars);
          },
        );
        parser.end();
      } finally {
        // A message cut off by an error or a stop is kept as far as it got.
        const open = message as { itemId: string | null; text: string; timer?: ReturnType<typeof setTimeout> } | null;
        if (open?.itemId) {
          clearTimeout(open.timer);
          updateDotItem(dotId, open.itemId, { text: open.text.trim(), streaming: false });
          message = null;
        }
        flushProse();
      }

      if (signal.aborted) return { reason: 'cancelled', iterations: iteration + 1, messagesSent };

      let sleeping = false;
      let stuckOn: string | null = null;
      const prepared: PreparedCall[] = calls.map((call) => {
        try {
          return { ...call, args: parseCallBody(call.body) };
        } catch (error) {
          return { ...call, args: {}, problem: error instanceof Error ? error.message : String(error) };
        }
      });
      const execute = async (call: PreparedCall): Promise<CallOutcome | 'cancelled'> => {
        const handler = options.tools.get(call.name);
        if (!handler) return { failed: true, observation: `ERROR: there is no tool called "${call.name}". Available tools: ${[...options.tools.keys()].join(', ')}.` };
        const toolContext: DotToolContext = {
          dotId,
          turnId,
          readFiles: options.workspace.readFiles,
          writeFiles: options.workspace.writeFiles,
          signal,
          emit: (toolCall) => toolCall.id,
          patch: () => undefined,
          stopTurn: () => {
            sleeping = true;
          },
          activity: (label) => onEvent({ type: 'activity', label }),
        };
        try {
          const result = await handler.run(call.args, toolContext);
          return { observation: result.observation, failed: Boolean(result.failed), images: result.images };
        } catch (error) {
          if (signal.aborted) return 'cancelled';
          return { failed: true, observation: `ERROR ${call.name}: ${error instanceof Error ? error.message : String(error)}` };
        }
      };
      const concurrent = (call: PreparedCall) => !call.problem && CONCURRENT_TOOLS.has(call.name) && options.tools.has(call.name);

      for (let next = 0; next < prepared.length && !sleeping && !stuckOn; ) {
        if (signal.aborted) return { reason: 'cancelled', iterations: iteration + 1, messagesSent };
        // Calls run in the order they were written, except that a run of ones that only look goes out at once.
        let end = next + 1;
        if (concurrent(prepared[next])) while (end < prepared.length && concurrent(prepared[end])) end += 1;
        const batch = prepared.slice(next, end);
        next = end;

        const started: { call: PreparedCall; itemId: string; repeats: number }[] = [];
        for (const call of batch) {
          if (call.problem) {
            const item = appendDotItem(dotId, { kind: 'call', tool: call.name, args: {}, text: call.body.slice(0, 400), turnId });
            appendDotItem(dotId, { kind: 'result', tool: call.name, callId: item.id, failed: true, turnId, text: `ERROR ${call.name}: ${call.problem}` });
            continue;
          }
          const repeats = countRepeat(repeat, call);
          const item = appendDotItem(dotId, { kind: 'call', tool: call.name, args: call.args, text: '', turnId });
          if (repeats > REPEAT_STOP_AT) {
            appendDotItem(dotId, { kind: 'result', tool: call.name, callId: item.id, failed: true, turnId, text: repeatRefusal(call.name, repeats - 1) });
            stuckOn = call.name;
            break;
          }
          if (repeats === REPEAT_STOP_AT) {
            appendDotItem(dotId, { kind: 'result', tool: call.name, callId: item.id, failed: true, turnId, text: repeatRefusal(call.name, repeats - 1) });
            continue;
          }
          onEvent({ type: 'call-start', itemId: item.id, tool: call.name });
          onEvent({ type: 'activity', label: TOOL_LABELS[call.name] ?? `Using ${call.name.replace(/^(app|mcp):/, '')}` });
          started.push({ call, itemId: item.id, repeats });
        }

        const outcomes = await Promise.all(started.map(({ call }) => execute(call)));
        if (outcomes.includes('cancelled')) return { reason: 'cancelled', iterations: iteration + 1, messagesSent };
        outcomes.forEach((outcome, index) => {
          if (outcome === 'cancelled') return;
          const { call, itemId, repeats } = started[index];
          // Pictures that were looked up add up; of screens only the latest, as an earlier one is already out of date.
          if (outcome.images?.length) images = CONCURRENT_TOOLS.has(call.name) ? [...images, ...outcome.images] : outcome.images;
          appendDotItem(dotId, { kind: 'result', tool: call.name, callId: itemId, text: outcome.observation, failed: outcome.failed, turnId });
          onEvent({ type: 'call-end', itemId, failed: outcome.failed });
          if (repeats === REPEAT_NOTICE_AT) appendDotItem(dotId, { kind: 'event', event: 'notice', text: repeatNotice(call.name, repeats), turnId });
          if (CHECKS_CHANGES.includes(call.name)) changes.checked = true;
          if (!outcome.failed && (call.name === 'computer_apply_patch' || (call.name === 'user_apply_patch' && outcome.observation.startsWith('Changed ')))) {
            changes.made = true;
            changes.checked = false;
          }
        });
      }
      onEvent({ type: 'activity', label: null });
      if (stuckOn) {
        appendDotItem(dotId, { kind: 'event', event: 'notice', text: repeatEndNotice(stuckOn), turnId });
        return { reason: 'limit', iterations: iteration + 1, messagesSent };
      }

      // Inputs that arrived while this response was being written were not in
      // view when it was written: place them after it in later transcripts.
      const arrived = arrivedSince(dotId, seenUpTo).filter((item) => item.turnId !== turnId);
      const lastOutput = (getDotThread(dotId)?.items ?? []).reduce((max, item) => (item.turnId === turnId ? Math.max(max, item.seq) : max), 0);
      arrived
        .filter((item) => item.seq < lastOutput && item.order === undefined)
        .forEach((item, index) => updateDotItem(dotId, item.id, { order: lastOutput + (index + 1) / 1_000 }));

      if (sleeping) return { reason: 'sleeping', iterations: iteration + 1, messagesSent };
      // Work the user waits on in silence: once it has run a while, a word is due before the bot goes on — told once a
      // turn, with the next request the work makes anyway.
      const waiting = !toldQuiet && calls.length > 0 ? waitingOn(dotId) : null;
      if (waiting && Date.now() - waiting.at >= quietWorkMs) {
        toldQuiet = true;
        appendDotItem(dotId, { kind: 'event', event: 'notice', text: quietWorkNotice(Math.round((Date.now() - waiting.at) / 1_000)), turnId });
      }
      const steered = arrived.some(wakesDot);
      if (calls.length === 0 && !needsAnotherLook && !steered && !acted && !toldUnheard && userWaiting(dotId)) {
        toldUnheard = true;
        appendDotItem(dotId, { kind: 'event', event: 'notice', text: wroteProse ? UNHEARD_NOTICE.prose : UNHEARD_NOTICE.empty, turnId });
        continue;
      }
      if (calls.length === 0 && !needsAnotherLook && !steered && changes.made && !changes.checked && !toldCheck && CHECKS_CHANGES.some((tool) => options.tools.has(tool))) {
        toldCheck = true;
        appendDotItem(dotId, { kind: 'event', event: 'notice', text: CHECK_CHANGE_NOTICE, turnId });
        continue;
      }
      if (calls.length === 0 && !needsAnotherLook && !steered) return { reason: 'idle', iterations: iteration + 1, messagesSent };
    }
    appendDotItem(dotId, {
      kind: 'event',
      event: 'notice',
      turnId,
      text: `This turn reached the limit of ${maxIterations} steps and was ended. If work remains, continue it in your next turn.`,
    });
    return { reason: 'limit', iterations: iteration, messagesSent };
  } catch (error) {
    if (signal.aborted) return { reason: 'cancelled', iterations: iteration, messagesSent };
    const text = error instanceof Error ? error.message : String(error);
    if (CONTEXT_OVERFLOW.test(text)) throw new DotContextOverflowError(text);
    return { reason: 'error', error: text, iterations: iteration, messagesSent };
  }
};
