// Compares two folders of PNG screenshots pixel by pixel and prints, per file, the share of
// pixels that differ by more than a small tolerance. Decodes PNG itself (8-bit RGB/RGBA, not
// interlaced: what Chrome's screenshots are), so it needs no image library.
// Usage: node tools/scratch/png-diff.cjs <baseline dir> <current dir> [--tolerance=24] [--out=<dir>]
// With --out, writes a diff mask per differing file (changed pixels in red) as a PNG.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = process.argv.slice(2);
const [baseDir, curDir] = args.filter((a) => !a.startsWith('--'));
const tolerance = Number((args.find((a) => a.startsWith('--tolerance=')) || '--tolerance=24').split('=')[1]);
const outDir = (args.find((a) => a.startsWith('--out=')) || '').slice(6) || null;

function decode(file) {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error(`${file}: unsupported bit depth or interlace`);
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`${file}: unsupported colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (line[x] + add) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      px[o] = line[x * channels];
      px[o + 1] = line[x * channels + 1];
      px[o + 2] = line[x * channels + 2];
      px[o + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    prev = line;
  }
  return { width, height, px };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function encode(width, height, rgba) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (outDir) fs.mkdirSync(outDir, { recursive: true });
const files = fs.readdirSync(baseDir).filter((f) => f.endsWith('.png')).sort();
for (const file of files) {
  const current = path.join(curDir, file);
  if (!fs.existsSync(current)) { console.log(`${file.padEnd(28)} missing`); continue; }
  const a = decode(path.join(baseDir, file));
  const b = decode(current);
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`${file.padEnd(28)} size ${a.width}x${a.height} -> ${b.width}x${b.height}`);
    continue;
  }
  let changed = 0;
  const mask = outDir ? Buffer.alloc(a.px.length) : null;
  for (let i = 0; i < a.px.length; i += 4) {
    const d = Math.max(Math.abs(a.px[i] - b.px[i]), Math.abs(a.px[i + 1] - b.px[i + 1]), Math.abs(a.px[i + 2] - b.px[i + 2]));
    if (d > tolerance) {
      changed += 1;
      if (mask) { mask[i] = 255; mask[i + 3] = 255; }
    } else if (mask) {
      const g = (b.px[i] + b.px[i + 1] + b.px[i + 2]) / 9;
      mask[i] = g; mask[i + 1] = g; mask[i + 2] = g; mask[i + 3] = 255;
    }
  }
  const share = (100 * changed) / (a.width * a.height);
  console.log(`${file.padEnd(28)} ${share.toFixed(3).padStart(8)}%  ${changed} px`);
  if (mask && changed) fs.writeFileSync(path.join(outDir, file), encode(a.width, a.height, mask));
}
