/**
 * Several Code screens at once, without a model: turns are marked running through
 * the app's own store (`setCodeScreenRunning`), so this checks the shell, not a turn.
 *
 *   1. project A working, hidden, while the Code home is on show (Code opens the home);
 *   2. the Code home working, hidden, while project A is on show;
 *   3. projects A and B together, A hidden;
 *   4. A settles: it goes after the grace, B stays;
 *   5. a project the Code home has open reopens in the Code home.
 *
 * Opens the first two Code projects in the registry and writes nothing to them.
 *
 *   node tools/scratch/bg-code-two-screens.cjs
 */
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const callModule = (page, suffix, body, ...args) => page.evaluate(async (part, source, rest) => {
  const url = performance.getEntriesByType('resource').map((entry) => entry.name).reverse()
    .find((entry) => entry.split('?')[0].endsWith(part));
  if (!url) return `module ${part} not loaded`;
  // eslint-disable-next-line no-new-func
  return new Function('mod', 'args', source)(await import(url), rest);
}, suffix, body, args);

const setRunning = (page, key, running) => callModule(page, '/code-turn-activity.ts',
  'mod.setCodeScreenRunning(args[0], args[1]); return mod.$runningCodeScreens.get();', key, running);

const go = (page, url) => page.evaluate((to) => {
  sessionStorage.setItem('staging-nav', 'true');
  history.pushState({}, '', to);
  dispatchEvent(new PopStateEvent('popstate'));
}, url);

const clickSidebar = (page, label) => page.evaluate((text) => {
  const row = [...document.querySelectorAll('.sidebar-item-row')]
    .find((el) => el.getBoundingClientRect().width > 0 && el.querySelector('.sidebar-item-label')?.textContent.trim() === text && !el.closest('[inert]'));
  row?.click();
  return Boolean(row);
}, label);

const state = async (page) => ({
  ...(await page.evaluate(() => {
    const hosts = [...document.querySelectorAll('[inert][aria-hidden="true"]')];
    return {
      url: location.pathname + location.search.slice(0, 40),
      markers: [...document.querySelectorAll('[data-two-screens]')].map((el) => `${el.getAttribute('data-two-screens')}:${el.closest('[inert]') ? 'hidden' : 'shown'}`),
      previews: [...document.querySelectorAll('iframe[title="Preview"]')].map((frame) => (frame.closest('[inert]') ? 'hidden' : 'shown')),
      hiddenHosts: hosts.filter((host) => host.childElementCount > 0).length,
      draft: [...document.querySelectorAll('textarea')].filter((area) => area.value.includes('two-screens draft')).map((area) => (area.closest('[inert]') ? 'hidden' : 'shown')),
    };
  })),
  running: await callModule(page, '/code-turn-activity.ts', 'return mod.$runningCodeScreens.get();'),
  saving: await callModule(page, '/code-turn-activity.ts', 'return mod.$codeScreenProjects.get();'),
  active: await callModule(page, '/session/code-session.ts', 'const s = mod.$activeCodeSession.get(); return s ? `${s.screenKey}${s.onShow.get() ? "" : " (hidden)"}` : null;'),
});

const mark = (page, label) => page.evaluate((name) => {
  const host = [...document.querySelectorAll('.fixed.inset-0.h-screen.w-screen')].find((el) => !el.closest('[inert]') && el.querySelector('iframe, textarea'));
  const target = host?.querySelector('textarea')?.parentElement;
  if (!target) return false;
  target.setAttribute('data-two-screens', name);
  return true;
}, label);

(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  try {
    await run(page);
  } finally {
    // Never leave a tab behind with made-up turns running in it.
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function run(page) {
  await page.evaluateOnNewDocument(() => performance.setResourceTimingBufferSize(20000));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
  await page.bringToFront();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea.willow-dictation-textarea', { visible: true, timeout: 90_000 });
  await sleep(2500);

  // The registry answers for the workspace once the folder has been read, which a busy machine takes a while to do.
  let projects = [];
  for (let attempt = 0; attempt < 20 && !(Array.isArray(projects) && projects.length >= 2); attempt += 1) {
    projects = await callModule(page, '/projects/src/registry.ts',
      'return mod.readProjectRegistry().filter((p) => (p.kind ?? "code") === "code").slice(0, 2).map((p) => ({ id: p.id, name: p.name }));');
    if (!(Array.isArray(projects) && projects.length >= 2)) await sleep(1000);
  }
  console.log('projects:', JSON.stringify(projects));
  if (!Array.isArray(projects) || projects.length < 2) throw new Error('needs two Code projects');
  const [a, b] = projects;
  const keyA = `project:${a.id}`;

  console.log('\n1. A working, hidden; Code opens the Code home');
  await go(page, `/project1?projectId=${encodeURIComponent(a.id)}`);
  await sleep(9000);
  console.log('   marked A:', await mark(page, 'A'));
  console.log('   running:', JSON.stringify(await setRunning(page, keyA, true)));
  await go(page, '/');
  await sleep(1500);
  console.log('   clicked Code:', await clickSidebar(page, 'Code'));
  await sleep(4000);
  await page.evaluate(() => {
    const area = [...document.querySelectorAll('textarea')].find((el) => el.getBoundingClientRect().width > 0 && !el.closest('[inert]'));
    area?.focus();
  });
  await page.keyboard.type('two-screens draft', { delay: 5 });
  console.log('  ', JSON.stringify(await state(page)));

  console.log('\n2. the Code home working, hidden, while A is on show');
  console.log('   running:', JSON.stringify(await setRunning(page, 'home', true)));
  await go(page, `/project1?projectId=${encodeURIComponent(a.id)}`);
  await sleep(3000);
  console.log('  ', JSON.stringify(await state(page)));

  console.log('\n3. B opened while A works');
  await go(page, `/project1?projectId=${encodeURIComponent(b.id)}`);
  await sleep(9000);
  console.log('   marked B:', await mark(page, 'B'));
  console.log('  ', JSON.stringify(await state(page)));

  console.log('\n   frame timing on B with A and the Code home mounted, hidden:');
  console.log('  ', JSON.stringify(await page.evaluate(() => new Promise((resolve) => {
    // A tab behind another gets no animation frames at all.
    if (document.visibilityState !== 'visible') {
      resolve('skipped: the tab is not the visible one');
      return;
    }
    const longTasks = [];
    const observer = new PerformanceObserver((list) => list.getEntries().forEach((entry) => longTasks.push(Math.round(entry.duration))));
    try { observer.observe({ type: 'longtask', buffered: false }); } catch {}
    const gaps = [];
    let last = performance.now();
    const started = last;
    const tick = (now) => {
      gaps.push(now - last);
      last = now;
      if (now - started < 5000) requestAnimationFrame(tick);
      else {
        observer.disconnect();
        gaps.sort((x, y) => x - y);
        resolve({ frames: gaps.length, p50: Math.round(gaps[Math.floor(gaps.length / 2)]), p95: Math.round(gaps[Math.floor(gaps.length * 0.95)]), worst: Math.round(gaps[gaps.length - 1]), longTasks });
      }
    };
    requestAnimationFrame(tick);
  }))));

  console.log('\n4. A and the Code home settle: they go after the grace, B stays');
  await setRunning(page, keyA, false);
  console.log('   running:', JSON.stringify(await setRunning(page, 'home', false)));
  await sleep(1000);
  console.log('   at 1s:', JSON.stringify(await state(page)));
  await sleep(3500);
  console.log('   at 4.5s:', JSON.stringify(await state(page)));

  console.log('\n5. a project the Code home has open reopens there');
  await go(page, '/');
  await sleep(1000);
  await clickSidebar(page, 'Code');
  await sleep(3000);
  await setRunning(page, 'home', true);
  await callModule(page, '/code-turn-activity.ts', 'mod.setCodeScreenProject("home", args[0]); return true;', a.name);
  await go(page, `/project1?projectId=${encodeURIComponent(a.id)}`);
  await sleep(3000);
  console.log('  ', JSON.stringify(await state(page)));
  await callModule(page, '/code-turn-activity.ts', 'mod.setCodeScreenProject("home", null); return true;');
  await setRunning(page, 'home', false);

  console.log('\npage errors:', JSON.stringify(errors.slice(0, 8)));
}
