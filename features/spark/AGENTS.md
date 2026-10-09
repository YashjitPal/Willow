# features/spark

Scheduling agent + browser automation. The user defines tasks (e.g. "every weekday
at 9am, check my inbox and summarise") and Spark executes them on a schedule.

## Files

| Path | Role |
| --- | --- |
| `src/SparkWorkspace.tsx` | Entry workspace (1308 lines). Task dashboard. Bots is a tab of its own beside the rest of Spark (`withBots`): once opened its page stays mounted, hidden while another Spark page is on show, and behind it the workspace keeps to the page Spark last showed, hidden — one workspace, since it runs the schedules and turns. |
| `src/SparkHome.tsx` | The launch / suggested-tasks grid. |
| `src/SparkTaskCard.tsx` · `.css` | Gemini's `.goal-card` row + its `⋮` action menu. Shared row for every task list. |
| `src/SparkTaskDialogs.tsx` · `.css` | Rename / Delete confirmations, with Gemini's copy. |
| `src/SparkTaskDetail.tsx` | Task detail/edit view (2196 lines). |
| `src/SparkComposer.tsx` · `.css` | The prompt box: a thin wrapper over Chat's `InputBar`. See below. |
| `src/composer/` | The prompt box's "@" app menu and "/" skill menu, laid over `InputBar`. See *Skills and connected apps*. |
| `src/spark-connectors.ts` | What a run can reach beyond its workspace: connectors and MCP servers as tools, and the timeline row each call puts down. |
| `src/spark-recommended-skills.ts` | Gemini's five recommended skills, verbatim, used to prefill the skill editor. |
| `src/spark-composer-chips.tsx` | Chip rows and tool labels for the task-detail composers, plus the file-merge helper. |
| `src/SparkAllTasks.tsx` | Full task list. |
| `src/SparkScheduleEditor.tsx` | Cron/time picker widget. |
| `src/SparkSkillEditor.tsx` | User-defined skill editor (LLM prompt templates). |
| `src/SparkCustomisePages.tsx` | Task customisation (1150 lines). |
| `src/remote-browser/` | The remote browser: permission card, pane, frames, driver. See *The remote browser*. |
| `src/SparkDictationWaveform.tsx` · `src/useSparkDictation.ts` | Voice-activation UI. |
| `src/useSparkNow.ts` | The "run now" hook. |
| `src/spark-store.ts` | Nanostore (1478 lines). Task state, scheduling, globals. |
| `src/spark-types.ts` | Shared types (`SparkTask`, `SparkSchedule`, `SparkSkill`, …). |
| `src/spark-routes.ts` | Each Spark page's address, both ways: Gemini's six. |
| `src/SparkFileViewer.tsx` · `.css` | A file a run created, as Gemini's side panel shows a Doc. See *Created files*. |
| `src/spark-open-file.ts` | Which created file each task's side panel shows. |
| `src/spark-create-with.ts` | What "Create with Gemini" opens on, on the Schedules and Skills pages: Gemini's texts. |
| `src/spark-task-layout.ts` | A task to open with its list collapsed and Progress showing. |
| `src/spark-schedule-time.ts` | When a schedule next runs. |
| `src/attachment-storage.ts` | File attachment persistence. |
| `src/spark-disk.ts` · `src/spark-task-files.ts` | Each task's files beside `Spark/Tasks/<task>.json` in the user's folder: its attachments, and the remote browser's screenshots. See *The history is kept for good*. |
| `src/browser-tabs-bridge.ts` | Connects the Spark agent to `chrome.tabs` / `browser.tabs`. |
| `src/spark-task-host.ts` | The seam that lets code outside the Spark page start, follow up and stop tasks through the mounted workspace's own runner. Bots use it. |
| `src/dots/` | Bots (the feature's code keeps the name `bots`; everything users and models read says "bot"): Codex's characters and onboarding, the bots directory and conversation. `dots-light.css` is the light theme for every Bots style that names one of Gemini's dark colours directly. |
| `src/dots/chat/` | A bot's conversation as a messenger, in Material 3 for the web (`@material/web`): bubbles grouped into bursts, day separators, read receipts, a typing bubble, and reactions both ways — the bot's labelled chips under the user's bubbles, the user's own under the bot's, picked from a hover button, the keyboard or a long press. |
| `src/dots/m3/` | The Material 3 components the bot UI uses (`m3.ts` registers them and types them for React), their system tokens set to Gemini's palette and tinted by the bot (`m3.css`), and a controlled `M3Switch`. |
| `src/dots/triggers/`, `src/dots/profile/` | The profile's Scheduled list and the conversation's trigger cards; Instructions, quiet hours and background research, and Skills and apps. |
| `src/dots/computer/` | A bot's own computer in the desktop app: its pane (Spark's remote browser, filled with the machine's whole desktop), its cards and its profile row. |
| `src/dots/dots-folder.ts`, `src/dots/dots-folder-plan.ts` | Each bot and its whole thread as `Spark/Dots/<bot id>.json` in the user's folder, so bots outlive browser storage and reach every copy of Willow on the folder. The rules are in the harness [AGENTS.md](src/dots/harness/AGENTS.md#persistence). |
| `src/dots/harness/` | The bot harness: an always-on fork of Spark's harness with its own memory and runtime. Has its own [AGENTS.md](src/dots/harness/AGENTS.md). |
| `src/pets/` | The desktop pet and its Customise page (`/spark/pets`), in the desktop app only. See *Pets*. |

## Pets (desktop app only)

BetterGravity's Pets plugin, ported: Codex's desktop pet, standing on the
desktop in a transparent always-on-top window, with an indicator and a stack of
cards for every Spark task that is running, needs input, is blocked, or finished
while you were away. Under Customise, **Pets** chooses the companion, previews
each animation, renames it, opens the library folder, creates one with the Hatch
Pet skill, and holds the plugin's settings. The desktop strip's paw shows and hides it.
Neither the page nor the sidebar item exists in a browser (`isDesktopApp()`), and
nothing of it loads there: `SparkPetsHost` and `PetsPage` are lazy chunks.

| File | Role |
|---|---|
| `surface/surface.js` · `pet.css` · `hud.css` | The pet itself: the plugin's `petSurface`, verbatim, and its styles. Self-contained on purpose — it is sent as source to the overlay window — so keep it that way, and keep it in step with the plugin rather than editing it here. |
| `pet-sensor.ts` | Spark's tasks as activity entries: the plugin's levels, priority, expiries, dismissal, greeting and sort, with Spark read in place of Antigravity's sidebar. Pure; tested. |
| `pets-controller.ts` | The keeper. One tab at a time (Web Lock `willow-pets`) reads the sensor, runs the surface — the desktop overlay, or inside its own page — and does what the pet asks. |
| `SparkPetsHost.tsx` | Mounted in every desktop tab by `App.tsx`: a turn at keeping the pet, and opening what it asked for in the tab in front. |
| `pet-store.ts` | Settings and state (localStorage, `willow:pets:*`), shared by every tab. |
| `pet-library.ts` · `PetsPage.tsx` · `.css` | The library and its page, on the Skills page's frame. |
| `pet-create.ts` · `pet-skill.ts` · `hatch-pet/` | Create with Gemini: the Hatch Pet skill as a Spark skill, and Spark's home with the request prefilled. |
| `pet-image-tool.ts` | `app:generate_pet_image`, the skill's image tool (Spark has none of its own). |

- **One keeper.** Every tab is a page of its own, so the pet is kept by whichever
  tab holds the lock; when it closes, another takes over and restores what the
  sensor knew (`willow:pets:memory`, if under a minute old). Inside Willow's window
  the pet must be on screen, so there the tab in front keeps it.
- **What is news** is the plugin's rule: running, needs-input and failed tasks
  always; anything else only once it has changed while the pet watched. An unread
  reply that was already there is the baseline. Cards expire (failed 1 h, waiting
  1 day, ready 1 week); a dismissed card stays away until its task does something new.
- **What the pet asks** goes through the task host (`spark-task-host.ts`): a reply
  is `followUp`, the chat pill is `startTask`, stop is `stop`. Opening a task, and
  the pet's poke, raise Willow and are carried out by the tab in front
  (`showInDesktopTab`).
- **Creating a pet** needs Python 3 with Pillow on the computer (the skill installs
  Pillow when missing, not Python) and a Gemini image model in Settings → Models.
  `app:generate_pet_image` is offered only in the desktop app and only while the
  user has the hatch-pet skill; the app lets it read and write only inside the
  library's `.hatching` runs. Runs and finished pets appear on the page by
  themselves (the app watches the library).
- Tests: `apps/studio/test/pets-sensor.test.mjs`.

## Architecture

Spark is nearly stateless-to-the-user: the store (`spark-store.ts`) is the action
hub, and the UI components dispatch through it. The backend agent (in
`@willow/ai/computer-use/session.ts`) is the runner; Spark is the scheduler.

## Runs outlive their tab

Runs already outlive the screen: `sparkRunControllers` and `sparkState` are
module-level, so leaving Spark does not stop a task. The background-only
`SparkWorkspace` sits **above the routes** in `App.tsx`, so schedules, the disk
mirror and takeovers keep going in the Media editor too.

Every run is also a `spark-run` background job (`platform/core` AGENTS.md):
`beginSparkRun` starts it under `sparkRunJobId(scope, task)` with the follow-up's
`turnId` when there is one, and `finishSparkRun` finishes it on every exit
(complete, stop, failure, missing key, waiting for input). When the tab running
it closes, whichever `SparkWorkspace` another tab has mounted takes it over and
calls `retryTurn` or `retryTask`, so the run starts again from the top there.

**"Interrupted" means no tab is still running it.** `normalizeTask` used to turn
any task saved as running into "Run interrupted". Every tab reads every task file
back from disk, so any second open tab rewrote a task as interrupted *while its
run was still going*, the two versions diverged on disk, and the folder engine
forked `<id> (Disk conflict …)` copies (the cascades in `Spark/Tasks/` were this).
Now the recovery applies only when `readLiveBackgroundJob` finds no live job, and
never to a file read back from disk (`parseSparkTask`): disk lags the store, so a
run that has just finished can still read as running there, and recovering it
replaced the finished answer with the interrupted notice.

## The prompt box is Chat's, not a second copy of it

`SparkComposer` wraps `InputBar` from `@willow/chat/composer/Composer`. Spark used to
hand-build its own composer around Chat's `PlusDropdownMenu`, which meant the file input,
the dictation button, the send-button entrance and the attachment chips existed twice and
drifted: Spark's could attach a file but never showed a thumbnail, and never gained the
image paste or GitHub import that Chat's grew.

Three of Chat's existing props make it fit without a fork:

- **`chatVariant`** is already the Gemini-styled box — 660px wide, 32px corners, #1e1f21 —
  which is what Spark's own copy had been measured to independently.
- **`liveAvailable={false}`**, with no live handlers passed, *is* the behaviour Spark wants
  from the send slot. `showSubmitControl` mounts the button only when there is something to
  send, so an empty box shows nothing and the arrow animates in on the first character —
  which is Gemini Spark's rule too. It also makes the voice session unreachable from here.
- **`hideModelPicker`** drops the model pill, which Gemini's Spark composer has no
  equivalent for. Tasks still run on the model `selectedModelId` names.

Four props were added to `InputBar` for this, all optional and all defaulting to today's
behaviour: `placeholder`, `hideModelPicker`, `composerRef`, and a fourth `tool` argument on
`onSubmit`. Chat ignores the last one; Spark stores it on the task.

**Attachments are the one real seam.** Chat hands back `ComposerAttachment`s holding a live
`File`; Spark persists its own `SparkTaskAttachment` records into IndexedDB before the task
exists. `SparkComposer` bridges the two and keeps the ownership rule Spark already had: if
the task cannot be created, the payloads it wrote are deleted again. Read the files out
synchronously — `InputBar.onSubmit` is sync and clears its own state on return (it revokes
the object URLs, not the `File` handles).

**`composerRef` exists because the draft is `InputBar`'s local state.** Spark's Suggested
cards fill the box from outside, and there was no other way in.

### Which composers were converted

All four: `SparkHome`, `SparkAllTasks`, and both boxes in the task detail view — the
sidebar's compact new-task box and the thread's follow-up box.

**The model pill stays visible** — a deliberate divergence from Gemini, which shows no model
control on its Spark composer. `selectedModelId` is the model Spark actually resolves the
task against, so the pill is the shortest path to running one on something else, and it
writes to the same app-level state Chat's picker does. `setSelectedModelId` therefore has to
reach every composer: `App` → `SparkWorkspace` → the page → `SparkComposer`.

Two things the conversion needed beyond the props above:

- **`disabled` on `InputBar`**, covering the textarea, the plus menu, the mic, the send slot
  and the fullscreen toggle, with the guard repeated in the submit path so Enter cannot
  bypass it. It now only covers a follow-up that is mid-submit: a working task uses
  `isGenerating` instead, which keeps the box live and turns send into stop, and a
  permission card leaves it open. See below.
- **`onSubmitFiles`**, an alternative to `onSubmitTask` that hands over the raw files. The
  follow-up path is keyed to a specific task and aborts if the user navigates away
  mid-upload, and it reads a boolean back from the store to decide whether the turn was
  accepted. Rather than grow `SparkComposer` a callback per race, that site keeps its own
  pipeline intact.

### A working task takes a draft, and send becomes stop

Willow used to lock the whole follow-up box while a task ran
(`disabled={followUpBlocked}`). It no longer does, and neither does Gemini's now — its box
reads "Ask a follow-up" over a stop control while the task works. It mirrors Chat: you can
write the next message while Spark finishes, and the send slot is a stop control until it
does.

`followUpBlocked` is a running task, and refuses the send. There is no hard lock left: a
permission card leaves the box open, as Gemini's does, and writing instead of answering
turns the request down (`submitFollowUp` in `SparkWorkspace`). The placeholder is
Gemini's "Ask a follow-up" in every state and at every width.

**Sending is still refused until the run ends,** by three guards, none of which is the
textarea's `disabled`: `SparkComposer.submit`, `InputBar`'s submit path (which is what
makes Enter safe), and `submitFollowUp` in `SparkWorkspace`, which returns `false` for a
`running`/`queued` task. There is **no queue** — a draft waits in the box until the run
finishes, and Spark still runs one turn per task.

**The part that is easy to get wrong is the stop, not the unlock.** `stopTask` only
aborts the run's `AbortController`; the run's own catch block settles the task. Before
this, that catch marked the sub-agents cancelled and `return`ed **with the status still
`running`** — which is exactly what the composer reads, so a stopped task would have
stayed stopped-but-busy and re-locked the box. Both catches now finalise to `'cancelled'`,
a status that already had a label, an icon, a message and a retry affordance.

`isCurrentRun()` is what makes finalising there safe. A user stop leaves the run current,
so it settles. A *preempted* run does not: `beginSparkRun` aborts the previous controller
before installing the new one, so the run being replaced sees `isCurrentRun() === false`
and leaves the status to whichever run took over. Whatever text had streamed is kept, as
Chat keeps a partial reply.

**Blanket focus rules reach into the composer too.** `SparkTaskDetail.css` carried
`.spark-task-detail :is(button, textarea, input):focus-visible { outline: 2px solid #a8c7fa }`,
written for Spark's own controls. Once the composer became Chat's `InputBar` that rule
painted a rectangle around the textarea on every focus — while the same composer in Chat
showed nothing, which is the exact inconsistency sharing the component is meant to remove. It
now carries `:not(.spark-composer-host *)`. Note the ring is *invisible* rather than absent
on the home and task-list composers: Tailwind's `outline-none` computes to
`outline: 2px solid transparent`, so **outline width alone tells you nothing — check the
colour.**

**Two more leftovers bit during the task-detail swap, and both would bite again.** The old
`.spark-task-detail__{new,followup}-composer textarea { height: 24px; max-height: 144px }`
rules were descendant selectors, so they kept applying to Chat's textarea and stretched the
box from 64px to 164px — the placeholder ended up floating near the top of a tall empty
panel. And the wrapper's `box-shadow` had to move onto the composer itself: Chat's own
`0 2px 8px -2px rgba(0,0,0,.16)` is right against a page background but vanishes against
this panel's #1f1f1f, and a shadow left on the square wrapper traces corners the composer
does not have. **When you retire a composer, delete its descendant rules in the same pass** —
the wrapper class survives as a positioning hook, so those selectors keep matching.

`110-composer-parity.cjs` pins both sides of the boundary: Spark's boxes carry the plus menu
and mic with no live control and mount send only on typing; Chat's keeps its model pill and
its "Ask Willow" placeholder. `116-followup-composer.cjs` covers the follow-up box's
placement, elevation and that its lock is consistent across every control.

### The composer and its glow are one node each, moved between routes

`SparkWorkspace` creates two detached hosts once — `.spark-connected-composer` and
`.spark-connected-glow` — and `attachSharedComposer` / `attachSharedGlow` `appendChild`
them into whichever `[data-spark-new-composer-anchor]` / `[data-spark-glow-anchor]` the
current route rendered. That is what lets both slide across a task navigation instead of
being torn down and rebuilt: `transitionTaskNavigation` measures them, re-attaches inside
`startViewTransition`, and `liveMove` animates the delta. A new Spark route joins in by
rendering the anchor attributes — it does not render a composer of its own.

**The trap: re-inserting a node restarts its CSS animations.** Anything on these hosts
that animates replays on every re-parent, so `attachSharedGlow` adds `is-settled` on each
attach after the first, pinning the reveal's end frame and setting `animation: none`.
Those values are *duplicated* from the keyframe's 100% and have to move with it — the
base rule is the pre-animation box (800×160), and it was the `both` fill mode that had
been holding the smaller settled size, so removing the animation alone jumps the glow
*larger* rather than leaving it put.

### Never let the "Loading task…" frame render between two tasks

That branch is the reason anchors get recreated, and it is worth understanding because
it breaks more than the glow. The task list holds summary records (`bodyLoaded: false`),
so navigating to a task before its body is read renders a tree that is **not** the detail
and carries **no composer anchor** — React unmounts `SparkTaskDetail` and rebuilds it a
microtask later.

What replays on that rebuild:

- **The shared composer glow**, re-parented into the newly built anchor.
- **The shared composer itself**, which is why the prompt box once animated toward zero
  width and snapped: `liveMove` measured a destination that had just been detached.
- **The wide wash** below — until its entrance animation was removed outright.

The fix is the same on both open paths in `openTaskWithTransition` — call the synchronous
`ensureSparkTaskBodyLoaded(taskId)` *before* `goToSparkTask(taskId)`, so the store update
and the route change land in one render and the loading branch is never reached. The
entering path always did this; the task→task branch did not, which is why switching
between tasks flickered while entering from the list looked right.

If you add another way to open a task, it needs the same pairing.

### The prompt-box glow is two layers, on both routes

Debugging it as one thing is what makes it confusing. Behind the Spark composer there are:

1. **`.spark-connected-glow`** — the tight pill, a single node that travels between route
   anchors (above).
2. **A wide background wash** — `.spark-task-detail::before` on the detail route and
   `.spark-all-tasks::before` on the list route, blurred 200px and reaching well up over
   the composer.

The wash used to exist **only** on the task-detail route, which is what its own comment
describes: it "lets the task-detail glow continue past the library". So closing a task
unmounted it and left the list route lit by the pill alone — the glow visibly dimmed and
*stayed* dim until a task was opened again. Both routes now carry both layers.

Two things follow, and they are easy to undo by accident:

- **Neither wash animates in.** Once both routes have one, a fade-in on arrival dips a
  layer that was already on screen, which is a flicker rather than an entrance. The
  detail wash's `spark-task-detail-background-grow` was deleted for this reason.
- **Both washes must state their settled values, including `translate(-50%, -45%)`.** The
  detail wash's authored `opacity: 0.7` and `translateX(-50%)` were being overridden by
  the grow keyframes' 100% frame, so removing the animation without writing those values
  back drops the wash 45% of its own height. The list copy matches it deliberately; if the
  two disagree, crossing routes shifts the glow.

The washes differ in exactly two places: `left: 15%` on the detail route (the composer
sits in the left 41.5% library pane) versus `left: 50%` on the list, and `z-index: 0`
versus `-1` — the list route needs the negative index for the same reason its pill does,
so the wash stays above that element's opaque fill but behind the task rows.

`--spark-task-detail-accent` comes from `sparkAccentVars` so both routes light from one
source; it used to be computed separately in `SparkTaskDetail`.

### `@starting-style` has to be scoped to the state you mean

`@starting-style` supplies a start value whenever an element has **no previous computed
style** — which is *insertion*, not just a `display: none` → visible flip. So an
unscoped block animates the element every time it mounts, whether you wanted an entrance
or not.

The status pill had one written against its plain selector, so the "Complete" chip played
a 300ms fade-and-scale on arrival. It also did not need it: the animation it was written
for is the progress panel hiding and showing the pill, and coming back from `.is-hidden`
already has a real previous style (`opacity: 0`, `scale: 0.9`) to transition out of, which
is all a transition needs. `allow-discrete` in the `transition` handles the `display` half.
The values now live on `.is-hidden`, so the panel animation survives and the mount does
not animate.

Compare the progress panel's own block, which is correct: it is scoped to
`.spark-task-detail__progress-panel.is-open`, so it applies only to the open state and
the panel's default closed state mounts inert. **Scope the block to a state class unless
you genuinely want an entrance on mount** — and in Spark you usually do not, because the
task-detail pane mounts more often than a user would call it an arrival.

## Gemini Spark is codenamed "remy"

Spark is transcribed from `gemini.google.com/spark`, whose components are all
`remy-*`: `remy-new-task-page` (the home route), `remy-task-list` (the `Recent`
list and the full list), `remy-task-discovery` (`Suggested`), `remy-status-pill`,
`remy-goal-action-menu`, plus `remy-viewer` / `remy-side-panel` on the two-pane
task detail. Searching Gemini's bundle for "spark" finds almost nothing; search
for `remy`.

Its six routes are `/spark`, `/spark/tasks`, `/spark/schedules`, `/spark/skills`,
`/spark/apps` and `/spark/chat/<id>`, and Willow's are the same six
(`src/spark-routes.ts`). The page itself lives in `sparkLocation` in the store and
in each history entry's state; the shell writes the address from it and opens the
page an address names (`apps/studio/AGENTS.md`, *Every shell surface has an
address*). The two editors have no address of their own and sit on the list they
edit, `/spark/schedules` and `/spark/skills`, as Gemini's do.

Captures, the scraper harness and the Gemini↔Willow diffs live in
`tools/ui-research/{captures,scrapers}/spark/`.

## Verifying a change

```
node tools/ui-research/scrapers/spark/verify-all.cjs
```

Runs every fidelity check and prints one pass/fail. Needs `npm run dev` on :3000 and
Chrome on :9222 (`lib.cjs` connects over CDP with `puppeteer-core`). If every check fails
to connect with an HTTP 404, another Chrome holds `127.0.0.1:9222`; point the harness at
the debugging one with `SPARK_CDP_URL=http://[::1]:9222`. The checks:

| Script | Checks |
| --- | --- |
| `37-icon-audit.cjs` | every icon's ligature actually forms, on all five surfaces |
| `44-font-audit-all.cjs` | each class's computed font against its measured Gemini value |
| `81-verify-variation.cjs` | the width axis on all five routes, and that it has not leaked into Chat |
| `22-willow-qa.cjs` | home-page geometry, hover endpoints and declared motion (23 assertions) |
| `52-verify-scroll.cjs` | the task list scrolls with a fixed header |
| `59-verify-dialogs.cjs` | rename / delete dialog surface and buttons |
| `57-verify-skill-card.cjs` | the Skills active card's container/row inversion |
| `76-skill-row.cjs` | the skill row's 642→586 hover reflow, and that card + actions fill the row |
| `72-skills-diff.cjs` | the Recommended list and both hover endpoints |
| `86-tasks-rhythm.cjs` | heading, composer and filter trigger land on Gemini's y positions |
| `90-task-row-diff.cjs` | the task row's surface, corners, spacing and painted title weight |
| `94-verify-badges.cjs` | the home page's "What's new" chip and Beta label |
| `95-schedule-row.cjs` | the schedule list's container/row split and its "9:00 am" labels |
| `106-verify-row-tint.cjs` | that the glow's stacking context is the page root, so the row fill darkens it |
| `110-composer-parity.cjs` | Spark's composers have no live control; Chat's keeps its pill and placeholder |
| `116-followup-composer.cjs` | the follow-up composer's placement, elevation and disabled lock |
| `117-detail-composers.cjs` | both task-detail composers render as one 65.6px pill, not stretched |
| `118-focus-ring.cjs` | no composer paints a focus rectangle Chat's own composer would not |

Diff tools, for when something looks off but you cannot say what. The general one is
`H.probe()` + `H.compare()` in `lib.cjs`: name the same logical element on each side and
it prints only the properties that differ, filtering the noise from Willow's reset
(`border: 0 solid #e5e7eb`, `box-sizing: border-box`) and from the two engines' different
serialisations. `71-apps-diff.cjs` and `72-skills-diff.cjs` are worked examples.

Older single-purpose tools: `21-compare-ladder.cjs` (home page, numeric),
`39-compare-detail.cjs` (task detail), `54-compare-apps.cjs` (Connected apps),
`53-height-chain.cjs` (where a flex height constraint is lost), `38-glyph-probe.cjs`
(which font holds a glyph), and `50-deep.cjs <url> <selector> <name> [clickText]` for an
arbitrary deep dump of Gemini.

Two harness notes worth knowing before you write another one:

- **A full-page screenshot of Willow renders a phantom rounded box** near the bottom of
  the scroll area. It is a stitching artefact — hit-testing that point finds only the page
  background. Two passes were spent chasing it. Capture at viewport size when judging.
- **Forced `:hover` reads the element you force it on.** Where Willow splits a row that
  Gemini keeps whole, force the state on the element that owns the selector and read the
  one that takes the fill; `72-skills-diff.cjs` takes both selectors for this reason.
- **Always collapse transitions before reading a hover endpoint.** They do not advance
  while the host Chrome window is unfocused, so the computed style comes back as the
  *start* colour — which will quietly satisfy any check written as "did it change?".
  `addStyleTag` with `transition-duration: 0s !important` first, then assert the value.
- **For geometry, use `animation: none`, not `animation-duration: 0s`.** Same root cause,
  worse symptom: a frozen entrance animation holds its element at the from-state
  indefinitely, so retrying and "wait until two samples agree" both confirm the wrong
  number. Gemini's task-list heading sat at `opacity: 0, translateY(52px)` and reported
  y=108, overlapping its own composer at y=135, stable across every sample. Zeroing the
  duration keeps the `both` fill applied; `animation: none` drops it and returns the element
  to its settled layout position.
- **Do not automate pixel sampling.** An unfocused window stops compositing, and
  `captureScreenshot` then serves a stale surface — not an error, a plausible wrong colour.
  Nothing detects it from inside: retries, warm-up captures and requiring consecutive reads
  to agree all pass on stale data, because a stale surface is stable. Assert the cascade
  instead and keep the pixel script for hand-running. `H.decodePng` and `H.primePaint` are
  still there for that.
- **Never `await` a `requestAnimationFrame` inside the page.** rAF does not fire while the
  window is unfocused, so the promise never settles and the call blocks until the protocol
  timeout. This is the same root cause as the frozen transitions and animations above, and
  it is easy to reintroduce while trying to fix one of them.
- **`connect()` sets a 90s `protocolTimeout` deliberately.** It was `0` — meaning never —
  and one killed run left an orphaned tab whose renderer was wedged, so the next check sat
  on a single CDP call for 28 minutes rather than failing. If a script hangs, check for
  stray `localhost:3000` tabs first: `findOrOpen` takes the first URL match, and Willow
  serves every app from one origin, so a left-open `/media` tab is enough to make the
  harness drive the wrong surface.
- **`gotoWillowSpark` waits for the destination page root, not for the click.** Entering
  Spark from Chat renders the sidebar rail a beat before the route is interactive, so a
  click can be dispatched at a button with no handler yet and report success while nothing
  happened. It also cannot key on `[class*="spark-"]`, which matches the rail's own
  `group/spark-item`. `113-nav-selftest.cjs` drives all five routes from a cold Chat start.
- **Seed fixtures through the store, not the editor.** Both editors span two panels and
  re-render their fields, and typing into them left one harness hung for seven minutes.
  `H.seedWillowSkill()` drives the UI because a skill needs only a name; `95-schedule-row.cjs`
  writes `state.schedules` into every `willow:spark:v*` key instead. Match the stored
  shapes exactly — `frequency` is `'Weekly'`, capitalised, and the card's weekday clause is
  gated on that exact string.

**These checks drive one shared live browser**, so a check can occasionally read a
state left settling by the previous one. `verify-all.cjs` retries each check once for
that reason; a check that fails twice is a real regression.

### Icon ligature failures, and how to find them

`MaterialSymbol` puts the glyph **name** in the element's text content and relies on
the icon font forming a ligature. If the chosen font has no such glyph, the raw name
paints instead, clipped to the icon box — so it looks like a small broken glyph
rather than a missing one. Two real instances:

- `edit_rectangle` and `edit_note` on the Schedules/Skills action buttons were routed
  to Material Symbols Rounded by an `icon.startsWith('edit_')` heuristic. Neither
  glyph exists there. `edit_rectangle` painted as "ec".
- `toggle_on` on the sidebar's collapsed Chat/Spark switch. Willow's **Luminous
  Symbols subset has `toggle_off` but not `toggle_on`**, so the ligature failed in
  exactly one state — the Spark one — and rendered as a stray "L". Probed advance at
  20px: Luminous 180px vs Google Symbols 20px. Fixed in `Sidebar.tsx` by drawing
  `toggle_off` for both states and rotating it 180° — **not** by switching font, since
  Google Symbols draws that capsule on its side where Gemini's is upright.
- `monitor` (the side-panel toggle) is absent from Luminous; Google Symbols has it.
- **`language` and `web_asset` exist in none of Willow's three fonts.** The
  computer-use panel used both. Replaced with `public` and `tab`, which resolve in
  Google Symbols. These only surfaced once the panel was moved into the side pane and
  actually mounted — an icon that never renders is never caught.

**Which font holds a glyph is per-glyph and not derivable from its name.** Probe
before choosing: render the name in a hidden span in the candidate font and compare
the advance width against the font size. A formed ligature is about one em; a failed
one is many. `tools/ui-research/scrapers/spark/37-icon-audit.cjs` sweeps every Spark
surface this way and `38-glyph-probe.cjs` tests candidate names across the three
fonts. Run the audit after touching any icon.

### The `font: inherit` specificity trap

`SparkTaskDetail.css` opens with:

```css
.spark-task-detail button,
.spark-task-detail textarea,
.spark-task-detail input { font: inherit; letter-spacing: 0 }
```

That selector is **0,0,1,1** (one class + one type), so it beats any single-class rule
(0,0,1,0) *regardless of source order* — and because `font` is a shorthand, it resets
`font-size` and `line-height` back to the inherited 16px/24px. Three rules in that
file were silently losing their typography to it, including
`.spark-task-detail__status-pill`, which had been rendering at 16px rather than the
13px it asks for since before this work started.

The fix is to scope the rule with two classes:
`.spark-task-detail .spark-task-detail__status-pill`. **When you set a font size on a
button, textarea or input inside a scope that carries this reset, check the computed
value** — the stylesheet will look correct and render wrong.
`tools/ui-research/scrapers/spark/44-font-audit-all.cjs` sweeps every Spark class
whose font was set against its measured Gemini value; run it after touching type.

### Google Sans Flex runs on a narrowed width axis

Gemini does not render Google Sans Flex at its default proportions. Sweeping every
text-bearing element across all five routes
(`tools/ui-research/scrapers/spark/79-variation-sweep.cjs`,
`82-axis-by-class.cjs`) turns up exactly four settings:

| Gemini type class | size/line-height | weight | `font-variation-settings` |
| --- | --- | --- | --- |
| `gds-body-*`, `gds-label-*`, `gds-emphasized-body-*` | 13–17px | 370 / 400 / 540 | `"ROND" 0, "slnt" 0, "wdth" 92, "wght" <weight>` |
| `gds-title-l`, `gds-title-l-emphasized`, `gds-headline-s` | 20px/24px | 470 | `"ROND" 20, "slnt" 0, "wdth" 94, "wght" 470` |
| `gds-emphasized-headline-l` | 28px/36px | 350 | `"ROND" 20, "slnt" 0, "wdth" 100, "wght" 350` |
| `gds-display-m` | 36px/44px | 320 | `"ROND" 100, "slnt" 0, "wdth" 100, "wght" 320` |

Body text — 173 elements at weight 400 alone — is **8% narrower than the default**.
Willow was leaving the axis at 100% everywhere, so every string ran wide: "Learn more"
measured 88.4px against Gemini's 84.2px, which also changed the shrink-to-fit width of
anything sized by its own text.

Two things make this awkward to apply:

- **`font-variation-settings` pins the weight.** Naming any axis overrides `font-weight`
  for `wght`, so a blanket `wdth: 92` would force every rule in Spark to restate its own
  weight. `font-stretch: 92%` drives the same axis, measures identically (verified in
  `80-axis-support.cjs`) and still composes with `font-weight` — so the base is set with
  `font-stretch` in `SparkWorkspace.css`, and only the four headline/title cases name
  their axes explicitly, repeating their weight as Gemini does.
- **The reset drops `font-stretch` on form controls.** It hands buttons and inputs
  `font-family`, `font-size`, `font-weight` and `font-variation-settings` from the parent
  but says nothing about `font-stretch`, so each one falls back to the UA default and
  resets the axis for its whole subtree. On the task list that silently swallowed 46
  elements, because the rows are buttons. `SparkWorkspace.css` follows the base rule with
  `font-stretch: inherit` for `button, input, select, textarea, optgroup`.

The base rule is scoped to the six Spark page roots rather than `.spark-studio-scroll`,
which the shell also applies to Media, Agents and Design.
`81-verify-variation.cjs` walks all five routes and then switches to Chat to confirm the
axis has not leaked out of Spark.

### The two page headings are not the same size

`/spark` and `/spark/tasks` carry the same sentence but not the same type. Home uses
`gds-emphasized-headline-l` (28px/36px weight 350); the task list uses `gds-display-m`
(36px/44px weight 320, `padding: 0 0 8px`, no margin, 52px tall). Willow had reused the
home ramp on both, so the task list read a full size small.

### The Connected apps opt-in switch

Measured off Gemini's Material switch, whose colours live on pseudo-elements —
`.mdc-switch__track` itself is transparent, with `::before` painting the unselected
track and `::after` the selected one, cross-faded on opacity:

| | track | handle |
| --- | --- | --- |
| off | #444746, with a 2px #8e918f ring | 16×16 in #8e918f |
| on | #a8c7fa, no ring | 24×24 in #062e6f |

Track is 52×32 and fully rounded, and **the handle grows** from 16px to 24px when
switched on.

The off track is filled grey **and** ringed. Read the history in order or the two
halves look contradictory: Willow first drew the ring with nothing behind it, and the
fill was added to correct that — but the ring itself does belong there, and the
settings page's copy of this switch (`.ca-switch-track` in `ConnectedAppsTab.css`) had
always drawn it, which is how the two surfaces came to disagree. Switched on, the blue
fill is the whole affordance and the ring is dropped.

The ring is an `inset` box-shadow, not a `border`: the thumb is absolutely positioned
against the padding box, so a real border would shift it 2px up and left under the
page-wide `box-sizing: border-box`.

There is **no caption beside it.** `.opt-in-container` holds the 32px logo and a bare
`mat-slide-toggle` pushed right. Willow rendered a "Use as context" label from an
unstyled wrapper that had no CSS at all; the switch's accessible name carries that now.

### The category chips, and where a Material outline hides

Three things about `mat-chip-row.category-shortcut` are easy to get wrong:

- **The host reports `border: 0px none`, yet the chip clearly has an outline.** MDC paints
  it on `.mdc-evolution-chip__action::before`, absolutely inset at `z-index: 1` — so it
  costs no layout and the 14px/20px weight-500 #c4c7c5 label still sits exactly 12px from
  the chip edge. Willow's 1px border on the host pushed the label in.
- **The hover is on a real child, not a pseudo-element.** `.mat-mdc-chip-focus-overlay` is
  a #c4c7c5 span at opacity 0 / hover .08 / focus .12 on `opacity 0.15s linear`. A sweep
  that reads the host plus `::before`/`::after` reports the chip as inert, which is how
  the outline came to be removed before it was put back.
- **Clicking leaves no selected style** — only the retained focus layer at .12. The chips
  are scroll shortcuts.

The parent and child cards on that page really are inert on hover, host and pseudo-
elements both.

### State layers: two shapes of the same 8%

Gemini's hover is `#e6e6e6` at 8%, but it lands two different ways depending on what is
behind the element, and copying the wrong one is visible:

- `.recommendation-card:hover` **replaces** its `#171717` fill with the bare
  `rgba(230,230,230,.08)`, so the page shows through and the result is lighter.
- `skill-card:hover` **mixes** the layer into its opaque surface —
  `color-mix(in srgb, #e6e6e6 8%, #1f1f1f)`, which Chrome reports as
  `color(srgb 0.183059 …)` — because the row is clipped by its container rather than
  transparent.

Both are `transition: background 0.15s`.

### Two component surfaces that were inverted

- **The Active-skill list.** Gemini outlines the container and fills the rows:
  `.skills-list` is transparent with a 1px #171717 border at 16px corners, and each
  `skill-card` inside is #1f1f1f with **no radius of its own**, `padding: 16px`,
  `gap: 16px`. The container clips them, so it needs `overflow: hidden`. Willow had it
  the other way round — a filled row wrapping a transparent card.
- **The thread's processing state.** Willow surfaced thinking steps through the
  response overflow menu into a slide-out panel; Gemini shows them inline above the
  response as `remy-processing-state` — a 32px pill trigger (`padding: 0 8px`, gap 8px,
  label gds-body-s in on-surface-variant, `expand_more` chevron at 20px weight 320,
  and `cursor: default`) that expands into the earlier steps plus one tool block per
  capability. `SparkProcessingState` in `SparkTaskDetail.tsx` is that row; the
  slide-out panel remains for the full timeline.

### A run of same-label tool rows collapses to one

`groupSparkActivity` drops a tool entry whose `getTimelineToolLabel` matches the
row before it, and `groupSparkSubagentTimeline` does the same for a sub-agent's
timeline. A model firing three `google_search` calls to assemble one answer drew
three "Google Search" rows; it now draws one.

**Adjacency is the whole test, and it is already the right one.** Narration
entries are the model's own work-log lines, and `SparkWorkspace` appends both
them and tool rows to `activityLog` in stream order — so a search that follows a
line the model wrote is not adjacent to the previous search and keeps its own
row. Only an uninterrupted run collapses. Nothing needs to track text offsets.

This generalises the rule it replaced, which collapsed consecutive *file* tools.
Every file tool renders as "Files", so that was already a same-label case and
comparing the label covers it too. Two consequences worth knowing:

- **It is presentational only.** `activityLog` still holds every call, and the
  harness still emits one `call-start` per provider tool call — the dedup in
  `platform/ai` is a different thing, and suppresses a *repeated delta for one
  search step* rather than a second real search. Don't "fix" the duplicate rows
  upstream in `publishUsedTool`; that would throw the calls away.
- **The entry kept is the first**, which is what the file rule did, so the icon a
  collapsed run shows is the first call's.

### Sending a follow-up anchors it and holds its response area open

A follow-up used to be appended and the thread scrolled to `scrollHeight`, so the
new prompt landed jammed against the composer with the reply growing off the
bottom edge. It now behaves like Chat: the prompt travels to near the top of the
pane and the rest of the visible pane is held open beneath it, so the reply
arrives into a settled area and the thread only grows once the reply is genuinely
taller than the space it was given.

The shape is Chat's — anchor, reserve, release — but **none of Chat's numbers
transfer**, and two structural differences change the arithmetic:

- **`SPARK_ANCHOR_OFFSET` is 48, not Chat's 72.** 72 is Chat's own thread top
  padding. Spark's scroller pads `35px`, but 35 is unusable: the scroller carries
  a scroll-edge mask that ramps transparent→opaque over `--fade-distance` (48px)
  the moment `scrollTop > 0`, and anchoring *is* a scroll, so a prompt parked at
  35 would settle with its top third dissolved into the fade. 48 is the first
  offset that clears the ramp. If either the padding or `--fade-distance` moves,
  this is the max of the two.
- **The composer's height must be subtracted explicitly.** Chat's composer is a
  flex sibling, so its scroller's `clientHeight` already excludes it. Spark docks
  the composer as an absolute overlay and makes room with
  `padding-bottom: var(--spark-followup-inset)`, so `clientHeight` still counts
  the strip the composer covers. `measureAnchorReserve` reads the scroller's
  computed `paddingBottom` for exactly this. Miss it and every reply gets ~160px
  of dead space under it.

**The reserve is `min-height` on the turn, and it has to be.** A sibling spacer
sized `reserve − turnHeight` was tried first and looks equivalent — the totals
match, and a growth sweep shows `scrollHeight` holding steady until the reply
exceeds the reserve. It is not equivalent, because a spacer has to be *measured*
back into shape: ResizeObserver → state → render. Collapsing the processing steps
shrinks the turn in CSS immediately while the spacer is still sized for the tall
version, so the thread's total height **dips for a frame** — and since anchoring
leaves `scrollTop` exactly at its maximum, that dip makes the browser clamp it.
The spacer then returns but the clamp does not, so the whole thread ends up
permanently lower. Expanding never showed it: that transient *grows* the thread,
and growth cannot clamp.

`min-height` floors the box in the same layout pass with no JS in the loop, so
there is no frame for a dip to happen in. Verified by sampling `scrollTop` across
an expand/collapse cycle: `213,213,213,213,213,213`, with the turn flooring back
to the reserve exactly. It also removes the need to detect the release at all —
once the reply is taller than the floor the declaration is simply inert, which is
why there is no `needsScrollPadding` equivalent here.

Only the newest turn carries the floor. When the anchor moves, the old turn's
`min-height` is dropped and the new one's applied inside the same `flushSync`, so
the two changes land atomically and the glide's target is measured after.

**Scrolling alone is not the animation.** `scrollTo({ behavior: 'smooth' })` is
enough only when the previous reply was long enough to push the new prompt below
the fold. When it was short — the common case, since its own reserve was still
holding space open — the new prompt is laid out directly beneath it and so
*enters* partway up the pane, around y≈274 in a 650px pane. Scrolling then
carries it only that short remaining distance, and it reads as the message
materialising where the last response ended and jumping, rather than rising from
where it was typed.

So `runFollowUpEntrance` offsets the entering row and article down to the
composer's edge and animates that offset out on the **same eased clock** that
drives the scroll. One clock for both is the point: a CSS transition plus a
native smooth scroll are two durations and two curves, and the seam shows as a
rate change mid-flight. Measured at 40ms intervals, the prompt now travels
`488 → 482 → 301 → 179 → 104 → 74 → 52 → 48`, starting exactly at
`clientHeight − composerInset`. The branch is `entranceOffset <= 8`, which sends
the below-the-fold case to a plain smooth scroll — verified separately as
`974 → 793 → 453 → 208 → 87 → 50 → 48`. This mirrors Chat's `runTurnEntrance`,
which exists for the identical case.

Three things that will bite if changed:

- **The glide's `scrollTop` writes are monotonic**, and its listeners abandon it
  on the first wheel/touch/keydown. A reserve collapsing mid-flight must never
  rewind the scroll, and a user who starts scrolling is not argued with.
- **Anchor scrolling is measured off `getBoundingClientRect`, not `offsetTop`.**
  The thread column carries `transform: translateX(14px)` and the nearest
  positioned ancestor is `.spark-task-detail__panel`, not the scroller — so
  `offsetTop` is not relative to the thing being scrolled.
- **An opened task restores its anchor, instantly.** "Lands, does not travel"
  means *no animation* — not "goes to the bottom". Chat writes `scrollTop`
  straight to the anchor on chat open, and Spark now does the same: the reserve
  is recomputed and the last prompt is put back at `SPARK_ANCHOR_OFFSET` with no
  glide. Without this the reserve, being React state, was dropped on every
  reload and the gap the user had just been looking at disappeared. The newest
  turn is still recorded as already handled, so reopening never replays an
  animation the user did not trigger.
  The restore scroll is issued from the sync effect, not the open branch, because
  the spacer has to exist before there is any range to scroll into — both run in
  the same layout phase, so nothing paints in between.
  A task with no follow-ups has nothing to anchor and still lands at the end,
  re-asserting for two frames because streamed markdown, the action row and file
  cards each grow `scrollHeight` after the first write, which otherwise left an
  open ~17px short.
- **The spacer changes `scrollHeight`, so the fade vars must be recomputed with
  it.** `updateScrollFade` is called from the reserve's own observer for this
  reason; without it the bottom fade goes stale as the reserve collapses.

Only follow-ups are anchored. The root exchange already renders its prompt at the
top of an unscrolled thread, so it needs none of this.

### The accents are the workspace colour, not Gemini's blue

Spark was transcribed from Gemini, so its accents arrived as Gemini's literal
blues. Three of them are now driven by the user's workspace colour through
`src/spark-accent.ts`:

| Variable | Theme token | Drives |
| --- | --- | --- |
| `--spark-accent` | `sendButton.bg` | `.spark-page-action--primary`, `.spark-suggested-indicator` at rest |
| `--spark-accent-hover` | `sendButton.hover` | that button's hover |
| `--spark-accent-bright` | `creamy.hex` | the indicator on hover, the working-spark glyph |

Each maps to the token that already plays that role elsewhere in the app, so a
green workspace gets Spark's buttons in the same green as the composer's send
button rather than an independently invented green.

Every other Gemini blue in Spark's stylesheets (the `#a8c7fa` / `#062e6f` pills, focus
rings, state layers, the light theme's `#0b57d0` family, Bots, Spaces and Pets) reads
through the app-wide `var(--sync-<hex>, <blue>)` from `@willow/core/workspace-sync`; see
`platform/core/AGENTS.md`. A new blue goes in the same way, or
`apps/studio/test/workspace-sync.test.mjs` fails on it.

A bot's profile wears the bot's colour instead (`dots/dot-tint.ts`): its pet's when it has one
(sampled from each bundled spritesheet's idle frame), else its character's body colour, custom or
preset, through the orbit catalog's tints. `DotProfile` sets the matching `--sync-*` on a
`display: contents` wrapper, so its selected category and its computer's wallpaper follow the bot.
Blue bots, grey rings and near-monochrome pets get Gemini's blues. The Bots page declares
`useSparkAccentVars()` like every other Spark page, so "New bot" follows the workspace.

Two things to know before touching this:

- **Every stylesheet reads them as `var(--spark-accent, #1f3b9b)`**, keeping
  Gemini's measured value as the fallback. An unthemed render is therefore
  byte-identical to what the scrapers in `tools/ui-research/scrapers/spark/` were
  written against — verified: with no variable set the button still computes
  `rgb(31,59,155)`, the indicator `rgb(31,59,155)` and the glyph `rgb(49,134,255)`.
  **Do not "simplify" these back to literals**, and do not drop the fallbacks.
- **The working spark's colour is in its asset, not its CSS.**
  `gemini-working-animation/template.svg` and `frames.json` now say `currentColor`
  where they said `rgb(49,134,255)`, and `.spark-task-detail__agent-working-animation`
  sets `color`. That worked because the asset carried exactly one colour across
  the template and all frames — the loop animates `fill-opacity` and transforms,
  never hue. Re-exporting the animation from Gemini will reintroduce the literal.

`SparkWorkspace` returns Home, Schedules, Skills and Apps **without**
`wrapConnectedPage`, so there is no single themed host over all of Spark and each
page root declares the variables itself. The rest of Spark's blues — the
`#a8c7fa` focus rings, `#192967` status pills, and the editors' primary buttons —
are still literal.

### Measured values worth not "correcting"

The home page reproduces these; each was read off the live app, not designed.

- **Layout is flex + auto margins, not a calc().** `.new-task-container` is
  `flex:1` with `gap:2rem` and `padding-block-start:2.5rem`; `.page-header` takes
  `margin-block-start:auto` and the last child `margin-block-end:auto`, so the
  stack floats in the leftover height. Below `max-height:800px` the header drops
  the auto margin for `padding-block-start:3.5rem`.
- **The composer carries `margin-block:-6px`**, which is why the gap under it
  measures 26px against the container's 32px.
- **The glow settles at `translate(-50%,-45%)`, not -50%.** `lm-background-grow`
  ends on -45% and is `both`-filled, so the fill wins. Blur is 100px: the
  dark-theme rule beats the later `blur(4rem)` on specificity.
- **The task row's timestamp is #e3e3e3.** It asks for
  `--bard-color-lm-on-surface-variant`, which this theme never defines, so the
  declaration drops and the card's own colour shows through.
- **The `-8px` pull on the action menu only applies when a status pill is
  present** — Gemini scopes it with
  `remy-status-pill.status-pill-hidden + remy-goal-action-menu { margin-inline-start: 0 }`.
- **"All tasks" has no hover feedback at all.** `.all-tasks-link:hover` sets a
  colour, but Material's button sets `#c4c7c5` on itself and the label inherits
  that in both states. Verified with `forcePseudoState`. There is no hover
  background either.
- **The suggestion card's hover snaps.** It computes `transition: all` with a 0s
  duration, so background and shadow change instantly while only the 3px
  indicator eases, over 100ms. Frame-recorded.
- **Relative times are `Intl.RelativeTimeFormat` at `style:'short'` under a
  locale that drops the full stop** — "2 wk ago", not "2 wk. ago" (en-US) and not
  "2 weeks ago". `spark-types.ts` pins `en-GB` deliberately.
- **Delete is not a danger-coloured button.** Both dialog buttons are the same
  neutral `#171717` pill.

### Menus all share one surface

Every Spark menu is a `mat-menu` on Gemini's `lm-menu-theme`, so they share a surface:
#1f1f1f, 8px padding, **no border**, level1 elevation `0 0 20px 0 rgba(0,0,0,.28)`, and
Material's `_mat-menu-enter` — 120ms on cubic-bezier(0,0,.2,1) from `scale(0.8)`. Rows
are 36px tall at a **12px** radius with `padding: 0 8px`, an 8px gap, and a 14px/20px
weight-500 label in #e3e3e3.

Per-menu overrides:

| Menu | Override |
| --- | --- |
| goal action (Rename / Pin / Delete) | `min-width: 240px`, `max-width: 280px`, 16px radius, origin top-right |
| task-list filter | `min-width: max-content`, **20px** radius, `overflow: hidden`, rows get `padding-inline-end: 2rem` |

Measured: the filter panel is 170.4×196 with 36px rows. Willow's now matches exactly.

**Beware the entry animation when measuring.** `scale(0.8)` plus a frozen animation
timeline (any unfocused Chrome window) makes every dimension come back at 0.8× — the
filter panel read 136.3×156.8 with 28.8px rows, which looks like a sizing bug and is
not one. Inject `animation-duration: 0s` before measuring, as
`58-filter-menu.cjs` does.

### The status pill

`remy-status-pill` has its own component sheet (host `ng-c894856390`), captured in
`tools/ui-research/captures/spark/27-detail/css/044.css`. Two surfaces:
`status-blocked` (#192967 on #3186ff) and `status-failed` (#3c0202 on #ff4c45),
17px tall plus 2px block padding, 12px inline padding, gap 4px, 11px text, pill
radius, `transition: background-color 100ms` on the standard curve.

**Not yet built: the running-task pulse.** A `.pulse-mode` pill drops its
background and padding entirely and renders a 6px `.pulse-dot` instead, running
`dot-pulse-fade 2s ease-out infinite`:

```css
@keyframes dot-pulse-fade {
  0%   { background-color: <accent-fixed @ .75>;
         box-shadow: 0 0 0 0 <accent-fixed @ .5>, 0 0 0 0 <accent-fixed @ .28> }
  80%  { background-color: #192967;
         box-shadow: 0 0 6px 5px transparent, 0 0 14px 8px transparent }
  100% { background-color: #192967; box-shadow: 0 0 0 0 transparent }
}
```

`accent-fixed` is #3186ff. `.pulse-dot.complete` stops the animation and goes solid
#3186ff. Under `@media (hover:hover)` the host becomes a 36×36 box so the bot sits
where the action menu would. There is also a `.status-pill.dot` variant whose label
collapses to `max-width: 0` and reveals on hover, with the bot pinned at
`inset-inline-end: 8px`.

## The task detail route

`/spark/chat/<id>` is a two-pane shell. Willow's structure already matched Gemini's
closely; the **chrome** has now been matched too. Captures are in
`tools/ui-research/captures/spark/27-detail/`, `28-shell/`, `30-panes/` and
`31-composer/`.

### The split view has two states, and the default is not the collapsed one

`.split-pane-container` carries `split-view` always and `expanded-view` when the
chat is maximised:

| State | Left task pane | Chat pane | Side panel |
| --- | --- | --- | --- |
| `split-view` (default) | 616px | 285px, radius 28px | 567px |
| `split-view expanded-view` | absent | full width, radius 0 | absent |

Measured at 1536×826. Willow's 616px left pane, `8px 8px 8px 0` right-pane padding,
28px panel radius and #1f1f1f panel surface all already matched the default state.
An early reading of this route mistook `expanded-view` for the default and concluded
the task pane collapses to 8px on open — it does not.

### Chrome values, measured

- `.split-pane-button` — a **bare 6×52 pill** in #171717, fully rounded, centred in a
  28px wrapper. No border, no shadow, no glyph, and always visible rather than
  hover-revealed.
- `.beta-badge` — 48×25.6, fully rounded, `padding: 0 8px`, 1px
  rgba(255,255,255,.12) hairline, 13px #e6e6e6.
- `.remy-plan-pill` (the status pill) — 76×22.7, **#171717**, fully rounded,
  `padding: 4px 12px`, label 13px #e6e6e6. Willow's keeps a status glyph and chevron
  because it opens a progress popover, so it is 24px rather than 22.7px.
- `.chat-thread-title` — gds-body-s, i.e. **13px/17px**, #e6e6e6. Not a large heading.
- The header overflow trigger is the same **36px** button the task rows use.
- `.spark-task-detail__panel`'s `border: 1px solid #171717` is correct — Gemini's
  chat pane measures `border: 0.8px solid rgb(23,23,23)`.

### The composer is separated by elevation, not by colour

Gemini's task-detail composer is **#1e1f20 on a #1f1f1f panel** — near-identical
colours. What makes it read as a distinct surface is the level1 elevation on the
composer itself, `box-shadow: 0 0 20px 0 rgba(0,0,0,.28)` (its class list says
`input-box-shadow`). Willow had `0 1px 2px rgba(0,0,0,.12)`, too tight to see, which
made the composer look like it had no boundary at all. Do not "fix" this by
lightening the composer's background.

The disclaimer under it is `p.gds-body-s`: **13px/17px weight 400 in #c4c7c5**,
centred — not the 11px rgba(255,255,255,.46) it was.

### The confirmation card

`remy-confirmation-card` is the browser-permission card, and Willow's
`.spark-task-detail__approval-card` already matched most of it: #171717, 28px
corners, 24px padding, a gds-body-l (17px/24px, #e6e6e6) heading and a gds-body-s
(13px/17px) body. Corrected against measurement: the body is
rgba(255,255,255,**.55**), its bullets **wrap** (Gemini's first item is 51px = three
lines; `white-space: nowrap` was overflowing the 338px body), each `li` takes
`margin: 8px 0`, and "Review the plan:" is **weight 400**, not bold, with a 12.5px
gap under it.

Both action buttons are 48px tall, fully rounded, `padding: 0 16px`, label 14px/24px
weight 500 — which Willow already matched. **The enabled appearance is unverified**:
the reference task's approval was already answered, so both buttons measured in
their disabled state (transparent background, rgba(230,230,230,.38) label). Willow's
filled blue primary was left alone rather than changed on a guess. They are Material
`mdc-button--unelevated`, so enabled they will be filled.

Gemini also has a `mat-mdc-select.action-choice-select` reading "Remote browser"
(183×48, pill, `padding: 0 12px 0 16px`, gap 8px) that picks the action target.
`SparkBrowserPermissionCard` has it too. The card and what follows from it are under
*The remote browser*.

### The remote-browser pane is a second pane, not a thread block

Willow used to render `SparkComputerUsePanel` inline in the conversation. Gemini's is
a sibling card beside the chat pane, so `.spark-task-detail__workspace` is now a flex
row with an 8px gutter holding `.spark-task-detail__panel` and
`.spark-task-detail__side-panel`, at `flex: 1` and `flex: 2`.

That ratio is measured: Gemini's split view is 285.1 and 567.1 against an 868px pane,
i.e. the chat takes 33.5%. Willow measures 264.4 / 527.1 — 33.4%. Both cards are
#1f1f1f at 28px corners with a 1px #171717 border. Below 980px they stack instead.

The header's `monitor` button opens a one-item menu, "View remote browser". It appears
once the task's browser has opened (`hasOpenedRemoteBrowser`) and hides while the pane
shows. At 960px and below the pane opens full-screen instead — see *The remote browser*.

### `/spark/tasks` scrolls the list, not the page

Gemini's `.goal-list` is the scroll container — `overflow-y: auto`, `flex: 1 1 0`,
`min-height: 0`, `padding: 16px 8px 16px 0`, gap 4px, a thin scrollbar in
rgba(196,199,197,.4) on a transparent track — so the title, composer and filter row
stay put while the tasks move under them. Willow scrolled the whole page.

**The fade mask is static.** It is authored as
`linear-gradient(to bottom, transparent 0, #000 calc(var(--fade-progress)*var(--fade-distance)), #000 calc(100% - var(--fade-bottom)*var(--fade-distance)), transparent 100%)`
with `--fade-distance: calc(16px*3)`, which looks scroll-driven — but sampling the two
variables at five scroll positions (top, quarter, half, near-bottom, bottom) found
`--fade-progress` pinned at 0 and `--fade-bottom` at 1 throughout. So there is no top
fade and the bottom 48px fade never lifts, even at the end of the list. Reproduced as a
plain static gradient rather than a scroll handler.

**The flex chain has to be unbroken.** `.spark-all-tasks__library` sat between the
content column and the list as `display: block`, so the list's `flex: 1 1 0` had no flex
parent and grew to its content instead — scroll container and mask both inert. Every
ancestor from `.spark-all-tasks` down needs `display: flex`, `flex-direction: column`
and `min-height: 0`. `tools/ui-research/scrapers/spark/53-height-chain.cjs` walks that
chain and prints where the constraint is lost.

### The row tint depends on the glow being *behind* the rows

The Recent rows and the task-list rows are filled `rgba(15,15,15,.5)` — 50% of the page
colour over itself. That is a no-op against a plain #0f0f0f page: it changes **not one
pixel**. The rounded darker rectangle only appears because the fill darkens the composer
glow behind it. Two separate bugs had defeated that, and neither was visible in any
computed style — both surfaces reported exactly the right `background-color`:

- **`.spark-composer-anchor` created a stacking context** (`z-index: 1; isolation: isolate`).
  Gemini's `.input-glow-anchor` is `z-index: auto; isolation: auto` and creates none, which
  is what lets its `z-index: -1` glow resolve against the page and paint *under* the rows.
  Willow's lifted the glow into a context that outranked them, so it painted *over* instead.
- **`.spark-all-tasks` was not a stacking context at all.** A negative z-index paints above
  its stacking context's background but below everything static in it — so with no context
  here, the glow resolved against `main.z-10` and was painted *underneath* this element's own
  opaque #0f0f0f fill. It rendered nothing whatsoever. `container-type: inline-size` does not
  create a stacking context (Chrome reports `contain: none`), which is why `.spark-home`
  carries an explicit `isolation: isolate` and this now does too.

Both faults are the same invariant: **walking up from the glow, the first stacking context
must be the page root that owns the opaque background.** One step lower and the glow is
buried under that background; one step higher and it covers the content. **Any of
`z-index`, `isolation`, `opacity < 1`, `transform` or `filter` on the composer anchor
reintroduces the first fault, and removing `isolation` from either page root reintroduces
the second.** `106-verify-row-tint.cjs` walks that chain and pins it.

**It used to sample rendered pixels, and that had to be abandoned.** Screenshotting a row,
removing only its fill and screenshotting again is the more direct test — it is how both
faults were originally found — but it cannot be automated here. An unfocused Chrome window
stops producing frames, so `captureScreenshot` returns a stale surface whose contents are a
plausible colour rather than an error; two captures then agree and the check reports a
confident zero. Retrying, discarding a warm-up capture, and requiring two consecutive reads
to agree were all tried, and none works: **a stale surface is stable, so agreement proves
nothing.** `97-tint-isolate.cjs` still does the pixel measurement — run it by hand with the
window focused.

### The task-list rhythm, measured top to bottom

Every landmark on `/spark/tasks`, against Gemini
(`tools/ui-research/scrapers/spark/86-tasks-rhythm.cjs` asserts the three that Gemini
exposes a stable selector for):

| Landmark | Gemini | What Willow had |
| --- | --- | --- |
| column padding | `56px 0 0` | `40px 0 48px` — the whole page started 16px high |
| heading | `gds-display-m`, top 56, 52 tall | 28px headline, top 40 |
| composer pill | top 135, **580x65.6**, inset 40px each side of the 660 column, `0 0 20px rgba(0,0,0,.28)` | full 660 wide, tight `0 1px 3px` shadow |
| filter trigger | top 226, **113.1x32** | top 231, 88.6x32 |
| row | 636.8x64, 16px corners, rgba(15,15,15,.5), 4px apart | matched |

The filter trigger is worth spelling out because three values were off at once:
`padding: 0 16px`, an 8px content gap, a label of `gds-title-m-emphasized` (15px/20px
weight **540**) and a **24px** Luminous chevron — 16 + 49.1 + 8 + 24 + 16 = 113.1. Willow
had the right label size at weight 500, half the padding and half the gap.

### `font-weight: 600` on the task title is inert

`.goal-description.gds-emphasized-body-m` computes `font-weight: 600`, a value that
appears nowhere else in Gemini's scale. It never paints: the class also names
`"wght" 540` in `font-variation-settings`, and a named axis beats the declaration.
Rendering "Creating a schedule" at each candidate settles it — the live box is 139.6px,
which is exactly weight 540 (600 would be 141.95). Willow had the title at the plain 400,
so every task title ran light.

The lesson generalises: **when a Gemini element declares a weight outside
350/370/400/470/540, check `font-variation-settings` before copying it.**
`92-goal-title-weight.cjs` does the measurement; `probe()` in `lib.cjs` records the
painted weight as `_wght` so the paired diffs compare that rather than the declaration.

### Row action menus stay out of flow until hover

`.skill-card-actions` is `display: none` at rest and `flex` on hover, so the card spans
the full 674px and its content reflows from 642 to 586 — 40px of button plus a 16px
gutter. Willow rendered the menu permanently, which left the card 50px short and put a
button on every row at once. The same applies to the schedule rows.

Willow has to split the row from the card, because the row and its menu are both
clickable and a button cannot nest inside a button. That means **the row, not the card,
carries `:hover`** — otherwise the fill drops away the moment the pointer crosses onto the
button it just revealed. `76-skill-row.cjs` checks the reflow and that the two halves
still add up to Gemini's row width.

### Section labels vs empty-state titles

`.spark-schedules-section > h2` is scoped to **direct children** deliberately. The
empty-state card nested inside that section has its own `h2`, and a descendant
selector outranked `.spark-schedules-empty__title` (0,0,1,1 beats 0,0,1,0) and
restyled the card's 20px/470 title as a 15px/540 section label.

Gemini's Schedules empty state is `.empty-state`: an **outlined** card, transparent
with a 1px rgba(255,255,255,.12) border at 28px corners, `padding: 136px 0`,
`margin: 36px 0 0`, holding only a centred title (gds-headline-s, 20px/24px weight
470, on-surface-variant) and subtitle (gds-body-s). No icon and no fill. Gemini also
hides the section label entirely while the list is empty.

**The populated schedule row is the one thing here that was never measurable** — the
reference account has no schedules, so Gemini never renders it. It now follows the pattern
the Active-skill list and the task rows both prove: one outlined #171717 container clipping
filled #1f1f1f rows, hover as the 8% state layer mixed into the surface, and the row menu
out of flow until the pointer arrives. Before that it was the odd surface out, a filled row
with a 10% white outline and a #252525 hover that appears nowhere in Gemini. If a schedule
ever shows up in the reference account, measure it and replace the inference.

### Measured components on this route

The processing row (`SparkProcessingState`), the header's `monitor` button and the side
panel are built. **Gemini's processing header names the phase, not the work**:
"Thinking it through…" while the turn runs and "Thoughts" once it has finished, with the
work in the rows beneath. Older Gemini turns still show the titles it used to put there
(that is what a 373px-wide trigger was measured on), but every new turn reads "Thoughts".

| Component | Sheet in `27-detail/css/` | Measured at 1536×826 |
| --- | --- | --- |
| `remy-viewer` | `040.css` | 52,0 · 1484×825.6 · transparent |
| `remy-side-panel` | `040.css` | 556,8 · 980.3×809.6 · `padding: 0 8px 0 0` |
| `remy-confirmation-card` | `065.css` | 386.1 wide |
| `remy-processing-state` | `027.css` | — |
| `remy-status-pill` | `044.css` | see above |

The sidebar collapses to a rail on this route (Willow already does this via
`sparkSidebarRestoreRef` in `apps/studio/src/app/App.tsx`).

### The Remote browser pane diverges on purpose

Gemini's right pane is `computer-use-panel` > **`vnc-viewer`**: a VNC surface onto a
cloud VM. Willow deliberately does **not** copy that: the pane shows an **iframe**,
served through a local proxy that gives every site its own origin, so the browser
agent can drive any site that loads. See *The remote browser*.

**Match Gemini's chrome around this pane, not its transport.** Do not replace the
iframe with a VNC client in the name of fidelity.

Note that Angular loads per-route sheets lazily: this route yields 98 stylesheets
against the home route's 80, so re-run the dump on the route you are working on
rather than reusing `03-css/`.

### "Create with Gemini"

Re-recorded on 2026-10-06 by using both buttons in Gemini, in Spark and in a chat
(`tools/ui-research/captures/spark/137-create-with-gemini/`). An earlier note here said
both buttons leave Spark; they do different things, and Willow now does what each does.
The texts are in `spark-create-with.ts`.

- **Schedules** opens a Spark task titled "Creating a schedule": the user's "Help me
  schedule a task." and, at once, Gemini asking what to schedule. The reply is fixed, not
  a model's (`createSeededTask` streams it in over about two seconds and then waits), and
  the task opens with the list collapsed and Progress showing (`spark-task-layout.ts`).
  The user's answer is the task's first real turn, and its `create_schedule` call saves
  the schedule (see *What a run saves*). Gemini's reply also offers to "react to specific
  updates"; Willow's schedules run on time only, so that half is left out.
- **Skills** leaves Spark for a new chat holding "Create a skill" and Gemini's question
  back, played without a model as Gemini's appears (`requestSeededChat`, carried out by
  the shell). The chat's `create_skill` saves the skill into the same library.

The **"Create manually"** editors on both pages are matched to Gemini exactly — see above.

### Known remaining differences

- Gemini has **no search input** on `/spark/tasks`; Willow's "Search tasks" is an
  addition, as are the Connected apps page's "Custom apps" segment, its
  "Use as context" toggle labels and its Google Photos notice. All kept
  deliberately.
- The `/spark/tasks` empty-state *copy* and its two font sizes are Willow's own —
  the reference account has tasks, so that state could not be observed. The card
  geometry around it is measured.

## The two editors

`/spark/schedules` and `/spark/skills` both open a "Create manually" editor. Both were
transcribed from Gemini in the pass that added them here; captures live in
`tools/ui-research/captures/spark/{47-editors,49-schedule-editor,50-deep}/`.

**Shared header.** Gemini uses one component for both: a `.back-to-schedules-btn` at
112×36 with `padding: 4px 0`, no radius and no hover surface, in #c4c7c5, holding a
28px weight-260 glyph and a gds-body-l (17px/24px) label; and a `.create-save-button`
at 90×36, fully rounded, label gds-label-m (15px/20px weight **370**). Its *inactive*
surface is rgba(230,230,230,.12) with an rgba(255,255,255,.3) label. The **enabled**
colour is unverified — the reference form was never valid — so Willow's blue stands.

**Schedule editor.** Card `.schedule-detail-card`: #1e1f20, 28px corners, 1px #131314,
body `padding: 24px 16px 32px`. The title is an **unlabelled** input (49.6px, 12px
corners, `padding: 12px`, 1px #171717, 17px/24px). Section labels are
`.section-label.gds-label-s` — 13px/20px weight 370 in #9a9b9c — and their sections are
indented 16px. The when-to-run row reads as a sentence, **"Weekly on S M T W T F S
around 9:00 am"**, laid out as a flex row with an 8px gap: the words "on" and "around"
are real elements. Frequency and time are **filled** fields, rgba(227,227,227,.08) at
8px corners, not outlined pills. Day circles are 24px on a 28px pitch, #171717 at rest
and **#192967** when active, label 13px/20px weight 370 in #e3e3e3 for both states.
`.ask-gemini-note` sits under that row as a sentence with only "Ask Gemini" interactive.
The disclaimer is 13px/20px weight 370 in #ababab.

Two behavioural details matched: Gemini's create form has **no enabled switch** (kept
in Willow only when editing, where pausing matters), and a new weekly schedule arrives
with **Monday–Friday** selected. Time is displayed as "9:00 am" via
`formatSparkScheduleTime`, while the stored value stays 24-hour because `spark-store`
parses it to compute the next run.

**Skill editor.** Card `.editor-new-content`: #1e1f20, 28px corners, 1px #171717,
`padding: 24px`, 20px between sections. No in-card header — Gemini opens straight onto
an unlabelled "Name your skill" input. Labels are `.editor-section-label.gds-body-s`,
13px/17px weight 400 in #9a9b9c with a 4px gap under them. All three fields are 1px
#171717 boxes with 16px padding and 15px/20px text; the name and description use 12px
corners, **the instructions box uses 16px**. There is no disclaimer and no "Ask Gemini"
— Willow keeps its generator but draws it as the quiet inline link Gemini uses in the
schedule editor instead of a blue button.

### Still duplicated (code, not appearance)

`SparkAllTasks.tsx` and `SparkTaskDetail.tsx` each carry their own rename / delete
dialogs and their own task rows. Their **copy and styling now match**
`SparkTaskDialogs.tsx` and `SparkTaskCard.tsx` — same surface, same geometry, same
Gemini wording — but the implementations are still separate, so a change to one has to
be made three times. They should move onto the shared components.

That migration was deliberately not attempted alongside the visual work:
`SparkAllTasks` owns roving-tabindex keyboard navigation, focus restoration after
delete, and filter state, and `SparkTaskDetail` is 2200+ lines. Matching the visuals in
place carried none of that risk. `59-verify-dialogs.cjs` pins the All-Tasks dialogs
against the measured surface so a future migration can be checked against it.

## Phones and tablets (960px and below)

Gemini switches to its narrow layout below 959.98px, and several of its rules split
again at 768px. Spark follows it in `(max-width: 960px)`, `(max-width: 768px)` and
`(min-width: 769px) and (max-width: 960px)` blocks placed at the end of each route's
stylesheet, so they win over the older desktop-first breakpoints above them. The desktop
layout was matched separately and nothing here applies above 960px. React-side
differences key on `useCompactViewport()` from `@willow/chat/use-compact-viewport`.

Measured at 390×844 and 800×1280, below 961px:

| Where | What changes |
| --- | --- |
| Every page | `#1c1c1c` / `#141414` surfaces, `#e0e0e0` text, `"wdth" 92` body type. Schedules, Skills and Connected apps gain the `.spark-top-controls` Beta badge |
| All tasks | A "Put Willow Spark to work for you" heading, the "Describe task" placeholder, unread / running bots and a scroll fade. The filter opens in `GeminiBottomSheet` from `@willow/ui`, and rename / delete use `SparkTaskDialogs` (the desktop keeps its own copies) |
| Task view | The drawer button is hidden in favour of the task's `chevron_left` back button (`body:has(.spark-task-detail)` in `apps/studio/src/shell/sidebar/Sidebar.css`). The follow-up placeholder is Gemini's "Ask a follow-up", as on the desktop (it read "What's next?" when first measured). The processing pill reaches 17px left of the column and pads its label back in, and from 757px to 960px a reply's top-level lists sit 1.675px left of its paragraphs. Links turn `#e0e0e0` — that rule lives in `@willow/ui`'s streaming-markdown styles, so Chat gets it too |
| Reply actions | `actions-container-v2.mobile`: a 48px row 4px under the reply, 36px buttons 12px apart carrying 24px weight-300 glyphs; on a tablet the row shifts 6px left. Its `more_horiz` menu is `gem-menu`: content-sized from `min(225px, 100%)`, `#1c1c1c` on 20px corners, 40px rows with 17px labels, left-aligned to the button and pulled back inside the viewport |
| Task menu | The header `⋮` menu drops flush from its 24px trigger with the right edges aligned, on `#1c1c1c`: 20px glyphs centred in 24px boxes, 13px labels 48px into the row, and a 0.8px `rgb(68, 71, 70)` divider |
| Progress pane | The status pill opens Gemini's `mobile-side-panel-overlay` instead of the desktop popover: the side panel's sections full-screen on black under a 48px close bar, with the task's schedule (`formatSparkScheduleTrigger`, "Daily around 8:00 AM") listed between Progress and Files. Neither edge animates, as in Gemini. A list-pane collapse carried over from a wider window cannot leave the desktop side panel open here |
| Follow-up composer | Phone: full width with a faint light glow, and the disclaimer moves to the end of the thread. Tablet: a 660px column, 32px corners, the disclaimer under the composer |
| Schedules | Times read "8:00 AM" (`formatSparkScheduleTime(time, true)`); the editor's selects use Gemini's filled triangle |
| The two editors | The skill editor drops its 1060px column for Gemini's full-viewport layout: a 60px header, then one edge-to-edge card whose instructions box fills the rest. Its placeholders become Gemini's long worked examples, which set the field heights. The Beta badge shows over the schedule editor but not the skill editor, whose header covers it in Gemini |
| Connected apps | The Workspace card has two 246px tool columns on a tablet. On a phone it stacks, with the title keeping its 60px right margin |
| Composer menus | The "@" panel turns `#1c1c1c` and its labels and 8% highlight follow `#e0e0e0`; "/" keeps `#1e1f20`. Touch drops the 12px scrollbar, so the panel is its rows plus 16px. A skill tooltip with no room on the right goes above the row (see *Skills and connected apps*) |
| Timeline | On a phone the processing state starts on the column edge but runs 16px past its right one, to 8px short of the screen; on a tablet it is 8px wider on each side. Node masks and the collapsed fades use `--spark-panel-surface`, which is `#1c1c1c` here |
| Created files | The card spans the 24px column, as the reply does, on `#141414` with `#e0e0e0` type. Open puts the file in the overlay the remote browser uses, the page alone (see *Created files*) |
| Bots | An open bot is laid out as a task: the list goes, the header leads with the task's `chevron_left` back (to the bots list) and carries the Beta pill among its actions, and the page's `.spark-top-controls` badge gives way while a bot is open (`body:has(.spark-dots-detail)`), since it would sit on those actions and take their taps. The profile and the bot's computer open in the overlay the remote browser uses; the computer pane's title and Take over's "Go back to <name>" truncate, and on a phone a reset's question takes the title's place on up to two lines. List rows clamp the name and the preview to a line each, as task rows do, and on a phone drop the category label. Chat bubbles widen to 86% of the column on a phone; without hover the reaction picker opens from a long press, and the bubble takes the room the hover actions held. The picker places itself inside the visible conversation, above the bubble when it fits |

**The category chips use `justify-content: safe center`.** Willow has four categories to
Gemini's two, which overflow a phone; plain `center` spills them off both edges where
they cannot be scrolled back.

`apps/studio/test/spark-responsive.test.mjs` pins these, including that none of them leak
into the desktop cascade. To compare a page against Gemini at these sizes,
`tools/scratch/device-emulator.cjs` serves `/mobile`, `/tablet` and `/desktop` to switch
both tabs at once. `tools/scratch/page-inventory.cjs` records every element's geometry and
type on one page, and `tools/scratch/inventory-diff.cjs --rename="Gemini=Willow"` prints
what differs.

## Skills and connected apps

A run reaches the user's skills, connected apps and MCP servers through tools that
`harness/spark-tools.ts` registers per run, from what `SparkWorkspace` passes on both run
paths. Gemini's reference runs (a skill applied with "/", Drive and Dropbox picked with
"@"), with their recordings and DOM dumps, are in
`tools/ui-research/captures/spark/135-skills-connectors/`; the scripts that took them are in
`tools/ui-research/scrapers/spark/135-skills-connectors/`.

### Skills

- `use_skill` takes `{"skill": name}`, strips a leading `/`, matches case-insensitively and
  returns the instructions. It also emits a `skill` call, which the timeline shows as
  Gemini does: "Check resources for <name> skill" beside the Google Symbols `build` glyph.
- The prompt's catalogue carries each skill's description, which is what the model chooses
  by; the body stays out until the skill is called. A message naming a skill with a leading
  slash means the user applied it, and the prompt says to call `use_skill` for it first.
- The Skills page's Recommended section shows the first four of Gemini's five not yet added,
  and "Show more" only while more than four remain. Opening one prefills the editor with
  Gemini's own name, description and instructions (`spark-recommended-skills.ts`).

### Connected apps and MCP servers

- **Connectors** are Willow's (`@willow/personal`), the same reads and actions Chat runs.
  `sparkConnectorTools` offers only products that are connected *and* hold a token now
  (`usableConnectors`), and drops the Google ones while Spark's Google Workspace switch is
  off. Each tool is called as `app:<name>` and its row carries the app's logo.
- **MCP servers** are the app-level list in `@willow/ai/mcp/mcp-store`, shared with Code.
  Enabled servers are connected before the run; each tool is `mcp:<qualified name>`, its row
  carries the `extension` glyph, and the prompt marks results as data, not instructions.
- **A row says what the call does** ("Listing recently modified files in Drive"), not which
  tool ran. The model supplies that as `_title` among the call's arguments; `splitStepTitle`
  removes it before the tool runs, since a tool may have a `title` argument of its own. With
  none, the row names the app or server.
- `timelineRowForCall` turns a call into its `activityLog` row: `skill:<name>`, `app:<app>`
  or `mcp:<server>`, with the step title as the row's `label`.
- Apps with no adapter (Contacts, OpenTable, YouTube Music, custom apps) are not offered to
  the model. Shown an app it cannot reach, a model calls it anyway and apologises.
- The rows match Gemini's at 1536×826, 800×1280 and 390×844: 24px rows on a 40px rhythm, a
  20px glyph or logo in a 24px box, and labels and glyphs at `rgba(255, 255, 255, 0.55)`.

### The "@" and "/" menus

"@" lists connected apps, then enabled MCP servers, then apps not connected (at 0.38, as
Gemini's `not-consented-dimmed`). "/" lists skills, a switched-off one at 0.63. Picking one
writes `@Label ` or `/name ` into the draft. `useSparkMentionOptions` builds the options,
`spark-mentions.ts` holds the logic and `SparkMentions.tsx` the overlay; the measured
values are in `spark-mentions.css`.

- **The composer is still Chat's textarea.** The menu hears its keys first (capture phase)
  and writes the draft through the native value setter plus an `input` event, so `InputBar`
  keeps owning it. A mirror of the textarea places the pane at the trigger character's
  left, 4px under its line, and it flips above when it would overflow the screen.
- **Mentions read bold at their own width.** Gemini writes `<strong>` into a
  contenteditable. A textarea cannot hold that, so a transparent copy of the text over it
  traces the mentions with a 0.45px stroke, leaving every glyph where the caret expects it.
- **Keys:** the first row is highlighted on open and the first Down stays on it, Up wraps,
  Enter or Tab picks, Escape closes and keeps the character, and Backspace takes a
  mention's trailing space, then the whole mention.
- **The skill tooltip** waits 750ms, fades in over 200ms and is anchored to the row's
  content box: right of it with tops aligned, else above it from its centre with its bottom
  4px in, narrowed to the space left (150–250px). Between two positions that fit only
  narrowed, the one with more room wins, as CDK decides.
- **Gemini's "/" panel is plain Material because of a Gemini bug.** Its `lmMenuTheme`
  directive adds `lm-menu-theme` once at init, and the menu's class binding drops it when it
  switches to `slash-menu`. After "/" has been used once, the same overwrite leaves "@" plain
  too (`#1e1f20`, no padding) until the composer remounts. Willow keeps "@" themed. Note
  that navigating a tab to the URL it is already on is a fragment jump, not a reload, so a
  capture can land on the overwritten state unnoticed; `09-fresh-at.cjs` reloads first.

### Capturing and checking

- `w-willow.cjs pickers|timeline <w> <h> [touch]` measures Willow headless on a seeded task,
  in the same shape as the Gemini scripts. It never calls a model.
- The Gemini scripts drive a probe window of the debug Chrome. Live runs create tasks in the
  account, and Gemini keeps composer drafts, so every script that types empties the
  composer when it is done; `clear-draft.cjs` does only that.
- `apps/studio/test/spark-skills-connectors.test.mjs` pins the menu logic, the tooltip
  placement against Gemini's phone capture, the calls the tools put on the timeline, the
  prompt's rules, the recommended skills and the measured CSS.

Light theme was not measured; its menu values are estimates.

## The remote browser

Gemini Spark's `computer` tool, rebuilt on an iframe: the main agent asks once per
thread, a background browser agent drives the page, and a pane shows it working.
Gemini captures, recon scripts and the side-by-side comparisons are in
`tools/ui-research/captures/spark/134-remote-browser/` (`narrow/` for phone and tablet).

### How a browser call runs

| Step | Where |
| --- | --- |
| The model calls `computer` with a `task`, a row `title` and maybe a `url` | `harness/spark-tools.ts` |
| Not yet allowed in this thread: the call goes on the timeline, and the turn ends with Gemini's sentence and the permission card | `BROWSER_PERMISSION_RESPONSE`, `SparkBrowserPermissionCard` |
| Allow / Don't allow is the user's next message, a turn of its own; Allow allows the thread | `respondToBrowserRequest` in `SparkWorkspace.tsx` |
| Writing a follow-up instead of answering turns the request down | `submitFollowUp` |
| Allowed: Willow's computer-use loop runs against the task's frame, and the main agent answers from its report | `remote-browser/run-remote-browser.ts` |

### The frame, the proxy and the bridge

- **One iframe per task, owned outside React** (`remote-browser-frames.ts`). It outlives
  the pane: with no pane mounted it is parked full-size in a hidden layer under the app
  (a throttled off-screen frame stops loading), and it moves with `moveBefore`, which
  keeps the page alive.
- **Every site gets its own origin.** `https://www.example.com` is served as
  `http://<base32 origin>.wb.localhost:<port>` by `api/_browse-proxy.js`, which the dev
  server and `bin/willow.js` mount. The page keeps its relative URLs, cookies and
  history, and Willow stays cross-origin to it on purpose. `browse-url.ts` is the
  client half of the mapping and has to stay byte-compatible; a test pins the two.
- **The proxy refuses private hosts** before every request and after every redirect
  (`api/_private-host.js`), drops frame-blocking headers and CSP, and **answers a
  POSTed page with a 303 to a tokened GET**. A POST entry in the frame's history sends
  "back" to Chrome's resubmit page, which has no bridge. The bridge and `fromBrowseUrl`
  strip the token from every address they report.
- **On an https site it adds `upgrade-insecure-requests`.** A scheme-less
  `//host/a.png` otherwise takes the proxy's `http:` and goes to the real host in the
  clear, which hangs on Wikimedia's image hosts — broken images, and a screenshot that
  waits for them. `*.localhost` is a secure origin, so the proxy's own requests are
  left alone.
- **The bridge** (`api/_browse-bridge.js`, the first script in `<head>`) answers the
  parent over postMessage — screenshot, click, type, scroll, key, drag, navigate,
  back/forward/reload — and reports `ready`, `state`, `navigating` and `unload`.
  `loading` is Chrome's throbber, until `load`; `parsed` is when the page can be read.
  The driver waits for `parsed` and then gives `load` 3s: Wikipedia through the proxy
  can take over 20s to fire it.

### Pages the bridge cannot reach

A `load` with no `ready` before it is a document the bridge never ran in: Chrome's error
page, its PDF or image viewer. The frame marks it **unbridged**, labelled with where the
navigation was headed; requests to it fail at once with `UNBRIDGED_PAGE_ERROR`; and

- the driver's screenshot is a stand-in drawn like Chrome's error page
  (`unreachablePageShot`), never a throw — a throw would end the whole task;
- back replaces the dead page with the last bridged one (`location.replace`, so it
  drops out of history) and reload loads its address again. Both go through
  `stepRemoteFrame`, which the take-over toolbar uses as well.

### Screenshots

The bridge captures with html2canvas. Three things about it are not what you would
assume:

- **The root's overflow belongs to the viewport.** html2canvas clips `<html>` (or
  `<body>`) to its own box, so a page styled `html { height: 100%; overflow-y: auto }`
  captured blank below its first screen once scrolled. The clone gets the browser's
  reading (`releaseViewportOverflow`).
- **Off-screen content is left out of the clone** (`planCapture`). html2canvas copies the
  whole document and reads every element's styles, about ten seconds a screenshot on a
  long article. What paints into the viewport, its ancestors, and anything fixed or
  sticky stay whole. A block-flow subtree below the viewport is dropped with its
  parent's height pinned. Any other off-screen box stays as an empty box at its live
  size, but only where emptying it cannot move anything: a plain block passes its
  children's margins through its edges (`sealsMargins`), so those are opened up
  instead. After pinning, the clone is scrolled back to the live position (html2canvas
  scrolled it while it was still short) and checked against an on-screen anchor.
  Wikipedia went from about 10s to 0.5s — and the capture now matches the live page,
  which the full clone did not: it laid the article out afresh, at different heights.
- **srcset images and masked icons.** A 2x file reports its size in CSS pixels, so
  html2canvas drew its top-left quarter; the clone is pointed at the file it chose, at
  its current box size. html2canvas has no masks and painted masked icons as solid
  squares; they are drawn from their mask image instead.

The `data-willow-capture-*` markers the clone reads are on the live page only for the
synchronous copy inside the `html2canvas()` call.

### The history is kept for good

Gemini's screenshots live with its VM on Google's servers and are gone after a while;
then its pane draws the browser's broken-image icon and "Screenshot of the virtual
machine" in Times. Willow keeps every one (`remote-browser-shots.ts`), with no cap:

- a JPEG in IndexedDB (`willow-spark-browser`, a database of its own), and, with a
  folder connected, a file beside the task: `Spark/Tasks/<task>/Browser/001 example.com.jpg`,
  listed with its address, title and time in `Browser/steps.json`;
- the session holds only where each one is (`RemoteBrowserShot.file`); the viewer loads
  the step on screen — this session's bytes, then IndexedDB, then the folder, which is
  put back in IndexedDB — and keeps the previous image up until the next is ready;
- a session restores its task's history when it is made, and a new screenshot is
  numbered after it (`pushRemoteBrowserShot` waits for that), so a run after a reload
  continues the history instead of overwriting its first steps; with no history in the
  browser, the folder's `steps.json` stands in;
- the bots show at most 15, around the step on screen;
- a step whose image is gone anywhere draws `RemoteBrowserShotUnavailable` over the page
  only — the frame's bar still names the step — and makes way for "View Live" when the
  scrim shows. `hide_image` is a Luminous glyph; Willow's Google Symbols subset lacks it.

A task's attachments go beside it too (`spark-task-files.ts`, `Attachments/`), and
deleting the task removes its screenshots and that whole folder. `spark-disk.ts` is how
these reach `useLocalFS`: `SparkWorkspace` attaches it while a folder is connected and
authorized, and attaching writes what was saved while it was not.

### The pane

Gemini's chrome around the iframe (`SparkRemoteBrowserPane.tsx`): a Chrome frame cloned
from the stream at 1:1 with the page below it, scaled into the 5:4 viewer; "Preparing
your computer…" while the first page loads; the scrim with previous/next and "Take over
task"; the history ("View Live", bots); and the take-over view. On the desktop it is the
second card beside the chat.

### Phones and tablets (960px and below)

Recorded off Gemini at 390×844 and 800×1280 in October 2026 with its VM up, which is when
Gemini shows this layout. Its own component CSS is in
`tools/ui-research/captures/spark/134-remote-browser/narrow-takeover/css/`, read out of its
bundle with `tools/scratch/bundle-styles.cjs`. Gemini changed this layout after the first
clone; a task whose VM has shut down still gets the old tap-to-reveal scrim there.

- **The pane fills the screen** (`fullscreen` on the session; Gemini's
  `computer-use-panel.fullscreen-panel`), on #030303: a 72px header ("Remote computer", a 20px
  `monitor`, the 40px "Close panel"), the viewer, the buttons, the disclaimer, 24px free at
  the bottom. Opening the pane, or a run opening it, sets `fullscreen`.
- **Handing a take-over back drops it into the card** in `mobile-side-panel-overlay`, the
  frame the status pill's Progress panel uses: #1c1c1c, 28px corners, a 0.8px #141414 edge
  (`.spark-task-detail__browser-overlay-panel`), "Remote browser" under the overlay's own
  close bar. That is Gemini's behaviour, not a bug; the next open fills the screen again.
- **The buttons sit under the viewer** (`RemoteBrowserActions`, Gemini's `bottom-container`):
  "Take over task" and, once there is a history, "View history"; on a step of the history,
  "View Live". 48px pills up to 320px wide, 12px apart: stacked on a phone, side by side on
  a tablet. The scrim keeps only previous, next and the dots, and only on a step of the
  history. **A finger has no hover**, so the first tap still only reveals it
  (`touchRevealed`).
- **Taken over** (`RemoteBrowserNarrowTakeover`), the header is just its title (52px), and a
  bar under the viewer holds the keyboard and click switches and "Go back to Willow": the
  lowest surface (#0e0e0e), 16px in, as wide as 390px inside that, top corners only below
  423px. The two switches are one toggle, as in Gemini: either opens the keyboard bar. The
  portal sits outside Spark's pages, so it declares `useSparkAccentVars()` itself. Its classes
  (`is-narrow`) are its own: the bot computer's take-over shares `is-compact` and keeps its
  layout.
- **The keyboard bar** (Gemini's `keyboard-input-bar`) slides up over 0.3s on #f0f0f0, which
  Gemini keeps in the dark theme too. It types for the page: typing in it takes the focus out
  of the page, so the bridge's `keyboard` op writes to the field the page last had focused, at
  that field's caret, and backspace deletes there. Gemini pastes into its VM instead.
- Its glyphs are Google Symbols on the face's own axes (`NarrowGlyph`); `keyboard`,
  `keyboard_hide`, `backspace`, `web_traffic`, `chevron_left` and `youtube_live` were added to
  the subset in `apps/studio/index.html` for it.

The monitor menu keeps Gemini's narrow row, 14px/20px weight 500 with the label 56px in.

```
node tools/scratch/rb-window.cjs open gemini|willow           # windows of their own
node tools/scratch/rb-emulator.cjs mobile                     # holds emulation on just those, :9341
node tools/ui-research/scrapers/spark/135-rb-narrow.cjs <phase>  # RB_APP=willow for the twin
node tools/scratch/rb-focus-check.cjs; node tools/scratch/rb-keyboard-send.cjs   # the keyboard bar, end to end
```

### Opening and closing on the desktop

Recorded from Gemini at 1536×826, frame by frame from the real click
(`rb-motion-frames.cjs gemini|willow`, results in `motion/frames-*.json`):

- One 450ms `cubic-bezier(0.2, 0, 0, 1)` clock. With the task list showing, the card
  does **not** grow out of the edge: in the first frame it already has its two thirds of
  what is right of the list (570px, the chat 282px), transparent, and it fades in while
  the list collapses — so the chat and the card widen together as the list goes. Only
  `opacity` has a starting style; the width movement is all the list's.
- The monitor button leaves at once and comes back over 300ms (opacity, scale 0.9). Its
  menu fades for 100ms after 25ms, Material's `_mat-menu-exit`, held where it opened
  while the header slides away under it.
- The viewer joins about 265ms in, with the card nearly full width (`viewerDelayMs`); the
  header and disclaimer are there from the start. So the page never zooms with the card.
- Gemini's browser and Progress are one side panel. Closing hands the card to Progress,
  which shrinks from the browser's width to 300px, opaque throughout; opening over
  Progress grows from 300px (`sidePanelHandoff`, `is-taking-over`).
- At 960px and below nothing animates, as in Gemini.

**Flex transitions run on the main thread**, so any work during those 450ms is a stall,
and work in the click delays the first frame. What keeps both out:

- the page subscribes to whether the pane is open, not to the session
  (`useRemoteBrowserPane`), and the menu keeps its own state (`SparkRemoteBrowserMenu`);
- no state is set while rendering — that runs the whole component a second time in the
  click — so the handoff reads the panel of the last commit from a ref, and the clicks
  that open and close the pane set the list's collapse with the change itself;
- the task list's rows are memoised (`libraryRows`), and its fade is not re-read as it
  collapses;
- the anchored reply's floor follows the resizing panel on the element itself, the
  state catching up 200ms after the resizing stops (a state update per frame redrew the
  task every frame of the motion);
- a browser the page has not loaded yet starts loading 480ms after the pane opens: the
  frame shares the main thread, and its page loading mid-motion dropped frames. It stays
  transparent until it has loaded, so the viewer shows its own surface, not white;
- the browser frame around the page is memoised, since the viewer redraws per scale step.

Measured in the dev build: opening over Progress and closing start 32–45ms after the
click and track Gemini's curve within a frame; the first open after a page load starts
40–75ms later than Gemini's, then follows the same curve. `willow-open-trace.cjs` and
`willow-open-components.cjs` show what a stall was.

### Testing it without a model

```
# WILLOW_URL is required: :3000 is the user's own data, so seed a test origin (:3101)
$env:WILLOW_URL = 'http://localhost:3101'
node tools/scratch/spark-rb-seed.cjs open-spark | answered | pending | pane <url> | shots 3 | takeover on | clear
node tools/scratch/rb-driver-test.cjs <out-dir> tools/scratch/rb-actions-2.json
node tools/scratch/willow-narrow-shot.cjs phone <out-prefix> --run="answered" --run="pane https://example.com/" --shot=overlay
```

`rb-driver-test.cjs` runs the real driver in the Willow tab — the calls the browser agent
makes — with no model, and saves what the agent would see. The session lives in memory,
and the dev server reloads the Willow tab whenever any session edits a module without an
HMR boundary, so re-seed before each run. Unit tests:
`apps/studio/test/remote-browser.test.mjs`.

### Where Willow still differs

- The header pill shows the status ("Needs input", "Complete"); on a browser task Gemini's
  reads "Plan steps".
- Gemini's narrow monitor menu opens pinned to the top-left corner of the screen, over
  the back button. Willow's stays under its button.
- "Take over task" is always offered, because Willow's page is local and stays live;
  Gemini drops it once the VM behind a finished task has shut down. For the same reason
  the narrow pane always has its buttons under the viewer, which Gemini shows only while
  its VM is up.
- Gemini renders menu labels in Google Sans Text, which Willow does not load, so its
  narrow menu label runs about 9% wider.
- Taken over on a phone, a tap goes straight into Willow's page, and a field in it can
  bring up the phone's own keyboard; Gemini's VNC stream needs its keyboard bar for any
  text. The bar works in Willow as well.
- The narrow pieces' light theme is unmeasured (Gemini's account is dark); it follows the
  light surfaces the pane already uses.

## Created files

A run's `apply_patch` that adds a file reports it (`generated-file`), and the turn shows
Gemini's `remy-output-artifact-card`: the file's icon, name and "Created <date>", and an
"Open" pill. Gemini's card is an `<a>` whose pill (`open-button-visual`) is only a picture
of a button, so here the whole card is the button. Captures, the recon scripts' output and
the side-by-side checks are in `tools/ui-research/captures/spark/136-file-open/`.

**Open puts the file in the remote browser's side panel** (`remy-side-panel.showing-embedded-doc`):
the task list collapses, the chat takes a third and the file two, and closing hands the
card to Progress at 300px. `spark-open-file.ts` holds each task's open file. The browser
and a file are one panel, so opening either closes the other; when a run opens the
browser over a file, the browser wins. Progress's Files rows (docked, in the popover and
in the narrow overlay) open their file the same way, where Gemini's link to Drive.

**The motion is the browser's clock with one difference**, recorded frame by frame from
Gemini (`tools/scratch/gemini-file-open.cjs`): the card starts at `flex: 0 0 0%` and grows
as it fades, where the browser's starts at its share. Over Progress it grows from 300px
(`is-taking-over`); in the browser's place it swaps at full width (`is-replacing`). The
page joins after the 450ms (`revealDelayMs`, none under reduced motion): Gemini's card is
empty while the Docs embed loads, and the text is not laid out again at every width.

**What fills the card is a clone of the Google Docs embed** (`SparkFileViewer.tsx`, read
from inside Gemini's frame by `gemini-file-frame.cjs`): a 55px white app bar (Docs' blue
page glyph, the name, a `#c2e7ff` pill, Open in new tab, Close with Shift+Esc), the 40px
`#f0f4f9` toolbar 6px under it, then the page. Docs draws its page on a canvas, so the page
was measured off the pixels (`tools/scratch/ink-lines.cjs`): Arial 11pt on a 20px pitch,
80px in and 49px down, wrapping by 760px. Willow's lines break where Gemini's do.

**Willow's files are not Docs**, and this is where it diverges on purpose:

- They are plain text in the run's OPFS workspace (`willow-spark/<scope>/workspace`, read
  back by `readSparkWorkspaceFile`), so the page is read-only and shows the text as
  written, as Gemini's Doc shows the Markdown its run put in it.
- The pill is Download where Docs has Share, the toolbar keeps the two controls a reader
  has (Print, and Zoom from 50% to 200%), and the "Saved to Drive" badge is gone.
- Code reads in a monospace face. Open in new tab opens an HTML file as its page, inside a
  sandboxed frame with no origin of its own (its scripts run, Willow's storage is out of
  reach), and anything else as its text.
- A file a task made in another browser is not in this one's OPFS. The page says so, and
  Download and Print are disabled.

**At 960px and below** it opens in the overlay the remote browser uses (the 48px close bar
over a `#1c1c1c` card), and the card holds the page alone, as Gemini's phone and tablet
embed does: single-spaced (16.8px), about 101px down, 11.6px in on a phone and 14px on a
tablet (`calc(9.3px + 0.585vw)`). Escape closes it.

`node tools/scratch/spark-file-open.cjs [phone|tablet]` seeds a task with three files in a
browser context of its own and walks every path; the unit tests are
`apps/studio/test/spark-file-open.test.mjs`.

## What a run saves: schedules and skills

A run saves what the user asks it to with `create_schedule` and `create_skill`, called
like any other tool (`harness/spark-tools.ts`), with the step's `_title` as the row Gemini
shows under Thoughts: "Created weekly science fact schedule", beside the `build` glyph
(`created:<label>` in `activityLog`). Both are mutating, so Plan mode refuses them, and
`tool-policy.ts` points the names models guess (`set_reminder`, `save_skill`, …) at them.

- **The arguments are read by `@willow/core/spark-library`** (`scheduleInputFrom`,
  `skillInputFrom`), the same rules Chat's tools use: "7 PM" is 19:00, weekly with no days
  or all seven is daily, a skill's name is kebab-case and may not repeat one the library
  has. A call repeated within a run gets its first answer, not a second copy.
- **A schedule belongs to the task that made it** (`taskId`), as Gemini's does, and is on
  with its next run worked out (`spark-schedule-time.ts`). A skill is `source: 'gemini'`.
- **The turn keeps what it saved** (`createdItems` on the task or turn, persisted with it),
  and shows each as Gemini's `remy-confirmation-card.draft-approval`: `ConfirmationCard`
  from `@willow/ui`, with the name as a 28px title, a five-line body with See more / See
  less, and for a schedule "When to run:" / "What to do:" and a disclaimer. The card reads
  the schedule or skill live (`librarySchedules`, `skillLibrary`), so an edit shows.
- **Gemini's disclaimer is about usage limits; Willow's says when schedules run** — while
  Willow is open, and one that came due while it was closed runs on the next open.
- **The "Create skill" chip is real**: the run is told to save the request as a skill.
- **Chat saves through Spark too.** `register.ts` registers the writer Chat's tools use
  (`registerSparkLibraryWriter`), and `spark-store.ts` publishes the schedule mirror, so
  a chat card shows its schedule as it is now. Each write hydrates Spark's state first:
  one into an unread state would publish over the user's saved schedules.

`node tools/scratch/create-with-verify.cjs [desktop|phone|tablet]` walks both "Create with
Gemini" buttons, a Spark task's schedule and a chat's schedule and skill end to end, in a
browser context of its own with a folder in its own OPFS and Gemini's API answered by the
script. The unit tests are `apps/studio/test/create-with-gemini.test.mjs`.

## Splits

`SparkTaskDetail.tsx` was 2310 lines; the composer chips (file/tool context rows,
attachment pills), the tool-name labels, the MaterialSymbol icon defaults, and
`mergeSelectedFiles` moved to `spark-composer-chips.tsx` (128 lines). That helper
was duplicated byte-for-byte in `SparkAllTasks.tsx` and `SparkHome.tsx` — all
three now import it from one place. `spark-store.ts` (1478 lines) is the
remaining split candidate; its exports are widely referenced — verify before any
move.

<!-- related-packages -->

## Related packages

**This package imports from:**

- [`features/chat`](../chat/AGENTS.md) — the standalone chat surface
- [`features/code`](../code/AGENTS.md) — the Workbench: sandbox and visual editing
- [`platform/ai`](../../platform/ai/AGENTS.md) — model clients, chat orchestration, computer use
- [`platform/auth`](../../platform/auth/AGENTS.md) — Firebase, `useAuth()`, `useUserData()`
- [`platform/ui`](../../platform/ui/AGENTS.md) — shared components

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
