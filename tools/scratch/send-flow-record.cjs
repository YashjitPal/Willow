/*
 * Sends one prompt in the debug Chrome's Gemini or Willow tab and records what happens:
 * a CDP screencast (JPEG frames), a DOM mutation log, and a per-frame sample of the
 * composer, greeting, user bubble, response, thinking row, actions row and scroller.
 *
 *   node tools/scratch/send-flow-record.cjs gemini|willow "<prompt>" [seconds] [label]
 *
 * Output: %TEMP%\willow-emulator\send-<app>-<label>\ — frames named by ms after the
 * send tap, plus timeline.json. A summary of first appearances prints to stdout.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

let SCALE = Number(process.env.EMULATION_SCALE || 0);
const APPS = {
  gemini: {
    url: 'https://gemini.google.com/',
    editor: 'rich-textarea .ql-editor[contenteditable="true"]',
    roles: {
      greeting: ['.top-section-container h1', '.greeting-container', 'h1'],
      userBubble: ['user-query .user-query-bubble-with-background', 'user-query'],
      response: ['model-response .markdown', 'model-response message-content', 'model-response'],
      turn: ['.conversation-container'],
      thinking: ['model-thoughts', '.thoughts-header', '.avatar_spinner_animation', 'bard-avatar', 'lottie-animation'],
      actions: ['message-actions', '.response-footer'],
      scroller: ['infinite-scroller', '#chat-history', '.chat-history'],
    },
  },
  willow: {
    url: 'http://localhost:3000/',
    editor: 'textarea[placeholder^="Ask"]',
    roles: {
      greeting: ['[data-rec="greeting"]'],
      userBubble: ['[class*="rounded-[40px]"][class*="whitespace-pre-wrap"]'],
      response: ['.smd-root'],
      turn: ['.gemini-chat-scrollbar.flex-1 > div > div'],
      thinking: ['.gemini-thinking-visualizer'],
      actions: ['[aria-label="Response actions"]'],
      scroller: ['.gemini-chat-scrollbar.flex-1'],
    },
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function install(roles, editorSelector) {
  const round = (n) => Math.round(n * 10) / 10;
  window.__recSendT = undefined;
  window.__recSendWall = undefined;
  const editor = document.querySelector(editorSelector);
  let shell = editor;
  for (let el = editor; el && el !== document.body; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(cs.borderTopLeftRadius) >= 20) { shell = el; break; }
  }
  shell.setAttribute('data-rec', 'composer');
  const greeting = [...document.querySelectorAll('h1, h2, div, span')].find((el) => {
    if (el.childElementCount > 1 || el.closest('[data-rec="composer"]')) return false;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    const r = el.getBoundingClientRect();
    return fs >= 24 && r.width > 0 && r.height > 0 && /\S/.test(el.textContent || '');
  });
  if (greeting) greeting.setAttribute('data-rec', 'greeting');

  const resolve = (list) => {
    for (const selector of list) {
      const all = document.querySelectorAll(selector);
      if (all.length) return all[all.length - 1];
    }
    return null;
  };
  const named = { composer: ['[data-rec="composer"]'], ...roles };
  const t0 = performance.now();
  const log = [];
  const samples = [];
  const describe = (el) => {
    const cls = String(el.className?.baseVal ?? el.className ?? '').trim().replace(/\s+/g, '.').slice(0, 70);
    const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), cls, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40), rect: [r.x, r.y, r.width, r.height].map(round) };
  };
  const observer = new MutationObserver((records) => {
    const t = round(performance.now() - t0);
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1 || log.length > 4000) continue;
        const d = describe(node);
        if (d.rect[2] * d.rect[3] < 64 && !node.childElementCount) continue;
        log.push({ t, op: '+', ...d });
      }
      for (const node of record.removedNodes) {
        if (node.nodeType !== 1 || log.length > 4000) continue;
        log.push({ t, op: '-', tag: node.tagName.toLowerCase(), cls: String(node.className?.baseVal ?? node.className ?? '').trim().replace(/\s+/g, '.').slice(0, 70) });
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const tick = () => {
    const t = round(performance.now() - t0);
    const frame = { t, items: {} };
    for (const [name, list] of Object.entries(named)) {
      const el = resolve(list);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const item = { rect: [r.x, r.y, r.width, r.height].map(round), opacity: +(+cs.opacity).toFixed(3) };
      if (cs.transform !== 'none') item.transform = cs.transform;
      if (name === 'response' || name === 'userBubble') item.chars = (el.textContent || '').length;
      if (name === 'scroller') { item.scrollTop = round(el.scrollTop); item.scrollHeight = el.scrollHeight; }
      frame.items[name] = item;
    }
    samples.push(frame);
    window.__recRaf = requestAnimationFrame(tick);
  };
  window.__recRaf = requestAnimationFrame(tick);
  window.__recDrain = () => {
    cancelAnimationFrame(window.__recRaf);
    observer.disconnect();
    document.querySelectorAll('[data-rec]').forEach((el) => el.removeAttribute('data-rec'));
    return { log, samples, sendT: window.__recSendT ?? null };
  };
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('button[aria-label="Send message"]') && window.__recSendT === undefined) {
      window.__recSendT = round(performance.now() - t0);
      window.__recSendWall = Date.now();
    }
  }, true);
  return { editor: !!editor, shell: describe(shell), greeting: greeting ? describe(greeting) : null };
}

(async () => {
  const [name, prompt, secondsArg, labelArg] = process.argv.slice(2);
  const app = APPS[name];
  if (!app || !prompt) throw new Error('usage: send-flow-record.cjs gemini|willow "<prompt>" [seconds] [label]');
  const seconds = Number(secondsArg || 20);
  const label = labelArg || 'run';
  const outDir = path.join(os.tmpdir(), 'willow-emulator', `send-${name}-${label}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  if (!SCALE) SCALE = (await fetch('http://127.0.0.1:9339/status').then((r) => r.json()).catch(() => ({ scale: 1 }))).scale || 1;
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(app.url));
  const cdp = await page.createCDPSession();
  await page.bringToFront();
  await page.waitForSelector(app.editor, { visible: true, timeout: 20000 });
  await sleep(600);

  const setup = await page.evaluate(install, app.roles, app.editor);
  console.log('setup:', JSON.stringify(setup), `tap scale ${SCALE}`);
  await page.evaluate((s) => document.querySelector(s).focus(), app.editor);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await sleep(200);
  await cdp.send('Input.insertText', { text: prompt });
  await sleep(700);

  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ wall: metadata.timestamp * 1000, data });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  await sleep(400);

  const send = await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Send message"]');
    if (!button) return null;
    const r = button.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!send) throw new Error('no Send message button — did the prompt land in the editor?');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: send.x * SCALE, y: send.y * SCALE }] });
  await sleep(80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(seconds * 1000);

  await cdp.send('Page.stopScreencast');
  const sendWall = await page.evaluate(() => window.__recSendWall ?? null);
  const { log, samples, sendT } = await page.evaluate(() => window.__recDrain());
  await cdp.detach();
  await browser.disconnect();

  const base = sendWall ?? (frames[0]?.wall || 0);
  for (const frame of frames) {
    const ms = Math.round(frame.wall - base);
    fs.writeFileSync(path.join(outDir, `${String(ms + 100000).padStart(6, '0')}_${ms}ms.jpg`), Buffer.from(frame.data, 'base64'));
  }
  const rel = (t) => (sendT == null ? t : Math.round((t - sendT) * 10) / 10);
  const relLog = log.map((entry) => ({ ...entry, t: rel(entry.t) }));
  const relSamples = samples.map((s) => ({ ...s, t: rel(s.t) }));
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ app: name, prompt, sendT, setup, log: relLog, samples: relSamples }, null, 1));

  const firstSeen = {};
  const lastSeen = {};
  for (const s of relSamples) {
    for (const key of Object.keys(s.items)) {
      if (!(key in firstSeen)) firstSeen[key] = s.t;
      lastSeen[key] = s.t;
    }
  }
  const intervals = relSamples.slice(1).map((s, i) => s.t - relSamples[i].t);
  console.log(`send click at t=${sendT}ms (page clock); ${frames.length} screencast frames; ${relSamples.length} samples, avg ${(intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length)).toFixed(1)}ms/frame`);
  console.log('first/last seen (ms after send):', JSON.stringify(Object.fromEntries(Object.keys(firstSeen).map((k) => [k, [firstSeen[k], lastSeen[k]]]))));
  console.log(`output: ${outDir}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
