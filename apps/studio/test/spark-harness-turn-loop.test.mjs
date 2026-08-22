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
const { createSparkCapabilityTools } = await importTs(
  path.join(repoRoot, 'features', 'spark', 'src', 'harness', 'spark-tools.ts'),
);
const { SparkGoalRuntime } = await importTs(
  path.join(repoRoot, 'features', 'spark', 'src', 'harness', 'runtime', 'goal.ts'),
);
const { resolveEffort, supportedEfforts } = await importTs(
  path.join(repoRoot, 'features', 'spark', 'src', 'harness', 'overlay', 'effort.ts'),
);
const { runSparkHarnessTurn } = await importTs(
  path.join(repoRoot, 'features', 'spark', 'src', 'harness', 'spark-harness.ts'),
);

const MODEL = { label: 'Test', options: { provider: 'gemini', model: 'test', apiKey: 'k' } };
const PROFILE = { systemPrompt: 'You are a general-purpose work agent.' };
const AGENTIC_PROFILE = createSparkHarnessProfile({ skills: [], connectedApps: [] });

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

async function run(prompt, responses, startingFiles = {}, profile = PROFILE) {
  let files = { ...startingFiles };
  const events = [];
  const scripted = transport(responses);
  await runTurn({
    prompt,
    history: [],
    files: () => ({ ...files }),
    writeFiles: (next) => { files = { ...next }; },
    model: MODEL,
    profile,
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
  assert.match(profile.systemPrompt, /\*\*\* Final Response/);
  assert.match(profile.systemPrompt, /as many consecutive, distinct updates/i);
  assert.match(profile.systemPrompt, /no fixed count/i);
  assert.match(profile.systemPrompt, /no required placement immediately before or after/i);
  assert.match(profile.systemPrompt, /distinct\s+update on its own line/i);
  assert.match(profile.systemPrompt, /verification or outcome updates/i);
  assert.match(profile.systemPrompt, /timeline updates as plain text/i);
  assert.match(profile.systemPrompt, /never alter a user's requested file contents/i);
  assert.match(profile.systemPrompt, /spawn_agent/);
  assert.match(profile.systemPrompt, /wait_agent/);
  assert.doesNotMatch(profile.systemPrompt, /Multiple consecutive `task` envelopes are started concurrently/i);
  assert.doesNotMatch(profile.systemPrompt, /available concurrency slots|up to \d+ at once|spawning their own sub-agents/i);
  assert.doesNotMatch(profile.systemPrompt, /\*\*\* Work Log:/);
  assert.ok(profile.systemPrompt.length > 18000, `Spark profile was unexpectedly compact: ${profile.systemPrompt.length} chars`);
});

it('dispatches sub-agents without blocking the parent and keeps wait_agent silent', async () => {
  const events = [];
  let releaseChildren;
  const childrenReleased = new Promise((resolve) => { releaseChildren = resolve; });
  let rootFinished = false;
  let childCalls = 0;
  const scripted = async (messages, _options, onToken, _onStart, _system, _onPhase, onToolCall) => {
    if (messages.at(-1)?.content.includes('Task name:')) {
      childCalls += 1;
      await childrenReleased;
      onToken(`Child ${childCalls} complete.`);
      return;
    }
    onToken('Parent is coordinating.');
    await onToolCall('spawn_agent', { task_name: 'alpha', message: 'Inspect alpha.', agent_type: 'researcher' });
    await onToolCall('spawn_agent', { task_name: 'beta', message: 'Inspect beta.', agent_type: 'researcher' });
    await onToolCall('wait_agent', { timeout_ms: 10 });
    onToken('Both sub-agents were started.');
  };

  const turn = runTurn({
    prompt: 'Use two sub-agents to inspect alpha and beta.',
    history: [],
    files: () => ({}),
    writeFiles: () => {},
    model: MODEL,
    profile: PROFILE,
    transport: scripted,
    onEvent: (event) => {
      events.push(event);
      if (event.type === 'turn-end') rootFinished = true;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(rootFinished, false);
  assert.equal(childCalls, 2);
  assert.equal(events.filter((event) => event.type === 'agents-start').length, 2);
  assert.equal(events.filter((event) => event.type === 'agents-start').every((event) => event.agents[0].status === 'running'), true);
  assert.equal(events.some((event) => event.type === 'activity' && /waiting for sub-agents/i.test(event.label ?? '')), false);
  assert.equal(events.some((event) => event.type === 'work-log' && /parent is coordinating/i.test(event.text)), true);
  releaseChildren();
  await turn;
  assert.equal(rootFinished, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(events.filter((event) => event.type === 'agent-progress' && event.patch.status === 'success').length, 2);
});

it('allows a final response while children are active', async () => {
  const events = [];
  let releaseFirstBatch;
  const firstBatchReleased = new Promise((resolve) => { releaseFirstBatch = resolve; });
  let rootTurn = 0;
  let childCalls = 0;
  const scripted = async (messages, _options, onToken, _onStart, _system, _onPhase, onToolCall) => {
    if (messages.at(-1)?.content.includes('Task name:')) {
      childCalls += 1;
      if (childCalls <= 2) await firstBatchReleased;
      onToken(`Child ${childCalls} complete.`);
      return;
    }
    rootTurn += 1;
    if (rootTurn === 1) {
      await onToolCall('spawn_agent', { task_name: 'first_a', message: 'First A.' });
      await onToolCall('spawn_agent', { task_name: 'first_b', message: 'First B.' });
      onToken('*** Final Response\nThis must wait.');
      return;
    }
    await onToolCall('wait_agent', { timeout_ms: 60000 });
    onToken('*** Final Response\nSecond round complete.');
  };

  const turn = runTurn({
    prompt: 'Use two collaboration batches.',
    history: [],
    files: () => ({}),
    writeFiles: () => {},
    model: MODEL,
    profile: { systemPrompt: 'You are a general-purpose work agent. *** Final Response' },
    transport: scripted,
    onEvent: (event) => events.push(event),
  });
  setTimeout(releaseFirstBatch, 0);
  await turn;

  assert.equal(rootTurn, 1);
  assert.equal(events.filter((event) => event.type === 'agents-start').length, 2);
  assert.equal(childCalls, 2);
  assert.equal(events.some((event) => event.type === 'text' && /This must wait/i.test(event.chunk)), true);
});

it('does not impose a Spark-specific ceiling on one parallel agent batch', async () => {
  const events = [];
  let childCalls = 0;
  const scripted = async (messages, _options, onToken, _onStart, _system, _onPhase, onToolCall) => {
    if (messages.at(-1)?.content.includes('Task name:')) {
      childCalls += 1;
      onToken('Child complete.');
      return;
    }
    for (let index = 0; index < 6; index += 1) {
      await onToolCall('spawn_agent', { task_name: `worker_${index}`, message: `Worker ${index}.` });
    }
    onToken('Batch dispatched.');
  };

  await runTurn({
    prompt: 'Dispatch the independent workers.',
    history: [],
    files: () => ({}),
    writeFiles: () => {},
    model: MODEL,
    profile: PROFILE,
    transport: scripted,
    onEvent: (event) => events.push(event),
  });

  assert.equal(events.filter((event) => event.type === 'agents-start').length, 6);
  assert.equal(childCalls, 6);
});

it('gives child agents the native collaboration declarations for nested delegation', async () => {
  let childDeclarations = [];
  const scripted = async (messages, options, onToken, _onStart, _system, _onPhase, onToolCall) => {
    if (messages.at(-1)?.content.includes('Task name:')) {
      childDeclarations = (options.toolDeclarations ?? [])
        .flatMap((group) => group.functionDeclarations ?? [])
        .map((declaration) => declaration.name);
      onToken('Child complete.');
      return;
    }
    await onToolCall('spawn_agent', { task_name: 'parent', message: 'Delegate if useful.' });
    onToken('Parent started.');
  };

  await runTurn({
    prompt: 'Use a sub-agent that may delegate further.',
    history: [],
    files: () => ({}),
    writeFiles: () => {},
    model: MODEL,
    profile: PROFILE,
    transport: scripted,
    onEvent: () => {},
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(childDeclarations.includes('spawn_agent'));
  assert.ok(childDeclarations.includes('send_message'));
  assert.ok(childDeclarations.includes('wait_agent'));
});

it('reuses a sub-agent identity and conversation on a later Spark turn', async () => {
  const events = [];
  let childRuns = 0;
  let followupSawPriorAnswer = false;
  const scripted = async (messages, _options, onToken, _onStart, _system, _onPhase, onToolCall) => {
    if (messages.at(-1)?.content.includes('Task name:')) {
      childRuns += 1;
      if (childRuns === 2) {
        followupSawPriorAnswer = messages.some((message) => message.content.includes('Initial child answer'));
      }
      onToken(childRuns === 1 ? 'Initial child answer.' : 'Follow-up child answer.');
      return;
    }
    const latest = messages.at(-1)?.content ?? '';
    if (latest.includes('Start the worker')) {
      await onToolCall('spawn_agent', { task_name: 'worker', message: 'Do the first pass.', fork_turns: 'none' });
      onToken('Worker started.');
      return;
    }
    await onToolCall('followup_task', { target: '/root/worker', message: 'Do the second pass.' });
    onToken('Worker follow-up started.');
  };
  const common = {
    history: [],
    files: () => ({}),
    writeFiles: () => {},
    model: MODEL,
    profile: PROFILE,
    transport: scripted,
    collaborationThreadId: 'persistent-collaboration-test',
    onEvent: (event) => events.push(event),
  };
  await runTurn({ ...common, prompt: 'Start the worker.' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await runTurn({ ...common, prompt: 'Continue the worker.' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(events.filter((event) => event.type === 'agents-start').length, 1);
  assert.equal(childRuns, 2);
  assert.equal(followupSawPriorAnswer, true);
  const terminal = events.filter((event) => event.type === 'agent-progress' && event.patch.status === 'success');
  assert.equal(new Set(terminal.map((event) => event.id)).size, 1);
});

it('preserves native Goal lifecycle and Ultra mode semantics', async () => {
  let current = null;
  const runtime = new SparkGoalRuntime('spark-thread', null, (goal) => { current = goal; });
  const tools = Object.fromEntries(runtime.tools().map((tool) => [tool.id, tool]));
  const created = await tools.create_goal.run({ objective: 'Finish the research task', token_budget: 100 }, {});
  assert.match(created.observation, /Finish the research task/);
  assert.equal(current.status, 'active');
  const fetched = await tools.get_goal.run({}, {});
  assert.match(fetched.observation, /"status":"active"/);
  const blocked = await tools.update_goal.run({ status: 'blocked' }, {});
  assert.match(blocked.observation, /"status":"blocked"/);
  const rejected = await tools.create_goal.run({ objective: 'A replacement goal' }, {});
  assert.equal(rejected.failed, true);
  await tools.update_goal.run({ status: 'complete' }, {});
  const replacement = await tools.create_goal.run({ objective: 'A replacement goal' }, {});
  assert.equal(replacement.failed, undefined);

  const ultra = resolveEffort('ultra', { providerId: 'gemini', modelId: 'gemini-3-pro' });
  assert.equal(ultra.effective, 'high');
  assert.equal(ultra.clamped, false);
  assert.equal(ultra.harness.delegation, 'proactive');
  assert.equal(typeof current.goalId, 'string');
});

it('accounts Goal provider usage and transitions at the token budget', async () => {
  let current = null;
  const runtime = new SparkGoalRuntime('usage-thread', null, (goal) => { current = goal; });
  const tools = Object.fromEntries(runtime.tools().map((tool) => [tool.id, tool]));
  await tools.create_goal.run({ objective: 'Use the budget', token_budget: 10 }, {});
  runtime.beginTurn();
  runtime.accountProgress(6);
  assert.equal(current.tokensUsed, 6);
  runtime.accountProgress(4);
  assert.equal(current.tokensUsed, 10);
  assert.equal(current.status, 'budget_limited');
  const replacement = await tools.create_goal.run({ objective: 'Replacement' }, {});
  assert.equal(replacement.failed, true);
});

it('routes transport-reported usage into the active Spark Goal', async () => {
  let current = null;
  const runtime = new SparkGoalRuntime('transport-usage-thread', null, (goal) => { current = goal; });
  const tools = Object.fromEntries(runtime.tools().map((tool) => [tool.id, tool]));
  await tools.create_goal.run({ objective: 'Count provider usage' }, {});

  const transportWithUsage = async (...args) => {
    const onToken = args[2];
    const onUsage = args[8];
    onUsage({ inputTokens: 7, outputTokens: 5, totalTokens: 12 });
    onToken('Usage accounted.');
  };

  await runTurn({
    prompt: 'Continue counting usage.',
    history: [],
    files: () => ({}),
    writeFiles: () => {},
    model: MODEL,
    profile: PROFILE,
    goalRuntime: runtime,
    transport: transportWithUsage,
    onEvent: () => {},
  });

  assert.equal(current.tokensUsed, 12);
  assert.equal(current.status, 'active');
});

it('marks an active Goal blocked on a terminal Spark turn error', async () => {
  let current = null;
  const runtime = new SparkGoalRuntime('error-thread', null, (goal) => { current = goal; });
  const tools = Object.fromEntries(runtime.tools().map((tool) => [tool.id, tool]));
  await tools.create_goal.run({ objective: 'Survive a failure' }, {});
  const scripted = async () => { throw new Error('provider failed permanently'); };
  await runTurn({
    prompt: 'Continue the goal.',
    history: [],
    files: () => ({}),
    writeFiles: () => {},
    model: MODEL,
    profile: PROFILE,
    goalRuntime: runtime,
    transport: scripted,
    onEvent: () => {},
  });
  assert.equal(current.status, 'blocked');
});

it('uses each model declared effort roster before provider defaults', () => {
  const futureGemini = {
    providerId: 'gemini',
    modelId: 'gemini-3.5-pro',
    reasoningEfforts: [
      { level: 1, label: 'Low', value: 'low' },
      { level: 2, label: 'Medium', value: 'medium' },
      { level: 3, label: 'High', value: 'high' },
      { level: 4, label: 'Extra High', value: 'xhigh' },
    ],
  };
  assert.deepEqual(supportedEfforts(futureGemini), ['low', 'medium', 'high', 'xhigh']);
  const ultra = resolveEffort('ultra', futureGemini);
  assert.equal(ultra.effective, 'xhigh');
  assert.equal(ultra.level, 4);
  assert.equal(ultra.harness.delegation, 'proactive');

  const compactModel = {
    providerId: 'gemini',
    modelId: 'gemini-compact',
    reasoningEfforts: [
      { level: 1, label: 'Low', value: 'low' },
      { level: 2, label: 'Medium', value: 'medium' },
    ],
  };
  assert.equal(resolveEffort('ultra', compactModel).effective, 'medium');
});

it('continues an active Goal automatically and stops after completion', async () => {
  const prompts = [];
  const goals = [];
  let calls = 0;
  const scripted = async (messages, _options, onToken, _onStart, _system, _onPhase, onToolCall) => {
    prompts.push(messages.at(-1)?.content ?? '');
    if (calls++ === 0) {
      await onToolCall('create_goal', { objective: 'Finish the goal autonomously' });
      onToken('I started the goal.');
      return;
    }
    await onToolCall('update_goal', { status: 'complete' });
    onToken('The goal is complete.');
  };
  const result = await runSparkHarnessTurn({
    prompt: 'Create a goal to finish the work autonomously.',
    model: { ...MODEL.options, label: MODEL.label },
    scope: 'goal-test-scope',
    threadId: 'goal-test-thread',
    capabilities: { skills: [], connectedApps: [] },
    workspace: {
      readFiles: async () => ({}),
      writeFiles: async () => {},
    },
    transport: scripted,
    onGoalChange: (goal) => goals.push(goal),
    onEvent: () => {},
  });

  assert.equal(calls, 2);
  assert.match(prompts[1], /Continue working toward the active thread goal/);
  assert.equal(goals.at(-1).status, 'complete');
  assert.match(result.response, /goal is complete/i);
});

it('requires an explicit skill call and reports only the skill actually used', async () => {
  const used = [];
  const tools = createSparkCapabilityTools({
    skills: [{ name: 'Document polish', instructions: 'Use concise headings and clean spacing.' }],
    connectedApps: [],
    onCapability: (capability) => used.push(capability),
  });
  const skill = tools.find((tool) => tool.id === 'use_skill');
  assert.ok(skill);

  const result = await skill.run({ skill: 'Document polish' }, {});
  assert.equal(result.failed, undefined);
  assert.match(result.observation, /Use concise headings and clean spacing/);
  assert.deepEqual(used, ['skill:Document polish']);

  const profile = createSparkHarnessProfile({
    skills: [{ name: 'Document polish', instructions: 'Use concise headings and clean spacing.' }],
    connectedApps: [],
  });
  assert.match(profile.systemPrompt, /call `use_skill` with \{"skill":"Document polish"\} before applying it/);
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

it('emits created files as generated artifacts owned by the current Spark run', async () => {
  const { events } = await run(
    'Create a note about Spark.',
    [
      `*** Begin Patch\n*** Add File: /spark-output.txt\n+Spark created this file.\n*** End Patch\n`,
      'The note is ready.',
    ],
  );

  const generated = events.filter((event) => event.type === 'generated-file');
  assert.equal(generated.length, 1);
  assert.equal(generated[0].file.name, 'spark-output.txt');
  assert.equal(generated[0].file.path, '/spark-output.txt');
  assert.equal(generated[0].file.mimeType, 'text/plain');
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
    onToken('I found the sources and completed the calculation.\n*** Final Response\nI finished the researched calculation.');
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
    profile: AGENTIC_PROFILE,
    transport: nativeTransport,
    onEvent: (event) => events.push(event),
  });
  assert.equal(receivedOptions.enableSearch, true);
  assert.equal(receivedOptions.enableCodeExecution, true);
  assert.ok(events.some((event) => event.type === 'call-start' && event.call.kind === 'web_search'));
  assert.ok(events.some((event) => event.type === 'call-start' && event.call.kind === 'code_execution'));
  assert.deepEqual(events.filter((event) => event.type === 'work-log').map((event) => event.text), [
    'I found the sources and completed the calculation.',
  ]);
  assert.equal(events.filter((event) => event.type === 'text').map((event) => event.chunk).join(''), 'I finished the researched calculation.');
});

it('treats substantive tool-free questions as optional Spark work batches', async () => {
  const { events, scripted } = await run('Compare two practical approaches for organizing notes.', [
    '*** Work Title: Comparing note organization approaches\nI am weighing retrieval speed against maintenance effort.\n*** Final Response\nFolders are simpler; tags are more flexible.',
  ], {}, AGENTIC_PROFILE);

  assert.match(scripted.conversations[0].at(-1).content, /^<intent>execution<\/intent>/);
  assert.deepEqual(events.filter((event) => event.type === 'work-log').map((event) => event.text), [
    'I am weighing retrieval speed against maintenance effort.',
  ]);
  assert.equal(events.filter((event) => event.type === 'text').map((event) => event.chunk).join(''), 'Folders are simpler; tags are more flexible.');
});

it('keeps all pre-final prose in the timeline across multiple tool calls', async () => {
  const { events } = await run('Inspect both notes and summarize them.', [
    '*** Work Title: Reviewing both notes\nI will inspect the first note.\n*** Call: read_file\n{"path":"/one.txt"}\n*** End Call',
    'The first note establishes the baseline. I will inspect the second note.\n*** Call: read_file\n{"path":"/two.txt"}\n*** End Call',
    'The second note adds the missing detail.\n*** Final Response\nTogether, the notes describe one complete process.',
  ], { '/one.txt': 'baseline\n', '/two.txt': 'detail\n' }, AGENTIC_PROFILE);

  assert.deepEqual(events.filter((event) => event.type === 'work-log').map((event) => event.text), [
    'I will inspect the first note.',
    'The first note establishes the baseline. I will inspect the second note.',
    'The second note adds the missing detail.',
  ]);
  assert.equal(events.filter((event) => event.type === 'text').map((event) => event.chunk).join(''), 'Together, the notes describe one complete process.');
});

it('recovers once when a model ignores the final-response marker', async () => {
  const { events, scripted } = await run('Explain a practical note-taking tradeoff.', [
    '*** Work Title: Weighing note-taking tradeoffs\nI am comparing structure with retrieval flexibility.',
    'Folders are easier to maintain, while tags make cross-cutting retrieval faster.',
  ], {}, AGENTIC_PROFILE);

  assert.equal(scripted.turns, 2);
  assert.match(scripted.conversations[1].at(-1).content, /Final Response/);
  assert.equal(events.filter((event) => event.type === 'text').map((event) => event.chunk).join(''), 'Folders are easier to maintain, while tags make cross-cutting retrieval faster.');
});

it('never executes another call after the final-response boundary', async () => {
  const { events } = await run('Research a practical note-taking approach.', [
    '*** Work Title: Researching note-taking approaches\nI compared the available approaches.\n*** Final Response\nUse folders for stable categories.\n*** Call: list_files\n{}\n*** End Call',
  ], {}, AGENTIC_PROFILE);

  assert.equal(events.some((event) => event.type === 'call-start'), false);
  assert.equal(events.filter((event) => event.type === 'text').map((event) => event.chunk).join('').trim(), 'Use folders for stable categories.');
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
