/**
 * Types a neutral Gem name into the editor's name field of Gemini and Willow and blurs it,
 * which turns the preview on. Never presses Enter and never saves; pass --clear to empty
 * both fields again. Then prints the preview subtree of each (boxes, type) to compare.
 *
 *   node tools/scratch/gem-editor-named.cjs [--name="Test Gem"] [--clear] [--tree-only]
 */
const puppeteer = require('puppeteer-core');

const nameArg = process.argv.find((a) => a.startsWith('--name='));
const NAME = nameArg ? nameArg.slice(7) : 'Test Gem';
const clear = process.argv.includes('--clear');
const treeOnly = process.argv.includes('--tree-only');

async function setName(page, selector, value) {
  await page.bringToFront();
  const input = await page.waitForSelector(selector, { timeout: 15000 });
  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  if (value) await page.keyboard.type(value, { delay: 25 });
  await page.evaluate((sel) => document.querySelector(sel).blur(), selector);
  await new Promise((r) => setTimeout(r, 1200));
}

const tree = (selector) => {
  const root = document.querySelector(selector);
  if (!root) return `${selector}: none`;
  const out = [];
  const walk = (el, depth) => {
    if (depth > 9 || out.length > 120) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const cs = getComputedStyle(el);
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter((c) => !c.startsWith('ng-')).slice(0, 3).join('.') : '';
    const text = el.children.length ? '' : ` "${el.textContent.trim().slice(0, 50)}"`;
    const paint = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? ` bg ${cs.backgroundColor}` : '';
    out.push(`${' '.repeat(depth * 2)}${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} [${[r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10)}] ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ${cs.color}${paint} r ${cs.borderRadius}${text}`);
    [...el.children].forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  return out.join('\n');
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const pages = await browser.pages();
  const gemini = pages.find((p) => p.url().startsWith('https://gemini.google.com'));
  const willow = pages.find((p) => (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')));
  if (!treeOnly) {
    await setName(gemini, 'bots-creation-window .name-input-container input', clear ? '' : NAME);
    await setName(willow, '.gem-editor-field input', clear ? '' : NAME);
  }
  if (!clear) {
    console.log('GEMINI preview');
    console.log(await gemini.evaluate(tree, 'bots-creation-window .preview-area'));
    console.log('WILLOW preview');
    console.log(await willow.evaluate(tree, '.gem-editor-preview'));
  }
  browser.disconnect();
})();
