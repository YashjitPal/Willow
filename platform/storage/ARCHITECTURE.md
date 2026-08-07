# Willow Storage & Sync Architecture

> **Read this before touching anything under `src/adapters/local-disk.ts`,
> `src/media-storage.ts`, `src/indexeddb/willow-db.ts`, `src/local-fs/LocalFSContext.tsx`, or any
> component that reads `willow_projects_list`.** It documents the entire
> local-first storage + real-time sync system so it can be extended without
> regressions. The [Invariants](#11-invariants--rules-you-must-not-break) section
> lists the rules that, if broken, cause data loss — several were learned the
> hard way.

## Table of contents
1. [Mental model](#1-mental-model)
2. [Module map (who owns what)](#2-module-map-who-owns-what)
3. [Storage layers (exact keys/DBs/folders)](#3-storage-layers-exact)
4. [Data shapes](#4-data-shapes)
5. [Public APIs](#5-public-apis)
6. [On-disk layout](#6-on-disk-layout)
7. [Lifecycle flows (create / save / load / delete / rename)](#7-lifecycle-flows)
8. [Real-time sync engine](#8-real-time-sync-engine)
9. [Project kind tagging](#9-project-kind-tagging)
10. [The event bus](#10-the-event-bus)
11. [Invariants — rules you must not break](#11-invariants--rules-you-must-not-break)
12. [Known issues / tech debt](#12-known-issues--tech-debt)
13. [How to extend safely (recipes)](#13-how-to-extend-safely-recipes)
14. [Debugging snippets](#14-debugging-snippets)

---

## 1. Mental model

Willow is **local-first**. Three product modes — **Media**, **Chat**, **Code** —
persist data across **three layers**:

| Layer | Role | Quota |
|-------|------|-------|
| **localStorage** | lightweight metadata only (registry, indexes, flags, settings) | ~5 MB → keep tiny |
| **IndexedDB** | all heavy payloads (media base64, covers, chat bodies, code snapshots) | browser-managed quota; persistent storage is requested, but no web store is literally unlimited |
| **Disk** (File System Access API) | optional mirror into a real folder; **source of truth** for which projects exist, their kind, and their name | none |

Golden rule of the split: **localStorage = pointers/indexes; IndexedDB = heavy
bytes; Disk = truth.** When the disk is connected, it wins.

### Sync hardening (current implementation)

> Scope note: current project registries use `willow_projects_list:v2:<scope>`
> through `projectStorage.ts`; project deletion guards and code-session keys are
> scoped by the same user/root/workspace id. Any unscoped key names shown later
> describe legacy migration inputs, not keys new code may write.

- Chat metadata and bodies are scoped by authenticated user, stable selected-root
  id, and workspace name. Legacy global chat records are claimed by one scope
  during migration and are never replayed into another account or folder.
- Media records, covers, media indexes, Code-mode chat markers, and pinned chats
  use that same user/root/workspace scope. Legacy media is assigned to one
  authenticated scope; unowned marker/pin data is not copied across accounts.
- Chat changes use monotonic revisions plus durable `dirty` and `tombstone`
  records. A failed disk write stays retryable; it is never converted into an
  external deletion after a timeout.
- Startup completes one initial reconciliation before authorization enables the
  observer/poller. Chat operations and project snapshots are serialized locally
  and, where supported, coordinated across tabs with the Web Locks API.
- Existing disk chat files are compared by modification time. Clean external
  edits refresh IndexedDB and the active UI; conflicts with dirty local edits are
  preserved as separate conflict copies.
- IndexedDB mutation helpers resolve only after transaction commit. The selected
  directory record includes a stable root id, and large fallback file copies use
  streams rather than whole-file `ArrayBuffer` allocations.

---

## 2. Module map (who owns what)

| File | Responsibility |
|------|----------------|
| `src/adapters/local-disk.ts` | Low-level File System Access API helpers: persist/restore the directory handle (IndexedDB `WillowLocalFS`), permission checks, recursive file writes, and the per-project `.willow.json` manifest read/write. **No React, no business logic.** |
| `src/media-storage.ts` | `WillowMediaDB` IndexedDB: per-project media item lists + covers. Also owns project-kind helpers (`getMediaProjectIds`, `autoDetectProjectKinds`) and `deleteProjectData`. |
| `src/indexeddb/willow-db.ts` | `WillowDB` IndexedDB: chat message bodies (`chats`) and code editor sessions (`code_sessions`) with **content-addressed file-snapshot dedup** (`code_blobs`). Handles legacy-localStorage migration on read. |
| `src/local-fs/LocalFSContext.tsx` | The brain. Owns the directory handle, the connect/restore/authorize flows, all `saveLocalFS*`/`deleteLocalFS*`/`renameLocalFS*` operations, the **disk↔registry reconciler** (`syncProjectsFromDisk`), and the **real-time polling watcher** (`pollDiskNow` + effect). Exposes everything via `useLocalFS()`. |
| `src/synced-folders.ts` | **The registry a feature plugs into.** A feature declares one top-level workspace folder (`Gems/`) plus how an item serializes; nothing here knows which features exist. Top-level sibling of `src/project-contributors.ts`, which covers sub-folders *inside* one project. See [§13](#13-how-to-extend-safely-recipes). |
| `src/local-fs/folder-sync-engine.ts` | **The one reconcile algorithm**, shared by every registered folder. Pure: no React, no `FileSystemDirectoryHandle`, everything arrives through `FolderSyncPorts` — which is what makes the sync rules unit-testable instead of only reviewable. Owns revisions, tombstones, dirty flushes, conflict copies, and every delete-safety rule. |
| `src/local-fs/synced-folder-driver.ts` | Adapter binding a registered folder to a real directory handle: supplies the engine with disk I/O, localStorage-backed sync records (`willow_synced_*` keys), and the per-item in-tab + cross-tab lock. |
| `src/project-contributors.ts` | Registry for sub-folders *within* a saved project (`Code/<project>/Designs/`). Used by `features/design/src/register.ts`. |
| `apps/studio/src/app/App.tsx` | Mounts `<LocalFSProvider>` around **all** routes. Runs `migrateProjectKinds()` once on mount. Chooses which surface renders (`studioMode` = `chat` / `develop` / `media`; `currentView` = `home` / `projects` / `starred` / `shared`). |
| `features/media/src/MediaHome.tsx` | Media-home project grid (filtered to `kind:'media'`). Owns project rename (`persistProjectRename`) + delete + the "New project" button. |
| `features/media/src/MediaShowcase.tsx` | Media-home "showcase" (top 9 of `kind:'media'`). Star toggle + delete. |
| `features/projects/src/ProjectsPage.tsx` | "All projects" / Starred / Shared. Unfiltered registry. Star toggle + delete. |
| `features/media/src/MediaView.tsx` | The media editor for one project. Generates media, saves it, sets covers, and runs **real-time media-file sync** for the open project. |
| `features/code/src/WorkbenchView.tsx` + `WorkbenchSidebar.tsx` | The code editor. Creates code projects (`kind:'code'`); persists sessions via `saveCodeSessions`/`loadCodeSessions`. |

---

## 3. Storage layers (exact)

### 3a. localStorage keys
| Key | Shape | Owner |
|-----|-------|-------|
| `willow_projects_list` | `Reg[]` (see [§4](#4-data-shapes)) — the **project registry** | everyone reads; mutations centralized |
| `willow_local_chats:<scope>` | `string[]` of chat ids, scoped by user/root/workspace | LocalFSContext |
| `willow_chat_timestamps:<scope>` | `{ [chatId]: epochMs }` for newest-first sort | LocalFSContext |
| `willow_chat_sync_state:<scope>` | revisions, disk mtimes, dirty flags, tombstones | LocalFSContext |
| `willow_pinned_chats:v2:<scope>` | `string[]` of pinned chat ids | Sidebar |
| `willow_synced_ids:<folder>:<scope>` | `string[]` of item ids for one registered folder | syncedFolderDriver |
| `willow_synced_timestamps:<folder>:<scope>` | `{ [itemId]: epochMs }` | syncedFolderDriver |
| `willow_synced_state:<folder>:<scope>` | revisions, disk mtimes, dirty flags, tombstones (same shape as the chat equivalent) | syncedFolderDriver |
| `willow_media_index:<scope>` / `willow_media_index_meta:<scope>` | lightweight media counts + revision metadata | mediaStorage |
| `willow_code_chats:v2:<scope>` / `willow_code_chat_state:v2:<scope>:<chat>` | Code-mode markers and tombstones | codeChatStorage |
| `modelConfig`, `selectedModelId` | non-secret UI settings | settings UI |
| `googleAccessToken`, `googleDriveAccessToken`, `isDriveConnected` | legacy OAuth keys; removed on startup | AuthContext |

API keys/provider settings and Drive-scoped OAuth credentials are held only in
UID-scoped `sessionStorage` for the current tab; the basic Google login token is
never persisted by Willow. Legacy unscoped secret caches are deleted, not
adopted by the next signed-in account.

**Legacy keys (migrated then removed — do not write):**
- `willow_chat_<chatId>` → migrated into `WillowDB.chats` by `loadChatBody`.
- `willow_chat_sessions_<project>` → migrated into `WillowDB.code_sessions` by `loadCodeSessions`. NOTE: this string is still **reused as the IndexedDB key** for a project's sessions.
- `willow_project_media_<projectId>` → migrated into `WillowMediaDB.project_media` by `loadProjectMedia`.

### 3b. IndexedDB databases
| DB (version) | Store | Key | Value |
|---|---|---|---|
| **`WillowMediaDB`** (2) | `project_media` | `scope:<scope>:project:<projectId>` | `MediaItem[]` |
| | `project_covers` | `scope:<scope>:project:<projectId>` | cover string (base64 data URL) |
| **`WillowDB`** (3) | `chats` | scoped chat key | message array |
| | `chat_scope_claims` | legacy `chatId` | ownership claim for legacy bodies |
| | `code_sessions` | `willow_chat_sessions_<project>` | `ChatSession[]` (snapshots deflated to hashes) |
| | `code_blobs` | `<storageKey>\0<sha256>` | one unique file content (content-addressed) |
| **`WillowLocalFS`** (1) | `handles` | `local_projects_dir` | `{ handle, rootId }` |

> `WillowLocalFS` is how a "local folder" survives reload: a handle can't be
> JSON-serialized, but IndexedDB can store the live object. On reload we read it
> back and re-check permission.

### 3c. Disk — see [§6](#6-on-disk-layout).

---

## 4. Data shapes

```ts
// willow_projects_list entries (the registry)
type Reg = {
  id: string;            // "#NNNN" — stable; keys covers/media in IndexedDB
  name: string;          // == disk folder name when on disk
  kind?: 'media' | 'code';
  hasCover?: boolean;    // hint only; the real cover lives in project_covers
  isStarred?: boolean;
  onDisk?: boolean;      // set true once seen on disk; gates external-delete (see §8)
};

// .willow.json (per project folder)
type Manifest = { id: string };

// MediaItem (MediaView + project_media)
type MediaItem = {
  id: string;
  kind: 'image' | 'video';
  status: 'generating' | 'completed' | 'failed';
  url?: string;          // base64 data URL (images) or external URL (videos)
  prompt: string; shortenedPrompt?: string;
  modelId: string; modelName: string; ratio: string; timestamp: number;
  isSavedToFS?: boolean; // true once mirrored to the Media/<proj> folder
  fsName?: string;       // the on-disk filename (used to delete/dedupe)
};

// ChatSession (code mode, code_sessions) — filesSnapshot is deflated to hashes
// on disk and re-inflated on load; callers always see full path->content.
type ChatSession = { id: string; messages: any[]; filesSnapshot?: Record<string,string>; ... };
```

---

## 5. Public APIs

### 5a. `useLocalFS()` (src/local-fs/LocalFSContext.tsx)
State: `isSupported`, `isLocalFolderConnected`, `isLocalFolderAuthorized`,
`localFolderName`, `isInitializingLocalFS`, `localChats: string[]`, `activeChatId`.

Connection:
- `connectLocalFolder()` — opens the picker, stores handle, syncs chats + projects.
- `authorizeLocalFolder()` — interactive permission re-grant (called from App's Authorize modal); then syncs.
- `disconnectLocalFolder()` — clears handle from `WillowLocalFS` and resets state.

Saves (all write IndexedDB and/or disk; never heavy data to localStorage):
- `saveLocalFSProject(projectName, files)` — writes `Code/<p>/Codebase/*` + design nodes.
- `saveLocalFSChat(chatId, messages, oldChatId?)` — committed scoped body + durable dirty revision + disk file.
- `saveLocalFSProjectChat(projectName, chatId, messages, oldChatId?)` — per-project chat under `Code/<p>/Chat sessions/`.
- `saveLocalFSMedia(projectName, kind, fileName, blob)` — writes blob to `Media/<p>/Images|Videos/`, returns final filename (collision-suffixed).
- `saveLocalFSCover(projectName, url)` — writes a cover file next to Images/Videos.

Mutations:
- `deleteLocalFSChat(chatId)` — IndexedDB body + disk file.
- `deleteLocalFSProject(projectId, projectName)` — removes `Code/<name>` or `Media/<name>` (recursive). Pair with `deleteProjectData` for IndexedDB.
- `deleteLocalFSMediaFile(projectName, kind, fsName)` — removes one media file so the poller won't re-ingest it.
- `renameLocalFSProject(oldName, newName)` — renames the disk folder (native `move()` → recursive copy+delete fallback). Keeps disk in lock-step with a UI rename.
- `renameLocalFSChat(oldChatId, newChatId)` — collision-safe scoped IndexedDB + metadata + disk rename.

Reads / refresh:
- `loadLocalFSChat(chatId)` — IndexedDB first, disk fallback (re-caches).
- `refreshLocalChats()` — revision-aware reconciliation with dirty retries, external-edit detection, and tombstones.
- `refreshLocalMedia(projectName)` — reconcile `Media/<p>` files with `project_media`.
- `getChatTimestamp(chatId)`, `selectLocalFSInboxChat(chatId)`, `generateChatTitle(...)`.

**Internal (not on the interface, but central):** `syncProjectsFromDisk`,
`pollDiskNow`, `getActiveHandle`, `getSanitizedWorkspaceName`,
`getProjectIdByName`, `ensureProjectManifest`. Refs include
`chatSyncRecordsRef`, `chatOperationQueuesRef`, `isPollingRef`,
`pollPendingRef`, and `manifestIdCacheRef`.

### 5b. `src/media-storage.ts`
`saveProjectMedia(projectId, items)`, `loadProjectMedia(projectId)` (migrates
legacy localStorage), `saveProjectCover(projectId, url)` (**converts `blob:` and
external video URLs to base64** so covers survive reload), `loadProjectCover(id)`,
`loadAllProjectCovers()` → `{id: url}`, `deleteProjectData(id)` (media **and**
cover), `getMediaProjectIds()` → `Set<id>` with media, `autoDetectProjectKinds()`
(fallback tagging — fills missing only), `migrateProjectKinds()` (alias).

### 5c. `src/indexeddb/willow-db.ts`
`saveChatBody(chatId, messages)`, `loadChatBody(chatId)` (migrates legacy),
`deleteChatBody(chatId)`, `renameChatBody(old, new)`,
`saveCodeSessions(storageKey, sessions)`, `loadCodeSessions(storageKey)`.

**Content-addressed dedup (code):** `saveCodeSessions` "deflates" each session's
`filesSnapshot` — every unique file content is stored once in `code_blobs`
(key = `<storageKey>\0<sha256>`), and the session keeps a `path → hash` manifest.
`loadCodeSessions` "inflates" back to full content, so callers never see hashes.
Unreferenced blobs are garbage-collected on save. A `hashCache` avoids re-hashing.
(`KEY_SEP` is a NUL byte `\u0000`; `KEY_MAX` is `￿` for prefix range scans —
both are cited here as escapes so this file stays greppable.)

### 5d. `src/adapters/local-disk.ts`
`isFSAAPISupported()`, `storeDirectoryHandle(h)`, `getStoredDirectoryHandle()`,
`removeStoredDirectoryHandle()`, `verifyPermission(h, readWrite, interactive)`,
`writeFileRecursively(rootDir, path, content)`, `readProjectManifest(dir)`,
`writeProjectManifest(dir, id)`.

---

## 6. On-disk layout

```
<user-picked folder>/
└── <Workspace Name>/                 // getSanitizedWorkspaceName():
    │                                 //   userProfile.workspaceName
    │                                 //   || "<FirstName>'s Willow" || "My Willow"
    ├── Chats/
    │   └── <chatId>.json             // inbox chats (chatId = generated title)
    ├── Code/
    │   └── <projectName>/
    │       ├── .willow.json          // { id } — the stable project id
    │       ├── Codebase/             // source files (wiped + rewritten each save)
    │       ├── Chat sessions/        // per-project chat <chatId>.json
    │       ├── Designs/              // <name>.tsx + <name>.json design nodes
    │       └── Agents/
    ├── Media/
    │   └── <projectName>/
    │       ├── .willow.json          // { id }
    │       ├── Images/  (+ Characters/)
    │       ├── Videos/
    │       ├── Scenes/               // reserved (created, not yet written)
    │       └── Music/                // reserved
    └── Gems/                         // registered via registerSyncedFolder
        └── <gemId>.json              // gemId = sanitized gem name
```

`Chats/`, `Code/` and `Media/` are hand-wired (they predate the registry).
`Gems/` is the first folder driven by `registerSyncedFolder`, and is the pattern
new folders should follow — see [§13](#13-how-to-extend-safely-recipes).

`kind` is decided by which parent the folder is under (`Code/` → code,
`Media/` → media). A folder present in **both** is treated as `code`.

---

## 7. Lifecycle flows

### Project create
- **Media:** MediaView materializes `{id, name, kind:'media'}` into the registry on
  first completed generation; `saveLocalFSMedia` writes the blob to disk →
  `Media/<name>/...`. The next poll sees the folder and sets `onDisk:true` (and
  writes the manifest with the registry id).
- **Code:** WorkbenchView pushes `{id, name, kind:'code'}`; autosave writes
  `Code/<name>/...`. Next poll sets `onDisk:true`.

### Save
- Media item → `saveProjectMedia(projectId, items)` (IndexedDB) + `saveLocalFSMedia` (disk) + cover.
- Chat → `saveLocalFSChat`: IndexedDB body (`saveChatBody`) → localStorage index/timestamp → disk `.json`.
- Code → `saveCodeSessions(storageKey, sessions)` (IndexedDB, deflated) + disk via autosave.

### Load
- Media: `refreshLocalMedia(name)` (disk→IndexedDB reconcile) then `loadProjectMedia`.
- Chat: `loadLocalFSChat` (IndexedDB → disk fallback).
- Code: `loadCodeSessions(storageKey)` (inflates snapshots; migrates legacy).

### Delete (project — three layers, all surfaces)
```
deleteProjectData(id)              // IndexedDB media + cover
deleteLocalFSProject(id, name)     // disk folder (Code/ or Media/)
// remove from willow_projects_list, then:
window.dispatchEvent(new Event('willow_projects_updated'))
```
Wired in HeroSection (trash icon), ProjectsPage + BottomPanel ("Delete" menu,
with a confirm). **Must remove the disk folder** — otherwise the reconciler
re-adds the project on the next poll.

### Delete (media item)
`onDelete` in MediaView removes from state, re-saves `project_media` (under both
projectName and projectId — see [§12](#12-known-issues--tech-debt)), **and**
`deleteLocalFSMediaFile` so the poller doesn't resurrect it. Wired to both the
hover "Delete card" button and the menu "Move to trash".

### Rename (project)
`persistProjectRename` (HeroSection): update registry name → dispatch →
`renameLocalFSProject(oldName, newName)` renames the disk folder. The manifest
(and thus id + covers/media) travels with the folder. If the disk rename fails,
the disk-authoritative reconciler reverts the registry name on the next poll, so
a rename only "sticks" when the folder actually moved.

---

## 8. Real-time sync engine

**Disk→UI sync:** PRIMARY is **`FileSystemObserver`** (recent Chromium) — a real
change-event watcher; FALLBACK is **poll + diff** (and both sync on focus/visibility),
so it works everywhere and can't miss a change.

### The watcher — `pollDiskNow` + its `useEffect` (LocalFSContext)
Runs only while connected **and** authorized. On connect it tries to attach a
`FileSystemObserver` on the workspace dir (`{recursive:true}`):
- **Observer present** → on any disk change, debounced (500ms) → `pollDiskNow()` +
  dispatch **`willow_disk_changed`**; the timer poll drops to a 30s safety backstop.
- **No observer** → timer poll **3s** visible / **20s** hidden.
- Either way: immediate reconcile on `focus` / `visibilitychange→visible`.
- Re-entrancy-guarded by `isPollingRef`.

Each reconcile: `verifyPermission` (non-interactive) → **projects**
(`syncProjectsFromDisk`) + **chats** (`refreshLocalChats`). `willow_disk_changed`
additionally tells `MediaView` to refresh the open gallery (see `MEDIA_STORAGE.md`).
No loop: our own writes only touch IndexedDB, not the disk reconcile.

> ⚠️ Do NOT re-introduce a *blind* per-project media reload **poll**. A media
> reload must be event-driven (`willow_disk_changed`), **debounced**, and
> **skipped while a generation is in flight** — otherwise it can clobber the
> gallery (this previously wiped media on video generation). See `MEDIA_STORAGE.md`.

### `syncProjectsFromDisk` — the reconciler (disk authoritative)
1. `collectDirs('Code')` and `collectDirs('Media')` → each returns
   `{ ok, map<name, handle> }`. **`ok:false` on any read error.**
2. **If either scan failed → return (NO deletions).** Hard safety rail.
3. Build `diskByName` (Code wins if a name is in both).
4. Resolve a stable id for each folder: manifest id → else registry id for that
   name → else mint `#NNNN`, persisting via `writeProjectManifest`. A
   `manifestIdCacheRef` (name→id) means steady-state polls do **no** per-file reads.
5. **Pass 1** over the registry: match by id (then name).
   - matched → keep, set `onDisk:true`, sync `kind` (and `name` on external rename).
   - not matched **and `onDisk` was true** → external delete → drop + `deleteProjectData(id)`.
   - not matched **and `onDisk` falsy** → browser-only → keep.
6. **Pass 2:** add disk folders no registry entry claimed (external create).
7. **Cover hydration:** for each media project lacking a durable still-IMAGE
   cover in `project_covers`, source one and store it (keyed by the project id,
   which is what the UI reads): (a) disk `cover.*`, (b) oldest file in `Images/`,
   (c) oldest file in `Videos/`, (d) oldest completed `project_media` item.
   **Covers are always still images** — any video source is run through
   `extractVideoFrame` to capture a single frame, and a canonical `cover.png` is
   written back to disk (replacing a stale `cover.mp4`). Skips only when a durable
   `data:image` cover already exists (a legacy `data:video` cover IS reprocessed
   into a frame). Once-per-project-per-session via `coverHydratedRef`.
8. Write registry (if changed) + dispatch `willow_projects_updated` (if registry
   or covers changed).

### Race guards (do not remove)
- **`onDisk` flag** — the gate that prevents deleting browser-only projects that
  were never on disk. Without it, every freshly-created (not-yet-saved) project
  would be deleted on the first poll.
- **Durable chat revisions** — committed local edits remain `dirty` until the
  disk write is acknowledged. Deletes use tombstones. There is no timeout after
  which a failed disk write can be mistaken for an external deletion.
- **Change-only writes** — reconciler + `refreshLocalChats` only `setState`/write
  when the set actually changed; MediaView compares a signature before
  `setMediaItems`. This is what stops idle 3s polls from re-rendering the sidebar
  or restarting cover videos.
- **Generation guard** — MediaView's media refresh bails if any item is
  `status:'generating'` (a reload would clobber in-progress items).

---

## 9. Project kind tagging

Priority order (so the two mechanisms never fight):
1. **`syncProjectsFromDisk` — AUTHORITATIVE.** Sets/repairs `kind` from the disk
   folder on every connect/restore/authorize/poll. Only overrides when the project
   is actually found on disk.
2. **`autoDetectProjectKinds` — FALLBACK ONLY.** Runs once on App mount; **fills
   missing tags only, never overrides.** Heuristic: media if it has IndexedDB media
   or an auto-generated name (`Project #NNNN` / a date), else code.
3. **Creation-time:** WorkbenchView → `code`; MediaView → `media`.

---

## 10. The event bus

Three DOM events coordinate the surfaces:

- **`willow_projects_updated`** — *fired by* every project mutation
  (create/rename/delete/star) and the reconciler, after writing
  `willow_projects_list`. *Listened by* `HeroSection`, `BottomPanel`,
  `ProjectsPage`, `MediaView` — each re-reads the registry + reloads covers.
- **`willow_media_updated`** — *fired by* `saveProjectMedia`/`deleteProjectData`
  after updating the realtime localStorage **media index**. *Listened by* the
  Media-tab surfaces (`HeroSection`, `BottomPanel`) so projects that gain/lose
  media appear/disappear from the Media tab live.
- **`willow_disk_changed`** — *fired by* the disk watcher (FileSystemObserver
  change, or focus/visibility) after `pollDiskNow`. *Listened by* `MediaView` to
  refresh the open gallery in realtime (debounced, skipped while generating).

Chats use React state (`localChats` from context) directly — no event needed.

---

## 11. Invariants — rules you must not break

1. **Never write a *filtered* project list back to `willow_projects_list`.**
   Surfaces that filter (HeroSection/BottomPanel show only `media`) must read the
   **full** registry, mutate it, and write the full thing. (Writing the filtered
   list erased all code projects — the worst bug we hit.)
2. **Heavy bytes never go in localStorage.** Media/covers → `WillowMediaDB`; chat
   bodies → `WillowDB.chats`; code snapshots → `WillowDB.code_sessions`/`code_blobs`.
3. **Disk is authoritative.** Any UI action that changes a project's existence,
   name, or kind must also change the disk (or it will be reverted by the
   reconciler). This is why delete removes the folder and rename moves the folder.
4. **Deletion gate:** only auto-delete a registry entry whose folder is gone **if
   `onDisk === true`.** Never delete browser-only entries.
5. **A failed/blocked folder scan performs zero deletions.** Keep the
   `if (!code.ok || !media.ok) return;` guard.
6. **Keep `manifest.id === registry.id`.** Covers/media are keyed by the registry
   id; the manifest carries it across renames/reconnects. If you write a manifest,
   use the registry id for that name.
7. **The poll must be idempotent and change-only.** No `setState`/storage write
   when nothing changed, or the UI re-renders/flickers every few seconds.
8. **Don't reconcile media while generating.** Guard on `status:'generating'`.
9. **Deleting a media item must delete its disk file** (`deleteLocalFSMediaFile`),
   else the poller re-ingests it.
10. **`autoDetectProjectKinds` fills missing tags only — never override.**
11. **Keep durable dirty revisions and tombstones.** Never replace them with a
    timeout-based grace window.
12. **`<LocalFSProvider>` must wrap every route** (it's in `apps/studio/src/app/App.tsx` around
    `<Routes>`). Any component calling `useLocalFS()` outside it throws.
13. **Rename must suppress disk-change reloads.** Renaming a project folder is
    async (native `move()` or recursive copy-then-delete). The `FileSystemObserver`
    fires multiple events mid-rename (folder deleted → folder created → files
    copied). If `loadMedia` runs during this window it reads partial/empty folder
    contents, causing images to vanish and the gallery layout to collapse.
    **Guard:** set a `renamingRef` flag before the disk rename starts, clear it
    ~800 ms after completion (lets the observer's last debounced event pass), and
    skip all disk-change-triggered `loadMedia` calls while it's true.
14. **Reuse existing `blob:` URLs when the underlying file hasn't changed.**
    When `loadMedia` hydrates disk-backed items it must check if the item's `id`
    and `fsName` match a currently-displayed item that already has a live
    `blob:` URL. If so, reuse that URL instead of creating a new one. Creating a
    new URL revokes the old one, which forces the browser to unload and reload
    the `<img>`, causing a masonry layout collapse and visible reflow.
15. **`loadMedia` must be change-only (structural diff gate).** After hydration,
    compare the incoming items against `mediaItemsRef.current` by ID (order-
    independent). If every item's `id`, `url`, `status`, `fsName`, `kind`,
    `prompt`, and `timestamp` are identical, skip `setMediaItems` entirely.
    Without this, each periodic disk poll triggers a React re-render and
    framer-motion `layout` animations that cause tiles to visibly reposition
    even though nothing changed on disk. (This is a refinement of invariant 7.)
16. **Never decide "this chat is unchanged" by loading its body.** In
    `reconcileChatsWithDisk`, the unchanged case must be settled with the mtime
    comparison plus `hasChatBody` (an IndexedDB *key* probe). `loadChatBody`
    deserializes the entire message array, so calling it before the change check
    made every startup read the whole history just to conclude nothing had
    changed — with a few hundred chats this froze the app until the pass
    finished, and repeated on every watcher tick and window focus.
    **The probe is not authoritative on absence.** A `false` result must still
    fall through to `loadChatBody`, because that is also what migrates a legacy
    `willow_chat_<id>` localStorage body. Skipping it there strands old data.
17. **The per-chat disk pass may run concurrently; the external-delete pass may
    not.** `enqueueChatOperation` already serializes by chat id and every id in
    the disk listing is distinct, so reconciling them through a bounded pool
    (`RECONCILE_CONCURRENCY`) is safe and is what keeps startup from scaling
    linearly with chat count. Wrap each task so one failure cannot abandon the
    rest of the pass. The **second** loop is different: it reassigns
    `localChatsRef.current` wholesale, so overlapping iterations can drop a
    concurrent `push` and lose a chat. Keep it a plain sequential `await` loop.
    Pinned by `apps/studio/test/chat-reconcile-race.test.mjs`.

---

## 12. Known issues / tech debt

- **Media storage is now disk-as-source (unified on `projectId`).** Heavy
  image/video bytes live on disk (`Media/<project>/Images|Videos`); IndexedDB
  keeps only metadata (`saveProjectMedia` strips bytes for disk-backed items), and
  the gallery hydrates streaming `blob:` URLs from disk. Base64 in IndexedDB is
  only the no-folder fallback. The previous `projectId` vs `projectName` split
  (which caused media to disappear) is resolved: IndexedDB is keyed by
  `projectId`, disk is located by `projectName`. **See `MEDIA_STORAGE.md` for the
  full model, flows, and the blob-URL lifecycle.**
- **Code file *contents* edited externally are not live-synced** into the Sandpack
  editor (it has its own in-memory session state; live-merging would fight unsaved
  edits). Only file *presence* (project/chat/media add/delete/rename) is synced.
- **Disk layer is Chromium-only** and needs an authorized folder. After a browser
  restart Chromium may downgrade the grant to "prompt"; until the user
  re-authorizes (App's Authorize modal), the poller no-ops and
  `autoDetectProjectKinds` is the interim tagger.
- **Covers are always still images** ([covers.ts](src/covers.ts)). A
  video source — the first generated item, a "Set as cover" on a video, a disk
  `cover.mp4`, or a `Videos/` file during hydration — is run through
  `extractVideoFrame` (loads it off-DOM, seeks ~0.1s in, draws to a canvas) to
  capture a single PNG frame. That frame is the cover (IndexedDB + `cover.png`).
  Cards therefore never autoplay a cover. A media project with no image, no
  video, and no `project_media` has no source and stays gray.
- **GOTCHA — cover image vs video detection.** Each surface has an `isCoverVideo(url)`
  helper deciding `<img>` vs `<video>`. For `data:` URLs it must trust ONLY the
  MIME prefix (`data:video`). Do **not** substring-match the whole URL for
  `'veo'`/`'/video'`/etc. — a base64 *image* payload frequently contains those
  letters, which mis-renders every image cover inside a `<video>` (blank/gray).
  This caused an "all covers gray" bug; keep the `data:` short-circuit.
- **Polling cost** is ~3 directory listings / 3s while visible (cheap, thanks to
  the manifest-id cache) — but it is still polling, not native fs-events.

---

## 13. How to extend safely (recipes)

**Add a field to a project (e.g. `tags`)**
- Add it to `Reg` in this doc + the inline types in LocalFSContext.
- In `syncProjectsFromDisk` Pass 1, the entry is spread (`{...p, onDisk:true}`) so
  unknown fields survive — good. Just make sure no mutation rebuilds the object
  from scratch and drops it.

### Sync a new folder to disk (the common case) — use the registry

**Do not write a second reconciler.** Declare a folder and the engine does the
rest. Two files, and nothing in `platform/storage` needs to change:

```ts
// features/<feature>/src/<feature>-store.ts
export const gemsStore = atom<Gem[]>([]);

// features/<feature>/src/register.ts
import { registerSyncedFolder } from '@willow/storage/synced-folders';

registerSyncedFolder('gems', {
  folder: 'Gems',           // <workspace>/Gems/ — created on demand
  extension: '.json',       // other files in the folder are ignored
  async readLocal() {       // what the feature holds right now
    return gemsStore.get().map((g) => ({ id: g.id, contents: JSON.stringify(g, null, 2) }));
  },
  async applyRemote(items) { // what disk says it should hold
    gemsStore.set(items.map(parse).filter(Boolean));
  },
  // Optional: isPaused() — return true mid-generation/mid-rename. A paused
  // folder performs ZERO deletions, exactly like a failed scan.
});
```

Then add one line to [`apps/studio/src/app/register-features.ts`](../../apps/studio/src/app/register-features.ts):
`import '@willow/<feature>/register';`. That is the whole wiring —
`pollDiskNow` iterates the registry, so it never needs editing again.

`features/gems` is the reference implementation ([register.ts](../../features/gems/src/register.ts),
~55 lines including JSON validation).

**What the engine already guarantees — never reimplement these:**

| Concern | Where it lives |
| --- | --- |
| Per-item revisions, dirty tracking, durable tombstones | `reconcileFolder` |
| In-tab queue + cross-tab Web Locks, per item | `lockItems` (driver) |
| Delete decisions re-checked against **live** disk | `reconcileFolder` pass 2 |
| `NotFoundError` is the *only* proof of deletion | `statNow` (driver) |
| Dirty item with an unreadable body → retry, never erase | `reconcileFolder` pass 2 |
| External edits preserved as `(Disk conflict <stamp>)` copies | `reconcileFolder` pass 1 |
| Zero deletions on failed scan or paused folder | `reconcileFolder` / driver |
| Change-only `applyRemote` (invariant 7) | driver |

**Rules for your descriptor:**
- **`id` is the file name stem.** It must survive a filesystem round trip — the
  engine ignores ids containing `` \ / : * ? " < > | ``. Sanitize at creation
  (see `makeGemId`), not at save time: an id that changes on the way to disk is
  precisely what made a chat vanish (see [§12](#12-known-issues--tech-debt)).
- **`applyRemote` must tolerate hostile input.** Files are user-editable. Narrow
  untrusted JSON and skip malformed entries rather than throwing — one bad file
  must not take the rest of the folder down.
- **`readLocal`/`applyRemote` must not throw.** Both are wrapped, but a thrown
  error means that pass does nothing.
- **Text only.** Heavy binary (images, video) does not belong here — it would go
  through localStorage-adjacent metadata and blow the budget. Follow the media
  path instead (`src/local-fs/media-disk.ts`), which streams bytes to disk and
  keeps only metadata in IndexedDB.
- One folder has exactly one owner. Registering a folder another feature already
  owns throws at registration — including a case-only difference, since Windows
  and macOS filesystems are case-insensitive.

Tests: [`folder-sync-engine.test.mjs`](../../apps/studio/test/folder-sync-engine.test.mjs)
(12, the engine's delete-safety spec) and
[`synced-folders.test.mjs`](../../apps/studio/test/synced-folders.test.mjs) (10,
the registry contract). If you change the engine, those are the gate.

### Add a disk-backed thing that does NOT fit the registry

Chats, Code and Media predate the registry and keep bespoke paths, because they
carry extra behaviour the descriptor model does not express (project manifests,
per-project sub-folders, blob-URL lifecycles, cover extraction). If you are
genuinely in that territory:
- Write a `refreshX()` that diffs disk vs state, is **change-only**, and is
  **delete-safe** (scan-failure → no deletes; a grace guard if it can race with
  saves). Call it from `pollDiskNow`. Never delete without an `onDisk`-style gate.
- Prefer reusing `reconcileFolder` by implementing `FolderSyncPorts` over
  hand-rolling the algorithm. Every rule in the table above is one you would
  otherwise have to rediscover — two of them by losing a user's data first.

**Change poll cadence**
- Edit the `period` in the watcher effect. Keep visible < hidden. Sub-second is
  wasteful; the focus/visibility triggers already cover "instant on return".

**Add a new project surface**
- Read the full `willow_projects_list`, filter for display only, and listen to
  `willow_projects_updated`. **Never** write the filtered list back (Invariant 1).

**Add a new heavy data type**
- New IndexedDB store (bump the DB version + add it in `onupgradeneeded`). Keep a
  lightweight pointer/flag in the registry if a surface needs to know it exists.

---

## 14. Debugging snippets (browser console)

```javascript
// Registry + kinds + onDisk
JSON.parse(localStorage.getItem('willow_projects_list') || '[]')
  .forEach(p => console.log(p.name, '→', p.kind, p.id, 'onDisk:', !!p.onDisk));

// localStorage usage (watch the ~5 MB cap)
let n = 0; for (const k in localStorage) n += (localStorage[k]||'').length + k.length;
console.log((n/1024/1024).toFixed(2), 'MB / ~5 MB');

// Projects that have media in IndexedDB
const mdb = await new Promise(r => { const q = indexedDB.open('WillowMediaDB',2); q.onsuccess = () => r(q.result); });
const mediaIds = await new Promise(r => { const out=[]; const c = mdb.transaction('project_media','readonly').objectStore('project_media').openCursor(); c.onsuccess = () => { const cur=c.result; if(cur){out.push(cur.key);cur.continue();} else r(out);} });
console.log('media in IndexedDB:', mediaIds);

// Stores in WillowDB (chats + code)
const wdb = await new Promise(r => { const q = indexedDB.open('WillowDB',3); q.onsuccess = () => r(q.result); });
console.log('WillowDB stores:', [...wdb.objectStoreNames]);
```
