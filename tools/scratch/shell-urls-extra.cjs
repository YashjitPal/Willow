/**
 * The shell addresses `shell-urls.cjs` leaves out, in a browser context of its own (own
 * storage, no folder): the Projects page with its Labs flag on, and Spark task addresses —
 * one naming a task that is not there, and one made here. Model requests are refused, so
 * the task never leaves the machine.
 *
 *   node tools/scratch/shell-urls-extra.cjs
 */
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const where = (page) => page.evaluate(() => {
  const visible = (el) => el.getBoundingClientRect().width > 0 && !el.closest('[inert]');
  const any = (selector) => [...document.querySelectorAll(selector)].some(visible);
  return {
    url: decodeURIComponent(location.pathname) + location.search,
    on: any('input[placeholder="Search projects..."]') ? 'Projects'
      : any('.spark-all-tasks') ? 'Spark tasks'
        : any('[class*="spark-task-detail"]') ? 'Spark task'
          : any('.spark-top-controls') ? 'Spark'
            : any('textarea.willow-dictation-textarea') ? 'Chat'
              : 'other',
  };
});

const clickSidebar = (page, label) => page.evaluate((text) => {
  const row = [...document.querySelectorAll('.sidebar-item-row, button')]
    .find((el) => el.getBoundingClientRect().width > 0 && !el.closest('[inert]')
      && ((el.querySelector('.sidebar-item-label')?.textContent.trim() ?? el.textContent.trim()) === text));
  row?.click();
  return Boolean(row);
}, label);

// TRACE=1 prints each step's history calls; ONLY=A or ONLY=B runs one part.
const traceHistory = () => {
  const log = (entry) => {
    const all = JSON.parse(sessionStorage.getItem('__historyLog') || '[]');
    all.push(`${Math.round(performance.now())} ${entry}`);
    sessionStorage.setItem('__historyLog', JSON.stringify(all.slice(-60)));
  };
  log(`load ${decodeURIComponent(location.pathname)} len=${history.length}`);
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method].bind(history);
    history[method] = (state, title, url) => {
      const spark = state?.willowSparkLocation ?? state?.sparkLocation;
      log(`${method} ${url ? decodeURIComponent(String(url)).replace(location.origin, '') : '(same)'} key=${state?.key ?? '-'} spark=${spark ? JSON.stringify(spark) : '-'}`);
      return original(state, title, url);
    };
  }
  window.addEventListener('popstate', () => log(`popstate -> ${decodeURIComponent(location.pathname)} key=${history.state?.key ?? '-'} state=${JSON.stringify(history.state)}`));
};

const step = async (page, label, action, wait = 2500) => {
  const done = await action();
  await sleep(wait);
  console.log(`${label}${done === false ? ' (no control found)' : ''}:`, JSON.stringify(await where(page)));
  if (!process.env.TRACE) return;
  const lines = await page.evaluate(() => {
    const all = JSON.parse(sessionStorage.getItem('__historyLog') || '[]');
    sessionStorage.setItem('__historyLog', '[]');
    return [...all, `history.length=${history.length}`];
  }).catch(() => []);
  console.log(`     ${lines.join('\n     ')}`);
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.evaluateOnNewDocument(() => {
      if (location.origin !== 'http://localhost:3000') return;
      if (!localStorage.getItem('willow:apiKeys:guest')) {
        localStorage.setItem('willow:apiKeys:guest', JSON.stringify({ gemini: ['zz-not-a-real-key'], openai: [], anthropic: [] }));
      }
      if (!localStorage.getItem('willow:experiments')) {
        localStorage.setItem('willow:experiments', JSON.stringify({ 'projects-panel': true }));
      }
    });
    if (process.env.TRACE) await page.evaluateOnNewDocument(traceHistory);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (/generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/.test(request.url())) void request.abort('failed');
      else void request.continue();
    });
    page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 160)}`));
    await page.bringToFront();

    if (process.env.ONLY !== 'B') {
      await step(page, 'A1. open /projects (Labs on)', () => page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded' }).then(() => true), 8000);
      await step(page, 'A2. New chat', () => clickSidebar(page, 'New chat'), 3000);
      await step(page, 'A3. Back', () => page.goBack({ waitUntil: 'domcontentloaded' }).then(() => true), 3000);
      await step(page, 'A4. Forward', () => page.goForward({ waitUntil: 'domcontentloaded' }).then(() => true), 3000);
    }
    if (process.env.ONLY === 'A') return;

    await page.goto(`${BASE}/spark/chat/not-a-task`, { waitUntil: 'domcontentloaded' });
    const startedAt = Date.now();
    let landed = null;
    while (Date.now() - startedAt < 15_000) {
      await sleep(250);
      const now = await where(page);
      if (now.url !== '/spark/chat/not-a-task') {
        landed = now;
        break;
      }
    }
    await sleep(1500);
    console.log(`B1. open /spark/chat/<a task that is not there>: left it after ${Date.now() - startedAt - 1500} ms for`,
      JSON.stringify(landed), '| settled on', JSON.stringify(await where(page)));

    await step(page, 'B2. open /spark', () => page.goto(`${BASE}/spark`, { waitUntil: 'domcontentloaded' }).then(() => true), 7000);
    await step(page, 'B3. start a Spark task', async () => {
      const focused = await page.evaluate(() => {
        const box = [...document.querySelectorAll('textarea')].find((el) => el.getBoundingClientRect().width > 0 && !el.closest('[inert]'));
        box?.focus();
        return Boolean(box);
      });
      if (!focused) return false;
      await page.keyboard.type('Summarize the plot of Hamlet', { delay: 4 });
      await page.keyboard.press('Enter');
      return true;
    }, 5000);
    const taskUrl = (await where(page)).url;
    await step(page, 'B4. reload it', () => page.reload({ waitUntil: 'domcontentloaded' }).then(() => true), 8000);
    await step(page, 'B5. Back', () => page.goBack({ waitUntil: 'domcontentloaded' }).then(() => true), 3000);
    await step(page, 'B6. Forward', () => page.goForward({ waitUntil: 'domcontentloaded' }).then(() => true), 3000);
    if (taskUrl.startsWith('/spark/chat/')) {
      await step(page, `B7. open ${taskUrl} in a fresh load`, () => page.goto(`${BASE}${encodeURI(taskUrl)}`, { waitUntil: 'domcontentloaded' }).then(() => true), 8000);
    }
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
