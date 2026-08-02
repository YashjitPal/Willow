# platform/core

Utility functions, types, and constants used everywhere. No UI, no state, no side
effects — just the shared vocabulary that both `features/` and `platform/` depend on.

## Files

| Path | Role |
| --- | --- |
| `src/types.ts` | TypeScript interfaces used across features. `DashboardExperience`, etc. |
| `src/utils.ts` | `cn()` (clsx + tailwind-merge) and other pure functions. |
| `src/layout.ts` | Sidebar width constants. |
| `src/color.ts` | Color manipulation (hex ↔ RGB, interpolation). |
| `src/attachments.ts` | File → base64 data URL, MIME type detection. |
| `src/display-name.ts` | `getDisplayName(user)` — falls back to email if name is missing. |
| `src/dialog-focus.ts` | Focus-trap helpers for modals. |
| `src/json-schema.ts` | JSON Schema → TypeScript type inference helpers. |
| `src/error-store.ts` | Nanostore for global error toasts. |

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
