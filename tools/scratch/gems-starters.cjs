/**
 * Visits each premade Gem's page in the Gemini tab and records its zero state: name,
 * description and the prompt-suggestion cards. Navigation only; nothing is sent.
 *
 *   node tools/scratch/gems-starters.cjs [slug ...]
 */
const puppeteer = require('puppeteer-core');

const SLUGS = ['chess-champ', 'career-guide', 'storybook', 'learning-coach', 'brainstormer', 'coding-partner', 'writing-editor', 'productivity-helper'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : SLUGS;
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60_000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  if (!page) throw new Error('no gemini tab');
  await page.bringToFront();
  const out = {};
  for (const slug of slugs) {
    await page.goto(`https://gemini.google.com/gem/${slug}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    let data = null;
    for (let i = 0; i < 20 && !data; i += 1) {
      await sleep(500);
      data = await page.evaluate(() => {
        const card = document.querySelector('bot-info-card');
        const cards = [...document.querySelectorAll('bot-info-card .prompt-text')];
        if (!card || !cards.length) return null;
        return {
          name: card.querySelector('.bot-name-container')?.textContent.trim(),
          description: card.querySelector('.bot-description')?.textContent.trim(),
          descriptionCollapsed: !!card.querySelector('.bot-description.collapsed'),
          starters: cards.map((p) => p.textContent.trim()),
          hasShowMore: !!card.querySelector('.bot-description-container button'),
        };
      });
    }
    out[slug] = data ?? 'no zero state';
  }
  console.log(JSON.stringify(out, null, 2));
  browser.disconnect();
})();
