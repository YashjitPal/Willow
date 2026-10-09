/**
 * Renders Willow's remote-browser Chrome frame at 1:1 device pixels (a temporary clone
 * pinned to the top-left of the Willow tab, zoomed to cancel the tab's DPR), screenshots
 * it, and stacks it over the same 1280×87 band of Gemini's VNC framebuffer with a
 * difference map, so the two can be compared pixel for pixel.
 *
 *   node tools/scratch/rb-chrome-compare.cjs <out.png>
 *
 * Needs a remote-browser pane open in the Willow tab. Removes the clone afterwards.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

(async () => {
  const out = process.argv[2] || 'tools/ui-research/captures/spark/134-remote-browser/willow/chrome-compare.png';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  await page.bringToFront();
  const dpr = await page.evaluate(() => {
    const chrome = document.querySelector('.spark-remote-browser__chrome');
    if (!chrome) throw new Error('no remote-browser chrome on screen');
    const clone = chrome.cloneNode(true);
    clone.id = 'rb-chrome-compare-clone';
    clone.style.cssText += ';position:fixed;top:0;left:0;z-index:2147483647;transform:none;';
    clone.style.zoom = String(1 / devicePixelRatio);
    document.body.appendChild(clone);
    return devicePixelRatio;
  });
  await new Promise((r) => setTimeout(r, 400));
  const shotPath = out.replace(/\.png$/, '.willow.png');
  await page.screenshot({ path: shotPath, clip: { x: 0, y: 0, width: 1280 / dpr, height: 87 / dpr } });
  await page.evaluate(() => document.getElementById('rb-chrome-compare-clone')?.remove());
  browser.disconnect();

  const willow = await loadImage(fs.readFileSync(shotPath));
  const gemini = await loadImage(fs.readFileSync(path.join('tools', 'ui-research', 'captures', 'spark', '134-remote-browser', 'vnc-frame.png')));
  const W = 1280;
  const H = 87;
  const canvas = createCanvas(W, H * 3 + 8);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, W, H * 3 + 8);
  ctx.drawImage(gemini, 0, 0, W, H, 0, 0, W, H);
  ctx.drawImage(willow, 0, 0, willow.width, willow.height, 0, H + 4, W, H);
  const a = ctx.getImageData(0, 0, W, H).data;
  const b = ctx.getImageData(0, H + 4, W, H).data;
  const diff = ctx.createImageData(W, H);
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    const v = Math.min(255, d);
    if (d > 30) differing += 1;
    diff.data[i] = v;
    diff.data[i + 1] = d > 30 ? 0 : v;
    diff.data[i + 2] = d > 30 ? 0 : v;
    diff.data[i + 3] = 255;
  }
  ctx.putImageData(diff, 0, H * 2 + 8);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`willow ${willow.width}x${willow.height} (dpr ${dpr}); ${(100 * differing / (W * H)).toFixed(2)}% of pixels differ by >30 -> ${out}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
