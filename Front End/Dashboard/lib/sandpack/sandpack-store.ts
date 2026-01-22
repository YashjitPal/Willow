// Sandpack Store - Central store for managing files and preview state
// Replaces bolt.diy's workbench, files, previews, and terminal stores

import { atom, map, type MapStore } from 'nanostores';
import { 
  BASE_TEMPLATE, 
  SANDPACK_DEPENDENCIES,
  type SandpackFile, 
  type SandpackFiles,
  type ParsedAction 
} from './sandpack-types';
import { StreamingMessageParser, parseAIResponse, parseResponseForDisplay, type ChatSegment } from './message-parser';

// File content type for internal tracking
interface FileEntry {
  type: 'file';
  content: string;
}

type FileMap = Record<string, FileEntry>;

class SandpackStore {
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
  
  // Pending file edits during streaming
  #pendingFileEdits: Map<string, { filePath: string; content: string }> = new Map();

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
   * Process a complete AI response
   * Parses the response and applies file changes
   */
  async processAIResponse(response: string): Promise<void> {
    console.log('[Store] Processing AI response, length:', response.length);
    console.log('[Store] Response preview:', response.substring(0, 300));
    const actions = parseAIResponse(response);
    console.log('[Store] Parsed actions:', actions.length, actions.map(a => a.filePath));
    
    for (const action of actions) {
      if (action.type === 'file' && action.filePath && action.content !== undefined) {
        console.log('[Store] Setting file from AI:', action.filePath);
        this.setFile(action.filePath, action.content);
      }
      // Ignore shell and start actions
    }
  }

  /**
   * Create a streaming message parser for real-time updates
   */
  createMessageParser(): StreamingMessageParser {
    return new StreamingMessageParser({
      onActionOpen: (action) => {
        if (action.type === 'file' && action.filePath) {
          this.setCurrentEditingFile(action.filePath);
        }
      },
      onActionClose: (action) => {
        if (action.type === 'file' && action.filePath && action.content !== undefined) {
          // Queue the file edit (will be applied in batch at the end)
          this.#pendingFileEdits.set(action.filePath, {
            filePath: action.filePath,
            content: action.content,
          });
        }
        this.setCurrentEditingFile(null);
      },
      onTextChunk: () => {
        // Text chunks handled by the UI directly
      },
    });
  }

  /**
   * Flush all pending file edits
   * Called when AI generation completes
   */
  flushPendingEdits(): void {
    console.log('[Store] Flushing pending edits, count:', this.#pendingFileEdits.size);
    for (const [path, edit] of this.#pendingFileEdits) {
      console.log('[Store] Flushing file:', path);
      this.setFile(edit.filePath, edit.content);
    }
    this.#pendingFileEdits.clear();
    this.setCurrentEditingFile(null);
  }

  /**
   * Get file content from the files store (for code panel)
   */
  getFileContent(path: string): string | undefined {
    return this.getFile(path);
  }
}

// Singleton instance
export const sandpackStore = new SandpackStore();

// Re-export parser functions for convenience
export { parseAIResponse, parseResponseForDisplay, type ChatSegment };
