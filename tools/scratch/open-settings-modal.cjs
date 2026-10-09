/**
 * Willow at narrow widths: opens the settings modal the way a user does — drawer, the
 * settings button, then a row of the settings sheet — with real CDP touches, and saves
 * a screenshot. Prints only UI structure (the modal's box and tab labels).
 *
 *   node tools/scratch/open-settings-modal.cjs [--row="Scheduled actions"] [--shot=name]
 */
const fs = require('fs');
const http = require('http');
const puppeteer = require('puppeteer-core');

const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const ROW = flag('row', 'Scheduled actions');
const SHOT = flag('shot', 'modal');
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
  const tapSel = async (selector, text) => {
    const pt = await page.evaluate((sel, txt) => {
      const el = [...document.querySelectorAll(sel)].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (!txt || (e.getAttribute('aria-label') || e.textContent || '').trim() === txt);
      });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector, text);
    if (!pt) return false;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x * scale, y: pt.y * scale }] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(900);
    return true;
  };
  console.log('drawer', await tapSel('button', 'Open sidebar'));
  const settingsButton = await page.evaluate(() => {
    const b = [...document.querySelectorAll('aside button')].find((x) => /settings/i.test(`${x.getAttribute('aria-label') || ''} ${x.className}`) && x.getBoundingClientRect().width > 0);
    return b ? b.getAttribute('aria-label') : null;
  });
  console.log('settings button label:', settingsButton);
  console.log('sheet', settingsButton ? await tapSel('aside button', settingsButton) : false);
  console.log('row', await tapSel('.willow-settings-sheet-row', ROW));
  await sleep(800);
  console.log(await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"], .settings-modal, .settings-modal-content')].find((d) => d.getBoundingClientRect().width > 0);
    if (!dialog) return 'no modal';
    const r = dialog.getBoundingClientRect();
    return `modal ${dialog.className.slice(0, 80)} [${[r.x, r.y, r.width, r.height].map(Math.round)}] doc scrollW ${document.documentElement.scrollWidth}`;
  }));
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${process.env.TEMP}/${SHOT}.png`, Buffer.from(shot.data, 'base64'));
  await cdp.detach();
  browser.disconnect();
})();
