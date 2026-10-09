/*
 * Screenshots the Gemini and Willow tabs directly over CDP (bringing each to the front
 * first, since a hidden tab paints nothing new), into %TEMP%\willow-emulator\shot-<app>.png.
 *
 *   node tools/scratch/shot.cjs [gemini|willow|both]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const URLS = { gemini: 'https://gemini.google.com/', willow: 'http://localhost:3000' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const which = process.argv[2] || 'both';
  const apps = which === 'both' ? ['gemini', 'willow'] : [which];
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const pages = await browser.pages();
  const dir = path.join(os.tmpdir(), 'willow-emulator');
  fs.mkdirSync(dir, { recursive: true });
  for (const app of apps) {
    // Never the user's own Media tab, which shares Willow's origin.
    const page = pages.find((candidate) => candidate.url().startsWith(URLS[app]) && !candidate.url().includes('/media'));
    if (!page) continue;
    await page.bringToFront();
    await sleep(600);
    const cdp = await page.createCDPSession();
    const file = path.join(dir, `shot-${app}.png`);
    fs.writeFileSync(file, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await cdp.detach();
    console.log(file);
  }
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
