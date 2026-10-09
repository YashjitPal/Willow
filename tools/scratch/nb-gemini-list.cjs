/**
 * Read-only: every notebook card on Gemini's /notebooks/view grid, in order — emoji, title,
 * source count, and whether it shows the pin — as JSON for nb-seed.cjs to mirror.
 *
 *   node tools/scratch/nb-gemini-list.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  const out = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('project-card, .project-card, [class*="project-card"]')]
      .filter((el, _, all) => !all.some((other) => other !== el && other.contains(el)));
    return cards.map((card) => {
      const texts = [...card.querySelectorAll('*')]
        .filter((el) => el.childElementCount === 0 && el.textContent.trim())
        .map((el) => el.textContent.trim());
      const icons = [...card.querySelectorAll('mat-icon')].map((icon) => icon.getAttribute('fonticon') || icon.textContent.trim());
      const words = texts.filter((t) => !icons.includes(t));
      const sources = words.find((t) => /^\d+ sources?$/.test(t)) || '';
      const emoji = words[0];
      const title = words.find((t) => t !== emoji && t !== sources) || '';
      return { emoji, title, sources: Number(sources.split(' ')[0] || 0), pinned: icons.includes('push_pin') };
    });
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
