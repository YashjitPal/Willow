# features/code

The coding app: describe an app in chat, an LLM writes it, it runs in a live
sandbox, and you can click elements in the preview to edit them visually. The
largest feature in the repo.

## Two surfaces

- **`CodeHome.tsx`** — the landing grid. Project cards, templates, the "what do you
  want to build" prompt box.
- **`WorkbenchView.tsx`** — the workbench: sidebar (chat + files) on the left,
  preview or code on the right. This is where the actual work happens.

`apps/studio` lazy-loads both.

## Files

| Path | Role |
| --- | --- |
| `src/CodeHome.tsx` | Landing grid (1490 lines). `preloadIdleImages()` warms card art before the tab shows. |
| `src/CodeHomeSkeleton.tsx` | Placeholder shown while the Code chunk loads. |
| `src/WorkbenchView.tsx` | Workbench shell. Owns project load/save and the LLM loop. |
| `src/workbench/WorkbenchSidebar.tsx` | Chat + file tree (4867 lines — see below). |
| `src/workbench/visual-edit-menu.tsx` | The visual-edit inspector panel (1138 lines), split out of the sidebar. |
| `src/workbench/sidebar-icons.tsx` | The sidebar's 13 inline SVG icons (149 lines). |
| `src/workbench/WorkbenchPreview.tsx` | The live preview iframe + its toolbar (1489 lines). |
| `src/workbench/WorkbenchTopBar.tsx` | Run/preview/code toggles. |
| `src/workbench/CodePanel.tsx` | The code editor pane. |
| `src/workbench/UnsavedChanges*.tsx`, `TestingIndicator.tsx` | Save-state affordances. |
| `src/runtime/sandpack/` | **The sandbox.** Sandpack store, AI-response parser, system prompt. |
| `src/runtime/preview/` | esbuild-wasm bundler for the preview iframe. |
| `src/visual-editing/` | Click-to-edit overlay and its engine. |
| `src/github/` | Import a repo. |
| `src/local-companion.ts` | Client for the optional `services/local-companion` daemon. |
| `src/use-auto-save.ts` | Debounced project autosave. |

## The runtime

The sandbox is **Sandpack**, not WebContainer. (Older comments may say otherwise;
they are wrong.) `runtime/sandpack/message-parser.ts` turns a streaming LLM
response into file writes and shell actions as it arrives — that is what makes
files appear one at a time while the model is still typing.

`runtime/preview/bundler.ts` uses **esbuild-wasm** (`public/esbuild.wasm`) to
bundle the project in-browser for the preview iframe.

## Visual editing

`visual-editing/` lets the user click an element in the preview and change it. The
flow:

1. An inspector script is injected into the preview iframe; it posts hover/click
   events out.
2. `engine/visual-editor-store.ts` (1301 lines) holds all selection and edit state
   as nanostores.
3. `engine/direct-style-service.ts` (1328 lines) maps CSS values to Tailwind
   classes (`TAILWIND_COLOR_MAP`, `FONT_SIZE_MAP`, …) so edits land as class
   changes, not inline styles.
4. `engine/visual-edit-service.ts` writes the change back into the source file.

Edits are queued and applied as a batch, with an undo stack. `engine/index.ts` is a
barrel — it is the intended entry point for this subsystem.

## Workbench sidebar split

`workbench/WorkbenchSidebar.tsx` was 6084 lines; the visual-edit inspector panel
moved out to `workbench/visual-edit-menu.tsx` (1138 lines) and the 13 inline SVG
icons to `workbench/sidebar-icons.tsx` (149 lines). The sidebar is now 4867 lines
and holds the chat thread, the file tree, the diff viewer, and the LLM request
loop. Everything in it is live — verify before you move anything.

## Naming

The workbench was once called "Staging". `WorkbenchView.tsx` still declares
`StagingView` / `StagingViewProps` internally. Renaming those is safe (they are not
persisted anywhere); renaming `localStorage` keys that contain `staging` is **not**
— those hold user data.
