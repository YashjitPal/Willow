/**
 * Willow Figma — typed REST client for the Figma backend.
 *
 * The backend (Back End/Figma) serves under `/figma-api/v1` — same-origin in
 * dev because it's mounted as Vite middleware; standalone it listens on
 * http://127.0.0.1:8788 with the same prefix. This client is the contract the
 * server implements.
 */

import type { FigComment, FigDocument, FigFileMeta, FigVersionMeta, FileId } from './types';

const BASE = '/figma-api/v1';

export class FigmaApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'FigmaApiError';
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new FigmaApiError(0, `Figma backend unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.error?.message) message = data.error.message;
    } catch {
      /* keep default */
    }
    throw new FigmaApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const figmaApi = {
  health(): Promise<{ ok: boolean; name: string; version: string }> {
    return request('GET', '/health');
  },

  // ── Files ──────────────────────────────────────────────────────────────────

  listFiles(): Promise<{ files: FigFileMeta[] }> {
    return request('GET', '/files');
  },

  createFile(name: string): Promise<{ file: FigFileMeta; doc: FigDocument }> {
    return request('POST', '/files', { name });
  },

  getFile(id: FileId): Promise<{ file: FigFileMeta; doc: FigDocument }> {
    return request('GET', `/files/${encodeURIComponent(id)}`);
  },

  /** Persist the full document (LWW). Server bumps updatedAt. */
  saveDoc(id: FileId, doc: FigDocument): Promise<{ file: FigFileMeta }> {
    return request('PUT', `/files/${encodeURIComponent(id)}/doc`, { doc });
  },

  /** Rename and/or update the thumbnail (PNG data URL). */
  patchFile(id: FileId, patch: { name?: string; thumbnail?: string }): Promise<{ file: FigFileMeta }> {
    return request('PATCH', `/files/${encodeURIComponent(id)}`, patch);
  },

  duplicateFile(id: FileId): Promise<{ file: FigFileMeta }> {
    return request('POST', `/files/${encodeURIComponent(id)}/duplicate`);
  },

  deleteFile(id: FileId): Promise<void> {
    return request('DELETE', `/files/${encodeURIComponent(id)}`);
  },

  // ── Comments ───────────────────────────────────────────────────────────────

  listComments(fileId: FileId): Promise<{ comments: FigComment[] }> {
    return request('GET', `/files/${encodeURIComponent(fileId)}/comments`);
  },

  addComment(
    fileId: FileId,
    input: { pageId: string; x: number; y: number; text: string; author: string; authorColor: string },
  ): Promise<{ comment: FigComment }> {
    return request('POST', `/files/${encodeURIComponent(fileId)}/comments`, input);
  },

  replyToComment(
    fileId: FileId,
    commentId: string,
    input: { text: string; author: string; authorColor: string },
  ): Promise<{ comment: FigComment }> {
    return request('POST', `/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}/replies`, input);
  },

  patchComment(
    fileId: FileId,
    commentId: string,
    patch: { resolved?: boolean; text?: string },
  ): Promise<{ comment: FigComment }> {
    return request('PATCH', `/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}`, patch);
  },

  deleteComment(fileId: FileId, commentId: string): Promise<void> {
    return request('DELETE', `/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}`);
  },

  // ── Version history ────────────────────────────────────────────────────────

  listVersions(fileId: FileId): Promise<{ versions: FigVersionMeta[] }> {
    return request('GET', `/files/${encodeURIComponent(fileId)}/versions`);
  },

  saveVersion(fileId: FileId, input: { label: string; author: string }): Promise<{ version: FigVersionMeta }> {
    return request('POST', `/files/${encodeURIComponent(fileId)}/versions`, input);
  },

  restoreVersion(fileId: FileId, versionId: string): Promise<{ file: FigFileMeta; doc: FigDocument }> {
    return request('POST', `/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/restore`);
  },
};

export type FigmaApi = typeof figmaApi;
