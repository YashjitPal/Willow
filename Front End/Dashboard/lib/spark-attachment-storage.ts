import type { Attachment as AiAttachment } from './ai';
import type { SparkTaskAttachment } from '../components/spark/spark-types';

const DB_NAME = 'willow-spark';
const STORE_NAME = 'attachment-payloads';
const DB_VERSION = 1;

export const MAX_SPARK_ATTACHMENTS = 8;
export const MAX_SPARK_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_SPARK_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

interface StoredSparkAttachmentPayload {
  data: string;
  id: string;
  scopeId: string;
  type: NonNullable<SparkTaskAttachment['type']>;
  updatedAt: string;
}

const attachmentKey = (scopeId: string, attachmentId: string) =>
  `${scopeId || 'guest'}:${attachmentId}`;

const openAttachmentDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('IndexedDB is not available.'));
    return;
  }

  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Could not open Spark attachment storage.'));
});

const writePayload = async (
  scopeId: string,
  attachment: SparkTaskAttachment & { data: string; type: NonNullable<SparkTaskAttachment['type']> },
): Promise<void> => {
  const database = await openAttachmentDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const payload: StoredSparkAttachmentPayload = {
        data: attachment.data,
        id: attachment.id,
        scopeId,
        type: attachment.type,
        updatedAt: new Date().toISOString(),
      };
      transaction.objectStore(STORE_NAME).put(payload, attachmentKey(scopeId, attachment.id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not store the attachment.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Storing the attachment was aborted.'));
    });
  } finally {
    database.close();
  }
};

const readPayload = async (
  scopeId: string,
  attachmentId: string,
): Promise<StoredSparkAttachmentPayload | undefined> => {
  const database = await openAttachmentDatabase();
  try {
    return await new Promise<StoredSparkAttachmentPayload | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(attachmentKey(scopeId, attachmentId));
      request.onsuccess = () => resolve(request.result as StoredSparkAttachmentPayload | undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not read the attachment.'));
    });
  } finally {
    database.close();
  }
};

const readFileAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    const separator = result.indexOf(',');
    resolve(separator >= 0 ? result.slice(separator + 1) : result);
  };
  reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
  reader.readAsDataURL(file);
});

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/javascript',
  'application/sql',
  'application/xml',
  'application/x-yaml',
]);

const TEXT_EXTENSIONS = /\.(?:c|cc|cpp|css|csv|go|h|html?|java|js|jsx|json|md|mjs|py|rb|rs|sql|svg|toml|ts|tsx|txt|xml|ya?ml)$/i;

const getAttachmentType = (file: File): NonNullable<SparkTaskAttachment['type']> => {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('text/') || TEXT_MIME_TYPES.has(file.type) || TEXT_EXTENSIONS.test(file.name)) {
    return 'text';
  }
  return 'file';
};

export const validateSparkAttachmentFiles = (files: readonly File[]): void => {
  if (files.length > MAX_SPARK_ATTACHMENTS) {
    throw new Error(`Choose at most ${MAX_SPARK_ATTACHMENTS} files per task.`);
  }

  let totalBytes = 0;
  for (const file of files) {
    if (!file.name || file.name.length > 255 || /[\\/\0]/.test(file.name)) {
      throw new Error(`Invalid attachment name: ${file.name || 'untitled'}.`);
    }
    if (file.size > MAX_SPARK_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} exceeds the 5 MB attachment limit.`);
    }
    totalBytes += file.size;
  }
  if (totalBytes > MAX_SPARK_TOTAL_ATTACHMENT_BYTES) {
    throw new Error('Task attachments exceed the 20 MB total limit.');
  }
};

export const createSparkTaskAttachments = async (
  files: readonly File[],
  scopeId: string,
): Promise<SparkTaskAttachment[]> => {
  validateSparkAttachmentFiles(files);
  const settled = await Promise.allSettled(files.map(async (file) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `${file.name}-${file.lastModified}-${file.size}`;
    const type = getAttachmentType(file);
    const data = type === 'text' ? await file.text() : await readFileAsBase64(file);
    const attachment: SparkTaskAttachment & {
      data: string;
      type: NonNullable<SparkTaskAttachment['type']>;
    } = {
      id,
      name: file.name,
      mimeType: file.type || (type === 'text' ? 'text/plain' : 'application/octet-stream'),
      size: file.size,
      type,
      data,
    };

    await writePayload(scopeId, attachment);
    return attachment;
  }));
  const attachments = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (!failure) return attachments;

  await deleteSparkAttachmentPayloads(
    attachments.map((attachment) => attachment.id),
    scopeId,
  ).catch(() => undefined);
  throw failure.reason;
};

export const resolveSparkTaskAttachments = async (
  attachments: readonly SparkTaskAttachment[] | undefined,
  scopeId: string,
): Promise<AiAttachment[]> => {
  if (!attachments?.length) return [];

  const resolved: Array<AiAttachment | null> = await Promise.all(attachments.map(async (
    attachment,
  ): Promise<AiAttachment | null> => {
    const stored = attachment.data !== undefined
      ? { data: attachment.data, type: attachment.type }
      : await readPayload(scopeId, attachment.id).catch(() => undefined);
    if (!stored || typeof stored.data !== 'string') return null;

    return {
      type: stored.type ?? attachment.type ?? 'file',
      mimeType: attachment.mimeType,
      data: stored.data,
      name: attachment.name,
    } satisfies AiAttachment;
  }));

  return resolved.filter((attachment): attachment is AiAttachment => attachment !== null);
};

export const deleteSparkAttachmentPayloads = async (
  attachmentIds: readonly string[],
  scopeId: string,
): Promise<void> => {
  if (!attachmentIds.length) return;
  const database = await openAttachmentDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      attachmentIds.forEach((id) => store.delete(attachmentKey(scopeId, id)));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not delete Spark attachments.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Deleting Spark attachments was aborted.'));
    });
  } finally {
    database.close();
  }
};
