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
once per visible row per redraw** — and the sidebar redraws often, including on
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
  restarts the scan on every mark, cancelling an in-flight body read. It
  deliberately calls `isCodeChat()` instead, which the module-level cache makes
  O(1). There is a comment saying so; leave it.
- **That effect reads full chat bodies, so it is scoped to `scanCandidates`** —
  the visible window plus the active chat — not the whole history. It shares
  `enqueueChatOperation`'s per-chat queue with the user's own chat open, so an
  unbounded scan puts every click behind minutes of background reads. Because it
  now legitimately restarts whenever the window grows, a cancelled read **rolls
  its id back out of `codeChatScannedRef`** (`inFlight` in the cleanup). Without
  that rollback a restart skips the chat as "already scanned" while localStorage
  never recorded it, and the marker is lost for the session.
- Rows are windowed (`RECENTS_INITIAL_COUNT`, +`RECENTS_CHUNK_SIZE` on scroll)
  and live in a memoized `RecentChatRow`. **Every prop it takes must be a
  primitive or an identity-stable callback** — the handlers go through
  `useEventCallback` for this reason. Adding an inline arrow or object prop
  silently un-memoizes the entire list.
- **Three rows must never be windowed away**, via the `forced` set: the row being
  renamed (React does not fire `blur` on unmount, so the rename is silently
  discarded and `editingChatId` is stranded), the row with an open menu (the menu
  renders outside the map and would float next to nothing), and the active chat
  (it would lose its highlight).
- The window resets on `chatScopeId` and on re-expanding Recents, **never on
  `localChats`** — a rename or a new chat would collapse a list the user had
  scrolled open.
- The window is `recentsLimit + pinnedChatSet.size`, because pins are all hoisted
  ahead of the recents and would otherwise fill the whole first page.
- The "loading more" spinner has a deliberate `RECENTS_SPINNER_MIN_MS` floor. The
  rows are already in memory, so appending is synchronous — without the floor the
  spinner would mount and unmount inside one frame and never be seen.

**Still outstanding (deliberately):** rows are windowed but not virtualized, so
everything scrolled past stays in the DOM. Growth is bounded by what the user
actually scrolls to, which is the case that mattered.

<!-- related-packages -->

## Sidebar footer: profile, settings and the fade

The bottom of `shell/sidebar/Sidebar.tsx` reproduces Gemini's `mavatar-*` footer.
Values came from Gemini's authored CSS via CDP's `CSS.getStyleSheetText` rather than
from the DOM, because the tab was occluded by then and `document.styleSheets` had
shed most of its rules (5085 -> 502); sheet text needs no layout, so it was unaffected.

```css
.mavatar-footer-row      { display:flex; align-items:center; justify-content:space-between;
                           padding-block: var(--gem-sys-spacing--xs) }   /* 4px */
.mavatar-footer-left     { padding-inline: 5px 6px; gap: var(--gem-sys-spacing--s) }  /* 8px */
.mavatar-container       { height:30px; width:30px; padding-block:5px }
.mavatar-user-name       { color: var(--lumi-sys-color--on-surface) }    /* #e6e6e6 */
.mavatar-settings-button { height:32px; width:32px; color: var(--lumi-sys-color--on-surface) }
```

**The settings button is 32px, not 36.** It carried `h-9` and `#e3e3e3` for a while,
contradicting the 32px measurement its own adjacent comment already recorded.

**The fade is 16px over 150ms linear**, not a 56px wash on a 200ms default ease:

```css
.bottom-gradient-container { position:sticky; height:0; opacity:0; z-index:1;
  pointer-events:none; transition: opacity .15s linear }
.bottom-gradient-container.visible { opacity: 1 }
.bottom-gradient { height: var(--bottom-gradient-height, 16px); bottom: 0;
  background: linear-gradient(to top, var(--bottom-gradient-color), transparent) }
```

`--bottom-gradient-color` is `--lumi-sys-color--surface-bright` on the sidenav, which
resolves to `#1f1f1f` — the sidebar's own background, so the list dissolves into the
panel instead of sitting under a scrim.

**Fade with the gradient overlay alone.** The scroll wrapper also carried a
`mask-image` fading its last 10px to 20%, so the final row was dimmed twice. Gemini
has no equivalent: it uses the sticky `.bottom-gradient` element and leaves the
scroller unmasked. Gemini also defines a matching `.top-gradient` (same 16px, same
150ms) which is not reproduced here — the top edge sits under the header.

The settings pane uses the same surface as Gemini's menus (`.mat-mdc-menu-panel.lm-menu-theme`
is in the same authored rule as the plus-menu cards) and opens with the same
`expand-in` animation — 100ms `ease-in-out`, `scale(.5)` and `opacity .25` to 1,
`transform-origin: 0 100%` since it grows up and right from the gear. That animation
is applied **by analogy**: the plus menu and both its submenus were sampled directly,
the settings pane was not, because the tab was occluded by then. The keyframes are
duplicated into `Sidebar.css` rather than shared, which is what Gemini does too
(`_ngcontent-ng-c3600954668_expand-in` and `_ngcontent-ng-c3777966446_expand-in` are
two independent copies), and it keeps the sidebar off a composer stylesheet that need
not be mounted.

`apps/studio/test/gemini-sidebar-footer.test.mjs` pins all of the above.

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
