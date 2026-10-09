// Puts the #willow-probe marker back on the probe tab after Flow's router dropped it, finding the
// tab by a substring only that tab's URL has (e.g. the test character's id), or by its whole URL
// with a leading "=" when another tab's URL contains the probe's. replaceState, so no navigation
// or hashchange reaches the app.
//   node tools/scratch/flow-remark.cjs <url-substring | =exact-url>
const puppeteer = require('puppeteer-core');

(async () => {
  const needle = process.argv[2];
  if (!needle) throw new Error('give a substring of the probe tab URL');
  const exact = needle.startsWith('=') ? needle.slice(1) : null;
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  // Flow tabs only: other agents' tabs (Gemini Spark's) carry #willow-probe too.
  const pages = (await browser.pages()).filter((p) => p.url().includes('flow.google.com') && (exact ? p.url().replace(/#.*$/, '') === exact : p.url().includes(needle)));
  if (pages.length !== 1) throw new Error(`expected one tab with ${needle}, found ${pages.length}`);
  await pages[0].evaluate(() => { if (!location.hash.includes('willow-probe')) history.replaceState(history.state, '', `${location.pathname}${location.search}#willow-probe`); });
  console.log(pages[0].url());
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
