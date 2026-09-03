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

Read `ARCHITECTURE.md` before changing anything in this package — it is 650 lines
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
| `src/local-fs/chat-metadata.ts` | Chat id/list/timestamp validation, storage-key scoping, sync-record merge, `chatDisplayName`. |
| `src/local-fs/chat-title.ts` | Asks the user's chat-naming model for a short title. Never throws. |
| `src/local-fs/project-manifest.ts` | Reads/repairs a project folder's stable id in `.willow.json`. |
| `src/local-fs/disk-deps.ts` | The `DiskDeps` contract the two disk writers below are passed. |
| `src/local-fs/code-disk.ts` | Writes a project's `Code/` folder: codebase files + chat sessions. |
| `src/local-fs/media-disk.ts` | Writes/deletes/renames files in a project's `Media/` folder + cover. |
| `src/project-contributors.ts` | Registry where features register their project-save writers (sub-folders *inside* a project). |
| `src/synced-folders.ts` | **Registry where features register a top-level synced folder** (`Gems/`). Start here to make a new feature sync. |
| `src/local-fs/folder-sync-engine.ts` | The one reconcile algorithm, shared by every registered folder. Pure + unit-tested. |
| `src/local-fs/synced-folder-driver.ts` | Binds a registered folder to a real directory handle; owns its sync records and per-item locks. |
| `src/code-chat-storage.ts` | Saves + loads Code projects (code files + chat threads). |
| `src/media-storage.ts` | Saves + loads Media projects (generated images/video/music). |
| `src/indexeddb/willow-db.ts` | Chat bodies + code sessions with **content-addressed file-snapshot dedup**. |
| `src/covers.ts` | Project cover-image logic (extract still frame from video as PNG). |

## Making a new feature sync to disk

**Do not write another reconciler.** Declare the folder and the engine drives it:

```ts
// features/<feature>/src/register.ts
import { registerSyncedFolder } from '@willow/storage/synced-folders';

registerSyncedFolder('gems', {
  folder: 'Gems',
  extension: '.json',
  readLocal: async () => gemsStore.get().map((g) => ({ id: g.id, contents: JSON.stringify(g, null, 2) })),
  applyRemote: async (items) => gemsStore.set(items.map(parse).filter(Boolean)),
});
```

Then one line in `apps/studio/src/app/register-features.ts`. `pollDiskNow`
iterates the registry, so it never needs editing. Revisions, tombstones, dirty
tracking, cross-tab locks, conflict copies and every delete-safety rule already
live in the engine — reimplementing them is how data gets lost. Reference
implementation: `features/gems/src/register.ts`. Full guide and the list of
guarantees: [ARCHITECTURE.md §13](ARCHITECTURE.md#13-how-to-extend-safely-recipes).

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
- **Failed scan → abort**: if any registered project-area scan errors, the
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

## Cost model: the reconcile pass runs constantly

This is easy to regress because a correct-looking change can be quadratic, and
nothing fails — the app just gets slower as the user's history grows. The pass
runs on connect, on every window focus, on every `FileSystemObserver` event, and
on a 3s/30s timer. So **anything it does per chat, it does hundreds of times a
minute.**

Two rules, both load-bearing (ARCHITECTURE.md §11.16–17):

- **Settle the unchanged case without reading the body.** mtime comparison plus
  `hasChatBody` (a key probe). `loadChatBody` deserializes the whole message
  array; using it as an existence check made startup read the entire history.
  A `false` probe must still fall through to `loadChatBody` — that call also
  performs legacy-localStorage migration.
- **First loop concurrent, second loop sequential.** See §11.17 for why the
  external-delete loop cannot be parallelised.

The same trap exists in `code-chat-storage.ts`. `scanCodeChats` walks **every**
localStorage key, and there is one key per Code-mode chat, so a per-chat caller
is O(chats x keys). `readCodeChats` is the cached read and is safe to call per
row; the cached object is **shared and must not be mutated**. Writers call
`scanCodeChats` for a private copy, then `invalidateCodeChatsCache()`. Pinned by
`apps/studio/test/code-chat-cache.test.mjs`, which counts scans directly.

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
2. **Disk is authoritative.** A rename/delete that doesn't change an *existing*
   disk folder is reverted by the next reconcile loop. A project with no folder
   yet is the exception, not a failure — see ARCHITECTURE.md §7 *Rename
   (project)*, which is the rule that got a Media project stuck with its old
   name.
3. **Keep `manifest.id === registry.id`.** Covers and media are keyed by the
   registry id; the `.willow.json` manifest carries the id across
   renames/reconnects.
4. **Deleting a media item must delete its disk file** — otherwise the poller
   re-ingests it.

Read `ARCHITECTURE.md` for the full invariant list and the debugging snippets
for verifying registry state from the browser console.

## LocalFSContext is still large — and why

`LocalFSContext.tsx` is 2313 lines, down from 2759. The leaves have been pulled
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

<!-- related-packages -->

## Related packages

**This package imports from:**

- [`platform/auth`](../auth/AGENTS.md) — Firebase, `useAuth()`, `useUserData()`
- [`platform/core`](../core/AGENTS.md) — utilities, types, constants
- [`platform/projects`](../projects/AGENTS.md) — project data model and registry

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/chat`](../../features/chat/AGENTS.md) — the standalone chat surface
- [`features/code`](../../features/code/AGENTS.md) — the Workbench: sandbox and visual editing
- [`features/design`](../../features/design/AGENTS.md) — the design surface
- [`features/media`](../../features/media/AGENTS.md) — AI image and video generation
- [`features/projects`](../../features/projects/AGENTS.md) — project browser UI
- [`platform/projects`](../projects/AGENTS.md) — project data model and registry

See also [`ARCHITECTURE.md`](ARCHITECTURE.md) — how persistence actually works, end to end.

See also [`MEDIA.md`](MEDIA.md) — the media pipeline specifically.

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
