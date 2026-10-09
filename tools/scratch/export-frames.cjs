// One-off: decodes frame N of an MP4 (WebCodecs, own headless Chrome) and saves it as a PNG; with a
// second file and frame, also the PSNR between the two frames at full resolution.
//   node tools/scratch/export-frames.cjs <a.mp4> <frameA> [<b.mp4> <frameB>]
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { readMp4 } = require('../ui-research/scrapers/flow/media/lib-mp4.cjs');

async function grab(page, file, index) {
  const { buf, tracks } = readMp4(file);
  const t = tracks.find((x) => x.handler === 'vide');
  const order = t.samples.map((s, i) => ({ ...s, i })).sort((a, b) => a.pts - b.pts);
  const target = order[index];
  // Decode from the keyframe before the target (decode order) through the target.
  const byDts = [...t.samples].sort((a, b) => a.dts - b.dts);
  let first = 0;
  byDts.forEach((s, k) => { if (s.key && s.dts <= target.dts) first = k; });
  const list = byDts.slice(first, byDts.findIndex((s) => s.dts > target.pts + 0.5) + 1 || undefined)
    .map((s) => ({ data: buf.subarray(s.offset, s.offset + s.size).toString('base64'), pts: Math.round(s.pts * 1e6), key: s.key }));
  return page.evaluate(async (codec, config, w, h, chunks, wantPts) => {
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    let hit = null;
    const dec = new VideoDecoder({ output: (f) => { if (!hit && Math.abs(f.timestamp - wantPts) < 2000) { const c = new OffscreenCanvas(f.displayWidth, f.displayHeight); c.getContext('2d').drawImage(f, 0, 0); hit = c; } f.close(); }, error: () => {} });
    dec.configure({ codec, description: bytes(config), codedWidth: w, codedHeight: h });
    for (const s of chunks) dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: s.pts, data: bytes(s.data) }));
    await dec.flush();
    const blob = await hit.convertToBlob({ type: 'image/png' });
    const data = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return btoa(bin);
  }, t.codec, t.config.toString('base64'), t.width, t.height, list, Math.round(target.pts * 1e6));
}

(async () => {
  const [a, ia, b, ib] = process.argv.slice(2);
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:3101/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  const pa = await grab(page, a, Number(ia));
  const outA = path.join(path.dirname(a), `${path.basename(a, '.mp4')}-f${ia}.png`);
  fs.writeFileSync(outA, Buffer.from(pa, 'base64'));
  console.log('saved', outA);
  if (b) {
    const pb = await grab(page, b, Number(ib));
    console.log('psnr', JSON.stringify(await page.evaluate(async (x, y) => {
      const load = async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); return img; };
      const [A, B] = [await load(x), await load(y)];
      const c = document.createElement('canvas');
      c.width = A.naturalWidth; c.height = A.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(A, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
      g.drawImage(B, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
      let se = 0;
      for (let i = 0; i < da.length; i += 4) for (let k = 0; k < 3; k += 1) se += (da[i + k] - db[i + k]) ** 2;
      const mse = se / (da.length * 0.75);
      return { size: `${c.width}x${c.height}`, psnrDb: Math.round(10 * Math.log10((255 * 255) / mse) * 100) / 100 };
    }, pa, pb)));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
