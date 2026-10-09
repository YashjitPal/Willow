// In the isolated headless Chrome (port 9333): type a prompt and press Enter with every
// non-localhost request BLOCKED, then report what the app tried to call and what it shows.
// Nothing leaves the machine.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

(async () => {
  const id = fs.readFileSync(path.join(__dirname, '../ui-research/scrapers/gemini/media-tools-2026/.w-media-tab'), 'utf8').trim();
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
  try {
    const target = browser.targets().find((t) => t.type() === 'page' && (t._targetId || t._getTargetInfo().targetId) === id);
    const page = await target.page();
    await page.setViewport({ width: 1536, height: 826, deviceScaleFactor: 1.25 });
    const tried = [];
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u) || u.startsWith('data:') || u.startsWith('blob:') || /fonts\.(googleapis|gstatic)\.com|gstatic\.com\/bard-robin-zs/.test(u)) { req.continue(); return; }
      tried.push(`${req.method()} ${u.slice(0, 140)}`);
      req.abort('blockedbyclient');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 9000));
    await page.click('textarea');
    await page.keyboard.type('a red apple', { delay: 20 });
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 5000));
    console.log(JSON.stringify(await page.evaluate(() => ({
      text: document.body.innerText.slice(0, 600),
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) => d.textContent.trim().slice(0, 120)),
    })), null, 1));
    console.log('blocked requests:\n  ' + [...new Set(tried)].slice(0, 30).join('\n  '));
  } finally { browser.disconnect(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
