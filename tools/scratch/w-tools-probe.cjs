// Opens the :3101 Tools pages in a headless Chrome kept between runs (its own profile) and runs a
// probe module against them: `module.exports = async ({ page, go, sleep, shot }) => { ... }`.
//   node tools/scratch/w-tools-probe.cjs <probe.cjs> [--fresh]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const PROJECT = 'wt-tools';
const [probeFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const userDataDir = path.join(os.tmpdir(), 'willow-tools-probe2');
if (process.argv.includes('--fresh')) fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });
const SHOTS = path.join(__dirname, '../ui-research/captures/willow/tools/probe');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    // Scrollbars take room in a real window, and Flow's layout counts on them.
    ignoreDefaultArgs: ['--hide-scrollbars'],
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  page.on('pageerror', (e) => console.log('pageerror:', String(e.message || e).slice(0, 300)));
  const go = async (p) => {
    await page.goto(`${ORIGIN}${p}${p.includes('?') ? '&' : '?'}projectId=${PROJECT}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  };
  const waitFor = async (fn, arg, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await page.evaluate(`!!((${fn})(${JSON.stringify(arg ?? null)}))`).catch(() => false)) return true;
      await sleep(150);
    }
    return false;
  };
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  /** A template's copy: the one already saved, else the first template opened (which makes it). */
  const ensureCopy = async () => {
    await go('/media/tools');
    await waitFor(() => document.querySelector('.applet-section'), null, 120000);
    const saved = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('WillowMediaToolsDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const all = await new Promise((res) => { const q = db.transaction('tools', 'readonly').objectStore('tools').getAll(); q.onsuccess = () => res(q.result); });
      db.close();
      return all.map((r) => r.tool).find((t) => t?.remixedFrom?.kind === 'template' && !t.pending)?.id ?? null;
    });
    if (saved) return saved;
    await page.evaluate(() => [...document.querySelectorAll('.marketplace-toggles .mat-button-toggle-button')].find((b) => b.textContent.trim() === 'Templates')?.click());
    await waitFor(() => /Build all the tools/.test(document.querySelector('.ng-flow-applet-hero-banner')?.textContent || ''), null, 5000);
    await page.evaluate(() => document.querySelector('.applet-grid-gallery .applet-card-main').click());
    await waitFor(() => /\/media\/tool\/[0-9a-f-]{20,}/.test(location.pathname), null, 30000);
    await sleep(1500);
    return page.url().match(/\/media\/tool\/([^?]+)/)?.[1] ?? null;
  };
  const goTarget = async (target) => {
    await go(target.includes('{copy}') ? target.replace('{copy}', await ensureCopy()) : target);
  };
  try {
    const probe = require(path.resolve(probeFile));
    await probe({ page, go, goTarget, ensureCopy, sleep, shot, waitFor, ORIGIN });
  } catch (e) {
    console.error('FAILED:', e.stack || e.message);
  } finally {
    await browser.close();
  }
})();
