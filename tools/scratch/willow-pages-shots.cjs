/**
 * Screenshots Willow pages (the Gems/chat tab, never the media tab) at the current
 * emulator size: routes by pushState, waits, captures. Optionally opens the settings
 * modal on a tab via the shell's own settings click path is not available here, so
 * modal shots use --modal=<tab> which dispatches a click on the matching settings row.
 *
 *   node tools/scratch/willow-pages-shots.cjs --prefix=tab /labs /models-settings /memory /search
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const args = process.argv.slice(2);
  const prefix = (args.find((a) => a.startsWith('--prefix=')) || '--prefix=shot').slice(9);
  const paths = args.filter((a) => a.startsWith('/'));
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  for (const path of paths) {
    await page.evaluate((to) => { history.pushState({}, '', to); dispatchEvent(new PopStateEvent('popstate')); }, path);
    await new Promise((r) => setTimeout(r, 2200));
    const info = await page.evaluate(() => {
      const main = document.querySelector('main');
      const scrollers = [...document.querySelectorAll('main *')].filter((el) => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'visible' && el.clientWidth > 0);
      return `${location.pathname} ${innerWidth}x${innerHeight} doc scrollW ${document.documentElement.scrollWidth} main ${main ? Math.round(main.getBoundingClientRect().width) : '-'} h-overflowing ${scrollers.length}`;
    });
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = `${process.env.TEMP}/${prefix}-${path.replace(/\W+/g, '_').replace(/^_|_$/g, '')}.png`;
    require('fs').writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(info, '->', file.split(/[\\/]/).pop());
  }
  await cdp.detach();
  browser.disconnect();
})();
