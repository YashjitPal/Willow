// Reloads the headless Willow tab, sends nothing, then runs w-thread's injection while logging
// page errors and console errors, to see what a stub conversation breaks.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

(async () => {
  const id = fs.readFileSync(path.join(__dirname, '../ui-research/scrapers/gemini/media-tools-2026/.w-media-tab'), 'utf8').trim();
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
  try {
    const target = browser.targets().find((t) => t.type() === 'page' && (t._targetId || t._getTargetInfo().targetId) === id);
    const page = await target.page();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 9000));
    const before = errors.length;
    const info = await page.evaluate(() => {
      const hostEl = document.querySelector('.willow-gemini-composer');
      const fiberKey = Object.keys(hostEl).find((k) => k.startsWith('__reactFiber$'));
      let fiber = hostEl[fiberKey];
      const found = [];
      while (fiber) {
        let hook = fiber.memoizedState; let i = 0;
        while (hook && typeof hook === 'object' && 'next' in hook) {
          const v = hook.memoizedState;
          if (Array.isArray(v) && hook.queue && typeof hook.queue.dispatch === 'function') {
            found.push(`${typeof fiber.type === 'function' ? fiber.type.name || 'anon' : fiber.type} hook#${i} len=${v.length} first=${v[0] ? Object.keys(v[0]).slice(0, 6).join(',') : '-'}`);
          }
          hook = hook.next; i += 1;
        }
        fiber = fiber.return;
      }
      return found.slice(0, 40);
    });
    console.log(info.join('\n'));
    console.log(errors.slice(before).join('\n') || 'no errors');
  } finally { browser.disconnect(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
