/**
 * The live preview, as one turn of the harness sees and uses it.
 *
 * A session lives for one turn. It owns everything the preview tools share:
 *
 * - **What the preview shows.** The harness commits the turn's files only when
 *   it ends, so before the first look the session loads the working copy into
 *   the preview — after the strict build check passes, so a broken edit is
 *   reported to the model instead of breaking the user's preview — and asks for
 *   a build with source locations, so every element names the line rendering it.
 *   It does this again whenever the model has edited since.
 * - **The numbers.** Element refs come from the latest look; actions resolve
 *   them against it.
 * - **Console output** between looks, so a result can say what the app logged.
 * - **The testing visuals**: the glow, the "AI Testing" pill and the moving
 *   cursor the Test tool always had, on while the model uses the computer and
 *   for a short while after, so they do not flicker between its steps.
 */

import type { CodeSession } from '../../session/code-session';
import { PREVIEW_VIEWPORTS, type PreviewViewportSize } from '../../workbench/preview-control';
import { formatCheckReport, reportHasErrors, type CheckReport } from '../verify';
import type { Workspace } from '../workspace';
import { describeEntry, findByText, scanPage, settle, type ActionOutcome, type PageEntry, type PageScan } from './page-driver';
import { captureFrame, type Screenshot } from './screenshot';

export interface PreviewSessionOptions {
  /** The screen whose preview this is: its files, its frame, its testing visuals. */
  session: CodeSession;
  /** Writes the working copy's changes into the workbench store. */
  syncFiles: (workspace: Workspace) => void;
  /**
   * Brings the preview into view: when testing starts, and with `force` when
   * the frame has no size at all (a narrow screen showing the chat).
   */
  showPreview?: (force: boolean) => void;
  /** Stops the turn: the Stop button on the preview's testing pill. */
  requestStop?: () => void;
  /** The frame to use; the workbench's live preview when absent. */
  getFrame?: () => HTMLIFrameElement | null;
  /** Asks for a rebuild of the frame; the workbench preview's when absent. */
  requestRebuild?: () => void;
}

export interface Observation {
  scan: PageScan;
  shot: Screenshot | null;
  /** For the model: where the app is, what is on screen, what it logged. */
  text: string;
}

/** Something to act on: a number from the latest look, visible text, or a point in screenshot pixels. */
export interface Target {
  ref?: number;
  text?: string;
  x?: number;
  y?: number;
}

export interface ResolvedTarget {
  element: Element | null;
  /** In the frame's CSS pixels. */
  point: { x: number; y: number };
  /** How the transcript names it: `"Add task" button`. */
  label: string;
}

const REBUILD_TIMEOUT_MS = 12_000;
const VISUALS_IDLE_MS = 15_000;
const MAX_CONSOLE_LINES = 8;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isPreviewNoise = (text: string): boolean =>
  /^\[(Preview|ThemeListener|Willow Inspector)\]|^Download the React DevTools|cdn\.tailwindcss\.com should not be used|^The above error occurred/.test(text);

export function labelOf(entry: Pick<PageEntry, 'role' | 'name'>): string {
  return entry.name ? `"${entry.name}" ${entry.role}` : entry.role;
}

export class PreviewSession {
  readonly #options: PreviewSessionOptions;
  #syncedRevision: number | null = null;
  #inspectable = false;
  #shown = false;
  #lastScan: PageScan | null = null;
  #scale = 1;
  #console: string[] = [];
  readonly #hooked = new WeakSet<Window>();
  #visualsOn = false;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;
  /** The page's own dialogs, put back when the session ends. */
  readonly #dialogs: Array<{ win: Window; alert: Window['alert']; confirm: Window['confirm']; prompt: Window['prompt'] }> = [];

  constructor(options: PreviewSessionOptions) {
    this.#options = options;
    window.addEventListener('message', this.#onMessage);
  }

  get iframe(): HTMLIFrameElement | null {
    return this.#options.getFrame ? this.#options.getFrame() : this.#options.session.test.getIframeRef();
  }

  get lastScan(): PageScan | null {
    return this.#lastScan;
  }

  /** Image pixels per CSS pixel in the latest screenshot. */
  get scale(): number {
    return this.#scale;
  }

  /** Uncaught errors the preview page reports itself. */
  readonly #onMessage = (event: MessageEvent) => {
    const frame = this.iframe;
    if (this.#disposed || !frame || event.source !== frame.contentWindow) return;
    const data = event.data as { type?: string; errorType?: string; message?: string } | null;
    if (data?.type !== 'PREVIEW_ERROR' || !data.message) return;
    this.#log(`error: ${data.errorType ? `${data.errorType}: ` : ''}${data.message}`);
  };

  #log(line: string): void {
    const text = line.split('\n')[0]!.slice(0, 300);
    if (isPreviewNoise(text.replace(/^(error|warn): /, ''))) return;
    if (this.#console.includes(text)) return;
    this.#console.push(text);
    if (this.#console.length > 40) this.#console.shift();
  }

  /** Console errors and warnings from this window, once per window: a reload brings a new one. */
  #hook(win: Window | null): void {
    if (!win || this.#hooked.has(win)) return;
    this.#hooked.add(win);
    const target = (win as Window & { console: Console }).console as Console & Record<string, unknown>;
    for (const level of ['error', 'warn'] as const) {
      const original = target[level].bind(target);
      target[level] = (...args: unknown[]) => {
        if (!this.#disposed) {
          const text = args.map((value) => (value instanceof Error ? value.message : typeof value === 'string' ? value : (() => {
            try {
              return JSON.stringify(value);
            } catch {
              return String(value);
            }
          })())).join(' ');
          this.#log(`${level}: ${text}`);
        }
        original(...args);
      };
    }

    // A real alert or confirm would stop the page, and the agent with it, until
    // someone clicked. While the agent drives the app it answers them itself and
    // says so; the user gets the real ones back when the turn ends.
    const saved = { win, alert: win.alert, confirm: win.confirm, prompt: win.prompt };
    this.#dialogs.push(saved);
    const agentActing = () => !this.#disposed && this.#visualsOn;
    win.alert = (message?: unknown) => {
      if (!agentActing()) return saved.alert.call(win, message);
      this.#log(`dialog: the app showed an alert "${String(message ?? '').slice(0, 200)}" (dismissed)`);
    };
    win.confirm = (message?: string) => {
      if (!agentActing()) return saved.confirm.call(win, message);
      this.#log(`dialog: the app asked "${String(message ?? '').slice(0, 200)}" (answered OK)`);
      return true;
    };
    win.prompt = (message?: string, fallback?: string) => {
      if (!agentActing()) return saved.prompt.call(win, message, fallback);
      this.#log(`dialog: the app prompted "${String(message ?? '').slice(0, 200)}" (answered "${fallback ?? ''}")`);
      return fallback ?? '';
    };
  }

  /**
   * Makes the preview show the working copy, built with source locations.
   * Returns a problem for the model, or null when the preview is ready.
   */
  async prepare(workspace: Workspace, check: () => Promise<CheckReport>): Promise<string | null> {
    const { workbench } = this.#options.session;
    if (workbench.previewSnapshot.get()) workbench.setPreviewSnapshot(null);

    let rebuild = false;
    if (workspace.revision !== this.#syncedRevision) {
      if (workspace.changes().length > 0) {
        const report = await check();
        if (reportHasErrors(report)) {
          return `The app has errors, so the preview cannot show your latest changes yet:\n${formatCheckReport(report)}\nFix them first, then use the preview again.`;
        }
        this.#options.syncFiles(workspace);
        rebuild = true;
      }
      this.#syncedRevision = workspace.revision;
    }
    if (!this.#inspectable) {
      this.#inspectable = true;
      this.#options.session.preview.inspectable.set(true);
      rebuild = true;
    }
    if (rebuild) await this.#rebuild();

    const frame = await this.#waitForFrame();
    if (!frame) {
      return "The preview isn't showing an app yet, so there is nothing to look at. Build the app first; it needs /App.tsx.";
    }
    this.#hook(frame.contentWindow);
    return null;
  }

  /** Asks the preview to rebuild and waits until the new build has rendered. */
  async #rebuild(): Promise<void> {
    const before = this.iframe?.contentDocument as (Document & { __willowStale?: boolean }) | null | undefined;
    if (before) before.__willowStale = true;

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        clearInterval(poll);
        window.removeEventListener('message', onMessage);
        resolve();
      };
      // A hot update keeps the document and says when it is done; a reload swaps the document.
      const onMessage = (event: MessageEvent) => {
        const frame = this.iframe;
        const type = (event.data as { type?: string } | null)?.type;
        if (frame && event.source === frame.contentWindow && (type === 'HOT_UPDATE_COMPLETE' || type === 'HOT_UPDATE_ERROR')) finish();
      };
      const poll = setInterval(() => {
        const doc = this.iframe?.contentDocument as (Document & { __willowStale?: boolean }) | null | undefined;
        if (doc && !doc.__willowStale && doc.readyState === 'complete' && (doc.getElementById('root')?.childElementCount ?? 0) > 0) finish();
      }, 120);
      const deadline = setTimeout(finish, REBUILD_TIMEOUT_MS);
      window.addEventListener('message', onMessage);
      (this.#options.requestRebuild ?? this.#options.session.preview.requestRebuild)();
    });
    await sleep(350);
  }

  async #waitForFrame(): Promise<HTMLIFrameElement | null> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const frame = this.iframe;
      if (frame?.contentDocument?.body && frame.contentWindow && frame.clientWidth > 16 && frame.clientHeight > 16) return frame;
      if (attempt === 8) this.#options.showPreview?.(true);
      await sleep(125);
    }
    return null;
  }

  /** The frame's window, which a reload replaces. */
  window(): Window {
    const win = this.iframe?.contentWindow;
    if (!win) throw new Error('The preview is not available.');
    this.#hook(win);
    return win;
  }

  async observe(): Promise<Observation> {
    const frame = this.iframe;
    if (!frame?.contentWindow) throw new Error('The preview is not available.');
    this.#hook(frame.contentWindow);
    const scan = scanPage(frame.contentWindow);
    const shot = await captureFrame(frame);
    this.#scale = shot?.scale ?? 1;
    this.#lastScan = scan;
    const consoleLines = this.#console.splice(0);
    return { scan, shot, text: formatObservation(scan, shot, consoleLines, this.#scale) };
  }

  /** A number, text or point, as a point in the frame and the element there. */
  resolve(target: Target, options: { scrollIntoView?: boolean } = {}): ResolvedTarget | { error: string } {
    const win = this.window();
    const viewport = { width: win.innerWidth, height: win.innerHeight };
    const scrollIntoView = options.scrollIntoView ?? true;

    let element: Element | null = null;
    let label = '';
    if (typeof target.ref === 'number') {
      const entry = this.#lastScan?.entries.find((candidate) => candidate.ref === target.ref);
      if (!entry) {
        return { error: this.#lastScan ? `There is no [${target.ref}] in the latest result. Use a number from the newest list.` : 'There are no numbers yet: take a screenshot first.' };
      }
      element = entry.element.isConnected ? entry.element : null;
      if (!element) {
        // The app re-rendered: find the same thing again by what it is called.
        const fresh = scanPage(win).entries.find((candidate) => candidate.role === entry.role && candidate.name === entry.name);
        element = fresh?.element ?? null;
      }
      if (!element) return { error: `[${target.ref}] ${labelOf(entry)} is no longer on the page. Take a new screenshot.` };
      label = labelOf(entry);
    } else if (target.text) {
      element = findByText(win, target.text);
      if (!element) return { error: `Nothing on the page says "${target.text}".` };
      label = `"${target.text}"`;
    } else if (typeof target.x === 'number' && typeof target.y === 'number') {
      const point = { x: target.x / this.#scale, y: target.y / this.#scale };
      if (point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height) {
        return { error: `${target.x},${target.y} is outside the screenshot.` };
      }
      element = win.document.elementFromPoint(point.x, point.y);
      return { element, point, label: `${Math.round(target.x)},${Math.round(target.y)}` };
    } else {
      return { error: 'Say what to act on: "ref" (a number from the latest result), "text", or "x" and "y".' };
    }

    let rect = element.getBoundingClientRect();
    const offScreen = rect.bottom < 4 || rect.top > viewport.height - 4 || rect.right < 4 || rect.left > viewport.width - 4;
    if (offScreen && scrollIntoView) {
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
      rect = element.getBoundingClientRect();
    }
    // The middle of the part a person can see, which for a tall element is not its middle.
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, viewport.width);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, viewport.height);
    const point = {
      x: Math.min(Math.max((left + right) / 2, 1), viewport.width - 1),
      y: Math.min(Math.max((top + bottom) / 2, 1), viewport.height - 1),
    };
    return { element, point, label };
  }

  /* -------------------------------------------------------------------- */
  /* What the user sees while the agent tests                              */
  /* -------------------------------------------------------------------- */

  beginVisuals(): void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
    if (this.#visualsOn) return;
    this.#visualsOn = true;
    if (!this.#shown) {
      this.#shown = true;
      this.#options.showPreview?.(false);
    }
    const { test } = this.#options.session;
    test.enterTestMode();
    test.showCursor();
    test.setCancelHandler(() => this.#options.requestStop?.());
  }

  /** Visuals stay up between steps, and go once the model has moved on. */
  idleVisuals(): void {
    if (!this.#visualsOn) return;
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => this.endVisuals(), VISUALS_IDLE_MS);
  }

  endVisuals(): void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
    if (!this.#visualsOn) return;
    this.#visualsOn = false;
    const { test } = this.#options.session;
    test.setCancelHandler(null);
    test.setThought(null);
    test.hideCursor();
    test.exitTestMode();
  }

  /** Moves the visible cursor to a point before acting there. */
  async pointAt(point: { x: number; y: number }, thought: string, click: boolean): Promise<void> {
    if (!this.#visualsOn) return;
    const win = this.iframe?.contentWindow;
    if (!win) return;
    const { test } = this.#options.session;
    test.moveCursor((point.x / win.innerWidth) * 1000, (point.y / win.innerHeight) * 1000);
    test.setThought(thought);
    await sleep(330);
    if (click) {
      test.triggerClick();
      await sleep(110);
    }
  }

  async setViewport(size: PreviewViewportSize | 'desktop'): Promise<ActionOutcome> {
    this.#options.session.preview.viewport.set(size === 'desktop' ? null : size);
    await sleep(450);
    const win = this.iframe?.contentWindow;
    if (win) await settle(win, 150);
    return {
      ok: true,
      message: size === 'desktop'
        ? 'The preview is back to its full width.'
        : `The preview is now ${PREVIEW_VIEWPORTS[size].width}px wide, a ${PREVIEW_VIEWPORTS[size].label} screen.`,
    };
  }

  async navigate(to: string): Promise<ActionOutcome> {
    const frame = this.iframe;
    const win = frame?.contentWindow;
    if (!frame || !win) return { ok: false, message: 'The preview is not available.' };
    const where = to.trim();
    if (where === 'back' || where === 'forward') {
      if (where === 'back') win.history.back();
      else win.history.forward();
      await settle(win, 400);
      return { ok: true, message: `Went ${where}. The route is now ${this.window().location.hash || '/'}.` };
    }
    if (where === 'reload' || where === 'refresh') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 8_000);
        frame.addEventListener('load', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        win.location.reload();
      });
      await settle(this.window(), 600);
      return { ok: true, message: 'Reloaded the app. Anything it saves (localStorage) should still be there.' };
    }
    // Only the hash can change: the preview is a blob: page, which has no paths to go to.
    const hash = where.startsWith('#') ? where : `#${where.startsWith('/') ? where : `/${where}`}`;
    win.location.hash = hash;
    await settle(win, 400);
    return { ok: true, message: `Went to ${hash}. (Routes only work through the hash, as HashRouter uses it.)` };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.endVisuals();
    this.#disposed = true;
    window.removeEventListener('message', this.#onMessage);
    for (const saved of this.#dialogs) {
      try {
        saved.win.alert = saved.alert;
        saved.win.confirm = saved.confirm;
        saved.win.prompt = saved.prompt;
      } catch {
        /* the window has gone */
      }
    }
    const { preview } = this.#options.session;
    if (preview.viewport.get() !== null) preview.viewport.set(null);
    if (this.#inspectable) preview.inspectable.set(false);
  }
}

/** The observation text: where the app is, what can be acted on, what it shows, what it logged. */
export function formatObservation(scan: PageScan, shot: Screenshot | null, consoleLines: readonly string[], scale: number): string {
  const lines: string[] = [];
  const size = shot ? `${shot.width}×${shot.height} screenshot` : `no screenshot (the page could not be drawn); the frame is ${scan.viewport.width}×${scan.viewport.height}`;
  const scroll = scan.scroll.maxY > 0 ? `, scrolled ${scan.scroll.y} of ${scan.scroll.maxY}px` : '';
  lines.push(`Screen: ${size}${scan.route ? `, route ${scan.route}` : ''}${scroll}.`);
  if (scan.dialog) lines.push(`A dialog is open: "${scan.dialog}". Things behind it are covered.`);
  if (scan.entries.length === 0) {
    lines.push('Nothing on screen can be acted on.');
  } else {
    lines.push('On screen (numbers for "ref", coordinates in screenshot pixels):');
    for (const entry of scan.entries) lines.push(describeEntry(entry, scale));
  }
  const hidden: string[] = [];
  if (scan.hiddenAbove > 0) hidden.push(`${scan.hiddenAbove} above`);
  if (scan.hiddenBelow > 0) hidden.push(`${scan.hiddenBelow} below`);
  if (hidden.length > 0) lines.push(`More controls off screen: ${hidden.join(', ')}. Scroll to reach them.`);
  if (scan.text) lines.push(`Text on screen: ${scan.text}`);
  if (consoleLines.length > 0) {
    lines.push('Console since the last step:');
    for (const line of consoleLines.slice(-MAX_CONSOLE_LINES)) lines.push(`- ${line}`);
  }
  return lines.join('\n');
}
