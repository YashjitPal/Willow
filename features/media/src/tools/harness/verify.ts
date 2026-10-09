/**
 * Checking a tool the way the user is about to see it: the Code harness's check
 * (`features/code/src/harness/verify.ts`), forked for Flow's tool runtime.
 *
 * - **Build.** Flow's compiler (`runtime/compiler.ts`): esbuild over the tool's files, every
 *   package external. Errors come back with file and line.
 * - **Runtime.** The bundle runs in a hidden frame through the real runner (`runtime/bridge.ts`),
 *   with a stand-in for the SDK's host: storage reads empty, picks come back cancelled, and
 *   generation refuses, so a check never spends anything. The frame's origin is opaque, so a
 *   probe inside it reports console lines and an outline of what rendered. A frame that never
 *   mounted or failed in time (offline, CDN down) is reported as skipped, not as an app error.
 *
 * The report shape and its formatting are the Code harness's, unchanged.
 */

export interface CheckMessage {
  file?: string;
  line?: number;
  column?: number;
  text: string;
}

export interface CheckReport {
  buildErrors: CheckMessage[];
  runtimeErrors: string[];
  warnings: string[];
  /** Console lines the app printed, most recent last. */
  console: string[];
  /** A text outline of what rendered, when the runtime check ran. */
  outline?: string;
  /** Set when a layer could not run, with the reason. */
  skipped?: string;
  durationMs: number;
}

export const reportHasErrors = (report: CheckReport): boolean =>
  report.buildErrors.length > 0 || report.runtimeErrors.length > 0;

export type ProjectChecker = (files: Record<string, string>, options?: { signal?: AbortSignal }) => Promise<CheckReport>;

const formatMessage = (message: CheckMessage): string => {
  const where = message.file ? `${message.file}${message.line ? `:${message.line}${message.column !== undefined ? `:${message.column}` : ''}` : ''}` : '';
  return where ? `${where} — ${message.text}` : message.text;
};

/** Short lines for the transcript step. */
export function summarizeCheck(report: CheckReport): { errors: string[]; warnings: string[] } {
  return {
    errors: [...report.buildErrors.map(formatMessage), ...report.runtimeErrors].slice(0, 8).map((line) => line.split('\n')[0]!.slice(0, 240)),
    warnings: report.warnings.slice(0, 8).map((line) => line.split('\n')[0]!.slice(0, 240)),
  };
}

/** The report as the model reads it. */
export function formatCheckReport(report: CheckReport, options: { includeOutline?: boolean } = {}): string {
  const lines: string[] = [];
  if (report.buildErrors.length > 0) {
    lines.push('Build: FAILED');
    for (const error of report.buildErrors.slice(0, 15)) lines.push(`- ${formatMessage(error)}`);
  } else {
    lines.push('Build: OK');
  }

  if (report.skipped) {
    lines.push(`Runtime: not checked (${report.skipped})`);
  } else if (report.buildErrors.length === 0) {
    if (report.runtimeErrors.length > 0) {
      lines.push('Runtime errors:');
      for (const error of report.runtimeErrors.slice(0, 10)) lines.push(`- ${error.slice(0, 1_200)}`);
    } else {
      lines.push('Runtime: no errors');
    }
  }

  if (report.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of report.warnings.slice(0, 10)) lines.push(`- ${warning.slice(0, 400)}`);
  }
  if (report.console.length > 0) {
    lines.push('Console (most recent last):');
    for (const entry of report.console.slice(-12)) lines.push(`  ${entry.slice(0, 300)}`);
  }
  if (options.includeOutline && report.outline) {
    lines.push('What rendered:', report.outline);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------------ */
/* The tool checker                                                          */
/* ------------------------------------------------------------------------ */

const PROBE = 'WILLOW_PROBE';
const LOAD_TIMEOUT_MS = 15_000;
const SETTLE_MS = 900;
const OUTLINE_TIMEOUT_MS = 800;

/** Console capture, and an outline of #root on request. Runs first in the frame. */
const PROBE_SCRIPT = `(function () {
  function send(kind, message) {
    try { parent.postMessage({ type: '${PROBE}', kind: kind, message: String(message).slice(0, 4000) }, '*'); } catch (e) {}
  }
  function format(args) {
    return Array.prototype.map.call(args, function (value) {
      if (value instanceof Error) return value.stack || value.message;
      if (value && typeof value === 'object') { try { return JSON.stringify(value).slice(0, 500); } catch (e) { return String(value); } }
      return String(value);
    }).join(' ');
  }
  ['error', 'warn', 'log', 'info'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      send('console-' + level, format(arguments));
      return original.apply(console, arguments);
    };
  });
  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== '${PROBE}_OUTLINE') return;
    var root = document.getElementById('root');
    var empty = !root || (root.childElementCount === 0 && !(root.textContent || '').trim());
    var outline = '';
    if (empty) outline = 'Nothing rendered: #root is empty.';
    else {
      var count = function (s) { return root.querySelectorAll(s).length; };
      var headings = Array.prototype.slice.call(root.querySelectorAll('h1, h2, h3'), 0, 12).map(function (h) { return h.tagName.toLowerCase() + ': ' + (h.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 90); });
      var text = ((root.innerText || root.textContent || '') + '').replace(/\\n{3,}/g, '\\n\\n').trim();
      var lines = [count('button') + ' buttons, ' + count('input, textarea, select') + ' inputs, ' + count('canvas') + ' canvases, ' + count('img') + ' images, ' + count('video') + ' videos.'];
      if (headings.length) lines.push('Headings: ' + headings.join(' | '));
      if (text) lines.push('Visible text (start): ' + text.slice(0, 1200));
      outline = lines.join('\\n');
    }
    try { parent.postMessage({ type: '${PROBE}_OUTLINE_RESULT', outline: outline, empty: empty }, '*'); } catch (e) {}
  });
})();`;

/** A short, readable first line of an error, without a 40-frame stack. */
const trimStack = (text: string): string => {
  const lines = text.split('\n');
  const head = lines[0]!;
  const frames = lines
    .slice(1)
    .filter((line) => /^\s*at /.test(line) && !/esm\.sh|data:|blob:|<anonymous>/.test(line))
    .slice(0, 3);
  return [head, ...frames].join('\n');
};

/** `src/App.tsx:12: Expected ";"` → file, line, text. */
function parseCompileError(error: string): CheckMessage {
  const match = /^([^:\s][^:]*?\.[a-z]+):(\d+): ([\s\S]*)$/i.exec(error);
  if (!match) return { text: error };
  return { file: `/${match[1]!.replace(/^\/+/, '')}`, line: Number(match[2]), text: match[3]! };
}

const checkingHost = () => {
  const refuse = async (): Promise<never> => {
    throw new Error('Generation is not available while Willow checks the tool.');
  };
  return {
    generateImage: refuse,
    generateVideo: refuse,
    generateText: refuse,
    saveMedia: async () => ({ id: 'check' }),
    selectMedia: async () => null,
    mediaBase64: refuse,
    storage: {
      getItem: async () => null,
      setItem: async () => undefined,
      removeItem: async () => undefined,
      clear: async () => undefined,
      keys: async () => [],
    },
    persistLocalStorage: () => undefined,
  };
};

/** One runtime probe at a time; two hidden frames racing for the CDN helps nobody. */
let probeQueue: Promise<unknown> = Promise.resolve();

type RuntimeResult = Pick<CheckReport, 'runtimeErrors' | 'warnings' | 'console' | 'outline' | 'skipped'>;

async function probeTool(
  files: { path: string; content: string }[],
  compiled: import('../runtime/compiler').CompileResult,
  signal?: AbortSignal,
): Promise<RuntimeResult> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { runtimeErrors: [], warnings: [], console: [], skipped: 'no browser to run it in' };
  }
  const { ToolRunner } = await import('../runtime/bridge');
  const runtimeErrors: string[] = [];
  const warnings: string[] = [];
  const consoleLines: string[] = [];
  const seen = new Set<string>();
  const isDuplicate = (text: string): boolean => {
    const key = text.split('\n')[0]!.replace(/^Unhandled Promise:\s*/i, '').replace(/^Uncaught\s+/i, '').replace(/^(?:[A-Z]\w*)?Error:\s*/, '').trim();
    if (!key) return true;
    if ([...seen].some((known) => known.includes(key) || key.includes(known))) return true;
    seen.add(key);
    return false;
  };

  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.setAttribute('data-willow-tool-probe', '');
  Object.assign(container.style, { position: 'fixed', left: '-12000px', top: '0', width: '1280px', height: '800px', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(container);

  let mounted = false;
  let failed = false;
  let settle: (() => void) | null = null;
  const done = new Promise<void>((resolve) => { settle = resolve; });
  const runner = new ToolRunner(container, checkingHost(), (event) => {
    if (event.type === 'app_mounted') { mounted = true; settle?.(); }
    if (event.type === 'runtime_error') {
      failed = true;
      if (!isDuplicate(event.error)) runtimeErrors.push(trimStack(event.stack && !event.stack.startsWith(event.error) ? `${event.error}\n${event.stack}` : event.error));
      settle?.();
    }
    if (event.type === 'csp_violation') warnings.push(`Blocked by the tool's Content Security Policy: ${event.blockedURI} (${event.effectiveDirective}). Only esm.sh, unpkg, jsDelivr, cdnjs, Hugging Face and Google Fonts can be reached; AI goes through flow-sdk.`);
  });
  let outlineReply: ((value: { outline: string; empty: boolean }) => void) | null = null;
  const onMessage = (event: MessageEvent) => {
    if (!runner.iframe || event.source !== runner.iframe.contentWindow) return;
    const data = event.data as { type?: string; kind?: string; message?: string; outline?: string; empty?: boolean } | null;
    if (!data) return;
    if (data.type === `${PROBE}_OUTLINE_RESULT`) { outlineReply?.({ outline: String(data.outline ?? ''), empty: !!data.empty }); return; }
    if (data.type !== PROBE) return;
    const text = String(data.message ?? '').trim();
    if (!text || /^Download the React DevTools|cdn\.tailwindcss\.com should not be used in production/.test(text)) return;
    if (data.kind === 'console-error') {
      if (/^Warning: /.test(text)) warnings.push(text.split('\n')[0]!.replace(/%s/g, '…'));
      else consoleLines.push(`error: ${text.split('\n')[0]}`);
    } else if (data.kind === 'console-warn') consoleLines.push(`warn: ${text.split('\n')[0]}`);
    else consoleLines.push(text.split('\n')[0]!);
  };
  window.addEventListener('message', onMessage);
  const onAbort = () => settle?.();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await runner.run(files, {}, { compiled, probeScript: PROBE_SCRIPT });
    const timer = window.setTimeout(() => settle?.(), LOAD_TIMEOUT_MS);
    await done;
    window.clearTimeout(timer);
    if (signal?.aborted) return { runtimeErrors: [], warnings, console: consoleLines, skipped: 'cancelled' };
    if (!mounted && !failed) return { runtimeErrors: [], warnings, console: consoleLines, skipped: 'the tool did not finish loading in time' };
    await new Promise((resolve) => window.setTimeout(resolve, SETTLE_MS));
    let outline: string | undefined;
    const frame = runner.iframe?.contentWindow;
    if (frame) {
      const reply = await new Promise<{ outline: string; empty: boolean } | null>((resolve) => {
        outlineReply = resolve;
        window.setTimeout(() => resolve(null), OUTLINE_TIMEOUT_MS);
        frame.postMessage({ type: `${PROBE}_OUTLINE` }, '*');
      });
      if (reply) {
        outline = reply.outline;
        if (reply.empty && runtimeErrors.length === 0) {
          runtimeErrors.push('The tool rendered nothing: #root is empty after loading. Check the App export and the first render.');
        }
      }
    }
    return { runtimeErrors, warnings, console: consoleLines, outline };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    window.removeEventListener('message', onMessage);
    runner.dispose();
    container.remove();
  }
}

/** The Tool Builder's checker: Flow's compiler, then the runner in a hidden frame. */
export function createToolChecker(): ProjectChecker {
  return async (files, options = {}) => {
    const started = Date.now();
    const toolFiles = Object.entries(files).map(([path, content]) => ({ path: path.replace(/^\/+/, ''), content }));
    if (!toolFiles.some((f) => /^(src\/)?App\.(tsx|jsx|ts|js)$/.test(f.path))) {
      return {
        buildErrors: [{ text: 'There is no /App.tsx. It is the entry point and must default-export the root component.' }],
        runtimeErrors: [],
        warnings: [],
        console: [],
        durationMs: Date.now() - started,
      };
    }
    const { compileTool } = await import('../runtime/compiler');
    const compiled = await compileTool(toolFiles);
    if (compiled.success === false) {
      return { buildErrors: compiled.errors.map(parseCompileError), runtimeErrors: [], warnings: [], console: [], durationMs: Date.now() - started };
    }
    const run = probeQueue.then(() => probeTool(toolFiles, compiled, options.signal));
    probeQueue = run.catch(() => {});
    const runtime = await run;
    return {
      buildErrors: [],
      runtimeErrors: runtime.runtimeErrors,
      warnings: runtime.warnings,
      console: runtime.console,
      outline: runtime.outline,
      skipped: runtime.skipped,
      durationMs: Date.now() - started,
    };
  };
}
