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
| `src/workbench/WorkbenchSidebar.tsx` | Chat + file tree (4322 lines — see below). |
| `src/workbench/visual-edit-menu.tsx` | The visual-edit inspector panel (1138 lines), split out of the sidebar. |
| `src/workbench/sidebar-icons.tsx` | The sidebar's 13 inline SVG icons (149 lines). |
| `src/workbench/collapsible-indicators.tsx` | The expand/collapse test and file indicators in the transcript (265 lines). |
| `src/workbench/GlobalErrorToasts.tsx` | Error toast stack, portalled out of the sidebar's stacking context (135 lines). |
| `src/workbench/attachment-files.ts` | Reads dropped files, slugifies and de-duplicates their upload paths. |
| `src/workbench/inline-formatting.tsx` | Bold/inline-code rendering for transcript text. |
| `src/workbench/message-text.ts` | Strips code blocks and indicator markers out of a message. |
| `src/workbench/design-generation.ts` | The design system prompt plus its response parser. |
| `src/workbench/sidebar-prompts.ts` | Session-title and follow-up-suggestion prompts. |
| `src/workbench/model-labels.ts` | Flattens saved model config; shortens names for the composer button. |
| `src/workbench/char-reveal-styles.ts` | Keyframes for the transcript's word-by-word reveal. |
| `src/workbench/WorkbenchPreview.tsx` | The live preview iframe + its toolbar (1489 lines). |
| `src/workbench/WorkbenchTopBar.tsx` | Run/preview/code toggles. |
| `src/workbench/CodePanel.tsx` | The code editor pane. |
| `src/workbench/UnsavedChanges*.tsx`, `TestingIndicator.tsx` | Save-state affordances. |
| `src/runtime/sandpack/` | **The sandbox.** Sandpack store, AI-response parser, system prompt. |
| `src/runtime/preview/` | esbuild-wasm bundler for the preview iframe. |
| `src/visual-editing/` | Click-to-edit overlay and its engine. |
| `src/visual-editing/VisualEditingOverlay.tsx` | The overlay component (1787 lines): selection state, hit-testing, JSX. |
| `src/visual-editing/element-geometry.ts` | Pure DOM helpers: source location, cover detection, `findTrueCover`. |
| `src/visual-editing/element-family.ts` | `findSimilarElements` — the set selected together with a click. |
| `src/visual-editing/prompt-box-position.ts` | Keeps the floating edit prompt inside the preview viewport. |
| `src/visual-editing/view-code.ts` | Element → source jump, incl. the end-line estimate heuristic. |
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

### The overlay split

`VisualEditingOverlay.tsx` went from 2089 to 1787 lines by moving out the four
modules listed above. What moved was only ever pure functions of the DOM; what is
left holds React state and cannot be cut the same way — `handleClick` (286 lines),
`handleVisualEditSubmit` (154) and the effects all read and write the overlay's 11
refs and 7 state values.

Two rules for anyone continuing this:

- **Never move a `motion.div` that is a direct child of `AnimatePresence`.** The
  floating prompt box is exactly that. A relocated exit animation still compiles
  and still type-checks — it just silently stops animating on close. When the
  prompt box's positioning maths was extracted, only the arithmetic moved; the
  markup stayed put, and the whole `AnimatePresence` subtree was diffed
  character-for-character afterwards to prove it.
- **`src/visual-editing/` is LF**, while `src/workbench/` is CRLF. Check before
  you write, or the diff will show every line as changed.

Note the test suite does **not** cover this subsystem — the 5 tests in
`apps/studio/test/` are Agent Builder smoke tests. `tsc` plus a diff against the
pre-change file is the only real safety net here, so prefer extractions you can
prove byte-identical over ones that reshape call sites.

## Workbench sidebar split

`workbench/WorkbenchSidebar.tsx` was 6084 lines. The visual-edit inspector panel
moved out to `workbench/visual-edit-menu.tsx` (1138 lines) and the 13 inline SVG
icons to `workbench/sidebar-icons.tsx` (149 lines), taking it to 4867. Eight more
extractions took it to **4322**: the nine `workbench/` modules listed in the table
above. Each one was a leaf — it closed over nothing in the component — so every
move was a relocation, not a rewrite.

What is left is deliberately left. The sidebar still holds the chat thread, the
file tree, the diff viewer, and the LLM request loop, and the big blocks inside it
(`persistSessions` ~297 lines, `startAiGeneration` ~266, `startTestGeneration`
~251, `renderTextContent`, `renderFormattedContent`, `handleSendMessage`) are not
leaves: they read and write hook state and refs declared above them. Extracting
one means designing a props or hook contract for it, which is its own change with
its own review — not a side effect of something else.

Two rules, learned the hard way, that `tsc` cannot check for you:

- **Never move a `motion.div` that is a direct child of `AnimatePresence`.** The
  presence boundary tracks its immediate children; putting a component boundary
  there silently kills the exit animation. Moving an entire `AnimatePresence` tree
  as one unit is fine, as is relocating a component whose render site is already a
  component boundary.
- **This directory is CRLF.** Write new files with `\r\n` or the whole file shows
  up as changed.

When you move a string payload — a prompt, a `<style>` block — compare the
**runtime string**, not the source text. Leading whitespace inside a template
literal is part of the value, so re-indenting a moved block changes what ships.
`GlobalErrorToasts.tsx` carries its own keyframes for the same reason: it renders
through a portal, outside any stylesheet the sidebar controls.

Everything here is live. Verify before you move anything.

## Naming

The workbench was once called "Staging", and the shell around it "Dashboard".
Both names have been retired from identifiers, types and CSS classes — see
**Vocabulary** in the root `AGENTS.md`. Two deliberate exceptions remain, and
neither is an oversight:

- `sessionStorage['staging-nav']` — set here and in `features/projects` /
  `features/media`, read back by the refresh guard in `apps/studio/src/app/App.tsx`.
- `localStorage['dashboard-background']` — in `apps/studio/src/shell/BackgroundContext.tsx`.

Storage keys address data users have already saved. Renaming one doesn't migrate
it, it orphans it, so these keep their legacy names permanently.
