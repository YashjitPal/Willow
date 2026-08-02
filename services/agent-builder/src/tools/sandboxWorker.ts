import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import type { JsonObject, JsonValue } from '../domain/types.ts';

type SandboxRequest =
  | { kind: 'function'; code: string; args: JsonObject; timeoutMs: number }
  | { kind: 'interpreter'; code: string; files: Array<{ name: string; content: string; mimeType?: string }>; timeoutMs: number };

const request = workerData as SandboxRequest;
const logs: string[] = [];
const MAX_LOG_ENTRIES = 500;
const MAX_LOG_LINE_CHARS = 8 * 1024;
const MAX_LOG_TOTAL_CHARS = 64 * 1024;
const LOG_TRUNCATED_SUFFIX = '...[truncated]';
let logChars = 0;

// Reject common host-escape gadgets before evaluating user code. VM string
// code-generation guards are still enabled, but these expressions can cross
// realm boundaries through values supplied by the host and may otherwise hang
// while resolving an escaped constructor.
function rejectUnsafeConstructors(code: string): void {
  const normalized = code.replace(/\s+/g, '');
  if (/(?:\.constructor){2,}/.test(normalized)
    || /(?:^|[^\w$])(Function|AsyncFunction|GeneratorFunction|eval)\s*\(/.test(code)
    || /constructor\s*\(\s*["'`]/.test(code)) {
    throw new Error('Code generation and host constructors are not available in the sandbox');
  }
}

function hardenCallable<T extends (...args: never[]) => unknown>(callback: T): T {
  Object.setPrototypeOf(callback, null);
  return Object.freeze(callback);
}

const pushLog = (level: string) => (...args: unknown[]) => {
  if (logs.length >= MAX_LOG_ENTRIES || logChars >= MAX_LOG_TOTAL_CHARS) return;
  let line = args.map((value) => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(' ');
  line = level === 'log' ? line : `[${level}] ${line}`;
  const remaining = MAX_LOG_TOTAL_CHARS - logChars;
  const limit = Math.min(MAX_LOG_LINE_CHARS, remaining);
  if (line.length > limit) {
    line = limit > LOG_TRUNCATED_SUFFIX.length
      ? `${line.slice(0, limit - LOG_TRUNCATED_SUFFIX.length)}${LOG_TRUNCATED_SUFFIX}`
      : line.slice(0, limit);
  }
  logs.push(line);
  logChars += line.length;
};

const sandboxConsole = Object.freeze(Object.assign(Object.create(null) as Record<string, unknown>, {
  log: hardenCallable(pushLog('log')), info: hardenCallable(pushLog('info')),
  warn: hardenCallable(pushLog('warn')), error: hardenCallable(pushLog('error')),
  debug: hardenCallable(pushLog('debug')),
}));

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try { return JSON.parse(JSON.stringify(value)) as JsonValue; } catch { return String(value); }
}

async function execute(): Promise<{ result: JsonValue; logs: string[] }> {
  const timeout = Math.max(100, request.timeoutMs);
  rejectUnsafeConstructors(request.code);
  if (request.kind === 'function') {
    const argsJson = JSON.stringify(request.args);
    const context = vm.createContext(
      {
        console: sandboxConsole,
        setTimeout: hardenCallable(setTimeout),
        clearTimeout: hardenCallable(clearTimeout),
      },
      { codeGeneration: { strings: false, wasm: false } },
    );
    vm.runInContext(`globalThis.args = JSON.parse(${JSON.stringify(argsJson)})`, context, { timeout });
    const trimmed = request.code.trim();
    const looksLikeFn = /^(async\s+)?(function\b|\()/.test(trimmed) || /^\s*\w+\s*=>/.test(trimmed);
    const script = looksLikeFn ? `(${trimmed})(args)` : `(function(args) { ${request.code}\n })(args)`;
    const value = await vm.runInContext(script, context, { timeout, displayErrors: true });
    return { result: toJsonValue(value), logs };
  }

  const filesJson = JSON.stringify(Object.fromEntries(request.files.map((file) => [file.name, {
    name: file.name, content: file.content, mimeType: file.mimeType ?? 'text/plain',
  }])));
  let fileMap: Record<string, { name: string; content: string; mimeType: string }>;
  const listFiles = hardenCallable(() => Object.keys(fileMap));
  const readFile = hardenCallable((name: string) => {
    const file = fileMap[name];
    if (!file) throw new Error(`attached file '${name}' not found`);
    return file.content;
  });
  const context = vm.createContext({
    console: sandboxConsole,
    setTimeout: hardenCallable(setTimeout),
    clearTimeout: hardenCallable(clearTimeout),
    listFiles,
    readFile,
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`globalThis.files = Object.freeze(JSON.parse(${JSON.stringify(filesJson)}))`, context, { timeout });
  fileMap = vm.runInContext('files', context) as typeof fileMap;
  let value: unknown;
  try {
    value = await vm.runInContext(`(function() { ${request.code}\n })()`, context, { timeout, displayErrors: true });
  } catch (error) {
    try {
      value = await vm.runInContext(`(${request.code})`, context, { timeout, displayErrors: true });
    } catch {
      throw error;
    }
  }
  return { result: value === undefined && logs.length ? logs.join('\n') : toJsonValue(value), logs };
}

execute().then(
  (result) => parentPort?.postMessage(result),
  (error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    parentPort?.postMessage({ error: { name: err.name, message: err.message, stack: err.stack } });
  },
);
