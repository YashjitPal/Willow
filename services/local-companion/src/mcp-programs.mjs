/**
 * MCP servers that are programs on this computer — MCP's stdio transport — for the desktop app. The program the user
 * named starts with no shell between (a Windows `.cmd` launcher such as `npx` goes through cmd.exe with every argument
 * quoted, as cross-spawn does it), and speaks JSON-RPC one message per line on its input and output.
 *
 * - `mcp.start { id, command, args?, env?, cwd? }` → `{ id, pid }`: starts it, ending one already under that id.
 * - `mcp.send { id, message }`: one message to its input.
 * - `mcp.stop { id }`: closes its input, then ends it and everything it started.
 * Its messages go to the window that started it as `mcp.message { id, message }`, and its end as
 * `mcp.exit { id, code, signal, stderr }` with the last of what it printed there. A window that goes away takes its
 * programs with it.
 *
 * What runs is what the user typed when they added the server; nothing here decides. The companion's own settings —
 * its pairing token — stay out of the program's environment.
 */
import { spawn, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_PROGRAMS = 32;
const MAX_LINE_BYTES = 32 * 1024 * 1024;
const STDERR_TAIL = 8 * 1024;
const MAX_ENV = 100;
const STOP_GRACE_MS = 1_500;

/** What each well-known launcher comes with, for when it is missing. */
const COMES_WITH = {
  npx: 'Node.js (nodejs.org)',
  node: 'Node.js (nodejs.org)',
  npm: 'Node.js (nodejs.org)',
  pnpm: 'pnpm (pnpm.io)',
  bun: 'Bun (bun.sh)',
  bunx: 'Bun (bun.sh)',
  deno: 'Deno (deno.com)',
  uv: 'uv (docs.astral.sh/uv)',
  uvx: 'uv (docs.astral.sh/uv)',
  python: 'Python (python.org)',
  python3: 'Python (python.org)',
  py: 'Python (python.org)',
  pipx: 'pipx (pipx.pypa.io)',
  docker: 'Docker Desktop (docker.com)',
};

const isFile = (file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

const isDirectory = (folder) => {
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
};

/** An environment variable by name, any case — Windows has `Path`, and either spelling may be set. */
const envValue = (env, name) => {
  const key = Object.keys(env).find((entry) => entry.toUpperCase() === name);
  return key ? env[key] : undefined;
};

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
/** cmd.exe's escaping of the file it runs. */
export const cmdCommand = (file) => file.replace(CMD_META, '^$1');
/** cmd.exe's escaping of one argument: quoted for the program, then its metacharacters (twice for an npm shim). */
export const cmdArgument = (arg, twice = false) => {
  const quoted = `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`.replace(CMD_META, '^$1');
  return twice ? quoted.replace(CMD_META, '^$1') : quoted;
};

/**
 * Where `command` is: itself when it names a path, else the first match on the search path and then in `extra` —
 * on Windows trying PATHEXT's extensions in order, since a bare name there is a shell script for another shell.
 */
export function resolveCommand(command, { env = process.env, platform = process.platform, exists = isFile, extra = [] } = {}) {
  const windows = platform === 'win32';
  const join = windows ? path.win32.join : path.posix.join;
  const extensions = windows ? (envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((ext) => ext.toLowerCase()) : [];
  const forms = (base) => {
    if (!windows) return [base];
    const ext = path.win32.extname(base).toLowerCase();
    return ext && extensions.includes(ext) ? [base] : extensions.map((entry) => `${base}${entry}`);
  };
  if (/[\\/]/.test(command)) return forms(command).find(exists) ?? null;
  const dirs = [...String(envValue(env, 'PATH') || '').split(windows ? ';' : ':'), ...extra].map((dir) => dir.replace(/^"|"$/g, '')).filter(Boolean);
  for (const dir of dirs) {
    const found = forms(join(dir, command)).find(exists);
    if (found) return found;
  }
  return null;
}

let loginPath;
/** The PATH the user's login shell sets up — an app opened from the Dock or a menu gets a bare one — asked once. */
const shellPath = (platform) => {
  if (platform === 'win32') return '';
  if (loginPath !== undefined) return loginPath;
  loginPath = '';
  try {
    const shell = process.env.SHELL && isFile(process.env.SHELL) ? process.env.SHELL : platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
    const marker = '__WILLOW_PATH__';
    const run = spawnSync(shell, ['-ilc', `printf '%s%s%s' ${marker} "$PATH" ${marker}`], { encoding: 'utf8', timeout: 4_000, stdio: ['ignore', 'pipe', 'ignore'] });
    loginPath = String(run.stdout || '').split(marker)[1] ?? '';
  } catch {
    /* No login shell to ask: the PATH the companion has, and the usual places. */
  }
  return loginPath;
};

/** Where launchers usually are when the PATH does not say: beside the companion's own Node, and per-user tool folders. */
const usualDirs = (platform) => {
  const home = os.homedir();
  return [
    path.dirname(process.execPath),
    ...(platform === 'win32'
      ? [path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'), path.join(home, '.local', 'bin'), path.join(home, '.bun', 'bin')]
      : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.deno', 'bin'), path.join(home, '.cargo', 'bin')]),
  ];
};

/** The program's environment: the companion's, less its own settings, with the user's variables over it. */
export function programEnv(base, extra = {}, platform = process.platform) {
  const env = {};
  for (const [key, value] of Object.entries(base)) if (typeof value === 'string' && !/^WILLOW_COMPANION/i.test(key)) env[key] = value;
  if (platform !== 'win32') {
    const login = shellPath(platform);
    if (login) env.PATH = [...new Set([...login.split(':'), ...String(env.PATH || '').split(':')].filter(Boolean))].join(':');
  }
  for (const [key, value] of Object.entries(extra && typeof extra === 'object' ? extra : {}).slice(0, MAX_ENV)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || /^WILLOW_COMPANION/i.test(key)) continue;
    if (platform === 'win32') for (const existing of Object.keys(env)) if (existing.toUpperCase() === key.toUpperCase()) delete env[existing];
    env[key] = value;
  }
  return env;
}

/** Starts `file`: directly, or a `.cmd`/`.bat` launcher through cmd.exe with everything escaped for it. */
export function launch(file, args, options, platform = process.platform) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    const shim = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(file);
    const line = [cmdCommand(path.win32.normalize(file)), ...args.map((arg) => cmdArgument(arg, shim))].join(' ');
    return spawn(envValue(options.env ?? process.env, 'COMSPEC') || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...options, windowsVerbatimArguments: true });
  }
  return spawn(file, args, options);
}

const killTree = (child, platform) => {
  if (!child.pid) return;
  if (platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => undefined);
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }, 3_000).unref?.();
};

const tail = (text) => (text.length > STDERR_TAIL ? text.slice(-STDERR_TAIL) : text);

/**
 * @param {{ send: (session: object, name: string, payload: unknown) => void, log?: Function, platform?: string,
 *   start?: typeof launch, resolve?: typeof resolveCommand, baseEnv?: Record<string, string | undefined>,
 *   kill?: (child: import('node:child_process').ChildProcess, platform: string) => void, extraDirs?: string[] }} options
 */
export function createMcpPrograms({ send, log = () => {}, platform = process.platform, start = launch, resolve = resolveCommand, baseEnv = process.env, kill = killTree, extraDirs = usualDirs(platform) }) {
  const programs = new Map();
  const keyOf = (session, id) => `${session.id}\u0000${id}`;

  const end = (program) => {
    programs.delete(program.key);
    if (!program.running) return;
    try { program.child.stdin.end(); } catch { /* already closed */ }
    setTimeout(() => {
      if (program.running) kill(program.child, platform);
    }, STOP_GRACE_MS).unref?.();
  };

  async function begin(session, payload) {
    const id = String(payload.id || '');
    if (!/^[\w.:-]{1,200}$/.test(id)) throw new Error('A program needs an id.');
    const command = String(payload.command || '').trim();
    if (!command) throw new Error('Enter the command that starts the server.');
    const args = Array.isArray(payload.args) ? payload.args.map(String) : [];
    if (args.length > 500 || [command, ...args].join(' ').length > 32_000) throw new Error('The command is too long.');
    const key = keyOf(session, id);
    if (programs.has(key)) end(programs.get(key));
    if (programs.size >= MAX_PROGRAMS) throw new Error(`At most ${MAX_PROGRAMS} programs run at once. Turn one off first.`);

    const env = programEnv(baseEnv, payload.env, platform);
    const file = resolve(command, { env, platform, extra: extraDirs });
    if (!file) {
      const name = path.basename(command).replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();
      throw new Error(COMES_WITH[name]
        ? `Willow could not find ${name} on this computer. It comes with ${COMES_WITH[name]}: install that, then try again.`
        : `Willow could not find ${command} on this computer. Check the command, or give its full path.`);
    }
    const cwd = payload.cwd ? path.resolve(String(payload.cwd)) : os.homedir();
    if (!isDirectory(cwd)) throw new Error(`There is no folder at ${cwd}.`);

    const child = start(file, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], detached: platform !== 'win32' }, platform);
    await new Promise((resolveSpawn, reject) => {
      child.once('spawn', resolveSpawn);
      child.once('error', reject);
    }).catch((error) => {
      throw new Error(`${command} could not start: ${error.message}`);
    });

    const program = { key, id, session, child, running: true, stderr: '', pending: Buffer.alloc(0) };
    programs.set(key, program);
    log(`program ${id} started: ${path.basename(file)}`);
    child.stdout.on('data', (chunk) => {
      program.pending = program.pending.length ? Buffer.concat([program.pending, chunk]) : chunk;
      let newline = program.pending.indexOf(10);
      while (newline !== -1) {
        const line = program.pending.subarray(0, newline).toString('utf8').trim();
        program.pending = program.pending.subarray(newline + 1);
        newline = program.pending.indexOf(10);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          // A program that logs to its output instead of stderr: kept with what it printed, never passed on.
          program.stderr = tail(`${program.stderr}${line}\n`);
          continue;
        }
        send(session, 'mcp.message', { id, message });
      }
      if (program.pending.length > MAX_LINE_BYTES) {
        program.pending = Buffer.alloc(0);
        program.stderr = tail(`${program.stderr}(a message too large to read was dropped)\n`);
      }
    });
    child.stderr.on('data', (chunk) => {
      program.stderr = tail(program.stderr + chunk.toString('utf8'));
    });
    child.stdin.on('error', () => { /* Written to after it ended: the exit says so. */ });
    child.once('error', (error) => {
      program.stderr = tail(`${program.stderr}${error.message}\n`);
    });
    child.once('close', (code, signal) => {
      program.running = false;
      if (programs.get(key) === program) programs.delete(key);
      log(`program ${id} ended: ${code ?? signal}`);
      send(session, 'mcp.exit', { id, code, signal, stderr: program.stderr.trim() });
    });
    return { id, pid: child.pid };
  }

  const write = (session, payload) => {
    const program = programs.get(keyOf(session, String(payload.id || '')));
    if (!program?.running) throw new Error('The program has stopped.');
    const line = JSON.stringify(payload.message);
    if (line === undefined) throw new Error('There is no message to send.');
    program.child.stdin.write(`${line}\n`);
    return { sent: true };
  };

  return {
    requests: ['mcp.start', 'mcp.send', 'mcp.stop'],
    async handle(session, type, payload) {
      if (type === 'mcp.start') return begin(session, payload);
      if (type === 'mcp.send') return write(session, payload);
      if (type === 'mcp.stop') {
        const program = programs.get(keyOf(session, String(payload.id || '')));
        if (program) end(program);
        return { stopped: Boolean(program) };
      }
      throw new Error(`Unknown companion request: ${type}`);
    },
    /** A window that went away: its programs end with it. */
    release(session) {
      for (const program of [...programs.values()]) if (program.session === session) end(program);
    },
    dispose() {
      for (const program of [...programs.values()]) {
        end(program);
        if (program.running) kill(program.child, platform);
      }
    },
  };
}
