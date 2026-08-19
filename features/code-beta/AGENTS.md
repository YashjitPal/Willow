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

### The provider is asked for no tools of its own

`model-binding.ts` sends `toolPolicy: 'disabled'`. The harness's tools are a
text protocol the provider never sees, and it executes them itself, so a
provider-native tool is both unwanted and the thing that makes the provider's
own loop go round again.

The binding used to inherit the saved model's policy — `provider-native` by
default — while pinning `maxToolIterations: 1` to stop that loop. The two
together were fatal: the model reached for search, the provider wanted a second
round to feed the result back, and the turn died on "AI tool loop exceeded the
1-iteration safety limit" right after planning. The cap is now headroom rather
than a budget; the real limit is the harness's own, which reports exhaustion as
a sentence instead of throwing.

### A turn that announces work but never emits an envelope

The loop ends when a response carries no tool call, because that is what a
finished answer looks like. Upstream can rely on that — Codex uses native
function calling, so a model that intends to act emits a call in the same
response.

Here tools are a text protocol, and a model can describe the envelope in good
prose without ever opening one, ending on "Let's start by creating the project
plan." The turn then closes looking successful, having written nothing.

`stalled.ts` catches that and the loop spends exactly one nudge on it. The
detector is tuned against false positives, since nudging a model that has
genuinely finished talks over the user: a response ending in a question is an
answer, the announcement has to be near the end, and the verb has to be one the
agent performs — "Let me set up the project" is an announcement, "Let me know
what you'd like to build" is not.

### `.cb-root` declares tokens and does not paint

It used to set a background and text colour, which made it unusable as an inline
wrapper: nesting the assistant's own answer inside it put a near-black block
behind the text. Every call site already passed `bg-transparent` to undo that,
which is the tell that the paint belonged to a component rather than the token
layer. A surface that wants the canvas asks for it.

### The overlay adds constraints, not opinions

Two things, and only two, justify diverging from the vendored prompt:

1. **There is no shell.** No terminal, no `rg`, no install command, no test run.
2. **The preview runs one React app and nothing else.** A file in another
   language, or anything expecting a Node process, is something the user has no
   way to execute.

Anything beyond those is Code Beta drifting from upstream Codex for reasons the
environment does not force. A section of UI-design guidance was removed for
exactly this reason: it was a set of preferences, not a fact about the runtime,
and the harness test now asserts it stays out.

### `writeWorkbenchFiles` must reproduce `setFile`'s side effects

The bridge replaces the whole file map instead of calling `setFile` per path,
because only that can express a deletion. The price is that `setFile`'s side
effects have to be repeated by hand — in particular `hasUserCode`, which every
stage of the preview pipeline is gated on: the bundler, the iframe, the empty
state, and `CodeHome`'s morph out of chat mode.

Leaving it unset failed silently in the worst way. Files were written and the
transcript showed them created, but nothing rendered and the workspace never
opened.

### Nothing but context may ride on the user's message

The user's message is `projectContext()` and their own words. That is all.

Anything the harness prepends is said on *every* turn, including turns that are
just "hey", so a sentence in the imperative mood there is an instruction the
user never gave. This has caused the same bug twice:

- The manifest ended "The project is empty. Create /App.tsx to begin."
- Effort guidance was prepended too, putting "Plan before acting with
  update_plan" directly above the word "hey".

Both times the model built a starter app and explained the work it had done.
Both times it was obeying us, not overreaching.

So: `projectContext()` states facts and stops — the model has no shell and
cannot run `ls`, which is the only reason it is there at all. Standing guidance
such as `effortSection()` goes in the **system prompt**, beside upstream's own
rule that casual greetings get a conversational answer. The turn-loop test
asserts the user message is exactly the listing plus the prompt.

### One edit card per file

An envelope may touch several files, and each `*** Add/Update/Delete File:`
header opens its own card. `applyPatchEnvelope` then matches each applied change
back to the card for that path, completes any card whose file produced no
change, and fails *all* of them together when the envelope does not apply — the
envelope is applied as one unit, so a partial outcome would be a lie.

Tracking a single card instead meant every header but the last was orphaned:
it sat at "Creating…" with a running timer forever, while the one surviving card
was filled in with a different file's diff.

### Why a turn pauses between paragraphs

A turn is not one request. It is **one request per round** — the model answers,
the harness runs what it asked for, and the entire conversation goes back up for
the next round. So a gap between two paragraphs is not the model thinking
mid-sentence; it is a new request being made and waiting on its first token,
with a system prompt of ~30k characters (~7.6k tokens) in front of it.

That is inherent to the loop and to running upstream's prompt. What is *not*
inherent is how fast the conversation grows, which is why `history.ts` exists.

`request-log.ts` is how any of this gets diagnosed instead of guessed at. Every
request the harness makes — sub-agents included, since it wraps the transport
rather than the loop — is timed, separating time-to-first-token (the endpoint)
from first-to-last token (the model streaming), and recording failures with
their message. `willowCodeBeta.requests()` in the console prints the table;
`.dump()` gives JSON.

It records sizes, never content, and never the key. A log that copies the
transcript is a second place for a user's code to leak from, and the sizes are
what actually explain the timings.

### Assistant turns are compacted before they go back

`compactForHistory` keeps every envelope marker and every file header, and
replaces long patch bodies with `[279 lines applied: +279 -0]`.

The model has to see the envelopes it emitted — that is the whole of the section
below — but not the contents of a patch. Those already landed in the project,
the observation says what was applied, and `read_file` can fetch any of it. The
difference is large: a 279-line file re-sent on every subsequent round of the
turn nearly doubled the prompt, and each round pays for it again.

### The model is shown the envelopes it emitted

The assistant turn pushed back into the conversation is `raw` — prose *and*
envelopes — not the stripped `text` the user reads.

Feeding back the stripped version hid the model's own tool calls from it. The
history then read as narration followed by an observation with nothing that
could have produced it, and models reconcile that by trying to close an envelope
they cannot see: one stray `*** End Call`, then a dozen. Upstream keeps the tool
call in the transcript for the same reason.

### Envelope markers are found anywhere on a line

`ResponseStreamParser` looks for `*** Begin Patch` and `*** Call:` at any offset,
not just at the start of a line, and closes a call on a line *ending* with
`*** End Call`.

This is not defensive padding. Models routinely append the opener straight onto
the sentence introducing it — `"...what we're starting with.*** Call:
list_files"` — and a line-anchored parser sees no envelope at all. The failure is
total rather than partial: the markers render as prose, no tool runs, and since
the loop continues only while calls are being made, the turn ends on the spot.
It looked like the model refusing to work; it was the parser not seeing the call.

A call whose closer never arrives is dispatched at `end()` for the same reason —
dropping it would stall the turn silently. The turn-loop tests cover all four
shapes.

The cost is that prose quoting a marker mid-sentence is taken literally. The
harness owns these markers and the prompt tells the model to put them on their
own line, so that is the cheaper failure.

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

## Work is written as lines, not cards

Codex writes what it did into the narration — "Editing App.tsx" — and keeps the
detail behind a disclosure. Code Beta does the same, and `ToolCard` is the
single place that shape is defined.

It used to draw a bordered, filled panel per call, with a progress stripe, a
running timer, a status glyph, and a green/red proportion bar on every edit.
Three file edits then became three competing boxes stacked between two
paragraphs of prose, which is the opposite of reading as an account of what
happened.

What a row carries now: a disclosure chevron (in a fixed column, so a run of
rows aligns), an icon, the verb, the subject, and the counts. Status shows in
the verb itself — it shimmers while running — rather than being repeated by a
glyph beside it. Expanded detail is indented behind a hairline instead of boxed.
Sub-agent rows and the plan checklist follow the same rule, since they are more
of the same work rather than a different kind of thing.

Type size, weight and family are inherited from the transcript throughout. The
chrome changed; the text did not.

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

## Reasoning effort, and Ultra

Effort belongs to the harness — upstream carries it as `model_reasoning_effort` —
so Code Beta owns a fuller ladder than the rest of Willow: `none`, `minimal`,
`low`, `medium`, `high`, `xhigh`, `ultra`. It lives in
`src/harness/overlay/effort.ts` and is covered by
`apps/studio/test/code-beta-effort.test.mjs`.

It is picked where every other effort in Willow is picked: the model pill →
**Thinking effort**. There is no separate control. The numeric levels come from
the shared menu unchanged; Ultra is appended through `ModelsMenu`'s
`extraEfforts` prop, which is optional and renders nothing for callers that omit
it — so Chat, Media and the Code tab are untouched.

Both Code Beta composers carry it — `CodeHome`'s and `WorkbenchSidebar`'s. The
landing one matters as much as the workbench one, since the opening prompt is
typed there and is the most likely to want delegation.

Guidance sets **how much care to take**, never which tools to use. The strings
once read "Plan before acting with `update_plan`" and "Verify the result with
`computer_use`", which made both unconditional — every build opened with a plan
and closed with a browser session regardless of what was asked for. Upstream
already decides both, and on better terms: its planning section says outright
not to plan simple or single-step work, and validation is explicitly a
judgement call. Naming a tool in the guidance overrode all of it. The effort
test asserts no level mentions a tool.

**Ultra is a mode, not a level.** Upstream presents it alongside the levels, but
it is not a value any provider accepts. Choosing it does two separate things:

- *On the wire*, it lowers to whatever the model's own ceiling is. That is not a
  clamp and is not reported as one — nothing was lost, because Ultra was never
  an API value to begin with.
- *In the harness*, it turns on proactive delegation: the agent is told to split
  work across sub-agents by default rather than only when asked, and gets the
  largest tool-call budget.

Because the second half is entirely harness-side, Ultra works on **every model**,
not just OpenAI's. Nothing about it depends on the provider.

Only the Ultra flag is stored, as `ultraEngaged` in `code-beta-store.ts`. The
numeric levels are already part of the selected model (`…::effort-N`), so
`effectiveEffort()` reads them straight off it — keeping a second copy in the
store would let the request drift from the level the pill is showing. Ultra has
nowhere else to live: it is not a saved-model id, and writing one into
`selectedModelId` would leave the Code tab unable to resolve the selection after
a tab switch. Picking a numeric level clears it, since the two are one radio
group.

## The isolation rules

Enforced by `apps/studio/test/code-beta-harness.test.mjs`, so breaking one fails
`npm test` rather than surfacing later as a bug in Code.

- **Never import from `@willow/code/*`.** Not a helper, not a type. If something
  is genuinely shared it moves down to `platform/`.
- **Never write to Code's stores or storage keys.**
- **Never edit the global Tailwind config** in `apps/studio/index.html`.

Two things are deliberately shared:

- The **esbuild-wasm module instance**: `esbuild.initialize()` may only be called
  once per page, so whichever tab loads first wins and the other treats "already
  initialized" as success.
- **`ModelsMenu`'s `extraEfforts` prop**, added for Ultra. Adding to a shared
  component is the exception, taken because the alternative — a second effort
  control sitting next to the model pill — would have put two effort pickers on
  screen at once and taught the wrong place to look. The prop is inert unless a
  caller passes rows, and the menu itself never names Ultra, so the behaviour of
  every other surface is unchanged. The effort test asserts both halves of that.

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
