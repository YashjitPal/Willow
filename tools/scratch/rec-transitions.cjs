/**
 * Prints the transitions and animations of a cdp-kit recording inside a time window,
 * measured from a mark: what started, on which element, with its timing.
 *
 *   node tools/scratch/rec-transitions.cjs <recording dir> <mark label> <fromMs> <toMs> [element regex] [--nth=N]
 *
 * `--nth` picks the Nth mark with that label (1-based).
 */
const fs = require('fs');
const path = require('path');

const [dir, markLabel, fromArg, toArg, pattern] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const nth = Number((process.argv.find((a) => a.startsWith('--nth=')) || '--nth=1').slice(6));
const rec = JSON.parse(fs.readFileSync(path.join(dir, 'recording.json'), 'utf8'));
const events = rec.events || [];
const marks = events.filter((e) => e.k === 'mark' && (!markLabel || e.label === markLabel));
const mark = marks[nth - 1] || marks[0];
if (!mark) throw new Error(`no mark ${markLabel}`);
const from = Number(fromArg || 0);
const to = Number(toArg || 5000);
const re = pattern ? new RegExp(pattern, 'i') : null;
const describe = (el) => (el ? `${el.tag}${el.cls ? `.${String(el.cls).trim().split(/\s+/).slice(0, 4).join('.')}` : ''} [${(el.rect || []).map((n) => Math.round(n)).join(',')}]` : '?');
const kinds = /^(transitionrun|transitionstart|transitionend|transitioncancel|animationstart|animationend|animationcancel|CSSAnimation|CSSTransition|Animation|waapi)$/;
for (const e of events) {
  if (!kinds.test(e.k)) continue;
  const t = e.t - mark.t;
  if (t < from || t > to) continue;
  const el = describe(e.el);
  if (re && !re.test(el)) continue;
  const timing = e.timing || e.effect || {};
  const extra = [
    e.prop && `prop=${e.prop}`,
    e.name && `name=${e.name}`,
    e.animationName && `name=${e.animationName}`,
    e.elapsed !== undefined && `elapsed=${e.elapsed}`,
    timing.duration !== undefined && `dur=${timing.duration}`,
    timing.delay !== undefined && `delay=${timing.delay}`,
    timing.easing && `ease=${timing.easing}`,
    e.duration !== undefined && `dur=${e.duration}`,
    e.delay !== undefined && `delay=${e.delay}`,
    e.easing && `ease=${e.easing}`,
    e.frames && `frames=${JSON.stringify(e.frames).slice(0, 220)}`,
    e.keyframes && `kf=${JSON.stringify(e.keyframes).slice(0, 220)}`,
  ].filter(Boolean).join(' ');
  console.log(`${String(Math.round(t)).padStart(7)} ${e.k.padEnd(16)} ${el.slice(0, 110)} ${extra}`);
}
