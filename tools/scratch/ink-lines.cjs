/**
 * Text lines in a screenshot, for text a canvas drew (Google Docs) where there is no DOM
 * to measure: each run of rows with dark ink, its top, bottom, left and right edges, in
 * CSS pixels. The scale is the image's width over the CSS width it shows.
 *
 *   node tools/scratch/ink-lines.cjs <png> <css width of the image> [x y w h in css px] [--dark=128]
 */
const { loadImage, createCanvas } = require('canvas');

(async () => {
  const args = process.argv.slice(2);
  const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
  const [file, cssWidth, ...region] = args.filter((a) => !a.startsWith('--'));
  const image = await loadImage(file);
  const scale = image.width / Number(cssWidth);
  const [x = 0, y = 0, w = image.width / scale, h = image.height / scale] = region.map(Number);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const px = (v) => Math.round(v * scale);
  const data = context.getImageData(px(x), px(y), px(w), px(h));
  const dark = Number(flags.dark ?? 128);
  const rows = [];
  for (let row = 0; row < data.height; row += 1) {
    let left = -1;
    let right = -1;
    for (let col = 0; col < data.width; col += 1) {
      const i = (row * data.width + col) * 4;
      const luminance = 0.2126 * data.data[i] + 0.7152 * data.data[i + 1] + 0.0722 * data.data[i + 2];
      if (luminance < dark) {
        if (left === -1) left = col;
        right = col;
      }
    }
    rows.push(left === -1 ? null : [left, right]);
  }
  const lines = [];
  let current = null;
  rows.forEach((ink, row) => {
    if (ink) {
      if (!current) current = { top: row, bottom: row, left: ink[0], right: ink[1] };
      else {
        current.bottom = row;
        current.left = Math.min(current.left, ink[0]);
        current.right = Math.max(current.right, ink[1]);
      }
    } else if (current) {
      lines.push(current);
      current = null;
    }
  });
  if (current) lines.push(current);
  const css = (v) => Math.round((v / scale) * 10) / 10;
  console.log(`image ${image.width}x${image.height}, scale ${scale.toFixed(3)}; region ${x},${y} ${w}x${h}`);
  let previousTop = null;
  for (const line of lines) {
    const top = css(line.top) + y;
    console.log(`top ${top.toFixed(1).padStart(7)}  height ${css(line.bottom - line.top + 1).toFixed(1).padStart(5)}  left ${(css(line.left) + x).toFixed(1).padStart(7)}  right ${(css(line.right) + x).toFixed(1).padStart(7)}${previousTop === null ? '' : `  pitch ${(top - previousTop).toFixed(1)}`}`);
    previousTop = top;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
