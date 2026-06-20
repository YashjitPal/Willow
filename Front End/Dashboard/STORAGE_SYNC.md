# Willow Storage & Sync Architecture

> **Read this before touching anything under `lib/localFileSystemService.ts`,
> `lib/mediaStorage.ts`, `lib/willowDB.ts`, `context/LocalFSContext.tsx`, or any
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
| **IndexedDB** | all heavy payloads (media base64, covers, chat bodies, code snapshots) | effectively unlimited |
| **Disk** (File System Access API) | optional mirror into a real folder; **source of truth** for which projects exist, their kind, and their name | none |

Golden rule of the split: **localStorage = pointers/indexes; IndexedDB = heavy
bytes; Disk = truth.** When the disk is connected, it wins.

---

## 2. Module map (who owns what)

| File | Responsibility |
|------|----------------|
| `lib/localFileSystemService.ts` | Low-level File System Access API helpers: persist/restore the directory handle (IndexedDB `WillowLocalFS`), permission checks, recursive file writes, and the per-project `.willow.json` manifest read/write. **No React, no business logic.** |
| `lib/mediaStorage.ts` | `WillowMediaDB` IndexedDB: per-project media item lists + covers. Also owns project-kind helpers (`getMediaProjectIds`, `autoDetectProjectKinds`) and `deleteProjectData`. |
| `lib/willowDB.ts` | `WillowDB` IndexedDB: chat message bodies (`chats`) and code editor sessions (`code_sessions`) with **content-addressed file-snapshot dedup** (`code_blobs`). Handles legacy-localStorage migration on read. |
| `context/LocalFSContext.tsx` | The brain. Owns the directory handle, the connect/restore/authorize flows, all `saveLocalFS*`/`deleteLocalFS*`/`renameLocalFS*` operations, the **disk↔registry reconciler** (`syncProjectsFromDisk`), and the **real-time polling watcher** (`pollDiskNow` + effect). Exposes everything via `useLocalFS()`. |
| `App.tsx` | Mounts `<LocalFSProvider>` around **all** routes. Runs `migrateProjectKinds()` once on mount. Chooses which surface renders (`dashboardMode` = `chat` / `develop` / `media`; `currentView` = `home` / `projects` / `starred` / `shared`). |
| `components/HeroSection.tsx` | Media-home project grid (filtered to `kind:'media'`). Owns project rename (`persistProjectRename`) + delete + the "New project" button. |
| `components/BottomPanel.tsx` | Media-home "showcase" (top 9 of `kind:'media'`). Star toggle + delete. |
| `components/ProjectsPage.tsx` | "All projects" / Starred / Shared. Unfiltered registry. Star toggle + delete. |
| `components/media/MediaView.tsx` | The media editor for one project. Generates media, saves it, sets covers, and runs **real-time media-file sync** for the open project. |
| `components/staging/StagingView.tsx` + `StagingSidebar.tsx` | The code editor. Creates code projects (`kind:'code'`); persists sessions via `saveCodeSessions`/`loadCodeSessions`. |

---

## 3. Storage layers (exact)

### 3a. localStorage keys
| Key | Shape | Owner |
|-----|-------|-------|
| `willow_projects_list` | `Reg[]` (see [§4](#4-data-shapes)) — the **project registry** | everyone reads; mutations centralized |
| `willow_local_chats` | `string[]` of chat ids (inbox index) | LocalFSContext |
| `willow_chat_timestamps` | `{ [chatId]: epochMs }` for newest-first sort | LocalFSContext |
| `willow_pinned_chats` | `string[]` of pinned chat ids | Sidebar |
| `apiKeys`, `userSettings`, `providerState`, `modelConfig`, `selectedModelId` | user settings | settings UI |
| `googleAccessToken`, `googleDriveAccessToken`, `isDriveConnected` | OAuth/Drive (separate from the local folder) | AuthContext |

**Legacy keys (migrated then removed — do not write):**
- `willow_chat_<chatId>` → migrated into `WillowDB.chats` by `loadChatBody`.
- `willow_chat_sessions_<project>` → migrated into `WillowDB.code_sessions` by `loadCodeSessions`. NOTE: this string is still **reused as the IndexedDB key** for a project's sessions.
- `willow_project_media_<projectId>` → migrated into `WillowMediaDB.project_media` by `loadProjectMedia`.

### 3b. IndexedDB databases
| DB (version) | Store | Key | Value |
|---|---|---|---|
| **`WillowMediaDB`** (2) | `project_media` | `projectId` | `MediaItem[]` |
| | `project_covers` | `projectId` | cover string (base64 data URL) |
| **`WillowDB`** (2) | `chats` | `chatId` | message array |
| | `code_sessions` | `willow_chat_sessions_<project>` | `ChatSession[]` (snapshots deflated to hashes) |
| | `code_blobs` | `<storageKey>\0<sha256>` | one unique file content (content-addressed) |
| **`WillowLocalFS`** (1) | `handles` | `local_projects_dir` | the live `FileSystemDirectoryHandle` |

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

### 5a. `useLocalFS()` (context/LocalFSContext.tsx)
State: `isSupported`, `isLocalFolderConnected`, `isLocalFolderAuthorized`,
`localFolderName`, `isInitializingLocalFS`, `localChats: string[]`, `activeChatId`.

Connection:
- `connectLocalFolder()` — opens the picker, stores handle, syncs chats + projects.
- `authorizeLocalFolder()` — interactive permission re-grant (called from App's Authorize modal); then syncs.
- `disconnectLocalFolder()` — clears handle from `WillowLocalFS` and resets state.

Saves (all write IndexedDB and/or disk; never heavy data to localStorage):
- `saveLocalFSProject(projectName, files)` — writes `Code/<p>/Codebase/*` + design nodes.
- `saveLocalFSChat(chatId, messages, oldChatId?)` — IndexedDB body + disk `Chats/<id>.json`. Stamps `recentChatWritesRef`.
- `saveLocalFSProjectChat(projectName, chatId, messages, oldChatId?)` — per-project chat under `Code/<p>/Chat sessions/`.
- `saveLocalFSMedia(projectName, kind, fileName, blob)` — writes blob to `Media/<p>/Images|Videos/`, returns final filename (collision-suffixed).
- `saveLocalFSCover(projectName, url)` — writes a cover file next to Images/Videos.

Mutations:
- `deleteLocalFSChat(chatId)` — IndexedDB body + disk file.
- `deleteLocalFSProject(projectId, projectName)` — removes `Code/<name>` or `Media/<name>` (recursive). Pair with `deleteProjectData` for IndexedDB.
- `deleteLocalFSMediaFile(projectName, kind, fsName)` — removes one media file so the poller won't re-ingest it.
- `renameLocalFSProject(oldName, newName)` — renames the disk folder (native `move()` → recursive copy+delete fallback). Keeps disk in lock-step with a UI rename.
- `renameLocalFSChat(oldChatId, newChatId)` — IndexedDB + disk; stamps `recentChatWritesRef`.

Reads / refresh:
- `loadLocalFSChat(chatId)` — IndexedDB first, disk fallback (re-caches).
- `refreshLocalChats()` — reconcile inbox chats with `Chats/` (delete-detection + grace guard).
- `refreshLocalMedia(projectName)` — reconcile `Media/<p>` files with `project_media`.
- `getChatTimestamp(chatId)`, `selectLocalFSInboxChat(chatId)`, `generateChatTitle(...)`.

**Internal (not on the interface, but central):** `syncProjectsFromDisk`,
`pollDiskNow`, `getActiveHandle`, `getSanitizedWorkspaceName`,
`getProjectIdByName`, `ensureProjectManifest`. Refs: `directoryHandleRef`,
`recentChatWritesRef`, `isPollingRef`, `manifestIdCacheRef`.

### 5b. `lib/mediaStorage.ts`
`saveProjectMedia(projectId, items)`, `loadProjectMedia(projectId)` (migrates
legacy localStorage), `saveProjectCover(projectId, url)` (**converts `blob:` and
external video URLs to base64** so covers survive reload), `loadProjectCover(id)`,
`loadAllProjectCovers()` → `{id: url}`, `deleteProjectData(id)` (media **and**
cover), `getMediaProjectIds()` → `Set<id>` with media, `autoDetectProjectKinds()`
(fallback tagging — fills missing only), `migrateProjectKinds()` (alias).

### 5c. `lib/willowDB.ts`
`saveChatBody(chatId, messages)`, `loadChatBody(chatId)` (migrates legacy),
`deleteChatBody(chatId)`, `renameChatBody(old, new)`,
`saveCodeSessions(storageKey, sessions)`, `loadCodeSessions(storageKey)`.

**Content-addressed dedup (code):** `saveCodeSessions` "deflates" each session's
`filesSnapshot` — every unique file content is stored once in `code_blobs`
(key = `<storageKey>\0<sha256>`), and the session keeps a `path → hash` manifest.
`loadCodeSessions` "inflates" back to full content, so callers never see hashes.
Unreferenced blobs are garbage-collected on save. A `hashCache` avoids re-hashing.
(`KEY_SEP` is a NUL byte ` `; `KEY_MAX` is `￿` for prefix range scans —
this is why the file is flagged "binary" by some tools. Don't "fix" those chars.)

### 5d. `lib/localFileSystemService.ts`
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
    └── Media/
        └── <projectName>/
            ├── .willow.json          // { id }
            ├── Images/  (+ Characters/)
            ├── Videos/
            ├── Scenes/               // reserved (created, not yet written)
            └── Music/                // reserved
```

`kind` is decided by which parent the folder is under (`Code/` → code,
`Media/` → media). A folder present in **both** is treated as `code`.

---

## 7. Lifecycle flows

### Project create
- **Media:** MediaView materializes `{id, name, kind:'media'}` into the registry on
  first completed generation; `saveLocalFSMedia` writes the blob to disk →
  `Media/<name>/...`. The next poll sees the folder and sets `onDisk:true` (and
  writes the manifest with the registry id).
- **Code:** StagingView pushes `{id, name, kind:'code'}`; autosave writes
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
- **`recentChatWritesRef` (20s grace)** — `saveLocalFSChat`/`renameLocalFSChat`
  stamp it; `refreshLocalChats` won't delete a chat written that recently (and
  keeps it visible) so the poller can't race-delete a chat mid-creation.
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
3. **Creation-time:** StagingView → `code`; MediaView → `media`.

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
11. **Keep the chat grace guard** (`recentChatWritesRef`) or the poller will
    race-delete chats mid-creation.
12. **`<LocalFSProvider>` must wrap every route** (it's in App.tsx around
    `<Routes>`). Any component calling `useLocalFS()` outside it throws.

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
- **Covers are always still images** ([coverUtils.ts](lib/coverUtils.ts)). A
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

**Add a new disk-backed thing to the poll**
- Write a `refreshX()` that diffs disk vs state, is **change-only**, and is
  **delete-safe** (scan-failure → no deletes; a grace guard if it can race with
  saves). Call it from `pollDiskNow`. Never delete without an `onDisk`-style gate.

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
const wdb = await new Promise(r => { const q = indexedDB.open('WillowDB',2); q.onsuccess = () => r(q.result); });
console.log('WillowDB stores:', [...wdb.objectStoreNames]);
```
