/**
 * The Tool Builder's harness (`features/media/src/tools/harness/`), a fork of the Code tab's,
 * driven the way `code-harness-turn.test.mjs` drives the original: a scripted model streams the
 * replies (in small chunks, as providers do), a stand-in checker plays the hidden frame that
 * builds and runs the tool, and each test asserts on the tool's files, the transcript and what
 * the model was told next. The files the fork copied are pinned to the Code harness's, so the
 * Code tab's tests cover them as well.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const toolsHarness = (file) => path.join(repoRoot, 'features', 'media', 'src', 'tools', 'harness', file);
const codeHarness = (file) => path.join(repoRoot, 'features', 'code', 'src', 'harness', file);
const { runTurn } = await importTs(toolsHarness('turn.ts'));

const MODEL = { label: 'Test', options: { provider: 'gemini', model: 'test', apiKey: 'k' } };

function scripted(replies, { chunk = 3, failures = [] } = {}) {
  const rounds = [];
  let calls = 0;
  const transport = async (messages, options, onToken, _onStart, systemPrompt) => {
    calls += 1;
    const failure = failures.shift();
    if (failure) throw failure;
    rounds.push({ messages: messages.map((message) => ({ ...message })), systemPrompt, options });
    const body = replies[rounds.length - 1] ?? '';
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

it('builds a new tool as the reply streams, runs its tools, and takes a package without declaring it', async () => {
  const transport = scripted([
    `I'll build a tap counter.
<willow-write path="/App.tsx">
import Counter from './components/Counter';
export default function App() { return <main className="h-screen bg-black"><Counter /></main>; }
</willow-write>
<willow-write path="components/Counter.tsx">
import { Plus } from 'lucide-react';
export default function Counter() { return <button><Plus /> 0</button>; }
</willow-write>
<willow-dependency name="lucide-react" version="^0.460.0" />
<willow-tool name="list_files">{}</willow-tool>`,
    'Built a **tap counter**.',
  ]);
  const result = await turn({ transport, checker: async () => ok() });

  assert.equal(result.reason, 'finished');
  assert.deepEqual(Object.keys(result.workspace.files).sort(), ['/App.tsx', '/components/Counter.tsx'], 'a tool has no package.json');
  assert.match(lastUser(transport, 1), /<tool_result name="list_files">/);
  assert.match(lastUser(transport, 1), /Applied: created \/App\.tsx \(2 lines\); created \/components\/Counter\.tsx \(2 lines\); lucide-react needs no declaring \(imports load from esm\.sh; nothing changed\)\./);
  assert.deepEqual(
    result.steps.filter((step) => step.kind !== 'text').map((step) => `${step.kind}:${step.status}`),
    ['file:done', 'file:done', 'dependency:done', 'list:done', 'check:done'],
  );
  assert.equal(result.text, "I'll build a tap counter.\n\nBuilt a **tap counter**.");
  assert.deepEqual(result.changedPaths, ['/App.tsx', '/components/Counter.tsx']);
});

it('turns down a package name an esm.sh import could not name', async () => {
  const transport = scripted(['<willow-dependency name="not a package!" />', 'Okay.']);
  const result = await turn({ transport });
  assert.match(lastUser(transport, 1), /"not a package!" is not a valid npm package name\./);
  assert.deepEqual(result.steps.filter((step) => step.kind === 'dependency').map((step) => [step.status, step.error]), [['error', 'Invalid name']]);
});

it('builds and runs the tool after the changes, and gives the model a round to fix what broke', async () => {
  const transport = scripted([
    '<willow-write path="/App.tsx">\nexport default function App() { return <div>{shots.map((s) => s)}</div>; }\n</willow-write>\nBuilt.',
    '<willow-edit path="/App.tsx">\n<<<<<<< SEARCH\n{shots.map((s) => s)}\n=======\n{[1, 2].map((s) => s)}\n>>>>>>> REPLACE\n</willow-edit>\nFixed.',
  ]);
  const checked = [];
  const checker = async (files) => {
    checked.push(files['/App.tsx']);
    return /shots\.map/.test(files['/App.tsx']) ? { ...ok(), runtimeErrors: ['ReferenceError: shots is not defined'] } : ok();
  };
  const result = await turn({ transport, checker });

  assert.equal(result.reason, 'finished');
  assert.equal(checked.length, 2);
  assert.match(lastUser(transport, 1), /Willow built and ran the project after your changes and found problems:/);
  assert.match(lastUser(transport, 1), /ReferenceError: shots is not defined/);
  assert.deepEqual(result.steps.filter((step) => step.kind === 'check').map((step) => step.status), ['error', 'done']);
  assert.match(result.workspace.read('/App.tsx'), /\[1, 2\]\.map/);
});

it('stops fixing after the limit and says the tool still has errors', async () => {
  const transport = scripted(Array.from({ length: 6 }, (_, index) => `<willow-write path="/App.tsx">\nexport default () => ${index};\n</willow-write>`));
  const result = await turn({ transport, maxFixRounds: 2, checker: async () => ({ ...ok(), buildErrors: [{ file: '/App.tsx', line: 1, text: 'boom' }] }) });

  assert.equal(result.reason, 'finished');
  assert.equal(transport.rounds.length, 3);
  assert.match(result.steps.find((step) => step.kind === 'notice').text, /The preview still reports errors after several fixes/);
  assert.match(lastUser(transport, 1), /<file path="\/App\.tsx">/, 'the file a build error names goes back with the feedback');
});

it('answers a check after changes with the automatic check, and runs one asked for before any change', async () => {
  const after = scripted([
    '<willow-write path="/App.tsx">\nexport default () => <h1>Hi</h1>;\n</willow-write>\nBuilt it.\n<willow-tool name="check_project">{}</willow-tool>',
    'This round should never be requested.',
  ]);
  let checks = 0;
  await turn({ transport: after, checker: async () => { checks += 1; return ok(); } });
  assert.equal(after.calls(), 1);
  assert.equal(checks, 1);

  const before = scripted(['<willow-tool name="check_project">{}</willow-tool>', 'The tool renders fine.']);
  const result = await turn({ transport: before, files: { '/App.tsx': 'export default () => null;\n' }, checker: async () => ok() });
  assert.equal(before.calls(), 2);
  assert.match(lastUser(before, 1), /<tool_result name="check_project">\nBuild: OK/);
  assert.equal(result.reason, 'finished');
});

it('edits a tool that keeps its sources under /src/ in place', async () => {
  const transport = scripted([
    '<willow-edit path="/App.tsx">\n<<<<<<< SEARCH\n  return <Card />;\n=======\n  return <><Card /><Badge /></>;\n>>>>>>> REPLACE\n</willow-edit>\n' +
      '<willow-edit path="src/App.tsx">\n<<<<<<< SEARCH\nimport Card from \'./components/Card\';\n=======\nimport Card from \'./components/Card\';\nimport Badge from \'./components/Badge\';\n>>>>>>> REPLACE\n</willow-edit>\n' +
      '<willow-write path="/src/components/Badge.tsx">\nexport default function Badge() { return <span>New</span>; }\n</willow-write>\nAdded a badge.',
  ]);
  const files = {
    '/src/App.tsx': "import Card from './components/Card';\nexport default function App() {\n  return <Card />;\n}\n",
    '/src/components/Card.tsx': 'export default function Card() { return <div />; }\n',
  };
  const result = await turn({ files, transport, checker: async () => ok() });

  assert.deepEqual(Object.keys(result.workspace.files).sort(), ['/src/App.tsx', '/src/components/Badge.tsx', '/src/components/Card.tsx']);
  assert.match(result.workspace.read('/src/App.tsx'), /import Badge from '\.\/components\/Badge';[\s\S]*<Badge \/>/);
});

it('keeps what the model wrote in front of it for the rest of the turn', async () => {
  const longFile = Array.from({ length: 200 }, (_, index) => `export const preset${index} = ${index};`).join('\n');
  const transport = scripted([
    `<willow-write path="/presets.ts">\n${longFile}\n</willow-write>\n<willow-tool name="list_files">{}</willow-tool>`,
    'Done.',
  ], { chunk: 400 });
  await turn({ transport, checker: async () => ok() });

  const ownReply = transport.rounds[1].messages.at(-2);
  assert.equal(ownReply.role, 'assistant');
  assert.match(ownReply.content, /export const preset199 = 199;/, 'a compacted write would send the model back to read_file');
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
    '<willow-edit path="/App.tsx">\n<<<<<<< SEARCH\n  return <h1 className="title">Shots</h1>;\n=======\n  return <h1>Storyboard</h1>;\n>>>>>>> REPLACE\n</willow-edit>',
    '<willow-edit path="/App.tsx">\n<<<<<<< SEARCH\n  return <h1 className="heading">Shots</h1>;\n=======\n  return <h1 className="heading">Storyboard</h1>;\n>>>>>>> REPLACE\n</willow-edit>',
  ]);
  const files = { '/App.tsx': 'export default function App() {\n  return <h1 className="heading">Shots</h1>;\n}\n' };
  const result = await turn({ files, transport, checker: async () => ok() });

  assert.match(lastUser(transport, 1), /did not match \/App\.tsx/);
  assert.match(lastUser(transport, 1), /2 \|   return <h1 className="heading">Shots<\/h1>;/);
  assert.match(result.workspace.read('/App.tsx'), /Storyboard/);
  assert.deepEqual(result.steps.filter((step) => step.kind === 'file').map((step) => step.status), ['error', 'done']);
});

it('catches code written into the reply instead of applied', async () => {
  const file = ['```tsx', "import { Flow } from 'flow-sdk';", 'export default function App() {', '  const save = () => Flow.save({ base64: "", mimeType: "image/png" });', '  return (', '    <button onClick={save}>', '      Save', '    </button>', '  );', '}', '```'].join('\n');
  const transport = scripted([
    `Here is the tool:\n\n${file}`,
    '<willow-write path="/App.tsx">\nexport default function App() { return null; }\n</willow-write>\nApplied.',
  ]);
  const result = await turn({ transport, checker: async () => ok() });

  assert.match(lastUser(transport, 1), /wrote file contents into your reply/);
  assert.ok(result.workspace.exists('/App.tsx'));
  assert.doesNotMatch(result.text, /Flow\.save/, 'the unapplied code is replaced in the transcript');
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
  const transport = scripted(['Hi! What should this tool do?']);
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
  const failed = await turn({ transport: scripted(['never'], { failures: [fatal] }) });
  assert.equal(failed.reason, 'error');
  assert.match(failed.error, /invalid api key/);
});

it('keeps finished work when the user stops a turn, and marks the unfinished file as stopped', async () => {
  const controller = new AbortController();
  const transport = async (_messages, _options, onToken) => {
    onToken('<willow-write path="/presets.ts">\nexport const presets = [];\n</willow-write>\n<willow-write path="/App.tsx">\nexport default');
    controller.abort();
    const error = new Error('The AI request was cancelled.');
    error.name = 'AbortError';
    throw error;
  };
  const result = await turn({ signal: controller.signal, transport });
  assert.equal(result.reason, 'cancelled');
  assert.equal(result.workspace.read('/presets.ts'), 'export const presets = [];\n');
  assert.equal(result.workspace.exists('/App.tsx'), false);
  assert.deepEqual(result.changedPaths, ['/presets.ts'], 'the builder commits what finished before the stop');
  const unfinished = result.steps.filter((step) => step.kind === 'file').at(-1);
  assert.deepEqual([unfinished.path, unfinished.status, unfinished.error], ['/App.tsx', 'error', 'Stopped']);
});

it('stops at the round limit and says so', async () => {
  const transport = scripted(Array.from({ length: 10 }, () => '<willow-tool name="list_files" />'));
  const result = await turn({ transport, maxRounds: 3 });
  assert.equal(result.reason, 'step-limit');
  assert.equal(transport.rounds.length, 3);
  assert.match(result.steps.at(-1).text, /step limit/);
});

it('offers only the four builder tools, and names them when the model asks for another', async () => {
  for (const name of ['propose_plan', 'read_skill', 'computer', 'run_shell']) {
    const transport = scripted([`<willow-tool name="${name}">{}</willow-tool>`, 'Okay.']);
    await turn({ transport, checker: async () => ok() });
    assert.match(
      lastUser(transport, 1),
      new RegExp(`There is no tool named "${name}"\\. Available tools: read_file, list_files, search_files, check_project\\.`),
    );
  }
  const unchecked = scripted(['<willow-tool name="check_project">{}</willow-tool>', 'Okay.']);
  await turn({ transport: unchecked });
  assert.match(lastUser(unchecked, 1), /Available tools: read_file, list_files, search_files\./, 'with nothing to run the tool, there is no check to offer');
});

it("opens the turn with the tool's files and the request, under the Tool Builder's own prompt", async () => {
  const transport = scripted(['Sure.']);
  await turn({
    prompt: 'add a download button',
    history: [{ role: 'user', content: 'build a palette tool' }, { role: 'assistant', content: 'Built it.\n\n[Changes made: created /App.tsx.]' }],
    files: { '/App.tsx': 'export default () => <h1>Palette</h1>;\n', '/assets/swatch.png': 'data:image/png;base64,AAAA' },
    attachments: [{ type: 'image', mimeType: 'image/png', data: 'AAAA', name: 'mood.png' }],
    checker: async () => ok(),
    transport,
  });
  const { messages, systemPrompt } = transport.rounds[0];
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'user']);
  const first = messages.at(-1);
  assert.match(first.content, /<file path="\/App\.tsx">\nexport default \(\) => <h1>Palette<\/h1>;\n<\/file>/);
  assert.match(first.content, /\/assets\/swatch\.png \(binary asset\)/);
  assert.doesNotMatch(first.content, /base64,AAAA/, 'assets are listed, never inlined');
  assert.match(first.content, /<user_message>\nadd a download button\n<\/user_message>$/);
  assert.equal(first.attachments[0].name, 'mood.png');

  assert.match(systemPrompt, /^You are the Tool Builder in Willow's Media app\./);
  for (const section of ['# The runtime', '# flow-sdk', '# Design', '# Changing the tool', '# Tools', '# Errors']) assert.ok(systemPrompt.includes(section), section);
  assert.match(systemPrompt, /- `check_project` — /);
  assert.doesNotMatch(systemPrompt, /# Skills|# Connectors|propose_plan|# The live preview/);
});

it("keeps the files it copied from the Code harness identical to the Code harness's", () => {
  const body = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/^\s*\/\*\*?[\s\S]*?\*\/\s*/, '');
  const copied = ['apply-patch.ts', 'search-replace.ts', 'stream-parser.ts', 'workspace.ts', 'loose-code.ts', 'stalled.ts', 'protocol.ts', 'context.ts', 'model.ts', 'harness-store.ts'];
  for (const name of copied) {
    assert.equal(body(toolsHarness(name)), body(codeHarness(name)), `${name} drifted from features/code/src/harness/${name}: bring the change across`);
  }
  const agents = fs.readFileSync(toolsHarness('AGENTS.md'), 'utf8');
  for (const name of copied) assert.ok(agents.includes(`\`${name}\``), `AGENTS.md no longer lists ${name} as copied`);
});
