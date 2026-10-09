/** Gemini at the current (narrow) size: the premade cards row's scroll container and the top bar. Read-only. */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const gemini = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  console.log(await gemini.evaluate(() => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const box = (el) => { const b = el.getBoundingClientRect(); return `[${[b.x, b.y, b.width, b.height].map(r1)}]`; };
    const label = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).filter((c) => !c.startsWith('ng-')).slice(0, 3).join('.')}` : ''}`;
    const out = [];
    const chess = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === 'Chess champ');
    if (chess) {
      let card = chess;
      for (let i = 0; i < 12 && card; i++) {
        const cs = getComputedStyle(card);
        if (/auto|scroll|hidden/.test(cs.overflowX) || cs.display === 'grid' || (cs.display === 'flex' && card.children.length > 3)) {
          out.push(`${label(card)} ${box(card)} display ${cs.display} overflowX ${cs.overflowX} scrollW ${card.scrollWidth} clientW ${card.clientWidth} gap ${cs.gap} pad ${cs.padding} margin ${cs.margin} snap ${cs.scrollSnapType} wrap ${cs.flexWrap} cols ${cs.gridTemplateColumns} height ${cs.height}`);
        }
        card = card.parentElement;
      }
      const cards = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && ['Chess champ', 'Career guide', 'Storybook', 'Learning coach'].includes(el.textContent.trim()));
      out.push(`card titles at x: ${cards.map((el) => r1(el.getBoundingClientRect().x)).join(', ')}`);
    }
    const premadeHeader = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === 'Premade by Google');
    if (premadeHeader) {
      const row = premadeHeader.parentElement;
      out.push(`premade header ${label(premadeHeader)} ${box(premadeHeader)} ${getComputedStyle(premadeHeader).fontSize}/${getComputedStyle(premadeHeader).lineHeight}; parent ${label(row)} ${box(row)} text "${row.innerText.replace(/\n/g, ' | ').slice(0, 80)}"`);
      const showMore = [...document.querySelectorAll('button')].find((b) => /Show (more|less)/.test(b.textContent));
      out.push(`show more button: ${showMore ? `${box(showMore)} display ${getComputedStyle(showMore).display}` : 'none'}`);
    }
    const bar = document.querySelector('top-bar-actions')?.closest('div[class*="top-bar"], .top-bar-container, header, mat-toolbar') || document.querySelector('top-bar-actions')?.parentElement;
    if (bar) {
      out.push(`top bar ${label(bar)} ${box(bar)} bg ${getComputedStyle(bar).backgroundColor} position ${getComputedStyle(bar).position}`);
      for (const el of bar.querySelectorAll('button, a, [data-test-id="bard-text"], .bard-text, .logo, span.gds-title-l, .gemini-logo')) {
        const b = el.getBoundingClientRect();
        if (!b.width) continue;
        const cs = getComputedStyle(el);
        out.push(`  ${label(el)} ${box(el)} ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color} aria ${el.getAttribute('aria-label') || ''} text "${el.innerText.trim().slice(0, 20)}"`);
      }
    }
    return out.join('\n');
  }));
  browser.disconnect();
})();
