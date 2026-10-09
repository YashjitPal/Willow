/**
 * Opens Gemini's Gem editor knowledge "+" → "Gemini Notebook" dialog, dumps the CSS rules
 * of its component (selectors matching the regex) while it is mounted, then Escape.
 * Never clicks a row or Add.
 *
 *   node tools/scratch/gem-add-notebook-css.cjs "<selector regex>"
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const pattern = process.argv[2] || 'notebook';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const gemini = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  await gemini.bringToFront();
  const trigger = await gemini.$('bots-creation-window .upload-card-button');
  const tr = await trigger.boundingBox();
  await gemini.mouse.click(tr.x + tr.width / 2, tr.y + tr.height / 2);
  await new Promise((r) => setTimeout(r, 800));
  const row = await gemini.evaluateHandle(() => [...document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="menuitem"]')].find((b) => /Gemini Notebook/.test(b.textContent)));
  const rr = await row.boundingBox();
  await gemini.mouse.click(rr.x + rr.width / 2, rr.y + rr.height / 2);
  await new Promise((r) => setTimeout(r, 1500));
  await gemini.mouse.move(5, 5);
  console.log(await gemini.evaluate((source) => {
    const re = new RegExp(source);
    const hits = [];
    const visit = (rules, media) => {
      for (const rule of rules) {
        if (rule.cssRules && !rule.selectorText) { visit(rule.cssRules, rule.conditionText || media); continue; }
        if (rule.selectorText && re.test(rule.selectorText)) hits.push(`${media ? `@media ${media} ` : ''}${rule.selectorText.replace(/\[_ng(content|host)-[^\]]+\]/g, '')} { ${rule.style.cssText} }`);
      }
    };
    for (const sheet of document.styleSheets) { try { visit(sheet.cssRules, ''); } catch { /* cross-origin */ } }
    return hits.join('\n') || 'no rules';
  }, pattern));
  for (let i = 0; i < 2; i++) {
    await gemini.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log('open panes after Escape:', await gemini.evaluate(() => [...document.querySelectorAll('.cdk-overlay-pane')].filter((p) => p.getBoundingClientRect().width > 0).length));
  browser.disconnect();
})();
