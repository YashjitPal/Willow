# platform/projects

The project registry: what projects exist, what kind each one is, and how their
files are named and renamed. This is metadata only — the bytes live in
`platform/storage`.

## Files

| Path | Role |
| --- | --- |
| `src/registry.ts` | The project list. Read/write, plus the `PROJECTS_UPDATED_EVENT` broadcast. |
| `src/file-content.ts` | MIME types, upload payload encoding, bytes → text decoding. |
| `src/rename.ts` | Project rename, including collision handling. |
| `src/file-content.test.ts` | Tests for the encode/decode round-trip. |

## The registry

`registry.ts` owns the canonical list of the user's projects. Both storage adapters
(local disk and Drive) merge into it, so the UI reads one list regardless of where
the files actually live.

**Everything is scoped.** Every read and write takes a `scopeId` (defaulting to the
active one, set by `setProjectStorageScope()`). A scope is "this user + this storage
location" — a signed-out user, a signed-in user, or a specific local directory each
get their own registry under their own `localStorage` key. That is what stops one
user's projects from appearing in another's list after a sign-out, and what lets
re-selecting a previously used folder recover its project list.

When the registry changes, it dispatches `PROJECTS_UPDATED_EVENT` on `window`.
Components listen for that rather than polling — see the listener in
`apps/studio/src/app/App.tsx`.

**Deletion tombstones.** `markProjectDeleted()` records that a project was deleted,
and `isProjectSaveBlocked()` reports whether such a tombstone exists. `writeProjectRegistry()`
consults it so that a slow, in-flight save (or a second tab still holding a stale
list) cannot resurrect a project the user just deleted. If you add a new write path,
it must honour the same check.

The `ownsLegacyProjectRegistry` / `canAdoptLegacyCodeSession` / `claimLegacyCodeSession`
trio migrates pre-scoping data into a scope, exactly once, without two tabs both
claiming it. Leave them alone unless you are working on migration.

## file-content.ts

The encode/decode layer between "a project file" and "bytes on a disk or in Drive".
It decides MIME type by extension, builds the multipart payload Drive expects, and
decodes bytes back to text with the right encoding. Both adapters in
`platform/storage/src/adapters/` call it, which is why it lives here and not there.

## Dependency constraint

**`platform/projects` must never import from `features/` or `apps/`.** It imports
`@willow/storage` at one call site and nothing else.
