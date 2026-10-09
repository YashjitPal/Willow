/**
 * The cross-tab job layer in real Chrome, with no model calls: three bare same-origin tabs
 * load `platform/core/src/background-jobs.ts` through Vite, one starts a job, the test closes
 * it, and reports which tab resumed it and how fast. Checks what the unit tests can only
 * fake: Web Locks released by a closed tab, storage events, one winner, and a hidden tab
 * still taking over.
 *
 *   node tools/scratch/bg-jobs-live.cjs
 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const ORIGIN = 'http://localhost:3000';
const MODULE = `/@fs/${path.resolve(__dirname, '../../platform/core/src/background-jobs.ts').replace(/\\/g, '/')}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const boot = (page, name) => page.evaluate(async (modulePath, tabName) => {
  const jobs = await import(modulePath);
  const env = {
    storage: localStorage,
    locks: navigator.locks,
    now: () => Date.now(),
    subscribe: (onChange) => {
      const listener = (event) => onChange(event.key);
      window.addEventListener('storage', listener);
      return () => window.removeEventListener('storage', listener);
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (handle) => clearInterval(handle),
  };
  const instance = jobs.createBackgroundJobs(env);
  window.__live = { name: tabName, instance, took: [] };
  instance.register('live-test', {
    takeOver: (job) => {
      const handle = instance.start({ id: job.id, kind: job.kind, scopeId: job.scopeId, payload: job.payload });
      window.__live.took.push({ id: job.id, at: Date.now(), resumed: handle.resumed, takeovers: job.takeovers, visibility: document.visibilityState });
      setTimeout(() => handle.finish(), 1500);
    },
  });
  return instance.instanceId.slice(0, 6);
}, MODULE, name);

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const tabs = {};
  for (const name of ['A', 'B', 'C']) {
    const page = await browser.newPage();
    await page.goto(`${ORIGIN}/favicon.ico`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    tabs[name] = { page, instance: await boot(page, name) };
  }
  // A starts a job; B is left in the background, C comes to the front.
  const id = `live-test:${Date.now()}`;
  await tabs.A.page.evaluate((jobId) => {
    window.__job = window.__live.instance.start({ id: jobId, kind: 'live-test', scopeId: 'live', payload: { step: 1 } });
  }, id);
  await sleep(300);
  await tabs.A.page.evaluate(() => window.__job.update({ step: 2 }));
  await tabs.C.page.bringToFront();
  await sleep(500);
  if (process.argv.includes('hidden')) {
    // Only B, in the background, is left to take over.
    await tabs.A.page.bringToFront();
    await tabs.C.page.close();
    tabs.C = null;
    await sleep(300);
  }
  const before = await tabs.B.page.evaluate((jobId) => JSON.parse(localStorage.getItem(`willow:job:${jobId}`)), id);
  console.log('record seen from B before closing A:', JSON.stringify(before));

  const closedAt = Date.now();
  await tabs.A.page.close();
  await sleep(1000);
  const alive = ['B', 'C'].filter((name) => tabs[name]);
  const took = {};
  for (const name of alive) took[name] = await tabs[name].page.evaluate(() => window.__live.took);
  console.log('takeovers 1s after closing A:', JSON.stringify(Object.fromEntries(
    Object.entries(took).map(([name, list]) => [name, list.map((entry) => ({ ...entry, afterCloseMs: entry.at - closedAt }))]),
  )));
  const record = await tabs.B.page.evaluate((jobId) => JSON.parse(localStorage.getItem(`willow:job:${jobId}`)), id);
  console.log('record after takeover:', JSON.stringify(record && { owner: record.owner.slice(0, 6), takeovers: record.takeovers, payload: record.payload }));
  console.log('instances:', JSON.stringify(Object.fromEntries(alive.map((name) => [name, tabs[name].instance]))));

  await sleep(2500);
  const after = await tabs.B.page.evaluate((jobId) => localStorage.getItem(`willow:job:${jobId}`), id);
  const tookLater = {};
  for (const name of alive) tookLater[name] = (await tabs[name].page.evaluate(() => window.__live.took)).length;
  console.log('after the resumed run finished: record', after === null ? 'removed' : 'still there', '| takeover counts', JSON.stringify(tookLater));

  for (const name of alive) await tabs[name].page.close();
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
