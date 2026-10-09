// A bot's Category menu (Spark's DotProfilePanel) with long category names, on the :3101 test
// origin, in a headless Chrome of its own (a fresh profile: no keys, so the bot never reaches a
// model). Seeds one bot, "Pip", and its categories, opens its profile and the menu, and writes a
// shot of the menu and the size of each row per viewport.
//   node tools/scratch/w-dot-category.cjs [--out=<name>]   (shots in captures/willow/dot-category/)
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const ROOT = '/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code';
const OUT = path.join(__dirname, '../ui-research/captures/willow/dot-category');
const NAME = (process.argv.find((a) => a.startsWith('--out=')) || '--out=now').slice('--out='.length);
const SIZES = {
  desktop: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const CATEGORIES = ['Work', 'The zazazaza Category', 'Travel plans for the summer holidays with the whole family'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-dot-category-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: SIZES.desktop,
    protocolTimeout: 300000,
  });
  const errors = [];
  try {
    const seed = (await browser.pages())[0];
    await seed.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await seed.evaluate((categories) => {
      const now = Date.now();
      localStorage.setItem('willow:spark:dots:v2', JSON.stringify({
        categories,
        dots: [{ id: 'pip', name: 'Pip', presetId: 'blue_beret', appearance: null, petId: null, status: 'ready', category: null, createdAt: now, updatedAt: now, messages: [] }],
      }));
    }, CATEGORIES);
    for (const [sizeName, size] of Object.entries(SIZES)) {
      // A page of its own per size: changing a page's mobile emulation reloads it.
      const page = await browser.newPage();
      page.setDefaultTimeout(120000);
      page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
      await page.setViewport(size);
      await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 180000 });
      await page.waitForFunction(() => document.querySelector('[aria-label="Switch to Spark"]'), { timeout: 120000 }).catch(() => null);
      await sleep(1500);
      await page.evaluate(() => document.querySelector('[aria-label="Switch to Spark"]')?.click());
      await sleep(2500);
      await page.evaluate(async (root) => {
        const store = await import(`${root}/features/spark/src/spark-store.ts`);
        store.goToSparkDot('pip');
      }, ROOT);
      await page.waitForFunction(() => document.querySelector('[aria-label="Show Pip\'s profile"], .dot-panel__category-chip'), { timeout: 90000 }).catch(() => null);
      await sleep(2500);
      // The chip on screen: the docked profile's on a wide screen, else the info button's popover.
      const markVisibleChip = () => page.evaluate(() => {
        const chips = [...document.querySelectorAll('.dot-panel__category-chip')];
        chips.forEach((chip) => chip.removeAttribute('data-probe'));
        const shown = chips.find((chip) => { const b = chip.getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; });
        shown?.setAttribute('data-probe', 'chip');
        return !!shown;
      });
      if (!(await markVisibleChip())) {
        await page.evaluate(() => document.querySelector('[aria-label="Show Pip\'s profile"]')?.click());
        await sleep(1500);
        await markVisibleChip();
      }
      await page.evaluate(() => document.querySelector('[data-probe="chip"]')?.click());
      await page.waitForSelector('[data-probe="chip"] ~ .dot-panel__category-menu', { timeout: 5000 }).catch(() => null);
      await sleep(500);
      const box = await page.evaluate(() => {
        const chip = document.querySelector('[data-probe="chip"]');
        const menu = chip?.parentElement?.querySelector('.dot-panel__category-menu');
        if (!menu || !chip) return null;
        const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
        const m = menu.getBoundingClientRect();
        const atCentre = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2);
        return {
          menu: r(menu),
          // False when something covers the menu or a clipping parent cuts it off.
          menuOnTop: !!atCentre && menu.contains(atCentre),
          chip: r(chip),
          rows: [...menu.querySelectorAll('[role="menuitemradio"]')].map((row) => {
            const label = row.lastElementChild;
            return { text: label.textContent, row: r(row), labelHeight: Math.round(label.getBoundingClientRect().height), clipped: label.scrollWidth > label.clientWidth, title: row.getAttribute('title') };
          }),
          viewport: { w: innerWidth, h: innerHeight },
        };
      });
      console.log(sizeName, JSON.stringify(box, null, 1));
      if (box) {
        const pad = 24;
        const x = Math.max(0, Math.min(box.menu.x, box.chip.x) - pad);
        const y = Math.max(0, box.chip.y - pad);
        const right = Math.min(box.viewport.w, Math.max(box.menu.x + box.menu.w, box.chip.x + box.chip.w) + pad);
        const bottom = Math.min(box.viewport.h, box.menu.y + box.menu.h + pad);
        if (right > x && bottom > y) await page.screenshot({ path: path.join(OUT, `${NAME}-${sizeName}.png`), clip: { x, y, width: right - x, height: bottom - y } });
        else console.log(`${sizeName}: the menu is off screen`);
      }
      await page.close();
    }
    if (errors.length) console.log('page errors:', JSON.stringify(errors.slice(0, 5)));
  } catch (e) {
    console.error('FAILED:', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})();
