/**
 * Can a separate Chrome on this machine open connections? A headless chrome.exe with a throwaway
 * profile loads a page or two and exits. If it can and the debug Chrome cannot, the fault is in
 * the debug Chrome's own network process rather than in the machine.
 *
 *   node tools/scratch/chrome-fresh-net.cjs [url...]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const urls = process.argv.slice(2).length ? process.argv.slice(2) : ['https://example.com/', 'https://gemini.google.com/'];

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-netcheck-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    userDataDir,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  try {
    const page = await browser.newPage();
    for (const url of urls) {
      const t0 = Date.now();
      const result = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
        .then((response) => `HTTP ${response?.status()}`)
        .catch((error) => error.message.split('\n')[0]);
      console.log(`${url}: ${result} in ${Date.now() - t0}ms`);
    }
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
