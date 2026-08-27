# Willow Local Sync

Browser-native synchronization between application state and a directory chosen
by the user. The package provides a reusable reconcile engine, durable retries,
tombstones, conflict copies, per-item locking, and registries for extending a
workspace without hardcoded folder lists.

```sh
npm install willow-local-sync
```

```ts
import { registerSyncedFolder } from 'willow-local-sync';

registerSyncedFolder('notes', {
  folder: 'Notes',
  extension: '.json',
  async readLocal() {
    return notesStore.get().map((note) => ({
      id: note.id,
      contents: JSON.stringify(note, null, 2),
    }));
  },
  async applyRemote(items) {
    notesStore.set(items.flatMap((item) => {
      try { return [JSON.parse(item.contents)]; }
      catch { return []; }
    }));
  },
});
```

The host application calls `syncRegisteredFolder` for each registered
descriptor after it has a workspace `FileSystemDirectoryHandle`. The library is
UI-agnostic and has no Willow runtime dependency.

## Requirements

- A secure browser context (`https://` or localhost)
- File System Access API support for directory handles
- ES2022 or newer
- Web Locks are used when available; an in-tab queue remains active otherwise
- Node.js 20 or newer for development and package scripts

The File System Access API is currently strongest in Chromium-based browsers.
Applications should feature-detect directory-picker support and provide a clear
unsupported-browser state. Importing the package does not request permission;
the host owns all permission prompts and handle persistence.

## Core APIs

`registerSyncedFolder(id, descriptor)` registers a text-file collection such as
`Notes/` or `Spark/Tasks/`. A descriptor owns one folder and one extension.

`syncRegisteredFolder(workspaceDir, descriptor, scopeId)` reconciles one
descriptor. The `scopeId` must distinguish users and workspaces so metadata
cannot leak across accounts or selected roots.

`registerProjectArea(descriptor)` declares a top-level folder whose children are
projects, such as `Design/<project>/`. Project areas describe discovery and
lifecycle ownership; feature-specific file writers remain application code.

`reconcileFolder(ports)` is the lower-level, filesystem-independent engine for
applications that need a custom adapter rather than the built-in browser
directory driver.

All exported types ship with the package. See `dist/types` after a build.

## Safety Guarantees

- A failed directory scan makes no deletion decisions.
- Only a confirmed `NotFoundError` is treated as an external deletion.
- A stale directory listing is rechecked before an item is removed.
- Dirty local data remains retryable after cache or disk failures.
- External edits are preserved as conflict copies before local work overwrites.
- Tombstones keep deleted files from being resurrected.
- Failed local-state reads are not interpreted as empty collections.
- Sync metadata is committed only after the application accepts remote state.
- Unsafe item ids and duplicate folder ownership are rejected.

`readLocal` and `applyRemote` should reject on temporary failures. The driver
then returns `{ ok: false }`, commits no metadata, and retries on a later pass.
Malformed individual documents should instead be skipped inside `applyRemote`
so one bad file does not block an otherwise valid folder.

## Project Areas

```ts
import { registerProjectArea } from 'willow-local-sync';

registerProjectArea({
  id: 'design',
  folder: 'Design',
  kind: 'design',
  priority: 10,
  ensureOnConnect: true,
});
```

The registry starts empty. Host applications register their own areas during
startup, which keeps the standalone library neutral and lets future features add
storage without editing central discovery, rename, deletion, or bootstrap code.

## Development

```sh
npm ci
npm run typecheck
npm run test:package
npm run pack:check
```

The package is ESM-only and MIT licensed. Release changes are documented in
[CHANGELOG.md](./CHANGELOG.md); security reporting and contribution expectations
are in [SECURITY.md](./SECURITY.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).
