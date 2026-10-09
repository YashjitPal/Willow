/** Willow: opens Gem editor knowledge "+" → Notebooks, measures the dialog, screenshots, Escape. */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const willow = (await browser.pages()).find((p) => (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')));
  await willow.bringToFront();
  const trigger = await willow.$('.gem-editor-upload');
  const tr = await trigger.boundingBox();
  await willow.mouse.click(tr.x + tr.width / 2, tr.y + tr.height / 2);
  await new Promise((r) => setTimeout(r, 500));
  const row = await willow.evaluateHandle(() => [...document.querySelectorAll('.gems-menu .gems-menu-item')].find((b) => /Notebooks/.test(b.textContent)));
  const rr = await row.boundingBox();
  await willow.mouse.click(rr.x + rr.width / 2, rr.y + rr.height / 2);
  await new Promise((r) => setTimeout(r, 700));
  await willow.mouse.move(5, 5);
  console.log(await willow.evaluate(() => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return `${sel}: none`;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return `${sel} [${[b.x, b.y, b.width, b.height].map(r1)}] ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color} bg ${cs.backgroundColor}`;
    };
    return [
      '.gem-nb-dialog', '.gem-nb-dialog-header', '.gem-nb-dialog-title > .luminous-symbols', '.gem-nb-dialog-title h2',
      '.gem-nb-dialog-close', '.gem-nb-dialog-content', '.gem-nb-dialog-section', '.gem-nb-dialog-row',
      '.gem-nb-dialog-chip', '.gem-nb-dialog-content-row', '.gem-nb-dialog-name', '.gem-nb-dialog-meta',
      '.gem-nb-dialog-empty', '.gem-nb-dialog-actions', '.gem-nb-dialog-add',
    ].map(box).join('\n') + `\nrows ${document.querySelectorAll('.gem-nb-dialog-row').length}`;
  }));
  const dialog = await willow.$('.gem-nb-dialog');
  const db = dialog && await dialog.boundingBox();
  if (db) await willow.screenshot({ path: `${process.env.TEMP}/w-add-notebook.png`, clip: { x: db.x - 8, y: db.y - 8, width: db.width + 16, height: db.height + 16 } });
  await willow.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  console.log('closed:', await willow.evaluate(() => !document.querySelector('.gem-nb-dialog')), 'editor:', await willow.evaluate(() => !!document.querySelector('.gem-editor')));
  browser.disconnect();
})();
