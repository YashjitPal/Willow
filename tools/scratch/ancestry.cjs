/**
 * The ancestor chain of the first visible leaf whose text equals the given string: box,
 * padding, margin, transform, animation and opacity per level.
 *
 *   node tools/scratch/ancestry.cjs gemini|willow "Exact text" [levels=10]
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const [which = 'gemini', text, levelsArg = '10'] = process.argv.slice(2);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which]));
  const out = await page.evaluate((needle, levels) => {
    const leaf = [...document.querySelectorAll('*')].find((el) => el.childElementCount === 0
      && el.textContent.trim() === needle && el.getBoundingClientRect().width > 0);
    if (!leaf) return `no visible leaf with text ${JSON.stringify(needle)}`;
    const lines = [];
    for (let n = leaf, i = 0; n && i < levels; n = n.parentElement, i += 1) {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      lines.push(`<${n.tagName.toLowerCase()} class="${String(n.className).slice(0, 70)}"> [${[r.x, r.y, r.width, r.height].map((v) => v.toFixed(1)).join(',')}] pad ${cs.padding} mar ${cs.margin} disp ${cs.display} tf ${cs.transform} anim ${cs.animationName} op ${cs.opacity} wb ${cs.wordBreak}/${cs.overflowWrap}`);
    }
    return lines.join('\n');
  }, text, Number(levelsArg));
  console.log(out);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
