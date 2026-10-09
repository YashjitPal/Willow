// Samples pixel colours from a capture PNG in the isolated headless Chrome (port 9333).
//   node tools/scratch/sample-colors.cjs <png> x,y x,y ...   (coordinates in the PNG's own pixels)
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

(async () => {
  const [file, ...points] = process.argv.slice(2);
  const data = fs.readFileSync(path.resolve(file)).toString('base64');
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
  const page = await browser.newPage();
  try {
    const out = await page.evaluate(async (b64, pts) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return { size: [c.width, c.height], colors: pts.map((p) => { const [x, y] = p.split(',').map(Number); const d = ctx.getImageData(x, y, 1, 1).data; return `${p} rgb(${d[0]}, ${d[1]}, ${d[2]})`; }) };
    }, data, points);
    console.log(JSON.stringify(out, null, 1));
  } finally { await page.close(); browser.disconnect(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
