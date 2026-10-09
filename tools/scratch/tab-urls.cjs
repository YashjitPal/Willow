// Read-only: the full URL of every page in the debug Chrome whose URL matches a regex.
//   node tools/scratch/tab-urls.cjs [regex]
const puppeteer = require('puppeteer-core');

(async () => {
  const re = new RegExp(process.argv[2] || '.');
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const session = await browser.target().createCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  for (const t of targetInfos.filter((x) => x.type === 'page' && re.test(x.url))) console.log(t.url);
  await browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
