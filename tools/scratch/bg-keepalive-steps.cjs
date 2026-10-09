/**
 * Walks Code's keep-alive by hand with a screenshot per step:
 * Chat -> Code (type a draft) -> mark busy -> Media home -> Chat (New chat) -> Code again.
 *
 *   node tools/scratch/bg-keepalive-steps.cjs
 */
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000';
// Outside the repo: the shots show the user's own workspace.
const OUT = path.join(os.tmpdir(), 'bg-steps');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const setRunning = (page, screenKey, running) => page.evaluate(async (key, next) => {
  const url = performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes('/code-turn-activity.ts'));
  if (!url) return 'code-turn-activity not loaded';
  const activity = await import(url);
  activity.setCodeScreenRunning(key, next);
  return `running: ${JSON.stringify(activity.$runningCodeScreens.get())}`;
}, screenKey, running);

const activeScreen = (page) => page.evaluate(async () => {
  const url = performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes('/session/code-session.ts'));
  if (!url) return 'code-session not loaded';
  const session = (await import(url)).$activeCodeSession.get();
  return session ? `${session.screenKey} (on show: ${session.onShow.get()})` : 'none';
});

const state = (page) => page.evaluate(() => ({
  hidden: [...document.querySelectorAll('[inert][aria-hidden="true"]')].map((host) => host.querySelectorAll('*').length),
  drafts: [...document.querySelectorAll('textarea')].filter((area) => area.value).map((area) => ({ value: area.value.slice(0, 30), visible: area.getBoundingClientRect().width > 0 && getComputedStyle(area).visibility !== 'hidden' })),
  sidebar: [...document.querySelectorAll('nav a, nav button, aside a, aside button')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.textContent.trim()).filter(Boolean).slice(0, 12),
}));

const clickSidebar = (page, label) => page.evaluate((text) => {
  const row = [...document.querySelectorAll('.sidebar-item-row')]
    .find((el) => el.getBoundingClientRect().width > 0 && el.querySelector('.sidebar-item-label')?.textContent.trim() === text && !el.closest('[inert]'));
  if (row) {
    row.click();
    return 'row';
  }
  const candidates = [...document.querySelectorAll('a, button, [role="button"]')]
    .filter((el) => el.getBoundingClientRect().width > 0 && (el.textContent.trim() === text || el.textContent.trim().endsWith(`\u200b${text}`) || el.textContent.trim().replace(/^[a-z_]+/, '') === text) && !el.closest('[inert]'));
  candidates[0]?.click();
  return candidates.length;
}, label);

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  await page.bringToFront();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea.willow-dictation-textarea', { visible: true, timeout: 90_000 });
  await sleep(1500);

  console.log('1 click Code:', await clickSidebar(page, 'Code'));
  await sleep(3000);
  await page.screenshot({ path: `${OUT}-1-code.png` });
  const draft = await page.evaluate(() => {
    const area = [...document.querySelectorAll('textarea')].find((candidate) => candidate.getBoundingClientRect().width > 0);
    if (!area) return null;
    area.focus();
    return area.placeholder;
  });
  console.log('  code prompt placeholder:', draft);
  await page.keyboard.type('keep-alive marker', { delay: 5 });
  console.log('  ', JSON.stringify(await state(page)));
  console.log('  active screen:', await activeScreen(page));

  console.log('2', await setRunning(page, 'home', true));
  console.log('3 click Media:', await clickSidebar(page, 'Media'));
  await sleep(2500);
  await page.screenshot({ path: `${OUT}-3-media.png` });
  console.log('  ', JSON.stringify(await state(page)));
  console.log('  active screen:', await activeScreen(page));

  console.log('4 click New chat:', await clickSidebar(page, 'New chat'));
  await sleep(2500);
  await page.screenshot({ path: `${OUT}-4-chat.png` });
  console.log('  ', JSON.stringify(await state(page)));

  console.log('5 click Code:', await clickSidebar(page, 'Code'));
  await sleep(2500);
  await page.screenshot({ path: `${OUT}-5-code-again.png` });
  console.log('  ', JSON.stringify(await state(page)));
  console.log('  active screen:', await activeScreen(page));

  console.log('6', await setRunning(page, 'home', false));
  console.log('7 click New chat (idle):', await clickSidebar(page, 'New chat'));
  await sleep(4500);
  console.log('  ', JSON.stringify(await state(page)));
  console.log('  active screen:', await activeScreen(page));
  console.log('page errors:', JSON.stringify(errors.slice(0, 5)));
  await page.close();
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
