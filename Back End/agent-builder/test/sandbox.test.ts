import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runFunctionCode, runInterpreterCode } from '../src/tools/sandbox.ts';

describe('sandbox worker isolation', () => {
  it('executes function and interpreter code with the existing contract', async () => {
    assert.deepEqual(await runFunctionCode('return args.value * 2', { value: 4 }), { result: 8, logs: [] });
    assert.deepEqual(await runInterpreterCode('console.log(readFile("note.txt")); return listFiles()', 1000, [
      { name: 'note.txt', content: 'hello' },
    ]), { result: ['note.txt'], logs: ['hello'] });
  });

  it('does not block the engine event loop for CPU-bound code', async () => {
    let timerFired = false;
    const timer = setTimeout(() => { timerFired = true; }, 20);
    await assert.rejects(runFunctionCode('while (true) {}', {}, 150), /timed out/);
    clearTimeout(timer);
    assert.equal(timerFired, true);
  });

  it('terminates an in-flight worker when the run is aborted', async () => {
    const controller = new AbortController();
    const execution = runFunctionCode('while (true) {}', {}, 10_000, controller.signal);
    setTimeout(() => controller.abort(), 25);
    await assert.rejects(execution, (error: Error) => error.name === 'AbortError');
  });

  it('does not expose host Function constructors through sandbox values', async () => {
    const probes = [
      'args.constructor.constructor("return process")()',
      'console.log.constructor("return process")()',
      'setTimeout.constructor("return process")()',
    ];
    for (const probe of probes) {
      await assert.rejects(runFunctionCode(`return ${probe}`, { value: 1 }), /Code generation|constructor|not a function/);
    }

    for (const probe of [
      'files.constructor.constructor("return process")()',
      'readFile.constructor("return process")()',
      'listFiles.constructor("return process")()',
    ]) {
      await assert.rejects(
        runInterpreterCode(`return ${probe}`, 1000, [{ name: 'note.txt', content: 'hello' }]),
        /Code generation|constructor|not a function/,
      );
    }
  });

  it('bounds individual and aggregate console output', async () => {
    const oneLargeLog = await runFunctionCode('console.log("x".repeat(100_000)); return "ok"', {});
    assert.equal(oneLargeLog.result, 'ok');
    assert.equal(oneLargeLog.logs.length, 1);
    assert.equal(oneLargeLog.logs[0]?.length, 8 * 1024);
    assert.match(oneLargeLog.logs[0] ?? '', /\.\.\.\[truncated\]$/);

    const manyLogs = await runFunctionCode(
      'for (let i = 0; i < 1000; i += 1) console.log("y".repeat(1000)); return "ok"',
      {},
    );
    assert.equal(manyLogs.result, 'ok');
    assert.ok(manyLogs.logs.length < 500);
    assert.ok(manyLogs.logs.reduce((total, line) => total + line.length, 0) <= 64 * 1024);
  });
});
