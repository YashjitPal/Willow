/**
 * Where does a row of Gemini's settings menu lead? Opens the drawer and the settings sheet
 * (or menu) if needed, clicks the row whose label matches exactly, and prints the URL the tab
 * lands on plus any new tab it opened. Navigation only — never use it on rows that act
 * (Send feedback, Upgrade, Manage subscription).
 *
 *   node tools/scratch/gemini-settings-route.cjs "Usage limits"
 */
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const REFUSE = /^(Send feedback|Upgrade to .*|Manage subscription)$/;

(async () => {
  const label = process.argv[2];
  if (!label) throw new Error('usage: gemini-settings-route.cjs "<row label>"');
  if (REFUSE.test(label)) throw new Error(`refusing "${label}": that row acts, it does not navigate`);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 60_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com'));
  if (!page) throw new Error('no Gemini tab');
  const before = new Set((await browser.pages()).map((p) => p.target()._targetId));

  const findRow = () => page.evaluate((text) => {
    const rows = [...document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane a, .cdk-overlay-pane [role="menuitem"]')];
    const row = rows.find((el) => el.getBoundingClientRect().width > 0
      && [...el.querySelectorAll('*')].concat(el).some((n) => n.childElementCount === 0 && n.textContent.trim() === text));
    if (!row) return null;
    return { href: row.getAttribute('href'), tag: row.tagName.toLowerCase() };
  }, label);

  let row = await findRow();
  if (!row) {
    const opened = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const menu = [...document.querySelectorAll('button[data-test-id="side-nav-menu-button"], button[aria-label="Main menu"]')]
        .find((b) => b.getBoundingClientRect().width > 0);
      const drawer = document.querySelector('bard-sidenav');
      const drawerShown = drawer && drawer.getBoundingClientRect().right > 40;
      if (!drawerShown && menu) { menu.click(); await wait(900); }
      const gear = [...document.querySelectorAll('bard-sidenav button, side-navigation-v2 button')]
        .find((b) => /settings/i.test(b.getAttribute('aria-label') || '') && b.getBoundingClientRect().width > 0);
      if (!gear) return false;
      gear.click();
      await wait(900);
      return true;
    });
    if (!opened) throw new Error('could not open the settings menu');
    row = await findRow();
  }
  if (!row) throw new Error(`no settings row "${label}"`);

  await page.evaluate((text) => {
    const rows = [...document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane a, .cdk-overlay-pane [role="menuitem"]')];
    rows.find((el) => el.getBoundingClientRect().width > 0
      && [...el.querySelectorAll('*')].concat(el).some((n) => n.childElementCount === 0 && n.textContent.trim() === text))?.click();
  }, label);
  await sleep(3500);

  const opened = (await browser.pages()).filter((p) => !before.has(p.target()._targetId)).map((p) => p.url());
  const overlay = await page.evaluate(() => [...document.querySelectorAll('.cdk-overlay-pane')]
    .filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90)));
  console.log(JSON.stringify({ label, href: row.href, url: page.url(), newTabs: opened, overlays: overlay }));
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
