/**
 * Willow /customize (never the media tab), below 961px: measures the gaps above and below
 * the Discover / Connectors / Skills pills. Prints the boxes of the shell's menu button and
 * wordmark, the pills row, the selected pill, an unselected pill's label and the heading,
 * and where each one's ink really starts and ends — found by scanning a screenshot's pixel
 * rows, so glyph and text side bearings count as the eye sees them. Read-only.
 *
 *   node tools/scratch/cz-top-gap.cjs
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  await new Promise((r) => setTimeout(r, 400));
  const cdp = await page.createCDPSession();
  const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
  await cdp.detach();
  const out = await page.evaluate(async (png) => {
    const r1 = (n) => Math.round(n * 10) / 10;
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const k = img.width / innerWidth;
    /** First and last CSS-px rows in the box whose pixels differ from `bg` by more than `tol`. */
    const inkRows = (b, bg = [0, 0, 0], tol = 40) => {
      let first = null;
      let last = null;
      for (let y = Math.floor(b.top * k); y < Math.ceil(b.bottom * k); y += 1) {
        for (let x = Math.floor(b.left * k); x < Math.ceil(b.right * k); x += 1) {
          const i = (y * img.width + x) * 4;
          if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > tol) {
            if (first === null) first = y;
            last = y;
            break;
          }
        }
      }
      return first === null ? 'no ink' : `ink ${r1(first / k)}..${r1((last + 1) / k)}`;
    };
    const desc = (label, el, opts) => {
      if (!el) return `${label}: none`;
      const b = el.getBoundingClientRect();
      return `${label} box ${r1(b.top)}..${r1(b.bottom)} (x ${r1(b.left)}..${r1(b.right)}) ${inkRows(b, opts?.bg, opts?.tol)}`;
    };
    const lines = [`viewport ${innerWidth}x${innerHeight}, screenshot scale ${r1(k)}`];
    lines.push(desc('menu button', document.querySelector('.studio-sidebar-mobile-open')));
    lines.push(desc('wordmark', document.querySelector('.studio-mobile-wordmark-text')));
    lines.push(desc('new chat', document.querySelector('[aria-label="New Chat"]')));
    lines.push(desc('pills row', document.querySelector('.customize-nav-buttons'), { tol: 12 }));
    lines.push(desc('selected pill', document.querySelector('.customize-nav-button.selected'), { tol: 12 }));
    // An unselected pill's label alone: measure the text node's own box.
    const plain = document.querySelector('.customize-nav-button:not(.selected)');
    if (plain) {
      const range = document.createRange();
      range.selectNodeContents(plain);
      const b = range.getBoundingClientRect();
      lines.push(`unselected label box ${r1(b.top)}..${r1(b.bottom)} ${inkRows(b)}`);
    }
    lines.push(desc('title', document.querySelector('.customize-header-title, .customize-category-page-title')));
    lines.push(desc('subtitle', document.querySelector('.customize-header-subtitle')));
    return lines.join('\n');
  }, shot);
  console.log(out);
  browser.disconnect();
})();
