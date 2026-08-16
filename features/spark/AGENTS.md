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
| `src/spark-composer-chips.tsx` | Shared composer pieces: chip rows, tool labels, icon defaults, file-merge helper (128 lines). |
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

Captures, the scraper harness and the Gemini↔Willow diff live in
`tools/ui-research/{captures,scrapers}/spark/`. `21-compare-ladder.cjs` prints a
numeric diff of the home page and `22-willow-qa.cjs` asserts the motion endpoints.

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

### Known remaining differences

- **`/spark/tasks` does not scroll the way Gemini's does.** Gemini's `.goal-list`
  is the scroll container (`overflow-y:auto; flex:1; min-height:0`) inside a fixed
  shell, with a scroll-driven fade mask:
  `mask-image: linear-gradient(to bottom, transparent 0, #000 calc(var(--fade-progress)*var(--fade-distance)), #000 calc(100% - var(--fade-bottom)*var(--fade-distance)), transparent 100%)`
  where `--fade-distance` is 48px and JS sets `--fade-progress` / `--fade-bottom`
  from scroll position. Willow scrolls the page instead, so the mask would have
  nothing to act on; making the list a scroll container is a layout change that was
  deliberately not attempted alongside the visual pass.
- Gemini has **no search input** on `/spark/tasks`; Willow's "Search tasks" is an
  addition, as are the Connected apps page's "Custom apps" segment, its
  "Use as context" toggle labels and its Google Photos notice. All kept
  deliberately.
- The `/spark/tasks` empty-state *copy* and its two font sizes are Willow's own —
  the reference account has tasks, so that state could not be observed. The card
  geometry around it is measured.

### Still duplicated

`SparkAllTasks.tsx` and `SparkTaskDetail.tsx` each carry their own older rename /
delete dialogs, with pre-Gemini copy ("Rename task" / "Save", "Delete task?").
They should move onto `SparkTaskDialogs.tsx` rather than a fourth copy appearing.
Their task rows should likewise move onto `SparkTaskCard.tsx`.

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
