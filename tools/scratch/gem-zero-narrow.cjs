/** Gemini gem chat zero state at the current size: ancestors of the Gem name with boxes and alignment. Read-only. */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const gemini = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  console.log(await gemini.evaluate(() => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const name = [...document.querySelectorAll('[class*="bot-name"]')].find((el) => el.getBoundingClientRect().height > 20);
    if (!name) return 'no name';
    const out = [];
    let el = name;
    for (let i = 0; i < 9 && el; i++, el = el.parentElement) {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).filter((c) => !c.startsWith('ng-')).slice(0, 3).join('.')} [${[b.x, b.y, b.width, b.height].map(r1)}] display ${cs.display} align ${cs.alignItems} justify ${cs.justifyContent} text-align ${cs.textAlign} pad ${cs.padding} margin ${cs.margin}`);
    }
    const desc = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^Find inspiration easily/.test(e.textContent.trim()));
    if (desc) {
      const b = desc.getBoundingClientRect();
      const cs = getComputedStyle(desc);
      out.push(`desc ${desc.tagName.toLowerCase()}.${desc.className} [${[b.x, b.y, b.width, b.height].map(r1)}] text-align ${cs.textAlign} ${cs.fontSize}/${cs.lineHeight}`);
    }
    const logo = document.querySelector('.bot-logo-text, bot-logo');
    if (logo) { const b = logo.getBoundingClientRect(); out.push(`logo ${logo.className} [${[b.x, b.y, b.width, b.height].map(r1)}]`); }
    const cards = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /^Affordable and creative/.test(e.textContent.trim()));
    for (const c of cards) {
      let card = c;
      for (let i = 0; i < 3; i++) card = card.parentElement;
      const b = c.getBoundingClientRect();
      const cb = card.getBoundingClientRect();
      out.push(`card text [${[b.x, b.y, b.width, b.height].map(r1)}] container ${card.className} [${[cb.x, cb.y, cb.width, cb.height].map(r1)}]`);
    }
    return out.join('\n');
  }));
  browser.disconnect();
})();
