/**
 * Spark's native runtime in the desktop app: Codex's unified exec and direct
 * filesystem access, for the `spark.*` requests.
 *
 * The browser build of Spark runs its harness against a private, in-memory
 * workspace with no shell. The desktop app does not need that conversion, so
 * this gives the same harness what Codex itself runs on: commands executed in a
 * real shell, with Codex's yield/session semantics (`exec_command`,
 * `write_stdin`), and files read and written where they are on disk.
 *
 * Nothing here decides whether something may run. The page asks the user before
 * a command runs (Spark's approval card) and resolves every path it sends; this
 * module only carries out what it is given, like Codex's executor.
 */

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/* Codex's unified exec constants (codex-rs/core/src/unified_exec/mod.rs). */
export const MIN_YIELD_TIME_MS = 250;
export const WINDOWS_INITIAL_EXEC_YIELD_TIME_FLOOR_MS = 10_000;
export const MIN_EMPTY_YIELD_TIME_MS = 5_000;
export const MAX_YIELD_TIME_MS = 30_000;
export const MAX_WRITE_STDIN_YIELD_TIME_MS = 300_000;
export const DEFAULT_EXEC_YIELD_TIME_MS = 10_000;
export const DEFAULT_WRITE_STDIN_YIELD_TIME_MS = 250;
export const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
export const OUTPUT_MAX_BYTES = 1024 * 1024;
export const MAX_PROCESSES = 64;
const TRAILING_OUTPUT_GRACE_MS = 100;
const APPROX_BYTES_PER_TOKEN = 4;
const INTERRUPT = '\u0003';

/** The environment Codex gives every command, so tools print plain text rather than pagers and colour. */
const EXEC_ENV = {
  NO_COLOR: '1',
  TERM: 'dumb',
  LANG: 'C.UTF-8',
  LC_CTYPE: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  COLORTERM: '',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
  GH_PAGER: 'cat',
  WILLOW_SPARK: '1',
};

const MAX_TEXT_READ_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_LIST_ENTRIES = 2_000;
const MAX_SEARCH_MATCHES = 200;
const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
/** Folders a listing names but does not open, and a search does not enter. */
const HEAVY_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.turbo', '.cache', '__pycache__', '.venv', 'venv', '.gradle', '.idea', '.vs', 'bin', 'obj']);
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };

/* ------------------------------------------------------------------------ */
/* Pure helpers, exported for tests                                          */
/* ------------------------------------------------------------------------ */

/** `clamp_yield_time` from Codex: Windows waits at least 10 s before handing back a session. */
export function clampExecYield(value, platform = process.platform) {
  const requested = Number.isFinite(Number(value)) && value !== undefined && value !== null ? Number(value) : DEFAULT_EXEC_YIELD_TIME_MS;
  const floored = platform === 'win32' ? Math.max(requested, WINDOWS_INITIAL_EXEC_YIELD_TIME_FLOOR_MS) : requested;
  return Math.min(Math.max(floored, MIN_YIELD_TIME_MS), MAX_YIELD_TIME_MS);
}

/** `write_stdin`'s yield: 250 ms after a write, at least 5 s for an empty poll. */
export function clampStdinYield(value, chars) {
  const requested = Number.isFinite(Number(value)) && value !== undefined && value !== null ? Number(value) : DEFAULT_WRITE_STDIN_YIELD_TIME_MS;
  if (chars) return Math.min(Math.max(requested, MIN_YIELD_TIME_MS), MAX_YIELD_TIME_MS);
  return Math.min(Math.max(requested, MIN_EMPTY_YIELD_TIME_MS), MAX_WRITE_STDIN_YIELD_TIME_MS);
}

export const approxTokenCount = (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / APPROX_BYTES_PER_TOKEN);

/** The longest prefix of `text` within `bytes` UTF-8 bytes, never splitting a character. */
const headWithin = (text, bytes) => {
  let used = 0;
  let index = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8');
    if (used + size > bytes) break;
    used += size;
    index += char.length;
  }
  return text.slice(0, index);
};

const tailWithin = (text, bytes) => {
  const chars = Array.from(text);
  let used = 0;
  let start = chars.length;
  while (start > 0) {
    const size = Buffer.byteLength(chars[start - 1], 'utf8');
    if (used + size > bytes) break;
    used += size;
    start -= 1;
  }
  return chars.slice(start).join('');
};

/**
 * Codex's `formatted_truncate_text` with a token budget: the head and tail of the
 * output around `…N tokens truncated…`, under a warning naming the original size.
 */
export function truncateOutput(text, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS) {
  const budget = Math.max(0, Math.floor(maxTokens)) * APPROX_BYTES_PER_TOKEN;
  const size = Buffer.byteLength(text, 'utf8');
  if (size <= budget) return { text, truncated: false, originalTokenCount: null };
  const originalTokenCount = approxTokenCount(text);
  const totalLines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const head = headWithin(text, Math.floor(budget / 2));
  const tail = tailWithin(text.slice(head.length), budget - Buffer.byteLength(head, 'utf8'));
  const removedTokens = Math.ceil((size - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8')) / APPROX_BYTES_PER_TOKEN);
  return {
    text: `Warning: truncated output (original token count: ${originalTokenCount})\nTotal output lines: ${Math.max(totalLines, 1)}\n\n${head}…${removedTokens} tokens truncated…${tail}`,
    truncated: true,
    originalTokenCount,
  };
}

/** Codex's `ExecCommandToolOutput::response_text`: the header lines, then the output. */
export function formatExecResponse({ chunkId, wallTimeMs, exitCode, sessionId, originalTokenCount, output }) {
  const lines = [];
  if (chunkId) lines.push(`Chunk ID: ${chunkId}`);
  lines.push(`Wall time: ${(wallTimeMs / 1000).toFixed(4)} seconds`);
  if (exitCode !== null && exitCode !== undefined) lines.push(`Process exited with code ${exitCode}`);
  if (sessionId !== null && sessionId !== undefined) lines.push(`Process running with session ID ${sessionId}`);
  if (originalTokenCount !== null && originalTokenCount !== undefined) lines.push(`Original token count: ${originalTokenCount}`);
  lines.push('Output:');
  return `${lines.join('\n')}\n${output}`;
}

export const generateChunkId = () => crypto.randomBytes(3).toString('hex');

/* ------------------------------------------------------------------------ */
/* Shells                                                                    */
/* ------------------------------------------------------------------------ */

const firstExisting = (candidates) => candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;

const whereOnPath = (name) => {
  try {
    const found = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8', windowsHide: true, timeout: 3_000 });
    const line = String(found.stdout || '').split(/\r?\n/).map((entry) => entry.trim()).find(Boolean);
    return line && existsSync(line) ? line : null;
  } catch {
    return null;
  }
};

let defaultShell = null;

/** The user's default shell, as Codex picks it: PowerShell 7 if present, else Windows PowerShell; `$SHELL` elsewhere. */
export function userShell() {
  if (defaultShell) return defaultShell;
  if (process.platform === 'win32') {
    const pwsh = firstExisting([path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')]) ?? whereOnPath('pwsh');
    const windowsPowerShell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    defaultShell = pwsh ? { name: 'powershell', path: pwsh } : { name: 'powershell', path: windowsPowerShell };
    return defaultShell;
  }
  const configured = process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : null;
  const shellPath = configured ?? firstExisting(['/bin/zsh', '/bin/bash', '/bin/sh']) ?? '/bin/sh';
  defaultShell = { name: path.basename(shellPath), path: shellPath };
  return defaultShell;
}

/** A requested shell (`pwsh`, `powershell`, `cmd`, `bash`, a path), or the default. */
function resolveShell(requested) {
  const wanted = String(requested || '').trim();
  if (!wanted) return userShell();
  const lower = wanted.toLowerCase().replace(/\.exe$/, '');
  if (process.platform === 'win32') {
    if (lower === 'cmd') return { name: 'cmd', path: process.env.ComSpec || 'cmd.exe' };
    if (lower === 'powershell' || lower === 'pwsh') return userShell();
    if (lower === 'bash' || lower === 'sh') {
      const bash = whereOnPath('bash') ?? firstExisting([path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')]);
      if (!bash) throw new Error('bash is not installed on this computer. Use PowerShell instead.');
      return { name: 'bash', path: bash };
    }
  }
  if (existsSync(wanted)) return { name: path.basename(wanted).replace(/\.exe$/i, '').toLowerCase(), path: wanted };
  const found = whereOnPath(wanted);
  if (!found) throw new Error(`The shell "${wanted}" is not installed on this computer.`);
  return { name: lower, path: found };
}

/** The argv that runs `command` in `shell`, as Codex launches each kind. */
export function shellArgs(shell, command, login = true) {
  if (shell.name === 'powershell' || shell.name === 'pwsh') {
    /*
     * `-Command`, as Codex launches it. `-EncodedCommand` would dodge quoting, but Windows
     * PowerShell then writes errors and warnings to stderr as CLIXML instead of text.
     * UTF-8 output so native programs' text decodes; no progress records, which also
     * makes `Invoke-WebRequest` usably fast.
     */
    const script = `$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.Encoding]::UTF8\n${command}`;
    return { args: ['-NoLogo', '-NoProfile', '-Command', script], verbatim: false };
  }
  if (shell.name === 'cmd') return { args: ['/d', '/s', '/c', `"${command}"`], verbatim: true };
  return { args: [login ? '-lc' : '-c', command], verbatim: false };
}

/* ------------------------------------------------------------------------ */
/* Processes                                                                 */
/* ------------------------------------------------------------------------ */

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => undefined);
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }, 2_000).unref();
}

/** Unread output, capped like Codex's head/tail buffer: the first and last half megabyte survive. */
class OutputBuffer {
  constructor(maxBytes = OUTPUT_MAX_BYTES) {
    this.maxBytes = maxBytes;
    this.head = '';
    this.tail = '';
    this.omitted = 0;
  }

  push(text) {
    if (!text) return;
    const half = Math.floor(this.maxBytes / 2);
    if (this.omitted === 0 && Buffer.byteLength(this.head, 'utf8') + Buffer.byteLength(text, 'utf8') <= this.maxBytes) {
      this.head += text;
      return;
    }
    if (this.omitted === 0) {
      const all = this.head + text;
      this.head = headWithin(all, half);
      this.tail = all.slice(this.head.length);
    } else {
      this.tail += text;
    }
    const tailBytes = Buffer.byteLength(this.tail, 'utf8');
    if (tailBytes > this.maxBytes - half) {
      const kept = tailWithin(this.tail, this.maxBytes - half);
      this.omitted += tailBytes - Buffer.byteLength(kept, 'utf8');
      this.tail = kept;
    }
  }

  drain() {
    const text = this.omitted ? `${this.head}\n... ${this.omitted} bytes omitted ...\n${this.tail}` : `${this.head}${this.tail}`;
    this.head = '';
    this.tail = '';
    this.omitted = 0;
    return text;
  }
}

/* ------------------------------------------------------------------------ */
/* The runtime                                                               */
/* ------------------------------------------------------------------------ */

const asString = (value) => (typeof value === 'string' ? value : '');

const requireAbsolute = (value, what = 'path') => {
  const raw = asString(value).trim();
  if (!raw) throw new Error(`A ${what} is required.`);
  if (!path.isAbsolute(raw)) throw new Error(`The ${what} must be absolute: ${raw}`);
  return path.resolve(raw);
};

const looksBinary = (buffer) => {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000));
  return sample.includes(0);
};

export function createSparkRuntime() {
  /** @type {Map<number, any>} */
  const sessions = new Map();
  let nextSessionId = 1;

  const prune = () => {
    if (sessions.size < MAX_PROCESSES) return;
    const finished = [...sessions.values()].filter((session) => session.exited);
    for (const session of finished) sessions.delete(session.id);
    if (sessions.size < MAX_PROCESSES) return;
    const oldest = [...sessions.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (oldest) {
      killTree(oldest.child);
      sessions.delete(oldest.id);
    }
  };

  /**
   * Codex's completion rule (`TRAILING_OUTPUT_GRACE` in unified_exec/async_watcher.rs): a
   * command is finished once its output closes, or once its process has exited and 100 ms
   * have passed for its last output. Closed pipes are not required: anything the command
   * left running in the background (an installer opening the app it installed, a server)
   * inherits them and can hold them open indefinitely.
   */
  const isFinished = (session) => session.exited && (session.closed || session.drained);

  /** Waits until the command is finished, by that rule, or the deadline passes. */
  const settle = (session, deadline) => new Promise((resolve) => {
    if (isFinished(session)) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      session.waiters.delete(onChange);
      resolve();
    };
    const onChange = () => {
      if (isFinished(session)) done();
    };
    const timer = setTimeout(done, Math.max(0, deadline - Date.now()));
    session.waiters.add(onChange);
  });

  const respond = (session, startedAt, maxOutputTokens) => {
    const raw = session.buffer.drain();
    const { text, originalTokenCount } = truncateOutput(raw, Number(maxOutputTokens) > 0 ? Number(maxOutputTokens) : DEFAULT_MAX_OUTPUT_TOKENS);
    session.lastUsedAt = Date.now();
    const finished = isFinished(session);
    if (finished) sessions.delete(session.id);
    const response = {
      chunkId: generateChunkId(),
      wallTimeMs: Date.now() - startedAt,
      exitCode: finished ? session.exitCode : null,
      sessionId: finished ? null : session.id,
      originalTokenCount,
      output: text,
    };
    return { ...response, text: formatExecResponse(response) };
  };

  async function execStart(payload) {
    const command = asString(payload.cmd ?? payload.command);
    if (!command.trim()) throw new Error('A command is required.');
    if (command.length > 200_000) throw new Error('The command is too long.');
    const cwd = requireAbsolute(payload.workdir ?? payload.cwd, 'working directory');
    const stats = await fs.stat(cwd).catch(() => null);
    if (!stats?.isDirectory()) throw new Error(`The working directory does not exist: ${cwd}`);
    prune();
    const shell = resolveShell(payload.shell);
    const { args, verbatim } = shellArgs(shell, command, payload.login !== false);
    const startedAt = Date.now();
    const child = spawn(shell.path, args, {
      cwd,
      env: { ...process.env, ...EXEC_ENV },
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const session = {
      id: nextSessionId++,
      owner: asString(payload.owner),
      command,
      cwd,
      child,
      buffer: new OutputBuffer(),
      exited: false,
      drained: false,
      closed: false,
      exitCode: null,
      startedAt,
      lastUsedAt: startedAt,
      waiters: new Set(),
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => session.buffer.push(chunk));
    child.stderr.on('data', (chunk) => session.buffer.push(chunk));
    child.stdin.on('error', () => undefined);
    const wake = () => [...session.waiters].forEach((waiter) => waiter());
    child.once('error', (error) => {
      session.buffer.push(`${error.message}\n`);
      session.exited = true;
      session.closed = true;
      session.exitCode = -1;
      wake();
    });
    child.once('exit', (code, signal) => {
      session.exited = true;
      session.exitCode = code ?? (signal ? 1 : 0);
      setTimeout(() => {
        session.drained = true;
        wake();
      }, TRAILING_OUTPUT_GRACE_MS);
    });
    child.once('close', () => {
      session.exited = true;
      session.closed = true;
      wake();
    });
    sessions.set(session.id, session);
    await settle(session, startedAt + clampExecYield(payload.yieldTimeMs ?? payload.yield_time_ms));
    return respond(session, startedAt, payload.maxOutputTokens ?? payload.max_output_tokens);
  }

  async function execWrite(payload) {
    const id = Number(payload.sessionId ?? payload.session_id);
    const session = sessions.get(id);
    if (!session) throw new Error(`Unknown session id ${payload.sessionId ?? payload.session_id}: it has finished or was never started.`);
    const chars = asString(payload.chars);
    const startedAt = Date.now();
    if (chars === INTERRUPT) {
      killTree(session.child);
    } else if (chars && !session.exited) {
      session.child.stdin.write(chars);
    }
    await settle(session, startedAt + clampStdinYield(payload.yieldTimeMs ?? payload.yield_time_ms, chars));
    return respond(session, startedAt, payload.maxOutputTokens ?? payload.max_output_tokens);
  }

  function execKill(payload) {
    const owner = asString(payload.owner);
    const id = payload.sessionId === undefined ? null : Number(payload.sessionId);
    let killed = 0;
    for (const session of [...sessions.values()]) {
      if (id !== null ? session.id !== id : !owner || session.owner !== owner) continue;
      if (!session.exited) killTree(session.child);
      sessions.delete(session.id);
      killed += 1;
    }
    return { killed };
  }

  const execList = () => ({
    sessions: [...sessions.values()].map((session) => ({
      sessionId: session.id,
      owner: session.owner,
      command: session.command,
      cwd: session.cwd,
      running: !session.exited,
      startedAt: session.startedAt,
    })),
  });

  async function stat(payload) {
    const target = requireAbsolute(payload.path);
    const stats = await fs.stat(target).catch(() => null);
    if (!stats) return { path: target, exists: false };
    return { path: target, exists: true, isFile: stats.isFile(), isDirectory: stats.isDirectory(), size: stats.size, modifiedAt: stats.mtimeMs };
  }

  async function readOne(target) {
    const stats = await fs.stat(target).catch(() => null);
    if (!stats) return { path: target, exists: false };
    if (stats.isDirectory()) return { path: target, exists: true, isDirectory: true, size: 0 };
    if (stats.size > MAX_TEXT_READ_BYTES) return { path: target, exists: true, size: stats.size, binary: false, tooLarge: true };
    const buffer = await fs.readFile(target);
    if (looksBinary(buffer)) return { path: target, exists: true, size: stats.size, binary: true };
    return { path: target, exists: true, size: stats.size, binary: false, text: buffer.toString('utf8') };
  }

  async function read(payload) {
    if (Array.isArray(payload.paths)) {
      const files = await Promise.all(payload.paths.map((entry) => readOne(requireAbsolute(entry))));
      return { files };
    }
    return readOne(requireAbsolute(payload.path));
  }

  async function write(payload) {
    const target = requireAbsolute(payload.path);
    if (typeof payload.text !== 'string') throw new Error('Text to write is required.');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, payload.text, 'utf8');
    return { path: target, size: Buffer.byteLength(payload.text, 'utf8') };
  }

  async function remove(payload) {
    const target = requireAbsolute(payload.path);
    const stats = await fs.stat(target).catch(() => null);
    if (!stats) return { path: target, removed: false };
    if (stats.isDirectory()) throw new Error(`${target} is a folder; only files are deleted this way.`);
    await fs.unlink(target);
    return { path: target, removed: true };
  }

  async function list(payload) {
    const root = requireAbsolute(payload.path);
    const depth = Math.min(Math.max(Number(payload.depth) || 1, 1), 6);
    const entries = [];
    let truncated = false;
    const walk = async (directory, level) => {
      let children;
      try {
        children = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      children.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const child of children) {
        if (entries.length >= MAX_LIST_ENTRIES) {
          truncated = true;
          return;
        }
        const full = path.join(directory, child.name);
        const relative = path.relative(root, full).split(path.sep).join('/');
        if (child.isDirectory()) {
          const skipped = HEAVY_DIRECTORIES.has(child.name);
          entries.push({ path: relative, type: 'dir', ...(skipped && level < depth ? { skipped: true } : {}) });
          if (!skipped && level < depth) await walk(full, level + 1);
        } else {
          const stats = await fs.stat(full).catch(() => null);
          entries.push({ path: relative, type: 'file', size: stats?.size ?? 0 });
        }
      }
    };
    const stats = await fs.stat(root).catch(() => null);
    if (!stats) throw new Error(`No such folder: ${root}`);
    if (!stats.isDirectory()) throw new Error(`${root} is a file, not a folder.`);
    await walk(root, 1);
    return { path: root, entries, truncated };
  }

  async function search(payload) {
    const root = requireAbsolute(payload.path);
    const query = asString(payload.query);
    if (!query) throw new Error('A search query is required.');
    let test;
    if (payload.regex === true) {
      const expression = new RegExp(query, 'i');
      test = (line) => expression.test(line);
    } else {
      const needle = query.toLowerCase();
      test = (line) => line.toLowerCase().includes(needle);
    }
    const matches = [];
    let truncated = false;
    const visit = async (file) => {
      if (matches.length >= MAX_SEARCH_MATCHES) {
        truncated = true;
        return;
      }
      const relative = path.relative(root, file).split(path.sep).join('/') || path.basename(file);
      if (test(path.basename(file))) matches.push({ path: relative, line: 0, text: '' });
      const stats = await fs.stat(file).catch(() => null);
      if (!stats || stats.size > MAX_SEARCH_FILE_BYTES) return;
      const buffer = await fs.readFile(file).catch(() => null);
      if (!buffer || looksBinary(buffer)) return;
      const lines = buffer.toString('utf8').split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!test(lines[index])) continue;
        if (matches.length >= MAX_SEARCH_MATCHES) {
          truncated = true;
          return;
        }
        const text = lines[index].trim();
        matches.push({ path: relative, line: index + 1, text: text.length > 240 ? `${text.slice(0, 240)}…` : text });
      }
    };
    const walk = async (directory) => {
      let children;
      try {
        children = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const child of children) {
        if (matches.length >= MAX_SEARCH_MATCHES) {
          truncated = true;
          return;
        }
        const full = path.join(directory, child.name);
        if (child.isDirectory()) {
          if (!HEAVY_DIRECTORIES.has(child.name)) await walk(full);
        } else if (child.isFile()) {
          await visit(full);
        }
      }
    };
    const stats = await fs.stat(root).catch(() => null);
    if (!stats) throw new Error(`No such folder: ${root}`);
    if (stats.isDirectory()) await walk(root);
    else await visit(root);
    return { path: root, query, matches, truncated };
  }

  async function image(payload) {
    const target = requireAbsolute(payload.path);
    const mimeType = IMAGE_TYPES[path.extname(target).toLowerCase()];
    if (!mimeType) throw new Error(`${target} is not an image Spark can view (png, jpg, gif, webp, bmp).`);
    const stats = await fs.stat(target).catch(() => null);
    if (!stats?.isFile()) throw new Error(`No such image: ${target}`);
    if (stats.size > MAX_IMAGE_BYTES) throw new Error(`${target} is too large to view.`);
    const buffer = await fs.readFile(target);
    return { path: target, mimeType, size: stats.size, base64: buffer.toString('base64') };
  }

  function environment() {
    const shell = userShell();
    return {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      home: os.homedir(),
      tmp: os.tmpdir(),
      user: os.userInfo().username,
      hostname: os.hostname(),
      shell: { name: shell.name, path: shell.path },
      pathSeparator: path.sep,
    };
  }

  const handlers = {
    'spark.env': environment,
    'spark.exec.start': execStart,
    'spark.exec.write': execWrite,
    'spark.exec.kill': execKill,
    'spark.exec.list': execList,
    'spark.fs.stat': stat,
    'spark.fs.read': read,
    'spark.fs.write': write,
    'spark.fs.delete': remove,
    'spark.fs.list': list,
    'spark.fs.search': search,
    'spark.fs.image': image,
  };

  return {
    requests: Object.keys(handlers),
    handles: (type) => Object.prototype.hasOwnProperty.call(handlers, type),
    handle: (type, payload = {}) => handlers[type](payload),
    dispose() {
      for (const session of sessions.values()) if (!session.exited) killTree(session.child);
      sessions.clear();
    },
  };
}
