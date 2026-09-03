/**
 * The turn loop, driven end to end by a scripted model.
 *
 * `runTurn` takes an injectable `transport`, so a whole turn can be played out
 * here — streaming, patch application, tool dispatch, sub-agents, cancellation —
 * with no network, no API key, and no browser. That covers the wiring between
 * the pieces the other two test files check in isolation.
 *
 * The scripted responses are written the way a model actually emits them:
 * prose interleaved with envelopes, arriving in small chunks.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const agentModule = await importTs(
  path.join(repoRoot, 'features', 'code', 'src', 'agent', 'harness', 'runtime', 'agent.ts'),
);
const { runTurn } = agentModule;

const MODEL = { label: 'Test Model', options: { provider: 'gemini', model: 'test', apiKey: 'k' } };

/**
 * A transport that replays scripted responses, one per iteration.
 *
 * Tokens are emitted in small slices so the stream parser is exercised across
 * chunk boundaries rather than handed each envelope whole.
 */
function scriptedTransport(responses) {
  const seen = [];
  let turn = 0;

  const transport = async (messages, _options, onToken) => {
    seen.push(messages);
    const body = responses[turn] ?? '';
    turn += 1;
    for (let i = 0; i < body.length; i += 7) {
      onToken(body.slice(i, i + 7));
    }
  };

  transport.conversations = seen;
  Object.defineProperty(transport, 'turns', { get: () => turn });
  return transport;
}

/** Runs a turn and collects everything that happened. */
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

const calls = (events) => events.filter((event) => event.type === 'call-start').map((e) => e.call);
const text = (events) =>
  events
    .filter((event) => event.type === 'text')
    .map((event) => event.chunk)
    .join('');

/* ---------------------------------------------------------------------- */

it('streams prose and ends the turn when no tools are called', async () => {
  const { events } = await run(['Nothing to change here.\n']);

  assert.match(text(events), /Nothing to change here\./);
  const end = events.at(-1);
  assert.equal(end.type, 'turn-end');
  assert.equal(end.reason, 'complete');
});

it('applies a patch mid-stream and reports the file write', async () => {
  const { files, events } = await run([
    `I'll create the entry point.

*** Begin Patch
*** Add File: /App.tsx
+export default function App() {
+  return <h1>hi</h1>;
+}
*** End Patch

Done.
`,
    'All set.\n',
  ]);

  assert.equal(files['/App.tsx'], 'export default function App() {\n  return <h1>hi</h1>;\n}\n');

  const edit = calls(events).find((call) => call.kind === 'create');
  assert.ok(edit, 'a create card should be emitted');
  assert.equal(edit.path, '/App.tsx');

  // The card is opened from the header line, before the body has arrived, so
  // the transcript shows a real filename rather than "writing…".
  const progress = events.filter((event) => event.type === 'call-progress');
  assert.ok(
    progress.some((event) => event.patch.revealed > 0),
    'diff lines should stream in',
  );

  const settled = progress.at(-1);
  assert.equal(settled.patch.status, 'success');
  assert.equal(settled.patch.added, 3);

  // Envelopes are stripped from the prose.
  assert.doesNotMatch(text(events), /Begin Patch/);
  assert.match(text(events), /I'll create the entry point/);
});

it('feeds a tool result back and continues the turn', async () => {
  const { events, transport } = await run(
    [
      `Let me look first.

*** Call: read_file
{"path": "/App.tsx"}
*** End Call
`,
      'It already renders a heading, so nothing to do.\n',
    ],
    { '/App.tsx': 'export default function App() {\n  return <h1>hi</h1>;\n}\n' },
  );

  const read = calls(events).find((call) => call.kind === 'read');
  assert.ok(read);
  assert.equal(read.path, '/App.tsx');
  assert.equal(read.totalLines, 4);

  // Two model calls: the original, then the follow-up carrying the observation.
  assert.equal(transport.turns, 2);
  const followUp = transport.conversations[1];
  const lastUserMessage = followUp.at(-1);
  assert.equal(lastUserMessage.role, 'user');
  assert.match(lastUserMessage.content, /export default function App/);

  assert.match(text(events), /nothing to do/);
});

it('returns a parse error to the model instead of throwing', async () => {
  // A malformed patch is normal and recoverable; the model fixes it far more
  // reliably when handed the parser's actual complaint.
  const { events, transport } = await run([
    `*** Begin Patch
*** Update File: /missing.tsx
@@
-nope
+yes
*** End Patch
`,
    'Sorry — let me create it instead.\n',
  ]);

  const followUp = transport.conversations[1].at(-1);
  assert.match(followUp.content, /ERROR/);
  assert.match(followUp.content, /no such file/i);

  const failed = events
    .filter((event) => event.type === 'call-progress')
    .find((event) => event.patch.status === 'error');
  assert.ok(failed, 'the edit card should show the failure');

  assert.equal(events.at(-1).reason, 'complete');
});

it('refuses a shell call with actionable guidance rather than running anything', async () => {
  const { events, transport } = await run([
    `*** Call: shell
{"command": "npm test"}
*** End Call
`,
    'Understood, I cannot run commands.\n',
  ]);

  const observation = transport.conversations[1].at(-1).content;
  assert.match(observation, /ERROR shell/);
  assert.match(observation, /no shell in this environment/i);
  assert.match(observation, /apply_patch/);

  // Nothing was executed and no card was emitted for it.
  assert.equal(calls(events).length, 0);
});

it('adds a dependency by writing package.json', async () => {
  const { files, events } = await run(
    [
      `*** Call: add_dependency
{"name": "clsx", "version": "^2.1.1"}
*** End Call
`,
      'Added.\n',
    ],
    { '/package.json': '{\n  "dependencies": {}\n}\n' },
  );

  const manifest = JSON.parse(files['/package.json']);
  assert.equal(manifest.dependencies.clsx, '^2.1.1');

  const card = calls(events).find((call) => call.kind === 'dependency');
  assert.ok(card);
  assert.equal(card.name, 'clsx');
});

it('records a plan and answers with upstream\'s exact message', async () => {
  const { events, transport } = await run([
    `*** Call: update_plan
{"plan": [{"step": "Write App.tsx", "status": "in_progress"}, {"step": "Style it", "status": "pending"}]}
*** End Call
`,
    'Starting now.\n',
  ]);

  const plan = calls(events).find((call) => call.kind === 'plan');
  assert.ok(plan);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].status, 'in_progress');

  /*
   * `PLAN_UPDATED_MESSAGE` in `codex-rs/core/src/tools/handlers/plan.rs` is
   * exactly `"Plan updated"` — no counts, no instruction not to repeat it.
   *
   * This test used to assert a longer local string that added both. The counts
   * were harmless; the appended "Do not repeat it back to the user" was not,
   * because it is guidance the prompt already gives and repeating it in a tool
   * result puts it in the transcript on every plan update, where the model then
   * has to reconcile an instruction with an observation.
   */
  assert.equal(transport.conversations[1].at(-1).content, 'Plan updated');
});

it('runs an agent and surfaces its work separately from the main thread', async () => {
  const { files, events } = await run([
    `Delegating the component.

*** Call: spawn_agent
{"task_name": "card_builder", "message": "Create the Card component"}
*** End Call
`,
    // The agent's own turn.
    `*** Begin Patch
*** Add File: /Card.tsx
+export function Card() { return null; }
*** End Patch
`,
    'Created Card.tsx.\n',
    // Back on the root thread.
    'The card is in place.\n',
  ]);

  assert.ok(files['/Card.tsx'], 'the agent should have written the file');

  const started = events.find((event) => event.type === 'agents-start');
  assert.ok(started);
  // Addressed by canonical path, which is what every collaboration tool takes.
  assert.equal(started.agents[0].path, '/root/card_builder');
  assert.equal(started.agents[0].name, 'card_builder');
  assert.equal(started.agents[0].parentPath, '/root');

  // Its tool calls land on the agent, not in the main transcript.
  const agentProgress = events.filter((event) => event.type === 'agent-progress');
  const withCalls = agentProgress.filter((event) => event.patch.calls?.length);
  assert.ok(withCalls.length > 0, 'the agent should report its own calls');
  assert.equal(
    calls(events).length,
    0,
    'a delegated edit must not appear as a main-thread card',
  );

  const finished = agentProgress.at(-1);
  assert.equal(finished.patch.status, 'success');
});

/*
 * Envelopes that are not on their own line.
 *
 * Observed in the wild on the very first message of a session: the model wrote
 * "...what we're starting with.*** Call: list_files" with no break before the
 * marker. A line-anchored parser sees no envelope at all, so the markers render
 * as prose, no tool runs, and the turn ends immediately — the loop only
 * continues while calls are being made.
 */
/** What the tool actually returned, as handed back to the model next turn. */
const observation = (transport) => transport.conversations[1]?.at(-1)?.content ?? '';

it('recognises a call appended to the sentence introducing it', async () => {
  const { events, transport } = await run(
    [
      `I'll check the current project files to see what we're starting with.*** Call: list_files
{}
*** End Call
`,
      'There is nothing here yet.\n',
    ],
    { '/App.tsx': 'export default null;\n' },
  );

  // The tool ran, and its result went back to the model.
  assert.match(observation(transport), /\/App\.tsx/, 'the call must be recognised mid-line');

  // The markers must not survive into the transcript.
  const prose = text(events);
  assert.doesNotMatch(prose, /\*\*\* Call:/);
  assert.doesNotMatch(prose, /\*\*\* End Call/);
  // ...but the sentence that preceded it must.
  assert.match(prose, /what we're starting with\./);

  // And the turn must go on rather than stopping at the unparsed block.
  assert.equal(transport.turns, 2, 'the loop should continue after the call');
  assert.equal(events.at(-1).reason, 'complete');
});

it('recognises a patch appended to the sentence introducing it', async () => {
  const { files } = await run([
    `Creating it now.*** Begin Patch
*** Add File: /A.tsx
+export const A = 1;
*** End Patch
`,
    'Done.\n',
  ]);

  assert.equal(files['/A.tsx'], 'export const A = 1;\n');
});

it('closes a call whose end marker is stuck to the body', async () => {
  const { events, transport } = await run(
    [
      `Listing.
*** Call: list_files
{}*** End Call
`,
      'Nothing there.\n',
    ],
    { '/App.tsx': 'export default null;\n' },
  );

  assert.match(observation(transport), /\/App\.tsx/, 'the call must still close');
  assert.doesNotMatch(text(events), /\*\*\* End Call/);
  assert.equal(transport.turns, 2);
});

it('still delivers a call whose end marker never arrived', async () => {
  // Truncated mid-envelope. Dropping it would end the turn silently, because
  // the loop only continues while calls are being made.
  const { transport } = await run(
    [
      `Listing.
*** Call: list_files
{}
`,
      'Nothing there.\n',
    ],
    { '/App.tsx': 'export default null;\n' },
  );

  assert.match(
    observation(transport),
    /\/App\.tsx/,
    'the truncated call must still be dispatched',
  );
});

it('sends the user their own message, with only the file listing attached', async () => {
  // Everything the harness prepends is said on *every* turn, including a
  // greeting. Twice now that has turned "hey" into a build order: first via a
  // manifest ending "Create /App.tsx to begin", then via how-to-work guidance
  // reading "Plan before acting" directly above the word "hey".
  //
  // Standing guidance belongs in the system prompt, next to upstream's own rule
  // about answering conversational messages conversationally. Only genuine
  // per-turn context — what files exist — may ride on the message.
  const { transport } = await run(['Hey! What would you like to build?\n']);

  const opening = transport.conversations[0].at(-1).content;
  assert.equal(
    opening,
    '<project>\nThe project has no files yet.\n</project>\n\ndo the thing',
    'nothing may be attached to the user message but the file listing',
  );

  for (const instruction of [
    /Create \/App\.tsx to begin/,
    /<how-to-work>/,
    /<effort>/,
    /Plan before acting/,
  ]) {
    assert.doesNotMatch(opening, instruction, 'context must not instruct');
  }
});

it('separates the prose of one iteration from the next', async () => {
  const { events } = await run([
    `Checking what is here.
*** Call: list_files
{}
*** End Call
`,
    'Nothing yet.\n',
  ]);

  // Without a break the two completions run together mid-sentence:
  // "Checking what is here.Nothing yet."
  assert.doesNotMatch(text(events), /here\.Nothing/);
  assert.match(text(events), /here\.\s*\n\s*\n\s*Nothing/);
});

it('completes one card per file in a multi-file envelope', async () => {
  const { files, events } = await run([
    `Setting up.

*** Begin Patch
*** Add File: /package.json
+{"name":"app"}
*** Add File: /App.tsx
+export default function App() { return null; }
*** End Patch
`,
    'Done.\n',
  ]);

  assert.ok(files['/package.json']);
  assert.ok(files['/App.tsx']);

  // Each header opens a card; each card must end up finished and holding its
  // own file. Previously the first was orphaned mid-write while the second was
  // filled in with the *first* file's result.
  const opened = calls(events);
  assert.equal(opened.length, 2, 'one card per file, and no extras');

  const finished = new Map();
  for (const event of events) {
    if (event.type === 'call-start') finished.set(event.call.id, { ...event.call });
    if (event.type === 'call-progress') {
      finished.set(event.id, { ...finished.get(event.id), ...event.patch });
    }
  }

  const byPath = new Map([...finished.values()].map((call) => [call.path, call]));
  assert.deepEqual(
    [...byPath.keys()].sort(),
    ['/App.tsx', '/package.json'],
    'each card must keep its own file',
  );
  for (const [path, call] of byPath) {
    assert.equal(call.status, 'success', `${path} should not still be running`);
    assert.ok(call.endedAt, `${path} should have stopped its timer`);
  }
});

it('fails every card in an envelope that could not be applied', async () => {
  const { events } = await run([
    `Editing.

*** Begin Patch
*** Update File: /missing.tsx
@@
-nope
+yes
*** End Patch
`,
    'I will fix that.\n',
  ]);

  const states = new Map();
  for (const event of events) {
    if (event.type === 'call-start') states.set(event.call.id, event.call.status);
    if (event.type === 'call-progress' && event.patch.status) {
      states.set(event.id, event.patch.status);
    }
  }

  assert.ok(states.size > 0);
  for (const status of states.values()) {
    assert.equal(status, 'error', 'a failed envelope must not leave a card running');
  }
});

it('shows the model the envelopes it emitted, not just its prose', async () => {
  /*
   * Observed: after an `update_plan` call the transcript filled with orphan
   * `*** End Call` markers.
   *
   * The assistant turn was fed back with envelopes stripped, so the model saw
   * itself narrating and then an observation with nothing that could have
   * produced it. Reconciling that means trying to close an envelope it cannot
   * see. The history has to be what it actually wrote.
   */
  const { transport } = await run([
    `Recording the plan.
*** Call: update_plan
{"plan": [{"step": "Build it", "status": "pending"}]}
*** End Call
`,
    'Plan is set.\n',
  ]);

  const assistantTurn = transport.conversations[1].find((m) => m.role === 'assistant');
  assert.ok(assistantTurn, 'the model must see its own turn');
  assert.match(assistantTurn.content, /\*\*\* Call: update_plan/, 'including the call it made');
  assert.match(assistantTurn.content, /\*\*\* End Call/);
});

it('never renders a stray closing marker as prose', async () => {
  // A model that has lost the thread emits these in runs. They are protocol
  // noise; no reply legitimately consists of a lone terminator.
  const { events } = await run([
    `I've got the layout in mind.
*** End Call
*** End Call
*** End Call
`,
  ]);

  assert.doesNotMatch(text(events), /End Call/);
  assert.match(text(events), /layout in mind/);
});

it('nudges a turn that announced work and emitted nothing', async () => {
  // Observed: a long feature plan ending "Let's start by creating the project
  // plan.", no tool call, turn over, nothing written.
  const { files, transport } = await run([
    "I am going to build AURA.\n\nLet's start by creating the project plan.\n",
    `Creating it now.

*** Begin Patch
*** Add File: /App.tsx
+export default function App() { return null; }
*** End Patch

Done — the app is in place.
`,
  ]);

  // Two rounds: the announcement, then the work. A clean patch needs no
  // observation, so the turn ends there rather than going round again.
  assert.equal(transport.turns, 2, 'the turn must continue rather than end empty');
  assert.ok(files['/App.tsx'], 'the work the model announced must actually happen');

  const nudge = transport.conversations[1].at(-1).content;
  assert.match(nudge, /did not emit a tool call/);
});

it('spends the nudge only once', async () => {
  // A model that announces twice has nothing to emit. Asking again would burn
  // the user's budget on it.
  const { transport } = await run([
    "Let's start by creating the project plan.\n",
    "Let's begin by setting up the structure.\n",
    'Never reached.\n',
  ]);

  assert.equal(transport.turns, 2, 'one nudge, then the turn ends');
});

it('does not nudge a turn that simply answered', async () => {
  const { transport, events } = await run([
    "Hey! How can I help? Let me know what you'd like to build.\n",
  ]);

  assert.equal(transport.turns, 1, 'a finished answer must not be nudged');
  assert.equal(events.at(-1).reason, 'complete');
});

it('reports cancellation as a cancelled turn, not an error', async () => {
  const controller = new AbortController();
  controller.abort();

  const { events } = await run(['whatever\n'], {}, { signal: controller.signal });

  const end = events.at(-1);
  assert.equal(end.type, 'turn-end');
  assert.equal(end.reason, 'cancelled');
});

it('includes a project manifest in the first message so the model knows what exists', async () => {
  const { transport } = await run(['ok\n'], { '/App.tsx': 'x\n', '/lib/util.ts': 'y\n' });

  const first = transport.conversations[0].at(-1).content;
  assert.match(first, /<project>/);
  assert.match(first, /\/App\.tsx/);
  assert.match(first, /\/lib\/util\.ts/);
  assert.match(first, /do the thing/);
});

it('stops after the iteration budget and says so in the transcript', async () => {
  // A model that calls a tool forever must terminate, and the user must be told
  // why rather than watching the turn end silently.
  const looping = Array.from(
    { length: 20 },
    () => `*** Call: list_files\n{}\n*** End Call\n`,
  );

  const { events } = await run(looping);

  assert.match(text(events), /tool-call limit/);
  assert.equal(events.at(-1).reason, 'complete');
});
