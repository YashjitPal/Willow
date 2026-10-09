/**
 * Checking the project the way the user is about to see it.
 *
 * After the model finishes a round of changes, the harness builds the working
 * copy with the preview's own bundler and renders it in a hidden frame, the
 * same page the preview would show. What comes back — build errors with file
 * and line, uncaught exceptions, React render errors, an app that rendered
 * nothing — is handed to the model to fix *before* the turn ends. That loop is
 * the difference between an agent that claims success and one that knows.
 *
 * Two layers, because they fail differently:
 *
 * - **Build.** esbuild in strict mode: a missing file, a Node built-in or an
 *   unknown package is an error, not the placeholder the forgiving live preview
 *   renders. Syntax errors come back with exact positions.
 * - **Runtime.** The bundle runs in an off-screen iframe with the preview's
 *   sandbox flags. Its errors are posted on a channel of their own, so the
 *   check never raises the toasts the visible preview would. If the frame
 *   cannot load at all (offline, CDN down) the check says it was skipped
 *   rather than inventing an app error.
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
/* The browser checker                                                       */
/* ------------------------------------------------------------------------ */

const PROBE_MESSAGE = 'WILLOW_HARNESS_PROBE';
const PROBE_ERROR_MESSAGE = 'WILLOW_HARNESS_PROBE_ERROR';
const LOAD_TIMEOUT_MS = 12_000;
const SETTLE_MS = 900;

/** Console capture and error forwarding, injected ahead of everything else. */
const PROBE_HEAD_SCRIPT = `(function () {
  function send(kind, message) {
    try { parent.postMessage({ type: ${JSON.stringify(PROBE_MESSAGE)}, kind: kind, message: String(message).slice(0, 4000) }, '*'); } catch (e) {}
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
  window.addEventListener('error', function (event) {
    send('error', (event.error && (event.error.stack || event.error.message)) || event.message);
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    send('error', 'Unhandled promise rejection: ' + ((reason && (reason.stack || reason.message)) || reason));
  });
})();`;

/** Messages the preview page itself prints, which are about the page and not the app. */
const isPreviewNoise = (text: string): boolean =>
  /^\[Preview\]|^Download the React DevTools|^cdn\.tailwindcss\.com should not be used in production|^React Error:/.test(text) ||
  /You are importing createRoot from .react-dom./.test(text);

/** A short, readable first line of an error, without a 40-frame stack. */
const trimStack = (text: string): string => {
  const lines = text.split('\n');
  const head = lines[0]!;
  const frames = lines
    .slice(1)
    .filter((line) => /^\s*at /.test(line) && !/react(-dom)?\.development\.js|blob:|<anonymous>/.test(line))
    .slice(0, 3);
  return [head, ...frames].join('\n');
};

function describeBuildError(error: any): CheckMessage[] {
  const errors = Array.isArray(error?.errors) ? error.errors : [];
  if (errors.length === 0) return [{ text: String(error?.message ?? error) }];
  return errors.map((entry: any) => {
    const file = typeof entry?.location?.file === 'string' ? entry.location.file.replace(/^[\w-]+:/, '') : undefined;
    return {
      file: file && file !== '__entry__' ? file : undefined,
      line: entry?.location?.line,
      column: entry?.location?.column,
      text: String(entry?.text ?? 'Build error').replace(/^\[plugin: [\w-]+\]\s*/, ''),
    };
  });
}

function outlineOf(doc: Document): { outline: string; empty: boolean } {
  const root = doc.getElementById('root');
  if (!root) return { outline: '', empty: true };
  const empty = root.childElementCount === 0 && !(root.textContent ?? '').trim();
  if (empty) return { outline: 'Nothing rendered: #root is empty.', empty: true };

  const count = (selector: string) => root.querySelectorAll(selector).length;
  const headings = Array.from(root.querySelectorAll('h1, h2, h3'))
    .slice(0, 12)
    .map((heading) => `${heading.tagName.toLowerCase()}: ${(heading.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 90)}`);
  const text = ((root as HTMLElement).innerText || root.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  const lines = [
    `${count('button')} buttons, ${count('input, textarea, select')} inputs, ${count('a[href]')} links, ${count('img')} images, ${count('svg')} svgs.`,
  ];
  if (headings.length > 0) lines.push(`Headings: ${headings.join(' | ')}`);
  if (text) lines.push(`Visible text (start): ${text.slice(0, 1_200)}`);
  return { outline: lines.join('\n'), empty: false };
}

/** One runtime probe at a time; two hidden frames racing for the CDN helps nobody. */
let probeQueue: Promise<unknown> = Promise.resolve();

async function probe(
  html: string,
  signal?: AbortSignal,
): Promise<Pick<CheckReport, 'runtimeErrors' | 'warnings' | 'console' | 'outline' | 'skipped'>> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { runtimeErrors: [], warnings: [], console: [], skipped: 'no browser to run it in' };
  }

  const runtimeErrors: string[] = [];
  const warnings: string[] = [];
  const consoleLines: string[] = [];
  const seen = new Set<string>();
  // One crash arrives up to three times — the error event, the preview page's
  // handler and React's error boundary — each worded a little differently.
  const isDuplicate = (text: string): boolean => {
    const key = text
      .split('\n')[0]!
      .replace(/^(?:Runtime Error|React Error|Build Error):\s*/i, '')
      .replace(/^Uncaught\s+/i, '')
      .replace(/^(?:[A-Z]\w*)?Error:\s*/, '')
      .trim();
    if (!key) return true;
    if ([...seen].some((known) => known.includes(key) || key.includes(known))) return true;
    seen.add(key);
    return false;
  };

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('data-willow-harness-probe', '');
  frame.tabIndex = -1;
  Object.assign(frame.style, {
    position: 'fixed',
    left: '-12000px',
    top: '0',
    width: '1280px',
    height: '800px',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  });

  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data as { type?: string; kind?: string; message?: string; errorType?: string } | null;
    if (!data || (data.type !== PROBE_MESSAGE && data.type !== PROBE_ERROR_MESSAGE)) return;
    const text = String(data.message ?? '').trim();
    if (!text || isPreviewNoise(text)) return;

    if (data.type === PROBE_ERROR_MESSAGE) {
      if (isDuplicate(text)) return;
      runtimeErrors.push(trimStack(`${data.errorType ? `${data.errorType}: ` : ''}${text}`));
      return;
    }

    switch (data.kind) {
      case 'error': {
        if (isDuplicate(text)) return;
        runtimeErrors.push(trimStack(text));
        return;
      }
      case 'console-error':
        if (/^Warning: /.test(text)) warnings.push(text.split('\n')[0]!.replace(/%s/g, '…'));
        else if (!/^The above error occurred/.test(text)) consoleLines.push(`error: ${text.split('\n')[0]}`);
        return;
      case 'console-warn':
        consoleLines.push(`warn: ${text.split('\n')[0]}`);
        return;
      default:
        consoleLines.push(text.split('\n')[0]!);
    }
  };

  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.addEventListener('message', onMessage);
  let loaded = false;
  try {
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, LOAD_TIMEOUT_MS);
      const finish = () => {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      frame.addEventListener('load', () => {
        loaded = true;
        finish();
      }, { once: true });
      signal?.addEventListener('abort', finish, { once: true });
      frame.src = url;
      document.body.appendChild(frame);
    });

    // A frame that never loaded says nothing about the app, so whatever it
    // reported is dropped rather than handed to the model as something to fix.
    if (signal?.aborted) return { runtimeErrors: [], warnings, console: consoleLines, skipped: 'cancelled' };
    if (!loaded) {
      return { runtimeErrors: [], warnings, console: consoleLines, skipped: 'the preview frame did not finish loading in time' };
    }

    await new Promise((resolve) => window.setTimeout(resolve, SETTLE_MS));

    let outline: string | undefined;
    try {
      const doc = frame.contentDocument;
      const win = frame.contentWindow as (Window & { React?: unknown }) | null;
      if (doc && win && !win.React) {
        return {
          runtimeErrors: [],
          warnings,
          console: consoleLines,
          skipped: 'React could not be loaded from the CDN (offline?)',
        };
      }
      if (doc) {
        const result = outlineOf(doc);
        outline = result.outline;
        if (result.empty && runtimeErrors.length === 0) {
          runtimeErrors.push('The app rendered nothing: #root is empty after loading. Check the App export and the first render.');
        }
      }
    } catch {
      /* A frame we cannot read is not the app's fault. */
    }

    return { runtimeErrors, warnings, console: consoleLines, outline };
  } finally {
    window.removeEventListener('message', onMessage);
    frame.remove();
    URL.revokeObjectURL(url);
  }
}

/**
 * The checker the workbench uses: the preview's bundler, then a hidden frame.
 *
 * The bundler is imported lazily so this module stays loadable without esbuild —
 * which is what lets the turn loop be tested with a stand-in checker.
 */
export function createBrowserChecker(): ProjectChecker {
  return async (files, options = {}) => {
    const started = Date.now();
    const { bundleFiles, generatePreviewHTML, extractThemeCSSFromFiles } = await import('../runtime/preview/bundler');
    const { undeclaredPackages } = await import('../runtime/preview/packages');

    const warnings: string[] = [];
    const undeclared = undeclaredPackages(files);
    if (undeclared.length > 0) {
      warnings.push(
        `Imported but not declared in /package.json (loaded at their latest versions): ${undeclared.join(', ')}. Declare them with <willow-dependency>.`,
      );
    }

    if (!Object.keys(files).some((path) => /^\/(src\/)?App\.(tsx|jsx|js)$/.test(path))) {
      return {
        buildErrors: [{ text: 'There is no /App.tsx. It is the entry point and must default-export the root component.' }],
        runtimeErrors: [],
        warnings,
        console: [],
        durationMs: Date.now() - started,
      };
    }

    let code: string;
    try {
      code = await bundleFiles(files, { strict: true });
    } catch (error) {
      return {
        buildErrors: describeBuildError(error),
        runtimeErrors: [],
        warnings,
        console: [],
        durationMs: Date.now() - started,
      };
    }

    const html = generatePreviewHTML(code, extractThemeCSSFromFiles(files), {
      errorMessageType: PROBE_ERROR_MESSAGE,
      headScript: PROBE_HEAD_SCRIPT,
    });

    const run = probeQueue.then(() => probe(html, options.signal));
    probeQueue = run.catch(() => {});
    const runtime = await run;

    return {
      buildErrors: [],
      runtimeErrors: runtime.runtimeErrors,
      warnings: [...warnings, ...runtime.warnings],
      console: runtime.console,
      outline: runtime.outline,
      skipped: runtime.skipped,
      durationMs: Date.now() - started,
    };
  };
}
