/**
 * Willow /models-settings: opens provider N (default 1) and, with --expand, the "Add custom
 * model" expander, then screenshots the page at three scroll positions. UI only.
 *
 *   node tools/scratch/models-shots.cjs [--provider=1] [--expand] [--prefix=ph-models]
 */
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer-core');

const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PROVIDER = Number(flag('provider', '1'));
const PREFIX = flag('prefix', 'ph-models');
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
  const cdp = await page.createCDPSession();
  const tapEl = async (selector, index = 0) => {
    const pt = await page.evaluate(async (sel, idx) => {
      const el = [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0)[idx];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 250));
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector, index);
    if (!pt) return false;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x * scale, y: pt.y * scale }] });
    await sleep(50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);
    return true;
  };
  if (new URL(page.url()).pathname !== '/models-settings') {
    await page.evaluate(() => { history.pushState({}, '', '/models-settings'); dispatchEvent(new PopStateEvent('popstate')); });
    await sleep(2500);
  }
  for (let guard = 0; guard < 3 && await page.evaluate(() => !!document.querySelector('.ma-back-button')); guard++) await tapEl('.ma-back-button');
  await tapEl('.ma-provider-row', PROVIDER - 1);
  if (process.argv.includes('--expand')) await tapEl('.ma-expander-trigger');
  for (const [i, at] of [0, 0.45, 1].entries()) {
    await page.evaluate((fraction) => {
      const sc = document.querySelector('.models-api-container');
      sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * fraction;
    }, at);
    await sleep(350);
    const data = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${process.env.TEMP}/${PREFIX}-${i}.png`, Buffer.from(data.data, 'base64'));
  }
  console.log('saved', [0, 1, 2].map((i) => `${PREFIX}-${i}.png`).join(' '));
  await cdp.detach();
  browser.disconnect();
})();
