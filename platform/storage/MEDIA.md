# Willow Media Storage (Images & Videos)

> How generated images/videos are stored and displayed. Companion to
> `ARCHITECTURE.md` (which covers projects/chats/code and the real-time sync).
> Read this before touching `MediaView.tsx` media effects, `src/media-storage.ts`,
> or the `refreshLocalMedia` / `loadLocalFSMediaUrl` functions in `LocalFSContext.tsx`.

## The principle: disk is the source of truth, browser is the fallback

A picked local folder now exists, so the **real `.png` / `.mp4` files on disk are
the source of truth** for media. The browser (IndexedDB) keeps only lightweight
**metadata** for disk-backed media — never the heavy bytes. When there's no folder
connected, media falls back to being stored in the browser as base64 (so it still
works offline / pre-folder). This replaced the old model where every image/video
was base64 in IndexedDB *and* duplicated as a file on disk.

| | Folder connected | No folder |
|---|---|---|
| Heavy bytes live in | the `.png`/`.mp4` on **disk** | base64 in **IndexedDB** |
| IndexedDB holds | metadata only (`url: ''`) | metadata + base64 `url` |
| Displayed via | a streaming **`blob:` URL** read from disk | the base64 `url` |

Everything is keyed in IndexedDB by **`projectId`** (rename-stable). The disk
folder is located by **`projectName`**. (This unified a previous `projectId`
vs `projectName` split that caused media to disappear.)

## Data flow

### Generate (folder connected)
1. Image arrives as a `data:image` base64; a video is fetched and inlined to a
   `data:video` base64 (durable even if the disk write fails). Item added to
   state with `isSavedToFS: false`.
2. `saveGeneratedMedia` writes the bytes to `Media/<projectName>/Images|Videos/`
   → sets `isSavedToFS: true` + `fsName`.
3. The save effect calls `saveProjectMedia(projectId, items)`, which **strips the
   bytes** of any `isSavedToFS` item (`url → ''`). So once on disk, the base64 is
   gone from IndexedDB — only metadata remains.
4. In-session display uses the item's in-memory base64/blob (no reload needed).

### Generate (no folder)
- Steps 2–3 don't happen; the item stays `isSavedToFS: false`, so its base64
  `url` is kept in IndexedDB. It displays from base64. (Unchanged old behavior.)

### Reload / open a project — the **single** load path (`MediaView.loadMedia`, keyed by projectId)
1. If folder connected → `refreshLocalMedia(projectId, projectName)`:
   reconciles IndexedDB metadata with the disk folder (drops files deleted
   externally, picks up files added externally, **de-dupes** by `fsName`/`id` to
   clean historical pileups), persists metadata, returns it.
   If no folder → `loadProjectMedia(projectId)` (base64 metadata).
2. **Hydrate**: for each disk-backed item (`url:''`, has `fsName`),
   `loadLocalFSMediaUrl(projectName, kind, fsName)` reads the file and makes a
   streaming **`blob:` URL**. Browser-only items keep their base64 `url`.
3. `setMediaItems(hydrated)`.

`loadMedia(skipIfGenerating)` is guarded by a `loadGenRef` token (only the latest
load applies) and **never clobbers an in-progress generation**.

### Realtime
- **In an open project:** the disk watcher fires **`willow_disk_changed`**
  (FileSystemObserver change, or focus) → `MediaView` runs `loadMedia(true)`
  (debounced, skipped while generating) → the gallery reflects external
  adds/deletes live.
- **On the studio home:** `saveProjectMedia`/`deleteProjectData` update a realtime
  localStorage **media index** (`willow_media_index`: per-project counts) and fire
  **`willow_media_updated`**. The Media tab shows any project tagged `media` OR
  with `index[id].count > 0` — so media generated into a `code` project still
  appears, and it updates live.

> There is ONE media load path and **no blind reload poll**. Reloads are
> event-driven, debounced, and skip while generating — a prior blind poll wiped
> the gallery on video generation.

> ⚠️ **localStorage can never hold the media bytes** (~5MB cap). The media index
> is metadata only (counts/timestamps); the bytes live on disk / IndexedDB.

### Display
- Images: `<img src={url}>` (blob URL or base64).
- Videos: the `MediaVideo` component. A blob URL streams directly; a `data:video`
  base64 (in-session, pre-strip) is converted to a blob URL for fast playback
  (base64 in a `<video>` can't stream → long black screen).

### Delete a media item
Removes from state, revokes its blob URL, persists the new list under `projectId`,
and deletes the file from disk (`deleteLocalFSMediaFile`) so the reconcile won't
re-add it.

## Blob URL lifecycle (important — leaks if mishandled)
- Disk-backed items are shown via `URL.createObjectURL(file)`. These are tracked
  in `mediaBlobUrlsRef` and **revoked** immediately when the project changes, on
  unmount, and on delete. To ensure active URLs are never broken during dynamic
  virtualization scrolling, background `loadMedia` refreshes never perform 
  arbitrary/bulk revocations; instead, the previous project's URLs are cleanly
  revoked as a single atomic batch during the project switch `useEffect` itself.
  Never persist a `blob:` URL — it dies on reload (the save strip guarantees
  disk-backed items store `url:''`, so a blob URL can't be persisted).
- `MediaVideo` owns the blob URL it creates from a `data:video` base64 and revokes
  it on src change/unmount (separate from the disk-hydration URLs).

## Race guards in `loadMedia` (critical — removing any of these causes gallery flicker)

### 1. Rename guard (`renamingRef`)
Renaming a project folder on disk is async (`FileSystemHandle.move()` or
recursive copy-then-delete). During this window the `FileSystemObserver` fires
multiple events (folder deleted → folder created → files copied). If `loadMedia`
runs mid-rename it reads partial/empty contents → images vanish, layout collapses.

**Guard:** `MediaView` sets `renamingRef.current = true` before the disk rename
starts and clears it ~800 ms after completion. Both the `willow_disk_changed`
handler and `loadMedia(true)` bail if this flag is set.

### 2. Blob URL reuse
When hydrating disk-backed items, `loadMedia` checks if the item (`id` + `fsName`)
already has a live `blob:` URL on screen. If so, it reuses that exact URL instead
of creating a new one. Without this, each reload revokes the old URL and creates a
new one → the browser unloads the `<img>` (height collapses to 0) → masonry layout
re-flows → tiles visibly jump.

### 3. Structural diff gate
After hydration, `loadMedia` compares the incoming items against
`mediaItemsRef.current` by ID (order-independent). It checks `id`, `url`,
`status`, `fsName`, `kind`, `prompt`, `shortenedPrompt`, and `timestamp`. If
everything is identical, `setMediaItems` is skipped entirely — no React re-render,
no framer-motion `layout` animation. Without this, each periodic disk poll
(every 3–30 s) triggers a state update that causes tiles to reposition even though
nothing changed on disk.

## Key functions
| Function | Where | Role |
|---|---|---|
| `saveProjectMedia(projectId, items)` | `src/media-storage.ts` | persist metadata; **strips bytes** of disk-backed items |
| `loadProjectMedia(projectId)` | `src/media-storage.ts` | read metadata |
| `refreshLocalMedia(projectId, projectName)` | `LocalFSContext` | reconcile metadata against disk; returns metadata |
| `loadLocalFSMediaUrl(projectName, kind, fsName)` | `LocalFSContext` | read one disk file → `blob:` URL (caller revokes) |
| `saveLocalFSMedia(projectName, kind, file, blob)` | `LocalFSContext` → `src/local-fs/media-disk.ts` | write a media file to disk |
| `deleteLocalFSMediaFile(projectName, kind, fsName)` | `LocalFSContext` → `src/local-fs/media-disk.ts` | delete one media file from disk |
| `renameLocalFSMediaFile(projectName, kind, oldFsName, newBaseName)` | `LocalFSContext` → `src/local-fs/media-disk.ts` | rename one media file on disk |
| `MediaVideo` / `useDisplayVideoSrc` | `MediaView.tsx` | stream-friendly video display |

## Caveats & honest limitations
- **Disk-backed media needs the folder authorized to display.** On a fresh load
  Chromium may downgrade the folder grant to "prompt"; until re-authorized (App's
  Authorize modal), disk-backed items can't be read. The project **cover** still
  shows (covers are kept as small base64 in `project_covers`). Mitigation idea for
  later: keep a tiny base64 thumbnail per item for instant display.
- **Transient base64 for video at generation.** A freshly generated video is held
  as base64 until its disk write completes and the save strips it. Brief, and the
  base64 is the fallback if the disk write fails.
- **Videos generated before this model** were saved with an expiring external URL;
  they may show black until re-generated.
- **Existing base64 items migrate lazily**: they keep displaying from base64, and
  the next save after they're on disk strips them to metadata-only.

## Possible future optimization
Store media as **Blobs** (not base64) even in the no-folder fallback (IndexedDB
supports Blob values) — smaller than base64 and blob-URL-ready — and add a tiny
per-item thumbnail so disk-backed items render instantly before the full file
loads. Not required for correctness; noted for when performance matters.
