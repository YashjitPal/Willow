/**
 * Saved chats by address, in this browser's own workspace (its folder is connected):
 * opens one chat by `/app/<chat>`, picks another from Recents, goes Back, and starts a
 * New chat. Opening a chat writes nothing; nothing is typed or sent. Its own tab, closed after.
 *
 *   node tools/scratch/shell-urls-chats.cjs
 */
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const where = (page) => page.evaluate(() => ({
  url: decodeURIComponent(location.pathname),
  // The Recents row Chat has open is the highlighted one.
  open: [...document.querySelectorAll('.sidebar-item-row')]
    .find((row) => row.getAttribute('aria-current') === 'page' || /active|selected/.test(row.className))
    ?.querySelector('.sidebar-item-label')?.textContent.trim() ?? null,
}));

(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  try {
    page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message.slice(0, 160)}`));
    if (process.env.TRACE) {
      await page.evaluateOnNewDocument(() => {
        const log = (entry) => {
          const all = JSON.parse(sessionStorage.getItem('__historyLog') || '[]');
          all.push(`${Math.round(performance.now())} ${entry}`);
          sessionStorage.setItem('__historyLog', JSON.stringify(all.slice(-60)));
        };
        log(`load ${decodeURIComponent(location.pathname)} len=${history.length}`);
        for (const method of ['pushState', 'replaceState']) {
          const original = history[method].bind(history);
          history[method] = (state, title, url) => {
            log(`${method} ${url ? decodeURIComponent(String(url)) : '(same)'} key=${state?.key ?? '-'}`);
            return original(state, title, url);
          };
        }
        window.addEventListener('popstate', () => log(`popstate -> ${decodeURIComponent(location.pathname)} key=${history.state?.key ?? '-'}`));
      });
    }
    const dumpLog = async (label) => {
      if (!process.env.TRACE) return;
      const lines = await page.evaluate(() => {
        const all = JSON.parse(sessionStorage.getItem('__historyLog') || '[]');
        sessionStorage.setItem('__historyLog', '[]');
        return [...all, `history.length=${history.length}`];
      });
      console.log(`   history during ${label}:\n     ${lines.join('\n     ')}`);
    };
    await page.bringToFront();
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sidebar-item-row', { visible: true, timeout: 90_000 });
    await sleep(6000);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.sidebar-item-row')]
      .filter((row) => row.getBoundingClientRect().width > 0 && !row.querySelector('[title="Started in Code mode"]'))
      .map((row) => row.querySelector('.sidebar-item-label')?.textContent.trim())
      .filter((label) => label && !['New chat', 'Search chats', 'Code', 'Media', 'Customize', 'Gems', 'Untitled'].includes(label)));
    // Two named chats Recents shows, neither of them Code's.
    const [first, second] = await page.evaluate((labels) => {
      const scope = Object.keys(localStorage).find((key) => key.startsWith('willow_local_chats:') && /signed-out%3A%3A[0-9a-f-]{36}$/.test(key));
      const ids = JSON.parse(localStorage.getItem(scope) || '[]');
      return labels.filter((label) => ids.includes(label)).slice(0, 2);
    }, rows);
    console.log('Recents rows on screen:', rows.slice(0, 4), '| two chat ids:', first, '|', second);
    if (!first || !second) throw new Error('needs two saved chats');

    await page.goto(`${BASE}/app/${encodeURIComponent(first).replace(/\./g, '%2E')}`, { waitUntil: 'domcontentloaded' });
    await sleep(8000);
    console.log('1. opened by address:', JSON.stringify(await where(page)));
    await dumpLog('step 1');

    const clicked = await page.evaluate((title) => {
      const row = [...document.querySelectorAll('.sidebar-item-row')]
        .find((el) => el.getBoundingClientRect().width > 0 && el.querySelector('.sidebar-item-label')?.textContent.trim() === title);
      (row?.querySelector('.sidebar-item-label') || row)?.click();
      return Boolean(row);
    }, second);
    await sleep(4000);
    console.log('2. picked from Recents:', clicked, JSON.stringify(await where(page)));
    await dumpLog('step 2');

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await sleep(4000);
    console.log('3. Back:', JSON.stringify(await where(page)));
    await dumpLog('step 3');

    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.sidebar-item-row')]
        .find((el) => el.getBoundingClientRect().width > 0 && el.querySelector('.sidebar-item-label')?.textContent.trim() === 'New chat');
      row?.click();
    });
    await sleep(3000);
    console.log('4. New chat:', JSON.stringify(await where(page)));
    await dumpLog('step 4');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await sleep(4000);
    console.log('5. Back:', JSON.stringify(await where(page)));
    await dumpLog('step 5');
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
