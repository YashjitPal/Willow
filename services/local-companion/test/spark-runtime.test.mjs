import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, it } from 'node:test';
import {
  clampExecYield,
  clampStdinYield,
  createSparkRuntime,
  formatExecResponse,
  truncateOutput,
} from '../src/spark-runtime.mjs';

const runtime = createSparkRuntime();
const windows = process.platform === 'win32';
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'willow-spark-runtime-'));

after(async () => {
  runtime.dispose();
  // A killed shell can hold the folder for a moment on Windows.
  await fs.rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

it("clamps yields the way Codex's unified exec does", () => {
  assert.equal(clampExecYield(undefined, 'linux'), 10_000);
  assert.equal(clampExecYield(100, 'linux'), 250);
  assert.equal(clampExecYield(60_000, 'linux'), 30_000);
  assert.equal(clampExecYield(2_000, 'win32'), 10_000);
  assert.equal(clampStdinYield(undefined, 'x'), 250);
  assert.equal(clampStdinYield(undefined, ''), 5_000);
  assert.equal(clampStdinYield(600_000, ''), 300_000);
});

it("truncates the middle of long output under Codex's warning", () => {
  const long = `${'a'.repeat(30)}\n${'b'.repeat(30)}\n`;
  const { text, truncated, originalTokenCount } = truncateOutput(long, 4);
  assert.equal(truncated, true);
  assert.equal(originalTokenCount, 16);
  assert.match(text, /^Warning: truncated output \(original token count: 16\)\nTotal output lines: 2\n\n/);
  assert.match(text, /…\d+ tokens truncated…/);
  assert.equal(truncateOutput('short', 10).text, 'short');
});

it('formats a response with the header lines Codex sends', () => {
  assert.equal(
    formatExecResponse({ chunkId: 'abc123', wallTimeMs: 1500, exitCode: 0, sessionId: null, originalTokenCount: null, output: 'hi\n' }),
    'Chunk ID: abc123\nWall time: 1.5000 seconds\nProcess exited with code 0\nOutput:\nhi\n',
  );
  assert.equal(
    formatExecResponse({ chunkId: '', wallTimeMs: 10, exitCode: null, sessionId: 4, originalTokenCount: 99, output: '' }),
    'Wall time: 0.0100 seconds\nProcess running with session ID 4\nOriginal token count: 99\nOutput:\n',
  );
});

it('runs a command to completion in the working directory', async () => {
  const command = windows ? 'Write-Output "hello from $((Get-Location).Path)"' : 'echo "hello from $(pwd)"';
  const response = await runtime.handle('spark.exec.start', { cmd: command, workdir: scratch, yieldTimeMs: 250 });
  assert.equal(response.exitCode, 0);
  assert.equal(response.sessionId, null);
  assert.match(response.output, /hello from /);
  assert.ok(response.output.toLowerCase().includes(path.basename(scratch).toLowerCase()));
  assert.match(response.text, /Process exited with code 0\nOutput:\nhello from /);
});

it('returns errors as plain text and keeps quoting intact', async () => {
  const command = windows
    ? `Write-Output "a & b | c"; Write-Output 'it''s here'; Write-Error "boom"`
    : `echo "a & b | c"; echo 'it'"'"'s here'; echo boom >&2`;
  const response = await runtime.handle('spark.exec.start', { cmd: command, workdir: scratch, yieldTimeMs: 250 });
  assert.match(response.output, /a & b \| c/);
  assert.match(response.output, /it's here/);
  assert.match(response.output, /boom/);
  assert.doesNotMatch(response.output, /CLIXML/);
});

it('reports a failing exit code', async () => {
  const response = await runtime.handle('spark.exec.start', { cmd: 'exit 3', workdir: scratch, yieldTimeMs: 250 });
  assert.equal(response.exitCode, 3);
});

it('finishes a command once it exits, even while something it started holds the output open', { timeout: 60_000 }, async () => {
  const response = await runtime.handle('spark.exec.start', {
    cmd: windows ? 'start /b ping -n 13 127.0.0.1 & echo started' : '(sleep 12) & echo started',
    ...(windows ? { shell: 'cmd' } : {}),
    workdir: os.tmpdir(),
    yieldTimeMs: 10_000,
  });
  assert.equal(response.exitCode, 0);
  assert.equal(response.sessionId, null);
  assert.match(response.output, /started/);
  assert.ok(response.wallTimeMs < 5_000, `took ${response.wallTimeMs} ms`);
});

it('keeps a long-running command as a session that write_stdin can drive', { timeout: 60_000 }, async () => {
  const command = windows
    ? '$line = [Console]::In.ReadLine(); Write-Output "got:$line"'
    : 'read line; echo "got:$line"';
  const started = await runtime.handle('spark.exec.start', { cmd: command, workdir: scratch, yieldTimeMs: 250, owner: 'task-1' });
  assert.equal(started.exitCode, null);
  assert.equal(typeof started.sessionId, 'number');
  assert.match(started.text, /Process running with session ID \d+/);
  const listed = runtime.handle('spark.exec.list', {});
  assert.ok(listed.sessions.some((session) => session.sessionId === started.sessionId && session.owner === 'task-1'));
  const answered = await runtime.handle('spark.exec.write', { sessionId: started.sessionId, chars: 'hi\n', yieldTimeMs: 3_000 });
  assert.match(answered.output, /got:hi/);
  assert.equal(answered.exitCode, 0);
  await assert.rejects(() => runtime.handle('spark.exec.write', { sessionId: started.sessionId, chars: '' }), /Unknown session id/);
});

it('stops every session a task owns', { timeout: 60_000 }, async () => {
  const command = windows ? 'Start-Sleep -Seconds 60' : 'sleep 60';
  const started = await runtime.handle('spark.exec.start', { cmd: command, workdir: scratch, yieldTimeMs: 250, owner: 'task-2' });
  assert.equal(typeof started.sessionId, 'number');
  assert.deepEqual(runtime.handle('spark.exec.kill', { owner: 'task-2' }), { killed: 1 });
  assert.ok(!runtime.handle('spark.exec.list', {}).sessions.some((session) => session.owner === 'task-2'));
});

it('reads, writes, lists, searches and deletes files by absolute path', async () => {
  const file = path.join(scratch, 'nested', 'notes.txt');
  const written = await runtime.handle('spark.fs.write', { path: file, text: 'first line\nneedle here\n' });
  assert.equal(written.size, 23);
  const read = await runtime.handle('spark.fs.read', { path: file });
  assert.equal(read.text, 'first line\nneedle here\n');
  const many = await runtime.handle('spark.fs.read', { paths: [file, path.join(scratch, 'missing.txt')] });
  assert.deepEqual(many.files.map((entry) => entry.exists), [true, false]);
  const stat = await runtime.handle('spark.fs.stat', { path: file });
  assert.equal(stat.isFile, true);
  const listing = await runtime.handle('spark.fs.list', { path: scratch, depth: 2 });
  assert.ok(listing.entries.some((entry) => entry.path === 'nested/notes.txt' && entry.type === 'file'));
  const found = await runtime.handle('spark.fs.search', { path: scratch, query: 'needle' });
  assert.deepEqual(found.matches.map((match) => [match.path, match.line]), [['nested/notes.txt', 2]]);
  await assert.rejects(() => runtime.handle('spark.fs.read', { path: 'relative.txt' }), /must be absolute/);
  assert.equal((await runtime.handle('spark.fs.delete', { path: file })).removed, true);
  assert.equal((await runtime.handle('spark.fs.read', { path: file })).exists, false);
});

it('describes the computer it runs on', () => {
  const environment = runtime.handle('spark.env', {});
  assert.equal(environment.home, os.homedir());
  assert.equal(environment.platform, process.platform);
  assert.ok(environment.shell.path);
});
