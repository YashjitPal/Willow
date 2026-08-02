/** Worker-isolated JavaScript execution for function and Code Interpreter tools. */

import { Worker } from 'node:worker_threads';
import type { JsonObject, JsonValue } from '../domain/types.ts';

export interface SandboxResult {
  result: JsonValue;
  logs: string[];
}

type SandboxRequest =
  | { kind: 'function'; code: string; args: JsonObject; timeoutMs: number }
  | { kind: 'interpreter'; code: string; files: Array<{ name: string; content: string; mimeType?: string }>; timeoutMs: number };

interface WorkerFailure {
  error: { name?: string; message: string; stack?: string };
}

function rejectUnsafeConstructors(code: string): void {
  const normalized = code.replace(/\s+/g, '');
  if (/(?:\.constructor){2,}/.test(normalized)
    || /(?:^|[^\w$])(Function|AsyncFunction|GeneratorFunction|eval)\s*\(/.test(code)
    || /constructor\s*\(\s*["'`]/.test(code)) {
    throw new Error('Code generation and host constructors are not available in the sandbox');
  }
}

function abortError(): Error {
  const error = new Error('sandbox execution aborted');
  error.name = 'AbortError';
  return error;
}

function runInWorker(request: SandboxRequest, signal?: AbortSignal): Promise<SandboxResult> {
  if (signal?.aborted) return Promise.reject(abortError());
  try { rejectUnsafeConstructors(request.code); } catch (error) { return Promise.reject(error); }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sandboxWorker.ts', import.meta.url), { workerData: request });
    let settled = false;
    const timeoutMs = Math.max(100, request.timeoutMs);

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const timer = setTimeout(
      () => finish(() => reject(new Error(`sandbox execution timed out after ${timeoutMs}ms`))),
      timeoutMs,
    );

    signal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (message: SandboxResult | WorkerFailure) => {
      if ('error' in message) {
        const error = new Error(message.error.message);
        error.name = message.error.name ?? 'Error';
        if (message.error.stack) error.stack = message.error.stack;
        finish(() => reject(error));
      } else {
        finish(() => resolve(message));
      }
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(() => reject(new Error(`sandbox worker exited with code ${code}`)));
    });
  });
}

export function runFunctionCode(
  code: string,
  args: JsonObject,
  timeoutMs = 5000,
  signal?: AbortSignal,
): Promise<SandboxResult> {
  return runInWorker({ kind: 'function', code, args: structuredClone(args), timeoutMs }, signal);
}

export function runInterpreterCode(
  code: string,
  timeoutMs = 5000,
  attachedFiles: Array<{ name: string; content: string; mimeType?: string }> = [],
  signal?: AbortSignal,
): Promise<SandboxResult> {
  return runInWorker({ kind: 'interpreter', code, files: structuredClone(attachedFiles), timeoutMs }, signal);
}
