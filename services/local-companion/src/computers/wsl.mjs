/**
 * wsl.exe, with the care it needs.
 *
 * - Every call has a time limit. A WSL call that waits on something — a
 *   network, a prompt, a stuck VM — otherwise waits for ever.
 * - WSL's own messages come back as UTF-8 (`WSL_UTF8`), not UTF-16.
 * - Only distros named `Willow-…` are ever named. The user's own distros share
 *   this machine's WSL and must never be started, stopped or touched.
 */
import { spawn } from 'node:child_process';

export const DISTRO_PREFIX = 'Willow-';

export const assertOwnDistro = (name) => {
  if (typeof name !== 'string' || !name.startsWith(DISTRO_PREFIX) || !/^[A-Za-z0-9._-]{1,60}$/.test(name)) {
    throw new Error(`Willow only works with its own WSL distros, not "${name}".`);
  }
  return name;
};

const clean = (text) => text.replace(/\0/g, '').replace(/\r/g, '');

/**
 * Runs wsl.exe and resolves to `{ code, stdout, stderr }` — or rejects when it
 * outlives `timeoutMs`, after killing it. `onLine` sees stdout line by line.
 */
export const wsl = (args, { timeoutMs = 60_000, input, onLine, signal } = {}) => new Promise((resolve, reject) => {
  const child = spawn('wsl.exe', args, {
    env: { ...process.env, WSL_UTF8: '1' },
    windowsHide: true,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let pending = '';
  let settled = false;
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (error) reject(error);
    else resolve(value);
  };
  const timer = setTimeout(() => {
    child.kill();
    finish(new Error(`wsl ${args.slice(0, 3).join(' ')} did not finish within ${Math.round(timeoutMs / 1000)} seconds.`));
  }, timeoutMs);
  const onAbort = () => {
    child.kill();
    finish(new Error('Stopped.'));
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
    if (!onLine) return;
    pending += clean(chunk);
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      try {
        onLine(line);
      } catch {}
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
  });
  child.once('error', (error) => finish(error.code === 'ENOENT' ? new Error('wsl.exe is not installed.') : error));
  child.once('close', (code) => {
    if (onLine && pending) onLine(pending);
    finish(null, { code: code ?? -1, stdout: clean(stdout), stderr: clean(stderr) });
  });
  if (input !== undefined) child.stdin.end(input);
});

/** What `wsl.exe` printed when something failed, in one line. */
export const wslMessage = (result) => (result.stderr.trim() || result.stdout.trim()).split('\n').map((line) => line.trim()).filter(Boolean).slice(-3).join(' ');

const expectSuccess = (result, what) => {
  if (result.code === 0) return result;
  throw new Error(`${what} failed: ${wslMessage(result) || `wsl.exe exited with ${result.code}`}`);
};

/** The installed WSL version, or why there is none that will do. */
export const wslSupport = async () => {
  if (process.platform !== 'win32') return { supported: false, reason: 'unsupported-os' };
  let result;
  try {
    result = await wsl(['--version'], { timeoutMs: 20_000 });
  } catch (error) {
    return { supported: false, reason: /not installed/.test(error.message) ? 'wsl-missing' : 'wsl-unresponsive', detail: error.message };
  }
  const version = /WSL[^:\n]*:\s*([\d.]+)/i.exec(result.stdout)?.[1];
  if (result.code !== 0 || !version) return { supported: false, reason: 'wsl-missing', detail: wslMessage(result) };
  return { supported: true, version };
};

/**
 * Every distro name WSL knows. `strict` rejects when WSL cannot say, rather
 * than answering "none" — WSL also fails the call when there are no distros,
 * which is why only callers that act on an absence ask for it.
 */
export const listDistros = async ({ strict = false } = {}) => {
  const result = await wsl(['--list', '--quiet'], { timeoutMs: 30_000 });
  if (result.code !== 0) {
    if (strict) throw new Error(`wsl --list failed: ${wslMessage(result) || `exit ${result.code}`}`);
    return [];
  }
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
};

export const isRegistered = async (name) => (await listDistros()).includes(assertOwnDistro(name));

export const importDistro = async (name, installDir, file, { vhd = false, timeoutMs = 15 * 60_000 } = {}) => whileBusy(
  () => wsl(['--import', assertOwnDistro(name), installDir, file, '--version', '2', ...(vhd ? ['--vhd'] : [])], { timeoutMs }),
  `Creating ${name}`,
);

/** Each distro's state, as `wsl --list --verbose` reports it (`Running`, `Stopped`, …). */
export const distroStates = async () => {
  const result = await wsl(['--list', '--verbose'], { timeoutMs: 30_000 });
  const states = new Map();
  for (const line of result.stdout.split('\n').slice(1)) {
    const match = /^\s*\*?\s*(\S+)\s+(\S+)\s+\d+\s*$/.exec(line);
    if (match) states.set(match[1], match[2]);
  }
  return states;
};

/** Stops a distro and waits until WSL reports it stopped. */
export const stopDistro = async (name, timeoutMs = 60_000) => {
  await terminateDistro(name);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = (await distroStates().catch(() => new Map())).get(assertOwnDistro(name));
    if (!state || state === 'Stopped') return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
};

const BUSY = /SHARING_VIOLATION|being used by another process/i;

/**
 * A freshly written disk is held for a while after its distro stops — by the
 * antivirus scanning it, typically — and WSL refuses it meanwhile. Waiting is
 * all it takes.
 */
const whileBusy = async (attempt, what) => {
  for (let tries = 1; ; tries += 1) {
    const result = await attempt();
    if (result.code === 0 || tries >= 8 || !BUSY.test(wslMessage(result))) return expectSuccess(result, what);
    await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 4_000 * tries)));
  }
};

/**
 * A distro's files as a tar, read through the distro itself. A copy of its disk
 * image is not the same thing: WSL may not have written everything to it yet.
 */
export const exportDistro = async (name, file, { timeoutMs = 20 * 60_000 } = {}) => whileBusy(
  () => wsl(['--export', assertOwnDistro(name), file], { timeoutMs }),
  `Saving ${name}`,
);

export const terminateDistro = async (name) => {
  await wsl(['--terminate', assertOwnDistro(name)], { timeoutMs: 60_000 }).catch(() => undefined);
};

export const unregisterDistro = async (name) => {
  if (!(await isRegistered(name))) return;
  await stopDistro(name);
  await whileBusy(() => wsl(['--unregister', assertOwnDistro(name)], { timeoutMs: 5 * 60_000 }), `Removing ${name}`);
};

/** A shell command in one of Willow's distros, as root unless said otherwise. */
export const runIn = async (name, command, { user = 'root', input, timeoutMs = 60_000, onLine, signal } = {}) => wsl(
  ['-d', assertOwnDistro(name), '-u', user, '--cd', '/', '--exec', '/bin/sh', '-c', command],
  { input, timeoutMs, onLine, signal },
);

/** The arguments that start a long-running process in one of Willow's distros. */
export const execArgs = (name, program, args = [], user = 'root') => ['-d', assertOwnDistro(name), '-u', user, '--cd', '/', '--exec', program, ...args];

/**
 * What one shell command in a Willow distro prints, fed to another's, as root
 * in both: a tar of a folder, moved across without a copy on Windows between.
 */
export const pipeBetween = ({ from, fromCommand, to, toCommand, timeoutMs = 10 * 60_000 }) => new Promise((resolve, reject) => {
  const env = { ...process.env, WSL_UTF8: '1' };
  const shell = (name, command) => ['-d', assertOwnDistro(name), '-u', 'root', '--cd', '/', '--exec', '/bin/sh', '-c', command];
  const reader = spawn('wsl.exe', shell(from, fromCommand), { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const writer = spawn('wsl.exe', shell(to, toCommand), { env, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  const errors = { reader: '', writer: '' };
  for (const [name, child] of [['reader', reader], ['writer', writer]]) {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => {
      errors[name] = (errors[name] + text).slice(-2_000);
    });
  }
  writer.stdin.on('error', () => undefined);
  reader.stdout.pipe(writer.stdin);
  const codes = {};
  let settled = false;
  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (!error) return resolve();
    reader.kill();
    writer.kill();
    reject(error);
  };
  const timer = setTimeout(() => finish(new Error(`Copying from ${from} did not finish within ${Math.round(timeoutMs / 60_000)} minutes.`)), timeoutMs);
  const done = (name, code) => {
    codes[name] = code ?? -1;
    if (codes[name] !== 0) {
      const detail = clean(errors[name]).trim().split('\n').pop() || `exit ${codes[name]}`;
      finish(new Error(`${name === 'reader' ? `Reading from ${from}` : `Writing to ${to}`} failed: ${detail}`));
    } else if (codes.reader === 0 && codes.writer === 0) {
      finish(null);
    }
  };
  reader.once('close', (code) => done('reader', code));
  writer.once('close', (code) => done('writer', code));
  reader.once('error', finish);
  writer.once('error', finish);
});
