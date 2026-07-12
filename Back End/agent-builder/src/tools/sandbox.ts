/**
 * JS sandbox for function tools ("js" execution mode) and the Code
 * Interpreter tool. Runs user code in a `node:vm` context with:
 *   - wall-clock timeout
 *   - no require/process/import access
 *   - captured console output
 *
 * NOTE: node:vm is an isolation convenience, not a hard security boundary.
 * This service is designed to run locally for a single user (the same person
 * who authored the code). Do not expose it to untrusted multi-tenant input.
 */

import vm from 'node:vm';
import type { JsonObject, JsonValue } from '../domain/types.ts';

export interface SandboxResult {
  result: JsonValue;
  logs: string[];
}

function makeConsole(logs: string[]) {
  const push = (level: string) => (...args: unknown[]) => {
    const line = args
      .map((a) => {
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
    logs.push(level === 'log' ? line : `[${level}] ${line}`);
    if (logs.length > 500) logs.splice(0, logs.length - 500);
  };
  return {
    log: push('log'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    debug: push('debug'),
  };
}

function toJsonValue(v: unknown): JsonValue {
  if (v === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(v)) as JsonValue;
  } catch {
    return String(v);
  }
}

/**
 * Run a function-tool body. The code may be either:
 *   - a full function expression:  `(args) => ...` or `function(args) {...}`
 *   - a bare body that can reference `args` and `return`
 */
export async function runFunctionCode(
  code: string,
  args: JsonObject,
  timeoutMs = 5000,
): Promise<SandboxResult> {
  const logs: string[] = [];
  const context = vm.createContext(
    {
      console: makeConsole(logs),
      JSON,
      Math,
      args: structuredClone(args),
    },
    { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' },
  );

  const trimmed = code.trim();
  const looksLikeFn =
    /^(async\s+)?(function\b|\()/.test(trimmed) || /^\s*\w+\s*=>/.test(trimmed);
  const script = looksLikeFn
    ? `(${trimmed})(args)`
    : `(function(args) { ${code}\n })(args)`;

  const raw = vm.runInContext(script, context, {
    timeout: Math.max(100, timeoutMs),
    displayErrors: true,
  });

  // Support async code with a bounded wait.
  let value: unknown = raw;
  if (raw && typeof (raw as Promise<unknown>).then === 'function') {
    value = await Promise.race([
      raw as Promise<unknown>,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('sandbox async timeout')), timeoutMs),
      ),
    ]);
  }
  return { result: toJsonValue(value), logs };
}

/**
 * Run Code Interpreter style code: a JS snippet whose last expression (or an
 * explicit `result` variable / return) is the output. Console output is
 * captured and returned alongside.
 */
export async function runInterpreterCode(
  code: string,
  timeoutMs = 5000,
): Promise<SandboxResult> {
  const logs: string[] = [];
  const context = vm.createContext(
    {
      console: makeConsole(logs),
      JSON,
      Math,
    },
    { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' },
  );
  const script = `(function() { ${code}\n })()`;
  let raw: unknown;
  try {
    raw = vm.runInContext(script, context, {
      timeout: Math.max(100, timeoutMs),
      displayErrors: true,
    });
  } catch (e) {
    // Retry as an expression (lets users write `1 + 1` directly).
    try {
      raw = vm.runInContext(`(${code})`, context, {
        timeout: Math.max(100, timeoutMs),
        displayErrors: true,
      });
    } catch {
      throw e;
    }
  }
  let value: unknown = raw;
  if (raw && typeof (raw as Promise<unknown>).then === 'function') {
    value = await Promise.race([
      raw as Promise<unknown>,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('sandbox async timeout')), timeoutMs),
      ),
    ]);
  }
  if (value === undefined && logs.length) {
    return { result: logs.join('\n'), logs };
  }
  return { result: toJsonValue(value), logs };
}
