/**
 * Reloads the Willow tab and reports console errors (with their substitution arguments
 * resolved, so React's "%s" names the component), page errors with their first stack
 * frames, and failed requests seen during the next few seconds; then the page text.
 *
 *   node tools/scratch/reload-errors.cjs [waitMs=8000]
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const wait = Number(process.argv[2] || 8000);
  const browser = await puppeteer.connect({
    browserURL: process.env.SPARK_CDP_URL || 'http://[::1]:9222',
    defaultViewport: null,
    protocolTimeout: 60_000,
  });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().startsWith('http://localhost:3000'));
  if (!target) throw new Error('no Willow tab');
  const page = await target.page();
  const seen = [];
  page.on('console', async (msg) => {
    if (msg.type() !== 'error') return;
    const args = await Promise.all(msg.args().map((arg) => arg.jsonValue().catch(() => '?')));
    let text = String(args[0] ?? msg.text());
    for (const value of args.slice(1)) text = text.replace(/%[sdo]/, String(value).slice(0, 400));
    seen.push(`console: ${text.slice(0, 900)}`);
  });
  page.on('pageerror', (err) => seen.push(`pageerror: ${String(err.message || err).slice(0, 300)}\n  ${String(err.stack || '').split('\n').slice(1, 6).join('\n  ')}`));
  page.on('requestfailed', (req) => seen.push(`failed: ${req.url().slice(0, 160)} ${req.failure()?.errorText}`));
  await page.bringToFront();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) => seen.push(`reload: ${e.message}`));
  await new Promise((resolve) => setTimeout(resolve, wait));
  const text = await page.evaluate(() => document.body.innerText.slice(0, 160).replace(/\n/g, ' | '));
  console.log(seen.length ? seen.join('\n') : '(no errors)');
  console.log(`body: ${text}`);
  await browser.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
