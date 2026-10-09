/**
 * Willow (Gems tab): routes to /gem/storybook to check the unknown-Gem redirect, then
 * measures the premade row on /gems — the scroller's box, the first and last cards at
 * rest and with the row scrolled to its end — and lists the premade names in order.
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  const go = async (to) => {
    await page.evaluate((path) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, to);
    await new Promise((r) => setTimeout(r, 1500));
  };
  await go('/');
  await go('/gem/storybook');
  console.log('after /gem/storybook ->', new URL(page.url()).pathname);
  if (!page.url().endsWith('/gems')) await go('/gems');
  console.log(await page.evaluate(async () => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const row = document.querySelector('.gems-premade-cards');
    const cards = [...document.querySelectorAll('.gems-card')];
    const box = (el) => { const b = el.getBoundingClientRect(); return `[${[b.x, b.y, b.width, b.height].map(r1)}]`; };
    const names = cards.map((c) => c.querySelector('.gems-card-name')?.textContent).join(', ');
    const rest = `row ${box(row)} scrollW ${row.scrollWidth} clientW ${row.clientWidth}; first ${box(cards[0])}; last ${box(cards.at(-1))}; title x ${r1(document.querySelector('.gems-title').getBoundingClientRect().x)}`;
    row.scrollLeft = row.scrollWidth;
    await new Promise((r) => setTimeout(r, 200));
    const end = `scrolled ${row.scrollLeft}: first ${box(cards[0])}; last ${box(cards.at(-1))}; viewport ${innerWidth}`;
    row.scrollLeft = 0;
    return `names: ${names}\n${rest}\n${end}`;
  }));
  browser.disconnect();
})();
