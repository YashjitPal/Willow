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

**Every Code screen has its own state** (`src/session/code-session.ts`): the
Code home and each reopened project get their own file store, live transcript,
preview requests, testing overlay and New chat signal, made by the screen's root
(`CodeWorkspace`, `WorkbenchView`'s default export) and read through
`useCodeSession()`. Code outside React (the harness, its preview session) is
handed the session. So any number of Code screens can be mounted at once, and
nothing one does reaches another. There are no shared stores to import: a new
consumer takes the session it runs in.

What stays one per tab follows the screen on show: visual editing (its frame,
mode, undo history), the problems list and code navigation. A hidden screen's
preview ignores them, every window message is checked against the screen's own
frame (`isOwnPreviewMessage`; the bundler names the screen in the build errors
it posts), and when a different screen comes on show the undo history and the
problems list start over (`$codeScreenSwitches`).

**Leaving Code mid-turn does not stop the turn.** `WorkbenchSidebar` reports
`isCurrentlyGenerating` under its screen's name (`setCodeScreenRunning`,
`src/workbench/code-turn-activity.ts`), and the shell keeps that screen mounted,
hidden but still laid out, so the preview tools keep a frame with a size, until
the turn settles (`apps/studio` AGENTS.md, "Screens that keep working after you
leave them"). Hidden, its transcript updates a few times a second rather than
every frame. `useAutoSave` publishes the folder each screen saves into
(`$codeScreenProjects`), so the shell never opens one project in two screens.

**A Code chat in Recents always reopens in Code** (`platform/storage` AGENTS.md
has the guards). Inbox chats are saved with `{ openInChat: false }`, so Code's
chat never becomes the chat Chat has open. The sidebar publishes the conversation
it holds (`$codeScreenChats`) until it is promoted into a project, so reopening one
a Code home already has open shows that Code home as it is, and opening another
while one is working opens it beside it (`apps/studio` AGENTS.md, "Code homes are
a list"). The shell's `/code/<chat>` address is the same entry for the Code home on
show. `CodeHome` opens the chat
the shell hands it (`openRequest`); it no longer reads the request itself.

**Closing the tab hands the turn to another one** (`src/workbench/code-turn-jobs.ts`).
`startHarnessGeneration` makes every turn in a saved conversation a `code-turn`
job naming its *place* — an inbox chat id, or a project id, name and session —
which `place` keeps current through naming and promotion. A tab that inherits the
job mounts the hidden screen for that place; the sidebar waits for the
conversation to be read back (`isSessionHydrated`), finds it ending on the user's
message — the save effect writes a question the moment it is sent, and a reply
only lands when a turn ends — and sends it again under the same job id and model.
Two rules keep a turn from damaging another session:

- **Unmounting finishes the job**: leaving a turn behind (another project, New
  chat) is not for another tab to pick up. A closed tab never unmounts.
- **A turn whose screen unmounted writes nothing** (`isLive` on
  `runWorkbenchTurn`): no commit, no preview sync, no live transcript.

## Files

| Path | Role |
| --- | --- |
| `src/CodeHome.tsx` | Landing grid (1490 lines). `preloadIdleImages()` warms card art before the tab shows. |
| `src/CodeHomeSkeleton.tsx` | Placeholder shown while the Code chunk loads. |
| `src/code-responsive.css` | Everything the tab does differently at 960px and below. See **Phones and tablets**. |
| `src/use-viewport-width.ts` | The viewport width as React state, for the 600px phone cut-off. |
| `src/WorkbenchView.tsx` | Workbench shell. Owns project load/save. |
| `src/workbench/WorkbenchSidebar.tsx` | Chat + file tree (about 4380 lines — see below). Sends every Code message to the harness. |
| `src/workbench/resume-code-chat.ts` | Reads a saved Code chat back in, including each reply's harness transcript. |
| `src/workbench/restore-project-chats.ts` | Turns a project's `Chat sessions/` back into sessions when browser storage has none for it (a wiped install, or a folder from another copy). One chat is on disk once per screen that showed it; the longest copy wins, and chats already stored are never replaced. |
| `src/workbench/visual-edit-menu.tsx` | The visual-edit inspector panel (1138 lines), split out of the sidebar. |
| `src/workbench/sidebar-icons.tsx` | The sidebar's 13 inline SVG icons (149 lines). |
| `src/workbench/collapsible-indicators.tsx` | The expand/collapse test and file indicators in the transcript (265 lines). |
| `src/workbench/GlobalErrorToasts.tsx` | Error toast stack, portalled out of the sidebar's stacking context (135 lines). |
| `src/workbench/attachment-files.ts` | Reads dropped files, slugifies and de-duplicates their upload paths. |
| `src/workbench/chat-files.ts` | A chat's attachments and annotated screenshots as files beside its JSON (`Chat sessions/<chat>/Attachments/`, `Screenshots/`); the project copy names the file instead of holding base64, and `joinChatFiles` reads those files back in when the project's chats are restored. An inbox chat keeps its bytes inline, since reopening reads them from its JSON. See `platform/storage/ARCHITECTURE.md` §6a. |
| `src/workbench/message-text.ts` | Strips code blocks and indicator markers out of a message. |
| `src/workbench/design-generation.ts` | The design system prompt plus its response parser. |
| `src/workbench/sidebar-prompts.ts` | Session-title and follow-up-suggestion prompts. |
| `src/workbench/model-labels.ts` | Flattens saved model config; shortens names for the composer button. |
| `src/workbench/WorkbenchPreview.tsx` | The live preview iframe + its toolbar (1489 lines). |
| `src/workbench/WorkbenchTopBar.tsx` | Run/preview/code toggles. |
| `src/workbench/CodePanel.tsx` | The code editor pane. |
| `src/workbench/UnsavedChanges*.tsx`, `TestingIndicator.tsx` | Save-state affordances. |
| `src/session/code-session.ts` | One Code screen's state, made by its root; the screen visual editing acts on. |
| `src/workbench/code-turn-activity.ts` | What the shell reads about the mounted screens: which are running, which folder each saves into, which chat each holds. App imports it, so it stays tiny. |
| `src/runtime/sandpack/` | The file store class each screen makes one of (`sandpack-store.ts`), plus the display parser for replies saved before the harness. |
| `src/runtime/preview/` | **The sandbox.** esbuild-wasm bundler for the preview iframe, and npm packages from esm.sh (`packages.ts`). |
| `src/visual-editing/` | Click-to-edit overlay and its engine. |
| `src/visual-editing/VisualEditingOverlay.tsx` | The overlay component (1787 lines): selection state, hit-testing, JSX. |
| `src/visual-editing/element-geometry.ts` | Pure DOM helpers: source location, cover detection, `findTrueCover`. |
| `src/visual-editing/element-family.ts` | `findSimilarElements` — the set selected together with a click. |
| `src/visual-editing/prompt-box-position.ts` | Keeps the floating edit prompt inside the preview viewport. |
| `src/visual-editing/view-code.ts` | Element → source jump, incl. the end-line estimate heuristic. |
| `src/local-companion.ts` | Client for the optional `services/local-companion` daemon. |
| `src/use-auto-save.ts` | Debounced project autosave. |
| `src/harness/` | **The harness.** The agent every Code message runs on: turn loop, edits, tools, skills, MCP, verification, transcript UI. See below. |

## The harness

Every Code message — the landing page's opening prompt, follow-ups, Plan mode,
"Implement plan" — runs on one agent, `src/harness/`, through
`runWorkbenchTurn`. It replaced both the original bolt-artifact loop and the
vendored Codex harness that used to sit behind an **Agent** tool; that tool, its
store and its UI are gone. **Read [the harness docs](src/harness/AGENTS.md)
before changing it.**

In short: the model changes files by writing action tags (`<willow-write>`,
`<willow-edit>` with SEARCH/REPLACE blocks, …) that apply as they stream; it can
call read-only tools, skills and MCP connectors; when it finishes, the harness
builds and runs the project in a hidden frame and hands any errors back for a fix
round; and the result is committed to the workbench in one step. The transcript
renders in the Code tab's own visual language — the "Edited App.tsx" rows —
live and after a reload. Above it, while the turn runs, sits Chat's thinking row
(the dots and the newest thought heading), which becomes "Thought for Ns" when
the turn is done.

Every entry in the composer's **Tools** menu is a capability of that same agent:
something it can call on its own (`propose_plan`, `generate_image`,
`create_design`, `annotate`, `inspect`, `computer`), and something the user can
pick to tell it to use that tool for the message, as in ChatGPT's and Gemini's
tool menus. **Test** is computer use by the same agent on the live preview —
not a separate test agent any more — after it reads the built-in app-testing
skill. **Plan** is Plan mode: the harness reads and plans but changes nothing,
and the reply offers **Implement plan**. A tool picked on the landing page
decides how the opening turn runs (`initialToolId`). Both menus are built from
`src/harness/code-tools.ts`.

### MCP, and the part of it that cannot exist here

The client lives in [`platform/ai/src/mcp/`](../../platform/ai/src/mcp/mcp-protocol.ts),
not here — two features share it, and the repo rule sends anything two features
need down to `platform/*`. Servers are added from **Spark → Connected apps → MCP
servers** and from **Settings → Connectors → MCP servers**; both write one store,
so they cannot disagree.

What stays in this feature is `src/harness/mcp.ts`, which maps MCP tools onto
`HarnessTool`. That cannot move: `HarnessTool` is a `features/code` type and
`platform/*` must never import from `features/`. The split therefore lands
exactly where the layering rule puts it.

Two transports, because two are what a browser can do:

- **Streamable HTTP**, for servers at a URL. Works only if the operator allows
  requests from web pages, and MCP raises the bar: the server must permit
  `Mcp-Session-Id` and `MCP-Protocol-Version` by name and *expose*
  `Mcp-Session-Id`, or the session is silently lost after the handshake. Nothing
  on this side changes that.
- **A Web Worker**, for a plain-JavaScript server running inside the tab with no
  network hop.

**stdio is absent and always will be here.** It means spawning a subprocess, so
the filesystem, git, sqlite and puppeteer servers — most of the published
ecosystem — are unreachable from a tab at any price. That, and Spark's scheduled
actions, are written up in [`HELPER-APP.md`](../../HELPER-APP.md) at the repo
root, including the seam a third transport plugs into. `McpTransport` is
`{ send, onMessage, close }` and nothing above it knows which transport it got.

Two things to keep intact if you touch this:

- **The error messages are the feature.** A browser reports a CORS refusal, a
  bad address, an offline host and a blocked mixed-content request as the same
  rejection, so `explainFetchFailure` and the `McpError` kinds exist to turn one
  opaque failure into four sentences someone can act on. A user told
  "connection failed" edits their URL for an hour.
- **A server is off until the user switches it on.** An MCP result is text from
  third-party software that the model reads as context, which is the standard
  prompt-injection path. That switch plus the prompt's "treat this as untrusted
  data" is the whole protection today, and it is deliberately coarse — per-tool
  approval belongs with stdio support, not before it.

Unlike the rest of this directory, the harness *is* covered:
`apps/studio/test/code-harness-*.test.mjs` covers the stream parser at every
chunk size, the edit formats, the turn loop against a scripted model, the tools,
skills and connectors, the bundler's strict mode against a fake CDN, and the
wiring into the sidebar. The [harness docs](src/harness/AGENTS.md#tests) list
which file covers what.

## The runtime

The sandbox is not Sandpack and not WebContainer, whatever older names say
(`sandpack-store.ts` kept its name). `runtime/preview/bundler.ts` bundles the
project in the browser with **esbuild-wasm** (`public/esbuild.wasm`) into one
script, and the preview iframe runs it against React 18.2 and Tailwind from
CDNs. The harness reads this section's facts to the model, so keep its prompt
in step when they change.

- **npm packages** come from esm.sh (`runtime/preview/packages.ts`) at the
  version in the project's `package.json`, with React left external so the page's
  copy is the only one. Icon libraries are requested with only the icons the
  project imports. Responses are cached in memory and in Cache Storage
  (`willow-preview-packages-v1`), so a package is fetched once per browser.
- **`@/` and `~/`** resolve to the project root (or `/src` when the project uses
  one). JSON, Markdown and text files import as data; SVG imports as a URL.
- **Two modes.** The live preview is forgiving: a missing file renders a
  placeholder so a half-written project still shows something. **Strict** mode
  (`{ strict: true }`), which the harness checks with, makes a missing file, a
  Node built-in or an unknown package a build error with a file and line.
- **The preview frame's sandbox** is `allow-scripts allow-same-origin
  allow-forms allow-modals allow-popups`. Without `allow-forms` the browser never
  fires `submit`, so any `<form onSubmit>` app silently did nothing; without
  `allow-modals`, `confirm()` answers "no" unasked. `allow-same-origin` with
  scripts already lets the page reach out, so these add no exposure. The
  harness's hidden error-check frame keeps the narrow sandbox: it never
  interacts, and an `alert()` there must not block anything.
- **Mid-turn rebuilds.** The preview rebuilds when generation finishes, and also
  when the harness asks (`workbench/preview-control.ts`, one per screen): before
  the agent tests or inspects the app, it loads the turn's edits and requests a
  build with source locations, plus an optional phone or tablet width. Nothing
  else rebuilds a hidden screen's preview: visual editing's requests are for the
  screen on show.

Replies saved before the harness held bolt artifacts; `runtime/sandpack/message-parser.ts`
now only turns those into display segments so old chats render as they did.

## Visual editing

`visual-editing/` lets the user click an element in the preview and change it. The
flow:

1. An inspector script is injected into the preview iframe; it posts hover/click
   events out.
2. `visual-editing/engine/visual-editor-store.ts` (1301 lines) holds all selection
   and edit state as nanostores.
3. `visual-editing/engine/direct-style-service.ts` (1328 lines) maps CSS values to
   Tailwind classes (`TAILWIND_COLOR_MAP`, `FONT_SIZE_MAP`, …) so edits land as
   class changes, not inline styles.
4. `visual-editing/engine/visual-edit-service.ts` writes the change back into the
   source file.

Edits are queued and applied as a batch, with an undo stack.
`visual-editing/engine/index.ts` is a barrel — it is the intended entry point for
this subsystem.

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

Note the test suite covers the harness and the bundler (see **The harness** above),
not visual editing or the sidebar's rendering. `tsc` plus a diff
against the pre-change file is the only real safety net there, so prefer
extractions you can prove byte-identical over ones that reshape call sites.

## Workbench sidebar split

`workbench/WorkbenchSidebar.tsx` was 6084 lines. The visual-edit inspector panel
moved out to `workbench/visual-edit-menu.tsx` (1138 lines) and the 13 inline SVG
icons to `workbench/sidebar-icons.tsx` (149 lines), taking it to 4867. Eight more
extractions took it to **4322**: the nine `workbench/` modules listed in the table
above. Each one was a leaf — it closed over nothing in the component — so every
move was a relocation, not a rewrite.

What is left is deliberately left. The sidebar still holds the chat thread, the
file tree, the diff viewer, the design and test request loops, and the harness's
entry point, and the big blocks inside it (`persistSessions` ~297 lines,
`startTestGeneration` ~251, `startHarnessGeneration` ~100,
`renderFormattedContent`, `handleSendMessage`) are not leaves: they read and
write hook state and refs declared above them. Extracting one means designing a
props or hook contract for it, which is its own change with its own review — not
a side effect of something else. (The agent itself is not in here: it is
`src/harness/`, which knows nothing about React state.)

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

## Phones and tablets

At 960px and below the Code tab has its own layout; the desktop's is untouched.
Gemini has no coding surface to measure, so it follows the narrow pages that do:
the shell's 68px top bar, bottom sheets for menus, one pane at a time.

The narrow CSS is all in `src/code-responsive.css`, and every rule there sits in a
max-width query, so the desktop never sees it. The classes it targets
(`code-hero`, `code-topbar`, `code-panel-explorer`, …) are hooks added for those
rules and style nothing on their own. What CSS cannot do switches on
`useCompactViewport()` (`@willow/chat/use-compact-viewport`), or on
`useViewportWidth()` for the 600px phone cut-off.

- **The landing is a column.** The heading starts under the top bar, and the cards
  fill the height between it and the "Your apps" button, so a taller screen grows
  them rather than opening a gap. The grid is two columns with two rows on a phone
  (the wide card sits out), three on a portrait tablet (the wide card spans the
  middle one), and one on a short screen. A phone on its side keeps only the
  heading and the composer. The category pills wrap rather than scroll. The model
  is picked from the top bar's `MobileModelPicker`, as on the chat home, and the
  composer drops its own model button.
- **`CodeHomeSkeleton` carries the same hooks** and imports the same stylesheet, so
  the swap to the live landing does not jump on a phone. A hook added to one belongs
  in the other.
- **One workspace pane at a time.** The sidebar's collapse state is reused: open is
  the chat at full width, collapsed is the preview. The resizer is hidden. A tool
  opens on the pane that holds it, with Edit, Agents and Design on the chat pane and
  the agent builder and the design canvas on the preview. `CodeHome` and
  `WorkbenchView` both do this; keep them in step.
- **The top bar** swaps the collapse toggle for a Chat pill, drops the tab labels on
  a phone and the address bar on every narrow screen, and moves Refresh, Open in new
  tab, Settings and (on a phone) Publish into a More sheet. When more tools are open
  than fit, the tabs scroll sideways and the active one is scrolled into view. Add
  tool sits outside that strip, because the strip's overflow would clip its menu.
- **Menus are bottom sheets**: Tools on both composers, More, and the "Your apps"
  card menu. The dropdowns' outside-click handlers return early on a compact
  viewport, because a tap on a sheet row lands outside the dropdown's ref.
- **The code panel on a phone** shows the file list or the open file, with a Files
  button back to the list.
- **"Your apps"** is Media's `BottomPanel` in `mode="develop"`. Its `showcase-*`
  hooks are styled only under `.code-apps-section`, so the Media tab's copy is
  unchanged, and its card menu becomes a sheet only in develop mode. On every
  screen, desktop included, the list starts at the top; only the empty state is
  centred.

The agent builder and the design canvas that open in the preview pane are the
Agents and Design apps' own canvases, and keep their desktop controls.

`apps/studio/test/code-responsive.test.mjs` pins the above.
`tools/scratch/code-desk-regress.ps1` replays five desktop states and compares a
layout fingerprint of each against one saved earlier: run `save` before a change and
`compare` after it to show the desktop did not move.

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

<!-- related-packages -->

## Related packages

**This package imports from:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/agent-builder`](../agent-builder/AGENTS.md) — the Agents workflow canvas
- [`features/chat`](../chat/AGENTS.md) — the standalone chat surface
- [`features/design`](../design/AGENTS.md) — the design surface
- [`features/media`](../media/AGENTS.md) — AI image and video generation
- [`platform/ai`](../../platform/ai/AGENTS.md) — model clients, chat orchestration, computer use
- [`platform/auth`](../../platform/auth/AGENTS.md) — Firebase, `useAuth()`, `useUserData()`
- [`platform/core`](../../platform/core/AGENTS.md) — utilities, types, constants
- [`platform/projects`](../../platform/projects/AGENTS.md) — project data model and registry
- [`platform/storage`](../../platform/storage/AGENTS.md) — persistence, adapters, sync
- [`platform/ui`](../../platform/ui/AGENTS.md) — shared components

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/design`](../design/AGENTS.md) — the design surface
- [`features/spark`](../spark/AGENTS.md) — scheduling / background-task agent

Chat is deliberately absent from that list: the three agent surfaces stay
independent, and the composer's GitHub import — the one thing Chat used to reach
in here for — now lives in the platform layer.

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
