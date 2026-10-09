# apps/desktop

Willow as a desktop app, built with Tauri v2. The window shows Studio exactly as
a browser would — answered by the app itself on Windows, served by Willow's own
production server elsewhere — as one page under a strip that replaces the system
title bar. The app adds what a browser tab cannot have: it
lives in the tray, keeps running with its window closed, can open at login,
raises native notifications, opens a native folder picker, and starts the local
companion, so dots can work on the user's computer.

Its own npm package (only `@tauri-apps/cli`) and a Rust crate. Nothing in
`features/` or `platform/` depends on it: web code reaches it only through
`platform/core/src/desktop-bridge.ts`, which falls back to browser behaviour.

## Layout

```
apps/desktop/
  package.json            dev / build / stage / tauri scripts
  shell/                  The app's own pages (Tauri's frontendDist)
    tabs.html             The strip: back and forward, the menus, the pet's paw, window controls
    index.html            What the page shows while the server starts: "Loading..."
    overlay.html · .js    The pet's transparent window: runs the surface it is handed
  scripts/
    build.mjs             Willow's build (no .env), stage, Node.js, `tauri build`
    pack.mjs              This PC's Willow updated: typecheck, then its pages in place, or build.mjs and the installer
    dev.mjs               Vite on :3417 + `tauri dev`
    stage.mjs             Assembles build/willow/, the app's payload
    node-runtime.mjs      Fetches and checksums the bundled Node.js per target
    lib.mjs               Paths, the MSVC environment on Windows, the CLI
  src-tauri/
    tauri.conf.json       Identity, bundle (willow-node sidecar, willow/ resource)
    Info.plist            macOS: merged into the bundle's; why Willow asks for the microphone
    Entitlements.plist    macOS: the audio-input entitlement a hardened-runtime build needs
    capabilities/willow.json   What Willow's pages may call: folder picker, notifications, the window's keys
    capabilities/shell.json    What the strip may call: window controls, back and forward, the paw
    capabilities/overlay.json  What the pet's window may call: its surface, input, focus, messages
    build.rs              Declares the app's commands, so capabilities grant them one by one
    src/main.rs           Origin, tray, startup, the companion hand-off
    src/pages.rs          Windows: Willow's pages answered inside the app; its server over a pipe
    src/local_folder.rs   The Willow folder the pages save into, handed over already able to write
    src/tabs.rs           The window, the strip and the page: state, layout, commands
    src/snap.rs           Windows 11 snap layouts on the strip's maximise button
    src/menus.rs          Windows: the right-click menu, WebView2's own commands in Willow's menu
    src/pets.rs           The pet's overlay window, the pet library, and their routing
    src/agents_backup.rs  A daily copy of the agents' conversations in the Willow folder
    src/processes.rs      The server and companion processes, and their cleanup
    app.manifest          Windows manifest: Common Controls 6, Windows 8+ compatibility
```

## How it works

1. The window opens with the strip and the page on `shell/index.html`: the
   frame Willow's page sits in, with the Media tab's "Loading..." in its page, in
   the theme and colour Willow was last in.
2. On Windows, the page answers Willow's address itself (see "Pages without a
   server" below), so nothing starts on Willow's port. Elsewhere, Willow's
   server — `bin/willow.js`, the same file `npx willow-studio` runs — starts
   under the bundled Node.js (`willow-node`) on Willow's port. Either way the
   local companion starts beside it on a free port with a fresh pairing token,
   and with `WILLOW_COMPUTERS_DIR` — the local (never roaming) app data's
   `computers/` — which turns on dots' own computers: a WSL 2 machine per dot
   (`services/local-companion/AGENTS.md`). The job object below takes those
   machines down with Willow.
3. Once Willow can be answered — at once on Windows, when the server answers
   elsewhere — the page navigates to its address on
   `http://localhost:<port>/`. Initialization scripts, run before Willow's own
   scripts on every load of that origin, write `willow_companion_url` and
   `willow_companion_token` (which `features/code/src/local-companion.ts`
   reads) and wire the window's keys.
4. Closing the window hides it; the tray has Open Willow, Open Willow at login
   and Quit Willow. A second launch focuses the running one. Started at login,
   Willow passes `--hidden` and opens straight into the tray.

The agents' server (`harness.rs`) also gets `WILLOW_MOBILE_PORT` (its own port
plus one) and the companion's port and token. With them it serves Willow's page
to phones paired with it, for Willow's Android app (`apps/android`), and relays
the companion to them (`vendor/t3code/apps/server/src/willow/mobile.ts`).

### The window

`tabs.rs` builds the window itself (Tauri's multi-webview API, behind its
`unstable` feature): a 40px strip webview (`shell/tabs.html`) and, below it,
Willow's page in a webview of its own, on Willow's origin and profile. There are
no tabs of Willow's own: one page, as Codex's window has (the strip only draws an
agent tab's side-panel tabs for it, below).

- **The frame**: no system title bar on Windows and Linux; the strip draws
  Windows' caption buttons at its right end. Labs' "macOS window buttons"
  (offered only in the app and not on macOS, which shows its own; the page
  reports it through `window_buttons` and `tabs.json` keeps it) puts macOS's at
  its left instead — red, yellow and green lights, 12px in 14px buttons 20px
  apart from 16px in, where Codex puts macOS's own (`trafficLightPosition`),
  marks showing while the pointer is over them and grey while another window is
  in front (`snap.rs` hears the foreground change; the window's own focus flag
  turns off whenever the page takes the keyboard). At the left come back and
  forward — Codex's title-bar pair, 28px ghost buttons with its arrow, dimmed
  where the page has nowhere to go (`page_script` reports the Navigation
  API's `canGoBack` / `canGoForward`, which count Willow's own pages only, never
  the loading page it starts on), Ctrl+[ and Ctrl+] as Codex has them — then
  File, Edit and View — Codex's Windows menu bar (`windowsMenuBar`)
  less Help, its sizes and colours — then the pet's paw, in the same ghost button
  as back and forward: just the paw, with nothing round or filled behind it,
  in the text colour while the pet is out and faded while it is away. The strip
  is 40px with no room below it, so a menu opens over the page:
  `tabs::menu_open` hands it to the page, Willow's `AppMenu` draws it hanging from
  the button (Codex's items where Willow has the command, Settings at the end of
  Edit as Codex has it on Windows) in Willow's own menu (`MenuPanel` in
  `apps/studio/src/shell/rail`: the pane and rows of Willow's Recents and settings
  menus, Gemini's measured `mat-menu`, a glyph on every row, shortcuts in the
  dimmer text, dividers in the outline colour), and either side closes it. Edit's commands and zoom
  are their keys, pressed into the page (`tabs::menu_keys`, only while Willow is
  the window in front), so the page's own undo, paste and zoom answer them. Alt
  held underlines the access keys, Alt+F/E/V or F10 opens a menu, F11 is full
  screen and Ctrl+Q quits (`page_script`). Its empty space drags the window
  (double-click maximises), and a 4px grip along its top resizes it (the side and
  bottom resize borders are the system's, kept by the frameless window's shadow).
  macOS keeps its own traffic lights and menus there.
- **Size**: the window shrinks as far as Codex's does and no further, to
  480 × 600 (its `getPrimaryMinimumSize`). The rail and the rounded page stay at
  every width, as Codex's do. Willow's page has its narrow layout at 960px and
  below, where its sidebar is a drawer: in the frame the drawer, its scrim and the
  button that opens it are placed in the page, beside the rail, which clips the
  drawer while it is put away (`AppRail.css`). The strip keeps the menus' names
  while everything fits beside them, and puts them away where it would not (a
  larger text size) — their keys still open them.
- **The rail's Code and Media**: reached from the rail (`AppRail`) alone — the
  sidebar has no rows for them in the app, as it has on the web — and theirs is
  the whole page: no sidebar, nor the button that opens it, beside them
  (`isSidebarAway`, from App.tsx). The sidebar stays mounted while away, so
  Home's lists are as they were; the rail's first button is Home.
- **The frame never goes**: a Media or Code project and Willow TV sit outside the
  main shell (StudioLayout), so App draws the same frame for them (`DesktopFrame`:
  rail, page, the strip's menus, Ask Willow) and lays them over its page
  (`willow-frame-fill`); the full-window pages inside them (Scenes, Characters,
  Tools), the Design canvas and Spark's taken-over browser keep to the page with
  `--willow-frame-inset` and `--willow-frame-page-radius` (`AppRail.css`). From
  there the rail takes the shell's own steps (`rail-navigation.ts`), through `/`.
- **Places are kept**: every rail destination is a tab of its own, kept mounted once
  opened, so going back to one finds it exactly as it was — its draft, its scroll, its
  open panels — rather than built again. In the shell the chat, Spark, Media's landing,
  Customize and the Code home each stay mounted, hidden while another is on show
  (`keptShellTabs` in `App.tsx`); Bots stays beside the rest of Spark inside Spark's one
  workspace, which runs its schedules and turns (`withBots` in `SparkWorkspace.tsx`);
  and the shell itself stays mounted beside a Media or Code project and TV, against its
  last address (`ShellKeepAlive`). A hidden tab is `inert`, so what listens on the whole
  window checks for that — files dropped on a composer, Escape on the chat's canvas and
  research panels, the `body:has(…)` rules — and only the frame on show answers the
  strip's menus and opens Ask Willow (`ShellActiveContext`). Media and Code go
  back to the project left there (`rail-returns.ts`), its screen kept mounted
  meanwhile, so it is exactly as it was; pressed from that project they go to their
  landing, which lets it go. Bots goes back to the bot left open and Spark to the page
  left open — the two share one location in Spark's store, so each keeps its own —
  and from there to the bots list and Spark's home. Home keeps its chat by itself,
  and Customize its section and open item (`CustomizeView`'s `left`).
  A landing's address lets it go only while that landing is on show: an agent tab
  opened from a project moves the shell behind it to `/create` (or `/code`), the
  surface it last showed, and that used to forget the project. The places are kept
  in `sessionStorage`, so a reload (an update, the agents starting) keeps them too,
  and the address a reload comes back on lets nothing go: behind an agent tab it is
  the landing's, and the tab does not survive the reload.
- **Tooltips**: the strip's buttons have Willow's tooltip, never the system's
  `title` bubble. The strip has no room below its 40px for one either, so it tells
  the page which button and what (`tabs::strip_tooltip`, in device pixels, since
  the two may be zoomed apart), and the page draws Willow's own (`TooltipOverlay`
  from `platform/ui`, in `StripTooltip`) against that button's span, just above
  its top edge. The maximise button's comes and goes with the snap-layouts
  window's hover, which owns its mouse. The rail's tooltips are Willow's too.
- **The agents' panel tabs**: while an agent tab with its side panel open is on show,
  the strip draws that panel's tabs (pages, files, the diff, terminals) over the panel,
  from its left edge to the window buttons, then the panel's + and room to drag the
  window by: Willow's page hands them over (`tabs::strip_panel_tabs`, from
  `features/harness` HarnessView.tsx, which has them from the agents' page) and takes
  them away when another destination comes to the front, and a page load clears them.
  Too many scroll sideways, fading out at whichever end has more. A click, a close, the
  middle button or a right-click goes back to the page (`tabs::panel_tab`), which acts on
  the tab and draws the + menu and the tab's menu under the strip, as it draws the
  strip's menus; the agents' page moves the surface's own bar up into the panel's row.
  Only the page may set them; titles are drawn as text, a site's icon by address, and a
  tab's glyph only as a PNG mask (the strip has none of Willow's icon fonts).
- **Right-click** (`menus.rs`, Windows): on Willow's pages WebView2's own menu for
  what was clicked — spelling suggestions, editing, the link's and the image's
  commands, each enabled as it should be — is drawn by the page at the pointer in
  Willow's menu (`ContextMenu`). WebView2's `ContextMenuRequested` hands the items
  over (less what keeps or sends the page — save, print, share — and its flyouts,
  and Copy link to highlight, which makes a `#:~:text=` link for a browser's
  address bar that Willow's pages are never opened from) and waits; the command
  chosen goes back (`context_menu_choose`) and WebView2 runs it on what was
  clicked, as its own menu would, so the menu never takes the keyboard: a paste
  lands where the caret was. Its point is in the webview's own pixels, which the
  page's zoom divides into the page's: the menu's corner is the pointer at any
  display scaling. One menu at a time — a new one answers the last with nothing.
  Other origins keep WebView2's menu; the strip has none.
- **Ask Willow** (Windows): the selected text comes with the menu
  (`ContextMenuTarget`'s `SelectionText`), and with some selected the menu starts
  with Ask Willow, which answers WebView2 with nothing and opens the canvas's
  floating prompt beside the selection (`features/chat/src/AskWillow.tsx`):
  questions about the passage, answered by the composer's model in the canvas's
  floating window.
- **Snap layouts** (Windows 11): Windows opens its snap-layout menu over a
  window whose hit test answers `HTMAXBUTTON`, but the strip's maximise button
  is HTML in WebView2, whose window belongs to another process and answers
  for itself. `snap.rs` puts an invisible native child window over the green
  button (layered, alpha 1/255, which needs the Windows 8 entry in
  `app.manifest`) that answers `HTMAXBUTTON`. It owns the mouse there, so it
  also maximises and restores on click and calls
  `willowTabs.maximizeButton({ hover, pressed })` so the strip still draws the
  buttons' states. `tabs::layout` keeps it on the button and above the
  webviews.
- **Mica** (Windows 11 22H2 and later, which have `DWMWA_SYSTEMBACKDROP_TYPE`):
  Codex's window has Windows' Mica behind it (`backgroundMaterial: 'mica'`, its
  page see-through around its surfaces), so the shell behind its rail and title
  bar is the material: the wallpaper's tint, blurred, while the window is in
  front, and a flat colour while it is behind another. Willow's window is made
  without a surface of its own (`WS_EX_NOREDIRECTIONBITMAP`), the strip and the
  page are transparent webviews, and DWM is asked for the main window's backdrop
  (`tabs::apply_mica`), so the material is what shows wherever the strip and the
  frame leave it, under the workspace tint they lay. Its light or dark is the
  window's theme, which is Willow's (`tab_frame` switches it), never the system's.
  Extending the frame over the window, or a transparent window (tao's empty
  blur-behind), left holes onto the windows behind instead: a window with its own
  surface paints it, and over that surface DWM draws no backdrop. Pages learn it
  from `window.__WILLOW_MATERIAL__`. Earlier Windows, macOS and Linux draw the
  flat colour.
- **Look**: the strip sits on the shell of the frame around Willow's page
  (`frameShell` in
  `platform/core/src/workspace-theme.ts`: the workspace colour's hue, as dark as
  Codex's `#1A2227`, tinted clearly enough to see), laid as a light tint (35%)
  over the grey Mica falls back to (`#202020`, `#f3f3f3`), or over Mica itself
  when that is on: Codex lays nothing over the material there. Willow's page reports
  the colour through `tab_frame`, and `tabs.json` keeps it for the next launch.
  `#1F1F1F` until Willow has said.
- **Starting**: the frame (the shell's tint, the rail's column, the rounded page)
  and "Loading..." in its page until Willow has painted; the rail's buttons come
  with Willow, whose frame is drawn in the same place. The window,
  the strip's webview and the page's start in the colours of the theme Willow was
  last in (`page_color`, Willow's page surface; `strip_color`, the strip's own mix;
  with Mica, the material in that theme), so nothing white shows before a page
  paints, between two pages, or along an edge the webviews have not caught up
  with in a resize, and `tab_frame` keeps them on the theme. The page shows `shell/index.html` until Willow answers: the frame
  in the colour `__WILLOW_FRAME__` says (the one `tab_frame` last kept) and the Media
  tab's "Loading..." (`features/media` FlowLoadingPage) letter by letter in its page,
  light or dark as `__WILLOW_LIGHT__` says. Willow's own first paint carries it on in
  the desktop app (`#willow-boot` in `apps/studio/index.html`, in the theme
  `willow_theme` resolves to and the colour `reportDesktopFrame` last kept), each
  letter timed from the clock so the two pages are in step, until the app paints over it.
  The letters are in the system's face: Willow's web fonts are not there yet, and
  one arriving midway would change them.
- **Keys** (pages and strip): Ctrl+W, and Ctrl+F4 on Windows, close the window to
  the tray, as File → Close does (Codex's `closeWindow`); Ctrl+[ and Ctrl+] go
  back and forward. Cmd on macOS.
- **New windows**: a Willow address opens in the page, moved there by its own
  router (`history.pushState` and a `popstate`), so nothing running in it stops;
  Willow's files (`blob:`, Spark's "open in a new tab") and sized popups (sign-in
  windows) get windows of their own; anything else opens in the user's browser.
- **Lifecycle**: the page opens where it was last time (`tabs.json` in the
  config directory; one written while the window had tabs opens where the tab
  in front was). Closing the window hides Willow to the tray, so its page keeps
  running.

State lives in Rust; the strip only draws it (Rust calls
`window.willowTabs.render(snapshot)` in it after each change). Commands are
`async`: a synchronous command that made a webview would deadlock on Windows.
The lock is never held across a call into Tauri.

### The pet

Spark's pet (`features/spark/src/pets`, which has the whole story) stands on
the desktop. `pets.rs` is the host side of BetterGravity's `plugin.overlay` and
`plugin.pets`, which the pet was written against:

- **The overlay window** (`overlay`, `shell/overlay.html`) is transparent,
  undecorated, always on top, off the taskbar, and covers the primary display's
  work area. Willow's page opens it with a surface — a function's source, its
  styles, its data — which the page runs as `(Overlay, data)`. It is
  click-through (`set_ignore_cursor_events`) except while the surface says the
  cursor is over something it drew; such a window hears no pointer moves, so a
  thread feeds it the cursor every 25 ms, and while the pet is dragged moves it
  to the display under the cursor. It is focusable only while typed into (and,
  on Windows, while solid, so clicks land). The pet's context menu is a native
  one. Messages from the surface go to the page that opened it.
- **The library** is `Pets/` in the Willow folder (`local_folder::folder`), beside
  the chats and projects: `Pets/<id>/pet.json`
  and a 1536 × 2288 PNG or WebP sheet, validated here (id, version 2 manifest,
  paths that stay in the package, the sheet's size read from its header), and
  `Pets/.hatching/<run>/progress.json` for a creation and its working files. It was
  `pets/` in the app's data directory; what is there moves over once, on the first
  read (`move_old_library`). The page's sync never scans `Pets/`. The page is
  told when anything there changes (polled once a second). Creation runs' images can
  be read and written by Willow's pages only inside a run (`pets_read_image`,
  `pets_write_image`). The Hatch Pet skill is staged beside the server.
- **The paw** in the strip is drawn from what the page keeping the pet last
  reported (`pets_report_shown`) and presses back to it (`pets_toggle`).
  `pets_show` raises Willow and has the page open a task or focus its composer.
- WebView2's arguments are the page's own (every webview must share them), and
  the window-state plugin leaves the overlay alone.

### The origin is fixed, on purpose

Willow keeps everything — chats, dots, settings, API keys — in the webview's
localStorage and IndexedDB, which belong to an origin. A different port would
be a different origin, and Willow would open empty. So the port is chosen once,
from 41730–41829 (below Windows' dynamic range, where Hyper-V and WSL reserve
blocks at boot), and saved to `server.json` in the app's config directory. On
Windows it is only an address: nothing listens on it, and another program using
it changes nothing. Elsewhere, if another program holds it at startup, Willow
says so and stops rather than moving, and a server left on the port by an
earlier run is recognised and reused.

### Pages without a server (Windows)

The page's `fetch` is wrapped (`pages::stream_script`) only to read `/llm-proxy`
as it streams; every other request goes to the browser untouched. The wrapper
reads a request's address without building a `Request` from it: a `Request` made
from another takes that one's body, and Firestore's channel, which sends
`Request`s with bodies, then had nothing to send — Firestore reported itself
offline, a signed-in account read as new (onboarding again) and saves never
finished.

`pages.rs` has the page answer Willow's addresses itself, through WebView2's
`WebResourceRequested`: `http://localhost:<port>/…` and Spark's remote-browser
sites at `http://<site>.wb.localhost:<port>/…`. The origin is the same as
before, so nothing stored there moves. The page opens on `shell/index.html` and
goes to its address only after the handler is attached, so no request can reach
the network first.

- **Willow's files** come from the install's `apps/studio/dist`, served as
  `bin/willow.js` serves them: the app's fallback for routes, a 404 for a
  missing asset, long caching under `assets/`, and the dot character frame's
  isolation headers (its engine needs `SharedArrayBuffer`).
- **Spark's browser, `/llm-proxy` and `/api/fetch-source`** need Willow's
  server, which starts the first time one of them is asked for: `bin/willow.js
  --pipe \\.\pipe\willow-<id>`, listening on a named pipe rather than a port.
  It answers only requests carrying this launch's `WILLOW_PIPE_TOKEN` and
  strips it before anything is passed on.
- **Streaming.** WebView2 gives a page an answered request's body only once all
  of it has arrived. Files and pages do not mind; a model's streamed answer
  would arrive as one block. So an initialization script (`stream_script`,
  Willow's origin only) sends the page's fetches for `/llm-proxy` through the
  `pages_stream` command, and the reply comes back in pieces as it arrives,
  with `pages_stream_cancel` for an aborted fetch.

The window uses `localhost`, not `127.0.0.1`, because that is the hostname
Firebase authorises by default.

### Why a bundled Node.js

Willow's server pieces (`bin/willow.js`, the browse proxy, `/llm-proxy`,
`/api/fetch-source`, the companion with Playwright) are Node programs already.
Serving the app from Tauri's asset protocol would change its origin per OS and
lose the server routes; rewriting them in Rust would fork them. Shipping the
official Node.js build as a sidecar (`externalBin`, ~90 MB, checked against the
release's SHASUMS256.txt) runs the same code as everywhere else on all three
OSs. Node SEA and `bun compile` were not needed: nothing here has to be one file.
The sidecar is called `willow-node` because Linux packages install sidecars into
`/usr/bin`, where `node` would collide with a system Node.

### Staying alive in the background

- **Windows**: WebView2 keeps timers running in a hidden window with
  `--disable-background-timer-throttling --disable-renderer-backgrounding
  --disable-backgrounding-occluded-windows` (set in `browser_args`, together with
  wry's defaults, which setting arguments replaces). Measured on the installed
  app: a 1 s interval and a chain of 1 s timeouts both kept time after 7 minutes
  hidden, past Chromium's 5-minute intensive throttling.
- **macOS 14+**: `background_throttling(Disabled)`.
- **Linux**: WebKitGTK has no switch for this; untested.

### Processes

`processes.rs` starts the server and the companion with their output in the
app's log directory (`server.log`, `companion.log`). On Windows both join a job
object that kills them — and anything they started — when Willow exits, however
it exits. Elsewhere each leads a process group that gets SIGTERM, then SIGKILL.
Measured: a hard kill of the app leaves no `willow-node` behind.

### Security

- `capabilities/willow.json` lets only `http://localhost:*` pages in the main
  window call the folder picker, the notification commands, the window's (close,
  full screen, quit, report the page's address), the strip's menus, the
  right-click menu's answer, and the pet's: its overlay, the pet library, images
  inside a creation run, the paw's state. No shell, and no filesystem beyond the
  library.
  `capabilities/overlay.json` gives the pet's window only its own five commands. `capabilities/shell.json` gives
  the strip — a page bundled with the app — the window controls, back and
  forward, its menus, its tooltips and the paw. App commands are declared in `build.rs`, so
  nothing is granted by default.
- The companion keeps its own model: loopback only, origin allowlist, and the
  per-launch token, which the page gets through the initialization script (main
  frame, Willow's origin only). A socket without the token is refused.
- Phones reach Willow only through the agents' server, and only while its network
  access is on (the agents tab's Settings > Connections). Its phone listener answers
  only clients paired with that server, by their session cookie. It relays the
  companion to them, adding the companion's token on this computer, so a phone never
  holds it. Phones get `/llm-proxy` and `/api/fetch-source` too, but not Spark's
  browse proxy.
- On Windows nothing listens on Willow's port, so no other program — a browser
  included — can open Willow; only the app's own page answers its address.
  Willow's server listens on a per-launch named pipe and refuses requests
  without that launch's token. `pages_stream` serves only `/llm-proxy`, and
  Spark's browsed sites (`*.wb.localhost`) match no capability, so they cannot
  call any command.
- `WILLOW_DESKTOP_DEBUG_PORT` turns on WebView2 remote debugging for tests. It
  is read only when set; never set it on a machine you share.

### The microphone

The composer's dictation and Live record, so each webview must hand Willow's pages
the microphone. `tabs::permission` (the app's `on_permission_request`) allows it for
Willow's origin only, on every platform. The system's own prompt still applies, but
the webview doesn't ask again on top of it, and WebKitGTK would otherwise refuse
outright. Spark's `*.wb.localhost` sites are another origin and get the webview's
default. Per platform:

- **macOS**: WKWebView ends the app on a microphone or speech-recognition request
  unless `Info.plist` has the usage strings, and a hardened-runtime build needs the
  audio-input entitlement (`Entitlements.plist`, named in `tauri.conf.json`).
- **Linux**: WebKitGTK has no `getUserMedia` until `enable-media-stream` is on, so
  `tabs::create_page` sets it on the page (the `webkit2gtk` dependency is Linux-only).
- **Windows**: WebView2 needs nothing more.

WebView2 and WebKitGTK have no working speech recognizer, so dictation there always
transcribes the recording (see `platform/ai/AGENTS.md`, *Dictation runs everywhere*).

### The local folder

Willow's local folder is a File System Access handle kept in IndexedDB (see
`platform/storage/ARCHITECTURE.md`), and of the three webviews only WebView2 has the
API. WebView2 drops every folder grant back to "prompt" when the app restarts, so
after each update a connected folder would sit behind Willow's Authorize modal, its
chats and projects missing until the user clicked it. So `tabs::permission` allows
the folder permission for Willow's origin too, and in the desktop app
`verifyPermission` asks for it again without a gesture: the folder the user picked
comes back on its own. Grants stay per handle, so this reaches only folders the user
chose in the picker, and Spark's sites keep the webview's default.

In the app, saving there is always on (`local_folder.rs`). On every start the page asks
for its folder (`openDesktopLocalFolder`), and the app hands over a handle WebView2 makes
for it with read and write already granted (`CreateWebFileSystemDirectoryHandle`, posted
with `PostWebMessageAsJsonWithAdditionalObjects`): `<home>\Willow`, made if missing, or
the folder picked in Settings → Connectors → Local Folder → Change folder (the system's
picker), kept in the config folder's `local-folder.json`. It stands in for the stored
handle when both are the same folder. Disconnect and the Authorize modal's Turn off are
gone from the app, and chats sent while it had no folder (the `browser` scope) join the
folder once. A picked folder is kept only after a test write works: Chromium keeps pages
out of AppData, Program Files and the like, whose handles open but take no writes.

A test copy must have its own `local-folder.json` pointing outside the user's folder,
written without a byte-order mark (PowerShell 5's `Set-Content -Encoding UTF8` adds one;
the app strips it now, but an unreadable file falls back to `<home>\Willow`): otherwise
it connects the user's real Willow folder and syncs a fresh profile's state into it —
including `settings.json`, so a setting the test changes changes in the user's app.

The app keeps two things of its own in the folder, beside what the page writes: the pet
library (`Pets/`, see "The pet") and a copy of the agents' conversations
(`agents_backup.rs`). The agents' tabs keep every thread in T3 Code's SQLite database in
the local app data (`agents/userdata/statev2.sqlite`); two minutes after start and every
half hour after, a database that changed is copied with SQLite's online backup (the
bundled Node's `node:sqlite`, then switched out of WAL mode so the copy is one file) to
`Agents/Backups/<local date>.sqlite`, the last seven days kept, beside a README saying how
to put one back. Copying the file itself would copy almost nothing: most of the database
sits in its write-ahead log. T3's `settings.json` and `keybindings.json` go to
`Agents/Settings/` when they change, with every value that could be a secret blanked (an
API key field, a server password, a provider variable marked sensitive or named like a
key or token; `scrub`). Never `userdata/secrets` or the logs, and only for
`com.willow.studio`, so a test copy never replaces the app's backup. When the agents' data
is not there at all — Willow's data removed, a reinstall, another computer on the folder —
the server's first start puts the newest backup and the settings back before it opens
anything (`restore_if_empty`, called from `harness.rs`); moving `Agents/` aside starts the
agents afresh instead. A backup names the database it came from (`willow-database-id` in
`userdata/`, `database-id` in `Backups/`), so a fresh database never writes over or prunes
another's backups.

Uninstalling with "Delete the application data" ticked removes `%APPDATA%` and
`%LOCALAPPDATA%\<identifier>` whole (Tauri's template; an update never does). The installer
hooks (`src-tauri/windows/hooks.nsh`, `installerHooks` in `tauri.conf.json`) set three things
aside first and put them back at the same paths after: `agents/` (worktrees, scratch, the
projects agents started, attachments), `computers/` (the bots' Linux computer, whose disk WSL
keeps registered at its path; `Willow-Computer` is stopped first, and only it) and
`local-folder.json` (a Willow folder the user picked). Same paths, so the worktrees' links,
the database's paths and the distro's registration still hold for the next install. If one
can't be moved (still in use), the uninstaller keeps the app data whole instead of deleting
around it. Anything left in `<data dir>.kept` is put back on the next start
(`put_back_set_aside` in `main.rs`). Tested by running the hooks around the template's
removal for a test identifier, in normal, in-use and update runs.

## Build and run

Rust (stable, via [rustup](https://rustup.rs)) plus each OS's Tauri
prerequisites: on Windows the MSVC build tools and WebView2; on Linux
`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`.

```powershell
npm run desktop:build    # installer for this OS
npm run desktop:dev      # Vite on :3417 and the app, rebuilt on change
```

`build.mjs` takes `--target <triple>` and `--bundles nsis,msi,...`. It builds
Willow with `apps/studio/scripts/build-production.mjs`, which reads no `.env`, so
nothing local ends up in an installer. On Windows, `lib.mjs` loads the developer
environment of a Visual Studio install whose MSVC toolset has the x64 C runtime
(found with vswhere), because Rust otherwise links with the newest install, and
a preview install without those libraries fails with LNK1104.

Output: `src-tauri/target/release/bundle/` — on Windows an NSIS installer
(~102 MB) that installs per user into `%LOCALAPPDATA%\Willow` (~255 MB). CI
builds every OS: `.github/workflows/desktop.yml`.

**Test copies** — a build under another identity, e.g. with
`TAURI_CONFIG={"identifier":"com.willow.studio.<you>test"}` and its own
`CARGO_TARGET_DIR` — have their own data and none of the user's: no chats, keys,
folders or account. They say "Willow (test copy)" in the title and carry an amber
Test copy tag in the strip (`tabs::test_copy`), because a user who finds one on
the taskbar takes it for their Willow with everything gone, and anything they add
there is lost with it. Start them minimised, close them and delete their data
(`%APPDATA%` and `%LOCALAPPDATA%\<identifier>`) when done, and never hand one to
the user to use. A build under the user's own identity at another address
(`npm run desktop:dev`, Vite on :3417) is worse: it opens their profile but not
their origin, so it shows an empty Willow and keeps what is saved in it where
their Willow never looks. Don't run it while they use Willow.

**Updating the Willow installed on this PC** goes through
`node apps/desktop/scripts/pack.mjs` (the user's `Pack in app.cmd` at the
repository root runs it, and is gitignored). It typechecks first (incremental),
since a build takes whatever is on disk and others edit this checkout at the same
time. Then, if only Willow's pages changed since the last full pack — the app's
own parts (`src-tauri`, `shell`, the staged server, proxy and companion) have the
fingerprint `build/pack-stamp.json` keeps, and the installed program is the one
that pack made — it rebuilds the pages, closes Willow, puts them in its
`willow/apps/studio/dist` and opens it again: about a minute. Otherwise (or with
`--full`) it builds with `build.mjs` and runs the installer with `/S /R`, which
closes Willow, replaces it, keeps its data and opens it again: about ten. One
pack at a time (`build/pack.lock`): a second waits, then builds from the newer
files, so the last pack carries everyone's work. It restarts the user's Willow,
so ask first. Don't copy files into `%LOCALAPPDATA%\Willow` by hand: the app's own
parts then fall behind the page, and the next pack can't tell.

## Verified (Windows 11, installed build)

The page loads on the saved origin with no console errors; the companion
handshake succeeds with the token and fails without it; notifications show; the
folder dialog opens and returns a path or `null`; `*.wb.localhost` resolves to the
server; the dots page renders; closing hides to the tray with timers running; a
second launch focuses the first; a hard kill leaves no Node processes; a
relaunch keeps localStorage; `--hidden` starts in the tray with Willow loaded.

The window: the system title bar is gone and the strip draws in its place, with
no tabs: back, forward, File, Edit, View and the paw, which has no circle behind
it whether the pet is out or away; `window.open` of a Willow page moves the page
there in the same document, and back returns; the strip's maximise and restore
work; the strip and the page follow the window when it is resized; at 480 × 600,
the smallest it goes, the menus' names still fit with the window buttons ending
at the window's edge, the rail stays beside the page in its narrow layout, and the
sidebar's drawer opens in the page beside the rail with the scrim over the page
alone; the app's loading page
and Willow's first paint
both read "Loading..." on `#0f0f0f`, or `#faf9f9` in the light theme; the strip's
close button hides Willow to the tray. Mica (Windows 11, over a window of the
test's own behind it): the strip and the frame show the material under the tint,
nowhere the window behind; flat while Willow is behind another window and tinted
by the wallpaper in front (`#f0f4f1` against `#edf5f5` in the light theme), light
or dark with Willow's theme; the snap-layouts window is still on its button.
Tooltips and menus (the real pointer over a window of the test's own, light and
dark): the rail's Home and the strip's buttons show Willow's tooltip, the strip's
under the button; File, Edit and View open in Willow's menu, hanging from their
buttons, and Escape closes them; a right-click on the composer opens Willow's menu
with WebView2's own rows (Emoji, Undo, Redo, Cut, Copy, Paste, Paste as plain
text, Select all), the ones that cannot run dimmed, and its Select all selects
the composer's text; a second right-click opens a new one. The menu's corner is
the point clicked, at 125% scaling; on selected text it reads Ask Willow, Copy,
Inspect, and Ask Willow opens the pill 4px under the selection with the caret in
it, then the floating window with the passage, the question and the streamed
answer, in both themes. Simulated pointers and screenshots of a window behind
others catch stale frames, mid-fade.

The pet (a debug build against the production bundle, 125% scaling): the
overlay opens on the work area and Rocky greets; a Spark task shows as a card
that says what it is doing, turns to Needs input and then Ready, opens its task
in the page when clicked, and goes when dismissed; the cursor over the
pet opens its cluster, makes it jump and turns the window solid, and leaving
makes it click-through again; the paw and the page's Hide pet put it away and
bring it back; the size setting resizes it on the desktop; Inside Willow moves it
into the page and back; a reloaded page reopens it; a creation run shows on
the Pets page as it progresses; creation images are written only inside a run.
Clicks and drags on the pet itself were not injected (the test shell cannot).

Snap layouts (a debug build, 125% scaling): the overlay sits on the button at
both window states, answers `HTMAXBUTTON`, and is the window under the cursor
there; hovering opens Windows' snap-layout menu with the button drawn hovered;
pressed and released, it maximises and restores. Clicks were sent as the
messages a click produces, because the test shell cannot inject input.

Pages without a server (a debug build under its own identifier, beside the
installed app): nothing listens on Willow's port and a request to it from
outside the app is refused; Willow loads with all 127–140 of its files and none
failing; `/api/fetch-source` answers over the pipe; Spark's browser opens a site
and keeps the cookies it sets across a redirect; `/llm-proxy` arrives in five
pieces 400 ms apart, as the upstream sent them, and aborting after two stops it;
the dot character frame is `crossOriginIsolated` with `SharedArrayBuffer`;
localStorage and IndexedDB survive a restart; Willow's server does not start
until something needs it.

## Not done yet

- macOS and Linux have not been run. `.github/workflows/desktop.yml` builds
  them (and Windows) with `build.mjs`, uploads the installers, and drafts a
  release on `v*` tags; it has not run yet, because nothing has been pushed.
  Of the microphone setup above, the Linux media-stream switch compiles only on
  Linux and has not been compiled, and the macOS plists have not been bundled.
- Code signing and notarization (SmartScreen and Gatekeeper warn), auto-update.
- The Agent Builder backend (`services/agent-builder`) is not started: the
  dev server mounts it, production deploys it separately.
- The icon comes from `assets/brand/willow-logo.png` (683 px); a 1024 px source
  would sharpen the largest sizes.
- The strip has only been run on Windows. The start has been checked page by
  page, not filmed from the first frame of a cold launch.
- The pet: only run on Windows, on one display. Creating a pet has not been run
  end to end: it needs Python 3 with Pillow and a Gemini image model, and the
  test machine had neither.
