/*
 * Summarises a send-flow-record.cjs timeline: each role's distinct states over time, the
 * response's text growth, the scroller, and DOM insertions in chosen windows.
 *
 *   node tools/scratch/send-flow-analyze.cjs <app>-<label> [fromMs] [toMs]
 *
 * fromMs/toMs bound the mutation log printout (default -200..1500).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const [run, fromArg, toArg] = process.argv.slice(2);
const dir = path.join(os.tmpdir(), 'willow-emulator', `send-${run}`);
const { app, sendT, log, samples } = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
const from = Number(fromArg ?? -200);
const to = Number(toArg ?? 1500);

console.log(`== ${app} (${run}) — send at page t=${sendT}; times below are ms after the send tap`);
const roles = new Set(samples.flatMap((s) => Object.keys(s.items)));
for (const role of roles) {
  if (role === 'scroller') continue;
  console.log(`-- ${role}`);
  let prev = null;
  let since = null;
  const flush = (until) => prev && console.log(`   ${String(since).padStart(8)} .. ${String(until).padStart(8)}  ${prev}`);
  for (const s of samples) {
    const item = s.items[role];
    const state = item ? JSON.stringify({ rect: item.rect, opacity: item.opacity, transform: item.transform }) : 'absent';
    if (state !== prev) {
      flush(s.t);
      prev = state;
      since = s.t;
    }
  }
  flush(samples[samples.length - 1].t);
}

console.log('-- scroller (scrollTop / scrollHeight changes)');
let lastScroll = null;
let printed = 0;
for (const s of samples) {
  const sc = s.items.scroller;
  if (!sc) continue;
  const key = `${sc.scrollTop}/${sc.scrollHeight}`;
  if (key !== lastScroll && printed < 60) {
    console.log(`   t=${s.t}  scrollTop=${sc.scrollTop} scrollHeight=${sc.scrollHeight} rect=${JSON.stringify(sc.rect)}`);
    lastScroll = key;
    printed++;
  }
}

console.log('-- response text growth (t: chars)');
let lastChars = -1;
const growth = [];
for (const s of samples) {
  const r = s.items.response;
  if (r && r.chars !== lastChars) {
    growth.push(`${s.t}:${r.chars}`);
    lastChars = r.chars;
  }
}
console.log(`   ${growth.length} changes: ${growth.slice(0, 80).join('  ')}`);

console.log(`-- DOM mutations ${from}..${to}ms (area >= 400 or with text)`);
const seen = new Set();
for (const entry of log) {
  if (entry.t < from || entry.t > to) continue;
  const area = entry.rect ? entry.rect[2] * entry.rect[3] : 0;
  if (entry.op === '+' && area < 400 && !entry.text) continue;
  const key = `${entry.op}${entry.tag}.${entry.cls}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`   t=${entry.t} ${entry.op} <${entry.tag}${entry.cls ? `.${entry.cls}` : ''}>${entry.rect ? ` ${JSON.stringify(entry.rect)}` : ''}${entry.text ? ` "${entry.text}"` : ''}`);
}
