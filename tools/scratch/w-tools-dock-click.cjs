// Opens a template (so the Tools dock has a row), goes back to the gallery, and clicks the rail's
// Tools row as a user does, logging what the press lands on: the hit element, every mousedown /
// mouseup / click on the way (capture phase), whether a marquee started, and where the page went.
// A headless Chrome with a fresh profile: nothing of the user's is read or changed.
// --early clicks 1.5s after the row appears, while the gallery may still be loading, instead of
// once the address has held still for 6s; --during-fade the moment the Loading page starts to fade.
//   node tools/scratch/w-tools-dock-click.cjs [origin=http://localhost:3101] [--at=center|icon|label] [--early|--during-fade]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:3101';
const AT = (process.argv.find((a) => a.startsWith('--at=')) || '--at=center').slice(5);
const EARLY = process.argv.includes('--early');
const DURING_FADE = process.argv.includes('--during-fade');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-tools-dock-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    ignoreDefaultArgs: ['--hide-scrollbars'],
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  const log = [];
  const t0 = Date.now();
  const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
  let lastNav = Date.now();
  page.on('pageerror', (e) => log.push(`${stamp()} pageerror: ${String(e.message || e).slice(0, 300)}`));
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[probe]')) log.push(`${stamp()} ${t}`);
    else if (m.type() === 'error') log.push(`${stamp()} console.error: ${t.slice(0, 300)}`);
  });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) { lastNav = Date.now(); log.push(`${stamp()} navigated: ${f.url().replace(ORIGIN, '')}`); } });
  const settle = async (ready, ms = 120000) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !((await page.evaluate(ready).catch(() => false)) && Date.now() - lastNav > 6000)) await sleep(500);
  };
  try {
    await page.goto(`${ORIGIN}/media/tools`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
    await settle(() => !!document.querySelector('.applet-section'));
    await page.evaluate(() => {
      const toggle = [...document.querySelectorAll('.marketplace-toggles .mat-button-toggle-button')].find((b) => b.textContent.trim() === 'Templates');
      toggle?.click();
    });
    await sleep(800);
    await page.evaluate(() => document.querySelector('.applet-grid-gallery .ng-flow-applet-card .applet-card-main')?.click());
    await settle(() => /\/media\/tool\/[0-9a-f-]{20,}/.test(location.pathname) && !!document.querySelector('.applet-view-header'), 60000);
    log.push(`${stamp()} template open: ${page.url().replace(ORIGIN, '')}`);

    await page.goto(`${ORIGIN}/media`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    if (DURING_FADE) {
      await page.waitForSelector('.flow-loading-host.loading-page-fade-out', { timeout: 120000 });
      const box = await page.evaluate(() => {
        const r = document.querySelector('aside a[href^="/media/tools"]').getBoundingClientRect();
        window.addEventListener('mousedown', (e) => {
          console.log(`[probe] mousedown on ${e.target.tagName.toLowerCase()}.${String(e.target.className).split(/\s+/)[0]} overlay=${!!document.querySelector('.flow-loading-host')}`);
        }, true);
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.click(box.x, box.y);
      await sleep(4000);
      const after = await page.evaluate(() => ({ url: location.pathname + location.search, manager: !!document.querySelector('.ng-flow-applet-manager-page') })).catch((e) => ({ error: String(e.message).slice(0, 200) }));
      log.push(`${stamp()} after ${JSON.stringify(after)}`);
      console.log(log.join('\n'));
      return;
    }
    if (EARLY) {
      const end = Date.now() + 120000;
      while (Date.now() < end && !(await page.evaluate(() => !!document.querySelector('aside a[href^="/media/tools"]')).catch(() => false))) await sleep(150);
      await sleep(1500);
    } else {
      await settle(() => !!document.querySelector('aside a[href^="/media/tools"]'));
    }
    await page.evaluate(() => {
      const describe = (el) => {
        if (!el || !el.tagName) return String(el);
        const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
        return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${el.getAttribute('href') ? `[href=${el.getAttribute('href')}]` : ''}`;
      };
      for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
        window.addEventListener(type, (e) => {
          console.log(`[probe] ${type} on ${describe(e.target)} button=${e.button} prevented=${e.defaultPrevented} selecting=${!!document.querySelector('.selecting-mode')}`);
        }, true);
        window.addEventListener(type, (e) => {
          console.log(`[probe] ${type} (bubbled) prevented=${e.defaultPrevented}`);
        }, false);
      }
    });
    const rail = await page.evaluate(() => {
      const row = document.querySelector('aside a[href^="/media/tools"]');
      const r = row.getBoundingClientRect();
      const label = row.querySelector('span')?.getBoundingClientRect();
      return {
        href: row.getAttribute('href'),
        text: row.textContent.trim(),
        rect: [r.x, r.y, r.width, r.height].map(Math.round),
        label: label ? [label.x, label.y, label.width, label.height].map(Math.round) : null,
        dockRows: [...document.querySelectorAll('aside a[aria-label]')].map((a) => a.getAttribute('aria-label')),
      };
    });
    log.push(`${stamp()} rail ${JSON.stringify(rail)}`);
    const [x, y, w, h] = rail.rect;
    const point = AT === 'icon' ? { x: x + 24, y: y + h / 2 } : AT === 'label' && rail.label ? { x: rail.label[0] + 10, y: y + h / 2 } : { x: x + w / 2, y: y + h / 2 };
    const hit = await page.evaluate(({ x: px, y: py }) => {
      const chain = [];
      for (let el = document.elementFromPoint(px, py); el && chain.length < 6; el = el.parentElement) {
        chain.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/).slice(0, 2).join('.')}` : ''}`);
      }
      return chain;
    }, point);
    log.push(`${stamp()} hit at ${Math.round(point.x)},${Math.round(point.y)}: ${hit.join(' < ')}`);
    await page.mouse.move(point.x, point.y, { steps: 5 });
    await sleep(150);
    await page.mouse.click(point.x, point.y);
    await sleep(EARLY ? 12000 : 3000);
    const after = await page.evaluate(() => ({
      url: location.pathname + location.search,
      manager: !!document.querySelector('.ng-flow-applet-manager-page'),
      surface: !!document.querySelector('.wt-tools-surface'),
    })).catch((e) => ({ error: String(e.message).slice(0, 200) }));
    log.push(`${stamp()} after ${JSON.stringify(after)}`);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.wt-tools-surface aside nav > button, .wt-tools-surface aside nav > a')].map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.textContent.trim().slice(-12)} y=${Math.round(r.y)} bg=${getComputedStyle(el).backgroundColor} hover=${el.matches(':hover')} focus=${el.matches(':focus')} class=${el.className.split(/\s+/).filter((c) => /bg-|hover|focus/.test(c)).join(' ')}`;
    })).catch((e) => [String(e.message)]);
    log.push(...rows.map((r) => `  row ${r}`));
    await page.screenshot({ path: path.join(__dirname, '../ui-research/captures/willow/tools/dock-click.png') });
    console.log(log.join('\n'));
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
