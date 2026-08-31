/**
 * Claude gets the tools, calls them, and hears what happened — executed, not read.
 *
 * The bug this file exists for: the Anthropic branch of `streamChat` built its
 * `tools` array out of the web-search tool and nothing else, so a canvas turn told
 * the model about `create_canvas` in the system prompt and gave it no way to call
 * one. Reported as "I tried changing the model and asked claude opus 5 to do
 * another change, and I noticed that instead of doing the change, it started
 * outputting html code" — which is the only thing left for a model in that
 * position to do.
 *
 * Source assertions could not have caught it and cannot protect it: the failure
 * was an absent line, and what matters now is a two-round handshake — the
 * declaration going out in Anthropic's own shape, the streamed `input_json_delta`
 * fragments arriving at the executor as one object, and the result going back with
 * the id the model can match it to. So this drives the real adapter against a
 * scripted SSE stream through a stubbed `fetch`.
 */
import { after, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const { streamChat } = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'chat.ts'));

/** Anthropic's wire format: a named event plus its JSON, one frame each. */
const sse = (events) => events
  .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  .join('');

/**
 * A real `Response` over a real `ReadableStream`, handed out 13 bytes at a time.
 *
 * The SDK parses the body itself, so this has to be a genuine stream rather than
 * the hand-rolled reader the Gemini adapter's test can get away with. The small,
 * deliberately unaligned chunks split SSE frames and JSON fragments mid-token,
 * which is the state the argument buffer exists for.
 */
const responseOf = (text) => {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset + 13));
      offset += 13;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
};

/**
 * ONE `fetch` stub for the whole file, with a swappable script.
 *
 * Not one per test, and the reason cost an hour: the SDK captures `fetch` when the
 * client is CONSTRUCTED, and `chat.ts` caches that client by key+baseUrl. So a
 * stub installed and restored per test only ever serves the first one — every
 * later test's requests go to the first test's closure, which happily keeps
 * replying with the last round of its own script. The symptom is a test that sees
 * a plausible answer, zero recorded requests, and no tool call at all.
 */
let script = { rounds: [], requests: [], round: 0 };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  script.requests.push(JSON.parse(init.body));
  const body = script.rounds[Math.min(script.round, script.rounds.length - 1)];
  script.round += 1;
  /* A round can be an error instead of a stream — `{ httpError }` — because the
     client is cached and captured THIS function, so a test cannot swap in its own
     stub to produce one. */
  if (body && !Array.isArray(body) && body.httpError) {
    return new Response(JSON.stringify(body.httpError), {
      status: body.status || 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  return responseOf(sse(body));
};
after(() => { globalThis.fetch = originalFetch; });

const DOC = `<!doctype html>\n<html><body>${'<p>a paragraph of the app</p>'.repeat(20)}</body></html>\n`;
const ARGS = { type: 'text/html', title: 'Pelican Glide', content: DOC };

/** The document's JSON, cut into fragments the way the API streams it. */
const jsonFragments = (value) => {
  const json = JSON.stringify(value);
  const out = [];
  for (let at = 0; at < json.length; at += 37) out.push(json.slice(at, at + 37));
  return out;
};

const TOOL_ROUND = [
  { type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [], usage: { input_tokens: 12, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Updating the game now.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_01', name: 'update_canvas', input: {} } },
  ...jsonFragments(ARGS).map((partial_json) => (
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json } }
  )),
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 220 } },
  { type: 'message_stop' },
];

const ANSWER_ROUND = [
  { type: 'message_start', message: { id: 'msg_2', role: 'assistant', content: [], usage: { input_tokens: 40, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' Done — the pelican flaps now.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
];

const CANVAS_DECLARATIONS = [{
  functionDeclarations: [{
    name: 'update_canvas',
    description: 'Rewrite the current document.',
    parameters: {
      type: 'OBJECT',
      properties: {
        type: { type: 'STRING' },
        title: { type: 'STRING' },
        content: { type: 'STRING', description: 'The whole document.' },
      },
      required: ['content'],
    },
  }],
}];

const runTurn = async (rounds, { toolDeclarations = CANVAS_DECLARATIONS, enableSearch = false } = {}) => {
  script = { rounds, requests: [], round: 0 };
  const calls = [];
  const phases = [];
  let text = '';
  await streamChat(
    [{ role: 'user', content: 'make the pelican flap faster' }],
    {
      provider: 'anthropic',
      model: 'claude-opus-5',
      apiKey: 'test-key',
      thinkingLevel: 0,
      enableSearch,
      toolDeclarations,
    },
    (token) => { text += token; },
    () => {},
    'system prompt',
    (phase) => { phases.push(phase); },
    async (name, args) => {
      calls.push({ name, args });
      return { status: 'ok', result: 'Document updated.' };
    },
  );
  return { calls, phases, text, requests: script.requests };
};

/* --------------------------------------------------------- the declaration */

it('sends the canvas declarations to Claude, in Anthropic\'s shape', async () => {
  const { requests } = await runTurn([TOOL_ROUND, ANSWER_ROUND]);
  const tool = (requests[0].tools || []).find((entry) => entry.name === 'update_canvas');
  assert.ok(tool, 'the tool never reached the model — this is the reported bug');
  assert.equal(tool.description, 'Rewrite the current document.');
  assert.equal(tool.input_schema.type, 'object', 'Gemini spells its types in caps; JSON Schema does not');
  assert.equal(tool.input_schema.properties.content.type, 'string', 'and nested types count too');
  assert.deepEqual(tool.input_schema.required, ['content']);
  assert.equal(tool.parameters, undefined, 'Anthropic reads `input_schema`, not `parameters`');
});

it('still sends search alongside, and neither crowds the other out', async () => {
  const { requests } = await runTurn([TOOL_ROUND, ANSWER_ROUND], { enableSearch: true });
  const names = (requests[0].tools || []).map((entry) => entry.name);
  assert.ok(names.includes('web_search'), 'the server-side search must survive the addition');
  assert.ok(names.includes('update_canvas'));
});

it('sends no tools block at all when there is nothing to declare', async () => {
  const { requests } = await runTurn([ANSWER_ROUND], { toolDeclarations: [] });
  assert.equal(requests[0].tools, undefined, 'an empty array would be a promise of tools that do not exist');
});

/* ------------------------------------------------------------ the handshake */

it('hands the executor the whole document, reassembled from its fragments', async () => {
  const { calls } = await runTurn([TOOL_ROUND, ANSWER_ROUND]);
  assert.equal(calls.length, 1, 'exactly one call, not one per fragment');
  assert.equal(calls[0].name, 'update_canvas');
  assert.deepEqual(calls[0].args, ARGS, 'a truncated document is what "No content was provided" looked like');
});

it('feeds the result back under the id the model can match', async () => {
  const { requests } = await runTurn([TOOL_ROUND, ANSWER_ROUND]);
  assert.equal(requests.length, 2, 'a tool call with no follow-up round is a turn that ends mid-thought');

  const turns = requests[1].messages;
  const assistant = turns[turns.length - 2];
  const user = turns[turns.length - 1];
  assert.equal(assistant.role, 'assistant');
  const use = assistant.content.find((block) => block.type === 'tool_use');
  assert.ok(use, 'the assistant turn must carry the tool_use it is being answered about');
  assert.equal(use.id, 'toolu_01');
  assert.deepEqual(use.input, ARGS, 'and the input it actually ran with');
  assert.ok(
    assistant.content.some((block) => block.type === 'text' && block.text.includes('Updating the game')),
    'the preamble is part of the turn being echoed back',
  );

  assert.equal(user.role, 'user');
  assert.equal(user.content[0].type, 'tool_result');
  assert.equal(user.content[0].tool_use_id, 'toolu_01');
  assert.match(user.content[0].content[0].text, /Document updated/);
});

it('streams the text of every round into one reply', async () => {
  const { text } = await runTurn([TOOL_ROUND, ANSWER_ROUND]);
  assert.equal(text, 'Updating the game now. Done — the pelican flaps now.');
});

/*
 * `tooling` is not `executing`: the label bound to `executing` is "Running code",
 * and a canvas write is not code execution. Same distinction the Gemini adapter
 * makes, for the same reason.
 */
it('reports the tool phase, then the answer', async () => {
  const { phases } = await runTurn([TOOL_ROUND, ANSWER_ROUND]);
  assert.ok(phases.includes('tooling'), 'the card cannot appear mid-stream without it');
  assert.ok(phases.includes('responding'));
  assert.ok(!phases.includes('executing'), 'a canvas write must never claim to be running code');
});

/*
 * The lesson the Gemini adapter learned the hard way (see `canFeedResultsBack`):
 * the blocks arriving is the fact, the stop reason is a claim about it. A gateway
 * that omits or renames `tool_use` must not cost the call.
 */
it('runs the call even when the stop reason never says tool_use', async () => {
  const noStopReason = TOOL_ROUND.filter((event) => event.type !== 'message_delta');
  const { calls, requests } = await runTurn([noStopReason, ANSWER_ROUND]);
  assert.equal(calls.length, 1, 'the call must run on the evidence of the block');
  assert.equal(requests.length, 2, 'and still be answered');
});

it('survives a stream cut mid-argument instead of failing the turn', async () => {
  const truncated = [
    ...TOOL_ROUND.slice(0, TOOL_ROUND.findIndex((event) => event.delta?.type === 'input_json_delta') + 2),
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    { type: 'message_stop' },
  ];
  const { calls } = await runTurn([truncated, ANSWER_ROUND]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, {}, 'the executor answers an empty call with an error the model understands');
});

/* ------------------------------------------------------- the search half */

/*
 * Claude's web search is Anthropic's OWN tool — it runs server-side and answers
 * itself, so it needs no executor. What it does need is the turn not to end while
 * it is still working: a long server-tool sequence comes back
 * `stop_reason: 'pause_turn'`, and the documented way to continue is to post the
 * partial assistant turn back. Without that the reply stops wherever the pause
 * landed, which reads as the model trailing off mid-sentence.
 */
const PAUSED_ROUND = [
  { type: 'message_start', message: { id: 'msg_p', role: 'assistant', content: [], usage: { input_tokens: 9, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Looking that up.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"pelican' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ' flight speed"}' } },
  { type: 'content_block_stop', index: 1 },
  {
    type: 'content_block_start',
    index: 2,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_1',
      content: [{ type: 'web_search_result', url: 'https://birds.example/pelican', title: 'Pelican', page_age: null }],
    },
  },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'pause_turn' } },
  { type: 'message_stop' },
];

it('resumes a paused search turn instead of ending it', async () => {
  const { requests, text, calls } = await runTurn([PAUSED_ROUND, ANSWER_ROUND], { enableSearch: true });
  assert.equal(requests.length, 2, 'a pause must be continued, not treated as the end of the turn');
  assert.equal(calls.length, 0, 'the search is Anthropic\'s own — there is nothing for the executor to run');

  const turns = requests[1].messages;
  const resumed = turns[turns.length - 1];
  assert.equal(resumed.role, 'assistant', 'a pause is resumed with the partial turn, with no user turn after it');
  const kinds = resumed.content.map((block) => block.type);
  assert.deepEqual(kinds, ['text', 'server_tool_use', 'web_search_tool_result'], 'every block goes back, in order');
  assert.deepEqual(
    resumed.content[1].input,
    { query: 'pelican flight speed' },
    'including the search it already ran, reassembled from its fragments',
  );
  assert.equal(text, 'Looking that up. Done — the pelican flaps now.');
});

it('keeps the sources it found across the pause', async () => {
  const sources = [];
  script = { rounds: [PAUSED_ROUND, ANSWER_ROUND], requests: [], round: 0 };
  await streamChat(
    [{ role: 'user', content: 'how fast is a pelican' }],
    { provider: 'anthropic', model: 'claude-opus-5', apiKey: 'test-key', thinkingLevel: 0, enableSearch: true },
    () => {},
    () => {},
    'system prompt',
    () => {},
    async () => ({ status: 'ok' }),
    () => {},
    (citations) => { sources.push(...citations.sources); },
  );
  assert.equal(sources.length, 1, 'the result list arrived in the round that paused');
  assert.match(sources[0].uri, /birds\.example/);
});

/* ------------------------------------------------ thinking, and the ladder */

/*
 * The thinking slider was reaching Gemini and being DROPPED here: the Messages
 * request carried no `thinking` block, so Claude answered at its default and the
 * thoughts panel stayed empty on every Claude turn. `thinking_delta` was already
 * being forwarded to `onThought` — there was simply never anything to forward.
 */
const THINKING_ROUND = [
  { type: 'message_start', message: { id: 'msg_t', role: 'assistant', content: [], usage: { input_tokens: 8, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Weighing the options.' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Here you go.' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
];

const runThinkingTurn = async (rounds, thinkingLevel) => {
  script = { rounds, requests: [], round: 0 };
  const thoughts = [];
  await streamChat(
    [{ role: 'user', content: 'think about this' }],
    {
      provider: 'anthropic',
      model: 'claude-opus-5',
      apiKey: 'test-key',
      thinkingLevel,
      includeThoughts: thinkingLevel > 0,
      enableSearch: false,
    },
    () => {},
    () => {},
    'system prompt',
    () => {},
    async () => ({ status: 'ok' }),
    (thought) => { thoughts.push(thought); },
  );
  return { thoughts, requests: script.requests };
};

it('asks for extended thinking, with a budget the slider chooses', async () => {
  const low = await runThinkingTurn([THINKING_ROUND], 1);
  const high = await runThinkingTurn([THINKING_ROUND], 4);
  assert.equal(low.requests[0].thinking.type, 'enabled');
  assert.ok(
    high.requests[0].thinking.budget_tokens > low.requests[0].thinking.budget_tokens,
    'a higher setting has to mean a larger budget or the control is decoration',
  );
  assert.ok(
    high.requests[0].thinking.budget_tokens < high.requests[0].max_tokens,
    'the budget is part of max_tokens, not additional to it — the API rejects the other reading',
  );
  assert.deepEqual(low.thoughts, ['Weighing the options.'], 'and the thoughts reach the panel');
});

it('sends no thinking block at level zero', async () => {
  const { requests } = await runThinkingTurn([ANSWER_ROUND], 0);
  assert.equal(requests[0].thinking, undefined, 'off must mean absent, not enabled with a floor budget');
});

/*
 * Willow's system prompt is thousands of tokens and byte-identical on every turn of
 * a chat, so it is marked ephemeral and read from cache for five minutes.
 */
it('marks the system prompt cacheable', async () => {
  const { requests } = await runTurn([ANSWER_ROUND], { toolDeclarations: [] });
  assert.ok(Array.isArray(requests[0].system), 'cache_control lives on a block, so system becomes a block list');
  assert.equal(requests[0].system[0].text, 'system prompt');
  assert.deepEqual(requests[0].system[0].cache_control, { type: 'ephemeral' });
});

/*
 * The ladder. This provider is routinely pointed at a gateway and an older model
 * can be typed into the Models tab by hand, so each optional parameter is sent once
 * and dropped if it comes back named in a 400 — keeping everything else. Gating on
 * endpoint identity instead would test who is answering rather than what they
 * support.
 */
const refusal = (message) => ({
  httpError: { type: 'error', error: { type: 'invalid_request_error', message } },
});

it('drops exactly the parameter an endpoint names, and keeps the rest', async () => {
  script = {
    rounds: [
      refusal('cache_control: unsupported field'),
      refusal('thinking is not supported on this model'),
      refusal('max_tokens: 32000 > 8192, which is the maximum for this model'),
      ANSWER_ROUND,
    ],
    requests: [],
    round: 0,
  };
  let text = '';
  await streamChat(
    [{ role: 'user', content: 'hi' }],
    {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'test-key',
      thinkingLevel: 3,
      includeThoughts: true,
      enableSearch: false,
    },
    (token) => { text += token; },
    () => {},
    'system prompt',
  );

  const [first, second, third, fourth] = script.requests;
  assert.ok(Array.isArray(first.system) && first.thinking && first.max_tokens > 8192, 'everything is offered once');
  assert.equal(typeof second.system, 'string', 'caching dropped');
  assert.ok(second.thinking, 'and nothing else');
  assert.equal(third.thinking, undefined, 'then thinking');
  assert.equal(third.max_tokens, first.max_tokens, 'still asking for the ceiling');
  assert.equal(fourth.max_tokens, 4096, 'and finally the ceiling steps down');
  assert.match(text, /Done/, 'the turn answers rather than failing');
});

it('re-throws a rejection it does not recognise', async () => {
  script = { rounds: [refusal('invalid x-api-key')], requests: [], round: 0 };
  await assert.rejects(
    streamChat(
      [{ role: 'user', content: 'hi' }],
      { provider: 'anthropic', model: 'claude-opus-5', apiKey: 'test-key', thinkingLevel: 0, enableSearch: false },
      () => {},
      () => {},
      'system prompt',
    ),
    /invalid x-api-key/,
    'a bad key must surface as a bad key, not as four retries and a mystery',
  );
});

/*
 * The Tool translation setting, on this adapter. `function-calling` means the
 * endpoint speaks plain function calling and nothing else, so Anthropic's own
 * server-side search goes away and Willow's declarations stay. It used to mean
 * nothing here at all — the dropdown had no effect on this provider.
 */
const runPolicyTurn = async (toolPolicy) => {
  script = { rounds: [ANSWER_ROUND], requests: [], round: 0 };
  await streamChat(
    [{ role: 'user', content: 'hi' }],
    {
      provider: 'anthropic',
      model: 'claude-opus-5',
      apiKey: 'test-key',
      thinkingLevel: 0,
      enableSearch: true,
      toolPolicy,
      toolDeclarations: CANVAS_DECLARATIONS,
    },
    () => {},
    () => {},
    'system prompt',
  );
  return script.requests[0];
};

it('honours function-calling by dropping search and keeping the declarations', async () => {
  const request = await runPolicyTurn('function-calling');
  const names = (request.tools || []).map((entry) => entry.name);
  assert.ok(!names.includes('web_search'), 'the built-in goes');
  assert.ok(names.includes('update_canvas'), 'the declaration stays');
});

it('honours disabled by sending no tools at all', async () => {
  const request = await runPolicyTurn('disabled');
  assert.equal(request.tools, undefined, 'neither built-ins nor declarations');
});

it('asks for enough output to hold a document, and steps down if refused', async () => {
  const { requests } = await runTurn([TOOL_ROUND, ANSWER_ROUND]);
  assert.ok(requests[0].max_tokens >= 16000, `4096 cannot hold a document; got ${requests[0].max_tokens}`);

  /* An older model configured in the Models tab answers with a 400 naming its own
     limit. One step down, once, rather than a failed turn. */
  const refusal = {
    httpError: {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'max_tokens: 32000 > 8192, which is the maximum allowed number of output tokens for claude-3-5-sonnet-20241022',
      },
    },
  };
  script = { rounds: [refusal, ANSWER_ROUND], requests: [], round: 0 };
  let text = '';
  await streamChat(
    [{ role: 'user', content: 'hi' }],
    { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', apiKey: 'test-key', thinkingLevel: 0, enableSearch: false },
    (token) => { text += token; },
    () => {},
    'system prompt',
  );
  assert.deepEqual(
    script.requests.map((request) => request.max_tokens),
    [32000, 4096],
    'the retry is one step, to a value every model accepts',
  );
  assert.match(text, /Done/, 'and the turn still answers');
});
