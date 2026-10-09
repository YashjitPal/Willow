import { atom } from 'nanostores';
import {
  registerBackgroundJobKind,
  startBackgroundJob,
  type BackgroundJob,
  type BackgroundJobHandle,
} from '@willow/core/background-jobs';

/**
 * Media work that carries on in another tab.
 *
 * While the editor works (an agent turn, or anything still generating) it holds
 * one background job (`@willow/core/background-jobs`). When its tab closes,
 * another open Willow tab inherits the job, opens the same project in a hidden
 * editor, and starts the work again there through the editor's own code: the
 * agent's conversation is reopened and its last request run again, and each
 * interrupted generation is started again from its saved gallery item.
 *
 * Started again rather than re-attached: an image request dies with its tab,
 * and Veo's operation handle was never saved, so nothing is left to poll.
 */

export const MEDIA_WORK_JOB = 'media-work';

export interface MediaWorkJob {
  /** The project's real id (never the `temp_` URL form). */
  projectId: string;
  /** The agent conversation whose turn was running, if one was. */
  agentSessionId: string | null;
  /** That turn's question, for a tab that closed before the conversation saved. */
  agentPrompt: string | null;
  /** Items still generating that the turn above did not make; each is started again. */
  itemIds: string[];
  /** A video's requested length, which the item itself does not carry. */
  videoDurations: Record<string, string>;
}

export const startMediaWorkJob = (
  id: string | undefined,
  scopeId: string,
  payload: MediaWorkJob,
): BackgroundJobHandle<MediaWorkJob> => startBackgroundJob<MediaWorkJob>({
  id: id ?? `media:${scopeId}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
  kind: MEDIA_WORK_JOB,
  scopeId,
  payload,
});

export interface MediaResumeRequest {
  job: BackgroundJob<MediaWorkJob>;
  /** Called by the editor once it has started the work again. */
  settle: () => void;
}

/** Work this tab has inherited and has yet to start; the shell mounts a hidden editor for its project. */
export const $mediaResume = atom<MediaResumeRequest | null>(null);

/* Mounting the editor and reading a project's gallery back can take a while on a cold tab. */
const RESUME_TIMEOUT_MS = 60_000;

export const registerMediaWorkTakeover = (
  canTakeOver: (job: BackgroundJob<MediaWorkJob>) => boolean,
): (() => void) => registerBackgroundJobKind<MediaWorkJob>(MEDIA_WORK_JOB, {
  canTakeOver: (job) => !$mediaResume.get() && canTakeOver(job),
  takeOver: (job) => new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      if ($mediaResume.get()?.job.id === job.id) $mediaResume.set(null);
      resolve();
    };
    timer = setTimeout(settle, RESUME_TIMEOUT_MS);
    $mediaResume.set({ job, settle });
  }),
});
