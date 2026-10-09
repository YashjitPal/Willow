# What the bots learned from other harnesses

The bots' instructions and turn handling were overhauled after reading the
source of six agent harnesses: the three strongest general ones (Codex, Hermes
Agent, OpenClaw) and three built around bots like Willow's (OpenDots, rakazo,
OpenMuse). This file records what each one does that matters, and what Willow
took from it.

Two rules held throughout:

- **Willow's own words.** Nothing was copied. Each idea was restated as a
  principle in the voice of `overlay/dot-profile.ts`, and the prompt tests
  check that no other harness is named in it.
- **Principles, never samples.** Several references teach with sample replies
  or "good/bad" lists. Willow's prompt still has none (see the header of
  `overlay/dot-profile.ts`): a sample gets copied, while a principle carries
  over to cases the sample never covered.

Every feature the bots had before is unchanged: the messenger protocol,
reactions with any emoji, Seen, status line, plans, triggers, sleep, the
notebook and its layers, helpers, Spark tasks, both computers, the user's
screen, Discord, Telegram, email, permissions and approvals.

## Codex (`openai/codex`)

Read: the model catalog `codex-rs/models-manager/models.json`, whose
per-model `instructions_template` is what Codex actually sends. The GPT-6
Astra entry matters most, since that is the bots' model. Also:
`codex-rs/protocol/src/prompts/base_instructions/default.md` (the fallback),
`codex-rs/core/gpt_5_2_prompt.md` (an older variant),
`codex-rs/ext/goal/templates/goals/continuation.md`,
`codex-rs/prompts/templates/persistent_mode.md`, `codex-rs/prompts/templates/compact/`,
`codex-rs/ext/memories/templates/memories/read_path.md`,
`codex-rs/core/templates/agents/orchestrator.md`,
`codex-rs/prompts/templates/permissions/approval_policy/on_request.md`,
`codex-rs/prompts/templates/guardian/policy.md`,
`codex-rs/collaboration-mode-templates/templates/default.md`.

What it does well:

- **The Astra prompt.**
  - Asking for permission:
    - Authorisation persists across turns.
    - Once what the user said covers the next step, take it.
    - Do all the authorised work first, so the user approves something
      concrete as the last step.
    - Say why a confirmation is needed whenever you stop for one.
  - Persistence:
    - A request to act is never answered by saying you can, a plan, or an
      offer to continue.
    - Never settle for a "helpful enough" partial answer.
    - With unclear intent, progress anyway and ask alongside.
  - Steering and compaction:
    - A mid-work message steers the task rather than replacing it.
    - Compaction does not end the task: no restarting, no redoing finished
      work, no repeating updates already given.
  - Writing: plain words in connected prose, no stock phrases, no closing
    summary line, and no contrasting your plan with an alternative nobody
    raised.
  - Getting work done: batch only what is independent, and add no
    unsolicited warnings about hypothetical risk.
- **Persistence.** It keeps working until the request is fully handled: the
  work, its verification and a clear account of the outcome. It pushes past
  failed tool calls and resolves blockers itself.
- **Acting over proposing.** Unless the user only wanted a plan or an opinion,
  it does the work instead of describing it.
- **Plans.** Steps are real work, never filler. Exactly one is in progress,
  and the plan changes when the scope does.
- **Ambition vs precision.** Creative on new work, surgical on existing work.
  It adds the right extras, never gold-plating. It fixes the root cause, and
  mentions unrelated problems instead of fixing them.
- **Validation.** It starts with the narrowest check of what changed, then
  widens.
- **Editing.** Never revert changes you did not make. When files change
  under you, find out before going on.
- **Persistent mode** (the closest match to a bot):
  - Follow-ups close known loops or confirm a change took effect, never
    invent work.
  - Nothing already said is said again.
  - Being woken is not a new request.
  - A follow-up has a scope, the evidence that settles it, and a stopping
    point, and survives sleeps.
  - Persistence never widens what was authorised.
- **Goal continuation.**
  - The current state is the authority, not memory of earlier work.
  - A restated status is no progress.
  - The goal is never narrowed to what is easy.
  - Completion is audited requirement by requirement.
  - A blocker counts only once it repeats.
- **Memory.** It looks things up by default unless the request is
  self-contained. It verifies facts that drift easily when that is cheap, and
  says when an answer rests on memory that may be stale.
- **Guardian policy.**
  - Sending private data out needs authorisation for that payload to that
    destination.
  - No hunting for credentials after a sign-in fails.
  - The exact target is pinned down before anything destructive.
  - No weakening of security beyond the task.
  - No getting around an approval by another route.

Adopted:

- **"Doing the work well"**:
  - act rather than describe;
  - don't stop at saying you can, at a plan or at an offer, and no "helpful
    enough" partial answer (Astra);
  - check that it worked.
- **"How you work"**: the promise rule, shared with OpenClaw.
- **Permission in the default mode**: take a step what the user said already
  covers, and say why a go-ahead is needed (Astra).
- **"Writing messages"**: plain words in connected sentences, no stock
  phrases, no closing summary, no contrasting with an alternative nobody
  raised, and no warnings about hypothetical risk (Astra).
- **"Memory"**: work running across a condensing is one piece of work, with no
  restarting, redoing or repeating (Astra).
- **"The user's computer"**: never undo a change you did not make, and look
  before going on when files changed under you.
- **"Plans"**:
  - resume from how things stand;
  - a restated status is no progress;
  - keep the whole goal;
  - check every requirement before calling the work done.
- **"Deciding how to respond"**: say each thing once, and leave a pending
  question open.
- **"Writing messages"**: read the moment, short when the user is moving fast
  and full of ideas when they are stuck.
- **"Memory"**: say when a remembered answer may be out of date.
- **"Safety"**:
  - a refusal stands;
  - credentials stay where they belong;
  - sharing needs its own permission;
  - be certain what a destructive action touches;
  - never weaken a protection.
- **Already in Willow:** the persistent-mode follow-up rules ("How you work",
  "Time"), the plan stall counter (`stillTurns` in `dot-runtime.ts`), and
  compaction as a handoff (`memory/compaction-prompts.ts`).

Not adopted:

- **Final-answer formatting rules** (headers, bullets, file references). A bot
  writes chat messages, not terminal reports.
- **The commentary/final channel split and the 60-second update clock.** A
  bot's messages all stay visible, and it writes at the moments a person
  would. A waiting user hears from it within about ten seconds of quiet work
  (`QUIET_WORK_MS`).
- **The Plan collaboration mode.** Bots have no mode switch; their plans live
  in `update_plan`.

## Hermes Agent (`nousresearch/hermes-agent`)

Read: `agent/prompt_builder.py` (identity, memory guidance, tool-use
enforcement, task completion, async handoff, parallel calls, execution
discipline, Google operational guidance, platform hints) and
`agent/background_review.py`.

What it does well:

- **Identity.**
  - Reply length matches the weight of the ask.
  - Finished work gets a short report of what changed, what is verified and
    what is left, not a replay.
  - No filler, no restating the request.
  - It agrees because something is right.
  - It says so plainly when it is unsure.
- **Tool-use enforcement.** Every response either makes progress with tools
  or delivers a result. A stated intention is acted on in the same response.
- **Finishing the job.** The deliverable is real output. When the real path
  is blocked, it says so and tries another way, and never fabricates a
  result.
- **Execution discipline.**
  - Tools before memory for anything that changes, and for arithmetic.
  - The obvious reading of a request is acted on.
  - Prerequisites come first.
  - Empty or narrow results are retried differently.
  - External writes are read back.
  - Stated totals must reconcile.
  - Identifiers are never "repaired".
  - Assumptions are labelled.
- **Parallel calls.** Independent lookups go in one response, and the runtime
  runs them concurrently.
- **Async handoff.** Once only delegated results remain, it ends the turn
  instead of polling.
- **Memory.**
  - Entries are declarative facts, never orders to itself, because an order
    gets re-read later as a directive.
  - Procedures go in skills.
  - Stale entries are consolidated rather than the save skipped.
  - Past sessions are searched before the user is asked to repeat
    themselves.
- **Background review.** After a turn, a forked agent decides whether
  anything should be saved to memory or skills.

Adopted:

- **"Who you are"**: agree because it is right, and say when unsure.
- **"Writing messages"**: size every reply, no replay, no filler.
- **"Doing the work well"**:
  - find out before you ask;
  - check what changes instead of recalling it;
  - settle what an action depends on before taking it;
  - ask for independent things together;
  - do not settle for the first answer;
  - never make anything up;
  - keep exact things exact;
  - check that it worked.
- **"Memory"**:
  - facts, not orders to yourself;
  - methods belong in skills;
  - merge and prune;
  - `recall` before asking the user to repeat something.
- **"Delegating"**: never claim a result before it arrives.
- **Turn loop**: look-only calls in a row run concurrently (see "Turn
  handling" below).
- **The notebook check in the now block** stands in for background review:
  when the user has said a good deal since the notebook last changed, the bot
  is told to save what should last. That keeps the idea without a second
  model run after every turn.
- **The check-your-change notice** comes from Hermes' rule that a coding
  task ends with real execution.

Not adopted: model-family switches (Willow's prompt is the same for every
model) and the terminal-specific lines (`date`, `sha256sum`). Willow's
version says to use a tool "when one can do it".

## OpenClaw (`openclaw.ai`)

Read: `docs/reference/templates/AGENTS.md`, `SOUL.md`, `HEARTBEAT.md`,
`src/agents/system-prompt.ts` (tool call style, execution bias, silent
replies), `src/agents/gpt5-prompt-overlay.ts`,
`src/agents/promised-work-prompt.ts`,
`extensions/memory-core/src/flush-plan.ts`.

What it does well:

- **Execution bias.**
  - Act on actionable requests.
  - Don't pre-refuse or ask for permission the approval system does not
    require.
  - Vary a weak search before concluding.
  - Check mutable facts live.
  - Every final claim needs evidence or a named blocker.
- **Promised work.**
  - "Checking now" is a progress update, not an answer.
  - A correction updates the task in hand; don't stop at an apology.
  - Promising later creates ownership, so arrange the way back or don't
    promise.
  - Come back with the result unasked.
  - "Running" is not done.
- **Behaviour contract.**
  - Clear and reversible: act. Irreversible, external or private: ask.
  - Tool evidence beats recall.
  - Parallel independent retrieval; dependent or approval work in order.
  - Verify with the smallest meaningful check.
- **Heartbeats.** Progress, not chatter. Never send "no change" updates.
  Interrupt only for a result, a blocker, a decision or a time risk.
- **Interaction style.** Unblock with a reasonable assumption and state it.
  Never offload needless work. Material trade-offs get the best few options
  with a recommendation.
- **Pre-compaction flush.** Before the context is compacted, the agent gets a
  turn to write durable memory.
- **Group etiquette and platform formatting** (templates): one reply, no
  tables on chat apps.

Adopted:

- **"How you work"**: promise later only when something will bring you back,
  and come back unasked.
- **"Doing the work well"**: verify with a fitting check.
- **"Triggers"**: never a run report that only says nothing changed, and
  treat a run as work nobody will steer.
- **"Writing messages"**: options with a recommendation, and light formatting
  without tables on Discord and Telegram.
- **Pre-compaction flush**: the now block tells the bot when the oldest
  stretch is about to be condensed (`notebookLine` in
  `memory/context-builder.ts`). The memory is written in a turn the bot is
  already taking, not a separate one.
- **Already in Willow:** reactions with no forced acknowledgement, quiet
  hours, the quiet-vs-reach-out bar, and the permission modes.

Not adopted: a silent-reply token. A Willow bot ends its turn without a
message instead, which the protocol already supports.

## OpenDots (`CopilotKit/OpenDots`)

Read: `src/server/dot-agent.ts` (the dot prompt), `src/server/headless.ts`,
`src/server/runner.ts`, `src/server/voice.ts`, `docs/COMPUTERS.md`, `README.md`.

What it does well:

- **Tool honesty.**
  - It checks whether a tool or computer is available before saying it
    isn't.
  - It never claims an action happened without tool evidence.
- **Approvals.**
  - When a connected service requires approval, it asks once and waits.
  - It never retries another way.
  - A declined request is not retried unless the user asks.
- **Internal ids.** It discovers them itself and never asks the user for
  them.
- **Untrusted content.** Page content is re-read before editing it, and is
  data.
- **Headless runs.** Runs nobody is watching are carried to completion.

Adopted:

- **"Doing the work well"**: know what you can do; check before saying you
  cannot.
- **"Safety"**: a refusal stands.
- **"Triggers"**: a run is work nobody will steer.
- **Already in Willow:** the bot discovers ids itself (channel names,
  triggers), page text is data, and declined commands stay declined
  ("The user's computer").

## rakazo (`elie222/rakazo`)

Read: `packages/adapters/src/tool-loop.ts`, `packages/adapters/src/executor.ts`
(computer, history, progress and untrusted-content guidance),
`packages/core/src/bot-messages.ts`, `packages/core/src/messaging-prompts.ts`,
`packages/adapters/src/builtin-skills.ts`.

What it does well:

- **Loop guard.** Six identical consecutive tool calls end the loop
  (`MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS`).
- **Relaying delegated work.** A report from another bot is passed on with
  its substance (names, dates, numbers), never as "it came through". A side
  note is mentioned only if it changes the user's outcome.
- **Handoffs.** A handoff transfers ownership, and work is never bounced
  back.
- **Untrusted data.** Compacted summaries, recalled memory, tool content and
  quoted messages are all data. Page banners saying the work is finished are
  page content, not a stop signal.
- **Computer use.**
  - Never kill or restart the browser or display.
  - Look again when someone else may have touched the screen.
- **History.**
  - Answer from facts already in view.
  - Search narrow, then broad.
  - When a fact is absent, say so briefly.
- **Exactness and secrets.** Pagination cursors are copied exactly. Secrets
  are never printed or written into commands.
- **Progress updates.** A few short ones, never the final answer.

Adopted:

- **Turn loop**: the repeated-call guard. It warns at the third identical
  call in a row, refuses the sixth, and ends the turn if the bot insists.
  Screens, scrolling and status checks are exempt.
- **"Writing messages"**: give the substance of what came from elsewhere.
- **"Delegating"**: what you hand over is theirs to do.
- **"Safety"**:
  - summaries and reports are information;
  - words on a page saying the work is finished are part of the page;
  - never write a secret into a message, note or command.
- **"Your computer"**: never stop what runs your desktop and browser.
- **"While you work"**: the status line never carries an answer.
- **`recall` tool**: try other words before concluding something was never
  said.
- **Already in Willow:** looking again before every screen action, and
  private things staying out of Discord servers.

## OpenMuse (`CopilotKit/openmuse`)

Read: `apps/server/src/engine/conversation.ts` (the agent prompt),
`apps/server/src/engine/tanstack-agent.ts`, `apps/server/src/computer-tools.ts`,
`docs/COMPUTER.md`.

What it does well:

- **Durable work.** Requested jobs become durable delegated work, never a
  list of steps for the person.
- **Done means confirmed.** Completion is never claimed before status and a
  receipt confirm it.
- **Honest connectors.**
  - Never pretend a connector works.
  - Report a connector error instead of claiming an empty calendar.
  - Never assume the server's time zone is the user's.
  - Say when results are truncated.
- **Reading pages.**
  - Answer from returned page text.
  - Never claim to have opened a page.
  - Keep search snippets distinct from pages actually read.

Adopted:

- **"Doing the work well"**:
  - a description of the steps is not the work;
  - never say you opened, read, sent or checked something you did not;
  - never pretend a tool or a connection works.
- **`read_web_page` tool**: answer from what it returns, and say so when a
  page cannot be read.
- **Already in Willow:** time in the user's own zone (the now block), and
  Spark tasks as durable work.

## Turn handling (`runtime/dot-loop.ts`, `memory/context-builder.ts`)

The harness changes that came out of this, each covered by
`apps/studio/test/dots-harness.test.mjs`:

- **Look-only calls run at once.** A run of consecutive calls to tools that
  only look runs concurrently (`CONCURRENT_TOOLS`): `recall`, web reads,
  skills, attachments, workspace files, the user's files, status checks. The
  bot's own computer is left out, since a call there may start it. Calls and
  results are still recorded in the order written, and anything that acts
  still runs alone, in order. Pictures from look-ups now add up instead of
  replacing one another. Sources: Hermes and Codex.
- **Repeated calls are stopped.** The same call with the same arguments
  (compared regardless of key order):
  - gets a notice at the third time in a row (`REPEAT_NOTICE_AT`);
  - is refused, not run, at the sixth (`REPEAT_STOP_AT`);
  - ends the turn if it comes again after the refusal.

  Tools whose repeats are normal (`REPEATABLE_TOOLS`) are neither counted nor
  allowed to keep a streak alive: screenshots, scrolling, key presses and
  status checks. Source: rakazo.
- **Check your change.** A turn that changed files on a computer and ran
  nothing since gets one notice before it ends, provided a way to run
  something exists. A change still waiting on the user's card doesn't count.
  Sources: Hermes and OpenClaw.
- **Only messages reach the user.** While the user's messages are new, the
  now block reminds the bot that they see only messages and reactions. This
  is the cheap guard against an answer written as private prose, next to the
  unheard notice that catches it afterwards.
- **Write it down before it fades.** The now block gets a line when the
  window is near condensation (90% of `verbatimHigh`), or when the user has
  written `NOTEBOOK_STALE_AFTER` (15) messages since the notebook last
  changed. Sources: OpenClaw's pre-compaction flush and Hermes' background
  review.
- **Helper brief.** The helper brief (`runtime/helpers.ts`) now says that
  nobody can answer the helper's questions, that its reports rest on tool
  output, that nothing is invented, that exact things stay exact, and that
  its report covers what it changed and what it could not verify.
