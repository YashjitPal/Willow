# features/design

The Design app. An infinite React-Flow canvas where the user prompts for a UI
component, an LLM writes it, and it renders live as a node on the canvas at real
device dimensions. Think "Figma boards, but each frame is a running React component."

## Files

| Path | Role |
| --- | --- |
| `src/DesignCanvas.tsx` | The React-Flow canvas: pan/zoom, selection, viewport modes, the dot grid. |
| `src/DesignNode.tsx` | One frame on the canvas. Renders the generated component, plus `VIEWPORTS` and `CANVAS_SCALE`. |
| `src/DesignChat.tsx` | The prompt surface that generates and revises nodes. |
| `src/ColorPickerMenu.tsx` | Colour picker for node styling. |
| `src/design-store.ts` | Nanostore: nodes, focus, selection, viewport mode. The feature's whole state. |
| `src/register.ts` | **Side-effect module.** Keeps Design's storage registration entry point. |

## `register.ts` — the pattern worth copying

`platform/storage` owns saving a project but must not know that a Design feature
exists. Design projects are written by the storage API to their own top-level
workspace folder:

```ts
saveLocalFSDesignProject(projectName, files)
```

Importing the module *is* the registration, and it is pulled in exactly once from
`apps/studio/src/app/register-features.ts`. This is the established way for a
feature to extend platform machinery without inverting the dependency arrow — see
the root `AGENTS.md` and `platform/storage/src/local-fs/project-areas.ts`.

Design files live under `Design/<project>/`, separately from Code and Media
projects. Each node can be saved as a pair: `<name>.tsx` (a plain component a
human can open) and `<name>.json` (canvas position, size, prompt, timestamp).

## The dot grid

`DesignCanvas.tsx`'s `DotGrid` subscribes to the React-Flow store and mutates SVG
attributes **directly**, bypassing React reconciliation, so pan/zoom runs at native
speed. Don't "fix" it into a normal React component — the direct DOM writes are the
point.

## Dependencies

One import each from `@willow/code`, `@willow/core`, `@willow/auth`, `@willow/ai`,
`@willow/ui`, `@willow/storage`. The lightest feature in the repo.

<!-- related-packages -->

## Related packages

**This package imports from:**

- [`features/code`](../code/AGENTS.md) — the Workbench: sandbox and visual editing
- [`platform/ai`](../../platform/ai/AGENTS.md) — model clients, chat orchestration, computer use
- [`platform/auth`](../../platform/auth/AGENTS.md) — Firebase, `useAuth()`, `useUserData()`
- [`platform/core`](../../platform/core/AGENTS.md) — utilities, types, constants
- [`platform/storage`](../../platform/storage/AGENTS.md) — persistence, adapters, sync
- [`platform/ui`](../../platform/ui/AGENTS.md) — shared components

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/code`](../code/AGENTS.md) — the Workbench: sandbox and visual editing

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
