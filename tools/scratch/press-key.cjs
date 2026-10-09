/**
 * Presses one key in the Gemini or Willow tab — Escape by default, to close whatever overlay
 * a measurement opened. Never use it to press Enter in Gemini.
 *
 *   node tools/scratch/press-key.cjs gemini|willow [Escape]
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };

(async () => {
  const [which = 'gemini', key = 'Escape'] = process.argv.slice(2);
  if (which === 'gemini' && key === 'Enter') throw new Error('refusing to press Enter in Gemini');
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 30_000,
  });
  const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGINS[which] || 'x'));
  if (!page) throw new Error(`no ${which} tab`);
  await page.bringToFront();
  await page.keyboard.press(key);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const left = await page.evaluate(() => [...document.querySelectorAll('.cdk-overlay-pane, [role="dialog"], [role="menu"], .mat-mdc-dialog-container')]
    .filter((el) => el.getBoundingClientRect().width > 0).length);
  console.log(`${which}: pressed ${key}; ${left} overlay(s) still open`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
