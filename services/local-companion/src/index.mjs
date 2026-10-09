import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { chromium } from 'playwright-core';
import { createComputers } from './computers/manager.mjs';
import { createDiscord } from './discord.mjs';
import { createScreen } from './screen.mjs';
import { createOAuth } from './oauth.mjs';
import { createMcpPrograms } from './mcp-programs.mjs';
import { createSparkRuntime } from './spark-runtime.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.WILLOW_COMPANION_PORT || 43117);
const MAX_OUTPUT_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const configuredToken = process.env.WILLOW_COMPANION_TOKEN || readArg('--token') || '';
const sessions = new Map();
// Bots' own computers come with the desktop app, which says where they live.
const computers = process.env.WILLOW_COMPUTERS_DIR
  ? createComputers({
    dir: process.env.WILLOW_COMPUTERS_DIR,
    broadcast: (name, payload) => broadcast(name, payload),
    send: (session, name, payload) => event(session.socket, name, payload),
    log: (...parts) => console.log('[Willow companion]', ...parts),
  })
  : null;
// Spark's native runtime: real commands and files, unconfined, so only behind a pairing token (the desktop app's).
const sparkRuntime = configuredToken ? createSparkRuntime() : null;
// Bots the user made Discord bots of their own: Discord's API and gateway, which a page cannot reach or keep.
const discord = createDiscord({ log: (...parts) => console.log('[Willow companion]', ...parts) });
// The user's own screen, for a bot they let use it — each system its own way (services/local-companion/src/screen.mjs):
// Windows shares the one desktop (never past the app's own windows, its parent process), macOS works apps in the
// background, Linux a desktop of the bot's own. Only behind the pairing token.
const screen = configuredToken
  ? createScreen({
    log: (...parts) => console.log('[Willow companion]', ...parts),
    protectPids: [process.ppid],
    onEvent: (payload) => broadcast(`screen.${payload.event}`, payload),
  })
  : null;
// Signing in to MCP servers from the desktop app: the sign-in page in the user's browser, the answer caught on this
// computer's loopback (services/local-companion/src/oauth.mjs). Only behind the pairing token.
const oauth = configuredToken ? createOAuth({ broadcast: (name, payload) => broadcast(name, payload) }) : null;
// MCP servers that are programs on this computer, started as the user typed them, for the window that asks
// (services/local-companion/src/mcp-programs.mjs). Only behind the pairing token.
const mcpPrograms = configuredToken
  ? createMcpPrograms({ send: (session, name, payload) => event(session.socket, name, payload), log: (...parts) => console.log('[Willow companion]', ...parts) })
  : null;

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function json(value) {
  return JSON.stringify(value);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  const configuredOrigins = String(process.env.WILLOW_COMPANION_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return configuredOrigins.includes(origin);
}

function isAuthorised(request) {
  const origin = String(request.headers.origin || '');
  if (!isAllowedOrigin(origin)) return false;
  if (!configuredToken) return true;
  const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);
  return requestUrl.searchParams.get('token') === configuredToken;
}

function send(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(json(message));
}

function result(socket, requestId, value) {
  send(socket, { id: requestId, type: 'result', ok: true, result: value });
}

function failure(socket, requestId, error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  send(socket, { id: requestId, type: 'result', ok: false, error: message });
}

function event(socket, name, payload) {
  send(socket, { type: 'event', event: name, payload });
}

function validUrl(value) {
  const input = String(value || '').trim();
  if (!input || input === 'about:blank') return 'about:blank';
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
  const parsed = new URL(candidate);
  if (!['http:', 'https:', 'about:'].includes(parsed.protocol)) {
    throw new Error('Only http, https, and about URLs are supported.');
  }
  return parsed.href;
}

function chromeExecutable() {
  if (process.env.WILLOW_CHROME_PATH) return process.env.WILLOW_CHROME_PATH;
  if (process.platform !== 'win32') return undefined;
  const candidates = [
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function pageForSession(session, pageId) {
  if (!pageId) return session.activePage;
  const page = session.pagesById.get(String(pageId));
  if (!page) throw new Error('The requested browser tab no longer exists.');
  return page;
}

async function tabSnapshot(session, page, index) {
  let title = '';
  try {
    title = await page.title({ timeout: 1_000 });
  } catch {
    title = '';
  }
  return {
    id: session.pageIds.get(page) || `tab-${index + 1}`,
    title: title || (() => {
      try { return new URL(page.url()).hostname; } catch { return 'New tab'; }
    })(),
    url: page.url() || 'about:blank',
    active: page === session.activePage,
    index,
  };
}

async function listTabs(session) {
  const pages = session.context?.pages() || [];
  return Promise.all(pages.map((page, index) => tabSnapshot(session, page, index)));
}

async function captureFrame(session, page = session.activePage) {
  if (!page) throw new Error('The browser has no active tab.');
  const image = await page.screenshot({ type: 'png' });
  const viewport = page.viewportSize() || { width: 1280, height: 720 };
  return {
    sessionId: session.id,
    tabId: session.pageIds.get(page),
    dataUrl: `data:image/png;base64,${image.toString('base64')}`,
    width: viewport.width,
    height: viewport.height,
    url: page.url() || 'about:blank',
  };
}

async function publishTabs(session) {
  const tabs = await listTabs(session);
  event(session.socket, 'browser.tabs', {
    sessionId: session.id,
    tabs,
    activeTabId: session.pageIds.get(session.activePage),
  });
  return tabs;
}

async function publishFrame(session) {
  if (!session.activePage || session.socket.readyState !== WebSocket.OPEN) return;
  try {
    event(session.socket, 'browser.frame', await captureFrame(session));
  } catch (error) {
    event(session.socket, 'browser.error', { sessionId: session.id, message: error.message });
  }
}

function attachPage(session, page) {
  if (session.pageIds.has(page)) return session.pageIds.get(page);
  const pageId = id('tab');
  session.pageIds.set(page, pageId);
  session.pagesById.set(pageId, page);
  page.on('framenavigated', () => {
    if (page === session.activePage) void publishFrame(session);
    void publishTabs(session);
  });
  page.on('load', () => {
    if (page === session.activePage) void publishFrame(session);
    void publishTabs(session);
  });
  page.on('close', () => {
    session.pageIds.delete(page);
    session.pagesById.delete(pageId);
    if (page === session.activePage) session.activePage = session.context?.pages()?.[0];
    void publishTabs(session);
    void publishFrame(session);
  });
  return pageId;
}

async function launchBrowser(session, url = 'about:blank') {
  if (session.browser) await closeBrowser(session);
  const executablePath = chromeExecutable();
  const launchOptions = {
    headless: true,
    args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  };
  if (executablePath) launchOptions.executablePath = executablePath;
  else launchOptions.channel = 'chrome';
  session.browser = await chromium.launch(launchOptions);
  session.context = await session.browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  });
  session.pageIds.clear();
  session.pagesById.clear();
  const page = await session.context.newPage();
  session.activePage = page;
  attachPage(session, page);
  const target = validUrl(url);
  if (target !== 'about:blank') {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  }
  session.frameTimer = setInterval(() => {
    void publishFrame(session);
  }, 500);
  const tabs = await publishTabs(session);
  const frame = await captureFrame(session);
  return { sessionId: session.id, tabs, activeTabId: session.pageIds.get(page), frame };
}

async function closeBrowser(session) {
  if (session.frameTimer) clearInterval(session.frameTimer);
  session.frameTimer = null;
  try { await session.context?.close(); } catch { /* best effort */ }
  try { await session.browser?.close(); } catch { /* best effort */ }
  session.browser = null;
  session.context = null;
  session.activePage = null;
  session.pageIds.clear();
  session.pagesById.clear();
}

async function browserRequest(session, type, payload = {}) {
  if (type === 'browser.launch') return launchBrowser(session, payload.url);
  if (payload.sessionId && String(payload.sessionId) !== session.id) {
    throw new Error('The browser session is no longer active. Reopen the local browser.');
  }
  if (type === 'browser.close') {
    await closeBrowser(session);
    return {
      sessionId: session.id,
      tabs: [],
      activeTabId: undefined,
      frame: null,
      closed: true,
    };
  }
  if (!session.browser || !session.context) throw new Error('Launch the local browser first.');

  if (type === 'browser.tabs') return { sessionId: session.id, tabs: await listTabs(session), activeTabId: session.pageIds.get(session.activePage) };
  if (type === 'browser.screenshot') return captureFrame(session, pageForSession(session, payload.tabId));

  if (type === 'browser.newTab') {
    const page = await session.context.newPage();
    attachPage(session, page);
    session.activePage = page;
    if (payload.url) await page.goto(validUrl(payload.url), { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
    await publishTabs(session);
    return { tabs: await listTabs(session), activeTabId: session.pageIds.get(page), frame: await captureFrame(session) };
  }

  if (type === 'browser.activateTab') {
    const page = pageForSession(session, payload.tabId);
    session.activePage = page;
    await page.bringToFront();
    await publishTabs(session);
    return { tabs: await listTabs(session), activeTabId: session.pageIds.get(page), frame: await captureFrame(session) };
  }

  if (type === 'browser.closeTab') {
    const page = pageForSession(session, payload.tabId);
    await page.close();
    let next = session.context.pages()[0];
    if (!next) {
      next = await session.context.newPage();
      attachPage(session, next);
    }
    if (next) session.activePage = next;
    await publishTabs(session);
    return { tabs: await listTabs(session), activeTabId: session.pageIds.get(session.activePage), frame: session.activePage ? await captureFrame(session) : null };
  }

  const page = pageForSession(session, payload.tabId);
  if (type === 'browser.navigate') {
    await page.goto(validUrl(payload.url), { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  } else if (type === 'browser.back') {
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS }).catch(() => undefined);
  } else if (type === 'browser.forward') {
    await page.goForward({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS }).catch(() => undefined);
  } else if (type === 'browser.reload') {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  } else if (type === 'browser.click') {
    await page.mouse.click(Number(payload.x) || 0, Number(payload.y) || 0, { button: payload.button || 'left' });
  } else if (type === 'browser.type') {
    await page.keyboard.insertText(String(payload.text || ''));
  } else if (type === 'browser.key') {
    await page.keyboard.press(String(payload.key || 'Enter'));
  } else if (type === 'browser.scroll') {
    await page.mouse.wheel(Number(payload.deltaX) || 0, Number(payload.deltaY) || 0);
  } else {
    throw new Error(`Unknown browser operation: ${type}`);
  }
  await publishTabs(session);
  return { tabs: await listTabs(session), activeTabId: session.pageIds.get(session.activePage), frame: await captureFrame(session) };
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function authoriseWorkspace(session, payload) {
  const root = path.resolve(String(payload.root || ''));
  const stats = await fs.stat(root);
  if (!stats.isDirectory()) throw new Error('Workspace root must be a directory.');
  const workspaceId = id('workspace');
  session.workspaces.set(workspaceId, root);
  return { workspaceId, root };
}

/**
 * Runs `command` through the platform shell exactly as written. On Windows the
 * line goes to cmd.exe verbatim and wrapped in quotes, as Node's own `shell`
 * option does it; passing it as an ordinary argument escapes inner quotes with
 * backslashes, which cmd.exe does not understand.
 */
function spawnShell(command, options) {
  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`], { ...options, windowsHide: true, windowsVerbatimArguments: true });
  }
  return spawn('/bin/sh', ['-lc', command], options);
}

async function executeShell(session, payload) {
  const workspaceId = String(payload.workspaceId || '');
  const root = session.workspaces.get(workspaceId);
  if (!root) throw new Error('Authorise a workspace before running commands.');
  const cwd = path.resolve(root, String(payload.cwd || root));
  if (!isInside(root, cwd)) throw new Error('The command directory is outside the authorised workspace.');
  const command = String(payload.command || '').trim();
  if (!command) throw new Error('A command is required.');
  if (command.length > 20_000) throw new Error('The command is too long.');
  const timeoutMs = Math.min(Math.max(Number(payload.timeoutMs) || DEFAULT_TIMEOUT_MS, 250), MAX_TIMEOUT_MS);
  const child = spawnShell(command, { cwd, windowsHide: true, env: { ...process.env, WILLOW_COMPANION: '1' } });
  let stdout = '';
  let stderr = '';
  const append = (target, chunk) => {
    const value = chunk.toString();
    return `${target}${value}`.slice(-MAX_OUTPUT_BYTES);
  };
  child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, signal: 'TIMEOUT' });
    }, timeoutMs);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  return { ...exit, stdout, stderr, cwd };
}

/*
 * Background jobs: commands that outlive the request that started them. A job
 * belongs to the companion, not to a socket, so a client that reconnects — or
 * another tab — can still read and stop it. Confined like `shell.exec`; bounded
 * by how many run at once and how much output is kept, not by time.
 */
const MAX_JOB_OUTPUT_CHARS = 1_000_000;
const MAX_RUNNING_JOBS = 8;
const MAX_KEPT_JOBS = 50;
const jobs = new Map();

function broadcast(name, payload) {
  for (const session of sessions.values()) event(session.socket, name, payload);
}

function confinedCwd(session, payload) {
  const root = session.workspaces.get(String(payload.workspaceId || ''));
  if (!root) throw new Error('Authorise a workspace before running commands.');
  const cwd = path.resolve(root, String(payload.cwd || root));
  if (!isInside(root, cwd)) throw new Error('The command directory is outside the authorised workspace.');
  return { root, cwd };
}

function jobSummary(job) {
  return {
    jobId: job.id,
    command: job.command,
    cwd: job.cwd,
    root: job.root,
    pid: job.pid ?? null,
    running: job.running,
    code: job.code,
    signal: job.signal,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    outputChars: job.dropped + job.output.length,
  };
}

function pruneJobs() {
  const finished = [...jobs.values()].filter((job) => !job.running).sort((a, b) => a.endedAt - b.endedAt);
  while (jobs.size > MAX_KEPT_JOBS && finished.length) jobs.delete(finished.shift().id);
}

function killJob(job) {
  if (!job.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(job.pid), '/T', '/F'], { windowsHide: true }).on('error', () => undefined);
    return;
  }
  try { process.kill(-job.pid, 'SIGTERM'); } catch { try { job.child?.kill('SIGTERM'); } catch { /* already gone */ } }
  setTimeout(() => {
    if (!job.running) return;
    try { process.kill(-job.pid, 'SIGKILL'); } catch { /* already gone */ }
  }, 3_000).unref();
}

/** Most one write to a job's input may hold. */
const MAX_JOB_INPUT = 64 * 1024;

/** Types into a running job: what the program reads next on its input. `close` ends the input after it. */
function writeJob(payload) {
  const job = jobs.get(String(payload.jobId || ''));
  if (!job) throw new Error('No such job: it finished long ago, or the companion has restarted since.');
  if (!job.running || !job.child.stdin || job.child.stdin.destroyed) throw new Error('That job is no longer reading its input.');
  const text = String(payload.text ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_JOB_INPUT) throw new Error('That is too much to type at once.');
  if (text) job.child.stdin.write(text);
  if (payload.close === true) job.child.stdin.end();
  return { written: Buffer.byteLength(text, 'utf8'), closed: payload.close === true };
}

function startJob(session, payload) {
  const { root, cwd } = confinedCwd(session, payload);
  const command = String(payload.command || '').trim();
  if (!command) throw new Error('A command is required.');
  if (command.length > 20_000) throw new Error('The command is too long.');
  if ([...jobs.values()].filter((job) => job.running).length >= MAX_RUNNING_JOBS) {
    throw new Error(`At most ${MAX_RUNNING_JOBS} background jobs can run at once. Stop one first.`);
  }
  // Its own process group off Windows, so stopping the job stops everything it started.
  const child = spawnShell(command, { cwd, windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, WILLOW_COMPANION: '1' } });
  const job = { id: id('job'), command, cwd, root, pid: child.pid, child, startedAt: Date.now(), endedAt: null, running: true, code: null, signal: null, output: '', dropped: 0 };
  const append = (chunk) => {
    job.output += chunk.toString();
    const excess = job.output.length - MAX_JOB_OUTPUT_CHARS;
    if (excess > 0) {
      job.output = job.output.slice(excess);
      job.dropped += excess;
    }
  };
  const finish = (code, signal) => {
    if (!job.running) return;
    job.running = false;
    job.code = code;
    job.signal = job.signal || signal || null;
    job.endedAt = Date.now();
    job.child = null;
    broadcast('job.exit', jobSummary(job));
    pruneJobs();
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.once('error', (error) => {
    append(`\n[The command could not start: ${error.message}]\n`);
    finish(null, 'ERROR');
  });
  child.once('exit', (code, signal) => finish(code, signal));
  jobs.set(job.id, job);
  return jobSummary(job);
}

function requireJob(payload) {
  const job = jobs.get(String(payload.jobId || ''));
  if (!job) throw new Error('No such job: it finished long ago, or the companion has restarted since.');
  return job;
}

/** Output from `since` (an offset into everything the job printed), or the tail when `since` is absent. */
function readJob(payload) {
  const job = requireJob(payload);
  const total = job.dropped + job.output.length;
  const maxChars = Math.min(Math.max(Number(payload.maxChars) || 16_000, 1), 200_000);
  const from = payload.since === undefined || payload.since === null ? Math.max(total - maxChars, 0) : Math.max(Number(payload.since) || 0, 0);
  const start = Math.max(from, job.dropped) - job.dropped;
  const text = job.output.slice(start, start + maxChars);
  return { ...jobSummary(job), text, from: job.dropped + start, next: job.dropped + start + text.length, truncated: from < job.dropped };
}

function stopJob(payload) {
  const job = requireJob(payload);
  if (job.running) {
    job.signal = 'STOPPED';
    killJob(job);
  }
  return jobSummary(job);
}

function listJobs() {
  return { jobs: [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).map(jobSummary) };
}

/*
 * Reading inside an authorised workspace. A path resolves through symlinks
 * before the confinement check, and walks never follow links, so nothing
 * outside the folder can be reached by way of one.
 */
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.hg', '.svn', '.next', '.nuxt', '.turbo', '.cache', 'dist', 'build', 'target', '__pycache__', '.venv', 'venv']);
const MAX_READ_BYTES = 256 * 1024;
/** A piece of a file read as bytes, for a copy to or from a bot's own computer. */
const MAX_RAW_READ_BYTES = 3 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 1_000_000;
const MAX_SEARCH_FILES = 5_000;

const toPosix = (value) => value.split(path.sep).join('/');

async function confinedPath(session, payload) {
  const root = session.workspaces.get(String(payload.workspaceId || ''));
  if (!root) throw new Error('Authorise a workspace before reading files.');
  const target = path.resolve(root, String(payload.path || '.'));
  if (!isInside(root, target)) throw new Error('That path is outside the authorised workspace.');
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
  if (!isInside(realRoot, realTarget)) throw new Error('That path leads outside the authorised workspace.');
  return { root, target, relative: toPosix(path.relative(root, target)) || '.' };
}

async function listWorkspace(session, payload) {
  const { root, target, relative } = await confinedPath(session, payload);
  if (!(await fs.stat(target)).isDirectory()) throw new Error('That path is a file, not a folder.');
  const depth = Math.min(Math.max(Number(payload.depth) || 1, 1), 4);
  const limit = Math.min(Math.max(Number(payload.limit) || 400, 1), 2_000);
  const entries = [];
  let truncated = false;
  const walk = async (directory, level) => {
    let children;
    try { children = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    children.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const child of children) {
      if (entries.length >= limit) {
        truncated = true;
        return;
      }
      const full = path.join(directory, child.name);
      const entryPath = toPosix(path.relative(root, full));
      if (child.isDirectory()) {
        const skipped = SKIPPED_DIRECTORIES.has(child.name);
        entries.push({ path: entryPath, type: 'dir', ...(skipped && level < depth ? { skipped: true } : {}) });
        if (level < depth && !skipped) await walk(full, level + 1);
      } else if (child.isFile()) {
        let size = 0;
        let modifiedAt = 0;
        try {
          const stats = await fs.stat(full);
          size = stats.size;
          modifiedAt = stats.mtimeMs;
        } catch { /* vanished mid-walk */ }
        entries.push({ path: entryPath, type: 'file', size, modifiedAt });
      }
    }
  };
  await walk(target, 1);
  return { root, path: relative, entries, truncated };
}

async function readWorkspaceFile(session, payload) {
  const { target, relative } = await confinedPath(session, payload);
  const stats = await fs.stat(target);
  if (!stats.isFile()) throw new Error('That path is not a file.');
  const offset = Math.max(Number(payload.offset) || 0, 0);
  // As bytes (`encoding: base64`), in larger pieces: a file copied as it is, to a bot's own computer.
  const raw = payload.encoding === 'base64';
  const most = raw ? MAX_RAW_READ_BYTES : MAX_READ_BYTES;
  const length = Math.min(Math.max(Number(payload.limit) || most, 1), most, Math.max(stats.size - offset, 0));
  const handle = await fs.open(target, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const bytes = buffer.subarray(0, bytesRead);
    const end = offset + bytesRead;
    const base = { path: relative, size: stats.size, modifiedAt: stats.mtimeMs, offset, next: end < stats.size ? end : null };
    if (raw) return { ...base, data: bytes.toString('base64') };
    if (bytes.includes(0)) return { ...base, binary: true, text: '' };
    return { ...base, binary: false, text: bytes.toString('utf8') };
  } finally {
    await handle.close();
  }
}

/** Most one write may hold: a source file, not a dataset. */
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
/** Most one piece of a copied file may hold. */
const MAX_RAW_WRITE_BYTES = 4 * 1024 * 1024;

/**
 * Writes one file inside the authorised workspace — the whole text, replacing what was there, folders made as
 * needed. Confined as reads are: the path is resolved and checked, and so is the real path of its nearest existing
 * folder, so neither `..` nor a linked folder can carry the write outside. An existing link at the path is refused
 * rather than written through. With `expectModifiedAt`, a file that changed since it was read is left alone.
 */
async function writeWorkspaceFile(session, payload) {
  const root = session.workspaces.get(String(payload.workspaceId || ''));
  if (!root) throw new Error('Authorise a workspace before writing files.');
  const target = path.resolve(root, String(payload.path || ''));
  if (target === path.resolve(root) || !isInside(root, target)) throw new Error('That path is outside the authorised workspace.');
  // Bytes (`encoding: base64`) come in pieces of a copied file, each but the first appended.
  const raw = payload.encoding === 'base64';
  const text = raw ? Buffer.from(String(payload.data ?? ''), 'base64') : String(payload.text ?? '');
  if ((raw ? text.length : Buffer.byteLength(text, 'utf8')) > (raw ? MAX_RAW_WRITE_BYTES : MAX_WRITE_BYTES)) throw new Error('That file is too large to write.');
  let folder = path.dirname(target);
  while (!(await fs.stat(folder).then(() => true, () => false))) folder = path.dirname(folder);
  const [realRoot, realFolder] = await Promise.all([fs.realpath(root), fs.realpath(folder)]);
  if (!isInside(realRoot, realFolder)) throw new Error('That path leads outside the authorised workspace.');
  const existing = await fs.lstat(target).catch(() => null);
  if (existing?.isSymbolicLink()) throw new Error('That path is a link, and Willow does not write through links.');
  if (existing && !existing.isFile()) throw new Error('That path is a folder, not a file.');
  if (existing && payload.expectModifiedAt !== undefined && Math.abs(existing.mtimeMs - Number(payload.expectModifiedAt)) > 2) {
    throw new Error('That file changed since it was read. Read it again before changing it.');
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (raw && payload.append === true) await fs.appendFile(target, text);
  else await fs.writeFile(target, text, raw ? undefined : 'utf8');
  const stats = await fs.stat(target);
  return { path: toPosix(path.relative(root, target)), size: stats.size, modifiedAt: stats.mtimeMs, created: !existing };
}

/**
 * An MCP server's HTTP, for the desktop app's window: a page reaches only servers that allow it by CORS, and most
 * MCP servers were written for desktop clients that never needed to. Public https addresses only — every address
 * the name resolves to is checked, so neither this computer nor its network can be reached through it — and the
 * answer comes back whole, an SSE stream included.
 */
const RELAY_MAX_BYTES = 8 * 1024 * 1024;
const RELAY_METHODS = new Set(['GET', 'POST', 'DELETE']);
const RELAY_DROPPED_HEADERS = /^(host|cookie|origin|referer|connection|content-length|transfer-encoding|keep-alive|upgrade|proxy-.*)$/i;
const RELAY_KEPT_HEADERS = ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'www-authenticate', 'retry-after'];

const isPrivateAddress = (address) => {
  const v4 = address.replace(/^::ffff:/i, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = address.toLowerCase();
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb');
};

async function relayHttp(payload) {
  let url;
  try {
    url = new URL(String(payload.url || ''));
  } catch {
    throw new Error('That is not a web address.');
  }
  if (url.protocol !== 'https:') throw new Error('Only https addresses can be relayed.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new Error('Addresses on this computer or its network cannot be relayed.');
  const { lookup } = (await import('node:dns')).promises;
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new Error(`${host} could not be found.`);
  if (addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error('Addresses on this computer or its network cannot be relayed.');
  const method = RELAY_METHODS.has(String(payload.method || 'GET').toUpperCase()) ? String(payload.method || 'GET').toUpperCase() : 'POST';
  const headers = {};
  for (const [name, value] of Object.entries(payload.headers || {})) {
    if (typeof value === 'string' && !RELAY_DROPPED_HEADERS.test(name)) headers[name] = value;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, { method, headers, body: method === 'GET' ? undefined : String(payload.body ?? ''), signal: controller.signal, redirect: 'error' });
    const chunks = [];
    let size = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > RELAY_MAX_BYTES) throw new Error('The answer was too large to relay.');
        chunks.push(Buffer.from(chunk));
      }
    }
    const kept = {};
    for (const name of RELAY_KEPT_HEADERS) {
      const value = response.headers.get(name);
      if (value) kept[name] = value;
    }
    return { status: response.status, statusText: response.statusText, headers: kept, body: Buffer.concat(chunks).toString('utf8') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Telegram's Bot API for a bot's Telegram chat. The API sends no CORS headers and refuses browsers, so the window
 * asks here. A relay for one host and four methods only: never a general proxy.
 */
const TELEGRAM_METHODS = new Set(['getMe', 'getUpdates', 'sendMessage', 'sendChatAction', 'setMessageReaction']);

async function relayTelegram(payload) {
  const token = String(payload.token || '');
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('That is not a Telegram bot token.');
  const method = String(payload.method || '');
  if (!TELEGRAM_METHODS.has(method)) throw new Error('That Telegram request is not allowed.');
  const params = payload.params && typeof payload.params === 'object' ? { ...payload.params } : {};
  if (method === 'getUpdates') params.timeout = Math.min(Math.max(Number(params.timeout) || 0, 0), 25);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ((params.timeout || 0) + 15) * 1_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchWorkspace(session, payload) {
  const { root, target, relative } = await confinedPath(session, payload);
  const query = String(payload.query || '').trim();
  if (!query) throw new Error('A search query is required.');
  const needle = query.toLowerCase();
  const limit = Math.min(Math.max(Number(payload.limit) || 100, 1), 500);
  const matches = [];
  let scanned = 0;
  let truncated = false;
  const full = () => matches.length >= limit || scanned >= MAX_SEARCH_FILES;
  const visit = async (file) => {
    const filePath = toPosix(path.relative(root, file));
    if (filePath.toLowerCase().includes(needle)) matches.push({ path: filePath, line: 0, text: '' });
    let stats;
    try { stats = await fs.stat(file); } catch { return; }
    if (stats.size > MAX_SEARCH_FILE_BYTES) return;
    scanned += 1;
    let content;
    try { content = await fs.readFile(file); } catch { return; }
    if (content.includes(0)) return;
    const lines = content.toString('utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
      if (lines[index].toLowerCase().includes(needle)) matches.push({ path: filePath, line: index + 1, text: lines[index].trim().slice(0, 240) });
    }
  };
  const walk = async (directory) => {
    let children;
    try { children = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const child of children) {
      if (full()) {
        truncated = true;
        return;
      }
      const childPath = path.join(directory, child.name);
      if (child.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(child.name)) await walk(childPath);
      } else if (child.isFile()) {
        await visit(childPath);
      }
    }
  };
  if ((await fs.stat(target)).isDirectory()) await walk(target);
  else await visit(target);
  return { root, path: relative, query, matches, truncated };
}

async function handle(socket, request) {
  const requestId = request?.id || id('request');
  const type = String(request?.type || '');
  const payload = request?.payload && typeof request.payload === 'object' ? request.payload : {};
  const session = sessions.get(socket);
  try {
    if (!session) throw new Error('Companion session is not ready.');
    if (type === 'tool.list') {
      return result(socket, requestId, {
        version: 1,
        tools: [
          'workspace.authorize', 'shell.exec', 'job.start', 'job.read', 'job.write', 'job.stop', 'job.list', 'fs.list', 'fs.read', 'fs.write', 'fs.search', 'relay.telegram', 'relay.http', 'browser.launch', 'browser.close', 'browser.tabs', 'browser.screenshot', 'browser.navigate', 'browser.newTab', 'browser.activateTab', 'browser.closeTab', 'browser.back', 'browser.forward', 'browser.reload', 'browser.click', 'browser.type', 'browser.key', 'browser.scroll',
          ...(computers ? ['machine.status', 'machine.create', 'machine.start', 'machine.stop', 'machine.reset', 'machine.remove', 'machine.call', 'machine.look', 'machine.cancel', 'machine.watch', 'machine.installWsl'] : []),
          ...(sparkRuntime ? sparkRuntime.requests : []),
          ...discord.requests,
          ...(screen ? screen.requests : []),
          ...(oauth ? oauth.requests : []),
          ...(mcpPrograms ? mcpPrograms.requests : []),
        ],
      });
    }
    if (discord.handles(type)) return result(socket, requestId, await discord.handle(type, payload));
    if (type.startsWith('screen.')) {
      if (!screen) throw new Error("Seeing and using the user's screen is part of Willow's desktop app.");
      return result(socket, requestId, await screen.handle(type, payload));
    }
    if (type.startsWith('oauth.')) {
      if (!oauth) throw new Error('Signing in to apps is part of the Willow desktop app.');
      return result(socket, requestId, await oauth.handle(type, payload));
    }
    if (type.startsWith('mcp.')) {
      if (!mcpPrograms) throw new Error('MCP servers that are programs on this computer run in the Willow desktop app.');
      return result(socket, requestId, await mcpPrograms.handle(session, type, payload));
    }
    if (type.startsWith('machine.')) {
      if (!computers) throw new Error("Bots' own computers are part of the Willow desktop app.");
      return result(socket, requestId, await computers.handle(session, type, payload));
    }
    if (type.startsWith('spark.')) {
      if (!sparkRuntime?.handles(type)) throw new Error(sparkRuntime ? `Unknown companion request: ${type}` : "Spark's native runtime is part of the Willow desktop app.");
      return result(socket, requestId, await sparkRuntime.handle(type, payload));
    }
    if (type === 'workspace.authorize') return result(socket, requestId, await authoriseWorkspace(session, payload));
    if (type === 'shell.exec') return result(socket, requestId, await executeShell(session, payload));
    if (type === 'job.start') return result(socket, requestId, startJob(session, payload));
    if (type === 'job.read') return result(socket, requestId, readJob(payload));
    if (type === 'job.write') return result(socket, requestId, writeJob(payload));
    if (type === 'job.stop') return result(socket, requestId, stopJob(payload));
    if (type === 'job.list') return result(socket, requestId, listJobs());
    if (type === 'fs.list') return result(socket, requestId, await listWorkspace(session, payload));
    if (type === 'fs.read') return result(socket, requestId, await readWorkspaceFile(session, payload));
    if (type === 'fs.write') return result(socket, requestId, await writeWorkspaceFile(session, payload));
    if (type === 'relay.telegram') return result(socket, requestId, await relayTelegram(payload));
    if (type === 'relay.http') return result(socket, requestId, await relayHttp(payload));
    if (type === 'fs.search') return result(socket, requestId, await searchWorkspace(session, payload));
    if (type.startsWith('browser.')) return result(socket, requestId, await browserRequest(session, type, payload));
    throw new Error(`Unknown companion request: ${type}`);
  } catch (error) {
    failure(socket, requestId, error);
  }
}

async function disposeSession(session) {
  computers?.release(session);
  mcpPrograms?.release(session);
  await closeBrowser(session);
  sessions.delete(session.socket);
}

const httpServer = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(json({ ok: true, service: 'willow-local-companion', version: 1 }));
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Willow local companion');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (socket, request) => {
  if (!isAuthorised(request)) {
    socket.close(1008, 'Origin or pairing token rejected');
    return;
  }
  const session = {
    id: id('session'),
    socket,
    browser: null,
    context: null,
    activePage: null,
    pageIds: new Map(),
    pagesById: new Map(),
    workspaces: new Map(),
    frameTimer: null,
  };
  sessions.set(socket, session);
  send(socket, { type: 'ready', version: 1, sessionId: session.id, capabilities: ['shell', 'jobs', 'files', 'browser', ...(computers ? ['computers'] : []), ...(sparkRuntime ? ['spark-native'] : []), ...(screen ? ['screen', `screen:${screen.platform}`] : []), ...(oauth ? ['oauth'] : []), ...(mcpPrograms ? ['mcp-programs'] : [])] });
  socket.on('message', (raw) => {
    try { void handle(socket, JSON.parse(raw.toString())); }
    catch (error) { failure(socket, null, error); }
  });
  socket.on('close', () => { void disposeSession(session); });
  socket.on('error', () => { void disposeSession(session); });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[Willow companion] listening on ws://${HOST}:${PORT}/ws`);
  if (configuredToken) console.log('[Willow companion] pairing token authentication is enabled');
  else console.log('[Willow companion] development pairing mode: localhost origins are accepted');
  console.log(`[Willow companion] default workspace hint: ${process.cwd() || os.homedir()}`);
});

async function shutdown() {
  for (const job of jobs.values()) if (job.running) killJob(job);
  await computers?.shutdown();
  sparkRuntime?.dispose();
  discord.dispose();
  screen?.dispose();
  oauth?.dispose();
  mcpPrograms?.dispose();
  await Promise.all([...sessions.values()].map(disposeSession));
  await new Promise((resolve) => httpServer.close(resolve));
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
