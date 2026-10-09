/**
 * Gemini, narrow widths: opens the last response's overflow menu with a real touch, prints
 * the menu's item labels (UI labels only), and with --open taps "Show thinking" and leaves
 * whatever it opens on screen for measuring. Screenshot goes to %TEMP%/thinking-<label>.png.
 * Never prints the conversation's text.
 *
 *   node tools/scratch/thinking-open.cjs [--href=/app/<id>] [--open] [--label=name] [--response=-1]
 */
const http = require('http');
const puppeteer = require('puppeteer-core');

const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const href = flag('href', '');
const label = flag('label', 'gemini');
const responseIndex = Number(flag('response', '-1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});

(async () => {
  const status = await getJson('http://127.0.0.1:9339/status');
  const scale = status?.scale || 1;
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90000 });
  const gemini = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  await gemini.bringToFront();
  if (href && !gemini.url().endsWith(href)) {
    await gemini.goto(`https://gemini.google.com${href}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    for (let i = 0; i < 20 && !(await gemini.evaluate(() => document.querySelectorAll('model-response message-actions').length)); i++) await sleep(500);
    await sleep(800);
  }
  const cdp = await gemini.createCDPSession();
  const tap = async (pt) => {
    const point = { x: pt.x * scale, y: pt.y * scale };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const more = await gemini.evaluate(async (idx) => {
    const responses = [...document.querySelectorAll('model-response')];
    const response = responses.at(idx);
    if (!response) return null;
    const buttons = [...response.querySelectorAll('message-actions button, .actions-container button, button')];
    const b = buttons.find((x) => /more/i.test(x.getAttribute('aria-label') || '') || x.getAttribute('data-test-id') === 'more-menu-button');
    if (!b) return { labels: buttons.map((x) => x.getAttribute('aria-label')).filter(Boolean) };
    b.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 400));
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, aria: b.getAttribute('aria-label'), box: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10) };
  }, responseIndex);
  if (!more || more.x === undefined) { console.log('no more button', JSON.stringify(more)); await cdp.detach(); browser.disconnect(); return; }
  console.log('more button', more.aria, JSON.stringify(more.box));
  await tap(more);
  await sleep(900);
  const items = await gemini.evaluate(() => [...document.querySelectorAll('.cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane button, gem-menu [role="menuitem"]')]
    .filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40), x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }));
  console.log('menu items:', items.map((i) => i.text).join(' | '));
  const thinking = items.find((i) => /thinking/i.test(i.text));
  if (process.argv.includes('--open') && thinking) {
    await tap(thinking);
    await sleep(1500);
    console.log('opened', thinking.text);
  } else if (!process.argv.includes('--open')) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(`${process.env.TEMP}/thinking-${label}.png`, Buffer.from(shot.data, 'base64'));
  await cdp.detach();
  browser.disconnect();
})();
