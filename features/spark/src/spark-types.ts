import type { SparkThreadGoal } from './harness/runtime/goal';

export type SparkTaskStatus =
  | 'queued'
  | 'running'
  | 'needs-input'
  | 'complete'
  | 'failed'
  | 'cancelled';

/** Live agent lifecycle used by the processing-state UI. */
export type SparkActivityPhase = 'queued' | 'thinking' | 'planning' | 'working';

export interface SparkPlanStep {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export type SparkActivityEntry =
  | { id: string; kind: 'narration'; text: string }
  /**
   * `label` is the step's own words, for a connected app or MCP call: "Listing recently modified files in Drive".
   * A command the desktop app ran also keeps its call and that call's status, so its group reads
   * "Running command" until it finishes and "Ran command" after.
   */
  | { id: string; kind: 'tool'; tool: string; label?: string; callId?: string; status?: SparkCommandRowStatus }
  | { id: string; kind: 'subagents' };

/** Persistable projection of a Codex sub-agent for Spark's delegated-work UI. */
export type SparkSubAgentStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled';

/** A command row's status: its call's own, from queued for approval to finished. */
export type SparkCommandRowStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled';

export interface SparkSubAgentCall {
  id: string;
  kind: string;
  status: SparkSubAgentStatus;
  label: string;
}

export type SparkSubAgentTimelineEntry =
  | { id: string; kind: 'narration'; text: string }
  | { id: string; kind: 'tool'; callId: string };

export interface SparkSubAgent {
  id: string;
  name: string;
  kind: string;
  objective: string;
  status: SparkSubAgentStatus;
  startedAt: number;
  endedAt?: number;
  progress: number;
  calls: SparkSubAgentCall[];
  timeline: SparkSubAgentTimelineEntry[];
  activity?: string;
  result?: string;
  model: string;
  tokensUsed: number;
}

export type SparkReaction = 'like' | 'dislike' | null;

/**
 * The pre-tool-call browser approval, kept only so tasks saved before the
 * `computer` tool still load: `normalizeTask` turns one into a `SparkBrowserRequest`.
 */
export interface SparkTaskApproval {
  kind: 'browser';
  title: string;
  description: string;
  prompt: string;
}

/**
 * A `computer` call that needed the user's permission.
 *
 * It sits on the turn whose answer is the permission card — the root task or a
 * follow-up — and stays there once answered, because Gemini keeps the answered
 * card in the thread with its buttons disabled.
 */
export interface SparkBrowserRequest {
  id: string;
  /** The timeline row's label. */
  title: string;
  /** The instruction the user reviews and the browser agent runs. */
  task: string;
  url?: string;
  status: 'pending' | 'allowed' | 'denied';
  createdAt: string;
}

/** The turn that answers a permission card: its prompt is "Allow" or "Don't allow". */
export interface SparkBrowserDecision {
  requestId: string;
  allowed: boolean;
}

/** Where the task's remote browser was last, so it can be reopened after a reload. */
export interface SparkRemoteBrowserPage {
  url: string;
  title: string;
  favicon?: string;
}

export type SparkLocation =
  | { page: 'home' }
  | { page: 'all-tasks' }
  | { page: 'task'; taskId: string }
  | { page: 'schedules' }
  | { page: 'schedule-editor'; scheduleId?: string }
  | { page: 'skills' }
  | {
      page: 'skill-editor';
      mode: 'manual' | 'gemini' | 'upload' | 'recommended';
      skillId?: string;
      template?: string;
    }
  | { page: 'apps' }
  /** The desktop pet's library and settings; the desktop app only. */
  | { page: 'pets' }
  | { page: 'dots'; dotId?: string }
  /** Pages' own router path (Codex's `/space` and `/space/<page id>`), with its query and hash. */
  | { page: 'pages'; path: string };

export interface SparkTaskTurn {
  id: string;
  prompt: string;
  response: string;
  /** Human-readable model label captured for the thinking-steps footer. */
  modelLabel?: string;
  /** Displayable thought summaries returned by the model, not hidden chain-of-thought. */
  thinkingSteps?: string[];
  /** Stable Gemini-style heading for this turn's work timeline. */
  activityTitle?: string;
  plan?: SparkPlanStep[];
  activityLog?: SparkActivityEntry[];
  subagents?: SparkSubAgent[];
  /** Capabilities actually invoked while this turn ran. */
  usedTools?: string[];
  /** Composer tools selected for this individual follow-up turn. */
  tools?: string[];
  activityPhase?: SparkActivityPhase;
  attachments?: SparkTaskAttachment[];
  generatedFiles?: SparkGeneratedFile[];
  /** Schedules and skills this turn's run saved. */
  createdItems?: SparkCreatedItem[];
  reaction?: SparkReaction;
  browserRequest?: SparkBrowserRequest;
  browserDecision?: SparkBrowserDecision;
  createdAt: string;
}

export interface SparkTaskAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  type?: 'image' | 'text' | 'file';
  /** Loaded on demand from IndexedDB. Never persisted in localStorage. */
  data?: string;
}

export interface SparkGeneratedFile {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  createdAt: string;
}

/**
 * A schedule or a skill a turn's run saved, as its card shows it: Gemini's
 * `remy-confirmation-card.draft-approval`. A snapshot, so the card still reads after
 * the record is edited or deleted; while the record exists the card shows it as it is.
 */
export type SparkCreatedItem =
  | {
    kind: 'schedule';
    id: string;
    /** The schedule's own id in `SparkState.schedules`. */
    recordId: string;
    title: string;
    frequency: 'Daily' | 'Weekly';
    weekdays: string[];
    time: string;
    instructions: string;
    createdAt: string;
  }
  | {
    kind: 'skill';
    id: string;
    /** The skill's own id in `SparkState.skills`. */
    recordId: string;
    name: string;
    description: string;
    instructions: string;
    createdAt: string;
  };

export interface SparkTask {
  id: string;
  title: string;
  description: string;
  time: string;
  status: SparkTaskStatus;
  prompt: string;
  response: string;
  /** Human-readable model label captured for the thinking-steps footer. */
  modelLabel?: string;
  /** Displayable thought summaries returned by the model, not hidden chain-of-thought. */
  thinkingSteps?: string[];
  /** Stable Gemini-style heading for this task's work timeline. */
  activityTitle?: string;
  plan?: SparkPlanStep[];
  activityLog?: SparkActivityEntry[];
  subagents?: SparkSubAgent[];
  /** Capabilities actually invoked while this task ran. */
  usedTools?: string[];
  activityPhase?: SparkActivityPhase;
  turns: SparkTaskTurn[];
  attachments?: SparkTaskAttachment[];
  generatedFiles?: SparkGeneratedFile[];
  /** Schedules and skills the root turn's run saved. */
  createdItems?: SparkCreatedItem[];
  /** Codex-style persisted Goal mode state for this Spark thread. */
  goal?: SparkThreadGoal;
  tools?: string[];
  reaction?: SparkReaction;
  approval?: SparkTaskApproval;
  approvalDecision?: 'allowed' | 'denied';
  /** The root turn's permission card, when its answer is one. */
  browserRequest?: SparkBrowserRequest;
  /** Gemini's permission is per thread: once allowed, later browser calls run without asking. */
  browserPermission?: 'allowed';
  remoteBrowser?: SparkRemoteBrowserPage;
  progressLabel?: string;
  scheduledLabel?: string;
  scheduledTime?: string;
  /** True while a completed task has not yet been opened by the user. */
  hasUnreadCompletion?: boolean;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  /** False when this is only the lightweight task-list record. */
  bodyLoaded?: boolean;
  /** True while the configured Chat-naming model is generating title/description. */
  isNaming?: boolean;
}

export type SparkScheduleFrequency = 'Daily' | 'Weekly';

export interface SparkSchedule {
  id: string;
  title: string;
  frequency: SparkScheduleFrequency;
  weekdays: string[];
  time: string;
  instructions: string;
  enabled: boolean;
  taskId?: string;
  lastRunLabel?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------------------- */
/* request_user_input                                                      */
/* ---------------------------------------------------------------------- */

/** One choice. Both fields are required by upstream's schema. */
export interface SparkQuestionOption {
  /** User-facing label, 1-5 words. The recommended one comes first. */
  label: string;
  /** One sentence on what choosing this means. */
  description: string;
}

export interface SparkQuestion {
  /** Stable identifier the model chose, used to key the answer back. */
  id: string;
  /** Short header label, 12 chars or fewer. */
  header: string;
  question: string;
  options: SparkQuestionOption[];
}

/**
 * What the user has entered for one question, before submitting.
 *
 * Kept per question rather than per panel so stepping back and forth through a
 * multi-question request does not lose earlier choices — which is how the Codex
 * app behaves (`{ selectedOptionId, freeformText }` per entry).
 *
 * `optionLabel` is null while the freeform field is in use: typing there
 * deselects the chosen option, since the two are alternatives rather than
 * additions.
 */
export interface SparkQuestionDraft {
  optionLabel: string | null;
  freeformText: string;
}

/**
 * A live `request_user_input` round.
 *
 * Not part of `SparkTask` because `resolve` is a promise callback and
 * `sparkState` is persisted — a serialised resolver is a function that no
 * longer resolves anything, and the turn behind it would hang forever after a
 * reload.
 */
export interface SparkPendingQuestion {
  taskId: string;
  questions: SparkQuestion[];
  /** True in Plan mode, where the turn genuinely stops for the answer. */
  blocking: boolean;
  /** Index of the question on screen, for the "1 of 3" stepper. */
  index: number;
  /** Per-question drafts, parallel to `questions`. */
  drafts: SparkQuestionDraft[];
}

export type SparkSkillSource = 'manual' | 'gemini' | 'upload' | 'recommended';

export interface SparkSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  source: SparkSkillSource;
  enabled: boolean;
  fileName?: string;
  createdAt: string;
  updatedAt: string;
}

export type SparkConnectedAppId = 'workspace' | 'youtube-music' | 'contacts' | 'opentable';

export interface SparkCustomApp {
  id: string;
  name: string;
  url: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestedTask {
  title: string;
  description: string;
}

/**
 * Gemini's task rows read "1 min ago", "1 hr ago", "2 days ago", "2 wk ago" —
 * which is `Intl.RelativeTimeFormat(…, { style: 'short' })`, but only under a
 * locale that drops the abbreviation full stop. The locale is pinned rather than
 * taken from `navigator.language` because en-US short yields "2 wk. ago", and the
 * point is to render what Gemini renders regardless of the viewer's locale.
 */
const SPARK_RELATIVE_TIME = new Intl.RelativeTimeFormat('en-GB', { style: 'short', numeric: 'always' });

/**
 * Gemini's <=960px layout switches to the narrow form — "1w ago", "3w ago", "1mo ago",
 * "16h ago" — which is en-US `narrow` (en-GB narrow keeps the spaced "1 wk ago").
 */
const SPARK_RELATIVE_TIME_COMPACT = new Intl.RelativeTimeFormat('en-US', { style: 'narrow', numeric: 'always' });

export const formatSparkRelativeTime = (isoTime: string, now = Date.now(), compact = false): string => {
  const timestamp = new Date(isoTime).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const format = compact ? SPARK_RELATIVE_TIME_COMPACT : SPARK_RELATIVE_TIME;

  const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) return format.format(-elapsedMinutes, 'minute');

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return format.format(-elapsedHours, 'hour');

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return format.format(-elapsedDays, 'day');

  const elapsedWeeks = Math.floor(elapsedDays / 7);
  if (elapsedWeeks < 4) return format.format(-elapsedWeeks, 'week');

  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return format.format(-Math.max(1, elapsedMonths), 'month');

  return format.format(-Math.floor(elapsedDays / 365), 'year');
};
