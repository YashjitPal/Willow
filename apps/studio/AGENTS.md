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
| `src/app/shell-routes.ts` | Each shell surface's address, both ways. See *Every shell surface has an address*. |
| `src/app/ShellRouteSync.tsx` | Keeps the address bar on the surface on show, and opens the surface an address names. |
| `src/app/ShellRequestHandler.tsx` | Shows the surface a feature asked for: a Spark page, or a new chat that opens on one exchange. |
| `src/shell/sidebar/` | Sidebar, its icons, primitives, appearance + user menus. |
| `src/shell/SearchModal.tsx` | Global search. |
| `src/shell/BackgroundContext.tsx` | Which animated background is active. |
| `src/settings/` | Settings modal and its eight tabs, plus the full-page settings routes. |
| `src/settings/provider-settings.ts` | API keys and endpoints. Module scope, deliberately — see below. |
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

A route that renders outside `mainAppShell`, as `/project1` and `/media/*` do,
must mount its own `SettingsModal`. Without one, anything in it that opens
Settings only sets the open flag, and the window appears after the user leaves.

### Gating one behind Labs

**Agents, Design and Projects are all gated this way** — they are unfinished, so
the alpha ships them off by default behind `agents-surface`, `design-surface` and
`projects-panel` rather than putting a half-built surface in the rail.
`darker-design-background` is the fourth flag, and it toggles a style rather than
a route.

Four pieces, and the lazy import is what makes the gate meaningful rather than
cosmetic:

1. A flag id in `ExperimentId` and a `false` default in
   [`platform/core/src/experiments-store.ts`](../../platform/core/src/experiments-store.ts).
2. An entry in `src/settings/labs-experiments.ts`. That roster is the only place
   a row is declared and **both** Labs surfaces render it, so this is one edit
   rather than two — see *Labs has two surfaces* below. (Two entries there carry
   `id: null`: static mock-ups with no flag behind them, which each surface draws
   inert. Only wire the ones backed by a flag.)
3. A `ViewType` member plus a sidebar row wrapped in `experiments['<id>'] && (…)`.
   The Sidebar reads `experimentsStore` through `useStore`.
4. A `React.lazy` route in `App.tsx`.

**Hiding the sidebar row is not the gate.** A surface with a URL keeps that URL
whether or not anything links to it, so each flag is read in four more places in
`App.tsx`: the `currentView` initialiser, the early return in `handleViewChange`,
the pathname/`searchParams` sync effects, and a redirect effect that bounces off
a gated URL. That last one is also what unsticks a user who turns a flag *off*
while sitting on the surface — the sync effects only decline to *enter* a view,
which would otherwise leave Home rendering under a `/design` address bar.
Agents exits through the existing `agentBuilderDraftFlush` path, so switching the
flag off mid-edit still gets the draft-save prompt.

Projects has had a URL (`/projects`) since every shell surface got one, so it is
gated in the same places, plus a small effect that commits `'home'` if the flag
goes off while the page is open. Do not make the render chain's final `else`
conditional on the flag — that branch is what holds the Projects page on screen
during a notebook transition, and gating it would reintroduce the dark flash the
transition exists to prevent.

Because the route is lazy, a user who never enables the flag never downloads the
chunk — the experiment costs nothing to ship. Doing step 3 without step 4 would
leave the feature's code in the initial bundle for everyone.

Note the counter-example: the Code harness is *not* lazy. It lives inside a
sub-app that is already lazy, so it rides in the Code chunk that a user opening
the Code tab downloads anyway. Something every user of a surface needs is a
different shape from a surface only some users can reach.

## Every shell surface has an address

Gemini's where Gemini has the part, Willow's own for the rest:

| On show | Address |
| --- | --- |
| Chat: a new chat, or a temporary one | `/app` |
| Chat: a saved chat | `/app/<chat>` |
| Code: its home, and the chat it has open | `/code`, `/code/<chat>` |
| Media's home | `/create` |
| Spark | `/spark`, `/spark/tasks`, `/spark/chat/<task>`, `/spark/schedules`, `/spark/skills`, `/spark/apps` |
| Projects (Labs) | `/projects` |

`src/app/shell-routes.ts` maps a surface to its address and back. `/` is the
shell's too, and becomes the address of whatever is on show. Every other page
keeps its own path: Gems, notebooks, the settings pages, the Media editor
(`/media`), the Code project editor (`/project1`) and Agents (`/?view=agents`).
`<chat>` is the chat's id (its title, once it has one) with `.` escaped as well:
the dev server reads a dot in the last segment as a file. `/code/<chat>` names
the chat of the Code home on show until it is promoted into a project
(`$codeScreenChats`, published by `WorkbenchSidebar`).

`ShellRouteSync` keeps the two in step:

- **The URL decides on a page load and on Back/Forward (a POP); the shell decides
  the rest of the time**, and the URL is written to match.
- **A user step is a history entry of its own**: another surface, a chat picked
  from Recents or Search, New chat, a Code chat opened. Anything else replaces the
  entry it is on: a chat taking its title, `/` becoming `/app`, an address naming a
  chat that is not there. The signal for a pick and the chat it opens can land
  renders apart, so the pick counts for the next address change within 2 s.
  Leaving a settings page, a Gem, a notebook or Projects replaces that page's entry
  (`handleViewChange`), as it did before the shell had addresses.
- **A chat named by its address opens by what it is**: `/app/<a Code chat>` opens
  in Code and the other way round (`checkCodeChat`), and the address is corrected.
- **The address holds until the shell shows what it named.** The reader acts once
  and settles on the render where the state matches. The writer runs in the same
  effect pass as each act, with the state from before it; settling there wrote the
  old chat back over a Back. A chat that never opens lets go after 10 s.
- **A Back is told apart by the router's `location` object, not its key.** Spark's
  entries copy the key of the entry they came from, and the entry a page loads
  with has none, so a second Back to it looked like the load.
- **Spark keeps its page in each entry's state** (`willowSparkLocation`) and pushes
  its own entries, which the router never sees. Its addresses are written with a
  raw `history.replaceState(history.state, …)` so the entry keeps its page. On
  Back/Forward, Spark restores from that state before the router's location update
  lands (the router's updates are transitions), so the reader opens a Spark address
  with `replaceSparkLocation`, which writes the page into the entry too. An entry
  whose state and address disagree had its address rewritten to the state's page.

`apps/studio/test/shell-routes.test.mjs` pins the mapping and these rules.
`tools/scratch/shell-urls.cjs` and `shell-urls-extra.cjs` walk them in a browser
context of their own; `shell-urls-chats.cjs` opens saved chats by address in the
debug browser's own workspace, read-only.

### A feature asking for another surface

A feature cannot reach App, so one that has to show another surface asks through
`@willow/core/shell-request`, and `src/app/ShellRequestHandler.tsx` carries each request
out once:

- **A Spark page** (`requestSparkLocation`): a chat's scheduled-action card asking for its
  schedule in Spark's editor. The same three steps as the sidebar's Spark rows, so the
  address and Back behave as they do from there.
- **A seeded chat** (`requestSeededChat`): Spark's Skills page "Create with Gemini" leaves
  Spark for a new chat already holding "Create a skill" and Gemini's question. The seed is
  set before New chat remounts ChatView, and the new ChatView takes it as it mounts, so
  the chat that was open never sees it.

## View swaps are transitions — do not make them urgent again

`commitView` wraps every `setCurrentView` in `startTransition`, and that is load-
bearing. Sub-apps are lazy chunks, so a first visit suspends while its code
downloads; as an urgent update that suspension commits at once, the outgoing page
is already unmounted, and the route's `Suspense` fallback (an empty div) is all
there is to paint — the content pane goes dark for the length of the download.
Held as a transition, React prepares the new tree off-screen and keeps the current
page committed until the new one can paint whole.

Measured off Gemini opening a notebook (`tools/ui-research/captures/notebooks/timeline.json`,
and `scrapers/notebooks/` re-runs it): the incoming page mounts 338ms after the
click, the outgoing one is torn down at 564ms, and the composer sits at 582,381
660x64 in every one of the 388 frames in between. Gemini overlaps the two views
rather than blanking, and is *slower* than Willow at fetching the page — you never
see it, because you spend the wait looking at the page you came from.

Three things follow, all of them already wired:

- **The top bar is now the only proof a click was heard.** It used to be raised by
  the route fallback mounting; that fallback no longer mounts, so an effect on
  `isViewPending` raises `view-transition` instead. Remove it and navigation looks
  like a dead click for the length of the download.
- **`heldNotebookId` exists because the URL moves before the view does.**
  `activeNotebookId` is derived from the pathname, so it clears the moment a
  navigation away from a notebook starts, while `currentView` is still `'notebook'`
  — and the render would fall through to the projects branch for those frames.
- **Chunks are prefetched at idle** (`loadNotebookPage`, `loadComposer`), so the
  held interval is short in the common case. The transition is what makes it
  invisible; the prefetch is what makes it brief.

## Screens that keep working after you leave them

Chat turns and Spark runs live in module-level stores and need nothing from the
shell. Code, Design and the Media editor run their work inside the screen's own
state, so `App.tsx` keeps a working screen **mounted and hidden** until it settles,
instead of unmounting it on navigation:

- **Code and Design render outside the view switch**, ahead of it inside
  `StudioLayout`, while they are the surface or still working (likewise Design).
  Each publishes a busy flag (`$runningCodeScreens` by screen name,
  `designTurnRunning`); `useKeepAlive` / `useKeepAliveKeys` hold the screen for
  that plus `KEEP_ALIVE_GRACE_MS` so its last save starts. Coming back while it
  works shows the same instance, state and draft intact.
- **New chat is Chat's alone.** It never resets a Code home: one left idle unmounts
  anyway, so the next visit starts fresh, and one still working carries on.
- **Code homes are a list** (`CodeHomeEntry`), the one on show last, each portalled
  into its own container (`CodeHomeSlot` holds the one on show). There is one,
  unless a Recents Code chat is opened while the one on show is working: that chat
  gets a new Code home and the working one carries on, hidden, until it is done.
  A chat a Code home already has open (`$codeScreenChats`) is shown as it is, never
  read back over its running turn. App routes every open (`code-chat-open-store`)
  and hands the chosen Code home the request until it has opened the chat.
- **Hidden means `BACKGROUND_SURFACE_STYLE` plus `inert`**: fixed, full size,
  `opacity: 0`, behind everything. Not `display: none`, because Code's preview
  tools need a frame with a size; not `visibility` alone, because a descendant can
  turn visibility back on. `onWorkspaceActive` is passed only while visible, so a
  hidden workbench cannot keep the sidebar collapsed.
- **The Media editor is `MediaKeepAlive`, above the routes.** The `/media/*` route
  keeps only the guard, the first-project redirect and the settings window. Hidden,
  the editor renders inside `<Routes location={lastMediaLocation}>`: its hooks would
  otherwise read the studio's URL, find no project and reset the project still
  generating. `MediaBackgroundContext` tells it to keep its body-level overlays
  (Scenebuilder, character pages, editors) invisible and inert, and to drop its
  snackbar and hover previews.
- **Opening another project in the Media editor still stops the first**: Media's
  character, scene and collection stores hold one project each, so two live
  editors would fight over them.
- **Code runs any number of screens at once** (`features/code` AGENTS.md: each
  has its own state). `CodeProjectScreens`, above the routes like Media, keeps one
  screen per reopened project (`project:<id>`): the one at `/project1` on show,
  any other one hidden while its turn runs (`useKeepAliveKeys`). The route keeps
  its guard and the settings window, plus a `RouteMarker` that says the guard let
  the project through; each `WorkbenchView` renders inside `<Routes location={…}>`
  against its own last location. Screens keep their insertion order in the DOM,
  so none ever moves, which would reload its preview. So a project's turn carries
  on while the user is in the Code home or another project, and the other way
  round. Nothing extra stays mounted while nothing runs: an idle screen goes the
  moment it is left.
- **One project, one screen.** Two screens on one project would write the same
  folder. Each screen's autosave publishes the folder it writes
  (`$codeScreenProjects`), and a project the Code home has open reopens there
  (`openCodeHome`) rather than at `/project1`.
- **Work also carries on in another tab** (`platform/core` AGENTS.md): Chat,
  Spark, Code (`code-turn`) and Media (`media-work`). A tab inheriting a Code or
  Media job mounts the hidden screen its place needs — the Code home for an inbox
  chat, a project screen for a promoted one, the editor for Media — and never over
  one already open: Code waits while the Code home (for a chat) or that project is
  open here (`CodeTurnTakeover`'s gate), Media while any editor is
  (`MediaKeepAlive`'s). The screen re-runs the work and settles the request.

Verified with `tools/scratch/bg-keepalive-steps.cjs` (Code home kept through
Media and New chat), `bg-code-two-screens.cjs` (the Code home and two projects
together, the grace, one project per screen, frame timing), `bg-takeover-code-open.cjs`
(a closed tab's Code turn inherited while Code is open, in a browser context of
its own) and `bg-takeover-media-sim.cjs` — all without a model, through the
app's own stores.

## Feature registration

`platform/*` cannot import `features/*` (see the root `AGENTS.md`). When a
platform system needs feature-specific behaviour, the feature registers it and
`src/app/register-features.ts` is the single place those registrations are pulled
in. It is imported once, for side effects only, and order does not matter.

## Dev server and plugins

`npm run dev` serves the app on **:3000** with `strictPort` — it fails loudly
rather than drifting to another port, because the QA harness and the backend's
same-origin assumption both depend on that number. The plugins, all
`apply: "serve"` or effectively dev-only, include:

- **`remoteBrowserProxy()`** — claims any request whose Host is
  `<base32 origin>.wb.localhost` and hands it to `api/_browse-proxy.js`, Spark's remote
  browser (see `features/spark/AGENTS.md`). It goes first so it gets first refusal.
  The proxy is re-imported keyed on its file's mtime, because Node caches an import
  for the life of the process, Vite restarts included; `_private-host.js`, which it
  imports, still needs a dev-server restart after an edit.

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
- **`hmrResumeState()`** — serves `/__willow/hmr-state` (when the server started,
  when it last pushed a change) for `src/app/hmr-resume.ts`. Chrome closes a
  frozen tab's WebSockets (background tabs, and every tab during Modern Standby),
  and Vite's client reloads any page whose socket closed the moment it runs again
  — so clicking a Willow tab used to reload it with nothing changed. The client
  now reloads only if the server restarted or pushed a change meanwhile; otherwise
  it keeps the page and reloads on the next change. Measure this with
  `Page.setWebLifecycleState` over CDP, and note a woken headless page stays
  `hidden` until something makes it visible, as a real click does.
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
- **`src/app/App.tsx` must export nothing but the `App` component.** In dev, an edit
  to any module App imports (`@willow/ai/chat`, `media-storage`, `registry`,
  `LocalFSContext`, …) hot-updates up to App; if App also exports a helper, React
  Refresh rejects it and Vite fully reloads **every open tab** — background tabs
  apply it when you switch back, and each reload costs the local-folder grant. An
  exported `matchNotebookRoute` did exactly that. `platform/auth/AuthContext.tsx`
  still reloads everything, because `main.tsx` imports it directly.

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
- **A row's label is `chatDisplayName(chat)`, never `chat`.** A chat id is its
  on-disk filename, so a title the naming model has already used gets a
  de-duplicating " (2)" appended to keep the two files apart. That is storage
  bookkeeping and the reader has no use for it, so every surface that shows a
  chat name — Recents, the notebook's Past chats, search results, the Rename
  field's prefill — strips it. Everything that *addresses* a chat still passes
  the raw id: select, rename, delete, pin and the code-chat maps are all keyed
  by the filename, and a stripped id points at nothing.
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

## Models & API has two surfaces, and one store behind them

The same settings are reachable two ways, and both stay:

| Entry | Surface |
| --- | --- |
| Profile menu → Settings → **Models & API** | `settings/tabs/ModelsTab.tsx`, inside `SettingsModal` |
| Sidebar gear → **Models** | `settings/tabs/models-api/ModelsApiPage.tsx`, at `/models-settings` |

The page is not a re-skin of the tab — it is a separate component drawn in the
language of the other full-page settings (`#0f0f0f`, one centred 800px column,
`#1e1f20` cards on a 12px radius, Google Sans Flex), with every control the tab
has doing the same thing. The one thing it drops is the tab's two-page provider
pager: that exists because six cards did not fit a dialog's content pane, and a
page lists all six.

Its accents are the **workspace colour**, not a fixed hue. `ModelsApiPage` reads
`getWorkspaceTheme(userProfile?.workspaceColor)` and hands the CSS three
variables, the way the notebooks pages do: `--ma-primary` from `creamy.hex` (the
pastel that tints configured providers, checkmarks and focus rings) and
`--ma-accent-button-bg`/`-hover` from `sendButton.*` (the deeper pair that fills
"Add to models"). Those two roles are the same ones they play on the agent cards
and the composer's send button — keep them distinct, or a button reads as another
icon tile. The defaults in `ModelsApiPage.css` are Willow Green's; do not
hardcode a hex anywhere else in that file.

**They must not each own the keys.** Two pieces are therefore module-scope in
`settings/provider-settings.ts`, not component state:

- the `$providerState` atom both surfaces render from,
- the Firestore eviction, single-flighted per uid.

`SettingsModal` stays mounted after its first open (the `hasOpenedSettings` latch
in `App.tsx`), so both surfaces are alive at once. Two copies of this would mean
two loads of `users/{uid}` and a key typed on one surface invisible on the other.
`useProviderSettings` is only a subscription; call it from as many surfaces as you
like.

**There is no debounce.** This section used to describe a "400ms debounced save"
and two writers racing over a 400ms-old snapshot. Neither has ever existed in the
file — `updateProviderConfig` writes `$providerState`, both localStorage keys and
`modelConfig` synchronously on every keystroke. What actually prevents the race is
that all three writers pass an updater function to `setModelConfig` rather than a
computed object, so each one reads the latest state. Keep it that way; a debounce
added later would reintroduce exactly the hazard the old text imagined.

**Other tabs share the catalog and nothing else.** Every tab writes its whole
`modelConfig` to one localStorage key, but on a `storage` event `App.tsx` takes only
the saved models and their order; each provider's picked model, thinking levels
and system defaults stay the tab's own. So a config taken from another tab is never
written back (`createTabCatalogSync` in `app/model-catalog-storage.ts`). The two
configs differ, a write-back reads over there as a fresh change, and the tabs used to
trade writes for as long as both were open, with a model added meanwhile flickering
in and out of Settings → Models in both. The handler also reads what is stored now
rather than `event.newValue`, which a later write may already have replaced.
`test/model-catalog-tabs.test.mjs` runs two tabs over one store.

**The folder's list comes first for a browser starting over.** The catalog is also
`Models/catalog.json` in the user's folder (`app/register-model-catalog.ts`). A browser
that has never synced it — Willow's storage cleared, a reinstall, another copy of Willow
on the folder — holds only `DEFAULT_MODEL_CONFIG`'s models, written on its first render,
and the driver takes an item it has no record of for a local change to export. Handed over
as it was, that wrote Willow's three Gemini models over the user's list, which went to the
Recycle Bin as a conflict copy on the next pass. So until the driver holds a hash for
`catalog`, `readLocal` takes the folder's list as it stands (adopting it, and handing the
engine the file's own text, so nothing differs), and this browser's own additions — never
the `default-` models — follow as an ordinary change on the next pass.
`test/model-catalog-disk.test.mjs` runs it through the real driver.

**The key field holds a list.** `splitApiKeys` splits it on commas and newlines at
the point it is cached, so the bucket is a real array — it used to store the whole
string as one element, which is how `"sk-aaa, sk-bbb"` came to be sent verbatim as
a single credential. `streamChat` then tries them in order, and only on an auth
rejection arriving before the first token. Both halves are needed for the hint
under the field to be true.

The offered-model roster and its pricing table are shared for the same reason, in
`settings/provider-models.ts`: a model added on either surface lands in the one
`modelConfig` the composer reads, so it has to be the same record either way.
Several assertions in `test/model-catalog.test.mjs` read that file as source text.

### Adding a model

Usually two edits, both in `settings/provider-models.ts`: an entry in the
provider's list and a row in the pricing table. Everything downstream keys off
the id's shape, so a well-named model needs nothing else — `providerOfModelId`
reads the prefix, `familyRank` and `versionOf` in `@willow/ai/models/auto-select`
place it on the price ladder, `getModelCategory` in `@willow/core/model-catalog`
decides text vs image/video/audio, and `chat.ts` picks the thinking map off
`model.includes('flash')` and friends.

The exception is a model whose **reasoning scale differs from its family's**.
Those need the request layer to agree with the picker, or the user selects an
effort the API cannot be sent. `GEMINI_FLASH_WITHOUT_MINIMAL` in
`@willow/ai/models/efforts` is the worked example: Gemini 3.7 and 3.8 Flash start
at Low, so they appear there, carry `hasNone: false` in the catalogue, and
`chat.ts` floors a stored level 0 up to 1 off the same list. When in doubt about
an undocumented model, fail *closed* — a missing cheap step costs the user a
choice, while a `minimal` the API quietly upgrades to full thinking costs them
money and tells them nothing.

## Labs has two surfaces

Same arrangement as Models & API, for the same reason, and both stay:

| Entry | Surface |
| --- | --- |
| Profile menu → Settings → **Labs** | `settings/tabs/LabsTab.tsx`, inside `SettingsModal` |
| Sidebar gear → **Labs** | `settings/tabs/labs/LabsPage.tsx`, at `/labs` |

The page is not a re-skin of the tab. It is drawn in the language of the other
full-page settings — `#0f0f0f`, one centred 800px column, `#1e1f20` cards on a
12px radius, Google Sans Flex, the same 68px top margin — while the tab stays
dialog-shaped, with 14px type on `border-white/5` dividers.

**Neither surface owns the roster or the flags.** The rows come from
`settings/labs-experiments.ts` and the flags from `experimentsStore` in
`@willow/core/experiments-store`. That store was already the single writer, so
unlike Models & API there is no load or debounced save to single-flight — a flag
flipped on the page is flipped on the tab behind it, which matters because
`SettingsModal` stays mounted after its first open. Duplicating the row list
would be the real hazard: an experiment offered on one surface and hidden on the
other is a feature the user can only find by luck.

Its switch is **`PersonalIntelligenceTab`'s MDC slide toggle reproduced geometry
for geometry** in `LabsPage.css` — 52x32 track, a 16px handle growing to 24px and
travelling 20px, 75ms on `cubic-bezier(0.4, 0, 0.2, 1)` — so a toggle is the same
object on every settings page. The one intended difference is colour: the Personal
Intelligence copy hardcodes Gemini's blues, while this reads the workspace colour,
taking `--lp-switch-on-track` from `creamy.hex` and `--lp-switch-on-handle` from
`sendButton.bg`, the same two roles they play on the Models page.

**Every selector in `LabsPage.css` is prefixed `.labs-page-container`, and that is
not optional.** It styles a switch, and `PersonalIntelligenceTab.css` /
`SavedInfoTab.css` are plain global imports that already collide with each other
on `.header`, `.section` and `.page-content` — an unprefixed `.mdc-switch` rule
here would repaint the Memory toggle two pages over. The class names carry an
`lp-` prefix for the same reason.

## Settings > Activity

`src/settings/tabs/activity/` and the `/activity` route.

**Gemini's Activity entry is not an in-app panel.** It opens a new browser tab at
`myactivity.google.com/product/gemini` — Google's account-wide My Activity page
scoped to the Gemini product. That page is what the clone reproduces, rendered
inside the shell rather than as a separate tab.

Because those stylesheets are cross-origin, `document.styleSheets` exposes **no
rules** for them; the authored CSS came from CDP `CSS.getMatchedStylesForNode`,
which does see them, and the geometry from `getBoundingClientRect`. Captures live
in `tools/ui-research/captures/activity/`, the scrapers beside them.

Values that look arbitrary and are not:

```
column        608px fixed, centred; min(608, 100vw - 48) below ~672px
card          rgba(209,225,255,.08), radius 1rem, padding 16px 16px 0
group header  #3c4043, padding 1rem 1.5rem, radius .5rem, margin 1.5rem -24px 0
row           padding 16px 0, border-top 1px #5f6368 except first in group
row action    height 49px, margin -13px -13px 0 0   (49 is measured, see below)
chevron disc  #202124 — `.CjA3B .oLR88b` overrides the card's own tint
```

- **The group header is 48px wider than the column**, bleeding 24px past it on each
  side. That is the `margin: … -24px` above, not a mistake.
- **`.activity-row-action` is 49px, not 48.** Gemini's `.YxbmAc` measures 48x49 — the
  extra pixel is its line box's descender — and it is what makes the row head resolve
  to `49 - 13 = 36`. Set it to 48 and every row is 1px short.
- **The menu enter animation is `scale(.8)`, and it was inferred rather than
  guessed.** Two captures of the same menu disagreed at 200.4x177 and 160.3x141.6;
  both ratios are exactly 0.8, so the smaller was sampled mid-animation. That pins
  the settled box and the transform at once.
- The "On" chip's dropdown items are not guesswork either — Google ships the
  `role="menu"` markup inside the card unopened, so it reads out of the static HTML.

`21-verify-willow.cjs` diffs the built view against `20-containers.json` element by
element and prints the deltas; run it after touching this file. Two entries always
differ and should: `.activity-column` (Willow's holds the list too, Gemini's wraps
only the header block) and `.activity-row-product` (10.6px narrower, because
"Willow Apps" is a shorter string than "Gemini Apps").

**Never click an unknown control on the live page to find out what it does.** Both
48px icon buttons on that page — the one on each row and the one on each date group —
are deletes that fire immediately with no confirmation, and their `aria-label` says
so (`"Delete activity item …"`, `"Delete all activity from Yesterday."`). A scraper
that assumed the row button was an overflow menu permanently destroyed a real entry
from the account. `16-observe.cjs` exists for this: it installs listeners and records
while a human drives, and clicks nothing itself.

## Connected Apps: the connect popup

Turning a card on asks first, as gemini.google.com/apps does with its
`tool-consent-dialog`. `ConnectConsentDialog.tsx` draws it and `connect-consent.ts`
says what it holds; both sit beside `ConnectedAppsTab.tsx`. Turning a card off asks
nothing, as on Gemini's page.

- **Three layouts, as Gemini has.** Workspace takes Gemini's
  `first-party-tool-consent-dialog` (six product logos, a 24px headline, the account
  pill). GitHub takes `github-consent-dialog`. YouTube and Spotify have no dialog of
  their own on Gemini, so they take the generic one: the server's consent blocks,
  measured on Webflow.
- **The switch reads on while the popup is up**, and stays on while the connection
  it started runs. Cancel, Escape and a click on the backdrop all close it and put
  the switch back once the popup has gone, which is when Gemini's moves back too.
- **Connect calls `toggleConnection` from inside its own click.** A provider's sign-in
  window has to open from a user gesture, so nothing may be awaited before it.
- **GitHub asks from its token field**, since that is where it connects. Declining
  resolves `null`, and `GithubTokenRow` shows no "token rejected" error for it.
- **The buttons are Gemini's `gem-button`s**: a state layer at 0.08 on hover and 0.12
  pressed, and Material's ripple from the pointer (`launchMaterialRipple` from
  `@willow/chat/material-ripple`, in `rgba(230, 230, 230, 0.1)`). Hovering the cancel
  button shows Gemini's "Cancel consent dialog" tooltip.

Rules that are not obvious from the result:

- Gemini's lumi dialog keeps `scrollbar-gutter: stable` for its 12px scrollbar, so
  on a mouse the text column is 12px narrower than its padding. That scrollbar is
  `(pointer: fine)` only, so touch keeps the full column.
- Every link in the content is a dotted underline from the font
  (`text-decoration-style: dotted; text-underline-position: from-font`). That is the
  lumi dialog's own rule, and it overrides each layout's `.link`.
- Subheadings declare weight 700 over a `"wght" 400` axis. Google Sans Flex is
  declared 280–540, Gemini's face and `index.html`'s alike, so 700 is drawn as
  synthetic bold. Do not "fix" it to an axis value: Gemini's look is the faux bold.
- The first-party heading is not a Material dialog title. It is headline-m at 24px,
  where the other layouts' `h1` is 20px.
- At 960px and below the surface is `#1c1c1c`, text and labels `#e0e0e0` and the
  tonal button `#141414`. At 768px and below the panel takes the screen's height
  (`100dvh`) and the dialog's container stops at 650px, so the surface runs the full
  height with the content at its top.
- Workspace's layout is built from Gemini's code and tokens, not a live capture: every
  first-party app in the reference account is connected, and disconnecting one is
  the only way to see it.

To capture it in Gemini, open the popup from an app that is off and dismiss it with
its own cancel button. That leaves the account as it was, as long as the app asks
first. Third-party apps do. A switch without the consent flag connects at once, so
never click one you have not checked in the bundle. The scripts are in
`tools/ui-research/scrapers/gemini/apps-connect/`: `02-consent.cjs` and
`04-responsive.cjs` for Gemini, `w-consent.cjs` for Willow. Captures are in
`tools/ui-research/captures/gemini/apps-connect/`, and
`apps/studio/test/connect-consent.test.mjs` pins the values.

## Settings pages at 960px and below

The settings pages that have a Gemini counterpart follow that page's own narrow layout,
measured at 390x844 and 800x1280. The desktop rules are untouched: every change lives in a
`(max-width: 960px)` block (split at 768px where Gemini splits) or behind
`useCompactViewport()`.

| Willow route | Gemini page |
| --- | --- |
| `/personalization-settings` | `/personalization-settings` |
| `/saved-info` | `/saved-info` (now "Instructions for Gemini") |
| `/connected-apps` | `/apps` |
| `/import` | `/import` |
| `/usage` | `/usage` |
| `/gems` | `/gems/view`, the Gem manager part only |
| `/gemini-spark` | `/gemini-spark` |
| `/activity` | `myactivity.google.com/product/gemini` |

The pages Gemini has no counterpart for take the narrow treatment of the page they are
drawn after, Personal Intelligence: Labs (`/labs`), Models & API (`/models-settings`),
Memory (`/memory`) and Search chats (`/search`). The rules are the same as below:

- The page starts under the 68px bar on black and drops the 68px it held inside.
- Headings take Gemini's narrow axes: display `"ROND" 100, "wdth" 100, "wght" 360`,
  title `"ROND" 20, "wdth" 94, "wght" 470`.
- Cards keep their desktop surface.

Memory's pills keep their labels on one line and wrap as a row, a memory's ⋮ opens
`GeminiBottomSheet` as Saved info's does, and its add / edit dialog closes on Escape.

On Models & API, the model and provider lists are one `minmax(0, 1fr)` track below
961px. An `auto` track grows to a row's min-content: the full unwrapped model name plus
the price pill and both buttons. In a provider's detail that pushed the whole page
sideways. Under 600px even a row's fixed parts are wider than the card, so a model row
takes two lines: the logo and the buttons span both, with the name over the price
between them. Check a page like this by every state, not just its first screen: each
provider's detail, the custom-model form, every dropdown open, each settings-modal tab
and its inner views, and the dialogs.

Gemini's Scheduled actions, Skills and Your public links rows have no Willow page; they
open the settings modal, as do Willow Notebook and Agents Settings. Below 961px that
modal is a full-screen, two-level settings screen:

- **List level:** a 32px "Settings" title over the tab rail, with 48px rows.
- **Tab level:** a 64px bar with a back arrow and the close button, over the tab's own
  title and content, inset 24px instead of 48. Opening on a particular tab goes straight
  to it.
- **Under 600px:** the tabs' description-beside-field rows stack, and card grids go one
  to a row.

The Agents tabs and the Media, Code, Design and Waifu surfaces are out of scope here;
Customize has [its own section](#customize-at-960px-and-below). The settings sheet itself
scrolls without a visible scrollbar.

**Every page scrolls in a region that starts under the top bar.** Gemini's
`.content-wrapper` begins at y=68, so content never passes beneath the menu button, and
the band above it is the app's black. Each page root therefore takes
`margin-top: 68px; height: calc(100% - 68px)` and drops the 68px it used to hold inside.
My Activity is the exception: it has its own fixed `#131314` app bar, 64px on a tablet and
56px under 600px, painted with a shadow into the space the margin leaves.

**The surface is black.** Below 961px Gemini's settings pages sit on `#000`; only the
windows that paint themselves keep a colour — `#131314` for Connected apps and Import
(each only as tall as its content), `#0f0f0f` for the Usage section, `#1c1c1c` for Spark
settings. Cards and pills on the narrow layout use `#141414` where the desktop has
`#171717`, and links read in on-surface `#e0e0e0`.

Per page, the things that were not obvious:

- **Saved info** replaces its fixed `650px 52px` desktop grid with
  `"title toggle" / "intro intro" / "buttons buttons"` over `minmax(0, 1fr) 52px`, and a
  saved instruction's actions open `GeminiBottomSheet` from `@willow/ui` instead of the
  dropdown. Its add / edit dialog also closes on Escape, as Gemini's does.
- **Connected apps** on a tablet spans the Workspace card over three tracks of a
  two-column grid, as Gemini does, which adds an implicit 184px third column at 800px. On
  a phone the cards drop to one column at their content height, and `.ca-collapsed-content`
  needs `flex: 0 0 auto` there or it claims no space and the cards overlap.
- **Import** uses Gemini's percentage padding, `3% 2.5%` of the page width.
- **Usage limits** drops its info popover below the button where it would end past
  436px, and slides it to stay 4.8px inside the screen.
- **Spark settings** headings carry `"ROND"`; the desktop rules spell it `"RNDS"`, which
  the font ignores. The Usage title's `"RNDS" 20` is Gemini's own typo and is kept.
- **Gems** renders Gemini's `is-mobile` variant: the premade cards in one row that scrolls
  sideways, and two-line rows with 28px logos. Gemini's retiring-Gems banner and Opal
  gallery above the manager are Google's own content and are not reproduced.

Seen while measuring, and left alone because they are desktop: `SavedInfoTab.css`'s
`.page-content` margin shorthand uses `--gem-sys-spacing--xxl`, which only the Personal
Intelligence container defines, so the whole declaration is dropped and the desktop page
starts at y=0; and the Personal Intelligence switch shows its check and minus icons side
by side when on.

`apps/studio/test/settings-responsive.test.mjs` pins the narrow rules and the desktop
values they leave.

## The Notebooks top bar at 960px and below

Gemini's notebook list and create screens carry its top bar: the **wordmark** beside the
menu button and a **New chat** button at the right. `StudioLayout` renders both for the
`notebooks` and `notebook-create` views — "Willow" in place of "Gemini", at [56,14],
18px at `"wdth" 94` scaled by 0.888888 as Gemini's is, and a 36px `gemini_chat` button
12px from the right edge. Both start a new chat. The notebook page itself shows the
model picker there instead, as a chat does, which is why `NotebookPage` takes
`renderModelPicker`. The rest of the narrow Notebooks layout is documented in
[`features/notebooks`](../../features/notebooks/AGENTS.md#phones-and-tablets), and
`apps/studio/test/notebooks-responsive.test.mjs` pins it.

The **Gems** view (`/gems/*`) gets the same bar, with one exception. In the Gem editor
(`isGemsEditor`, `/gems/create` and `/gems/edit/…`), the wordmark gives way to the model
picker the editor renders through `renderModelPicker`, as on Gemini. In a Gem's chat
(`$chatGemId` set), the narrow bar is the ongoing chat's New chat button rather than the
temporary-chat button and avatar. See
[`features/gems`](../../features/gems/AGENTS.md#narrow-screens-960px-and-below).

## Customize at 960px and below

Gemini has no Customize surface to measure, so `/customize` borrows from the narrow
pages that do. The desktop is untouched: the rules live in `(max-width: 960px)`, `740px`
and `600px` blocks at the end of `CustomizeView.css`, and the menus switch on
`useCompactViewport()`.

- **The top bar.** `StudioLayout` gives the `customize` view the Notebooks bar above:
  the wordmark beside the menu button and New chat at the right, on every Customize
  screen.
- **The first row.** The Discover / Connectors / Skills pills, and the back row of a
  category page, a connector's details or the skill editor, open the page at y 68 as a
  36px row with 32px under it. That matches the space above it: the menu glyph's ink ends
  at y 36. The row needs `flex: none`, because the category page's sits straight in the
  scrolling flex column, which would squeeze it. Its focus rings are drawn inset, since
  the scroller's top edge clips one drawn outside.
- **Cards.** Nothing hovers on a touchscreen, so a card's + and ⋯ stay visible. Once
  the grid is one column (740px), the cards fill it rather than keep their 348px.
- **Under 600px:**
  - Headings stack over a full-width search, with Skills' Create beside it.
  - A connector's Use in chat and ⋯ drop under its title.
  - Related apps go to one column.
  - The skill editor's card pads 16px, and its instructions start at 320px.
  - The three starter prompts become 200px cards in a row that scrolls sideways, edge
    to edge as the Gems premade row does.
- **Menus.** A card's ⋯ menu and the Create menu are `GeminiBottomSheet`s:
  - The card menu stays mounted for `cardMenuExitMs(true)`, 200ms, so the sheet's 180ms
    exit plays out.
  - The Create menu's click-outside handler stands down. Otherwise the tap on a sheet
    item counts as a click outside and closes the menu before the click lands.
- **Confirmations.** Disconnect and "Leave without saving / creating" are `message`
  dialogs, so they take the 332px mobile panel.
- **Scoping.** The detail and editor views use generic class names (`.top-nav-bar`,
  `.app-header`, `.prompts-row`), so their narrow rules are scoped under
  `.customize-page-root`.

`apps/studio/test/customize-responsive.test.mjs` pins all of this.
`tools/scratch/customize-walk.cjs` walks every screen, sheet and dialog with touch taps
and reports anything that scrolls sideways, sits past the edge, or overflows the screen.

## Code at 960px and below

The Code tab's narrow layout belongs to the feature and is documented in
[`features/code`](../../features/code/AGENTS.md#phones-and-tablets). The shell's part
is one condition: the narrow account avatar is not drawn while `isSidebarHidden` is
set. The Code workspace and Design set it, and their own headers own that corner.

## Related packages

**This package imports from:**

- [`features/agent-builder`](../../features/agent-builder/AGENTS.md) — the Agents workflow canvas
- [`features/auth`](../../features/auth/AGENTS.md) — login / account UI
- [`features/chat`](../../features/chat/AGENTS.md) — the standalone chat surface
- [`features/code`](../../features/code/AGENTS.md) — the Workbench: sandbox, visual editing, and the Code harness
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
