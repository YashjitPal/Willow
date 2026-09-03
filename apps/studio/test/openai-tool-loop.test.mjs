/**
 * The OpenAI-shaped adapters, executed: Chat Completions, the Responses API, and
 * Grok on top of both.
 *
 * These three shared one gap with the Anthropic branch — `toolDeclarations` was
 * read by the Gemini adapter and nobody else, so Canvas and the personalization
 * tools were invisible to every model that was not Gemini. The failure is silent
 * and it does not look like a missing tool: the model writes the document into the
 * reply, or claims it saved something it never called.
 *
 * Source assertions cannot protect a handshake. What matters is that a call split
 * across `delta.tool_calls` fragments arrives at the executor whole, and that the
 * result goes back in the shape each API pairs by id — `tool_call_id` on Chat
 * Completions, `call_id` on Responses. So this drives the real adapter against
 * scripted SSE through one stubbed `fetch`.
 */
import { after, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const { streamChat } = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'chat.ts'));

/** Chat Completions frames: bare `data:` lines and a `[DONE]` sentinel. */
const chatSse = (chunks) => `${chunks
  .map((chunk) => `data: ${JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-5',
    ...chunk,
  })}\n\n`)
  .join('')}data: [DONE]\n\n`;

/** Responses frames: a named event beside its JSON, which carries `type` too. */
const responsesSse = (events) => events
  .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  .join('');

const responseOf = (text) => {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      /* 17 bytes at a time, deliberately unaligned: an SSE frame and a JSON
         argument fragment both end up split mid-token, which is the state the
         per-index accumulator exists for. */
      controller.enqueue(bytes.slice(offset, offset + 17));
      offset += 17;
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

/*
 * ONE stub for the file. The SDK captures `fetch` when the client is constructed
 * and `chat.ts` caches clients per provider, so a per-test stub would only ever
 * serve the first test — every later one would read the first test's script and
 * look like an adapter that lost the call.
 */
let script = { bodies: [], requests: [], round: 0 };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  script.requests.push({ url: String(url), body });
  /* Reject on a FIELD rather than on a round number, for the fallback tests: the
     SDK retries some rejections itself, so "the second request" is not a stable
     thing to script against. */
  if (script.rejectStreamOptions && body.stream_options) {
    return new Response(
      JSON.stringify({ error: { message: 'Unrecognized request argument supplied: stream_options', param: 'stream_options' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }
  /* Reject whichever Live Search spelling arrives, so the ladder can be walked all
     the way down. The message copies the one api.x.ai actually returned. */
  if (script.rejectXaiSearch) {
    const types = (body.tools || []).map((entry) => entry.type);
    if (types.includes('live_search')) {
      return new Response(
        JSON.stringify({ error: { message: 'Failed to deserialize the JSON body into the target type: tools[0].type: unknown variant `live_search`, expected `function`' } }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      );
    }
    if (body.search_parameters) {
      return new Response(
        JSON.stringify({ error: { message: 'unknown field `search_parameters`' } }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      );
    }
  }
  const next = script.bodies[Math.min(script.round, script.bodies.length - 1)];
  script.round += 1;
  if (next && typeof next === 'object' && next.httpError) {
    return new Response(JSON.stringify(next.httpError), {
      status: next.status || 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  return responseOf(next);
};
after(() => { globalThis.fetch = originalFetch; });

const DOC = `<!doctype html>\n<html><body>${'<p>paragraph</p>'.repeat(30)}</body></html>\n`;
const ARGS = { type: 'text/html', title: 'Pelican Glide', content: DOC };

/** JSON in 31-byte fragments, the way `function.arguments` streams. */
const fragments = (value) => {
  const json = JSON.stringify(value);
  const out = [];
  for (let at = 0; at < json.length; at += 31) out.push(json.slice(at, at + 31));
  return out;
};

const CHAT_TOOL_ROUND = chatSse([
  { choices: [{ index: 0, delta: { role: 'assistant', content: 'Rewriting it.' }, finish_reason: null }] },
  {
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'update_canvas', arguments: '' } }] },
      finish_reason: null,
    }],
  },
  ...fragments(ARGS).map((chunk) => ({
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: chunk } }] }, finish_reason: null }],
  })),
  { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 30, completion_tokens: 200, total_tokens: 230 } },
]);

const CHAT_ANSWER_ROUND = chatSse([
  { choices: [{ index: 0, delta: { role: 'assistant', content: ' Done — it flaps faster now.' }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
]);

/** The same answer, with the usage chunk `stream_options` asks for. */
const CHAT_ANSWER_ROUND_WITH_USAGE = chatSse([
  { choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello.' }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  { choices: [], usage: { prompt_tokens: 9, completion_tokens: 12, total_tokens: 21 } },
]);

const DECLARATIONS = [{
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

const runTurn = async (bodies, options = {}) => {
  script = { bodies, requests: [], round: 0 };
  const calls = [];
  const phases = [];
  const thoughts = [];
  let text = '';
  await streamChat(
    [{ role: 'user', content: 'make the pelican flap faster' }],
    {
      provider: 'openai',
      model: 'gpt-5.2',
      apiKey: 'sk-test-key',
      thinkingLevel: 1,
      enableSearch: false,
      toolDeclarations: DECLARATIONS,
      ...options,
    },
    (token) => { text += token; },
    () => {},
    'system prompt',
    (phase) => { phases.push(phase); },
    async (name, args) => {
      calls.push({ name, args });
      return { status: 'ok', result: 'Document updated.' };
    },
    (thought) => { thoughts.push(thought); },
  );
  return { calls, phases, thoughts, text, requests: script.requests };
};

/* ------------------------------------------------- Chat Completions: the tools */

it('declares the tools in Chat Completions\' nested function shape', async () => {
  const { requests } = await runTurn([CHAT_TOOL_ROUND, CHAT_ANSWER_ROUND]);
  const tool = (requests[0].body.tools || []).find((entry) => entry.function?.name === 'update_canvas');
  assert.ok(tool, 'the tool never reached the model — the reported bug, on this provider');
  assert.equal(tool.type, 'function');
  assert.equal(tool.function.description, 'Rewrite the current document.');
  assert.equal(tool.function.parameters.type, 'object', 'Gemini spells its types in caps; JSON Schema does not');
  assert.equal(tool.function.parameters.properties.content.type, 'string');
  assert.equal(tool.function.name, 'update_canvas');
  assert.equal(tool.name, undefined, 'Chat Completions reads the nested form, not the flat one');
});

it('sends no tools key when there is nothing to declare', async () => {
  const { requests } = await runTurn([CHAT_ANSWER_ROUND], { toolDeclarations: [] });
  assert.equal(requests[0].body.tools, undefined, 'an empty array is a promise of tools that do not exist');
});

it('hands the executor the whole document, reassembled from its fragments', async () => {
  const { calls } = await runTurn([CHAT_TOOL_ROUND, CHAT_ANSWER_ROUND]);
  assert.equal(calls.length, 1, 'one call, not one per fragment');
  assert.equal(calls[0].name, 'update_canvas');
  assert.deepEqual(calls[0].args, ARGS, 'a truncated document is what "No content was provided" looks like');
});

it('feeds the result back under the id Chat Completions pairs on', async () => {
  const { requests } = await runTurn([CHAT_TOOL_ROUND, CHAT_ANSWER_ROUND]);
  assert.equal(requests.length, 2, 'a call with no follow-up round is a turn that ends mid-thought');
  const turns = requests[1].body.messages;
  const assistant = turns[turns.length - 2];
  const tool = turns[turns.length - 1];

  assert.equal(assistant.role, 'assistant');
  assert.equal(assistant.tool_calls[0].id, 'call_abc');
  assert.equal(assistant.tool_calls[0].type, 'function');
  assert.deepEqual(JSON.parse(assistant.tool_calls[0].function.arguments), ARGS);
  assert.equal(assistant.content, 'Rewriting it.', 'the preamble is part of the turn being echoed back');

  assert.equal(tool.role, 'tool');
  assert.equal(tool.tool_call_id, 'call_abc');
  assert.match(tool.content, /Document updated/);
});

/*
 * `content: null` rather than `''`. An empty string is a message the model did not
 * send, and endpoints have been seen to reject one alongside `tool_calls`.
 */
it('echoes a silent tool turn back with null content', async () => {
  const silent = chatSse([
    {
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: 'call_quiet', type: 'function', function: { name: 'update_canvas', arguments: '{"content":"x"}' } }] },
        finish_reason: 'tool_calls',
      }],
    },
  ]);
  const { requests, calls } = await runTurn([silent, CHAT_ANSWER_ROUND]);
  assert.deepEqual(calls[0].args, { content: 'x' });
  const assistant = requests[1].body.messages.find((message) => Array.isArray(message.tool_calls));
  assert.equal(assistant.content, null);
});

it('streams every round into one reply, and reports the phases in order', async () => {
  const { text, phases } = await runTurn([CHAT_TOOL_ROUND, CHAT_ANSWER_ROUND]);
  assert.equal(text, 'Rewriting it.\n\nDone — it flaps faster now.');
  assert.ok(phases.includes('tooling'), 'the card cannot appear mid-stream without it');
  assert.ok(phases.includes('responding'));
  assert.ok(!phases.includes('executing'), 'a canvas write must never claim to be running code');
});

it('runs two calls from one turn, in the order they were declared', async () => {
  const twice = chatSse([
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [
            { index: 1, id: 'call_second', type: 'function', function: { name: 'update_canvas', arguments: '{"title":"B"}' } },
            { index: 0, id: 'call_first', type: 'function', function: { name: 'update_canvas', arguments: '{"title":"A"}' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
    },
  ]);
  const { calls, requests } = await runTurn([twice, CHAT_ANSWER_ROUND]);
  assert.deepEqual(calls.map((call) => call.args.title), ['A', 'B'], 'index orders them, not arrival');
  const results = requests[1].body.messages.filter((message) => message.role === 'tool');
  assert.deepEqual(results.map((message) => message.tool_call_id), ['call_first', 'call_second']);
});

/* -------------------------------------------------------------- Grok's shape */

/*
 * Grok's search is TWO vocabularies, and which one is right depends on the endpoint
 * — measured in the user's own gateway log against grok-4.6:
 *
 *     tools[0].type: unknown variant `web_search`,
 *                    expected `function` or `live_search`
 *
 * `web_search` / `x_search` are Responses-API types. Sending them on Chat
 * Completions is a 422 before the model runs, and the search-off fallback then
 * returned a clean 200 — so every Grok turn answered and none of them searched.
 */
it('asks Chat Completions for live_search, never the Responses types', async () => {
  const { requests } = await runTurn([CHAT_TOOL_ROUND, CHAT_ANSWER_ROUND], {
    provider: 'spacexai',
    model: 'grok-4-latest',
    enableSearch: true,
  });
  const tools = requests[0].body.tools || [];
  const types = tools.map((entry) => entry.type);
  assert.ok(types.includes('live_search'), 'the variant the endpoint itself named');
  assert.ok(!types.includes('web_search'), 'this one 422s the whole body on this path');
  assert.ok(!types.includes('x_search'));
  assert.ok(
    tools.some((entry) => entry.function?.name === 'update_canvas'),
    'declaring a function must not displace the built-in',
  );
});

it('keeps the agentic pair for the Responses path, where they are correct', async () => {
  const { requests } = await runTurn([RESPONSES_ANSWER_ROUND], {
    provider: 'spacexai',
    model: 'grok-4-latest',
    apiFormat: 'openai-responses',
    enableSearch: true,
    toolDeclarations: [],
  });
  const types = (requests[0].body.tools || []).map((entry) => entry.type);
  assert.deepEqual(types, ['web_search', 'x_search'], 'X as well as the open web');
});

/*
 * And if `live_search` is not what a given relay wants either, the other spelling
 * is tried before search is given up — the ladder has to be one ladder, because a
 * generic "drop search" retry would fire on the first rejection and never reach the
 * second shape.
 */
it('falls back to search_parameters, then to no search at all', async () => {
  script = { bodies: [CHAT_ANSWER_ROUND], requests: [], round: 0, rejectXaiSearch: true };
  let text = '';
  await streamChat(
    [{ role: 'user', content: 'what happened today' }],
    {
      provider: 'spacexai',
      model: 'grok-4-latest',
      apiKey: 'sk-test-key',
      thinkingLevel: 2,
      enableSearch: true,
    },
    (token) => { text += token; },
    () => {},
    'system prompt',
  );
  const shapes = script.requests.map((request) => {
    const types = (request.body.tools || []).map((entry) => entry.type);
    if (types.includes('live_search')) return 'live_search';
    if (request.body.search_parameters) return 'search_parameters';
    return 'none';
  });
  assert.deepEqual(shapes, ['live_search', 'search_parameters', 'none'], 'every spelling, then give up');
  assert.match(text, /Done/, 'and the turn still answers');
});

it('sends reasoning_effort to grok-4 and withholds it from grok-3', async () => {
  const four = await runTurn([CHAT_ANSWER_ROUND], { provider: 'spacexai', model: 'grok-4-latest', thinkingLevel: 3 });
  assert.equal(four.requests[0].body.reasoning_effort, 'high', 'the grok-4 family takes it');
  const three = await runTurn([CHAT_ANSWER_ROUND], { provider: 'spacexai', model: 'grok-3', thinkingLevel: 3 });
  assert.equal(three.requests[0].body.reasoning_effort, undefined, 'anything else 400s on it');
});

/* -------------------------------------------------------------- the usage */

/*
 * Chat Completions reports NO usage on a streamed response unless asked, so the
 * token counts were absent on every OpenAI and Grok turn while Gemini and Anthropic
 * reported theirs. Asked for once, and dropped if the endpoint names it — a relay
 * without the field must cost a token count, not the turn.
 */
it('asks for usage on a streamed turn, and reports what comes back', async () => {
  const usage = [];
  script = { bodies: [CHAT_ANSWER_ROUND_WITH_USAGE], requests: [], round: 0 };
  await streamChat(
    [{ role: 'user', content: 'hi' }],
    { provider: 'openai', model: 'gpt-5.2', apiKey: 'sk-test-key', thinkingLevel: 1, enableSearch: false },
    () => {},
    () => {},
    'system prompt',
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    (report) => { usage.push(report); },
  );
  assert.deepEqual(script.requests[0].body.stream_options, { include_usage: true });
  assert.equal(usage.length, 1, 'the count has to reach the caller, not just the wire');
  assert.equal(usage[0].outputTokens, 12);
});

it('drops stream_options when the endpoint rejects it, and still answers', async () => {
  /*
   * The stub rejects every request CARRYING the field rather than a fixed number of
   * them, because the SDK has its own retry policy in front of this and the point is
   * the adapter's behaviour, not the retry count: whatever the SDK does first, the
   * turn must end up asking without the field and answering.
   */
  script = { bodies: [CHAT_ANSWER_ROUND], requests: [], round: 0, rejectStreamOptions: true };
  let text = '';
  await streamChat(
    [{ role: 'user', content: 'hi' }],
    { provider: 'openai', model: 'gpt-5.2', apiKey: 'sk-test-key', thinkingLevel: 1, enableSearch: false },
    (token) => { text += token; },
    () => {},
    'system prompt',
  );
  const offered = script.requests.map((request) => !!request.body.stream_options);
  assert.equal(offered[0], true, 'offered once');
  assert.equal(offered[offered.length - 1], false, 'then dropped');
  assert.match(text, /Done/, 'the turn survives the retry');
});

/* ---------------------------------------------------------- the endpoints */

/*
 * Every OpenAI-shaped provider shares one request path, so the base URL each one
 * resolves to is part of that path being correct.
 *
 * Zhipu is the case that was broken: its OpenAI-compatible base is
 * `https://open.bigmodel.cn/api/paas/v4`, and the resolver only recognised `/v1` as
 * an existing version segment — so it appended another one and every GLM request
 * went to `/api/paas/v4/v1/chat/completions`, a 404. Nothing about that is visible
 * in the request body, which is why it survived: the shapes were all correct and
 * the address was not.
 */
it('sends each provider to its own documented path, versioned once', async () => {
  const cases = [
    ['openai', 'gpt-5.2', 'https://api.openai.com/v1/chat/completions'],
    ['spacexai', 'grok-4-latest', 'https://api.x.ai/v1/chat/completions'],
    ['zhipuai', 'glm-5.3', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
    ['moonshot', 'kimi-k2', 'https://api.moonshot.cn/v1/chat/completions'],
  ];
  for (const [provider, model, expected] of cases) {
    await runTurn([CHAT_ANSWER_ROUND], { provider, model, toolDeclarations: [] });
    assert.equal(script.requests[0].url, expected, provider);
  }
});

/* ------------------------------------------------ the compatible providers */

/*
 * Kimi and GLM used to be served by a branch that could never run: both default to
 * `openai-chat-completions`, which is handled above, so the dedicated branch below
 * it was unreachable and everything specific to them was silently lost. These pin
 * what each one gets now.
 */
it('gives GLM its nested search config, which is how results come back at all', async () => {
  const { requests } = await runTurn([CHAT_ANSWER_ROUND], {
    provider: 'zhipuai',
    model: 'glm-5.3',
    enableSearch: true,
    toolDeclarations: [],
  });
  const search = (requests[0].body.tools || []).find((entry) => entry.type === 'web_search');
  assert.ok(search, 'GLM search must be declared');
  assert.deepEqual(
    search.web_search,
    { enable: 'True', search_result: 'True' },
    'the nested config, and those really are the strings Zhipu wants',
  );
});

it('sends GLM thinking and effort only on the model that takes them', async () => {
  const reasoning = await runTurn([CHAT_ANSWER_ROUND], {
    provider: 'zhipuai', model: 'glm-5.3', thinkingLevel: 3, toolDeclarations: [],
  });
  assert.equal(reasoning.requests[0].body.reasoning_effort, 'high');
  assert.deepEqual(reasoning.requests[0].body.thinking, { type: 'enabled' });

  const plain = await runTurn([CHAT_ANSWER_ROUND], {
    provider: 'zhipuai', model: 'glm-4.6', thinkingLevel: 3, toolDeclarations: [],
  });
  assert.equal(plain.requests[0].body.reasoning_effort, undefined, 'any other GLM 400s on the field');
  assert.equal(plain.requests[0].body.thinking, undefined);
});

it('caps Kimi and GLM below OpenAI\'s own effort vocabulary', async () => {
  const kimi = await runTurn([CHAT_ANSWER_ROUND], {
    provider: 'moonshot', model: 'kimi-k2', thinkingLevel: 4, toolDeclarations: [],
  });
  assert.equal(kimi.requests[0].body.reasoning_effort, 'max', '`xhigh` is OpenAI\'s own and 400s here');
});

it('declares no search tool for Moonshot, but every client tool', async () => {
  const { requests } = await runTurn([CHAT_ANSWER_ROUND], {
    provider: 'moonshot',
    model: 'kimi-k2',
    enableSearch: true,
  });
  const tools = requests[0].body.tools || [];
  assert.ok(
    !tools.some((entry) => entry.type === 'web_search'),
    'its builtin could not be verified, and a guessed schema is a 400',
  );
  assert.ok(
    tools.some((entry) => entry.function?.name === 'update_canvas'),
    'which is no reason for Canvas not to work on Kimi',
  );
});

/* ------------------------------------------------------ the tool translation */

/*
 * One dropdown, one meaning, on every provider: `provider-native` sends the
 * endpoint's built-ins alongside Willow's declarations, `function-calling` sends the
 * declarations alone, `disabled` sends nothing. It used to mean three different
 * things — nothing at all on Gemini and Anthropic, "no search" on OpenAI, and
 * nothing again on xAI, which was exempted because a stale stored default would
 * otherwise have turned its search off.
 */
it('honours function-calling by dropping the built-ins and keeping the functions', async () => {
  const { requests } = await runTurn([CHAT_TOOL_ROUND, CHAT_ANSWER_ROUND], {
    provider: 'spacexai',
    model: 'grok-4-latest',
    enableSearch: true,
    toolPolicy: 'function-calling',
  });
  const tools = requests[0].body.tools || [];
  assert.ok(!tools.some((entry) => entry.type === 'web_search'), 'no server-side search');
  assert.ok(!tools.some((entry) => entry.type === 'x_search'));
  assert.ok(tools.some((entry) => entry.function?.name === 'update_canvas'), 'the client tools stay');
});

it('honours disabled by sending no tools at all', async () => {
  const { requests } = await runTurn([CHAT_ANSWER_ROUND], {
    enableSearch: true,
    toolPolicy: 'disabled',
  });
  assert.equal(requests[0].body.tools, undefined, 'neither built-ins nor declarations');
});

/* ------------------------------------------------------- the Responses API */

const RESPONSES_TOOL_ROUND = responsesSse([
  { type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } },
  { type: 'response.output_text.delta', delta: 'Rewriting it.' },
  {
    type: 'response.output_item.done',
    item: { type: 'function_call', id: 'fc_1', call_id: 'call_resp', name: 'update_canvas', arguments: JSON.stringify(ARGS) },
  },
  {
    type: 'response.completed',
    response: {
      id: 'resp_1',
      status: 'completed',
      usage: { input_tokens: 20, output_tokens: 100, total_tokens: 120 },
      output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_resp', name: 'update_canvas', arguments: JSON.stringify(ARGS) }],
    },
  },
]);

const RESPONSES_ANSWER_ROUND = responsesSse([
  { type: 'response.created', response: { id: 'resp_2', status: 'in_progress' } },
  { type: 'response.output_text.delta', delta: ' Done' },
  { type: 'response.output_text.delta', delta: ' — it flaps faster now.' },
  { type: 'response.completed', response: { id: 'resp_2', status: 'completed', output: [] } },
]);

/*
 * The Responses path used to await the whole response and emit it in one
 * `onToken`, so a long answer sat on a blank screen and then appeared at once —
 * beside a Chat Completions path that streamed. Two token calls, not one, is the
 * assertion that keeps it streaming.
 */
it('streams the Responses API instead of arriving all at once', async () => {
  const tokens = [];
  script = { bodies: [RESPONSES_ANSWER_ROUND], requests: [], round: 0 };
  await streamChat(
    [{ role: 'user', content: 'hi' }],
    { provider: 'openai', model: 'gpt-5.2', apiKey: 'sk-test-key', apiFormat: 'openai-responses', thinkingLevel: 1, enableSearch: false },
    (token) => { tokens.push(token); },
    () => {},
    'system prompt',
  );
  assert.deepEqual(tokens, [' Done', ' — it flaps faster now.'], 'one call per delta');
  assert.equal(script.requests[0].body.stream, true);
});

it('does the Responses tool handshake on call_id', async () => {
  const { calls, requests, text } = await runTurn(
    [RESPONSES_TOOL_ROUND, RESPONSES_ANSWER_ROUND],
    { apiFormat: 'openai-responses' },
  );
  assert.deepEqual(calls[0].args, ARGS, 'the arguments arrive whole');
  assert.equal(requests.length, 2);

  const input = requests[1].body.input;
  const call = input[input.length - 2];
  const output = input[input.length - 1];
  assert.equal(call.type, 'function_call');
  assert.equal(call.call_id, 'call_resp', '`id` identifies the item; `call_id` is what pairs them');
  assert.equal(output.type, 'function_call_output');
  assert.equal(output.call_id, 'call_resp');
  assert.match(output.output, /Document updated/);
  assert.equal(text, 'Rewriting it.\n\nDone — it flaps faster now.');
});

it('declares functions to the Responses API in its flat shape', async () => {
  const { requests } = await runTurn(
    [RESPONSES_TOOL_ROUND, RESPONSES_ANSWER_ROUND],
    { apiFormat: 'openai-responses' },
  );
  const tool = (requests[0].body.tools || []).find((entry) => entry.name === 'update_canvas');
  assert.ok(tool, 'this API takes the flat form');
  assert.equal(tool.type, 'function');
  assert.equal(tool.parameters.type, 'object');
  assert.equal(tool.function, undefined, 'the nested form belongs to Chat Completions');
});
