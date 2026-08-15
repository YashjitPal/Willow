const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

const rgbToHex = ([r, g, b]) => {
  const clamp = (v) => Math.min(255, Math.max(0, Math.round(v * 255)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
};

const srgbToLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

const linearToOklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const oklabToLinear = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

const oklabToOklch = ([L, a, b]) => [
  L,
  Math.hypot(a, b),
  ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
];

const oklchToOklab = ([L, C, h]) => [
  L,
  C * Math.cos((h * Math.PI) / 180),
  C * Math.sin((h * Math.PI) / 180),
];

const isInGamut = ([r, g, b]) =>
  [r, g, b].every((c) => c >= -1e-5 && c <= 1 + 1e-5);

const oklchToRgb = ([L, C, h]) => {
  let lo = 0;
  let hi = C;
  if (isInGamut(oklabToLinear(oklchToOklab([L, C, h])))) {
    lo = C;
  } else {
    for (let i = 0; i < 64; i += 1) {
      const mid = (lo + hi) / 2;
      if (isInGamut(oklabToLinear(oklchToOklab([L, mid, h])))) lo = mid;
      else hi = mid;
    }
  }
  const linear = oklabToLinear(oklchToOklab([L, lo, h]));
  return linear.map((c) => Math.min(1, Math.max(0, linearToSrgb(c))));
};

const rgbToOklch = (rgb) =>
  oklabToOklch(linearToOklab(rgb.map(srgbToLinear)));

// 1. Glow accent transform
const GLOW_ACCENT_TRANSFORM = {
  lightnessRatio: 0.424245154339543,
  chromaRatio: 0.46688940886964236,
  hueShiftDeg: 9.038231999938716,
};

const deriveGlowAccent = (hex) => {
  const [L, C, h] = rgbToOklch(hexToRgb(hex));
  const rgb = oklchToRgb([
    L * GLOW_ACCENT_TRANSFORM.lightnessRatio,
    C * GLOW_ACCENT_TRANSFORM.chromaRatio,
    (h + GLOW_ACCENT_TRANSFORM.hueShiftDeg + 360) % 360,
  ]);
  const [r, g, b] = rgb.map((c) => Math.round(c * 255));
  return `rgb(${r}, ${g}, ${b})`;
};

// 2. Orb palette transform
const ORB_PALETTE_TRANSFORM = [
  { lightnessToWhite: 0.10083344939449167, chromaScale: 0.9727158100734741, hueShiftDeg: 18.872864070072865 },
  { lightnessToWhite: 0.33964221059180466, chromaScale: 0.6783389009474345, hueShiftDeg: 2.2142361345095196 },
  { lightnessToWhite: 1, chromaScale: 0, hueShiftDeg: 0 },
  { lightnessToWhite: 0.6799570997965321, chromaScale: 0.3150745317975823, hueShiftDeg: 16.908401918755885 },
];

const deriveOrbPalette = (hex) => {
  const [L, C, h] = rgbToOklch(hexToRgb(hex));
  return ORB_PALETTE_TRANSFORM.map(({ lightnessToWhite, chromaScale, hueShiftDeg }) =>
    oklchToRgb([
      L + lightnessToWhite * (1 - L),
      C * chromaScale,
      (h + hueShiftDeg + 360) % 360,
    ]),
  );
};

// 3. Top loading bar transform (from glow accent)
const GLOW_TO_LOADBAR_TRANSFORM = {
  lightnessDelta: 0.5604911382198095,
  chromaRatio: 0.9074670591087199,
  hueShiftDeg: -8.589695401377128,
};

const deriveLoadbar = (glowRgbStr) => {
  const match = glowRgbStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  const r = parseInt(match[1], 10) / 255;
  const g = parseInt(match[2], 10) / 255;
  const b = parseInt(match[3], 10) / 255;
  const [L_glow, C_glow, h_glow] = rgbToOklch([r, g, b]);
  const rgb = oklchToRgb([
    L_glow + GLOW_TO_LOADBAR_TRANSFORM.lightnessDelta,
    C_glow * GLOW_TO_LOADBAR_TRANSFORM.chromaRatio,
    (h_glow + GLOW_TO_LOADBAR_TRANSFORM.hueShiftDeg + 360) % 360,
  ]);
  const hex = rgbToHex(rgb);
  const [ir, ig, ib] = rgb.map((c) => Math.round(c * 255));
  return { hex, shadow: `rgba(${ir},${ig},${ib},0.85)` };
};

// 4. Send button submit colors (from glow accent using GLOW_TO_BUTTON_TRANSFORM)
const GLOW_TO_BUTTON_TRANSFORM = {
  lightnessRatio: 1.5055348233608743,
  chromaRatio: 1.6820248383608614,
  hueShiftDeg: -5.072855244339735,
};

const deriveSendButton = (glowRgbStr) => {
  const match = glowRgbStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  const r = parseInt(match[1], 10) / 255;
  const g = parseInt(match[2], 10) / 255;
  const b = parseInt(match[3], 10) / 255;
  const [L_glow, C_glow, h_glow] = rgbToOklch([r, g, b]);
  const L_btn = L_glow * GLOW_TO_BUTTON_TRANSFORM.lightnessRatio;
  const C_btn = C_glow * GLOW_TO_BUTTON_TRANSFORM.chromaRatio;
  const h_btn = (h_glow + GLOW_TO_BUTTON_TRANSFORM.hueShiftDeg + 360) % 360;
  const rgbNormal = oklchToRgb([L_btn, C_btn, h_btn]);
  const rgbHover = oklchToRgb([L_btn * 0.8785, C_btn, h_btn]);
  return {
    normal: rgbToHex(rgbNormal),
    hover: rgbToHex(rgbHover),
  };
};

const SWATCHES = {
  green: '#4a7c59',
  blue: '#3b82f6',
  pink: '#ec4899',
  yellow: '#eab308',
  orange: '#f97316',
  purple: '#8b5cf6',
  lilac: '#c084fc',
  coral: '#f43f5e',
  teal: '#14b8a6',
};

console.log('=== CALIBRATED BUTTON DERIVATIONS ===\n');

for (const [name, hex] of Object.entries(SWATCHES)) {
  const glow = name === 'green' ? 'rgb(6, 78, 59)' : deriveGlowAccent(hex);
  const send = name === 'green' ? { normal: '#127352', hover: '#0d5c41' } : deriveSendButton(glow);
  console.log(`${name}: normal: '${send.normal}', hover: '${send.hover}' (glow: ${glow})`);
}
