import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const { runTurn } = await importTs(
  path.join(repoRoot, 'features', 'spark', 'src', 'harness', 'runtime', 'agent.ts'),
);
const { createSparkHarnessProfile } = await importTs(
  path.join(repoRoot, 'features', 'spark', 'src', 'harness', 'overlay', 'spark-profile.ts'),
);

const MODEL = { label: 'Test', options: { provider: 'gemini', model: 'test', apiKey: 'k' } };
const PROFILE = { systemPrompt: 'You are a general-purpose work agent.' };

function transport(responses) {
  const conversations = [];
  let turn = 0;
  const value = async (messages, _options, onToken) => {
    conversations.push(messages);
    onToken(responses[turn++] ?? '');
  };
  value.conversations = conversations;
  Object.defineProperty(value, 'turns', { get: () => turn });
  return value;
}

async function run(prompt, responses, startingFiles = {}) {
  let files = { ...startingFiles };
  const events = [];
  const scripted = transport(responses);
  await runTurn({
    prompt,
    history: [],
    files: () => ({ ...files }),
    writeFiles: (next) => { files = { ...next }; },
    model: MODEL,
    profile: PROFILE,
    transport: scripted,
    onEvent: (event) => events.push(event),
  });
  return { files, events, scripted };
}

it('keeps greetings conversational and omits workspace context', async () => {
  const { scripted } = await run('heyy', ['Hey! What can I help you with?']);
  assert.equal(scripted.turns, 1);
  assert.equal(scripted.conversations[0].at(-1).content, '<intent>conversation</intent>\n\nheyy');
});

it('builds Spark from the full Codex prompt while preserving its Work Title', async () => {
  const profile = createSparkHarnessProfile({
    skills: [],
    connectedApps: [],
    mcpTools: [],
  });
  assert.match(profile.systemPrompt, /Before making tool calls, send a brief preamble/i);
  assert.match(profile.systemPrompt, /Sharing progress updates/i);
  assert.match(profile.systemPrompt, /Your final message should read naturally/i);
  assert.match(profile.systemPrompt, /\*\*\* Work Title:/);
  assert.doesNotMatch(profile.systemPrompt, /\*\*\* Work Log:/);
  assert.ok(profile.systemPrompt.length > 18000, `Spark profile was unexpectedly compact: ${profile.systemPrompt.length} chars`);
});

it('keeps Spark workspace calls on the Codex text protocol', async () => {
  let receivedOptions;
  let calls = 0;
  const scripted = async (_messages, options, onToken) => {
    receivedOptions = options;
    if (calls++ === 0) onToken('I will inspect the workspace.\n*** Call: list_files\n{}\n*** End Call\n');
    else onToken('The workspace is empty.');
  };
  await runTurn({
    prompt: 'List the workspace files.',
    history: [],
    files: () => ({}),
    writeFiles: () => {},
    model: MODEL,
    profile: { systemPrompt: createSparkHarnessProfile({ skills: [], connectedApps: [] }).systemPrompt },
    transport: scripted,
    onEvent: () => {},
  });
});

it('does not complete a requested file write after read-only inspection', async () => {
  const { files, events, scripted } = await run(
    'Create a text document file and write down the usefulness of AI',
    [
      `*** Call: read_file\n{"path":"/ai_usefulness.txt"}\n*** End Call\n`,
      'The file already exists, so there is nothing to do.',
      `*** Begin Patch\n*** Update File: /ai_usefulness.txt\n@@\n-old\n+AI is useful for automation, analysis, creativity, and accessibility.\n*** End Patch\n`,
      'The file now contains the requested information.',
    ],
    { '/ai_usefulness.txt': 'old\n' },
  );
  assert.equal(scripted.turns, 4);
  assert.match(files['/ai_usefulness.txt'], /automation/);
  assert.equal(events.at(-1).reason, 'complete');
  assert.match(scripted.conversations[2].at(-1).content, /mutation is not complete/i);
});

it('continues after a successful patch when the patch stream has no closing response', async () => {
  const { files, events, scripted } = await run(
    'Create a note about Spark.',
    [
      `*** Begin Patch\n*** Add File: /spark-note.txt\n+Spark keeps the work timeline separate from the final response.\n*** End Patch\n`,
      'The note was created successfully.',
    ],
  );

  assert.equal(scripted.turns, 2);
  assert.match(files['/spark-note.txt'], /work timeline/);
  assert.equal(events.filter((event) => event.type === 'text').map((event) => event.chunk).join(''), 'The note was created successfully.');
  assert.equal(events.at(-1).reason, 'complete');
});

it('fails honestly when a mutation request never changes a file', async () => {
  const { events } = await run(
    'Write a text file about AI',
    ['I checked it.', 'I still did not write anything.'],
  );
  assert.equal(events.at(-1).reason, 'error');
  assert.match(events.at(-1).error, /did not produce a file change/i);
});

it('executes a provider-native read through the Spark registry', async () => {
  let files = { '/ai_usefulness.txt': 'AI helps with analysis.\n' };
  const events = [];
  let nativeResult;
  const nativeTransport = async (_messages, _options, onToken, _onStart, _system, _onPhase, onToolCall) => {
    nativeResult = await onToolCall('read_file', { path: '/ai_usefulness.txt' });
    onToken('I checked the document.');
  };
  await runTurn({
    prompt: 'Read the AI document and tell me what it says.',
    history: [],
    files: () => ({ ...files }),
    writeFiles: (next) => { files = { ...next }; },
    model: MODEL,
    profile: PROFILE,
    transport: nativeTransport,
    toolDeclarations: [{ functionDeclarations: [{ name: 'read_file', parameters: { type: 'OBJECT' } }] }],
    onEvent: (event) => events.push(event),
  });
  assert.equal(nativeResult.status, 'success');
  assert.ok(events.some((event) => event.type === 'call-start' && event.call.kind === 'read'));
  assert.equal(events.at(-1).reason, 'complete');
});

it('surfaces native Google Search and code execution as Spark timeline tools', async () => {
  const events = [];
  let receivedOptions;
  const nativeTransport = async (_messages, options, onToken) => {
    receivedOptions = options;
    options.onToolCallStart?.('web_search', { query: 'latest Willow news' });
    options.onToolCallStart?.('code_execution', { language: 'python', code: 'print(1)' });
    onToken('I finished the researched calculation.');
  };
  await runTurn({
    prompt: 'Research the latest information and calculate the result.',
    history: [],
    files: () => ({}),
    writeFiles: () => {},
    model: {
      label: 'Test',
      options: {
        provider: 'gemini',
        model: 'test',
        apiKey: 'k',
        enableSearch: true,
        enableCodeExecution: true,
      },
    },
    profile: PROFILE,
    transport: nativeTransport,
    onEvent: (event) => events.push(event),
  });
  assert.equal(receivedOptions.enableSearch, true);
  assert.equal(receivedOptions.enableCodeExecution, true);
  assert.ok(events.some((event) => event.type === 'call-start' && event.call.kind === 'web_search'));
  assert.ok(events.some((event) => event.type === 'call-start' && event.call.kind === 'code_execution'));
  assert.equal(events.some((event) => event.type === 'work-log'), false);
});

it('deduplicates a repeated Interactions search delta without hiding a second search', async () => {
  const chat = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'chat.ts'));
  const priorFetch = globalThis.fetch;
  const events = [];
  const sse = [
    'event: step.start\n',
    'data: {"event_type":"step.start","index":4,"step":{"id":"search-4","type":"google_search_call"}}\n\n',
    'event: step.delta\n',
    'data: {"event_type":"step.delta","index":4,"step":{"id":"search-4","type":"google_search_call"},"delta":{"type":"google_search_call","arguments":{"queries":["same query"]}}}\n\n',
    'event: step.delta\n',
    'data: {"event_type":"step.delta","index":5,"step":{"id":"search-5","type":"google_search_call"},"delta":{"type":"google_search_call","arguments":{"queries":["same query"]}}}\n\n',
    'event: step.delta\n',
    'data: {"event_type":"step.delta","index":4,"step":{"id":"search-4","type":"google_search_call"},"delta":{"type":"google_search_call","arguments":{"queries":["same query"]}}}\n\n',
    'event: interaction.complete\n',
    'data: {"event_type":"interaction.complete","interaction":{"id":"i-1","status":"completed"}}\n\n',
  ].join('');
  globalThis.fetch = async () => new Response(sse, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
  try {
    await chat.streamChat(
      [{ role: 'user', content: 'search' }],
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'test-key',
        enableSearch: true,
        baseUrl: 'https://generativelanguage.googleapis.com',
        onToolCallStart: (name, args) => events.push({ name, args }),
      },
      () => {},
      () => {},
    );
  } finally {
    globalThis.fetch = priorFetch;
  }
  assert.equal(events.filter((event) => event.name === 'web_search').length, 2);
});

it('uses ordinary Codex-style preamble prose as work narration and never exposes provider thoughts', async () => {
  const events = [];
  let turn = 0;
  const scripted = async (_messages, _options, onToken, _onStart, _system, _onPhase, _onToolCall, onThought) => {
    if (turn++ === 0) {
      onThought('private provider reasoning');
      onToken(`I will update the workspace now.\n\n*** Begin Patch\n*** Add File: /workspace/note.txt\n+done\n*** End Patch\n\nI created the workspace note.`);
      return;
    }
    onToken('I found the workspace contents.');
  };
  await runTurn({
    prompt: 'Inspect the workspace.',
    history: [],
    files: () => ({}),
    writeFiles: () => {},
    model: MODEL,
    profile: PROFILE,
    transport: scripted,
    onEvent: (event) => events.push(event),
  });
  const workIndex = events.findIndex((event) => event.type === 'work-log');
  const callIndex = events.findIndex((event) => event.type === 'call-start');
  assert.ok(workIndex >= 0);
  assert.ok(callIndex > workIndex);
  assert.match(events[workIndex].text, /update the workspace/i);
  assert.equal(events.some((event) => event.type === 'thought'), false);
  const progress = events.filter((event) => event.type === 'work-log').map((event) => event.text);
  assert.deepEqual(progress, ['I will update the workspace now.']);
  assert.equal(events.filter((event) => event.type === 'text').some((event) => /update the workspace/i.test(event.chunk)), false);
  assert.equal(events.filter((event) => event.type === 'text').some((event) => /created the workspace note/i.test(event.chunk)), true);
});

it('does not fabricate status lines for a narration-free tool batch', async () => {
  const { events } = await run('Inspect both workspace files.', [
    `*** Call: read_file\n{"path":"/one.txt"}\n*** End Call\n*** Call: read_file\n{"path":"/two.txt"}\n*** End Call`,
    'I checked both files.',
  ], { '/one.txt': 'one\n', '/two.txt': 'two\n' });
  const ordered = events
    .filter((event) => event.type === 'work-log' || event.type === 'call-start')
    .map((event) => event.type === 'work-log' ? `line:${event.text}` : `tool:${event.call.kind}`);
  assert.deepEqual(ordered, ['tool:read', 'tool:read']);
});

it('emits one stable work heading as metadata, separate from the timeline', async () => {
  const { events } = await run('Update the workspace note.', [
    `*** Work Title: Updating the workspace note\nI am checking the file first.\n*** Call: read_file\n{"path":"/note.txt"}\n*** End Call\n`,
    `*** Work Title: This must not replace the heading\nI found the note.`,
  ], { '/note.txt': 'existing\n' });

  assert.deepEqual(events.filter((event) => event.type === 'work-title').map((event) => event.title), [
    'Updating the workspace note',
  ]);
  assert.equal(events.filter((event) => event.type === 'text').some((event) => event.chunk.includes('Work Title')), false);
  assert.ok(events.findIndex((event) => event.type === 'work-title') < events.findIndex((event) => event.type === 'work-log'));
});

it('derives a fallback work heading when the model omits metadata', async () => {
  const { events } = await run('Create a short note about Spark.', [
    `I am creating the note now.\n*** Begin Patch\n*** Add File: /spark-note.txt\n+Spark keeps work headings separate from progress rows.\n*** End Patch\n`,
  ]);

  assert.equal(events.filter((event) => event.type === 'work-title').length, 1);
  assert.match(events.find((event) => event.type === 'work-title').title, /Create a short note about Spark/i);
});
