export type SparkTaskStatus =
  | 'queued'
  | 'running'
  | 'needs-input'
  | 'complete'
  | 'failed'
  | 'cancelled';

/** Live agent lifecycle used by the processing-state UI. */
export type SparkActivityPhase = 'queued' | 'thinking' | 'working';

export type SparkActivityEntry =
  | { id: string; kind: 'narration'; text: string }
  | { id: string; kind: 'tool'; tool: string };

export type SparkReaction = 'like' | 'dislike' | null;

export interface SparkTaskApproval {
  kind: 'browser';
  title: string;
  description: string;
  prompt: string;
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
  | { page: 'apps' };

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
  activityLog?: SparkActivityEntry[];
  /** Capabilities actually invoked while this turn ran. */
  usedTools?: string[];
  activityPhase?: SparkActivityPhase;
  attachments?: SparkTaskAttachment[];
  reaction?: SparkReaction;
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
  activityLog?: SparkActivityEntry[];
  /** Capabilities actually invoked while this task ran. */
  usedTools?: string[];
  activityPhase?: SparkActivityPhase;
  turns: SparkTaskTurn[];
  attachments?: SparkTaskAttachment[];
  tools?: string[];
  reaction?: SparkReaction;
  approval?: SparkTaskApproval;
  approvalDecision?: 'allowed' | 'denied';
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

export type SparkSkillSource = 'manual' | 'gemini' | 'upload' | 'recommended';

export interface SparkSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  source: SparkSkillSource;
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

export const formatSparkRelativeTime = (isoTime: string, now = Date.now()): string => {
  const timestamp = new Date(isoTime).getTime();
  if (!Number.isFinite(timestamp)) return '';

  const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) return SPARK_RELATIVE_TIME.format(-elapsedMinutes, 'minute');

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return SPARK_RELATIVE_TIME.format(-elapsedHours, 'hour');

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return SPARK_RELATIVE_TIME.format(-elapsedDays, 'day');

  const elapsedWeeks = Math.floor(elapsedDays / 7);
  if (elapsedWeeks < 4) return SPARK_RELATIVE_TIME.format(-elapsedWeeks, 'week');

  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return SPARK_RELATIVE_TIME.format(-Math.max(1, elapsedMonths), 'month');

  return SPARK_RELATIVE_TIME.format(-Math.floor(elapsedDays / 365), 'year');
};
