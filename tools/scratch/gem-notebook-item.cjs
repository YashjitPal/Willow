/**
 * Gemini Gem editor: opens the knowledge "+" menu, hovers "Gemini Notebook", and if nothing
 * opens on hover, clicks it, then records the structure of what opened (role, title, box,
 * counts — not the user's notebook names) and closes everything with Escape. Never picks
 * a notebook or confirms anything.
 */
const puppeteer = require('puppeteer-core');

const snapshot = () => {
  const panes = [...document.querySelectorAll('.cdk-overlay-pane')].filter((p) => p.getBoundingClientRect().width > 0);
  return panes.map((p) => {
    const r = p.getBoundingClientRect();
    const dialog = p.querySelector('[role="dialog"], mat-dialog-container, .mat-mdc-dialog-container');
    const heading = p.querySelector('h1, h2, h3, [mat-dialog-title], .mat-mdc-dialog-title');
    const rows = p.querySelectorAll('[role="menuitem"], [role="option"], [role="listitem"], li, mat-list-option, button');
    const buttons = [...p.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()).filter(Boolean);
    return `pane [${[r.x, r.y, r.width, r.height].map((n) => Math.round(n))}] dialog=${!!dialog} heading=${JSON.stringify(heading?.textContent.trim().slice(0, 60) || '')} rows=${rows.length} buttons(first 4 labels, may include names)=${buttons.length}`;
  }).join('\n') || 'no panes';
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const gemini = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  await gemini.bringToFront();
  const trigger = await gemini.$('bots-creation-window .upload-card-button');
  const tr = await trigger.boundingBox();
  await gemini.mouse.click(tr.x + tr.width / 2, tr.y + tr.height / 2);
  await new Promise((r) => setTimeout(r, 800));
  const row = await gemini.evaluateHandle(() => [...document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="menuitem"]')].find((b) => /Gemini Notebook/.test(b.textContent)));
  const rr = await row.boundingBox();
  if (!rr) { console.log('no notebook row'); await gemini.keyboard.press('Escape'); browser.disconnect(); return; }
  await gemini.mouse.move(rr.x + rr.width / 2, rr.y + rr.height / 2);
  await new Promise((r) => setTimeout(r, 900));
  console.log('AFTER HOVER\n' + await gemini.evaluate(snapshot));
  const paneCount = await gemini.evaluate(() => [...document.querySelectorAll('.cdk-overlay-pane')].filter((p) => p.getBoundingClientRect().width > 0).length);
  if (paneCount <= 1) {
    await gemini.mouse.click(rr.x + rr.width / 2, rr.y + rr.height / 2);
    await new Promise((r) => setTimeout(r, 1500));
    console.log('AFTER CLICK\n' + await gemini.evaluate(snapshot));
    await gemini.screenshot({ path: `${process.env.TEMP}/g-notebook-item.png` });
  }
  for (let i = 0; i < 3; i++) {
    await gemini.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log('AFTER ESC\n' + await gemini.evaluate(snapshot));
  browser.disconnect();
})();
