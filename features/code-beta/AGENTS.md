# features/code-beta

**A fork of [`features/code`](../code/AGENTS.md), gated behind Labs**, with two
things replaced: the generation loop is a vendored copy of the open-source
**Codex** harness, and the transcript renders Codex-style tool cards instead of
Code's indicator rows.

Everything else — the landing grid, the workbench shell, project save/load, the
file tree, the preview, visual editing — is Code's, copied byte-for-byte at the
fork point and left alone.

## Why a fork rather than a mode

Three constraints, all pointing the same way:

1. **It is an experiment.** It must not be able to break the shipped Code tab.
   A shared store, parser or preview would make that possible.
2. **The harness is upstream code.** `harness/upstream/` is byte-for-byte
   openai/codex and gets replaced wholesale on upgrade. That only works if
   nothing local is interleaved with it.
3. **The agent contract is different.** Code's LLM writes whole files inside
   `<willowAction>` tags. Codex writes *patches* in the V4A format and expects
   `apply_patch`, `update_plan`, and a tool-call protocol. Retrofitting that
   onto Code's parser would mean two contracts in one code path.

The cost is duplication: ~815 KB of Code is copied here. That is the intended
trade. If Code Beta graduates, the merge is a deliberate piece of work — not
something that happens by accident because two features grew into each other.

## Turning it on

Settings → Labs → **Code Beta**. The flag is `code-beta` in
[`platform/core/src/experiments-store.ts`](../../platform/core/src/experiments-store.ts)
and defaults to `false`. Enabling it adds a **Code Beta** row to the sidebar
under Agents.

The route is `React.lazy`, so the whole fork — workbench, harness, vendored
prompt — is a separate chunk that never downloads for anyone who has not opted
in. Verified by the build: `CodeHome-*.js` appears twice, once per feature.

## Tracking the fork

```bash
node tools/scripts/code-beta-fork-status.mjs
```

Reports which copied files still match `features/code`, which have diverged, and
which exist on only one side. `FORK.json` records the commit the copy was taken
from.

Divergence is expected — it is the point — but six months from now nobody will
remember which files were changed deliberately and which merely drifted. This is
how you tell. It is informational and never a gate.

To see how one file differs:

```bash
git diff --no-index features/code/src/<file> features/code-beta/src/<file>
```

## What actually changed from Code

| File | Change |
| --- | --- |
| `workbench/WorkbenchSidebar.tsx` | `startAiGeneration` now calls `runCodexTurn`. The bolt prompt, the codebase-context block and the artifact parser are gone. Renders `LiveTurnActivity` / `SettledTurnActivity`. |
| `workbench/WorkbenchPreview.tsx` | Publishes its iframe to `setPreviewFrame` so `computer_use` can drive it. |

Everything else in the copied tree is untouched.

## Files added by the fork

| Path | Role |
| --- | --- |
| `src/harness/` | **The Codex harness.** Its own [`AGENTS.md`](src/harness/AGENTS.md) — read it before touching anything in there. |
| `src/harness-bridge.ts` | The seam: workbench files ↔ harness file map, plus the `run_command` and `computer_use` tools. |
| `src/code-beta-store.ts` | Tool calls and sub-agents, keyed by turn. Deliberately does **not** hold files or messages — the workbench owns those. |
| `src/code-beta.css` | Scoped design tokens (`--cb-*`). See *Styling*. |
| `src/model-binding.ts` | Willow's saved model config → a harness `ModelBinding`. |
| `src/ui/` | The Codex interface: tool cards, diff view, terminal, computer use, sub-agents, turn status. |

## How a turn flows

```
WorkbenchSidebar.startAiGeneration()
  └─ runCodexTurn()                    harness-bridge.ts
       ├─ resolveBinding()             model-binding.ts
       ├─ beginTurn(turnId)            code-beta-store.ts
       └─ runTurn()                    harness/runtime/agent.ts
            ├─ getHarnessProfile()     vendored prompt + overlay
            ├─ streamChat()            platform/ai — bytes only
            ├─ ResponseStreamParser    prose / patches / calls
            │    ├─ patch closes  ──> applyPatch ──> writeWorkbenchFiles
            │    └─ call closes   ──> tool handler ──> observation
            └─ onEvent
                 ├─ 'text'      ──> sidebar's streaming message body
                 └─ everything else ──> applyHarnessEvent(turnId, …)
                                          └─ LiveTurnActivity re-renders
```

`writeWorkbenchFiles` replaces the whole file map in one assignment rather than
calling `setFile` per path. Two reasons: the harness can *delete* files, which
`setFile` cannot express, and one assignment means the preview rebuilds once per
patch instead of once per file — which is what stops a multi-file edit flashing
two or three broken intermediate states.

## The transcript

Three components, and the split between them is the whole design:

- **`TurnStatus`** — "Working for 12s", shimmering, with the harness's current
  phase. It **exits when the answer arrives.** While the agent works this is the
  only signal the turn is alive; once prose starts, the prose *is* the signal
  and a live timer beside it competes with the thing the user wants to read.
  The elapsed value is frozen on the way out, because a timer racing back to
  0:00 during its fade reads as a bug.
- **`LiveTurnActivity`** — every tool card, expanded, while the turn runs. There
  is no answer yet, so the work *is* the content.
- **`SettledTurnActivity`** — the same cards, collapsed behind one "Show 6
  steps" row on the finished message. Hidden, not discarded: "what did it
  actually change" is the first question anyone asks re-reading a turn.

Cards live in `src/ui/ToolCallView.tsx`, one per tool kind, all sharing
`ToolCard` so the status glyph, timer and disclosure sit in the same place
regardless of what the row is. A running card shows its verb in the present
tense with a shimmer (`Editing`), a settled one in the past tense plain
(`Edited`).

## Tools

| Tool | Notes |
| --- | --- |
| `apply_patch` | V4A patches. Streams — the diff fills in as it arrives. |
| `read_file`, `list_files`, `search_files` | `search_files` exists because there is no `rg`. |
| `update_plan` | Upstream's. Always-open card; a collapsed plan has nothing in its header. |
| `add_dependency` | Writes `/package.json`. Exists so "install a package" has somewhere legitimate to land. |
| `run_command` | **Not a shell.** A small allow-list of sandbox operations; anything else is refused with an explanation naming the right tool. |
| `computer_use` | Drives the live preview. See below. |
| `task` | Spawns a sub-agent. Sub-agents get every tool except `task`. |

### Computer use

`computer_use` runs Gemini's computer-use model against the preview iframe via
`platform/ai/src/computer-use/session.ts`, clicking and typing the way a person
would, and reporting back with screenshots.

The only thing there is to drive in this product is the app the agent just
built — which is exactly why it is worth having. It closes the loop between
writing a UI and checking that the UI works. Without it the agent can only
assert its code is correct; with it, it can look.

The card is screenshot-first on purpose. A list of "clicked at (412, 288)" is
unreadable, because the coordinates mean nothing without the pixels they refer
to. The cursor overlay is what makes it legible: it marks where the agent is
about to act, in the screenshot's own coordinate space, so a click landing on
the wrong element is obvious at a glance.

The frame is published by `WorkbenchPreview` into `previewFrame` on the store,
because the tool runs inside the harness, far from React's tree. If the preview
is closed the tool says so rather than failing obscurely.

## The isolation rules

Enforced by `apps/studio/test/code-beta-harness.test.mjs`, so breaking one fails
`npm test` rather than surfacing later as a bug in Code.

- **Never import from `@willow/code/*`.** Not a helper, not a type. If something
  is genuinely shared it moves down to `platform/`.
- **Never write to Code's stores or storage keys.**
- **Never edit the global Tailwind config** in `apps/studio/index.html`.

The one thing deliberately shared is the **esbuild-wasm module instance**:
`esbuild.initialize()` may only be called once per page, so whichever tab loads
first wins and the other treats "already initialized" as success.

## Styling

Willow styles itself with the Tailwind Play CDN plus a runtime config in
`apps/studio/index.html`. Extending that config would push Code Beta's palette
onto every other surface, so this feature does not touch it.

`code-beta.css` declares CSS variables under `.cb-root`, and components
reference them through arbitrary values:

```tsx
<div className="bg-[hsl(var(--cb-surface))] text-[hsl(var(--cb-ink-muted))]" />
```

**No component here uses a bare colour utility.** No `bg-zinc-900`, no
`text-white`. Colour comes from a token, always.

## Testing

| File | Covers |
| --- | --- |
| `code-beta-apply-patch.test.mjs` | The V4A parser and applier — the one place a bug silently corrupts a project. |
| `code-beta-harness.test.mjs` | The no-shell guarantee, upstream checksums, the fork record, and the isolation rules. |
| `code-beta-turn-loop.test.mjs` | A whole turn end to end against a scripted model. |

42 tests, none needing a model, a network, or a browser. `runTurn` takes an
injectable `transport`, which is what makes the last file possible — and why
`platform/ai` is imported *lazily*, so a static import does not drag three
provider SDKs into every test that touches the harness.

It earns its keep. Writing the turn-loop file immediately caught a bug that
would have made every non-patch tool call fail silently: the stream parser
flushed a partial `*** Call:` line as prose once the buffer grew past the
opener's length, so with realistic token chunking the envelope was never
recognised.

## Known gaps

Honest list, not a roadmap:

- **`run_command` cannot typecheck.** There is no TypeScript compiler in the
  browser; the command reports that and points at the bundler's errors, which
  the preview already surfaces. It does not pretend to have run one.
- **Sub-agents share the file map with no locking.** Two agents editing the same
  file in one turn is last-write-wins. The prompt says to delegate only
  independent work, which is guidance, not a guarantee.
- **`add_dependency` writes `package.json`, but Code's bundler marks only
  `react`/`react-dom` external**, so a newly added package will not resolve in
  the preview until the bundler learns to map bare imports to a CDN.
- **Design mode and the test runner still use Code's original loop.** Only
  `startAiGeneration` was swapped; `startDesignGeneration` and the computer-use
  *test* flow are untouched copies.

<!-- related-packages -->

## Related packages

**This package imports from:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — `BackgroundContext`, settings CSS (inherited from the Code copy)
- [`platform/ai`](../../platform/ai/AGENTS.md) — `streamChat` for bytes, `computer-use/session` for the preview driver
- [`platform/auth`](../../platform/auth/AGENTS.md) — `useUserDataContext()` for API keys
- [`platform/core`](../../platform/core/AGENTS.md) — model catalog, experiments store
- [`platform/projects`](../../platform/projects/AGENTS.md), [`platform/storage`](../../platform/storage/AGENTS.md), [`platform/ui`](../../platform/ui/AGENTS.md) — inherited from the Code copy

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — behind the Labs flag

Deliberately absent: `features/code`. See *The isolation rules*.

Repo-wide conventions live in [the root `AGENTS.md`](../../AGENTS.md).
