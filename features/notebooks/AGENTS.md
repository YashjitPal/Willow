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
