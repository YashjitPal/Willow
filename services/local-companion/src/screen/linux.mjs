/**
 * The user's computer on Linux, the way it is done well there: a desktop of the bot's own. X lets a program run a
 * whole display off-screen (Xvfb), so the bot gets one — apps it opens there run on it, its pictures are of it, its
 * clicks and keys go to it — and the user's own display, pointer and focus are never touched. Nothing needs drawing
 * over the user's screen, so a grant shows no overlay.
 *
 * Built on standard tools: Xvfb for the display, xdotool for the pointer and keys, and ImageMagick's `import` (or
 * ffmpeg) for pictures. When one is missing it says which, and how to get it. There is no accessibility reading here —
 * the pictures and the pointer are the way in — so `elements` says so.
 */
import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const KINDS = new Set(['click', 'move', 'scroll', 'drag', 'type', 'key']);
const WIDTH = 1440;
const HEIGHT = 900;
const INSTALL_HINT = 'Install them with your package manager — on Debian and Ubuntu: sudo apt install xvfb xdotool imagemagick — then try again.';

/** Runs a program to its end: its exit code, and what it printed (stdout as bytes, for pictures). */
const defaultRun = (file, args, { env } = {}) => new Promise((resolve) => {
  execFile(file, args, { env, maxBuffer: 64 * 1024 * 1024, timeout: 60_000, encoding: 'buffer' }, (error, stdout, stderr) => {
    const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
    resolve({ code, stdout: stdout ?? Buffer.alloc(0), stderr: String(stderr ?? (error ? error.message : '')) });
  });
});

/** Whether a program is on the PATH. */
const defaultHas = (name) => new Promise((resolve) => {
  execFile('sh', ['-c', `command -v ${name}`], (error, stdout) => resolve(!error && String(stdout).trim().length > 0));
});

/**
 * @param {{ log?: Function, run?: typeof defaultRun, has?: typeof defaultHas, spawn?: typeof nodeSpawn, exists?: (path: string) => boolean }} options
 * `run`, `has`, `spawn` and `exists` stand in for the system in tests.
 */
export function createLinuxScreen({ log = () => {}, run = defaultRun, has = defaultHas, spawn = nodeSpawn, exists = existsSync } = {}) {
  let display = null;
  let server = null;
  const launched = new Set();

  /** The tools this needs that are missing, and the picture tool there is, if any. */
  const tools = async () => {
    const missing = [];
    for (const name of ['Xvfb', 'xdotool']) if (!(await has(name))) missing.push(name);
    const picture = (await has('import')) ? 'import' : (await has('ffmpeg')) ? 'ffmpeg' : null;
    if (!picture) missing.push('import (ImageMagick)');
    return { missing, picture };
  };

  /** The bot's display's environment: only its own DISPLAY, never the user's. */
  const envFor = () => ({ ...process.env, DISPLAY: display });

  /** A display number no X server holds: from :90 up, skipping any with a socket or lock already. */
  const freeDisplay = () => {
    for (let number = 90; number < 140; number++) {
      if (!exists(`/tmp/.X11-unix/X${number}`) && !exists(`/tmp/.X${number}-lock`)) return number;
    }
    throw new Error('No free X display number was found for the bot\'s desktop.');
  };

  /** Starts the bot's own desktop if it is not running, and waits until it answers. */
  const ensureDisplay = async () => {
    if (display && server && server.exitCode === null) return display;
    const { missing } = await tools();
    if (missing.length) throw new Error(`The bot's desktop needs ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not installed. ${INSTALL_HINT}`);
    const number = freeDisplay();
    const name = `:${number}`;
    // -nolisten tcp: reachable only on this computer. The display exists only while Willow runs it.
    server = spawn('Xvfb', [name, '-screen', '0', `${WIDTH}x${HEIGHT}x24`, '-nolisten', 'tcp'], { stdio: 'ignore', detached: false });
    server.on('exit', () => { if (display === name) { display = null; server = null; } });
    display = name;
    for (let attempt = 0; attempt < 40; attempt++) {
      const probe = await run('xdotool', ['getdisplaygeometry'], { env: envFor() });
      if (probe.code === 0) return display;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('The bot\'s desktop did not start.');
  };

  const capture = async () => {
    await ensureDisplay();
    const { picture } = await tools();
    const outcome = picture === 'import'
      ? await run('import', ['-window', 'root', 'png:-'], { env: envFor() })
      : await run('ffmpeg', ['-loglevel', 'error', '-f', 'x11grab', '-video_size', `${WIDTH}x${HEIGHT}`, '-i', display, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { env: envFor() });
    const bytes = Buffer.isBuffer(outcome.stdout) ? outcome.stdout : Buffer.from(String(outcome.stdout ?? ''), 'binary');
    if (outcome.code !== 0 || bytes.length === 0) throw new Error(`The bot's desktop could not be captured: ${outcome.stderr.trim().slice(0, 200) || 'no picture came back'}.`);
    return { data: bytes.toString('base64'), format: 'png', left: 0, top: 0, width: WIDTH, height: HEIGHT, monitor: 1, monitors: 1, primary: true, userIdleMs: null };
  };

  const xdotool = async (args) => {
    const outcome = await run('xdotool', args, { env: envFor() });
    if (outcome.code !== 0) throw new Error(`The bot's desktop did not take that: ${outcome.stderr.trim().slice(0, 200) || `xdotool ${args[0]} failed`}.`);
    return String(outcome.stdout ?? '');
  };

  const BUTTONS = { left: '1', middle: '2', right: '3' };

  /** xdotool's names for keys, from the names the tools take: ctrl+s, Enter, F5… */
  const keyName = (combination) => combination.split('+').map((part) => part.trim()).filter(Boolean).map((part) => {
    const lower = part.toLowerCase();
    const named = { ctrl: 'ctrl', control: 'ctrl', shift: 'shift', alt: 'alt', option: 'alt', win: 'super', super: 'super', meta: 'super', cmd: 'super', enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'space', backspace: 'BackSpace', delete: 'Delete', del: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next', insert: 'Insert' };
    if (named[lower]) return named[lower];
    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower.toUpperCase();
    return part;
  }).join('+');

  const act = async (payload = {}) => {
    const kind = String(payload.kind ?? '');
    if (!KINDS.has(kind)) throw new Error(`Unknown action on the screen: ${kind || 'none'}.`);
    await ensureDisplay();
    const x = String(Math.round(Number(payload.x) || 0));
    const y = String(Math.round(Number(payload.y) || 0));
    if (kind === 'click') {
      const button = BUTTONS[String(payload.button ?? 'left')] ?? '1';
      const clicks = String(Math.max(1, Math.min(3, Math.round(Number(payload.clicks)) || 1)));
      await xdotool(['mousemove', x, y, 'click', '--repeat', clicks, '--delay', '80', button]);
    } else if (kind === 'move') {
      await xdotool(['mousemove', x, y]);
    } else if (kind === 'scroll') {
      const deltaY = Math.round(Number(payload.deltaY) || 0);
      const deltaX = Math.round(Number(payload.deltaX) || 0);
      const steps = (delta) => String(Math.max(1, Math.min(50, Math.round(Math.abs(delta) / 100))));
      await xdotool(['mousemove', x, y]);
      if (deltaY) await xdotool(['click', '--repeat', steps(deltaY), deltaY > 0 ? '5' : '4']);
      if (deltaX) await xdotool(['click', '--repeat', steps(deltaX), deltaX > 0 ? '7' : '6']);
    } else if (kind === 'drag') {
      const toX = String(Math.round(Number(payload.toX) || 0));
      const toY = String(Math.round(Number(payload.toY) || 0));
      await xdotool(['mousemove', x, y, 'mousedown', '1', 'mousemove', '--sync', toX, toY, 'mouseup', '1']);
    } else if (kind === 'type') {
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (!text) throw new Error('Give the "text" to type.');
      await xdotool(['type', '--delay', '12', '--', text]);
    } else if (kind === 'key') {
      const key = typeof payload.key === 'string' ? payload.key : '';
      if (!key.trim()) throw new Error('Give the "key" to press.');
      await xdotool(['key', '--', keyName(key)]);
    }
    return { ok: true };
  };

  const apps = async () => {
    await ensureDisplay();
    const ids = (await xdotool(['search', '--onlyvisible', '--name', '.']).catch(() => '')).split(/\s+/).filter(Boolean).slice(0, 40);
    const list = [];
    for (const id of ids) {
      const title = (await xdotool(['getwindowname', id]).catch(() => '')).trim();
      if (!title) continue;
      const shell = await xdotool(['getwindowgeometry', '--shell', id]).catch(() => '');
      const read = (name) => Number((shell.match(new RegExp(`${name}=(-?\\d+)`)) ?? [])[1] ?? 0);
      list.push({ title, window: Number(id), bounds: { left: read('X'), top: read('Y'), width: read('WIDTH'), height: read('HEIGHT') } });
    }
    return { apps: list };
  };

  const focus = async (payload = {}) => {
    const window = Math.round(Number(payload.window)) || 0;
    if (!window) throw new Error('Give the "window" to bring forward on your desktop: its id from user_apps.');
    await ensureDisplay();
    await xdotool(['windowactivate', '--sync', String(window)]);
    return { ok: true, foreground: true };
  };

  /** Opens a program on the bot's desktop, where it runs off the user's screen; it ends with the desktop. */
  const launch = async (payload = {}) => {
    const command = typeof payload.command === 'string' ? payload.command.trim() : '';
    if (!command) throw new Error('Give the "command" that opens the app, such as firefox or libreoffice --calc.');
    await ensureDisplay();
    const [file, ...args] = command.split(/\s+/);
    const child = spawn(file, args, { env: envFor(), stdio: 'ignore', detached: false });
    launched.add(child);
    child.on('exit', () => launched.delete(child));
    child.on('error', () => launched.delete(child));
    return { ok: true, started: file };
  };

  const stop = () => {
    for (const child of launched) { try { child.kill(); } catch {} }
    launched.clear();
    if (server) { try { server.kill(); } catch {} }
    server = null;
    display = null;
  };

  return {
    platform: 'linux',
    requests: ['screen.info', 'screen.capture', 'screen.act', 'screen.apps', 'screen.elements', 'screen.element', 'screen.focus', 'screen.launch', 'screen.begin', 'screen.end'],
    handles: (type) => type.startsWith('screen.'),
    async handle(type, payload = {}) {
      if (type === 'screen.info') {
        const { missing } = await tools();
        return {
          platform: 'linux',
          mode: 'virtual',
          monitors: [{ index: 1, primary: true, left: 0, top: 0, width: WIDTH, height: HEIGHT, scale: 1 }],
          userIdleMs: null,
          locked: false,
          running: Boolean(display),
          ...(missing.length ? { missing, hint: INSTALL_HINT } : {}),
        };
      }
      if (type === 'screen.capture') return capture();
      if (type === 'screen.act') return act(payload);
      if (type === 'screen.apps') return apps();
      if (type === 'screen.focus') return focus(payload);
      if (type === 'screen.launch') return launch(payload);
      if (type === 'screen.elements' || type === 'screen.element') {
        throw new Error('The bot\'s desktop on Linux has no accessibility reading. Use the screenshot, and point and type.');
      }
      // The desktop starts when a grant's first action needs it, and ends with the grant.
      if (type === 'screen.begin') return { shown: false };
      if (type === 'screen.end') { stop(); return { shown: false }; }
      throw new Error(`Unknown companion request: ${type}`);
    },
    dispose: stop,
  };
}
