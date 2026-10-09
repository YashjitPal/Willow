/**
 * Greps the CSS rules loaded in a tab for a selector fragment, including rules inside
 * @media blocks (printed with their condition). Read-only; for components that cannot be
 * triggered safely, such as a snackbar that only appears after a destructive action.
 *
 *   node tools/scratch/sheet-rules.cjs gemini|willow "<regex on selectorText>" [maxRules=40]
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const [which = 'gemini', pattern = 'snack', maxArg = '40'] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  if (!page) throw new Error(`no ${which} tab`);
  const rules = await page.evaluate((src, max) => {
    const re = new RegExp(src, 'i');
    const out = [];
    const walk = (list, condition) => {
      for (const rule of list) {
        if (out.length >= max) return;
        if (rule.cssRules && rule.conditionText !== undefined) {
          walk(rule.cssRules, `${condition ? `${condition} && ` : ''}@media ${rule.conditionText}`);
        } else if (rule.selectorText && re.test(rule.selectorText)) {
          out.push(`${condition ? `[${condition}] ` : ''}${rule.selectorText.slice(0, 160)}\n    ${rule.style.cssText.slice(0, 400)}`);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules, ''); } catch { /* cross-origin sheet */ }
    }
    return out;
  }, pattern, Number(maxArg));
  console.log(rules.join('\n') || '(none)');
  browser.disconnect();
})();
