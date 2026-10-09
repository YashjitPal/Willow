// Opens a page of the test server in a throwaway headless Chrome and reports what it shows.
// node tools/scratch/w-load-check.mjs [url] [waitMs]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(REPO, 'package.json'));
const puppeteer = require('puppeteer');

const URL = process.argv[2] || 'http://localhost:3101/media';
const WAIT = Number(process.argv[3] || 30000);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-load-check-'));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-first-run', '--no-default-browser-check'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 500)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text().slice(0, 300)); });
  page.on('requestfailed', (r) => console.log('[requestfailed]', r.url().slice(0, 200), r.failure()?.errorText));
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 180000 });
  console.log(`load after ${Date.now() - t0}ms`);
  const found = await page.waitForSelector('textarea[placeholder="What do you want to create?"]', { timeout: WAIT }).then(() => true, () => false);
  console.log(`prompt box: ${found} after ${Date.now() - t0}ms; url ${page.url()}`);
  const info = await page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 800),
    textareas: [...document.querySelectorAll('textarea')].map((t) => t.placeholder),
    rootChildren: document.getElementById('root')?.children.length,
  }));
  console.log(JSON.stringify(info, null, 1));
  const shot = path.join(os.tmpdir(), 'willow-load-check.png');
  await page.screenshot({ path: shot });
  console.log('screenshot', shot);
} finally {
  await browser.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
