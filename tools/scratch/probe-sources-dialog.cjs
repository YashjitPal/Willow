/** What the sources dialog offers, so the stack check can drive it. */
const { connect, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /localhost:3000\/notebook\//.test(p.url()));
    if (!page) throw new Error('not on a notebook page');
    await page.evaluate(() => document.querySelector('.nb-source-chip').click());
    await sleep(700);
    console.log(JSON.stringify(await page.evaluate(() => ({
      rail: Array.from(document.querySelectorAll('.nb-src-rail-item')).map((b) => b.textContent.trim()),
      rows: Array.from(document.querySelectorAll('.nb-src-row')).map((r) => r.textContent.trim().slice(0, 60)),
    })), null, 2));

    // Open "Copied text" and report its controls.
    await page.evaluate(() => {
      const item = Array.from(document.querySelectorAll('.nb-src-rail-item'))
        .find((b) => /copied text/i.test(b.textContent));
      item.click();
    });
    await sleep(700);
    console.log(JSON.stringify(await page.evaluate(() => ({
      textareas: Array.from(document.querySelectorAll('textarea')).map((t) => t.placeholder),
      inputs: Array.from(document.querySelectorAll('.nb-sub input')).map((t) => t.placeholder),
      buttons: Array.from(document.querySelectorAll('.nb-sub button')).map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim()),
    })), null, 2));
  } finally {
    await browser.disconnect();
  }
})();
