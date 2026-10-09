/**
 * Finds a Gemini conversation whose responses carry thinking. At narrow widths the history
 * lives in the drawer, so this taps "Main menu" (real CDP touch), collects conversation
 * hrefs (never titles), closes the drawer, then opens each chat in turn and reports only
 * counts: responses, model-thoughts elements, and buttons mentioning "thinking".
 *
 *   node tools/scratch/find-thinking-chat.cjs [--max=8] [--skip=0]
 */
const http = require('http');
const puppeteer = require('puppeteer-core');

const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const max = Number(flag('max', '8'));
const skip = Number(flag('skip', '0'));
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
  const cdp = await gemini.createCDPSession();
  const tap = async (x, y) => {
    const point = { x: x * scale, y: y * scale };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const collect = () => gemini.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/app/"]')]
    .map((a) => new URL(a.href).pathname)
    .filter((p) => /^\/app\/[0-9a-f]{8,}$/i.test(p)))]);

  let hrefs = await collect();
  if (!hrefs.length) {
    const menu = await gemini.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Main menu' && x.getBoundingClientRect().width > 0);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (menu) {
      await tap(menu.x, menu.y);
      await sleep(1200);
      hrefs = await collect();
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(500);
    }
  }
  console.log(`history links: ${hrefs.length}`);
  if (process.argv.includes('--list')) {
    hrefs.slice(skip, skip + max).forEach((h, i) => console.log(`#${skip + i} ${h}`));
    await cdp.detach();
    browser.disconnect();
    return;
  }
  for (const [index, href] of hrefs.slice(skip, skip + max).entries()) {
    await gemini.goto(`https://gemini.google.com${href}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    let info = null;
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      info = await gemini.evaluate(() => ({
        responses: document.querySelectorAll('model-response').length,
        modelThoughts: document.querySelectorAll('model-thoughts').length,
        thinkingButtons: [...document.querySelectorAll('button, [role="button"]')].filter((b) => /thinking|thoughts/i.test(`${b.textContent} ${b.getAttribute('aria-label') || ''}`)).length,
      }));
      if (info.responses) break;
    }
    console.log(`#${skip + index} ${href.slice(0, 10)}… responses ${info.responses} model-thoughts ${info.modelThoughts} thinking-buttons ${info.thinkingButtons}`);
    if (info.modelThoughts || info.thinkingButtons) {
      console.log(`FOUND ${href}`);
      break;
    }
  }
  await cdp.detach();
  browser.disconnect();
})();
