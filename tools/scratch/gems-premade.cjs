/**
 * Reads Gemini's premade Gem cards off /gems/view: title, full description, link, logo
 * (ligature name and font, or the inline svg's markup), logo colours and the Experiment
 * badge. Read-only. Prints JSON.
 *
 *   node tools/scratch/gems-premade.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  if (!page) throw new Error('no gemini tab');
  const cards = await page.evaluate(() => [...document.querySelectorAll('template-gallery-card.premade-gems-card')].map((card) => {
    const link = card.querySelector('a.template-gallery-card');
    const logo = card.querySelector('.bot-logo-text');
    const icon = logo?.querySelector('mat-icon');
    const svg = icon?.querySelector('svg');
    const cs = logo ? getComputedStyle(logo) : null;
    const ics = icon ? getComputedStyle(icon) : null;
    return {
      title: card.querySelector('.template-gallery-card-title')?.textContent.trim(),
      description: card.querySelector('.template-gallery-card-content')?.textContent.trim(),
      href: link?.getAttribute('href'),
      experiment: !!card.querySelector('xap-status-badge'),
      logoBg: cs?.backgroundColor,
      logoColor: ics?.color,
      iconFont: ics?.fontFamily,
      iconName: svg ? null : (icon?.getAttribute('fonticon') || icon?.textContent.trim()),
      iconFvs: ics?.fontVariationSettings,
      iconWeight: ics?.fontWeight,
      iconSize: ics?.fontSize,
      svg: svg ? svg.outerHTML.slice(0, 1600) : null,
    };
  }));
  console.log(JSON.stringify(cards, null, 2));
  browser.disconnect();
})();
