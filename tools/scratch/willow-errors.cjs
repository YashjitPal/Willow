/**
 * Reports why the Willow tab might be blank: the Vite error overlay's message, the size of
 * the app root, and console errors seen over a reload.
 *
 *   node tools/scratch/willow-errors.cjs [--reload]
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text().slice(0, 400)}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${String(error.message || error).slice(0, 600)}`));
  if (process.argv.includes('--reload')) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 9000));
  }
  const facts = await page.evaluate(() => {
    const overlay = document.querySelector('vite-error-overlay');
    const message = overlay?.shadowRoot?.querySelector('.message-body')?.textContent
      || overlay?.shadowRoot?.textContent || '';
    const root = document.getElementById('root');
    return {
      url: location.href,
      overlay: message.slice(0, 1500),
      rootChildren: root?.children.length ?? -1,
      rootText: (root?.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    };
  });
  console.log(JSON.stringify(facts, null, 1));
  console.log(errors.slice(0, 20).join('\n'));
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
