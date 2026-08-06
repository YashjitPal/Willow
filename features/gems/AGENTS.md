# @willow/gems

The Gems feature provides a "Gem Manager" interface mimicking the Gemini web app's Gems UI.
It displays a grid of premade tools and characters.

## Structure
- `src/GemsView.tsx` - The main view displaying the Gem Manager.
- `src/CreateGemView.tsx` - The create/edit form (name, description, instructions, default tool).
- `src/gems-store.ts` - The `Gem` model and its nanostore.
- `src/register.ts` - Registers `Gems/` as a synced workspace folder.

## State
`gemsStore` (nanostores) holds the user's gems. `PREMADE_GEMS` in `GemsView.tsx`
stays a hardcoded presentation list — only user-created gems are persisted.

`CreateGemView` still holds its fields in local `useState` and does not write to
the store yet; wiring its submit to `upsertGem` is what turns persistence on.

## Persistence
Gems sync to `<workspace>/Gems/<gemId>.json` through the shared synced-folder
registry, so this feature owns **no** sync logic of its own: `src/register.ts`
declares the folder and how a gem serializes, and
`platform/storage/src/local-fs/folder-sync-engine.ts` handles revisions,
tombstones, conflicts, locking and delete-safety.

This is the reference implementation for that seam — copy it when adding
persistence to another feature. See
[ARCHITECTURE.md §13](../../platform/storage/ARCHITECTURE.md#13-how-to-extend-safely-recipes).

**A gem's `id` is its file name stem.** Build ids with `makeGemId`, which strips
the characters a filesystem cannot round-trip. Never let an id change on its way
to disk — that mismatch is what once made a chat disappear.

## Dependencies
Imports standard UI elements from `@willow/ui` and `@willow/core` as needed, and
`@willow/storage/synced-folders` for registration.
