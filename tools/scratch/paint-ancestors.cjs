/*
 * Walks up from the first visible match of a selector and prints each ancestor's box with
 * whatever it paints — background, radius, border, shadow, opacity, transform — including
 * ::before/::after, so you can find which element actually draws a visible shape.
 *
 *   node tools/scratch/paint-ancestors.cjs gemini|willow "<selector>" [levels=6]
 */
const puppeteer = require('puppeteer-core');

const URLS = { gemini: 'https://gemini.google.com/', willow: 'http://localhost:3000' };

(async () => {
  const [app, selector, levelsArg = '6'] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(URLS[app]));
  const out = await page.evaluate((sel, levels) => {
    const r2 = (n) => Math.round(n * 10) / 10;
    const start = [...document.querySelectorAll(sel)].find((el) => el.getBoundingClientRect().width > 0);
    if (!start) return `no visible ${sel}`;
    const paint = (cs) => {
      const parts = [];
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') parts.push(`bg ${cs.backgroundColor}`);
      if (cs.backgroundImage !== 'none') parts.push(`img ${cs.backgroundImage.slice(0, 60)}`);
      if (cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none') parts.push(`border ${cs.borderTopWidth} ${cs.borderTopColor}`);
      if (cs.boxShadow !== 'none') parts.push(`shadow ${cs.boxShadow.slice(0, 50)}`);
      if (cs.opacity !== '1') parts.push(`op ${cs.opacity}`);
      if (cs.transform !== 'none') parts.push(`tf ${cs.transform}`);
      if (cs.borderRadius !== '0px') parts.push(`r ${cs.borderRadius}`);
      return parts.join(' | ');
    };
    const lines = [];
    let el = start;
    for (let i = 0; el && i <= levels; i += 1, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      lines.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} [${[r.x, r.y, r.width, r.height].map(r2)}] ${paint(getComputedStyle(el))}`);
      for (const pseudo of ['::before', '::after']) {
        const pcs = getComputedStyle(el, pseudo);
        if (pcs.content && pcs.content !== 'none' && paint(pcs)) lines.push(`   ${pseudo} ${paint(pcs)} size ${pcs.width}x${pcs.height}`);
      }
    }
    return lines.join('\n');
  }, selector, Number(levelsArg));
  console.log(out);
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
