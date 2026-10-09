/**
 * Read-only: the hover state of the sent-image preview's Close and More options buttons in
 * Gemini (the state layer's colour and opacity), with a cropped shot of each. Its own tab.
 *
 *   node tools/scratch/gemini-sent-image-hover.cjs <chat id>
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const chatId = process.argv[2];
  const out = 'tools/ui-research/captures/gemini/sent-image/desktop';
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 90_000 });
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1536, height: 826 });
    await page.bringToFront();
    await page.goto(`https://gemini.google.com/app/${chatId}`, { waitUntil: 'networkidle2', timeout: 90_000 });
    await sleep(6000);
    const box = await page.evaluate(() => {
      const img = [...document.querySelectorAll('user-query img')].filter((el) => el.getBoundingClientRect().width > 20)[0];
      img.scrollIntoView({ block: 'center' });
      const r = img.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await sleep(700);
    await page.mouse.click(box.x, box.y);
    await page.waitForSelector('mat-dialog-container img.image-container', { timeout: 15_000 });
    await sleep(1500);
    for (const label of ['Close', 'More options']) {
      const rect = await page.evaluate((aria) => {
        const r = document.querySelector(`.cdk-overlay-container button[aria-label="${aria}"]`).getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, label);
      await page.mouse.move(rect.x + rect.w / 2, rect.y + rect.h / 2);
      await sleep(500);
      const state = await page.evaluate((aria) => {
        const button = document.querySelector(`.cdk-overlay-container button[aria-label="${aria}"]`);
        const ripple = button.querySelector('.mat-mdc-button-persistent-ripple');
        const before = ripple ? getComputedStyle(ripple, '::before') : null;
        return {
          buttonBg: getComputedStyle(button).backgroundColor,
          rippleBefore: before ? { bg: before.backgroundColor, opacity: before.opacity } : null,
          iconColor: getComputedStyle(button.querySelector('mat-icon')).color,
        };
      }, label);
      console.log(`${label} hovered:`, JSON.stringify(state));
      await page.screenshot({ path: `${out}/hover-${label.replace(/\s+/g, '-').toLowerCase()}.png`, clip: { x: rect.x - 12, y: rect.y - 12, width: rect.w + 24, height: rect.h + 24 } });
    }
  } finally {
    await page.close().catch(() => {});
    browser.disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
