/**
 * Read-only: goes down the sidebar's Recents, opening each chat in turn, and reports the
 * ones whose user turns hold an image — a chat to study Gemini's sent-image preview in.
 * Its own tab; nothing is sent or changed.
 *
 *   node tools/scratch/gemini-find-sent-image.cjs [max chats]
 */
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const max = Number(process.argv[2]) || 30;
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90_000 });
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1536, height: 826 });
    await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2', timeout: 90_000 });
    await sleep(5000);
    const chats = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/app/"]')]
      .map((a) => a.getAttribute('href'))
      .filter((href) => /\/app\/[0-9a-f]{8,}/.test(href || '')))]);
    console.log(`${chats.length} chats in Recents`);
    const found = [];
    for (const href of chats.slice(0, max)) {
      await page.goto(`https://gemini.google.com${href.startsWith('/') ? href : `/${href}`}`, { waitUntil: 'networkidle2', timeout: 90_000 }).catch(() => {});
      await page.waitForSelector('user-query', { timeout: 12_000 }).catch(() => {});
      await sleep(1500);
      const hit = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll('user-query img')].filter((img) => img.getBoundingClientRect().width > 20 || img.naturalWidth > 20);
        return { title: document.querySelector('.conversation-title, [data-test-id="conversation-title"]')?.textContent?.trim() ?? document.title, turns: document.querySelectorAll('user-query').length, imgs: imgs.length };
      });
      console.log(`  ${href} turns ${hit.turns} user images ${hit.imgs}`);
      if (hit.imgs) found.push(href);
      if (found.length >= 3) break;
    }
    console.log('\nwith sent images:', JSON.stringify(found));
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
