/**
 * Code takeovers while Code is open, without a model, in a browser context of their own
 * (own storage, own Web Locks), so no other open Willow tab can be the one that inherits.
 *
 *   1. B has the Code home on show; A starts a turn for a project and closes. B adopts it
 *      in a hidden project screen beside the Code home, settles, and lets it go.
 *   2. B has that project on show; A starts a turn for an inbox chat and closes. B adopts
 *      it in a hidden Code home beside the project, settles, and lets it go.
 *
 * The project is a registry entry made in this context only, and the chat does not exist,
 * so neither has a message to send again. The context is closed at the end.
 *
 *   node tools/scratch/bg-takeover-code-open.cjs
 */
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000';
const SCOPE = 'signed-out::browser';
const PROBE = { id: '#zz-takeover-probe', name: 'ZZ Takeover Probe', kind: 'code' };
const PROBE_CHAT = 'zz-takeover-probe-chat';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const callModule = (page, suffix, body, ...args) => page.evaluate(async (part, source, rest) => {
  const url = performance.getEntriesByType('resource').map((entry) => entry.name).reverse()
    .find((entry) => entry.split('?')[0].endsWith(part));
  if (!url) return `module ${part} not loaded`;
  // eslint-disable-next-line no-new-func
  return new Function('mod', 'args', source)(await import(url), rest);
}, suffix, body, args);

const open = async (context, path) => {
  const page = await context.newPage();
  await page.evaluateOnNewDocument(() => performance.setResourceTimingBufferSize(20000));
  page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 200)}`));
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea', { visible: true, timeout: 90_000 });
  await sleep(4000);
  return page;
};

const go = (page, url) => page.evaluate((to) => {
  sessionStorage.setItem('staging-nav', 'true');
  history.pushState({}, '', to);
  dispatchEvent(new PopStateEvent('popstate'));
}, url);

const state = async (page) => ({
  ...(await page.evaluate(() => ({
    url: location.pathname + location.search.slice(0, 30),
    onShow: [...document.querySelectorAll('[data-takeover-marker]')].filter((el) => !el.closest('[inert]')).map((el) => el.getAttribute('data-takeover-marker')),
    hiddenScreens: [...document.querySelectorAll('[inert][aria-hidden="true"]')].filter((host) => host.querySelector('textarea')).length,
    jobs: Object.keys(localStorage).filter((key) => key.startsWith('willow:job:code')).length,
  }))),
  resume: await callModule(page, '/code-turn-jobs.ts', 'const r = mod.$codeResume.get(); return r ? r.job.payload.place.target : null;'),
  active: await callModule(page, '/session/code-session.ts', 'const s = mod.$activeCodeSession.get(); return s ? s.screenKey : null;'),
});

const markOnShow = (page, label) => page.evaluate((name) => {
  const area = [...document.querySelectorAll('textarea')].find((el) => el.getBoundingClientRect().width > 0 && !el.closest('[inert]'));
  area?.parentElement?.setAttribute('data-takeover-marker', name);
  return Boolean(area);
}, label);

const inherit = async (context, b, place) => {
  const a = await open(context, '/');
  const id = await callModule(a, '/code-turn-jobs.ts', `
    window.__probeJob = mod.startCodeTurnJob(undefined, args[0], { place: args[1], mode: 'build', tool: null, selectedModelId: '' });
    return window.__probeJob.id;`, SCOPE, place);
  console.log('   A started:', id);
  await sleep(2000);
  await a.close();
  const closedAt = Date.now();
  let quiet = 0;
  for (let step = 0; step < 40 && quiet < 3; step += 1) {
    await sleep(700);
    const now = await state(b);
    console.log(`   +${((Date.now() - closedAt) / 1000).toFixed(1)}s`, JSON.stringify(now));
    quiet = now.jobs === 0 && !now.resume && now.hiddenScreens === 0 ? quiet + 1 : 0;
  }
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const context = await browser.createBrowserContext();
  try {
    const b = await open(context, '/');
    await callModule(b, '/projects/src/registry.ts',
      'mod.writeProjectRegistry([...mod.readProjectRegistry().filter((p) => p.id !== args[0].id), args[0]]); return true;', PROBE);

    console.log('1. a project turn inherited while the Code home is on show');
    await go(b, '/?mode=develop');
    await sleep(5000);
    console.log('   marked the Code home:', await markOnShow(b, 'home'));
    console.log('  ', JSON.stringify(await state(b)));
    await inherit(context, b, { target: 'project', projectId: PROBE.id, projectName: PROBE.name, sessionId: null });

    console.log('\n2. an inbox chat turn inherited while a project is on show');
    await go(b, `/project1?projectId=${encodeURIComponent(PROBE.id)}`);
    await sleep(8000);
    console.log('   marked the project:', await markOnShow(b, 'project'));
    console.log('  ', JSON.stringify(await state(b)));
    await inherit(context, b, { target: 'chat', chatId: PROBE_CHAT });
  } finally {
    await context.close();
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
