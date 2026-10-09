/**
 * The Code harness's turn loop, driven by a scripted model.
 *
 * The transport is the only thing replaced: each test hands the loop the
 * replies a model would stream (in small chunks, as providers do) and asserts
 * on what landed in the working copy, what the transcript recorded, and what
 * the model was told next. The checker that builds and runs the project is a
 * stand-in too, so a test can make the app "fail" on demand.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (file) => path.join(repoRoot, 'features', 'code', 'src', 'harness', file);
const { runTurn } = await importTs(harness('turn.ts'));
const { compactHistory, buildProjectSnapshot, recentlyChangedPaths } = await importTs(harness('context.ts'));
const { latestThoughtHeading } = await importTs(path.join(repoRoot, 'features', 'chat', 'src', 'thought-summary.ts'));

const MODEL = { label: 'Test', options: { provider: 'gemini', model: 'test', apiKey: 'k' } };

function scripted(replies, { chunk = 3, failures = [] } = {}) {
  const rounds = [];
  let calls = 0;
  const transport = async (messages, options, onToken, _onStart, systemPrompt) => {
    calls += 1;
    const failure = failures.shift();
    if (failure) throw failure;
    rounds.push({ messages: messages.map((message) => ({ ...message })), systemPrompt, options });
    const body = typeof replies[rounds.length - 1] === 'function'
      ? replies[rounds.length - 1](rounds.length - 1, options)
      : (replies[rounds.length - 1] ?? '');
    for (let i = 0; i < body.length; i += chunk) {
      if (options.signal?.aborted) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      onToken(body.slice(i, i + chunk));
    }
  };
  transport.rounds = rounds;
  transport.calls = () => calls;
  return transport;
}

const ok = () => ({ buildErrors: [], runtimeErrors: [], warnings: [], console: [], durationMs: 1, outline: 'rendered' });
const lastUser = (transport, round) => transport.rounds[round].messages.at(-1).content;

const turn = (overrides) => runTurn({ prompt: 'build it', history: [], files: {}, mode: 'build', model: MODEL, ...overrides });

it('applies actions as they stream, runs tools, and feeds results back', async () => {
  const transport = scripted([
    `I'll build a counter.
<willow-write path="/App.tsx">
import Counter from './components/Counter';
export default function App() { return <main className="min-h-screen bg-white"><Counter /></main>; }
</willow-write>
<willow-write path="src/components/Counter.tsx">
export default function Counter() { return <button>0</button>; }
</willow-write>
<willow-dependency name="lucide-react" version="^0.460.0" />
<willow-tool name="read_file">{"path": "/App.tsx"}</willow-tool>`,
    'All done — a counter.',
  ]);
  const result = await turn({ transport, checker: async () => ok() });

  assert.equal(result.reason, 'finished');
  assert.deepEqual(Object.keys(result.workspace.files).sort(), ['/App.tsx', '/components/Counter.tsx', '/package.json']);
  assert.match(result.workspace.read('/package.json'), /"lucide-react": "\^0\.460\.0"/);
  assert.match(lastUser(transport, 1), /<tool_result name="read_file">/);
  assert.match(lastUser(transport, 1), /Applied: created \/App\.tsx/);
  assert.deepEqual(
    result.steps.filter((step) => step.kind !== 'text').map((step) => `${step.kind}:${step.status}`),
    ['file:done', 'file:done', 'dependency:done', 'read:done', 'check:done'],
  );
  assert.equal(result.text, "I'll build a counter.\n\nAll done — a counter.");
  assert.deepEqual(result.changedPaths, ['/App.tsx', '/components/Counter.tsx', '/package.json']);
});

it('adds up the thinking of every round, and leaves out writing, tools and checks', async () => {
  let now = 0;
  const replies = [
    'Looking first.\n<willow-tool name="read_file">{"path": "/App.tsx"}</willow-tool>',
    '<willow-write path="/App.tsx">\nexport default () => null;\n</willow-write>',
  ];
  const thinkFor = [3_000, 2_000];
  let round = 0;
  const transport = async (_messages, _options, onToken) => {
    now += thinkFor[round];
    const body = replies[round];
    round += 1;
    onToken(body.slice(0, 4));
    now += 10_000;
    onToken(body.slice(4));
  };
  const result = await turn({
    transport,
    clock: () => now,
    files: { '/App.tsx': 'export default () => 1;\n' },
    checker: async () => {
      now += 4_000;
      return ok();
    },
  });

  assert.equal(result.reason, 'finished');
  assert.equal(round, 2);
  assert.equal(result.thinkingMs, 5_000);
});

it('passes the thoughts to the live state alone, a paragraph per round', async () => {
  const thoughts = [
    ['**Planning the counter**\nI will read the file', ' first.'],
    ['**Fixing the import**\nThe path was wrong.'],
  ];
  const replies = ['<willow-tool name="read_file">{"path": "/App.tsx"}</willow-tool>', 'Done.'];
  let round = 0;
  const transport = async (_messages, _options, onToken, _onStart, _systemPrompt, _onPhase, _onToolCall, onThought) => {
    for (const thought of thoughts[round]) onThought(thought);
    onToken(replies[round]);
    round += 1;
  };
  const states = [];
  const result = await turn({ transport, files: { '/App.tsx': 'export default () => 1;\n' }, onUpdate: (state) => states.push(state) });

  const last = states.at(-1);
  assert.equal(last.thoughts, '**Planning the counter**\nI will read the file first.\n\n**Fixing the import**\nThe path was wrong.');
  assert.equal(latestThoughtHeading(last.thoughts), 'Fixing the import', "each round's heading stays on its own line");
  assert.equal(result.text, 'Done.');
});

it('keeps only the newest thoughts, cut at a line', async () => {
  const filler = Array.from({ length: 400 }, (_, index) => `Line ${index} of a long stretch of reasoning that keeps going.`).join('\n');
  const transport = async (_messages, _options, onToken, _onStart, _systemPrompt, _onPhase, _onToolCall, onThought) => {
    onThought(`**Older heading**\n${filler}\n`);
    onThought('**Newest heading**\nAlmost there.');
    onToken('Done.');
  };
  const states = [];
  await turn({ transport, onUpdate: (state) => states.push(state) });

  const { thoughts } = states.at(-1);
  assert.ok(thoughts.length <= 16_000, `kept ${thoughts.length} characters`);
  assert.match(thoughts, /^Line \d+ of/);
  assert.equal(latestThoughtHeading(thoughts), 'Newest heading');
});

it('tells the model which tool the user picked', async () => {
  const transport = scripted(['On it.']);
  await turn({ transport, selectedTool: 'test' });
  assert.match(lastUser(transport, 0), /The user picked the Test tool for this message\. Test the app in the live preview with `computer`/);

  const planned = scripted(['A plan.']);
  await turn({ transport: planned, mode: 'plan', selectedTool: 'plan' });
  assert.doesNotMatch(lastUser(planned, 0), /picked the Plan tool/, 'Plan mode does that job');
});

it('makes the model read the app-testing skill before computer use, then shows it the screen', async () => {
  const { makeBrowserTools } = await importTs(harness('browser/browser-tools.ts'));
  const preview = {
    lastScan: null,
    scale: 1,
    prepare: async () => null,
    beginVisuals() {},
    idleVisuals() {},
    observe: async () => ({
      text: 'Screen: 1280×800 screenshot.\nOn screen (numbers for "ref", coordinates in screenshot pixels):\n[1] button "Add task" at 640,120',
      shot: { mimeType: 'image/jpeg', data: 'SHOT' },
    }),
  };
  const transport = scripted([
    '<willow-tool name="computer">{"action": "screenshot"}</willow-tool>',
    '<willow-tool name="read_skill">{"name": "skill://app-testing"}</willow-tool>\n<willow-tool name="computer">{"action": "screenshot"}</willow-tool>',
    'Works: adding a task.',
  ]);
  const result = await turn({ transport, extraTools: makeBrowserTools(preview), files: { '/App.tsx': 'export default () => null;\n' } });

  assert.match(transport.rounds[0].systemPrompt, /# The live preview/);
  assert.match(transport.rounds[0].systemPrompt, /- App testing: How to test the app in the preview with the computer tool \(skill:\/\/app-testing\)/);
  assert.match(lastUser(transport, 1), /Read the app-testing skill before using the computer/);
  const third = transport.rounds[2].messages.at(-1);
  assert.match(third.content, /<skill name="App testing" file="SKILL\.md">/);
  assert.match(third.content, /\[1\] button "Add task" at 640,120/);
  assert.deepEqual(third.attachments.map((attachment) => [attachment.data, attachment.fromTool]), [['SHOT', true]]);
  assert.deepEqual(result.steps.filter((step) => step.kind === 'computer').map((step) => `${step.action}:${step.status}`), ['screenshot:done']);
});

it('keeps only the newest screenshots in the conversation, and every picture the user attached', async () => {
  let taken = 0;
  const camera = {
    name: 'camera',
    description: 'Takes a picture.',
    signature: '{}',
    readOnly: true,
    source: 'builtin',
    startStep: () => null,
    run: async () => {
      taken += 1;
      return { output: `picture ${taken}`, images: [{ mimeType: 'image/jpeg', data: `IMG${taken}` }] };
    },
  };
  const call = '<willow-tool name="camera">{}</willow-tool>';
  const transport = scripted([call, call, call, 'Done.']);
  await turn({
    transport,
    extraTools: [camera],
    attachments: [{ type: 'image', mimeType: 'image/png', data: 'USER', name: 'sketch.png' }],
  });

  const messages = transport.rounds[3].messages;
  assert.deepEqual(messages.flatMap((message) => message.attachments ?? []).map((attachment) => attachment.data), ['USER', 'IMG2', 'IMG3']);
  assert.match(messages.find((message) => message.content.includes('picture 1')).content, /The screenshot from this step was removed to save space/);
});

it('stops on a proposed plan and waits for the go-ahead', async () => {
  const transport = scripted([
    'This is a big one, so here is the plan first:\n1. Layout\n2. Data model\n<willow-tool name="propose_plan">{}</willow-tool>',
    'This round should never be requested.',
  ]);
  const result = await turn({ transport, checker: async () => ok() });
  assert.equal(transport.calls(), 1);
  assert.equal(result.reason, 'finished');
  assert.equal(result.awaitingApproval, true);
  assert.match(result.text, /here is the plan first/);
});

it('answers a check after changes with the automatic check, not another round', async () => {
  const transport = scripted([
    '<willow-write path="/App.tsx">\nexport default () => <h1>Hi</h1>;\n</willow-write>\nBuilt it.\n<willow-tool name="check_project">{}</willow-tool>',
    'This round should never be requested.',
  ]);
  let checks = 0;
  const result = await turn({ transport, checker: async () => { checks += 1; return ok(); } });

  assert.equal(result.reason, 'finished');
  assert.equal(transport.calls(), 1);
  assert.equal(checks, 1);
  assert.deepEqual(result.steps.filter((step) => step.kind === 'check').map((step) => step.automatic), [true]);
});

it('still runs a check the model asks for before it changes anything', async () => {
  const transport = scripted([
    '<willow-tool name="check_project">{}</willow-tool>',
    'The app renders fine; nothing to fix.',
  ]);
  const result = await turn({ transport, files: { '/App.tsx': 'export default () => null;\n' }, checker: async () => ok() });

  assert.equal(transport.calls(), 2);
  assert.match(lastUser(transport, 1), /<tool_result name="check_project">\nBuild: OK/);
  assert.equal(result.reason, 'finished');
});

it('keeps what the model wrote in front of it for the rest of the turn', async () => {
  const longFile = Array.from({ length: 200 }, (_, index) => `export const line${index} = ${index};`).join('\n');
  const transport = scripted([
    `<willow-write path="/data.ts">\n${longFile}\n</willow-write>\n<willow-tool name="list_files">{}</willow-tool>`,
    'Done.',
  ], { chunk: 400 });
  await turn({ transport, checker: async () => ok() });

  const ownReply = transport.rounds[1].messages.at(-2);
  assert.equal(ownReply.role, 'assistant');
  assert.match(ownReply.content, /export const line199 = 199;/, 'a compacted write would send the model back to read_file');
});

it('builds and runs the result, and gives the model a round to fix what broke', async () => {
  const transport = scripted([
    '<willow-write path="/App.tsx">\nexport default function App() { return <div>{items.map((i) => i)}</div>; }\n</willow-write>\nBuilt.',
    '<willow-edit path="/App.tsx">\n<<<<<<< SEARCH\n{items.map((i) => i)}\n=======\n{[1, 2].map((i) => i)}\n>>>>>>> REPLACE\n</willow-edit>\nFixed.',
  ]);
  let checks = 0;
  const checker = async (files) => {
    checks += 1;
    return /items\.map/.test(files['/App.tsx'])
      ? { ...ok(), runtimeErrors: ['ReferenceError: items is not defined'] }
      : ok();
  };
  const result = await turn({ transport, checker });

  assert.equal(result.reason, 'finished');
  assert.equal(checks, 2);
  assert.match(lastUser(transport, 1), /found problems/);
  assert.match(lastUser(transport, 1), /ReferenceError: items is not defined/);
  const checkSteps = result.steps.filter((step) => step.kind === 'check');
  assert.deepEqual(checkSteps.map((step) => step.status), ['error', 'done']);
  assert.match(result.workspace.read('/App.tsx'), /\[1, 2\]\.map/);
});

it('stops fixing after the limit and says the preview still has errors', async () => {
  const transport = scripted(Array.from({ length: 6 }, (_, index) => `<willow-write path="/App.tsx">\nexport default () => ${index};\n</willow-write>`));
  const result = await turn({ transport, maxFixRounds: 2, checker: async () => ({ ...ok(), buildErrors: [{ file: '/App.tsx', line: 1, text: 'boom' }] }) });

  assert.equal(result.reason, 'finished');
  assert.equal(transport.rounds.length, 3);
  const notice = result.steps.find((step) => step.kind === 'notice');
  assert.match(notice.text, /still reports errors/);
  // The files a build error names go back with the feedback, so the fix needs no read.
  assert.match(lastUser(transport, 1), /<file path="\/App\.tsx">/);
});

it('changes nothing in Plan mode, but may read', async () => {
  const transport = scripted([
    '<willow-tool name="read_file">{"path": "/App.tsx"}</willow-tool>',
    'Here is the plan.\n<willow-write path="/App.tsx">\nnope\n</willow-write>',
    '## Plan\n- Add a header\n\nShall I go ahead?',
  ]);
  let checks = 0;
  const result = await turn({
    mode: 'plan',
    files: { '/App.tsx': 'export default () => null;\n' },
    transport,
    checker: async () => {
      checks += 1;
      return ok();
    },
  });

  assert.equal(result.reason, 'finished');
  assert.equal(result.workspace.read('/App.tsx'), 'export default () => null;\n');
  assert.deepEqual(result.changedPaths, []);
  assert.equal(checks, 0);
  assert.match(transport.rounds[0].systemPrompt, /# Plan mode is on/);
  assert.match(lastUser(transport, 2), /Plan mode is on, so files cannot be changed/);
  assert.equal(result.steps.some((step) => step.kind === 'file'), false);
});

it('refuses a write cut off by the output limit, then takes the re-sent file', async () => {
  const transport = scripted([
    'Building.\n<willow-write path="/App.tsx">\nexport default function App() {\n  return <div',
    '<willow-write path="/App.tsx">\nexport default function App() { return <div />; }\n</willow-write>',
  ]);
  const result = await turn({ transport, checker: async () => ok() });

  assert.match(lastUser(transport, 1), /cut off while writing \/App\.tsx/);
  assert.equal(result.workspace.read('/App.tsx'), 'export default function App() { return <div />; }\n');
});

it('hands a failed SEARCH back with the real lines', async () => {
  const transport = scripted([
    '<willow-edit path="/App.tsx">\n<<<<<<< SEARCH\n  return <h1 className="title">Hi</h1>;\n=======\n  return <h1>Hello</h1>;\n>>>>>>> REPLACE\n</willow-edit>',
    '<willow-edit path="/App.tsx">\n<<<<<<< SEARCH\n  return <h1 className="heading">Hi</h1>;\n=======\n  return <h1 className="heading">Hello</h1>;\n>>>>>>> REPLACE\n</willow-edit>',
  ]);
  const files = { '/App.tsx': 'export default function App() {\n  return <h1 className="heading">Hi</h1>;\n}\n' };
  const result = await turn({ files, transport, checker: async () => ok() });

  assert.match(lastUser(transport, 1), /did not match \/App\.tsx/);
  assert.match(lastUser(transport, 1), /2 \|   return <h1 className="heading">Hi<\/h1>;/);
  assert.match(result.workspace.read('/App.tsx'), /Hello/);
  const edits = result.steps.filter((step) => step.kind === 'file');
  assert.deepEqual(edits.map((step) => step.status), ['error', 'done']);
});

it('catches code written into the reply instead of applied', async () => {
  const file = ['```tsx', 'import { useState } from "react";', 'export default function App() {', '  const [n, setN] = useState(0);', '  return (', '    <button onClick={() => setN(n + 1)}>', '      {n}', '    </button>', '  );', '}', '```'].join('\n');
  const transport = scripted([
    `Here is the app:\n\n${file}`,
    '<willow-write path="/App.tsx">\nexport default function App() { return null; }\n</willow-write>\nApplied.',
  ]);
  const result = await turn({ transport, checker: async () => ok() });

  assert.match(lastUser(transport, 1), /wrote file contents into your reply/);
  assert.ok(result.workspace.exists('/App.tsx'));
  assert.doesNotMatch(result.text, /useState/, 'the unapplied code is replaced in the transcript');
  assert.match(result.text, /moved into the project/);
});

it('nudges once when a reply announces work and stops', async () => {
  const transport = scripted(['Let me start by creating the layout.', 'Let me start by creating the layout.']);
  const result = await turn({ transport, checker: async () => ok() });
  assert.equal(transport.rounds.length, 2);
  assert.match(lastUser(transport, 1), /contained no action tags/);
  assert.equal(result.reason, 'finished');
});

it('answers a greeting in one round, without building or checking', async () => {
  let checks = 0;
  const transport = scripted(["Hi! What would you like to build?"]);
  const result = await turn({ prompt: 'hi', transport, checker: async () => { checks += 1; return ok(); } });
  assert.equal(transport.rounds.length, 1);
  assert.equal(checks, 0);
  assert.deepEqual(result.steps.map((step) => step.kind), ['text']);
});

it('retries a rate-limited request that never started, and only that', async () => {
  const limited = Object.assign(new Error('429 Too Many Requests'), { status: 429 });
  const transport = scripted(['Done.'], { failures: [limited] });
  const result = await turn({ transport });
  assert.equal(result.reason, 'finished');
  assert.equal(transport.calls(), 2);

  const fatal = Object.assign(new Error('invalid api key'), { status: 401 });
  const failing = scripted(['never'], { failures: [fatal] });
  const failed = await turn({ transport: failing });
  assert.equal(failed.reason, 'error');
  assert.match(failed.error, /invalid api key/);
});

it('keeps finished work when the user stops a turn', async () => {
  const controller = new AbortController();
  const transport = async (_messages, _options, onToken) => {
    onToken('<willow-write path="/a.ts">\nexport const a = 1;\n</willow-write>\nNow the next part…');
    controller.abort();
    const error = new Error('The AI request was cancelled.');
    error.name = 'AbortError';
    throw error;
  };
  const result = await turn({ signal: controller.signal, transport });
  assert.equal(result.reason, 'cancelled');
  assert.equal(result.workspace.read('/a.ts'), 'export const a = 1;\n');
  assert.deepEqual(result.changedPaths, ['/a.ts'], 'the caller commits what finished before the stop');
});

it('reports cancellation and marks unfinished work as stopped', async () => {
  const controller = new AbortController();
  const transport = async (_messages, options, onToken) => {
    onToken('<willow-write path="/App.tsx">\nexport default');
    controller.abort();
    const error = new Error('The AI request was cancelled.');
    error.name = 'AbortError';
    throw error;
  };
  const result = await turn({ signal: controller.signal, transport });
  assert.equal(result.reason, 'cancelled');
  const step = result.steps.find((entry) => entry.kind === 'file');
  assert.equal(step.status, 'error');
  assert.equal(step.error, 'Stopped');
  assert.deepEqual(result.changedPaths, []);
});

it('stops at the round limit and says so', async () => {
  const transport = scripted(Array.from({ length: 10 }, () => '<willow-tool name="list_files" />'));
  const result = await turn({ transport, maxRounds: 3 });
  assert.equal(result.reason, 'step-limit');
  assert.equal(transport.rounds.length, 3);
  assert.match(result.steps.at(-1).text, /step limit/);
});

it('names the real tools when the model invents one', async () => {
  const transport = scripted(['<willow-tool name="run_shell">{"command": "npm test"}</willow-tool>', 'Okay.']);
  await turn({ transport });
  assert.match(lastUser(transport, 1), /There is no tool named "run_shell"\. Available tools: read_file, list_files, search_files/);
});

it('opens the turn with the project, the request, and what the user attached', async () => {
  const transport = scripted(['Sure.']);
  await turn({
    prompt: 'use $BrandVoice on the hero',
    files: { '/App.tsx': 'export default () => <h1>Hi</h1>;\n', '/assets/logo.png': 'data:image/png;base64,AAAA' },
    promptNotes: ['The user attached these images: /assets/logo.png'],
    skills: [{ id: 'brand-voice', name: 'Brand voice', description: 'Copy rules', instructions: 'Be warm.', enabled: true }],
    attachments: [{ type: 'image', mimeType: 'image/png', data: 'AAAA', name: 'logo.png' }],
    transport,
  });
  const first = transport.rounds[0].messages.at(-1);
  assert.match(first.content, /<file path="\/App\.tsx">\nexport default \(\) => <h1>Hi<\/h1>;\n<\/file>/);
  assert.match(first.content, /\/assets\/logo\.png \(binary asset\)/);
  assert.doesNotMatch(first.content, /base64,AAAA/, 'assets are listed, never inlined');
  assert.match(first.content, /read it with read_skill before acting:\n- Brand voice \(skill:\/\/brand-voice\)/);
  assert.match(first.content, /<user_message>\nuse \$BrandVoice on the hero\n<\/user_message>$/);
  assert.equal(first.attachments[0].name, 'logo.png');
  assert.match(transport.rounds[0].systemPrompt, /# Skills/);
});

it('lets the model read a skill mid-turn', async () => {
  const transport = scripted(['<willow-tool name="read_skill">{"name": "skill://brand-voice"}</willow-tool>', 'Following it.']);
  const result = await turn({
    transport,
    skills: [{ id: 'brand-voice', name: 'Brand voice', description: 'Copy rules', instructions: 'Be warm.', enabled: true }],
  });
  assert.match(lastUser(transport, 1), /<skill name="Brand voice" file="SKILL\.md">[\s\S]*Be warm\./);
  assert.deepEqual(result.steps.filter((step) => step.kind === 'skill').map((step) => [step.name, step.status]), [['Brand voice', 'done']]);
});

it('runs a connector tool in build mode and withholds it in Plan mode', async () => {
  const connector = {
    qualifiedName: 'mcp__docs__search',
    toolName: 'search',
    serverId: 'docs',
    serverLabel: 'Docs',
    description: 'Search the docs.',
    inputSchema: { properties: { q: { type: 'string' } }, required: ['q'] },
    client: { callTool: async (_name, args) => ({ text: `results for ${args.q}`, failed: false }) },
  };
  const build = scripted(['<willow-tool name="mcp__docs__search">{"q": "hooks"}</willow-tool>', 'Got it.']);
  const result = await turn({ transport: build, connectors: [connector] });
  assert.match(lastUser(build, 1), /<connector_result server="Docs" tool="search">\nresults for hooks/);
  assert.match(build.rounds[0].systemPrompt, /# Connectors[\s\S]*`mcp__docs__search` — `\{ q: string \}`/);
  assert.deepEqual(result.steps.filter((step) => step.kind === 'tool').map((step) => step.label), ['Docs · search']);

  const plan = scripted(['<willow-tool name="mcp__docs__search">{"q": "hooks"}</willow-tool>', 'Okay.']);
  await turn({ mode: 'plan', transport: plan, connectors: [connector] });
  assert.doesNotMatch(plan.rounds[0].systemPrompt, /# Connectors/);
  assert.match(lastUser(plan, 1), /not connected right now|not available in Plan mode/);
});

/* ====================================================================== */
/* Context                                                                */
/* ====================================================================== */

it('sends earlier turns as what was said and what changed, never the code', () => {
  const history = compactHistory([
    { role: 'assistant', content: 'stray opener' },
    { role: 'user', content: 'build a todo app', attachments: [{ name: 'mock.png', type: 'image' }] },
    {
      role: 'assistant',
      content: 'Built it.',
      steps: [
        { id: '1', kind: 'text', text: 'Built it.' },
        { id: '2', kind: 'file', action: 'write', path: '/App.tsx', status: 'done', created: true },
        { id: '3', kind: 'file', action: 'edit', path: '/components/List.tsx', status: 'done' },
      ],
    },
    { role: 'user', content: 'make it blue' },
    { role: 'user', content: 'and bigger' },
    { role: 'assistant', content: 'Sure <boltArtifact id="a" title="A"><boltAction type="file" filePath="src/App.tsx">const x = 1;</boltAction></boltArtifact> done' },
  ]);
  assert.equal(history[0].role, 'user', 'a leading assistant message is dropped');
  assert.match(history[0].content, /\[Attached: mock\.png\]/);
  assert.match(history[1].content, /\[Changes made: created \/App\.tsx; edited \/components\/List\.tsx\.\]/);
  assert.equal(history[2].content, 'make it blue\n\nand bigger', 'consecutive user messages merge');
  assert.doesNotMatch(history[3].content, /const x = 1/);
  assert.match(history[3].content, /\[Files changed: src\/App\.tsx\]/);
});

it('shows the files the user is most likely talking about first, within a budget', () => {
  const files = {
    '/App.tsx': 'a'.repeat(100),
    '/components/Header.tsx': 'h'.repeat(100),
    '/components/Huge.tsx': 'x'.repeat(50_000),
    '/lib/util.ts': 'u'.repeat(100),
  };
  const snapshot = buildProjectSnapshot(files, { prompt: 'fix the Header', maxChars: 250, maxFileChars: 10_000 });
  assert.match(snapshot, /<file path="\/components\/Header\.tsx">/);
  assert.match(snapshot, /<file path="\/App\.tsx">/);
  assert.doesNotMatch(snapshot, /<file path="\/components\/Huge\.tsx">/);
  assert.match(snapshot, /Not shown above[^\n]*\/components\/Huge\.tsx/);
  assert.equal(buildProjectSnapshot({}, { prompt: 'hi' }), '<project>\nThe project is empty: it has no files yet.\n</project>');

  assert.deepEqual(
    recentlyChangedPaths([{ role: 'assistant', content: '', steps: [{ id: '1', kind: 'file', action: 'edit', path: '/components/Header.tsx', status: 'done' }] }]),
    ['/components/Header.tsx'],
  );
});
