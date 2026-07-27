export type SparkTaskStatus =
  | 'queued'
  | 'running'
  | 'needs-input'
  | 'complete'
  | 'failed'
  | 'cancelled';

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
  turns: SparkTaskTurn[];
  attachments?: SparkTaskAttachment[];
  tools?: string[];
  reaction?: SparkReaction;
  approval?: SparkTaskApproval;
  approvalDecision?: 'allowed' | 'denied';
  progressLabel?: string;
  scheduledLabel?: string;
  scheduledTime?: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface TrendingTask {
  title: string;
  description: string;
}

export const formatSparkRelativeTime = (isoTime: string, now = Date.now()): string => {
  const timestamp = new Date(isoTime).getTime();
  if (!Number.isFinite(timestamp)) return '';

  const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hr${elapsedHours === 1 ? '' : 's'} ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`;

  const elapsedWeeks = Math.floor(elapsedDays / 7);
  return `${elapsedWeeks} week${elapsedWeeks === 1 ? '' : 's'} ago`;
};
