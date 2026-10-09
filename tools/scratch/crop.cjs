// Crops a region of a screenshot given in CSS pixels, scaled up for a close look.
//   node tools/scratch/crop.cjs <in.png> <out.png> <x> <y> <w> <h> [dpr=1.25] [zoom=4]
const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');

const [input, output, x, y, w, h, dpr = '1.25', zoom = '4'] = process.argv.slice(2);
(async () => {
  const img = await loadImage(input);
  const d = Number(dpr);
  const z = Number(zoom);
  const canvas = createCanvas(Math.round(Number(w) * d * z), Math.round(Number(h) * d * z));
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, Number(x) * d, Number(y) * d, Number(w) * d, Number(h) * d, 0, 0, canvas.width, canvas.height);
  fs.writeFileSync(output, canvas.toBuffer('image/png'));
  console.log(`${img.width}x${img.height} -> ${output}`);
})();
