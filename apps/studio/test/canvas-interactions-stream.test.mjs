/**
 * The Interactions function-call handshake, actually executed.
 *
 * Everything else covering Canvas asserts on source text, which is why five
 * consecutive live attempts failed: a regex can confirm a line exists, not that
 * a `create_canvas` call arrives at the executor with its `content` intact. Two
 * separate defects hid behind passing source tests — a terminal-status gate that
 * dropped the call entirely, then a shared argument buffer that handed the
 * executor `{}` and produced "No content was provided" in the model's own
 * thoughts.
 *
 * So this file runs `streamChat` against a scripted SSE stream and asserts on
 * what `onToolCall` receives. The event shapes below are the ones this API has
 * actually been seen to emit, one test each, and the bytes are fed through the
 * reader in small chunks so a JSON fragment split across a chunk boundary is
 * part of every scenario rather than a test of its own.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const { streamChat } = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'chat.ts'));

/** One SSE frame per event, in the wire shape the reader parses. */
const sse = (events) => events
  .map((event) => `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`)
  .join('');

/**
 * A response body that hands out `chunkSize` bytes at a time.
 *
 * Deliberately small and not aligned to anything: an SSE frame, a `data:` line
 * and a streamed JSON fragment all end up split mid-token, which is the state
 * the reader's persistent `buffer` exists for.
 */
const streamOf = (text, chunkSize = 11) => {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (offset >= bytes.length) return { value: undefined, done: true };
        const value = bytes.slice(offset, offset + chunkSize);
        offset += chunkSize;
        return { value, done: false };
      },
    }),
  };
};

/**
 * Replace `fetch` with a script of stream bodies, one per interaction round.
 *
 * The parsed request bodies are handed back so a test can assert what went back
 * upstream — a tool result is only useful to the model if it is posted with the
 * right `call_id` against the right `previous_interaction_id`.
 */
const installFetch = (rounds) => {
  const requests = [];
  const original = globalThis.fetch;
  let round = 0;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const body = rounds[Math.min(round, rounds.length - 1)];
    round += 1;
    return { ok: true, status: 200, body: streamOf(sse(body)) };
  };
  return {
    requests,
    restore: () => { globalThis.fetch = original; },
  };
};

/**
 * Run one Canvas-shaped turn.
 *
 * These options are what makes the Interactions transport eligible, and they
 * mirror `chat-turn-runner` exactly: official endpoint, search and code
 * execution both on, the Canvas declarations passed as `toolDeclarations`.
 */
const runTurn = async (rounds) => {
  const fetchStub = installFetch(rounds);
  const calls = [];
  const phases = [];
  let text = '';
  try {
    await streamChat(
      [{ role: 'user', content: 'write me a poem in canvas' }],
      {
        provider: 'gemini',
        model: 'gemini-3-pro-preview',
        apiKey: 'test-key',
        thinkingLevel: 1,
        includeThoughts: true,
        enableSearch: true,
        enableCodeExecution: true,
        toolDeclarations: [{
          functionDeclarations: [{
            name: 'create_canvas',
            description: 'Create a document.',
            parameters: { type: 'OBJECT', properties: { content: { type: 'STRING' } }, required: ['content'] },
          }],
        }],
      },
      (token) => { text += token; },
      () => {},
      'system prompt',
      (phase) => { phases.push(phase); },
      async (name, args) => {
        calls.push({ name, args });
        return { status: 'ok', result: 'Document created.' };
      },
    );
  } finally {
    fetchStub.restore();
  }
  return { calls, phases, text, requests: fetchStub.requests };
};

/** The document, long enough that its JSON cannot land in one chunk. */
const DOC = `# Rain\n\n${'Soft rain on the window, and the city goes quiet. '.repeat(12)}`;
const ARGS = { type: 'text/markdown', title: 'Rain', content: DOC };

/** `requires_action` with the call listed on the interaction, as the API sends it. */
const requiresAction = (call) => ({
  event_type: 'interaction.done',
  interaction: {
    id: 'int_first',
    status: 'requires_action',
    required_action: { function_calls: [call] },
  },
});

/** The follow-up round: the model answers, having been told the tool succeeded. */
const ANSWER_ROUND = [
  { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Here it is.' } },
  { event_type: 'interaction.done', interaction: { id: 'int_second', status: 'completed' } },
];

/* ------------------------------------------------- the documented event shape */

/*
 * The shape that produced "No content was provided".
 *
 * `step.start` opens the call with a placeholder `arguments: {}` and the real
 * arguments then stream as `arguments_delta` fragments. Absorbing that
 * placeholder into the same buffer the fragments append to yields
 * `{}{"type":"text/markdown",…}`, which does not parse — so the executor was
 * handed `{}` and rejected the call for the one field the model had definitely
 * sent.
 */
it('delivers a streamed document whole, past the placeholder arguments', async () => {
  const json = JSON.stringify(ARGS);
  const fragments = [];
  for (let at = 0; at < json.length; at += 37) fragments.push(json.slice(at, at + 37));
  assert.ok(fragments.length > 3, 'the fixture must actually be fragmented');

  const opening = { type: 'function_call', id: 'call_rain', name: 'create_canvas', arguments: {} };
  const { calls, requests, text } = await runTurn([
    [
      { event_type: 'step.start', index: 0, step: opening },
      ...fragments.map((fragment) => ({
        event_type: 'step.delta',
        index: 0,
        delta: { type: 'arguments_delta', arguments: fragment },
      })),
      { event_type: 'step.done', index: 0, step: opening },
      requiresAction({ id: 'call_rain', name: 'create_canvas', arguments: {} }),
    ],
    ANSWER_ROUND,
  ]);

  assert.equal(calls.length, 1, 'the call must run exactly once');
  assert.equal(calls[0].name, 'create_canvas');
  assert.deepEqual(calls[0].args, ARGS, 'every field must arrive, `content` included');
  assert.equal(text, 'Here it is.', 'the turn must continue after the tool result');

  const [, second] = requests;
  assert.equal(second.previous_interaction_id, 'int_first');
  assert.deepEqual(second.input, [{
    type: 'function_result',
    name: 'create_canvas',
    call_id: 'call_rain',
    result: { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', result: 'Document created.' }) }] },
  }]);
});

/* --------------------------------------------------- the shapes that also ship */

/*
 * A coalesced deployment sends no `arguments_delta` at all: the call opens and
 * closes with the whole object on the step. Reading only the fragment buffer
 * loses the call outright, which is the "one sentence of preamble and no
 * document" turn.
 */
it('delivers a call whose arguments arrive only on step.done', async () => {
  const done = { type: 'function_call', id: 'call_done', name: 'create_canvas', arguments: ARGS };
  const { calls } = await runTurn([
    [
      { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call_done', name: 'create_canvas' } },
      { event_type: 'step.done', index: 0, step: done },
      requiresAction({ id: 'call_done', name: 'create_canvas', arguments: ARGS }),
    ],
    ANSWER_ROUND,
  ]);
  assert.equal(calls.length, 1, 'the interaction listing the same call must not run it twice');
  assert.deepEqual(calls[0].args, ARGS);
});

/*
 * No function-call step events whatsoever — the calls exist only on the
 * interaction the model is blocked on. This is the last net, and without it an
 * unrecognised step shape ends the turn in silence.
 */
it('delivers a call the interaction lists and the steps never mentioned', async () => {
  const { calls } = await runTurn([
    [
      { event_type: 'step.delta', index: 0, delta: { type: 'thought_summary', text: 'Writing the poem.' } },
      requiresAction({ id: 'call_swept', name: 'create_canvas', arguments: JSON.stringify(ARGS) }),
    ],
    ANSWER_ROUND,
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ARGS, 'a pre-serialised string is as valid as an object');
});

/*
 * The name and the arguments under different `event.index` values. The named
 * half would execute with `{}` and the half holding the document would be
 * discarded for having no name — indistinguishable, from the outside, from the
 * model calling the tool wrongly.
 */
it('reunites a call split across two indices', async () => {
  const json = JSON.stringify(ARGS);
  const { calls } = await runTurn([
    [
      { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call_split', name: 'create_canvas' } },
      { event_type: 'step.delta', index: 7, delta: { type: 'arguments_delta', arguments: json.slice(0, 40) } },
      { event_type: 'step.delta', index: 7, delta: { type: 'arguments_delta', arguments: json.slice(40) } },
      { event_type: 'interaction.done', interaction: { id: 'int_first', status: 'requires_action' } },
    ],
    ANSWER_ROUND,
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ARGS);
});

/*
 * A terminal status that is not `requires_action` still has to run the call.
 * Feeding the result back is impossible without the handshake, but a document
 * the model announced must exist — and the executor reports into the UI itself.
 */
it('runs the call even when the handshake never completes', async () => {
  const { calls, requests } = await runTurn([
    [
      {
        event_type: 'step.done',
        index: 0,
        step: { type: 'function_call', id: 'call_orphan', name: 'create_canvas', arguments: ARGS },
      },
      { event_type: 'interaction.done', interaction: { id: 'int_first', status: 'completed' } },
    ],
  ]);
  assert.equal(calls.length, 1, 'the call must not be dropped on the floor');
  assert.deepEqual(calls[0].args, ARGS);
  assert.equal(requests.length, 1, 'with no handshake there is nothing to post a result to');
});

/* ------------------------------------------------------------------ the phase */

/*
 * "Running code" is the label bound to `executing`, and a Canvas write is not
 * code execution. The phase a declared function reports is what decides which
 * label the thinking row shows, so it is asserted here rather than inferred from
 * the source of the row.
 */
it('reports a declared function as tooling, never as executing', async () => {
  const { phases } = await runTurn([
    [
      {
        event_type: 'step.start',
        index: 0,
        step: { type: 'function_call', id: 'call_phase', name: 'create_canvas', arguments: ARGS },
      },
      requiresAction({ id: 'call_phase', name: 'create_canvas', arguments: ARGS }),
    ],
    ANSWER_ROUND,
  ]);
  assert.ok(phases.includes('tooling'), 'a function call must report its own phase');
  assert.ok(
    !phases.includes('executing'),
    'reporting `executing` is what made a document write claim to be running code',
  );
});

it('keeps executing for the code sandbox', async () => {
  const { phases } = await runTurn([
    [
      { event_type: 'step.start', index: 0, step: { type: 'code_execution_call' } },
      {
        event_type: 'step.delta',
        index: 0,
        delta: { type: 'code_execution_call', arguments: { language: 'python', code: 'print(1)' } },
      },
      { event_type: 'interaction.done', interaction: { id: 'int_first', status: 'completed' } },
    ],
  ]);
  assert.ok(phases.includes('executing'), 'the sandbox is what the label belongs to');
  assert.ok(!phases.includes('tooling'), 'and it is not a declared function');
});
