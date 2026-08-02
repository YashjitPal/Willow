// Color Utility Functions

// --- Types ---
export type RGB = { r: number; g: number; b: number };
export type HSV = { h: number; s: number; v: number };
export type HSVA = HSV & { a: number };
export type HSL = { h: number; s: number; l: number };

// --- RGB <-> HEX ---
export const rgbToHex = (r: number, g: number, b: number): string => 
  "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);

export const hexToRgb = (hex: string): RGB => {
  let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result 
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 0, g: 0, b: 0 };
};

// --- RGB <-> HSV ---
export const rgbToHsv = (r: number, g: number, b: number): HSV => {
  r /= 255; g /= 255; b /= 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s, v = max;
  let d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) h = 0;
  else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, v: v * 100 };
};

export const hsvToRgb = (h: number, s: number, v: number): RGB => {
  s /= 100; v /= 100;
  let f = (n: number, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) };
};

// --- RGB <-> HSL ---
export const rgbToHsl = (r: number, g: number, b: number): HSL => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
};

// --- OKLCH <-> RGB (Approximation for Display) ---
// Note: Converting RGB -> OKLCH -> RGB is lossy and complex.
// We will implement a simplified conversion or rely on a robust approximation.
// For now, simpler sRGB <-> OKLCH conversion matrices.

// Linearize RGB
const linearize = (c: number) => {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
// Unlinearize RGB
const unlinearize = (c: number) => {
    const val = c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
    return Math.max(0, Math.min(255, Math.round(val * 255)));
};

export const rgbToOklch = (r: number, g: number, b: number) => {
    // 1. RGB to Linear sRGB
    const lr = linearize(r);
    const lg = linearize(g);
    const lb = linearize(b);

    // 2. Linear sRGB to OKLab
    // Matrices from: https://bottosson.github.io/posts/oklab/
    const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

    // 3. OKLab to OKLCH
    const C = Math.sqrt(a * a + b_ * b_);
    let h = Math.atan2(b_, a) * (180 / Math.PI);
    if (h < 0) h += 360;

    return { l: L, c: C, h: h };
};

export const oklchToRgb = (l: number, c: number, h: number): RGB => {
    // 1. OKLCH to OKLab
    const hRad = h * (Math.PI / 180);
    const a = c * Math.cos(hRad);
    const b_ = c * Math.sin(hRad);

    const L = l;

    // 2. OKLab to Linear sRGB
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b_;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b_;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b_;

    const l3 = l_ * l_ * l_;
    const m3 = m_ * m_ * m_;
    const s3 = s_ * s_ * s_;

    const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
    const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
    const b = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

    // 3. Linear sRGB to RGB
    return {
        r: unlinearize(r),
        g: unlinearize(g),
        b: unlinearize(b)
    };
};

// --- Parsers ---

export const parseRgba = (str: string): { r: number, g: number, b: number, a: number } | null => {
    const match = str.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/i);
    if (!match) return null;
    return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3]),
        a: match[4] ? parseFloat(match[4]) : 1
    };
};

export const parseHsla = (str: string): { h: number, s: number, l: number, a: number } | null => {
    const match = str.match(/hsla?\((\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%(?:\s*,\s*([\d.]+))?\)/i);
    if (!match) return null;
    return {
        h: parseInt(match[1]),
        s: parseInt(match[2]),
        l: parseInt(match[3]),
        a: match[4] ? parseFloat(match[4]) : 1
    };
};

export const parseOklch = (str: string): { l: number, c: number, h: number, a: number } | null => {
    // Matches oklch(0.5 0.2 250 / 0.5) or oklch(0.5 0.2 250)
    const match = str.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/i);
    if (!match) return null;
    return {
        l: parseFloat(match[1]),
        c: parseFloat(match[2]),
        h: parseFloat(match[3]),
        a: match[4] ? parseFloat(match[4]) : 1
    };
};
