/**
 * Google Drive Service
 * Handles all Drive operations for saving/loading projects and checkpoints
 */

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

// Folder names
const ROOT_FOLDER_NAME = 'Willow Apps';

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

class DriveService {
  private accessToken: string | null = null;

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  private async request(url: string, options: RequestInit = {}): Promise<any> {
    if (!this.accessToken) {
      throw new Error('No access token available. Please sign in with Google.');
    }

    const response = await fetch(url, {
      ...options,
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
        this.accessToken = null;
        window.dispatchEvent(new Event('willow_drive_auth_expired'));
      }
      throw new Error(error.error?.message || 'Drive API request failed');
    }

    return response.json();
  }

  /**
   * Find a folder by name within a parent folder
   */
  async findFolder(name: string, parentId?: string): Promise<DriveFile | null> {
    let query = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
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

  /**
   * Get or create the root "Willow Apps" folder
   */
  async getOrCreateRootFolder(): Promise<string> {
    let folder = await this.findFolder(ROOT_FOLDER_NAME);
    
    if (!folder) {
      console.log('[DriveService] Creating root folder:', ROOT_FOLDER_NAME);
      folder = await this.createFolder(ROOT_FOLDER_NAME);
    }

    return folder.id;
  }

  /**
   * Get or create a project folder within Willow Apps
   */
  async getOrCreateProjectFolder(projectName: string): Promise<string> {
    const rootId = await this.getOrCreateRootFolder();
    
    let folder = await this.findFolder(projectName, rootId);
    
    if (!folder) {
      console.log('[DriveService] Creating project folder:', projectName);
      folder = await this.createFolder(projectName, rootId);
    }

    return folder.id;
  }

  /**
   * Create a file in Drive
   */
  async createFile(name: string, content: string, parentId: string, mimeType: string = 'text/plain'): Promise<DriveFile> {
    const metadata = {
      name,
      parents: [parentId],
    };

    // Multipart upload for file with metadata and content
    const boundary = '-------DriveUploadBoundary';
    const body = 
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n` +
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
    
    // Get existing checkpoints to determine next number
    const existingCheckpoints = await this.listCheckpoints(projectName);
    const nextNumber = existingCheckpoints.length + 1;
    const checkpointName = `checkpoint_${String(nextNumber).padStart(3, '0')}`;
    
    console.log('[DriveService] Saving checkpoint:', checkpointName);
    
    // Create checkpoint folder
    const checkpointFolder = await this.createFolder(checkpointName, projectFolderId);
    
    // Save all files to checkpoint folder
    for (const file of files) {
      const mimeType = this.getMimeType(file.name);
      await this.createFile(file.name, file.content, checkpointFolder.id, mimeType);
    }
    
    // Also update "latest" folder
    await this.updateLatestFolder(projectFolderId, files);
    
    console.log('[DriveService] Checkpoint saved:', checkpointName, 'with', files.length, 'files');
    
    return checkpointFolder.id;
  }

  /**
   * Update the "latest" folder with current files
   */
  private async updateLatestFolder(projectFolderId: string, files: FileContent[]): Promise<void> {
    let latestFolder = await this.findFolder('latest', projectFolderId);
    
    if (latestFolder) {
      // Delete existing files in latest folder
      const existingFiles = await this.listFilesInFolder(latestFolder.id);
      for (const file of existingFiles) {
        await this.deleteFile(file.id);
      }
    } else {
      latestFolder = await this.createFolder('latest', projectFolderId);
    }
    
    // Save current files
    for (const file of files) {
      const mimeType = this.getMimeType(file.name);
      await this.createFile(file.name, file.content, latestFolder.id, mimeType);
    }
  }

  /**
   * List all checkpoints for a project
   */
  async listCheckpoints(projectName: string): Promise<DriveFile[]> {
    try {
      const projectFolderId = await this.getOrCreateProjectFolder(projectName);
      
      const query = `'${projectFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and name contains 'checkpoint_' and trashed=false`;
      
      const result = await this.request(
        `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)&orderBy=name`
      );
      
      return result.files || [];
    } catch (err) {
      console.error('[DriveService] Error listing checkpoints:', err);
      return [];
    }
  }

  /**
   * List all files in a folder
   */
  async listFilesInFolder(folderId: string): Promise<DriveFile[]> {
    const query = `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
    
    const result = await this.request(
      `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)`
    );
    
    return result.files || [];
  }

  /**
   * Get file content by ID
   */
  async getFileContent(fileId: string): Promise<string> {
    const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get file content');
    }

    return response.text();
  }

  /**
   * Load all files from a checkpoint
   */
  async loadCheckpoint(checkpointId: string): Promise<FileContent[]> {
    const files = await this.listFilesInFolder(checkpointId);
    const contents: FileContent[] = [];
    
    for (const file of files) {
      const content = await this.getFileContent(file.id);
      contents.push({ name: file.name, content });
    }
    
    return contents;
  }

  /**
   * Delete a file
   */
  async deleteFile(fileId: string): Promise<void> {
    await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
    });
  }

  /**
   * List all projects in Willow Apps folder
   */
  async listProjects(): Promise<DriveFile[]> {
    try {
      const rootId = await this.getOrCreateRootFolder();
      
      const query = `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      
      const result = await this.request(
        `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`
      );
      
      return result.files || [];
    } catch (err) {
      console.error('[DriveService] Error listing projects:', err);
      return [];
    }
  }

  /**
   * Get MIME type based on file extension
   */
  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'ts': 'application/typescript',
      'tsx': 'application/typescript',
      'jsx': 'application/javascript',
      'json': 'application/json',
      'md': 'text/markdown',
      'txt': 'text/plain',
    };
    return mimeTypes[ext || ''] || 'text/plain';
  }
}

// Export singleton instance
export const driveService = new DriveService();
export type { FileContent, DriveFile };

// Expose on window for debugging — DEV builds only (stripped from production bundles)
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).driveService = driveService;
  (window as any).testDriveCreate = async () => {
    console.log('[Test] Testing Drive folder creation...');
    try {
      const folderId = await driveService.getOrCreateRootFolder();
      console.log('[Test] SUCCESS! Willow Apps folder created/found with ID:', folderId);
      return folderId;
    } catch (err) {
      console.error('[Test] FAILED:', err);
      return null;
    }
  };
}
