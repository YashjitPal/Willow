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
| `src/workspace-sync.ts` | The workspace colour's counterpart of every Gemini blue the cloned surfaces use, published as `--sync-<hex>`. See below. |
| `src/model-catalog.ts` | Saved-model helpers: providers, `getModelCategory()`, catalog order, and `RETIRED_MODEL_IDS`, the ids Willow no longer offers (shut down by their provider, or taken out of Settings' catalogue) mapped to their replacements. When an id that saved configs may hold goes, add it there, and its name to `RETIRED_MODEL_NAMES` if the replacement is called something else; configs migrate on load and on catalog sync, and a selection on a record dropped as a duplicate moves to the one kept (`migrateSelectedModelId`). |
| `src/settings-file.ts` | `settings.json` at the top of the user's folder: settings and API keys in one file to read and edit by hand. A part of Willow joins with `registerSettingsSection` (read, apply, subscribe, optional merge); `@willow/storage` attaches the file once a folder is connected. Which copy wins is in the file's header and `platform/storage/ARCHITECTURE.md` §6b. |
| `src/spark-library.ts` | Spark's schedules and skills for other surfaces: the writer Spark registers (Chat's `create_schedule` / `create_skill` save through it), the schedule mirror, the argument rules both surfaces read a model's call by, and how a schedule reads on each card. |
| `src/shell-request.ts` | A feature asking the shell for another surface — a Spark page, or a new chat that opens on one exchange — and the seed that chat takes as it mounts. App carries each out once. |
| `src/background-jobs.ts` | Work that outlives its tab: a running job holds a Web Lock and leaves a small record in `localStorage`; when its tab closes, another open tab is granted the lock and resumes it. See below. |
| `src/desktop-bridge.ts` | What the desktop app (Tauri) adds, with browser fallbacks: `isDesktopApp()`, the native folder picker, the Willow folder handed over already able to write (`openDesktopLocalFolder`), notifications (permission, show) and `isAppInBackground()`; for the pet, the desktop overlay (open, post, close), the pet library (read, load, creation, folder, creation-run images), the paw's state, and `onDesktopMessage` for what the app sends a tab (`window.__WILLOW_DESKTOP__.receive`). Talks to Tauri through `window.__TAURI_INTERNALS__`, so the web build needs no Tauri package. Bots use it for computer access and notifications; Spark's pets for everything else. |

## Background jobs (work that carries on in another tab)

`startBackgroundJob({ id, kind, scopeId, payload })` when work starts, `finish()`
when it ends however it ends; `registerBackgroundJobKind(kind, { takeOver })` in
every tab that can resume that kind. Chat turns (`chat-turn`), Spark runs
(`spark-run`), Code turns (`code-turn`) and busy Media editors (`media-work`) use
it. Code and Media live in screens, so their `takeOver` publishes a resume request
that the shell answers by mounting the screen hidden; the screen re-runs the work
and adopts the job, and the promise resolves when it settles (or after a minute).

- **The lock is the liveness signal.** A job holds `willow-job:<id>` for its whole
  run and every other tab that can run the kind queues for it. Closing a tab
  releases its locks, so the first tab in the queue is granted it, finds the
  record still there, and calls the kind's `takeOver`. The kind resumes by calling
  `startBackgroundJob` again with the same id, which adopts the lock already held,
  so no second tab can start it in between.
- **Finish removes the record before releasing.** A tab granted the lock after a
  normal finish finds nothing and lets go. Never release first.
- **The record carries ids and choices, never content.** Each kind resumes from
  what it already saved (the chat file, the Spark task). Model choice is per tab,
  so a kind records the one the work started with.
- **A stale record is settled, not resumed.** The owner heartbeats every 15 s;
  one older than `JOB_STALE_MS` (3 min, generous because hidden tabs throttle
  timers) means every tab closed a while ago, and reopening Willow later must not
  quietly start spending tokens. `abandon` lets the kind mark it interrupted.
  A reload inside that window resumes, like a closed tab does.
- **`readLiveBackgroundJob(id)`** is how saved state tells "still running in some
  tab" from "interrupted": Spark's loader keys its interrupted recovery on it.
- Tested with a fake lock manager and several fake tabs in
  `apps/studio/test/background-jobs.test.mjs`, and in real Chrome with
  `tools/scratch/bg-jobs-live.cjs`.

## Adding Workspace Colors

Willow workspace theming is 100% automated. All derivative assets (glow accents, send/submit button states, horizontal top loadbars, creamy agent card icons, text selection tints, logo filters, and settings swatches) are computed automatically using perceptual OKLCh formulas.

To add a new workspace color in the future:
1. Add an entry to `WORKSPACE_COLOR_DEFINITIONS` in `src/workspace-theme.ts`:
   ```ts
   { id: 'amber', label: 'Warm Amber', hex: '#f59e0b' }
   ```
2. Extend the `UserProfile.workspaceColor` union type in `platform/auth/src/AuthContext.tsx` if desired for strict typing.
3. No UI components or CSS classes need manual editing — everything binds dynamically through `getWorkspaceTheme(color)`.

## Gemini's blues on every workspace colour (`workspace-sync.ts`)

What Willow clones from Gemini arrives in Gemini's literal blues. Blue is the anchor:
each of those blues says how its role looks on a blue workspace, and `workspace-sync.ts`
works out the same role on every other colour.

- **A surface writes the blue through a variable**, keeping Gemini's value as the fallback:
  `color: var(--sync-a8c7fa, #a8c7fa)`, `rgba(var(--sync-a8c7fa-rgb, 168, 199, 250), 0.08)`
  for a translucent use, `text-[color:var(--sync-a8c7fa,#a8c7fa)]` in Tailwind (the hint
  is needed: `text-[var(..)]` is ambiguous to it). The hex is in `SYNC_ANCHORS`; add it
  when a surface starts using a new blue.
- **Blue publishes nothing**, so a blue workspace renders Gemini's measured values byte
  for byte. Any other colour publishes every counterpart on the document element, from
  `App` (`applyWorkspaceSync`), where portalled menus and dialogs see it too.
- **The counterpart:** a blue the engine already gives a role takes that role's value
  (`#a8c7fa` is `creamy`, `#1f3b9b` the accent button, `#1f3760` / `#d3e3fd` the notice
  callout, `#062e6f` the toggle thumb, `#14204f` the glow, `#3186ff` the file-drop text),
  so synced surfaces match what was themed before them. A blue near one of those keeps its
  offset from it, so hovers and pressed states stay in Gemini's order. Any other blue
  keeps its OKLCh lightness (its contrast against Gemini's greys) and takes the workspace
  colour's hue and relative chroma.
- **A subtree can wear its own colour** with `tintSyncVariables(hex)`: every `--sync-*` set on
  that element, worked out for `hex` the same way. Blue stays the anchor there too: a hex within
  12° of the blue swatch's hue, a grey, or none gives Gemini's blues themselves. A bot's profile
  uses it (`features/spark/src/dots/dot-tint.ts`).
- **Not synced:** brand marks (Google, Discord, Drive), code-token colours, colour-picker
  presets, Chrome's own frame in Spark's remote browser, the Docs-styled file viewer, and the
  per-colour tables the engine itself keeps.
- `apps/studio/test/workspace-sync.test.mjs` pins the formula and fails on a raw Gemini blue
  left in a synced stylesheet. `tools/ui-research/scrapers/gemini/media-tools-2026/blue-scan.cjs`
  lists every blue literal in a folder.

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
