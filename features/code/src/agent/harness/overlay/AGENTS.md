# overlay/ — everything Willow changes

`../upstream/` is Codex, untouched. This folder is the diff.

Upstream drives a terminal agent with a real shell and a real filesystem. Code
Beta drives a browser sandbox whose only capability is writing files into a
React project. Roughly a fifth of upstream's prompt describes things we cannot
do, and shipping it unchanged makes the model call tools that do not exist.

| File | Role |
| --- | --- |
| `prompt-overlay.ts` | The operations applied to the vendored prompt, and the new sections appended to it. |
| `tool-policy.ts` | Which tools exist, and the refusal text for every tool that does not. |
| `profile.ts` | Composes the two into the `HarnessProfile` the runtime consumes. |
| `markdown-sections.ts` | The section parser the operations address. |

## Addressing by heading, not by string

Operations select a section by its **heading path**:

```ts
{ kind: 'replace-section', selector: ['Shell commands'], body: …, required: true }
```

Search-and-replace on prose breaks the first time upstream rewords a sentence.
Headings are far more stable — upstream reorganises prose constantly and renames
sections rarely. A selector may be a suffix of the full path, so
`['Tool Guidelines', 'Shell commands']` and `['Shell commands']` both work; use
the longer form only when a bare title is ambiguous.

## `required` is the safety mechanism

Every operation declares whether its anchor must exist.

- `required: true` — a missing anchor throws `OverlayAnchorError` and the app
  surfaces it in the Harness panel.
- `required: false` — a missing anchor is recorded in `skipped` and composition
  continues.

**Mark an operation `required` when its absence would leave a false statement in
the prompt.** The shell-section replacement is the canonical case: without it,
the prompt tells the model it has a terminal, in an app that has none. Failing
to boot is strictly better than an agent that claims to have run your tests.

Dropping the `AGENTS.md spec` section is `required: false` — if upstream removes
it, we simply have nothing to remove.

## The trap in `withDescendants`

**`drop-section` with `withDescendants: true` will take more than you expect.**

Upstream marks `# AGENTS.md spec` at level 1, so every `##` that follows it —
Responsiveness, Planning, Task execution, Validating your work, Presenting your
work — parses as *nested underneath it*. Cascading that drop removes most of the
agent's behaviour and leaves a prompt that still reads plausibly, which is the
worst kind of regression: nothing errors, the agent just gets worse.

This was a real bug, caught by a test that asserts those headings survive
composition. Before using `withDescendants`, check the actual heading levels in
the vendored file — not the levels you would expect it to use.

## Deriving from upstream where possible

The tool-protocol section is **built from** `apply_patch_tool_instructions.md`
rather than written out locally. Upstream describes `apply_patch` as a shell
invocation, which is the one instruction we cannot honour — but its grammar is
correct and worth tracking. So the overlay slices the grammar out of the
vendored text and rewrites only the invocation around it.

Prefer this shape whenever upstream's content is right and only its framing is
wrong: it means a grammar change upstream reaches the model with no local edit.

## Two halves of the no-shell guarantee

Both are needed; either alone fails.

- **`prompt-overlay.ts`** replaces upstream's shell guidance with an explicit
  statement of the boundary. It replaces rather than drops, because with no
  mention of shells at all, models still reached for one and then apologised —
  an explicit boundary where the model looks for shell guidance is what stops
  the attempts.
- **`tool-policy.ts`** makes it structurally true. `DENIED_TOOLS` is not dead
  weight: a denied tool the model calls anyway gets a specific, actionable
  refusal naming the alternative, which is what lets it recover inside the same
  turn instead of stalling on "unknown tool".

When you add a tool to `ALLOWED_TOOLS`, add a handler in `../runtime/tools.ts`
and describe it in the tool-protocol section. A declared tool with no executor
produces a model that announces work it never did — the same failure mode
`platform/ai` documents for its media tools.

## After changing anything here

```bash
npm test    # agent-harness.test.mjs pins the guarantees above
```

Then read the composed prompt in the app: Code → Harness → Prompt. It is
the exact string sent to the model, and it is the only way to see the result of
composition end to end.
