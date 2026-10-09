/**
 * Read-only: opens a finished Gemini Spark task's remote browser on the desktop in a
 * tab of its own and screenshots it at intervals, logging the side panel's styles.
 *
 *   node tools/scratch/gemini-rb-open-debug.cjs "<task title>" <out-prefix>
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const title = process.argv[2] || 'Alan Turing Biographical Research';
  const prefix = process.argv[3] || 'tools/ui-research/captures/spark/134-remote-browser/open-debug';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  try {
    await page.bringToFront();
    await page.goto('https://gemini.google.com/spark/tasks', { waitUntil: 'networkidle2', timeout: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await page.evaluate((wanted) => {
      const match = [...document.querySelectorAll('remy-task-list *')].find((el) => (el.textContent || '').trim() === wanted);
      (match?.closest('button, a, [role="button"], .goal-card') || match)?.click();
    }, title);
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const monitor = await page.evaluateHandle(() => [...document.querySelectorAll('mat-icon, .google-symbols, [fonticon], span, i')]
      .find((el) => (el.textContent || '').trim() === 'monitor' || el.getAttribute('fonticon') === 'monitor')?.closest('button'));
    const box = await monitor.asElement()?.boundingBox();
    console.log('monitor button box', JSON.stringify(box));
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const items = await page.$$('[role="menuitem"]');
    console.log('menu items', items.length);
    let target = null;
    for (const item of items) {
      const text = await item.evaluate((el) => el.textContent || '');
      if (/view remote browser/i.test(text)) target = item;
    }
    const itemBox = await target?.boundingBox();
    console.log('menu item box', JSON.stringify(itemBox));
    if (itemBox) await page.mouse.click(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2);
    const report = async (label) => {
      const info = await page.evaluate(() => {
        const host = document.querySelector('remy-side-panel');
        const inner = document.querySelector('remy-side-panel .remy-side-panel');
        const left = document.querySelector('.left-pane');
        const pick = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return `${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)} display=${cs.display} flex=${cs.flex} width=${cs.width} opacity=${cs.opacity} transition=${cs.transition.slice(0, 120)}`;
        };
        return { host: pick(host), hostClass: host?.className, inner: pick(inner), left: pick(left), split: document.querySelector('.split-pane-container')?.className };
      });
      console.log(label, JSON.stringify(info));
      await page.screenshot({ path: `${prefix}-${label}.png` });
    };
    await new Promise((resolve) => setTimeout(resolve, 150));
    await report('150ms');
    await new Promise((resolve) => setTimeout(resolve, 850));
    await report('1000ms');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await report('3000ms');
  } finally {
    await page.close();
    browser.disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
