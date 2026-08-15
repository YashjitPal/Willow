# platform/core

Utility functions, types, and constants used everywhere. No UI, no state, no side
effects — just the shared vocabulary that both `features/` and `platform/` depend on.

## Files

| Path | Role |
| --- | --- |
| `src/types.ts` | TypeScript interfaces used across features. `StudioExperience`, etc. |
| `src/utils.ts` | `cn()` (clsx + tailwind-merge) and other pure functions. |
| `src/layout.ts` | Sidebar width constants. |
| `src/color.ts` | Color manipulation (hex ↔ RGB, interpolation). |
| `src/attachments.ts` | File → base64 data URL, MIME type detection. |
| `src/display-name.ts` | `getDisplayName(user)` — falls back to email if name is missing. |
| `src/dialog-focus.ts` | Focus-trap helpers for modals. |
| `src/json-schema.ts` | JSON Schema → TypeScript type inference helpers. |
| `src/error-store.ts` | Nanostore for global error toasts. |
| `src/workspace-theme.ts` | Centralized workspace theme registry and automated OKLCh color engine. |

## Adding Workspace Colors

Willow workspace theming is 100% automated. All derivative assets (glow accents, send/submit button states, horizontal top loadbars, creamy agent card icons, text selection tints, logo filters, and settings swatches) are computed automatically using perceptual OKLCh formulas.

To add a new workspace color in the future:
1. Add an entry to `WORKSPACE_COLOR_DEFINITIONS` in `src/workspace-theme.ts`:
   ```ts
   { id: 'amber', label: 'Warm Amber', hex: '#f59e0b' }
   ```
2. Extend the `UserProfile.workspaceColor` union type in `platform/auth/src/AuthContext.tsx` if desired for strict typing.
3. No UI components or CSS classes need manual editing — everything binds dynamically through `getWorkspaceTheme(color)`.

## Dependency constraint

**`platform/core` must never import from `features/` or `apps/`.** It may import
sibling platform packages, and that is all. If you are tempted to reach up into a
feature, stop — the abstraction belongs here, and the feature calls it.

## What goes here

- **Types** that appear in more than one platform package or feature.
- **Pure functions** with no I/O, no fetch, no `localStorage`.
- **Constants** (layout dimensions, magic numbers).

What does **not** go here: React components (those are `platform/ui`), API clients
(those are the feature or `platform/ai`), storage logic (that is `platform/storage`).

<!-- related-packages -->

## Related packages

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/agent-builder`](../../features/agent-builder/AGENTS.md) — the Agents workflow canvas
- [`features/auth`](../../features/auth/AGENTS.md) — login / account UI
- [`features/chat`](../../features/chat/AGENTS.md) — the standalone chat surface
- [`features/code`](../../features/code/AGENTS.md) — the Workbench: sandbox and visual editing
- [`features/design`](../../features/design/AGENTS.md) — the design surface
- [`features/media`](../../features/media/AGENTS.md) — AI image and video generation
- [`platform/storage`](../storage/AGENTS.md) — persistence, adapters, sync
- [`platform/ui`](../ui/AGENTS.md) — shared components

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
