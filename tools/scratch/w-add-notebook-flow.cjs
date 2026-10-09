/** Willow: Gem editor → knowledge "+" → Notebooks → select "Test notebook C" → Add; reports the result. */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const willow = (await browser.pages()).find((p) => (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')));
  await willow.bringToFront();
  const click = async (handle) => { const b = await handle.boundingBox(); await willow.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  await click(await willow.$('.gem-editor-upload'));
  await new Promise((r) => setTimeout(r, 500));
  await click(await willow.evaluateHandle(() => [...document.querySelectorAll('.gems-menu .gems-menu-item')].find((b) => /Notebooks/.test(b.textContent))));
  await new Promise((r) => setTimeout(r, 600));
  await click(await willow.evaluateHandle(() => [...document.querySelectorAll('.gem-nb-dialog-row')].find((r) => /Test notebook C/.test(r.textContent))));
  await new Promise((r) => setTimeout(r, 300));
  await willow.mouse.move(5, 5);
  await new Promise((r) => setTimeout(r, 200));
  console.log(await willow.evaluate(() => {
    const row = document.querySelector('.gem-nb-dialog-row.is-selected');
    const check = row?.querySelector('.gem-nb-dialog-check');
    const add = document.querySelector('.gem-nb-dialog-add');
    return `selected row bg ${row ? getComputedStyle(row).backgroundColor : 'none'} aria ${row?.getAttribute('aria-selected')} check ${check ? `${JSON.stringify(check.getBoundingClientRect().toJSON())} ${getComputedStyle(check).color}` : 'none'}\ncount "${document.querySelector('.gem-nb-dialog-count')?.textContent}" add disabled=${add?.disabled} bg ${add && getComputedStyle(add).backgroundColor} color ${add && getComputedStyle(add).color}`;
  }));
  const dialog = await willow.$('.gem-nb-dialog');
  const db = await dialog.boundingBox();
  await willow.screenshot({ path: `${process.env.TEMP}/w-add-notebook-selected.png`, clip: { x: db.x, y: db.y, width: db.width, height: db.height } });
  await click(await willow.$('.gem-nb-dialog-add'));
  await new Promise((r) => setTimeout(r, 600));
  console.log(await willow.evaluate(() => {
    const tiles = [...document.querySelectorAll('.gem-editor-knowledge-box [data-attachment-id], .gem-editor-knowledge-box .gemini-attachment-card, .gem-editor-knowledge-box [class*="attachment"]')];
    return `dialog open ${!!document.querySelector('.gem-nb-dialog')} | knowledge box text: ${document.querySelector('.gem-editor-knowledge-box')?.innerText.replace(/\n/g, ' | ').slice(0, 200)} | tiles ${tiles.length}`;
  }));
  browser.disconnect();
})();
