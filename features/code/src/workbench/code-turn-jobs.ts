import { atom } from 'nanostores';
import {
  registerBackgroundJobKind,
  startBackgroundJob,
  type BackgroundJob,
  type BackgroundJobHandle,
} from '@willow/core/background-jobs';
import { readProjectRegistry } from '@willow/projects/registry';
import type { TurnMode } from '../harness/protocol';

/**
 * A Code turn that carries on in another tab.
 *
 * Every turn in a saved Code chat is a background job
 * (`@willow/core/background-jobs`). When the tab running it closes, another open
 * Willow tab inherits the job, opens the same chat or project in a hidden Code
 * screen, and sends the interrupted message again through the screen's own send
 * path, so the reply, the files it writes and every save are the ones a turn
 * started there would make.
 *
 * Resumed from the top, like Chat and Spark: the harness edits a working copy
 * and commits when the turn ends, so an interrupted turn has usually left the
 * project as it found it.
 */

export const CODE_TURN_JOB = 'code-turn';

/** Where the turn's conversation lives, which is what another tab has to open. */
export type CodeTurnPlace =
  /** An inbox Code chat, not yet a project: `Chats/<chatId>.json`, reopened like a Recents row. */
  | { target: 'chat'; chatId: string }
  /** A project's chat session, reopened by opening the project. */
  | { target: 'project'; projectId: string; projectName: string; sessionId: string | null };

export interface CodeTurnJob {
  place: CodeTurnPlace;
  mode: TurnMode;
  tool: string | null;
  /** The model the sender picked. */
  selectedModelId: string;
}

/** A Code project's registry id, which is what `/project1` opens. */
export const codeProjectId = (projectName: string): string | null => {
  const entry = readProjectRegistry().find((project) => project.name === projectName && (project.kind ?? 'code') === 'code');
  return entry?.id ?? null;
};

export const startCodeTurnJob = (
  id: string | undefined,
  scopeId: string,
  payload: CodeTurnJob,
): BackgroundJobHandle<CodeTurnJob> => startBackgroundJob<CodeTurnJob>({
  id: id ?? `code:${scopeId}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
  kind: CODE_TURN_JOB,
  scopeId,
  payload,
});

export interface CodeResumeRequest {
  job: BackgroundJob<CodeTurnJob>;
  /** Called by the Code screen once it has sent the message again, or found nothing to send. */
  settle: () => void;
}

/**
 * A turn this tab has inherited and has yet to start. The shell mounts a hidden
 * Code screen for it (`apps/studio` App.tsx), which opens the place, sends the
 * message, and settles.
 */
export const $codeResume = atom<CodeResumeRequest | null>(null);

/* Mounting a lazy screen and reading a project back can take a while on a cold tab. */
const RESUME_TIMEOUT_MS = 60_000;

export const registerCodeTurnTakeover = (
  canTakeOver: (job: BackgroundJob<CodeTurnJob>) => boolean,
): (() => void) => registerBackgroundJobKind<CodeTurnJob>(CODE_TURN_JOB, {
  canTakeOver: (job) => !$codeResume.get() && canTakeOver(job),
  takeOver: (job) => new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      if ($codeResume.get()?.job.id === job.id) $codeResume.set(null);
      resolve();
    };
    timer = setTimeout(settle, RESUME_TIMEOUT_MS);
    $codeResume.set({ job, settle });
  }),
});
