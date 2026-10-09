/*
 * Taps an element in the Gemini or Willow tab with a real CDP touch (coordinates scaled by
 * the device emulator's window-fit factor), then screenshots the tab and lists every visible
 * overlay surface — menus, bottom sheets, dialogs — with its box and first rows.
 *
 *   node tools/scratch/touch-tap.cjs gemini|willow "<selector>" [--text=Label] [--index=0]
 *        [--hold=60] [--wait=700] [--label=name] [--escape]
 *
 * Only opens UI. Pass --escape to close the overlay again afterwards.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');

const URLS = { gemini: 'https://gemini.google.com/', willow: 'http://localhost:3000' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getJson = (url) => new Promise((resolve) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});

(async () => {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const [app, selector] = args.filter((a) => !a.startsWith('--'));
  const text = flag('text', '');
  const index = Number(flag('index', '0'));
  const hold = Number(flag('hold', '60'));
  const wait = Number(flag('wait', '700'));
  const label = flag('label', 'tap');
  const status = await getJson('http://127.0.0.1:9339/status');
  const scale = status?.scale || 1;

  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(URLS[app]) && !candidate.url().includes('/media'));
  await page.bringToFront();
  await sleep(300);
  const cdp = await page.createCDPSession();
  const center = await page.evaluate((sel, txt, idx) => {
    const visible = [...document.querySelectorAll(sel)].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (!txt || (el.textContent || '').replace(/\s+/g, ' ').includes(txt));
    });
    const el = visible[idx];
    if (!el) return { error: `no visible match #${idx} for ${sel}${txt ? ` containing "${txt}"` : ''} (found ${visible.length})` };
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10) };
  }, selector, text, index);
  if (center.error) {
    console.log(center.error);
    await browser.disconnect();
    return;
  }
  const point = { x: center.x * scale, y: center.y * scale };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await sleep(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(wait);

  const overlays = await page.evaluate(() => {
    const r2 = (n) => Math.round(n * 10) / 10;
    const box = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(r2); };
    const surfaces = [...document.querySelectorAll('gem-menu, .mat-mdc-menu-panel, mat-bottom-sheet-container, mat-dialog-container, [role="menu"], [role="dialog"], [role="listbox"], .willow-bottom-sheet-overlay, .spark-goal-menu-panel, .willow-settings-sheet')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0';
      });
    return surfaces.map((el) => {
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 120),
        rect: box(el),
        bg: cs.backgroundColor,
        radius: cs.borderRadius,
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      };
    });
  });
  const dir = path.join(os.tmpdir(), 'willow-emulator');
  fs.mkdirSync(dir, { recursive: true });
  const shot = path.join(dir, `tap-${app}-${label}.png`);
  fs.writeFileSync(shot, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('tapped', JSON.stringify(center.rect), 'scale', scale);
  for (const o of overlays) console.log('overlay', JSON.stringify(o));
  console.log('screenshot', shot);
  if (args.includes('--escape')) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(400);
  }
  await cdp.detach();
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
