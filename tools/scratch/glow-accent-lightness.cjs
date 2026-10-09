/**
 * Compares the old desktop glow accents (HOME_GLOW_ACCENT, Gemini's surface-accent family)
 * with the new ones (HOME_GLOW_MOBILE_ACCENT, Gemini's lm-glow-chat family) in OKLCh, and
 * shows what each swatch gives through the measured transforms. Read-only.
 *
 *   node tools/scratch/glow-accent-lightness.cjs
 */
const SWATCH = { green: '#4a7c59', blue: '#3b82f6', pink: '#ec4899', yellow: '#eab308', orange: '#f97316', purple: '#8b5cf6', lilac: '#c084fc', coral: '#f43f5e', teal: '#14b8a6' };
const OLD = { green: [6, 78, 59], blue: [20, 32, 79], pink: [76, 9, 35], yellow: [66, 54, 0], orange: [72, 34, 0], purple: [45, 17, 75], lilac: [62, 32, 76], coral: [78, 7, 10], teal: [0, 53, 52] };
const NEW = { green: [19, 67, 44], blue: [31, 59, 155], pink: [142, 0, 71], yellow: [122, 98, 0], orange: [131, 64, 0], purple: [85, 22, 150], lilac: [115, 56, 147], coral: [143, 0, 26], teal: [0, 98, 93] };

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toOklch = ([r, g, b]) => {
  const [R, G, B] = [r, g, b].map((v) => lin(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360];
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const f = (n, d = 3) => n.toFixed(d);

console.log('colour   old desktop L/C        new L/C                L ratio  C ratio');
for (const id of Object.keys(SWATCH)) {
  const [Lo, Co] = toOklch(OLD[id]);
  const [Ln, Cn] = toOklch(NEW[id]);
  console.log(`${id.padEnd(8)} ${f(Lo)} / ${f(Co)}   ->   ${f(Ln)} / ${f(Cn)}        ${f(Ln / Lo, 2)}     ${f(Cn / Co, 2)}`);
}
const [Ls] = toOklch(hex(SWATCH.green));
console.log(`\ngreen swatch L ${f(Ls)}: old desktop green is ${f(toOklch(OLD.green)[0] / Ls)} of it, the new green ${f(toOklch(NEW.green)[0] / Ls)}; the transforms give 0.424 (old) and 0.637 (new)`);
