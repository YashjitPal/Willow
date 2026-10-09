/*
 * Records how an open overlay leaves: samples every visible surface matching the selector
 * per animation frame after an Escape key (or a touch at --tap=x,y, in CSS px), and prints
 * the frames where its box, opacity or transform changed.
 *
 *   node tools/scratch/overlay-close-frames.cjs gemini|willow "<surface selector>" [--tap=x,y]
 */
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
  const [app, selector] = args.filter((a) => !a.startsWith('--'));
  const tapArg = args.find((a) => a.startsWith('--tap='));
  const scale = (await getJson('http://127.0.0.1:9339/status'))?.scale || 1;
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith(URLS[app]));
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  await page.evaluate((sel) => {
    const samples = [];
    const t0 = performance.now();
    const r2 = (n) => Math.round(n * 10) / 10;
    const tick = () => {
      const els = [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width > 0);
      samples.push({
        t: Math.round(performance.now() - t0),
        s: els.map((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return `[${[r.x, r.y, r.width, r.height].map(r2)}] op ${(+cs.opacity).toFixed(3)} tf ${cs.transform} anim ${cs.animationName}`;
        }).join(' || ') || 'none',
      });
      if (performance.now() - t0 < 600) requestAnimationFrame(tick);
    };
    window.__closeSamples = samples;
    requestAnimationFrame(tick);
  }, selector);
  await sleep(50);
  if (tapArg) {
    const [x, y] = tapArg.slice(6).split(',').map(Number);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x * scale, y: y * scale }] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }
  await sleep(700);
  const samples = await page.evaluate(() => window.__closeSamples);
  let previous = '';
  for (const sample of samples) {
    if (sample.s === previous) continue;
    previous = sample.s;
    console.log(`t=${sample.t} ${sample.s}`);
  }
  await cdp.detach();
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
