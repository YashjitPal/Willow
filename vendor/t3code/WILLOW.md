# T3 Code, forked for Willow

This is a fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT, © T3 Tools Inc., see
`LICENSE`), taken at `9bd1d8009a6b7c50f9dd9458e2bf27d481ff3b43` (2026-10-06). Willow's desktop
app runs its server and shows its web client, restyled in Willow's design, as the agent tabs on
Willow's rail (`features/harness`). The parity checklist is `features/harness/PARITY.md`.

What came over: `apps/server`, `apps/web`, `packages/*`, `patches`, `scripts`, `docs`,
`oxlint-plugin-t3code`, `native` (the terminal's libghostty headers and notice, the resource
monitor, the browser-import and SnapShot helpers), and the root workspace files. Not taken: the
Electron shell (Willow's Tauri app hosts the server instead), the Expo mobile app (the phone
client is the restyled web client), the marketing site, cloud infrastructure, and T3's reference
repositories.

It keeps its own toolchain, separate from Willow's npm workspace and typecheck: pnpm 11, Vite+
(`vp`, a dev dependency here), TypeScript 7, Effect 4. Willow's `tsconfig.json` does not include
`vendor/`.

Changes from upstream:
- `package.json` `prepare` no longer runs `vp config`, which installs git hooks into the
  repository that contains it: here that would be Willow's.
- `apps/web/vite.config.ts`: the third-party notices cover the web client and the server, not
  T3's Electron app, which is not here.
- `apps/web/src/willow/`: the bridge to Willow's page, standing in for T3's Electron preload
  (`window.desktopBridge`), installed by its own module script in `index.html` ahead of the
  app (bundled, the app's shared chunks run before `main.tsx`'s imports). In Willow, `main.tsx`
  leaves out the Electron window-control classes and tells Willow's page when it has painted,
  and `localApi.ts` closes the HTML context menus the bridge shows. Beside the bridge: Willow's
  design (`willow.css` and the files it imports, `icons.tsx` for `lucide-react`), Willow's
  sidebar pieces, the agent scoping of a tab (`harness.ts`, `WillowScopeRoutes.tsx`), the
  preview browser's tabs (`preview.ts`, used by `browser/HostedBrowserWebview.tsx`) and a
  development-only timeline fixture (`devTimeline.ts`). On Windows the desktop app gives each
  browser tab a webview of its own over the page (its `harness_preview.rs`, through Willow's
  `features/harness/src/harness-preview.ts`), since most sites refuse to be framed:
  `HostedBrowserWebview.tsx` draws an empty surface where it goes, `preview.ts` reports where,
  with what this page draws over it there (the webview is cut away under it), drives it, and
  passes its address, title, history and load failures to T3's preview state. Elsewhere a tab
  is an iframe `preview.ts` drives.
- `apps/server/src/willow/ssh.ts`: desktop-managed SSH environments, which T3 keeps in its
  Electron main process, served to Willow's page only (it must present the desktop bootstrap
  token).
- `apps/server/src/willow/mobile.ts` and `phone.ts`: Willow on a phone (Willow's
  `apps/android`). With `WILLOW_MOBILE_PORT` set (Willow's desktop app sets the server's port
  plus one), the server also serves Willow's own page on that port. The page comes from
  Willow's `apps/studio/dist`, found above `vendor/t3code`. Only clients paired with this
  server get it: their session cookie is checked against `/api/auth/session`. Alongside the
  page come Willow's `/llm-proxy` and `/api/fetch-source`, and a relay to Willow's local
  companion (`WILLOW_COMPANION_PORT` and `WILLOW_COMPANION_TOKEN`).
  - `GET /.well-known/willow/mobile` names the page's port and the server's own.
  - `POST /api/willow/harness` issues the phone a pairing credential for the agent tabs' page.
  - The `phone_*` MCP tools (`mcp/toolkits/phone`) reach the phone through `phone.ts`. The
    phone's Willow page long-polls `/api/willow/phone/next` and posts each answer to
    `/api/willow/phone/result`.
- The web client's user-facing "T3 Code" reads "Willow" (T3 Connect, T3's store apps and the
  GNOME extension keep their names); its icons and manifest are Willow's; `T3Wordmark` draws
  Willow's mark; the per-project sidebar is the default (`packages/contracts` settings), and in
  Willow's agent tabs the only one: it carries Willow's tabs, so `useLegacySidebarEnabled` holds
  it there whatever the stored setting, and its switch is hidden (`SettingsPanels.tsx`,
  `settingsSearch.ts`).
- Components restyled in place where a selector could not reach them (the sidebar, the user
  bubble, buttons, the HTML context menu, the toasts' `data-slot`, the welcome wizard's header),
  and new threads land on the tab's agent (`providerInstances.ts`, `chatThreadActions.ts`,
  `ChatView.tsx`, `DraftHeroHeadline.tsx`, `useHandleNewThread.ts`).
- The composer is Willow's prompt box (`willow/composer.css`): `ChatComposer.tsx` keeps one
  shape (T3's resting layout is off), puts Willow's plus and plus menu at the left
  (`WillowComposerPlus.tsx`: Upload files, and Plan as a tool whose chip turns it off) and
  Willow's model pill and model menu at the right (`WillowModelPill.tsx`, traits as its rows,
  each opening its values; `TraitsPicker.tsx` and `composerProviderState.tsx` gained the
  per-trait listing and a summary). The workspace and branch controls (`BranchToolbar`, "Work
  locally" in `BranchToolbar.logic.ts`) render as Willow's chips (its media gallery's), centred
  under a new thread's box (a portal from `ChatView.tsx`), with the context meter
  `ChatComposer.tsx` portals beside them; the first message settles both, so in Willow
  `ChatView.tsx` ignores `persistComposerContextStrip` and a running thread keeps the meter in the
  box's footer. The access control (`runtimeModeConfig.ts`: "Ask for approval", "Auto-accept
  edits", "Auto" with Material glyphs, "Full access" with the Luminous `lock` Willow's Spark gives
  it, `willowSymbol(glyph, "luminous")`) is plain text in the model name's size and ink on the
  model pill's line, not a chip. A new thread's box sits on Willow's home glow
  (`.willow-home-glow-layer` in `willow.css`, from Willow's studio `index.html`, its mask in
  `public/willow/glow-mask.webp`), in the colours Willow's page sends for the tab: its agent's
  (Willow's `features/harness/src/harness-theme.ts`). `DraftHeroHeadline.tsx` drops T3's "or
  start without a project" line; "No project" in the headline's project menu carries the
  shortcut. What is attached above the box is
  Codex's composer rail, one panel 13px in from its sides with a rule between its rows
  (`composer.css` on `ChatComposer.tsx`'s banner column): in Willow `ComposerBannerStack.tsx` lists
  every notice there rather than stacking them, and `QueuedRunsControl.tsx` is a row of it as
  Codex's queued messages (its glyph, the words, Steer, bin, and a menu with Edit message and
  T3's queue / steer setting); a running plan's "Step N / M" sits centred over it as Codex's
  in-progress strip. `ComposerControl.tsx` chips carry
  `data-composer-control` and Willow's chevron; `ComposerPrimaryActions.tsx` sends with Willow's
  arrow, stops with its filled square and names Queue / Steer / Stop with their keys. The `@` and `/` suggestions are Willow's prompt-box
  menus (its mention card and slash menu) over the box rather than T3's drawer under it, by CSS
  on T3's drawer (`composer.css`).
- A turn's work reads as the Codex app's (`willow/activity.css`, `activity.tsx`,
  `activitySummary.ts`, `codexIcons.ts` from the Codex app UI clone's icon set): `WorkLog.tsx`
  rows carry data attributes for its geometry; `MessagesTimeline.tsx` names commands and edits
  with Codex's verbs, shows reasoning as "Thought", puts the chevron after the summary, opens
  commands to a shell card and edits to a unified diff (also `V2ItemInspector.tsx`);
  `MessagesTimeline.logic.ts` adds Codex's group summary (`codexSummary`, `codexIcon`) beside
  T3's, keeps thinking and image views out of tool groups, drops the closing "Thinking" under a
  reply that is already streaming and folds a stopped turn behind "You stopped after" as Codex
  does; `ProposedPlanCard.tsx`, `ChangedFilesTree.tsx` (`ChangedFilesCard`) and
  `ComposerPendingApprovalPanel.tsx` take Codex's plan, end-of-turn and approval cards.
- The sidebar is Willow's own (`willow/WillowSidebar.tsx`, `willow/sidebar.css`): tabs for New
  thread, Add project, Search threads (`routes/search.tsx` and `willow/WillowSearchPage.tsx`, Willow's
  Search chats page, `willow/search.css`), Pull requests and Usage, and the gear opening Willow's
  settings pane of T3's settings pages; `LegacySidebar.tsx` makes each project a folder row with its
  working count. In Willow `AppSidebarLayout.tsx` keeps the sidebar at Willow's 288px with no
  resize handle (its collapse button is the only control, as Willow's own), collapses it to
  Willow's 52px rail (T3's icon mode, on the page's own colour: `sidebar.css` drops T3's grain)
  instead of off the screen, drops T3's floating sidebar button (the shortcut stays),
  keeps the threads beside the settings pages instead of T3's settings panel, and lets the page
  headers keep their gutter beside the rail. A thread's header leads with its title, its project
  after it (`willow/primitives.css`).
- The settings pages are Willow's full-page settings (`willow/settings.css`, after its LabsPage and
  ModelsApiPage): in Willow `settingsLayout.tsx` gives each page Willow's headline (the page's
  name, its actions, the scope sentence as its description) in place of `routes/settings.tsx`'s
  breadcrumb bar, a section named like its page hands its actions to the headline, and sections,
  groups and rows carry data slots for the cards, rows and controls. `ProviderSettingsPanel.tsx`
  turns the providers into Willow's list of provider rows, each opening as its own page with a
  back arrow (`useSettingsHeadlineOverride`); `ThemeSettings.tsx` splits the color scheme and the
  themes into two cards. T3's `Button` also carries `data-size`, which survives a trigger's
  `render` where `data-slot` does not.
- The side panel reads as Codex's (`willow/rightpanel.css`, the browser's bar included), its
  tabs and the terminal drawer's as Willow's (12px corners, no edge, its chips' fill for the
  chosen one); sent messages are Willow's chat bubble (`willow/message.css`,
  `CollapsibleUserMessageBody` in `MessagesTimeline.tsx`); "more" buttons are Willow's three-dot
  trigger (`icons.tsx` maps the ellipses to `more_vert`).
- In Willow's desktop app the side panel's tabs are drawn in the strip across its window, over
  the panel up to the window buttons (`stripTabs: true` in the page's init): `RightPanelTabs.tsx`
  reports them through `willow/stripTabs.ts` (a glyph as a PNG mask drawn from the icon font,
  which the strip lacks; a page's icon by address) and acts on what is done to them there —
  choosing, closing, the tab's menu, and the + menu, anchored under the strip's + at the top of
  the page. The panel's row then keeps only its controls, over the surface at the top right, and
  the surface's own bar (the browser's address bar, a review's tools) moves up beside them into
  the row's place (`rightpanel.css`).
- The page changes layout at Willow's breakpoints, measured on Willow's window (rail included)
  rather than its own narrower frame: Willow's page sends the width (`viewport`, and
  `viewportWidth` in the init) and `willow/viewport.ts` marks the root with the tiers it falls in
  (`data-willow-compact` at 960px and below, `-tablet` 769–960, `-phone` 768 and below,
  `-max-720`, `-small` 600 and below). At its compact width the sidebar is Willow's drawer
  (`useIsMobile` in `hooks/useMediaQuery.ts`, opened by `WillowDrawerButton.tsx` from
  `AppSidebarLayout.tsx`), the side panel covers the page (`ChatView.tsx` takes the sheet,
  `RightPanelSheet.tsx`), and T3's collapsing phone composer stays off (`ChatComposer.tsx`), as
  Willow's box keeps one shape; `willow/responsive.css` carries the rest from Willow's own pages:
  the drawer's 44px rows and scrim, the 64px header band with the model picker beside the menu
  button, the black dark page, the conversation's insets, the prompt box's tiers, a new thread's
  box docked at the bottom under its greeting over the rising glow, the plus menu's touch
  layout, centred confirmations and search's column.
- `icons.tsx` paints a glyph from an attribute in a `foreignObject`, so icon names never join
  the text around them. `MorphIcon.tsx` draws vanilla `lucide` data, which the alias misses, so
  it paints the glyph `willow/morphGlyphs.ts` maps its icon to (copy, folds, folders, toggles)
  and morphs only icons without one. The thread's and panel's controls at the top right are
  Willow's 36px header buttons with 24px glyphs (`PanelLayoutControls.tsx`, `primitives.css`),
  and the side panel's icon buttons are 32px with 20px glyphs (`rightpanel.css`).
- An agent tab never runs on another agent: `resolveComposerProviderSelection`
  (`ChatView.logic.ts`) takes the tab's driver, so a tab whose agent is off or signed out shows
  "Set up <agent>" (`ChatComposer.tsx`, the sidebar's account row) instead of falling back to a
  ready agent's model.
- Cursor takes a pasted API key (`crsr_…`): the `CURSOR_API_KEY` field (`providerDriverMeta.ts`)
  warns about a key without the prefix and turns the instance on when saved
  (`ProviderInstanceCard.tsx`); the Account row says which key is in use
  (`ProviderSettingsPanel.tsx`); a disabled provider's sign-in says to turn it on
  (`ProviderAuthenticationSection.tsx`); the server's messages name the key
  (`CursorProvider.ts`, `CursorAuth.ts`, `CursorTextGeneration.ts`).
- The review panel's files read as Codex's ChangesPanel: `DiffPanel.tsx` draws each header's
  content in the viewer's prefix slot (`willow/DiffFileHeader.tsx`: chevron, document, name then
  folder, the kind of change, the counts) and a "File actions" button opening the file menu with
  Copy path, and lists the files beside them as Codex's file list does (`CodexReviewFileList`,
  with its filter); `willow/diffs.ts` adds rules inside every viewer's shadow root (36px headers,
  the whole changed row in Codex's git colour at 23%, gutters in 30% ink, `classic` +/- signs in
  the panel) and, for the panel, a hairline card around an opened file's lines and a hairline
  under every file; `StyledDiffCodeView.tsx` takes the 36px header height into its virtual
  geometry.
- `contextMenuFallback.ts` measures a menu by its laid-out size, so one opened near the window's
  edge is kept inside it while its open animation still scales it down.
- The usage page reads as Willow's usage view (`willow/usage.css`, data attributes in
  `UsagePage.tsx`, `UsageShareBar.tsx`, `UsageLimitsPooled.tsx`): sections on cards, a
  provider's limit windows stacked as Willow stacks its usage windows, Willow's type scale.
- SnapShot rides Willow's desktop app (`willow/bridge.ts`): the bridge's capture methods ask
  Willow's page, which asks the app (`apps/desktop/src-tauri/src/snapshots.rs`, the captured
  window's text read through UI Automation when "Include app text" is on), and the capture
  settings are handed to the app whenever they are saved.
- Pictures and videos sit in Willow's 112px square tiles, cover-cropped: in the prompt box's
  strip (`ChatComposer.tsx`, `composer.css`; the placeholder stays while the prompt holds only
  attachments, `ComposerPromptEditorTiptap.tsx`) and in a row above a sent message, which draws no
  bubble when it has no words (`MessagesTimeline.tsx`, `message.css`). A capture's app and window
  are its tile's title and its app text a button in the corner (`SnapShotContentsButton`).
- Things move as Willow's do. Menus, right-click menus, pickers and popovers move as its menu
  pane (`menus.css`; `contextMenuFallback.ts` grows from the pointer and fades out before it is
  removed), the plus and model menus as their own, selects as its settings dropdowns, tooltips
  at once without gliding between triggers (a `TooltipProvider` in `main.tsx`). Dialogs move as
  its dialog, sheets as its drawer (`sheet.tsx` names the side), toasts as its snackbar at the
  window's bottom left (`toast.tsx`), and the command palette opens at once (`primitives.css`).
  Panels slide for 300ms on its curve: the bridge starts T3's panel-motion setting at 300ms once,
  after which it is the user's. Work entries open and close as its code panel (`WorkLog.tsx`), a
  streaming reply's words fade in as its replies' do (`willow/streamWords.ts`, `ChatMarkdown.tsx`),
  and a copied message is confirmed by the snackbar alone (`MessageCopyButton.tsx`).
- The rest of the client's chrome is Willow's or Codex's too. Dialogs keep Gemini's surface and
  take its outlined field (56px, 4px corners, the outline doubled on focus) for their inputs,
  selects and pickers, its text pill for Cancel and Willow's 40px round close (`primitives.css`;
  footer buttons are matched by `data-variant`/`data-size`, since a dialog's close part replaces
  `data-slot`); a form that ends in an action puts it at the right as a footer does
  (`data-slot="dialog-actions"`, `ConnectionsSettings.tsx`). The command palette is Willow's
  compact search dialog (`command.tsx` gives it the 64px search bar); toasts and the banners over
  the timeline are its snackbar (`toast.tsx` puts the dismiss inside); the thread details card
  and T3's glass surfaces are its menu card (`menus.css`, `threadDetailsPanelStyles.ts`); Pull
  requests is Spark's All tasks under Willow's search pill (`willow/pages.css`); a picker's
  search is Notebooks' 28px pill (`combobox.tsx`). From Codex: the terminal drawer's header is its
  bottom panel's tab strip, a tab per terminal in place of T3's side list, over TerminalView's
  inset (`ThreadTerminalDrawer.tsx`); file trees take FilesPanel's 28px rows and filter
  (`pierre-tree-theme.ts`, `FileBrowserPanel.tsx`); the browser's start page takes the launcher's
  rows (`discovery-list.tsx`, `PreviewEmptyState.tsx`); a running plan is its "Step N / M" pill,
  centred over the composer rail, with the steps in a card on hover (`ComposerPlanPill`). Right-click menus keep an icon's slot on
  every row once one row has an icon (`contextMenuFallback.ts`). Diagnostics' dashboards take
  Willow's usage type and the settings surfaces (`ResourceTelemetryDiagnostics.tsx`, and
  `settings.css` for T3's tracked capitals, bordered panels and monospace readings on any settings
  page).
- Tests follow: T3's expectations of its own names, icon classes, wordings and the boot script's
  light page were updated where the fork changes them (`*.test.ts(x)` beside each change).

Built by Willow's `apps/desktop/scripts/agents.mjs`, which also stages the server for release. It
builds in one process at a time (`apps/desktop/build/agents.lock`; `build.mjs` and `pack.mjs` build
the agents too), and checks the client it copies beside the server and the server it stages against
the web build file by file: the server answers a missing chunk with `index.html`, so a client short
of one file is a page that never starts. A page that cannot start says so to Willow's tab
(`lib/bootError.ts`), which shows what went wrong instead of loading it again forever.
