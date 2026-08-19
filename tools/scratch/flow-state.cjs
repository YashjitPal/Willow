/* Throwaway: reload the Flow tab and report whether the header search came back. */
const { connect, sleep } = require('../ui-research/scrapers/flow/lib.cjs');

(async () => {
  const browser = await connect();
  const t = browser.targets().find((x) => x.type() === 'page' && x.url().includes('labs.google/fx/tools/flow'));
  if (!t) throw new Error('no Flow tab');
  const page = await t.page();
  await page.bringToFront();
  await page.reload({ waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 12; i += 1) {
    await sleep(2500);
    const out = await page.evaluate(() => ({
      url: location.href,
      inputs: document.querySelectorAll('input').length,
      forms: document.querySelectorAll('form').length,
      text: (document.body.innerText || '').slice(0, 120).replace(/\s+/g, ' '),
    }));
    console.log(`[${i}]`, JSON.stringify(out));
    if (out.forms > 0) break;
  }
  await browser.disconnect();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
