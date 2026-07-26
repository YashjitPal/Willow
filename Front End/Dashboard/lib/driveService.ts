/**
 * Google Drive Service
 * Handles all Drive operations for saving/loading projects and checkpoints
 */

import {
  getProjectFileMimeType,
  getProjectFileUploadPayload,
  projectFileContentFromBytes,
} from './projectFileContent.ts';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

// Folder names
const ROOT_FOLDER_NAME = 'Willow Apps';
const driveResourceQueues = new Map<string, Promise<unknown>>();

async function withDriveResourceLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  if (locks?.request) return locks.request(`willow-drive-resource:${name}`, operation);
  const previous = driveResourceQueues.get(name) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  driveResourceQueues.set(name, current);
  try {
    return await current;
  } finally {
    if (driveResourceQueues.get(name) === current) driveResourceQueues.delete(name);
  }
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  parents?: string[];
}

interface FileContent {
  name: string;
  content: string;
}

export class DriveService {
  private readonly accessToken: string;
  private readonly signal?: AbortSignal;

  // Bind each client to one immutable grant. Otherwise an account switch in
  // the middle of a multi-request checkpoint can send later requests using a
  // different user's token.
  constructor(accessToken: string, signal?: AbortSignal) {
    if (!accessToken) throw new Error('No access token available. Please sign in with Google.');
    this.accessToken = accessToken;
    this.signal = signal;
  }

  private async request(url: string, options: RequestInit = {}): Promise<any> {
    const response = await fetch(url, {
      ...options,
      signal: options.signal ?? this.signal,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('[DriveService] API Error:', error);
      if (response.status === 401 && typeof window !== 'undefined') {
        // Token expired or revoked — drop it and let the app prompt a re-connect
        // instead of repeatedly failing every request with a stale token.
        window.dispatchEvent(new Event('willow_drive_auth_expired'));
      }
      throw new Error(error.error?.message || 'Drive API request failed');
    }

    return response.json();
  }

  private async listAllFiles(query: string, fileFields: string, orderBy?: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: query,
        fields: `nextPageToken,files(${fileFields})`,
        pageSize: '1000',
      });
      if (orderBy) params.set('orderBy', orderBy);
      if (pageToken) params.set('pageToken', pageToken);
      const result = await this.request(`${DRIVE_API_BASE}/files?${params.toString()}`);
      if (Array.isArray(result.files)) files.push(...result.files);
      pageToken = result.nextPageToken;
    } while (pageToken);
    return files;
  }

  /**
   * Find a folder by name within a parent folder
   */
  async findFolder(name: string, parentId?: string): Promise<DriveFile | null> {
    // Escape backslashes and single quotes: AI-generated project names can contain
    // apostrophes (e.g. "Bob's App"), which would otherwise break the Drive `q`
    // syntax and 400 the request — silently failing every save for that project.
    const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let query = `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentId) {
      query += ` and '${parentId}' in parents`;
    }

    const result = await this.request(
      `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)`
    );

    return result.files?.[0] || null;
  }

  /**
   * Create a folder in Drive
   */
  async createFolder(name: string, parentId?: string): Promise<DriveFile> {
    const metadata: any = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };

    if (parentId) {
      metadata.parents = [parentId];
    }

    return this.request(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
  }

  async updateFileMetadata(fileId: string, metadata: Record<string, unknown>): Promise<DriveFile> {
    return this.request(`${DRIVE_API_BASE}/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
  }

  /**
   * Get or create the root "Willow Apps" folder
   */
  async getOrCreateRootFolder(): Promise<string> {
    return withDriveResourceLock('root-folder', async () => {
      let folder = await this.findFolder(ROOT_FOLDER_NAME);
      if (!folder) {
        console.log('[DriveService] Creating root folder:', ROOT_FOLDER_NAME);
        folder = await this.createFolder(ROOT_FOLDER_NAME);
      }
      return folder.id;
    });
  }

  /**
   * Get or create a project folder within Willow Apps
   */
  async getOrCreateProjectFolder(projectName: string): Promise<string> {
    const rootId = await this.getOrCreateRootFolder();
    return withDriveResourceLock(`project-folder:${rootId}:${projectName}`, async () => {
      let folder = await this.findFolder(projectName, rootId);
      if (!folder) {
        console.log('[DriveService] Creating project folder:', projectName);
        folder = await this.createFolder(projectName, rootId);
      }
      return folder.id;
    });
  }

  /** Find an existing project folder without creating any Drive resources. */
  async findProjectFolder(projectName: string): Promise<DriveFile | null> {
    const root = await this.findFolder(ROOT_FOLDER_NAME);
    if (!root) return null;
    return this.findFolder(projectName, root.id);
  }

  /**
   * Create a file in Drive
   */
  async createFile(name: string, content: string, parentId: string, mimeType: string = 'text/plain'): Promise<DriveFile> {
    const payload = getProjectFileUploadPayload(name, content, mimeType);
    const effectiveMimeType = payload.mimeType;
    const metadata = {
      name,
      parents: [parentId],
      mimeType: effectiveMimeType,
    };

    const contentBlob = payload.blob;
    // Drive's multipart path is intended for small payloads. Use a resumable
    // upload for larger source files so checkpointing does not hit the 5 MB
    // multipart ceiling or build another giant boundary-delimited string. Binary
    // files always use this byte-safe path; interpolating them into a multipart
    // JavaScript string would corrupt bytes above 0x7f.
    if (payload.binary || contentBlob.size > 5 * 1024 * 1024) {
      const initiation = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=resumable`, {
        method: 'POST',
        signal: this.signal,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': effectiveMimeType,
          'X-Upload-Content-Length': String(contentBlob.size),
        },
        body: JSON.stringify(metadata),
      });
      if (!initiation.ok) {
        if (initiation.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('willow_drive_auth_expired'));
        }
        const error = await initiation.json().catch(() => ({}));
        throw new Error(error.error?.message || 'Failed to start resumable Drive upload');
      }
      const uploadUrl = initiation.headers.get('Location');
      if (!uploadUrl) throw new Error('Drive did not return a resumable upload URL');
      const upload = await fetch(uploadUrl, {
        method: 'PUT',
        signal: this.signal,
        headers: { 'Content-Type': effectiveMimeType },
        body: contentBlob,
      });
      if (!upload.ok) {
        if (upload.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('willow_drive_auth_expired'));
        }
        const error = await upload.json().catch(() => ({}));
        throw new Error(error.error?.message || 'Resumable Drive upload failed');
      }
      return upload.json();
    }

    // Multipart upload for file with metadata and content
    const boundary = `-------DriveUploadBoundary${crypto.randomUUID?.() || Date.now().toString(36)}`;
    const body = 
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${effectiveMimeType}\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`;

    return this.request(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
  }

  /**
   * Save a checkpoint for a project
   * Creates a folder like "checkpoint_001" with all project files
   */
  async saveCheckpoint(projectName: string, files: FileContent[]): Promise<string> {
    const projectFolderId = await this.getOrCreateProjectFolder(projectName);
    
    // Get existing checkpoints to determine next number. Use the MAX existing
    // suffix + 1 rather than count + 1 — otherwise deleting a middle checkpoint
    // (001,002,003 → delete 002 → count 2 → "003") collides with an existing name
    // and Drive silently creates a duplicate checkpoint_003.
    const existingCheckpoints = await this.listCheckpoints(projectName);
    const maxNumber = existingCheckpoints.reduce((max, cp) => {
      const m = /checkpoint_(\d+)/.exec(cp.name || '');
      const n = m ? parseInt(m[1], 10) : 0;
      return n > max ? n : max;
    }, 0);
    const nextNumber = maxNumber + 1;
    const checkpointName = `checkpoint_${String(nextNumber).padStart(3, '0')}`;
    
    console.log('[DriveService] Saving checkpoint:', checkpointName);

    // Keep in-progress checkpoints out of listCheckpoints. Only rename the
    // folder to its public checkpoint_* name after every file and latest/ have
    // committed. A failed upload is cleaned up instead of becoming a visible,
    // partially-restorable checkpoint.
    const pendingName = `willow_pending_${crypto.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
    const checkpointFolder = await this.createFolder(pendingName, projectFolderId);
    try {
      for (const file of files) {
        const mimeType = this.getMimeType(file.name);
        await this.createFile(file.name, file.content, checkpointFolder.id, mimeType);
      }
      await this.updateLatestFolder(projectFolderId, files);
      await this.updateFileMetadata(checkpointFolder.id, { name: checkpointName });
      console.log('[DriveService] Checkpoint saved:', checkpointName, 'with', files.length, 'files');
      return checkpointFolder.id;
    } catch (error) {
      try { await this.deleteFile(checkpointFolder.id); } catch {}
      throw error;
    }
  }

  /**
   * Update the "latest" folder with current files
   */
  private async updateLatestFolder(projectFolderId: string, files: FileContent[]): Promise<void> {
    const previousLatest = await this.findFolder('latest', projectFolderId);
    const nonce = crypto.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const pendingLatest = await this.createFolder(`willow_latest_pending_${nonce}`, projectFolderId);

    // Capture the previous generation's files, but do NOT delete them yet.
    let previousRenamed = false;
    try {

    // Write the new files FIRST. Deleting before writing left `latest/` empty (or
    // half-populated) if the save was interrupted mid-rewrite — the project then
    // opened blank. Writing first means latest/ always holds a complete set; the
    // brief same-name duplicates are removed below and self-heal on the next save.
    for (const file of files) {
      const mimeType = this.getMimeType(file.name);
      await this.createFile(file.name, file.content, pendingLatest.id, mimeType);
    }

      if (previousLatest) {
        await this.updateFileMetadata(previousLatest.id, { name: `willow_latest_stale_${nonce}` });
        previousRenamed = true;
      }
      try {
        await this.updateFileMetadata(pendingLatest.id, { name: 'latest' });
      } catch (error) {
        if (previousLatest && previousRenamed) {
          try { await this.updateFileMetadata(previousLatest.id, { name: 'latest' }); } catch {}
        }
        throw error;
      }
      if (previousLatest) {
        try { await this.deleteFile(previousLatest.id); } catch {}
      }
    } catch (error) {
      try { await this.deleteFile(pendingLatest.id); } catch {}
      throw error;
    }
  }

  /**
   * List all checkpoints for a project
   */
  async listCheckpoints(projectName: string): Promise<DriveFile[]> {
    const projectFolder = await this.findProjectFolder(projectName);
    if (!projectFolder) return [];
    const query = `'${projectFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and name contains 'checkpoint_' and trashed=false`;
    return this.listAllFiles(query, 'id,name,modifiedTime', 'name');
  }

  /**
   * List all files in a folder
   */
  async listFilesInFolder(folderId: string): Promise<DriveFile[]> {
    const query = `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
    
    return this.listAllFiles(query, 'id,name,mimeType');
  }

  /**
   * Get file content by ID
   */
  async getFileContent(file: DriveFile): Promise<string> {
    const response = await fetch(`${DRIVE_API_BASE}/files/${file.id}?alt=media`, {
      signal: this.signal,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('willow_drive_auth_expired'));
      }
      throw new Error('Failed to get file content');
    }

    return projectFileContentFromBytes(
      file.name,
      new Uint8Array(await response.arrayBuffer()),
      file.mimeType,
    );
  }

  /**
   * Load all files from a checkpoint
   */
  async loadCheckpoint(checkpointId: string): Promise<FileContent[]> {
    const files = await this.listFilesInFolder(checkpointId);
    const contents: FileContent[] = [];
    
    for (const file of files) {
      const content = await this.getFileContent(file);
      contents.push({ name: file.name, content });
    }
    
    return contents;
  }

  /**
   * Load the current complete generation for a project. `null` distinguishes a
   * missing project/latest folder from a valid latest folder with zero files.
   */
  async loadLatestProject(projectName: string): Promise<FileContent[] | null> {
    const projectFolder = await this.findProjectFolder(projectName);
    if (!projectFolder) return null;
    let latest = await this.findFolder('latest', projectFolder.id);
    if (!latest) {
      // A tab/browser crash can happen after the previous complete `latest`
      // generation was renamed stale but before the pending generation became
      // `latest`. The stale folder is deliberately retained until that swap
      // commits, so it is a safe read-only recovery source.
      const query = `'${projectFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and name contains 'willow_latest_stale_' and trashed=false`;
      const stale = await this.listAllFiles(query, 'id,name,modifiedTime', 'modifiedTime desc');
      latest = stale[0] || null;
    }
    return latest ? this.loadCheckpoint(latest.id) : null;
  }

  /**
   * Delete a file
   */
  async deleteFile(fileId: string): Promise<void> {
    const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
      method: 'DELETE',
      signal: this.signal,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
    });
    if (!response.ok && response.status !== 404) {
      if (response.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('willow_drive_auth_expired'));
      }
      throw new Error('Failed to delete stale Drive file');
    }
  }

  /**
   * List all projects in Willow Apps folder
   */
  async listProjects(): Promise<DriveFile[]> {
    const root = await this.findFolder(ROOT_FOLDER_NAME);
    if (!root) return [];
    const query = `'${root.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    return this.listAllFiles(query, 'id,name,modifiedTime', 'modifiedTime desc');
  }

  /**
   * Get MIME type based on file extension
   */
  private getMimeType(filename: string): string {
    return getProjectFileMimeType(filename);
  }
}

// Export singleton instance
export type { FileContent, DriveFile };

// Expose on window for debugging — DEV builds only (stripped from production bundles)
