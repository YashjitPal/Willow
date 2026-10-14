/**
 * The user's computer on Linux, the way it is done well there: a desktop of the bot's own. X lets a program run a
 * whole display off-screen (Xvfb), so the bot gets one — apps it opens there run on it, its pictures are of it, its
 * clicks and keys go to it — and the user's own display, pointer and focus are never touched. Nothing needs drawing
 * over the user's screen, so a grant shows no overlay.
 *
 * Apps opened there are kept to it. They are told to draw with X rather than on the user's Wayland session, given a
 * session bus of the desktop's own so they never hand their window to a copy already open on the user's screen, and —
 * browsers, mail and office suites, which share one profile with any copy of themselves — a profile of their own. A
 * light window manager is started on it when the system has one, so windows can be brought to the front.
 *
 * Built on standard tools: Xvfb for the display, xdotool for the pointer and keys, and ImageMagick's `import` (or
 * ffmpeg) for pictures. When one is missing it says which, and how to get it. There is no accessibility reading here —
 * the pictures and the pointer are the way in — so `elements` says so.
 */
import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KINDS = new Set(['click', 'move', 'scroll', 'drag', 'type', 'key']);
const WIDTH = 1440;
const HEIGHT = 900;
const INSTALL_HINT = 'Install them with your package manager — on Debian and Ubuntu: sudo apt install xvfb xdotool imagemagick — then try again.';
// Light window managers, in the order they are tried, with what each needs to stay out of the way.
const WINDOW_MANAGERS = [['openbox', []], ['fluxbox', []], ['icewm', []], ['xfwm4', ['--compositor=off']], ['matchbox-window-manager', []], ['marco', []], ['metacity', []]];
// How long what an action set going is given to draw before the bot looks again.
const SETTLE_MS = { click: 350, key: 350, drag: 300, scroll: 250, type: 200, move: 200 };
// A bus address nothing listens on: with no bus of its own to be had, an app gets none rather than the user's.
const NO_BUS = 'unix:path=/nonexistent/willow-desktop-bus';

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

/* ------------------------------------------------------------------------ */
/* Keys                                                                      */
/* ------------------------------------------------------------------------ */

/** X's names for keys (and xdotool's for modifiers), from the names the tools take. A Mac's cmd is Control here. */
const X_NAMES = {
  ctrl: 'ctrl', control: 'ctrl', cmd: 'ctrl', command: 'ctrl', shift: 'shift', alt: 'alt', option: 'alt', opt: 'alt',
  win: 'super', windows: 'super', super: 'super', meta: 'super',
  enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'space', spacebar: 'space',
  backspace: 'BackSpace', delete: 'Delete', del: 'Delete', forwarddelete: 'Delete', insert: 'Insert', ins: 'Insert',
  home: 'Home', end: 'End', pageup: 'Prior', pgup: 'Prior', pagedown: 'Next', pgdn: 'Next',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
  menu: 'Menu', contextmenu: 'Menu', capslock: 'Caps_Lock', numlock: 'Num_Lock', scrolllock: 'Scroll_Lock',
  printscreen: 'Print', prtsc: 'Print', pause: 'Pause',
  numpadadd: 'KP_Add', numpadsubtract: 'KP_Subtract', numpadmultiply: 'KP_Multiply', numpaddivide: 'KP_Divide', numpaddecimal: 'KP_Decimal', numpadenter: 'KP_Enter',
  volumeup: 'XF86AudioRaiseVolume', volumedown: 'XF86AudioLowerVolume', volumemute: 'XF86AudioMute', mute: 'XF86AudioMute',
  mediaplaypause: 'XF86AudioPlay', playpause: 'XF86AudioPlay', medianext: 'XF86AudioNext', mediaprevious: 'XF86AudioPrev', mediaprev: 'XF86AudioPrev', mediastop: 'XF86AudioStop',
  browserback: 'XF86Back', browserforward: 'XF86Forward', browserrefresh: 'XF86Reload',
  plus: 'plus', minus: 'minus', hyphen: 'minus', comma: 'comma', period: 'period', dot: 'period', slash: 'slash', backslash: 'backslash',
  semicolon: 'semicolon', quote: 'apostrophe', apostrophe: 'apostrophe', backquote: 'grave', backtick: 'grave', grave: 'grave',
  equal: 'equal', equals: 'equal', bracketleft: 'bracketleft', bracketright: 'bracketright',
};
/** X's names for the characters on keys, which it does not take as themselves. */
const X_CHARACTERS = {
  '!': 'exclam', '"': 'quotedbl', '#': 'numbersign', $: 'dollar', '%': 'percent', '&': 'ampersand', "'": 'apostrophe',
  '(': 'parenleft', ')': 'parenright', '*': 'asterisk', '+': 'plus', ',': 'comma', '-': 'minus', '.': 'period', '/': 'slash',
  ':': 'colon', ';': 'semicolon', '<': 'less', '=': 'equal', '>': 'greater', '?': 'question', '@': 'at', '[': 'bracketleft',
  '\\': 'backslash', ']': 'bracketright', '^': 'asciicircum', _: 'underscore', '`': 'grave', '{': 'braceleft', '|': 'bar',
  '}': 'braceright', '~': 'asciitilde', ' ': 'space',
};
const X_MODIFIERS = new Set(['ctrl', 'shift', 'alt', 'super']);

/** A key with any modifiers before it, joined with + — "ctrl+s", "Enter", "?", "é" — as xdotool names it. */
export function xKey(combination) {
  const trimmed = String(combination ?? '').trim();
  if (!trimmed) throw new Error('Give the "key" to press.');
  const parts = trimmed === '+' ? ['+'] : trimmed.endsWith('++') ? [...trimmed.slice(0, -2).split('+'), '+'] : trimmed.split('+');
  const names = parts.map((part) => part.trim()).filter(Boolean);
  const last = names.pop();
  const modifiers = names.map((name) => {
    const modifier = X_NAMES[name.toLowerCase()];
    if (!X_MODIFIERS.has(modifier)) throw new Error(`"${name}" is not a modifier key; use ctrl, shift, alt or super.`);
    return modifier;
  });
  const lower = last.toLowerCase();
  let key;
  if (X_NAMES[lower]) key = X_NAMES[lower];
  else if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) key = lower.toUpperCase();
  else if (/^numpad[0-9]$/.test(lower)) key = `KP_${lower.slice(6)}`;
  else if ([...last].length === 1) {
    if (/^[a-z0-9]$/i.test(last)) key = modifiers.length ? lower : last;
    else key = X_CHARACTERS[last] ?? `U${last.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  } else if (/^[A-Za-z][A-Za-z0-9_]*$/.test(last)) key = last;
  else throw new Error(`"${last}" is not a key X knows. Use a key name such as Enter, Escape, Tab, Up, PageDown or F5, or a single character.`);
  return [...modifiers, key].join('+');
}

/* ------------------------------------------------------------------------ */
/* Starting an app                                                           */
/* ------------------------------------------------------------------------ */

/**
 * A command line in its words, as a shell would split it — quotes and backslashes meaning what they do there — to be
 * run without one, after any VAR=value settings before the program.
 */
export function splitCommand(command) {
  const words = [];
  let word = '';
  let quote = null;
  let started = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && /["\\$`]/.test(command[index + 1] ?? '')) word += command[++index];
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (char === '\\' && index + 1 < command.length) { word += command[++index]; started = true; continue; }
    if (/\s/.test(char)) {
      if (started) words.push(word);
      word = '';
      started = false;
      continue;
    }
    word += char;
    started = true;
  }
  if (quote) throw new Error('That command has a quote that is never closed.');
  if (started) words.push(word);
  if (words.some((part) => ['|', '||', '&&', ';', '&', '>', '>>', '<'].includes(part))) throw new Error('Give one program and what it takes: there is no shell here to join commands or send their output anywhere.');
  const settings = {};
  while (words.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
    const setting = words.shift();
    settings[setting.slice(0, setting.indexOf('='))] = setting.slice(setting.indexOf('=') + 1);
  }
  if (!words.length) throw new Error('Give the "command" that opens the app, such as firefox or libreoffice --calc.');
  return { file: words[0], args: words.slice(1), settings };
}

/**
 * Programs that share one profile with any copy of themselves — browsers, mail, office suites — given one of the bot's
 * own, so they start afresh on its desktop instead of handing their window to the user's copy. Snaps are given one
 * where their confinement lets them write.
 */
export function ownProfile(file, args, { home = os.homedir(), exists = existsSync } = {}) {
  const name = path.posix.basename(file);
  const dir = exists(`/snap/bin/${name}`) ? path.posix.join(home, 'snap', name, 'common', 'willow-desktop') : path.posix.join(home, '.cache', 'willow', 'desktop', name);
  if (/^(firefox(-esr|-developer-edition)?|librewolf|waterfox|thunderbird)$/.test(name) && !args.some((arg) => /^--?(profile|P|no-remote|new-instance)$/.test(arg))) {
    return { dir, args: ['--no-remote', '--new-instance', '--profile', dir, ...args] };
  }
  if (/^(google-chrome(-stable|-beta|-unstable)?|chromium(-browser)?|brave(-browser)?(-stable)?|microsoft-edge(-stable|-beta|-dev)?|vivaldi(-stable)?|opera)$/.test(name) && !args.some((arg) => arg.startsWith('--user-data-dir'))) {
    return { dir, args: [`--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', ...args] };
  }
  if (/^(code|code-insiders|codium)$/.test(name) && !args.some((arg) => arg.startsWith('--user-data-dir'))) {
    return { dir, args: ['--user-data-dir', dir, '--new-window', ...args] };
  }
  if (/^(libreoffice|soffice|localc|lowriter|loimpress|lodraw|lomath|lobase)/.test(name) && !args.some((arg) => arg.startsWith('-env:UserInstallation'))) {
    return { dir, args: [`-env:UserInstallation=file://${dir}`, ...args] };
  }
  return { dir: null, args };
}

/**
 * @param {{ log?: Function, run?: typeof defaultRun, has?: typeof defaultHas, spawn?: typeof nodeSpawn, exists?: (path: string) => boolean, makeDir?: (dir: string) => void, home?: string, sleep?: (ms: number) => Promise<void> }} options
 * `run`, `has`, `spawn`, `exists`, `makeDir`, `home` and `sleep` stand in for the system in tests.
 */
export function createLinuxScreen({
  log = () => {},
  run = defaultRun,
  has = defaultHas,
  spawn = nodeSpawn,
  exists = existsSync,
  makeDir = (dir) => mkdirSync(dir, { recursive: true }),
  home = os.homedir(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let display = null;
  let server = null;
  let manager = null;
  let busDaemon = null;
  let bus = NO_BUS;
  const launched = new Set();

  /** The tools this needs that are missing, and the picture tool there is, if any. */
  const tools = async () => {
    const missing = [];
    for (const name of ['Xvfb', 'xdotool']) if (!(await has(name))) missing.push(name);
    const picture = (await has('import')) ? 'import' : (await has('ffmpeg')) ? 'ffmpeg' : null;
    if (!picture) missing.push('import (ImageMagick)');
    return { missing, picture };
  };

  /**
   * The bot's display's environment: its own DISPLAY and session bus, never the user's — no Wayland, and GTK, Qt,
   * Firefox, Electron and SDL each told to draw with X.
   */
  const envFor = (settings = {}) => {
    const env = { ...process.env, ...settings };
    for (const name of ['WAYLAND_DISPLAY', 'WAYLAND_SOCKET', 'DBUS_SESSION_BUS_ADDRESS', 'SESSION_MANAGER', 'DESKTOP_STARTUP_ID', 'XDG_ACTIVATION_TOKEN', 'GNOME_DESKTOP_SESSION_ID']) delete env[name];
    return {
      ...env,
      DISPLAY: display,
      DBUS_SESSION_BUS_ADDRESS: bus,
      XDG_SESSION_TYPE: 'x11',
      GDK_BACKEND: 'x11',
      QT_QPA_PLATFORM: 'xcb',
      MOZ_ENABLE_WAYLAND: '0',
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      SDL_VIDEODRIVER: 'x11',
      CLUTTER_BACKEND: 'x11',
    };
  };

  /** A display number no X server holds: from :90 up, skipping any with a socket or lock already. */
  const freeDisplay = () => {
    for (let number = 90; number < 140; number++) {
      if (!exists(`/tmp/.X11-unix/X${number}`) && !exists(`/tmp/.X${number}-lock`)) return number;
    }
    throw new Error('No free X display number was found for the bot\'s desktop.');
  };

  /** A session bus of the desktop's own, when the system has dbus-daemon: its address, or none to be had. */
  const startBus = async () => {
    if (!(await has('dbus-daemon'))) return NO_BUS;
    const child = spawn('dbus-daemon', ['--session', '--nofork', '--nopidfile', '--print-address=1'], { stdio: ['ignore', 'pipe', 'ignore'], detached: false });
    busDaemon = child;
    child.on('error', () => {});
    if (!child.stdout) return NO_BUS;
    return new Promise((resolve) => {
      let text = '';
      const timer = setTimeout(() => resolve(NO_BUS), 3_000);
      child.stdout.on('data', (chunk) => {
        text += String(chunk);
        const line = text.split('\n')[0].trim();
        if (text.includes('\n') && line) { clearTimeout(timer); resolve(line); }
      });
      child.once('error', () => { clearTimeout(timer); resolve(NO_BUS); });
      child.once('exit', () => { clearTimeout(timer); resolve(NO_BUS); });
    });
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
    server.on('error', () => {});
    server.on('exit', () => { if (display === name) { display = null; server = null; } });
    display = name;
    for (let attempt = 0; ; attempt++) {
      const probe = await run('xdotool', ['getdisplaygeometry'], { env: envFor() });
      if (probe.code === 0) break;
      if (attempt >= 40) throw new Error('The bot\'s desktop did not start.');
      await sleep(150);
    }
    bus = await startBus();
    for (const [program, args] of WINDOW_MANAGERS) {
      if (!(await has(program))) continue;
      const started = spawn(program, args, { env: envFor(), stdio: 'ignore', detached: false });
      started.on('error', () => { if (manager === started) manager = null; });
      manager = started;
      break;
    }
    return display;
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
    const said = String(outcome.stderr ?? '');
    // xdotool passes over a key name X does not know, saying so only on stderr.
    const unknown = said.match(/No such key name '([^']*)'/);
    if (unknown) throw new Error(`"${unknown[1]}" is not a key X knows. Use a key name such as Enter, Escape, Tab, Up, PageDown or F5, or a single character.`);
    if (outcome.code !== 0) throw new Error(`The bot's desktop did not take that: ${said.trim().slice(0, 200) || `xdotool ${args[0]} failed`}.`);
    return String(outcome.stdout ?? '');
  };

  const BUTTONS = { left: '1', middle: '2', right: '3' };

  const act = async (payload = {}) => {
    const kind = String(payload.kind ?? '');
    if (!KINDS.has(kind)) throw new Error(`Unknown action on the screen: ${kind || 'none'}.`);
    const key = kind === 'key' ? xKey(payload.key) : '';
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
      if (deltaY) await xdotool(['click', '--repeat', steps(deltaY), '--delay', '20', deltaY > 0 ? '5' : '4']);
      if (deltaX) await xdotool(['click', '--repeat', steps(deltaX), '--delay', '20', deltaX > 0 ? '7' : '6']);
    } else if (kind === 'drag') {
      const from = { x: Number(x), y: Number(y) };
      const to = { x: Math.round(Number(payload.toX) || 0), y: Math.round(Number(payload.toY) || 0) };
      // Pressed, carried there in steps as a hand would, and let go: what drag and drop waits to see.
      const route = [];
      for (let step = 1; step <= 8; step++) route.push('mousemove', String(Math.round(from.x + (to.x - from.x) * step / 8)), String(Math.round(from.y + (to.y - from.y) * step / 8)), 'sleep', '0.02');
      await xdotool(['mousemove', x, y, 'sleep', '0.05', 'mousedown', '1', 'sleep', '0.1', ...route, 'sleep', '0.1', 'mouseup', '1']);
    } else if (kind === 'type') {
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (!text) throw new Error('Give the "text" to type.');
      // A new line is pressed as Return: some xdotool versions type it as Linefeed, which most programs ignore.
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      for (let index = 0; index < lines.length; index++) {
        if (index > 0) await xdotool(['key', '--', 'Return']);
        if (lines[index]) await xdotool(['type', '--delay', '12', '--', lines[index]]);
      }
    } else if (kind === 'key') {
      await xdotool(['key', '--', key]);
    }
    await sleep(SETTLE_MS[kind] ?? 200);
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

  /** A window to the front: by the window manager when there is one, and raised and given the keys either way. */
  const focus = async (payload = {}) => {
    const window = Math.round(Number(payload.window)) || 0;
    if (!window) throw new Error('Give the "window" to bring forward on your desktop: its id from user_apps.');
    await ensureDisplay();
    const id = String(window);
    if (manager) await xdotool(['windowactivate', id]).catch(() => undefined);
    await xdotool(['windowraise', id]);
    await xdotool(['windowfocus', id]);
    await sleep(150);
    return { ok: true, foreground: true };
  };

  /** Opens a program on the bot's desktop, where it runs off the user's screen; it ends with the desktop. */
  const launch = async (payload = {}) => {
    const command = typeof payload.command === 'string' ? payload.command.trim() : '';
    if (!command) throw new Error('Give the "command" that opens the app, such as firefox or libreoffice --calc.');
    const { file, args: given, settings } = splitCommand(command);
    await ensureDisplay();
    const { dir, args } = ownProfile(file, given, { home, exists });
    if (dir) { try { makeDir(dir); } catch {} }
    // A group of its own, so the helpers it starts end with it.
    const child = spawn(file, args, { env: envFor(settings), stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    launched.add(child);
    child.on('error', () => {});
    let said = '';
    child.stderr?.on?.('data', (chunk) => { if (said.length < 2_000) said += String(chunk); });
    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ running: true }), 800);
      child.once('error', (error) => { clearTimeout(timer); resolve({ error }); });
      child.once('exit', (code) => { clearTimeout(timer); resolve({ exited: code }); });
    });
    child.once?.('exit', () => launched.delete(child));
    if (outcome.error) {
      launched.delete(child);
      if (outcome.error.code === 'ENOENT') throw new Error(`${file} is not installed on the user's computer, or not on its PATH.`);
      throw new Error(`${file} could not be started: ${outcome.error.message}`);
    }
    if (outcome.exited !== undefined) {
      launched.delete(child);
      if (outcome.exited !== 0) throw new Error(`${file} stopped as soon as it started (exit code ${outcome.exited})${said.trim() ? `: ${said.trim().slice(0, 300)}` : ''}.`);
      return { ok: true, started: file, note: 'It finished at once, as programs that open a window and hand it on do: look for its window.' };
    }
    return { ok: true, started: file };
  };

  const end = (child) => {
    if (!child) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill(); } catch {} }
  };

  const stop = () => {
    for (const child of launched) end(child);
    launched.clear();
    for (const child of [manager, busDaemon, server]) { if (child) { try { child.kill(); } catch {} } }
    manager = null;
    busDaemon = null;
    bus = NO_BUS;
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
