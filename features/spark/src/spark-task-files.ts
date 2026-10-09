/**
 * A task's attachments, kept beside it in the user's folder as
 * `Spark/Tasks/<task>/Attachments/<name [hash].ext>`, from the copy in IndexedDB —
 * and read back from there into a browser that has no copy (`restoreSparkTaskAttachments`).
 *
 * Called with the whole task list whenever it changes, which during a run is many
 * times a second, so what has been written is remembered here and a pass over tasks
 * with nothing new does no disk work at all.
 */
import { CONVERSATION_FOLDERS, conversationFileName } from '@willow/storage/local-fs/conversation-files';
import {
  MAX_SPARK_ATTACHMENT_BYTES,
  loadSparkAttachmentBlob,
  missingSparkAttachmentPayloads,
  putSparkAttachmentPayload,
} from './attachment-storage';
import { sparkDisk } from './spark-disk';
import type { SparkTask, SparkTaskAttachment } from './spark-types';

/** Written, or being written: `${scope}\0${task}\0${attachment}`. */
const kept = new Set<string>();
/** When a write last failed, so a payload that never arrives is not retried on every change. */
const failedAt = new Map<string, number>();
const RETRY_AFTER_MS = 60_000;
/** Found in IndexedDB, or read back into it, so not looked for again: keyed like `kept`. */
const settled = new Set<string>();
/** When a payload was last looked for in the folder and not found there. */
const missedAt = new Map<string, number>();

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

/**
 * The attachments `tasks` name that this browser has no payload for — its storage
 * was cleared, or it is a new copy of Willow on the folder — read back from their
 * files beside the tasks. Only a name a task's attachment gives is read, so nothing
 * else in `Attachments/` is ever taken for one.
 */
export const restoreSparkTaskAttachments = async (tasks: readonly SparkTask[], scopeId: string): Promise<void> => {
  const disk = sparkDisk();
  if (!disk) return;
  const now = Date.now();
  const wanted = tasks.flatMap((task) => attachmentsOf(task)
    .filter((attachment) => attachment.data === undefined)
    .map((attachment) => ({ task, attachment, key: `${scopeId}\u0000${task.id}\u0000${attachment.id}` }))
    .filter(({ key }) => !settled.has(key) && now - (missedAt.get(key) ?? 0) > RETRY_AFTER_MS));
  if (wanted.length === 0) return;
  const missing = await missingSparkAttachmentPayloads([...new Set(wanted.map(({ attachment }) => attachment.id))], scopeId)
    .then((ids) => new Set(ids), () => null);
  if (!missing) return;
  for (const { task, attachment, key } of wanted) {
    if (!missing.has(attachment.id)) {
      settled.add(key);
      continue;
    }
    const file = await disk.read(task.id, sparkAttachmentPath(attachment));
    if (file && file.size > MAX_SPARK_ATTACHMENT_BYTES) {
      // Larger than an attachment can be: something else saved under its name.
      settled.add(key);
    } else if (file && await putSparkAttachmentPayload(attachment, file, scopeId).then(() => true, () => false)) {
      settled.add(key);
      kept.add(key);
    } else {
      missedAt.set(key, Date.now());
    }
  }
};

/** A task's files after it is deleted: written again if a task of that id ever returns. */
export const forgetSparkTaskFiles = (taskId: string): void => {
  const ofTask = (key: string) => key.split('\u0000')[1] === taskId;
  for (const key of [...kept]) if (ofTask(key)) kept.delete(key);
  for (const key of [...settled]) if (ofTask(key)) settled.delete(key);
  for (const key of [...missedAt.keys()]) if (ofTask(key)) missedAt.delete(key);
};
