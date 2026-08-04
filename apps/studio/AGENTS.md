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
