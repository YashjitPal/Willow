# features/media/src/tools/harness

The Tool Builder's agent: a fork of the Code tab's harness
([`features/code/src/harness/`](../../../../code/src/harness/AGENTS.md)), copied rather than
imported because `features/code` imports Media and the layering rule forbids the reverse. A turn
works as that file describes (rounds, streamed edits applied to a working copy, tools, a build
and run after the edits, fix rounds); read it first.

## What is the same

`apply-patch.ts`, `search-replace.ts`, `stream-parser.ts`, `workspace.ts`, `loose-code.ts`,
`stalled.ts`, `protocol.ts`, `context.ts`, `model.ts` and `harness-store.ts` are the Code
harness's files unchanged apart from their header comments. A fix to one there usually belongs
here too.

## What differs

- **`turn.ts`** has no skills, MCP connectors, Code tools or selected tool; the dependency action
  is accepted and ignored (a tool's imports load from esm.sh, so nothing is declared); the first
  message and system prompt are built from this folder's `prompt.ts`.
- **`tools.ts`** offers `read_file`, `list_files`, `search_files` and `check_project`, and no
  `propose_plan`.
- **`prompt.ts`** is new: the builder's identity, Flow's runtime (React 19.1, `App.tsx` entry,
  Tailwind v4, the fonts and icons, esm.sh imports, the CSP's network rules) and the whole
  `flow-sdk` surface, with Flow's look for new tools.
- **`verify.ts`** is new: the check compiles the tool (`../runtime/compiler.ts`) and runs it in a
  hidden `ToolRunner` frame with a stub host, collecting compile errors, uncaught errors and
  console errors, and a short outline of what rendered. Storage reads come back empty and
  generation is unavailable during the check; the prompt says so.

`../builder-session.ts` drives a turn for one tool and turns its result into the tool's next
version; `apps/studio/test/media-tools.test.mjs` pins the tool list against the prompt.
`apps/studio/test/media-tools-harness.test.mjs` drives the turn loop with a scripted model and a
stand-in checker, and fails when a copied file drifts from the Code harness's: bring the change
across rather than loosening the test.
