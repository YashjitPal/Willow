# Willow Figma (unfinished prototype)

A Figma-style design canvas. **This feature does not compile and is not wired
into the app.** It is kept in the tree because the parts that do exist — the
scene model, geometry, and the REST/realtime contracts — are a real head start,
not scratch work.

Do not treat this folder as a working reference for how Willow features are
built. Look at [features/agent-builder/](../agent-builder/) or
[features/code/](../code/) instead.

## Why it is excluded from typecheck

The root [tsconfig.json](../../tsconfig.json) lists `features/figma` under
`exclude`. Sixteen modules that the existing files import were never written,
so `tsc` cannot resolve them. Excluding the folder keeps `npm run typecheck` a
real gate on the rest of the repo instead of a wall of known errors.

Nothing outside this folder imports it — the only references to
`@willow/figma` are the alias definitions themselves — so the exclusion costs
no coverage elsewhere.

## What exists

```
src/
  FigmaWorkspace.tsx        feature entry; renders the editor
  index.ts                  public barrel (FigmaWorkspace)
  editor/
    EditorView.tsx          editor chrome
    canvas/CanvasHost.tsx   canvas surface + pointer plumbing
  lib/
    api.ts                  typed REST client for a backend that does not exist yet
    contracts.ts            wire types shared with that future backend
    realtime.ts             multiplayer/presence transport
    scene.ts                document tree + node operations
    geometry.ts             hit-testing, bounds, transforms
    colors.ts  text.ts  types.ts  user.ts  store.ts
  figma.css
```

## What is missing

Sixteen modules, imported by the four existing components:

| Imported by | Missing modules |
| --- | --- |
| `FigmaWorkspace.tsx` | `home/FigmaHome`, `lib/export` |
| `editor/EditorView.tsx` | `topbar/TopBar`, `toolbar/Toolbar`, `panels/LeftPanel`, `panels/RightPanel`, `menus/ContextMenu`, `menus/QuickActions`, `PresentMode`, `shortcuts` |
| `editor/canvas/CanvasHost.tsx` | `render`, `overlays`, `interactions`, `TextEditorOverlay`, `CommentsOverlay`, `CursorsOverlay` |

There is also no backend. `lib/api.ts` describes one under `/figma-api/v1`;
writing it would mean a new package under [services/](../../services/), mounted
as Vite dev middleware the way
[services/agent-builder](../../services/agent-builder/) is.

## Finishing it

1. Write the missing modules above, starting with `render` and `interactions` —
   `CanvasHost.tsx` is inert without them.
2. Build the `/figma-api/v1` service and point `lib/api.ts` at it.
3. Add a route and a sidebar entry in [apps/studio](../../apps/studio/).
4. Delete `features/figma` from `exclude` in the root `tsconfig.json` and get
   `npm run typecheck` green.
