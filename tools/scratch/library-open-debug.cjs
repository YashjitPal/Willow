/**
 * Why a Library open did not open its panel: clicks a row on the Library's Documents page and
 * samples the open request, the route and the panels every 100ms for 4s.
 *
 *   WILLOW_URL=http://localhost:3101 node tools/scratch/library-open-debug.cjs [row text = Research]
 */
const puppeteer = require('puppeteer-core');

const BASE = process.env.WILLOW_URL;
if (!BASE || /:3000\b/.test(BASE)) throw new Error('set WILLOW_URL to the test origin');
const MARK = 'willow-library-w';
const ROOT_FS = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const match = process.argv[2] || 'Research';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().includes(`#${MARK}`));
  if (!target) throw new Error(`no window marked #${MARK}`);
  const page = await target.page();
  page.on('console', (msg) => { if (/library|canvas|research/i.test(msg.text())) console.log('  console:', msg.text().slice(0, 200)); });
  await page.goto(`${BASE}/library/documents#${MARK}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.gm-library-row') && !document.querySelector('.gm-library [role="progressbar"]'), { timeout: 60_000 });
  await sleep(800);
  const moduleUrl = `${ROOT_FS}/features/chat/src/library-page/library-open.ts`;
  const sample = await page.evaluate(async (url, text) => {
    const mod = await import(url);
    const row = [...document.querySelectorAll('.gm-library-row a')].find((a) => a.textContent.includes(text));
    if (!row) return { error: `no row with "${text}"` };
    row.click();
    const out = [];
    const started = performance.now();
    while (performance.now() - started < 4000) {
      const req = mod.$libraryOpenRequest.get();
      out.push({
        t: Math.round(performance.now() - started),
        path: decodeURIComponent(location.pathname),
        request: req ? `${req.chatId} ${req.docId ?? ''}${req.researchMessageId ?? ''}` : null,
        research: !!document.querySelector('.dr-body'),
        canvas: !!document.querySelector('aside[aria-label$=" canvas"]'),
        messages: document.querySelectorAll('[data-message-id]').length,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return out;
  }, moduleUrl, match);
  if (sample.error) console.log(sample.error);
  else {
    let last = '';
    for (const s of sample) {
      const line = JSON.stringify({ ...s, t: undefined });
      if (line !== last) console.log(s.t, line);
      last = line;
    }
  }
  await page.evaluate((mark) => { if (!location.hash.includes(mark)) history.replaceState(history.state, '', `${location.pathname}${location.search}#${mark}`); }, MARK);
  browser.disconnect();
})().catch((error) => { console.error(error); process.exit(1); });
