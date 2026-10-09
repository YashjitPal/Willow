/**
 * What the pet reports: Spark's tasks as Codex-style activity entries.
 *
 * BetterGravity's Pets plugin reads them off Antigravity's sidebar; Willow has
 * the tasks themselves, so the reading is the only new part. Everything done
 * with a reading is the plugin's, which is Codex's: the five levels and their
 * priority, which ones count as news, how long each lives, how a dismissal
 * holds, the greeting, and the sort.
 */
import type { SparkPendingQuestion, SparkTask, SparkTaskTurn } from '../spark-types';

/** The five levels, and the greeting, which is idle's level with a wave over it. */
export type PetStatus = 'running' | 'waiting' | 'failed' | 'review' | 'idle' | 'greeting';

/** One card, as the pet's surface takes it. */
export interface PetActivityEntry {
  key: string;
  status: PetStatus;
  title: string;
  subtitle: string;
  place: number;
  sortAtMs: number;
  updatedAtMs: number;
  expiresAtMs?: number;
}

/** One task as it reads right now, before anything is decided about it. */
export interface PetRead {
  key: string;
  status: Exclude<PetStatus, 'greeting'>;
  title: string;
  /** What it is doing, when it is doing something. */
  detail: string;
  /** Its place in Spark's list, newest first. */
  place: number;
  /** How long since it last changed, or null when it cannot say. */
  age: number | null;
  sortAtMs: number;
  turnStartedAtMs: number;
  /** Changes whenever its activity does, including two steps with the same label. */
  activityRevision: string;
}

/** What each task was last seen doing. */
interface Seen {
  status: PetRead['status'];
  title: string;
  subtitle: string;
  activityRevision: string;
  sourceAtMs: number;
  turnStartedAtMs: number;
  updatedAtMs: number;
  sortAtMs: number;
  live: boolean;
}

/** Mi: which level outranks which. */
export const PRIORITY: Record<PetStatus, number> = { waiting: 0, failed: 1, review: 2, running: 3, idle: 4, greeting: 4 };

/**
 * How long a card lives. A failure is stale after an hour, a question after a
 * day, a finished reply after a week; work happening now never goes stale.
 */
export const EXPIRY_MS: Partial<Record<PetStatus, number>> = {
  failed: 3600 * 1000,
  waiting: 1440 * 60 * 1000,
  review: 10080 * 60 * 1000,
};

/** The levels that cannot be stale: a task earns a card by being one, or by changing while watched. */
export const LIVE = new Set<PetStatus>(['running', 'waiting', 'failed']);

/** A bound on the list handed to the surface, not on the tray: it scrolls through all of them. */
export const MAX_ENTRIES = 32;
const SEEN_MAX = 512;
/** Older than the longest expiry, so no dismissal outlives its card. */
const DISMISSED_MS = 10080 * 60 * 1000;

export const GREETING_KEY = 'first-awake';
/** Ii: eight seconds. */
export const GREETING_MS = 8 * 1000;
export const GREETING_BODY = "I'm here to help keep your Willow sessions moving";

/* ── What a task is doing, in the plugin's words ─────────────────────────── */

/** Turns a step's label into the plugin's short activity vocabulary. Verbatim from it. */
export function formatActivityDetail(raw: unknown, toolName?: string): string {
  const tn = String(toolName || '').toLowerCase();
  if (tn === 'view_file' || tn === 'list_dir' || tn === 'find_by_name') return 'Analyzing files';
  if (tn === 'replace_file_content' || tn === 'write_to_file') return 'Editing files';
  if (tn === 'read_url_content' || tn === 'search_web' || tn.includes('devtools') || tn.includes('computer-use') || tn.includes('browser')) return 'Using browser';
  if (tn === 'grep_search') return 'Searching codebase';
  if (tn === 'generate_image') return 'Generating image';
  if (tn === 'invoke_subagent' || tn === 'manage_subagents' || tn === 'define_subagent') return 'Running subagent';
  if (tn === 'ask_question') return 'Waiting for input';
  if (tn === 'run_command') {
    if (typeof raw === 'string' && raw.trim()) {
      const s = raw.trim();
      if (/\b(tests?|vitest|jest|pytest)\b/i.test(s)) return 'Running tests';
      if (/\b(build|bundle|compile)\b/i.test(s)) return 'Building project';
    }
    return 'Running command';
  }

  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';

  if (s === 'Running tests' || s === 'Running command' || s === 'Running subagent' ||
      s === 'Using browser' || s === 'Editing files' || s === 'Analyzing files' ||
      s === 'Searching codebase' || s === 'Generating image' || s === 'Building project') {
    return s;
  }

  if (/subagent/i.test(s)) return 'Running subagent';

  // Commands and tests first, so commands with file paths are not taken for file viewing.
  if (/^Run\b|^Running\b|^Ran\b|^Execut|^Task:\b|^Checked\b/i.test(s) || /command\s+execution/i.test(s) || /^(node|pnpm|npm|git|bash|powershell)\b/i.test(s)) {
    const clean = s.replace(/^Task:\s*/i, '').replace(/\s+/g, ' ');
    if (/\b(tests?|vitest|jest|pytest)\b/i.test(clean)) return 'Running tests';
    if (/\b(build|bundle|compile)\b/i.test(clean)) return 'Building project';
    if (clean.length <= 40 && /^Running:\s*\S+/i.test(clean)) return clean;
    return 'Running command';
  }

  if (
    /\b(browser|chrome|devtools|url|http|navigate|page|screenshot|snapshot|appshot|click|dom|read_url)\b/i.test(s) ||
    /^(using\s+browser|browsing|navigating|navigated|web\s+search|reading\s+url|clicked|clicking)/i.test(s)
  ) {
    return 'Using browser';
  }

  if (
    /\b(edit|editing|edited|write|writing|written|replace|replacing|patch|patching|modify|modifying|save|saving|delete|deleting|create|creating)\b/i.test(s) &&
    /\b(file|files|code|content|line|document|script|\.[a-z0-9]{1,4})\b/i.test(s)
  ) {
    return 'Editing files';
  }
  if (/^(editing|edited|writing|modifying|patching|file\s+edit|created?\s+(new\s+)?file)\b/i.test(s)) {
    return 'Editing files';
  }

  if (
    /\b(read|reading|view|viewing|analyz|analyzing|inspect|inspecting|explor|exploring|list|listing|scan|scanning)\b/i.test(s) &&
    /\b(file|files|directory|folder|code|repo|codebase|workspace|\.[a-z0-9]{1,4})\b/i.test(s)
  ) {
    return 'Analyzing files';
  }
  if (/^(explored|exploring|analyzing|reading|viewing|inspecting|scanning|directory\s+analysis|file\s+view)\b/i.test(s)) {
    return 'Analyzing files';
  }

  if (/\b(search|searching|searched|grep|ripgrep|find_by_name|grep_search)\b/i.test(s)) {
    if (/\b(web|google|internet|url)\b/i.test(s)) return 'Using browser';
    return 'Searching codebase';
  }

  const clean = s.replace(/\s+/g, ' ');
  if (/\b(test|vitest|jest|pytest)\b/i.test(clean)) return 'Running tests';
  if (/\b(build|building|compile|compiling|bundle|bundling)\b/i.test(clean)) return 'Building project';
  if (/\bimage\b/i.test(s) && /\b(generate|generating|create|creating)\b/i.test(s)) return 'Generating image';

  if (/^needs\s+approval|^waiting\s+on|^waiting\s+for/i.test(s)) return s.slice(0, 160);
  if (/^thinking\b|^thought\b/i.test(s)) return 'Thinking';

  return s.length > 50 ? s.slice(0, 50).trim() + '…' : s;
}

/** A Spark timeline row (`activityLog`'s tool entries) in the plugin's vocabulary. */
export function toolDetail(tool: string, label?: string): string {
  if (tool.startsWith('request_user_input:')) return 'Waiting for input';
  if (tool === 'computer' || tool.startsWith('computer:')) return 'Using browser';
  if (tool === 'web_search' || tool === 'research') return 'Using browser';
  if (tool === 'search') return 'Searching codebase';
  if (tool === 'command' || tool === 'run_command' || tool === 'code_execution') return formatActivityDetail(label ?? '', 'run_command');
  if (tool === 'images') return 'Generating image';
  if (tool === 'files' || tool === 'create' || tool === 'apply_patch') return 'Editing files';
  if (tool === 'plan') return 'Planning';
  if (tool.startsWith('skill:')) return formatActivityDetail(`Check resources for ${tool.slice(6)} skill`);
  if ((tool.startsWith('app:') || tool.startsWith('mcp:')) && label) return formatActivityDetail(label);
  return formatActivityDetail(label || tool.replaceAll('_', ' '));
}

/* ── Reading Spark ──────────────────────────────────────────────────────── */

const timeOf = (iso: string | undefined): number => {
  const parsed = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * The run a task is on. Follow-ups are only sent to a task that has stopped, so
 * a task that is active and has turns is running its latest one.
 */
const activeRun = (task: SparkTask): Pick<SparkTask, 'activityLog' | 'activityPhase' | 'progressLabel' | 'subagents'> => {
  const turn: SparkTaskTurn | undefined = task.turns?.at(-1);
  const active = task.status === 'running' || task.status === 'queued' || task.status === 'needs-input';
  return turn && active
    ? { activityLog: turn.activityLog, activityPhase: turn.activityPhase, subagents: turn.subagents, progressLabel: task.progressLabel }
    : task;
};

const levelOf = (task: SparkTask, question: SparkPendingQuestion | undefined): PetRead['status'] => {
  if (question || task.status === 'needs-input') return 'waiting';
  if (task.status === 'failed') return 'failed';
  if (task.status === 'running' || task.status === 'queued') return 'running';
  if (task.status === 'complete' && task.hasUnreadCompletion) return 'review';
  return 'idle';
};

const pendingBrowserRequest = (task: SparkTask) => {
  const turn = task.turns?.at(-1);
  const request = turn?.browserRequest ?? task.browserRequest;
  return request?.status === 'pending' ? request : undefined;
};

/** What a working or waiting task is doing, as the card's second line. */
const detailOf = (task: SparkTask, status: PetRead['status'], question: SparkPendingQuestion | undefined): string => {
  if (status === 'waiting') {
    const asked = question?.questions[question.index]?.question ?? question?.questions[0]?.question;
    if (asked) return formatActivityDetail(`Waiting for input: ${asked}`);
    const request = pendingBrowserRequest(task);
    if (request) return `Needs approval: ${request.title || request.task}`.slice(0, 160);
    return 'Needs input';
  }
  if (status !== 'running') return '';
  const run = activeRun(task);
  const log = run.activityLog ?? [];
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const entry = log[index];
    if (entry.kind === 'subagents') return 'Running subagent';
    if (entry.kind === 'tool') return toolDetail(entry.tool, entry.label);
  }
  if (run.subagents?.some((agent) => agent.status === 'running')) return 'Running subagent';
  if (run.activityPhase === 'thinking') return 'Thinking';
  return run.progressLabel ? formatActivityDetail(run.progressLabel) : '';
};

const revisionOf = (task: SparkTask): string => {
  const run = activeRun(task);
  const log = run.activityLog ?? [];
  return JSON.stringify([task.status, task.turns?.length ?? 0, run.activityPhase, run.progressLabel, log.length, log.at(-1)?.id]);
};

/** Every task, as one reading each, in Spark's own order. */
export function readSparkTasks(
  tasks: readonly SparkTask[],
  questions: Readonly<Record<string, SparkPendingQuestion | undefined>>,
  now: number,
): PetRead[] {
  return tasks.map((task, index) => {
    const question = questions[task.id];
    const status = levelOf(task, question);
    const updatedAt = timeOf(task.updatedAt);
    const turnStartedAtMs = Math.max(timeOf(task.turns?.at(-1)?.createdAt), timeOf(task.createdAt));
    return {
      key: task.id,
      status,
      title: task.title?.trim() || 'New task',
      detail: detailOf(task, status, question),
      place: index + 1,
      age: updatedAt > 0 ? Math.max(0, now - updatedAt) : null,
      sortAtMs: Math.max(updatedAt, turnStartedAtMs),
      turnStartedAtMs,
      activityRevision: revisionOf(task),
    };
  });
}

/* ── Deciding what is news ─────────────────────────────────────────────── */

/**
 * What the sensor remembers between readings: what each task was last seen
 * doing, and which cards were sent away. It outlives a tab handing the pet to
 * another (`toJSON` / `fromJSON`), so a handoff is not a fresh start.
 */
export class PetSensorMemory {
  readonly seen = new Map<string, Seen>();
  readonly dismissed = new Map<string, number>();

  toJSON(): { seen: [string, Seen][]; dismissed: [string, number][] } {
    return { seen: [...this.seen], dismissed: [...this.dismissed] };
  }

  static fromJSON(value: unknown): PetSensorMemory {
    const memory = new PetSensorMemory();
    if (!value || typeof value !== 'object') return memory;
    const { seen, dismissed } = value as { seen?: unknown; dismissed?: unknown };
    if (Array.isArray(seen)) {
      for (const pair of seen) if (Array.isArray(pair) && typeof pair[0] === 'string' && pair[1] && typeof pair[1] === 'object') memory.seen.set(pair[0], pair[1] as Seen);
    }
    if (Array.isArray(dismissed)) {
      for (const pair of dismissed) if (Array.isArray(pair) && typeof pair[0] === 'string' && Number.isFinite(pair[1])) memory.dismissed.set(pair[0], pair[1] as number);
    }
    return memory;
  }
}

/**
 * The plugin's readEntries: each reading through the bookkeeping that decides
 * whether it is a card. A task earns one by being in a live level, or by having
 * changed while the pet was watching; an unread reply that was already there
 * when the pet arrived is the baseline, and says nothing.
 */
export function entriesFrom(memory: PetSensorMemory, reads: readonly PetRead[], now: number): PetActivityEntry[] {
  const entries: PetActivityEntry[] = [];
  for (const read of reads) {
    const before = memory.seen.get(read.key);
    // A task that has stopped working keeps its last progress rather than losing its subtitle.
    const subtitle = read.detail || (before?.status === read.status ? before.subtitle : '');
    const sourceAtMs = Math.max(read.sortAtMs || 0, before?.sourceAtMs || 0);
    const turnStartedAtMs = Math.max(read.turnStartedAtMs || 0, before?.turnStartedAtMs || 0);
    const statusChanged = before !== undefined && before.status !== read.status;
    const newTurn = before !== undefined && turnStartedAtMs > before.turnStartedAtMs;
    const activityChanged = before !== undefined && (
      statusChanged || before.title !== read.title || before.subtitle !== subtitle ||
      before.activityRevision !== read.activityRevision || sourceAtMs > before.sourceAtMs
    );
    const live = LIVE.has(read.status) || activityChanged || (before?.live ?? false);
    const expiry = EXPIRY_MS[read.status];
    const dated = expiry !== undefined && read.age !== null ? now - read.age : now;
    const updatedAtMs = statusChanged || newTurn || before === undefined ? dated : before.updatedAtMs;
    const sortAtMs = activityChanged ? now : (before?.sortAtMs ?? (read.sortAtMs > 0 ? read.sortAtMs : read.age === null ? now : now - read.age));
    memory.seen.set(read.key, {
      status: read.status, title: read.title, subtitle, activityRevision: read.activityRevision,
      sourceAtMs, turnStartedAtMs, updatedAtMs, sortAtMs, live,
    });

    if (read.status === 'idle' || !live || (expiry !== undefined && now - updatedAtMs >= expiry)) continue;
    entries.push({ key: read.key, status: read.status, title: read.title, subtitle, place: read.place, sortAtMs, updatedAtMs });
  }

  // Bounded by age rather than pruned against what Spark lists, so a task that
  // drops out of a filtered list has not gone quiet.
  if (memory.seen.size > SEEN_MAX) {
    const oldest = [...memory.seen.entries()].sort((a, b) => a[1].updatedAtMs - b[1].updatedAtMs);
    for (const [key] of oldest.slice(0, memory.seen.size - SEEN_MAX)) memory.seen.delete(key);
  }
  for (const [key, at] of [...memory.dismissed]) {
    if (now - at >= DISMISSED_MS) memory.dismissed.delete(key);
  }
  return entries;
}

/**
 * The tray as the surface gets it: dismissed cards out (until their task does
 * something new), the greeting in while it lasts, newest activity first.
 * Work is read before anything is hidden — sending a card away acknowledges it,
 * it does not stop the task.
 */
export function activityOf(
  all: readonly PetActivityEntry[],
  memory: PetSensorMemory,
  greeting: PetActivityEntry | null,
  showActivity: boolean,
  now: number,
): { entries: PetActivityEntry[]; working: boolean; greeting: PetActivityEntry | null } {
  const working = all.some((entry) => entry.status === 'running');
  const entries = all.filter((entry) => {
    const at = memory.dismissed.get(entry.key);
    return at === undefined || entry.updatedAtMs > at;
  });
  let current = greeting;
  if (current !== null && (current.expiresAtMs === undefined || now >= current.expiresAtMs || memory.dismissed.has(GREETING_KEY))) {
    current = null;
  }
  if (current !== null) entries.push(current);
  entries.sort(
    (a, b) =>
      Number(a.status === 'greeting') - Number(b.status === 'greeting') ||
      b.sortAtMs - a.sortAtMs ||
      a.place - b.place ||
      a.key.localeCompare(b.key),
  );
  return { entries: showActivity ? entries.slice(0, MAX_ENTRIES) : [], working, greeting: current };
}

/** Enough of the tray to tell whether the surface needs telling: order, level, words, and whether anything works. */
export const signatureOf = (entries: readonly PetActivityEntry[], working: boolean): string =>
  JSON.stringify([working, entries.map((entry) => [entry.key, entry.status, entry.title, entry.subtitle])]);

/** The close and tick controls: this card, at this stamp. A later change is news again. */
export function dismissEntry(memory: PetSensorMemory, entries: readonly PetActivityEntry[], key: string): PetActivityEntry[] | null {
  const entry = entries.find((item) => item.key === key);
  if (!entry) return null;
  memory.dismissed.set(key, entry.updatedAtMs);
  return entries.filter((item) => item.key !== key);
}

/** The greeting card: once per pet, ever, and only for eight seconds. */
export const greetingFor = (name: string, now: number): PetActivityEntry => ({
  key: GREETING_KEY,
  status: 'greeting',
  title: `Hi, I'm ${name}`,
  subtitle: GREETING_BODY,
  place: Number.MAX_SAFE_INTEGER,
  sortAtMs: now,
  updatedAtMs: now,
  expiresAtMs: now + GREETING_MS,
});
