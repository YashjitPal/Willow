/**
 * A task's attachments, kept beside it in the user's folder as
 * `Spark/Tasks/<task>/Attachments/<name [hash].ext>`, from the copy in IndexedDB.
 *
 * Called with the whole task list whenever it changes, which during a run is many
 * times a second, so what has been written is remembered here and a pass over tasks
 * with nothing new does no disk work at all.
 */
import { CONVERSATION_FOLDERS, conversationFileName } from '@willow/storage/local-fs/conversation-files';
import { loadSparkAttachmentBlob } from './attachment-storage';
import { sparkDisk } from './spark-disk';
import type { SparkTask, SparkTaskAttachment } from './spark-types';

/** Written, or being written: `${scope}\0${task}\0${attachment}`. */
const kept = new Set<string>();
/** When a write last failed, so a payload that never arrives is not retried on every change. */
const failedAt = new Map<string, number>();
const RETRY_AFTER_MS = 60_000;

export const sparkAttachmentPath = (attachment: Pick<SparkTaskAttachment, 'id' | 'name' | 'mimeType'>): string =>
  `${CONVERSATION_FOLDERS.attachments}/${conversationFileName(attachment.name, attachment.id, attachment.mimeType)}`;

const attachmentsOf = (task: SparkTask): SparkTaskAttachment[] => [
  ...(task.attachments ?? []),
  ...(task.turns ?? []).flatMap((turn) => turn.attachments ?? []),
];

export const mirrorSparkTaskAttachments = (tasks: readonly SparkTask[], scopeId: string): void => {
  const disk = sparkDisk();
  if (!disk) return;
  const now = Date.now();
  for (const task of tasks) {
    const waiting = attachmentsOf(task).filter((attachment) => {
      const key = `${scopeId}\u0000${task.id}\u0000${attachment.id}`;
      return !kept.has(key) && now - (failedAt.get(key) ?? 0) > RETRY_AFTER_MS;
    });
    if (waiting.length === 0) continue;
    const keys = waiting.map((attachment) => `${scopeId}\u0000${task.id}\u0000${attachment.id}`);
    keys.forEach((key) => kept.add(key));
    void disk.write(task.id, waiting.map((attachment) => ({
      path: sparkAttachmentPath(attachment),
      read: () => loadSparkAttachmentBlob(attachment, scopeId),
    }))).then((complete) => {
      if (complete) return;
      // Which one failed is not reported; all are retried, and the rest are found on disk.
      for (const key of keys) {
        kept.delete(key);
        failedAt.set(key, Date.now());
      }
    }, () => keys.forEach((key) => kept.delete(key)));
  }
};

/** A task's files after it is deleted: written again if a task of that id ever returns. */
export const forgetSparkTaskFiles = (taskId: string): void => {
  for (const key of [...kept]) if (key.split('\u0000')[1] === taskId) kept.delete(key);
};
