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
| `src/notebook-chat-store.ts` | Chat ↔ notebook hand-off and source grounding. |
| `src/useNotebookDisk.ts` | The one filing API: `fileChat`, and the source/folder writes. Mutates the registry **and** the disk mirror together. |
| `src/MoveChatDialog.tsx` | The notebook picker, shared by "Add to notebook" and "Move to another notebook". |
| `src/NotebooksSection.tsx` | The sidebar section. |
| `src/NotebookCreatePage.tsx` | "What are you working on?" — name + vertical chips. |
| `src/AllNotebooksPage.tsx` | The card grid, or the splash at zero. |
| `src/NotebooksSplashScreen.tsx` | First-run "Introducing notebooks" screen. |
| `src/NotebookPage.tsx` | One notebook: header, sources chip, composer, Past chats. |
| `src/NotebookSourcesDialog.tsx` | Add sources: upload / paste / link. Owns the pending (still-reading) list. |
| `src/SourceTile.tsx` | One source as a 112px tile, plus its loading spinner. |
| `src/SourceIcon.tsx` | The type icon / favicon for a source. |
| `src/notebooks.css` | Every animation and measured dimension. |

Dependencies go one way: `types <- backend <- store <- components`. Nothing outside
this folder should reach past `notebooks-store` into the backend. Three exceptions,
all deliberate:

1. **`ChatView`** imports the hand-off helpers from `notebook-chat-store`.
2. **`LocalFSContext`** imports from `notebooks-backend` — eight symbols now, not
   one: the scope wiring, `readNotebooks` / `readNotebookChatIndex`, the folder-name
   pair (`derive…` / `ensure…` / `setNotebookFolderName`), `setNotebookSourceFsName`
   and `adoptChatIntoNotebook`.
3. **`notebooks-disk`** imports the three directory names, so `Notebooks/`,
   `Sources/` and `Chats/` are spelled in exactly one place.

**The direction is what matters, and it is `backend`, never `store`.** The storage
layer sits *below* React: it runs inside a 3-second poll with no component mounted,
so a nanostore write from there would be a mutation nobody is subscribed to yet.
That is why the two writes the reconciler needs — filing a chat it found in an
unexpected folder, and recording a source's on-disk name — live in the backend as
`adoptChatIntoNotebook` and `setNotebookSourceFsName` rather than in the store, and
why both persist through `writeNotebooks` and let the store re-hydrate off
`NOTEBOOKS_UPDATED_EVENT` like any other tab would. Adding a fourth exception is
fine; making one of them import `notebooks-store` is not.

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

**This does not mean nothing is on disk** — a connected folder gets a full mirror,
described next. The registry stays authoritative for *existence*; disk is
authoritative for *where a chat file is*.

## On disk

```
<workspace>/Notebooks/<Notebook title>/
├── .willow.json          // { id } — the notebook's uuid
├── Sources/
│   ├── lecture-notes.pdf // uploads keep their original bytes and extension
│   └── Photosynthesis.md // 'text' and 'website' sources (URL on line 1)
└── Chats/
    └── <chatId>.json     // MOVED here out of the workspace's global Chats/
```

Every directory operation is in `platform/storage/src/local-fs/notebooks-disk.ts`;
this folder never touches a handle. Two things about it are load-bearing:

**The folder name is assigned once and then frozen in `Notebook.fsFolder`.** Titles
are free text, may contain `/ \ : * ? " < > |`, may be a Windows device name, and
are allowed to collide — so `ensureNotebookFolderName` sanitizes and de-dupes
(`Physics`, `Physics (2)`), and **`deriveNotebookFolderName` de-dupes against other
notebooks' `fsFolder`, never against their titles.** Deriving from the whole list
each time is not stable: rename the first of two "Physics" notebooks and the
second's derived name silently changes from `Physics (2)` to `Physics`, while its
folder — and every chat in it — is still where it was. The comparison is
case-insensitive because Windows and a default macOS are.

**Filing a chat MOVES its file, and that is the dangerous part.** A chat id is its
filename, and the storage layer's reconciler used to treat "in the chat index, not
in `Chats/`" as an external delete — so with a naive implementation every filing
destroyed the conversation on the next 3-second poll. `useNotebookDisk.fileChat`
is the one place that knows filing has two halves (registry + file), and the rules
that keep it safe are invariants 18-20 in
[`platform/storage/ARCHITECTURE.md`](../../platform/storage/ARCHITECTURE.md), pinned
by `apps/studio/test/notebook-chat-location.test.mjs`. In particular: a chat moved
by hand in Explorer is **adopted** into that notebook rather than dragged back, and
deleting a notebook whose `Chats/` still holds files is **refused** at the disk
layer — unfile them first, because a notebook is a grouping and a grouping decision
must not delete conversations.

With no folder connected all of this is skipped and notebooks work exactly as
before; the backfill closes the gap on the poll after one is connected.

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
takes a `renderComposer` render prop, and `App` passes Willow's real `<InputBar>`
through — model picker, dictation, attachments and submit all stay on one
implementation.

### Sending: the hand-off

A notebook page cannot run a turn. Streaming, persistence, history and title
generation all live in `ChatView`. So sending goes:

1. notebook composer submits → `sendFromNotebook` → `startNotebookChat()` sets
   `$notebookHandoff`, then `handleNewChat()` and navigate to the chat surface;
2. `ChatView` mounts, its hand-off effect consumes the handoff and calls its own
   `handleSend`;
3. `$chatNotebookId` stays set for the life of that chat, and a second effect
   records the chat id on the notebook so "Past chats" can find it.

Two things there are load-bearing:

- **Publish the handoff AFTER navigating, never before.** `sendFromNotebook` does
  `handleNewChat()` → `await handleViewChange('home')` → `startNotebookChat()`, in
  that order, and `ChatView` consumes the atom *reactively* (`useStore`) rather than
  reading it once on mount. Setting it first meant ChatView started a turn inside
  its own mount, and the turn then **never finalised**: the thinking indicator span
  forever with no error and no reply, while the request had already failed upstream.
  Publishing last means the handoff lands on a mounted, settled ChatView — the same
  state a user typing into it is in.
- **`consumeNotebookHandoff()` flips a `consumed` flag rather than clearing the
  atom.** StrictMode double-invokes effects in dev, and a read-then-clear sends the
  turn twice — a dev-only duplicate that would ship unnoticed. It also makes the
  reactive effect safe to re-run as `handleSend`'s identity changes.
- **The effect is gated on `isAuthenticated`.** `handleSend` bails on
  `!isAuthenticated` by calling `onAuthRequired` and returning — no throw, no log.
  Consuming the handoff before auth resolves therefore *silently* dropped the
  message and never retried, which looks exactly like a dead button.

### Grounding goes in the system prompt, not the message

`getActiveNotebookGrounding` is called from inside ChatView's per-turn
`systemPrompt` array. The first implementation prepended the preamble to the user's
message instead, which was wrong twice over: the user saw "You are chatting inside
a notebook…" rendered as their own words, and only the first turn was grounded. The
system prompt is rebuilt every turn and is never rendered, so a source added
mid-conversation reaches the next turn.

### Retrieval, not the first N characters

`src/source-retrieval.ts` selects the passages that bear on the question asked.
Before it, grounding took each source's first 12,000 characters and sent the lot
every turn — so a long source was permanently truncated to its opening (ask about
chapter nine, the model saw chapter one) and cost grew with the notebook rather
than the question.

Google describes the same shape: "when your notebook contains many sources, Gemini
Notebook retrieves the most relevant information based on your question first, then
builds a response with this information." Both paths exist here for that reason —
**a corpus that fits inside `RETRIEVAL_BUDGET_CHARS` is sent whole and never
ranked**, since retrieving from a small notebook is worse and costs more.

| | |
| --- | --- |
| Chunks | ~1,100 chars, ~150 overlap, split on paragraph boundaries |
| Budget | 24,000 chars per turn (~6k tokens) |
| Default ranking | BM25 — no key, no network, no cost |
| Optional ranking | Gemini embeddings + cosine, via `systemDefaults.notebookSearch` |

Four things that are deliberate:

- **The setting mirrors `chatSearch` exactly**, down to `'linear'` meaning lexical
  and to degrading to lexical when the chosen model is no longer saved. One mental
  model for "search in Willow" rather than two — see `shell/SearchChats.tsx`.
- **An embedding failure falls back to lexical silently.** A rate-limited key must
  not turn a grounded chat into an ungrounded one.
- **A source whose passages all missed is still named** in the prompt, with a note
  saying nothing matched. A source the model is not told about is one the user
  thinks it read.
- **Passages are restored to document order** after ranking, and labelled with
  their character offset. Ranked order reads as a jumble when several passages come
  from one document, and without the offsets a model narrates across a gap as
  though the text ran on.

Chunk vectors are cached **in memory for the session**, not in IndexedDB — unlike
chat search, which persists them. Notebook chunks are small and bounded by what
localStorage holds, so re-embedding is one batched call; persisting would need a new
object store for a saving of one request per session.

`tools/scratch/retrieval-smoke.mjs` drives the pure halves with the answer planted
at the *end* of a 20k-character document — the case the old head-slice could never
reach — and checks it comes back.

## Measure at a real viewport — this cost a rebuild

Gemini renders **different components** at different widths. The Sources dialog was
first built from a probe taken at a 1075x350 viewport, where Gemini serves
`div.content.mobile-layout`: a back chevron and a "+" that opens the source types as
a popup menu. That is the narrow layout. At 1536x826 it is a **permanent left rail**
with an X close and no "+" anywhere.

The window was genuinely maximized the whole time — a stale
`Emulation.setDeviceMetricsOverride` from an earlier probe was shrinking
`innerWidth`. Overrides outlive the connection that set them.

**Before any measurement:** clear the override and *confirm* `innerWidth`, do not
assume it. `%TEMP%\wfmt\clearemu.mjs` does both. Record the viewport next to every
number you write down, or it cannot be checked later.

## Sources

`NotebookSourcesDialog`, measured at 1536x826:

| Element | Measured |
| --- | --- |
| dialog | 887x548, radius 28, `rgb(30,31,32)` |
| h2 "Sources" | [24,24] 20/24 w470 `rgb(227,227,227)` |
| subtitle | [24,48] 17/24 w400 — **also `rgb(227,227,227)`**, not muted |
| close (X) | [823,24] 40x40, i.e. 24px from the right edge |
| rail | 4 items at x=24, y=96/160/224/288 → **64px pitch**, each **174x56**, radius 16, `rgb(23,23,23)** |
| rail label | **13px/17px w400** — small, not a 16px menu row |
| empty state | centred in the pane to the RIGHT of the rail |

The four entries are **"Upload files" / "Add from Drive" / "Add websites" /
"Copied text"** — the last is not "Add text". Icons are mixed families again:
`add_2` Luminous, an inline four-colour Drive SVG, then `web` and `content_paste`
from **Google Symbols**.

Gemini's own rail is internally inconsistent (icon sizes 24/30/16/16, paddings
`8px 12px` vs `0 16px`, gaps 8/4/12/12) because the first two rows are a different
component from the last two. Icon size is reproduced per row; padding and gap are
unified on the majority values — the one deliberate simplification.

"Add websites" and "Copied text" open Gemini's secondary dialog: 600 wide, radius
28, `rgb(28,28,28)`, 24px inset, a 20/24 w470 title beside a 24px icon, a 15/20
subtitle, a 13/17 notes list, and an end-aligned accent button **disabled until
there is input** (disabled fill `rgba(224,224,224,0.12)`).

### A source's type icon is an image, not a glyph

`SourceIcon` paints a file with Drive's third-party type icon — the red PDF badge, the
blue Docs page — which is what Gemini does too. Measured on its sources chip: an `<img>`
with `src="https://drive-thirdparty.googleusercontent.com/32/type/application/pdf"`. The
same PNGs are vendored, so `fileTypeIcon` from `@willow/core/gemini-file-icon` resolves
one locally and no filename is sent to Google.

**Copied text is a type icon too**, `text/plain`, the blue page — not `content_paste`.
Gemini uses the clipboard glyph on the *rail*, where it names the action, and the type
icon on the source itself; measured on a copied-text source, which asks for
`/32/type/text/plain` in the chip and on its tile alike.

**A website gets the page's own favicon**, through the service and parameters Gemini uses:
`https://www.google.com/s2/favicons?domain=<the whole URL, encoded>&sz=32`. The `web`
glyph is the fallback for a site with no icon, on the `<img>`'s `onError`. This is the one
icon that does send a URL to Google, and it is not avoidable the way the vendored type
icons were: a favicon has to be fetched from somewhere, and asking the site directly means
guessing `/favicon.ico`, chasing `<link rel="icon">`, and handling every failure by hand,
all cross-origin.

**The trap this fixes is worth remembering, because it is silent.** Both icon faces are
subsetted to the ligatures Willow names, and a name the subset lacks renders as its own
letters — the letters *are* in the face, so the browser never falls through and there is
no blank box to notice. The chip asked for `description` from Luminous and the row for
`picture_as_pdf` from Google Symbols; neither is in its subset, so both drew stray
glyphs. Measure before trusting a name: a present ligature collapses to one advance
width, a missing one measures as the sum of its letters (`tools/scratch/lig-probe.cjs`).
The same bug had reached two surfaces outside this feature —
`platform/ui/src/RichResourcePreview.tsx` naming Luminous `draft` and
`features/spark/src/SparkSkillEditor.tsx` naming Luminous `description`. Both now ask
Google Symbols, and `draft` was added to that subset (192 icons) since it was in neither
face. The Luminous face cannot be extended the same way: it is served from an opaque
`gstatic.com/l/font?kit=` URL, not from the `css2` endpoint that `icon_names` works with.

### The chip stacks the LAST THREE sources

Each disc past the first is pulled 4px left, from Gemini's `variant-lm` rules — which live
in a **constructed stylesheet**, so `document.styleSheets` reports nothing and
`dumpCssRules` comes back empty. `tools/scratch/stacked-rules.cjs` reads them through the
CDP CSS domain instead, and that also reads rules for states the page is not currently in,
which is how the stack was first reproduced from a notebook holding one source.

Three things about it are easy to get backwards, and all three were:

- **Three discs, whatever the count.** A four-source notebook labels its chip
  "4 Sources" and draws three discs. The chip measures 154.1 wide at that count.
- **It is the TAIL that survives**, in list order. The three drawn against a source list of
  file / wikipedia / ai.google.dev / copied text were the last three, so
  `notebook.sources.slice(-3)`.
- **Newest paints on top.** Gemini writes an inline `z-index: 0` on *every* disc, so DOM
  order decides and the rightmost wins. Reading a one-source chip made that look like a
  descending z-index, which stacks them the other way round.

### Sources are tiles, not rows

`SourceTile`, in a grid — `project-file-upload-item` wrapping a `gem-attachment`. 112x112,
radius 20, `rgba(255,255,255,0.12)`, a 12px inset content box with the 24px type icon at
its top-left and the name pinned to its bottom at 13/17 `wdth 92`, plus a 20px white close
circle that is `visibility: hidden` until hover. The container is
`repeat(auto-fill, minmax(112px, 1fr))` with an 8px gap, which resolves to Gemini's
measured `121.8px x5` on the 641px pane exactly.

Two traps here:

- **It is not `GeminiAttachmentCard`**, though the box is identical to the pixel. Gemini's
  tile carries a `gem-attachment-notebook` modifier and shows an ICON where the composer
  variant shows the word "PDF" — `showsExtensionLabel` is true for PDF, text, audio and
  unknown, i.e. for half the sources a notebook is likely to hold.
- **A website tile is labelled with its URL, not the page title.** Measured
  "https://en...a_Showgirl" on a Wikipedia source. Willow has the title as well and it
  reads better, so it is the tooltip. Both labels come from `tileDisplayName`, Gemini's own
  arithmetic (strip a known extension, then middle-truncate to 20), which reproduces the
  measured strings character for character.

Gemini declares `height: 112px` on the container — one row, the rest scrolling. Willow lets
it wrap and grow, identical for the five that fit a row and no hidden sixth. The only
sample measured held four sources, so what Gemini does past five is unknown.

### A source being read is a spinner in the icon's place, and no text

While a PDF is extracted or a website fetched, `NotebookSourcesDialog` renders a tile per
in-flight source from its own `pending` list — `<SourceTile loading />` — after the stored
ones. The tile is the real tile: same 112px box, same name, same position in the grid, so
the source does not move when it settles.

`loading` changes exactly two things, and both match Gemini's `isLoading` /
`hideCloseWhileLoading` pair: the spinner replaces the type icon, and the remove button is
gone (there is nothing stored yet to remove).

**There is deliberately no accompanying text.** Willow used to print "Reading…" under the
dialog; that line and its `.nb-sheet-hint` rule are gone. Gemini says nothing — the spinner
is the whole affordance.

**It is a circular spinner, not a bar.** Worth stating because "loading bar" is the natural
way to describe it and it is wrong: Gemini's stylesheet for this component has 145
occurrences of `mdc-circular-progress` and **zero** of `mat-progress-bar`,
`mdc-linear-progress`, or `mat-spinner`. `TileSpinner` in `SourceTile.tsx` is MDC's own
structure at `diameter: 20` — container rotate plus two counter-rotating half-clippers and
a gap patch, at 1568.235 / 5332 / 1333 / 1333 ms. The `diameter` comes out of the compiled
template, where the spinner is bound with `[…,"gem-attachment-loading-spinner",3,"diameter"]`.

**The notebook variant is not the composer variant, and copying the composer's is the
mistake to avoid:**

| | composer tile | notebook tile |
| --- | --- | --- |
| `.gem-attachment-content.loading` | `align-items/justify-content: center`, `line-height: 0` | *no such rule* |
| spinner | centred in the tile | `position: absolute; top: 0; inset-inline-start: 0` |
| name while loading | dropped | kept |

So the notebook spinner stands in the icon's corner with the label still under it. Measured
live in Willow: `spinnerOffsetInContent` is `{dx: 0, dy: 0}` against the content box —
exactly where `.nb-src-tile-icon` sits — colour `rgb(230,230,230)`, `line-height: 0`, circle
`stroke-width 20%`, `dasharray 50.2655px`, `dashoffset 25.1327px`, and all four animations
`running`.

**Four rules in `notebooks.css` are load-bearing, and `left: -100%` is the one that bit.**
Every item here was a divergence from MDC that shipped and had to be fixed:

| rule | on | why it matters |
| --- | --- | --- |
| `left: -100%` | `.nb-spinner-clip-right .nb-spinner-graphic` | The graphic is 200% of a 50%-wide clipper, so at `left: 0` the window falls on the circle's **left** half — correct for the left clipper, wrong for this one. Without it both clippers draw the same half; since they counter-rotate, the two copies render mirrored and the spinner draws an **S-shaped wave**, not an arc. |
| `direction: ltr` | `.nb-src-tile-spinner` | MDC pins it because the clipper arithmetic is physical (`left: -100%`, `left: 47.5%`), not flow-relative. |
| `font-size: 0; letter-spacing: 0; white-space: nowrap` | `.nb-spinner-rotator` | The clippers are inline-level, so any whitespace between them becomes a word space that shifts the halves apart. |
| *no* `stroke-linecap` | `.nb-spinner-graphic circle` | Willow had `square`, which adds ~2px of arc per end on a 4px stroke in a 20px box. No capture contains the word `linecap` at all, so MDC keeps SVG's default `butt`. |

Reduced motion also needs `stroke-dasharray: 0 !important` alongside `animation: none`, or a
frozen half-circle is left on screen. MDC does the same in its `_mat-animation-noopable`
block, and `!important` is needed for the same reason it is there: `SourceTile` sets
`strokeDasharray` inline. Note that Gemini's own captured CSS has **no**
`prefers-reduced-motion` rule — that block is Willow's own call, not a port.

**How this is known, and why the previous check missed it.** An earlier pass called the
spinner verified on the strength of rects, computed styles and `playState` — none of which can
tell a wave from an arc, because the box is 20×20 either way and all four animations run in
both cases. `tools/scratch/spinner-vs-mdc.cjs` settles it instead by building **MDC's own
spinner from its own class names** out of `captures/notebooks/src-chip/gemini-spinner.css`,
mounting it beside Willow's, seeking both to the same `currentTime`, and comparing lit pixels.
Current result: **identical at all nine phases of the 1333ms cycle** — 17/80/230/279/289/224/77/28/18
lit pixels, zero pixels unique to either side, IoU 100%, and the four durations match
(1333/1333/1568/5332ms).

A third mount puts the same markup inside a real `.nb-src-tile`, because isolation cannot prove
the shipped tile draws it: there the spinner inherits its colour, sits under `overflow: hidden`
on a 20px radius, and shares a stacking context with the name. Measured: `radius 20px, overflow
hidden, spinner at +12/+12 from the tile corner, inherited colour rgb(230, 230, 230)`, and
**zero missing pixels at all nine phases** — so nothing is clipped. The extra ink the tile adds
(100px across nine phases) is all 8-neighbour-adjacent to MDC's arc, i.e. anti-aliasing against
a different backdrop; 1px total is isolated. `captures/notebooks/src-chip/willow-vs-mdc-spinner.png`
is the three-row strip, and the rows are visually indistinguishable.

`captures/notebooks/src-chip/willow-spinner-pending-wave-bug.png` is kept deliberately: it is
the dialog with a pending tile drawing the **wave**, i.e. what the bug looked like. Don't mistake
it for current behaviour — a passing `willow-spinner-verify.cjs` run writes
`willow-spinner-pending.png` instead.

**Known but unmeasured:** the notebook variant also declares
`.gem-attachment-processing-info` — a muted line under the name
(`padding-block-start: var(--gem-sys-spacing--xs); line-height: 1em;
color: var(--gem-sys-color--on-surface-variant)`) — with an error variant
`.gem-attachment-processing-error` in `--gem-sys-color--error`. Reading the compiled
template for it returned template names and node counts but no bodies, and there is no
capture of it populated, so it is *not* implemented rather than guessed at. If a per-source
error or progress line is wanted later, that is the hook Gemini uses; measure it first.

### Verifying the loading state — the traps

Two scripts, and they answer different questions. `tools/scratch/willow-spinner-verify.cjs`
checks the tile is *wired up* — that a pending source renders one, in the right place, with its
animations running. `tools/scratch/spinner-vs-mdc.cjs` checks it is *drawn correctly*, by
diffing pixels against MDC's own spinner. The first cannot detect a mis-drawn arc; that is how
the wave shipped.

**Compare against a real oracle, not an invented one.** Three plausible-sounding invariants
were tried against the shape and all three were wrong: "ink either side of centre" (the arc
shrinks to ~25°, which fits in one quadrant), "one contiguous arc" (at t=0 the graphics sit at
`rotate(265deg)` and `rotate(-265deg)`, 170° apart, so each clipper catches a ~5° sliver and
MDC's minimum is legitimately **two** nubs 180° apart), and 360-degree binning to count runs
(the ring is r=8, ~50px of circumference, so five bins in six are empty by construction and
one arc reads as ten pieces). Each reported a failure against a correct spinner. The captured
stylesheet *is* MDC, so render it and diff — don't reason about what the shape ought to be.

- **IoU is the wrong criterion at these pixel counts, even against a real oracle.** The tile
  comparison first scored overlap-over-union and reported `FAIL — worst 72%` on a render whose
  ink was a strict *superset* of MDC's: at the 18-lit-pixel phase, seven anti-aliased edge
  pixels move IoU by 28 points. Ask the two questions that carry a verdict separately —
  **missing** ink means something clipped it, **isolated extra** ink (no lit 8-neighbour in the
  reference) means a stray graphic. Extra ink touching the arc is anti-aliasing and means
  nothing; don't let it fail a build.
- **The CDP probe window cannot reach notebook content.** It renders the notebooks splash
  (`nb-splash-*`) and its handle store is empty, so `.nb-card` never appears and loading a real
  notebook URL gives `hasSourceChip: false` — see the "probe Chrome has no local folder" note.
  So `willow-spinner-verify.cjs` cannot currently complete there, and the live-tile question is
  answered by *mounting* the shipped tile in `spinner-vs-mdc.cjs` instead of driving the dialog.
  That mount is weaker in one specific way — it does not exercise `SourceTile`'s pending branch
  or the fetch that triggers it — so treat it as covering the *drawing*, not the wiring.
- **Interception is only as durable as the process that owns it.** A held request is
  *released*, not dropped, when the driver dies — an earlier run was killed by a timeout,
  Chrome completed the request it had been holding, and a real source landed in the user's
  notebook. Assume anything you hold will complete if the script exits badly, and note that
  the CDP window sees the user's real notebook data, not an empty storage scope.
  `spinner-vs-mdc.cjs` avoids this class of hazard entirely: it never touches
  `/api/fetch-source`, the dialog, or the notebook, mounting the spinner's markup directly
  against the app's already-loaded stylesheet.
- **`requestAnimationFrame` samplers hang here.** Chrome stops rAF in a window nobody is
  looking at, so the promise never settles and it reads as a hung script rather than a
  failed check. `getAnimations()` reports `playState` off the timeline with no frames
  required — that is what proves the spinner is running, and `animation.pause()` plus a
  `currentTime` write is how to compare a specific phase deterministically.
- **An element outside the document has no animations.** `getAnimations()` returns `[]`, so
  pausing and seeking a detached clone is a silent no-op and every cell of a phase strip
  renders the same live frame. Append the cell *and its column* first, then clone, then seek —
  and assert the clone reports animations, because the failure is invisible in the numbers and
  only shows up in the image.
- **`browser.pages()` is not a cheap call.** It attaches a session to every page target in the
  browser; with a dozen heavy tabs open it took **over 12 seconds** on this machine. The
  `openOwnWindow` in `scrapers/notebooks/lib.cjs` used to poll it every 200ms against a 30s
  deadline, which bought about two attempts and then failed as "opened a window but never
  found its page". It now scans `browser.targets()` — a synchronous list read, ~1ms — and
  attaches only to the target it just created. Sub-second.
- **`console.log` after a stack of awaits tells you nothing.** `lib.cjs` connects with
  `protocolTimeout: 0`, so a stalled CDP call hangs forever and an outer `timeout` kills the
  run with an empty log. Announce each step before awaiting it and cap it individually.
  Relatedly, `cmd 2>&1 | tail` reports **`tail`'s** exit status — redirect to a file if the
  script's own status matters.

Two selectors that bite: the rail entry is `.nb-src-rail-item` labelled **"Add websites"**
and its confirm button is `.nb-sub-confirm` labelled **"Insert"**, not "Add"; and a bare
`querySelector('textarea')` picks the notebook page's *composer*, which precedes the
portal-rendered dialog in document order — scope to `.nb-sub-textarea` or the typing goes
nowhere and Insert stays disabled. A tile's `title` attribute is the source's **title**, not
its URL.

**The capture was malformed, and silently.** `gemini-spinner.css` had 12 unbalanced braces:
`gemini-spinner-css.cjs` collected each `@keyframes` block properly with a brace matcher, but
its *rules* regex also matched those blocks — their names contain `mdc-circular-progress` —
and `[^}]*\}` truncated them at the first inner brace. One unclosed at-rule makes Chrome's
parser swallow every following rule as a keyframe selector, so the file applied almost
nothing: MDC's reference spinner mounted with **zero** animations. The scraper now filters
keyframes out of the rules match, and the 12 truncated fragments were dropped from the capture
(each duplicated a block already stored in full above the `---- rules ----` marker, so no
information was lost). Worth knowing generally: a saved stylesheet that *looks* fine can apply
almost none of its rules, so assert the reference actually animates before trusting a
comparison against it — agreeing with an invisible oracle is not agreement.

### Not replicated

- **Add from Drive is inert.** Gemini opens Google's picker against a Drive-scoped
  token. The row is present because its absence is more wrong than its being
  disabled, and it says so on click rather than failing silently.
- **Website text is fetched through `/api/fetch-source`**, a zero-config function
  beside `api/image.js`, mounted for dev by `sourceFetchEndpoint()` in
  `apps/studio/vite.config.ts` so both environments run the same handler. A browser
  cannot read a cross-origin page, so this is the one source type that genuinely
  needs a server — Gemini does the same, scraping the URL when it is added and
  storing a static copy of the text.

  It is **closed unless `SOURCE_FETCH_ENABLED` is set** (the dev plugin sets it),
  because deployed it is both an open scraping relay and an SSRF surface. There is
  deliberately no host allowlist — unlike the image proxy — since the user is
  adding arbitrary sources; the guard is a private-address check applied to the
  URL *and* to wherever it redirects. A page that cannot be read is still stored as
  a link, which is what every URL used to be.

  Chose this over `services/agent-builder`, which already has document extraction
  and is mounted same-origin in dev: that package owns the workflow engine and its
  database, and hanging notebook ingestion off it would break sources in any
  deployment where Agents is not running.

  `tools/scratch/fetch-source-smoke.mjs` drives the handler directly — no browser,
  no server — and covers the refusals as well as two real pages.
- Images under `MAX_INLINE_SOURCE_BYTES` keep a data URL; anything else with no
  text extractor is recorded by name and type.

### Extraction runs in the browser, on purpose

`src/source-extract.ts` turns an upload into text: `pdfjs-dist` for PDF, `mammoth`
(its **browser** build — the package root wants Node's `fs`) for DOCX, `FileReader`
for the ~40 text extensions. Both parsers are `import()`ed inside the branch that
needs them, so a notebook of `.md` files never downloads pdf.js, which is ~1MB with
its worker.

`services/agent-builder/src/rag/extractText.ts` already does this server-side, and
it is mounted same-origin in dev — so routing uploads there was the obvious
alternative and was **deliberately not taken**. Notebooks are documented to work
with nothing else connected; posting every upload to a service would make "add a
source" fail on a profile that has never started one, for the same reason the
registry is scoped localStorage.

Three things worth knowing before changing it:

- **A scanned PDF yields nothing, and that is reported.** pdf.js returns the text
  layer; a scan has none and there is no OCR. `ExtractionResult.problem` carries
  the reason and the source is stored **without** `content`, so the grounding block
  lists it as unreadable. A silently empty source is worse than an absent one — the
  model would treat it as available and fill the gap.
- **`MAX_STORED_CHARS` is 400k and it is a storage bound, not a context bound.**
  Sources live in localStorage, whose quota covers the whole origin and is shared
  with the notebook registry, the media index and chat metadata. A 400-page PDF
  exceeds a million characters on its own.
- **The loading task is destroyed, not the document.** `PDFDocumentProxy` has no
  `destroy`; releasing the worker means holding `getDocument(...)`'s task. Pages
  are also `cleanup()`ed as they are consumed, or a long document holds every
  rasterised page at once.

## The composer never moves

Gemini's composer is at **identical coordinates on the notebook page and the
new-chat page** — `x 582, y 380.8, 660x64`, same `is-zero-state` class. That is why
it appears not to reload or shift when you switch between them.

Two things follow, and both were wrong at first:

- **The composer is 660 wide and flush with the column; the title is inset 16px.**
  Willow originally had it the other way round, so the composer rendered 628 wide in
  a notebook and 660 on home and visibly resized on every open. `.nb-page-composer`
  now breaks out of the column padding with `margin: 28px -16px 0`.
- Verified after the fix: notebook textarea vs home textarea is **dx 0, dw 0** (1px
  in y), against Gemini's exact 0.

## Past chats

Measured on a Gemini notebook with two chats:

| Element | Measured |
| --- | --- |
| heading | `margin: 36px 0 16px`, 15/20 **w540**, `rgba(255,255,255,0.55)` |
| row | `project-chat-row`, **48px** tall, stacked with **no gap** |
| row title | 15/20 **w400**, `rgb(227,227,227)`, truncated |
| date | 15/20 w400, `rgb(154,155,156)`, right-aligned |
| glyphs at rest | **none** |
| on hover | a `more_vert`, revealed with `visibility` (opacity stays 1 — no fade) |

Three mistakes worth not repeating: a leading `chat_bubble` (no such icon exists in
Gemini's row), treating the heading's `padding-left: 16px` as an indent to copy (the
notebook title, the heading, and every row title are **flush on one x**; that padding
only exists because Gemini's heading sits in a wider container), and shipping without
the hover menu.

### The skeleton is recorded, not invented

Captured by remounting Gemini's chat-history component through an in-app navigation
— a full reload kills the sampler before the skeleton paints:

| Element | Measured |
| --- | --- |
| `.skeleton-loader-row` | 644x42 |
| `.skeleton-loader-column.alt-1` | 283x18, radius **12** — the title bar |
| `.skeleton-loader-column.alt-2` | 40x18, radius **9999** — the date pill |
| fill | `rgba(196,199,197,0.08)` |
| animation | `pulse` **1500ms linear infinite**, the pill delayed **100ms** |

Re-measured frame by frame during a real notebook open (`tools/ui-research/captures/notebooks`),
which also put a stopwatch on it: the skeleton is up from **1567ms to 1785ms** after
the click — about 220ms. The **100ms delay on the pill** is the detail most likely to
be dropped as noise; without it the bar and the pill dim together and the row reads
as one blinking block rather than Gemini's looser rhythm.

The keyframes are **asymmetric** — `0% {opacity:1} 33% {opacity:0.5} 100% {opacity:1}`.
The midpoint is at 33%, not 50%, so it dims fast and recovers slowly; a symmetric
pulse reads as a different rhythm.

Rows come from joining `notebook.chatIds` (which owns the ORDER) against LocalFS's
`localChats` (which owns the metadata). `NotebookPage` reads the context itself
because `App` renders `LocalFSProvider` and therefore sits above it. The filter that
drops unknown ids is **skipped when `localChats` is empty** — an unavailable chat
index is not the same as "every chat was deleted".

Unnamed chats still carry their temp id, and a raw `2026-08-16T08-40-23_b74vqr` is
not a title; those render as **"Untitled"**, matching `Sidebar.tsx`.

The row menu's "Remove from notebook" **unfiles, and unfiling is not deleting** —
the chat's file moves back into the workspace's global `Chats/` and it reappears in
Recents. It does not delete data.

**A filed chat is dropped from Recents while it is filed**, which is deliberate and
matches where its file now is: `sortedChats` in `Sidebar.tsx` filters out any id a
notebook owns. That filter is **display-only** and must stay that way — the rows
here are validated against the same unfiltered `localChats`, so actually removing
the ids from the chat index would empty every notebook's Past chats list.

## Verified behaviour

Measured against Gemini's own 0-source notebook, the page matches within 1px
vertically — emoji 257, title row 306 (Gemini 305), composer 382 (381),
"Past chats" 502 (501), empty state 538 (537).

Chat was verified end to end: the composer submits, the hand-off lands on the chat
surface, the prompt appears as the user's message with no preamble leaking, and the
chat id is written to the notebook's `chatIds`.

**Notebook chat and normal chat are the same code path** — confirmed by sending the
same prompt both ways under an identical API failure and getting identical
behaviour. Errors surface the same way in both: a 429 shows "Something went wrong /
Show error" plus a retry line, but only after the provider retries are exhausted,
which took ~12.5s. Anything watching for less than that sees an empty assistant
turn with the stop button still up, and will wrongly conclude the notebook path is
broken. It is not — check the network tab for the real status before debugging.

## Sidebar row geometry — do not re-derive

Gemini's `a.gem-nav-list-item` and Willow's `<SidebarItem>` already agree to the
pixel by different arithmetic. Gemini: 8px row padding + 24px icon slot + 8px gap
→ label at x=46. Willow: 6px wrapper + 6px padding + 28px icon box + 6px gap →
label at x=46, icon centred at x=26, which is exactly where Gemini's 28px
`gem-icon` sits. The section renders through the shared primitive so it inherits
the collapsed-rail tooltip and active state; there is no private row type.
