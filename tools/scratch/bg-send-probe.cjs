/** Sends one short chat message from a fresh Willow tab and reports whether a turn started. */
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const COMPOSER = 'textarea.willow-dictation-textarea';

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(COMPOSER, { visible: true, timeout: 60_000 });
  await sleep(2500);
  await page.bringToFront();
  await page.focus(COMPOSER);
  const cdp = await page.createCDPSession();
  await cdp.send('Input.insertText', { text: process.argv[2] || 'Say hi in five words.' });
  await sleep(600);
  console.log(JSON.stringify(await page.evaluate((selector) => {
    const area = document.querySelector(selector);
    const send = [...document.querySelectorAll('button[aria-label="Send message"], button[aria-label="Submit"]')]
      .map((button) => ({ label: button.getAttribute('aria-label'), disabled: button.disabled, width: button.getBoundingClientRect().width }));
    return { value: area.value, focused: document.activeElement === area, send };
  }, COMPOSER)));
  await page.keyboard.press('Enter');
  await sleep(4000);
  await page.screenshot({ path: require('node:os').tmpdir() + '/bg-send-probe.png' });
  console.log(JSON.stringify(await page.evaluate((selector) => {
    const turns = globalThis[Symbol.for('willow.chatTurns')];
    return { turns: turns ? turns.size : 'no map', value: document.querySelector(selector)?.value, url: location.href };
  }, COMPOSER)));
  if (!process.argv.includes('--keep')) await page.close();
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
