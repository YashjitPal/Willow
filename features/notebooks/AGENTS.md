# features/notebooks

Gemini's **Notebooks**: the sidebar section, the card grid, the create screen, and
a single notebook's page. Aliased as **`@willow/notebooks`**.

A notebook groups chats by topic and holds sources to ground them on. Gemini's own
code calls these *projects* — `project-mgmt`, `project-sidenav-list`,
`project-editor-window-v2` — and only the user-facing copy says "notebook".

## The naming trap — read first

| Alias | Points at | Is |
| --- | --- | --- |
| `@willow/notebooks` | `features/notebooks/src` | **This.** Gemini's notebooks. |
| `@willow/project-browser` | `features/projects/src` | The *code workspace* browser UI. |
| `@willow/projects` | `platform/projects/src` | The *code workspace* data layer. |

Willow's `Project` is a code workspace on disk and has nothing to do with a
notebook. They are separate registries under separate keys and must stay that way,
however much Gemini's class names suggest otherwise.

## Files

| Path | Role |
| --- | --- |
| `src/notebook-types.ts` | Types, the two verticals, `formatSourceCount`. No behaviour. |
| `src/notebooks-backend.ts` | Persistence: scoped localStorage, parse/validate, sort, ids. Knows nothing about React. |
| `src/notebooks-store.ts` | Reactive layer (`nanostores`) plus every mutation. |
| `src/NotebooksSection.tsx` | The sidebar section. |
| `src/NotebookCreatePage.tsx` | "What are you working on?" — name + vertical chips. |
| `src/AllNotebooksPage.tsx` | The card grid, or the splash at zero. |
| `src/NotebooksSplashScreen.tsx` | First-run "Introducing notebooks" screen. |
| `src/NotebookPage.tsx` | One notebook: header, source chip, Past chats. |
| `src/notebooks.css` | Every animation and measured dimension. |

Dependencies go one way: `types <- backend <- store <- components`. Nothing outside
this folder should reach past `notebooks-store` into the backend. The single
exception is `LocalFSContext`, which imports `setNotebookStorageScope` and nothing
else.

## The create screen

Vertical rhythm, all measured — the whole block sits at the same y as Gemini's
(icon 262, heading 306, form 334, chips 426):

| Element | Value |
| --- | --- |
| `.prompt-container` | h 68 = 28px icon + **16px** gap + 24px heading |
| form | **4px** below the prompt block, h 52 |
| chips row | **40px** below the form, h 138, 12px between chips |

**The input is not centred in its row.** Gemini's 44px input sits **6px** below the
top of the 52px form, where centring gives 4px. Two pixels, but it reads as a
tighter gap under the heading. The submit button beside it *is* centred (8px), so
`.nb-create-field` shifts alone via `align-self: flex-start; margin-top: 6px`
rather than the row changing its `align-items`. The form's height is fixed at 52px
either way, so **the chips below never move** — they stay at y 425.8, as Gemini's do.

**The name field is a bare display-size input, not a text box.** 36px/44px at
weight 320, transparent background, no border, no outline, caret
`rgb(168,199,250)`. It carries `padding-left: 16px` while the field around it
carries `margin-left: -16px`; they cancel, so the *text* aligns with the icon and
heading while the field's hit area still reaches 16px further left. Adding a
filled rounded rect here — the obvious reading of "input" — is wrong.

**There are no action buttons.** No "Create notebook" pill, no "Cancel". Submit is
a 36×36 borderless `arrow_forward` that does not exist until the field has text.

**The submit button tracks the text.** It sits 8px past the field's right edge, and
the field grows to fit its content, so the button slides right as you type. The
width comes from a hidden mirror — Gemini's `div.dupe-title`, `opacity: 0`,
`position: absolute`, `pointer-events: none`, holding the same string in the same
face — sized to `max(400px, mirrorWidth + 16px)`.

Three traps in that mechanism:

- **The mirror's font must match the input exactly.** Any divergence in family,
  size, weight, or a single variation axis mis-sizes the field and the button
  drifts off the end of the text. `.nb-create-typescale` is shared by both for
  this reason — do not split it.
- **Do not round the measurement.** Advance widths are fractional and Gemini
  passes them straight through; `Math.ceil` put the field at 715px where Gemini
  sits at 714px for the same string.
- **The growth is not animated.** Gemini's `transition: all` resolves to a 0s
  duration, and frame-sampling a large paste showed 400 → 732 in one frame. An
  eased width transition looks smoother than the real thing and lags the caret.

**The placeholder types itself, and the phrases differ per vertical.** Typed a
character at a time at ~63ms, held 2050ms, deleted at ~58ms. The holds measured
2044–2090ms across both verticals. The two lists are **entirely different**, not a
shared pool:

| Vertical | Phrases, in order |
| --- | --- |
| Organize | Project or idea · Weekly meal prep · Creative brainstorm · Moving checklist |
| Study | Subject or topic · Plant biology · Creative writing · World geography |

Switching chips **restarts from the first phrase** rather than finishing the
current one — timed after a click, the new phrase typed from empty (16 chars ×
~68ms). Both lists live on `NOTEBOOK_VERTICALS` beside `prompt`, so heading and
placeholder can't fall out of sync.

The timer is paused while the field has a value (the placeholder is not visible
then) but keeps its phrase index, so clearing resumes mid-cycle. It resets only on
a vertical change — hence two separate effects in the hook, one keyed on `phrases`
and one on `isPaused`. `aria-label` is fixed so the cycling text never churns the
accessible name.

### Heading weight — the `wdth` axis, and the font itself

`gds-headline-s` is 20px/24px at `wght 470`, but **also `wdth 94` and `ROND 20`**.
Google Sans Flex is a variable face: setting `font-weight: 470` alone leaves the
width axis at its default 100, and the heading renders wider and reads visibly
bolder than Gemini's. Declare all the axes, not just the weight.

Worse, and easy to miss: **Willow's global sans is Inter.** `tailwind.config` sets
`sans: ["Inter", "sans-serif"]`, so anything that does not declare `font-family`
inherits Inter, which is ~8% wider than Google Sans Flex at `wdth 94` — the create
heading measured **248.19px** against Gemini's **228.85px** for the same string.
That presents as "the text is slightly bigger", not as a wrong typeface, which is
why it survives a casual look. Every root here carries `.nb-surface`, which sets
the family once; per-element rules then only set size/weight/axes.

When checking type against Gemini, compare **rendered text width** via a
`Range` — `getClientRects()` on the text contents — not `font-size`. The sizes
matched exactly while the face did not.

### The heading follows the vertical

Selecting **Study and learn** changes the heading from "What are you working on?"
to **"What are you studying?"**, and changes nothing else — chip copy, icons, and
layout all stay. The string lives on the vertical in `NOTEBOOK_VERTICALS.prompt`
so the two cannot fall out of sync.

### The submit button is a filled blue circle

`rgb(31, 59, 155)`, 36×36, fully round, arrow at `rgb(230,230,230)` — the same
accent as the splash CTA. The fill sits on Gemini's `gem-icon-button` **wrapper**,
not on the `<button>` inside it, so reading the button's own `background-color`
reports transparent and the button looks like a bare glyph. Check the wrapper.

## What the `study` vertical does and does not do

The vertical is **persisted for both values** — `Notebook.vertical` is written at
create time, validated on read, and round-trips through storage. Nothing else
reads it yet.

Gemini does more with it: the study vertical puts `?subtype=study` on the
notebook's chats and swaps the notebook page for a tutor layout with lessons and
progress. None of that is implemented here. So a notebook created under "Study and
learn" is currently identical to an "Organize your ideas" one apart from the stored
field and the create screen's heading.

## Zero notebooks is a different surface

Verified against a Gemini account that had never created one:

- `/notebooks/view` renders `project-splash-screen`, **and nothing else** — no
  "Notebooks" heading and no top-right New notebook button. So the whole page is
  replaced, chrome included, not just the grid body.
- The sidebar section holds **exactly one row**, `New notebook -> /notebooks/create`.
  The "All notebooks" row is *absent*, not disabled — it would otherwise point at
  an empty grid.

Both branches wait on `notebooksHydratedStore` first. Without that gate the splash
paints for a frame on every visit by an account that does have notebooks, and a
first-run screen flashing at a returning user is worse than a blank frame.

Two splash details that look like mistakes but are not:

- The heading glyph is a **28px glyph at `transform: scale(2)`**, not a 56px glyph.
  Its font is pinned to `opsz 28`, so rendering at 56px picks a different optical
  size and the stroke comes out heavier. Keeping the box at 28px also means the 8px
  flex gap below it measures from the *unscaled* box, which is what puts the title
  where Gemini has it — the glyph overflows its own box on purpose.
- The three feature icons do **not** share a font. `forum` is Google Symbols;
  `note_stack` and `rule` are Luminous. Treating the row as one set leaves a blank
  box where the odd one out is.
- The subtitle separator is a **literal `|`** in the text node, not an element:
  "Level up your projects | Powered by …" is one 420px line (285px text + 135px
  lockup).

### Adapted, not copied

Two spots in the splash deviate deliberately, both marked in the component:

1. Gemini ends the subtitle with the **Gemini Notebook wordmark** (an inline
   135×27 SVG). Willow is not powered by Google's product, so that slot holds
   Willow's own name at the same size and weight — line metrics unchanged. Swap
   `POWERED_BY` to change it.
2. Gemini's disclaimer makes specific claims about Google's model training, Keep
   activity, and its privacy notice, and links to three Google support pages.
   Reproducing it verbatim would assert things about Willow that are false, so the
   paragraph is Willow's own at the same length, position, and type scale, keeping
   the three-link shape. `DISCLAIMER` is a plain JSX constant.

## Routes

Gemini's paths, matched rather than renamed:

| Path | View |
| --- | --- |
| `/notebooks/view`, `/notebooks` | `notebooks` — the grid |
| `/notebooks/create` | `notebook-create` |
| `/notebook/<uuid>` | `notebook` |

`matchNotebookRoute` in `App.tsx` is the only place that parses these. It exists
because `/notebooks/…` and `/notebook/<id>` differ by one character, so a
`startsWith('/notebook')` tested first swallows both. `activeNotebookId` is derived
from the URL, never held as separate state, so deep links and back/forward agree.

`handleViewChange` handles the two id-less views. Opening one notebook goes through
`openNotebook(id)`, which navigates and lets the pathname sync set the view — a
view enum cannot carry an id.

## Why localStorage and not the synced folder

Notebooks must work with **no local folder connected**. The folder-backed stores
gate reads behind `isLocalFolderConnected`, which is why Recents vanishes without
one; a notebook list that disappeared the same way would look broken on a fresh
profile. So the registry is scoped localStorage keyed
`willow_notebooks:v1:<uid>::<root>::<workspace>`, using the same scope string as
projects, media, and code sessions.

Every write goes through `writeNotebooks`, which persists then fires
`NOTEBOOKS_UPDATED_EVENT`. The store listens to that *and* to `storage`, so a
mutation from any surface reaches all of them — and a second tab — without those
surfaces importing each other.

`parseNotebooks` is defensive on purpose: this data is user-editable via devtools
and outlives releases, so one malformed entry must not take the sidebar down.
An entry with no usable `id` is dropped, since nothing else can be reconstructed
from a missing id.

## Measurements that are not obvious

Every number in `notebooks.css` came off the live app. Four are worth knowing
before editing:

**The chip animates `width`, and that is load-bearing.** The subtext is laid out
at the *selected* content width (176px = 200 − 2×12) while the collapsed 160px chip
clips it with `overflow: hidden`. Growing the box is what reveals the text. The
name, by contrast, is pinned to the *unselected* width (136px) so it wraps
identically in both states — if it grew with the chip, selecting one would reflow
its title from two lines to one and the row would jump. Neither element is scaled.

**The spring is `cubic-bezier(0.34, 1.56, 0.64, 1)`** over 400ms, shared by the
chip width, the subtext fade, and the badge's `scale(0) -> scale(1)`. It overshoots.
Replacing it with an ease-out makes the whole create flow feel like another product.

**Lists inside the sidebar row have no pin icon.** Gemini renders its row menu with
`hide-pin-icon`, and probing confirms `.project-item-pin-icon` is *absent*, not
hidden. Pinning still sorts the notebook to the top; the pin glyph only ever appears
on the card in the grid, which uses `always-show-menu-icon`.

**The card's 291px width is derived, not fixed.** Cards measured exactly 291.0px in
a 1188px row, and (1188 − 3×8)/4 = 291 exactly — a 4-column fractional grid. An
`auto-fill` floor of 291px is knife-edge there: Willow's row is 1185px, three pixels
short, and silently fell back to a 3-up with 390px cards. Hence explicit column
counts per breakpoint.

Two more, smaller:

- The vertical chip icons (`lightbulb`, `school`) are **Google Symbols** at
  `wght 300, ROND 100`. Every other icon on these screens is Luminous. Asking the
  Luminous face for `lightbulb` renders a blank box.
- Hover menus are revealed with `visibility`, not `opacity` — Gemini keeps
  `opacity: 1` in both states, so there is no fade.

## The composer is not rebuilt here

Gemini's notebook page mounts the *same* composer the new-chat page does:
`project-chat-window > chat-window` with `center-input-layout`, whose
`fieldset.input-area-container` carries `is-zero-state`. `NotebookPage` therefore
takes `composer` as a `ReactNode` and expects the shell to pass Willow's real
`<InputBar>` through, so model selection, dictation, attachments, and submit stay
on one implementation.

**Currently the shell passes nothing**, so the notebook page renders its header and
Past chats with no composer. Wiring `<InputBar>` in — and routing its submit
through `addChatToNotebook` so the new chat lands in this notebook — is the next
step, and the reason `chats`/`onOpenChat` are already props.

## Sidebar row geometry — do not re-derive

Gemini's `a.gem-nav-list-item` and Willow's `<SidebarItem>` already agree to the
pixel by different arithmetic. Gemini: 8px row padding + 24px icon slot + 8px gap
→ label at x=46. Willow: 6px wrapper + 6px padding + 28px icon box + 6px gap →
label at x=46, icon centred at x=26, which is exactly where Gemini's 28px
`gem-icon` sits. The section renders through the shared primitive so it inherits
the collapsed-rail tooltip and active state; there is no private row type.
