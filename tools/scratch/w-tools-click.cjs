// Clicks the Media rail's Tools row from the gallery, as a user does, in a headless Chrome of its
// own (a fresh profile: nothing of the user's is read or changed), and reports what follows:
// the address, whether the Tools pages mounted, any snackbar, console errors and failed requests.
//   node tools/scratch/w-tools-click.cjs [origin=http://localhost:3101]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = process.argv[2] || 'http://localhost:3101';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-tools-click-'));
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
  page.on('pageerror', (e) => log.push(`pageerror: ${String(e.message || e).slice(0, 400)}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`console.${m.type()}: ${m.text().slice(0, 400)}`); });
  page.on('requestfailed', (r) => log.push(`requestfailed: ${r.url().slice(0, 200)} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) log.push(`http ${r.status()}: ${r.url().slice(0, 200)}`); });
  const t0 = Date.now();
  let lastNav = Date.now();
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) { lastNav = Date.now(); log.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s navigated: ${f.url()}`); } });
  const state = () => page.evaluate(() => ({
    url: location.pathname + location.search,
    surface: !!document.querySelector('.wt-tools-surface'),
    manager: !!document.querySelector('.ng-flow-applet-manager-page'),
    loading: !!document.querySelector('.wt-tools-loading'),
    snack: document.querySelector('.sb-snackbar')?.textContent?.trim() ?? null,
    railTools: !!document.querySelector('aside a'),
  })).catch((e) => ({ error: String(e.message).slice(0, 200) }));
  try {
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
    const end = Date.now() + 120000;
    // A row's text starts with its glyph's ligature name ("apps_spark_2Tools"). The dev server may
    // reload the page a few times while it optimizes; click once it has held still for 8s.
    const ready = () => page.evaluate(() => !!document.querySelector('aside a[href^="/media/tools"]')).catch(() => false);
    while (Date.now() < end && !((await ready()) && Date.now() - lastNav > 8000)) await sleep(500);
    log.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s clicking`);
    console.log('before', JSON.stringify(await state()));
    const box = await page.evaluate(() => {
      const row = document.querySelector('aside a[href^="/media/tools"]');
      const r = row?.getBoundingClientRect();
      return r ? { x: r.x + 40, y: r.y + r.height / 2 } : null;
    });
    console.log('tools row', JSON.stringify(box));
    if (box) {
      await page.mouse.move(box.x, box.y, { steps: 5 });
      await sleep(150);
      await page.mouse.click(box.x, box.y);
    }
    for (const t of [500, 2000, 5000, 10000, 20000]) {
      await sleep(t - (t === 500 ? 0 : [500, 2000, 5000, 10000, 20000][[500, 2000, 5000, 10000, 20000].indexOf(t) - 1]));
      console.log(`after ${t}ms`, JSON.stringify(await state()));
    }
    await page.screenshot({ path: path.join(__dirname, '../ui-research/captures/willow/tools/click-tools.png') });
    console.log(log.slice(0, 60).join('\n'));
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
