// One channel change on Willow TV, sampled every 100ms: the URL, how many clips are mounted, the
// shader's canvas, and whether Next is disabled (it is while a transition runs). Uses the profile
// w-tv.cjs --keep seeded, in its own headless Chrome on :3101.
//   node tools/scratch/w-tv-debug.cjs
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ORIGIN = 'http://localhost:3101';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir: path.join(os.tmpdir(), 'willow-tv-probe'),
    defaultViewport: { width: 1536, height: 826, deviceScaleFactor: 1.25 },
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    protocolTimeout: 300000,
  });
  const page = (await browser.pages())[0];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`  console.${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => console.log(`  pageerror: ${String(e.message || e).slice(0, 200)}`));
  const sample = () => page.evaluate(() => ({
    t: (performance.now() / 1000).toFixed(1),
    url: location.pathname.replace('/tv/channel/', ''),
    clips: document.querySelectorAll('.wtv-video__outerContainer').length,
    shader: !!document.querySelector('.wtv-channel-shader-transition__canvas'),
    nextDisabled: document.querySelector('.wtv-controls__button[data-is-next]')?.getAttribute('data-is-disabled'),
    loop: document.querySelector('.wtv-controls__button[data-is-loop] .wtv-tooltip__tooltip')?.textContent,
    loaded: [...document.querySelectorAll('video.wtv-video__video')].map((v) => `${v.getAttribute('data-is-loaded')}:${v.readyState}`).join(','),
  }));
  try {
    await page.goto(`${ORIGIN}/tv/channel/ocean-days/tv-ocean-v0`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    for (let i = 0; i < 100; i += 1) {
      if (await page.evaluate(() => !!document.querySelector('.wtv-controls__button[data-is-loop]'))) break;
      await sleep(200);
    }
    console.log('landed', JSON.stringify(await sample()));
    for (let i = 0; i < 4 && (await sample()).loop !== 'Unloop'; i += 1) {
      await page.click('.wtv-controls__button[data-is-loop]');
      await sleep(300);
    }
    console.log('repeat', JSON.stringify(await sample()));
    // Two moves within the channel, then the next channel: the sequence w-tv.cjs runs.
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown']) {
      await page.keyboard.press(key);
      console.log(`-- ${key}`);
      for (let i = 0; i < (key === 'ArrowDown' ? 30 : 12); i += 1) {
        console.log(JSON.stringify(await sample()));
        await sleep(150);
      }
    }
  } finally {
    await browser.close();
  }
})();
