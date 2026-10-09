// Navigates the probe tab (the one marked #willow-probe) to a URL, keeping the marker on it.
//   node tools/scratch/flow-probe-goto.cjs <url>
const puppeteer = require('puppeteer-core');

(async () => {
  const url = process.argv[2];
  if (!url) throw new Error('give a URL');
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  // Flow tabs only: other agents' tabs (Gemini Spark's) carry #willow-probe too.
  const pages = (await browser.pages()).filter((p) => p.url().includes('#willow-probe') && p.url().includes('flow.google.com'));
  if (pages.length !== 1) throw new Error(`expected one probe tab, found ${pages.length}`);
  await pages[0].goto(`${url.replace(/#.*$/, '')}#willow-probe`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 6000));
  await pages[0].evaluate(() => { if (!location.hash.includes('willow-probe')) history.replaceState(history.state, '', `${location.pathname}${location.search}#willow-probe`); });
  console.log(pages[0].url());
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
