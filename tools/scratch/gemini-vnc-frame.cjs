/**
 * Saves the Gemini Spark remote-browser VNC canvas at its intrinsic resolution, read-only:
 * prints the framebuffer size and writes it as a PNG.
 *
 *   node tools/scratch/gemini-vnc-frame.cjs [out.png]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const out = process.argv[2] || path.join('tools', 'ui-research', 'captures', 'spark', '134-remote-browser', 'vnc-frame.png');
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('https://gemini.google.com/'));
  if (!page) throw new Error('no gemini tab');
  const info = await page.evaluate(() => {
    const canvas = document.querySelector('remy-side-panel vnc-viewer canvas, computer-use-panel vnc-viewer canvas');
    if (!canvas) return { error: 'no canvas' };
    const r = canvas.getBoundingClientRect();
    let data = null;
    let error = null;
    try { data = canvas.toDataURL('image/png'); } catch (e) { error = e.message; }
    return { width: canvas.width, height: canvas.height, css: [r.width, r.height], data, error };
  });
  console.log(JSON.stringify({ width: info.width, height: info.height, css: info.css, error: info.error || info.data === null ? info.error : undefined }));
  if (info.data) {
    fs.writeFileSync(out, Buffer.from(info.data.split(',')[1], 'base64'));
    console.log(`saved ${out}`);
  }
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
