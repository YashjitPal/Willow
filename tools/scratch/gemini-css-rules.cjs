/**
 * Read-only: prints every CSS rule on a Gemini page whose selector matches a pattern,
 * with the media or container query around it. Opens the page in a tab of its own.
 *
 *   node tools/scratch/gemini-css-rules.cjs <url> "<selector regex>" [out.txt]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const [url, pattern, out] = process.argv.slice(2);
  if (!url || !pattern) throw new Error('usage: <url> "<selector regex>" [out.txt]');
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90_000 });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const rules = await page.evaluate((source) => {
      const wanted = new RegExp(source);
      const found = [];
      const walk = (list, wrappers) => {
        for (const rule of list) {
          if (rule.cssRules && !(rule instanceof CSSStyleRule)) {
            const label = rule instanceof CSSMediaRule ? `@media ${rule.conditionText}`
              : rule.constructor.name === 'CSSContainerRule' ? `@container ${rule.conditionText}`
                : rule instanceof CSSSupportsRule ? `@supports ${rule.conditionText}`
                  : rule.constructor.name;
            walk(rule.cssRules, [...wrappers, label]);
            continue;
          }
          if (rule instanceof CSSStyleRule && wanted.test(rule.selectorText)) {
            found.push(`${wrappers.length ? `${wrappers.join(' > ')} :: ` : ''}${rule.cssText}`);
            if (rule.cssRules?.length) walk(rule.cssRules, [...wrappers, rule.selectorText]);
          }
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          walk(sheet.cssRules, []);
        } catch {
          found.push(`/* unreadable sheet ${sheet.href} */`);
        }
      }
      return found;
    }, pattern);
    const text = rules.join('\n\n');
    if (out) fs.writeFileSync(out, text);
    console.log(out ? `${rules.length} rules -> ${out}` : text);
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
