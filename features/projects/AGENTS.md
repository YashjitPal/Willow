# features/projects

The project browser: the grid/list of every saved project with covers, search, and
sort. Aliased as **`@willow/project-browser`** — not `@willow/projects`, which is
the platform data layer.

## Files

| Path | Role |
| --- | --- |
| `src/ProjectsPage.tsx` | The whole feature. Grid/list toggle, search, sort, cover rendering, context menu. |

## The alias trap

| Alias | Points at | Contains |
| --- | --- | --- |
| `@willow/project-browser` | `features/projects/src` | This browser **UI**. |
| `@willow/projects` | `platform/projects/src` | The registry, rename, file-content data layer. |

This feature reads the registry through `@willow/projects`. The dependency only
goes that direction.

## Cover rendering — read before editing

A project cover can be an image or a video, and the check for which is subtle.
For `data:` URLs it trusts **only** the MIME type:

```ts
if (url.startsWith('data:')) return url.startsWith('data:video');
```

Never substring-match a base64 payload. Random base64 routinely contains `veo`,
`/video`, and similar, which puts an image cover inside a `<video>` tag where it
renders blank/grey. The substring checks below that line apply to real file URLs
only, and the ordering matters.

## The list-write invariant

This surface filters projects for display. **A filtered list must never be written
back to the registry.** Writing a filtered subset once erased every non-media
project. See `platform/storage/AGENTS.md` §"Hardest-won rules" — it is rule #1
there for a reason.

<!-- related-packages -->

## Related packages

**This package imports from:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`platform/auth`](../../platform/auth/AGENTS.md) — Firebase, `useAuth()`, `useUserData()`
- [`platform/projects`](../../platform/projects/AGENTS.md) — project data model and registry
- [`platform/storage`](../../platform/storage/AGENTS.md) — persistence, adapters, sync

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
