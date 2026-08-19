/**
 * Remove the Wikipedia/Photosynthesis source that `willow-spinner-verify.cjs` accidentally
 * left in the notebook, and nothing else.
 *
 * How it got there: that script held `/api/fetch-source` unresolved so the pending tile
 * could be measured, but an earlier revision hung on a `requestAnimationFrame` sampler in a
 * window Chrome had stopped painting. Killing the process tore down the interception, Chrome
 * then completed the request it had been holding, and the source landed. **Interception is
 * only as durable as the process that owns it** — a held request is released, not dropped,
 * when the driver dies.
 *
 * Lists first, matches on the exact URL, refuses if the count is anything but one, and
 * prints the source list before and after.
 */
const { connect, openOwnWindow, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');

/*
 * The tile's `title` attribute is the source's TITLE, not its URL — for a website that is
 * the fetched page title, so this matches "Photosynthesis - Wikipedia", not the URL.
 */
const TARGET = 'Photosynthesis - Wikipedia';

const LIST = `() => Array.from(document.querySelectorAll('.nb-src-tile')).map((t) => ({
  label: (t.querySelector('.nb-src-tile-name') || {}).textContent || null,
  title: t.getAttribute('title'),
}))`;

(async () => {
  const browser = await connect();
  let page = null;
  try {
    page = await openOwnWindow(browser, 'http://localhost:3000/notebooks/view');
    await page.waitForSelector('.nb-card', { timeout: 30000 });
    await sleep(2000);
    if (!/\/notebook\//.test(page.url())) {
      await page.evaluate(() => document.querySelector('.nb-card').click());
    }
    await page.waitForSelector('.nb-source-chip', { timeout: 30000 });
    await sleep(1200);

    await page.evaluate(() => document.querySelector('.nb-source-chip').click());
    await page.waitForSelector('.nb-src-tile', { timeout: 15000 });
    await sleep(900);

    console.log('BEFORE:', JSON.stringify(await page.evaluate(new Function('return ' + LIST)()), null, 2));

    const result = await page.evaluate((target) => {
      const tiles = Array.from(document.querySelectorAll('.nb-src-tile'));
      const matches = tiles.filter((t) => (t.getAttribute('title') || '').includes(target));
      if (matches.length !== 1) return { ok: false, matched: matches.length };
      const btn = matches[0].querySelector('.nb-src-tile-remove');
      if (!btn) return { ok: false, reason: 'no remove button' };
      btn.click();
      return { ok: true, removed: matches[0].getAttribute('title') };
    }, TARGET);
    console.log('remove:', JSON.stringify(result));
    await sleep(1500);

    console.log('AFTER:', JSON.stringify(await page.evaluate(new Function('return ' + LIST)()), null, 2));
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.disconnect();
  }
})();
