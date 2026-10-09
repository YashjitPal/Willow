/**
 * Willow /memory: opens the Add dialog (never submits), scans for sideways scrolling or
 * anything past the screen edge, then closes it with Escape. Prints UI structure only.
 *
 *   node tools/scratch/memory-dialog-scan.cjs [--label=phone]
 */
const http = require('http');
const puppeteer = require('puppeteer-core');

const LABEL = (process.argv.find((a) => a.startsWith('--label=')) || '--label=memory').slice(8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});

(async () => {
  const scale = (await getJson('http://127.0.0.1:9339/status'))?.scale || 1;
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  if (new URL(page.url()).pathname !== '/memory') {
    await page.evaluate(() => { history.pushState({}, '', '/memory'); dispatchEvent(new PopStateEvent('popstate')); });
  }
  for (let i = 0; i < 30 && !(await page.evaluate(() => !!document.querySelector('.mem-button-filled'))); i++) await sleep(250);
  const cdp = await page.createCDPSession();
  const pt = await page.evaluate(() => {
    const b = document.querySelector('.mem-button-filled').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x * scale, y: pt.y * scale }] });
  await sleep(50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(800);
  const result = await page.evaluate(() => {
    const W = innerWidth;
    const dialog = document.querySelector('.mem-dialog');
    if (!dialog) return 'no dialog';
    const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`;
    const out = [];
    for (const el of [dialog, ...dialog.querySelectorAll('*')]) {
      const b = el.getBoundingClientRect();
      if (b.width && (b.right > W + 0.5 || b.left < -0.5)) out.push(`past edge: ${name(el)} [${Math.round(b.left)}..${Math.round(b.right)}]`);
      const cs = getComputedStyle(el);
      if (/auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`scrolls sideways: ${name(el)}`);
    }
    const d = dialog.getBoundingClientRect();
    return `dialog [${[d.x, d.y, d.width, d.height].map(Math.round)}] ${out.length ? out.slice(0, 6).join(' | ') : 'fits'}`;
  });
  console.log(`[${LABEL}] memory add dialog @${await page.evaluate(() => innerWidth)}px: ${result}`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(500);
  console.log(`[${LABEL}] dialog closed: ${await page.evaluate(() => !document.querySelector('.mem-dialog'))}`);
  await cdp.detach();
  browser.disconnect();
})();
