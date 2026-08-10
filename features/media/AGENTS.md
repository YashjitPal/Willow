# features/media

The Media app. AI-generated images, music, and video, plus character-based
generation (consistent-character storyboards). The "create" tab of Willow Studio.

## Files

| Path | Role |
| --- | --- |
| `src/MediaHome.tsx` | The landing section: a hero with a prompt box, shown on the Home tab inside App.tsx. |
| `src/MediaShowcase.tsx` | A bottom panel bar with generated cards; also used on Home. |
| `src/MediaView.tsx` | The full Media tab (6966 lines — see below). |
| `src/AnnotationOverlay.tsx` | The image editor's SVG annotation layer (222 lines), split out of MediaView. |
| `src/CropOverlay.tsx` | The crop tool's box + dimming strips + drag handles (70 lines), split out of MediaView. |
| `src/PenMenu.tsx` | The pen tool's flyout: sub-tools, colour swatches, brush size, undo/redo/reset (229 lines). |
| `src/ToolFlyouts.tsx` | The select (box/lasso) and crop (ratio) flyouts (135 lines). |
| `src/annotations.ts` | The `Annotation` shape and the system prompt built from a user's marks. |
| `src/crop-math.ts` | Pure crop geometry: image aspect ratio, maximized crop box. |
| `src/dropdown-placement.ts` | Whether a dropdown opens up or down given the viewport. |
| `src/GalleryTile.tsx` | One gallery tile: the memoized `GalleryTile` shell plus the private `TileContent` interior. |
| `src/types.ts` | `MediaItem`, `MediaKind`, `MediaStatus`, `ImageAttachment`. Shared by MediaView and AgentSidebar. |
| `src/media-icons.tsx` | The 11 hand-drawn SVG rail icons (vinyl record, scenes, aspect-ratio rectangles). |
| `src/sunflower-art.ts` | A ~9KB pixel-art `box-shadow` string, alone in a file so it stops wrecking greps. |
| `src/AgentSidebar.tsx` | AI agent sidebar for media generation (1302 lines). |
| `src/AssetMenuModal.tsx` | Right-click / ... menu for a generated asset. |
| `src/music/MusicView.tsx` | Music generation (1524 lines). |
| `src/music/MusicPlayerSidebar.tsx` | Player UI while generating/listening. |
| `src/characters/CharactersView.tsx` | Consistent-character generation. |

## The media agent owns the generation tools

`MediaView.tsx` builds its own `systemPrompt` and is the **one caller in the repo
that passes `enableMediaTools: true`** to `streamChat`. Chat and Code both leave
it off, so `generate_image` / `generate_video` are never declared to their turns.
That is the invariant behind the three-agent split: Chat, Code and Media are
separate agents, and a chat turn told it can generate video announces a render
that never lands.

Because of that, the deferred **media capability self-description** block — the
prompt text describing image / video / music generation, recovered from the
source prompt Chat's was adapted from — is parked as a comment directly above
`systemPrompt` here, not in `features/chat`. It is paste-ready but needs one
reconciling pass first: it hardcodes the source's model names, while the live
ones are resolved just above it into `activeImageModelName` /
`activeVideoModelName` from the user's picker. Prefer the variables, or the
prompt drifts from the UI. See `features/chat/AGENTS.md` for the other three
blocks and the rule they are all held under.

## The big one

`MediaView.tsx` (6966 lines) is still the largest file in the repo. It covers
image generation (DALL·E, Imagen, Flux/local), the gallery, the detail panel,
export, and the prompt queue. Read it a few times before touching it.

It was 8818 lines until the leaf pieces above were split out. What is left is
genuinely interconnected: nearly every remaining function closes over MediaView's
own `useState`, so the next split has to move state, not just code. Extract
bottom-up (a self-contained subcomponent and the props it needs), never by
cutting the file at a line number.

Two things make that safe to attempt:

- `useEventCallback` (defined in `MediaView.tsx`) hands memoized children stable
  callback identities. Any component you extract should take its handlers as
  props built with it, or `React.memo` on the child silently stops holding.
- `TileContent` and `useDisplayVideoSrc` in `GalleryTile.tsx` are intentionally
  unexported. Nothing outside that file needed them, and that is what keeps the
  tile reasonable to reason about. Export them only for a real second caller.

### What the recent splits looked like

The seven most recent splits used two shapes. `crop-math.ts`,
`dropdown-placement.ts`, and `annotations.ts` took helpers that were *nearly*
pure — they read one value from closure — and made the value a parameter, so
`getImageAr()` became `getImageAr(selectedItem?.ratio)`. `AnnotationOverlay.tsx`,
`CropOverlay.tsx`, `PenMenu.tsx`, and `ToolFlyouts.tsx` took stateless JSX blocks
and passed the few things they drew from as props.

Both shapes are mechanical, and that is the point: the moved code should come out
identical to the original modulo indentation and renamed props, which you can
check with a whitespace-normalized diff against the pre-split file.
`ToolFlyouts.tsx` is the one that does *not* satisfy that check — its six menu
rows all shared one className template and its four crop rows all shared one
click preamble, so they were factored into a `rowClass()` helper and a
`CROP_RATIOS` table. When you restructure like that, verify the generated strings
instead of the source lines.

`PenMenu` and `ToolFlyouts` show the other wrinkle worth knowing. Their
`motion.div` wrappers stayed in `MediaView` and only the contents moved, because
those divs are direct children of an `AnimatePresence` — extracting the wrapper
too would put a component boundary where Framer Motion tracks presence, and a
broken exit animation is not something a typecheck would catch.

## Dependencies

Imports from 9 Willow packages: `@willow/storage` (9, save/load), `@willow/auth`
(8, user/projects), `@willow/assets` (7, sample media), `@willow/ui` (6), and
`@willow/projects` (6, registry + file-content). All horizontal — no forbidden
imports.

Media saves through `@willow/storage/media-storage`, which the storage layer calls
directly. It does **not** use the `project-contributors` registry (only Design
does) — so if you add a Media-owned sub-folder to a saved project, decide
deliberately between extending `media-storage.ts` and registering a writer.

<!-- related-packages -->

## Related packages

**This package imports from:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/chat`](../chat/AGENTS.md) — the standalone chat surface
- [`platform/ai`](../../platform/ai/AGENTS.md) — model clients, chat orchestration, computer use
- [`platform/auth`](../../platform/auth/AGENTS.md) — Firebase, `useAuth()`, `useUserData()`
- [`platform/core`](../../platform/core/AGENTS.md) — utilities, types, constants
- [`platform/projects`](../../platform/projects/AGENTS.md) — project data model and registry
- [`platform/storage`](../../platform/storage/AGENTS.md) — persistence, adapters, sync
- [`platform/ui`](../../platform/ui/AGENTS.md) — shared components

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/chat`](../chat/AGENTS.md) — the standalone chat surface
- [`features/code`](../code/AGENTS.md) — the Workbench: sandbox and visual editing

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
