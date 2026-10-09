/** Read-only: Gemini's Gem editor legal line, tool-select arrow and field placeholders vs Willow's. */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const pages = await browser.pages();
  const gemini = pages.find((p) => p.url().startsWith('https://gemini.google.com'));
  const willow = pages.find((p) => (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')));

  console.log(await gemini.evaluate(() => {
    const legal = document.querySelector('bots-creation-window .legal-consent');
    const icon = legal.querySelector('mat-icon');
    const link = legal.querySelector('a');
    const lc = getComputedStyle(link);
    const arrow = document.querySelector('bots-creation-window .input-area-switch mat-icon');
    const ac = getComputedStyle(arrow);
    return [
      `legal text: ${JSON.stringify(legal.innerText)}`,
      `legal html: ${legal.innerHTML.replace(/<!--.*?-->/g, '').replace(/ _ngcontent[^=]*="[^"]*"/g, '').slice(0, 900)}`,
      `link: deco ${lc.textDecorationLine} ${lc.textDecorationThickness} offset ${lc.textUnderlineOffset} color ${lc.color} weight ${lc.fontWeight}`,
      `legal icon: ${icon.getAttribute('fonticon')} margin ${getComputedStyle(icon).margin} va ${getComputedStyle(icon).verticalAlign}`,
      `legal: display ${getComputedStyle(legal).display} align ${getComputedStyle(legal).textAlign} width ${getComputedStyle(legal).width} margin ${getComputedStyle(legal).margin}`,
      `arrow: ${arrow.getAttribute('fonticon')} ${arrow.className} | ${ac.fontFamily} ${ac.fontSize} w${ac.fontWeight} box ${ac.width}x${ac.height} lh ${ac.lineHeight} margin ${ac.margin} overflow ${ac.overflow}`,
    ].join('\n');
  }));

  const placeholders = (selectors) => selectors.map((s) => {
    const el = document.querySelector(s);
    if (!el) return `${s}: none`;
    const c = getComputedStyle(el, '::placeholder');
    return `${s}: ${JSON.stringify(el.placeholder || el.getAttribute('data-placeholder') || '')} color ${c.color} opacity ${c.opacity}`;
  }).join('\n');
  console.log('G');
  console.log(await gemini.evaluate(placeholders, [
    'bots-creation-window .name-input-container input',
    'bots-creation-window .description-input-container textarea',
    'bots-creation-window .instructions-input-container textarea',
  ]));
  console.log('W');
  console.log(await willow.evaluate(placeholders, [
    '.gem-editor-field input',
    '.gem-editor-field.is-textarea textarea',
    '.gem-editor-instructions textarea',
  ]));
  browser.disconnect();
})();
