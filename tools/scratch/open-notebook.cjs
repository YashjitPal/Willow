/** Put the Willow tab back on the notebook page by clicking its card. */
const { connect, sleep } = require('../ui-research/scrapers/notebooks/lib.cjs');

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /localhost:3000/.test(p.url()));
    if (!page) throw new Error('no Willow tab');
    console.log('at', page.url());
    if (!/\/notebook\//.test(page.url())) {
      const ok = await page.evaluate(() => {
        const card = document.querySelector('.nb-card');
        if (card) { card.click(); return true; }
        return false;
      });
      if (!ok) {
        await page.goto('http://localhost:3000/notebooks/view', { waitUntil: 'networkidle2' });
        await sleep(1500);
        await page.evaluate(() => document.querySelector('.nb-card').click());
      }
      await sleep(1800);
    }
    console.log('now', page.url());
    console.log('chip:', await page.evaluate(() => {
      const c = document.querySelector('.nb-source-chip');
      return c ? c.textContent.trim() : 'none';
    }));
  } finally {
    await browser.disconnect();
  }
})();
