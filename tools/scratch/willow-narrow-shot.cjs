/**
 * Screenshots the Willow tab at phone or tablet size. The emulation (size, touch,
 * Android UA) lives on this script's own DevTools session, so it ends when the
 * script exits and the tab goes back to desktop. `--run` steps are spark-rb-seed
 * commands, run while the emulation holds; `--eval` runs a snippet in the page.
 *
 *   node tools/scratch/willow-narrow-shot.cjs <phone|tablet> <out-prefix> [--run="pending"] [--run="pane https://example.com/"] [--shot=name] ...
 *
 * Steps run in order; each `--shot=name` saves <out-prefix>-<name>.png.
 */
const puppeteer = require('puppeteer-core');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SIZES = { phone: { width: 390, height: 844 }, tablet: { width: 800, height: 1280 } };

(async () => {
  const [kind, prefix, ...steps] = process.argv.slice(2);
  const size = SIZES[kind];
  if (!size || !prefix) throw new Error('usage: <phone|tablet> <out-prefix> [--run=...] [--eval=...] [--wait=ms] [--shot=name]');
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  const version = (await browser.version()).match(/\/(\d+)/)?.[1] || '141';
  const phone = kind === 'phone';
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0${phone ? ' Mobile' : ''} Safari/537.36`,
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true, screenWidth: size.width, screenHeight: size.height,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    for (const step of steps) {
      const [flag, ...rest] = step.replace(/^--/, '').split('=');
      const value = rest.join('=');
      if (flag === 'run') {
        const out = execFileSync(process.execPath, [path.join(__dirname, 'spark-rb-seed.cjs'), ...value.split(' ')], { encoding: 'utf8' });
        console.log(`run ${value}: ${out.trim()}`);
      } else if (flag === 'eval') {
        console.log('eval:', JSON.stringify(await page.evaluate(value)));
      } else if (flag === 'tap') {
        // A CSS selector: taps the centre of the first match, as a finger would.
        const box = await (await page.$(value))?.boundingBox();
        if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        console.log(`tap ${value}: ${box ? 'done' : 'not found'}`);
      } else if (flag === 'wait') {
        await new Promise((resolve) => setTimeout(resolve, Number(value) || 1000));
      } else if (flag === 'shot') {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const file = `${prefix}-${value}.png`;
        await page.screenshot({ path: file });
        console.log('shot', file);
      }
    }
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: '' }).catch(() => {});
    browser.disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
