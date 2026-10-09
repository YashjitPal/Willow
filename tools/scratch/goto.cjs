/**
 * Points the debug Chrome's Gemini or Willow tab at a URL (or a path on its origin) without
 * touching the emulation the device-emulator daemon holds on it, then prints where it landed.
 *
 *   node tools/scratch/goto.cjs gemini /saved-info
 *   node tools/scratch/goto.cjs willow /usage
 */
const puppeteer = require('puppeteer-core');

const ORIGINS = { gemini: 'https://gemini.google.com', willow: 'http://localhost:3000' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const [which = 'gemini', target = '/app', settle = '2500'] = process.argv.slice(2);
  const origin = ORIGINS[which];
  if (!origin) throw new Error('usage: goto.cjs gemini|willow <path-or-url> [settleMs]');
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 60_000,
  });
  // The Gemini tab may be on My Activity, which Gemini's Activity entry opens on its own origin.
  const origins = which === 'gemini' ? [origin, 'https://myactivity.google.com'] : [origin];
  // Never the user's own Media tab, which shares Willow's origin.
  const page = (await browser.pages()).find((p) => origins.some((o) => p.url().startsWith(o)) && !p.url().includes('/media'));
  if (!page) throw new Error(`no ${which} tab`);
  const url = /^https?:/.test(target) ? target : `${origin}${target}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
  await sleep(Number(settle));
  console.log(JSON.stringify(page.url()));
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
