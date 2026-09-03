# overlay/ — everything Willow changes

`../upstream/` is Codex, untouched. This folder is the diff.

Upstream drives a terminal agent with a real shell and a real filesystem. Code
Beta drives a browser sandbox whose only capability is writing files into a
React project. Roughly a fifth of upstream's prompt describes things we cannot
do, and shipping it unchanged makes the model call tools that do not exist.

| File | Role |
| --- | --- |
| `prompt-overlay.ts` | The operations applied to the vendored prompt, and the new sections appended to it. |
| `tool-policy.ts` | Which tools exist, which of them a given turn gets, and the refusal text for every tool that does not. |
| `profile.ts` | Composes the session-level prompt, and assembles the per-turn one. |
| `markdown-sections.ts` | The section parser the operations address. |
| `collaboration-mode.ts` | Plan mode: the mode kinds, the vendored documents, and every model-facing string upstream defines for them. |
| `multi-agent-mode.ts` | What Ultra selects. Holds upstream's two mode texts verbatim. |
| `effort.ts` | The reasoning ladder, and the per-provider wire vocabulary. |

## Two layers, session and turn

`getHarnessProfile()` is the session layer: upstream's prompt with the overlay
applied, composed once and cached. `composeSystemPrompt()` is the turn layer.

The split exists because upstream delivers the mode, the multi-agent mode and
the live goal as separate `developer`-role messages appended *after* the base
instructions, and it re-sends them every turn. Order is load-bearing rather than
stylistic: the mode document asserts that the agent's mode "changes only when
new developer instructions with a different `<collaboration_mode>` change it",
and both multi-agent texts open by revoking the other. Appending in upstream's
order — instructions, mode, multi-agent mode, goal, turn context — is what makes
those sentences true.

Willow's transport carries system / user / assistant only, so these land at the
end of the system prompt rather than as their own messages. Same position in the
conversation, same precedence; the tags are kept because the documents refer to
them by name.

## Where the fidelity rules live

`collaboration-mode.ts` and `multi-agent-mode.ts` are close to transcriptions,
and that is deliberate. Every string in them that the model reads is upstream's,
down to the punctuation:

- `UPDATE_PLAN_IN_PLAN_MODE_ERROR` is `plan.rs`'s `RespondToModel` text.
- `requestUserInputUnavailableMessage` / `requestUserInputToolDescription` are
  `request_user_input_spec.rs`'s two generators, including `format_allowed_modes`
  and its "no modes" case.
- `PROACTIVE_TEXT` and `EXPLICIT_REQUEST_ONLY_TEXT` are
  `multi_agent_mode_instructions.rs`'s two constants.

The "no longer applies" clause opening both multi-agent texts reads oddly
standalone, and rewriting it is the tempting mistake: upstream re-sends the
fragment whenever the mode changes mid-session, so each text has to revoke the
other. `agent-effort.test.mjs` asserts both strings character for character.

**The mode documents themselves are never restated here.** They are 9KB and 5KB
of behaviour in `../upstream/`, and `collaborationModeInstructions` only renders
`{{KNOWN_MODE_NAMES}}`. `/plan` used to be a three-line composer template ending
"Use update_plan" — the exact tool Plan mode refuses — which is what a
paraphrase of a document that long turns into.

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

## `ALLOWED_TOOLS` is the superset, `toolsForTurn` is the gate

Three tools are conditional: `request_user_input` exists only in Plan mode, and
the three `*_goal` tools only during a goal session. They stay in
`ALLOWED_TOOLS` and are filtered out of the *registry* instead.

That indirection is the whole point. `runCall` can then tell "the harness has no
such tool" from "not available this turn", and answer them differently.
`request_user_input` in Default mode used to come back as

    ERROR Unknown tool "request_user_input". Available tools: read_file, …

— a list that does not contain it, from a harness that plainly does. A model
reading that concludes the capability does not exist and stops asking. Told
`request_user_input is unavailable in Default mode`, it carries on without it,
which is what upstream's message is for.

The same rule applies to `update_plan` in Plan mode, which is refused by its
handler rather than removed: the mode document *promises* the model a specific
error if it tries, so the tool has to be there to produce it.

## After changing anything here

```bash
npm test    # agent-harness.test.mjs pins the guarantees above
```

Then read the composed prompt in the app: Code → Harness → Prompt. It is
the exact string sent to the model, and it is the only way to see the result of
composition end to end.
