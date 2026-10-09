/**
 * Willow (never the media tab): a real CDP touch at CSS coordinates (scaled by the device
 * emulator's window-fit factor), then a screenshot to %TEMP%\willow-emulator\tapxy-<label>.png.
 *
 *   node tools/scratch/tap-xy.cjs <x> <y> [--label=name] [--wait=800]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');

const getJson = (url) => new Promise((resolve) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});

(async () => {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;
  const [x, y] = args.filter((a) => !a.startsWith('--')).map(Number);
  const scale = (await getJson('http://127.0.0.1:9339/status'))?.scale || 1;
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x * scale, y: y * scale }] });
  await new Promise((r) => setTimeout(r, 60));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await new Promise((r) => setTimeout(r, Number(flag('wait', '800'))));
  const dir = path.join(os.tmpdir(), 'willow-emulator');
  fs.mkdirSync(dir, { recursive: true });
  const shot = path.join(dir, `tapxy-${flag('label', 'tap')}.png`);
  fs.writeFileSync(shot, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('tapped', x, y, 'scale', scale, '->', shot);
  await cdp.detach();
  browser.disconnect();
})();
