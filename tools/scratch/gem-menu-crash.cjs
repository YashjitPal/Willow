/** Reproduces a crash on Willow's Gem editor: reload /gems/create, name it, open the tool menu. */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const willow = (await browser.pages()).find((p) => (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')));
  const errors = [];
  willow.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
  willow.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 600)}`); });
  await willow.bringToFront();
  await willow.goto('http://localhost:3000/gems/create', { waitUntil: 'domcontentloaded' });
  await willow.waitForSelector('.gem-editor-field input', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  if (process.argv.includes('--named')) {
    await willow.click('.gem-editor-field input');
    await willow.keyboard.type('Test Gem', { delay: 20 });
    await willow.evaluate(() => document.querySelector('.gem-editor-field input').blur());
    await new Promise((r) => setTimeout(r, 800));
  }
  const el = await willow.$('.gem-editor-select');
  const r = await el.boundingBox();
  await willow.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  await new Promise((res) => setTimeout(res, 800));
  console.log('menu', await willow.evaluate(() => {
    const m = document.querySelector('.gems-menu');
    return m ? JSON.stringify(m.getBoundingClientRect()) : 'none';
  }), 'editor', await willow.evaluate(() => !!document.querySelector('.gem-editor')));
  console.log(errors.join('\n\n') || 'no errors');
  browser.disconnect();
})();
