import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runToolWithPolicy } from '../src/engine/toolExecution.ts';

describe('tool execution policy', () => {
  it('retries transient failures with attempt visibility', async () => {
    const attempts: number[] = [];
    const retries: number[] = [];
    const result = await runToolWithPolicy({
      signal: new AbortController().signal,
      timeoutMs: 1000,
      maxRetries: 2,
      retryBackoffMs: 1,
      onAttempt: (attempt) => { attempts.push(attempt); },
      onRetry: (attempt) => { retries.push(attempt); },
      execute: async (_signal, attempt) => {
        if (attempt < 3) throw new Error('function endpoint HTTP 503: unavailable');
        return 'ok';
      },
    });
    assert.equal(result.value, 'ok');
    assert.equal(result.attempts, 3);
    assert.deepEqual(attempts, [1, 2, 3]);
    assert.deepEqual(retries, [1, 2]);
  });

  it('does not retry application failures', async () => {
    let attempts = 0;
    await assert.rejects(runToolWithPolicy({
      signal: new AbortController().signal,
      timeoutMs: 1000,
      maxRetries: 5,
      retryBackoffMs: 0,
      execute: async () => {
        attempts++;
        throw new Error('invalid tool arguments');
      },
    }), /invalid tool arguments/);
    assert.equal(attempts, 1);
  });

  it('enforces attempt timeouts', async () => {
    await assert.rejects(runToolWithPolicy({
      signal: new AbortController().signal,
      timeoutMs: 100,
      maxRetries: 0,
      retryBackoffMs: 0,
      execute: (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    }), /timed out|timeout|aborted/i);
  });

  it('does not start a tool cancelled during attempt bookkeeping', async () => {
    const controller = new AbortController();
    const reason = new Error('run cancelled');
    let executions = 0;

    await assert.rejects(runToolWithPolicy({
      signal: controller.signal,
      timeoutMs: 1000,
      maxRetries: 2,
      retryBackoffMs: 0,
      onAttempt: async () => {
        await Promise.resolve();
        controller.abort(reason);
      },
      execute: async () => {
        executions++;
        return 'must not run';
      },
    }), (error) => error === reason);

    assert.equal(executions, 0);
  });
});
