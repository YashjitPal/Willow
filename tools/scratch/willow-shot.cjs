/**
 * Brings the Willow tab (the :3000 tab that is not the user's /media one) to the front,
 * optionally navigates it, and saves a screenshot.
 *
 *   node tools/scratch/willow-shot.cjs <out.png> [--goto=/spark] [--wait=1500] [--clip=x,y,w,h]
 */
const puppeteer = require('puppeteer-core');

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

(async () => {
  const out = args.find((a) => !a.startsWith('--')) || 'willow.png';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  await page.bringToFront();
  const goto = flag('goto');
  if (goto) await page.goto(`http://localhost:3000${goto}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, Number(flag('wait') || 900)));
  const clip = flag('clip');
  const options = { path: out };
  if (clip) {
    const [x, y, width, height] = clip.split(',').map(Number);
    options.clip = { x, y, width, height };
  }
  await page.screenshot(options);
  const info = await page.evaluate(() => ({ url: location.href, w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
  console.log(JSON.stringify(info), `-> ${out}`);
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
