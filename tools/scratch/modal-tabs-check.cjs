/**
 * Willow, narrow widths: walks the settings modal's compact layout. Closes any open modal,
 * opens it from the settings sheet's "Scheduled actions" row (straight into a tab), taps
 * Back to the list, then opens each tab row in turn — screenshot per step — and reports
 * elements wider than the viewport inside the content pane (layout breakage only; no text).
 */
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer-core');

const TABS = (process.argv.find((a) => a.startsWith('--tabs=')) || '--tabs=Appearance,Models & API,Your account,Labs,Connectors,GitHub').slice(7).split(',');
const PREFIX = (process.argv.find((a) => a.startsWith('--prefix=')) || '--prefix=modal').slice(9);
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
  const key = async (k) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 });
  };
  const tap = async (selector, text) => {
    const pt = await page.evaluate((sel, txt) => {
      const el = [...document.querySelectorAll(sel)].find((e) => {
        const r = e.getBoundingClientRect();
        const label = (e.getAttribute('aria-label') || e.textContent || '').trim();
        return r.width > 0 && r.height > 0 && (!txt || label === txt);
      });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector, text);
    if (!pt) return false;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x * scale, y: pt.y * scale }] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(800);
    return true;
  };
  const snap = async (name) => {
    const data = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${process.env.TEMP}/${PREFIX}-${name.replace(/\W+/g, '_')}.png`, Buffer.from(data.data, 'base64'));
  };
  const report = () => page.evaluate(() => {
    const dialog = document.querySelector('.settings-modal-dialog');
    if (!dialog) return 'no modal';
    const r = dialog.getBoundingClientRect();
    const content = dialog.querySelector('.settings-modal-content');
    const list = dialog.querySelector('.settings-modal-compact-list');
    const wide = [...dialog.querySelectorAll('*')].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1);
    }).slice(0, 6).map((el) => {
      const b = el.getBoundingClientRect();
      return `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 4).join('.')} [${Math.round(b.left)}..${Math.round(b.right)}]`;
    });
    return `dialog [${[r.x, r.y, r.width, r.height].map(Math.round)}] compact ${dialog.classList.contains('is-compact')} pane ${content ? 'content' : list ? 'list' : '?'}${wide.length ? `\n   overflow: ${wide.join(' | ')}` : ''}`;
  });

  await key('Escape');
  await sleep(500);
  await tap('button', 'Open sidebar');
  await tap('aside button', 'Settings');
  await tap('.willow-settings-sheet-row', 'Scheduled actions');
  await sleep(500);
  console.log('scheduled:', await report());
  await snap('scheduled');
  await tap('button', 'Back to settings');
  console.log('list:', await report());
  await snap('list');
  for (const tab of TABS) {
    const opened = await tap('.settings-modal-compact-list > button, .settings-modal-compact-list > .settings-modal-labs-item', tab);
    await sleep(400);
    console.log(`${tab}${opened ? '' : ' (no row)'}:`, await report());
    await snap(tab);
    await tap('button', 'Back to settings');
  }
  await cdp.detach();
  browser.disconnect();
})();
