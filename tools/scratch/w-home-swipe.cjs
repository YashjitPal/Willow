// Media's home on a phone, on the :3101 test origin, in the responsive harness's own headless
// Chrome profile: a finger swipe across the promo moves a slide either way, and an upright swipe
// still scrolls the page.
//   node tools/scratch/w-home-swipe.cjs
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir: path.join(os.tmpdir(), 'willow-responsive-profile'),
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  const page = (await browser.pages())[0];
  try {
    await page.goto('http://localhost:3101/?mode=media', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('.mh-promo-title', { timeout: 60000 });
    await sleep(2500);
    const title = () => page.evaluate(() => document.querySelector('.mh-promo-title')?.textContent ?? null);
    // A slide is settled once its text has faded back in.
    const settled = () => page.waitForFunction(() => document.querySelector('.mh-promo-text')?.classList.contains('opacity-100'), { timeout: 8000 }).catch(() => null);
    const swipe = async (fromX, toX, y) => {
      await page.touchscreen.touchStart(fromX, y);
      for (let i = 1; i <= 8; i += 1) await page.touchscreen.touchMove(fromX + ((toX - fromX) * i) / 8, y);
      await page.touchscreen.touchEnd();
    };
    // Hold the playlist still, so only a swipe moves it.
    await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.pause()));
    await settled();
    const promo = await page.evaluate(() => { const r = document.querySelector('.mh-promo').getBoundingClientRect(); return { y: Math.round(r.top + r.height * 0.4), left: Math.round(r.left), right: Math.round(r.right) }; });

    const first = await title();
    await swipe(promo.right - 40, promo.left + 60, promo.y);
    await sleep(1600);
    await settled();
    const next = await title();
    check('a swipe to the left shows the next slide', next && next !== first, { first, next });

    await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.pause()));
    await swipe(promo.left + 60, promo.right - 40, promo.y);
    await sleep(1600);
    await settled();
    const back = await title();
    check('a swipe to the right goes back', back === first, { back, first });

    const scrolledBefore = await page.evaluate(() => document.querySelector('.media-home').scrollTop);
    await page.touchscreen.touchStart(195, 700);
    for (let i = 1; i <= 8; i += 1) await page.touchscreen.touchMove(195, 700 - i * 40);
    await page.touchscreen.touchEnd();
    await sleep(900);
    const scrolledAfter = await page.evaluate(() => document.querySelector('.media-home').scrollTop);
    check('an upright swipe scrolls the page', scrolledAfter > scrolledBefore, { scrolledBefore, scrolledAfter });
    const stayed = await title();
    check('and leaves the slide alone', stayed === back, { stayed });
  } catch (e) {
    failures += 1;
    console.error('FAILED:', e.stack || e.message);
  } finally {
    await browser.close();
    console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
    process.exit(failures ? 1 : 0);
  }
})();
