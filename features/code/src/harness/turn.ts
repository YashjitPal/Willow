/**
 * The Code harness's turn loop.
 *
 * One user message is one turn. A turn is a bounded loop of rounds; each round
 * streams one model reply. While the reply streams, every action applies to the
 * turn's working copy the moment its tag closes, and the transcript shows each
 * file as it is written. When the reply ends:
 *
 * 1. tools it called run, in the order it called them, and their results go
 *    back as the next round's input;
 * 2. an action that failed (a SEARCH that did not match, a write cut off by the
 *    output limit) goes back as feedback, so the model fixes it in the same turn;
 * 3. if the model is done and the project changed, the harness builds and runs
 *    it, and any errors go back for a fix round — up to `maxFixRounds`.
 *
 * The turn ends when a round produces nothing further to do. The working copy is
 * returned to the caller, which commits it to the workbench in one step.
 *
 * `platform/ai` only moves bytes here: every decision about what the agent does
 * is made in this file, and the transport is injectable so the whole loop can be
 * driven by a scripted model in tests.
 */

import type { AiOptions } from '@willow/ai/chat';
import type { LibrarySkill } from '@willow/core/skill-library';
import type { McpBoundTool } from '@willow/ai/mcp/mcp-store';
import { applyPatch, parsePatch, PatchApplyError, PatchParseError } from './apply-patch';
import { withBuiltinSkills } from './builtin-skills';
import { codeTool, type CodeToolId } from './code-tools';
import { buildProjectSnapshot, type ConversationMessage } from './context';
import { findLooseCode, looseCodeFeedback, stripLooseCode } from './loose-code';
import { makeConnectorTools, renderConnectorsSection } from './mcp';
import { buildSystemPrompt } from './prompt';
import {
  MUTATING_KINDS,
  nextId,
  stepsText,
  TAGS,
  type CheckStep,
  type FileStep,
  type ParsedBlock,
  type PlanItem,
  type StopReason,
  type TurnMode,
  type TurnOutcome,
  type TurnPhase,
  type TurnStep,
} from './protocol';
import { makeSkillTools, renderSkillsSection, skillLocator, skillsMentionedIn } from './skills';
import { announcedWithoutActing, CONTINUE_FEEDBACK } from './stalled';
import { applySearchReplace, parseSearchReplace } from './search-replace';
import { cleanFileBody, StreamParser } from './stream-parser';
import { BUILTIN_TOOLS, parseToolArgs, type HarnessTool, type ToolContext, type ToolImage } from './tools';
import { formatCheckReport, reportHasErrors, summarizeCheck, type CheckReport, type ProjectChecker } from './verify';
import { countLines, PathError, Workspace } from './workspace';
import { isValidPackageName } from '../runtime/preview/packages';

/* ------------------------------------------------------------------------ */
/* Options                                                                   */
/* ------------------------------------------------------------------------ */

export interface ModelBinding {
  /** Display name. */
  label: string;
  /** Passed through to the transport; the harness adds the signal. */
  options: Omit<AiOptions, 'signal'>;
}

export interface TurnAttachment {
  type: 'image' | 'text' | 'file';
  mimeType: string;
  /** Base64 for an image, the text itself otherwise. */
  data: string;
  name?: string;
  /** A tool's picture, such as a screenshot. Only the newest few stay in the conversation. */
  fromTool?: boolean;
}

export interface TransportMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: TurnAttachment[];
}

/**
 * The one thing the harness needs from a provider: stream a reply. Shaped like
 * `streamChat`, which is the default.
 */
export type Transport = (
  messages: TransportMessage[],
  options: AiOptions,
  onToken: (token: string) => void,
  onStart: () => void,
  systemPrompt: string,
  onPhase: undefined,
  onToolCall: undefined,
  onThought: (thought: string) => void,
) => Promise<unknown>;

export interface TurnState {
  steps: TurnStep[];
  phase: TurnPhase | null;
  /** The model's thought summaries so far this turn, a paragraph per round. Only the newest part is kept. */
  thoughts: string;
}

export interface TurnOptions {
  prompt: string;
  /** Files and images the user attached to this message. */
  attachments?: TurnAttachment[];
  /** Facts appended after the project snapshot, e.g. where attached images were saved. */
  promptNotes?: string[];
  /** Earlier turns, already compacted. */
  history: ConversationMessage[];
  /** The project as the turn begins. */
  files: Record<string, string>;
  /** Paths recent turns changed, shown first in the snapshot. */
  recentPaths?: string[];
  mode: TurnMode;
  /** The tool the user picked in the composer for this message. */
  selectedTool?: CodeToolId | null;
  model: ModelBinding;
  /** Enabled skills, snapshotted for the turn. Willow's built-in skills are added to them. */
  skills?: readonly LibrarySkill[];
  /** Tools from connected MCP servers, snapshotted for the turn. */
  connectors?: readonly McpBoundTool[];
  /** Any further tool source. */
  extraTools?: readonly HarnessTool[];
  /** Builds and runs the project. Without one, nothing is verified. */
  checker?: ProjectChecker;
  signal?: AbortSignal;
  transport?: Transport;
  /** Rounds per turn. */
  maxRounds?: number;
  /** Rounds spent fixing errors the automatic check found. */
  maxFixRounds?: number;
  /** Every change to the transcript or the phase. */
  onUpdate?: (state: TurnState) => void;
  /** The file being written right now, or null. */
  onWriting?: (path: string | null) => void;
  /** The model produced its first visible output. */
  onFirstOutput?: () => void;
  /** Milliseconds, for timing the thinking. `performance.now` by default. */
  clock?: () => number;
}

export interface TurnResult extends TurnOutcome {
  workspace: Workspace;
  /** The exact conversation sent, for the debug log. */
  transcript: { systemPrompt: string; messages: TransportMessage[] };
}

/** Room for a build, a test session in the preview, and a fix, in one message. */
const DEFAULT_MAX_ROUNDS = 40;
const DEFAULT_MAX_FIX_ROUNDS = 3;
/** Screenshots cost the most context; older ones are dropped once newer ones arrive. */
const MAX_TOOL_IMAGES = 2;
const MAX_TRANSIENT_RETRIES = 2;
const COMPACT_WRITE_LINES = 120;
const MAX_ERROR_FILE_CHARS = 30_000;
/** Past this, older replies in the turn lose their long write bodies. */
const MAX_CONVERSATION_CHARS = 300_000;
/** Only the newest thought heading is ever shown, so the thoughts keep their tail. */
const MAX_THOUGHT_CHARS = 16_000;
const KEPT_THOUGHT_CHARS = 8_000;

const defaultClock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const defaultTransport: Transport = async (...args) => {
  const { streamChat } = await import('@willow/ai/chat');
  return (streamChat as Transport)(...args);
};

class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'AbortError';
  }
}

const isAbort = (error: unknown, signal?: AbortSignal): boolean =>
  Boolean(signal?.aborted) ||
  error instanceof Cancelled ||
  (!!error && typeof error === 'object' &&
    (/(abort|cancel)/i.test(String((error as { name?: unknown }).name ?? '')) ||
      /(abort|cancel)/i.test(String((error as { code?: unknown }).code ?? ''))));

/** Failures worth one more try: rate limits, overload, a dropped connection. */
const isTransient = (error: unknown): boolean => {
  const status = Number((error as { status?: unknown })?.status ?? (error as { response?: { status?: unknown } })?.response?.status ?? 0);
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return true;
  const text = String((error as Error)?.message ?? error);
  return /overloaded|rate.?limit|too many requests|temporarily|unavailable|timeout|timed out|ECONNRESET|network|fetch failed|socket hang up|502|503|504|529/i.test(text);
};

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Cancelled());
    }, { once: true });
  });

/* ------------------------------------------------------------------------ */
/* The transcript recorder                                                   */
/* ------------------------------------------------------------------------ */

class Recorder {
  steps: TurnStep[] = [];
  phase: TurnPhase | null = null;
  thoughts = '';
  /** Time spent in the thinking phase, over every round. */
  thinkingMs = 0;
  #thinkingSince: number | null = null;
  #breakBeforeText = false;
  #breakBeforeThought = false;
  #firstOutput = false;

  constructor(
    private readonly onUpdate?: (state: TurnState) => void,
    private readonly onFirstOutput?: () => void,
    private readonly clock: () => number = defaultClock,
  ) {}

  #emit(): void {
    this.onUpdate?.({ steps: this.steps, phase: this.phase, thoughts: this.thoughts });
  }

  #noteOutput(): void {
    if (this.#firstOutput) return;
    this.#firstOutput = true;
    this.onFirstOutput?.();
  }

  #enterPhase(phase: TurnPhase | null): void {
    const now = this.clock();
    if (this.#thinkingSince !== null) {
      this.thinkingMs += now - this.#thinkingSince;
      this.#thinkingSince = null;
    }
    if (phase === 'thinking') this.#thinkingSince = now;
    this.phase = phase;
  }

  setPhase(phase: TurnPhase | null): void {
    if (this.phase === phase) return;
    this.#enterPhase(phase);
    this.#emit();
  }

  /** A new round: its prose and its thoughts each start a new paragraph. */
  breakText(): void {
    this.#breakBeforeText = true;
    this.#breakBeforeThought = true;
  }

  thought(chunk: string): void {
    if (!chunk) return;
    let addition = chunk;
    if (this.#breakBeforeThought) {
      if (!chunk.trim()) return;
      this.#breakBeforeThought = false;
      // A heading only counts alone on its line, so a round's first one must not join the last round's prose.
      if (this.thoughts) addition = `\n\n${chunk.replace(/^\s+/, '')}`;
    }
    let next = this.thoughts + addition;
    if (next.length > MAX_THOUGHT_CHARS) {
      const lineStart = next.indexOf('\n', next.length - KEPT_THOUGHT_CHARS);
      next = lineStart === -1 ? next.slice(-KEPT_THOUGHT_CHARS) : next.slice(lineStart + 1);
    }
    this.thoughts = next;
    this.#emit();
  }

  text(chunk: string): void {
    if (!chunk) return;
    const last = this.steps[this.steps.length - 1];
    if (last?.kind === 'text') {
      let addition = chunk;
      if (this.#breakBeforeText) {
        if (!chunk.trim()) return;
        addition = `\n\n${chunk.replace(/^\s+/, '')}`;
        this.#breakBeforeText = false;
      }
      this.steps = [...this.steps.slice(0, -1), { ...last, text: last.text + addition }];
    } else {
      // Whitespace between two actions is not a paragraph.
      if (!chunk.trim()) return;
      this.#breakBeforeText = false;
      this.steps = [...this.steps, { id: nextId('text'), kind: 'text', text: chunk.replace(/^\s+/, '') }];
    }
    this.#noteOutput();
    this.#emit();
  }

  add(step: TurnStep): string {
    this.steps = [...this.steps, step];
    this.#breakBeforeText = false;
    this.#noteOutput();
    this.#emit();
    return step.id;
  }

  patch(id: string, patch: Partial<TurnStep>): void {
    const index = this.steps.findIndex((step) => step.id === id);
    if (index === -1) return;
    const next = [...this.steps];
    next[index] = { ...next[index]!, ...patch } as TurnStep;
    this.steps = next;
    this.#emit();
  }

  find<K extends TurnStep['kind']>(kind: K): Extract<TurnStep, { kind: K }> | undefined {
    return this.steps.find((step) => step.kind === kind) as Extract<TurnStep, { kind: K }> | undefined;
  }

  /** Steps still running when the turn stops did not finish; they are marked so. */
  settle(reason: StopReason): void {
    let changed = false;
    const interrupted = reason === 'cancelled' || reason === 'error';
    const next = this.steps.map((step) => {
      if ('status' in step && step.status === 'running') {
        changed = true;
        return interrupted
          ? ({ ...step, status: 'error', error: reason === 'cancelled' ? 'Stopped' : 'Interrupted' } as TurnStep)
          : ({ ...step, status: 'done' } as TurnStep);
      }
      return step;
    });
    if (changed) this.steps = next;
    this.#enterPhase(null);
    this.#emit();
  }

  mapText(transform: (text: string) => string): void {
    this.steps = this.steps.map((step) => (step.kind === 'text' ? { ...step, text: transform(step.text) } : step));
  }
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

/** A reply with its long write bodies replaced by a note; the files hold them. */
function compactReply(raw: string): string {
  return raw.replace(/(<willow-write\b[^>]*>)([\s\S]*?)(<\/willow-write>)/g, (whole, open: string, body: string, close: string) => {
    const lines = body.split('\n').length;
    if (lines <= COMPACT_WRITE_LINES) return whole;
    return `${open}\n[${lines} lines written and applied — the file now holds them; read_file shows the current contents]\n${close}`;
  });
}

/**
 * Keeps a long turn inside the context window.
 *
 * Only when it has to: a model that can still see the file it just wrote edits
 * it directly, while one whose write was compacted away reads it back first —
 * a round trip per edit. The newest reply is never compacted.
 */
function fitConversation(conversation: TransportMessage[]): void {
  let total = conversation.reduce((sum, message) => sum + message.content.length, 0);
  if (total <= MAX_CONVERSATION_CHARS) return;
  const newest = conversation.map((message) => message.role).lastIndexOf('assistant');
  for (let index = 0; index < conversation.length && total > MAX_CONVERSATION_CHARS; index += 1) {
    const message = conversation[index]!;
    if (message.role !== 'assistant' || index === newest) continue;
    const compacted = compactReply(message.content);
    total -= message.content.length - compacted.length;
    conversation[index] = { ...message, content: compacted };
  }
}

const toolNameOf = (block: ParsedBlock): string => (block.attrs.name ?? block.attrs.tool ?? '').trim();

/**
 * Keeps the newest tool pictures and drops the rest, saying so where each was.
 * The user's own attachments are never touched.
 */
function pruneToolImages(conversation: TransportMessage[], keep = MAX_TOOL_IMAGES): void {
  let kept = 0;
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index]!;
    if (!message.attachments?.some((attachment) => attachment.fromTool)) continue;
    const remaining: TurnAttachment[] = [];
    let dropped = 0;
    for (let at = message.attachments.length - 1; at >= 0; at -= 1) {
      const attachment = message.attachments[at]!;
      if (!attachment.fromTool || kept < keep) {
        if (attachment.fromTool) kept += 1;
        remaining.unshift(attachment);
      } else {
        dropped += 1;
      }
    }
    if (dropped === 0) continue;
    conversation[index] = {
      ...message,
      attachments: remaining.length > 0 ? remaining : undefined,
      content: `${message.content}\n\n[${dropped === 1 ? 'The screenshot' : `${dropped} screenshots`} from this step ${dropped === 1 ? 'was' : 'were'} removed to save space; newer ones show the app as it is now.]`,
    };
  }
}

/** `- [x] Done`, `- [ ] Todo`, `- [~] Doing`, or a plain bullet. */
export function parsePlan(body: string): PlanItem[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(?:[-*+]|\d+[.)])?\s*(?:\[(.)\])?\s*(.+)$/.exec(line);
      if (!match) return null;
      const mark = (match[1] ?? ' ').toLowerCase();
      const text = match[2]!.trim();
      if (!text) return null;
      const status: PlanItem['status'] = mark === 'x' || mark === '✓' ? 'completed' : mark === '~' || mark === '-' || mark === '>' || mark === '/' ? 'in_progress' : 'pending';
      return { text, status };
    })
    .filter((item): item is PlanItem => Boolean(item))
    .slice(0, 30);
}

function wrapFeedback(parts: string[]): string {
  return `<willow_feedback>\n${parts.join('\n\n')}\n</willow_feedback>`;
}

/* ------------------------------------------------------------------------ */
/* One round                                                                 */
/* ------------------------------------------------------------------------ */

interface RoundResult {
  /** The reply's prose, actions removed. */
  prose: string;
  /** The reply as written, actions included — what goes back as the assistant message. */
  raw: string;
  tools: ParsedBlock[];
  /** Feedback about actions that failed. */
  problems: string[];
  /** One line per action applied. */
  applied: string[];
  /** The reply ended inside an action. */
  truncated: boolean;
  /** Any action was attempted. */
  acted: boolean;
}

interface RoundContext {
  options: TurnOptions;
  recorder: Recorder;
  workspace: Workspace;
  systemPrompt: string;
  transport: Transport;
}

/** Applies one action to the working copy and records it. */
function applyBlock(block: ParsedBlock, context: RoundContext, openSteps: Map<string, string>, result: RoundResult): void {
  const { workspace, recorder, options } = context;
  // A checklist alone is not work: a reply that plans and stops has stalled.
  if (block.kind !== 'plan') result.acted = true;

  if (block.kind === 'tool') {
    result.tools.push(block);
    return;
  }

  if (block.kind === 'ignored') {
    result.problems.push(
      `<${block.tag}> is not an action Willow knows. Use ${Object.values(TAGS).map((tag) => `<${tag}>`).join(', ')}.`,
    );
    return;
  }

  if (block.kind === 'plan') {
    const items = parsePlan(block.body);
    if (items.length === 0) return;
    const existing = recorder.find('plan');
    if (existing) recorder.patch(existing.id, { items });
    else recorder.add({ id: nextId('step'), kind: 'plan', items });
    return;
  }

  if (options.mode === 'plan' && MUTATING_KINDS.has(block.kind)) {
    const stepId = openSteps.get(block.id);
    if (stepId) recorder.patch(stepId, { status: 'error', error: 'Plan mode' });
    result.problems.push(
      'Plan mode is on, so files cannot be changed and nothing was written. Describe the change in your plan instead.',
    );
    return;
  }

  const fileStep = (path: string, action: FileStep['action']): string => {
    const open = openSteps.get(block.id);
    if (open) {
      recorder.patch(open, { path, action });
      return open;
    }
    return recorder.add({ id: nextId('step'), kind: 'file', action, path, status: 'running' });
  };

  const fail = (stepId: string | undefined, message: string, short?: string) => {
    if (stepId) recorder.patch(stepId, { status: 'error', error: short ?? message.split('\n')[0]!.slice(0, 160) });
    result.problems.push(message);
  };

  const resolve = (raw: string | undefined): string | null => {
    try {
      return workspace.resolvePath(raw ?? '');
    } catch (error) {
      if (error instanceof PathError) return null;
      throw error;
    }
  };

  switch (block.kind) {
    case 'write': {
      const path = resolve(block.attrs.path ?? block.attrs.file ?? block.attrs.filePath);
      const stepId = openSteps.get(block.id);
      if (!path) {
        fail(stepId, `A <${block.tag}> had an invalid or missing path ("${block.attrs.path ?? ''}"). Paths look like /components/Button.tsx.`, 'Invalid path');
        return;
      }
      const id = fileStep(path, 'write');
      if (!block.complete) {
        fail(
          id,
          `Your reply was cut off while writing ${path}, so that file was not written. Write it again in full ` +
            '(if it is very long, split it into smaller components across several files), then continue with the rest.',
          'Cut off',
        );
        return;
      }
      const content = cleanFileBody(block.body);
      if (path.endsWith('.json')) {
        try {
          JSON.parse(content);
        } catch (error) {
          fail(id, `${path} is not valid JSON (${(error as Error).message}), so it was not written. Send it again as valid JSON.`, 'Invalid JSON');
          return;
        }
      }
      const outcome = workspace.write(path, content);
      recorder.patch(id, { status: 'done', created: outcome.created, added: outcome.added, removed: outcome.removed });
      result.applied.push(`${outcome.created ? 'created' : 'wrote'} ${path} (${countLines(content)} lines)`);
      return;
    }

    case 'edit': {
      const path = resolve(block.attrs.path ?? block.attrs.file);
      const stepId = openSteps.get(block.id);
      if (!path) {
        fail(stepId, `A <${block.tag}> had an invalid or missing path ("${block.attrs.path ?? ''}").`, 'Invalid path');
        return;
      }
      const id = fileStep(path, 'edit');
      const parsed = parseSearchReplace(block.body);
      if (parsed.error) {
        fail(id, `Edit to ${path}: ${parsed.error}`, 'Malformed edit');
        return;
      }
      const current = workspace.read(path);
      if (current === undefined) {
        if (parsed.blocks.every((entry) => entry.search.trim() === '')) {
          const content = cleanFileBody(parsed.blocks.map((entry) => entry.replace).join('\n'));
          const outcome = workspace.write(path, content);
          recorder.patch(id, { status: 'done', created: true, added: outcome.added, removed: 0 });
          result.applied.push(`created ${path}`);
          return;
        }
        const similar = workspace.similarPaths(path);
        fail(
          id,
          `Edit to ${path}: the file does not exist.${similar.length > 0 ? ` Did you mean ${similar.join(' or ')}?` : ''} Use <${TAGS.write}> to create a new file.`,
          'File not found',
        );
        return;
      }
      if (!block.complete) {
        // Blocks that closed before the cut-off are sound; a REPLACE that was
        // still being written is not, and applying it would leave half a change.
        const endedCleanly = /(?:>{5,9}|\+{5,9})[ \t]*REPLACE[ \t]*$/i.test(block.body.trimEnd());
        if (!endedCleanly) parsed.blocks = parsed.blocks.slice(0, -1);
        if (parsed.blocks.length === 0) {
          fail(id, `Your reply was cut off inside the edit to ${path}, so nothing was applied to it. Send the edit again.`, 'Cut off');
          return;
        }
      }
      const edit = applySearchReplace(current, parsed.blocks, path);
      if (edit.applied > 0) {
        const outcome = workspace.write(path, edit.content);
        recorder.patch(id, { status: 'done', added: outcome.added, removed: outcome.removed });
        result.applied.push(
          `edited ${path} (${edit.applied} of ${parsed.blocks.length} block${parsed.blocks.length === 1 ? '' : 's'} applied)`,
        );
      }
      if (edit.failures.length > 0) {
        const message =
          `Edit to ${path}: ${edit.failures.length} of ${parsed.blocks.length} SEARCH/REPLACE block${parsed.blocks.length === 1 ? '' : 's'} did not apply` +
          `${edit.applied > 0 ? ' (the others did)' : ''}.\n${edit.failures.map((failure) => failure.message).join('\n\n')}\n` +
          'Resend only the blocks that failed, with SEARCH copied exactly from the lines above.';
        if (edit.applied === 0) fail(id, message, 'SEARCH did not match');
        else result.problems.push(message);
      }
      if (!block.complete) {
        result.problems.push(`Your reply was cut off inside the edit to ${path}. Check that file and finish the change.`);
      }
      return;
    }

    case 'delete': {
      const path = resolve(block.attrs.path ?? block.attrs.file);
      if (!path) {
        result.problems.push(`A <${block.tag}> had an invalid or missing path.`);
        return;
      }
      const id = fileStep(path, 'delete');
      if (!workspace.exists(path)) {
        fail(id, `Could not delete ${path}: it does not exist.`, 'Not found');
        return;
      }
      const lines = workspace.delete(path);
      recorder.patch(id, { status: 'done', removed: lines });
      result.applied.push(`deleted ${path}`);
      return;
    }

    case 'rename': {
      const from = resolve(block.attrs.from ?? block.attrs.path);
      const to = resolve(block.attrs.to ?? block.attrs.destination);
      if (!from || !to) {
        result.problems.push(`A <${block.tag}> needs both "from" and "to" paths.`);
        return;
      }
      const id = recorder.add({ id: nextId('step'), kind: 'file', action: 'rename', path: from, toPath: to, status: 'running' });
      try {
        workspace.rename(from, to);
        recorder.patch(id, { status: 'done' });
        result.applied.push(`renamed ${from} to ${to}`);
      } catch (error) {
        fail(id, `Could not rename ${from} to ${to}: ${(error as Error).message}`);
      }
      return;
    }

    case 'dependency': {
      const name = (block.attrs.name ?? block.attrs.package ?? '').trim();
      const version = (block.attrs.version ?? '').trim();
      const id = recorder.add({ id: nextId('step'), kind: 'dependency', name: name || '(unnamed)', version: version || undefined, status: 'running' });
      if (!name || !isValidPackageName(name)) {
        recorder.patch(id, { status: 'error', error: 'Invalid name' });
        result.problems.push(`"${name}" is not a valid npm package name.`);
        return;
      }
      if (name === 'react' || name === 'react-dom') {
        recorder.patch(id, { status: 'done' });
        result.applied.push(`${name} is provided by the preview (no change)`);
        return;
      }
      const manifestPath = workspace.exists('/package.json') ? '/package.json' : workspace.exists('/src/package.json') ? '/src/package.json' : '/package.json';
      let manifest: Record<string, unknown> = { name: 'willow-app', private: true, dependencies: {} };
      const existing = workspace.read(manifestPath);
      if (existing) {
        try {
          manifest = JSON.parse(existing) as Record<string, unknown>;
        } catch {
          recorder.patch(id, { status: 'error', error: 'package.json is invalid' });
          result.problems.push(`${manifestPath} is not valid JSON, so ${name} could not be added. Rewrite it with <${TAGS.write}>.`);
          return;
        }
      }
      const dependencies = { ...((manifest.dependencies as Record<string, string> | undefined) ?? {}) };
      dependencies[name] = version || 'latest';
      manifest.dependencies = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)));
      workspace.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      recorder.patch(id, { status: 'done' });
      result.applied.push(`added ${name}${version ? `@${version}` : ''} to ${manifestPath}`);
      return;
    }

    case 'patch': {
      const stepId = openSteps.get(block.id);
      if (!block.complete) {
        if (stepId) recorder.patch(stepId, { status: 'error', error: 'Cut off' });
        result.problems.push('Your reply was cut off inside a patch, so it was not applied. Send the change again.');
        return;
      }
      try {
        const ops = parsePatch(block.body).map((op) => ({
          ...op,
          path: workspace.resolvePath(op.path),
          movePath: op.movePath ? workspace.resolvePath(op.movePath) : undefined,
        }));
        const { files, changes } = applyPatch(workspace.files, ops);
        let reused = false;
        for (const change of changes) {
          const target = change.movePath ?? change.path;
          const action: FileStep['action'] = change.kind === 'delete' ? 'delete' : change.kind === 'add' ? 'write' : 'edit';
          const id = !reused && stepId ? stepId : recorder.add({ id: nextId('step'), kind: 'file', action, path: target, status: 'running' });
          reused = true;
          if (change.kind === 'delete') {
            workspace.delete(change.path);
            recorder.patch(id, { path: change.path, action, status: 'done', removed: change.removed });
          } else {
            if (change.movePath) workspace.delete(change.path);
            const outcome = workspace.write(target, files[target]!);
            recorder.patch(id, { path: target, action, status: 'done', created: change.kind === 'add', added: outcome.added, removed: outcome.removed });
          }
          result.applied.push(`${change.kind === 'add' ? 'created' : change.kind === 'delete' ? 'deleted' : 'edited'} ${target}`);
        }
        if (!reused && stepId) recorder.patch(stepId, { status: 'done' });
      } catch (error) {
        const message = error instanceof PatchParseError
          ? `The patch could not be parsed (line ${error.line}): ${error.message}`
          : error instanceof PatchApplyError
            ? `The patch could not be applied to ${error.path}: ${error.message}`
            : `The patch failed: ${(error as Error).message}`;
        if (stepId) recorder.patch(stepId, { status: 'error', error: message.slice(0, 160) });
        result.problems.push(`${message}\nPrefer <${TAGS.edit}> with SEARCH/REPLACE blocks.`);
      }
      return;
    }
  }
}

async function streamRound(conversation: TransportMessage[], context: RoundContext): Promise<RoundResult> {
  const { options, recorder } = context;
  const result: RoundResult = { prose: '', raw: '', tools: [], problems: [], applied: [], truncated: false, acted: false };
  const openSteps = new Map<string, string>();

  const parser = new StreamParser({
    onText: (chunk) => {
      result.prose += chunk;
      recorder.text(chunk);
    },
    onBlockOpen: (block) => {
      if (block.kind === 'write' || block.kind === 'edit' || block.kind === 'patch') {
        if (options.mode === 'plan') return;
        const raw = block.attrs.path ?? block.attrs.file ?? block.attrs.filePath ?? '';
        let path = raw;
        try {
          path = context.workspace.resolvePath(raw);
        } catch {
          /* reported when the block closes */
        }
        const action: FileStep['action'] = block.kind === 'edit' ? 'edit' : 'write';
        const label = block.kind === 'patch' ? 'patch' : path || 'file';
        const stepId = recorder.add({ id: nextId('step'), kind: 'file', action, path: label, status: 'running' });
        openSteps.set(block.id, stepId);
        if (block.kind !== 'patch') options.onWriting?.(path || null);
      }
    },
    onBlock: (block) => {
      if (block.kind === 'write' || block.kind === 'edit' || block.kind === 'patch') options.onWriting?.(null);
      if (!block.complete) result.truncated = true;
      applyBlock(block, context, openSteps, result);
    },
  });

  let received = false;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await context.transport(
        conversation,
        { ...options.model.options, enableSearch: false, enableCodeExecution: false, signal: options.signal } as AiOptions,
        (token: string) => {
          if (options.signal?.aborted) return;
          if (!received) {
            received = true;
            recorder.setPhase('responding');
          }
          result.raw += token;
          parser.push(token);
        },
        () => {},
        context.systemPrompt,
        undefined,
        undefined,
        (thought: string) => {
          if (!options.signal?.aborted) recorder.thought(thought);
        },
      );
      break;
    } catch (error) {
      if (isAbort(error, options.signal)) throw new Cancelled();
      if (received || attempt >= MAX_TRANSIENT_RETRIES || !isTransient(error)) throw error;
      await wait(attempt === 0 ? 1_500 : 4_000, options.signal);
    }
  }

  parser.end();
  options.onWriting?.(null);
  if (options.signal?.aborted) throw new Cancelled();
  return result;
}

/* ------------------------------------------------------------------------ */
/* Tools                                                                     */
/* ------------------------------------------------------------------------ */

interface ToolRun {
  outputs: string[];
  images: ToolImage[];
  /** A tool asked to end the turn and wait for the user. */
  awaitingApproval: boolean;
}

async function runTools(
  blocks: ParsedBlock[],
  registry: Map<string, HarnessTool>,
  context: RoundContext,
  toolContext: ToolContext,
): Promise<ToolRun> {
  const { recorder, options } = context;
  const outputs: string[] = [];
  const images: ToolImage[] = [];
  let awaitingApproval = false;

  for (const block of blocks) {
    if (options.signal?.aborted) throw new Cancelled();
    const name = toolNameOf(block);
    const tool = registry.get(name);

    if (!name) {
      outputs.push('A <willow-tool> had no name attribute, so nothing ran.');
      continue;
    }
    if (!tool) {
      const available = [...registry.values()].filter((entry) => options.mode === 'build' || entry.readOnly).map((entry) => entry.name);
      outputs.push(
        name.startsWith('mcp__')
          ? `${name} is not available: that connector is not connected right now.`
          : `There is no tool named ${JSON.stringify(name)}. Available tools: ${available.join(', ')}. (Files are changed with action tags, not tools.)`,
      );
      continue;
    }
    if (options.mode === 'plan' && !tool.readOnly) {
      outputs.push(`${name} is not available in Plan mode, which only reads.`);
      continue;
    }
    if (!block.complete && !block.body.trim().endsWith('}')) {
      outputs.push(`Your reply was cut off inside the call to ${name}, so it did not run.`);
      continue;
    }

    let args: Record<string, unknown>;
    try {
      args = parseToolArgs(block.body, block.attrs);
    } catch (error) {
      outputs.push(`${name}: ${(error as Error).message}`);
      continue;
    }

    const step = tool.startStep(args);
    const stepId = step ? recorder.add(step) : null;
    try {
      const run = await tool.run(args, toolContext);
      if (stepId && run.step) recorder.patch(stepId, run.step);
      else if (stepId) recorder.patch(stepId, { status: run.isError ? 'error' : 'done' } as Partial<TurnStep>);
      const pictures = run.images ?? [];
      images.push(...pictures);
      const attached = pictures.length === 0 ? '' : `\n[${pictures.length === 1 ? 'Screenshot' : `${pictures.length} pictures`} attached.]`;
      outputs.push(`<tool_result name="${name}"${run.isError ? ' error="true"' : ''}>\n${run.output}${attached}\n</tool_result>`);
      if (run.endTurn === 'awaiting-approval') awaitingApproval = true;
    } catch (error) {
      if (isAbort(error, options.signal)) throw new Cancelled();
      if (stepId) recorder.patch(stepId, { status: 'error', error: (error as Error).message.slice(0, 160) } as Partial<TurnStep>);
      outputs.push(`<tool_result name="${name}" error="true">\n${name} failed: ${(error as Error).message}\n</tool_result>`);
    }
  }
  return { outputs, images, awaitingApproval };
}

/* ------------------------------------------------------------------------ */
/* The turn                                                                  */
/* ------------------------------------------------------------------------ */

function buildFirstMessage(options: TurnOptions, skills: readonly LibrarySkill[]): string {
  const parts = [buildProjectSnapshot(options.files, { prompt: options.prompt, recentPaths: options.recentPaths })];

  const mentioned = skills.length > 0 ? skillsMentionedIn(options.prompt, skills) : [];
  if (mentioned.length > 0) {
    parts.push(
      `The user named ${mentioned.length === 1 ? 'this skill' : 'these skills'}; read ${mentioned.length === 1 ? 'it' : 'them'} with read_skill before acting:\n` +
        mentioned.map((skill) => `- ${skill.name} (${skillLocator(skill)})`).join('\n'),
    );
  }
  for (const note of options.promptNotes ?? []) {
    if (note.trim()) parts.push(note.trim());
  }
  const picked = codeTool(options.selectedTool);
  if (picked?.directive) parts.push(`The user picked the ${picked.label} tool for this message. ${picked.directive}`);
  parts.push(`<user_message>\n${options.prompt}\n</user_message>`);
  return parts.join('\n\n');
}

/** Feedback for errors the automatic check found, with the files they name. */
function checkFeedback(report: CheckReport, workspace: Workspace): string {
  const files = [...new Set(report.buildErrors.map((error) => error.file).filter((file): file is string => Boolean(file)))];
  const attached: string[] = [];
  let used = 0;
  for (const file of files.slice(0, 3)) {
    const contents = workspace.read(file);
    if (contents === undefined || used + contents.length > MAX_ERROR_FILE_CHARS) continue;
    used += contents.length;
    attached.push(`<file path="${file}">\n${contents.replace(/\n$/, '')}\n</file>`);
  }
  return [
    'Willow built and ran the project after your changes and found problems:',
    formatCheckReport(report),
    ...(attached.length > 0 ? ['Current contents of the files involved:', ...attached] : []),
    'Fix the cause with targeted edits. Keep every feature working.',
  ].join('\n\n');
}

export async function runTurn(options: TurnOptions): Promise<TurnResult> {
  const recorder = new Recorder(options.onUpdate, options.onFirstOutput, options.clock);
  const workspace = new Workspace(options.files);
  const transport = options.transport ?? defaultTransport;
  const skills = withBuiltinSkills(options.skills ?? []);
  const connectors = options.connectors ?? [];

  const tools: HarnessTool[] = [
    ...BUILTIN_TOOLS.filter((tool) => tool.name !== 'check_project' || options.checker),
    ...makeSkillTools(skills),
    ...(options.mode === 'build' ? makeConnectorTools(connectors) : []),
    ...(options.extraTools ?? []),
  ];
  const registry = new Map(tools.map((tool) => [tool.name, tool]));

  const systemPrompt = buildSystemPrompt({
    mode: options.mode,
    tools,
    skillsSection: renderSkillsSection(skills),
    connectorsSection: renderConnectorsSection(connectors),
  });

  const conversation: TransportMessage[] = [
    ...options.history.map((message) => ({ role: message.role, content: message.content })),
    { role: 'user', content: buildFirstMessage(options, skills), attachments: options.attachments?.length ? options.attachments : undefined },
  ];

  const context: RoundContext = { options, recorder, workspace, systemPrompt, transport };

  let checkedRevision = workspace.revision;
  const check = async (automatic: boolean): Promise<CheckReport> => {
    const revision = workspace.revision;
    const step: CheckStep | null = automatic ? { id: nextId('step'), kind: 'check', status: 'running', automatic: true } : null;
    if (step) recorder.add(step);
    const previous = recorder.phase;
    recorder.setPhase('checking');
    try {
      const report = await options.checker!(workspace.files, { signal: options.signal });
      checkedRevision = revision;
      if (step) {
        const summary = summarizeCheck(report);
        recorder.patch(step.id, {
          status: reportHasErrors(report) ? 'error' : 'done',
          errors: summary.errors,
          warnings: summary.warnings,
          skipped: report.skipped,
        });
      }
      return report;
    } finally {
      recorder.setPhase(previous);
    }
  };
  const toolContext: ToolContext = {
    workspace,
    signal: options.signal,
    check: () => check(false),
    readSkills: new Set<string>(),
    mode: options.mode,
    record: {
      add: (step) => recorder.add(step),
      patch: (id, patch) => recorder.patch(id, patch),
    },
  };

  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxFixRounds = options.maxFixRounds ?? DEFAULT_MAX_FIX_ROUNDS;
  const startRevision = workspace.revision;
  let fixRounds = 0;
  let nudged = false;
  let looseNudges = 0;
  let sawLooseCode = false;

  const finish = (reason: StopReason, error?: string, awaitingApproval = false): TurnResult => {
    recorder.settle(reason);
    if (sawLooseCode) recorder.mapText(stripLooseCode);
    return {
      reason,
      error,
      steps: recorder.steps,
      text: stepsText(recorder.steps),
      changedPaths: workspace.changes().map((change) => change.path),
      awaitingApproval: awaitingApproval || undefined,
      thinkingMs: recorder.thinkingMs,
      workspace,
      transcript: { systemPrompt, messages: conversation },
    };
  };

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      if (options.signal?.aborted) throw new Cancelled();
      recorder.setPhase('thinking');
      if (round > 0) recorder.breakText();

      fitConversation(conversation);
      const result = await streamRound(conversation, context);
      conversation.push({ role: 'assistant', content: result.raw || '(empty reply)' });

      // Checking the project after changing it asks whether the finished work
      // runs, which the automatic check below answers without another round.
      if (
        options.mode === 'build' &&
        options.checker &&
        result.problems.length === 0 &&
        workspace.revision !== startRevision &&
        result.tools.length > 0 &&
        result.tools.every((block) => toolNameOf(block) === 'check_project')
      ) {
        result.tools = [];
      }

      const feedback: string[] = [];
      const pictures: TurnAttachment[] = [];
      if (result.problems.length > 0) feedback.push(...result.problems);
      if (result.tools.length > 0) {
        recorder.setPhase('tools');
        const toolRun = await runTools(result.tools, registry, context, toolContext);
        if (toolRun.awaitingApproval) return finish('finished', undefined, true);
        feedback.push(...toolRun.outputs);
        pictures.push(...toolRun.images.map((image): TurnAttachment => ({ type: 'image', mimeType: image.mimeType, data: image.data, fromTool: true })));
      }

      if (feedback.length === 0 && options.mode === 'build') {
        const loose = findLooseCode(result.prose);
        if (loose.length > 0) sawLooseCode = true;
        if (loose.length > 0 && looseNudges < 2) {
          looseNudges += 1;
          feedback.push(looseCodeFeedback(loose));
        } else if (!result.acted && !nudged && announcedWithoutActing(result.prose)) {
          nudged = true;
          feedback.push(CONTINUE_FEEDBACK);
        }
      }

      if (feedback.length === 0 && options.mode === 'build' && options.checker && workspace.revision !== checkedRevision) {
        const report = await check(true);
        if (reportHasErrors(report)) {
          if (fixRounds < maxFixRounds) {
            fixRounds += 1;
            feedback.push(checkFeedback(report, workspace));
          } else {
            recorder.add({
              id: nextId('step'),
              kind: 'notice',
              tone: 'warning',
              text: 'The preview still reports errors after several fixes. Describe what you see, or ask me to keep fixing.',
            });
          }
        }
      }

      if (feedback.length === 0) return finish('finished');

      if (result.applied.length > 0 && (result.problems.length > 0 || result.tools.length > 0)) {
        feedback.unshift(`Applied: ${result.applied.join('; ')}.`);
      }
      conversation.push({ role: 'user', content: wrapFeedback(feedback), attachments: pictures.length > 0 ? pictures : undefined });
      pruneToolImages(conversation);
    }

    recorder.add({
      id: nextId('step'),
      kind: 'notice',
      tone: 'info',
      text: 'I stopped after reaching the step limit for one message. Everything so far is applied — send a message to continue.',
    });
    return finish('step-limit');
  } catch (error) {
    if (isAbort(error, options.signal)) return finish('cancelled');
    return finish('error', (error as Error)?.message || String(error));
  }
}
