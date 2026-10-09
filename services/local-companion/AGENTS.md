# services/local-companion

An optional loopback daemon that gives Willow what the browser cannot have: a
**real Chromium session** it can screenshot and drive, and — inside a folder the
user explicitly authorised — **shell commands**, **background jobs** and
**file access** (reads, and the writes a bot's patches make). Spark uses the browser and shell; bots use the shell,
jobs and files (`features/spark/src/dots/harness/runtime/computer-bridge.ts`).
In the desktop app it also runs **bots' own computers**: a Linux machine per bot
under WSL 2 (below), and **Spark's native runtime**, Codex's command sessions and
file access on the user's computer (below). The desktop app starts it with the
window.

Plain `.mjs` on Node — no TypeScript, no build step. `src/index.mjs`, plus
`src/computers/` for bots' own computers. Its own npm package (`ws`,
`playwright-core`); the machine side has no dependencies at all.

## Run it

```powershell
npm install --prefix services/local-companion   # first time only
npm run companion:start                         # from the repo root
```

Listens on `ws://127.0.0.1:43117/ws`, plus `GET /health` for liveness. The browser
client is `features/code/src/local-companion.ts`; Spark falls back to its embedded
session when the companion is absent.

## Protocol

WebSocket JSON request/response with server-pushed events.

- **Request** → `{ id, type, payload }`; **reply** → `{ id, type: 'result', ok, result | error }`.
- **Events** (unsolicited) → `{ type: 'event', event, payload }`: `browser.frame`
  (a PNG data URL, pushed every 500 ms while a browser is open), `browser.tabs`,
  and `job.exit` (to every session, when a background job ends); `mcp.message` and
  `mcp.exit` go only to the session that started the program.
- `tool.list` returns the 24 supported operations.
- On connect the server sends `{ type: 'ready', sessionId, capabilities }`.

One session per socket. Closing the socket disposes the browser; authorised
folders are per session too, so a client authorises again after reconnecting.

Folder operations (all need a `workspaceId` from `workspace.authorize`):

- `shell.exec { command, cwd?, timeoutMs? }` → `{ code, signal, stdout, stderr }`.
- `job.start { command, cwd? }` → a job summary. Jobs belong to the process, not
  the socket: `job.read { jobId, since?, maxChars? }` (output from an offset, or
  the tail), `job.stop { jobId }` (the whole process tree; `signal: 'STOPPED'`)
  and `job.list` work from any session. Running jobs are killed on shutdown.
- `fs.list { path?, depth? }`, `fs.read { path, offset?, limit? }` (256 KB per
  read; binary files are reported, not returned), `fs.search { query, path? }`
  (case-insensitive, names and contents). Dependency, build and version-control
  folders are listed but not descended into.
- With `encoding: 'base64'`, `fs.read` returns a file's bytes as they are (`data`,
  3 MB a piece, `next` for the rest) and `fs.write` takes them (`data`, 4 MB a
  piece, `append` for every piece after the first): a file copied to or from a
  bot's own computer, as it is.

Commands go through `spawnShell`: `/bin/sh -lc` elsewhere, and on Windows
`cmd.exe /d /s /c "<command>"` with verbatim arguments — the way Node's own
`shell` option does it. Passing the line as an ordinary argument escapes inner
quotes with backslashes, which cmd.exe does not understand.

## Security model — read this before changing anything here

This process runs shell commands and drives a browser on the user's machine. Four
controls hold it in place; **do not weaken any of them without saying so explicitly:**

1. **Loopback only.** `HOST` is hardcoded `127.0.0.1`. Never bind `0.0.0.0` — that
   would expose command execution to the LAN.
2. **Origin allowlist.** `isAllowedOrigin()` accepts only `localhost` /
   `127.0.0.1` (any port), plus whatever `WILLOW_COMPANION_ORIGINS` adds.
3. **Optional pairing token.** If `WILLOW_COMPANION_TOKEN` is set, the socket must
   present `?token=`. Unset means dev mode: any localhost origin connects. The
   browser side reads the token from the `willow_companion_token` localStorage key.
4. **Workspace confinement.** Commands, jobs and file reads refuse to run until
   the client calls `workspace.authorize` with a directory, and `isInside()`
   rejects any `cwd` or path that escapes that root. Path traversal is checked via
   `path.relative`, not string prefixes. File reads also resolve symlinks before
   the check (`confinedPath`), and walks never follow links. Writes (`fs.write`,
   a bot's patches) check the real path of the nearest existing folder, refuse to
   write through a link or onto the root, and with `expectModifiedAt` leave a file
   that changed since it was read alone (`test/workspace-write.test.mjs`).
   `relay.telegram` reaches `api.telegram.org` only, for a bot token's own
   `getMe`, `getUpdates`, `sendMessage` and `sendChatAction`: never a proxy.
   `relay.http` carries the desktop window's MCP requests (pages cannot reach most
   MCP servers, which send no CORS headers): https only, every resolved address
   checked so nothing on this computer or its network is reachable, redirects
   refused, a few methods and headers passed, answers capped at 8 MB.
   `discord.call` reaches `discord.com/api/v10` only, for a bot token, on the
   routes listed in `src/discord.mjs` (the bot's own user and application, its
   servers' channels, reading and posting messages, typing, its own reactions,
   opening its DM, and its own picture, banner and name): nothing that manages a
   server or anyone else's account, ids and query values checked, bodies capped
   at 64 KB, answers at 4 MB. The one change a bot may make to itself,
   `PATCH /users/@me`, takes only `avatar` and `banner` (images as data URLs) and
   `username` (2 to 32 characters), with room for pictures (8 MB).
   `screen.*` (desktop app) reaches the user's own screen — Windows' shared
   desktop, macOS's apps in the background, or on Linux a desktop of the bot's own —
   never Willow's own windows, and on Windows holds off while the user is using the
   computer or it is locked ("The user's screen" below).
   `mcp.*` (desktop app) starts the MCP servers the user added as programs, exactly
   as they typed them and never through a shell of its own, without the pairing
   token in their environment ("MCP servers that are programs" below).

Also bounded on purpose: output truncated to 1 MB (per command, and kept per
job), command length to 20 000 chars, `shell.exec` timeout clamped to
250 ms–120 s, at most 8 jobs running and 50 kept, reads capped at 256 KB, writes at 2 MB, search
at 5 000 files of up to 1 MB, and URLs restricted to `http`/`https`/`about`.

Background jobs deliberately have **no time limit** — that is what they are for.
What keeps them in check is the caller: bots start one only after the user
approves that exact command, and stop their jobs when the folder is disconnected
or the bot is deleted.

## Discord

`src/discord.mjs`, for bots the user made Discord bots of their own
(`features/spark/src/dots/harness/runtime/discord.ts`). Discord's API sends no CORS
headers, and its gateway — the WebSocket messages arrive over — needs a heartbeat a
hidden page cannot keep, so both live here.

- `discord.call { token, method, path, query?, body? }` → `{ status, body }`: one
  REST request on the allowlist above; a rate limit of 10 s or less is waited out
  (twice at most).
- `discord.next { token, content, after?, epoch?, guildsVersion?, waitMs? }` →
  `{ epoch, after, events, state, problem?, user, content, contentRefused,
  guildsVersion, guilds? }`: opens the token's gateway on first use, then answers
  with what arrived after `after`, waiting up to `waitMs` (25 s at most) for
  something. Events are `message` (slimmed: ids, author, text, mentions, a reply's
  author, attachments' names) and `reaction`; the bot's own are left out. Servers
  and their channels come back only when the window's copy (`epoch` +
  `guildsVersion`) is old. The last 300 events are kept; a new `epoch` means a new
  gateway, read from its start.
- `discord.close { token }` closes it. A gateway nobody asked about for three
  minutes closes by itself, and all close on shutdown. Tokens are only in memory.

The gateway identifies with servers, server and DM messages and reactions, and
Message Content only when the window says the application has it (`content`):
Discord closes a connection asking for it otherwise (4014), and the gateway then
carries on without it (`contentRefused`). It resumes the session after a dropped
connection, a reconnect request or a missed heartbeat; a refused token (4004) and
the other fatal closes stop it with a `problem` for the user. Tested against a
stand-in gateway: `node --test test/discord.test.mjs`.

## Signing in to apps

`src/oauth.mjs`, for MCP servers that sign in with OAuth (the window's
`features/spark/src/mcp-signin.ts`; the protocol is `platform/ai/src/mcp/mcp-oauth.ts`).
Native apps sign in through the user's own browser and a loopback redirect (RFC 8252),
and this is that half. Only with the pairing token; the ready message lists `oauth`.

- `oauth.listen { port?, path?, host? }` → `{ id, redirectUri }`: an HTTP listener for
  one answer on 127.0.0.1 (plus ::1 for `localhost`, which a browser may resolve either
  way) — an ephemeral port, unless the user's own app was registered with a fixed one
  (ports 1024–65535; a port in use is said so). It answers the browser with a short
  page, broadcasts `oauth.callback { id, code?, state?, error?, errorDescription? }`,
  and closes; unanswered, it broadcasts a `timeout` and closes after ten minutes.
- `oauth.open { url }`: the sign-in page in the default browser — https only, passed
  as one argument with no shell (`rundll32 url.dll,FileProtocolHandler` on Windows,
  `open`, `xdg-open`).
- `oauth.cancel { id }`.

Nothing here sees a token: the code it relays is useless without the PKCE verifier the
window keeps, and the window checks `state`. Discovery, registration and the token
exchange go through `relay.http`, which keeps `WWW-Authenticate`. Tested with
`node --test test/oauth.test.mjs`.

## MCP servers that are programs

`src/mcp-programs.mjs`: MCP's stdio transport, for servers the user added in Spark's
Connected apps as "A program on this computer" (the window's
`platform/ai/src/mcp/program-transport.ts`, through `features/spark/src/mcp-relay.ts`).
Only with the pairing token; the ready message lists `mcp-programs`.

- `mcp.start { id, command, args?, env?, cwd? }` → `{ id, pid }`: starts the program,
  ending one already under that id. JSON-RPC goes one message per line each way.
- `mcp.send { id, message }`: one message to its input.
- `mcp.stop { id }`: closes its input, as MCP asks, and ends it and everything it
  started (`taskkill /T`, or its process group) 1.5 s later if it has not gone.
- Its messages go to the window that started it as `mcp.message { id, message }`, and
  its end as `mcp.exit { id, code, signal, stderr }` with the last 8 KB it printed
  there — and anything it wrongly printed to its output that was not a message. A
  window that disconnects takes its programs with it; at most 32 run at once.

How it starts: `command` is found the way the system would — on Windows through
PATHEXT in order, so `npx` is `npx.cmd` and never the bare shell script beside it —
on the PATH, then beside the companion's own Node and in per-user tool folders; on
macOS and Linux the login shell's PATH is added first, since an app opened from the
Dock or a menu gets a bare one. A `.cmd`/`.bat` launcher runs through cmd.exe with
every argument quoted and escaped as cross-spawn does (twice for an npm shim);
anything else is started directly. A launcher that is not installed is said so with
where it comes from (Node.js for `npx`, uv for `uvx`, and so on). The environment is
the companion's without `WILLOW_COMPANION_*`, with the user's variables over it; the
folder is `cwd` or the user's home. Tested with `node --test test/mcp-programs.test.mjs`,
which also runs a real `.cmd` launcher with spaces, `&`, `|`, `%` and quotes in its
arguments on Windows.

## The user's screen

`src/screen.mjs`, for a bot the user lets see and use their own computer through its
screen (`features/spark/src/dots/harness/tools/user-screen-tools.ts`), and for Spark
tasks in the desktop app (`features/spark/src/spark-computer-tools.ts`). Only with
the desktop app's pairing token. Each system its own way — `createScreen` picks by
`process.platform`, and the ready message says which (`screen:windows`,
`screen:mac`, `screen:linux` beside `screen`):

| System | Way | Where |
| --- | --- | --- |
| Windows | The one desktop the user sees, shared with them: pictures and real input, an overlay while the bot acts, UI Automation for a window's controls | `src/screen/screen-helper.cs`, `screen-overlay.cs`, `screen-ui.cs` |
| macOS | In the background, app by app: one window's picture (`screencapture -l`), its controls through Accessibility (JXA via `osascript`), raw input posted to that app's process (`CGEventPostToPid`); nothing drawn over the screen | `src/screen/mac.mjs` |
| Linux | A desktop of the bot's own: an Xvfb display from `:90` up (`-nolisten tcp`), apps started on it, xdotool for input, ImageMagick `import` or ffmpeg for pictures; the user's own display never touched, no accessibility reading | `src/screen/linux.mjs` |

Requests (each backend answers those it has): `screen.info`, `screen.capture`,
`screen.act`, `screen.apps` (open windows), `screen.elements` (a window's controls,
numbered under a `snapshot`), `screen.element { snapshot, index, action, value? }`
(`invoke`, `toggle`, `select`, `expand`, `collapse`, `set_value`), `screen.focus`
(a window to the front), `screen.launch { command }` (Linux: an app on the bot's
desktop), and `screen.begin { name, color, grant, session }` / `screen.end` — the
overlay on Windows, the bot's desktop ending with the grant on Linux, nothing on
macOS. A window is named by `pid`, `process`, words in its `title`, or `window` id.
macOS and Linux are tested against stand-ins for their tools
(`node --test test/screen-platforms.test.mjs`); they cannot run on a Windows machine.

### Windows

The work is done by `src/screen/screen-helper.cs` with `screen-overlay.cs` and
`screen-ui.cs`, built together on first use with the C# compiler that ships with
Windows' .NET Framework (`csc.exe`, C# 5; Windows Forms for the overlay, UI
Automation from beside it in `WPF\`) into
`%LOCALAPPDATA%\com.willow.studio\screen\willow-screen-<hash>.exe` — named by its
sources' hash, so a new source builds anew and old builds are removed. Its manifest
(`screen-helper.manifest`) declares it per-monitor DPI aware, so a capture and a click
are in the screen's real pixels however the user scales it (an unaware process sees a
125% screen of 1920×1200 as 1536×960, and clicks a quarter off). It is one process,
JSON lines both ways, started on demand and stopped after ten quiet minutes.

- `screen.info` → `{ monitors: [{ index, primary, left, top, width, height, scale }],
  cursor, foreground: { title, process, willow }, userIdleMs, locked }`. Monitor 1 is
  the main one, the rest left to right.
- `screen.capture { monitor? }` → one monitor as a JPEG (`data`) at its real pixels,
  the pointer drawn in, with its place on the desktop and what is in front; or
  `{ ok: false, refused: 'locked' }`.
- `screen.act { kind, x?, y?, toX?, toY?, button?, clicks?, hold?, text?, key?,
  deltaX?, deltaY?, grant? }` — `click`, `move`, `scroll`, `drag` at desktop positions
  (a monitor's own left and top added), `type` (Unicode, newlines as Enter) and `key`
  (combinations joined by +). Only those fields reach the helper. An action under a
  grant the user stopped from the overlay is refused (`stopped`).
- `screen.apps` → the open windows, front to back (Willow's own left out);
  `screen.elements` → a window's controls through UI Automation — reading needs only
  an unlocked screen; `screen.element` and `screen.focus` act, and hold off like an
  action. Invoking a control is Windows asking the app to do what a click would: no
  mouse moves.

**The overlay** (`screen-overlay.cs`) shows from `screen.begin` until `screen.end`,
the user stopping it, or 40 quiet seconds. It has three parts:
- **A glow around every monitor.** It is drawn once, and its window's opacity
  carries it in, its breath and its going.
- **A pill at the top of the monitor the bot is on.** It is dark glass with a soft
  shadow (a pass-through window of its own under the pill), and the bot's colour
  glows behind its badge. The badge is the bot's initial, ringed by an arc turning
  while it acts and a slow pulse while it only holds the screen. Then "{bot} is
  clicking…", the doing shimmering, and a red-toned Stop with an Esc keycap.
- **The bot's own cursor.** A vector arrow in the bot's colour, it travels to each
  action on springs (an arc for a long hop), stretches along its way, breathes at
  rest, and dips with a ring where it presses. The action waits for it to arrive,
  then checks the user is still away.

It comes and goes in motion (`Animate`):
- **Coming:** the glow blooms in over 0.6 s and then breathes. The pill drops into
  place a beat later and settles, and the cursor grows out of the user's pointer.
- **Going** (0.4 s): the pill lifts away first and the rest sinks out.
- **Called back half way:** a fade rises again from where it had got to.

It is GDI+ in layered windows at real pixels, never activated, kept out of captures
(`WDA_EXCLUDEFROMCAPTURE`; on older Windows it steps aside for a capture), and all
but the pill let clicks through. A click on the pill itself is refused like
Willow's own window. Esc is read with a low-level keyboard hook only while it shows,
and only the user's own key (not one flagged injected) counts; Stop or Esc ends the
grant there and then, and the helper says so on its own line
(`{"event":"stopped","how","grant","session"}`), which the companion broadcasts as
`screen.stopped`. The user's input is never blocked. Since captures leave the overlay
out, its look is checked with `willow-screen-<hash>.exe --render-samples <folder> [name]
[#colour]`, which draws into PNGs and exits without showing anything. It draws:
- the pill at rest, at work and with Stop under the pointer, on a light and a dark
  desktop;
- its coming in and going, a frame at a time;
- the cursor resting, travelling, pressing and ringing;
- a glow.

What it refuses, as `{ ok: false, refused }` rather than an error: a point on any of
Willow's own windows (`willow`: the app's process, by name and by the companion's
parent's id — a bot must never approve its own requests), typing or keys while
Willow is in front (`willow-focus`; Win-key shortcuts and Alt+Tab, which Windows
itself takes, still go), a locked screen or a sign-in or UAC prompt (`locked`: the
lock screen's own window in front, or the input desktop not `Default`), and anything
while the user is using the computer (`user-active`: input after the helper's own
last action, within 1.5 s — read from `GetLastInputInfo`, with no hooks). The last
is waited out once here, so the click with which the user allowed it does not turn
the bot away; then it stands. Tested with a stand-in helper and by building the real
one (`node --test test/screen.test.mjs`); live checks against windows of their own
are in `dots-harness-research/screen-check/`: `check.mjs` clicks and types (and stops
before any input unless its window is in front), `uia-check.mjs` lists a form's
controls and works them through UI Automation alone.

## Bots' own computers

Each bot can have a computer of its own: OpenBot's per-Bot computer
(CopilotKit/openbot `agent-computer/`, there a container) as an account of its
own on one WSL 2 distro the user's bots share, `Willow-Computer`. On only when
the desktop app passes `WILLOW_COMPUTERS_DIR` (its local app data,
`computers/`); otherwise `machine.*` requests fail and the ready message does
not advertise `computers`. Windows only for now.

```
src/computers/
  manager.mjs          The base, the computer, the dots' accounts, start/stop/reset/remove, moving old machines, the relay to pages, idle stop.
  wsl.mjs              wsl.exe with a time limit on every call, UTF-8 output, and only `Willow-…` distros.
  alpine.mjs           Alpine's minimal root filesystem, checked against its published sha256.
  machine/
    provision.sh       Runs once in a throwaway distro to make the base.
    service.mjs        The computer service: one per dot that is using the computer, copied in at every start.
```

**Why one computer.** A machine per bot cost every bot ~1.5 GB of disk and
~1 GB of memory while it worked. Shared, the system is on disk once (each bot
adds its folder, a few MB to start) and program code is in memory once:
measured, the first working bot's screen and browser take ~0.9 GB and each
further one ~0.45 GB, against ~1.05 GB for a machine of its own. Bots that
are not working cost nothing.

**Lifecycle.** The computer needs a base: Alpine's minirootfs is imported as
`Willow-Base-Build`, `provision.sh` installs a desktop (Xvfb, XFCE and its dock
plugin, xdotool, ffmpeg), Chromium, Node, Python and everyday tools, and the
distro is exported as `base/base.tar` (about four minutes; raise
`BASE_VERSION` when provision.sh changes). The computer is imported from that
tar into `computer/` (a tar on purpose: a copy of a just-stopped distro's VHDX
can miss writes WSL has not flushed), and the tar is then deleted — it is only
for making the computer again. Any base will do: the service installs
whatever desktop packages the computer lacks the first time it starts there
(a minute for the whole desktop, seconds for one package; browser and desktop
actions are refused with "try again in a minute" meanwhile) — keep
`DESKTOP_PACKAGES` and `DESKTOP_PROGRAMS` in the service and the list in
provision.sh alike. Setting up a bot's computer adds its account: user
`d<hash of its id>` from uid 61001, home `/home/<user>` (0700), screen
`:<uid − 61000>`, ports 61000 + 100·(uid − 61001) and the 99 after. Starting a
bot pipes the current `service.mjs` in (written aside and moved into place,
since other bots' services may be running) and runs it as one long-lived
`wsl.exe` the companion holds — so the desktop app's job object takes the
computer down with Willow. The first start in a run terminates the distro
(whatever an earlier run left); later ones end only that bot's leftover
processes. The service reads its token, port and account from stdin, binds
127.0.0.1, and Windows reaches it through WSL's localhost forwarding. A bot's
computer turns off after 30 minutes without a call, a watching page or a
person at the wheel; stopping ends that bot's processes, and the distro itself
stops once no bot is using it. Starting, stopping, resetting and adding
accounts take turns (`exclusive`), so one bot's stop never pulls the computer
out from under another's start. Reset wipes the bot's account (folder,
browser, settings, history); remove deletes it. `computers.json` records the
base, the computer and the accounts; if the computer's distro is gone, so are
the accounts. Distro names are global to the PC, so the computer's is
recorded and only that one used: a new computer takes a name no distro has
(`Willow-Computer`, else `Willow-Computer-2`, …), and an unrecorded distro is
never adopted — a test companion's computer and the app's never mix.

**Machines from before.** A bot with a machine of its own from before the
computer was shared (`machines` in `computers.json`) is moved onto it when the
companion starts: its account is made, the old machine's home (files and
browser sign-ins) and step history are piped across as tars, the software it
installed is installed on the computer, and only then is the old distro
unregistered. A failure leaves the old machine as it was, to try again; the
service still accepts the old workspace path, `/home/dot/workspace`.

**Protocol.** `machine.status { dotId? }` (WSL support, the base, the bot's
machine), `machine.create`, `machine.start`, `machine.stop`, `machine.reset`,
`machine.remove`, `machine.call { dotId, method, path, body, timeoutMs, callId }`
(a request to the service; the machine starts first if off; `machine.cancel
{ callId }` aborts it, which stops a running command), `machine.watch { dotId,
on }` (frames to this socket), `machine.installWsl` (Windows' own elevated
`wsl --install --no-distribution`). Events to every session: `machine.state`,
`machine.progress`, `machine.screen`, `machine.control`, `machine.shot`; to
watching sessions only: `machine.frame` (JPEG, base64) and `machine.cursor`.
The service's port and token never leave the manager, and pages cannot reach
its `/events` or `/shutdown`.

**The service** (`machine/service.mjs`) speaks OpenBot's contract over plain
HTTP: `/browser/navigate | read | snapshot | click | type | key | scroll`, step
images (`/shots`), `/files/list | read | write`, `/exec`, the wheel
(`/control`, `/control/request | take | release | cancel | secret`) and a
person's input while they hold it (`/human/mouse | key | text | navigate |
back | forward | reload | secret`), plus `/events` (server-sent events) for the
manager. Chromium is driven over `--remote-debugging-pipe` with no Playwright:
snapshots come from Chrome's accessibility tree, refs are DOM nodes held by the
service and retired on navigation, and actions are real input events. The
control state machine is OpenBot's: while a request waits or a person holds
the wheel the bot's actions and commands are refused, a waiting request lapses
after 10 minutes, and handing back requires a fresh look — a snapshot or a
screenshot — before the bot changes anything.

**The desktop** goes beyond OpenBot, whose computer has no screen. The service
brings up Xvfb (the bot's display, 1280×1024 — Spark's remote screen), D-Bus
and an XFCE session as the bot's user when something first needs them, not at
start: the browser, a screenshot or a desktop action, a watcher, or a program
that connects to the display. Until then the service listens on the display's
socket itself (`screenDoor`: 0600, the bot's, like Xvfb's), and a program that
connects there starts the screen and is piped through to Xvfb once it is up;
the screen's key is one for the service's life, so a client that read it first
still gets in. Commands get `DISPLAY` while the screen or that socket is
there, so a program with a window opens on the desktop, starting it if
needed. Once on, the screen stays on until the computer turns off. Chromium
runs headed in a window there (still on the DevTools pipe). It looks like OpenAI's bot's computer as Codex shows it
(`computer-preview-64538a5b8034.png`): no desktop icons and no top panel, a
frosted dock floating at the bottom (`xfce4-docklike-plugin` on one panel,
styled in `gtk.css` with Codex's 10px corners, which its buttons' highlight
shares as they fill its height) with the browser, a terminal and files, the
browser in a window clear of it, and every other window opening centred
(xfwm4's `placement_ratio` 100). The screen is drawn by picom, not xfwm4's
own compositor (off), because xfwm4 cannot round a window: an app's window
has Windows 11's 8px corners — square again maximised or full screen — and
the faint shadow xfwm4 drew; the dock, the desktop, menus and tooltips draw
their own. picom is started before the session, and the screen works without
it, square. The dock plugin runs in the panel's wrapper process, so CSS for
its buttons goes through `.xfce4-panel button`. The layout is versioned
(`DESKTOP_LAYOUT`): a machine laid out by an older service gets the new one
once, and keeps changes made on it after.

**The bot's colour.** The wallpaper is Codex's "Blue Hour", the picture the
bot's profile shows in place of its computer, and the browser wears Codex's
browser colours (frame `#a2b6ce`, toolbar `#d7e0e9`); both are turned to the
bot's colour by the page (`features/spark/src/dots/computer/dot-wallpaper.ts`)
and sent as the machine's look with every start and call (`settings.wallpaper`,
`settings.browser`), and through `machine.look` when the bot's colour changes.
The manager keeps the last look, starts the service with it, and pushes a
change to a running machine (`POST /look`), which swaps the wallpaper through
xfconf and the browser's theme at once. The theme is an unpacked theme
extension in the bot's home, loaded over the DevTools pipe
(`Extensions.loadUnpacked`, which needs `--enable-unsafe-extension-debugging`);
loading it again repaints the open window. A theme colour set by policy would
be every bot's at once and makes Chromium refuse theme extensions, so the
service removes the policy file an earlier one wrote. The browser on the
screen is always the service's, so it always wears the theme and takes a
change: `chromium` on the PATH is a wrapper, and what the dock, the menu, a
command or a program opening a link starts through it becomes a request in the
bot's folder (`browser-requests`), which the service takes (as the bot, web and
file addresses only) and opens in its own browser, starting it — and the
screen — if needed. Asked for another profile or for no window, or with no
one taking the request in 5 s, the wrapper starts Chromium itself, still with
the bot's profile, theme and window where it can; the profile is told to use
Chromium's own theme when the screen starts, since a browser that starts
without the theme falls back to GTK's white. The screen streams to watchers as JPEG frames
from ffmpeg's `x11grab` (8 a second; a frame like the last is not sent again
for 5 s), a person's mouse and keyboard reach it through `xdotool` (characters
typed as themselves, other keys down and up by name, held keys let go when the
wheel changes hands), and the bot sees and uses it by pixel:
`/desktop/screenshot` and `/desktop/click | move | type | key | scroll | drag`, each
action answering with the screen it left (`click` takes `hold`, modifier keys kept
down through it; `move` leaves the pointer where hovering shows something). Those
are the screen's own pixels: the window scales the picture to what the bot's model
takes and turns its positions back (`runtime/screen-view.ts`). `/files/read` and
`/files/write` also move bytes as base64 (`encoding`, 3 MB a piece), for copies to
and from the user's computer. The bot's browser actions bring the
browser's window to the front while the bot holds the wheel. If the desktop
cannot start, the machine falls back to a headless browser and the pane shows
the page in Spark's Chrome frame (`display: 'browser'` in `/state`).

**Keeping each bot to itself** — do not weaken these without saying so:

1. **No way to Windows.** `/etc/wsl.conf` turns off drive automounting and
   Windows interop; the service unmounts the shared `/mnt/wsl`, WSLg's sockets
   and the host GPU driver store at start (copying the resolver first, which
   WSL links into `/mnt/wsl`).
2. **An unprivileged user per bot.** A bot's browser, commands and file
   operations run as its own user, whose home is 0700. File operations switch
   to that user and resolve links inside the workspace, because the root
   service could otherwise follow a link to another bot's folder or another
   distro's disk. Commands run with `umask 077`, so what they leave in shared
   places is theirs alone, and `/proc` is remounted `hidepid`, so a bot sees
   its own processes and not the others' (or their command lines).
3. **Software is shared, and only added.** The one root action is `apk add`,
   through `/usr/local/sbin/willow-apk` (package names and a few harmless
   flags, from Alpine's signed repositories; installs take turns), granted to
   each bot's user by a sudoers file of its own. `apk del` is refused: another
   bot may be using what it would remove.
4. **No local network, and no one else's servers.** Every WSL 2 distro shares
   one network namespace, so loopback here is the user's other distros, every
   bot's service and the servers the other bots run. Each bot's nftables table
   (`willow_dot_<uid>`, matching that uid alone) lets its connections reach
   the internet, DNS and its own hundred ports on loopback — `$WILLOW_PORTS`
   in its environment — and rejects loopback, private, link-local and
   multicast addresses otherwise. Tables are per bot so that each service
   changes only its own.
5. **Token and loopback.** Every request but `/health` carries the token; the
   service binds 127.0.0.1 only, on a port outside the bots' ranges.
6. **A screen nobody else can reach.** X and D-Bus listen on abstract sockets
   by default, which live in the shared network namespace: another distro
   could read or drive a screen. Xvfb runs with `-nolisten local` and the
   session bus on a path, so both are files inside the computer — and the
   other bots are users of the same files, so the bus lives in the bot's own
   0700 runtime folder, and Xvfb takes only clients holding the screen's
   MIT-MAGIC-COOKIE (`-auth`, a file only the bot's user can read; its socket
   is also 0600). The session's keyring, thumbnailer and power manager are
   kept from starting (one prompts for a password nobody is there to type),
   and sessions are not saved, so nothing comes back on its own.

Known limits: the separation between bots rests on their users — a bot that
somehow became root could reach the others' accounts (bots have no root but
`apk add`). Chromium runs with `--no-sandbox` (its own sandbox does not start
under WSL's kernel here; the account is the boundary), the kernel is shared
with the user's distros (a root escape inside the computer would reach the WSL
VM), and the namespace is shared (the egress tables are what separate them).

`npm run companion:computers` (from the repo root) is a real smoke test, in a
folder of its own: two bots' accounts on the computer used at once — desktop,
browser, shell, files, the wheel and frames — each closed to the other (files,
screen, processes, servers), `apk del` refused, and one turned off while the
other works on.

## Spark's native runtime

In the desktop app Spark works on the user's computer the way Codex does, and
this is the half that runs things: `src/spark-runtime.mjs`, a port of Codex's
unified exec (`codex-rs/core/src/unified_exec/`) plus plain file access. The
harness half is `features/spark/src/harness/native/` (its AGENTS.md says what
the model sees).

**On only behind a pairing token.** `spark.*` requests exist only when
`WILLOW_COMPANION_TOKEN` is set, which the desktop app always does; a dev-mode
companion refuses them and does not advertise `spark-native`. This matters
because **the fourth control above does not apply to them**: like Codex with
`danger-full-access`, they are not confined to an authorised folder. What holds
them instead is loopback, the origin allowlist, the token, and the app's own
approvals, which by default ask before every command (Codex's `unless-trusted`).

- `spark.env` → platform, home, temp, user, host, and the shell commands run in
  (PowerShell 7 if installed, else Windows PowerShell; `$SHELL` elsewhere).
- `spark.exec.start { cmd, workdir, shell?, login?, yieldTimeMs?, maxOutputTokens?, owner? }`
  and `spark.exec.write { sessionId, chars, yieldTimeMs?, maxOutputTokens? }` are
  `exec_command` and `write_stdin`: Codex's yields (250 ms floor, 10 s on Windows
  for a first exec, 30 s cap; empty polls 5–300 s), 1 MiB head-and-tail buffers,
  64 sessions, its environment (`NO_COLOR`, `TERM=dumb`, UTF-8, pagers off) and
  its response text, which the harness hands the model unchanged. A command is
  finished when its output closes, or 100 ms after its process exits (Codex's
  `TRAILING_OUTPUT_GRACE`): not waiting for the pipes matters, because anything
  it left running in the background (an installer opening the app it installed,
  a server) holds them open. `\u0003`
  stops a session's whole process tree. `spark.exec.kill { owner | sessionId }`
  stops a task's processes; `spark.exec.list` lists them.
- `spark.fs.stat | read | write | delete | list | search | image`, by absolute
  path. Reads report binary and over-8 MB files rather than returning them;
  writes create parent folders; delete removes files only; list and search skip
  dependency, build and version-control folders.

PowerShell gets `-NoLogo -NoProfile -Command` with UTF-8 output and progress
off, because `-EncodedCommand` writes CLIXML to stderr. `npm run spark --prefix
services/local-companion` tests it all against real processes.

## Notes

- The Chromium it launches is a **separate headless profile**, not the user's open
  Chrome. Taking over real tabs is the browser-extension bridge's job, not this.
- On Windows it probes the three usual Chrome install paths, then falls back to
  Playwright's `channel: 'chrome'`. `WILLOW_CHROME_PATH` overrides.
- No planner, no retries, no PTY multiplexing. Permission is the caller's job:
  bots ask the user to approve every command and job in the conversation.
- `npm run companion:test` (from the repo root) is a real smoke test: shell,
  quoting, jobs, file reads, confinement and the browser.
