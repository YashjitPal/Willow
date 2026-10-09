/**
 * Starts work in one Willow tab, closes that tab mid-run, and watches every other open
 * Willow tab carry it on (the cross-tab job layer, `@willow/core/background-jobs`).
 *
 *   node tools/scratch/bg-takeover.cjs chat ["<prompt>"]
 *
 * Opens two fresh tabs, sends the prompt from the first, waits for the reply to stream
 * and checkpoint, closes the first tab, then reports each remaining Willow tab's chat
 * turns and the job records once a second until the reply settles. Leaves the second
 * tab open on the chat.
 */
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000/';
const COMPOSER = 'textarea.willow-dictation-textarea';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mode = process.argv[2] || 'chat';
const prompt = process.argv[3]
  || 'Takeover test: write a 450-word short story about a lighthouse keeper who befriends a storm. Plain paragraphs, no headings.';

const chatState = (page) => page.evaluate(() => {
  const turns = globalThis[Symbol.for('willow.chatTurns')];
  return {
    turns: turns ? [...turns.values()].map((record) => ({
      turn: record.turnId.slice(0, 8),
      chat: record.chatId,
      status: record.status,
      chars: record.content.length,
      thinking: record.thinkingText.length,
      final: record.finalContent.length,
      stopped: record.wasStopped,
      watched: Boolean(record.listener),
    })) : [],
    jobs: Object.keys(localStorage).filter((key) => key.startsWith('willow:job:')).map((key) => {
      const job = JSON.parse(localStorage.getItem(key));
      return { id: job.id.slice(0, 24), owner: job.owner.slice(0, 6), takeovers: job.takeovers, chat: job.payload.chatId };
    }),
    instance: document.visibilityState,
  };
});

const willowPages = async (browser) => (await browser.pages())
  .filter((page) => page.url().startsWith(BASE.slice(0, -1)));

/** Spark's tasks as this tab's own store holds them, plus the job records. */
const sparkState = (page, taskId) => page.evaluate(async (id) => {
  const url = performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes('/spark-store.ts'));
  const store = url ? await import(url) : null;
  const tasks = store ? store.sparkState.get().tasks : [];
  const task = id ? tasks.find((candidate) => candidate.id === id) : null;
  return {
    task: task && { id: task.id, status: task.status, progress: task.progressLabel, response: (task.response || '').length, title: task.title.slice(0, 40) },
    jobs: Object.keys(localStorage).filter((key) => key.startsWith('willow:job:spark')).map((key) => {
      const job = JSON.parse(localStorage.getItem(key));
      return { owner: job.owner.slice(0, 6), takeovers: job.takeovers, payload: job.payload };
    }),
    visibility: document.visibilityState,
  };
}, taskId).catch((error) => ({ error: error.message.slice(0, 80) }));

(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://127.0.0.1:9222', defaultViewport: null });
  if (mode !== 'chat' && mode !== 'spark') throw new Error(`unknown mode ${mode}`);

  const started = Date.now();
  const open = async (name) => {
    const page = await browser.newPage();
    page.on('console', (message) => {
      const text = message.text();
      if (/\[Auth\]|scope|takeover|background job/i.test(text)) console.log(`  [${name} console +${((Date.now() - started) / 1000).toFixed(1)}s] ${text.slice(0, 160)}`);
    });
    page.on('pageerror', (error) => console.log(`  [${name} error] ${error.message.slice(0, 200)}`));
    await page.bringToFront();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(COMPOSER, { visible: true, timeout: 90_000 });
    // Signed in, with keys loaded: the sidebar shows the account rather than "Sign In".
    await page.waitForFunction(() => {
      const footer = [...document.querySelectorAll('aside, nav, div')].find((el) => /^Sign In$/.test(el.textContent.trim()) && el.getBoundingClientRect().width > 0);
      return !footer && /Let's chat|Hello|Hi,/i.test(document.body.innerText);
    }, { timeout: 90_000 }).catch(() => console.log(`  ${name}: never showed a signed-in greeting`));
    await sleep(2500);
    return page;
  };
  const a = await open('A');
  const b = await open('B');

  if (mode === 'spark') {
    await a.bringToFront();
    await sleep(1000);
    const toggled = await a.evaluate(() => {
      const option = [...document.querySelectorAll('button, [role="tab"], [role="button"], a')]
        .find((el) => /^Spark\s*(beta)?$/i.test(el.textContent.trim()) && el.getBoundingClientRect().width > 0);
      option?.click();
      return Boolean(option);
    });
    console.log('switched tab A to Spark:', toggled);
    await sleep(3000);
    const focused = await a.evaluate(() => {
      const area = [...document.querySelectorAll('textarea')].find((candidate) => candidate.getBoundingClientRect().width > 0);
      area?.focus();
      return area?.placeholder ?? null;
    });
    console.log('spark composer:', focused);
    const taskIds = () => a.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes('/spark-store.ts'));
      return url ? (await import(url)).sparkState.get().tasks.map((task) => task.id) : [];
    });
    const before = new Set(await taskIds());
    const cdpA = await a.createCDPSession();
    await cdpA.send('Input.insertText', { text: prompt });
    await sleep(600);
    await a.keyboard.press('Enter');
    let taskId = null;
    for (let second = 1; second <= 60; second += 1) {
      await sleep(1000);
      taskId = taskId ?? (await taskIds()).find((id) => !before.has(id)) ?? null;
      const state = await sparkState(a, taskId);
      console.log(`tab A +${second}s`, JSON.stringify(state));
      if (state.task?.status === 'running' && state.jobs.length && second >= 8) break;
      if (state.task && state.task.status !== 'running' && state.task.status !== 'queued' && second > 3) {
        console.log('the task settled before the test could close the tab');
        break;
      }
    }
    await a.close();
    const closedAt = Date.now();
    for (let second = 1; second <= 180; second += 1) {
      await sleep(1000);
      const rows = [];
      for (const page of await willowPages(browser)) {
        const state = await Promise.race([sparkState(page, taskId), sleep(4000).then(() => ({ error: 'no answer' }))]);
        if (state.error) continue;
        rows.push({ page: page === b ? 'B' : page.url().slice(21, 45), ...state });
      }
      const summary = rows.map((row) => `${row.page}:${row.task?.status ?? '-'}/${row.task?.response ?? 0}/${row.jobs.map((job) => `${job.owner}x${job.takeovers}`).join(',') || 'nojob'}`);
      console.log(`+${((Date.now() - closedAt) / 1000).toFixed(1)}s`, summary.join('  '));
      const settled = rows.length && rows.every((row) => row.task && row.task.status !== 'running' && row.task.status !== 'queued' && !row.jobs.length);
      if (settled) break;
    }
    if (!process.argv.includes('--keep')) await b.close();
    browser.disconnect();
    return;
  }

  await a.bringToFront();
  await sleep(3000);
  await a.evaluate(() => {
    const abort = AbortController.prototype.abort;
    window.__aborts = [];
    AbortController.prototype.abort = function traced(...args) {
      window.__aborts.push({ at: Math.round(performance.now()), stack: new Error().stack.split('\n').slice(2, 9).map((line) => line.trim()).join(' | ') });
      return abort.apply(this, args);
    };
  });
  await a.focus(COMPOSER);
  const cdp = await a.createCDPSession();
  await cdp.send('Input.insertText', { text: prompt });
  await sleep(600);
  console.log('composer before send:', JSON.stringify(await a.evaluate((selector) => {
    const area = document.querySelector(selector);
    return { value: area?.value.slice(0, 40), focused: document.activeElement === area, visible: document.visibilityState };
  }, COMPOSER)));
  await a.keyboard.press('Enter');
  await sleep(1500);
  await a.screenshot({ path: require('node:os').tmpdir() + '/bg-takeover-sent.png' });

  let before = null;
  for (let index = 0; index < 90; index += 1) {
    await sleep(1000);
    before = await chatState(a);
    console.log(`tab A +${index + 1}s`, JSON.stringify(before));
    if (before.turns.some((turn) => turn.chars > 500)) break;
    if (index > 3 && !before.turns.length) {
      console.log('turn ended in tab A before the test could close it; aborts:',
        JSON.stringify(await a.evaluate(() => window.__aborts), null, 1));
      await a.close();
      await b.close();
      browser.disconnect();
      return;
    }
  }
  // Long enough for a checkpoint (every 2 s) to put the question and partial reply on disk.
  await sleep(2600);
  before = await chatState(a);
  console.log('tab A, about to close:', JSON.stringify(before));
  await a.close();
  const closedAt = Date.now();

  for (let second = 1; second <= 150; second += 1) {
    await sleep(1000);
    const pages = await willowPages(browser);
    const states = [];
    for (const page of pages) {
      try {
        const state = await chatState(page);
        if (state.turns.length || state.jobs.length) states.push({ url: page.url().slice(21, 70), page: page === b ? 'B' : 'other', ...state });
      } catch {
        // A page mid-navigation.
      }
    }
    console.log(`+${((Date.now() - closedAt) / 1000).toFixed(1)}s`, JSON.stringify(states));
    const running = states.some((state) => state.turns.some((turn) => turn.status === 'running'));
    const jobs = states.some((state) => state.jobs.length);
    if (second > 3 && !running && !jobs) break;
  }
  if (!process.argv.includes('--keep')) await b.close();
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
