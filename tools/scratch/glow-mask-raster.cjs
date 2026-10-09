/**
 * Rasterises apps/studio/public/glow-mask.svg to a bitmap in the Willow page (the same
 * renderer that paints the mask), writes it next to the SVG, and reports how far the bitmap
 * drawn at the desktop glow's size strays from the SVG drawn at that size, alpha channel only.
 *
 *   node tools/scratch/glow-mask-raster.cjs <width> <png|webp> [out-name]
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

(async () => {
  const [width = '742', format = 'png', outName] = process.argv.slice(2);
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 120000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  const res = await page.evaluate(async (w, fmt) => {
    const load = async (src) => { const img = new Image(); img.src = src; await img.decode(); return img; };
    const svg = await load('/glow-mask.svg');
    const W = Number(w);
    const H = Math.round((W * svg.naturalHeight) / svg.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d').drawImage(svg, 0, 0, W, H);
    const blob = await new Promise((r) => canvas.toBlob(r, `image/${fmt}`, 1));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));

    // Both drawn at the desktop glow's mask size (1601.27 wide, the SVG's 1484:2070), alpha compared.
    const bitmap = await load(URL.createObjectURL(blob));
    const DW = 1601;
    const DH = Math.round((DW * svg.naturalHeight) / svg.naturalWidth);
    const alpha = (img) => {
      const c = document.createElement('canvas');
      c.width = DW;
      c.height = DH;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, DW, DH);
      const d = ctx.getImageData(0, 0, DW, DH).data;
      const out = new Uint8Array(DW * DH);
      for (let i = 0; i < out.length; i += 1) out[i] = d[i * 4 + 3];
      return out;
    };
    const a = alpha(svg);
    const b = alpha(bitmap);
    let max = 0;
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) {
      const diff = Math.abs(a[i] - b[i]);
      if (diff > max) max = diff;
      sum += diff;
    }
    return { W, H, bytes: bytes.length, base64: btoa(bin), maxDiff: max, meanDiff: sum / a.length };
  }, width, format);
  const name = outName || `glow-mask-${res.W}.${format}`;
  const file = path.join('apps', 'studio', 'public', name);
  fs.writeFileSync(file, Buffer.from(res.base64, 'base64'));
  console.log(`${file}: ${res.W}x${res.H}, ${(res.bytes / 1024).toFixed(1)} KB; alpha vs SVG at 1601px wide: max ${res.maxDiff}/255, mean ${res.meanDiff.toFixed(3)}/255`);
  browser.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
