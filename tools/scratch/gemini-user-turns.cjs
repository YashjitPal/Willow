/**
 * Read-only: what the user turns of a Gemini chat contain — custom tags, images (with their
 * boxes) and background images — to find where a sent image lives. Its own tab.
 *
 *   node tools/scratch/gemini-user-turns.cjs <chat id>
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const chatId = process.argv[2];
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90_000 });
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1536, height: 826 });
    await page.goto(`https://gemini.google.com/app/${chatId}`, { waitUntil: 'networkidle2', timeout: 90_000 });
    await new Promise((r) => setTimeout(r, 6000));
    const report = await page.evaluate(() => {
      const turns = [...document.querySelectorAll('user-query')];
      return {
        title: document.title,
        turns: turns.map((turn) => ({
          text: turn.innerText.replace(/\s+/g, ' ').slice(0, 120),
          tags: [...new Set([...turn.querySelectorAll('*')].map((el) => el.tagName.toLowerCase()).filter((t) => t.includes('-')))].slice(0, 30),
          imgs: [...turn.querySelectorAll('img')].map((img) => { const r = img.getBoundingClientRect(); return `${img.className} [${[r.x, r.y, r.width, r.height].map(Math.round)}] ${img.src.slice(0, 70)}`; }),
          bgs: [...turn.querySelectorAll('*')].filter((el) => getComputedStyle(el).backgroundImage.startsWith('url')).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`).slice(0, 5),
        })),
        allImgsInThread: [...document.querySelectorAll('.conversation-container img')].map((img) => { const r = img.getBoundingClientRect(); return `${img.closest('user-query') ? 'USER' : img.closest('model-response') ? 'MODEL' : '?'} ${img.className.slice(0, 40)} [${[r.x, r.y, r.width, r.height].map(Math.round)}]`; }).slice(0, 20),
      };
    });
    console.log(JSON.stringify(report, null, 1));
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
