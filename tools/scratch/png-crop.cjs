/**
 * Crops and zooms a PNG, and optionally reports colour runs along a line, for measuring
 * a screenshot at pixel level.
 *
 *   node tools/scratch/png-crop.cjs <in.png> <x> <y> <w> <h> <zoom> <out.png>
 *   node tools/scratch/png-crop.cjs <in.png> --col=<x> [--from=0 --to=200]   colour runs down a column
 *   node tools/scratch/png-crop.cjs <in.png> --row=<y> [--from=0 --to=1280]  colour runs along a row
 *   node tools/scratch/png-crop.cjs <in.png> --at=<x>,<y> [--at=...]          single pixels
 */
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');

const args = process.argv.slice(2);
const flag = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
const positional = args.filter((a) => !a.startsWith('--'));

(async () => {
  const image = await loadImage(fs.readFileSync(positional[0]));
  const base = createCanvas(image.width, image.height);
  const ctx = base.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const pixel = (x, y) => {
    const d = ctx.getImageData(x, y, 1, 1).data;
    return `rgb(${d[0]},${d[1]},${d[2]})`;
  };
  const col = flag('col')[0];
  const row = flag('row')[0];
  const from = Number(flag('from')[0] ?? 0);
  // --spans: the [start, end] runs along the line that differ from --bg (default: the first pixel).
  if (args.includes('--spans') && (col !== undefined || row !== undefined)) {
    const to = Number(flag('to')[0] ?? (col !== undefined ? image.height : image.width));
    const at = (i) => (col !== undefined ? pixel(Number(col), i) : pixel(i, Number(row)));
    const bg = flag('bg')[0] ? `rgb(${flag('bg')[0]})` : at(from);
    const spans = [];
    let start = -1;
    let darkest = null;
    for (let i = from; i <= to; i += 1) {
      const c = i === to ? bg : at(i);
      if (c !== bg && start < 0) { start = i; darkest = c; }
      if (c !== bg && start >= 0) {
        const lum = (s) => s.match(/\d+/g).slice(0, 3).reduce((a, b) => a + Number(b), 0);
        if (lum(c) < lum(darkest)) darkest = c;
      }
      if (c === bg && start >= 0) { spans.push(`${start}..${i - 1} (${i - start}) ${darkest}`); start = -1; }
    }
    console.log(`bg ${bg}`);
    console.log(spans.join('\n'));
    return;
  }
  if (col !== undefined || row !== undefined) {
    const to = Number(flag('to')[0] ?? (col !== undefined ? image.height : image.width));
    let runStart = from;
    let runColor = col !== undefined ? pixel(Number(col), from) : pixel(from, Number(row));
    for (let i = from + 1; i <= to; i += 1) {
      const c = i === to ? null : (col !== undefined ? pixel(Number(col), i) : pixel(i, Number(row)));
      if (c !== runColor) {
        console.log(`${String(runStart).padStart(5)}..${String(i - 1).padEnd(5)} (${i - runStart}px) ${runColor}`);
        runStart = i;
        runColor = c;
      }
    }
    return;
  }
  // --grid=x,y,w,h: a character map of darkness against the region's lightest pixel.
  const grid = flag('grid')[0];
  if (grid) {
    const [gx, gy, gw, gh] = grid.split(',').map(Number);
    const data = ctx.getImageData(gx, gy, gw, gh).data;
    const lum = (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let light = 0;
    for (let i = 0; i < data.length; i += 4) light = Math.max(light, lum(i));
    const ramp = ' .:-=+*#%@';
    console.log(`     ${Array.from({ length: gw }, (_, i) => String((gx + i) % 10)).join('')}`);
    for (let row = 0; row < gh; row += 1) {
      let line = '';
      for (let col = 0; col < gw; col += 1) {
        const darkness = Math.max(0, light - lum((row * gw + col) * 4)) / Math.max(1, light);
        line += ramp[Math.min(ramp.length - 1, Math.round(darkness * (ramp.length - 1) * 1.3))];
      }
      console.log(`${String(gy + row).padStart(4)} ${line}`);
    }
    return;
  }
  const at = flag('at');
  if (at.length) {
    for (const point of at) {
      const [x, y] = point.split(',').map(Number);
      console.log(`${x},${y} ${pixel(x, y)}`);
    }
    return;
  }
  const [, x, y, w, h, zoom, out] = positional;
  const z = Number(zoom || 1);
  const canvas = createCanvas(Number(w) * z, Number(h) * z);
  const c2 = canvas.getContext('2d');
  c2.imageSmoothingEnabled = false;
  c2.drawImage(base, Number(x), Number(y), Number(w), Number(h), 0, 0, Number(w) * z, Number(h) * z);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`${image.width}x${image.height} -> ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
