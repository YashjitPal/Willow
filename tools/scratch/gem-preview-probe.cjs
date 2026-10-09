/** Read-only: the Gem editor preview's zero state and composer buttons, Gemini vs Willow. */
const puppeteer = require('puppeteer-core');

const describe = (el) => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  let opacity = 1;
  for (let n = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter((c) => !c.startsWith('ng-')).slice(0, 4).join('.') : '';
  return `${el.tagName.toLowerCase()}.${cls} [${[r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10)}] ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color} bg ${cs.backgroundColor} eff-opacity ${Math.round(opacity * 100) / 100} fvs ${cs.fontVariationSettings} ${el.children.length ? '' : JSON.stringify(el.textContent.trim().slice(0, 40))}`;
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const pages = await browser.pages();
  const gemini = pages.find((p) => p.url().startsWith('https://gemini.google.com'));
  const willow = pages.find((p) => (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')));

  console.log('GEMINI');
  console.log(await gemini.evaluate((fn) => {
    const describe = new Function(`return (${fn})`)();
    const area = document.querySelector('bots-creation-window .preview-container');
    const pick = [...area.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      return /bot-logo|bot-name|bot-info|zero-state|send-button|submit|mic|speech|disclaimer|chat-history|infinite-scroller/.test(String(el.className)) || el.tagName === 'BUTTON';
    });
    return pick.map(describe).join('\n');
  }, describe.toString()));

  console.log('WILLOW');
  console.log(await willow.evaluate((fn) => {
    const describe = new Function(`return (${fn})`)();
    const area = document.querySelector('.gem-editor-preview-box');
    const pick = [...area.querySelectorAll('.gem-zero-info, .gem-logo, .gem-zero-name-text, .gem-editor-preview-placeholder, button')];
    return `scrollX ${window.scrollX} doc scrollLeft ${document.scrollingElement.scrollLeft}\n${pick.map(describe).join('\n')}`;
  }, describe.toString()));
  browser.disconnect();
})();
