// Sandpack Store - Central store for managing files and preview state
// Replaces bolt.diy's workbench, files, previews, and terminal stores

import { atom, map, type MapStore } from 'nanostores';
import { 
  BASE_TEMPLATE, 
  type SandpackFiles,
} from './sandpack-types';
import { parseResponseForDisplay, type ChatSegment } from './message-parser';

// File content type for internal tracking
interface FileEntry {
  type: 'file';
  content: string;
}

type FileMap = Record<string, FileEntry>;

/**
 * One Code screen's files and preview state. Each screen has its own (see
 * `session/code-session.ts`): two screens on one store meant opening the Code
 * home reset the files under a project's running turn.
 */
export class SandpackStore {
  // Files store - tracks all project files
  files: MapStore<FileMap> = map({});
  
  // Currently active/selected file path
  activeFile = atom<string>('/src/App.tsx');
  
  // Current editing file (for UI indicator)
  currentEditingFile = atom<string | null>(null);
  
  // Preview ready state
  previewReady = atom<boolean>(false);
  
  // Track if user has generated code
  hasUserCode = atom<boolean>(false);
  
  // Track if AI is currently generating (for UI states)
  isGenerating = atom<boolean>(false);
  
  // Temporary snapshot for previewing past code states without overwriting live files
  previewSnapshot = atom<Record<string, string> | null>(null);
  
  // Tracks the ID of the currently active snapshot (used to disable Revert/Preview buttons for the active state)
  activeSnapshotId = atom<string | null>(null);

  constructor() {
    // Initialize with base template
    this.resetToTemplate();
  }

  /**
   * Reset files to the base React template
   */
  resetToTemplate() {
    const initialFiles: FileMap = {};
    
    for (const [path, file] of Object.entries(BASE_TEMPLATE)) {
      const content = typeof file === 'string' ? file : file.code;
      initialFiles[path] = { type: 'file', content };
    }
    
    this.files.set(initialFiles);
    this.activeFile.set('/App.tsx');
    this.hasUserCode.set(false);
    this.previewReady.set(true);
  }

  /**
   * Restore files from a specific snapshot
   */
  restoreFromSnapshot(snapshotId: string, snapshot: Record<string, string>) {
    const restoredFiles: FileMap = {};
    for (const [path, content] of Object.entries(snapshot)) {
      restoredFiles[path] = { type: 'file', content };
    }
    this.files.set(restoredFiles);
    
    // Ensure preview is updated with this new live state
    this.hasUserCode.set(true);
    this.activeSnapshotId.set(snapshotId);
    this.previewSnapshot.set(null); // Clear preview snapshot when reverting (we are now live on this state)
  }

  /**
   * Set or update a file
   */
  setFile(path: string, content: string) {
    // Normalize paths for the preview system
    let normalizedPath = path.startsWith('/') ? path : `/${path}`;
    
    // Remove src/ prefix if present - preview uses root paths
    if (normalizedPath.startsWith('/src/')) {
      normalizedPath = '/' + normalizedPath.substring(5);
    }
    
    console.log(`[Store] Setting file: ${path} -> ${normalizedPath}`);
    
    this.files.setKey(normalizedPath, { type: 'file', content });
    this.hasUserCode.set(true);
    this.activeSnapshotId.set(null); // Invalidate active snapshot when any file changes
  }

  /**
   * Get a file's content
   */
  getFile(path: string): string | undefined {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const file = this.files.get()[normalizedPath];
    return file?.content;
  }

  /**
   * Get all files in Sandpack format
   */
  getSandpackFiles(): SandpackFiles {
    const currentFiles = this.files.get();
    const sandpackFiles: SandpackFiles = {};
    
    for (const [path, file] of Object.entries(currentFiles)) {
      sandpackFiles[path] = {
        code: file.content,
        active: path === this.activeFile.get(),
      };
    }
    
    return sandpackFiles;
  }

  /**
   * Get all files as array (for Drive saving, etc.)
   */
  getAllFiles(): Array<{ name: string; content: string }> {
    const currentFiles = this.files.get();
    return Object.entries(currentFiles).map(([path, file]) => ({
      name: path.startsWith('/') ? path.substring(1) : path,
      content: file.content,
    }));
  }

  /**
   * Set the currently editing file (for UI indicator)
   */
  setCurrentEditingFile(filePath: string | null) {
    this.currentEditingFile.set(filePath);
  }

  /**
   * Set the active/selected file
   */
  setActiveFile(path: string) {
    this.activeFile.set(path);
  }

  /**
   * Full reset - clears all state for a fresh session
   * Call this when starting a new project/session
   */
  reset(): void {
    console.log('[Store] Full reset - clearing all session state');
    this.files.set({});
    this.activeFile.set('/src/App.tsx');
    this.currentEditingFile.set(null);
    this.previewReady.set(false);
    this.hasUserCode.set(false);
    this.isGenerating.set(false);
    this.previewSnapshot.set(null);
    this.activeSnapshotId.set(null);
  }

  /**
   * Get file content from the files store (for code panel)
   */
  getFileContent(path: string): string | undefined {
    return this.getFile(path);
  }

  /**
   * Set a temporary preview snapshot (time travel)
   */
  setPreviewSnapshot(snapshot: Record<string, string> | null): void {
    this.previewSnapshot.set(snapshot);
  }
}


// Re-export parser functions for convenience
export { parseResponseForDisplay, type ChatSegment };
