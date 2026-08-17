# The Codex harness

Code Beta's agent loop is a port of [openai/codex](https://github.com/openai/codex)
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

   `code-beta-harness.test.mjs` is the gate. It fails loudly if a required
   overlay anchor no longer exists, if the composed prompt stops denying a
   shell, or if a vendored file does not match its checksum.

4. **Fix anchors, if any.** See below.

5. **Read the composed prompt.** Code Beta → Harness → Prompt. It is the actual
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
| `LICENSE`, `NOTICE` | Required by Apache-2.0 §4 for redistribution. |

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
   so native calling would pin Code Beta to one provider.

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
- **`MAX_ITERATIONS` is 12.** On exhaustion the user is told, in the transcript,
  rather than the turn ending silently.

Sub-agents run the identical loop through a different `CallSink` — that
indirection is the only difference between a main turn and a delegated one. They
get every tool except `task`, because unbounded recursion in a browser tab is
not a feature.

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
