/**
 * What the old desktop green becomes under the change Gemini's blue went through
 * (#14204f, the old surface-accent glow, to #1f3b9b, the lm-glow-chat glow), using the repo's
 * own OKLCh functions so rounding and gamut-mapping match the baked accents. Read-only.
 *
 *   node tools/scratch/glow-green-brighten.mjs
 */
import path from 'node:path';
import { importTs } from '../../apps/studio/test/ts-module.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const palette = await importTs(path.join(root, 'features', 'chat', 'src', 'voice-orb', 'orb-palette.ts'));
const glow = await importTs(path.join(root, 'features', 'media', 'src', 'home-glow.ts'));
const { hexToRgb, rgbToOklch, oklchToRgb } = palette;

const [Lo, Co, ho] = rgbToOklch(hexToRgb(glow.GEMINI_GLOW_ACCENT_HEX));
const [Ln, Cn, hn] = rgbToOklch(hexToRgb(glow.GEMINI_GLOW_ACCENT_MOBILE_HEX));
const step = { lightnessRatio: Ln / Lo, chromaRatio: Cn / Co, hueShiftDeg: ((hn - ho + 540) % 360) - 180 };
console.log('blue old -> new:', JSON.stringify(step));

const apply = (rgbString) => {
  const rgb = rgbString.match(/\d+/g).map((n) => Number(n) / 255);
  const [L, C, h] = rgbToOklch(rgb);
  const out = oklchToRgb([L * step.lightnessRatio, C * step.chromaRatio, (h + step.hueShiftDeg + 360) % 360]);
  return { oklch: [L * step.lightnessRatio, C * step.chromaRatio, (h + step.hueShiftDeg + 360) % 360].map((n) => +n.toFixed(4)), rgb: `rgb(${out.map((c) => Math.round(c * 255)).join(', ')})` };
};

for (const [name, old] of Object.entries(glow.HOME_GLOW_ACCENT)) {
  const r = apply(old);
  console.log(`${name.padEnd(7)} old ${old.padEnd(18)} -> brightened like blue ${r.rgb.padEnd(18)} shipped now ${glow.HOME_GLOW_MOBILE_ACCENT[name]}`);
}
