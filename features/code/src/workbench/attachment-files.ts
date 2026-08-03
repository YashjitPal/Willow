/**
 * Reading and naming the files a user drops into the composer.
 *
 * These were inner helpers of the sidebar component but close over nothing, so
 * they live here as plain functions. Both readers wrap FileReader in a promise
 * because the send path awaits attachments before it can build a message.
 */

/** Largest image we will inline into the project, in bytes. */
export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

/** Reads a file as base64, with the data-URL prefix stripped. */
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        // Remove data:image/png;base64, prefix
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to read file'));
      }
    };
    reader.onerror = error => reject(error);
  });
};

/** Reads a file as UTF-8 text. */
export const readFileText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsText(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file'));
      }
    };
    reader.onerror = error => reject(error);
  });
};

/** Lowercases and slugifies a filename so it is safe as a project path. */
const sanitizeFileName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

/**
 * Picks a free path under /public/uploads, suffixing -1, -2, ... on collision
 * so re-uploading a file never overwrites the earlier one.
 */
export const getUniqueImagePath = (name: string, existingFiles: Record<string, any>): string => {
  const sanitized = sanitizeFileName(name);
  const basePath = `/public/uploads/${sanitized}`;
  if (!existingFiles[basePath]) return basePath;

  const dotIndex = sanitized.lastIndexOf('.');
  const stem = dotIndex > 0 ? sanitized.substring(0, dotIndex) : sanitized;
  const ext = dotIndex > 0 ? sanitized.substring(dotIndex) : '';

  let counter = 1;
  let candidate: string;
  do {
    candidate = `/public/uploads/${stem}-${counter}${ext}`;
    counter++;
  } while (existingFiles[candidate]);

  return candidate;
};
