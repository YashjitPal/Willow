import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  isFSAAPISupported,
  storeDirectoryHandle,
  getStoredDirectoryHandle,
  removeStoredDirectoryHandle,
  verifyPermission,
  writeFileRecursively,
  readProjectManifest,
  writeProjectManifest
} from '../lib/localFileSystemService';
import { useAuth } from './AuthContext';
import { useUserDataContext } from './UserDataContext';
import { designNodesStore } from '../lib/stores/design-store';
import { loadProjectMedia, saveProjectMedia, deleteProjectData, saveProjectCover, loadProjectCover } from '../lib/mediaStorage';
import { extractVideoFrame } from '../lib/coverUtils';
import { saveChatBody, loadChatBody, deleteChatBody, renameChatBody } from '../lib/willowDB';

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
  return [...chats].sort((a, b) => {
    return getChatTimestamp(b) - getChatTimestamp(a);
  });
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
  saveLocalFSMedia: (projectName: string, kind: 'image' | 'video', fileName: string, blob: Blob) => Promise<string | null>;
  deleteLocalFSMediaFile: (projectName: string, kind: 'image' | 'video', fsName: string) => Promise<boolean>;
  renameLocalFSProject: (oldName: string, newName: string) => Promise<boolean>;
  saveLocalFSCover: (projectName: string, url: string) => Promise<boolean>;
  generateChatTitle: (userMessage: string, assistantMessage: string) => Promise<string>;
  localChats: string[];
  activeChatId: string | null;
  selectLocalFSInboxChat: (chatId: string | null) => void | Promise<void>;
  loadLocalFSChat: (chatId: string) => Promise<any[] | null>;
  refreshLocalChats: () => Promise<void>;
  refreshLocalMedia: (projectId: string, projectName: string) => Promise<any[]>;
  loadLocalFSMediaUrl: (projectName: string, kind: 'image' | 'video', fsName: string) => Promise<string | null>;
  deleteLocalFSChat: (chatId: string) => Promise<boolean>;
  deleteLocalFSProject: (projectId: string, projectName: string) => Promise<boolean>;
  renameLocalFSChat: (oldChatId: string, newChatId: string) => Promise<boolean>;
  getChatTimestamp: (chatId: string) => number;
  isInitializingLocalFS: boolean;
}

const LocalFSContext = createContext<LocalFSContextType | null>(null);

export const LocalFSProvider: React.FC<{ children: ReactNode, modelConfig?: any }> = ({ children, modelConfig }) => {
  const { user, userProfile } = useAuth();
  const { apiKeys } = useUserDataContext();
  const [isSupported] = useState(isFSAAPISupported);
  const [isInitializingLocalFS, setIsInitializingLocalFS] = useState(true);
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

  // chatId -> last local-save time. The disk poller uses this to avoid deleting a
  // chat that was just created/edited in the brief window before its .json hits
  // disk (a real-time-sync race guard).
  const recentChatWritesRef = useRef<Map<string, number>>(new Map());
  // Re-entrancy guard so overlapping disk polls don't stack up.
  const isPollingRef = useRef(false);
  // Cache of project folder name -> manifest id, so steady-state polling only
  // lists directories and doesn't re-read every .willow.json on every tick.
  const manifestIdCacheRef = useRef<Map<string, string>>(new Map());
  // Project ids whose IndexedDB cover we've already tried to hydrate from disk
  // this session (so we don't re-read cover.* on every poll).
  const coverHydratedRef = useRef<Set<string>>(new Set());

  const getSanitizedWorkspaceName = useCallback(() => {
    const name = userProfile?.workspaceName || (userProfile?.displayName ? `${userProfile.displayName.split(' ')[0]}'s Willow` : "My Willow");
    return name.replace(/[\/:*?"<>|]/g, '').trim() || 'My Willow';
  }, [userProfile]);

  // Resolve a project's stable id from the localStorage registry by its folder name.
  const getProjectIdByName = useCallback((projectName: string): string | null => {
    try {
      const stored = localStorage.getItem('willow_projects_list');
      if (stored) {
        const list = JSON.parse(stored) as { id: string; name: string }[];
        const found = list.find((p) => p.name === projectName);
        if (found?.id) return found.id;
      }
    } catch {}
    return null;
  }, []);

  // Ensure a project folder on disk carries a `.willow.json` manifest with its
  // stable id, so it is never re-assigned a fresh random id on re-discovery.
  const ensureProjectManifest = useCallback(async (projectDirHandle: FileSystemDirectoryHandle, projectName: string): Promise<void> => {
    try {
      const existing = await readProjectManifest(projectDirHandle);
      if (existing?.id) return; // already has a stable id
      const id = getProjectIdByName(projectName);
      if (id) {
        await writeProjectManifest(projectDirHandle, id);
      }
    } catch {}
  }, [getProjectIdByName]);

  // Full two-way reconciliation of the localStorage project registry against
  // what's actually on disk. DISK IS AUTHORITATIVE. This is the heart of the
  // real-time sync — it detects external creates, deletes, and renames:
  //   • new folder on disk            -> added to the registry
  //   • folder deleted on disk        -> removed from registry + IndexedDB
  //   • folder renamed on disk        -> registry entry renamed (id preserved
  //                                       via the .willow.json manifest)
  // Projects are matched by their stable manifest id (falling back to name), so
  // covers/media stay linked across renames. An `onDisk` flag marks registry
  // entries that came from disk, so browser-only projects (created in the UI but
  // not yet saved to a folder) are NEVER auto-deleted. A failed/blocked scan is
  // treated as "unknown" and performs no deletions, so a transient permission or
  // IO hiccup can never wipe the registry.
  const syncProjectsFromDisk = useCallback(async (workspaceDir: FileSystemDirectoryHandle): Promise<void> => {
    type Reg = { id: string; name: string; hasCover?: boolean; isStarred?: boolean; kind?: 'code' | 'media'; onDisk?: boolean };

    // Scan a parent folder. `ok` is false ONLY when the folder couldn't be read
    // (permission/IO error) — an empty-but-readable folder returns ok:true.
    const collectDirs = async (parentName: string): Promise<{ ok: boolean; map: Map<string, FileSystemDirectoryHandle> }> => {
      const map = new Map<string, FileSystemDirectoryHandle>();
      try {
        const parent = await workspaceDir.getDirectoryHandle(parentName, { create: true });
        for await (const entry of (parent as any).values()) {
          if (entry.kind === 'directory') {
            map.set(entry.name, entry as FileSystemDirectoryHandle);
          }
        }
        return { ok: true, map };
      } catch {
        return { ok: false, map };
      }
    };

    try {
      const code = await collectDirs('Code');
      const media = await collectDirs('Media');
      // Safety: if either scan failed, do nothing (never delete on uncertainty).
      if (!code.ok || !media.ok) return;

      // Read the current registry.
      let projectsList: Reg[] = [];
      try {
        const stored = localStorage.getItem('willow_projects_list');
        if (stored) projectsList = JSON.parse(stored);
      } catch {}
      if (!Array.isArray(projectsList)) projectsList = [];
      const nameToId = new Map<string, string>();
      for (const p of projectsList) if (p?.name && p?.id) nameToId.set(p.name, p.id);

      // Build the disk view (name -> {kind, handle}); Code wins if a name is in both.
      const diskByName = new Map<string, { name: string; kind: 'code' | 'media'; handle: FileSystemDirectoryHandle; id?: string }>();
      for (const [name, handle] of media.map) diskByName.set(name, { name, kind: 'media', handle });
      for (const [name, handle] of code.map) diskByName.set(name, { name, kind: 'code', handle });

      // Resolve a stable id for every disk folder. Prefer the manifest id; else
      // inherit the registry id for that name; else mint one. Persist it so the
      // id survives future renames/reconnects (keeps covers/media linked).
      // A name->id cache makes steady-state polls skip the per-folder file read.
      const cache = manifestIdCacheRef.current;
      const diskById = new Map<string, { name: string; kind: 'code' | 'media' }>();
      for (const info of diskByName.values()) {
        let id = cache.get(info.name) ?? null;
        if (!id) {
          id = (await readProjectManifest(info.handle))?.id ?? null;
          if (!id) {
            id = nameToId.get(info.name) ?? `#${Math.floor(1000 + Math.random() * 9000)}`;
            await writeProjectManifest(info.handle, id);
          }
          cache.set(info.name, id);
        }
        info.id = id;
        diskById.set(id, { name: info.name, kind: info.kind });
      }
      // Drop cache entries for folders that no longer exist on disk.
      for (const name of [...cache.keys()]) {
        if (!diskByName.has(name)) cache.delete(name);
      }

      let changed = false;
      const next: Reg[] = [];
      const consumed = new Set<string>(); // disk ids already mapped to a registry entry

      // Pass 1: reconcile existing registry entries against disk.
      for (const p of projectsList) {
        const byName = diskByName.get(p.name);
        const byId = p.id ? diskById.get(p.id) : undefined;
        const disk = byName ?? (byId ? { name: byId.name, kind: byId.kind, handle: undefined as any, id: p.id } : undefined);

        if (disk) {
          const diskId = byName?.id ?? p.id;
          if (diskId) consumed.add(diskId);
          const updated: Reg = { ...p, onDisk: true };
          // External rename: matched by id but the folder name changed -> adopt it.
          if (!byName && byId && updated.name !== byId.name) { updated.name = byId.name; changed = true; }
          if (updated.kind !== disk.kind) { updated.kind = disk.kind; changed = true; }
          if (!p.onDisk) changed = true;
          next.push(updated);
        } else if (p.onDisk) {
          // Was on disk, folder is gone, and its id isn't present anywhere on disk
          // -> genuinely deleted externally. Remove it and clean its IndexedDB data.
          changed = true;
          void deleteProjectData(p.id);
        } else {
          // Browser-only project (never saved to a folder) -> keep as-is.
          next.push(p);
        }
      }

      // Pass 2: add disk folders that no registry entry claimed (external creates).
      for (const info of diskByName.values()) {
        const id = info.id!;
        if (consumed.has(id)) continue;
        if (next.some(p => p.id === id || p.name === info.name)) continue;
        next.push({ id, name: info.name, kind: info.kind, onDisk: true });
        changed = true;
      }

      // Cover hydration: the UI reads covers from IndexedDB (project_covers,
      // keyed by project id). Make sure each media project has a durable, still
      // IMAGE cover there. Covers are always images — if the source is a video
      // (disk cover.mp4, a Videos/ file, or a video media item) we capture a
      // frame. Repairs missing, fragile (non-data:), AND legacy data:video covers.
      // Sources, in priority: disk cover.* -> oldest Images/ file -> oldest
      // Videos/ file (framed) -> oldest project_media item. When sourced from the
      // disk fallback (or a video), a canonical cover.png is written back.
      // Attempted at most once per project per session (coverHydratedRef).
      let coversChanged = false;
      const fileToDataURL = (file: File): Promise<string> => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const resolveDiskCover = async (projectDirHandle: any): Promise<{ file: File; explicit: boolean } | null> => {
        try {
          // 1. Explicit cover.* at the project root.
          for await (const entry of projectDirHandle.values()) {
            if (entry.kind === 'file' && /^cover\.(png|jpe?g|webp|mp4)$/i.test(entry.name)) {
              return { file: await entry.getFile(), explicit: true };
            }
          }
          // 2. Fallback: oldest file in Images/, then Videos/.
          for (const sub of ['Images', 'Videos']) {
            try {
              const subDir = await projectDirHandle.getDirectoryHandle(sub);
              let best: File | null = null;
              for await (const entry of (subDir as any).values()) {
                if (entry.kind !== 'file') continue;
                const f = await entry.getFile();
                if (!best || f.lastModified < best.lastModified) best = f;
              }
              if (best) return { file: best, explicit: false };
            } catch {}
          }
        } catch {}
        return null;
      };
      // Write a canonical still cover.png to disk (removing any other cover.* incl.
      // a stale cover.mp4), from a base64 image data URL.
      const writeDiskCoverPng = async (projectDirHandle: any, imageDataUrl: string) => {
        try {
          const blob = await fetch(imageDataUrl).then(r => r.blob());
          for (const nm of ['cover.jpg', 'cover.jpeg', 'cover.webp', 'cover.mp4']) {
            try { await projectDirHandle.removeEntry(nm); } catch {}
          }
          const fh = await projectDirHandle.getFileHandle('cover.png', { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
        } catch {}
      };
      for (const p of next) {
        if (p.kind !== 'media') continue;
        if (coverHydratedRef.current.has(p.id)) continue;
        coverHydratedRef.current.add(p.id);
        const existing = await loadProjectCover(p.id);
        // Skip only if we already have a durable still IMAGE. A data:video cover
        // (legacy) is intentionally reprocessed into a frame.
        if (existing && existing.startsWith('data:image')) continue;

        // Source 1: the project's disk folder (explicit cover.* or oldest file).
        const handle = p.onDisk ? media.map.get(p.name) : undefined;
        if (handle) {
          const resolved = await resolveDiskCover(handle);
          if (resolved) {
            const isVid = (resolved.file.type || '').startsWith('video');
            let imageUrl: string | null = isVid ? await extractVideoFrame(resolved.file) : await fileToDataURL(resolved.file);
            if (imageUrl) {
              await saveProjectCover(p.id, imageUrl);
              if (!p.hasCover) { p.hasCover = true; changed = true; }
              coversChanged = true;
              // Write a canonical cover.png when it came from a video frame or a
              // non-explicit fallback (i.e. there isn't already a still cover.*).
              if (isVid || !resolved.explicit) {
                await writeDiskCoverPng(handle, imageUrl);
              }
              continue;
            }
          }
        }

        // Source 2: no usable disk source — use the oldest completed media item
        // from IndexedDB (framing it if it's a video).
        try {
          const items = await loadProjectMedia(p.id);
          const completed = (Array.isArray(items) ? items : []).filter((m: any) => m?.status === 'completed' && m?.url);
          const firstGen = completed.reduce((oldest: any, m: any) =>
            (!oldest || (m.timestamp || 0) < (oldest.timestamp || 0)) ? m : oldest, null as any);
          if (firstGen?.url) {
            const imageUrl = firstGen.kind === 'video'
              ? (await extractVideoFrame(firstGen.url)) || null
              : firstGen.url;
            if (imageUrl) {
              await saveProjectCover(p.id, imageUrl); // inlines any external URL to base64
              if (!p.hasCover) { p.hasCover = true; changed = true; }
              coversChanged = true;
            }
          }
        } catch {}
      }

      if (changed) {
        localStorage.setItem('willow_projects_list', JSON.stringify(next));
      }
      if (changed || coversChanged) {
        window.dispatchEvent(new Event('willow_projects_updated'));
      }
    } catch (err) {
      console.error('Error reconciling projects with disk', err);
    }
  }, []);

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
                  const body = await loadChatBody(chat);
                  if (body) {
                    await writeFileRecursively(chatsDir, `${chat}.json`, JSON.stringify(body, null, 2));
                    diskChats.push(chat);
                  }
                } catch {}
              }
            }

            const sorted = sortChatsNewestToOldest(diskChats);
            setLocalChats(sorted);
            localStorage.setItem('willow_local_chats', JSON.stringify(sorted));

            // Recover & re-tag projects from disk (self-healing registry).
            await syncProjectsFromDisk(workspaceDir);
          } else {
            setIsLocalFolderAuthorized(false);
          }
        } catch {
          setIsLocalFolderAuthorized(false);
        }
      }
      setIsInitializingLocalFS(false);
    };

    restoreConnection();
  }, [isSupported, getSanitizedWorkspaceName, syncProjectsFromDisk]);

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
              const body = await loadChatBody(chat);
              if (body) {
                await writeFileRecursively(chatsDir, `${chat}.json`, JSON.stringify(body, null, 2));
                diskChats.push(chat);
              }
            } catch {}
          }
        }

        const sorted = sortChatsNewestToOldest(diskChats);
        setLocalChats(sorted);
        localStorage.setItem('willow_local_chats', JSON.stringify(sorted));

        // Recover & re-tag projects from disk (self-healing registry).
        await syncProjectsFromDisk(workspaceDir);
      } catch (err) {
        console.error('Error syncing chats to connected folder', err);
      }

      return true;
    } catch (err) {
      return false;
    }
  }, [isSupported, getSanitizedWorkspaceName, syncProjectsFromDisk]);

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
                const body = await loadChatBody(chat);
                if (body) {
                  await writeFileRecursively(chatsDir, `${chat}.json`, JSON.stringify(body, null, 2));
                  diskChats.push(chat);
                }
              } catch {}
            }
          }

          const sorted = sortChatsNewestToOldest(diskChats);
          setLocalChats(sorted);
          localStorage.setItem('willow_local_chats', JSON.stringify(sorted));

          // Recover & re-tag projects from disk (self-healing registry).
          await syncProjectsFromDisk(workspaceDir);

        } catch (err) {
          console.error('Error syncing chats during authorization', err);
        }
        return true;
      }
    } catch {}
    return false;
  }, [getSanitizedWorkspaceName, syncProjectsFromDisk]);

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
      
      // Persist the stable project id alongside the code so re-discovery keeps it.
      await ensureProjectManifest(projectDir, projectName);

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

    // Mark this chat as just-written so the disk poller won't delete it in the
    // window before its .json reaches disk.
    recentChatWritesRef.current.set(chatId, Date.now());

    // 1. Always save the body to IndexedDB immediately for instant, quota-free persistence
    try {
      await saveChatBody(chatId, messages);
      // Update the timestamp for the current chatId ONLY if it is a new chat (oldChatId !== null)
      // or if it's a genuine edit. If it's just being opened, we don't want to bump the timestamp
      // to Date.now() which would send it to the top of the sidebar.
      // We know it's a genuine new save if `oldChatId` is provided (renaming from temp to real title),
      // OR if we are updating an existing chat with actual messages (not just the initial [] array).
      if (oldChatId !== undefined || (messages && messages.length > 0)) {
         updateChatTimestamp(chatId, Date.now());
      }
      
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
          void deleteChatBody(oldChatId);
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
      console.error('Failed to save chat body', err);
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
  const saveLocalFSMedia = useCallback(async (projectName: string, kind: 'image' | 'video', fileName: string, blob: Blob): Promise<string | null> => {
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return null;

    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      const mediaDir = await workspaceDir.getDirectoryHandle('Media', { create: true });
      const projectDir = await mediaDir.getDirectoryHandle(projectName, { create: true });
      
      // Persist the stable project id alongside the media so re-discovery keeps it.
      await ensureProjectManifest(projectDir, projectName);

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

      return finalFileName;
    } catch (err) {
      return null;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Read a single media file from a project's Images/ or Videos/ folder on disk
   * and return a streaming blob: URL for display. The CALLER OWNS the returned
   * URL and must URL.revokeObjectURL() it when done (e.g. on project change /
   * unmount) to avoid leaks. Returns null if the folder/permission/file is
   * unavailable. This is the disk-as-source read path: heavy bytes live on disk,
   * not in IndexedDB, and are streamed via blob URLs.
   */
  const loadLocalFSMediaUrl = useCallback(async (projectName: string, kind: 'image' | 'video', fsName: string): Promise<string | null> => {
    if (!projectName || !fsName) return null;
    const handle = directoryHandleRef.current;
    if (!handle) return null;
    try {
      const hasAccess = await verifyPermission(handle, false, false);
      if (!hasAccess) return null;
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await handle.getDirectoryHandle(workspaceName, { create: true });
      const mediaDir = await workspaceDir.getDirectoryHandle('Media', { create: true });
      const projectDir = await mediaDir.getDirectoryHandle(projectName, { create: true });
      const subDir = await projectDir.getDirectoryHandle(kind === 'image' ? 'Images' : 'Videos');
      const fileHandle = await subDir.getFileHandle(fsName);
      const file = await fileHandle.getFile();
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }, [getSanitizedWorkspaceName]);

  /**
   * Delete a single media file from a project's Images/ or Videos/ folder on
   * disk. Used by in-app media-item deletion so the file is actually removed
   * (and the real-time poller won't re-ingest it). No-op if no folder/permission.
   */
  const deleteLocalFSMediaFile = useCallback(async (projectName: string, kind: 'image' | 'video', fsName: string): Promise<boolean> => {
    if (!projectName || !fsName) return false;
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return false;
    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      const mediaDir = await workspaceDir.getDirectoryHandle('Media', { create: true });
      const projectDir = await mediaDir.getDirectoryHandle(projectName, { create: true });
      const subDir = await projectDir.getDirectoryHandle(kind === 'image' ? 'Images' : 'Videos', { create: true });
      await subDir.removeEntry(fsName);
      return true;
    } catch (err) {
      return false;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Rename a project folder on disk so it stays in lock-step with a UI rename
   * (otherwise the disk-authoritative reconciler would revert the new name).
   * Renames in Code/ and/or Media/ — wherever the project lives. Uses the native
   * FileSystemHandle.move() when available, falling back to a safe recursive
   * copy-then-delete (the original is only removed AFTER a complete copy, so an
   * interrupted rename can never lose data). The .willow.json manifest travels
   * with the folder, preserving the project id (and thus its covers/media).
   */
  const renameLocalFSProject = useCallback(async (oldName: string, newName: string): Promise<boolean> => {
    if (!oldName || !newName || oldName === newName) return false;
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return false;

    const copyDir = async (src: any, dst: any): Promise<void> => {
      for await (const entry of src.values()) {
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          const fh = await dst.getFileHandle(entry.name, { create: true });
          const w = await fh.createWritable();
          await w.write(await file.arrayBuffer());
          await w.close();
        } else if (entry.kind === 'directory') {
          const sub = await dst.getDirectoryHandle(entry.name, { create: true });
          await copyDir(entry, sub);
        }
      }
    };

    const renameIn = async (parent: FileSystemDirectoryHandle): Promise<boolean> => {
      let oldHandle: any;
      try {
        oldHandle = await parent.getDirectoryHandle(oldName);
      } catch {
        return false; // project doesn't live in this parent
      }
      // Prefer a native move/rename (Chromium) — atomic and instant.
      if (typeof oldHandle.move === 'function') {
        try { await oldHandle.move(newName); return true; } catch {}
      }
      // Fallback: full recursive copy, THEN delete the original.
      const newHandle = await parent.getDirectoryHandle(newName, { create: true });
      await copyDir(oldHandle, newHandle);
      await parent.removeEntry(oldName, { recursive: true });
      return true;
    };

    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      let renamed = false;
      for (const parentName of ['Code', 'Media']) {
        try {
          const parent = await workspaceDir.getDirectoryHandle(parentName, { create: true });
          const ok = await renameIn(parent);
          renamed = renamed || ok;
        } catch {}
      }
      // Invalidate the cached id for the old folder name; the new name is read fresh.
      manifestIdCacheRef.current.delete(oldName);
      return renamed;
    } catch (err) {
      console.error('Error renaming project folder', err);
      return false;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Save a project cover image to disk at Media/<projectName>/cover.<ext>,
   * a sibling of the Images/ and Videos/ folders (NOT inside them). Accepts a
   * data URL or any fetchable URL; the body is read into a Blob and written.
   */
  const saveLocalFSCover = useCallback(async (projectName: string, url: string): Promise<boolean> => {
    const rootHandle = await getActiveHandle();
    if (!rootHandle || !url) return false;

    try {
      const response = await fetch(url);
      const blob = await response.blob();

      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      const mediaDir = await workspaceDir.getDirectoryHandle('Media', { create: true });
      const projectDir = await mediaDir.getDirectoryHandle(projectName, { create: true });
      await ensureProjectManifest(projectDir, projectName);

      // Pick an extension from the blob's mime type (default png for image covers).
      const ext = blob.type === 'image/jpeg' ? 'jpg'
        : blob.type === 'image/webp' ? 'webp'
        : blob.type === 'video/mp4' ? 'mp4'
        : 'png';

      // Keep a single cover.* at the project root: remove any stale variants.
      for (const name of ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp', 'cover.mp4']) {
        if (name === `cover.${ext}`) continue;
        try { await projectDir.removeEntry(name); } catch {}
      }

      const fileHandle = await projectDir.getFileHandle(`cover.${ext}`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      return true;
    } catch (err) {
      return false;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName, ensureProjectManifest]);

  /**
   * Generate a chat title using the user's default chat naming model
   */
  const generateChatTitle = useCallback(async (userMessage: string, assistantMessage: string): Promise<string> => {
    // 1. Resolve which model the user has selected for Chat Naming
    const chatNamingSelectionId = modelConfig?.systemDefaults?.chatRenaming || 'gemini-3-flash-preview';
    
    // 2. Look it up across all providers to get the provider + API key
    const allModels = [
      ...(modelConfig?.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' as const })),
      ...(modelConfig?.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' as const })),
      ...(modelConfig?.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' as const })),
    ];
    
    let targetProvider = 'gemini';
    let targetModelId = 'gemini-3-flash-preview';
    
    // If it's the exact default string, we know what it is
    if (chatNamingSelectionId === 'gemini-3-flash-preview') {
      targetProvider = 'gemini';
      targetModelId = 'gemini-3-flash-preview';
    } else if (chatNamingSelectionId === 'claude-sonnet-4.5') {
        targetProvider = 'anthropic';
        targetModelId = 'claude-sonnet-4.5';
    } else {
        // It's a custom saved model
        const sel = allModels.find((m) => m.modelId === chatNamingSelectionId);
        if (sel) {
          targetProvider = sel.provider;
          targetModelId = sel.modelId;
        }
    }
    
    const apiKey = apiKeys?.[targetProvider]?.[0];
    if (!apiKey) return ''; // Cannot generate if the target provider has no key
    
    try {
      if (targetProvider === 'gemini') {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${targetModelId}:generateContent?key=${apiKey}`,
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
      } else if (targetProvider === 'openai') {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: targetModelId,
              messages: [{
                role: 'user',
                content: `Summarize this chat starting message into a very short, concise, and clean file/folder name (maximum 5 to 6 words). Return ONLY the rephrased name itself, with no quotation marks, punctuation, file extension, or introduction.\n\nUser: ${userMessage}\nAssistant: ${assistantMessage}`
              }]
            })
          });
          if (response.ok) {
              const data = await response.json();
              const text = data?.choices?.[0]?.message?.content?.trim();
              if (text) {
                  return text.replace(/[\/:*?"<>|]/g, '').trim().slice(0, 80) || 'Untitled Chat';
              }
          }
      } else if (targetProvider === 'anthropic') {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-cors-bypass': 'true'
              },
              body: JSON.stringify({
                model: targetModelId,
                max_tokens: 50,
                messages: [{
                  role: 'user',
                  content: `Summarize this chat starting message into a very short, concise, and clean file/folder name (maximum 5 to 6 words). Return ONLY the rephrased name itself, with no quotation marks, punctuation, file extension, or introduction.\n\nUser: ${userMessage}\nAssistant: ${assistantMessage}`
                }]
              })
            });
            if (response.ok) {
                const data = await response.json();
                const text = data?.content?.[0]?.text?.trim();
                if (text) {
                    return text.replace(/[\/:*?"<>|]/g, '').trim().slice(0, 80) || 'Untitled Chat';
                }
            }
      }
    } catch (err) {
      // Ignored
    }
    return '';
  }, [apiKeys, modelConfig]);

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
    // 1. Try loading from IndexedDB first (migrates any legacy localStorage body)
    try {
      const cached = await loadChatBody(chatId);
      if (cached) {
        return cached;
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

      // Cache it back to IndexedDB
      await saveChatBody(chatId, parsed);

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

      // Reconcile cache against disk. A chat in the cache but not on disk was
      // either (a) just created and hasn't hit disk yet, or (b) deleted on disk.
      // We only treat it as a real external delete if it WASN'T written locally
      // in the last grace window — otherwise we keep it (and keep it visible) so
      // the real-time poller can't race-delete a chat mid-creation.
      const GRACE_MS = 20000;
      const now = Date.now();
      const validDiskChats = new Set(diskChats);
      const keepPending: string[] = [];
      for (const chat of cachedChats) {
        if (validDiskChats.has(chat)) continue;
        const recentlyWritten = (recentChatWritesRef.current.get(chat) ?? 0) > now - GRACE_MS;
        if (recentlyWritten) {
          // Created/edited very recently — assume it's still flushing to disk.
          keepPending.push(chat);
          continue;
        }
        // Genuinely gone from disk -> remove its body + timestamp.
        try {
          void deleteChatBody(chat);
          const tsStr = localStorage.getItem('willow_chat_timestamps');
          if (tsStr) {
            const tsObj = JSON.parse(tsStr);
            if (tsObj[chat]) {
              delete tsObj[chat];
              localStorage.setItem('willow_chat_timestamps', JSON.stringify(tsObj));
            }
          }
        } catch {}
      }

      // Prune stale grace entries so the map can't grow unbounded.
      for (const [id, ts] of recentChatWritesRef.current) {
        if (ts <= now - GRACE_MS) recentChatWritesRef.current.delete(id);
      }

      const sorted = sortChatsNewestToOldest([...diskChats, ...keepPending]);
      // Only update state/storage when the list actually changed, so the 3s
      // poll doesn't re-render the sidebar on every idle tick.
      setLocalChats(prev => {
        const same = prev.length === sorted.length && prev.every((c, i) => c === sorted[i]);
        if (same) return prev;
        localStorage.setItem('willow_local_chats', JSON.stringify(sorted));
        return sorted;
      });
    } catch (err) {
      console.error('Error refreshing local chats', err);
    }
  }, [getSanitizedWorkspaceName]);

  /**
   * Scan Media folder and sync with IndexedDB
   */
  // Reconcile a project's media list against its on-disk files. DISK IS THE
  // SOURCE OF TRUTH for which media exists. Keyed in IndexedDB by `projectId`;
  // the disk folder is found by `projectName`. Returns lightweight metadata
  // (disk-backed items have NO bytes — `url:''`; the caller hydrates a streaming
  // blob: URL from disk via loadLocalFSMediaUrl). Browser-only items (not yet on
  // disk: in-progress, failed, or generated before a folder was connected) keep
  // their base64 url. Items previously on disk whose file is now gone are dropped
  // (external delete reflected). Persists the reconciled metadata by projectId.
  const refreshLocalMedia = useCallback(async (projectId: string, projectName: string): Promise<any[]> => {
    const rootHandle = directoryHandleRef.current;
    if (!rootHandle) return await loadProjectMedia(projectId);

    try {
      const hasAccess = await verifyPermission(rootHandle, false, false);
      if (!hasAccess) return await loadProjectMedia(projectId);

      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });
      const mediaDir = await workspaceDir.getDirectoryHandle('Media', { create: true });
      const projectDir = await mediaDir.getDirectoryHandle(projectName, { create: true });

      const dbMedia = (await loadProjectMedia(projectId)) || [];
      const onDisk: any[] = [];
      const consumedDbIds = new Set<string>();

      const scanFolder = async (folderName: string, kind: 'image' | 'video') => {
        try {
          const subDir = await projectDir.getDirectoryHandle(folderName);
          for await (const entry of (subDir as any).values()) {
            if (entry.kind !== 'file') continue;
            const fsName = entry.name as string;
            const dot = fsName.lastIndexOf('.');
            const baseName = dot !== -1 ? fsName.slice(0, dot) : fsName;
            let matchName = baseName;
            const suffixMatch = baseName.match(/ \(\d+\)$/);
            if (suffixMatch) {
              matchName = baseName.substring(0, suffixMatch.index);
            }
            
            // Match to existing metadata by filename, else by prompt (legacy).
            let existing = dbMedia.find((m: any) => m.fsName === fsName)
              || dbMedia.find((m: any) => !consumedDbIds.has(m.id) && (m.shortenedPrompt === matchName || m.prompt === matchName));
            if (existing) {
              consumedDbIds.add(existing.id);
              // Keep metadata, mark disk-backed, drop bytes (hydrated on display).
              onDisk.push({ ...existing, kind, fsName, isSavedToFS: true, status: 'completed', url: '' });
            } else {
              // A file added externally (e.g. dropped into the folder).
              let ts = 0;
              try { ts = (await entry.getFile()).lastModified; } catch {}
              onDisk.push({
                id: `disk_${kind}_${fsName}`,
                kind, status: 'completed', url: '',
                prompt: matchName, shortenedPrompt: matchName,
                modelId: 'external', modelName: 'External Source', ratio: '16:9',
                timestamp: ts, isSavedToFS: true, fsName,
              });
            }
          }
        } catch {}
      };

      await scanFolder('Images', 'image');
      await scanFolder('Videos', 'video');

      // Keep any item not matched to a disk file UNLESS it's a disk-backed item
      // whose bytes are gone (stripped url + isSavedToFS + file missing = a real
      // external delete). Items that still carry their bytes (a base64 `url`) or
      // were never on disk (in-progress / failed / pre-folder) are preserved —
      // we never discard media we still hold.
      const leftover = dbMedia.filter((m: any) =>
        !consumedDbIds.has(m?.id) && (!!m?.url || !m?.isSavedToFS)
      );

      // De-dup (cleans up historical pileups, e.g. the same file scanned many
      // times by the old reconciler). Disk-backed items are pushed first, so the
      // disk copy wins for a given file. Key by disk filename, else by id.
      const seen = new Set<string>();
      const deduped = [...onDisk, ...leftover].filter((m: any) => {
        const key = m?.fsName ? `fs:${m.kind}:${m.fsName}` : `id:${m?.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const merged = deduped.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      await saveProjectMedia(projectId, merged); // strips disk-backed bytes
      return merged;
    } catch (err) {
      console.error('Error refreshing local media', err);
      return await loadProjectMedia(projectId);
    }
  }, [getSanitizedWorkspaceName]);

  /**
   * Poll the workspace once: reconcile projects + chats against disk. Used by the
   * real-time watcher below and on focus/visibility changes. Re-entrancy guarded.
   */
  const pollDiskNow = useCallback(async (): Promise<void> => {
    if (isPollingRef.current) return;
    const handle = directoryHandleRef.current;
    if (!handle) return;
    isPollingRef.current = true;
    try {
      const hasAccess = await verifyPermission(handle, false, false);
      if (!hasAccess) return;
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await handle.getDirectoryHandle(workspaceName, { create: true });
      await syncProjectsFromDisk(workspaceDir);
      await refreshLocalChats();
    } catch {
      // transient — next tick will retry
    } finally {
      isPollingRef.current = false;
    }
  }, [getSanitizedWorkspaceName, syncProjectsFromDisk, refreshLocalChats]);

  // Real-time disk watcher.
  // PRIMARY: FileSystemObserver (recent Chromium) gives true change events — when
  // anything under the workspace changes on disk we reconcile (debounced) and
  // broadcast `willow_disk_changed` so the media gallery can refresh too.
  // FALLBACK / BACKSTOP: a timer poll (rare when the observer is active, normal
  // cadence when it isn't) plus an immediate reconcile on focus/visibility — so it
  // works everywhere and can't miss a change. Our own writes only flip IndexedDB
  // (not the disk reconcile), so this can't loop.
  useEffect(() => {
    if (!isSupported || !isLocalFolderConnected || !isLocalFolderAuthorized) return;

    let observer: any = null;
    let intervalId: number | undefined;
    let debounceTimer: number | undefined;
    let disposed = false;

    const fireMediaChanged = () => { try { window.dispatchEvent(new Event('willow_disk_changed')); } catch {} };

    const debouncedReconcile = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => { void pollDiskNow(); fireMediaChanged(); }, 500);
    };

    const onFocus = () => { void pollDiskNow(); fireMediaChanged(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') { void pollDiskNow(); fireMediaChanged(); } };

    (async () => {
      void pollDiskNow(); // sync immediately on connect/mount

      const handle = directoryHandleRef.current;
      let observing = false;
      const hasObserver = typeof (window as any).FileSystemObserver === 'function';
      if (handle && hasObserver) {
        try {
          const hasAccess = await verifyPermission(handle, false, false);
          if (hasAccess && !disposed) {
            const workspaceName = getSanitizedWorkspaceName();
            const workspaceDir = await handle.getDirectoryHandle(workspaceName, { create: true });
            observer = new (window as any).FileSystemObserver(() => debouncedReconcile());
            await observer.observe(workspaceDir, { recursive: true });
            observing = true;
          }
        } catch {
          observing = false;
          try { observer?.disconnect(); } catch {}
          observer = null;
        }
      }
      if (disposed) { try { observer?.disconnect(); } catch {} return; }

      // Backstop interval — slow when the observer is active (just a safety net),
      // normal cadence when there's no observer support.
      const period = observing ? 30000 : (document.visibilityState === 'visible' ? 3000 : 20000);
      intervalId = window.setInterval(() => { void pollDiskNow(); }, period);
    })();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);

    return () => {
      disposed = true;
      if (debounceTimer) window.clearTimeout(debounceTimer);
      if (intervalId) window.clearInterval(intervalId);
      try { observer?.disconnect(); } catch {}
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [isSupported, isLocalFolderConnected, isLocalFolderAuthorized, pollDiskNow, getSanitizedWorkspaceName]);

  /**
   * Delete a local chat file
   */
  const deleteLocalFSChat = useCallback(async (chatId: string): Promise<boolean> => {
    // 1. Delete the body from IndexedDB first
    try {
      await deleteChatBody(chatId);

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

  const deleteLocalFSProject = useCallback(async (projectId: string, projectName: string): Promise<boolean> => {
    // Try deleting project folder from filesystem
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return true; // No filesystem connected, just browser storage delete

    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName, { create: true });

      // Try deleting from both Media/ and Code/ folders
      for (const folderName of ['Media', 'Code']) {
        try {
          const folderDir = await workspaceDir.getDirectoryHandle(folderName, { create: false });
          await folderDir.removeEntry(projectName, { recursive: true });
          console.log(`Deleted project folder: ${folderName}/${projectName}`);
          return true;
        } catch (err) {
          // Project not in this folder, try the next one
        }
      }

      // If we get here, project wasn't found in either folder
      console.warn(`Project folder not found on disk: ${projectName}`);
      return true; // Still return true since browser storage will be deleted
    } catch (err) {
      console.error('Failed to delete project from filesystem:', err);
      return false;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Rename a local chat file
   */
  const renameLocalFSChat = useCallback(async (oldChatId: string, newChatId: string): Promise<boolean> => {
    // Mark both ids as just-written so the disk poller won't delete them mid-rename.
    recentChatWritesRef.current.set(oldChatId, Date.now());
    recentChatWritesRef.current.set(newChatId, Date.now());
    // 1. Rename the body in IndexedDB first
    try {
      await renameChatBody(oldChatId, newChatId);

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
        deleteLocalFSMediaFile,
        renameLocalFSProject,
        saveLocalFSCover,
        generateChatTitle,
        localChats,
        activeChatId,
        selectLocalFSInboxChat,
        loadLocalFSChat,
        refreshLocalChats,
        refreshLocalMedia,
        loadLocalFSMediaUrl,
        deleteLocalFSChat,
        deleteLocalFSProject,
        renameLocalFSChat,
        getChatTimestamp,
        isInitializingLocalFS
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
