import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', 'harness', ...parts);

const { createNativePaths } = await importTs(harness('native', 'native-paths.ts'));
const { commandSegments, allowedByRules, offeredPrefix } = await importTs(harness('native', 'native-approvals.ts'));
const { renderEnvironmentContext, renderPermissionsInstructions, discoverAgentsMd, renderAgentsMd } = await importTs(harness('native', 'native-context.ts'));
const { createDiskPatchEngine, PATCH_REJECTED } = await importTs(harness('native', 'native-disk-patches.ts'));
const { createNativeTools, EXEC_REJECTED, ESCALATION_REJECTED } = await importTs(harness('native', 'native-tools.ts'));
const { createSparkNativeRuntime, NativeFolderMissingError } = await importTs(harness('native', 'native-runtime.ts'));
const { createSparkNativeHarnessProfile } = await importTs(harness('overlay', 'spark-native-profile.ts'));
const { createSparkHarnessProfile } = await importTs(harness('overlay', 'spark-profile.ts'));
const { runSparkHarnessTurn } = await importTs(harness('spark-harness.ts'));
const { parsePatch, applyPatch } = await importTs(harness('runtime', 'apply-patch.ts'));

const HOME = 'C:\\Users\\me';
const PROJECT = 'C:\\Users\\me\\Projects\\site';

/** A Windows computer in memory, answering what the companion's `spark.*` requests answer. */
function fakeComputer(files = {}, { directories = [] } = {}) {
  const disk = new Map(Object.entries(files).map(([file, text]) => [file.toLowerCase(), text]));
  const folders = new Set([HOME, PROJECT, ...directories].map((folder) => folder.toLowerCase()));
  const calls = [];
  let nextSession = 1;
  const running = new Map();
  const isFolder = (target) => {
    const key = target.toLowerCase().replace(/\\+$/, '');
    return folders.has(key) || [...disk.keys()].some((file) => file.startsWith(`${key}\\`));
  };
  const response = (output, { exitCode = 0, sessionId = null } = {}) => ({
    chunkId: 'a1b2c3',
    wallTimeMs: 15,
    exitCode: sessionId == null ? exitCode : null,
    sessionId,
    originalTokenCount: null,
    output,
    text: `Chunk ID: a1b2c3\nWall time: 0.0150 seconds\n${sessionId == null ? `Process exited with code ${exitCode}` : `Process running with session ID ${sessionId}`}\nOutput:\n${output}`,
  });
  return {
    calls,
    disk,
    host: {
      async environment() {
        return { platform: 'win32', release: '10.0', arch: 'x64', home: HOME, tmp: `${HOME}\\AppData\\Local\\Temp`, user: 'me', hostname: 'pc', shell: { name: 'powershell', path: 'powershell.exe' }, pathSeparator: '\\' };
      },
      async execStart(request) {
        calls.push(['exec', request]);
        if (request.cmd.startsWith('npm run dev')) {
          const sessionId = nextSession++;
          running.set(sessionId, request.cmd);
          return response('ready on http://localhost:5173\n', { sessionId });
        }
        if (request.cmd === 'exit 3') return response('', { exitCode: 3 });
        return response(`ran ${request.cmd}\n`);
      },
      async execWrite(request) {
        calls.push(['write_stdin', request]);
        if (!running.has(request.sessionId)) throw new Error(`Unknown session ID ${request.sessionId}`);
        if (request.chars === '\u0003') {
          running.delete(request.sessionId);
          return response('', { exitCode: 1 });
        }
        return response('still serving\n', { sessionId: request.sessionId });
      },
      async execKill(request) {
        calls.push(['kill', request]);
      },
      async stat(target) {
        if (disk.has(target.toLowerCase())) return { path: target, exists: true, isFile: true, isDirectory: false, size: disk.get(target.toLowerCase()).length };
        if (isFolder(target)) return { path: target, exists: true, isFile: false, isDirectory: true, size: 0 };
        return { path: target, exists: false };
      },
      async read(targets) {
        calls.push(['read', targets]);
        return targets.map((target) => {
          const text = disk.get(target.toLowerCase());
          if (text === undefined) return isFolder(target) ? { path: target, exists: true, isDirectory: true, size: 0 } : { path: target, exists: false };
          if (text === '\0binary') return { path: target, exists: true, size: 7, binary: true };
          return { path: target, exists: true, size: text.length, binary: false, text };
        });
      },
      async write(target, text) {
        calls.push(['write', target]);
        disk.set(target.toLowerCase(), text);
      },
      async remove(target) {
        calls.push(['remove', target]);
        disk.delete(target.toLowerCase());
      },
      async list(root, depth) {
        const prefix = `${root.toLowerCase()}\\`;
        const entries = [...disk.keys()].filter((file) => file.startsWith(prefix)).map((file) => ({ path: file.slice(prefix.length).replaceAll('\\', '/'), type: 'file', size: disk.get(file).length }));
        return { path: root, entries, truncated: false, depth };
      },
      async search(root, query) {
        const prefix = `${root.toLowerCase()}\\`;
        const matches = [];
        for (const [file, text] of disk) {
          if (!file.startsWith(prefix)) continue;
          text.split(/\r?\n/).forEach((line, index) => {
            if (line.toLowerCase().includes(query.toLowerCase())) matches.push({ path: file.slice(prefix.length).replaceAll('\\', '/'), line: index + 1, text: line.trim() });
          });
        }
        return { path: root, query, matches, truncated: false };
      },
    },
  };
}

/** Approvals that answer from a script and record what was asked. */
function scriptedApprovals(mode = 'ask', answers = []) {
  const state = { mode, rules: [], asked: [] };
  return {
    state,
    mode: () => state.mode,
    rules: () => state.rules,
    async request(request) {
      state.asked.push(request);
      return answers.shift() ?? 'deny';
    },
    addRule: (prefix) => state.rules.push(prefix),
    allowAll: () => {
      state.mode = 'full';
    },
  };
}

function toolContext() {
  const emitted = [];
  return {
    emitted,
    context: {
      readFiles: () => ({}),
      writeFiles: () => {},
      emit: (call) => {
        emitted.push({ ...call });
        return call.id;
      },
      patch: (id, patch) => {
        const call = emitted.find((entry) => entry.id === id);
        if (call) Object.assign(call, patch);
      },
    },
  };
}

const toolsFor = (computer, approvals, cwd = PROJECT) => {
  const paths = createNativePaths(cwd, { platform: 'win32', home: HOME });
  return Object.fromEntries(createNativeTools({ host: computer.host, paths, approvals, owner: 'task-1', shell: 'powershell' }).map((tool) => [tool.id, tool]));
};

describe('native paths', () => {
  const paths = createNativePaths('c:/Users/me/Projects/site/', { platform: 'win32', home: HOME });

  it('resolves Windows paths against the working folder', () => {
    assert.equal(paths.cwd, PROJECT);
    assert.equal(paths.resolve('src/App.tsx'), `${PROJECT}\\src\\App.tsx`);
    assert.equal(paths.resolve('.\\src\\..\\README.md'), `${PROJECT}\\README.md`);
    assert.equal(paths.resolve('D:\\data\\x.csv'), 'D:\\data\\x.csv');
    assert.equal(paths.resolve('~\\Desktop\\note.txt'), `${HOME}\\Desktop\\note.txt`);
    assert.equal(paths.resolve('"C:\\Program Files\\App"'), 'C:\\Program Files\\App');
    assert.equal(paths.resolve('\\Windows'), 'C:\\Windows');
    assert.equal(paths.resolve('d:'), 'D:\\');
    assert.equal(paths.resolve('..\\..\\..\\..\\..'), 'C:\\');
  });

  it('shows paths inside the working folder relative to it, and compares without case', () => {
    assert.equal(paths.display(`${PROJECT}\\src\\App.tsx`), 'src\\App.tsx');
    assert.equal(paths.display('C:\\Windows\\win.ini'), 'C:\\Windows\\win.ini');
    assert.equal(paths.isInside(PROJECT, 'c:\\users\\ME\\projects\\SITE\\a.txt'), true);
    assert.equal(paths.isInside(PROJECT, `${PROJECT}-old\\a.txt`), false);
  });

  it('resolves POSIX paths', () => {
    const posix = createNativePaths('/home/me/site', { platform: 'linux', home: '/home/me' });
    assert.equal(posix.resolve('src/../lib/a.ts'), '/home/me/site/lib/a.ts');
    assert.equal(posix.resolve('~/notes.md'), '/home/me/notes.md');
    assert.equal(posix.resolve('/etc/hosts'), '/etc/hosts');
    assert.equal(posix.display('/home/me/site/lib/a.ts'), 'lib/a.ts');
  });
});

describe('approval rules', () => {
  it('splits a command at control operators, honouring quotes', () => {
    assert.deepEqual(commandSegments('git status && npm test -- --watch=false | Select-Object -First 5'), [
      ['git', 'status'],
      ['npm', 'test', '--', '--watch=false'],
      ['Select-Object', '-First', '5'],
    ]);
    assert.deepEqual(commandSegments('git commit -m "a; b && c"'), [['git', 'commit', '-m', 'a; b && c']]);
  });

  it('never rule-matches redirection, variables, substitution, wildcards or assignments', () => {
    for (const command of ['npm test > out.txt', 'echo $HOME', 'echo "$(whoami)"', 'Get-Item *.ts', 'FOO=1 npm test', 'git log `whoami`', 'echo "unterminated']) {
      assert.equal(commandSegments(command), null, command);
      assert.equal(allowedByRules(command, [['npm'], ['echo'], ['git'], ['Get-Item']]), false, command);
    }
  });

  it('allows a command only when every segment starts with an approved prefix', () => {
    const rules = [['npm', 'test'], ['git', 'status']];
    assert.equal(allowedByRules('npm test', rules), true);
    assert.equal(allowedByRules('NPM Test --coverage', rules), true);
    assert.equal(allowedByRules('git status; npm test', rules), true);
    assert.equal(allowedByRules('git status; rm -rf build', rules), false);
    assert.equal(allowedByRules('npm install', rules), false);
  });

  it('offers safe prefixes only', () => {
    assert.deepEqual(offeredPrefix('npm test -- --watch', ['npm', 'test']), ['npm', 'test']);
    assert.deepEqual(offeredPrefix('git pull --rebase'), ['git', 'pull']);
    assert.equal(offeredPrefix('python script.py', ['python']), undefined);
    assert.equal(offeredPrefix('Remove-Item -Recurse build'), undefined);
    assert.equal(offeredPrefix('rm -rf build', ['rm']), undefined);
    assert.deepEqual(offeredPrefix('npm test', ['npm']), ['npm', 'test'], 'a too-broad suggestion narrows to the command');
    assert.equal(offeredPrefix('git status && npm test'), undefined);
  });
});

describe('Codex context fragments', () => {
  it('renders the environment context as Codex does', () => {
    assert.equal(
      renderEnvironmentContext({ cwd: PROJECT, shell: 'powershell', now: new Date(2026, 9, 6, 15, 0), timezone: 'Asia/Kolkata' }),
      [
        '<environment_context>',
        `  <cwd>${PROJECT}</cwd>`,
        '  <shell>powershell</shell>',
        '  <current_date>2026-10-06</current_date>',
        '  <timezone>Asia/Kolkata</timezone>',
        '  <filesystem><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>',
        '</environment_context>',
      ].join('\n'),
    );
  });

  it('renders the permissions instructions from Codex templates', () => {
    const ask = renderPermissionsInstructions('ask', [['npm', 'test']]);
    assert.match(ask, /^<permissions instructions>\n/);
    assert.match(ask, /`sandbox_mode` is `danger-full-access`: No filesystem sandboxing - all commands are permitted\. Network access is enabled\./);
    assert.match(ask, /`approval_policy` is `unless-trusted`/);
    assert.match(ask, /The following prefix rules have already been approved: \["npm","test"\]/);
    const full = renderPermissionsInstructions('full', [['npm', 'test']]);
    assert.match(full, /Approval policy is currently never\./);
    assert.doesNotMatch(full, /prefix rules/);
  });

  it('collects AGENTS.md from the git root down, override first, within the size limit', async () => {
    const computer = fakeComputer({
      [`${HOME}\\Projects\\AGENTS.md`]: 'outside the repository',
      [`${PROJECT}\\.git`]: 'gitdir',
      [`${PROJECT}\\AGENTS.md`]: 'root rules',
      [`${PROJECT}\\web\\AGENTS.md`]: 'web rules',
      [`${PROJECT}\\web\\AGENTS.override.md`]: 'web override',
      [`${PROJECT}\\web\\app\\AGENTS.md`]: 'x'.repeat(40_000),
    }, { directories: [`${PROJECT}\\web\\app`] });
    const paths = createNativePaths(`${PROJECT}\\web\\app`, { platform: 'win32', home: HOME });
    const found = await discoverAgentsMd(computer.host, paths);
    assert.deepEqual(found.map((file) => file.directory), [PROJECT, `${PROJECT}\\web`, `${PROJECT}\\web\\app`]);
    assert.deepEqual(found.slice(0, 2).map((file) => file.text), ['root rules', 'web override']);
    assert.equal(found.reduce((total, file) => total + file.text.length, 0), 32 * 1024);
    assert.equal(
      renderAgentsMd(found.slice(0, 1)),
      `# AGENTS.md instructions for ${PROJECT}\n\n<INSTRUCTIONS>\nroot rules\n</INSTRUCTIONS>`,
    );
  });

  it('reads only the working folder AGENTS.md outside a repository', async () => {
    const computer = fakeComputer({ [`${HOME}\\AGENTS.md`]: 'home rules', [`${HOME}\\Projects\\AGENTS.md`]: 'not mine' });
    const found = await discoverAgentsMd(computer.host, createNativePaths(HOME, { platform: 'win32', home: HOME }));
    assert.deepEqual(found.map((file) => file.text), ['home rules']);
  });
});

describe('patches on disk', () => {
  const engineFor = (computer, approvals, writableRoot = PROJECT) => createDiskPatchEngine({
    host: computer.host,
    paths: createNativePaths(PROJECT, { platform: 'win32', home: HOME }),
    approvals,
    writableRoot,
  });
  const apply = async (engine, envelope) => {
    const ops = parsePatch(envelope, engine.normalizePath);
    const touched = [...new Set(ops.flatMap((op) => (op.movePath ? [op.path, op.movePath] : [op.path])))];
    const { files, changes } = applyPatch(await engine.read(touched), ops);
    await engine.write(files, changes);
    return changes;
  };

  it('keeps CRLF line endings and a byte-order mark', async () => {
    const file = `${PROJECT}\\src\\app.ts`;
    const computer = fakeComputer({ [file]: '\uFEFFconst a = 1;\r\nconst b = 2;\r\n' });
    await apply(engineFor(computer, scriptedApprovals('ask')), '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-const b = 2;\n+const b = 3;\n*** End Patch');
    assert.equal(computer.disk.get(file.toLowerCase()), '\uFEFFconst a = 1;\r\nconst b = 3;\r\n');
  });

  it('adds, moves and deletes files inside the project without asking', async () => {
    const approvals = scriptedApprovals('ask');
    const computer = fakeComputer({ [`${PROJECT}\\old.txt`]: 'move me\n', [`${PROJECT}\\gone.txt`]: 'bye\n' });
    await apply(engineFor(computer, approvals), [
      '*** Begin Patch',
      '*** Add File: notes/new.txt',
      '+hello',
      '*** Update File: old.txt',
      '*** Move to: moved.txt',
      '@@',
      '-move me',
      '+moved',
      '*** Delete File: gone.txt',
      '*** End Patch',
    ].join('\n'));
    assert.equal(computer.disk.get(`${PROJECT}\\notes\\new.txt`.toLowerCase()), 'hello\n');
    assert.equal(computer.disk.get(`${PROJECT}\\moved.txt`.toLowerCase()), 'moved\n');
    assert.equal(computer.disk.has(`${PROJECT}\\old.txt`.toLowerCase()), false);
    assert.equal(computer.disk.has(`${PROJECT}\\gone.txt`.toLowerCase()), false);
    assert.equal(approvals.state.asked.length, 0);
  });

  it('asks before editing outside the project, and writes nothing when declined', async () => {
    const approvals = scriptedApprovals('ask', ['deny']);
    const computer = fakeComputer({ [`${HOME}\\.gitconfig`]: '[user]\n' });
    await assert.rejects(
      apply(engineFor(computer, approvals), '*** Begin Patch\n*** Update File: ~\\.gitconfig\n@@\n-[user]\n+[core]\n*** End Patch'),
      new RegExp(PATCH_REJECTED),
    );
    assert.deepEqual(approvals.state.asked[0].paths, [`${HOME}\\.gitconfig`]);
    assert.equal(computer.disk.get(`${HOME}\\.gitconfig`.toLowerCase()), '[user]\n');
  });

  it('asks for every edit in a task with no project folder, and never with full access', async () => {
    const asking = scriptedApprovals('ask', ['once']);
    const computer = fakeComputer();
    await apply(engineFor(computer, asking, null), '*** Begin Patch\n*** Add File: a.txt\n+a\n*** End Patch');
    assert.equal(asking.state.asked.length, 1);
    const full = scriptedApprovals('full');
    await apply(engineFor(computer, full, null), '*** Begin Patch\n*** Add File: b.txt\n+b\n*** End Patch');
    assert.equal(full.state.asked.length, 0);
  });

  it('refuses binary files', async () => {
    const computer = fakeComputer({ [`${PROJECT}\\logo.png`]: '\0binary' });
    await assert.rejects(
      apply(engineFor(computer, scriptedApprovals('full')), '*** Begin Patch\n*** Update File: logo.png\n@@\n-x\n+y\n*** End Patch'),
      /binary file/,
    );
  });
});

describe('native tools', () => {
  it('waits for approval, and reports Codex\'s rejection when declined', async () => {
    const computer = fakeComputer();
    const approvals = scriptedApprovals('ask', ['deny']);
    const { context, emitted } = toolContext();
    const result = await toolsFor(computer, approvals).exec_command.run({ cmd: 'npm install', justification: 'Install the dependencies?', prefix_rule: ['npm', 'install'] }, context);
    assert.deepEqual(result, { observation: EXEC_REJECTED, failed: true });
    assert.equal(computer.calls.some(([kind]) => kind === 'exec'), false);
    assert.deepEqual(approvals.state.asked[0], { kind: 'command', command: 'npm install', cwd: PROJECT, justification: 'Install the dependencies?', prefixRule: ['npm', 'install'] });
    assert.equal(emitted[0].status, 'cancelled');
    assert.equal(emitted[0].shell, 'powershell');
  });

  it('runs an approved command and returns the companion\'s text unchanged', async () => {
    const computer = fakeComputer();
    const approvals = scriptedApprovals('ask', ['prefix']);
    const tools = toolsFor(computer, approvals);
    const { context, emitted } = toolContext();
    const first = await tools.exec_command.run({ cmd: 'npm test', workdir: 'web', yield_time_ms: 20000 }, context);
    assert.equal(first.mutated, true);
    assert.match(first.observation, /^Chunk ID: a1b2c3\nWall time: 0\.0150 seconds\nProcess exited with code 0\nOutput:\nran npm test\n$/);
    assert.deepEqual(computer.calls.find(([kind]) => kind === 'exec')[1], { cmd: 'npm test', workdir: `${PROJECT}\\web`, shell: undefined, login: undefined, yieldTimeMs: 20000, maxOutputTokens: undefined, owner: 'task-1' });
    assert.deepEqual(approvals.state.rules, [['npm', 'test']]);
    assert.deepEqual({ status: emitted[0].status, cwd: emitted[0].cwd, exitCode: emitted[0].exitCode }, { status: 'success', cwd: 'web', exitCode: 0 });

    await tools.exec_command.run({ cmd: 'npm test -- --grep paths' }, context);
    assert.equal(approvals.state.asked.length, 1, 'the approved prefix covers the second run');
  });

  it('switches the task to full access when the user allows everything', async () => {
    const approvals = scriptedApprovals('ask', ['task']);
    const tools = toolsFor(fakeComputer(), approvals);
    await tools.exec_command.run({ cmd: 'git status' }, toolContext().context);
    await tools.exec_command.run({ cmd: 'git log -1' }, toolContext().context);
    assert.equal(approvals.state.mode, 'full');
    assert.equal(approvals.state.asked.length, 1);
  });

  it('rejects escalation requests under the never policy, as Codex does', async () => {
    const result = await toolsFor(fakeComputer(), scriptedApprovals('full')).exec_command.run({ cmd: 'git push', sandbox_permissions: 'require_escalated' }, toolContext().context);
    assert.deepEqual(result, { observation: ESCALATION_REJECTED, failed: true });
  });

  it('keeps a running command in a session for write_stdin', async () => {
    const computer = fakeComputer();
    const tools = toolsFor(computer, scriptedApprovals('full'));
    const { context, emitted } = toolContext();
    const started = await tools.exec_command.run({ cmd: 'npm run dev' }, context);
    assert.match(started.observation, /Process running with session ID 1/);
    const polled = await tools.write_stdin.run({ session_id: 1 }, context);
    assert.match(polled.observation, /still serving/);
    assert.equal(emitted[1].interaction, 'wait');
    assert.equal(emitted[1].command, 'npm run dev');
    const stopped = await tools.write_stdin.run({ session_id: 1, chars: '\u0003' }, context);
    assert.match(stopped.observation, /Process exited with code 1/);
    assert.equal(emitted[2].interaction, 'write');
    const unknown = await tools.write_stdin.run({ session_id: 9 }, context);
    assert.equal(unknown.failed, true);
  });

  it('keeps run_command working for chats that used it', async () => {
    const computer = fakeComputer();
    const result = await toolsFor(computer, scriptedApprovals('full')).run_command.run({ command: 'exit 3' }, toolContext().context);
    assert.match(result.observation, /Process exited with code 3/);
  });

  it('reads, lists and searches the disk', async () => {
    const computer = fakeComputer({ [`${PROJECT}\\src\\cart.ts`]: 'export const useCart = () => 1;\r\nexport const total = 2;\r\n' });
    const tools = toolsFor(computer, scriptedApprovals('ask'));
    const read = await tools.read_file.run({ path: 'src/cart.ts', start_line: 2 }, toolContext().context);
    assert.equal(read.observation, 'src\\cart.ts (3 lines)\n\n    2  export const total = 2;\n    3  ');
    const missing = await tools.read_file.run({ path: 'nope.ts' }, toolContext().context);
    assert.deepEqual(missing, { observation: 'No file at nope.ts.', failed: true });
    const listed = await tools.list_files.run({}, toolContext().context);
    assert.match(listed.observation, /src\/cart\.ts {2}\(\d+ bytes\)/);
    const searched = await tools.search_files.run({ query: 'useCart' }, toolContext().context);
    assert.equal(searched.observation, '1 match(es) in 1 file(s):\nsrc\\cart.ts:1: export const useCart = () => 1;');
  });
});

describe('the desktop prompt', () => {
  const profile = createSparkNativeHarnessProfile({ skills: [], connectedApps: [] }, { platform: 'win32', shell: 'powershell', project: true });

  it('keeps upstream\'s shell guidance and AGENTS.md spec, and documents unified exec', () => {
    assert.match(profile.systemPrompt, /When using the shell, you must adhere to the following guidelines:/);
    assert.match(profile.systemPrompt, /prefer using `rg` or `rg --files`/);
    assert.match(profile.systemPrompt, /# AGENTS\.md spec/);
    assert.match(profile.systemPrompt, /Windows safety rules:/);
    assert.match(profile.systemPrompt, /You have a real terminal on this computer/);
    assert.match(profile.systemPrompt, /\*\*\* Call: exec_command/);
    assert.match(profile.systemPrompt, /--accept-source-agreements --accept-package-agreements/);
    assert.match(profile.systemPrompt, /`write_stdin` continues a running session/);
    assert.match(profile.systemPrompt, /Function calls do not change how a work batch ends/);
    assert.match(profile.systemPrompt, /Waiting is a call too: to wait for a running command, call `write_stdin` with empty `chars`/);
    assert.match(profile.systemPrompt, /# Willow desktop runtime/);
    assert.match(profile.systemPrompt, /\*\*\* Work Title:/);
    assert.match(profile.systemPrompt, /\*\*\* Final Response/);
    assert.doesNotMatch(profile.systemPrompt, /You do not have a shell|no shell|private browser-backed workspace/i);
  });

  it('leaves the web prompt as it was', () => {
    const web = createSparkHarnessProfile({ skills: [], connectedApps: [] }).systemPrompt;
    assert.match(web, /You do not have arbitrary shell access in this environment/);
    assert.doesNotMatch(web, /exec_command|AGENTS\.md spec|Willow desktop runtime/);
  });
});

describe('a Spark turn on the desktop', () => {
  const MODEL = { provider: 'gemini', model: 'test', apiKey: 'k', label: 'Test' };

  const scripted = (responses) => {
    const seen = [];
    const transport = async (messages, _options, onToken, _onStart, systemPrompt) => {
      seen.push({ messages: messages.map((message) => ({ ...message })), systemPrompt });
      onToken(responses[seen.length - 1] ?? '');
    };
    return { transport, seen };
  };

  it('runs commands and edits files on the computer, with the environment in the user message', async () => {
    const computer = fakeComputer({ [`${PROJECT}\\greeting.txt`]: 'hello\r\n', [`${PROJECT}\\AGENTS.md`]: 'Use two spaces.' });
    const approvals = scriptedApprovals('ask', ['once']);
    const native = await createSparkNativeRuntime({ host: computer.host, environment: await computer.host.environment(), projectPath: PROJECT, owner: 'task-1', approvals, now: new Date(2026, 9, 6), timezone: 'UTC' });
    const { transport, seen } = scripted([
      '*** Work Title: Updating the greeting\nChecking the repository first.\n*** Call: exec_command\n{"cmd":"git status --short"}\n*** End Call\n',
      'Updating the greeting now.\n*** Begin Patch\n*** Update File: greeting.txt\n@@\n-hello\n+hello, world\n*** End Patch\n',
      'The greeting is updated.\n*** Final Response\nI changed the greeting to "hello, world".',
    ]);
    const events = [];
    const result = await runSparkHarnessTurn({
      prompt: 'Change the greeting in greeting.txt to "hello, world".',
      model: MODEL,
      scope: 'native-test',
      capabilities: { skills: [], connectedApps: [] },
      native,
      transport,
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.reason, 'complete');
    assert.match(result.response, /hello, world/);
    assert.equal(computer.disk.get(`${PROJECT}\\greeting.txt`.toLowerCase()), 'hello, world\r\n');
    assert.deepEqual(computer.calls.filter(([kind]) => kind === 'exec').map(([, request]) => request.cmd), ['git status --short']);
    assert.equal(approvals.state.asked.length, 1);

    const firstUser = seen[0].messages.at(-1).content;
    assert.match(firstUser, /<environment_context>\n  <cwd>C:\\Users\\me\\Projects\\site<\/cwd>/);
    assert.match(firstUser, /<permissions instructions>/);
    assert.match(firstUser, /# AGENTS\.md instructions for C:\\Users\\me\\Projects\\site\n\n<INSTRUCTIONS>\nUse two spaces\.\n<\/INSTRUCTIONS>/);
    assert.match(seen[0].systemPrompt, /# Willow desktop runtime/);
    assert.match(seen[1].messages.at(-1).content, /Process exited with code 0/);
    assert.ok(events.some((event) => event.type === 'call-start' && event.call.kind === 'command' && event.call.shell === 'powershell'));
  });

  it('refuses a shell tool name by pointing at exec_command', async () => {
    const computer = fakeComputer();
    const native = await createSparkNativeRuntime({ host: computer.host, environment: await computer.host.environment(), projectPath: null, owner: 'task-2', approvals: scriptedApprovals('full') });
    const { transport, seen } = scripted([
      '*** Work Title: Listing the home folder\nListing files.\n*** Call: shell\n{"command":["ls"]}\n*** End Call\n',
      '*** Final Response\nDone.',
    ]);
    await runSparkHarnessTurn({ prompt: 'List my home folder and tell me what is there.', model: MODEL, scope: 'native-test-2', capabilities: { skills: [], connectedApps: [] }, native, transport, onEvent: () => {} });
    assert.match(seen[1].messages.at(-1).content, /ERROR shell: Commands run through `exec_command`/);
    assert.match(seen[0].messages.at(-1).content, /<cwd>C:\\Users\\me<\/cwd>/);
  });

  it('declares the terminal as function tools, and runs a function call through approval', async () => {
    const computer = fakeComputer();
    const approvals = scriptedApprovals('ask', ['once']);
    const native = await createSparkNativeRuntime({ host: computer.host, environment: await computer.host.environment(), projectPath: PROJECT, owner: 'task-4', approvals });
    let declared = [];
    let observation;
    const transport = async (_messages, options, onToken, _onStart, _systemPrompt, _onPhase, onToolCall) => {
      if (!observation) {
        declared = options.toolDeclarations.flatMap((group) => group.functionDeclarations.map((declaration) => declaration.name));
        observation = await onToolCall('exec_command', { cmd: 'npm test', justification: 'Run the tests?' });
        onToken('*** Work Title: Running the tests\nThe tests ran.\n*** Final Response\nThe tests passed.');
        return;
      }
      onToken('*** Final Response\nDone.');
    };
    const result = await runSparkHarnessTurn({ prompt: 'Run the tests in this project.', model: MODEL, scope: 'native-test-4', capabilities: { skills: [], connectedApps: [] }, native, transport, onEvent: () => {} });

    for (const name of ['exec_command', 'write_stdin', 'read_file', 'list_files', 'search_files', 'get_goal']) assert.ok(declared.includes(name), name);
    assert.equal(observation.status, 'success');
    assert.match(observation.result, /^Chunk ID: a1b2c3\n[\s\S]*Process exited with code 0/);
    assert.equal(approvals.state.asked[0].justification, 'Run the tests?');
    assert.deepEqual(computer.calls.filter(([kind]) => kind === 'exec').map(([, request]) => request.cmd), ['npm test']);
    assert.match(result.response, /The tests passed/);
  });

  const callNatively = async (options, onToolCall, name, args) => {
    options.onToolCallStart?.(name, args);
    await onToolCall(name, args);
  };

  it('keeps each function-call round its own timeline row, and answers with the last round when the marker is missing', async () => {
    const computer = fakeComputer();
    const native = await createSparkNativeRuntime({ host: computer.host, environment: await computer.host.environment(), projectPath: null, owner: 'task-5', approvals: scriptedApprovals('full') });
    let requests = 0;
    const transport = async (_messages, options, onToken, _onStart, _systemPrompt, _onPhase, onToolCall) => {
      requests += 1;
      onToken('*** Work Title: Installing T3 Code\nSearching for the T3 Code package in winget.');
      await callNatively(options, onToolCall, 'exec_command', { cmd: 'winget search t3' });
      onToken('Running the official T3 Code installer script.');
      await callNatively(options, onToolCall, 'exec_command', { cmd: 'irm https://t3.codes/install.ps1 | iex' });
      onToken('T3 Code is installed. Run `t3` to start it.');
    };
    const events = [];
    const result = await runSparkHarnessTurn({ prompt: 'Install T3 Code on my computer.', model: MODEL, scope: 'native-test-5', capabilities: { skills: [], connectedApps: [] }, native, transport, onEvent: (event) => events.push(event) });

    assert.equal(requests, 1);
    assert.equal(result.response, 'T3 Code is installed. Run `t3` to start it.');
    assert.deepEqual(events.filter((event) => event.type === 'work-log').map((event) => event.text), [
      'Searching for the T3 Code package in winget.',
      'Running the official T3 Code installer script.',
    ]);
  });

  it('shows a later round of the turn the calls the provider already ran, with their results', async () => {
    const computer = fakeComputer();
    const native = await createSparkNativeRuntime({ host: computer.host, environment: await computer.host.environment(), projectPath: null, owner: 'task-7', approvals: scriptedApprovals('full') });
    const seen = [];
    const transport = async (messages, options, onToken, _onStart, _systemPrompt, _onPhase, onToolCall) => {
      seen.push(messages.map((message) => ({ ...message })));
      if (seen.length > 1) {
        onToken('*** Final Response\nT3 Code is installed. Run `t3` to start it.');
        return;
      }
      onToken('*** Work Title: Installing T3 Code\nSearching for the T3 Code package in winget.');
      await callNatively(options, onToolCall, 'exec_command', { cmd: 'winget search t3' });
      onToken('Running the official T3 Code installer script.');
      await callNatively(options, onToolCall, 'exec_command', { cmd: 'irm https://t3.codes/install.ps1 | iex' });
      onToken('Looking for the installed files.\n*** Call: list_files\n{"path":"."}\n*** End Call\n');
    };
    const events = [];
    const result = await runSparkHarnessTurn({ prompt: 'Install T3 Code on my computer.', model: MODEL, scope: 'native-test-7', capabilities: { skills: [], connectedApps: [] }, native, transport, onEvent: (event) => events.push(event) });

    assert.equal(seen.length, 2);
    assert.equal(result.response, 'T3 Code is installed. Run `t3` to start it.');
    assert.deepEqual(events.filter((event) => event.type === 'work-log').map((event) => event.text), [
      'Searching for the T3 Code package in winget.',
      'Running the official T3 Code installer script.',
      'Looking for the installed files.',
    ]);
    const [assistant, user] = seen[1].slice(-2);
    assert.equal(
      assistant.content,
      '*** Work Title: Installing T3 Code\nSearching for the T3 Code package in winget.\n\n' +
        '*** Call: exec_command\n{"cmd":"winget search t3"}\n*** End Call\n' +
        'Running the official T3 Code installer script.\n\n' +
        '*** Call: exec_command\n{"cmd":"irm https://t3.codes/install.ps1 | iex"}\n*** End Call\n' +
        'Looking for the installed files.\n*** Call: list_files\n{"path":"."}\n*** End Call\n',
    );
    assert.match(user.content, /ran winget search t3\n[\s\S]*\n---\n[\s\S]*ran irm https:\/\/t3\.codes\/install\.ps1 \| iex\n[\s\S]*\n---\n/);
    assert.doesNotMatch(user.content, /Final Response/);
  });

  it('keeps a long native result short when it is replayed', async () => {
    const computer = fakeComputer();
    computer.host.execStart = async () => ({ chunkId: 'a1', wallTimeMs: 1, exitCode: 0, sessionId: null, originalTokenCount: null, output: '', text: `start ${'x'.repeat(20_000)} end` });
    const native = await createSparkNativeRuntime({ host: computer.host, environment: await computer.host.environment(), projectPath: null, owner: 'task-6', approvals: scriptedApprovals('full') });
    const seen = [];
    const transport = async (messages, options, onToken, _onStart, _systemPrompt, _onPhase, onToolCall) => {
      seen.push(messages.map((message) => ({ ...message })));
      if (seen.length > 1) {
        onToken('*** Final Response\nDone.');
        return;
      }
      onToken('*** Work Title: Reading the log\nPrinting the log.');
      await callNatively(options, onToolCall, 'exec_command', { cmd: 'type big.log' });
      onToken('Listing the folder beside it.\n*** Call: list_files\n{"path":"."}\n*** End Call\n');
    };
    await runSparkHarnessTurn({ prompt: 'Print my big log file.', model: MODEL, scope: 'native-test-6', capabilities: { skills: [], connectedApps: [] }, native, transport, onEvent: () => {} });

    const replayed = seen[1].at(-1).content;
    assert.match(replayed, /^start x{2994}\n…16010 characters omitted…\nx{996} end/);
    assert.ok(replayed.length < 5_000);
  });

  it('declares no terminal on the web', async () => {
    let declared = [];
    const transport = async (_messages, options, onToken) => {
      declared = options.toolDeclarations.flatMap((group) => group.functionDeclarations.map((declaration) => declaration.name));
      onToken('*** Final Response\nDone.');
    };
    await runSparkHarnessTurn({
      prompt: 'Summarise the workspace.',
      model: MODEL,
      scope: 'web-test',
      capabilities: { skills: [], connectedApps: [] },
      workspace: { readFiles: async () => ({}), writeFiles: async () => {} },
      transport,
      onEvent: () => {},
    });
    assert.ok(declared.includes('get_goal'));
    assert.equal(declared.includes('exec_command'), false);
  });

  it('will not start in a project folder that no longer exists', async () => {
    const computer = fakeComputer();
    await assert.rejects(
      createSparkNativeRuntime({ host: computer.host, environment: await computer.host.environment(), projectPath: 'C:\\gone', owner: 'task-3', approvals: scriptedApprovals('ask') }),
      NativeFolderMissingError,
    );
  });
});
