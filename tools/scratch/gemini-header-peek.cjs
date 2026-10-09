/**
 * Read-only: opens one existing Gemini Spark task in a new tab of the debug Chrome,
 * records its processing-state labels and a screenshot, and closes the tab. Leaves
 * every other tab alone.
 *
 *   node tools/scratch/gemini-header-peek.cjs "<task title>" <out.png>
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const title = process.argv[2] || 'Daily Email Summarization Workflow';
  const out = process.argv[3] || 'tools/ui-research/captures/spark/134-remote-browser/gemini-header-peek.png';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  try {
    await page.goto('https://gemini.google.com/spark/tasks', { waitUntil: 'networkidle2', timeout: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const clicked = await page.evaluate((wanted) => {
      const rows = [...document.querySelectorAll('remy-task-list *')].filter((el) => (el.textContent || '').trim() === wanted);
      const target = rows[0];
      if (!target) return false;
      (target.closest('button, a, [role="button"], .goal-card') || target).click();
      return true;
    }, title);
    if (!clicked) throw new Error(`task "${title}" not found`);
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const labels = await page.evaluate(() => [...document.querySelectorAll('.processing-state-text')]
      .map((el) => `${el.className.replace(/\s+/g, '.')} => ${(el.textContent || '').trim().slice(0, 100)}`));
    console.log(JSON.stringify({ url: page.url(), labels }, null, 2));
    await page.screenshot({ path: out });
    console.log('screenshot', out);
  } finally {
    await page.close();
    browser.disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
