import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  isFSAAPISupported,
  storeDirectoryHandle,
  getStoredDirectoryHandle,
  removeStoredDirectoryHandle,
  verifyPermission,
  writeFileRecursively
} from '../lib/localFileSystemService';
import { useAuth } from './AuthContext';
import { useUserDataContext } from './UserDataContext';
import { designNodesStore } from '../lib/stores/design-store';

interface FileContent {
  name: string;
  content: string;
}

export const getChatTimestamp = (chatId: string): number => {
  if (typeof window === 'undefined') return 0;
  try {
    const stored = localStorage.getItem('willow_chat_timestamps');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed[chatId]) return parsed[chatId];
    }
  } catch {}
  
  // Fallback: If it's a temp ID format, extract timestamp from name
  const isTemp = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_[a-z0-9]{6}$/i.test(chatId);
  if (isTemp) {
    try {
      const firstPart = chatId.split('_')[0]; // "2026-06-06T06-44-09"
      const tIdx = firstPart.indexOf('T');
      if (tIdx !== -1) {
        const datePart = firstPart.slice(0, tIdx); // "2026-06-06"
        const timePart = firstPart.slice(tIdx + 1).replace(/-/g, ':'); // "06:44:09"
        const dateStr = `${datePart}T${timePart}`;
        const parsedTime = new Date(dateStr).getTime();
        if (!isNaN(parsedTime)) {
          return parsedTime;
        }
      }
    } catch {}
  }
  return 0; // Fallback for other unnamed chats
};

export const updateChatTimestamp = (chatId: string, timestamp = Date.now()) => {
  if (typeof window === 'undefined') return;
  try {
    const stored = localStorage.getItem('willow_chat_timestamps');
    const timestamps = stored ? JSON.parse(stored) : {};
    timestamps[chatId] = timestamp;
    localStorage.setItem('willow_chat_timestamps', JSON.stringify(timestamps));
  } catch {}
};

export const sortChatsNewestToOldest = (chats: string[]): string[] => {
  const sorted = [...chats];
  sorted.sort((a, b) => {
    const tA = getChatTimestamp(a);
    const tB = getChatTimestamp(b);
    if (tB !== tA) {
      return tB - tA;
    }
    return a.localeCompare(b);
  });
  return sorted;
};

interface LocalFSContextType {
  isSupported: boolean;
  isLocalFolderConnected: boolean;
  isLocalFolderAuthorized: boolean;
  localFolderName: string | null;
  connectLocalFolder: () => Promise<boolean>;
  disconnectLocalFolder: () => Promise<void>;
  authorizeLocalFolder: () => Promise<boolean>;
  saveLocalFSProject: (projectName: string, files: FileContent[]) => Promise<boolean>;
  saveLocalFSChat: (chatId: string, messages: any[], oldChatId?: string | null) => Promise<boolean>;
  saveLocalFSProjectChat: (projectName: string, chatId: string, messages: any[], oldChatId?: string | null) => Promise<boolean>;
  saveLocalFSMedia: (projectName: string, kind: 'image' | 'video', fileName: string, blob: Blob) => Promise<boolean>;
  generateChatTitle: (userMessage: string, assistantMessage: string) => Promise<string>;
  localChats: string[];
  activeChatId: string | null;
  selectLocalFSInboxChat: (chatId: string | null) => void | Promise<void>;
  loadLocalFSChat: (chatId: string) => Promise<any[] | null>;
  refreshLocalChats: () => Promise<void>;
  deleteLocalFSChat: (chatId: string) => Promise<boolean>;
  renameLocalFSChat: (oldChatId: string, newChatId: string) => Promise<boolean>;
  getChatTimestamp: (chatId: string) => number;
}

const LocalFSContext = createContext<LocalFSContextType | null>(null);

export const LocalFSProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, userProfile } = useAuth();
  const { apiKeys } = useUserDataContext();
  const [isSupported] = useState(isFSAAPISupported);
  const [isLocalFolderConnected, setIsLocalFolderConnected] = useState(false);
  const [isLocalFolderAuthorized, setIsLocalFolderAuthorized] = useState(false);
  const [localFolderName, setLocalFolderName] = useState<string | null>(null);
  const [localChats, setLocalChats] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('willow_local_chats');
        return stored ? JSON.parse(stored) : [];
      } catch {}
    }
    return [];
  });
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  
  // Keep the handle in a ref to avoid re-renders and closure issues
  const directoryHandleRef = useRef<FileSystemDirectoryHandle | null>(null);

  const getSanitizedWorkspaceName = useCallback(() => {
    const name = userProfile?.workspaceName || (userProfile?.displayName ? `${userProfile.displayName.split(' ')[0]}'s Willow` : "My Willow");
    return name.replace(/[\/:*?"<>|]/g, '').trim() || 'My Willow';
  }, [userProfile]);

  // Attempt to restore directory connection from IndexedDB on mount
  useEffect(() => {
    if (!isSupported) return;

    const restoreConnection = async () => {
      const handle = await getStoredDirectoryHandle();
      if (handle) {
        directoryHandleRef.current = handle;
        setLocalFolderName(handle.name);
        setIsLocalFolderConnected(true);

        try {
          const hasAccess = await verifyPermission(handle, false, false);
          if (hasAccess) {
            setIsLocalFolderAuthorized(true);
            const workspaceName = getSanitizedWorkspaceName();
            const workspaceDir = await handle.getDirectoryHandle(workspaceName, { create: true });
            const chatsDir = await workspaceDir.getDirectoryHandle('Chats', { create: true });
            
            // Read disk chats
            const diskChats: string[] = [];
            const timestamps = (() => {
              try {
                const stored = localStorage.getItem('willow_chat_timestamps');
                return stored ? JSON.parse(stored) : {};
              } catch { return {}; }
            })();
            let timestampsUpdated = false;

            for await (const entry of (chatsDir as any).values()) {
              if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                const chatId = entry.name.slice(0, -5);
                diskChats.push(chatId);
                if (!timestamps[chatId]) {
                  try {
                    const file = await entry.getFile();
                    timestamps[chatId] = file.lastModified;
                    timestampsUpdated = true;
                  } catch {}
                }
              }
            }

            if (timestampsUpdated) {
              localStorage.setItem('willow_chat_timestamps', JSON.stringify(timestamps));
            }

            // Get cached chats list
            let cachedChats: string[] = [];
            try {
              const stored = localStorage.getItem('willow_local_chats');
              cachedChats = stored ? JSON.parse(stored) : [];
            } catch {}

            // Auto-sync local-only chats to disk
            for (const chat of cachedChats) {
              if (!diskChats.includes(chat)) {
                try {
                  const cachedContent = localStorage.getItem(`willow_chat_${chat}`);
                  if (cachedContent) {
                    await writeFileRecursively(chatsDir, `${chat}.json`, cachedContent);
                    diskChats.push(chat);
                  }
                } catch {}
              }
            }

            const sorted = sortChatsNewestToOldest(diskChats);
            setLocalChats(sorted);
            localStorage.setItem('willow_local_chats', JSON.stringify(sorted));
          } else {
            setIsLocalFolderAuthorized(false);
          }
        } catch {
          setIsLocalFolderAuthorized(false);
        }
      }
    };

    restoreConnection();
  }, [isSupported, getSanitizedWorkspaceName]);

  /**
   * Connect to a local folder by opening the folder picker
   */
  const connectLocalFolder = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      return false;
    }

    try {
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });

      // Verify write access
      const hasPermission = await verifyPermission(handle, true);
      if (!hasPermission) {
        return false;
      }

      // Store handle in IndexedDB
      await storeDirectoryHandle(handle);
      
      directoryHandleRef.current = handle;
      setLocalFolderName(handle.name);
      setIsLocalFolderConnected(true);
      setIsLocalFolderAuthorized(true);

      // Refresh chats list and sync cached chats to disk
      try {
        const workspaceName = getSanitizedWorkspaceName();
        const workspaceDir = await handle.getDirectoryHandle(workspaceName, { create: true });
        const chatsDir = await workspaceDir.getDirectoryHandle('Chats', { create: true });
        
        // Read disk chats
        const diskChats: string[] = [];
        const timestamps = (() => {
          try {
            const stored = localStorage.getItem('willow_chat_timestamps');
            return stored ? JSON.parse(stored) : {};
          } catch { return {}; }
        })();
        let timestampsUpdated = false;

        for await (const entry of (chatsDir as any).values()) {
          if (entry.kind === 'file' && entry.name.endsWith('.json')) {
            const chatId = entry.name.slice(0, -5);
            diskChats.push(chatId);
            if (!timestamps[chatId]) {
              try {
                const file = await entry.getFile();
                timestamps[chatId] = file.lastModified;
                timestampsUpdated = true;
              } catch {}
            }
          }
        }

        if (timestampsUpdated) {
          localStorage.setItem('willow_chat_timestamps', JSON.stringify(timestamps));
        }

        // Get cached chats
        let cachedChats: string[] = [];
        try {
          const stored = localStorage.getItem('willow_local_chats');
          cachedChats = stored ? JSON.parse(stored) : [];
        } catch {}

        // Auto-sync local-only chats to disk
        for (const chat of cachedChats) {
          if (!diskChats.includes(chat)) {
            try {
              const cachedContent = localStorage.getItem(`willow_chat_${chat}`);
              if (cachedContent) {
                await writeFileRecursively(chatsDir, `${chat}.json`, cachedContent);
                diskChats.push(chat);
              }
            } catch {}
          }
        }

        const sorted = sortChatsNewestToOldest(diskChats);
        setLocalChats(sorted);
        localStorage.setItem('willow_local_chats', JSON.stringify(sorted));
      } catch (err) {
        console.error('Error syncing chats to connected folder', err);
      }

      return true;
    } catch (err) {
      return false;
    }
  }, [isSupported, getSanitizedWorkspaceName]);

  /**
   * Disconnect local folder and clean up IndexedDB
   */
  const disconnectLocalFolder = useCallback(async (): Promise<void> => {
    try {
      await removeStoredDirectoryHandle();
      directoryHandleRef.current = null;
      setLocalFolderName(null);
      setIsLocalFolderConnected(false);
      setIsLocalFolderAuthorized(false);
      setLocalChats([]);
      setActiveChatId(null);
    } catch (err) {
    }
  }, []);

  /**
   * Authorize / prompt for directory permission in a user gesture context
   */
  const authorizeLocalFolder = useCallback(async (): Promise<boolean> => {
    const handle = directoryHandleRef.current;
    if (!handle) return false;

    try {
      const hasAccess = await verifyPermission(handle, true, true);
      if (hasAccess) {
        setIsLocalFolderAuthorized(true);
        // Refresh chats list and sync cached chats to disk
        try {
          const workspaceName = getSanitizedWorkspaceName();
          const workspaceDir = await handle.getDirectoryHandle(workspaceName, { create: true });
          const chatsDir = await workspaceDir.getDirectoryHandle('Chats', { create: true });
          
          // Read disk chats
          const diskChats: string[] = [];
          const timestamps = (() => {
            try {
              const stored = localStorage.getItem('willow_chat_timestamps');
              return stored ? JSON.parse(stored) : {};
            } catch { return {}; }
          })();
          let timestampsUpdated = false;

          for await (const entry of (chatsDir as any).values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.json')) {
              const chatId = entry.name.slice(0, -5);
              diskChats.push(chatId);
              if (!timestamps[chatId]) {
                try {
                  const file = await entry.getFile();
                  timestamps[chatId] = file.lastModified;
                  timestampsUpdated = true;
                } catch {}
              }
            }
          }

          if (timestampsUpdated) {
            localStorage.setItem('willow_chat_timestamps', JSON.stringify(timestamps));
          }

          // Get cached chats
          let cachedChats: string[] = [];
          try {
            const stored = localStorage.getItem('willow_local_chats');
            cachedChats = stored ? JSON.parse(stored) : [];
          } catch {}

          // Auto-sync local-only chats to disk
          for (const chat of cachedChats) {
            if (!diskChats.includes(chat)) {
              try {
                const cachedContent = localStorage.getItem(`willow_chat_${chat}`);
                if (cachedContent) {
                  await writeFileRecursively(chatsDir, `${chat}.json`, cachedContent);
                  diskChats.push(chat);
                }
              } catch {}
            }
          }

          const sorted = sortChatsNewestToOldest(diskChats);
          setLocalChats(sorted);
          localStorage.setItem('willow_local_chats', JSON.stringify(sorted));
        } catch (err) {
          console.error('Error syncing chats during authorization', err);
        }
        return true;
      }
    } catch {}
    return false;
  }, [getSanitizedWorkspaceName]);

  /**
   * Internal helper to retrieve handle and verify permission on action
   */
  const getActiveHandle = useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
    const handle = directoryHandleRef.current;
    if (!handle) return null;

    const hasAccess = await verifyPermission(handle, true, false);
    if (!hasAccess) {
      return null;
    }
    setIsLocalFolderAuthorized(true);

    return handle;
  }, []);

  /**
   * Save project files locally
   */
  const saveLocalFSProject = useCallback(async (projectName: string, files: FileContent[]): Promise<boolean> => {
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return false;

    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      const codeDir = await workspaceDir.getDirectoryHandle('Code', { create: true });
      const projectDir = await codeDir.getDirectoryHandle(projectName, { create: true });
      
      // Create subfolders: Codebase, Chat sessions, Designs, Agents
      const codebaseDir = await projectDir.getDirectoryHandle('Codebase', { create: true });
      await projectDir.getDirectoryHandle('Chat sessions', { create: true });
      const designsDir = await projectDir.getDirectoryHandle('Designs', { create: true });
      await projectDir.getDirectoryHandle('Agents', { create: true });

      try {
        for await (const entry of (codebaseDir as any).values()) {
          if (entry.kind === 'file') {
            await codebaseDir.removeEntry(entry.name);
          }
        }
      } catch {}

      // Save codebase files: /[workspace]/Code/[projectName]/Codebase/
      for (const file of files) {
        await writeFileRecursively(codebaseDir, file.name, file.content);
      }

      // Save design nodes from store: /[workspace]/Code/[projectName]/Designs/
      try {
        const designNodes = designNodesStore.get();
        
        // Clean up designs folder
        for await (const entry of (designsDir as any).values()) {
          if (entry.kind === 'file') {
            await designsDir.removeEntry(entry.name);
          }
        }

        for (const node of designNodes) {
          const baseName = node.fileName || `design_${node.id.split('-')[1] || Date.now()}`;
          const nameWithoutExt = baseName.replace(/\.[^/.]+$/, '');
          const codeFileName = `${nameWithoutExt}.tsx`;
          const metaFileName = `${nameWithoutExt}.json`;

          await writeFileRecursively(designsDir, codeFileName, node.code);

          const metaContent = JSON.stringify({
            id: node.id,
            prompt: node.prompt,
            layoutData: node.layoutData,
            customSize: node.customSize,
            timestamp: node.timestamp
          }, null, 2);
          await writeFileRecursively(designsDir, metaFileName, metaContent);
        }
      } catch {}

      return true;
    } catch (err) {
      return false;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Save general chat history locally
   */
  const saveLocalFSChat = useCallback(async (chatId: string, messages: any[], oldChatId?: string | null): Promise<boolean> => {
    const chatContent = JSON.stringify(messages, null, 2);

    // 1. Always save to localStorage immediately for instant persistence and fallback
    try {
      localStorage.setItem(`willow_chat_${chatId}`, chatContent);
      
      // Update the timestamp for the current chatId
      updateChatTimestamp(chatId, Date.now());
      if (oldChatId && oldChatId !== chatId) {
        try {
          const stored = localStorage.getItem('willow_chat_timestamps');
          if (stored) {
            const ts = JSON.parse(stored);
            delete ts[oldChatId];
            localStorage.setItem('willow_chat_timestamps', JSON.stringify(ts));
          }
        } catch {}
      }
      
      setLocalChats((prev) => {
        let next = prev;
        if (!prev.includes(chatId)) {
          next = [...prev, chatId];
        }
        if (oldChatId && oldChatId !== chatId) {
          next = next.filter((c) => c !== oldChatId);
          localStorage.removeItem(`willow_chat_${oldChatId}`);
        }
        const sorted = sortChatsNewestToOldest(next);
        localStorage.setItem('willow_local_chats', JSON.stringify(sorted));
        return sorted;
      });

      // Update activeChatId if it was null or matched the oldChatId
      setActiveChatId((prev) => {
        if (prev === null || prev === oldChatId) {
          return chatId;
        }
        return prev;
      });
    } catch (err) {
      console.error('Failed to save chat to localStorage', err);
    }

    // 2. Try saving to local file system if connected and authorized
    const rootHandle = await getActiveHandle();
    if (!rootHandle) {
      return true; // Succeeded in saving to browser storage!
    }

    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      const chatsDir = await workspaceDir.getDirectoryHandle('Chats', { create: true });
      
      // Write new file
      await writeFileRecursively(chatsDir, `${chatId}.json`, chatContent);
      
      // Delete old file if chatId changed from temporary ID
      if (oldChatId && oldChatId !== chatId) {
        try {
          await chatsDir.removeEntry(`${oldChatId}.json`);
        } catch {}
      }

      // Sync latest filesystem directory list
      try {
        const chats: string[] = [];
        for await (const entry of (chatsDir as any).values()) {
          if (entry.kind === 'file' && entry.name.endsWith('.json')) {
            chats.push(entry.name.slice(0, -5));
          }
        }
        
        setLocalChats((prev) => {
          const merged = Array.from(new Set([...prev, ...chats]));
          const sorted = sortChatsNewestToOldest(merged);
          localStorage.setItem('willow_local_chats', JSON.stringify(sorted));
          return sorted;
        });
      } catch {}

      return true;
    } catch (err) {
      return false;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Save codebase/design chat sessions of respective project locally
   */
  const saveLocalFSProjectChat = useCallback(async (projectName: string, chatId: string, messages: any[], oldChatId?: string | null): Promise<boolean> => {
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return false;

    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      const codeDir = await workspaceDir.getDirectoryHandle('Code', { create: true });
      const projectDir = await codeDir.getDirectoryHandle(projectName, { create: true });
      const chatSessionsDir = await projectDir.getDirectoryHandle('Chat sessions', { create: true });
      
      const chatContent = JSON.stringify(messages, null, 2);
      await writeFileRecursively(chatSessionsDir, `${chatId}.json`, chatContent);
      
      if (oldChatId && oldChatId !== chatId) {
        try {
          await chatSessionsDir.removeEntry(`${oldChatId}.json`);
        } catch {}
      }
      return true;
    } catch (err) {
      return false;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Save media creations locally
   */
  const saveLocalFSMedia = useCallback(async (projectName: string, kind: 'image' | 'video', fileName: string, blob: Blob): Promise<boolean> => {
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return false;

    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      const mediaDir = await workspaceDir.getDirectoryHandle('Media', { create: true });
      const projectDir = await mediaDir.getDirectoryHandle(projectName, { create: true });
      
      // Pre-create Scenes and Music directories
      await projectDir.getDirectoryHandle('Scenes', { create: true });
      await projectDir.getDirectoryHandle('Music', { create: true });
      
      // Write file to Images or Videos subfolder
      const subFolder = kind === 'image' ? 'Images' : 'Videos';
      const subDir = await projectDir.getDirectoryHandle(subFolder, { create: true });
      
      // If image kind, also pre-create "Characters" subfolder
      if (kind === 'image') {
        await subDir.getDirectoryHandle('Characters', { create: true });
      }

      // Dynamic file numbering collision check
      const lastDot = fileName.lastIndexOf('.');
      const baseName = lastDot !== -1 ? fileName.slice(0, lastDot) : fileName;
      const ext = lastDot !== -1 ? fileName.slice(lastDot) : '';

      let finalFileName = fileName;
      let counter = 1;
      let fileExists = true;

      while (fileExists) {
        try {
          // Check if file already exists in destination directory
          await subDir.getFileHandle(finalFileName, { create: false });
          // If this call succeeds, the file exists. Increment counter and try again.
          finalFileName = `${baseName} (${counter})${ext}`;
          counter++;
        } catch (e) {
          // If it throws, the file name is available!
          fileExists = false;
        }
      }

      const fileHandle = await subDir.getFileHandle(finalFileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      
      return true;
    } catch (err) {
      return false;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Generate a chat title using Gemini 3.1 Flash Lite based on the first turns
   */
  const generateChatTitle = useCallback(async (userMessage: string, assistantMessage: string): Promise<string> => {
    const apiKey = apiKeys?.gemini?.[0];
    if (!apiKey) return '';
    
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Summarize this chat starting message into a very short, concise, and clean file/folder name (maximum 5 to 6 words). Return ONLY the rephrased name itself, with no quotation marks, punctuation, file extension, or introduction.\n\nUser: ${userMessage}\nAssistant: ${assistantMessage}`
              }]
            }]
          })
        }
      );
      if (response.ok) {
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          return text.replace(/[\/:*?"<>|]/g, '').trim().slice(0, 80) || 'Untitled Chat';
        }
      }
    } catch (err) {
      // Ignored
    }
    return '';
  }, [apiKeys]);

  /**
   * Select local inbox chat
   */
  const selectLocalFSInboxChat = useCallback((chatId: string | null) => {
    setActiveChatId(chatId);
  }, []);

  /**
   * Load messages of a specific local chat
   */
  const loadLocalFSChat = useCallback(async (chatId: string): Promise<any[] | null> => {
    // 1. Try loading from localStorage first for instant load and offline backup
    try {
      const cached = localStorage.getItem(`willow_chat_${chatId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {}

    // 2. Fall back to loading from local file system if connected and authorized
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return null;

    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      const chatsDir = await workspaceDir.getDirectoryHandle('Chats', { create: true });
      const fileHandle = await chatsDir.getFileHandle(`${chatId}.json`);
      const file = await fileHandle.getFile();
      const content = await file.text();
      const parsed = JSON.parse(content);
      
      // Cache it back to localStorage
      try {
        localStorage.setItem(`willow_chat_${chatId}`, content);
      } catch {}
      
      return parsed;
    } catch (err) {
      return null;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Scan Chats folder and refresh lists
   */
  const refreshLocalChats = useCallback(async (): Promise<void> => {
    const rootHandle = directoryHandleRef.current;
    if (!rootHandle) return;

    try {
      const hasAccess = await verifyPermission(rootHandle, false, false);
      if (!hasAccess) return;

      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      const chatsDir = await workspaceDir.getDirectoryHandle('Chats', { create: true });
      
      // Read disk chats
      const diskChats: string[] = [];
      const timestamps = (() => {
        try {
          const stored = localStorage.getItem('willow_chat_timestamps');
          return stored ? JSON.parse(stored) : {};
        } catch { return {}; }
      })();
      let timestampsUpdated = false;

      for await (const entry of (chatsDir as any).values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json')) {
          const chatId = entry.name.slice(0, -5);
          diskChats.push(chatId);
          if (!timestamps[chatId]) {
            try {
              const file = await entry.getFile();
              timestamps[chatId] = file.lastModified;
              timestampsUpdated = true;
            } catch {}
          }
        }
      }

      if (timestampsUpdated) {
        localStorage.setItem('willow_chat_timestamps', JSON.stringify(timestamps));
      }

      // Get cached chats list
      let cachedChats: string[] = [];
      try {
        const stored = localStorage.getItem('willow_local_chats');
        cachedChats = stored ? JSON.parse(stored) : [];
      } catch {}

      // Auto-sync local-only chats to disk
      for (const chat of cachedChats) {
        if (!diskChats.includes(chat)) {
          try {
            const cachedContent = localStorage.getItem(`willow_chat_${chat}`);
            if (cachedContent) {
              await writeFileRecursively(chatsDir, `${chat}.json`, cachedContent);
              diskChats.push(chat);
            }
          } catch {}
        }
      }

      const sorted = sortChatsNewestToOldest(diskChats);
      setLocalChats(sorted);
      localStorage.setItem('willow_local_chats', JSON.stringify(sorted));
    } catch (err) {
      console.error('Error refreshing local chats', err);
    }
  }, [getSanitizedWorkspaceName]);

  /**
   * Delete a local chat file
   */
  const deleteLocalFSChat = useCallback(async (chatId: string): Promise<boolean> => {
    // 1. Delete from localStorage first
    try {
      localStorage.removeItem(`willow_chat_${chatId}`);
      
      // Delete timestamp
      try {
        const stored = localStorage.getItem('willow_chat_timestamps');
        if (stored) {
          const ts = JSON.parse(stored);
          delete ts[chatId];
          localStorage.setItem('willow_chat_timestamps', JSON.stringify(ts));
        }
      } catch {}

      setLocalChats((prev) => {
        const next = prev.filter((c) => c !== chatId);
        localStorage.setItem('willow_local_chats', JSON.stringify(next));
        return next;
      });
    } catch {}

    if (activeChatId === chatId) {
      setActiveChatId(null);
    }

    // 2. Try deleting from filesystem
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return true; // Succeeded in local cache deletion

    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      const chatsDir = await workspaceDir.getDirectoryHandle('Chats', { create: true });
      await chatsDir.removeEntry(`${chatId}.json`);
      return true;
    } catch (err) {
      return false;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName, activeChatId]);

  /**
   * Rename a local chat file
   */
  const renameLocalFSChat = useCallback(async (oldChatId: string, newChatId: string): Promise<boolean> => {
    // 1. Rename in localStorage first
    try {
      const cached = localStorage.getItem(`willow_chat_${oldChatId}`);
      if (cached) {
        localStorage.setItem(`willow_chat_${newChatId}`, cached);
        localStorage.removeItem(`willow_chat_${oldChatId}`);
      }

      // Move timestamp
      try {
        const stored = localStorage.getItem('willow_chat_timestamps');
        if (stored) {
          const ts = JSON.parse(stored);
          ts[newChatId] = ts[oldChatId] || Date.now();
          delete ts[oldChatId];
          localStorage.setItem('willow_chat_timestamps', JSON.stringify(ts));
        }
      } catch {}

      setLocalChats((prev) => {
        const next = prev.map((c) => (c === oldChatId ? newChatId : c));
        const sorted = sortChatsNewestToOldest(next);
        localStorage.setItem('willow_local_chats', JSON.stringify(sorted));
        return sorted;
      });
    } catch {}

    if (activeChatId === oldChatId) {
      setActiveChatId(newChatId);
    }

    // 2. Try renaming in filesystem
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return true; // Succeeded in local cache rename

    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      const chatsDir = await workspaceDir.getDirectoryHandle('Chats', { create: true });
      
      const fileHandle = await chatsDir.getFileHandle(`${oldChatId}.json`);
      const file = await fileHandle.getFile();
      const content = await file.text();
      
      await writeFileRecursively(chatsDir, `${newChatId}.json`, content);
      await chatsDir.removeEntry(`${oldChatId}.json`);
      return true;
    } catch (err) {
      return false;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName, activeChatId]);

  return (
    <LocalFSContext.Provider
      value={{
        isSupported,
        isLocalFolderConnected,
        isLocalFolderAuthorized,
        localFolderName,
        connectLocalFolder,
        disconnectLocalFolder,
        authorizeLocalFolder,
        saveLocalFSProject,
        saveLocalFSChat,
        saveLocalFSProjectChat,
        saveLocalFSMedia,
        generateChatTitle,
        localChats,
        activeChatId,
        selectLocalFSInboxChat,
        loadLocalFSChat,
        refreshLocalChats,
        deleteLocalFSChat,
        renameLocalFSChat,
        getChatTimestamp
      }}
    >
      {children}
    </LocalFSContext.Provider>
  );
};

export const useLocalFS = () => {
  const context = useContext(LocalFSContext);
  if (!context) {
    throw new Error('useLocalFS must be used within a LocalFSProvider');
  }
  return context;
};
