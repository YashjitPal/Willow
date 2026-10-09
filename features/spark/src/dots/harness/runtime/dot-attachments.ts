/**
 * Files the user sends a bot. Their bytes are Spark's attachment payloads (IndexedDB, under the storage scope); the
 * message keeps a reference to each. They go with the requests of the turn they arrive in, and the bot can open
 * an earlier one again (`open_attachment`); the bubble draws them from the same payloads.
 */
import type { Attachment } from '@willow/ai/chat';
import { createSparkTaskAttachments, deleteSparkAttachmentPayloads, loadSparkAttachmentBlob, resolveSparkTaskAttachments } from '../../../attachment-storage';
import { getActiveSparkStorageScope } from '../../../spark-store';
import type { SparkTaskAttachment } from '../../../spark-types';
import type { DotAttachmentRef } from '../thread/thread-types';

const asSpark = (ref: DotAttachmentRef): SparkTaskAttachment => ({
  id: ref.id,
  name: ref.name,
  mimeType: ref.mimeType ?? 'application/octet-stream',
  size: ref.size ?? 0,
  ...(ref.type ? { type: ref.type } : {}),
});

/** Spark's limits say "task"; here they are a message's. */
const reworded = (error: unknown): Error =>
  new Error((error instanceof Error ? error.message : String(error)).replace(' per task', ' per message').replace(/^Task attachments/, 'Attachments'));

/** Keeps the files and returns what the message holds of them. Throws what is wrong with them: too many, too big. */
export const storeDotAttachments = async (files: readonly File[]): Promise<DotAttachmentRef[]> => {
  const stored = await createSparkTaskAttachments(files, getActiveSparkStorageScope()).catch((error) => {
    throw reworded(error);
  });
  return stored.map(({ id, name, mimeType, size, type }) => ({ id, name, mimeType, size, ...(type ? { type } : {}) }));
};

export const forgetDotAttachments = (refs: readonly DotAttachmentRef[]): Promise<void> =>
  deleteSparkAttachmentPayloads(refs.map((ref) => ref.id), getActiveSparkStorageScope());

/** The files, ready to go with a request; one whose bytes are gone is left out. */
export const readDotAttachments = (refs: readonly DotAttachmentRef[]): Promise<Attachment[]> =>
  resolveSparkTaskAttachments(refs.map(asSpark), getActiveSparkStorageScope());

/** One file's bytes, for its thumbnail. */
export const dotAttachmentBlob = (ref: DotAttachmentRef): Promise<Blob | null> =>
  loadSparkAttachmentBlob(asSpark(ref), getActiveSparkStorageScope());
