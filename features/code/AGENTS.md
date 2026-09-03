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
| `src/workbench/message-text.ts` | Strips code blocks and indicator markers out of a message. |
| `src/workbench/design-generation.ts` | The design system prompt plus its response parser. |
| `src/workbench/sidebar-prompts.ts` | Session-title and follow-up-suggestion prompts. |
| `src/workbench/model-labels.ts` | Flattens saved model config; shortens names for the composer button. |
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
| `src/local-companion.ts` | Client for the optional `services/local-companion` daemon. |
| `src/use-auto-save.ts` | Debounced project autosave. |
| `src/agent/` | **The Agent tool.** The vendored Codex harness, its UI, and the seam to the workbench. See below. |

## The Agent tool

An optional *second* generation path, selected as **Agent** in the composer's
Tools menu. With it off — the default — the Code tab runs `startAiGeneration`
exactly as it always has: the bolt system prompt, whole-file artifacts, the
streaming `parseAIResponse` parser. With it on, `startCodexGeneration` runs the
turn on a vendored [Codex](https://github.com/openai/codex) harness instead,
which writes its own prompt, sends a file manifest rather than the whole
codebase, and applies edits as V4A patches.

This began life as `features/code-beta`, a full clone of this feature behind a
Labs flag. The clone is gone; only the harness survived, as `src/agent/`.

| Path | Role |
| --- | --- |
| `src/agent/agent-store.ts` | Tool calls and sub-agents per turn, plus `agentEngaged` / `ultraEngaged`, the collaboration mode, the thread goal, and the `request_user_input` round-trip. |
| `src/agent/harness-bridge.ts` | The seam: file-map ↔ sandpack store, plus the `run_command` and `computer_use` tools. |
| `src/agent/harness/` | The turn loop, V4A patcher, text protocol, Plan mode, Goal mode, and the vendored upstream documents. |
| `src/agent/ui/` | The transcript timeline: tool cards, diffs, terminal output, sub-agent chips. |
| `src/agent/mcp/` | The adapter that turns MCP tools into Codex tools. The client itself is `@willow/ai/mcp`. See below. |
| `src/agent/model-binding.ts` | Resolves the selected model to a provider binding, clamping effort. |
| `src/agent/slash-commands.ts` | `/`-triggered composer templates, plus the three that change mode. |
| `src/agent/agent.css` | Design tokens, all scoped under `.cb-root`. |

### Four subsystems, all upstream's

The Agent tool carries four things people reach for by name, and all four are
real Codex subsystems rather than prompt shapes:

- **Plan mode** (`/plan`) — a collaboration mode. Vendored 9KB developer
  document, `update_plan` refused, mutation declined, `request_user_input`
  available and blocking, the plan delivered as a `<proposed_plan>` block.
- **Goal mode** (`/goal <objective>`) — the `ext/goal` extension. Three tools,
  six statuses, a token budget, and automatic continuation turns until the
  objective is verifiably true.
- **Collaboration** — multi-agent V2. Six tools (`spawn_agent`, `send_message`,
  `followup_task`, `wait_agent`, `interrupt_agent`, `list_agents`), agents
  addressed as `/root/explore/deeper`, non-blocking spawn, unbounded nesting,
  and `fork_turns` to choose how much context a child inherits.
- **Ultra** — not more reasoning. It lowers to the model's ceiling on the wire
  and switches delegation to proactive, which is the only thing it changes.

Three of the four began life as something much thinner, and the thin versions
are worth knowing about because each one looked fine: `/plan` was a composer
template that told the model to "Use update_plan" — the exact tool Plan mode
refuses; `/goal` was a template with no goal object and no continuation; and
delegation was one blocking tool called `task` that exists nowhere in codex-rs.

Read [the harness docs](src/agent/harness/AGENTS.md#the-four-subsystems) before
changing any of them. Each has a short list of places the browser forced a
divergence, and everything else is a transcription.

### MCP, and the part of it that cannot exist here

The client lives in [`platform/ai/src/mcp/`](../../platform/ai/src/mcp/mcp-protocol.ts),
not here — two features share it, and the repo rule sends anything two features
need down to `platform/*`. Servers are added from **Spark → Connected apps → MCP
servers** and from **Settings → Connectors → MCP servers**; both write one store,
so they cannot disagree.

What stays in this feature is `src/agent/mcp/mcp-harness-tools.ts`, which maps
MCP tools onto `ToolHandler`. That cannot move: `ToolHandler` is a
`features/code` type and `platform/*` must never import from `features/`. The
split therefore lands exactly where the layering rule puts it.

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

**`agentEngaged` is the only switch.** Three things read it, and all three are
inert when it is false: the send routing in `handleSendMessage`, the slash-command
matcher, and the model menu's `extraEfforts` (the Ultra rung). It lives in a store
rather than component state because `CodeHome` and `WorkbenchSidebar` keep
separate `selectedToolId`, and a pick made on the landing screen has to decide how
the *opening* turn runs.

Two things to know before editing here:

- **The `cb-` class prefix is historical** — it stood for Code Beta. Left alone
  deliberately: renaming it is 373 occurrences across 13 files for no behavioural
  gain. Every rule is scoped under `.cb-root`, which is why `agent.css` can be
  imported unconditionally.
- **`harness/upstream/` is byte-checked.** `npm run codex:check` hashes it against
  `MANIFEST.json`; never hand-edit those files. Willow's changes live in
  `harness/overlay/` and are applied at runtime.

Unlike the rest of this directory, this subsystem *is* covered:
`apps/studio/test/agent-*.test.mjs` is 176 tests over the patcher, effort ladder,
turn loop, timeline, prompt composition, Plan mode, Goal mode and multi-agent
collaboration.

`agent-modes.test.mjs` is the one to read first if you are changing the modes.
Every assertion in it that quotes a string quotes upstream's, and the file names
the `codex-rs` path each one came from — so an upgrade that changes upstream's
wording fails here with a pointer to what to re-check.

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

Note the test suite covers only `src/agent/` (see **The Agent tool** above) — the
sandbox, visual editing and the sidebar itself are untested. `tsc` plus a diff
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
file tree, the diff viewer, and both LLM request loops, and the big blocks inside
it (`persistSessions` ~297 lines, `startAiGeneration` ~266, `startTestGeneration`
~251, `startCodexGeneration` ~135, `renderFormattedContent`, `handleSendMessage`)
are not leaves: they read and write hook state and refs declared above them.
Extracting one means designing a props or hook contract for it, which is its own
change with its own review — not a side effect of something else.

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
