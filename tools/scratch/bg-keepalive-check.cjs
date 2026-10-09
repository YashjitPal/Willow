/**
 * Step 1 of background work, without a model: marks Code (or Media) as busy through the
 * app's own store, leaves the screen, and checks it stays mounted, hidden and inert, keeps
 * its state, and comes back as the same instance — then clears the flag and checks it goes.
 *
 *   node tools/scratch/bg-keepalive-check.cjs code
 *   node tools/scratch/bg-keepalive-check.cjs media <projectId>
 */
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mode = process.argv[2] || 'code';

/** Sets an atom exported by a module the app already loaded, through the same module instance. */
const setAtom = (page, fragment, exportName, value) => page.evaluate(async (part, name, next) => {
  const url = performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes(part));
  if (!url) return `module ${part} not loaded`;
  const module = await import(url);
  module[name].set(next);
  return `set ${name}=${next}`;
}, fragment, exportName, value);

const hiddenHosts = (page) => page.evaluate(() => [...document.querySelectorAll('[inert][aria-hidden="true"]')].map((host) => {
  const style = getComputedStyle(host);
  return { opacity: style.opacity, position: style.position, z: style.zIndex, children: host.querySelectorAll('*').length, text: host.innerText.slice(0, 60).replace(/\s+/g, ' ') };
}));

const clickText = (page, selector, text) => page.evaluate((sel, label) => {
  const target = [...document.querySelectorAll(sel)].find((el) => el.textContent.trim() === label && el.getBoundingClientRect().width > 0);
  if (!target) return false;
  target.click();
  return true;
}, selector, text);

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  await page.bringToFront();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  if (mode === 'code') {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea.willow-dictation-textarea', { visible: true, timeout: 90_000 });
    await sleep(1500);
    console.log('to Code:', await clickText(page, 'a, button, [role="button"], div', 'Code'));
    await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some((area) => /Ask Willow|What do you want to build|Describe/i.test(area.placeholder) && area.getBoundingClientRect().width > 0), { timeout: 60_000 }).catch(() => undefined);
    await sleep(1500);
    // A marker only this Code instance holds: a draft in its prompt box.
    const typed = await page.evaluate(() => {
      const area = [...document.querySelectorAll('textarea')].find((candidate) => candidate.getBoundingClientRect().width > 0 && !candidate.classList.contains('willow-dictation-textarea'));
      if (!area) return 'no code prompt box';
      area.focus();
      return area.placeholder;
    });
    console.log('code prompt box:', typed);
    await page.keyboard.type('keep-alive marker', { delay: 5 });
    console.log(await setAtom(page, 'code-turn-activity', '$runningCodeScreens', ['home']));
    console.log('to Chat:', await clickText(page, 'a, button, [role="button"], div', 'New chat'));
    await sleep(1500);
    console.log('hidden hosts while in Chat:', JSON.stringify(await hiddenHosts(page)));
    console.log('chat composer visible:', await page.evaluate(() => !!document.querySelector('textarea.willow-dictation-textarea')?.getBoundingClientRect().width));
    console.log('New chat again:', await clickText(page, 'a, button, [role="button"], div', 'New chat'));
    await sleep(800);
    console.log('hidden hosts after a second New chat:', (await hiddenHosts(page)).length);
    console.log('back to Code:', await clickText(page, 'a, button, [role="button"], div', 'Code'));
    await sleep(1500);
    console.log('marker kept:', await page.evaluate(() => [...document.querySelectorAll('textarea')].some((area) => area.value.includes('keep-alive marker'))));
    console.log('hidden hosts in Code:', (await hiddenHosts(page)).length);
    console.log('to Chat again:', await clickText(page, 'a, button, [role="button"], div', 'New chat'));
    await sleep(500);
    console.log(await setAtom(page, 'code-turn-activity', '$runningCodeScreens', []));
    await sleep(1000);
    console.log('1s after settling:', (await hiddenHosts(page)).length, 'hidden hosts');
    await sleep(3000);
    console.log('4s after settling:', (await hiddenHosts(page)).length, 'hidden hosts');
  } else {
    const projectId = process.argv[3];
    sessionStorage && undefined;
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea.willow-dictation-textarea', { visible: true, timeout: 90_000 });
    await page.evaluate(() => sessionStorage.setItem('staging-nav', 'true'));
    await page.evaluate((id) => { history.pushState({}, '', `/media?projectId=${encodeURIComponent(id)}`); dispatchEvent(new PopStateEvent('popstate')); }, projectId);
    await sleep(6000);
    const mediaBox = await page.evaluate(() => ({ url: location.pathname + location.search, prompt: !!document.querySelector('textarea, [contenteditable="true"]') }));
    console.log('media open:', JSON.stringify(mediaBox));
    const typed = await page.evaluate(() => {
      const box = [...document.querySelectorAll('textarea, [contenteditable="true"]')].find((el) => el.getBoundingClientRect().width > 0);
      if (!box) return 'no prompt box';
      box.focus();
      return box.tagName + ' ' + (box.getAttribute('placeholder') || box.getAttribute('aria-label') || '');
    });
    console.log('media prompt box:', typed);
    await page.keyboard.type('keep-alive marker', { delay: 5 });
    console.log(await setAtom(page, 'media-background', '$mediaWorkRunning', true));
    await page.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
    await sleep(2500);
    console.log('hidden hosts on home:', JSON.stringify(await hiddenHosts(page)));
    console.log('chat composer visible:', await page.evaluate(() => !!document.querySelector('textarea.willow-dictation-textarea')?.getBoundingClientRect().width));
    await page.screenshot({ path: require('node:os').tmpdir() + '/bg-keepalive-media-home.png' });
    await page.evaluate((id) => { history.pushState({}, '', `/media?projectId=${encodeURIComponent(id)}`); dispatchEvent(new PopStateEvent('popstate')); }, projectId);
    await sleep(2000);
    console.log('marker kept:', await page.evaluate(() => [...document.querySelectorAll('textarea, [contenteditable="true"]')].some((el) => (el.value ?? el.textContent).includes('keep-alive marker'))));
    await page.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
    await sleep(500);
    console.log(await setAtom(page, 'media-background', '$mediaWorkRunning', false));
    await sleep(4000);
    console.log('4s after settling:', (await hiddenHosts(page)).length, 'hidden hosts');
  }

  console.log('page errors:', JSON.stringify(errors.slice(0, 5)));
  await page.close();
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
