# Agents in Willow — T3 Code parity checklist

Willow's desktop app runs coding-agent harnesses (Claude Code, Codex, Cursor, Grok Build,
OpenCode, Antigravity, Pi, ACP agents) the way [T3 Code](https://github.com/pingdotgg/t3code)
does, with every T3 Code feature, in Willow's design. This file is the acceptance list: an item
is checked only when it works in a desktop build, not when code for it exists.

Source of truth: `pingdotgg/t3code` at `9bd1d8009a6b7c50f9dd9458e2bf27d481ff3b43`
(2026-10-06), MIT, © T3 Tools Inc. Inventory taken from its `docs/user/*`, `apps/web/src`,
`apps/server/src`, `packages/*`, `apps/desktop/src` and `apps/mobile/src`.

Legend: `[ ]` to do · `[~]` partly · `[x]` done and verified in a desktop build ·
`[H]` needs T3's hosted cloud — the line says what Willow does instead.

Most of T3's features come over whole: Willow runs T3's own server and web client (forked,
restyled), so a feature T3's server and client implement works in Willow unchanged. Lines
marked `[~]` below are present that way but were not exercised end to end here (they need a
real agent run, a signed-in account, a remote machine or a second device).

---

## 0. Willow requirements (from the brief)

- [x] Desktop app only: nothing of this appears on the web version (rail entries and the agents' frame render only when `isDesktop`; checked on the web build: no agent tabs, no frame), and the server only ships in the desktop payload
- [x] Every harness is its own tab on Willow's rail after the dots button (Claude Code, Codex, Cursor pinned; Grok Build, OpenCode, Antigravity, Pi in Explore)
- [x] Any extra tab the feature needs sits outside the harness tabs — none was needed: Connections / remote control live in each tab's settings
- [x] Nothing else in Willow changes beyond those tabs and the plumbing they need (rail entries, `features/harness`, `harness.rs`, its commands and capability entries, desktop-bridge helpers, the build/stage/pack hooks)
- [x] Each harness tab looks the same: harness logo + name at the top left of its sidebar, **Add project** like Spark's (system folder picker), each project a sidebar category with its threads; threads and new threads scoped to the tab's agent
- [~] Sign in with the official account (Anthropic, ChatGPT/OpenAI, Cursor, xAI, Google, OpenCode) on the user's own plan — T3's provider auth flows (server-side `provider.auth.*`, auth terminal, browser sign-in through Willow's external-link handler) are in place; not exercised with a real account here
- [~] API key + base URL access wherever T3 Code supports it — the per-instance environment variables, binary path and config-dir fields render in Willow's design; not exercised with a real key here
- [~] Willow's design system throughout: fonts (Willow's chat type: 17px/24px Google Sans Flex for messages and the prompt, 13px/17px rows), Material Symbols (Willow's 36px header buttons with 24px glyphs at the top right, the side panel's tools at 32px with 20px glyphs, T3's morphing icons as Willow's glyphs), colours (dark + light, each tab in its agent's colour from its mark through Willow's workspace-colour engine: Claude orange, Codex and Antigravity blue, neutral for the monochrome marks), sidebar rows, Willow's menus (menu card, submenus, three-dot triggers), dialogs, toasts, fields, switches, **Willow's prompt box** (plus + plus menu, chips, model pill + model menu with each trait's values, send/stop), **Willow's chat bubble** for sent messages, markdown, Willow's home glow behind a new chat's box (its masked glow and bloom), settings rows, attachments as Willow's 112px square tiles (in the prompt box and above a sent message), the prompt box's `@` and `/` menus as Willow's (its mention card and slash menu over the box). Things move as **Willow's** do: menus, right-click menus, pickers and popovers as its menu pane (the plus and model menus as their own), selects as its settings dropdowns, tooltips at once, dialogs, drawers, the snackbar at the bottom left (which also confirms a copied message), panels sliding for 300ms on its curve, work entries opening and closing as its code panel, a streaming reply's words fading in as its replies' do (checked in the design rig by the computed animations: menus, plus and model menus, selects, right-click menu, tooltips, dialog, toasts, sheet, panels, a work entry opening and closing; in a desktop build: the plus and model menus, the `@` menu, the copy snackbar, the sidebar sliding shut, the square tiles; the word fade by unit tests, no reply streamed here). The agent's work reads as **the Codex app's** (activity rows and groups, shell card, diff, plan, approval, error and end-of-turn cards, "Worked for"), and the side panel takes **the Codex app's** tab strip, bars, new-tab launcher and review (each file a 36px row — chevron, document, name then folder, its counts, File actions — the whole changed row in Codex's git colours, an opened file in a hairline card, the file list with its filter beside them), while the usage page takes **Willow's own usage view** (sections on cards, limit windows stacked, Willow's type scale) (checked in a desktop build: prompt box, model menu, bubble, launcher, review; the work states in the design rig against the same code). The rest of the chrome followed: dialogs with Gemini's outlined fields, selects and pickers, its text pill and Willow's 40px close; the command palette as Willow's search dialog; toasts and the banners over the timeline as the snackbar; the thread details card and T3's glass surfaces as the menu card; Pull requests as Spark's All tasks; the terminal drawer as Codex's bottom panel (a tab per terminal); file trees, the Files filter and the browser's start page as Codex's; a running plan as Codex's "Step N / M" pill (checked in the design rig in dark and light; the palette, a dialog, the terminal drawer, the Files panel and a right-click menu in a desktop build; the plan pill rendered from its component with sample steps, since no plan streamed here). Still T3-shaped: the device panel's stream controls, which need a running simulator or emulator
- [x] The remote-control client (phone) in Willow's design: checked at phone size against the built server — pairing page, the paired client (hero, composer, header) and Willow's sidebar (logo, New thread / Search / Pull requests / Usage / Add project, projects with their threads)

## 1. Hosting (architecture)

- [x] T3's server forked into `vendor/t3code` (MIT notice kept), building `t3`'s `dist/bin.mjs` with its own toolchain (pnpm 11, Vite+, TypeScript 7) — `apps/desktop/scripts/agents.mjs`
- [x] Native modules shipped for the bundled Node: `node-pty`, `@napi-rs/keyring`, `@ff-labs/fff-node`, `@cursor/sdk`
- [x] The desktop app starts and supervises the server like T3's Electron shell does: desktop bootstrap on stdin, loopback host, the user's home as its working directory (which bounds the folders its diffs may read; it was Willow's own folder, so reviews of projects elsewhere showed nothing or another repository), a port kept across launches (waits for it after a restart), app data dir, bootstrap token, readiness on `/.well-known/t3/environment`, restart on settings changes, children in a kill-on-close job, and a crashed server started again with backoff (killed in a desktop build: answering again after 4 s); a tab whose page loaded during a restart loads it again
- [x] Renderer auth: bootstrap credential exchanged for a bearer session (`deviceType: desktop`), stable across server restarts, WebSocket ticket, orchestration protocol 2
- [x] Willow's restyled T3 web client served by that server and shown inside the harness tabs
- [~] A `desktopBridge` for the web client on Willow's desktop app — done: folder picker, project icon picker, open external, badge (taskbar overlay), local-environment bootstraps and on/off, exposure, Tailscale status, SSH environments, notifications, context menus, updates seam, SnapShot, the preview browser's webviews (Windows). Missing: WSL backends, browser cookie import, app activation (`t3 app`)
- [x] Telemetry off by default (`T3CODE_TELEMETRY_ENABLED=false`), no Clerk/relay config
- [~] Model manifest: bundled copy, network refresh as T3 does (T3's server code, unchanged; not separately checked)
- [x] Data in Willow's app data dir (`agents/` under the app's local data: database, settings, keybindings, attachments, logs, secrets, worktrees)

## 2. Providers (drivers, sign-in, models)

Shared
- [x] Settings → Providers per environment: enable/disable, status, version warnings, **Update all**, checked-at, health-check interval (seen in a desktop build)
- [~] Multiple instances per driver: display name, accent colour, binary path, home/config dir, launch args, environment variables (fields render; adding instances not exercised)
- [~] Custom models (name + options), favourites, hide, reorder; remembered provider/model/options for new threads; project model overrides
- [~] Provider auth state machine UI: `provider.auth.start/respond/complete/cancel/logout/subscribe`, in-app auth terminal for CLI logins, browser sign-in with copy/open URL, paste-back callback URL for remote environments
- [~] Provider install / remove for managed runtimes with progress (`provider.install.*`)

Codex
- [~] Connect with ChatGPT (managed sign-in, Codex install handled), Manage usage, Disconnect, reconnect same account
- [~] Existing `codex login`; multiple ChatGPT accounts; shadow `CODEX_HOME`; separate homes
- [~] Async questions panel, app-access approvals (once / session / permanent), usage-limit messages, `/feedback`
- [~] Goals (`/goal`, pause/resume/clear), rollback, fork (incl. from turn/subagent), steer, plan, images/files, MCP, subagents

Claude Code
- [~] `claude auth login` (subscription) and API keys / endpoints through instance environment variables (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`) — OpenRouter and local routers (the desktop build shows Claude authenticated with an API key)
- [~] Multiple accounts through `CLAUDE_CONFIG_DIR`; switch only within one config dir
- [~] Auto-compact window (100,000–1,000,000), `/compact` + context meter, usage-limit hold, skills, goals

Cursor
- [~] Browser sign-in (works remotely), change account / sign out — not exercised with a real account here
- [x] Cursor API keys (`crsr_…`, user or service account): paste one in the Cursor tab's settings (the footer's "Set up Cursor", or the composer's) and Cursor turns on with it; a key without `crsr_` saves with a warning; a key Cursor rejects reads "Cursor rejected the API key"; a `CURSOR_API_KEY` in the computer's environment is named as the one in use (desktop build, with a placeholder key)
- [x] The Cursor tab stays on Cursor: until it is set up, its composer says "Set up Cursor" instead of borrowing another agent's model
- [~] V2 SDK runtime: create/resume, model between turns, reasoning/tools/plans/todos, thread-scoped MCP, images, interrupt/queue/restart-steer, read-only `task` subagent threads; forks through portable handoff

Grok Build
- [~] `grok login` (+ `--device-auth`), ACP runtime, permission mapping (no Auto-accept edits), usage limits after login

OpenCode
- [~] 1.x and 2.x (version probe, "Limited support"), local server or external **Server URL** + password, reconnect, plan agent, approvals, refresh caching

Antigravity
- [~] Enable → Install → Sign in with Google; Gemini Enterprise; Gemini API key; Agent Platform / Vertex
- [~] Remote Google callback paste, managed install with leases, binary path, models from catalog, native `/plan`, skills dirs, attachments as paths, subagents, disable / sign out / remove runtime

Pi
- [~] Setup (≥0.80.5), launch args rules, native sessions (resume/rollback/forks), skills, extension dialogs, context meter, permission mapping, `delegate_task` child threads

ACP
- [~] ACP Registry search → add → instance → sign-in; local ACP command; managed install under T3 home
- [~] Sign-in methods (URL / terminal / API keys), models + custom, Plan/Build, `/` and `$` menus, list/import sessions, permissions by thread mode, checkpoints (files only), advanced overrides

## 3. Welcome wizard

- [x] Steps Connect → Agents → Projects in Willow's dialog, headed by the tab's agent (its mark and name)
- [x] Connect: computers list (local preselected), add a computer by pairing link — `[H]` T3 Connect discovery → Willow: pairing + SSH + Tailscale only
- [x] Agents: lists the tab's agent with its readiness (Claude Code: Ready)
- [x] Projects: scanned Claude's directories, listed `sample-project`, imported it with its conversation
- [~] Import limits (30 days, 200-message budget, file limits) — T3's server, unchanged

## 4. Threads and sidebar

- [x] Willow's own sidebar (apps/studio `Sidebar.tsx`, Spark's rows): the mark and name with the collapse button, then tabs for New thread (its shortcut on hover), Add project under it as Spark's Add folder sits, Search threads (a page like Willow's Search chats: the 64px pill, "Recent", title and day, narrowed by title and by T3's message search), Pull requests and Usage, then each project a folder row ("1 active" while a thread works) with its threads indented under it
- [x] Collapses to Willow's 52px rail instead of off the screen: the mark (the expand glyph under the pointer), each tab's glyph with its name in a tooltip to the right, the gear over the account; width and surface 300ms on Willow's curve, the name fading in 100ms behind it and the collapse button landing at 250ms; T3's own floating sidebar button is gone (its shortcut stays) (checked in the design rig). Like Willow's, it cannot be resized: 288px, its collapse button the only control, and collapsed it is the page's own colour (T3's grain is off; checked in the design rig and the desktop test copy)
- [x] Settings from Willow's settings pane: the gear opens it (300px of 36px rows over the gear, 120ms in from its corner, 100ms out) with each of T3's settings pages, and a page opens beside the threads instead of T3's settings panel taking the sidebar (checked in the design rig)
- [~] New thread defaults (verified: new threads land on the tab's agent); New thread in this worktree; project switch picks an environment that has the project
- [~] Threads without a project (`mod+alt+n`, scratch folder naming, no git controls)
- [~] Start in background (`mod+enter` on drafts), multi-model fan-out
- [~] Sections, pins, drag reorder, undo toast (T3's sidebar features under Willow's per-project tree; the newer sections sidebar stays available in settings)
- [~] Settle / un-settle, auto-settle, per-thread auto-settle
- [~] Snooze presets + custom, wake now, limited-thread resume
- [~] Rename, regenerate title, mark unread, archive, delete, copy path / branch / thread ID / reference (Willow's context menu), project settings
- [~] Thread search with excerpts, multi-select, drag files onto a row to attach
- [~] Project grouping, order, project icons (image icons through Willow's file picker)
- [~] Agents panel: subagents read-only, stop delegated work
- [x] Archived threads page (Settings → Archive renders)

## 5. Conversation

- [x] Timeline rows checked with every row kind T3 renders for a turn: Willow's chat bubble for the user, Willow's markdown for replies; the work as the Codex app draws it — 14px rows with a 16px icon at 60% (38% in an opened group), "Thought" for reasoning, "Read index.ts" / "Searched for …" / "Edited README.md +x -y" / "Ran npm test" with the chevron after the summary, commands opening to Codex's shell card (Success / exit code), edits to a unified diff, web searches, Codex's error card, plan card and end-of-turn changed-files card, work folded under "Worked for …" over a rule
- [~] Remaining items as T3 renders them (citations, todo list, approval/user-input/secret requests, checkpoints, compaction, handoff, fork, subagent groups, HTML render, Mermaid, media, worktree setup card, goal banner, queued runs)
- [x] Markdown in Willow's type and spacing (headings, lists, code blocks, inline code, quotes, links)
- [x] Activity-log summaries for consecutive tools, in Codex's words ("Edited a file, read files, ran a command"); T3's own tools keep T3's labels
- [x] The rest of Codex's timeline rules (the clone's `lib/timeline.ts`, `TurnView`, `WorkedFor`, items): thinking and image views on lines of their own ("Thought for 4s"), only tools gathered into a group, reads / searches / listings that do not open, a web search opening to its sources, commands timed "in 6s" / "for 4s", durations as "2m 14s", only "Thinking" from the moment a message is sent until its work has started on the server, then the working divider as the Codex app's own (its `localConversation.working` / `workingFor`: "Working" through the first second, "Working for 12s" from then, timed from the server's start), "Thinking" only while nothing on screen is moving (not under a reply already streaming), a stopped turn folded behind "You stopped after 13s" (checked with a real Claude Code turn that was steered and stopped), compaction as Codex's divider
- [~] Copy, Fork from response, Edit from here, Cite selection into composer
- [~] Timeline minimap, provider status / usage-limit / auto-balance banners, open-in-editor picker
- [~] HTML visual replies
- [~] File viewer

## 6. Composer

- [~] Limits, attachments, paste-as-attachment (T3's composer as Willow's prompt box: Willow's 660px surface and 17px type, Upload files in Willow's plus menu, send in the agent's colour, hidden while the box is empty; pictures, videos and captures as Willow's 112px square tiles, cover-cropped whatever their shape, with its remove button on hover and the placeholder kept under them — checked in the design rig, dark and light)
- [x] Model choice as Willow's model pill and model menu (models with a check, each trait — reasoning, context window, speed — a row opening its values), permission mode as Willow's chip (the workspace and branch moved to the row over the box), Plan as a plus-menu tool with its chip (seen in the desktop build)
- [~] Triggers: `@`, `#`, `/`, `$`
- [x] Where the chat runs, chosen under a new chat's box ("Work locally" with its laptop and the branch as Willow's 36px chips, centred, its media gallery's #1e1f20 / #f0f4f9 pills) and gone once the first message settles them, the context ring then in the box's footer; the access control beside the plus as plain text in the model name's size and ink, its chevron on the model pill's line, with Material glyphs ("Ask for approval" with its hand) and Willow's Luminous lock for "Full access", as Spark's menu draws it — checked in the design rig, dark and light
- [x] Queue vs steer as Codex's: Enter queues while a turn runs (the button's tooltip "Queue ⏎"), Stop's tooltip "Stop"; queueing and steering checked with a real Claude Code turn
- [x] Codex's composer rail (its `composer-rail` module and `queued-message-list`, from the Codex app's own bundle): what is attached above the box is one panel 13px in from its sides, 16px corners at the top, a 1px rule round it and between its rows, tucked under the box — the notices (each listed, none stacked behind another), running background work with Stop, the goal, approvals and questions, and the queued follow-ups as Codex's rows (its queue glyph with the grip on hover for drag reorder, the words, ↳ Steer — "Submit without interrupting the model" — a bin, and a menu with Edit message and Turn off / on queueing); a running plan's "Step N / M" centred over it as Codex's in-progress strip, its steps in a card on hover (checked in the design rig with staged rows, dark and light)
- [~] Send / Resume / Stop / Refine / Implement; send in background; Enter-vs-mod+Enter setting ("Ask for follow-up changes" once a thread has started)
- [~] Stash, prompt recall, rich text, collapse on scroll, tasks badge (as Codex's "Step N / M" pill over the box, its steps in a menu card on hover or focus), context meter
- [~] Pending approval and question panels above the composer

## 7. Permission modes

- [~] Supervised / Auto-accept edits / Auto / Full access in the composer (picker seen); default in Settings → General → New threads → Permissions (seen); project override; per-provider mappings

## 8. Portable handoffs and migration

- [~] Handoff on provider switch / portable restart / non-native fork
- [~] V1 → V2 database migration (as the server does)

## 9. Projects, settings scope and storage

- [x] "Applying settings for …" scope (seen on General and Providers)
- [~] Project overview, project actions/scripts (`t3.json`)
- [~] Worktree branch naming, submodules policy (seen), start from origin, add-project base directory
- [~] Storage settings page (renders)
- [~] Scheduled tasks — `[H]` webhook public URL and offline hold need T3 Connect → Willow: webhooks reachable through Tailscale/LAN URL, no hold
- [~] Automatically pull, default merge method, remove agent credits on merge

## 10. Source control and pull requests

- [~] Hosts: GitHub, GitLab, Forgejo/Gitea, Bitbucket, Azure DevOps (T3's server; needs each host's CLI)
- [~] New project, clone, publish repository (Publish repository shows in thread details)
- [~] Commit / push / create PR with generated messages
- [~] Pull requests page (Willow sidebar row opens it)
- [~] Linked PRs, watch PR, GitHub sharing
- [~] VCS: pull, refresh status, refs, worktrees, branches, init, stacked actions, review diff preview

## 11. Panels

- [x] Right panel: surface picker (Browser / Terminal / Files / Diff / Pull request / Linked PRs / Device), tabs, maximise
- [x] Diff panel: scope picker (Changes / Uncommitted / Latest turn / Turn), unified/split, wrap, refresh; a project's uncommitted changes listed and opened in a desktop build (`sample-project`: README.md +8, index.ts −1 +3) as Codex's review draws them; a file's name opens it in the editor, its row folds it, File actions offers Open / Reveal in File Explorer / Open with / Copy path on Willow's menu
- [~] Files panel (Codex's FilesPanel: the 28px soft filter, 28px tree rows at 13px on 6px corners, Codex's git colours; the tree and its right-click menu seen in a desktop build)
- [x] Terminal drawer: opens a shell in the project (PowerShell), Willow's terminal colours; Codex's bottom-panel header (a 32px tab per terminal with its close on the chosen tab or under the pointer, split groups marked by their icon) over TerminalView's 16/8/12px inset, its tabs as Willow's (12px corners, no edge, its chips' fill when chosen) and its actions as Willow's round header buttons in white with its glyphs (rounded split screens, Luminous add and delete) (desktop build; a second terminal and its close confirmation in the design rig)
- [x] The side panel's tabs as Willow's (12px corners, no edge, its chips' fill when chosen); in the desktop app they sit in the strip across the window, over the panel up to the window buttons, scrolling sideways with fades when there are many, the + and a tab's menu opening under the strip, and the surface's own bar (the browser's address bar, a review's tools) moved up into the panel's row beside its controls; full screen and back as Willow canvas's Fullscreen and Collapse glyphs (design rig for the agents' side; the strip in a test build)
- [x] Thread rows' fill ends where their project's does; the `/` menu never runs past its card (its list scrolls within it, first and last rows whole)
- [x] Responsive as Willow is, at its breakpoints on its window's width: at 960px and below the sidebar is Willow's drawer (min(320px, 85vw), #1c1c1c, 44px rows of 17px, a 45% scrim, closing as a thread or page is picked) behind its 48px menu button, the header's controls sit in a 64px band with the model picker beside the button in place of the title, the side panel covers the page, the dark page goes black, sent messages keep 52px clear on #141414, the prompt box takes its touch sizes (40px plus and send with 28px glyphs, a 20px/375 placeholder on a new thread) and a new thread's box docks at the bottom under the centred greeting over Willow's rising glow, the plus menu is its touch card, confirmations stay centred at 332px with 48px pills, and search sits under the band; the box's 36px corners and 68px bar at 769–960px, 40px and 72px with the full width below 768px; search's narrow column at 720px (design rig at 1280, 900 and 700 in dark and light)
- [x] Thread header as Codex's (`shell/ThreadHeader.tsx`): the title first, the project after it in the tertiary ink; the project still starts a thread there and the title still opens the thread's menu
- [x] The browser's bar as Codex's (`panels/BrowserPanel.tsx`): 28px buttons (30% with nowhere to go), the address as plain centred text that takes a soft fill under the pointer and the field's ring only while edited
- [~] Browser preview: the Browser surface (URL bar, discovered local servers and recent pages as Codex's launcher rows, tabs). On Windows each tab is a webview of its own laid over the agents' page (`apps/desktop/src-tauri/src/harness_preview.rs`, placed by `features/harness/src/harness-preview.ts` from `apps/web/src/willow/preview.ts`), so sites that refuse to be framed show too: open, back / forward through its real history, refresh, zoom, its address and title, a page that cannot be reached on T3's own unreachable page, hidden behind another tab, panel or Willow destination, and cut away under the agents' page's and Willow's menus, tooltips and dialogs; it gets none of the app's commands (`capabilities/willow.json` is Willow's page's alone) — checked in the desktop test copy with google.com, example.com and a refused port. Elsewhere tabs are iframes Willow drives, where pages that forbid framing stay blank. Not available without Electron's `<webview>`: developer tools, screenshots, recording, the element picker, agent automation (refused with the reason), cookie import
- [~] Device panel (setup wizard in Willow's dialog; streams need simulators/emulators)
- [x] Thread details panel (workspace, open in editor, project script, branch, publish, changes)
- [~] Command palette (its shortcut; threads have the sidebar's Search threads page; drawn as Willow's search dialog with its 64px search bar and 44px rows, seen in a desktop build), file picker, project content search

## 12. Settings pages

- [x] Every settings page drawn as Willow's full-page settings (its Labs and Models & API pages): one 800px column, the page's name as a 32px headline with its actions beside it (General's "Restore device defaults", Keybindings' search and add, Scheduled tasks' "New task", Providers' refresh and add), the scope sentence ("Applying settings for …", its pickers in the workspace colour) or "Saved on this device." as its description, #1e1f20 / #f0f4f9 section cards with 20px headings, 16px/15px rows split by hairlines, 44px fields and 260px dropdowns, tonal and filled 40px pills, 36px icon buttons, Willow's switch with its check, #1b1b1b child rows, pill badges, dashed empty states, and the "Legacy features" fold as its expander (checked in the design rig on every page in dark, and on General, Appearance and Providers in light; General, Providers, Keybindings and Storage in a desktop build)
- [x] Providers as Willow's Models & API: the providers are a list of rows (round mark, status, switch, chevron) and a provider opens as its own page, its name and a back arrow in the headline, its settings as cards (checked in a desktop build: Codex opened and back)
- [x] Searching settings: T3's settings panel and its search field give way to Willow's settings pane, and the command palette still finds every setting and opens its page at the row (desktop build: "worktree location" → Storage)
- [~] General (seen, Willow rows and switches)
- [~] Appearance (T3's themes stay selectable, the color scheme and the themes as two cards; Willow's tokens override T3's palette in the agent tabs, and light/dark follows Willow)
- [x] Projects, Keybindings, SnapShots, Providers, Integrations, Scheduled tasks, Source control, Storage, Connections, Archive all reachable from Willow's settings rows (Project listed first while one project is the scope, as in T3's nav); Open-source licences keeps T3's notice

## 13. Keybindings (defaults from `packages/shared/src/keybindings.ts`)

- [~] Every default binding and command id (T3's client, unchanged)
- [~] They live inside the agents' frame, so they act only while it has focus and never reach Willow's own shortcuts outside the tabs

## 14. Usage and limits

- [~] Usage page (`mod+u`; Willow sidebar row opens it) in Willow's usage design: cost and tokens with the daily chart, totals, cost by type and the breakdown, each on a card (seen in the design rig); limit windows stacked as Willow stacks its usage windows (no provider here reports subscription limits)

## 15. Remote control

- [~] Network access toggle (Willow binds the server to every interface and restarts it; LAN address and endpoints advertised) — implemented; not switched on here because Windows Firewall would prompt on this PC. Pairing links + **QR codes**, one-time links, revoke, authorised clients come with it (T3's client)
- [~] Routes per machine (LAN, Tailscale IP, Tailscale HTTPS, SSH)
- [~] Tailscale HTTPS toggle (status read from `tailscale status --json`; the row shows "Start Tailscale…" when it is not running)
- [~] Desktop-managed SSH environments: kept by the agents' server for Willow's page only (`apps/server/src/willow/ssh.ts`, gated by the desktop bootstrap token — checked: other callers get 404), host discovery and alias resolution checked; password prompts relayed to T3's dialog; the tunnel and remote runtime download are T3's `@t3tools/ssh`, not exercised without a remote host
- [~] Add remote environments to this app (Connections → Add environment); load balancing
- [x] Local environment on/off (remote-only): switched off and on again in a desktop build — off, the tabs reload with remote environments only and the server closes to the network
- [x] Phone client in Willow's design: pairing (paste link / token), the paired client and Willow's per-project sidebar checked at phone size against the built server; the rest of the phone client is T3's web client, restyled ([~] lines elsewhere apply to it too)
- [ ] `[H]` T3 Connect (relay, Clerk sign-in, managed tunnels, deregister) → Willow: not available; remote works over LAN / Tailscale / SSH
- [ ] `[H]` Push notifications, Live Activities, widgets → Willow: in-app notifications in the phone client while open

## 16. Desktop shell capabilities

- [x] Badge count for waiting threads on Willow's taskbar button (set and cleared in a desktop build), external links open in the browser, folder picker (checked), project icon picker (wired), theme files through the web picker
- [x] `[H]` Deep links → not needed: T3's desktop app takes them for T3 Connect's Clerk sign-in, its hosted web app's ChatGPT handoff and the return to `t3code://app` after either; Willow has none of those, and provider sign-ins come back through their own localhost callbacks
- [~] SnapShot on Windows (`apps/desktop/src-tauri/src/snapshots.rs`): turned on in Settings → SnapShots, a low-level keyboard hook on its own thread watches for the shortcut (both Shift keys by default, both keys of another modifier, or a key with modifiers, kept from the app in front; T3's refusals for chords other apps use), the window in front is drawn with `PrintWindow` and cropped to its frame, and the capture lands in the current draft's composer with its app and window title, T3's sound, Willow raised on the agent tab; with "Include app text" on, the window's text read through UI Automation goes with it (capped as T3 caps it). Checked in a desktop build: the settings, the state, a capture carried into the composer (`window-….png`, "willow-desktop · Willow pet") with its app text; the key matching by unit tests, since this machine's sandboxed shell cannot press keys into the app (Windows drops its injected input while the app is in front). Not done: the flash over the captured window, the fly-in animation
- [ ] Browser cookie import (with the browser preview)
- [ ] WSL backends (secondary / WSL-only, distro choice) — the Connections rows report WSL as unavailable. T3 runs a self-contained Linux `t3` its release pipeline builds (Node and the server with Linux builds of `node-pty`, the keyring and `fff`), or the distro's own Node with `node-pty` built there; Willow ships neither, and this machine's only Willow distro (`Willow-Computer`) belongs to another feature
- [x] Quit-hold: Willow's own quit stays as it is
- [x] Desktop app updates stay Willow's: the agents' update rows say "Up to date" and point at Willow's packaging

## 17. Server operations

- [~] Background policy, resource telemetry, process diagnostics (T3's server; Diagnostics page, its dashboards in Willow's usage type on the settings surfaces — sentence-case labels, 28px readings in Google Sans Flex, pill status chips — seen in a desktop build)
- [x] Server lifecycle and restarts: tabs stay signed in and reconnect after the server restarts
- [~] `t3` CLI parity where it applies inside Willow (as UI)
- [x] Telemetry: `[H]` PostHog → off

---

## Status

Checked in desktop test builds (`com.willow.studio.agentstest`) on Windows. Remaining work: the
browser preview's webview-only tools (devtools, screenshots, recording, picker, automation) and
its cookie import, WSL backends (a Linux build of the agents' server), SnapShot's flash and
fly-in, the device panel's stream controls, and end-to-end runs with signed-in agents.
