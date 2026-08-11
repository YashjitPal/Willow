/**
 * Google Docs.
 *
 * Action-only, and the thinnest connector here, because Docs is really two APIs:
 * Drive owns the file (creating it, naming it, putting it in a folder) and the
 * Docs API owns the content inside it. So creating a document is a Drive call
 * followed by a Docs call, and this file is the second half plus the small amount
 * of glue that makes the pair usable.
 *
 * There is no read path. Reading documents means reading everything the user has
 * ever written, which is not something a personalization feature should hold, and
 * the `drive.file` scope makes it impossible anyway — Willow can only see the
 * documents it created itself.
 */

import { createFile, type DriveFile } from './drive';
import type { ConnectorFetch } from '../types';

const DOCS_API = 'https://docs.googleapis.com/v1/documents';

export const DOC_MIME = 'application/vnd.google-apps.document';

export interface DocumentRef {
  documentId: string;
  title: string;
  url: string;
}

const docUrl = (documentId: string): string =>
  `https://docs.google.com/document/d/${documentId}/edit`;

/**
 * Insert text at the start of a document.
 *
 * The Docs API is a batch of edit operations rather than a "set contents" call.
 * Index 1 is the first position in the body — index 0 is before the body itself
 * and the API rejects it, which is the single thing worth remembering about this
 * endpoint.
 */
export const insertText = async (
  fetchJson: ConnectorFetch,
  documentId: string,
  text: string,
  signal?: AbortSignal,
): Promise<boolean> => {
  if (!text) return true;
  const result = await fetchJson<{ documentId?: string }>(
    `${DOCS_API}/${encodeURIComponent(documentId)}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ insertText: { location: { index: 1 }, text } }],
      }),
      signal,
    },
  );
  return Boolean(result);
};

/**
 * Create a document with a title, optional body, and optional folder.
 *
 * Goes through Drive rather than the Docs API's own create call, because the Docs
 * call cannot put the file in a folder — it always lands in the root of My Drive,
 * and a user who asked for a document in a particular place would find it
 * somewhere else.
 */
export const createDocument = async (
  fetchJson: ConnectorFetch,
  input: { title: string; body?: string; folderId?: string },
  signal?: AbortSignal,
): Promise<DocumentRef | null> => {
  const file: DriveFile | null = await createFile(
    fetchJson,
    { name: input.title, mimeType: DOC_MIME, folderId: input.folderId },
    signal,
  );
  if (!file?.id) return null;

  if (input.body) {
    // A document that exists but is empty is still a usable result, so a failed
    // insert is reported by returning the ref rather than by throwing away a
    // document the user can see in their Drive.
    await insertText(fetchJson, file.id, input.body, signal);
  }

  return {
    documentId: file.id,
    title: file.name ?? input.title,
    url: file.webViewLink ?? docUrl(file.id),
  };
};

/** Append text to the end of a document. */
export const appendToDocument = async (
  fetchJson: ConnectorFetch,
  documentId: string,
  text: string,
  signal?: AbortSignal,
): Promise<boolean> => {
  if (!text) return true;
  const result = await fetchJson<{ documentId?: string }>(
    `${DOCS_API}/${encodeURIComponent(documentId)}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // `endOfSegmentLocation` with an empty segment id means the end of the
        // body, which saves reading the document to find out how long it is.
        requests: [{ insertText: { endOfSegmentLocation: {}, text } }],
      }),
      signal,
    },
  );
  return Boolean(result);
};
