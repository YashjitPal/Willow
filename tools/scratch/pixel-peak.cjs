// The brightest pixel in each CSS-pixel rect of a screenshot: a glyph's drawn colour at its core.
//   node tools/scratch/pixel-peak.cjs <shot.png> <dpr> name=x,y,w,h [name=x,y,w,h ...]
const { createCanvas, loadImage } = require('canvas');

const [file, dpr, ...rects] = process.argv.slice(2);
(async () => {
  const img = await loadImage(file);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = Number(dpr);
  for (const spec of rects) {
    const [name, box] = spec.split('=');
    const [x, y, w, h] = box.split(',').map(Number);
    const data = g.getImageData(Math.round(x * d), Math.round(y * d), Math.round(w * d), Math.round(h * d)).data;
    let best = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > best[0] + best[1] + best[2]) best = [data[i], data[i + 1], data[i + 2]];
    console.log(`${name.padEnd(12)} rgb(${best.join(', ')})`);
  }
})();
