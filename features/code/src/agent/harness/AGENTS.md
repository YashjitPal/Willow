# The Codex harness

The Agent tool's loop is a port of [openai/codex](https://github.com/openai/codex)
(Apache-2.0). This folder is that port.

The organising idea is one sentence: **upstream files are vendored verbatim and
never edited; everything Willow changes is declared separately and applied at
runtime.** Every rule below follows from it.

```
harness/
  upstream/        Byte-for-byte openai/codex. Never edit. Has its own AGENTS.md.
  overlay/         Everything Willow changes. Has its own AGENTS.md.
  runtime/         The turn loop, the patch engine, the tools.
  upstream-assets.ts   The only module that reads upstream/ directly.
```

## Why not just fork the prompt

Because the prompt is not a one-time copy. Upstream ships changes to it
regularly, and those changes are the reason to track upstream at all. A fork
means every upgrade is a three-way merge of a 24,000-character document that
someone has to read in full.

With the overlay, an upgrade is:

```bash
npm run codex:update    # replaces upstream/, rewrites MANIFEST.json
npm test                # anchors still resolve? no-shell guarantee intact?
```

and the diff you review is upstream's own diff, not a merge conflict.

## Updating to a new Codex release

1. **Check what is available.**

   ```bash
   npm run codex:check
   ```

   Verifies the vendored files still match `MANIFEST.json` (i.e. nobody
   hand-edited them) and reports whether a newer upstream release exists.

2. **Move the pin.**

   ```bash
   npm run codex:update              # latest release
   npm run codex:update -- --ref rust-v0.150.0   # a specific tag
   ```

   This replaces every file in `upstream/`, rewrites `MANIFEST.json` with new
   checksums, and deletes anything that disappeared upstream.

3. **Run the tests.**

   ```bash
   npm test
   ```

   `agent-harness.test.mjs` is the gate. It fails loudly if a required
   overlay anchor no longer exists, if the composed prompt stops denying a
   shell, or if a vendored file does not match its checksum.

4. **Fix anchors, if any.** See below.

5. **Read the composed prompt.** Code → Harness → Prompt. It is the actual
   string sent to the model; a five-minute read catches things a test cannot,
   like upstream adding a section about a tool we do not implement.

### When a path moves upstream

`codex:update` will report `FAIL <path>` and stop. Find where the file went in
the new tree and update `TRACKED` in
[`tools/scripts/sync-codex-upstream.mjs`](../../../../tools/scripts/sync-codex-upstream.mjs).
This has already happened once: `codex-rs/core/prompt.md` became
`codex-rs/core/prompt_with_apply_patch_instructions.md`, and
`codex-rs/apply-patch/apply_patch_tool_instructions.md` moved under
`codex-rs/prompts/templates/`.

Keep `TRACKED` small. Every entry is a file some future upgrade has to
reconcile, so vendor only what the runtime genuinely reads — never "for
reference".

### When an overlay anchor disappears

`composePrompt` throws `OverlayAnchorError` naming the missing selector, and the
Harness panel renders it. Open `upstream/prompt_with_apply_patch_instructions.md`,
find where the guidance moved, and update the selector in
[`overlay/prompt-overlay.ts`](overlay/AGENTS.md).

**This failure is fatal on purpose.** The alternative — skipping the operation
and carrying on — produces a prompt that still tells the model it has a shell,
in an app that has no shell. A loud error at startup is strictly better than a
turn where the agent announces it ran your tests.

## What is vendored, and what it is for

| File | Used by |
| --- | --- |
| `prompt_with_apply_patch_instructions.md` | The base system prompt. The overlay rewrites parts of it. |
| `apply_patch_tool_instructions.md` | Its grammar section is spliced into the tool-protocol section, so a grammar change upstream reaches the model with no local edit. |
| `apply_patch.lark` | The formal grammar. Not executed — `runtime/apply-patch.ts` is a hand port — but diffed on every upgrade to catch a format change. |
| `collaboration_mode_plan.md` | **Plan mode, entire.** Sent as a `<collaboration_mode>` developer message. |
| `collaboration_mode_default.md` | The same for Default mode. Its `{{KNOWN_MODE_NAMES}}` is the only placeholder. |
| `goal_continuation.md` | Rendered and submitted as the sole input of each automatic goal turn. |
| `goal_budget_limit.md` | Sent once, when a goal exhausts its token budget. |
| `goal_objective_updated.md` | Sent when the user edits a live goal's objective. |
| `LICENSE`, `NOTICE` | Required by Apache-2.0 §4 for redistribution. |

## The four subsystems

Plan mode, Goal mode, multi-agent collaboration and the effort ladder are all
upstream subsystems, and all four are easy to approximate and wrong when
approximated. What each one actually is:

| | Upstream | Here |
| --- | --- | --- |
| **Plan mode** | `ModeKind::Plan`. A 9KB developer document, `update_plan` refused, mutation forbidden, `request_user_input` available and *blocking*, output wrapped in `<proposed_plan>`. | `overlay/collaboration-mode.ts` + the vendored document. `runtime/proposed-plan.ts` is a port of upstream's streaming parser. |
| **Goal mode** | The `ext/goal` crate. Three tools, six statuses, a token budget, and `continue_if_idle` restarting the turn until the objective is *true*. | `runtime/goal.ts`, and the continuation loop at the bottom of `runTurn`. |
| **Collaboration** | Multi-agent V2. Six tools, agent addresses, non-blocking spawn, unbounded nesting, `fork_turns`, a message envelope. | `runtime/collaboration.ts` + `runtime/agent-path.ts`, described by `overlay/collaboration-tools.ts`. |
| **Skills** | `SKILL.md` folders, a prompt catalog, `$mentions`, and `skills.list` / `skills.read`. | `runtime/skills.ts` + `overlay/skills-prompt.ts`, over `@willow/core/skill-{frontmatter,library}`. |
| **Ultra** | Not more reasoning. `client.rs` lowers it to `Max`; what it selects is `MultiAgentMode::Proactive`. | `overlay/effort.ts` + `overlay/multi-agent-mode.ts`, which holds upstream's two mode texts verbatim. |

### Why collaboration and Ultra are one story

Ultra's entire effect is one bit: delegation goes from "only when asked" to
"when it would help". That bit is worth nothing unless the delegation machinery
can actually spend it, and for a long time it could not — the harness had a
single tool called `task` that blocked until its helper finished. `task` exists
nowhere in codex-rs, and upstream's own role guidance says exactly what a
blocking helper costs:

> "You are encouraged to spawn up multiple explorers in parallel… **While
> waiting for the explorer results, you can continue working on other local
> tasks that do not depend on those results.** This parallelism is a key
> advantage of delegation."

So Ultra was granting a freedom the model had no way to use. `spawn_agent`
returning immediately is the fix, and it is why the two arrived together.

Three rules follow, and each of them was learned by getting it wrong first.

**A mode is a document, not a paraphrase.** `/plan` began life as a composer
template that expanded to three lines ending "Use update_plan" — the exact tool
upstream *refuses* in Plan mode, and spends a section of the mode document
explaining why. The documents are 9KB and 5KB of behaviour; they are vendored
and sent verbatim, and the tests assert that rather than asserting their
contents.

**Effort derives two things and no more.** `maxIterations` (Willow's own; see
below) and the multi-agent mode. There is no per-rung guidance text upstream and
there must not be one here — the version that existed named tools, which made
planning and browser verification unconditional at the higher rungs and overrode
upstream's own rules for when to do either.

**Where this port diverges, it is because a browser forced it.** There are
exactly six places, all commented at the site:

- **Plan mode's mutation boundary is enforced, not instructed.** Upstream can
  refuse an `apply_patch` *call*; Willow's patches apply the instant the
  envelope closes, mid-stream, so an instruction-only boundary would mean a
  model that ignores it has already written the user's files.
- **Ultra lowers to the model's ceiling, not literally to `max`.** Upstream
  talks to one backend. `platform/ai` forwards `reasoningEffort` verbatim to
  Gemini as `thinking_level`, where `max` is not a valid value and the request
  fails outright. Everywhere `max` exists, the two agree exactly.
- **`maxIterations` and `MAX_GOAL_CONTINUATIONS` exist at all.** Codex runs until
  the model stops and the user interrupts from a terminal. A browser tab has no
  terminal and no visible bill.
- **Goal token usage is only ever a number a provider reported.** Upstream
  accounts exact usage from its own backend. An estimate here would make
  `budget_limited` fire on invented arithmetic, and a budget that stops work
  early on a guess is worse than no budget.
- **The turn waits for the agent tree.** Upstream's session outlives a turn, so
  a parent may finish while its children work on and the user watches them in
  the TUI. Resolving `runTurn` unlocks the composer and reports the turn done,
  so a still-running agent would rewrite the user's files *after* they were told
  the work finished. Spawning is still non-blocking — only the final boundary
  waits.
- **Every tool goes over the text protocol, including these six.** Upstream uses
  native function calling and namespaces them under `collaboration`. See *Why a
  text protocol* below; the short version is that `platform/ai` only wires
  `functionDeclarations` on the Gemini adapter.

### Collaboration, in one screen

Six tools, and the three properties that make them worth having:

| Tool | What it does |
| --- | --- |
| `spawn_agent` | Starts an agent and **returns immediately**. |
| `send_message` | Queues a note. Does not start a turn. |
| `followup_task` | Queues a new job, waking the agent if idle. |
| `wait_agent` | Waits for news. **Returns who has news, never the news.** |
| `interrupt_agent` | Stops a turn. The agent survives and can be re-tasked. |
| `list_agents` | Who exists, and in what state. |

- **Addresses, not ids.** `/root`, `/root/explore`, `/root/explore/deeper`. A
  parent may name its own child relatively; anyone else needs the full path.
  `runtime/agent-path.ts` is that port, and its naming rules are strict because
  a path arrives as model-supplied text and is then used as a map key.
- **Nesting is unbounded here.** `collab_tools_enabled` only depth-limits
  multi-agent **V1**; V2 has no limit, and both `spawn_agent`'s description and
  the sub-agent role hint say children may spawn children. Spark caps it at one
  level on purpose — it runs unattended on a schedule, where an unbounded tree
  spends tokens with nobody watching. **The two harnesses differ here
  deliberately; do not change either to match the other.**
- **`wait_agent` is a doorbell, not a mailbox.** It reports *that* there is
  news; the news arrives as an envelope on the next turn. A model that thinks
  otherwise summarises findings it has not received.

The concurrency cap is 4 — `DEFAULT_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION`
— and it is **the same at every effort**, because upstream's is one session
config value. It briefly scaled from 1 at `none` to 4 at `ultra` here, which was
invented and made low effort worse at a job the user had explicitly delegated.

### Skills, in one screen

A skill is a folder with a `SKILL.md`: YAML frontmatter (`name`, `description`,
`metadata.short-description`) then instructions, plus whatever `references/` or
`assets/` it ships.

The harness shows the model **one line per skill** in the system prompt and
nothing more; bodies are fetched with `skills.read`. That split is the point —
upstream calls it progressive disclosure, and it exists because a skill can be a
folder of documents that would cost more context than the task.

- **`$` is the sigil, not `@`.** `TOOL_MENTION_SIGIL` in `mentions.rs`. The
  linked form `[$Name](skill://id)` is what a menu inserts. Twelve shell
  variables (`$PATH`, `$HOME`, …) are excluded, because a prompt about shell
  config is full of them.
- **A mention is squashed before matching.** A mention ends at the first
  character outside `[A-Za-z0-9_:-]`, so a skill called "Brand voice" *cannot*
  be written `$Brand voice` — only `$BrandVoice`. Both sides drop separators
  before comparing, or upstream's own trigger rule is unsatisfiable for every
  multi-word name.
- **`wait_agent`'s sibling trap:** `skills.read` returns the document
  *including* frontmatter, because the catalog text tells the model to read it
  "completely".

The parser is in `platform/core` rather than here because three surfaces need
it. It is line-oriented rather than a YAML library, which means upstream's
90-line `repair_frontmatter_scalar_fields` is not ported — that pass exists only
to re-quote prose `serde_yaml` rejects (`description: Build for AWS: ECS`), and
taking everything after the first `: ` makes the whole failure class impossible.

**Where skills live is Willow's decision, not Codex's.** They are the workspace's
`Skills/` folder, which Spark registers and owns; `platform/core/src/skill-library.ts`
is the shared read seam that Spark's own registration always anticipated
("workspace-level so Chat can consume the same library later"). The harness
takes a `LibrarySkill[]` and knows nothing about any of that, the same way it
takes `extraTools`.

## What is a port, not a copy

`runtime/apply-patch.ts` implements upstream's V4A patch format against an
in-memory file map rather than a filesystem. It is a port of the *format*, not
of the Rust code.

The one behaviour worth knowing: **context matching is fuzzy, in three graduated
steps** — exact, then ignoring trailing whitespace, then ignoring leading and
trailing whitespace. Models reliably get the shape of a hunk right and its
whitespace wrong, so a strictly literal matcher rejects patches that are
unambiguously correct. Anything looser than these three starts matching the
wrong region, which is why the ladder stops there.

When a context line matches fuzzily, the file's own text is kept — not the
model's copy of it. Writing the model's version back would silently reformat
lines nobody asked to change.

## Why a text protocol instead of function calling

Two reasons, the second being the one that decided it:

1. `platform/ai` only wires `functionDeclarations` for the Gemini adapter. The
   OpenAI, Anthropic and compat branches accept search tools and nothing else,
   so native calling would pin the harness to one provider.

2. **Upstream's own `apply_patch` is a freeform tool** — the model emits raw
   text matching a Lark grammar, not a JSON argument object
   (`create_apply_patch_freeform_tool` in codex-rs). Parsing text is the
   faithful port; JSON would be the deviation.

It also streams. A patch arriving as text can be applied and rendered line by
line while the model is still writing, which is what makes the diff fill in
inside the transcript instead of appearing all at once at the end.

The format is documented in `runtime/protocol.ts` and described to the model by
the overlay's tool-protocol section.

## The turn loop

`runtime/agent.ts`. A bounded loop; each iteration streams one model response.

- **Patches apply mid-stream.** The model does not need the result to keep
  writing, and applying immediately is what makes the preview feel live.
- **Calls do not.** A call is a question, so continuing past one would mean the
  model inventing an answer it has not received. The prompt tells it to stop
  after a call; the loop re-prompts with the real observation.
- **Errors come back as observations, not exceptions.** A malformed patch is
  normal and recoverable, and models fix it far more reliably when handed the
  parser's actual complaint.
- **The iteration budget comes from effort**, defaulting to `MAX_ITERATIONS`
  (12). On exhaustion the user is told, in the transcript, and `turn-end`
  carries `stopReason: 'iteration-budget'` so the caller can tell an
  interrupted turn from a finished one.
- **In Goal mode the loop runs more than once.** `runIterations` is one pass;
  when the model stops with the goal still `active`, another pass begins whose
  sole input is the rendered `goal_continuation.md`. That is upstream's
  `continue_if_idle`, and it is the entire difference between a goal and a long
  prompt.

Agents run the identical loop through a different `CallSink` — that indirection
is the only difference between the root turn and a delegated one. They get every
tool the root had **including all six collaboration tools**, and lose exactly
one: `request_user_input`, which upstream also withholds
(`session_source.is_non_root_agent()` → "can only be used by the root thread").
A delegated agent has no user to ask.

Parallelism comes from `spawn_agent` returning immediately, not from the
dispatcher. `runIteration` executes pending calls one at a time in the order the
model wrote them, which matters for everything else: two `read_file` calls
emitted in sequence may be sequenced on purpose, and a `run_command` reordered
against a patch is a different program.

Concurrent agents are safe against the shared file map for a reason worth
stating: every patch application is a synchronous read-modify-write
(`files()` → `applyPatch` → `writeFiles()` with no `await` between), so two
agents cannot interleave inside one. They can still both edit the same file,
which is a logical conflict upstream has too — hence the prompt telling the
model to give each agent a piece nobody else is touching.

### Two failure modes worth knowing

Both were real, both were silent, and both are now pinned by tests.

- **`getHarnessProfile()` must be called inside `runTurn`'s `try`.** It throws
  `OverlayAnchorError` after an upstream reorganisation, which is deliberate —
  but called outside the `try` the rejection escaped, so no `turn-end` was
  emitted, `onDone` never ran, and the composer span forever on a turn that had
  already failed.
- **A mode-gated tool must not report "unknown".** `ALLOWED_TOOLS` is a superset
  of what any one turn registers, so `runCall` distinguishes "the harness has no
  such tool" from "not available this turn". `request_user_input` in Default
  mode used to come back as `Unknown tool "request_user_input". Available tools:
  read_file, …` — a list that does not contain it, from a harness that plainly
  does. A model reading that concludes the capability does not exist.

## Licence obligations

Apache-2.0 requires, and this folder satisfies:

- The licence text ships with the work (`upstream/LICENSE`).
- Upstream's attribution notice is preserved (`upstream/NOTICE`).
- Modified files carry prominent notice — which is why nothing here is modified;
  changes live in `overlay/` and are labelled as Willow's.
- `MANIFEST.json` records the exact commit, so what was taken is auditable.

If you ever do need to edit a vendored file, the licence requires a prominent
notice of the change in the file itself — and `codex:check` will fail until
`MANIFEST.json` is regenerated. Prefer the overlay; that is what it is for.

Read [`overlay/AGENTS.md`](overlay/AGENTS.md) next if you are changing behaviour,
or [`upstream/AGENTS.md`](upstream/AGENTS.md) if you are about to touch a
vendored file.
