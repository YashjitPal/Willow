/**
 * The user's own screen, for a bot they let see and use it — each system the way it is best done there:
 *
 * - Windows (here): the one desktop the user is looking at, shared with them. The work is done by
 *   `screen/screen-helper.cs` with `screen-overlay.cs` (the glow, the pill with Stop and Esc, the bot's own cursor)
 *   and `screen-ui.cs` (the open apps, and the controls inside a window through UI Automation) — built here once
 *   with the C# compiler that ships with Windows' .NET Framework, kept by its sources' hash, so it needs nothing
 *   installed. It is declared per-monitor DPI aware, so a picture and a click are in the screen's real pixels.
 * - macOS (`screen/mac.mjs`): in the background, app by app, without taking the user's screen or focus.
 * - Linux (`screen/linux.mjs`): a desktop of the bot's own, off the user's display entirely.
 *
 * Only behind the desktop app's pairing token. The Windows helper refuses what a bot must never do — click on, or type
 * into, Willow's own windows (where its requests are approved) — and holds off while the user is using the computer.
 * Their input a moment before is waited out once, so the click with which they allowed it does not turn the bot away.
 */
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLinuxScreen } from './screen/linux.mjs';
import { createMacScreen } from './screen/mac.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = ['screen-helper.cs', 'screen-overlay.cs', 'screen-ui.cs'].map((name) => path.join(HERE, 'screen', name));
const MANIFEST = path.join(HERE, 'screen', 'screen-helper.manifest');
const QUIET_MS = 10 * 60_000;
/** How long ago the user's own input still holds an action off (the helper's USER_QUIET_MS). */
const USER_QUIET_MS = 1_500;
const KINDS = new Set(['click', 'move', 'scroll', 'drag', 'type', 'key']);
const ELEMENT_ACTIONS = new Set(['invoke', 'toggle', 'select', 'expand', 'collapse', 'set_value']);

const defaultDir = () => path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'com.willow.studio', 'screen');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The window a request means: a process id, a process name, or words in its title — or, with none, the one in front. */
export const windowTarget = (payload = {}) => {
  const target = {};
  const pid = Math.round(Number(payload.pid));
  if (Number.isInteger(pid) && pid > 0) target.pid = pid;
  if (typeof payload.process === 'string' && payload.process.trim()) target.process = payload.process.trim().slice(0, 120);
  if (typeof payload.title === 'string' && payload.title.trim()) target.title = payload.title.trim().slice(0, 200);
  return target;
};

/**
 * @param {{ platform?: string, dir?: string, log?: (...parts: unknown[]) => void, protectPids?: number[], launch?: () => Promise<import('node:child_process').ChildProcess>, onEvent?: (event: Record<string, unknown>) => void, run?: Function }} options
 * `launch` (Windows) and `run` (macOS, Linux) stand in for the system's own tools, in tests.
 */
export function createScreen(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') return createWindowsScreen(options);
  if (platform === 'darwin') return createMacScreen(options);
  if (platform === 'linux') return createLinuxScreen(options);
  return null;
}

const compiler = () => {
  const windows = process.env.WINDIR || 'C:\\Windows';
  return [path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(windows, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find((candidate) => existsSync(candidate));
};

function createWindowsScreen({ dir = defaultDir(), log = () => {}, protectPids = [], launch, onEvent = () => {} } = {}) {
  let helper = null;
  let starting = null;
  let quietTimer = null;
  let counter = 0;

  const build = async () => {
    const [manifest, ...sources] = await Promise.all([fs.readFile(MANIFEST), ...SOURCES.map((source) => fs.readFile(source))]);
    const hash = crypto.createHash('sha256');
    for (const source of sources) hash.update(source);
    const exe = path.join(dir, `willow-screen-${hash.update(manifest).digest('hex').slice(0, 12)}.exe`);
    if (existsSync(exe)) return exe;
    const csc = compiler();
    if (!csc) throw new Error("Windows' .NET Framework is missing, and Willow needs it to see the screen.");
    // The overlay draws with Windows Forms; UI Automation and its types come with WPF, beside the compiler.
    const wpf = path.join(path.dirname(csc), 'WPF');
    const references = ['System.Drawing.dll', 'System.Web.Extensions.dll', 'System.Windows.Forms.dll', path.join(wpf, 'UIAutomationClient.dll'), path.join(wpf, 'UIAutomationTypes.dll'), path.join(wpf, 'WindowsBase.dll')];
    await fs.mkdir(dir, { recursive: true });
    const temp = path.join(dir, `building-${process.pid}-${Date.now()}.exe`);
    await new Promise((resolve, reject) => {
      execFile(csc, ['/nologo', '/target:exe', '/platform:anycpu', '/optimize+', `/out:${temp}`, `/win32manifest:${MANIFEST}`, ...references.map((reference) => `/reference:${reference}`), ...SOURCES], { windowsHide: true, timeout: 180_000 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`Willow could not build its screen helper: ${String(stdout || stderr || error.message).trim().slice(0, 400)}`));
        else resolve();
      });
    });
    await fs.rename(temp, exe).catch(async (error) => {
      await fs.rm(temp, { force: true }).catch(() => {});
      if (!existsSync(exe)) throw error;
    });
    // Builds of older sources, unless another run still has one open.
    for (const name of await fs.readdir(dir).catch(() => [])) {
      if (/^willow-screen-[0-9a-f]+\.exe$/.test(name) && path.join(dir, name) !== exe) await fs.rm(path.join(dir, name), { force: true }).catch(() => {});
    }
    return exe;
  };

  const startChild = async () => {
    if (launch) return launch();
    const exe = await build();
    const args = [...new Set(protectPids.filter((pid) => Number.isInteger(pid) && pid > 0))].flatMap((pid) => ['--protect-pid', String(pid)]);
    return spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  };

  const start = async () => {
    const child = await startChild();
    const state = { child, pending: new Map(), buffer: '' };
    const ready = new Promise((resolve, reject) => {
      state.ready = resolve;
      state.failed = reject;
      setTimeout(() => reject(new Error('The screen helper did not start.')), 30_000).unref?.();
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      state.buffer += chunk;
      let end;
      while ((end = state.buffer.indexOf('\n')) >= 0) {
        const line = state.buffer.slice(0, end).trim();
        state.buffer = state.buffer.slice(end + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.ready) {
          state.ready();
          continue;
        }
        // Said by the helper on its own: the user stopped the bot from the overlay.
        if (typeof message.event === 'string') {
          try { onEvent(message); } catch (error) { log('screen event:', error?.message ?? error); }
          continue;
        }
        const waiting = state.pending.get(message.id);
        if (!waiting) continue;
        state.pending.delete(message.id);
        clearTimeout(waiting.timer);
        if (message.ok) waiting.resolve(message.result);
        else if (message.refused) waiting.resolve({ refused: message.refused, message: message.error });
        else waiting.reject(new Error(message.error || 'The screen helper could not do that.'));
      }
    });
    child.stderr?.on('data', (chunk) => log('screen helper:', String(chunk).trim().slice(0, 300)));
    const end = (why) => {
      if (helper === state) helper = null;
      for (const [, waiting] of state.pending) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error(why));
      }
      state.pending.clear();
      state.failed?.(new Error(why));
    };
    child.on('exit', (code) => end(`The screen helper stopped${code === null ? '' : ` (${code})`}.`));
    child.on('error', (error) => end(`The screen helper could not run: ${error.message}`));
    await ready;
    return state;
  };

  const ensure = async () => {
    if (helper) return helper;
    starting ??= start().then((state) => {
      helper = state;
      return state;
    }).finally(() => {
      starting = null;
    });
    return starting;
  };

  const restQuietly = () => {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => helper?.child.kill(), QUIET_MS);
    quietTimer.unref?.();
  };

  const ask = async (op, payload = {}, timeoutMs = 30_000) => {
    const state = await ensure();
    restQuietly();
    counter += 1;
    const id = counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error('The screen did not answer in time.'));
      }, timeoutMs);
      state.pending.set(id, { resolve, reject, timer });
      state.child.stdin.write(`${JSON.stringify({ ...payload, id, op })}\n`);
    });
  };

  const settle = (outcome) => (outcome?.refused ? { ok: false, refused: outcome.refused, message: outcome.message } : outcome);

  const act = async (payload) => {
    const kind = String(payload?.kind ?? '');
    if (!KINDS.has(kind)) throw new Error(`Unknown action on the screen: ${kind || 'none'}.`);
    const action = { kind };
    for (const key of ['x', 'y', 'toX', 'toY', 'clicks', 'deltaX', 'deltaY']) if (payload[key] !== undefined) action[key] = Math.round(Number(payload[key]));
    for (const key of ['button', 'hold', 'text', 'key', 'grant']) if (typeof payload[key] === 'string') action[key] = payload[key];
    // The overlay's cursor travels to each point first, so an action allows for its flight.
    const timeoutMs = kind === 'type' ? 60_000 + String(action.text ?? '').length * 20 : 30_000;
    let outcome = await ask('act', action, timeoutMs);
    if (outcome?.refused === 'user-active') {
      // Waited out once: the user's last touch may only have been to allow this.
      const info = await ask('info').catch(() => null);
      const idle = info?.userIdleMs;
      if (typeof idle === 'number' && idle < USER_QUIET_MS) await sleep(USER_QUIET_MS + 150 - idle);
      outcome = await ask('act', action, timeoutMs);
    }
    return outcome?.refused ? { ok: false, refused: outcome.refused, message: outcome.message } : { ok: true, ...outcome };
  };

  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

  return {
    platform: 'windows',
    requests: ['screen.info', 'screen.capture', 'screen.act', 'screen.apps', 'screen.elements', 'screen.element', 'screen.focus', 'screen.begin', 'screen.end'],
    handles: (type) => type.startsWith('screen.'),
    async handle(type, payload = {}) {
      if (type === 'screen.info') return { platform: 'windows', mode: 'shared', ...(await ask('info')) };
      if (type === 'screen.capture') {
        return settle(await ask('capture', payload.monitor === undefined ? {} : { monitor: Math.round(Number(payload.monitor)) || 0 }, 30_000));
      }
      if (type === 'screen.act') return act(payload);
      if (type === 'screen.apps') return settle(await ask('apps', {}, 15_000));
      if (type === 'screen.elements') return settle(await ask('elements', windowTarget(payload), 30_000));
      if (type === 'screen.element') {
        const action = String(payload.action ?? 'invoke');
        if (!ELEMENT_ACTIONS.has(action)) throw new Error(`Unknown action on an element: ${action}.`);
        const request = { snapshot: Math.round(Number(payload.snapshot)) || 0, index: Math.round(Number(payload.index)), action };
        if (action === 'set_value') request.value = text(payload.value, 20_000);
        return settle(await ask('element', request, 20_000));
      }
      if (type === 'screen.focus') return settle(await ask('focus', windowTarget(payload), 15_000));
      if (type === 'screen.begin') {
        const color = typeof payload.color === 'string' && /^#?[0-9a-f]{6}$/i.test(payload.color) ? payload.color : '';
        return ask('begin', { name: text(payload.name, 40), color, grant: text(payload.grant, 80), session: text(payload.session, 120) }, 20_000);
      }
      if (type === 'screen.end') {
        // Nothing to take down when the helper is not running.
        if (!helper) return { shown: false };
        return ask('end', {}, 10_000);
      }
      throw new Error(`Unknown companion request: ${type}`);
    },
    dispose() {
      clearTimeout(quietTimer);
      helper?.child.kill();
      helper = null;
    },
  };
}
