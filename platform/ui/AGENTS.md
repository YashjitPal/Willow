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
