/**
 * Willow, narrow widths: walks the settings modal's compact layout through every view a
 * user can reach without changing anything, and scans each for sideways scrolling or
 * elements past the screen edge:
 *   the list; every tab; Models & API → each provider's Manage view and each defaults
 *   dropdown; Connectors → each connector's detail view.
 * Opens the modal from the settings sheet if it is not open. Never taps save, connect,
 * delete, a toggle, or a dropdown option. Prints UI structure only.
 *
 *   node tools/scratch/modal-walk.cjs [--label=phone]
 */
const http = require('http');
const puppeteer = require('puppeteer-core');

const LABEL = (process.argv.find((a) => a.startsWith('--label=')) || '--label=modal').slice(8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
  }).on('error', () => resolve(null));
});

const SCAN = () => {
  const W = innerWidth;
  const dialog = document.querySelector('.settings-modal-dialog');
  if (!dialog) return ['no modal'];
  const name = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 4).join('.')}` : ''}`;
  const visible = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const out = [];
  for (const el of [dialog, ...dialog.querySelectorAll('*')]) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (/auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !el.matches('.snap-x, [data-scroll-x]')) {
      out.push(`scrolls sideways: ${name(el)} ${el.scrollWidth}/${el.clientWidth}`);
    }
  }
  const reported = [];
  for (const el of dialog.querySelectorAll('*')) {
    if (!visible(el) || reported.some((p) => p.contains(el)) || el.closest('.sr-only')) continue;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    if (b.right > W + 0.5 || b.left < -0.5) {
      out.push(`past edge: ${name(el)} [${Math.round(b.left)}..${Math.round(b.right)}]`);
      reported.push(el);
    }
  }
  return out.slice(0, 8);
};

(async () => {
  const scale = (await getJson('http://127.0.0.1:9339/status'))?.scale || 1;
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  const tap = async (selector, { text, index = 0 } = {}) => {
    const pt = await page.evaluate(async (sel, txt, idx) => {
      const els = [...document.querySelectorAll(sel)].filter((e) => {
        const r = e.getBoundingClientRect();
        const label = (e.getAttribute('aria-label') || e.textContent || '').trim();
        return r.width > 0 && r.height > 0 && (!txt || label === txt || label.startsWith(txt));
      });
      const el = els[idx];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 200));
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector, text || '', index);
    if (!pt) return false;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x * scale, y: pt.y * scale }] });
    await sleep(50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(650);
    return true;
  };
  const count = (sel, text) => page.evaluate((s, t) => [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().width > 0 && (!t || (e.textContent || '').trim() === t)).length, sel, text || '');
  let shotIndex = 0;
  const report = async (state) => {
    const issues = await page.evaluate(SCAN);
    console.log(`[${LABEL}] ${state}: ${issues.length ? issues.join(' | ') : 'ok'}`);
    if (process.argv.includes('--shots') && !/dropdown/.test(state)) {
      const data = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = `${process.env.TEMP}/modalwalk-${LABEL}-${String(shotIndex++).padStart(2, '0')}.png`;
      require('fs').writeFileSync(file, Buffer.from(data.data, 'base64'));
    }
  };

  if (!(await page.evaluate(() => !!document.querySelector('.settings-modal-dialog')))) {
    await tap('button', { text: 'Open sidebar' });
    await tap('aside button', { text: 'Settings' });
    await tap('.willow-settings-sheet-row', { text: 'Scheduled actions' });
    await sleep(500);
  }
  await report('opened on Scheduled actions');
  await tap('button', { text: 'Back to settings' });
  await report('list');

  const ROW = '.settings-modal-compact-list > button, .settings-modal-compact-list > .settings-modal-labs-item';
  const tabs = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()), ROW);
  for (const tab of tabs) {
    await tap(ROW, { text: tab });
    await report(`tab ${tab}`);
    if (tab === 'Models & API') {
      const manage = await count('.settings-modal-content button', 'Manage');
      for (let i = 0; i < manage; i++) {
        await tap('.settings-modal-content button', { text: 'Manage', index: i });
        await report(`Models & API · Manage ${i + 1}/${manage}`);
        await tap('.settings-modal-content button:has(> svg.rotate-90)');
      }
      const dropdowns = await count('.settings-modal-content [data-dropdown] > button');
      for (let i = 0; i < dropdowns; i++) {
        await tap('.settings-modal-content [data-dropdown] > button', { index: i });
        await report(`Models & API · defaults dropdown ${i + 1}/${dropdowns} open`);
        await tap('.settings-modal-content [data-dropdown] > button', { index: i });
      }
    }
    if (tab === 'Connectors') {
      const cards = await count('.settings-modal-content .grid > div.cursor-pointer');
      for (let i = 0; i < cards; i++) {
        await tap('.settings-modal-content .grid > div.cursor-pointer', { index: i });
        await report(`Connectors · card ${i + 1}/${cards}`);
        if (!(await tap('.settings-modal-content button', { text: 'Connectors' }))) {
          await tap('.settings-modal-content button:has(> svg.rotate-90), .settings-modal-content button[aria-label="Back"]');
        }
      }
    }
    await tap('button', { text: 'Back to settings' });
  }
  await cdp.detach();
  browser.disconnect();
})();
