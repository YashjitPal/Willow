/**
 * Google Drive.
 *
 * Action-only. Drive's content is where everything the user has ever written
 * lives, and reading it wholesale would be a different product: a search over
 * everything, instead of a profile that respects the shape of the person's life.
 * The signal half of this connector is deliberately absent — a person's folder
 * names are not facts about the person.
 *
 * What Drive is connected *for* is writing. The user says "save this somewhere I
 * can find it" and a file lands in their Drive. Which is also why the write scope
 * is `drive.file` rather than the full `drive` scope: `drive.file` only ever
 * grants access to files Willow itself created, so this connector cannot see the
 * rest of the drive even by mistake.
 */

import { query } from '../google-fetch';
import type { ConnectorFetch } from '../types';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
}

/** Drive's search syntax uses single quotes, so a name containing one breaks it. */
const escapeQuery = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const findChildFolder = async (
  fetchJson: ConnectorFetch,
  parentId: string,
  name: string,
  signal?: AbortSignal,
): Promise<DriveFile | null> => {
  const page = await fetchJson<{ files?: DriveFile[] }>(
    `${DRIVE_API}/files${query({
      q: `'${parentId}' in parents and name = '${escapeQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id,name,mimeType)',
      pageSize: 1,
    })}`,
    { signal },
  );
  return page?.files?.[0] ?? null;
};

/**
 * Resolve a folder path, creating any part of it that is missing.
 *
 * Under `drive.file`, a folder Willow created is visible to Willow and a folder
 * the user created by hand is not — so a lookup that finds nothing means "not
 * ours yet", and creating is the correct response rather than an error. The
 * consequence worth knowing: if the user already has a folder by that name,
 * this makes a second one rather than writing into theirs. That is the scope
 * working as intended, and the alternative is asking for read access to the
 * whole drive to avoid one duplicate folder.
 */
export const ensureFolder = async (
  fetchJson: ConnectorFetch,
  path: string,
  signal?: AbortSignal,
): Promise<DriveFile | null> => {
  const parts = path.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let parentId = 'root';
  let folder: DriveFile | null = null;

  for (const name of parts) {
    if (signal?.aborted) return null;
    folder = await findChildFolder(fetchJson, parentId, name, signal);
    if (!folder) {
      folder = await fetchJson<DriveFile>(`${DRIVE_API}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
        signal,
      });
    }
    if (!folder?.id) return null;
    parentId = folder.id;
  }

  return folder;
};

/** Create an empty Google-native file (a Doc, a Sheet) in a folder. */
export const createFile = async (
  fetchJson: ConnectorFetch,
  input: { name: string; mimeType: string; folderId?: string },
  signal?: AbortSignal,
): Promise<DriveFile | null> =>
  fetchJson<DriveFile>(
    `${DRIVE_API}/files${query({ fields: 'id,name,mimeType,webViewLink' })}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        mimeType: input.mimeType,
        ...(input.folderId ? { parents: [input.folderId] } : {}),
      }),
      signal,
    },
  );

/** List files Willow created, newest first. Under `drive.file` that is all it can see. */
export const listOwnFiles = async (
  fetchJson: ConnectorFetch,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<DriveFile[]> => {
  const page = await fetchJson<{ files?: DriveFile[] }>(
    `${DRIVE_API}/files${query({
      q: 'trashed = false',
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name,mimeType,webViewLink)',
      pageSize: options.limit ?? 20,
    })}`,
    { signal: options.signal },
  );
  return page?.files ?? [];
};
