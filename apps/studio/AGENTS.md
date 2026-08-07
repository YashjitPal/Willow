# apps/studio

The host shell — the only application in the repo. It owns routing, the sidebar,
the settings modal, and the page background, and it lazy-loads each sub-app from
`features/`. It deliberately contains **no** feature logic: if you are adding
behaviour that belongs to Code or Media or Agents, it goes in that feature.

## Files

| Path | Role |
| --- | --- |
| `src/main.tsx` | Entry. Mounts React, imports `register-features` for side effects. |
| `src/app/App.tsx` | Routes, layout, and the `React.lazy` boundary for every sub-app. |
| `src/app/register-features.ts` | Pulls in feature self-registrations. See below. |
| `src/shell/sidebar/` | Sidebar, its icons, primitives, appearance + user menus. |
| `src/shell/SearchModal.tsx` | Global search. |
| `src/shell/BackgroundContext.tsx` | Which animated background is active. |
| `src/settings/` | Settings modal and its eight tabs. |
| `scripts/lib/willow-aliases.mjs` | Reads `tsconfig.base.json` `paths`; feeds bundlers. |
| `vite.config.ts` | Dev server, the mounted backend, and the LLM proxy. |

## Adding a sub-app

Sub-apps are lazy-loaded so that opening Home does not download the Media or
Agents bundle. Follow the existing shape in `src/app/App.tsx`:

```ts
const MediaView = React.lazy(() => import('@willow/media/MediaView'));
```

Then add its route and a sidebar entry. Keep the import inside `React.lazy` — a
top-level import defeats the code-splitting and inflates the initial bundle.

## Feature registration

`platform/*` cannot import `features/*` (see the root `AGENTS.md`). When a
platform system needs feature-specific behaviour, the feature registers it and
`src/app/register-features.ts` is the single place those registrations are pulled
in. It is imported once, for side effects only, and order does not matter.

## Dev server and plugins

`npm run dev` serves the app on **:3000** with `strictPort` — it fails loudly
rather than drifting to another port, because the QA harness and the backend's
same-origin assumption both depend on that number. Four plugins, all
`apply: "serve"` or effectively dev-only:

- **`agentBuilderBackend()`** — runtime-imports `services/agent-builder`'s
  `vite-middleware.ts` and mounts the API on the same origin, so `/api/v1/*` is
  served from the same process. One command, no CORS, no second port. Teardown is
  memoized: a config edit fires both the `httpServer` `close` event and
  `closeBundle`, and closing the backend's SQLite handle twice throws.
- **`conditionalCrossOriginHeaders()`** — COOP/COEP only on `/project1`. These
  headers are needed for `SharedArrayBuffer` but they **break Firebase
  `signInWithPopup`**, so they must never be set on the login route.
- **`dynamicLlmProxy()`** — reads the upstream target from the `x-proxy-target`
  header and opens a fresh connection per request, so user-supplied base URLs pass
  SNI/Cloudflare checks. A static Vite `proxy` entry cannot do this.
- **`react()`** — standard.

## Tests

`npm test` runs `test/agent-builder-overlays.smoke.test.mjs`. Many of its
assertions read **source text** rather than rendered output, because they pin
invariants that never reach the DOM (lock ordering, clamp bounds). That makes them
sensitive to file moves, so every path it touches lives in one `SOURCE` map at the
top of the file — update that map, not scattered string literals.

The test builds with esbuild and gets its aliases from `willowAliasPlugin`, so it
tracks `tsconfig.base.json` automatically. The plugin is registered *after* the
boundary mocks so mock specifiers still win.

## Gotchas

- The `alias` array in `vite.config.ts` mirrors `tsconfig.base.json` and is
  ordered **longest-prefix-first**, because Vite takes the first match.
- `server.fs.allow` includes the repo root, because source lives outside this
  folder (`features/`, `platform/`, `assets/`).
- `define` replaces two `@babel/types` build flags — narrower than shimming a
  whole Node `process`, and intentionally so.
- `dist/` is committed build output; don't hand-edit it.
- `src/settings/tabs/index.ts` and `src/shell/sidebar/index.ts` are barrels that
  nothing currently imports (call sites use deep paths, per the root `AGENTS.md`).
  Harmless, but don't take them as the house style.
- Import sidebar siblings from `'./index'`, **never `'./sidebar'`**. On a
  case-insensitive filesystem the latter resolves to `Sidebar.tsx` itself, and the
  resulting circular self-import makes its named exports `undefined` — which black-
  screens the whole app. There is a comment on this at the import site; leave it.

## Sidebar Recents: the one hot render path

The Recents list renders one row per chat, so **anything done per row is done
hundreds of times per redraw** — and the sidebar redraws often, including on
scroll (`handleScroll` sets `isScrolled`/`isAtScrollEnd`), on hover-driven menu
state, and on every keystroke while renaming.

Rules:

- **Never call a per-chat function that scans a whole store.** Resolve it once
  per render and index into the result. `codeChats` (a `useMemo` over
  `readCodeChats`) exists for exactly this; `codeChats[chat] === true` replaced a
  per-row `isCodeChat()` that walked all of localStorage each time, which is what
  made a large history lock up the UI on every render.
- **The lazy Code-mode migration effect must NOT depend on `codeChats`.** That
  effect calls `markCodeChat`, which invalidates the memo. Depending on it
  restarts the scan on every mark, cancelling an in-flight body read for a chat
  already recorded in `codeChatScannedRef` — permanently losing that chat's
  Code-mode marker. It deliberately calls `isCodeChat()` instead, which the
  module-level cache makes O(1). There is a comment saying so; leave it.
- `pinnedChats` is an array and the render does `.includes()` per row. Fine at
  current sizes, but it is the next thing to make a `Set` if the list grows.

**Still outstanding (deliberately):** rows are neither memoized nor virtualized,
so all rows exist in the DOM and redraw together. This is a *linear* cost, not the
quadratic one above, and only matters at thousands of chats. Note that memoizing
`SidebarItem` alone does nothing — each row's `actions`, `onClick` and
`customLabel` are built inline in `Sidebar.tsx`, so React sees new props every
render regardless. The prerequisite is extracting a row component that takes
stable primitives and callbacks keyed by chat id. If you virtualize, the row being
renamed and the row with an open menu must stay mounted even when scrolled out of
view, or unmounting the input drops the pending rename.

<!-- related-packages -->

## Related packages

**This package imports from:**

- [`features/agent-builder`](../../features/agent-builder/AGENTS.md) — the Agents workflow canvas
- [`features/auth`](../../features/auth/AGENTS.md) — login / account UI
- [`features/chat`](../../features/chat/AGENTS.md) — the standalone chat surface
- [`features/code`](../../features/code/AGENTS.md) — the Workbench: sandbox and visual editing
- [`features/design`](../../features/design/AGENTS.md) — the design surface
- [`features/media`](../../features/media/AGENTS.md) — AI image and video generation
- [`features/onboarding`](../../features/onboarding/AGENTS.md) — first-run flow
- [`features/projects`](../../features/projects/AGENTS.md) — project browser UI
- [`features/spark`](../../features/spark/AGENTS.md) — scheduling / background-task agent
- [`platform/ai`](../../platform/ai/AGENTS.md) — model clients, chat orchestration, computer use
- [`platform/auth`](../../platform/auth/AGENTS.md) — Firebase, `useAuth()`, `useUserData()`
- [`platform/core`](../../platform/core/AGENTS.md) — utilities, types, constants
- [`platform/projects`](../../platform/projects/AGENTS.md) — project data model and registry
- [`platform/storage`](../../platform/storage/AGENTS.md) — persistence, adapters, sync
- [`platform/ui`](../../platform/ui/AGENTS.md) — shared components

**Imported by:**

- [`features/chat`](../../features/chat/AGENTS.md) — the standalone chat surface
- [`features/code`](../../features/code/AGENTS.md) — the Workbench: sandbox and visual editing
- [`features/media`](../../features/media/AGENTS.md) — AI image and video generation
- [`features/projects`](../../features/projects/AGENTS.md) — project browser UI

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
