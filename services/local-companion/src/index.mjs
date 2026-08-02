import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { chromium } from 'playwright-core';

const HOST = '127.0.0.1';
const PORT = Number(process.env.WILLOW_COMPANION_PORT || 43117);
const MAX_OUTPUT_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const configuredToken = process.env.WILLOW_COMPANION_TOKEN || readArg('--token') || '';
const sessions = new Map();

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
  const windows = process.platform === 'win32';
  const child = spawn(
    windows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh',
    windows ? ['/d', '/s', '/c', command] : ['-lc', command],
    { cwd, windowsHide: true, env: { ...process.env, WILLOW_COMPANION: '1' } },
  );
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
        tools: ['workspace.authorize', 'shell.exec', 'browser.launch', 'browser.close', 'browser.tabs', 'browser.screenshot', 'browser.navigate', 'browser.newTab', 'browser.activateTab', 'browser.closeTab', 'browser.back', 'browser.forward', 'browser.reload', 'browser.click', 'browser.type', 'browser.key', 'browser.scroll'],
      });
    }
    if (type === 'workspace.authorize') return result(socket, requestId, await authoriseWorkspace(session, payload));
    if (type === 'shell.exec') return result(socket, requestId, await executeShell(session, payload));
    if (type.startsWith('browser.')) return result(socket, requestId, await browserRequest(session, type, payload));
    throw new Error(`Unknown companion request: ${type}`);
  } catch (error) {
    failure(socket, requestId, error);
  }
}

async function disposeSession(session) {
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
  send(socket, { type: 'ready', version: 1, sessionId: session.id, capabilities: ['shell', 'browser'] });
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
  await Promise.all([...sessions.values()].map(disposeSession));
  await new Promise((resolve) => httpServer.close(resolve));
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
