/**
 * The CyberGhost extension's popup, opened as a page in this work's window (own-window.cjs
 * marker): `read` prints its text and controls; `press <label regex>` clicks one control and
 * reads it again. The debug profile's traffic goes through this VPN.
 *
 *   node tools/scratch/vpn-popup.cjs <marker> read
 *   node tools/scratch/vpn-popup.cjs <marker> press "<label regex>"
 */
const puppeteer = require('puppeteer-core');

const [marker = 'willow-library-probe', command = 'read', pattern] = process.argv.slice(2);
const POPUP = 'chrome-extension://ffbkglfijbcbgblgflchnbphjdllaogb/src/popup.html';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const read = (page) => page.evaluate(() => ({
  text: document.body.innerText.replace(/\s*\n\s*/g, ' | ').slice(0, 900),
  controls: [...document.querySelectorAll('button, a, [role="button"], input, [class*="toggle"], [class*="switch"]')]
    .filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} [${(el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 50)}]`)
    .slice(0, 30),
}));

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60_000 });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().includes(`#${marker}`));
  if (!target) throw new Error(`no window marked #${marker}`);
  const page = await target.page();
  if (!page.url().startsWith(POPUP)) {
    await page.goto(`${POPUP}#${marker}`, { waitUntil: 'domcontentloaded' });
    await sleep(3500);
  }
  if (command === 'power') {
    const box = await page.evaluate(() => {
      const el = document.querySelector('[class*="_powerButton_"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!box) throw new Error('no power button');
    await page.mouse.click(box.x, box.y);
    console.log('pressed the power button');
    await sleep(8000);
  }
  if (command === 'press') {
    const hit = await page.evaluate((source) => {
      const re = new RegExp(source, 'i');
      const el = [...document.querySelectorAll('button, a, [role="button"], [class*="toggle"], [class*="switch"], li, div')]
        .filter((candidate) => candidate.getBoundingClientRect().width > 0)
        .find((candidate) => re.test((candidate.getAttribute('aria-label') || candidate.textContent || '').replace(/\s+/g, ' ').trim()) && candidate.children.length < 6);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) };
    }, pattern);
    if (!hit) throw new Error(`nothing matches ${pattern}`);
    await page.mouse.click(hit.x, hit.y);
    console.log('pressed', hit.label);
    await sleep(5000);
  }
  console.log(JSON.stringify(await read(page), null, 1));
  await browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
