// Media's More menu on :3101 (its own headless Chrome, the profile w-tv.cjs --keep seeded): the
// Willow TV item draws the `tv` glyph (a missing ligature would set the letters, twice as wide),
// and choosing it opens Willow TV in a tab of its own.
//   node tools/scratch/w-tv-menu.cjs
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir: path.join(os.tmpdir(), 'willow-tv-probe'),
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  try {
    await page.goto(`${ORIGIN}/media?projectId=tv-ocean`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    for (let i = 0; i < 120; i += 1) {
      if (await page.evaluate(() => [...document.querySelectorAll('button[aria-label="More options"]')].some((b) => b.textContent.includes('more_vert')))) break;
      await sleep(250);
    }
    await sleep(1500);
    await page.evaluate(() => [...document.querySelectorAll('button[aria-label="More options"]')].find((b) => b.textContent.includes('more_vert')).click());
    await sleep(600);
    const item = await page.evaluate(async () => {
      await document.fonts.ready;
      const row = [...document.querySelectorAll('[role="menuitem"]')].find((r) => r.textContent.includes('Willow TV'));
      if (!row) return null;
      const glyph = [...row.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === 'tv');
      if (!glyph) return { row: true };
      const r = glyph.getBoundingClientRect();
      const size = parseFloat(getComputedStyle(glyph).fontSize);
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-family:${getComputedStyle(glyph).fontFamily};font-size:${size}px;font-feature-settings:"liga"`;
      probe.textContent = 'tv';
      document.body.appendChild(probe);
      const inked = probe.getBoundingClientRect().width;
      probe.remove();
      return { box: Math.round(r.width), fontSize: size, inked: Math.round(inked), family: getComputedStyle(glyph).fontFamily };
    });
    check('the menu has Willow TV with the tv glyph, not its letters', !!item && item.inked > 0 && item.inked <= item.fontSize * 1.2, item);
    const opened = browser.waitForTarget((t) => t.url().startsWith(`${ORIGIN}/tv`), { timeout: 15000 }).catch(() => null);
    await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((r) => r.textContent.includes('Willow TV')).click());
    const target = await opened;
    check('choosing it opens Willow TV in a tab of its own', !!target, target?.url());
    check('the editor stays where it was', page.url().startsWith(`${ORIGIN}/media`), page.url());
  } finally {
    await browser.close();
    console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
    process.exit(failures ? 1 : 0);
  }
})();
