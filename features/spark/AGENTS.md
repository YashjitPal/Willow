# features/spark

Scheduling agent + browser automation. The user defines tasks (e.g. "every weekday
at 9am, check my inbox and summarise") and Spark executes them on a schedule.

## Files

| Path | Role |
| --- | --- |
| `src/SparkWorkspace.tsx` | Entry workspace (1308 lines). Task dashboard. |
| `src/SparkHome.tsx` | The launch / suggested-tasks grid. |
| `src/SparkTaskCard.tsx` · `.css` | Gemini's `.goal-card` row + its `⋮` action menu. Shared row for every task list. |
| `src/SparkTaskDialogs.tsx` · `.css` | Rename / Delete confirmations, with Gemini's copy. |
| `src/SparkTaskDetail.tsx` | Task detail/edit view (2196 lines). |
| `src/SparkComposer.tsx` · `.css` | The prompt box: a thin wrapper over Chat's `InputBar`. See below. |
| `src/spark-composer-chips.tsx` | Chip rows and tool labels for the task-detail composers, plus the file-merge helper. |
| `src/SparkAllTasks.tsx` | Full task list. |
| `src/SparkScheduleEditor.tsx` | Cron/time picker widget. |
| `src/SparkSkillEditor.tsx` | User-defined skill editor (LLM prompt templates). |
| `src/SparkCustomisePages.tsx` | Task customisation (1150 lines). |
| `src/SparkComputerUsePanel.tsx` | Browser-context panel for computer-use mode. |
| `src/SparkDictationWaveform.tsx` · `src/useSparkDictation.ts` | Voice-activation UI. |
| `src/useSparkNow.ts` | The "run now" hook. |
| `src/spark-store.ts` | Nanostore (1478 lines). Task state, scheduling, globals. |
| `src/spark-types.ts` | Shared types (`SparkTask`, `SparkSchedule`, `SparkSkill`, …). |
| `src/attachment-storage.ts` | File attachment persistence. |
| `src/browser-tabs-bridge.ts` | Connects the Spark agent to `chrome.tabs` / `browser.tabs`. |

## Architecture

Spark is nearly stateless-to-the-user: the store (`spark-store.ts`) is the action
hub, and the UI components dispatch through it. The backend agent (in
`@willow/ai/computer-use/session.ts`) is the runner; Spark is the scheduler.

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
  bypass it. It is now reserved for `followUpLocked` — an approval the task is waiting on,
  where there is nothing to stop and the thing to do is answer the prompt above the box.
  A task that is merely *working* uses `isGenerating` instead, which keeps the box live and
  turns send into stop. See below.
- **`onSubmitFiles`**, an alternative to `onSubmitTask` that hands over the raw files. The
  follow-up path is keyed to a specific task and aborts if the user navigates away
  mid-upload, and it reads a boolean back from the store to decide whether the turn was
  accepted. Rather than grow `SparkComposer` a callback per race, that site keeps its own
  pipeline intact.

### A working task takes a draft, and send becomes stop

Gemini locks its whole follow-up box while a task runs, and Willow used to as well
(`disabled={followUpBlocked}`). It no longer does — **this is a deliberate deviation,
asked for by name**, and it mirrors Chat: you can write the next message while Spark
finishes, and the send slot is a stop control until it does.

`followUpBlocked` still means what it always did and still drives the placeholder, the
status chrome and `aria-busy`. What narrowed is the composer's hard lock, now
`followUpLocked` — approval states only.

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
`/spark/apps` and `/spark/chat/<id>`. Willow reaches the same six through
`sparkLocation` in the store rather than the URL.

Captures, the scraper harness and the Gemini↔Willow diffs live in
`tools/ui-research/{captures,scrapers}/spark/`.

## Verifying a change

```
node tools/ui-research/scrapers/spark/verify-all.cjs
```

Runs every fidelity check and prints one pass/fail. Needs `npm run dev` on :3000 and
Chrome on :9222 (`lib.cjs` connects over CDP with `puppeteer-core`). The fourteen checks:

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
#3186ff. Under `@media (hover:hover)` the host becomes a 36×36 box so the dot sits
where the action menu would. There is also a `.status-pill.dot` variant whose label
collapses to `max-width: 0` and reveals on hover, with the dot pinned at
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
Willow has no equivalent.

### The remote-browser pane is a second pane, not a thread block

Willow used to render `SparkComputerUsePanel` inline in the conversation. Gemini's is
a sibling card beside the chat pane, so `.spark-task-detail__workspace` is now a flex
row with an 8px gutter holding `.spark-task-detail__panel` and
`.spark-task-detail__side-panel`, at `flex: 1` and `flex: 2`.

That ratio is measured: Gemini's split view is 285.1 and 567.1 against an 868px pane,
i.e. the chat takes 33.5%. Willow measures 264.4 / 527.1 — 33.4%. Both cards are
#1f1f1f at 28px corners with a 1px #171717 border. Below 980px they stack instead.

The header's `monitor` glyph toggles the pane, and the pane only exists when
`SparkWorkspace` supplies `computerUse`, which needs
`task.approval.kind === 'browser'` and `approvalDecision === 'allowed'`.

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

### Still to do on this route

- The thread body. Gemini opens with `remy-processing-state`: a collapsible row
  (`button.processing-state-container-button`, 373.4×32, pill, `padding: 0 8px`,
  label gds-body-s 13px/17px in rgba(255,255,255,.55), chevron `expand_more` at 20px
  weight 320) that expands into `.thought-details` and `.tool-block` rows — the
  latter carrying a `monitor` glyph and the label "Computer". Willow renders a user
  bubble and its own turn layout instead.
- Gemini's header carries a `monitor` glyph (16px, weight 330, #c4c7c5) that toggles
  the side panel. Willow's header has no such control.
- `remy-side-panel` chrome: 972×810 at #1f1f1f, radius 28px, `padding: 0 8px 0 0`
  on the host, with a `.scroll-container` inside.

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
cloud VM, so it can drive any site. Willow deliberately does **not** copy that.
`SparkComputerUsePanel.tsx` renders an **iframe** instead, with the local-companion
daemon's streamed frames (`companionFrame.dataUrl`, an `<img>`) as an optional
upgrade when `services/local-companion` is running.

The trade-off is accepted and known: any site sending `X-Frame-Options` or a
restrictive `frame-ancestors` will not embed, and the panel says so rather than
failing silently — "This page is cross-origin or blocks embedding. It can be viewed
here, but a frontend-only iframe cannot expose it to the local agent."

**Match Gemini's chrome around this pane, not its transport.** Do not replace the
iframe with a VNC client in the name of fidelity.

Note that Angular loads per-route sheets lazily: this route yields 98 stylesheets
against the home route's 80, so re-run the dump on the route you are working on
rather than reusing `03-css/`.

### "Create with Gemini" diverges on purpose

On both the Schedules and Skills pages, Gemini's **"Create with Gemini" leaves Spark
entirely** — it mounts a plain `chat-window` zero-state and the sidebar switches to the
Chat experience (New chat, Gems, Notebooks). The schedule is then created
conversationally.

Willow's stays inside Spark and creates a Spark task ("Creating a schedule → Working on
your task"). That is kept deliberately: crossing into Chat would couple two
intentionally separate surfaces, and Willow's flow already reaches the same result. The
**"Create manually"** editors on both pages are matched to Gemini exactly — see above.

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
