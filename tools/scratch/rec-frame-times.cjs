/**
 * Prints the screencast frames of a cdp-kit recording with their time from the first mark.
 *
 *   node tools/scratch/rec-frame-times.cjs <recording dir>
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const rec = JSON.parse(fs.readFileSync(path.join(dir, 'recording.json'), 'utf8'));
const keys = Object.keys(rec);
const events = rec.events || rec.log || [];
const mark = events.find((e) => e.type === 'mark' || e.k === 'mark');
const markPage = mark ? (mark.t ?? mark.time ?? 0) : 0;
const frames = rec.frames || events.filter((e) => /frame/.test(e.type || e.k || ''));
const frameTime = (f) => f.t ?? f.time ?? f.ts;
// Frames are stamped in wall-clock ms, marks in page time from timeOrigin.
const t0 = frameTime(frames[0]) > 1e11 ? rec.timeOrigin + markPage : markPage;
console.log(`keys: ${keys.join(', ')}; ${events.length} events; mark at page ${markPage}`);
const all = process.argv.includes('--all');
const withSize = process.argv.includes('--size');
let prevSize = 0;
frames.slice(0, all ? frames.length : 40).forEach((f, i) => {
  const name = String(f.file || f.name || f.i || `${String(i + 1).padStart(5, '0')}.jpg`);
  let size = '';
  if (withSize) {
    const p = path.join(dir, 'frames', name.endsWith('.jpg') ? name : `${String(i + 1).padStart(5, '0')}.jpg`);
    const bytes = fs.existsSync(p) ? fs.statSync(p).size : 0;
    size = ` ${(bytes / 1024).toFixed(1)}KB${Math.abs(bytes - prevSize) > 4096 ? ' *' : ''}`;
    prevSize = bytes;
  }
  console.log(`${name.padEnd(12)} ${Math.round(frameTime(f) - t0)}ms${size}`);
});
