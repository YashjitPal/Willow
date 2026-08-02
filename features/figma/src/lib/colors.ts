/**
 * Willow Figma — color utilities: RGBA(0..1) ↔ hex/css, HSV conversions for
 * the color picker, and default palette used across the editor.
 */

import type { GradientPaint, Paint, RGBA, SolidPaint } from './types';

export const rgba = (r: number, g: number, b: number, a = 1): RGBA => ({ r, g, b, a });

/** From 0..255 channel values. */
export const rgba255 = (r: number, g: number, b: number, a = 1): RGBA => ({ r: r / 255, g: g / 255, b: b / 255, a });

export function cssColor(c: RGBA, opacityMul = 1): string {
  const a = Math.max(0, Math.min(1, c.a * opacityMul));
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${+a.toFixed(4)})`;
}

/** "1A2B3C" (no #, uppercase) — Figma-style hex field value. */
export function toHex(c: RGBA): string {
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase();
}

/** Parse "#abc", "abc", "#aabbcc", "aabbccdd", "rgb(...)" → RGBA or null. */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return rgba255(parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16));
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return rgba255(parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16));
  }
  if (/^[0-9a-fA-F]{8}$/.test(s)) {
    return rgba255(
      parseInt(s.slice(0, 2), 16),
      parseInt(s.slice(2, 4), 16),
      parseInt(s.slice(4, 6), 16),
      parseInt(s.slice(6, 8), 16) / 255,
    );
  }
  const m = input.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (m) return rgba255(+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]);
  return null;
}

// ── HSV (for the color picker) ───────────────────────────────────────────────

export interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

export function rgbToHsv(c: RGBA): HSV {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === c.r) h = 60 * (((c.g - c.b) / d) % 6);
    else if (max === c.g) h = 60 * ((c.b - c.r) / d + 2);
    else h = 60 * ((c.r - c.g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(hsv: HSV, a = 1): RGBA {
  const { h, s, v } = hsv;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: r + m, g: g + m, b: b + m, a };
}

// ── Paint factories ──────────────────────────────────────────────────────────

export function solid(color: RGBA, opacity = 1): SolidPaint {
  return { type: 'SOLID', color, opacity, visible: true };
}

export function linearGradient(from: RGBA, to: RGBA, rotation = 0): GradientPaint {
  return {
    type: 'GRADIENT_LINEAR',
    stops: [
      { position: 0, color: from },
      { position: 1, color: to },
    ],
    rotation,
    opacity: 1,
    visible: true,
  };
}

/** First visible solid paint's color, for swatches/summaries. */
export function primaryColor(paints: Paint[]): RGBA | null {
  for (const p of paints) {
    if (p.visible && p.type === 'SOLID') return p.color;
  }
  return null;
}

/** Short display label for a paint list (hex, "Linear", "Image", …). */
export function paintLabel(paints: Paint[]): string {
  const p = paints.find((x) => x.visible) ?? paints[0];
  if (!p) return 'None';
  if (p.type === 'SOLID') return toHex(p.color);
  if (p.type === 'IMAGE') return 'Image';
  if (p.type === 'GRADIENT_LINEAR') return 'Linear';
  if (p.type === 'GRADIENT_RADIAL') return 'Radial';
  return 'Angular';
}

// ── Editor palette ───────────────────────────────────────────────────────────

export const WHITE: RGBA = rgba(1, 1, 1, 1);
export const BLACK: RGBA = rgba(0, 0, 0, 1);
export const GRAY_FILL: RGBA = rgba255(217, 217, 217); // Figma's default shape gray D9D9D9
export const FRAME_WHITE: RGBA = rgba(1, 1, 1, 1);
export const CANVAS_BG: RGBA = rgba255(30, 30, 30); // dark canvas #1E1E1E
export const ACCENT: RGBA = rgba255(13, 153, 255); // Figma blue 0D99FF
export const ACCENT_HEX = '#0D99FF';
export const COMPONENT_PURPLE = '#9747FF';

/** Deterministic multiplayer color from a user id. */
export function presenceColor(id: string): string {
  const palette = ['#F24E1E', '#FF7262', '#A259FF', '#1ABCFE', '#0ACF83', '#FFC700', '#EF5DA8', '#5D5FEF'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}
