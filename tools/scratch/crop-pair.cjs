/**
 * Two screenshots' same region, stacked into one image at full resolution, for a
 * side-by-side read of fine detail (Gemini above, Willow below).
 *
 *   node tools/scratch/crop-pair.cjs <a.png> <b.png> <css width of both> <x> <y> <w> <h> <out.png> [scale]
 */
const { loadImage, createCanvas } = require('canvas');
const fs = require('fs');

(async () => {
  const [a, b, cssWidth, x, y, w, h, out, scaleArg] = process.argv.slice(2);
  const images = [await loadImage(a), await loadImage(b)];
  const dpr = images[0].width / Number(cssWidth);
  const scale = Number(scaleArg || 1);
  const [px, py, pw, ph] = [x, y, w, h].map((v) => Math.round(Number(v) * dpr));
  const gap = 8;
  const canvas = createCanvas(Math.round(pw * scale), Math.round((ph * 2 + gap) * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#ff00ff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((image, index) => {
    context.drawImage(image, px, py, pw, ph, 0, Math.round(index * (ph + gap) * scale), Math.round(pw * scale), Math.round(ph * scale));
  });
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`wrote ${out} (${canvas.width}x${canvas.height}, dpr ${dpr.toFixed(2)})`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
