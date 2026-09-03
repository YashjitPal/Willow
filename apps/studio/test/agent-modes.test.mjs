/**
 * Plan mode and Goal mode, against upstream Codex.
 *
 * Both are real subsystems upstream rather than prompt shapes — Plan mode is a
 * `ModeKind` with its own vendored developer document, and Goal mode is the
 * `ext/goal` crate with three tools and an idle-continuation loop. This file
 * pins the parts that are easy to approximate and wrong when approximated.
 *
 * Where an assertion quotes a string, that string is upstream's. The references
 * are:
 *
 * - `codex-rs/protocol/src/config_types.rs`            — `ModeKind`
 * - `codex-rs/collaboration-mode-templates/templates/` — the mode documents
 * - `codex-rs/core/src/tools/handlers/plan.rs`         — the `update_plan` refusal
 * - `codex-rs/core/src/tools/handlers/request_user_input_spec.rs`
 * - `codex-rs/utils/stream-parser/src/proposed_plan.rs`
 * - `codex-rs/protocol/src/protocol.rs`                — `ThreadGoalStatus`
 * - `codex-rs/ext/goal/src/{spec,runtime,steering}.rs`
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (...segments) =>
  path.join(repoRoot, 'features', 'code', 'src', 'agent', 'harness', ...segments);

const collab = await importTs(harness('overlay', 'collaboration-mode.ts'));
const policy = await importTs(harness('overlay', 'tool-policy.ts'));
const proposedPlan = await importTs(harness('runtime', 'proposed-plan.ts'));
const goalModule = await importTs(harness('runtime', 'goal.ts'));
const requestUserInput = await importTs(harness('runtime', 'request-user-input.ts'));
const agentModule = await importTs(harness('runtime', 'agent.ts'));

const { runTurn } = agentModule;
const { GoalRuntime } = goalModule;

const MODEL = { label: 'Test Model', options: { provider: 'gemini', model: 'test', apiKey: 'k' } };

/** Replays scripted responses, one per model round, in small slices. */
function scriptedTransport(responses) {
  const seen = [];
  let round = 0;
  const transport = async (messages, _options, onToken, _onStart, systemPrompt) => {
    seen.push({ messages, systemPrompt });
    const body = responses[round] ?? '';
    round += 1;
    for (let i = 0; i < body.length; i += 7) onToken(body.slice(i, i + 7));
  };
  transport.rounds = seen;
  Object.defineProperty(transport, 'count', { get: () => round });
  return transport;
}

async function run(responses, startingFiles = {}, extra = {}) {
  let files = { ...startingFiles };
  const events = [];
  const transport = scriptedTransport(responses);

  await runTurn({
    prompt: 'do the thing',
    history: [],
    files: () => ({ ...files }),
    writeFiles: (next) => {
      files = { ...next };
    },
    model: MODEL,
    transport,
    onEvent: (event) => events.push(event),
    ...extra,
  });

  return { files, events, transport };
}

const observationsSent = (transport) =>
  transport.rounds
    .flatMap(({ messages }) => messages)
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n');

/* ====================================================================== */
/* Plan mode                                                              */
/* ====================================================================== */

it('has exactly the two modes upstream has, with its aliases', () => {
  // `ModeKind` is `Plan` and `Default`. `code`, `pair_programming`, `execute`
  // and `custom` are serde *aliases* of Default, not modes of their own.
  assert.deepEqual(collab.COLLABORATION_MODES, ['default', 'plan']);
  assert.equal(collab.MODE_DISPLAY_NAME.plan, 'Plan');
  assert.equal(collab.MODE_DISPLAY_NAME.default, 'Default');

  for (const alias of ['code', 'pair_programming', 'execute', 'custom', 'nonsense', '']) {
    assert.equal(collab.parseModeKind(alias), 'default', `${alias} should resolve to Default`);
  }
  assert.equal(collab.parseModeKind('plan'), 'plan');
  assert.equal(collab.parseModeKind('PLAN'), 'plan');
});

it("sends the vendored mode document, not a paraphrase of it", () => {
  /*
   * This is the assertion that would have caught the original port. `/plan`
   * used to expand to a three-line composer template ending "Use update_plan",
   * which is the *opposite* of Plan mode: upstream refuses that tool there and
   * spends a whole section of the mode document explaining why.
   *
   * The document is 9KB of behaviour. Reproducing it by hand is not a thing
   * anyone should attempt, so the test is that we do not.
   */
  const vendored = fs.readFileSync(harness('upstream', 'collaboration_mode_plan.md'), 'utf8');
  const section = collab.collaborationModeSection('plan');

  assert.ok(section.startsWith('<collaboration_mode>'));
  assert.ok(section.trimEnd().endsWith('</collaboration_mode>'));
  assert.ok(section.includes(vendored.trim()), 'the plan document must be sent verbatim');

  // The load-bearing passages, so a re-vendor that loses them is caught.
  assert.match(section, /You are in \*\*Plan Mode\*\* until a developer message explicitly ends it/);
  assert.match(section, /You must not perform \*\*mutating\*\* actions/);
  assert.match(section, /it will return an error/);
  assert.match(section, /<proposed_plan>/);
  assert.match(section, /request_user_input/);
});

it('renders the Default document, including its mode-name placeholder', () => {
  const section = collab.collaborationModeSection('default');

  assert.match(section, /You are now in Default mode/);
  // `{{KNOWN_MODE_NAMES}}` exists so the list is written once. An unrendered
  // placeholder reaching the model is worse than no sentence at all.
  assert.doesNotMatch(section, /\{\{/, 'no placeholder may survive rendering');
  // Upstream has *two* mode-name formatters and they differ. `format_mode_names`
  // (collaboration_mode_presets.rs) joins a pair with " and "; the separate
  // `format_allowed_modes` (request_user_input_spec.rs) yields "Default or Plan
  // mode". Collapsing them to one helper put the wrong sentence in a document
  // whose whole job is telling the model which modes exist.
  assert.match(section, /Known mode names are Default and Plan\./);
});

it('refuses update_plan in Plan mode, with upstream\'s exact message', async () => {
  // `plan.rs`: FunctionCallError::RespondToModel(
  //   "update_plan is a TODO/checklist tool and is not allowed in Plan mode")
  assert.equal(
    collab.UPDATE_PLAN_IN_PLAN_MODE_ERROR,
    'update_plan is a TODO/checklist tool and is not allowed in Plan mode',
  );

  const { events, transport } = await run(
    [
      `Let me plan.

*** Call: update_plan
{"plan": [{"step": "one", "status": "pending"}]}
*** End Call
`,
      'Understood — planning only.\n',
    ],
    {},
    { mode: 'plan' },
  );

  assert.match(observationsSent(transport), /not allowed in Plan mode/);
  // Refused, so no plan card was opened.
  assert.equal(
    events.filter((event) => event.type === 'call-start' && event.call.kind === 'plan').length,
    0,
  );
});

it('declines mutation in Plan mode and writes nothing', async () => {
  /*
   * The one place Willow enforces what upstream instructs.
   *
   * Upstream's `apply_patch` is a tool call it can refuse before running.
   * Willow's patches apply the instant the envelope closes, mid-stream, to make
   * the preview feel live — so an instruction-only boundary would mean a model
   * that ignores it has already written the user's files.
   */
  const { files, events, transport } = await run(
    [
      `I'd change this.

*** Begin Patch
*** Add File: /App.tsx
+export default function App() { return null; }
*** End Patch
`,
      'Right — here is the plan instead.\n',
    ],
    { '/existing.ts': 'export const a = 1;\n' },
    { mode: 'plan' },
  );

  assert.deepEqual(Object.keys(files), ['/existing.ts'], 'Plan mode must not write files');
  assert.match(observationsSent(transport), /not applied/);
  assert.match(observationsSent(transport), /Plan mode/);
  assert.match(observationsSent(transport), /the project is[\s\S]*unchanged/i);

  // And no edit card, which would read as a failed patch rather than as the
  // mode declining one.
  const editCards = events.filter(
    (event) =>
      event.type === 'call-start' &&
      ['edit', 'create', 'delete'].includes(event.call.kind),
  );
  assert.equal(editCards.length, 0);
});

it('still lets Plan mode explore, because that is what it is for', async () => {
  // The mode document's own list: reading, searching and inspecting are
  // *allowed*. A mode that refused everything would be useless.
  const { transport } = await run(
    [
      `*** Call: read_file
{"path": "/App.tsx"}
*** End Call
`,
      'Now I understand the shape of it.\n',
    ],
    { '/App.tsx': 'export default function App() { return null; }\n' },
    { mode: 'plan' },
  );

  const sent = observationsSent(transport);
  assert.match(sent, /export default function App/);
  assert.doesNotMatch(sent, /ERROR read_file/);
});

it('applies patches normally in Default mode', async () => {
  // The mirror of the test above: the gate must be the mode, not a new
  // restriction on every turn.
  const { files } = await run([
    `*** Begin Patch
*** Add File: /App.tsx
+export default function App() { return null; }
*** End Patch
`,
    'Done.\n',
  ]);

  assert.ok(files['/App.tsx'], 'Default mode still writes');
});

/* ---------------------------------------------------------------------- */
/* request_user_input                                                      */
/* ---------------------------------------------------------------------- */

it('offers request_user_input in Plan mode only, with upstream\'s wording', () => {
  // `ModeKind::allows_request_user_input` is true for Plan only.
  assert.equal(collab.allowsRequestUserInput('plan'), true);
  assert.equal(collab.allowsRequestUserInput('default'), false);

  // `request_user_input_unavailable_message`
  assert.equal(
    collab.requestUserInputUnavailableMessage('default'),
    'request_user_input is unavailable in Default mode',
  );
  assert.equal(collab.requestUserInputUnavailableMessage('plan'), null);

  // `request_user_input_tool_description` + `format_allowed_modes`
  assert.equal(
    collab.requestUserInputToolDescription(['plan']),
    'Request user input for one to three short questions and wait for the response. ' +
      'This tool is only available in Plan mode.',
  );
  assert.equal(
    collab.requestUserInputToolDescription(['default', 'plan']),
    'Request user input for one to three short questions and wait for the response. ' +
      'This tool is only available in Default or Plan mode.',
  );
  assert.match(collab.requestUserInputToolDescription([]), /only available in no modes\./);
});

it('validates questions the way normalize_request_user_input_tool_args does', () => {
  const { normalizeQuestions } = requestUserInput;

  // Upstream's exact message, and its exact condition.
  assert.equal(
    normalizeQuestions([{ id: 'a', header: 'A', question: 'Which?', options: [] }]),
    'request_user_input requires non-empty options for every question',
  );
  assert.match(normalizeQuestions([]), /non-empty "questions" array/);
  assert.match(normalizeQuestions('nope'), /non-empty "questions" array/);
  // "Prefer 1 and do not exceed 3".
  assert.match(
    normalizeQuestions(
      Array.from({ length: 4 }, (_, i) => ({
        id: `q${i}`,
        header: 'H',
        question: 'Which?',
        options: [{ label: 'a', description: 'x' }],
      })),
    ),
    /at most 3 questions/,
  );

  // `is_other` is forced on, never taken from the model: the schema tells it
  // not to write an "Other" option because the client always adds one.
  const ok = normalizeQuestions([
    { id: 'storage', header: 'Storage', question: 'Where?', options: [{ label: 'localStorage' }] },
  ]);
  assert.equal(ok[0].isOther, true);
});

it('blocks the turn on a question in Plan mode, and not in Default', async () => {
  const asked = [];
  const sink = async (request) => {
    asked.push(request);
    return [{ id: 'storage', answer: 'localStorage' }];
  };

  const { transport } = await run(
    [
      `*** Call: request_user_input
{"questions": [{"id": "storage", "header": "Storage", "question": "Where should drafts live?", "options": [{"label": "localStorage", "description": "Survives reload."}]}]}
*** End Call
`,
      'Thanks — planning around localStorage.\n',
    ],
    {},
    { mode: 'plan', requestUserInput: sink },
  );

  assert.equal(asked.length, 1);
  // `is_blocking: mode == ModeKind::Plan` — the one behavioural difference
  // between the modes, and upstream's whole reason for gating on mode.
  assert.equal(asked[0].isBlocking, true);
  assert.match(observationsSent(transport), /localStorage/);

  // In Default mode the tool is not registered, and the refusal names the mode
  // rather than reporting an unknown tool — the first is recoverable inside the
  // turn, the second is not.
  const inDefault = await run(
    [
      `*** Call: request_user_input
{"questions": [{"id": "q", "header": "H", "question": "Which?", "options": [{"label": "a"}]}]}
*** End Call
`,
      'Proceeding on my own judgement.\n',
    ],
    {},
    { mode: 'default', requestUserInput: sink },
  );

  assert.match(
    observationsSent(inDefault.transport),
    /request_user_input is unavailable in Default mode/,
  );
  assert.equal(asked.length, 1, 'the sink must not be reached in Default mode');
});

it('reports no answer as an empty map and a dismissal as cancelled', async () => {
  /*
   * An empty answer set is a legitimate outcome, and upstream reports it as an
   * empty map with no commentary attached — `RequestUserInputResponse` is a
   * `HashMap`, so zero answers serialise to `{}`.
   *
   * This assertion used to require the phrase "best judgement", citing
   * `default.md`. That sentence is not in `default.md`, nor in `plan.md`; it
   * was invented and then pinned. The guidance it reached for is already in
   * `plan.md` in upstream's own words, so the model has read it — it does not
   * need a paraphrase competing with it from inside a tool result.
   */
  const empty = await run(
    [
      `*** Call: request_user_input
{"questions": [{"id": "q", "header": "H", "question": "Which?", "options": [{"label": "a"}]}]}
*** End Call
`,
      'Going with the recommended option.\n',
    ],
    {},
    { mode: 'plan', requestUserInput: async () => [] },
  );
  assert.match(observationsSent(empty.transport), /\{"answers":\{\}\}/);
  assert.doesNotMatch(observationsSent(empty.transport), /cancelled/);

  const dismissed = await run(
    [
      `*** Call: request_user_input
{"questions": [{"id": "q", "header": "H", "question": "Which?", "options": [{"label": "a"}]}]}
*** End Call
`,
      'Understood.\n',
    ],
    {},
    { mode: 'plan', requestUserInput: async () => null },
  );
  assert.match(
    observationsSent(dismissed.transport),
    /was cancelled before receiving a response/,
  );
});

/* ---------------------------------------------------------------------- */
/* <proposed_plan>                                                         */
/* ---------------------------------------------------------------------- */

it('parses <proposed_plan> exactly as upstream does', () => {
  const { ProposedPlanParser, stripProposedPlanBlocks, extractProposedPlanText } = proposedPlan;

  // Upstream's `streams_proposed_plan_segments_and_visible_text`, chunked at
  // the same awkward boundary — the tag is split across two deltas.
  const parser = new ProposedPlanParser();
  let visible = '';
  const segments = [];
  for (const chunk of ['Intro text\n<prop', 'osed_plan>\n- step 1\n', '</proposed_plan>\nOutro']) {
    const out = parser.push(chunk);
    visible += out.visibleText;
    segments.push(...out.extracted);
  }
  const tail = parser.finish();
  visible += tail.visibleText;
  segments.push(...tail.extracted);

  assert.equal(visible, 'Intro text\nOutro');
  assert.deepEqual(segments, [
    { kind: 'normal', text: 'Intro text\n' },
    { kind: 'start' },
    { kind: 'delta', text: '- step 1\n' },
    { kind: 'end' },
    { kind: 'normal', text: 'Outro' },
  ]);

  /*
   * `preserves_non_tag_lines`. This is the rule that matters: a tag counts only
   * when it is alone on its line, because plans discuss their own format. A
   * model writing "wrap it in a `<proposed_plan>` block" must not open one.
   */
  const inline = new ProposedPlanParser();
  const inlineOut = inline.push('  <proposed_plan> extra\n');
  assert.equal(inlineOut.visibleText, '  <proposed_plan> extra\n');
  assert.deepEqual(inlineOut.extracted, [
    { kind: 'normal', text: '  <proposed_plan> extra\n' },
  ]);

  // `closes_unterminated_plan_block_on_finish` — a stream that dies mid-plan
  // still leaves a complete, renderable block.
  const unterminated = new ProposedPlanParser();
  const first = unterminated.push('<proposed_plan>\n- step 1\n');
  const closed = unterminated.finish();
  assert.equal(first.visibleText + closed.visibleText, '');
  assert.deepEqual([...first.extracted, ...closed.extracted], [
    { kind: 'start' },
    { kind: 'delta', text: '- step 1\n' },
    { kind: 'end' },
  ]);

  // `strips_proposed_plan_blocks_from_text` / `extracts_proposed_plan_text`
  const text = 'before\n<proposed_plan>\n- step\n</proposed_plan>\nafter';
  assert.equal(stripProposedPlanBlocks(text), 'before\nafter');
  assert.equal(extractProposedPlanText(text), '- step\n');
  assert.equal(extractProposedPlanText('no plan here'), null);

  // "any new `<proposed_plan>` must be a complete replacement" — so the last
  // block wins rather than the two concatenating.
  assert.equal(
    extractProposedPlanText(
      '<proposed_plan>\nold\n</proposed_plan>\n<proposed_plan>\nnew\n</proposed_plan>',
    ),
    'new\n',
  );
});

it('lifts the plan block into its own card, in Plan mode only', async () => {
  const script = `Here is what I would do.

<proposed_plan>
## Summary
Add a drafts store.
</proposed_plan>
`;

  const inPlan = await run([script], {}, { mode: 'plan' });
  const planCards = inPlan.events.filter(
    (event) => event.type === 'call-start' && event.call.kind === 'proposed-plan',
  );
  assert.equal(planCards.length, 1, 'the plan is the deliverable and gets its own card');

  const prose = inPlan.events
    .filter((event) => event.type === 'text')
    .map((event) => event.chunk)
    .join('');
  assert.match(prose, /Here is what I would do\./);
  assert.doesNotMatch(prose, /Add a drafts store/, 'the block is lifted out of the prose');
  assert.doesNotMatch(prose, /<proposed_plan>/);

  // The card fills in as the block streams, so it renders live rather than
  // appearing whole at the end.
  const progress = inPlan.events.filter(
    (event) => event.type === 'call-progress' && event.id === planCards[0].call.id,
  );
  assert.ok(progress.length > 1, 'the plan card should stream');
  assert.match(progress.at(-1).patch.markdown ?? '', /Add a drafts store/);

  /*
   * Not in Default mode. Upstream gates it the same way
   * (`stream_events_utils.rs` computes `mode() == Plan` first), and the gate
   * matters in both directions: outside Plan mode the block has no meaning, so
   * a model that merely mentions the tag would open a card for it.
   */
  const inDefault = await run([script]);
  assert.equal(
    inDefault.events.filter(
      (event) => event.type === 'call-start' && event.call.kind === 'proposed-plan',
    ).length,
    0,
  );
});

/* ====================================================================== */
/* Goal mode                                                              */
/* ====================================================================== */

it('has upstream\'s ThreadGoalStatus set and objective limits', () => {
  assert.equal(goalModule.MAX_THREAD_GOAL_OBJECTIVE_CHARS, 4_000);

  // `validate_thread_goal_objective`, both messages.
  assert.equal(goalModule.validateThreadGoalObjective(''), 'goal objective must not be empty');
  assert.equal(
    goalModule.validateThreadGoalObjective('x'.repeat(4_001)),
    'goal objective must be at most 4000 characters',
  );
  assert.equal(goalModule.validateThreadGoalObjective('ship it'), null);

  // Active, Paused, Blocked, UsageLimited, BudgetLimited, Complete.
  const runtime = new GoalRuntime(null);
  runtime.ensureGoal('ship it');
  for (const status of [
    'active',
    'paused',
    'blocked',
    'usage_limited',
    'budget_limited',
    'complete',
  ]) {
    runtime.setStatusFromUser(status);
    assert.equal(runtime.current().status, status);
  }
});

it('renders the vendored steering templates rather than restating them', () => {
  /*
   * The continuation document is the whole of Goal mode's behaviour — the
   * no-progress check, the fidelity rules, the completion audit, the blocked
   * audit. It is 5KB, and a hand-written summary of it is a different agent.
   */
  const vendored = fs.readFileSync(harness('upstream', 'goal_continuation.md'), 'utf8');
  const goal = {
    goalId: 'g',
    objective: 'ship <the> & checkout',
    status: 'active',
    tokenBudget: 1_000,
    tokensUsed: 250,
    timeUsedSeconds: 12,
    createdAt: 0,
    updatedAt: 0,
    blockedStreak: 0,
  };

  const prompt = goalModule.goalSteeringPrompt('continuation', goal);

  // Every placeholder rendered, none left behind.
  assert.doesNotMatch(prompt, /\{\{/);
  assert.match(prompt, /Tokens used: 250/);
  assert.match(prompt, /Token budget: 1000/);
  assert.match(prompt, /Tokens remaining: 750/);
  // `escape_xml_text` — the objective is untrusted user data inside XML tags.
  assert.match(prompt, /ship &lt;the&gt; &amp; checkout/);

  /*
   * And the document's own structure survived, which a paraphrase would not.
   *
   * Read out of the vendored file rather than hard-coded: upstream adds
   * sections to this document between releases (`No-progress check:` arrived
   * after the pinned commit), and the invariant is "whatever upstream ships
   * reaches the model", not "these four headings exist".
   */
  const headings = vendored
    .split('\n')
    .filter((line) => /^[A-Z][^:]*:$/.test(line.trim()))
    .map((line) => line.trim());

  assert.ok(headings.length >= 4, 'the vendored template should have several sections');
  for (const heading of headings) {
    assert.ok(prompt.includes(heading), `${heading} must come from the vendored template`);
  }
  // The two that carry the rules most easily lost to summarising.
  assert.ok(headings.includes('Completion audit:'));
  assert.ok(headings.includes('Blocked audit:'));

  // Upstream's two different words for an absent budget, which are not a typo.
  const unbounded = { ...goal, tokenBudget: undefined };
  assert.match(goalModule.goalSteeringPrompt('continuation', unbounded), /Tokens remaining: unbounded/);
  assert.match(
    goalModule.goalSteeringPrompt('objective-updated', unbounded),
    /Tokens remaining: unknown/,
  );
  assert.match(goalModule.goalSteeringPrompt('continuation', unbounded), /Token budget: none/);

  // The budget-limit document asks the model to wrap up, not to keep going.
  const limited = goalModule.goalSteeringPrompt('budget-limit', { ...goal, tokensUsed: 1_000 });
  assert.match(limited, /reached its token budget/);
  assert.match(limited, /Time spent pursuing goal: 12 seconds/);
  assert.match(limited, /do not start new substantive work/);
});

it('enforces create_goal\'s preconditions', async () => {
  const runtime = new GoalRuntime(null);
  const tools = new Map(runtime.tools().map((tool) => [tool.id, tool]));
  const context = { readFiles: () => ({}), writeFiles: () => {}, emit: () => 'id', patch: () => {} };

  assert.match((await tools.get('create_goal').run({}, context)).observation, /must not be empty/);

  // "Set token_budget only when an explicit token budget is requested" and
  // `validate_goal_budget`: positive integers only.
  for (const bad of [0, -5, 1.5, 'lots']) {
    const result = await tools.get('create_goal').run({ objective: 'ship it', token_budget: bad }, context);
    assert.equal(result.failed, true, `${bad} should be rejected`);
    assert.match(result.observation, /positive integers/);
  }

  assert.equal(
    (await tools.get('create_goal').run({ objective: 'ship it', token_budget: 500 }, context)).failed,
    undefined,
  );

  // "Fails if an unfinished goal exists".
  const second = await tools.get('create_goal').run({ objective: 'something else' }, context);
  assert.equal(second.failed, true);
  assert.match(second.observation, /unfinished goal/);

  // Finished, so a replacement is allowed — `update_goal`'s own docs say
  // `create_goal` "replaces the current goal when it is complete".
  await tools.get('update_goal').run({ status: 'complete' }, context);
  assert.equal(
    (await tools.get('create_goal').run({ objective: 'something else' }, context)).failed,
    undefined,
  );
});

it('holds the blocked audit to three consecutive turns', async () => {
  /*
   * Upstream states this rule in `update_goal`'s description and audits the
   * transcript for it. Stating it alone does not hold — models reach for
   * `blocked` on the first obstacle, and a goal that stops at the first
   * obstacle is just a slow ordinary turn.
   */
  const runtime = new GoalRuntime(null);
  runtime.ensureGoal('ship it');
  const tools = new Map(runtime.tools().map((tool) => [tool.id, tool]));
  const context = { readFiles: () => ({}), writeFiles: () => {}, emit: () => 'id', patch: () => {} };

  const first = await tools.get('update_goal').run({ status: 'blocked' }, context);
  assert.equal(first.failed, true);
  assert.match(first.observation, /turn 1 of 3/);
  assert.equal(runtime.current().status, 'active', 'still active after one claim');

  const second = await tools.get('update_goal').run({ status: 'blocked' }, context);
  assert.equal(second.failed, true);
  assert.match(second.observation, /turn 2 of 3/);

  const third = await tools.get('update_goal').run({ status: 'blocked' }, context);
  assert.equal(third.failed, undefined);
  assert.equal(runtime.current().status, 'blocked');

  // A turn that made progress clears the streak, because the rule counts
  // *consecutive* turns.
  const other = new GoalRuntime(null);
  other.ensureGoal('ship it');
  const otherTools = new Map(other.tools().map((tool) => [tool.id, tool]));
  await otherTools.get('update_goal').run({ status: 'blocked' }, context);
  other.noteTurnWithoutBlockedClaim();
  assert.match(
    (await otherTools.get('update_goal').run({ status: 'blocked' }, context)).observation,
    /turn 1 of 3/,
    'a productive turn resets the audit',
  );

  // "If the user resumes a goal that was previously marked blocked, treat the
  // resumed run as a fresh blocked audit."
  other.setStatusFromUser('active');
  assert.equal(other.current().blockedStreak, 0);

  // `complete` is not subject to any of this.
  const done = new GoalRuntime(null);
  done.ensureGoal('ship it');
  const doneTools = new Map(done.tools().map((tool) => [tool.id, tool]));
  assert.equal(
    (await doneTools.get('update_goal').run({ status: 'complete' }, context)).failed,
    undefined,
  );

  // And the model cannot reach the transitions upstream reserves for the user.
  const guarded = new GoalRuntime(null);
  guarded.ensureGoal('ship it');
  const guardedTools = new Map(guarded.tools().map((tool) => [tool.id, tool]));
  for (const status of ['paused', 'active', 'usage_limited', 'budget_limited']) {
    const result = await guardedTools.get('update_goal').run({ status }, context);
    assert.equal(result.failed, true, `the model must not be able to set ${status}`);
    assert.match(result.observation, /only mark the existing goal complete or blocked/);
  }
});

it('never invents token usage', () => {
  /*
   * Upstream accounts exact provider usage. A browser often has no number at
   * all, and an estimate would make `budget_limited` fire on invented
   * arithmetic — a budget that stops work early on a guess is worse than no
   * budget.
   */
  const runtime = new GoalRuntime(null);
  runtime.ensureGoal('ship it');
  const tools = new Map(runtime.tools().map((tool) => [tool.id, tool]));
  void tools;

  runtime.beginTurn();
  runtime.finishTurn(undefined);
  assert.equal(runtime.current().tokensUsed, 0, 'no report means no usage');

  runtime.beginTurn();
  runtime.finishTurn(0);
  assert.equal(runtime.current().tokensUsed, 0);

  runtime.beginTurn();
  runtime.finishTurn(1_200);
  assert.equal(runtime.current().tokensUsed, 1_200);
});

it('flips to budget_limited once the budget is spent', async () => {
  const runtime = new GoalRuntime(null);
  const tools = new Map(runtime.tools().map((tool) => [tool.id, tool]));
  const context = { readFiles: () => ({}), writeFiles: () => {}, emit: () => 'id', patch: () => {} };
  await tools.get('create_goal').run({ objective: 'ship it', token_budget: 100 }, context);

  runtime.beginTurn();
  runtime.finishTurn(150);

  assert.equal(runtime.current().status, 'budget_limited');
  // One wrap-up turn, then nothing.
  assert.match(runtime.nextSteeringPrompt(), /reached its token budget/);
  runtime.setStatusFromUser('complete');
  assert.equal(runtime.nextSteeringPrompt(), null);
});

/* ---------------------------------------------------------------------- */
/* The continuation loop                                                   */
/* ---------------------------------------------------------------------- */

it('keeps starting turns while the goal is active — upstream\'s continue_if_idle', async () => {
  /*
   * This is the behaviour that makes a goal a goal. `runtime.rs`:
   *
   *     if goal.status != Active { clear_active_goal(); return }
   *     thread.try_start_turn_if_idle(vec![continuation_steering_item(&goal)])
   *
   * Without it, "Goal mode" is a long prompt: the model stops, and nothing
   * checks whether the objective is actually true.
   */
  const goal = new GoalRuntime(null);
  goal.ensureGoal('ship the checkout flow');

  const { events, transport } = await run(
    [
      'Made a start.\n',
      'A bit more.\n',
      `Now it is done.

*** Call: update_goal
{"status": "complete"}
*** End Call
`,
      'Confirmed complete.\n',
    ],
    {},
    { goal, maxGoalContinuations: 8 },
  );

  // Three model rounds without the user sending anything after the first.
  assert.ok(transport.count >= 3, `expected continuations, got ${transport.count} rounds`);

  const continuations = events.filter((event) => event.type === 'goal-continuation');
  assert.ok(continuations.length >= 2, 'each automatic turn must be announced');
  assert.deepEqual(
    continuations.map((event) => event.index),
    continuations.map((_, index) => index + 1),
    'continuations are numbered from 1',
  );
  assert.ok(continuations.every((event) => event.limit === 8));

  // Each continuation's input is the rendered template, not a summary.
  const steering = observationsSent(transport);
  assert.match(steering, /Continue working toward the active thread goal/);
  assert.match(steering, /<objective>[\s\S]*ship the checkout flow[\s\S]*<\/objective>/);

  assert.equal(goal.current().status, 'complete');
  const end = events.at(-1);
  assert.equal(end.type, 'turn-end');
  assert.equal(end.reason, 'complete');
  assert.equal(end.stopReason, 'goal-ended');
});

it('stops at the continuation cap and leaves the goal resumable', async () => {
  /*
   * Upstream is unbounded: `continue_if_idle` fires as long as the goal is
   * active, and the user stops it from a terminal. A browser tab has neither a
   * terminal nor a visible bill, so the cap exists — and reaching it must leave
   * the goal `active`, because the alternative is throwing away work the user
   * can still resume.
   */
  const goal = new GoalRuntime(null);
  goal.ensureGoal('ship it');

  const { events } = await run(
    Array.from({ length: 20 }, () => 'Still going.\n'),
    {},
    { goal, maxGoalContinuations: 3 },
  );

  const continuations = events.filter((event) => event.type === 'goal-continuation');
  assert.equal(continuations.length, 3, 'the cap is the cap');
  assert.equal(goal.current().status, 'active', 'the goal survives the cap');

  const end = events.at(-1);
  assert.equal(end.stopReason, 'goal-continuation-budget');
  const prose = events
    .filter((event) => event.type === 'text')
    .map((event) => event.chunk)
    .join('');
  assert.match(prose, /still active/);
});

it('stops the goal when a turn fails, rather than steering into it again', async () => {
  const goal = new GoalRuntime(null);
  goal.ensureGoal('ship it');

  const events = [];
  let files = {};
  await runTurn({
    prompt: 'go',
    history: [],
    files: () => files,
    writeFiles: (next) => {
      files = next;
    },
    model: MODEL,
    goal,
    transport: async () => {
      throw new Error('provider exploded');
    },
    onEvent: (event) => events.push(event),
  });

  const end = events.at(-1);
  assert.equal(end.reason, 'error');
  // A goal that kept steering into the same failing request would spend the
  // user's budget on it.
  assert.equal(goal.current().status, 'blocked');
  assert.equal(events.filter((event) => event.type === 'goal-continuation').length, 0);
});

it('reports goal transitions so they can be persisted and shown', async () => {
  const seen = [];
  const goal = new GoalRuntime(null, (snapshot) => seen.push(snapshot));
  goal.ensureGoal('ship it');

  const { events } = await run(
    [
      `*** Call: update_goal
{"status": "complete"}
*** End Call
`,
      'Done.\n',
    ],
    {},
    { goal, maxGoalContinuations: 2 },
  );

  assert.ok(seen.length > 0, 'the host must be told about every transition');
  assert.equal(seen.at(-1).status, 'complete');
  const goalEvents = events.filter((event) => event.type === 'goal');
  assert.ok(goalEvents.length > 0, 'the transcript must see them too');

  // And the call left a card, because a goal that changed state invisibly is
  // the worst version of this feature.
  const cards = events.filter(
    (event) => event.type === 'call-start' && event.call.kind === 'goal',
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0].call.action, 'update');
  assert.equal(cards[0].call.goalStatus, 'complete');
});

it('does not install the goal tools without a goal session', async () => {
  /*
   * Upstream installs them from the `ext/goal` extension, so a thread without
   * it has no such tools. But the refusal names the reason rather than
   * reporting an unknown tool: `ALLOWED_TOOLS` is a superset of what any one
   * turn registers, and a model told "unknown tool" about a tool the harness
   * plainly has concludes the capability does not exist.
   */
  const { transport } = await run([
    `*** Call: get_goal
{}
*** End Call
`,
    'Right, no goal here.\n',
  ]);

  const sent = observationsSent(transport);
  assert.match(sent, /get_goal is unavailable because this thread has no goal session/);
  assert.doesNotMatch(sent, /Unknown tool/);

  // A name the harness genuinely does not have still says so.
  const { transport: bogus } = await run([
    `*** Call: teleport
{}
*** End Call
`,
    'Understood.\n',
  ]);
  assert.match(observationsSent(bogus), /Unknown tool "teleport"/);
});

/* ====================================================================== */
/* Mode plumbing                                                          */
/* ====================================================================== */

it('re-sends the mode every turn, after the base instructions', async () => {
  // The mode document asserts that the agent's mode "changes only when new
  // developer instructions with a different `<collaboration_mode>` change it".
  // That is only true if the fragment is actually present on every turn, and
  // after the instructions it overrides.
  const { transport } = await run(
    [
      `*** Call: read_file
{"path": "/a.ts"}
*** End Call
`,
      'Done reading.\n',
    ],
    { '/a.ts': 'export const a = 1;\n' },
    { mode: 'plan' },
  );

  assert.ok(transport.rounds.length >= 2);
  for (const { systemPrompt } of transport.rounds) {
    assert.match(systemPrompt, /<collaboration_mode>/);
    assert.match(systemPrompt, /Plan Mode \(Conversational\)/);
    // Upstream's own prompt comes first; the mode overrides it.
    assert.ok(
      systemPrompt.indexOf('<collaboration_mode>') > systemPrompt.indexOf('Willow sandbox runtime') ||
        systemPrompt.indexOf('<collaboration_mode>') > 0,
    );
  }
});

it('sends the multi_agent_mode fragment on every turn too', async () => {
  const { transport } = await run(['Nothing to do.\n'], {}, {
    model: {
      ...MODEL,
      effort: {
        requested: 'ultra',
        effective: 'max',
        clamped: false,
        harness: { maxIterations: 4, multiAgentMode: { kind: 'proactive' }, maxConcurrentAgents: 4 },
      },
    },
  });

  const { systemPrompt } = transport.rounds[0];
  assert.match(systemPrompt, /<multi_agent_mode>/);
  assert.match(systemPrompt, /Proactive multi-agent delegation is active/);
});

it('surfaces an overlay failure as a turn error rather than hanging', async () => {
  /*
   * A real hang, now fixed. `getHarnessProfile()` throws `OverlayAnchorError`
   * when an upstream upgrade moves a section the overlay depends on — that part
   * is deliberate. But it was called *above* `runTurn`'s try/catch, so the
   * rejection escaped: no `turn-end` was emitted, `onDone` never ran, and the
   * composer sat spinning on a turn that had already failed.
   */
  const agentSource = fs.readFileSync(harness('runtime', 'agent.ts'), 'utf8');
  const runTurnBody = agentSource.slice(agentSource.indexOf('export async function runTurn'));
  const tryAt = runTurnBody.indexOf('try {');
  const profileAt = runTurnBody.indexOf('composeSystemPrompt({');

  assert.ok(tryAt !== -1 && profileAt !== -1);
  assert.ok(
    tryAt < profileAt,
    'prompt composition must be inside the try, or an overlay failure hangs the turn',
  );
});

it('tells a model that wrapped a patch in a call envelope what it did wrong', async () => {
  /*
   * `apply_patch` is allowed, has no call handler, and never did — it is applied
   * from the patch envelope mid-stream. A model that wrapped a patch in
   * `*** Call: apply_patch` used to get "Unknown tool "apply_patch". Available
   * tools: read_file, …", which lists `apply_patch` nowhere and reads as though
   * patching were impossible. Models responded by giving up or by pasting the
   * file into their reply.
   */
  const { transport } = await run([
    `*** Call: apply_patch
{"patch": "*** Begin Patch\\n*** Add File: /a.ts\\n+export const a = 1;\\n*** End Patch"}
*** End Call
`,
    'Understood, emitting it directly.\n',
  ]);

  const sent = observationsSent(transport);
  assert.match(sent, /not invoked through a call envelope/);
  assert.match(sent, /\*\*\* Begin Patch/);
  assert.doesNotMatch(sent, /Unknown tool/);
});

it('distinguishes a finished turn from one that ran out of rounds', async () => {
  // Both used to report `reason: 'complete'` with nothing else, so the caller
  // could not tell whether to offer "continue".
  const finished = await run(['All done.\n']);
  assert.equal(finished.events.at(-1).stopReason, 'model-finished');

  const exhausted = await run(
    Array.from({ length: 10 }, () => `*** Call: list_files\n{}\n*** End Call\n`),
    {},
    {
      model: {
        ...MODEL,
        effort: {
          requested: 'low',
          effective: 'low',
          clamped: false,
          harness: { maxIterations: 2, multiAgentMode: { kind: 'explicit-request-only' }, maxConcurrentAgents: 1 },
        },
      },
    },
  );
  assert.equal(exhausted.events.at(-1).stopReason, 'iteration-budget');
});

it('answers a bad path the same way whichever file tool got it', async () => {
  // `read_file` always caught `normalizePath`'s throw and returned it as a
  // failed observation; `list_files` did not, so the same bad argument produced
  // "ERROR list_files threw: …" there — which reads like a harness defect
  // rather than a bad path.
  const { transport } = await run([
    `*** Call: list_files
{"path": "../../etc"}
*** End Call
`,
    'Understood.\n',
  ]);

  const sent = observationsSent(transport);
  assert.doesNotMatch(sent, /threw:/);
  assert.match(sent, /ERROR list_files: /);
});

/* ====================================================================== */
/* The composer surface                                                   */
/* ====================================================================== */

it('makes /plan and /goal modes rather than prompt templates', async () => {
  /*
   * The regression this exists to prevent, verbatim from what it replaced:
   *
   *   '/plan' → 'Plan how you would do this, but do not change any files yet:
   *              …  Use update_plan, and tell me what you would touch …'
   *
   * `update_plan` is refused in Plan mode. The template instructed the model to
   * do the one thing the real mode forbids, and because it was only a template
   * nothing else about Plan mode — the document, the mutation boundary,
   * `request_user_input`, `<proposed_plan>` — existed at all.
   */
  const commands = await importTs(
    path.join(repoRoot, 'features', 'code', 'src', 'agent', 'slash-commands.ts'),
  );

  const byName = new Map(commands.SLASH_COMMANDS.map((c) => [c.name, c]));

  assert.equal(byName.get('/plan').action, 'plan-mode');
  assert.equal(byName.get('/plan').template, '', 'a mode command expands to nothing');
  assert.equal(byName.get('/goal').action, 'goal-mode');
  assert.equal(byName.get('/goal').takesArgument, true);
  // The way back out. A mode with no visible exit is a trap, and the mode
  // document explicitly assumes the user can leave.
  assert.equal(byName.get('/code').action, 'default-mode');

  for (const command of commands.SLASH_COMMANDS) {
    if (!command.action) continue;
    assert.doesNotMatch(
      command.template,
      /update_plan/,
      `${command.name} must not instruct the model about tools`,
    );
  }

  // `/goal <objective>` has to be catchable on submit: `matchSlashCommands`
  // stops matching at the first space, so the menu never sees it.
  assert.deepEqual(commands.matchSlashCommands('/goal'), [byName.get('/goal')]);
  assert.deepEqual(commands.matchSlashCommands('/goal ship it'), []);

  const submitted = commands.matchCommandSubmission('/goal ship the checkout flow');
  assert.equal(submitted.command.action, 'goal-mode');
  assert.equal(submitted.argument, 'ship the checkout flow');
  assert.equal(commands.matchCommandSubmission('/plan').command.action, 'plan-mode');
  assert.equal(commands.matchCommandSubmission('/goal').argument, '');
  // An ordinary message is not a command.
  assert.equal(commands.matchCommandSubmission('use the /api endpoint'), null);
  // Nor is a template command, which still goes through the composer.
  assert.equal(commands.matchCommandSubmission('/fix the button'), null);
});

it('shows the active mode and goal on both composers', () => {
  /*
   * Plan mode declines every edit. A user who cannot see they are in it
   * experiences the agent refusing to work, so the indicator is part of the
   * feature rather than polish — upstream carries the same thing in its footer
   * (`CollaborationModeIndicator::Plan`, `GoalStatusIndicator`).
   *
   * Both composers, because a mode set in one is active in the other: the
   * landing screen is where opening prompts are typed.
   */
  for (const surface of [
    ['features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'],
    ['features', 'code', 'src', 'CodeHome.tsx'],
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, ...surface), 'utf8');
    const where = surface[surface.length - 1];
    assert.match(source, /useStore\(collaborationMode\)/, `${where} must read the mode`);
    assert.match(source, /isAgent && mode === 'plan'/, `${where} must show Plan mode`);
    // Click-to-exit, so there is always a way out.
    assert.match(
      source,
      /setCollaborationMode\('default'\)/,
      `${where} must offer a way out of Plan mode`,
    );
  }

  // The goal indicator lives with the turn that runs it.
  const sidebar = fs.readFileSync(
    path.join(repoRoot, 'features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'),
    'utf8',
  );
  assert.match(sidebar, /goalIsRunning\(goal\)/, 'the sidebar must show a live goal');
  assert.match(sidebar, /setThreadGoal\(null\)/, 'and let the user stop it');
});

it('clears the goal on a new chat, because a goal belongs to a thread', () => {
  /*
   * Upstream's `ThreadGoal` carries a `thread_id` and its runtime is registered
   * per thread. Left standing across a new chat, a goal would keep starting
   * continuation turns steered by an objective describing work that is no
   * longer on screen — and it would pursue it confidently.
   */
  const sidebar = fs.readFileSync(
    path.join(repoRoot, 'features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'),
    'utf8',
  );
  const newChat = sidebar.slice(
    sidebar.indexOf('const handleNewChat'),
    sidebar.indexOf('const handleNewChat') + 3_000,
  );

  assert.match(newChat, /setThreadGoal\(null\)/);
  assert.match(newChat, /dismissUserInput\(\)/, 'an outstanding question must not survive');
  // The mode deliberately does *not* reset: it is a preference, upstream
  // persists it across sessions, and both composers show it.
  assert.doesNotMatch(newChat, /setCollaborationMode/);
});

it('only resumes a goal that is still live', () => {
  /*
   * Handing a finished goal back as `resume` would let `create_goal` fire
   * against it — upstream's own rule is that a new goal "replaces the current
   * goal when it is complete", so a completed goal in the slot is not inert.
   */
  const goalModuleSource = fs.readFileSync(harness('runtime', 'goal.ts'), 'utf8');
  assert.match(goalModuleSource, /export const isGoalFinished/);

  const sidebar = fs.readFileSync(
    path.join(repoRoot, 'features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'),
    'utf8',
  );
  assert.match(sidebar, /resume: goalIsRunning\(goal\) \? goal : null/);

  // And the store's predicate agrees with the runtime's.
  assert.equal(goalModule.isGoalFinished(null), true);
  assert.equal(goalModule.isGoalFinished({ status: 'complete' }), true);
  assert.equal(goalModule.isGoalFinished({ status: 'blocked' }), true);
  assert.equal(goalModule.isGoalFinished({ status: 'active' }), false);
  assert.equal(goalModule.isGoalFinished({ status: 'budget_limited' }), false);
});

it('keeps the vendored upstream folder exempt from line-ending rewriting', () => {
  /*
   * `core.autocrlf=true` rewrites LF to CRLF on checkout, and a rewritten byte
   * is a changed byte — so without this every vendored file fails its checksum
   * on a fresh clone with no local edit having been made. It is not
   * hypothetical: it happened the moment these files were round-tripped through
   * `git stash`, and the failure looked exactly like someone hand-editing a
   * vendored file.
   */
  const attributes = fs.readFileSync(harness('upstream', '.gitattributes'), 'utf8');
  assert.match(attributes, /^\* -text$/m);

  // And the sync script must not delete it while re-vendoring, which it did.
  const sync = fs.readFileSync(
    path.join(repoRoot, 'tools', 'scripts', 'sync-codex-upstream.mjs'),
    'utf8',
  );
  assert.match(sync, /KEEP = new Set\(\['AGENTS\.md', '\.gitattributes'\]\)/);
});

/* ====================================================================== */
/* Multi-agent collaboration                                              */
/* ====================================================================== */

const ULTRA = (maxConcurrentAgents = 4) => ({
  ...MODEL,
  effort: {
    requested: 'ultra',
    effective: 'max',
    clamped: false,
    harness: {
      maxIterations: 6,
      multiAgentMode: { kind: 'proactive' },
      maxConcurrentAgents,
    },
  },
});

it('exposes upstream\'s six collaboration tools and nothing called task', async () => {
  const collabTools = await importTs(harness('overlay', 'collaboration-tools.ts'));

  assert.deepEqual([...policy.COLLABORATION_TOOLS].sort(), [
    'followup_task',
    'interrupt_agent',
    'list_agents',
    'send_message',
    'spawn_agent',
    'wait_agent',
  ]);

  // Verified against codex-rs/core/src/config/mod.rs.
  assert.equal(collabTools.DEFAULT_MAX_CONCURRENT_AGENTS, 4);
  assert.equal(collabTools.DEFAULT_WAIT_TIMEOUT_MS, 30_000);
  assert.equal(collabTools.MIN_WAIT_TIMEOUT_MS, 10_000);
  assert.equal(collabTools.MAX_WAIT_TIMEOUT_MS, 3_600_000);

  /*
   * The addressing rule and the wait_agent contract are the two sentences the
   * model cannot work without, so they are pinned literally. Without the first
   * it guesses targets; without the second it treats a wait summary as the
   * answer and invents the rest.
   */
  assert.match(
    collabTools.SPAWN_AGENT_DESCRIPTION,
    /the agent will have canonical task name `\/root\/task1\/task_3`/,
  );
  assert.match(
    collabTools.SPAWN_AGENT_DESCRIPTION,
    /the ability to spawn its own subagents/,
  );
  assert.match(collabTools.WAIT_AGENT_DESCRIPTION, /Does not return the content/);
});

it('resolves agent addresses the way AgentPath does', async () => {
  const paths = await importTs(harness('runtime', 'agent-path.ts'));

  // Upstream's `resolve_supports_relative_and_absolute_references`.
  assert.equal(paths.resolveAgentPath('/root/researcher', 'worker'), '/root/researcher/worker');
  assert.equal(paths.resolveAgentPath('/root/researcher', '/root/other'), '/root/other');
  assert.equal(paths.resolveAgentPath('/root', '/root'), '/root');

  // A relative name means *my* child, which is what makes a cousin unreachable
  // by short name — the asymmetry `spawn_agent`'s description describes.
  assert.equal(paths.resolveAgentPath('/root/task1', 'task_3'), '/root/task1/task_3');
  assert.equal(paths.resolveAgentPath('/root/task2', 'task_3'), '/root/task2/task_3');

  // `validate_agent_name`, with upstream's messages.
  assert.equal(paths.validateAgentName('root'), 'agent_name `root` is reserved');
  assert.equal(paths.validateAgentName('..'), 'agent_name `..` is reserved');
  assert.equal(paths.validateAgentName('a/b'), 'agent_name must not contain `/`');
  assert.match(paths.validateAgentName('Nope'), /lowercase letters, digits, and underscores/);
  assert.equal(paths.validateAgentName('read_cart_2'), null);

  assert.equal(paths.agentPathName('/root/a/b'), 'b');
  assert.equal(paths.agentPathName('/root'), 'root');
  assert.equal(paths.parentAgentPath('/root/a/b'), '/root/a');
  assert.equal(paths.parentAgentPath('/root'), '/root');
});

it('returns from spawn_agent immediately instead of waiting', async () => {
  /*
   * The single most important behavioural change, and the reason Ultra was
   * worth nothing before it.
   *
   * The old `task` tool blocked. Upstream's role guidance is explicit about why
   * that defeats the purpose: "While waiting for the explorer results, you can
   * continue working on other local tasks that do not depend on those results.
   * This parallelism is a key advantage of delegation."
   *
   * The proof is ordering: the root's *second* round must begin before the
   * agent's round finishes.
   */
  const order = [];
  // Counted separately from the agent's rounds, or the root's second round is
  // numbered by however many agent turns happened to interleave with it.
  let rootRounds = 0;

  const transport = async (messages, _options, onToken) => {
    if (messages.at(-1)?.content.includes('Task name:')) {
      order.push('agent:start');
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push('agent:end');
      onToken('Explored it.\n');
      return;
    }

    const mine = rootRounds++;
    order.push(`root:${mine}`);
    if (mine === 0) {
      const body = `*** Call: spawn_agent
{"task_name": "explore", "message": "Look at the cart"}
*** End Call
`;
      for (let i = 0; i < body.length; i += 7) onToken(body.slice(i, i + 7));
      return;
    }
    onToken('Carrying on.\n');
  };

  let files = {};
  await runTurn({
    prompt: 'go',
    history: [],
    files: () => files,
    writeFiles: (next) => {
      files = next;
    },
    model: ULTRA(),
    transport,
    onEvent: () => {},
  });

  const agentStart = order.indexOf('agent:start');
  const agentEnd = order.indexOf('agent:end');
  const rootSecond = order.indexOf('root:1');

  assert.ok(agentStart !== -1, 'the agent should have run');
  assert.ok(rootSecond !== -1, 'the root should have taken another round');
  assert.ok(
    rootSecond < agentEnd,
    `the root must resume before the agent finishes; order was ${order.join(' → ')}`,
  );
});

it('runs several agents at once, up to the cap', async () => {
  let live = 0;
  let peak = 0;
  let round = 0;

  const transport = async (messages, _options, onToken) => {
    if (messages.at(-1)?.content.includes('Task name:')) {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 20));
      live -= 1;
      onToken('Done my piece.\n');
      return;
    }

    if (round++ === 0) {
      const body = `*** Call: spawn_agent
{"task_name": "one", "message": "first"}
*** End Call
*** Call: spawn_agent
{"task_name": "two", "message": "second"}
*** End Call
*** Call: spawn_agent
{"task_name": "three", "message": "third"}
*** End Call
`;
      for (let i = 0; i < body.length; i += 7) onToken(body.slice(i, i + 7));
      return;
    }
    onToken('All three came back.\n');
  };

  let files = {};
  await runTurn({
    prompt: 'go',
    history: [],
    files: () => files,
    writeFiles: (next) => {
      files = next;
    },
    model: ULTRA(3),
    transport,
    onEvent: () => {},
  });

  assert.ok(peak > 1, `agents should overlap; peak concurrency was ${peak}`);
  assert.ok(peak <= 3, `the cap must hold; peak concurrency was ${peak}`);
});

it('lets an agent spawn its own agents', async () => {
  /*
   * Upstream allows this and says so twice: `spawn_agent`'s description ("the
   * ability to spawn its own subagents") and the sub-agent role hint ("those
   * sub-agents can spawn their own sub-agents"). `collab_tools_enabled` only
   * applies a depth limit under multi-agent V1; V2 has none.
   *
   * Spark's harness strips `spawn_agent` from children, which is why its own
   * nested-delegation test fails. This is the assertion that keeps the Code
   * harness from copying that.
   */
  const spawned = [];
  let childDeclined = false;

  const transport = async (messages, _options, onToken) => {
    const last = messages.at(-1)?.content ?? '';

    // The grandchild: just finish.
    if (last.includes('Task name: /root/parent/child')) {
      onToken('Grandchild done.\n');
      return;
    }

    // The child: spawn one of its own.
    if (last.includes('Task name: /root/parent')) {
      if (last.includes('ERROR')) {
        childDeclined = true;
        onToken('Could not delegate.\n');
        return;
      }
      const body = `*** Call: spawn_agent
{"task_name": "child", "message": "go deeper"}
*** End Call
`;
      for (let i = 0; i < body.length; i += 7) onToken(body.slice(i, i + 7));
      return;
    }

    // The root: spawn the child.
    if (!spawned.includes('parent')) {
      spawned.push('parent');
      const body = `*** Call: spawn_agent
{"task_name": "parent", "message": "delegate further"}
*** End Call
`;
      for (let i = 0; i < body.length; i += 7) onToken(body.slice(i, i + 7));
      return;
    }
    onToken('Finished.\n');
  };

  const events = [];
  let files = {};
  await runTurn({
    prompt: 'go',
    history: [],
    files: () => files,
    writeFiles: (next) => {
      files = next;
    },
    model: ULTRA(),
    transport,
    onEvent: (event) => events.push(event),
  });

  const paths = events
    .filter((event) => event.type === 'agents-start')
    .flatMap((event) => event.agents.map((agent) => agent.path));

  assert.equal(childDeclined, false, 'a child must not be refused spawn_agent');
  assert.ok(paths.includes('/root/parent'), 'the root should have spawned an agent');
  assert.ok(
    paths.includes('/root/parent/child'),
    `an agent must be able to spawn its own; saw ${paths.join(', ')}`,
  );
});

it('delivers an agent\'s final answer to whoever spawned it', async () => {
  const collab = await importTs(harness('runtime', 'collaboration.ts'));

  // The envelope both role hints promise the model it will receive.
  assert.equal(
    collab.renderEnvelope({
      messageType: 'FINAL_ANSWER',
      taskName: '/root',
      sender: '/root/explore',
      payload: 'It uses useCart in three files.',
    }),
    [
      'Message Type: FINAL_ANSWER',
      'Task name: /root',
      'Sender: /root/explore',
      'Payload:',
      'It uses useCart in three files.',
    ].join('\n'),
  );

  let round = 0;
  const seen = [];
  const transport = async (messages, _options, onToken) => {
    const last = messages.at(-1)?.content ?? '';
    seen.push(last);

    if (last.includes('Task name: /root/explore')) {
      onToken('It uses useCart in three files.\n');
      return;
    }
    if (round++ === 0) {
      const body = `*** Call: spawn_agent
{"task_name": "explore", "message": "Where is useCart used?"}
*** End Call
`;
      for (let i = 0; i < body.length; i += 7) onToken(body.slice(i, i + 7));
      return;
    }
    onToken('Thanks.\n');
  };

  let files = {};
  await runTurn({
    prompt: 'go',
    history: [],
    files: () => files,
    writeFiles: (next) => {
      files = next;
    },
    model: ULTRA(),
    transport,
    onEvent: () => {},
  });

  const delivered = seen.join('\n');
  assert.match(delivered, /Message Type: FINAL_ANSWER/);
  assert.match(delivered, /Sender: \/root\/explore/);
  assert.match(delivered, /It uses useCart in three files\./);
});

it('slices inherited context with fork_turns', async () => {
  const collab = await importTs(harness('runtime', 'collaboration.ts'));
  const source = [
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'u3' },
    { role: 'assistant', content: 'a3' },
  ];

  // "Defaults to `all`."
  assert.equal(collab.forkConversation(source, undefined).length, 6);
  assert.equal(collab.forkConversation(source, 'all').length, 6);
  assert.equal(collab.forkConversation(source, '').length, 6);
  assert.equal(collab.forkConversation(source, 'none').length, 0);

  // "a positive integer string such as `3` to fork only the most recent turns"
  // — a turn being a user/assistant pair, hence the doubling.
  assert.deepEqual(
    collab.forkConversation(source, '2').map((entry) => entry.content),
    ['u2', 'a2', 'u3', 'a3'],
  );

  // Anything else is reported rather than silently treated as `all`: a model
  // that asked for `none` and got the whole history would leak context it
  // deliberately withheld.
  assert.equal(collab.forkConversation(source, 'some'), null);
  assert.equal(collab.forkConversation(source, '0'), null);
  assert.equal(collab.forkConversation(source, '-1'), null);
});

it('returns a summary from wait_agent, never the content', async () => {
  /*
   * Upstream's description: "Does not return the content; returns either a
   * summary of which agents have updates (if any) … or a timeout summary."
   *
   * If this leaked the payload the model would stop reading its messages and
   * start paraphrasing a summary as though it were the finding.
   */
  const observations = [];
  let round = 0;

  const transport = async (messages, _options, onToken) => {
    const last = messages.at(-1)?.content ?? '';
    if (last.includes('Task name: /root/explore')) {
      onToken('SECRET_FINDING_ABC\n');
      return;
    }
    observations.push(last);

    if (round++ === 0) {
      const body = `*** Call: spawn_agent
{"task_name": "explore", "message": "find it"}
*** End Call
`;
      for (let i = 0; i < body.length; i += 7) onToken(body.slice(i, i + 7));
      return;
    }
    if (round === 2) {
      const body = `*** Call: wait_agent
{"timeout_ms": 10000}
*** End Call
`;
      for (let i = 0; i < body.length; i += 7) onToken(body.slice(i, i + 7));
      return;
    }
    onToken('Understood.\n');
  };

  let files = {};
  await runTurn({
    prompt: 'go',
    history: [],
    files: () => files,
    writeFiles: (next) => {
      files = next;
    },
    model: ULTRA(),
    transport,
    onEvent: () => {},
  });

  const waitResult = observations.find((text) => text.includes('"timed_out"'));
  assert.ok(waitResult, 'wait_agent should have produced an observation');
  assert.doesNotMatch(
    waitResult,
    /SECRET_FINDING_ABC/,
    'wait_agent must not return the agent\'s content',
  );
  assert.match(waitResult, /Updates waiting from|No agent activity|No live agents/);
});

it('keeps an interrupted agent available instead of destroying it', async () => {
  // "The agent remains available for messages and follow-up tasks." So the
  // status is `interrupted`, which `is_final` deliberately treats as non-final.
  const { isFinalAgentStatus } = await importTs(harness('runtime', 'protocol.ts'));

  assert.equal(isFinalAgentStatus({ kind: 'interrupted' }), false);
  assert.equal(isFinalAgentStatus({ kind: 'running' }), false);
  assert.equal(isFinalAgentStatus({ kind: 'pending_init' }), false);
  assert.equal(isFinalAgentStatus({ kind: 'completed', message: null }), true);
  assert.equal(isFinalAgentStatus({ kind: 'errored', message: 'x' }), true);
  assert.equal(isFinalAgentStatus({ kind: 'shutdown' }), true);
});

it('tells the model what went wrong rather than failing silently', async () => {
  const cases = [
    [
      '{"task_name": "explore"}',
      /requires a "message"/,
      'a spawn with no task',
    ],
    [
      '{"task_name": "Explore", "message": "x"}',
      /lowercase letters, digits, and underscores/,
      'an illegal name is reported, not silently rewritten',
    ],
    [
      '{"task_name": "root", "message": "x"}',
      /`root` is reserved/,
      'the root name is reserved',
    ],
    [
      '{"task_name": "ok", "message": "x", "fork_turns": "some"}',
      /fork_turns must be/,
      'an unrecognised fork mode',
    ],
  ];

  for (const [body, expected, why] of cases) {
    const { transport } = await run(
      [
        `*** Call: spawn_agent\n${body}\n*** End Call\n`,
        'Understood.\n',
      ],
      {},
      { model: ULTRA() },
    );
    assert.match(observationsSent(transport), expected, why);
  }

  // An unknown target names the path it looked for, using upstream's wording.
  const { transport } = await run(
    [
      `*** Call: send_message\n{"target": "nobody", "message": "hi"}\n*** End Call\n`,
      'Understood.\n',
    ],
    {},
    { model: ULTRA() },
  );
  assert.match(observationsSent(transport), /live agent path `\/root\/nobody` not found/);
});

it('holds the turn open until the agent tree is quiet', async () => {
  /*
   * The one deliberate browser divergence, and the reason for it.
   *
   * Upstream's session outlives a turn, so a parent may finish while its
   * children work on and the user watches them in the TUI. Willow has nowhere
   * to watch: resolving `runTurn` unlocks the composer and reports the turn
   * done, and an agent still running would then rewrite the user's files
   * *after* they were told the work finished.
   *
   * Spawning stays non-blocking — the test above proves it — so only the final
   * boundary waits.
   */
  let agentFinished = false;
  let round = 0;

  const transport = async (messages, _options, onToken) => {
    if (messages.at(-1)?.content.includes('Task name:')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      agentFinished = true;
      onToken('Written.\n');
      return;
    }
    if (round++ === 0) {
      const body = `*** Call: spawn_agent
{"task_name": "slow", "message": "take your time"}
*** End Call
`;
      for (let i = 0; i < body.length; i += 7) onToken(body.slice(i, i + 7));
      return;
    }
    // The root stops immediately, while the agent is still going.
    onToken('I am done.\n');
  };

  const events = [];
  let files = {};
  await runTurn({
    prompt: 'go',
    history: [],
    files: () => files,
    writeFiles: (next) => {
      files = next;
    },
    model: ULTRA(),
    transport,
    onEvent: (event) => events.push(event),
  });

  assert.equal(
    agentFinished,
    true,
    'the turn must not end while an agent is still running',
  );
  assert.equal(events.at(-1).type, 'turn-end');
});
