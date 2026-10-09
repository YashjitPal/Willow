/**
 * Narrow-width Gems manager probe: scrolls Gemini's page so its "Gem manager" heading is at
 * the top, screenshots both apps, and prints the key boxes (title, sections, cards, rows,
 * New Gem, top bar) for each. Read-only (scrolling only).
 *
 *   node tools/scratch/gems-manager-narrow.cjs [--name=prefix]
 */
const puppeteer = require('puppeteer-core');

const nameArg = process.argv.find((a) => a.startsWith('--name='));
const NAME = nameArg ? nameArg.slice(7) : 'narrow';

const SPECS = {
  g: {
    title: 'all-bots .gem-manager-title, all-bots h1, .gems-manager-title',
    premadeHeader: 'all-bots .premade-bots-header, all-bots .section-header',
    card: 'all-bots premade-bot-card, all-bots .premade-bot-card, all-bots bot-card',
    myHeader: 'all-bots .list-header',
    row: 'all-bots bot-list-row .bot-list-row-container',
    newGem: 'all-bots .create-bot-button, all-bots button.new-gem-button',
    topBar: 'top-bar-actions, .top-bar, mat-toolbar, .mobile-top-bar',
  },
  w: {
    title: '.gems-title',
    premadeHeader: '.gems-section-header',
    card: '.gems-card',
    myHeader: '.gems-list-header',
    row: '.gems-row',
    newGem: '.gems-new-button',
    topBar: '.gems-topbar, .nb-topbar',
  },
};

const probe = (spec) => {
  const r1 = (n) => Math.round(n * 10) / 10;
  const out = {};
  for (const [key, sel] of Object.entries(spec)) {
    const els = [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0);
    const el = els[0];
    if (!el) { out[key] = 'none'; continue; }
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[key] = `n=${els.length} [${[b.x, b.y, b.width, b.height].map(r1)}] ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight}${els[1] ? ` second [${[els[1].getBoundingClientRect().x, els[1].getBoundingClientRect().y].map(r1)}]` : ''}`;
  }
  return out;
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const pages = await browser.pages();
  const gemini = pages.find((p) => p.url().startsWith('https://gemini.google.com'));
  const willow = pages.find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await gemini.bringToFront();
  await gemini.evaluate(() => {
    const heading = [...document.querySelectorAll('h1, h2, div, span')].find((el) => el.children.length === 0 && el.textContent.trim() === 'Gem manager');
    heading?.scrollIntoView({ block: 'start' });
  });
  await new Promise((r) => setTimeout(r, 900));
  await gemini.screenshot({ path: `${process.env.TEMP}/${NAME}-g.png` });
  const g = await gemini.evaluate(probe, SPECS.g);
  const gTitle = await gemini.evaluate(() => {
    const heading = [...document.querySelectorAll('h1, h2, div, span')].find((el) => el.children.length === 0 && el.textContent.trim() === 'Gem manager');
    if (!heading) return 'none';
    const b = heading.getBoundingClientRect();
    const cs = getComputedStyle(heading);
    return `${heading.tagName.toLowerCase()}.${heading.className} [${[b.x, b.y, b.width, b.height].map((n) => Math.round(n * 10) / 10)}] ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight}`;
  });
  await willow.bringToFront();
  await new Promise((r) => setTimeout(r, 900));
  await willow.screenshot({ path: `${process.env.TEMP}/${NAME}-w.png` });
  const w = await willow.evaluate(probe, SPECS.w);
  console.log('Gemini "Gem manager" heading:', gTitle);
  for (const key of Object.keys(SPECS.g)) {
    console.log(key);
    console.log(`  G ${g[key]}`);
    console.log(`  W ${w[key]}`);
  }
  browser.disconnect();
})();
