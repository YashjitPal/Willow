# platform/storage

User projects live in **one of two places**: the local disk (File System Access API)
or Google Drive. Both are behind adapters that implement the same operations, so
toggling between them is a matter of swapping which adapter the UI calls — not
rewriting every caller.

## Three-layer persistence model

| Layer | Role | Quota |
| --- | --- | --- |
| **localStorage** | Lightweight metadata only: registry, indexes, flags. | ~5 MB — keep tiny |
| **IndexedDB** | All heavy payloads: media base64, covers, chat bodies, code snapshots. | Browser-managed |
| **Disk** (FSA API) | Optional mirror; **source of truth** for which projects exist. | None |

Rule: localStorage = pointers/indexes; IndexedDB = heavy bytes; Disk = truth.
When disk is connected it wins.

Read `ARCHITECTURE.md` before changing anything in this package — it is 542 lines
with exact flows, data shapes, storage keys, invariants, and debugging snippets.
Section 11 (Invariants) lists rules that cause data loss when broken.

## Files

| Path | Role |
| --- | --- |
| `src/adapters/local-disk.ts` | File System Access API. Stores handle + stable root ID in IndexedDB. |
| `src/adapters/google-drive.ts` | Drive v3 REST. Creates `Willow Apps/` folder, one child per project. |
| `src/adapters/drive-discovery.ts` | Merges Drive projects into the local registry on connect. |
| `src/adapters/use-drive.ts` | React hook: syncs the access token from `AuthContext`. |
| `src/local-fs/LocalFSContext.tsx` | **The brain.** Directory handle, reconcile loop, CRUD, polling watcher. |
| `src/local-fs/chat-metadata.ts` | Chat id/list/timestamp validation, storage-key scoping, sync-record merge. |
| `src/local-fs/chat-title.ts` | Asks the user's chat-naming model for a short title. Never throws. |
| `src/local-fs/project-manifest.ts` | Reads/repairs a project folder's stable id in `.willow.json`. |
| `src/local-fs/disk-deps.ts` | The `DiskDeps` contract the two disk writers below are passed. |
| `src/local-fs/code-disk.ts` | Writes a project's `Code/` folder: codebase files + chat sessions. |
| `src/local-fs/media-disk.ts` | Writes/deletes/renames files in a project's `Media/` folder + cover. |
| `src/project-contributors.ts` | Registry where features register their project-save writers. |
| `src/code-chat-storage.ts` | Saves + loads Code projects (code files + chat threads). |
| `src/media-storage.ts` | Saves + loads Media projects (generated images/video/music). |
| `src/indexeddb/willow-db.ts` | Chat bodies + code sessions with **content-addressed file-snapshot dedup**. |
| `src/covers.ts` | Project cover-image logic (extract still frame from video as PNG). |

## The two surfaces

- **Where projects are stored** — the adapters. `local-disk.ts` uses the File
  System Access API and keeps a stable root ID in IndexedDB so that re-selecting
  the same folder recovers its identity instead of appearing as a new scope.
  `google-drive.ts` uses Drive v3 REST and creates a `Willow Apps/` folder, with
  one child folder per project.

- **What goes into a project folder** — the contributors. `project-contributors.ts`
  is a registry where features self-register the sub-folders they own. When the
  user saves a project, the save pipeline calls every registered writer. This is
  how `platform/storage` can orchestrate the save without knowing that a Design
  feature exists. See `features/design/src/register.ts` for the established
  pattern.

## Real-time sync

`LocalFSContext` polls disk every 3s (visible) / 15s (hidden) + on focus/connect.
The reconciler (`syncProjectsFromDisk`) is **disk-authoritative**:

- **`onDisk` guard**: only auto-delete a registry entry whose folder is gone if
  `onDisk === true`. Browser-only projects (never yet saved to disk) survive.
- **Failed scan → abort**: if either the Code or Media folder scan errors, the
  reconciler returns without making any change. A partial listing must never
  convert into deletions.
- **Change-only**: no `setState` or disk write when nothing changed — prevents
  re-renders every 3 seconds.
- **Media generation guard**: `loadMedia` bails if any item is still
  `status:'generating'`, because a reload would clobber in-progress items.
- **`blob:` URL reuse**: if an item's `id` + `fsName` match a currently-displayed
  item with a live `blob:`, reuse that URL instead of creating a new one (which
  would unload + reload the `<img>` and cause visible layout reflow).
- **Rename guard**: during an async folder rename, set `renamingRef` and skip
  disk-change-triggered `loadMedia` for ~800ms — the FileSystemObserver fires
  multiple events mid-rename and a partial read would vanish the gallery.

Chat sync uses **monotonic revisions + durable `dirty`/`tombstone` records**. A
failed disk write stays retryable; it is never converted into an external deletion
after a timeout.

## Content-addressed dedup (code sessions)

Code sessions carry a full `filesSnapshot` per turn for revert/preview. Storing
verbatim copies would duplicate the entire codebase each turn. Instead:
- Every unique file content is stored **once** in `code_blobs` (keyed by SHA-256).
- Sessions keep only a `path → hash` manifest.
- Callers always see fully-inflated snapshots — compression happens at this boundary.
- Unreferenced blobs are garbage-collected on save.

## Scoping

Storage keys are **scoped** by authenticated user + stable selected-root ID +
workspace name. A signed-out user's chats stay in their own scope; signing in does
not merge them. Legacy unscoped keys are claimed by one scope on first read
(migration) and never replayed into another account.

## Dependency constraint

**`platform/storage` must never import from `features/` or `apps/`.** It can import
sibling platform packages (`@willow/projects`, `@willow/auth`, `@willow/core`) and
that is all. When you add behaviour that only a feature knows how to do, make the
feature register it — don't reach up and import the feature.

## Hardest-won rules (from ARCHITECTURE.md §11)

1. **Never write a filtered project list back to the registry.** A surface that
   filters for display must still write the full list — writing a filtered subset
   erased all non-media projects.
2. **Disk is authoritative.** A rename/delete that doesn't change the disk folder
   is reverted by the next reconcile loop.
3. **Keep `manifest.id === registry.id`.** Covers and media are keyed by the
   registry id; the `.willow.json` manifest carries the id across
   renames/reconnects.
4. **Deleting a media item must delete its disk file** — otherwise the poller
   re-ingests it.

Read `ARCHITECTURE.md` for the full invariant list and the debugging snippets
for verifying registry state from the browser console.

## LocalFSContext is still large — and why

`LocalFSContext.tsx` is 2184 lines, down from 2759. The leaves have been pulled
out into the five `src/local-fs/*` modules listed above; what remains is the
local-disk state machine itself (directory handle, registry, migration, project
list, CRUD, Drive merge) plus a large React context.

**Do not try to finish the split by cutting at line numbers.** Every export is in
use, and every remaining block reads and writes provider refs (`chatScopeIdRef`,
`recentProjectRenamesRef`, `projectSaveQueuesRef`, …) declared above it. Moving
one out means threading React context through multiple files or lifting state
into nanostores. Neither is trivial, and neither is required for the file to be
readable.

What *was* safe, and is the pattern to follow if you extract more:

- A `useCallback` whose body touches **no ref and no setState** can become a
  module-scope function of its own dependencies (`generateChatTitleWith`,
  `saveMediaFileToDisk`, `saveProjectFilesToDisk`). Verify the body first —
  a dep array is not proof, since two of the media writers call
  `resolveCurrentProjectName` without listing it.
- **Keep the provider's `useCallback` wrapper and its dependency array exactly as
  they were.** The array is part of the context value's identity: shortening it
  because the body "obviously" no longer needs an entry changes when consumers
  re-render. Where an original array omitted a dependency, that omission was
  preserved — it is safe only because `resolveCurrentProjectName` is
  `useCallback(_, [])` and so never changes identity.
- Compare every moved block against a pre-extraction copy of the file,
  **anchored on content, not line numbers**, and check that the comments came
  with it. The invariant notes on those functions (write-then-prune, the
  case-only rename hazard, dot-entry ownership) are the reason the code is
  correct.
- `platform/storage/src/*` is **LF**, unlike `features/code/src/workbench/*`.
  A tool that rewrites the file with CRLF will show every line as changed.

Also see `MEDIA.md` for the media-specific storage details.
