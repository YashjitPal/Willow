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
| `src/GeminiAttachmentCard.tsx` · `src/RichResourcePreview.tsx` | Attachment/link previews. |
| `src/TopLoadingBar.tsx` | Route-transition progress bar. |
| `src/Tooltip.tsx` + `.css` | Gemini's tooltip. Every value measured off gemini.google.com — see below. |
| `src/hooks/use-auto-resize-textarea.ts` | Grows a textarea to fit its content. |

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

## Dependency constraint

**`platform/ui` must never import from `features/` or `apps/`.** It imports
`@willow/core` (13 call sites, mostly `cn()`) and nothing else in the repo. If a
component needs feature data, take it as a prop.

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
