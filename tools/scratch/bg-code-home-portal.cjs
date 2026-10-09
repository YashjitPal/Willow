/**
 * The Code home rendered above the routes, without a model: opens Code, types a draft,
 * marks a turn running through the app's own store, opens the Media editor, comes back,
 * and reports where the Code home's container sits at each step and whether the draft
 * (this instance's only marker) survived. Then checks an idle Code home still unmounts
 * when the Media editor opens.
 *
 *   node tools/scratch/bg-code-home-portal.cjs
 */
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DRAFT = 'portal marker draft';

const setRunning = (page, value) => page.evaluate(async (next) => {
  const url = performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes('/code-turn-activity.ts'));
  (await import(url)).setCodeScreenRunning('home', next);
}, value);

const go = (page, url) => page.evaluate((target) => {
  sessionStorage.setItem('staging-nav', 'true');
  history.pushState({}, '', target);
  dispatchEvent(new PopStateEvent('popstate'));
}, url);

const state = (page) => page.evaluate((draft) => {
  const area = [...document.querySelectorAll('textarea')].find((candidate) => candidate.value === draft);
  const parking = [...document.querySelectorAll('[inert][aria-hidden="true"]')];
  const main = document.querySelector('main');
  return {
    url: location.pathname,
    draft: area ? (area.closest('[inert]') ? 'parked' : main?.contains(area) ? 'in main area' : 'elsewhere') : 'gone',
    draftBox: area ? (() => { const r = area.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)]; })() : null,
    parkedElements: parking.map((host) => host.querySelectorAll('*').length),
    mediaEditor: Boolean(document.querySelector('.fixed.inset-0.h-screen.w-screen.bg-\\[\\#000000\\]')),
  };
}, DRAFT);

const clickRow = (page, label) => page.evaluate((text) => {
  const row = [...document.querySelectorAll('.sidebar-item-row')]
    .find((el) => el.querySelector('.sidebar-item-label')?.textContent.trim() === text && el.getBoundingClientRect().width > 0 && !el.closest('[inert]'));
  row?.click();
  return Boolean(row);
}, label);

(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));
  await page.bringToFront();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea.willow-dictation-textarea', { visible: true, timeout: 90_000 });
  await sleep(2500);
  const mediaProject = await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes('/projects/src/registry.ts'));
    return (await import(url)).readProjectRegistry().find((entry) => entry.kind === 'media')?.id ?? null;
  });

  console.log('open Code:', await clickRow(page, 'Code'));
  await sleep(3500);
  await page.evaluate(() => {
    const area = [...document.querySelectorAll('textarea')].find((candidate) => candidate.getBoundingClientRect().width > 0 && !candidate.closest('[inert]'));
    area?.focus();
  });
  await page.keyboard.type(DRAFT, { delay: 4 });
  await page.screenshot({ path: require('node:os').tmpdir() + '/bg-portal-1-code.png' });
  console.log('1 Code home:', JSON.stringify(await state(page)));

  await setRunning(page, true);
  await go(page, `/media?projectId=${encodeURIComponent(mediaProject)}`);
  await sleep(6000);
  await page.screenshot({ path: require('node:os').tmpdir() + '/bg-portal-2-media.png' });
  console.log('2 Media editor while Code works:', JSON.stringify(await state(page)));

  await go(page, '/');
  await sleep(3000);
  await page.screenshot({ path: require('node:os').tmpdir() + '/bg-portal-3-back.png' });
  console.log('3 back to the studio:', JSON.stringify(await state(page)));

  await setRunning(page, false);
  await sleep(500);
  await go(page, `/media?projectId=${encodeURIComponent(mediaProject)}`);
  await sleep(5000);
  console.log('4 Media editor with Code idle (3s grace passed):', JSON.stringify(await state(page)));
  await go(page, '/');
  await sleep(2500);
  console.log('5 studio again:', JSON.stringify(await state(page)));
  console.log('page errors:', JSON.stringify(errors.slice(0, 5)));
  await page.close();
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
