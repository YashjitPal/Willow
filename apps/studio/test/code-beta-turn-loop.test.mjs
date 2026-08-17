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
  path.join(repoRoot, 'features', 'code-beta', 'src', 'harness', 'runtime', 'agent.ts'),
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

it('records a plan without echoing it back into the transcript', async () => {
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

  assert.match(transport.conversations[1].at(-1).content, /Do not repeat it back/);
});

it('runs a sub-agent and surfaces its work separately from the main thread', async () => {
  const { files, events } = await run([
    `Delegating the component.

*** Call: task
{"name": "Card builder", "kind": "implementer", "objective": "Create the Card component"}
*** End Call
`,
    // The sub-agent's own turn.
    `*** Begin Patch
*** Add File: /Card.tsx
+export function Card() { return null; }
*** End Patch
`,
    'Created Card.tsx.\n',
    // Back on the main thread.
    'The card is in place.\n',
  ]);

  assert.ok(files['/Card.tsx'], 'the sub-agent should have written the file');

  const started = events.find((event) => event.type === 'agents-start');
  assert.ok(started);
  assert.equal(started.agents[0].name, 'Card builder');
  assert.equal(started.agents[0].kind, 'implementer');

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
