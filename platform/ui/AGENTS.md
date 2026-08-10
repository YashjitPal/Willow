# platform/ui

Shared presentational components. Buttons, inputs, avatars, markdown rendering,
and the animated backgrounds. No feature logic, no data fetching — a component
here should work the same whether it is rendered by Chat, Code, or Media.

## Files

Primitives (shadcn-style, `class-variance-authority` + `cn()`):

| Path | Role |
| --- | --- |
| `src/button.tsx` | Button with variants. |
| `src/input.tsx` · `src/textarea.tsx` · `src/label.tsx` · `src/checkbox.tsx` | Form primitives. |

Willow-specific:

| Path | Role |
| --- | --- |
| `src/StreamingMarkdown.tsx` | Markdown renderer for LLM output (1638 lines). KaTeX math, GFM, syntax highlighting, streaming-safe partial parses. |
| `src/streaming-markdown-styles.ts` | The renderer's injected stylesheet + `useInjectStyles` (522 lines). |
| `src/MaterialSymbol.tsx` | Material Symbols icon by name. |
| `src/Avatar.tsx` · `src/AgentIcon.tsx` · `src/CanvasIcon.tsx` | Iconography. |
| `src/GeminiAttachmentCard.tsx` · `src/RichResourcePreview.tsx` | Attachment/link previews. The tile is measured off Gemini — see below. |
| `src/GeminiBentoCard.tsx` + `src/gemini-cards.ts` | Gemini's `bento-card` tiles and the flex packing that lays them out. Every value measured — see below. |
| `src/GeminiInlineImage.tsx` | Gemini's markdown `.inline-image-container`: floated image plus a credit/alt caption. |
| `src/TopLoadingBar.tsx` | Route-transition progress bar. |
| `src/Tooltip.tsx` + `.css` | Gemini's tooltip. Every value measured off gemini.google.com — see below. |
| `src/hooks/use-auto-resize-textarea.ts` | Grows a textarea to fit its content. |
| `src/github/GithubImportDialog.tsx` + `src/github/repository.ts` | The composer's "Import code" dialog and its GitHub client. Lived in `features/code` until it was noticed that Code never used it and Chat did — see below. |

Decorative / animated:

| Path | Role |
| --- | --- |
| `src/shader-lines.tsx` · `src/wave-shader.tsx` | WebGL animated backgrounds (the `lines` and `waves` options). |
| `src/cpu-architecture.tsx` + `.css` | Animated CPU diagram. |
| `src/rainbow-button.tsx` · `src/shimmer-button.tsx` · `src/interactive-hover-button.tsx` | Decorated buttons. |
| `src/text-shimmer.tsx` · `src/animated-streaming-text.tsx` · `src/message-loading.tsx` | Loading/streaming affordances. |
| `src/ai-input-with-loading.tsx` | Input with a built-in loading state. |

## The big one

`StreamingMarkdown.tsx` (1638 lines, was 2147) renders LLM output as it streams.
Its stylesheet — ~500 lines of string-array CSS — now lives in
`streaming-markdown-styles.ts`, injected once via `useInjectStyles`. That is
harder than it sounds: the parser must tolerate *partial* markdown (an unclosed
code fence, half a table row) and re-render without flickering as more text
arrives. It also handles KaTeX math, GFM tables, and syntax highlighting. Read
carefully before changing — most of its length is edge cases that were hit in
practice.

## Tooltip

`Tooltip.tsx` + `Tooltip.css` reproduce Gemini's tooltip. Not "in the style of" —
every value in the CSS was read off gemini.google.com with `getComputedStyle`.
Gemini's authored tooltip CSS is unreachable (4459 rules across 75 sheets, none
matching `/tooltip/`; one gstatic sheet is CORS-blocked), so the computed
cascade is the only ground truth and the stylesheet is that cascade written
back out. **Do not "clean up" the values.** `letter-spacing: 0.096px`,
`min-width: 40px`, `box-sizing: content-box` on the wrapper and
`max-height: 40vh` (measured 330.24px against an 825.6px viewport) are all real.

```tsx
<Tooltip content="Open sidebar" position="right">
  <button aria-label="Open sidebar">…</button>
</Tooltip>
```

The child must be a single element that forwards `ref` and DOM handlers. It
receives `aria-describedby` plus enter/leave/focus handlers; the accessible name
is a visually-hidden `role="tooltip"` node and the visible box is `aria-hidden`,
which is Gemini's own arrangement.

Behaviour, all measured: no show delay, no hide delay, 150ms
`cubic-bezier(0, 0, 0.2, 1)` in, 75ms `cubic-bezier(0.4, 0, 1, 1)` out, 8px gap
on every side, and a flip to the opposite side when there is no room.

Edge clamping is deliberately asymmetric — `MARGIN_NEAR = 8`, `MARGIN_FAR = 15`,
confirmed at three viewport widths. Do not average them; CDK compares overflow
against the viewport's *width* rather than its right edge, which is where the
difference comes from.

### `title=` is the app-wide opt-in

`<GlobalTooltips />` is mounted once in `apps/studio/src/main.tsx` and swaps the
native bubble for this one at every `title=` site — around 230 of them — without
touching any of them. It strips `title` to `data-willow-tooltip` on `mouseover`
(capture phase, so it beats Chrome's dwell) and restores it on the way out,
mirroring the text into `aria-label` only when the element has no name of its
own.

Two consequences, both of which have already been reported as bugs:

- **No `title`, no tooltip, ever.** `GlobalTooltips` anchors solely on
  `closest('[title]')`. A collapsed sidebar rail row needs
  `title={isCollapsed ? label : undefined}` or it stays silent — and do not
  hand-roll a bubble instead. The old ones sat at `left-[46px]` (x=64) inside a
  52px rail and were clipped away entirely by the scroll wrapper's
  `overflow: auto`. A portal cannot be clipped by an ancestor; that is the point.
- **Any `title` tooltips instantly.** Attributes that were effectively invisible
  behind the native dwell delay now show immediately. This is why the response
  three-dot menu rows carry no `title`: `disabled` + `aria-disabled` already
  carry unavailability, visually and to AT.

Placement defaults to `below`; opt into another side with
`data-tooltip-position="right"` on the trigger. The collapsed rail uses `right`,
measured against Gemini's own rail (pane `left` == anchor `right`, gap 8,
vertical centres equal).

`apps/studio/test/tooltip-triggers.test.mjs` pins both directions.

## Attachment tiles

`GeminiAttachmentCard.tsx` is Gemini's attachment tile, transcribed rather than
designed. The decision logic it runs on lives in `platform/core`:
`gemini-file-tables.ts` (generated — five index-aligned lookup tables lifted from
the bundle), `gemini-file-info.ts` (the ported functions, each naming its Gemini
original), and `gemini-file-icon.ts` (mime → vendored PNG).

**Shape is decided by extension, never by mime.** Gemini's template picks the
cover-cropped thumbnail via `q_c`/`dK`, both of which test only the filename's
extension. So a PNG served as `application/octet-stream` still gets a thumbnail,
and an `image/png` named `report` does not. Willow's own `detectAttachmentKind`
(`platform/core/src/attachments.ts`) matches on mime **or** extension, so the two
disagree on exactly those cases — do not wire `attachment.kind` into the tile. A
test pins this.

**The generic tile shows a label or an icon, not both.** `showsExtensionLabel`
returns true for PDF, TEXT, AUDIO and UNKNOWN — the four types whose Drive icon
says no more than the word does. Everything else gets the 24px icon. Note that
`md` is in the code-extension table, so markdown is CODE and takes the `text/code`
bracket icon, not a "MD" label.

The box: 112×112, 20px corners, `rgba(255,255,255,0.12)`, `overflow:hidden`, and
a content box on the floor holding the name. **That content box's inset differs by
shape — 8px over a thumbnail, 12px on a generic tile** — and it is the close
button's containing block, so the button inherits that inset rather than sitting in
the tile's own corner. Measured: image `594+112−20−8 = 678`, generic
`834+112−20−12 = 914`.

Strip pitch is 120 = 112 + an 8px gap.

**Gemini's `margin-inline: -12px` on the strip is load-bearing, not decoration.**
It cancels `.text-input-field`'s own `padding: 12px` so the strip spans the
container's full border box, and the re-added `padding-inline: 12px` is what places
the first tile. Measured live: wrapper x == fieldset x == 582, first tile x == 594.
Willow's strip must cancel its shell's padding the same way — `-ml-[14px] -mr-[15px]`
in the chat variant, `-mx-2` in the standard one. An earlier pass skipped this on the
theory that `px-3` already positioned the tiles; it does not, and the result was a
first tile at 26px against Gemini's 12px, reported as an unexplained left gap. The
full-width span is also what puts the mask's 12px fade exactly on the tile edge.

`pr-[54px]` on the chat strip is ours, not Gemini's: the maximize toggle is
absolutely positioned at `right-[-7px] top-[8px]` at 40×40 and tiles must clear it.
Gemini has no control there and uses a symmetric 12px.

**Do not wrap the strip in an `overflow-hidden` box.** The negative margin pulls the
strip wider than its parent, so any clipping ancestor slices the first tile. Willow
had exactly that — an `overflow-hidden` div at x=588.4 around a strip at x=574.4,
left over from a `grid-rows-[0fr]` height animation — and it cut 2.4px off the first
tile's left edge, which showed as a dark strip under the corner radius. The layout
reported no gap; only a pixel read of the rendered frame found it (`getBoundingClientRect`
said the image and tile rects were identical, because clipping happens at paint).
The strip is now rendered conditionally instead. Gemini does the same: its `row-gap`
rule keys off `:has(.attachment-preview-wrapper)`, which only means anything if the
wrapper is absent when nothing is attached.

**Nothing about a tile animates.** The close button is revealed by
`.gem-attachment-tile:not(.is-mobile):hover .gem-attachment-close-button
{ visibility: visible }` with `transition: all 0s`, so it snaps in. Detaching is the
same: every element in the strip computes `transition-duration: 0s`, no `@keyframes`
matches `/attach|chip|preview/`, and the strip carries no `ng-trigger-*` class, so
there is no Angular runtime animation either. The tile is removed and the flex row
reflows. Willow's old fade/zoom entrance and its 200ms removal hold were both
inventions and are gone.

The glyph is `close` in `Luminous Symbols` at 16px, `font-variation-settings:
"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 16, "wght" 330`, black on a white 20px pill.
The `mat-icon` carries no text — the ligature is a `::before` whose `content` is
`"close"`.

Attaching a file does **not** switch Gemini's composer into a different layout. The
3-row grid comes from `with-toolbox-drawer`:

```css
.text-input-field:where(.with-toolbox-drawer):not(.simplified-input-area):not(:has(.input-companion-wrapper))
  { grid-template: "file-preview" auto "text-input" auto "leading-actions … trailing-actions" 1fr; }
.text-input-field:has(.attachment-preview-wrapper) { row-gap: 8px; }
```

The strip merely fills a row that was already declared, so the box grows by
112 + 8 = 120px. Height with five files attached decomposes exactly:
12 + 112 + 8 + 40 + 8 + 38 + 12 = 230.

Willow reaches the same two-row arrangement through `shouldExpand` in
`use-composer-textarea-autosize.ts`, which already handled tool chips and wrapped
text — attachments simply were not an input to it. Wired, the chat composer measures
64px → 234px on attach against Gemini's 230px. The remaining 4px is internal
distribution, not total: top padding (12) and bottom padding (15) match, while
tile→editor is 24 against Gemini's 12 and editor→controls is 15 against 23. Closing
that needs Gemini's *unattached* baseline, which cannot be measured while files are
in its composer.

Two things are deliberately **not** implemented, both for want of ground truth:
the message variant's multi-file layout (item 2 of the prompt-box work), and the
video tile's duration overlay — Gemini defines a bottom scrim for the media
variant but does not emit it on live tiles, so inventing one was the wrong call.

The tooltip needs no code here: the tile passes the **full** filename, extension
included, as `title=`, and `GlobalTooltips` does the rest (see above). The visible
label is middle-truncated to 20 characters; the tooltip is not.

`apps/studio/test/gemini-attachment-tile.test.mjs` pins the shape decision, the
label/icon split, the box, the close button and the strip.

## Cards and inline images

Both are transcribed from the running Gemini app, not designed. The header
comment in each file records where every number came from; the reasoning lives
there rather than here, so it stays next to the code it constrains.

**There are two image hosts, and they are different Gemini components.** Sending
one down the other's path is the mistake to avoid:

- `GeminiSingleImage` — Gemini's `single-image`, the centred hero. Emitted for an
  image *attachment* on the response; live, it hangs off
  `div.attachment-container.search-images`, a block-level sibling of the prose,
  which is what an "images of …" answer actually produces. Centred, capped at
  580px landscape / 400px portrait, caption beside it. `StreamingMarkdown` routes
  an image alone in its own paragraph here.
- `GeminiInlineImage` — the markdown renderer's `.inline-image-container`, for an
  image written *into* prose. Floated right, capped at 362px.

Five things worth knowing before touching them:

- **An in-prose image is hoisted out of its paragraph, and that is a parser fact
  rather than a style choice.** Gemini's host writes markdown as an HTML string,
  so `<p>before<div>…</div>after</p>` parses as `<p>before</p>` + the div +
  `"after"` — verified against Chrome's parser, and a `<span>` in the same slot
  stays nested, so it is the block display that causes it. React builds via the
  DOM API and would nest instead, so `hoistableInlineImage` reproduces the hoist
  explicitly.
- **The hero button is 384px around a 380px image, and the 4px is a line-box
  descender.** The `<img>` computes `display: inline` / `vertical-align:
  baseline`; adding `display: block` silently eats those 4px. Confirming this
  cost seven probes that all read 0 — because `about:blank` is **quirks mode**,
  where the strut is dropped. Measure line-box geometry inside a doctyped
  iframe or the number is a lie. Height arithmetic: 384 + 8 + 40 = 432.
- **The hero caption is two nodes, not one.** Live it is a bare text node
  holding the description, then a `<span>` holding only the source — the
  surrounding spaces are the separator, so they are written as explicit string
  literals that JSX will not strip. Markdown's `alt` supplies the first half and
  its title the second.
- **Source order is load-bearing in the inline-image CSS.** The authored sheet
  puts the `@media (min-width: 768px)` float block *before* the
  `.landscape`/`.portrait` caps, so the orientation cap overrides the block's
  `max-width: 40%`. A probe in the live 708px panel measured 362px, not 283px.
  Reordering those rules silently changes the width.
- **A `@media (max-width: 959.98px)` rule that undoes the float exists in the
  captured CSS and is deliberately not reproduced.** It targets
  `.hero-overlay-container` / `.hero-image`, which belong to the separate
  `single-image` component. Copying it would kill the float at every width the
  panel actually renders at.
- **Cards arrive as a fenced block**, language `bento-cards`, carrying a JSON
  array. There is no field on `ChatMsg` for them and the public Gemini API does
  not expose the app's bento payload, so the fence is a Willow convention. It is
  taught to Gemini only, via `chatSystemPromptFor` in `features/chat/src/chat-model.ts`.
  While the JSON is still streaming it does not parse and nothing renders — that
  is deliberate, so a half-arrived block never flashes as a code block.
- **Cards are rigid, and the bento layout is a recursive tree.** Gemini authors
  it server-side: nested flex rows and columns, `flex-grow: 0`, width equal to
  `min-width`, `flex-wrap: nowrap` throughout. So the tiling is
  count-dependent — two cards are not three cards minus one — and it is built by
  splitting a tree in `gemini-cards.ts`, not by a packing heuristic. A card's
  picture is a CSS `background-image`, which fires no error event, so a broken
  URL is detected with an off-DOM `new Image()` probe and filled with the same
  `#35383b` placeholder token the hero uses.

`apps/studio/test/gemini-cards.test.mjs` pins the measured geometry, the
attribution rules, the packing arithmetic, the type scales and the wiring.

## The GitHub import dialog

`src/github/` is the composer's "Import code" flow: paste a repository URL, and
`repository.ts` walks the public GitHub API, packs the text files it finds
(subject to the size and count caps at the top of the file) and returns a single
`'github'` `ComposerAttachment`. `GithubImportDialog.tsx` is the modal around it,
plus an "Upload folder" escape hatch that hands raw `File`s back to the caller.

It sat in `features/code/src/github/` for a long time, on the reasonable-sounding
theory that importing a repo is a Code concern. It is not — Code never imported
it. The only consumer was Chat's composer, which had to reach across into another
feature to get at it, and that single edge was the whole of Chat's dependency on
Code. Willow Chat, Willow Code and Willow Media are three independent agents;
that edge made them look coupled when they were not.

It lives here rather than in `platform/core` because `platform/core` bans I/O and
API clients, and `repository.ts` is a `fetch` client. The dialog and its client
stay in one directory: the caps, the priority-filename list and the dialog's
error copy are one design, and splitting them across packages to satisfy a
purity rule would cost more than it buys.

## Dependency constraint

**`platform/ui` must never import from `features/` or `apps/`.** It imports
`@willow/core` (14 call sites, mostly `cn()` and the attachment types) and
nothing else in the repo. If a component needs feature data, take it as a prop.

<!-- related-packages -->

## Related packages

**This package imports from:**

- [`platform/core`](../core/AGENTS.md) — utilities, types, constants

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/agent-builder`](../../features/agent-builder/AGENTS.md) — the Agents workflow canvas
- [`features/auth`](../../features/auth/AGENTS.md) — login / account UI
- [`features/chat`](../../features/chat/AGENTS.md) — the standalone chat surface
- [`features/code`](../../features/code/AGENTS.md) — the Workbench: sandbox and visual editing
- [`features/design`](../../features/design/AGENTS.md) — the design surface
- [`features/media`](../../features/media/AGENTS.md) — AI image and video generation
- [`features/spark`](../../features/spark/AGENTS.md) — scheduling / background-task agent

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
