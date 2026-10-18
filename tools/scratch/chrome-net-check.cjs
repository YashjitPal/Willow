/**
 * Why the debug Chrome cannot open new connections, read from its own internals pages in this
 * work's window (own-window.cjs marker): the proxy it applies, how it resolves a host, and
 * whether a plain page loads. Read-only unless `--flush` is given, which presses "Flush socket
 * pools" (every idle and active socket in the profile is closed and reopened on demand).
 *
 *   node tools/scratch/chrome-net-check.cjs <marker> [host] [--flush]
 */
const puppeteer = require('puppeteer-core');

const [marker = 'willow-library-probe', host = 'gemini.google.com'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flush = process.argv.includes('--flush');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60_000 });
  const target = browser.targets().find((t) => t.type() === 'page' && t.url().includes(`#${marker}`));
  if (!target) throw new Error(`no window marked #${marker}`);
  const page = await target.page();
  const read = () => page.evaluate(() => document.body?.innerText.replace(/\n{2,}/g, '\n').slice(0, 1500));

  await page.goto('chrome://net-internals/#proxy');
  await sleep(1500);
  console.log('--- proxy\n' + await read());

  await page.goto('chrome://net-internals/#dns');
  await sleep(1500);
  await page.evaluate((name) => {
    const input = document.querySelector('#dns-view-dns-lookup-input');
    const submit = document.querySelector('#dns-view-dns-lookup-submit');
    if (input && submit) { input.value = name; submit.click(); }
  }, host);
  await sleep(4000);
  console.log(`--- dns lookup ${host}\n` + await page.evaluate(() => document.querySelector('#dns-view-dns-lookup-output')?.innerText || '(no output)'));

  if (flush) {
    await page.goto('chrome://net-internals/#sockets');
    await sleep(1500);
    const pressed = await page.evaluate(() => {
      const button = document.querySelector('#sockets-view-flush-button');
      button?.click();
      return Boolean(button);
    });
    console.log('--- flushed socket pools:', pressed);
    await sleep(1500);
  }

  for (const url of ['https://example.com/', `https://${host}/`]) {
    const t0 = Date.now();
    const result = await page.goto(`${url}#${marker}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      .then((response) => `HTTP ${response?.status()}`)
      .catch((error) => error.message.split('\n')[0]);
    console.log(`--- load ${url}: ${result} in ${Date.now() - t0}ms`);
  }
  await browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
