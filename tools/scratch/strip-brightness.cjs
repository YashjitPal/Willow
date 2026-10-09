// One-off: mean brightness of a horizontal strip in recorded frames, decoded in the :3101 page
// (no image library in node). Tells whether Flow's hover footer gradient actually darkens the tile.
//   node tools/scratch/strip-brightness.cjs <framesDir> <x> <y> <w> <h> [frame...]
const fs = require('fs');
const path = require('path');
const { session } = require('../../.agents/skills/clone-google-app-ui/scripts/cdp-kit.cjs');

const [dir, x, y, w, h, ...frames] = process.argv.slice(2);

(async () => {
  const s = await session({ tab: 'willow-test', out: 'tools/scratch' });
  const files = frames.length ? frames : fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
  for (const f of files) {
    const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
    const v = await s.page.evaluate(async (data, rx, ry, rw, rh) => {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${data}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const scale = img.naturalWidth / 1536;
      const d = g.getImageData(Math.round(rx * scale), Math.round(ry * scale), Math.round(rw * scale), Math.round(rh * scale)).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return { mean: Math.round((sum / (d.length / 4)) * 10) / 10, natural: [img.naturalWidth, img.naturalHeight] };
    }, b64, Number(x), Number(y), Number(w), Number(h));
    console.log(f, JSON.stringify(v));
  }
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
