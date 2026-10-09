// What Media's rail holds on a server, in a fresh headless profile: each <aside>'s rows, and every
// element whose text is "Tools".
//   node tools/scratch/w-rail-dump.cjs [origin=http://localhost:3101]
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = process.argv[2] || 'http://localhost:3101';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-rail-'));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir,
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
  });
  const page = (await browser.pages())[0];
  try {
    await page.goto(`${ORIGIN}/media`, { waitUntil: 'networkidle2', timeout: 180000 }).catch(() => {});
    await sleep(8000);
    const out = await page.evaluate(() => ({
      url: location.href,
      asides: [...document.querySelectorAll('aside')].map((a) => ({
        cls: a.className.slice(0, 120),
        rows: [...a.querySelectorAll('button, [role="link"], a')].map((e) => `${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[role=${e.getAttribute('role')}]` : ''}: ${e.textContent.trim().slice(0, 40)}`),
      })),
      tools: [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && /^Tools$/.test(e.textContent.trim())).map((e) => {
        const p = e.closest('[role], button, a, aside');
        return `${e.tagName.toLowerCase()}.${e.className} in ${p ? `${p.tagName.toLowerCase()}[${p.getAttribute('role') || ''}].${String(p.className).slice(0, 80)}` : '-'}`;
      }),
    }));
    console.log(JSON.stringify(out, null, 1));
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
