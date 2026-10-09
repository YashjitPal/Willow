# features/code/src/harness

The Code tab's agent. Every message sent from the Code composer — the opening
prompt from the landing page, follow-ups, Plan mode, "Implement plan" — runs
through `runWorkbenchTurn` in this folder. There is no second path.

It replaced two: the original bolt-artifact loop (one reply, whole files, no
feedback) and the vendored Codex harness behind the old **Agent** tool. It keeps
what each did well — the bolt loop's look and its streaming file indicators, the
Codex harness's tool loop, edit formats and skills/MCP support — and is written
for what this product is: a browser-only app builder, with no shell, no server
and no build step.

## A turn

One user message is one turn. A turn is a bounded loop of **rounds**; each round
streams one model reply.

1. **The first message** carries the project (`context.ts`): a listing of every
   file, then as many file bodies as fit in 140,000 characters, entry files and
   recently changed files first. Earlier turns are compacted to prose plus
   "[Changes made: …]", so the model never sees old file bodies it might copy.
2. **While the reply streams**, `stream-parser.ts` finds action tags and each
   action applies to the turn's working copy (`workspace.ts`) the moment its tag
   closes. The transcript shows "Editing App.tsx" from the moment the tag opens.
3. **When the reply ends**, any tools it called run in order and their results
   become the next round's input. Any action that failed — a SEARCH that did not
   match, a file cut off by the output limit, invalid JSON — goes back as
   feedback so the model fixes it in the same turn.
4. **When the model is done** and the project changed, the harness builds and runs
   it (`verify.ts`). Errors go back for a fix round, up to three; after that the
   turn ends with a notice instead of looping. A `check_project` call made after
   the turn changed files is answered by this check rather than a round of its
   own: the model is asking whether its finished work runs.
5. **At the end**, `run-turn.ts` commits the working copy to the workbench in one
   step, and the preview rebuilds once, on a project that has already been run.

Limits: 40 rounds per turn (room for a build, a test session and a fix), 3
automatic fix rounds, 2 retries of a transient provider failure (rate limit,
overload, dropped connection) — and only before the first token, so a retry can
never duplicate output. Tool screenshots ride on the feedback message as image
attachments, and only the newest two stay in the conversation; each older one is
replaced by a line saying it was removed. Pictures the user attached are never
dropped.

**Rounds are the cost to watch.** Each one is a full model call, and the two
things that multiplied them in practice are both handled here: the model's own
replies stay in the conversation verbatim for the rest of the turn (older write
bodies are compacted only past 300,000 characters), because a model that cannot
see the file it just wrote reads it back before every edit; and the prompt tells
it that checking is automatic, because otherwise it verifies after every change.
Measured on Gemini 3.7 Flash, "build a small counter app" went from 7 rounds and
138 seconds to 1 round and 18 seconds with those two changes, and a follow-up
edit took one round with every SEARCH matching first time.

**Stop** aborts the stream. Actions that completed before it are kept and
committed; steps still running are marked "Stopped".

## Files

| Path | Role |
| --- | --- |
| `protocol.ts` | The vocabulary: action tags, transcript step types, and why it is a text protocol. Read first. |
| `stream-parser.ts` | Incremental tag parser. Handles tags split across chunks, code fences around tags, missing closers, aliases. |
| `search-replace.ts` | SEARCH/REPLACE parsing and the fuzzy match ladder, plus the "closest region" a failed edit is shown. |
| `apply-patch.ts` | The V4A `*** Begin Patch` format, accepted because some models reach for it. |
| `workspace.ts` | The per-turn working copy: path normalisation, writes, line deltas, the change list. |
| `context.ts` | The project snapshot and history compaction. |
| `prompt.ts` | The system prompt. |
| `tools.ts` | `HarnessTool`, the built-in tools, argument parsing. |
| `skills.ts` | The skill catalog, `$mentions`, and `read_skill`. |
| `mcp.ts` | MCP server tools as `HarnessTool`s. |
| `verify.ts` | The automatic check: strict build, then a hidden-frame run. |
| `loose-code.ts`, `stalled.ts` | Nudges for a reply that pasted code instead of writing it, or announced work and stopped. |
| `turn.ts` | The loop. Every decision about what the agent does is made here. |
| `model.ts` | The selected model → a provider binding, via `resolveProviderBinding`. |
| `code-tools.ts` | The Tools menu: each entry, the model tool it is built on, and what picking it tells the model. Both composers build their menus from it. |
| `builtin-skills.ts` | Skills that ship with the harness: `app-testing`, required before `computer`. |
| `image-tool.ts` | `generate_image`: an image from the user's image model, saved into the project. |
| `design-tool.ts` | `create_design`: a `/Designs/` screen placed on the Design canvas. |
| `browser/preview-session.ts` | One turn's hold on the live preview: loading the working copy into it, element numbers, console output, dialogs, the testing visuals. |
| `browser/page-driver.ts` | Reading the page (numbered elements with source lines) and acting on it with real DOM events. |
| `browser/browser-tools.ts` | `computer`, `inspect` and `annotate`, and the forgiving action parser. |
| `browser/screenshot.ts`, `browser/annotate.ts` | The viewport as a JPEG, and numbered marks drawn on one. |
| `run-turn.ts` | The seam to the workbench: reads the project, gives the turn the workbench-only tools, commits once — all on the Code screen it is handed (`options.session`). |
| `harness-store.ts` | One screen's live transcript, published at most once per animation frame, or a few times a second while the screen is hidden. |
| `ui/TurnTimeline.tsx` | The transcript, live and saved. |
| `ui/ThinkingRow.tsx` | The row above the reply while the turn runs: Chat's dots and the newest thought heading. |

## The Tools menu

Every entry in the composer's Tools menu is two things, the way tool menus work
in ChatGPT and Gemini: a **model tool** the agent may call on its own whenever it
helps, and — picked in the composer — a **direction** to use it for that message
(`code-tools.ts`; the direction goes into the opening message, not the system
prompt, so the prompt stays the same between turns).

| Entry | Model tool | Picked for a message |
| --- | --- | --- |
| Plan | `propose_plan` — stop on a written plan; the reply gets **Implement plan** | Plan mode (below) |
| Image | `generate_image` | Make the images the request needs and use them |
| Design | `create_design` | Design screens on the Design canvas instead of changing the app |
| Annotate | `annotate` | Answer by marking up a screenshot of the app |
| Visual Edits | `inspect` | Find the elements meant on screen and change exactly those; the user's Visual Edits selection comes along as context |
| Test | `computer` | Test the app in the preview, fix what is broken, test again |

The Test tool used to start a separate computer-use agent mid-chat, with its own
model and its own transcript. It is now the same agent: the one that wrote the
code drives the preview, sees what it broke, and fixes it in the same turn. The
Design canvas tab keeps its own chat (`startDesignGeneration`); the Design *tool*
is the harness's.

`code-harness-model-tools.test.mjs` fails if a menu entry names a model tool that
nothing registers, so the menu cannot offer something the agent cannot do.

## The live preview: `computer`, `inspect`, `annotate`

The three preview tools share one `PreviewSession` per turn (`browser/`).

- **The preview shows the turn's edits.** Files are committed only at the end of
  a turn, so before the first look the session loads the working copy into the
  workbench — but only after the strict build check passes, so a broken edit is
  reported to the model instead of breaking the user's preview — and asks for a
  rebuild (`workbench/preview-control.ts`). It does so again whenever the model
  has edited since. The rebuild injects `data-willow-source` on every element, as
  visual editing does, so each element in an observation names its file and line.
- **Every result is a screenshot plus numbered elements**: `[7] button "Add task"
  at 612,148 — /components/TaskForm.tsx:31`, then the text on screen and anything
  the app logged since the last step. Actions point at numbers; coordinates are
  the fallback for canvases. Numbers belong to the result they came with.
- **Actions use real DOM events built in the frame's own realm.** Three details
  each broke the old test agent: typing goes through the prototype's value setter
  (assigning `input.value` updates React's tracker and `onChange` never fires);
  one click is one `click` event (dispatching one and calling `element.click()`
  ran handlers twice); and typing yields between keystrokes, because React 18
  applies state in a microtask and a form submitted in the same tick reads the
  draft from before typing began.
- **Dialogs.** While the agent is acting, `alert`/`confirm`/`prompt` are answered
  automatically (confirm says OK) and reported; at any other moment, and after
  the turn, the page has its own back.
- **What the user sees**: the Test tool's glow, the "AI Testing in progress" pill
  and the moving cursor, on while the agent uses the computer and for 15 seconds
  after, so they do not flicker between its steps. The pill's Stop stops the
  turn (`session.test.setCancelHandler`). Each screen has its own testing overlay
  and frame, so a turn tests the preview of the screen it runs in, hidden or not.
  Testing switches the workbench to the preview if another panel covers it;
  `inspect` and `annotate` do not.
- **The preview's sandbox** is `allow-scripts allow-same-origin allow-forms
  allow-modals allow-popups`. Testing found this: without `allow-forms` the
  browser never fires `submit`, so every `<form onSubmit>` app was dead in the
  preview for real users too.

`computer` refuses to act until the turn has read `skill://app-testing` with
`read_skill`. The skill is the test playbook — plan journeys, use numbers, batch
predictable steps, judge by specific evidence, fix and re-test, report only what
was seen — and requiring it makes every session start from the same place.

## The protocol

The model changes files by writing tags in its reply, not by native function
calls — `protocol.ts` has the three reasons (works on every provider and relay,
streams, keeps code out of JSON strings). The actions:

```
<willow-write path="/components/Card.tsx">…whole file…</willow-write>
<willow-edit path="/App.tsx">SEARCH/REPLACE blocks</willow-edit>
<willow-delete path="/old.tsx" />
<willow-rename from="/a.tsx" to="/b.tsx" />
<willow-dependency name="recharts" version="^2.12.7" />
<willow-plan>- [x] done  - [ ] todo</willow-plan>
<willow-tool name="read_file">{"path": "/lib/utils.ts"}</willow-tool>
```

The parser is deliberately forgiving about the ways models get this wrong, and
each forgiveness has a test in `code-harness-parser.test.mjs`, run at every
chunk size from one character up: tags wrapped in code fences, a closing tag left
off before the next action, `<boltAction>` from old chats, unknown `willow-*`
tags (reported back, never shown as prose), and `<tool_result>` or
`<willow_feedback>` blocks a model imitates in its own reply (dropped with their
body — the user never sees the real ones, and an imitated one is invented).

Edits use SEARCH/REPLACE. A SEARCH that does not match exactly is retried as:
trailing whitespace ignored → indentation ignored (the replacement is
re-indented to fit) → blank lines ignored → a unique substring. One that still
fails comes back with the file's closest region, numbered, so the retry copies
real lines.

## Tools

Built-ins: `read_file`, `list_files`, `search_files`, `check_project`. Then
`read_skill` when skills are installed, and one tool per MCP server tool when
servers are connected.

A tool is a `HarnessTool` (`tools.ts`): a name, a one-line signature, a
description, `readOnly`, a `startStep` for the transcript and a `run`. **The
prompt's tool list is generated from the registry**, so it cannot describe a
tool that does not exist — `code-harness-tools.test.mjs` pins that. To add a
tool source, build `HarnessTool`s and pass them as `extraTools` (or add them
beside skills and connectors in `runTurn`).

Plan mode keeps only `readOnly` tools. Files never change through tools; they
change through actions, and the prompt says so.

## Verification

After a round that changed the project and asked for nothing further, the
checker runs:

- **Build** — the preview's own bundler in **strict** mode
  (`bundleFiles(files, { strict: true })`). The live preview is forgiving: a
  missing file renders a placeholder so a half-written project still shows
  something. Strict mode makes that an error with a file and line, as it must be
  for the model.
- **Run** — the bundle in an off-screen iframe with the preview's sandbox flags.
  Uncaught errors, React render errors, unhandled rejections and an empty `#root`
  come back as runtime errors; `Warning:` lines as warnings; the rest as console.
  It posts on its own message type, so it never raises the workbench's error
  toasts.

If the frame cannot load (offline, CDN down) the check reports **skipped**, not
failed: a frame that never ran says nothing about the app, and handing that to
the model would start a fix loop over nothing.

## Skills

The library is `@willow/core/skill-library`, the union of what its owners
publish: Spark (its editor and the `Skills/` synced folder) and **Customize →
Skills** in the shell (`apps/studio/src/customize/customize-skills.ts`).

- **The prompt lists skills, one line each** — name, short description,
  `skill://id`. Bodies stay out until needed, so a large library costs little.
- **`read_skill`** returns `SKILL.md`, or one of the skill's supporting files.
- **`$Name`** in a message (or picking from the composer's `$` menu, or a leading
  `/name`) names a skill; the first message then tells the model to read it
  before acting.
- **Willow's own skills** (`builtin-skills.ts`) sit first in the catalog and the
  `$` menu. `app-testing` is one, and `computer` will not act until the turn has
  read it; a user skill with the same id is shadowed.
- **Willow's own skills** (`builtin-skills.ts`) are listed first, in the prompt
  and the `$` menu, and a user skill with the same id is shadowed. Today there is
  one, `app-testing`, which `computer` requires (see *The live preview*).
  `read_skill` records each skill read in the turn's `readSkills`, which is how a
  tool can insist on one.

The library is read at send time, as a snapshot for the turn.

## Connectors (MCP)

The client is `@willow/ai/mcp` — shared with Spark, so it lives in `platform/`.
Servers are added under **Settings → Connectors → MCP servers** or **Spark →
Connected apps**, and connect when the workbench mounts. `mcp.ts` turns each
connected tool into a `HarnessTool` named `mcp__<server>__<tool>`, with a
compact argument signature in the prompt.

Connectors are offered in build mode only — they can act outside Willow — and
their output is wrapped and described to the model as untrusted data. A failed
call comes back as text the model can act on, never as a thrown turn. What a
browser cannot do (stdio servers) is written up in
[`HELPER-APP.md`](../../../../HELPER-APP.md).

## Plan mode

The **Plan** tool in either composer. The prompt gains a plan-mode section, file
actions are refused with feedback, connectors are withdrawn, and read-only tools
remain. The reply is a Markdown plan; the message offers **Implement plan**,
which turns Plan off and sends "Implement the plan." as a build turn — the
compacted history carries the plan into it.

The agent can also get there on its own: for a large or ambiguous request it may
write a plan and call `propose_plan`, which ends the turn (`awaitingApproval`)
and gives the reply the same **Implement plan** button.

## The transcript UI

`ui/TurnTimeline.tsx` draws a turn the way the Code tab always has: an 18px icon
in `#81888f`, a 15.15px verb, the file name in a mono pill, a shimmer while it is
happening, and consecutive work collapsed behind a chevron. It extends the
language of `workbench/collapsible-indicators.tsx` and adds nothing foreign —
keep it that way.

**Thinking shows in one place, the row above the reply**, never between the
work. While the turn runs, through every round, that row is Chat's own: Gemini's
three dots (`GeminiThinkingVisualizer`) and, beside them, the newest heading of
the model's thought summary wiping in (`ThoughtSummaryLine`). It is the dots
alone before the first heading, and for models whose thoughts have no headings.
The model is asked for thought summaries whenever it thinks (`includeThoughts`
in `model.ts`, as Chat does); the recorder keeps the turn's thoughts — a
paragraph per round, so each round's headings stay on their own lines — and
only their newest 8–16K characters. When the turn ends, the saved reply shows
the bulb and "Thought for Ns" in the row's place. N is `TurnOutcome.thinkingMs`:
the time every round spent waiting on the model before it said anything, added
up. Writing, tools and checks are not counted. It used to stop at the turn's
first output, so a turn that thought again after its tools under-reported.

While a turn runs, `LiveTurnTimeline` reads its screen's `harness-store`, so
streaming tokens re-render only that transcript. When it ends, the steps are saved on the
assistant message (`steps`, plus `harnessMode` for a plan), and the same
component renders them after a reload. `resume-code-chat.ts` sanitises saved
steps on the way back in. Messages saved before the harness have no steps and
render from their content, as they always did.

## Debugging

The last turn — system prompt, every message sent, the steps — is on
`window.willowHarness.lastTurn` in the browser console.

## Tests

All in `apps/studio/test/`, all offline:

| File | Covers |
| --- | --- |
| `code-harness-parser.test.mjs` | The stream parser, at every chunk size |
| `code-harness-edits.test.mjs` | SEARCH/REPLACE, the fuzzy ladder, re-indenting, V4A, the workspace |
| `code-harness-turn.test.mjs` | The loop with a scripted model: feedback, tools, fix rounds, truncation, retries, Stop, Plan mode, thinking time and thoughts |
| `code-harness-tools.test.mjs` | Tools, skills, connectors, and prompt ↔ registry consistency |
| `code-harness-runtime.test.mjs` | The bundler's strict mode and npm packages, against a fake CDN |
| `code-harness-model-tools.test.mjs` | The Tools-menu tools: action parsing, the observation, menu ↔ tool consistency, `generate_image`, `create_design`, the image client, the testing skill |
| `code-harness-wiring.test.mjs` | How the sidebar, landing page and preview use the harness |

What needs a real page — clicks, typing, screenshots — is not reachable from
Node. It was verified in Chrome against a React app built by the real bundler:
one click adds exactly one, typing and Enter submit through React, checkboxes,
selects, Tab, routes and scrolling behave, and a live Test turn found, fixed and
re-tested a planted bug.

`turn.ts` takes a `transport`, so a test drives the whole loop with a scripted
model. One trap when adding one: `importTs` rewrites anything that looks like an
import specifier, including inside strings, so a module under test must not
contain `from '…'` or `import '…'` in a string or comment.
