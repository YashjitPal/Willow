const { loadImage, createCanvas } = require('canvas');
const fs = require('fs');
const [out, cssW, x, y, w, h, scale, ...files] = process.argv.slice(2);
(async () => {
  const imgs = await Promise.all(files.map((f) => loadImage(f)));
  const dpr = imgs[0].width / Number(cssW);
  const [px, py, pw, ph] = [x, y, w, h].map((v) => Math.round(Number(v) * dpr));
  const s = Number(scale);
  const gap = 6;
  const c = createCanvas(Math.round((pw * imgs.length + gap * (imgs.length - 1)) * s), Math.round(ph * s));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, c.width, c.height);
  imgs.forEach((img, i) => ctx.drawImage(img, px, py, pw, ph, Math.round(i * (pw + gap) * s), 0, Math.round(pw * s), Math.round(ph * s)));
  fs.writeFileSync(out, c.toBuffer('image/png'));
  console.log(`wrote ${out} ${c.width}x${c.height} dpr ${dpr}`);
})();
