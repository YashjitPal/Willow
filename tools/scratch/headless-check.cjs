// Launches an isolated headless Chrome (temp profile) on Willow, so captures never touch the
// user's debug browser. Prints what renders and saves a screenshot.
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => fs.existsSync(p));

(async () => {
  if (!CHROME) throw new Error('no Chrome executable found');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-headless-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    userDataDir: profile,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars=false'],
  });
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 12000));
    console.log(JSON.stringify(await page.evaluate(() => ({
      url: location.href,
      plus: !!document.querySelector('button[aria-label^="Upload"]'),
      composer: !!document.querySelector('.willow-gemini-composer'),
      text: document.body.innerText.slice(0, 300),
    })), null, 1));
    const out = path.resolve(__dirname, '../ui-research/captures/gemini/media-tools-2026/w/headless-home.png');
    await page.screenshot({ path: out });
    console.log('saved', out);
  } finally {
    await browser.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
