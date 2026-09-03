import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  isFSAAPISupported,
  storeDirectoryHandle,
  getStoredDirectoryRecord,
  removeStoredDirectoryHandle,
  verifyPermission,
  writeFileRecursively,
  readFilesRecursively,
  readProjectManifest,
  writeProjectManifest
} from '../adapters/local-disk';
import { useAuth } from '@willow/auth/AuthContext';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { compareMediaItemsNewestFirst, loadProjectMedia, saveProjectMedia, deleteProjectData, saveProjectCover, loadProjectCover, migrateProjectKinds, setMediaStorageScope } from '../media-storage';
import { extractVideoFrame } from '../covers';
import {
  saveChatBody,
  loadChatBody,
  hasChatBody,
  deleteChatBody,
  renameChatBody,
  renameCodeSessions,
  deleteCodeSessions,
  setCodeSessionStorageScope,
  saveChatAttachment,
  loadChatAttachment,
  type ChatStorageScope,
  type StoredChatAttachment,
} from '../indexeddb/willow-db';
import type { ChatAttachment } from '@willow/core/attachments';
import { isActiveProjectRegistryStorageKey, isProjectSaveBlocked, markProjectDeleted, readProjectRegistry, setProjectStorageScope, writeProjectRegistry } from '@willow/projects/registry';
import {
  adoptChatIntoNotebook,
  deriveNotebookFolderName,
  ensureNotebookFolderName,
  readNotebookChatIndex,
  readNotebooks,
  setNotebookFolderName,
  setNotebookSourceFsName,
  setNotebookStorageScope,
} from '@willow/notebooks/notebooks-backend';
import {
  LEGACY_CHAT_KEYS,
  LEGACY_CHAT_MIGRATION_KEY,
  chatMetadataKeysForScope,
  isValidChatId,
  mergeSyncRecords,
  parseTempIdTimestamp,
  readJSON,
  sortChatsNewestToOldest,
  validateChatList,
  validateSyncRecords,
  validateTimestampMap,
  type ChatMetadataKeys,
  type ChatSyncRecord,
} from './chat-metadata';

// Re-exported so this module's public surface is unchanged: ChatView and the
// shell Sidebar import isTempChatId from here.
export { isTempChatId, parseTempIdTimestamp, sortChatsNewestToOldest } from './chat-metadata';
import { generateChatDescriptionWith, generateChatTitleWith } from './chat-title';
import { bumpChatSelectionEpoch } from './chat-selection-store';
import { ensureProjectManifest, getProjectIdByName } from './project-manifest';
import { getSyncedFolders } from '../synced-folders';
import { syncRegisteredFolder } from './synced-folder-driver';
import { getProjectAreas, getProjectAreaFolder, type LocalProjectKind } from './project-areas';
import {
  deleteMediaFileFromDisk,
  renameMediaFileOnDisk,
  saveMediaFileToDisk,
  saveProjectCoverToDisk,
} from './media-disk';
import {
  saveProjectChatToDisk,
  saveProjectFilesToDisk,
  type FileContent,
} from './code-disk';
import { saveDesignProjectToDisk } from './design-disk';
import {
  dataUrlToBlob,
  deleteNotebookFolder,
  deleteNotebookSourceFromDisk,
  ensureNotebookDir,
  ensureNotebookDirIn,
  moveFileBetweenDirs,
  openNotebookChatsDir,
  renameNotebookFolder,
  saveNotebookSourceToDisk,
  type NotebookSourcePayload,
} from './notebooks-disk';
import {
  deleteSavedInfoFromDisk,
  readSavedInfoFromDisk,
  writeSavedInfoToDisk,
} from './saved-info-disk';
import { attachSavedInfoDisk } from '@willow/core/saved-info-store';
import {
  deleteProfileFromDisk,
  readProfileFromDisk,
  writeProfileToDisk,
} from './personal-profile-disk';
import {
  attachPersonalRuntime,
  attachProfileDisk,
  detachPersonalRuntime,
  schedulePersonalBuild,
  type ProfileState,
} from '@willow/personal';
import { resolveAutoModel, type AutoSelectProvider } from '@willow/ai/models/auto-select';


interface LocalFSContextType {
  chatScopeId: string;
  isSupported: boolean;
  isLocalFolderConnected: boolean;
  isLocalFolderAuthorized: boolean;
  localFolderName: string | null;
  connectLocalFolder: () => Promise<boolean>;
  disconnectLocalFolder: () => Promise<void>;
  authorizeLocalFolder: () => Promise<boolean>;
  saveLocalFSProject: (projectName: string, files: FileContent[]) => Promise<boolean>;
  saveLocalFSDesignProject: (projectName: string, files: FileContent[]) => Promise<boolean>;
  loadLocalFSProject: (projectName: string) => Promise<FileContent[] | null>;
  saveLocalFSChat: (chatId: string, messages: any[], oldChatId?: string | null) => Promise<boolean>;
  saveLocalFSChatAttachment: (attachment: ChatAttachment, blob: Blob) => Promise<boolean>;
  loadLocalFSChatAttachment: (attachmentId: string) => Promise<StoredChatAttachment | null>;
  saveLocalFSProjectChat: (projectName: string, chatId: string, messages: any[], oldChatId?: string | null) => Promise<boolean>;
  saveLocalFSMedia: (projectName: string, kind: 'image' | 'video' | 'audio', fileName: string, blob: Blob) => Promise<string | null>;
  deleteLocalFSMediaFile: (projectName: string, kind: 'image' | 'video' | 'audio', fsName: string) => Promise<boolean>;
  renameLocalFSMediaFile: (projectName: string, kind: 'image' | 'video' | 'audio', oldFsName: string, newBaseName: string) => Promise<string | null>;
  /*
   * Notebooks on disk: `Notebooks/<name>/{Sources,Chats}`. Addressed by notebook
   * id, never by folder name — the folder name is stored on the notebook and
   * resolved in here, so no caller can derive a name that disagrees with the one
   * the folder actually has.
   */
  ensureLocalFSNotebookDir: (notebookId: string) => Promise<boolean>;
  saveLocalFSNotebookSource: (notebookId: string, payload: NotebookSourcePayload) => Promise<string | null>;
  deleteLocalFSNotebookSource: (notebookId: string, fsName: string) => Promise<boolean>;
  /** Call after the title has been committed, and only if it actually changed. */
  renameLocalFSNotebookFolder: (notebookId: string) => Promise<string | null>;
  /** Refuses while the notebook's `Chats/` still holds files. */
  deleteLocalFSNotebookFolder: (notebookId: string) => Promise<boolean>;
  /**
   * Move a chat's file into a notebook's `Chats/`, or back to the global one with
   * `null`. The disk half of filing; the registry half belongs to the notebooks
   * store, and `useNotebookDisk` does both.
   */
  moveLocalFSChatToNotebook: (chatId: string, notebookId: string | null) => Promise<boolean>;
  renameLocalFSProject: (oldName: string, newName: string) => Promise<boolean>;
  saveLocalFSCover: (projectName: string, url: string) => Promise<boolean>;
  generateChatTitle: (userMessage: string, assistantMessage?: string) => Promise<string>;
  generateChatDescription: (userMessage: string, assistantMessage?: string) => Promise<string>;
  localChats: string[];
  activeChatId: string | null;
  selectLocalFSInboxChat: (chatId: string | null) => void | Promise<void>;
  loadLocalFSChat: (chatId: string) => Promise<any[] | null>;
  refreshLocalChats: () => Promise<void>;
  refreshLocalMedia: (projectId: string, projectName: string, liveItems?: any[]) => Promise<any[]>;
  loadLocalFSMediaUrl: (projectName: string, kind: 'image' | 'video' | 'audio', fsName: string) => Promise<string | null>;
  deleteLocalFSChat: (chatId: string) => Promise<boolean>;
  deleteLocalFSProject: (projectId: string, projectName: string) => Promise<boolean>;
  renameLocalFSChat: (oldChatId: string, newChatId: string) => Promise<boolean>;
  getChatTimestamp: (chatId: string) => number;
  isInitializingLocalFS: boolean;
  /*
   * True once the chat registry has been read out of localStorage for the
   * current scope — i.e. the moment the Recents list is renderable.
   *
   * This is deliberately NOT `!isInitializingLocalFS`. That flag means "the
   * whole local-FS restore has settled", which includes verifying folder
   * permission, walking every chat file on disk, and re-scanning projects —
   * none of which the sidebar list needs. Chat titles ARE the filenames and the
   * ordering comes from the timestamp index, so the list is complete and
   * correct straight out of localStorage; the disk walk only corrects it if
   * something changed outside the app. Gating the list on the walk is what made
   * Recents show up seconds after the nav rows above it.
   *
   * Monotonic: once true it stays true, including across a scope switch. The
   * switch clears `localChats` and `activateChatScope` refills it in the same
   * pass, so flipping this back to false would only buy a flash of nothing.
   */
  isChatListHydrated: boolean;
}

const LocalFSContext = createContext<LocalFSContextType | null>(null);

/**
 * The workspace folder holding every *unfiled* chat.
 *
 * A chat filed into a notebook lives in `Notebooks/<name>/Chats/` instead, so
 * this is one of several directories a chat file can be in — see
 * `resolveChatDir`, which is the only thing that should spell either path.
 */
const CHATS_DIR_NAME = 'Chats';

export const LocalFSProvider: React.FC<{ children: ReactNode, modelConfig?: any }> = ({ children, modelConfig }) => {
  const { user, userProfile, loading: isAuthLoading } = useAuth();
  const { apiKeys } = useUserDataContext();
  const apiKeysRef = useRef(apiKeys);
  const modelConfigRef = useRef(modelConfig);
  const [isSupported] = useState(isFSAAPISupported);
  const [isInitializingLocalFS, setIsInitializingLocalFS] = useState(true);
  const [isChatListHydrated, setIsChatListHydrated] = useState(false);
  const [isLocalFolderConnected, setIsLocalFolderConnected] = useState(false);
  const [isLocalFolderAuthorized, setIsLocalFolderAuthorized] = useState(false);
  const [localFolderName, setLocalFolderName] = useState<string | null>(null);
  // The correct storage scope depends on the authenticated user, selected root,
  // and workspace. Keep the first paint empty while that scope is restored so
  // a legacy/global list can never flash and then visibly reorder.
  const [localChats, setLocalChats] = useState<string[]>([]);
  const [chatScopeId, setChatScopeId] = useState('signed-out::browser::My Willow');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // The personal runtime reads keys through this rather than through a captured
  // value, so adding a key after boot takes effect on the next build without
  // re-attaching the runtime.
  useEffect(() => {
    apiKeysRef.current = apiKeys;
  }, [apiKeys]);

  // Same arrangement for the model config, which carries the Personal
  // Intelligence system default. Changing it in Settings must reach the next
  // build without restarting the scheduler.
  useEffect(() => {
    modelConfigRef.current = modelConfig;
  }, [modelConfig]);

  useEffect(() => {
    const storage = navigator.storage;
    if (!storage?.persist || !storage?.persisted) return;
    void storage.persisted().then((persisted) => persisted || storage.persist()).catch(() => false);
  }, []);

  // Keep the handle in a ref to avoid re-renders and closure issues
  const directoryHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const rootIdRef = useRef('browser');
  const chatScopeIdRef = useRef('signed-out::browser::My Willow');
  const chatStorageScopeRef = useRef<ChatStorageScope>({
    userId: 'signed-out',
    rootId: 'browser',
    workspaceId: 'My Willow',
  });
  const chatMetadataKeysRef = useRef<ChatMetadataKeys>(chatMetadataKeysForScope(chatScopeIdRef.current));
  const chatTimestampsRef = useRef<Record<string, number>>({});
  const chatSyncRecordsRef = useRef<Record<string, ChatSyncRecord>>({});
  const localChatsRef = useRef<string[]>([]);
  const chatBroadcastRef = useRef<BroadcastChannel | null>(null);
  // Invalidates async work started by an older provider/scope. A scope ID can
  // repeat after reconnecting, so generation is intentionally independent.
  const providerGenerationRef = useRef(0);
  const chatOperationQueuesRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const isSwitchingChatScopeRef = useRef(false);
  const projectSaveQueuesRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const chatReconcilePromiseRef = useRef<Promise<void> | null>(null);
  const pendingWorkspaceDirRef = useRef<FileSystemDirectoryHandle | null>(null);
  // oldName -> { newName, ts } for recently renamed project folders. Save paths
  // resolve project folders by NAME, often seconds after capturing it (fetches,
  // debounces) — a write addressed to a just-renamed-away folder would recreate
  // Media/<oldName>/ as an orphan (adopted as a phantom project on the next
  // reconcile), or land mid-move and be deleted with the old folder. Every
  // name-addressed disk path redirects through resolveCurrentProjectName, and
  // the reconciler skips adopting a disk name that is a rename's in-flight
  // old name.
  const recentProjectRenamesRef = useRef<Map<string, { newName: string; ts: number }>>(new Map());
  // >0 while a project-folder move is executing on disk; the timestamp keeps
  // the guard up ~800ms after it completes so the FileSystemObserver's last
  // debounced event can pass. refreshLocalMedia consults these: reconciling a
  // half-copied folder makes every not-yet-copied file look externally
  // deleted, and the reconcile PERSISTS that loss (invariant #13).
  const projectRenameOpsRef = useRef(0);
  const projectRenameSettleUntilRef = useRef(0);
  // The same guard for a notebook-folder move, and it matters more: a notebook's
  // folder holds its CHATS, so the copy-then-delete window makes every chat the
  // notebook owns look externally deleted — and the chat reconciler acts on that
  // by tombstoning the row and reaping the body (invariants 5 and 13).
  const notebookRenameOpsRef = useRef(0);
  const notebookRenameSettleUntilRef = useRef(0);

  // Follow the rename chain (A→B→C) for a project name captured before one or
  // more renames landed. Entries expire after 60s — long enough for any
  // in-flight save, short enough that a deliberately re-created folder with a
  // recycled name isn't redirected.
  const resolveCurrentProjectName = useCallback((name: string): string => {
    const RENAME_GRACE_MS = 60000;
    const now = Date.now();
    let current = name;
    // Bounded hops to stay safe against a (never-expected) cycle.
    for (let hop = 0; hop < 5; hop++) {
      const entry = recentProjectRenamesRef.current.get(current);
      if (!entry || entry.ts <= now - RENAME_GRACE_MS) break;
      current = entry.newName;
    }
    return current;
  }, []);
  // Re-entrancy guard so overlapping disk polls don't stack up.
  const isPollingRef = useRef(false);
  const pollPendingRef = useRef(false);
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

  const persistChatMetadata = useCallback((broadcast = true): void => {
    const keys = chatMetadataKeysRef.current;
    // Merge the freshest storage snapshot first. This does not make
    // localStorage transactional, but it prevents ordinary read/modify/write
    // clobbers and BroadcastChannel closes the simultaneous-write gap.
    const storedRecords = validateSyncRecords(readJSON(keys.sync, {}));
    const storedTimestamps = validateTimestampMap(readJSON(keys.timestamps, {}));
    const storedChats = validateChatList(readJSON(keys.chats, []));
    chatSyncRecordsRef.current = mergeSyncRecords(storedRecords, chatSyncRecordsRef.current);
    const mergedTimestamps = { ...storedTimestamps };
    for (const [chatId, timestamp] of Object.entries(chatTimestampsRef.current)) {
      mergedTimestamps[chatId] = Math.max(mergedTimestamps[chatId] || 0, timestamp);
    }
    for (const [chatId, record] of Object.entries(chatSyncRecordsRef.current)) {
      if (record.tombstone) delete mergedTimestamps[chatId];
    }
    chatTimestampsRef.current = mergedTimestamps;
    const allChats = Array.from(new Set([...storedChats, ...localChatsRef.current]));
    const visibleChats = allChats.filter((chatId) => !chatSyncRecordsRef.current[chatId]?.tombstone);
    const sorted = sortChatsNewestToOldest(visibleChats, chatTimestampsRef.current);
    localChatsRef.current = sorted;

    localStorage.setItem(keys.sync, JSON.stringify(chatSyncRecordsRef.current));
    localStorage.setItem(keys.timestamps, JSON.stringify(chatTimestampsRef.current));
    localStorage.setItem(keys.chats, JSON.stringify(sorted));
    setLocalChats((previous) =>
      previous.length === sorted.length && previous.every((chatId, index) => chatId === sorted[index])
        ? previous
        : sorted
    );
    if (broadcast) {
      try {
        chatBroadcastRef.current?.postMessage({
          scopeId: chatScopeIdRef.current,
          chats: sorted,
          timestamps: chatTimestampsRef.current,
          records: chatSyncRecordsRef.current,
        });
      } catch {}
    }
  }, [mergeSyncRecords]);

  /**
   * The single definition of a chat scope id. Anything that needs to know
   * whether a scope is about to change must build the candidate id through
   * this, or the two spellings drift and the comparison silently stops working.
   */
  const buildChatScopeId = useCallback((rootId: string): string =>
    `${user?.uid || 'signed-out'}::${rootId}::${getSanitizedWorkspaceName()}`,
  [getSanitizedWorkspaceName, user?.uid]);

  const activateChatScope = useCallback(async (rootId: string): Promise<void> => {
    isSwitchingChatScopeRef.current = true;
    // Nothing may outlive a scope change. `chatStorageScopeRef` is about to be
    // reassigned, so a background chat turn settling afterwards would write into
    // the next account's namespace under this one's chat name — and one settling
    // mid-drain is silently discarded, because enqueueChatOperation no-ops while
    // the flag is set. Announced before the drain so those turns are already
    // gone when the queues are counted.
    window.dispatchEvent(new CustomEvent('willow_chat_scope_changing'));
    try {
      while (chatOperationQueuesRef.current.size > 0 || chatReconcilePromiseRef.current) {
        const pending = [
          ...chatOperationQueuesRef.current.values(),
          ...(chatReconcilePromiseRef.current ? [chatReconcilePromiseRef.current] : []),
        ];
        await Promise.allSettled(pending);
      }
    } finally {
      isSwitchingChatScopeRef.current = false;
    }
    const workspaceId = getSanitizedWorkspaceName();
    const userId = user?.uid || 'signed-out';
    const scopeId = buildChatScopeId(rootId);
    const keys = chatMetadataKeysForScope(scopeId);
    if (chatScopeIdRef.current !== scopeId) {
      // These caches are keyed by project name/id and must never leak across
      // account, root, or workspace changes.
      manifestIdCacheRef.current.clear();
      coverHydratedRef.current.clear();
      pendingWorkspaceDirRef.current = null;
      providerGenerationRef.current += 1;
    }
    const hasScopedMetadata = localStorage.getItem(keys.chats) !== null || localStorage.getItem(keys.sync) !== null;

    let chats = validateChatList(readJSON(keys.chats, []));
    let timestamps = validateTimestampMap(readJSON(keys.timestamps, {}));
    let records = validateSyncRecords(readJSON(keys.sync, {}));

    // Legacy chat metadata was global. Adopt it exactly once, only after a real
    // authenticated scope is known, so switching accounts/folders can never
    // copy the same legacy registry into multiple workspaces.
    if (!hasScopedMetadata && user?.uid && !localStorage.getItem(LEGACY_CHAT_MIGRATION_KEY)) {
      chats = validateChatList(readJSON(LEGACY_CHAT_KEYS.chats, []));
      timestamps = validateTimestampMap(readJSON(LEGACY_CHAT_KEYS.timestamps, {}));
      records = validateSyncRecords(readJSON(LEGACY_CHAT_KEYS.sync, {}));
      localStorage.setItem(keys.chats, JSON.stringify(chats));
      localStorage.setItem(keys.timestamps, JSON.stringify(timestamps));
      localStorage.setItem(keys.sync, JSON.stringify(records));
      localStorage.setItem(LEGACY_CHAT_MIGRATION_KEY, scopeId);
    }

    rootIdRef.current = rootId;
    chatScopeIdRef.current = scopeId;
    setMediaStorageScope(scopeId);
    setProjectStorageScope(scopeId);
    setCodeSessionStorageScope(scopeId);
    /*
     * Notebooks join the same scope so they follow a user across sign-in and
     * workspace switches exactly as their chats and projects do. Unlike those,
     * the notebook registry is plain scoped localStorage and stays readable with
     * no folder connected — see the header note in `notebooks-backend.ts`.
     */
    setNotebookStorageScope(scopeId);
    await migrateProjectKinds();
    chatStorageScopeRef.current = { userId, rootId, workspaceId };
    chatMetadataKeysRef.current = keys;
    chatTimestampsRef.current = timestamps;
    chatSyncRecordsRef.current = records;
    localChatsRef.current = sortChatsNewestToOldest(chats.filter((id) => !records[id]?.tombstone), timestamps);
    setChatScopeId(scopeId);
    persistChatMetadata(false);
  }, [buildChatScopeId, getSanitizedWorkspaceName, persistChatMetadata, user?.uid]);

  const updateScopedChatTimestamp = useCallback((chatId: string, timestamp = Date.now()): void => {
    chatTimestampsRef.current[chatId] = timestamp;
  }, []);

  const getScopedChatTimestamp = useCallback((chatId: string): number =>
    chatTimestampsRef.current[chatId] || parseTempIdTimestamp(chatId), []);

  const nextChatRevision = useCallback((chatId: string): number =>
    (chatSyncRecordsRef.current[chatId]?.revision || 0) + 1, []);

  const enqueueChatOperation = useCallback(async <T,>(chatIds: string[], operation: () => Promise<T>): Promise<T> => {
    if (isSwitchingChatScopeRef.current) return undefined as T;
    const ids = Array.from(new Set(chatIds.filter(Boolean))).sort();
    const predecessors = ids.map((id) => chatOperationQueuesRef.current.get(id)).filter(Boolean) as Promise<unknown>[];
    const runWithCrossTabLocks = async (index = 0): Promise<T> => {
      const locks = (navigator as any).locks;
      if (!locks?.request || index >= ids.length) return operation();
      const lockName = `willow-chat:${chatScopeIdRef.current}:${ids[index]}`;
      return locks.request(lockName, () => runWithCrossTabLocks(index + 1));
    };
    const run = Promise.allSettled(predecessors).then(() => runWithCrossTabLocks());
    const settled = run.then(() => undefined, () => undefined);
    for (const id of ids) chatOperationQueuesRef.current.set(id, settled);
    try {
      return await run;
    } finally {
      for (const id of ids) {
        if (chatOperationQueuesRef.current.get(id) === settled) chatOperationQueuesRef.current.delete(id);
      }
    }
  }, []);

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
    type Reg = { id: string; name: string; hasCover?: boolean; isStarred?: boolean; kind?: LocalProjectKind; onDisk?: boolean };
    const scopeIdAtStart = chatScopeIdRef.current;
    const generationAtStart = providerGenerationRef.current;
    const scopeIsCurrent = () => chatScopeIdRef.current === scopeIdAtStart && providerGenerationRef.current === generationAtStart;

    // Scan a parent folder WITHOUT creating it (a reconcile is a read — creating
    // here used to mint junk Code//Media/ scaffolding under whatever workspace
    // name was current, including the pre-profile fallback). `ok` is false ONLY
    // when the folder couldn't be read (permission/IO error) — a missing folder
    // is a real, readable "no projects of this kind" state and returns ok:true
    // with an empty map, so reconciliation still runs.
    const collectDirs = async (parentName: string): Promise<{ ok: boolean; map: Map<string, FileSystemDirectoryHandle> }> => {
      const map = new Map<string, FileSystemDirectoryHandle>();
      try {
        const parent = await workspaceDir.getDirectoryHandle(parentName);
        for await (const entry of (parent as any).values()) {
          if (entry.kind === 'directory') {
            map.set(entry.name, entry as FileSystemDirectoryHandle);
          }
        }
        return { ok: true, map };
      } catch (err: any) {
        if (err?.name === 'NotFoundError') return { ok: true, map };
        return { ok: false, map };
      }
    };

    try {
      const projectAreas = getProjectAreas();
      const scans = await Promise.all(projectAreas.map(async (area) => ({
        area,
        scan: await collectDirs(area.folder),
      })));
      // Safety: if any scan failed, do nothing (never delete on uncertainty).
      if (scans.some(({ scan }) => !scan.ok) || !scopeIsCurrent()) return;

      // Read the current registry.
      let projectsList = readProjectRegistry(scopeIdAtStart) as Reg[];
      if (!Array.isArray(projectsList)) projectsList = [];
      const nameToId = new Map<string, string>();
      for (const p of projectsList) if (p?.name && p?.id) nameToId.set(p.name, p.id);

      // Build the disk view (name -> area). Descriptors are priority-ordered, so
      // the established Code-over-Media precedence remains deterministic.
      const diskByName = new Map<string, { name: string; kind: LocalProjectKind; areaId: string; handle: FileSystemDirectoryHandle; id?: string }>();
      for (const { area, scan } of scans) {
        for (const [name, handle] of scan.map) {
          if (!diskByName.has(name)) diskByName.set(name, { name, kind: area.kind, areaId: area.id, handle });
        }
      }

      // Resolve a stable id for every disk folder. Prefer the manifest id; else
      // inherit the registry id for that name; else mint one. Persist it so the
      // id survives future renames/reconnects (keeps covers/media linked).
      // A name->id cache makes steady-state polls skip the per-folder file read.
      const cache = manifestIdCacheRef.current;
      const diskById = new Map<string, { name: string; kind: LocalProjectKind }>();
      const mintProjectId = (): string => {
        const taken = new Set<string>(diskById.keys());
        for (const project of projectsList) if (project?.id) taken.add(project.id);
        let candidate: string;
        do {
          candidate = `#${crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
        } while (taken.has(candidate));
        return candidate;
      };
      for (const info of diskByName.values()) {
        let id = cache.get(info.name) ?? null;
        let persistManifest = false;
        if (!id) {
          id = (await readProjectManifest(info.handle))?.id ?? null;
          if (!scopeIsCurrent()) return;
          if (!id) {
            id = nameToId.get(info.name) ?? null;
            if (!id) {
              // Mint an id no registry entry or already-resolved disk folder is
              // using. The 4-digit space is small enough for birthday collisions
              // with a modest project count — and a duplicate id cross-links two
              // projects' covers/media in IndexedDB.
              id = mintProjectId();
            }
            persistManifest = true;
          }
        }
        const duplicate = diskById.get(id);
        if (duplicate && duplicate.name !== info.name) {
          id = mintProjectId();
          persistManifest = true;
        }
        if (persistManifest) {
          await writeProjectManifest(info.handle, id);
          if (!scopeIsCurrent()) return;
        }
        cache.set(info.name, id);
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
          // Code-editor sessions are keyed by project NAME — migrate them along
          // with the rename or the project's session history orphans.
          // EXCEPTION: while an IN-APP rename's folder move is still in flight,
          // the disk briefly still shows the OLD name — adopting it back would
          // revert the registry (and ping-pong the session keys). Skip; once
          // the move completes the manifest match adopts the new name for good.
          if (!byName && byId && updated.name !== byId.name) {
            const pending = recentProjectRenamesRef.current.get(byId.name);
            const renameInFlight = !!pending && pending.newName === updated.name && pending.ts > Date.now() - 60000;
            if (!renameInFlight) {
              void renameCodeSessions(`willow_chat_sessions_${updated.name}`, `willow_chat_sessions_${byId.name}`);
              updated.name = byId.name;
              changed = true;
            }
          }
          if (updated.kind !== disk.kind) { updated.kind = disk.kind; changed = true; }
          if (!p.onDisk) changed = true;
          next.push(updated);
        } else if (p.onDisk) {
          // Was on disk, folder is gone, and its id isn't present anywhere on disk
          // -> genuinely deleted externally. Remove it and clean its IndexedDB data.
          changed = true;
          markProjectDeleted(p.name, scopeIdAtStart, p.id);
          void deleteProjectData(p.id, scopeIdAtStart);
          // deleteProjectData only clears media + covers. Code-editor sessions
          // (and their content-addressed blobs) are keyed by project NAME —
          // clear them too, exactly like the in-app delete surfaces do, or an
          // externally-deleted code project leaks its whole session history in
          // IndexedDB forever.
          void deleteCodeSessions(`willow_chat_sessions_${p.name}`);
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
        if (!scopeIsCurrent()) return;
        if (p.kind !== 'media') continue;
        if (coverHydratedRef.current.has(p.id)) continue;
        coverHydratedRef.current.add(p.id);
        const existing = await loadProjectCover(p.id, scopeIdAtStart);
        if (!scopeIsCurrent()) return;
        // Skip only if we already have a durable still IMAGE. A data:video cover
        // (legacy) is intentionally reprocessed into a frame.
        if (existing && existing.startsWith('data:image')) continue;

        // Source 1: the project's disk folder (explicit cover.* or oldest file).
        const handle = p.onDisk ? diskByName.get(p.name)?.handle : undefined;
        if (handle) {
          const resolved = await resolveDiskCover(handle);
          if (!scopeIsCurrent()) return;
          if (resolved) {
            const isVid = (resolved.file.type || '').startsWith('video');
            let imageUrl: string | null = isVid ? await extractVideoFrame(resolved.file) : await fileToDataURL(resolved.file);
            if (imageUrl) {
              await saveProjectCover(p.id, imageUrl, scopeIdAtStart);
              if (!scopeIsCurrent()) return;
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
          const items = await loadProjectMedia(p.id, scopeIdAtStart);
          if (!scopeIsCurrent()) return;
          const completed = (Array.isArray(items) ? items : []).filter((m: any) => m?.status === 'completed' && m?.url);
          const firstGen = completed.reduce((oldest: any, m: any) =>
            (!oldest || (m.timestamp || 0) < (oldest.timestamp || 0)) ? m : oldest, null as any);
          if (firstGen?.url) {
            const imageUrl = firstGen.kind === 'video'
              ? (await extractVideoFrame(firstGen.url)) || null
              : firstGen.url;
            if (imageUrl) {
              await saveProjectCover(p.id, imageUrl, scopeIdAtStart); // inlines any external URL to base64
              if (!scopeIsCurrent()) return;
              if (!p.hasCover) { p.hasCover = true; changed = true; }
              coversChanged = true;
            }
          }
        } catch {}
      }

      if (!scopeIsCurrent()) return;
      if (changed) {
        // Re-read the registry right before writing. The reconcile above ran
        // many awaits (manifest reads, cover hydration — seconds), and another
        // writer may have mutated the registry in that window. Blindly writing
        // our stale `next` would clobber those edits.
        try {
          const originalIds = new Set(projectsList.map((p) => p?.id).filter(Boolean));
          const nextById = new Map(next.map((p) => [p.id, p]));
          const freshList = readProjectRegistry(scopeIdAtStart) as Reg[];
          if (Array.isArray(freshList)) {
            for (const p of freshList) {
              if (!p?.id) continue;
              const mine = nextById.get(p.id);
              if (!mine) {
                // A concurrent ADDITION we never saw (new project just
                // registered) — preserve it, unless it's an id we deliberately
                // dropped (saw in the original snapshot and removed on purpose).
                if (!originalIds.has(p.id)) {
                  next.push(p);
                  nextById.set(p.id, p);
                }
              } else {
                // An entry we kept. `isStarred` is a user preference the
                // reconcile has no authority over and never sets — adopt the
                // fresh value so a star toggled DURING our long await isn't
                // reverted. Disk-authoritative fields (name/kind/onDisk/
                // hasCover) keep the reconcile's disk-derived values.
                if (!!p.isStarred !== !!mine.isStarred) {
                  mine.isStarred = p.isStarred;
                }
                // hasCover only ever flips false→true (a cover got saved) —
                // adopting a concurrent `true` can never lose information.
                if (p.hasCover && !mine.hasCover) {
                  mine.hasCover = true;
                }
              }
            }
          }
        } catch {}
        writeProjectRegistry(next, scopeIdAtStart);
      }
      if (changed || coversChanged) {
        window.dispatchEvent(new Event('willow_projects_updated'));
      }
    } catch (err) {
      console.error('Error reconciling projects with disk', err);
    }
  }, []);

  /**
   * Which notebook's folder a chat's file belongs in — `''` for the global `Chats/`.
   *
   * The sync record is authoritative, because it is the field a move sets and the
   * reconciler maintains. The registry is consulted **only when there is no record
   * at all**, which means no file has ever been written under this id and there is
   * therefore no current location to preserve. That case is the chat started
   * *inside* a notebook: `ChatView` files it the moment it is persisted, so its
   * very first write should land in the notebook's folder rather than in the global
   * one and be moved a poll later.
   *
   * `previousId` carries the location across a rename (temp id -> AI title). Taking
   * it from the old record rather than re-reading the registry is deliberate: the
   * registry is keyed by id, and the new title is registered by a React effect that
   * may not have run yet.
   */
  const chatNotebookId = useCallback((chatId: string, previousId?: string | null): string => {
    const record = chatSyncRecordsRef.current[chatId];
    if (record) return record.notebookId;
    const carried = previousId ? chatSyncRecordsRef.current[previousId] : undefined;
    if (carried) return carried.notebookId;
    const { chatOwner } = readNotebookChatIndex();
    return chatOwner[chatId] || (previousId ? chatOwner[previousId] || '' : '');
  }, []);

  /**
   * The directory a chat file goes in, for a location from `chatNotebookId`.
   *
   * Every chat read, write, move and delete resolves its directory here, so the
   * two possible paths are spelled once — two call sites spelling them separately
   * eventually means a chat written to a folder nobody scans.
   *
   * `create` distinguishes the two contracts this layer has always had. A write
   * may build what it needs; a read or a delete may not, because a fabricated
   * empty folder is indistinguishable from "everything in here was deleted" and
   * the reconciler acts on that. A write to a notebook that has no folder yet
   * builds the whole shape (manifest and `Sources/` too), so a folder that appears
   * because a chat moved into it looks like one the create screen made.
   */
  const resolveChatDir = useCallback(async (
    workspaceDir: FileSystemDirectoryHandle,
    notebookId: string,
    { create = false }: { create?: boolean } = {},
  ): Promise<FileSystemDirectoryHandle | null> => {
    if (!notebookId) {
      try {
        return await workspaceDir.getDirectoryHandle(CHATS_DIR_NAME, { create });
      } catch {
        return null;
      }
    }
    if (!create) {
      const assigned = readNotebookChatIndex().folderByNotebookId[notebookId] || '';
      return assigned ? openNotebookChatsDir(workspaceDir, assigned, { create: false }) : null;
    }
    const folderName = ensureNotebookFolderName(notebookId);
    if (!folderName) return null;
    if (!(await ensureNotebookDirIn(workspaceDir, folderName, notebookId))) return null;
    return openNotebookChatsDir(workspaceDir, folderName, { create: true });
  }, []);

  /**
   * One chat file, as found on disk.
   *
   * `dir`/`notebookId` are where it actually *is*, which is not necessarily where
   * the record says it should be — reconciling that difference is what the
   * location pass below does.
   */
  interface DiskChatFile {
    handle: FileSystemFileHandle;
    mtime: number;
    dir: FileSystemDirectoryHandle;
    notebookId: string;
  }

  const reconcileChatsWithDisk = useCallback(async (workspaceDir: FileSystemDirectoryHandle): Promise<void> => {
    /*
     * Read once for the whole pass. A chat filed while this runs is picked up by
     * the next one, and `chatNotebookId` prefers the sync record anyway — which a
     * concurrent filing writes — so a stale index can only affect a chat that has
     * no record at all.
     */
    const notebookIndex = readNotebookChatIndex();

    /*
     * The global folder is the one directory this pass cannot do without: an empty
     * scan set makes every known chat look externally deleted, and the pass at the
     * bottom acts on that. Failing to open it aborts the whole reconcile
     * (invariant 5: a failed scan performs zero deletions).
     */
    let globalChatsDir: FileSystemDirectoryHandle;
    try {
      globalChatsDir = await workspaceDir.getDirectoryHandle(CHATS_DIR_NAME, { create: true });
    } catch {
      return;
    }

    const diskFiles = new Map<string, DiskChatFile>();
    /** Every directory this pass could read, including the global one as `''`. */
    const dirByNotebookId = new Map<string, FileSystemDirectoryHandle>([['', globalChatsDir]]);
    /**
     * Notebooks whose folder could not be opened. Their chats are **unaccounted
     * for, not deleted** — a folder renamed by hand in Explorer looks exactly like
     * this, and reading it as a deletion would tombstone every chat inside and reap
     * their bodies.
     */
    const unreadableNotebooks = new Set<string>();

    const scanChatsDir = async (dir: FileSystemDirectoryHandle, notebookId: string): Promise<void> => {
      for await (const entry of (dir as any).values()) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
        const chatId = entry.name.slice(0, -5);
        if (!isValidChatId(chatId)) continue;
        let mtime = 0;
        try { mtime = (await entry.getFile()).lastModified; } catch { continue; }
        const existing = diskFiles.get(chatId);
        if (existing) {
          /*
           * The same id in two folders — a copy, or a move made outside the app
           * that only got halfway. Keep whichever copy the app expects (else the
           * global one, since it is scanned first) and leave the other file
           * completely alone: it holds a conversation, and deleting it on the
           * strength of a guess about which is newer is not recoverable.
           */
          const expected = chatNotebookId(chatId);
          if (existing.notebookId === expected || notebookId !== expected) continue;
        }
        diskFiles.set(chatId, { handle: entry, mtime, dir, notebookId });
      }
    };

    try {
      await scanChatsDir(globalChatsDir, '');
    } catch {
      // A partial global scan is still a scan of an unknown subset, so it cannot
      // be trusted to prove absence either.
      return;
    }
    for (const { notebookId, folderName } of notebookIndex.folders) {
      const dir = await openNotebookChatsDir(workspaceDir, folderName, { create: false });
      if (!dir) {
        unreadableNotebooks.add(notebookId);
        continue;
      }
      dirByNotebookId.set(notebookId, dir);
      try {
        await scanChatsDir(dir, notebookId);
      } catch {
        unreadableNotebooks.add(notebookId);
      }
    }

    const knownIds = new Set<string>([...localChatsRef.current, ...diskFiles.keys()]);
    const makeConflictId = (chatId: string): string => {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const base = `${chatId.slice(0, 180)} (Disk conflict ${stamp})`;
      let candidate = base;
      let suffix = 2;
      while (knownIds.has(candidate)) candidate = `${base} ${suffix++}`;
      knownIds.add(candidate);
      return candidate;
    };

    // Durable tombstones win over a still-present disk file. A failed removal
    // is retried on every reconcile and can never resurrect the chat.
    for (const [chatId, record] of Object.entries(chatSyncRecordsRef.current)) {
      if (!record.tombstone) continue;
      const disk = diskFiles.get(chatId);
      if (disk) {
        try {
          // From whichever folder it turned up in, not from where the record
          // expected it: a deleted chat the user had moved is still deleted.
          await disk.dir.removeEntry(`${chatId}.json`);
          diskFiles.delete(chatId);
        } catch {}
      }
      try { await deleteChatBody(chatId, chatStorageScopeRef.current); } catch {}
      localChatsRef.current = localChatsRef.current.filter((id) => id !== chatId);
    }

    // Per-chat reconciliation is independent — `enqueueChatOperation` already
    // serializes by chat id, and every id here is distinct. Awaiting them one
    // at a time serialized N unrelated IO round trips (each with its own
    // cross-tab lock), so startup latency grew linearly with chat count. A
    // bounded pool overlaps the waiting without flooding the disk or the lock
    // manager. Ordering is not relied upon: `persistChatMetadata` re-sorts at
    // the end, and each task re-reads shared refs after its own awaits.
    const RECONCILE_CONCURRENCY = 8;
    const diskEntries = [...diskFiles];
    let nextEntryIndex = 0;
    const reconcileEntry = async ([chatId, disk]: [string, DiskChatFile]) => {
      await enqueueChatOperation([chatId], async () => {
        let record = chatSyncRecordsRef.current[chatId];
        if (record?.tombstone) return;

        /*
         * ── Location, before content ──────────────────────────────────────────
         *
         * Which folder the file is in decides which folder the content work below
         * writes to, so it is settled first. The whole scheme rests on one
         * tie-break, and it is what stops a file ping-ponging between two folders
         * on every poll: `locationDirty` means the app asked for a move that disk
         * has not caught up with, so the move is completed and the registry is
         * never reverted. Clear means nobody in the app asked, so the user moved
         * the file themselves and disk is authoritative for where a file is
         * (invariant 3) — the record follows the file, and the registry follows
         * the record.
         */
        let activeDir = disk.dir;
        let activeNotebookId = disk.notebookId;
        /** The file's mtime as it stands now — a move gives it a new one. */
        let observedMtime = disk.mtime;
        /** Re-resolved after a move: a copy-then-delete one strands the old handle. */
        let activeHandle = disk.handle;
        const wantedNotebookId = record ? record.notebookId : (notebookIndex.chatOwner[chatId] || '');
        if (disk.notebookId !== wantedNotebookId) {
          if (record?.locationDirty) {
            const targetDir = await resolveChatDir(workspaceDir, wantedNotebookId, { create: true });
            const moved = !!targetDir && await moveFileBetweenDirs(disk.dir, targetDir, `${chatId}.json`);
            if (moved && targetDir) {
              activeDir = targetDir;
              activeNotebookId = wantedNotebookId;
              /*
               * Re-resolve the file where it now lives, and re-read its mtime.
               * Both matter. A copy-then-delete move leaves `disk.handle`
               * pointing at a file that no longer exists, so the content pass
               * below would read nothing and bail. And a move gives the file a
               * new timestamp, which the next poll would otherwise read as an
               * external edit — re-loading the body and firing an update event
               * every 3 seconds forever (invariant 7: change-only).
               */
              try {
                activeHandle = await targetDir.getFileHandle(`${chatId}.json`);
                observedMtime = (await activeHandle.getFile()).lastModified;
              } catch {}
              const latest = chatSyncRecordsRef.current[chatId];
              if (latest) {
                chatSyncRecordsRef.current[chatId] = {
                  ...latest,
                  diskMtime: observedMtime,
                  locationDirty: false,
                  updatedAt: Date.now(),
                };
                record = chatSyncRecordsRef.current[chatId];
              }
            }
            // A failed move leaves `locationDirty` set and the file where it is;
            // the next poll retries it. Same durable-dirty contract as content
            // (invariant 11).
          } else {
            if (record) {
              chatSyncRecordsRef.current[chatId] = {
                ...record,
                notebookId: disk.notebookId,
                locationDirty: false,
                updatedAt: Date.now(),
              };
              record = chatSyncRecordsRef.current[chatId];
            }
            // Fires the notebooks-updated event only when something really moved,
            // so an idle poll writes nothing and re-renders nothing.
            adoptChatIntoNotebook(chatId, disk.notebookId || null);
          }
        } else if (record?.locationDirty) {
          /*
           * The file is already where the record wants it, so whatever move was
           * outstanding has landed — by `saveLocalFSChat` writing the new content
           * straight into the target folder, or by a retry that succeeded and
           * lost its record update to a scope switch. Clearing the flag here is
           * what makes the intent converge instead of staying dirty forever.
           */
          chatSyncRecordsRef.current[chatId] = {
            ...record,
            locationDirty: false,
            updatedAt: Date.now(),
          };
          record = chatSyncRecordsRef.current[chatId];
        }

        // Order matters for cost. The overwhelmingly common case is "nothing
        // changed", and deciding that needs only an mtime comparison plus a
        // presence probe — NOT the chat body. Loading every body up front made
        // startup scale with total history size, which is what made a large
        // Recents list hang the app until the scan finished.
        const diskChanged = !record || !record.diskMtime || observedMtime !== record.diskMtime;
        if (!record?.dirty && !diskChanged) {
          let bodyPresent = false;
          try { bodyPresent = await hasChatBody(chatId, chatStorageScopeRef.current); } catch {}
          if (bodyPresent) {
            if (!localChatsRef.current.includes(chatId)) localChatsRef.current.push(chatId);
            return;
          }
        }

        // Past this point the chat genuinely needs work, so the body is worth
        // reading. `loadChatBody` also performs legacy migration, which is why
        // the probe above must not be treated as authoritative on absence.
        let cached: any[] | null = null;
        try { cached = await loadChatBody(chatId, chatStorageScopeRef.current); } catch {}
        if (!record?.dirty && cached && !diskChanged) {
          if (!localChatsRef.current.includes(chatId)) localChatsRef.current.push(chatId);
          return;
        }

        let diskBody: any[] | null = null;
        let diskText = '';
        try {
          const file = await activeHandle.getFile();
          diskText = await file.text();
          const parsed = JSON.parse(diskText);
          if (Array.isArray(parsed)) diskBody = parsed;
        } catch {
          return;
        }

        if (record?.dirty && cached) {
          const cachedText = JSON.stringify(cached, null, 2);
          const contentDiffers = JSON.stringify(diskBody) !== JSON.stringify(cached);
          const externallyChanged = contentDiffers && (!record.diskMtime || observedMtime !== record.diskMtime);
          if (externallyChanged && diskBody) {
            // Preserve the external version under a deterministic conflict copy
            // before retrying the local dirty revision at the original name. The
            // copy is written beside the original, whichever folder that is now.
            const conflictId = makeConflictId(chatId);
            await saveChatBody(conflictId, diskBody, chatStorageScopeRef.current);
            await writeFileRecursively(activeDir, `${conflictId}.json`, diskText);
            const conflictFile = await (await activeDir.getFileHandle(`${conflictId}.json`)).getFile();
            const conflictRevision = nextChatRevision(conflictId);
            chatSyncRecordsRef.current[conflictId] = {
              revision: conflictRevision,
              diskRevision: conflictRevision,
              diskMtime: conflictFile.lastModified,
              dirty: false,
              tombstone: false,
              updatedAt: Date.now(),
              notebookId: activeNotebookId,
              locationDirty: false,
            };
            chatTimestampsRef.current[conflictId] = observedMtime;
            localChatsRef.current.push(conflictId);
          }

          try {
            await writeFileRecursively(activeDir, `${chatId}.json`, cachedText);
            const written = await (await activeDir.getFileHandle(`${chatId}.json`)).getFile();
            record = chatSyncRecordsRef.current[chatId];
            if (record && record.dirty) {
              chatSyncRecordsRef.current[chatId] = {
                ...record,
                diskRevision: record.revision,
                diskMtime: written.lastModified,
                dirty: false,
                updatedAt: Date.now(),
              };
            }
          } catch {
            // Keep dirty forever; a later watcher/focus tick retries it.
          }
        } else if (diskBody) {
          // Clean disk revisions are authoritative. Refresh IndexedDB whenever
          // mtime changes so external edits to existing chats become visible.
          await saveChatBody(chatId, diskBody, chatStorageScopeRef.current);
          window.dispatchEvent(new CustomEvent('willow_chat_body_updated', { detail: { chatId } }));
          const revision = Math.max(record?.revision || 0, record?.diskRevision || 0);
          chatSyncRecordsRef.current[chatId] = {
            revision,
            diskRevision: revision,
            diskMtime: observedMtime,
            dirty: false,
            tombstone: false,
            updatedAt: Date.now(),
            // Where the file actually is, which the block above has already
            // reconciled against where the app wanted it.
            notebookId: activeNotebookId,
            locationDirty: false,
          };
          chatTimestampsRef.current[chatId] = observedMtime;
        }
        if (!localChatsRef.current.includes(chatId)) localChatsRef.current.push(chatId);
      });
    };
    await Promise.all(
      Array.from({ length: Math.min(RECONCILE_CONCURRENCY, diskEntries.length) }, async () => {
        while (nextEntryIndex < diskEntries.length) {
          const entry = diskEntries[nextEntryIndex++];
          // One failing chat must not abandon the rest of the pass.
          try { await reconcileEntry(entry); } catch {}
        }
      })
    );

    /*
     * A notebook rename is a folder copy followed by a folder delete, so for the
     * length of it every chat inside that notebook is either in two places or in
     * neither. Read by the pass below that is a mass external delete, and it
     * would tombstone the whole notebook's history and reap the bodies — the
     * same trap `projectRenameOpsRef` exists for (invariants 5 and 13). The
     * settle window covers the observer events that arrive just after the last
     * write. Everything above is safe during a rename: it only ever acts on
     * files it actually found.
     */
    if (notebookRenameOpsRef.current > 0 || Date.now() < notebookRenameSettleUntilRef.current) {
      persistChatMetadata();
      return;
    }

    // Deliberately sequential, unlike the pass above. This loop reassigns
    // `localChatsRef.current` wholesale, so overlapping iterations could drop a
    // concurrent push. It is also nearly free in practice — on a healthy
    // install every known chat is present on disk and this exits immediately.
    //
    // A clean cached chat missing from disk is an external deletion, including
    // one made while the app was closed. Only an explicitly dirty revision is
    // eligible to be flushed back to disk.
    const scannedDirs = [...dirByNotebookId.values()];
    for (const chatId of [...localChatsRef.current]) {
      if (diskFiles.has(chatId)) continue;
      await enqueueChatOperation([chatId], async () => {
        const record = chatSyncRecordsRef.current[chatId];
        if (record?.tombstone) return;

        /*
         * The notebook this chat belongs to was not enumerated, so its files were
         * never looked at. Unaccounted for is not deleted — a notebook folder
         * renamed by hand in a file manager reads as unreadable, and a registry
         * entry that vanished without its chats being unfiled first reads as
         * unknown. Treating either as a deletion would erase every chat in the
         * notebook (invariant 5).
         */
        const wanted = record ? record.notebookId : (notebookIndex.chatOwner[chatId] || '');
        if (wanted && (unreadableNotebooks.has(wanted) || !notebookIndex.folderByNotebookId[wanted])) return;

        // `diskFiles` was enumerated at the top of this reconcile, but we only
        // reach this decision after every per-chat await above — seconds later.
        // A chat saved in that window is present on disk and absent from the
        // snapshot, which reads here as "externally deleted" and destroys a
        // conversation the user is actively in. Renaming to the AI-generated
        // title is exactly that write, which is why this hit reliably on the
        // first message of a new chat. Re-check disk before believing the
        // snapshot; absence has to be true *now* to count as a deletion.
        //
        // Every folder is re-probed, not just the expected one: a chat file can
        // legitimately be in the global `Chats/` or in any notebook's, and a
        // file found somewhere unexpected is a move for the next poll's scan to
        // adopt — never a delete.
        let foundNow = false;
        for (const dir of scannedDirs) {
          try {
            await dir.getFileHandle(`${chatId}.json`);
            foundNow = true;
            break;
          } catch (error: any) {
            // Only a genuine "not there" is evidence. A permission or transient
            // failure must not be read as a delete, and it says nothing about
            // the folders not yet probed either, so the whole decision is
            // abandoned rather than continuing the sweep.
            if (error?.name && error.name !== 'NotFoundError') return;
          }
        }
        if (foundNow) {
          if (!localChatsRef.current.includes(chatId)) localChatsRef.current.push(chatId);
          return;
        }

        /*
         * `locationDirty` earns the same protection as `dirty`, for the same
         * reason: a move has been asked for and has not landed, so where the file
         * is right now is unknown *by construction*. Absence from the folders this
         * pass could read is therefore not evidence of a deletion — the file may
         * be sitting in a notebook folder the registry no longer names, which is
         * what a notebook deleted while no folder was connected leaves behind.
         * Writing the cached body to the wanted folder both saves the conversation
         * and converges the state, so the flush below covers both flags.
         */
        if (record?.dirty || record?.locationDirty) {
          let body: any[] | null = null;
          try { body = await loadChatBody(chatId, chatStorageScopeRef.current); } catch {}
          if (!body) {
            // `dirty` means there is local work disk has never seen, so a body
            // we cannot read right now is NOT evidence of an external delete —
            // it is a read to retry. Falling through to the tombstone below
            // permanently erased the chat and its body, which is exactly how a
            // conversation the user is still looking at gets lost. A save in
            // flight is the common cause: saveLocalFSChat registers the chat in
            // the list before writing its body, so a reconcile landing in that
            // window sees dirty-with-no-body. Leave it dirty; the next
            // watcher/poll tick retries.
            return;
          }
          // Flushed to where the record says it belongs, creating the notebook's
          // folder if the move never landed. A folder we cannot resolve leaves
          // the record dirty for the next tick rather than dropping the write.
          const targetDir = await resolveChatDir(workspaceDir, wanted, { create: true });
          if (!targetDir) return;
          try {
            await writeFileRecursively(targetDir, `${chatId}.json`, JSON.stringify(body, null, 2));
            const written = await (await targetDir.getFileHandle(`${chatId}.json`)).getFile();
            const latest = chatSyncRecordsRef.current[chatId];
            if (latest?.dirty || latest?.locationDirty) {
              chatSyncRecordsRef.current[chatId] = {
                ...latest,
                // Only a dirty flush publishes a new content revision. A
                // location-only flush wrote the body disk already had.
                diskRevision: latest.dirty ? latest.revision : latest.diskRevision,
                diskMtime: written.lastModified,
                dirty: false,
                updatedAt: Date.now(),
                // The file now exists in the wanted folder, so any pending move
                // has been satisfied by this write.
                locationDirty: false,
              };
            }
          } catch {
            // Keep dirty; a later watcher/focus tick retries the flush.
          }
          return;
        }

        const revision = nextChatRevision(chatId);
        chatSyncRecordsRef.current[chatId] = {
          revision,
          diskRevision: record?.diskRevision || 0,
          diskMtime: record?.diskMtime || 0,
          dirty: false,
          tombstone: true,
          updatedAt: Date.now(),
          // Kept rather than cleared: a tombstone can be resurrected by a
          // cross-tab merge, and where the chat belonged is still true.
          notebookId: record?.notebookId || '',
          locationDirty: false,
        };
        localChatsRef.current = localChatsRef.current.filter((id) => id !== chatId);
        delete chatTimestampsRef.current[chatId];
        try { await deleteChatBody(chatId, chatStorageScopeRef.current); } catch {}
        setActiveChatId((current) => current === chatId ? null : current);
        window.dispatchEvent(new CustomEvent('willow_chat_body_updated', { detail: { chatId, deleted: true } }));
      });
    }

    persistChatMetadata();
  }, [enqueueChatOperation, nextChatRevision, persistChatMetadata, chatNotebookId, resolveChatDir]);

  // All startup, watcher, focus, and manual refreshes enter one reconciliation
  // loop. Requests arriving during a long scan are queued for another pass
  // instead of being dropped.
  //
  // The handle is the **workspace** directory, not `Chats/`: a chat file can be
  // in the global folder or in any notebook's, and only `reconcileChatsWithDisk`
  // gets to decide which (see `resolveChatDir`).
  const syncChatsWithDisk = useCallback(async (workspaceDir: FileSystemDirectoryHandle): Promise<void> => {
    pendingWorkspaceDirRef.current = workspaceDir;
    if (chatReconcilePromiseRef.current) return chatReconcilePromiseRef.current;
    const run = (async () => {
      while (pendingWorkspaceDirRef.current) {
        const nextDir = pendingWorkspaceDirRef.current;
        pendingWorkspaceDirRef.current = null;
        await reconcileChatsWithDisk(nextDir);
      }
    })();
    chatReconcilePromiseRef.current = run;
    try {
      await run;
    } finally {
      if (chatReconcilePromiseRef.current === run) chatReconcilePromiseRef.current = null;
    }
  }, [reconcileChatsWithDisk]);

  // Attempt to restore directory connection from IndexedDB on mount
  useEffect(() => {
    if (!isSupported) {
      setIsInitializingLocalFS(false);
      setIsChatListHydrated(true);
      return;
    }
    /*
     * Wait for auth before touching the chat registry.
     *
     * The scope id is `${uid}::${rootId}::${workspaceName}`, and BOTH of those
     * first two come from auth. Running while `loading` is still true meant
     * hydrating under `signed-out::…` — which for a signed-in user with a saved
     * folder is a real, populated scope — and then re-running once Firebase
     * reported the uid, where `buildChatScopeId(...) !== chatScopeIdRef.current`
     * is now true and the wipe below fires. That is exactly the reported
     * flicker: the list paints from the provisional scope, is cleared when the
     * true scope arrives, and paints again after the second activation.
     *
     * Holding here removes the wrong-scope pass entirely, so the list paints
     * once, correctly. It costs nothing visually: `isChatListHydrated` stays
     * false throughout, so Recents renders nothing rather than something wrong,
     * and the rest of the sidebar is not gated on this at all.
     */
    if (isAuthLoading) return;
    let cancelled = false;
    let generation = ++providerGenerationRef.current;
    const isCurrent = () => !cancelled && providerGenerationRef.current === generation;

    const restoreConnection = async () => {
      setIsInitializingLocalFS(true);
      setIsLocalFolderAuthorized(false);
      const stored = await getStoredDirectoryRecord();
      if (!isCurrent()) return;
      const handle = stored?.handle || null;
      const nextRootId = stored?.rootId || 'browser';

      // Only drop the visible chat registry when this restore is actually
      // moving to a different scope. This effect re-runs whenever
      // `getSanitizedWorkspaceName`/`activateChatScope` change identity — which
      // happens on ANY userProfile change, including one that leaves the
      // workspace name untouched. Wiping unconditionally nulled `activeChatId`
      // mid-conversation, and ChatView reads a sustained null as a deselect and
      // clears the live thread (see its clear-effect), dumping the user back on
      // the home screen with the chat gone.
      //
      // Skipping the wipe leaks nothing: an identical scopeId means same
      // account, same root, and same workspace, so the registry on screen
      // already belongs to this scope. When the scope DOES differ we still
      // clear first, so another account's chats can never be shown, and
      // activateChatScope repopulates from that scope's own metadata.
      if (buildChatScopeId(nextRootId) !== chatScopeIdRef.current) {
        setLocalChats([]);
        localChatsRef.current = [];
        setActiveChatId(null);
      }

      await activateChatScope(nextRootId);
      // The registry is now on screen: `activateChatScope` seeds `localChats`
      // synchronously from localStorage, and chat titles are the filenames, so
      // nothing below this line changes what Recents renders unless the folder
      // was edited outside the app. Release the sidebar here rather than at the
      // end of the restore.
      if (!cancelled) setIsChatListHydrated(true);
      // activateChatScope advances the generation when account/root/workspace
      // changes; adopt that new generation for the work this restore started.
      if (cancelled) return;
      generation = providerGenerationRef.current;
      if (handle) {
        directoryHandleRef.current = handle;
        setLocalFolderName(handle.name);
        setIsLocalFolderConnected(true);

        try {
          const hasAccess = await verifyPermission(handle, false, false);
          if (hasAccess) {
            /*
             * Authorization is settled by `verifyPermission`, not by the disk
             * walk below — so both this flag and the init gate flip here. They
             * used to flip after `syncChatsWithDisk` + `syncProjectsFromDisk`,
             * which meant every consumer of `isInitializingLocalFS` (including
             * the "Authorize local folder?" modal) waited on a full per-file
             * reconcile plus an unrelated projects scan. Releasing them here
             * cannot flash the modal: `isLocalFolderAuthorized` is already true
             * in the same commit.
             */
            if (isCurrent()) {
              setIsLocalFolderAuthorized(true);
              setIsInitializingLocalFS(false);
            }
            const workspaceName = getSanitizedWorkspaceName();
            // Do NOT create the workspace folder here. On early mount the user
            // profile (and thus the real workspace name) may not have loaded
            // yet — creating eagerly minted junk folders named after the
            // fallback ("My Willow") and then synced chats/projects into them.
            // If the folder isn't on disk yet, skip the initial sync: this
            // effect re-runs when the profile loads (getSanitizedWorkspaceName
            // identity changes), and every save path still creates on demand.
            let workspaceDir: FileSystemDirectoryHandle | null = null;
            try {
              workspaceDir = await handle.getDirectoryHandle(workspaceName);
            } catch {}
            if (workspaceDir) {
              await syncChatsWithDisk(workspaceDir);

              // Recover & re-tag projects from disk (self-healing registry).
              await syncProjectsFromDisk(workspaceDir);
            }
          } else {
            setIsLocalFolderAuthorized(false);
          }
        } catch {
          setIsLocalFolderAuthorized(false);
        }
      } else {
        directoryHandleRef.current = null;
        setLocalFolderName(null);
        setIsLocalFolderConnected(false);
      }
      // Catch-all for the paths that did not release it above (no handle,
      // permission denied, or a throw mid-restore). Idempotent.
      if (isCurrent()) setIsInitializingLocalFS(false);
    };

    void restoreConnection().catch(() => {
      if (isCurrent()) setIsInitializingLocalFS(false);
      if (!cancelled) setIsChatListHydrated(true);
    });
    return () => {
      cancelled = true;
      providerGenerationRef.current += 1;
      pendingWorkspaceDirRef.current = null;
    };
  }, [isSupported, isAuthLoading, buildChatScopeId, getSanitizedWorkspaceName, syncProjectsFromDisk, syncChatsWithDisk, activateChatScope, user?.uid]);

  // Cross-tab sync bridge. Another tab's writes to the shared localStorage
  // registry/indexes fire only the DOM `storage` event in this tab — nothing
  // listened to it, so tabs drifted until the next disk poll. Re-broadcast the
  // app's internal update events (all listeners are idempotent re-reads) and
  // adopt the chat list into state. No loop risk: `storage` never fires in the
  // tab that performed the write.
  useEffect(() => {
    const mergeIncomingChatMetadata = (payload: any) => {
      if (!payload || payload.scopeId !== chatScopeIdRef.current) return;
      const incomingRecords = validateSyncRecords(payload.records);
      const incomingTimestamps = validateTimestampMap(payload.timestamps);
      const incomingChats = validateChatList(payload.chats);
      chatSyncRecordsRef.current = mergeSyncRecords(chatSyncRecordsRef.current, incomingRecords);
      for (const [chatId, timestamp] of Object.entries(incomingTimestamps)) {
        chatTimestampsRef.current[chatId] = Math.max(chatTimestampsRef.current[chatId] || 0, timestamp);
      }
      localChatsRef.current = Array.from(new Set([...localChatsRef.current, ...incomingChats]));
      persistChatMetadata(false);
    };

    try {
      chatBroadcastRef.current?.close();
      chatBroadcastRef.current = typeof BroadcastChannel === 'function'
        ? new BroadcastChannel(`willow-chat-sync:${chatScopeId}`)
        : null;
      if (chatBroadcastRef.current) chatBroadcastRef.current.onmessage = (event) => mergeIncomingChatMetadata(event.data);
    } catch {
      chatBroadcastRef.current = null;
    }

    const onStorage = (e: StorageEvent) => {
      try {
        if (isActiveProjectRegistryStorageKey(e.key)) {
          window.dispatchEvent(new Event('willow_projects_updated'));
        } else if (e.key === 'willow_media_index') {
          window.dispatchEvent(new Event('willow_media_updated'));
        } else if (e.key === chatMetadataKeysRef.current.chats ||
                   e.key === chatMetadataKeysRef.current.timestamps ||
                   e.key === chatMetadataKeysRef.current.sync) {
          mergeIncomingChatMetadata({
            scopeId: chatScopeIdRef.current,
            chats: readJSON(chatMetadataKeysRef.current.chats, []),
            timestamps: readJSON(chatMetadataKeysRef.current.timestamps, {}),
            records: readJSON(chatMetadataKeysRef.current.sync, {}),
          });
        }
      } catch {}
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      try { chatBroadcastRef.current?.close(); } catch {}
      chatBroadcastRef.current = null;
    };
  }, [chatScopeId, mergeSyncRecords, persistChatMetadata]);

  /**
   * Connect to a local folder by opening the folder picker
   */
  const connectLocalFolder = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      return false;
    }

    try {
      setIsInitializingLocalFS(true);
      setIsLocalFolderAuthorized(false);
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });

      // Verify write access
      const hasPermission = await verifyPermission(handle, true);
      if (!hasPermission) {
        setIsInitializingLocalFS(false);
        return false;
      }

      // Store handle in IndexedDB
      const rootId = await storeDirectoryHandle(handle);
      
      await activateChatScope(rootId);
      directoryHandleRef.current = handle;
      setLocalFolderName(handle.name);
      setIsLocalFolderConnected(true);

      // Refresh chats list and sync cached chats to disk. Connect is an explicit
      // user gesture on a chosen folder, so creating the workspace scaffold here
      // is intended (unlike the passive restore path above).
      try {
        const workspaceName = getSanitizedWorkspaceName();
        const workspaceDir = await handle.getDirectoryHandle(workspaceName, { create: true });
        // Explicitly connecting is the one place where registered areas may
        // create their workspace folders. Read-only reconciliation never does.
        for (const area of getProjectAreas()) {
          if (area.ensureOnConnect) await workspaceDir.getDirectoryHandle(area.folder, { create: true });
        }
        await syncChatsWithDisk(workspaceDir);

        // Recover & re-tag projects from disk (self-healing registry).
        await syncProjectsFromDisk(workspaceDir);
      } catch (err) {
        console.error('Error syncing chats to connected folder', err);
      }

      setIsLocalFolderAuthorized(true);
      setIsInitializingLocalFS(false);
      return true;
    } catch (err) {
      setIsInitializingLocalFS(false);
      return false;
    }
  }, [isSupported, getSanitizedWorkspaceName, syncProjectsFromDisk, syncChatsWithDisk, activateChatScope]);

  /**
   * Disconnect local folder and clean up IndexedDB
   */
  const disconnectLocalFolder = useCallback(async (): Promise<void> => {
    try {
      // Invalidate in-flight reconciliation/writes before clearing the active
      // handle. The catalog in IndexedDB is intentionally retained so a later
      // re-selection can recover the same stable root ID.
      providerGenerationRef.current += 1;
      pendingWorkspaceDirRef.current = null;
      await removeStoredDirectoryHandle();
      directoryHandleRef.current = null;
      setLocalFolderName(null);
      setIsLocalFolderConnected(false);
      setIsLocalFolderAuthorized(false);
      setLocalChats([]);
      localChatsRef.current = [];
      setActiveChatId(null);
      await activateChatScope('browser');
    } catch (err) {
    }
  }, [activateChatScope]);

  /**
   * Authorize / prompt for directory permission in a user gesture context
   */
  const authorizeLocalFolder = useCallback(async (): Promise<boolean> => {
    const handle = directoryHandleRef.current;
    if (!handle) return false;

    try {
      setIsInitializingLocalFS(true);
      setIsLocalFolderAuthorized(false);
      const hasAccess = await verifyPermission(handle, true, true);
      if (hasAccess) {
        // Refresh chats list and sync cached chats to disk. Like the restore
        // path, never CREATE the workspace folder here — if it's absent (e.g.
        // the profile's workspace name hasn't loaded yet), skip the sync; the
        // realtime watcher and save paths pick it up once it exists.
        try {
          const workspaceName = getSanitizedWorkspaceName();
          let workspaceDir: FileSystemDirectoryHandle | null = null;
          try {
            workspaceDir = await handle.getDirectoryHandle(workspaceName);
          } catch {}
          if (workspaceDir) {
            await syncChatsWithDisk(workspaceDir);

            // Recover & re-tag projects from disk (self-healing registry).
            await syncProjectsFromDisk(workspaceDir);
          }
        } catch (err) {
          console.error('Error syncing chats during authorization', err);
        }
        setIsLocalFolderAuthorized(true);
        setIsInitializingLocalFS(false);
        return true;
      }
    } catch {}
    setIsInitializingLocalFS(false);
    return false;
  }, [getSanitizedWorkspaceName, syncProjectsFromDisk, syncChatsWithDisk]);

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

  /*
   * Point Saved Info at the user's folder.
   *
   * The instructions are the user's own words about themselves, so they belong
   * in the folder they chose alongside their chats and media rather than in
   * browser storage. `saved-info-store` cannot reach in here — it sits in
   * `@willow/core`, below this package — so the two disk operations are handed
   * to it and it writes through on every edit.
   *
   * Waiting for the profile is the whole reason this is its own effect rather
   * than a line in the restore above. Attaching runs a one-time migration write
   * for anyone whose instructions are still only in localStorage, and
   * `getSanitizedWorkspaceName()` answers "My Willow" until the profile lands —
   * writing before then creates a folder under the fallback name, which is the
   * junk-folder bug the restore path documents. A signed-out user has no profile
   * to wait for and "My Willow" is their real workspace name.
   *
   * Placed after `getActiveHandle` deliberately: it is in the dependency array,
   * which is evaluated during render, so an effect written above the callback
   * would throw on its own initializer.
   */
  useEffect(() => {
    if (isAuthLoading) return;
    if (user && !userProfile) return;
    if (!isLocalFolderConnected || !isLocalFolderAuthorized) {
      // No folder to write to: the store keeps its localStorage mirror.
      void attachSavedInfoDisk(null);
      return;
    }
    const deps = { getActiveHandle, getSanitizedWorkspaceName };
    void attachSavedInfoDisk({
      load: () => readSavedInfoFromDisk(deps),
      save: (state) => writeSavedInfoToDisk(deps, state),
      remove: () => deleteSavedInfoFromDisk(deps),
    });
  }, [
    isAuthLoading,
    user,
    userProfile,
    isLocalFolderConnected,
    isLocalFolderAuthorized,
    getActiveHandle,
    getSanitizedWorkspaceName,
  ]);

  // Disk write lives in ./code-disk; this wrapper keeps the context value
  // identity and dependency array exactly as they were.
  const saveLocalFSProjectInner = useCallback((projectName: string, files: FileContent[]): Promise<boolean> => (
    saveProjectFilesToDisk({ getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }, projectName, files)
  ), [ensureProjectManifest, getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName]);

  const saveLocalFSProject = useCallback((projectName: string, files: FileContent[]): Promise<boolean> => {
    const queueKey = resolveCurrentProjectName(projectName);
    const scopeId = chatScopeIdRef.current;
    const snapshot = files.map((file) => ({ ...file }));
    const previous = projectSaveQueuesRef.current.get(queueKey) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() => {
        if (chatScopeIdRef.current !== scopeId || isProjectSaveBlocked(queueKey, scopeId)) return false;
        const locks = (navigator as any).locks;
        if (!locks?.request) return saveLocalFSProjectInner(queueKey, snapshot);
        return locks.request(`willow-project:${scopeId}:${queueKey}`, () => {
          if (chatScopeIdRef.current !== scopeId || isProjectSaveBlocked(queueKey, scopeId)) return false;
          return saveLocalFSProjectInner(queueKey, snapshot);
        });
      });
    const settled = run.then(() => undefined, () => undefined);
    projectSaveQueuesRef.current.set(queueKey, settled);
    void settled.finally(() => {
      if (projectSaveQueuesRef.current.get(queueKey) === settled) {
        projectSaveQueuesRef.current.delete(queueKey);
      }
    });
    return run;
  }, [resolveCurrentProjectName, saveLocalFSProjectInner]);

  const saveLocalFSDesignProject = useCallback((projectName: string, files: FileContent[]): Promise<boolean> => {
    const queueKey = `design:${resolveCurrentProjectName(projectName)}`;
    const scopeId = chatScopeIdRef.current;
    const snapshot = files.map((file) => ({ ...file }));
    const previous = projectSaveQueuesRef.current.get(queueKey) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => {
      if (chatScopeIdRef.current !== scopeId || isProjectSaveBlocked(projectName, scopeId)) return false;
      return saveDesignProjectToDisk(
        { getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName },
        projectName,
        snapshot,
      );
    });
    const settled = run.then(() => undefined, () => undefined);
    projectSaveQueuesRef.current.set(queueKey, settled);
    void settled.finally(() => {
      if (projectSaveQueuesRef.current.get(queueKey) === settled) projectSaveQueuesRef.current.delete(queueKey);
    });
    return run;
  }, [getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName]);

  /**
   * Load an existing code project from disk. `null` means the folder is missing
   * or unavailable; an empty array is a valid, intentionally empty Codebase.
   * Reads share the project queue/lock with saves, renames, and deletes so a
   * reopen can never observe a half-pruned or half-moved tree.
   */
  const loadLocalFSProject = useCallback((projectName: string): Promise<FileContent[] | null> => {
    if (!projectName) return Promise.resolve(null);
    const scopeId = chatScopeIdRef.current;
    const queueKey = resolveCurrentProjectName(projectName);
    const predecessor = projectSaveQueuesRef.current.get(queueKey) ?? Promise.resolve();
    const readProject = async (): Promise<FileContent[] | null> => {
      if (chatScopeIdRef.current !== scopeId || isProjectSaveBlocked(queueKey, scopeId)) return null;
      const rootHandle = await getActiveHandle();
      if (!rootHandle || chatScopeIdRef.current !== scopeId) return null;
      try {
        const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName());
        const codeDir = await workspaceDir.getDirectoryHandle(getProjectAreaFolder('code'));
        const projectDir = await codeDir.getDirectoryHandle(queueKey);
        const codebaseDir = await projectDir.getDirectoryHandle('Codebase');
        const files = await readFilesRecursively(codebaseDir);
        return chatScopeIdRef.current === scopeId ? files : null;
      } catch (error: any) {
        if (error?.name !== 'NotFoundError') {
          console.error('Failed to load project from local folder:', error);
        }
        return null;
      }
    };
    const run = predecessor
      .catch(() => undefined)
      .then(() => {
        const locks = (navigator as any).locks;
        if (!locks?.request) return readProject();
        return locks.request(`willow-project:${scopeId}:${queueKey}`, readProject);
      });
    const settled = run.then(() => undefined, () => undefined);
    projectSaveQueuesRef.current.set(queueKey, settled);
    void settled.finally(() => {
      if (projectSaveQueuesRef.current.get(queueKey) === settled) projectSaveQueuesRef.current.delete(queueKey);
    });
    return run;
  }, [getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName]);

  /**
   * Save general chat history locally
   */
  const saveLocalFSChat = useCallback(async (chatId: string, messages: any[], oldChatId?: string | null): Promise<boolean> => {
    chatId = chatId.replace(/[\/:*?"<>|]/g, '').trim();
    if (!chatId || !Array.isArray(messages)) return false;
    const previousId = oldChatId && oldChatId !== chatId ? oldChatId : null;

    return enqueueChatOperation([chatId, previousId || ''], async () => {
      const previousRecord = previousId ? chatSyncRecordsRef.current[previousId] : undefined;
      const isFirstRename = !!previousId && !previousRecord?.tombstone;
      const targetRecord = chatSyncRecordsRef.current[chatId];
      if (isFirstRename && localChatsRef.current.includes(chatId) && !targetRecord?.tombstone) return false;

      const rootHandle = await getActiveHandle();
      /*
       * Where this chat's file belongs. Resolved once, before anything is
       * written, and `previousId` is what carries a notebook across the temp-id →
       * title rename: the record for the new title does not exist yet, and the
       * notebook registry may not have caught up either (`ChatView` files the
       * chat from an effect).
       */
      const notebookId = chatNotebookId(chatId, previousId);
      let targetDir: FileSystemDirectoryHandle | null = null;
      let previousDir: FileSystemDirectoryHandle | null = null;
      if (rootHandle) {
        try {
          const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName(), { create: true });
          targetDir = await resolveChatDir(workspaceDir, notebookId, { create: true });
          // The old name's file is wherever it was written, which is a different
          // folder only if the chat was filed while the rename was in flight.
          const previousNotebookId = previousRecord ? previousRecord.notebookId : notebookId;
          previousDir = previousNotebookId === notebookId
            ? targetDir
            : await resolveChatDir(workspaceDir, previousNotebookId, { create: false });
          if (isFirstRename && targetDir) {
            try {
              await targetDir.getFileHandle(`${chatId}.json`);
              return false;
            } catch (error: any) {
              if (error?.name && error.name !== 'NotFoundError') return false;
            }
          }
        } catch {
          targetDir = null;
        }
      }

      const previousChats = [...localChatsRef.current];
      const previousTargetTimestamp = chatTimestampsRef.current[chatId];
      const previousOldTimestamp = previousId ? chatTimestampsRef.current[previousId] : undefined;
      const now = Date.now();
      const revision = nextChatRevision(chatId);
      chatSyncRecordsRef.current[chatId] = {
        revision,
        diskRevision: targetRecord?.diskRevision || 0,
        diskMtime: targetRecord?.diskMtime || 0,
        dirty: true,
        tombstone: false,
        updatedAt: now,
        notebookId,
        /*
         * Carried, not cleared. This write lands in the folder the record wants,
         * but it says nothing about a file a failed move may have left behind
         * elsewhere, so the intent stays until the reconciler has seen the file
         * where it belongs and cleared it.
         */
        locationDirty: targetRecord?.locationDirty === true,
      };
      updateScopedChatTimestamp(chatId, now);
      if (!localChatsRef.current.includes(chatId)) localChatsRef.current.push(chatId);

      if (previousId) {
        const oldRevision = nextChatRevision(previousId);
        chatSyncRecordsRef.current[previousId] = {
          revision: oldRevision,
          diskRevision: previousRecord?.diskRevision || 0,
          diskMtime: previousRecord?.diskMtime || 0,
          dirty: false,
          tombstone: true,
          updatedAt: now,
          notebookId: previousRecord?.notebookId || '',
          locationDirty: false,
        };
        localChatsRef.current = localChatsRef.current.filter((id) => id !== previousId);
        delete chatTimestampsRef.current[previousId];
      }
      try {
        await saveChatBody(chatId, messages, chatStorageScopeRef.current);
        if (previousId) await deleteChatBody(previousId, chatStorageScopeRef.current);
      } catch (error) {
        if (targetRecord) chatSyncRecordsRef.current[chatId] = targetRecord;
        else delete chatSyncRecordsRef.current[chatId];
        if (previousId) {
          if (previousRecord) chatSyncRecordsRef.current[previousId] = previousRecord;
          else delete chatSyncRecordsRef.current[previousId];
        }
        localChatsRef.current = previousChats;
        if (previousTargetTimestamp === undefined) delete chatTimestampsRef.current[chatId];
        else chatTimestampsRef.current[chatId] = previousTargetTimestamp;
        if (previousId) {
          if (previousOldTimestamp === undefined) delete chatTimestampsRef.current[previousId];
          else chatTimestampsRef.current[previousId] = previousOldTimestamp;
        }
        persistChatMetadata();
        console.error('Failed to save chat body', error);
        return false;
      }
      persistChatMetadata();

      // The chat id has now actually moved (new body written, old one deleted).
      // Announced so module-level owners of in-flight work can follow it — a
      // background chat turn is registered under the id it started on, and the
      // temp -> title adoption below happens mid-stream. `setActiveChatId`
      // deliberately declines when the user is viewing another chat, so it is
      // not a usable signal for this.
      if (previousId) {
        window.dispatchEvent(new CustomEvent('willow_chat_id_moved', {
          detail: { from: previousId, to: chatId },
        }));
      }

      setActiveChatId((current) => current === null || current === previousId ? chatId : current);
      if (!targetDir) return true;

      try {
        await writeFileRecursively(targetDir, `${chatId}.json`, JSON.stringify(messages, null, 2));
        if (previousId && previousDir) {
          try { await previousDir.removeEntry(`${previousId}.json`); } catch {}
        }
        const written = await (await targetDir.getFileHandle(`${chatId}.json`)).getFile();
        const latest = chatSyncRecordsRef.current[chatId];
        if (latest?.revision === revision) {
          chatSyncRecordsRef.current[chatId] = {
            ...latest,
            diskRevision: revision,
            diskMtime: written.lastModified,
            dirty: false,
            updatedAt: Date.now(),
          };
          persistChatMetadata();
        }
      } catch {
        // IndexedDB succeeded; the durable dirty revision is retried later.
      }
      return true;
    });
  }, [enqueueChatOperation, getActiveHandle, getSanitizedWorkspaceName, nextChatRevision, persistChatMetadata, updateScopedChatTimestamp, chatNotebookId, resolveChatDir]);

  // Disk write lives in ./code-disk (see saveLocalFSProjectInner).
  const saveLocalFSProjectChat = useCallback((projectName: string, chatId: string, messages: any[], oldChatId?: string | null): Promise<boolean> => (
    saveProjectChatToDisk({ getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }, projectName, chatId, messages, oldChatId)
  ), [getActiveHandle, getSanitizedWorkspaceName]);

  // Disk write lives in ./media-disk; this wrapper keeps the context value
  // identity and dependency array exactly as they were.
  const saveLocalFSMediaInner = useCallback((projectName: string, kind: 'image' | 'video' | 'audio', fileName: string, blob: Blob): Promise<string | null> => (
    saveMediaFileToDisk({ getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }, projectName, kind, fileName, blob)
  ), [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Read a single media file from a project's Images/ or Videos/ folder on disk
   * and return a streaming blob: URL for display. The CALLER OWNS the returned
   * URL and must URL.revokeObjectURL() it when done (e.g. on project change /
   * unmount) to avoid leaks. Returns null if the folder/permission/file is
   * unavailable. This is the disk-as-source read path: heavy bytes live on disk,
   * not in IndexedDB, and are streamed via blob URLs.
   */
  const loadLocalFSMediaUrl = useCallback(async (projectName: string, kind: 'image' | 'video' | 'audio', fsName: string): Promise<string | null> => {
    if (!projectName || !fsName) return null;
    const handle = directoryHandleRef.current;
    if (!handle) return null;
    try {
      const hasAccess = await verifyPermission(handle, false, false);
      if (!hasAccess) return null;
      const workspaceName = getSanitizedWorkspaceName();
      // Pure read: don't create folders while resolving a file for display.
      // Redirect through any in-flight rename so hydration keeps working the
      // instant a project is renamed.
      const targetName = resolveCurrentProjectName(projectName);
      const workspaceDir = await handle.getDirectoryHandle(workspaceName);
      const mediaDir = await workspaceDir.getDirectoryHandle(getProjectAreaFolder('media'));
      const projectDir = await mediaDir.getDirectoryHandle(targetName);
      const subDir = await projectDir.getDirectoryHandle(kind === 'image' ? 'Images' : kind === 'video' ? 'Videos' : 'Audio');
      const fileHandle = await subDir.getFileHandle(fsName);
      const file = await fileHandle.getFile();
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }, [getSanitizedWorkspaceName]);

  const deleteLocalFSMediaFile = useCallback((projectName: string, kind: 'image' | 'video' | 'audio', fsName: string): Promise<boolean> => (
    deleteMediaFileFromDisk({ getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }, projectName, kind, fsName)
  ), [getActiveHandle, getSanitizedWorkspaceName]);

  const renameLocalFSMediaFile = useCallback((projectName: string, kind: 'image' | 'video' | 'audio', oldFsName: string, newBaseName: string): Promise<string | null> => (
    renameMediaFileOnDisk({ getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }, projectName, kind, oldFsName, newBaseName)
  ), [getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName]);

  /*
   * ── Notebooks on disk ────────────────────────────────────────────────────────
   *
   * Thin wrappers over ./notebooks-disk, in the same shape as the media ones
   * above. What they add on top of the driver is the two things that need the
   * registry, and so cannot live in the storage layer:
   *
   *  - resolving the notebook's folder name (and assigning one the first time),
   *  - holding the rename guard, since a notebook rename moves every chat file the
   *    notebook owns.
   *
   * The registry stays authoritative for whether a notebook EXISTS — notebooks
   * work with no folder connected, which is why every one of these returns a
   * failure value instead of throwing when there is no handle.
   */

  /**
   * The notebook's folder name, minting one on first use.
   *
   * Gated on a live handle on purpose: `ensureNotebookFolderName` persists the
   * name it picks, and a name recorded with no folder behind it would have the
   * reconciler scanning a directory that was never created.
   */
  const notebookFolderNameFor = useCallback(async (notebookId: string): Promise<string> => {
    if (!notebookId) return '';
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return '';
    return ensureNotebookFolderName(notebookId);
  }, [getActiveHandle]);

  /** The folder name a notebook already has. Never mints one — for delete paths. */
  const existingNotebookFolderName = (notebookId: string): string => (
    notebookId ? readNotebooks().find((entry) => entry.id === notebookId)?.fsFolder || '' : ''
  );

  const ensureLocalFSNotebookDir = useCallback(async (notebookId: string): Promise<boolean> => {
    const folderName = await notebookFolderNameFor(notebookId);
    if (!folderName) return false;
    const dir = await ensureNotebookDir({ getActiveHandle, getSanitizedWorkspaceName }, folderName, notebookId);
    return !!dir;
  }, [getActiveHandle, getSanitizedWorkspaceName, notebookFolderNameFor]);

  /**
   * Write one source into the notebook's `Sources/` folder and return the file
   * name it got — which the caller must store on the source, since collisions are
   * resolved with a `(1)` suffix and a name derived again later would not match.
   */
  const saveLocalFSNotebookSource = useCallback(async (notebookId: string, payload: NotebookSourcePayload): Promise<string | null> => {
    const folderName = await notebookFolderNameFor(notebookId);
    if (!folderName) return null;
    return saveNotebookSourceToDisk({ getActiveHandle, getSanitizedWorkspaceName }, folderName, notebookId, payload);
  }, [getActiveHandle, getSanitizedWorkspaceName, notebookFolderNameFor]);

  const deleteLocalFSNotebookSource = useCallback(async (notebookId: string, fsName: string): Promise<boolean> => {
    const folderName = existingNotebookFolderName(notebookId);
    if (!folderName || !fsName) return false;
    return deleteNotebookSourceFromDisk({ getActiveHandle, getSanitizedWorkspaceName }, folderName, fsName);
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Move the notebook's folder to match its (already renamed) title, and return
   * the new folder name.
   *
   * Reads the new title from the registry rather than taking it as an argument, so
   * the folder name can only ever be derived from what was actually persisted.
   * **Call this only when the title really changed**: a folder rename copies every
   * chat file the notebook owns, so running it on a no-op rename is a lot of I/O
   * for nothing.
   *
   * A notebook with no folder yet returns null and is left alone — the next write
   * creates the folder under the new title.
   */
  const renameLocalFSNotebookFolder = useCallback(async (notebookId: string): Promise<string | null> => {
    const notebooks = readNotebooks();
    const notebook = notebooks.find((entry) => entry.id === notebookId);
    const oldName = notebook?.fsFolder || '';
    if (!notebook || !oldName) return null;
    const newName = deriveNotebookFolderName(notebook, notebooks);
    if (!newName || newName === oldName) return null;
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return null;

    notebookRenameOpsRef.current++;
    try {
      const moved = await renameNotebookFolder({ getActiveHandle, getSanitizedWorkspaceName }, oldName, newName);
      if (!moved) return null;
      // Recorded only once the move has landed: this name is what every later
      // lookup resolves through, so writing it early points every read — and the
      // reconciler — at a folder that does not exist yet.
      setNotebookFolderName(notebookId, newName);
      return newName;
    } finally {
      notebookRenameOpsRef.current--;
      // Keep the guard up briefly after the move, so the observer's last debounced
      // event cannot land on a reconcile. Same 800ms the project rename uses.
      notebookRenameSettleUntilRef.current = Date.now() + 800;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Remove a deleted notebook's folder. Refuses while its `Chats/` still holds
   * files — deleting a notebook is a grouping decision, not a decision to delete
   * conversations, so the caller unfiles them first.
   */
  const deleteLocalFSNotebookFolder = useCallback(async (notebookId: string): Promise<boolean> => {
    const folderName = existingNotebookFolderName(notebookId);
    if (!folderName) return false;
    return deleteNotebookFolder({ getActiveHandle, getSanitizedWorkspaceName }, folderName);
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  /**
   * Bring a workspace that predates this mirror up to the shape on disk, one poll
   * at a time.
   *
   * Every notebook in a workspace created before `Notebooks/` existed has no
   * folder, its sources exist only in localStorage, and its chats' files are all
   * still in the global `Chats/`. None of those are errors and none of them are
   * repaired by the live write paths, because those only run when the user touches
   * something. So the poll walks the registry and closes each gap once.
   *
   * **Change-only (invariant 7).** Each of the three halves is guarded by the
   * absence of the thing it writes — no `fsFolder`, no `fsName`, a record that
   * disagrees — so a workspace already in the target shape performs zero writes,
   * fires no events and re-renders nothing. That matters more here than anywhere
   * else in this file: this runs every 3 seconds.
   *
   * **Only ever in the registry -> record direction.** It files chats the registry
   * says are filed; it never unfiles one because the registry does not mention it.
   * A registry that reads as empty — a scope switch mid-poll, a cleared
   * localStorage — must not be able to move every notebook chat back to the global
   * folder (invariant 5's rule applied to moves). The reverse direction already has
   * an owner: the reconciler adopts the location the **file** is in, which is why
   * this runs after it and re-reads the index rather than reusing a snapshot taken
   * before it.
   */
  const backfillNotebooksToDisk = useCallback(async (workspaceDir: FileSystemDirectoryHandle): Promise<void> => {
    /*
     * A rename is a folder copy followed by a folder delete, so for its duration
     * `fsFolder` names a directory that is half-there or already gone. A source
     * written into it lands in the copy that is about to be deleted. Skipping
     * costs one poll; the settle window is the same one the delete pass uses.
     */
    if (notebookRenameOpsRef.current > 0 || Date.now() < notebookRenameSettleUntilRef.current) return;

    const notebooks = readNotebooks();

    // ── 1. Folders ─────────────────────────────────────────────────────────────
    // Only notebooks that have never been assigned one. A folder the user deleted
    // by hand is deliberately NOT rebuilt here: that would be a per-notebook
    // directory probe on every poll forever, and the next write into it rebuilds
    // it anyway (`resolveChatDir` and `saveLocalFSNotebookSource` both create).
    for (const notebook of notebooks) {
      if (notebook.fsFolder) continue;
      const folderName = ensureNotebookFolderName(notebook.id);
      if (!folderName) continue;
      await ensureNotebookDirIn(workspaceDir, folderName, notebook.id);
    }

    // ── 2. Sources ─────────────────────────────────────────────────────────────
    for (const notebook of notebooks) {
      for (const source of notebook.sources) {
        if (source.fsName) continue;
        /*
         * Nothing to write is not a failure. A large upload keeps only its name
         * and type — the bytes were over the inline cap and the text could not be
         * extracted — and a 0-byte file named after someone's lecture notes reads
         * as data loss. Left without an `fsName`, which costs this in-memory
         * check per poll and no writes.
         */
        const blob = source.dataUrl ? dataUrlToBlob(source.dataUrl) : null;
        if (!blob && !source.content?.trim() && !source.url) continue;
        const fsName = await saveLocalFSNotebookSource(notebook.id, {
          title: source.title,
          kind: source.kind,
          blob,
          content: source.content,
          url: source.url,
        });
        if (fsName) setNotebookSourceFsName(notebook.id, source.id, fsName);
      }
    }

    // ── 3. Chat locations ──────────────────────────────────────────────────────
    /*
     * Read after the reconcile above, so an adoption it just made is already in
     * here and this pass agrees with it instead of moving the file back.
     *
     * Only the intent is recorded; the file is moved by the reconciler on the next
     * poll. Not merely to keep one mover — `moveLocalFSChatToNotebook` derives the
     * source folder from `record.notebookId`, and that is the exact field this pass
     * exists to correct, so it would be asking a stale value where to move from.
     * The reconciler moves from the directory it just *found* the file in, which is
     * the only trustworthy answer. It also re-reads the moved file's mtime, without
     * which the next poll reads the move as an external edit forever (invariant 7).
     *
     * A record already carrying the flag is left alone: the intent is outstanding,
     * and restating it would reset `updatedAt` on every poll until the move landed.
     */
    const { chatOwner } = readNotebookChatIndex();
    for (const [chatId, notebookId] of Object.entries(chatOwner)) {
      const record = chatSyncRecordsRef.current[chatId];
      // No record at all means no file has ever been written under this id, and
      // `chatNotebookId` already prefers the registry in that case — the first
      // write lands in the notebook's folder with nothing to migrate.
      if (!record || record.tombstone) continue;
      if (record.notebookId === notebookId || record.locationDirty) continue;
      await enqueueChatOperation([chatId], async () => {
        // Re-read inside the queue: a filing made while this pass walked the rest
        // of the registry has already written both halves correctly.
        const latest = chatSyncRecordsRef.current[chatId];
        if (!latest || latest.tombstone) return;
        if (latest.notebookId === notebookId || latest.locationDirty) return;
        chatSyncRecordsRef.current[chatId] = {
          ...latest,
          notebookId,
          locationDirty: true,
          updatedAt: Date.now(),
        };
        persistChatMetadata();
      });
    }
  }, [enqueueChatOperation, persistChatMetadata, saveLocalFSNotebookSource]);

  /**
   * File a chat into a notebook, or back out of one, by moving its file.
   *
   * `null` means the global `Chats/` folder. The registry half of filing belongs
   * to the notebooks store; this is only the disk half, and the two are joined by
   * `useNotebookDisk` so no caller has to remember there are two.
   *
   * The intent is recorded **before** the move and only cleared after it lands, so
   * an interruption is retried by the reconciler rather than lost — the same
   * durable-dirty contract content writes have (invariant 11). Which means the
   * return value is "did the file move now", not "did the filing take": with no
   * folder connected there is nothing to move and the answer is still yes.
   */
  const moveLocalFSChatToNotebook = useCallback(async (chatId: string, notebookId: string | null): Promise<boolean> => {
    if (!chatId) return false;
    const wanted = notebookId || '';

    return await enqueueChatOperation([chatId], async () => {
      const record = chatSyncRecordsRef.current[chatId];
      if (record?.tombstone) return false;

      const from = record ? record.notebookId : chatNotebookId(chatId);
      const now = Date.now();
      /*
       * `revision` is deliberately untouched: it tracks CONTENT, and bumping it
       * would make the local copy look newer than what disk has — i.e. dirty —
       * and schedule a body rewrite for a move. `updatedAt` is what lets another
       * tab's merge prefer this record at an equal revision.
       */
      chatSyncRecordsRef.current[chatId] = {
        revision: record?.revision || 0,
        diskRevision: record?.diskRevision || 0,
        diskMtime: record?.diskMtime || 0,
        dirty: record?.dirty === true,
        tombstone: false,
        updatedAt: now,
        notebookId: wanted,
        locationDirty: true,
      };
      persistChatMetadata();

      const rootHandle = await getActiveHandle();
      if (!rootHandle) {
        // No folder connected: nothing to move, and the intent is already stored.
        // It is completed by the reconciler the next time a folder is connected.
        return true;
      }

      let moved = false;
      let movedMtime = 0;
      try {
        const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName(), { create: true });
        // Source resolved without `create`: if the old folder is not there the
        // file is not either, and fabricating it would leave an empty stray.
        const fromDir = await resolveChatDir(workspaceDir, from, { create: false });
        const toDir = await resolveChatDir(workspaceDir, wanted, { create: true });
        if (fromDir && toDir) {
          moved = await moveFileBetweenDirs(fromDir, toDir, `${chatId}.json`);
          if (moved) {
            // Re-read the mtime a copy-then-delete move gave the file, or the
            // next poll reads the move as an external edit and reloads the body
            // on every tick (invariant 7).
            try { movedMtime = (await (await toDir.getFileHandle(`${chatId}.json`)).getFile()).lastModified; } catch {}
          }
        }
      } catch {}

      if (!moved) {
        // `locationDirty` stays set; the reconciler completes it on the next poll.
        return false;
      }

      const latest = chatSyncRecordsRef.current[chatId];
      if (latest && latest.notebookId === wanted) {
        chatSyncRecordsRef.current[chatId] = {
          ...latest,
          diskMtime: movedMtime || latest.diskMtime,
          locationDirty: false,
          updatedAt: Date.now(),
        };
        persistChatMetadata();
      }
      return true;
    }) ?? false;
  }, [enqueueChatOperation, getActiveHandle, getSanitizedWorkspaceName, persistChatMetadata, chatNotebookId, resolveChatDir]);

  /**
   * Rename a project folder on disk so it stays in lock-step with a UI rename
   * (otherwise the disk-authoritative reconciler would revert the new name).
   * Renames in Code/ and/or Media/ — wherever the project lives.
   *
   * The boolean means "disk now agrees with the new name", NOT "a folder was
   * moved". A project that has no folder in any area satisfies that vacuously
   * and answers true — see the empty-`sourceParents` case below for why the
   * distinction is load-bearing. False is reserved for a folder that exists and
   * could not be moved, which is the only case a caller must roll back for.
   *
   * Uses the native
   * FileSystemHandle.move() when available, falling back to a safe recursive
   * copy-then-delete (the original is only removed AFTER a complete copy, so an
   * interrupted rename can never lose data). The .willow.json manifest travels
   * with the folder, preserving the project id (and thus its covers/media).
   *
   * CASE-ONLY renames ("my film" → "My Film") need special care: Chromium has
   * never implemented directory move(), so folder renames ALWAYS take the
   * copy-then-delete fallback — and on case-insensitive filesystems
   * (Windows/macOS) getDirectoryHandle(newName) resolves to the SAME directory
   * as oldName. The naive fallback then self-copied the folder and
   * removeEntry(oldName) DELETED the one-and-only copy, after which the
   * disk-authoritative reconciler purged the project's registry row and
   * IndexedDB data. Detected via isSameEntry and routed through an
   * intermediate temp folder (old → tmp → new), so the data always exists in
   * at least one complete copy.
   */
  const renameLocalFSProjectInner = useCallback(async (oldName: string, newName: string): Promise<boolean> => {
    newName = newName.replace(/[\/:*?"<>|]/g, '').trim();
    if (!oldName || !newName || oldName === newName) return false;
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return false;

    const copyDir = async (src: any, dst: any): Promise<void> => {
      for await (const entry of src.values()) {
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          const fh = await dst.getFileHandle(entry.name, { create: true });
          const w = await fh.createWritable();
          await file.stream().pipeTo(w);
        } else if (entry.kind === 'directory') {
          const sub = await dst.getDirectoryHandle(entry.name, { create: true });
          await copyDir(entry, sub);
        }
      }
    };

    const renameIn = async (
      parent: FileSystemDirectoryHandle,
      fromName = oldName,
      toName = newName,
    ): Promise<boolean> => {
      let oldHandle: any;
      try {
        oldHandle = await parent.getDirectoryHandle(fromName);
      } catch {
        return false; // project doesn't live in this parent
      }
      // Prefer a native move/rename — atomic and instant. (Not implemented for
      // directories in Chromium to date, but harmless to attempt.)
      if (typeof oldHandle.move === 'function') {
        try { await oldHandle.move(toName); return true; } catch {}
      }
      // Fallback: full recursive copy, THEN delete the original.
      const newHandle = await parent.getDirectoryHandle(toName, { create: true });
      // Same-entry guard (case-insensitive filesystems): copying a folder into
      // itself and deleting "the old one" would destroy the project. Route
      // through a temp sibling instead: copy old→tmp, delete old (same entry
      // as new), recreate new with the requested casing, copy tmp→new, drop tmp.
      let sameEntry = false;
      try { sameEntry = await oldHandle.isSameEntry(newHandle); } catch {}
      if (sameEntry) {
        const tmpName = `${toName}.willow-rename-${crypto.randomUUID?.() || Date.now().toString(36)}`;
        const tmpHandle = await parent.getDirectoryHandle(tmpName, { create: true });
        await copyDir(oldHandle, tmpHandle);
        await parent.removeEntry(fromName, { recursive: true });
        const finalHandle = await parent.getDirectoryHandle(toName, { create: true });
        await copyDir(tmpHandle, finalHandle);
        await parent.removeEntry(tmpName, { recursive: true });
        return true;
      }
      await copyDir(oldHandle, newHandle);
      await parent.removeEntry(fromName, { recursive: true });
      return true;
    };

    projectRenameOpsRef.current++;
    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName).catch((error: any) => {
        if (error?.name === 'NotFoundError') return null;
        throw error;
      });
      // Nothing has ever been written under this root, so no project has a
      // folder here to keep in lock-step. Same reasoning as the empty
      // `sourceParents` case below.
      if (!workspaceDir) return true;
      const sourceParents: FileSystemDirectoryHandle[] = [];
      for (const parentName of getProjectAreas().map((area) => area.folder)) {
        try {
          const parent = await workspaceDir.getDirectoryHandle(parentName);
          const source = await parent.getDirectoryHandle(oldName);
          sourceParents.push(parent);
          try {
            const destination = await parent.getDirectoryHandle(newName);
            if (!(await source.isSameEntry(destination))) return false;
          } catch (error: any) {
            if (error?.name && error.name !== 'NotFoundError') return false;
          }
        } catch (error: any) {
          if (error?.name !== 'NotFoundError') return false;
        }
      }
      // No folder in any project area: this project has never been saved to
      // disk. A media project's folder is created by the first file written
      // into it, so an empty one is the ordinary case here, not an error.
      //
      // This must not report false. `transactionalRenameProject` reads false as
      // a failed disk move and rolls the entire rename back, which is why
      // renaming an untouched Media project snapped straight back to its old
      // name the moment it was committed. Nothing reverts the registry after
      // this returns either: the reconciler only drops a row whose folder is
      // missing when `onDisk === true`, and a browser-only project is exactly
      // the row that guard protects.
      if (sourceParents.length === 0) return true;
      // A compensating rollback is itself a rename (new→old). Remove the
      // immediately preceding reverse redirect (old→new) before recording it,
      // otherwise resolveCurrentProjectName follows a two-node cycle and later
      // autosaves can target the wrong side of the rolled-back move.
      const reverseRedirect = recentProjectRenamesRef.current.get(newName);
      if (reverseRedirect?.newName === oldName) recentProjectRenamesRef.current.delete(newName);
      recentProjectRenamesRef.current.set(oldName, { newName, ts: Date.now() });
      const completedParents: FileSystemDirectoryHandle[] = [];
      let renameFailed = false;
      for (const parent of sourceParents) {
        try {
          const ok = await renameIn(parent);
          if (ok) completedParents.push(parent);
          else renameFailed = true;
        } catch {
          renameFailed = true;
        }
      }
      if (renameFailed || completedParents.length !== sourceParents.length) {
        for (const parent of [...completedParents].reverse()) {
          try { await renameIn(parent, newName, oldName); } catch {}
        }
        recentProjectRenamesRef.current.delete(oldName);
        return false;
      }
      // Invalidate the cached id for the old folder name; the new name is read fresh.
      manifestIdCacheRef.current.delete(oldName);
      return true;
    } catch (err) {
      console.error('Error renaming project folder', err);
      recentProjectRenamesRef.current.delete(oldName);
      return false;
    } finally {
      projectRenameOpsRef.current--;
      projectRenameSettleUntilRef.current = Date.now() + 800;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  const saveLocalFSMedia = useCallback((projectName: string, kind: 'image' | 'video' | 'audio', fileName: string, blob: Blob): Promise<string | null> => {
    const scopeId = chatScopeIdRef.current;
    const queueKey = resolveCurrentProjectName(projectName);
    const predecessor = projectSaveQueuesRef.current.get(queueKey) ?? Promise.resolve();
    const run = predecessor
      .catch(() => undefined)
      .then(async () => {
        if (chatScopeIdRef.current !== scopeId) return null;
        const locks = (navigator as any).locks;
        if (!locks?.request) return saveLocalFSMediaInner(queueKey, kind, fileName, blob);
        return locks.request(`willow-project:${scopeId}:${queueKey}`, () => {
          if (chatScopeIdRef.current !== scopeId) return null;
          return saveLocalFSMediaInner(queueKey, kind, fileName, blob);
        });
      });
    const settled = run.then(() => undefined, () => undefined);
    projectSaveQueuesRef.current.set(queueKey, settled);
    void settled.finally(() => {
      if (projectSaveQueuesRef.current.get(queueKey) === settled) {
        projectSaveQueuesRef.current.delete(queueKey);
        window.setTimeout(() => window.dispatchEvent(new Event('willow_disk_changed')), 350);
      }
    });
    return run;
  }, [resolveCurrentProjectName, saveLocalFSMediaInner]);

  const renameLocalFSProject = useCallback((oldName: string, newName: string): Promise<boolean> => {
    const keys = Array.from(new Set([
      resolveCurrentProjectName(oldName),
      resolveCurrentProjectName(newName),
    ])).sort();
    const predecessors = keys
      .map((key) => projectSaveQueuesRef.current.get(key))
      .filter(Boolean) as Promise<unknown>[];
    const withLocks = async (index = 0): Promise<boolean> => {
      const locks = (navigator as any).locks;
      if (!locks?.request || index >= keys.length) return renameLocalFSProjectInner(oldName, newName);
      return locks.request(`willow-project:${chatScopeIdRef.current}:${keys[index]}`, () => withLocks(index + 1));
    };
    const run = Promise.allSettled(predecessors).then(() => withLocks());
    const settled = run.then(() => undefined, () => undefined);
    for (const key of keys) projectSaveQueuesRef.current.set(key, settled);
    void settled.finally(() => {
      for (const key of keys) {
        if (projectSaveQueuesRef.current.get(key) === settled) projectSaveQueuesRef.current.delete(key);
      }
    });
    return run;
  }, [renameLocalFSProjectInner, resolveCurrentProjectName]);

  const saveLocalFSCover = useCallback((projectName: string, url: string): Promise<boolean> => (
    saveProjectCoverToDisk({ getActiveHandle, getSanitizedWorkspaceName, resolveCurrentProjectName }, projectName, url)
  ), [getActiveHandle, getSanitizedWorkspaceName, ensureProjectManifest]);

  /**
   * Generate a chat title using the user's default chat naming model.
   *
   * The assistant reply is optional: chat naming must not depend on a finished
   * response, or a chat whose first reply the user stopped can never be named.
   */
  const generateChatTitle = useCallback(
    (userMessage: string, assistantMessage?: string): Promise<string> =>
      generateChatTitleWith(modelConfig, apiKeys, userMessage, assistantMessage),
    [apiKeys, modelConfig],
  );
  const generateChatDescription = useCallback(
    (userMessage: string, assistantMessage?: string): Promise<string> =>
      generateChatDescriptionWith(modelConfig, apiKeys, userMessage, assistantMessage),
    [apiKeys, modelConfig],
  );

  /**
   * Select local inbox chat
   */
  const selectLocalFSInboxChat = useCallback((chatId: string | null) => {
    // The ONLY user-initiated selection. Renames, temp-id adoption, deletes and
    // scope switches all call setActiveChatId directly and must not bump this —
    // ChatView blanks the conversation area on a bump, and blanking a chat the
    // user is reading because it got renamed is a regression, not a load.
    bumpChatSelectionEpoch();
    setActiveChatId(chatId);
  }, []);

  /**
   * Load messages of a specific local chat
   */
  const loadLocalFSChat = useCallback(async (chatId: string): Promise<any[] | null> => {
    return enqueueChatOperation([chatId], async () => {
      const record = chatSyncRecordsRef.current[chatId];
      if (record?.tombstone) return null;
      let cached: any[] | null = null;
      try { cached = await loadChatBody(chatId, chatStorageScopeRef.current); } catch {}
      if (record?.dirty) return cached;
      const rootHandle = await getActiveHandle();
      if (!rootHandle) return cached;
      try {
        const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName());
        // No `create` on a read path: fabricating a folder here once made every
        // cached chat look externally deleted. A filed chat whose notebook folder
        // is missing simply reads as "not on disk" and the cached body stands.
        const chatsDir = await resolveChatDir(workspaceDir, chatNotebookId(chatId), { create: false });
        if (!chatsDir) return cached;
        const file = await (await chatsDir.getFileHandle(`${chatId}.json`)).getFile();
        if (cached && record?.diskMtime === file.lastModified) return cached;
        const parsed = JSON.parse(await file.text());
        if (!Array.isArray(parsed)) return cached;
        await saveChatBody(chatId, parsed, chatStorageScopeRef.current);
        const revision = Math.max(record?.revision || 0, record?.diskRevision || 0);
        chatSyncRecordsRef.current[chatId] = {
          revision,
          diskRevision: revision,
          diskMtime: file.lastModified,
          dirty: false,
          tombstone: false,
          updatedAt: Date.now(),
          // Read from the folder the record already named, so the location is
          // confirmed rather than changed.
          notebookId: record?.notebookId || '',
          locationDirty: false,
        };
        chatTimestampsRef.current[chatId] = file.lastModified;
        if (!localChatsRef.current.includes(chatId)) localChatsRef.current.push(chatId);
        persistChatMetadata();
        return parsed;
      } catch {
        return cached;
      }
    });
  }, [enqueueChatOperation, getActiveHandle, getSanitizedWorkspaceName, persistChatMetadata, chatNotebookId, resolveChatDir]);

  /*
   * Point the personal profile at the same folder, and start the builder.
   *
   * Split from the Saved Info effect even though the conditions are identical,
   * because this one does a second thing: it hands the runtime a way to read
   * chats, then schedules a build. Folding the two together would mean a change
   * to either concern re-runs both, and re-running this one re-reads every chat.
   *
   * Placed here rather than beside Saved Info because it depends on
   * `loadLocalFSChat`, which is declared above — an effect written earlier would
   * reference it before its initializer runs.
   *
   * The same wait applies and for the same reason: `getSanitizedWorkspaceName()`
   * answers "My Willow" until the profile lands, and a write before then creates
   * a junk folder.
   */
  useEffect(() => {
    if (isAuthLoading) return;
    if (user && !userProfile) return;
    if (!isLocalFolderConnected || !isLocalFolderAuthorized) {
      // No folder: the profile keeps its localStorage mirror, and nothing builds.
      // A build reads chats off disk, and there is no disk to read.
      void attachProfileDisk(null);
      detachPersonalRuntime();
      return;
    }

    const deps = { getActiveHandle, getSanitizedWorkspaceName };
    void attachProfileDisk({
      load: () => readProfileFromDisk(deps) as Promise<Partial<ProfileState> | null>,
      save: (state) => writeProfileToDisk(deps, state),
      remove: () => deleteProfileFromDisk(deps),
    });

    attachPersonalRuntime({
      // Read through refs, so the runtime sees the current scope's chats even
      // though this attach happened once. `list` is the sorted, tombstone-free
      // list the sidebar shows, which is exactly the set a build should read.
      chats: {
        list: async () => localChatsRef.current.map((chatId) => ({
          chatId,
          updatedAt: chatTimestampsRef.current[chatId] ?? 0,
        })),
        load: (chatId) => loadLocalFSChat(chatId),
      },
      // A function, not a captured value: a key added after boot is then picked
      // up by the next build without re-attaching. That is also why `apiKeys` is
      // absent from the dependency array below — including it would restart the
      // scheduler on every keystroke in the API-key field.
      getApiKeys: () => apiKeysRef.current,
      // The Personal Intelligence row in Settings → Models & API. `auto` — the
      // default, and what the row shows until the user pins a model — resolves
      // here, against the same saved-models list the settings screen shows, so
      // the builder and the UI cannot disagree about which model is running.
      // This takes a key check, which is why the row's helper lives here instead
      // of in the settings screen: the runtime is the one that knows the key.
      getExtractModelId: () => {
        const systemDefault = modelConfigRef.current?.systemDefaults?.personalIntelligence;
        const models = Object.entries(modelConfigRef.current ?? {})
          .filter(([key]) => key !== 'systemDefaults')
          .flatMap(([provider, config]: [string, any]) =>
            (config?.savedModels || []).map((model: any) => ({
              ...model,
              provider,
            })),
          );
        const hasKey = (provider: AutoSelectProvider): boolean => {
          const key = apiKeysRef.current?.[provider]?.[0];
          return typeof key === 'string' && key.trim().length > 0;
        };
        return resolveAutoModel(systemDefault, models, hasKey)?.modelId;
      },
    });

    // Hands back its own canceller, so a folder or scope change drops a build
    // that was scheduled but has not started.
    const cancelScheduledBuild = schedulePersonalBuild();
    return () => {
      cancelScheduledBuild();
      detachPersonalRuntime();
    };
  }, [
    isAuthLoading,
    user,
    userProfile,
    isLocalFolderConnected,
    isLocalFolderAuthorized,
    getActiveHandle,
    getSanitizedWorkspaceName,
    loadLocalFSChat,
  ]);

  /** Heavy attachment bytes live in IndexedDB next to chat bodies, never in localStorage. */
  const saveLocalFSChatAttachment = useCallback(async (
    attachment: ChatAttachment,
    blob: Blob,
  ): Promise<boolean> => {
    try {
      await saveChatAttachment(attachment, blob, chatStorageScopeRef.current);
      return true;
    } catch (error) {
      console.error('Unable to save local chat attachment', error);
      return false;
    }
  }, []);

  const loadLocalFSChatAttachment = useCallback(async (
    attachmentId: string,
  ): Promise<StoredChatAttachment | null> => {
    try {
      return await loadChatAttachment(attachmentId, chatStorageScopeRef.current);
    } catch (error) {
      console.error('Unable to load local chat attachment', error);
      return null;
    }
  }, []);

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
      // Never CREATE the workspace on a read/reconcile path. If it's missing
      // (not created yet, externally moved, or the profile's real name hasn't
      // loaded), abort as a no-op — fabricating an empty workspace here made
      // every cached chat look externally-deleted and reaped their bodies.
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName);
      await syncChatsWithDisk(workspaceDir);
    } catch (err: any) {
      // A missing workspace folder is the expected no-op case (see above), not
      // an error worth spamming every poll tick.
      if (err?.name !== 'NotFoundError') {
        console.error('Error refreshing local chats', err);
      }
    }
  }, [getSanitizedWorkspaceName, syncChatsWithDisk]);

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
  const refreshLocalMedia = useCallback(async (projectId: string, projectName: string, liveItems?: any[]): Promise<any[]> => {
    const scopeIdAtStart = chatScopeIdRef.current;
    const generationAtStart = providerGenerationRef.current;
    const scopeIsCurrent = () => chatScopeIdRef.current === scopeIdAtStart && providerGenerationRef.current === generationAtStart;
    // Overlay the caller's LIVE in-memory items over what IndexedDB has. The
    // gallery's IndexedDB persist is debounced (~600ms) while the disk watcher
    // reconciles ~300ms after a file lands — so right after a generation batch
    // completes, the stored record still shows the items as 'generating' with
    // no fsName (or missing entirely). Matching disk files against that stale
    // record degraded to prompt-matching, and a batch shares ONE prompt — the
    // files paired with the WRONG items (tiles visibly swapped/rearranged) and
    // the mangled mapping was then persisted. Live state is the truth the UI
    // holds; by-id it always wins, and live-only items are appended so a
    // just-completed, not-yet-persisted item can't be dropped or re-ingested
    // as an anonymous "External Source" tile.
    const loadBaseline = async (): Promise<any[]> => {
      const stored = (await loadProjectMedia(projectId, scopeIdAtStart)) || [];
      if (!scopeIsCurrent()) return [];
      if (!liveItems || liveItems.length === 0) return stored;
      const liveById = new Map(liveItems.filter((m: any) => m?.id).map((m: any) => [m.id, m]));
      const merged = stored.map((m: any) => liveById.get(m?.id) ?? m);
      const storedIds = new Set(stored.map((m: any) => m?.id));
      for (const m of liveItems) {
        if (m?.id && !storedIds.has(m.id)) merged.push(m);
      }
      return merged;
    };

    const rootHandle = directoryHandleRef.current;
    if (!rootHandle) return await loadBaseline();

    try {
      const hasAccess = await verifyPermission(rootHandle, false, false);
      if (!scopeIsCurrent()) return [];
      if (!hasAccess) return await loadBaseline();

      // INVARIANT #13 (STORAGE_SYNC.md): never reconcile while a project
      // folder is mid-rename (copy-then-delete). Scanning the target folder
      // half-copied makes every not-yet-copied file look externally deleted;
      // the saveProjectMedia below would PERSIST that loss, and the files
      // would later re-ingest as anonymous "External Source" items — the
      // user's prompts/model metadata gone for good. Serve IndexedDB as-is;
      // the realtime watcher reconciles once the move (+800ms settle) is done.
      if (projectRenameOpsRef.current > 0 || Date.now() < projectRenameSettleUntilRef.current) {
        return await loadBaseline();
      }

      const workspaceName = getSanitizedWorkspaceName();
      // Read-only reconcile: never create workspace/Media/project folders here.
      // A missing folder means "nothing on disk for this project" — fall through
      // to the catch and serve IndexedDB metadata as-is. Redirect through any
      // in-flight rename so a reconcile right after a rename reads the moved
      // folder instead of finding nothing.
      const targetName = resolveCurrentProjectName(projectName);
      if (projectSaveQueuesRef.current.has(targetName)) return await loadBaseline();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName);
      const mediaDir = await workspaceDir.getDirectoryHandle(getProjectAreaFolder('media'));
      const projectDir = await mediaDir.getDirectoryHandle(targetName);
      if (!scopeIsCurrent()) return [];

      const dbMedia = await loadBaseline();
      const onDisk: any[] = [];
      const consumedDbIds = new Set<string>();

      const scanFolder = async (folderName: string, kind: 'image' | 'video' | 'audio') => {
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
            // fsNames are only unique WITHIN a folder, so also require the item's
            // kind to match the folder being scanned — otherwise Images/X.png
            // could consume an audio item whose cover is Audio/X.png (flipping
            // its kind and losing the song from the music view). Both matchers
            // are consumed-guarded so one metadata item can never be claimed by
            // two disk files (which would push the same id twice — duplicate
            // tiles sharing a React key, with ambiguous rename/delete-by-id).
            const kindMatches = (m: any) => m.kind === kind || !m.kind;
            let existing = dbMedia.find((m: any) => !consumedDbIds.has(m.id) && m.fsName === fsName && kindMatches(m));
            if (!existing) {
              const promptCandidates = dbMedia.filter((m: any) =>
                !consumedDbIds.has(m.id) && kindMatches(m) &&
                (m.shortenedPrompt === matchName || m.prompt === matchName)
              );
              // Prompt matching is legacy-only. A bulk batch intentionally has
              // several items with the same prompt, so guessing among them
              // swaps IDs/timestamps and visibly rearranges generated tiles.
              if (promptCandidates.length === 1) existing = promptCandidates[0];
            }
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
      // Audio/ holds a song's on-disk artifact (MediaView writes the cover art
      // there; externally dropped song files land there too). Without this scan
      // a saved audio item matched nothing on disk, so the leftover filter below
      // (stripped url + isSavedToFS) DROPPED it — songs silently vanished from
      // the gallery on the first reconcile after save.
      await scanFolder('Audio', 'audio');
      if (!scopeIsCurrent()) return [];

      // Keep any item not matched to a disk file UNLESS it's a disk-backed item
      // whose bytes are gone (stripped url + isSavedToFS + file missing = a real
      // external delete). Items that still carry their bytes (a base64 `url`, or
      // `audioUrl` for songs — the audio itself lives in IndexedDB and must not
      // die with its on-disk cover art) or were never on disk (in-progress /
      // failed / pre-folder) are preserved — we never discard media we still hold.
      const leftover = dbMedia.filter((m: any) =>
        !consumedDbIds.has(m?.id) && (!!m?.url || !!m?.audioUrl || !m?.isSavedToFS)
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

      const merged = deduped.sort(compareMediaItemsNewestFirst);

      await saveProjectMedia(projectId, merged, scopeIdAtStart); // strips disk-backed bytes
      if (!scopeIsCurrent()) return [];
      return merged;
    } catch (err: any) {
      // Missing workspace/Media/<project> folder = nothing on disk yet for this
      // project (browser-only) — expected, not an error. Serve IndexedDB as-is.
      if (err?.name !== 'NotFoundError') {
        console.error('Error refreshing local media', err);
      }
      return await loadBaseline();
    }
  }, [getSanitizedWorkspaceName]);

  /**
   * Reconcile every folder a feature registered via `registerSyncedFolder`.
   *
   * This is the seam that means adding a synced data type does not mean editing
   * this file: the loop is over the registry, not over a hardcoded list of kinds.
   * Chats, Code and Media still have their own bespoke paths above for now (they
   * predate the registry and carry extra behaviour like project manifests), but
   * anything new should arrive here. See ARCHITECTURE.md §13.
   *
   * One folder failing must not stop the others, so each is isolated.
   */
  const syncRegisteredFolders = useCallback(async (workspaceDir: FileSystemDirectoryHandle): Promise<void> => {
    const folders = getSyncedFolders();
    if (folders.length === 0) return;
    const scopeId = chatScopeIdRef.current;
    for (const descriptor of folders) {
      try {
        await syncRegisteredFolder(workspaceDir, descriptor, scopeId);
      } catch (error) {
        console.error(`[storage] synced folder "${descriptor.folder}" failed to reconcile`, error);
      }
    }
  }, []);

  /**
   * Poll the workspace once: reconcile projects + chats against disk. Used by the
   * real-time watcher below and on focus/visibility changes. Re-entrancy guarded.
   */
  const pollDiskNow = useCallback(async (): Promise<void> => {
    if (isPollingRef.current) {
      pollPendingRef.current = true;
      return;
    }
    isPollingRef.current = true;
    try {
      do {
        pollPendingRef.current = false;
        const handle = directoryHandleRef.current;
        if (!handle) break;
        const hasAccess = await verifyPermission(handle, false, false);
        if (!hasAccess) break;
        const workspaceName = getSanitizedWorkspaceName();
        const workspaceDir = await handle.getDirectoryHandle(workspaceName);
        await syncProjectsFromDisk(workspaceDir);
        await refreshLocalChats();
        // After the reconcile, deliberately: the backfill files chats the
        // registry says are filed, and the reconcile adopts chats the *disk*
        // says are filed. Running it second means an adoption just made is
        // already visible here, so the two never fight over one chat.
        await backfillNotebooksToDisk(workspaceDir);
        await syncRegisteredFolders(workspaceDir);
      } while (pollPendingRef.current);
    } catch {
      // transient — next tick will retry
    } finally {
      isPollingRef.current = false;
    }
  }, [getSanitizedWorkspaceName, syncProjectsFromDisk, refreshLocalChats, backfillNotebooksToDisk, syncRegisteredFolders]);

  // Real-time disk watcher.
  // PRIMARY: FileSystemObserver (recent Chromium) gives true change events — when
  // anything under the workspace changes on disk we reconcile (debounced) and
  // broadcast `willow_disk_changed` so the media gallery can refresh too.
  // FALLBACK / BACKSTOP: a timer poll (rare when the observer is active, normal
  // cadence when it isn't) plus an immediate reconcile on focus/visibility — so it
  // works everywhere and can't miss a change.
  //
  // Our own `saveLocalFSChat` writes DO land on disk, so they do wake this
  // watcher. That is safe but not free: a reconcile can already be in flight,
  // holding a directory listing taken before our write, while that write
  // completes. Anything concluding a chat is gone must therefore re-check disk
  // instead of trusting that listing — see the external-deletion pass in
  // reconcileChatsWithDisk.
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
            // Observe-only: if the workspace folder doesn't exist yet, don't
            // create it — fall through to the polling backstop, which no-ops
            // until the folder appears (and this effect re-runs when the
            // profile's workspace name loads).
            const workspaceDir = await handle.getDirectoryHandle(workspaceName);
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
  }, [isSupported, isLocalFolderConnected, isLocalFolderAuthorized, pollDiskNow, getSanitizedWorkspaceName, chatScopeId]);

  /**
   * Delete a local chat file
   */
  const deleteLocalFSChat = useCallback(async (chatId: string): Promise<boolean> => {
    return enqueueChatOperation([chatId], async () => {
      const previous = chatSyncRecordsRef.current[chatId];
      const notebookId = chatNotebookId(chatId);
      const revision = nextChatRevision(chatId);
      chatSyncRecordsRef.current[chatId] = {
        revision,
        diskRevision: previous?.diskRevision || 0,
        diskMtime: previous?.diskMtime || 0,
        dirty: false,
        tombstone: true,
        updatedAt: Date.now(),
        notebookId,
        locationDirty: false,
      };
      localChatsRef.current = localChatsRef.current.filter((id) => id !== chatId);
      delete chatTimestampsRef.current[chatId];
      persistChatMetadata();
      /*
       * Unfiled from its notebook as part of the delete, for two reasons: the
       * notebook should not go on listing a conversation that no longer exists,
       * and a chat id IS its title, so the next chat the naming model calls the
       * same thing would take this id back and be born inside this notebook.
       */
      if (notebookId) adoptChatIntoNotebook(chatId, null);
      // Announced BEFORE the body is removed, so an in-flight turn for this chat
      // is aborted and discarded rather than saved. saveLocalFSChat clears the
      // tombstone and re-adds the id to the chat list, so a completion landing
      // after a delete would resurrect the chat in IndexedDB, in Recents and on
      // disk — and it would survive the reconciler, because the record is no
      // longer a tombstone.
      window.dispatchEvent(new CustomEvent('willow_chat_deleted', { detail: { chatId } }));
      try { await deleteChatBody(chatId, chatStorageScopeRef.current); } catch {}
      setActiveChatId((current) => current === chatId ? null : current);
      const rootHandle = await getActiveHandle();
      if (rootHandle) {
        try {
          const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName());
          const chatsDir = await resolveChatDir(workspaceDir, notebookId, { create: false });
          if (chatsDir) await chatsDir.removeEntry(`${chatId}.json`);
        } catch {
          // Tombstone remains and the reconciler retries — from whichever folder
          // the file actually turns up in, so a hand-moved file is still deleted.
        }
      }
      return true;
    });
  }, [enqueueChatOperation, getActiveHandle, getSanitizedWorkspaceName, nextChatRevision, persistChatMetadata, chatNotebookId, resolveChatDir]);

  const deleteLocalFSProjectInner = useCallback(async (_projectId: string, projectName: string): Promise<boolean> => {
    // Try deleting project folder from filesystem
    const rootHandle = await getActiveHandle();
    if (!rootHandle) return true; // No filesystem connected, just browser storage delete

    try {
      const workspaceName = getSanitizedWorkspaceName();
      const workspaceDir = await rootHandle.getDirectoryHandle(workspaceName);

      // Try deleting project folder from BOTH Media/ and Code/. A project can
      // live in both (media + code share the same folder name), so we must remove
      // it from every parent — returning after the first success left the other
      // folder on disk, and the disk-authoritative reconciler then re-added the
      // "deleted" project (it reappeared).
      let deletedAny = false;
      let deleteFailed = false;
      for (const folderName of getProjectAreas().map((area) => area.folder)) {
        try {
          const folderDir = await workspaceDir.getDirectoryHandle(folderName, { create: false });
          await folderDir.removeEntry(projectName, { recursive: true });
          console.log(`Deleted project folder: ${folderName}/${projectName}`);
          deletedAny = true;
        } catch (err: any) {
          if (err?.name !== 'NotFoundError') deleteFailed = true;
        }
      }

      // Drop the cached manifest id so a future project reusing this name is
      // re-read fresh rather than inheriting the deleted project's id.
      manifestIdCacheRef.current.delete(projectName);

      if (!deletedAny) {
        console.warn(`Project folder not found on disk: ${projectName}`);
      }
      return !deleteFailed;
    } catch (err) {
      console.error('Failed to delete project from filesystem:', err);
      return false;
    }
  }, [getActiveHandle, getSanitizedWorkspaceName]);

  const deleteLocalFSProject = useCallback((projectId: string, projectName: string): Promise<boolean> => {
    const scopeId = chatScopeIdRef.current;
    const queueKey = resolveCurrentProjectName(projectName);
    const predecessor = projectSaveQueuesRef.current.get(queueKey) ?? Promise.resolve();
    const run = predecessor
      .catch(() => undefined)
      .then(async () => {
        if (chatScopeIdRef.current !== scopeId) return false;
        const locks = (navigator as any).locks;
        if (!locks?.request) {
          const deleted = await deleteLocalFSProjectInner(projectId, queueKey);
          if (deleted) markProjectDeleted(queueKey, scopeId, projectId);
          return deleted;
        }
        return locks.request(`willow-project:${scopeId}:${queueKey}`, async () => {
          if (chatScopeIdRef.current !== scopeId) return false;
          const deleted = await deleteLocalFSProjectInner(projectId, queueKey);
          if (deleted) markProjectDeleted(queueKey, scopeId, projectId);
          return deleted;
        });
      });
    const settled = run.then(() => undefined, () => undefined);
    projectSaveQueuesRef.current.set(queueKey, settled);
    void settled.finally(() => {
      if (projectSaveQueuesRef.current.get(queueKey) === settled) projectSaveQueuesRef.current.delete(queueKey);
    });
    return run;
  }, [deleteLocalFSProjectInner, resolveCurrentProjectName]);

  /**
   * Rename a local chat file
   */
  const renameLocalFSChat = useCallback(async (oldChatId: string, newChatId: string): Promise<boolean> => {
    newChatId = newChatId.replace(/[\/:*?"<>|]/g, '').trim();
    if (!newChatId || newChatId === oldChatId) return false;
    return enqueueChatOperation([oldChatId, newChatId], async () => {
      const target = chatSyncRecordsRef.current[newChatId];
      if (localChatsRef.current.includes(newChatId) && !target?.tombstone) return false;
      const previousChats = [...localChatsRef.current];
      const previousOldTimestamp = chatTimestampsRef.current[oldChatId];
      const previousNewTimestamp = chatTimestampsRef.current[newChatId];

      const rootHandle = await getActiveHandle();
      // A rename keeps the chat in its notebook: the folder is decided by the old
      // id's record, and both files live in it.
      const notebookId = chatNotebookId(oldChatId);
      let chatsDir: FileSystemDirectoryHandle | null = null;
      if (rootHandle) {
        try {
          const workspaceDir = await rootHandle.getDirectoryHandle(getSanitizedWorkspaceName());
          chatsDir = await resolveChatDir(workspaceDir, notebookId, { create: false });
          if (chatsDir) {
            try {
              await chatsDir.getFileHandle(`${newChatId}.json`);
              return false;
            } catch (error: any) {
              if (error?.name && error.name !== 'NotFoundError') return false;
            }
          }
        } catch {
          chatsDir = null;
        }
      }

      const body = await loadChatBody(oldChatId, chatStorageScopeRef.current);
      if (!body) return false;
      const oldRecord = chatSyncRecordsRef.current[oldChatId];
      const now = Date.now();
      const newRevision = nextChatRevision(newChatId);
      chatSyncRecordsRef.current[newChatId] = {
        revision: newRevision,
        diskRevision: 0,
        diskMtime: 0,
        dirty: true,
        tombstone: false,
        updatedAt: now,
        notebookId,
        locationDirty: oldRecord?.locationDirty === true,
      };
      chatSyncRecordsRef.current[oldChatId] = {
        revision: nextChatRevision(oldChatId),
        diskRevision: oldRecord?.diskRevision || 0,
        diskMtime: oldRecord?.diskMtime || 0,
        dirty: false,
        tombstone: true,
        updatedAt: now,
        notebookId,
        locationDirty: false,
      };
      chatTimestampsRef.current[newChatId] = chatTimestampsRef.current[oldChatId] || now;
      delete chatTimestampsRef.current[oldChatId];
      localChatsRef.current = localChatsRef.current.filter((id) => id !== oldChatId);
      localChatsRef.current.push(newChatId);

      try {
        await renameChatBody(oldChatId, newChatId, chatStorageScopeRef.current);
      } catch {
        if (target) chatSyncRecordsRef.current[newChatId] = target;
        else delete chatSyncRecordsRef.current[newChatId];
        if (oldRecord) chatSyncRecordsRef.current[oldChatId] = oldRecord;
        else delete chatSyncRecordsRef.current[oldChatId];
        localChatsRef.current = previousChats;
        if (previousOldTimestamp === undefined) delete chatTimestampsRef.current[oldChatId];
        else chatTimestampsRef.current[oldChatId] = previousOldTimestamp;
        if (previousNewTimestamp === undefined) delete chatTimestampsRef.current[newChatId];
        else chatTimestampsRef.current[newChatId] = previousNewTimestamp;
        persistChatMetadata();
        return false;
      }
      persistChatMetadata();
      // See the matching dispatch in saveLocalFSChat: a turn generating in this
      // chat is keyed on the old id and has to follow the rename.
      window.dispatchEvent(new CustomEvent('willow_chat_id_moved', {
        detail: { from: oldChatId, to: newChatId },
      }));
      setActiveChatId((current) => current === oldChatId ? newChatId : current);
      if (chatsDir) {
        try {
          await writeFileRecursively(chatsDir, `${newChatId}.json`, JSON.stringify(body, null, 2));
          try { await chatsDir.removeEntry(`${oldChatId}.json`); } catch {}
          const written = await (await chatsDir.getFileHandle(`${newChatId}.json`)).getFile();
          const latest = chatSyncRecordsRef.current[newChatId];
          if (latest?.revision === newRevision) {
            chatSyncRecordsRef.current[newChatId] = {
              ...latest,
              diskRevision: newRevision,
              diskMtime: written.lastModified,
              dirty: false,
              updatedAt: Date.now(),
            };
            persistChatMetadata();
          }
        } catch {
          // Durable rename state will retry new-file write and old tombstone.
        }
      }
      return true;
    });
  }, [enqueueChatOperation, getActiveHandle, getSanitizedWorkspaceName, nextChatRevision, persistChatMetadata, chatNotebookId, resolveChatDir]);

  return (
    <LocalFSContext.Provider
      value={{
        chatScopeId,
        isSupported,
        isLocalFolderConnected,
        isLocalFolderAuthorized,
        localFolderName,
        connectLocalFolder,
        disconnectLocalFolder,
        authorizeLocalFolder,
        saveLocalFSProject,
        saveLocalFSDesignProject,
        loadLocalFSProject,
        saveLocalFSChat,
        saveLocalFSChatAttachment,
        loadLocalFSChatAttachment,
        saveLocalFSProjectChat,
        saveLocalFSMedia,
        deleteLocalFSMediaFile,
        renameLocalFSMediaFile,
        ensureLocalFSNotebookDir,
        saveLocalFSNotebookSource,
        deleteLocalFSNotebookSource,
        renameLocalFSNotebookFolder,
        deleteLocalFSNotebookFolder,
        moveLocalFSChatToNotebook,
        renameLocalFSProject,
        saveLocalFSCover,
        generateChatTitle,
        generateChatDescription,
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
        getChatTimestamp: getScopedChatTimestamp,
        isInitializingLocalFS,
        isChatListHydrated
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
