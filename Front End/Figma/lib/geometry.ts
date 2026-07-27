/**
 * Willow Figma — geometry helpers: vectors, affine transforms, rects,
 * rotated-bounds math and hit-test primitives. Pure functions only.
 */

import type { Camera, Rect, Vec2 } from './types';

// ── Vectors ──────────────────────────────────────────────────────────────────

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const vAdd = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const vSub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const vScale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const vLen = (a: Vec2): number => Math.hypot(a.x, a.y);
export const vDist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const vLerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// ── Affine transform: [a c e; b d f] (canvas setTransform order) ─────────────

export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function matMultiply(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export const matTranslate = (tx: number, ty: number): Mat => [1, 0, 0, 1, tx, ty];

export function matRotateDeg(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, 0, 0];
}

export function matApply(m: Mat, p: Vec2): Vec2 {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function matInvert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

/**
 * Local→parent transform for a node placed at (x, y) with size (w, h) rotated
 * `rotation` degrees around its center.
 */
export function nodeTransform(x: number, y: number, w: number, h: number, rotation: number): Mat {
  if (!rotation) return matTranslate(x, y);
  const cx = x + w / 2;
  const cy = y + h / 2;
  return matMultiply(matMultiply(matTranslate(cx, cy), matRotateDeg(rotation)), matTranslate(-w / 2, -h / 2));
}

// ── Rects ────────────────────────────────────────────────────────────────────

export const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

export function rectFromPoints(a: Vec2, b: Vec2): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export const rectCenter = (r: Rect): Vec2 => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function rectContains(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function rectUnion(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function rectUnionAll(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  return rects.reduce(rectUnion);
}

export function rectExpand(r: Rect, amount: number): Rect {
  return { x: r.x - amount, y: r.y - amount, width: r.width + amount * 2, height: r.height + amount * 2 };
}

/** Axis-aligned bounding box of a rect transformed by `m`. */
export function transformedRectAabb(r: Rect, m: Mat): Rect {
  const corners = [
    matApply(m, { x: r.x, y: r.y }),
    matApply(m, { x: r.x + r.width, y: r.y }),
    matApply(m, { x: r.x + r.width, y: r.y + r.height }),
    matApply(m, { x: r.x, y: r.y + r.height }),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

// ── Camera (world ↔ screen) ──────────────────────────────────────────────────

export function worldToScreen(camera: Camera, p: Vec2): Vec2 {
  return { x: (p.x - camera.x) * camera.zoom, y: (p.y - camera.y) * camera.zoom };
}

export function screenToWorld(camera: Camera, p: Vec2): Vec2 {
  return { x: p.x / camera.zoom + camera.x, y: p.y / camera.zoom + camera.y };
}

export function worldRectToScreen(camera: Camera, r: Rect): Rect {
  return {
    x: (r.x - camera.x) * camera.zoom,
    y: (r.y - camera.y) * camera.zoom,
    width: r.width * camera.zoom,
    height: r.height * camera.zoom,
  };
}

export function screenRectToWorld(camera: Camera, r: Rect): Rect {
  return {
    x: r.x / camera.zoom + camera.x,
    y: r.y / camera.zoom + camera.y,
    width: r.width / camera.zoom,
    height: r.height / camera.zoom,
  };
}

/** Zoom keeping the given screen point stationary. */
export function zoomAt(camera: Camera, screenPoint: Vec2, nextZoom: number): Camera {
  const clamped = clamp(nextZoom, 0.02, 256);
  const world = screenToWorld(camera, screenPoint);
  return {
    zoom: clamped,
    x: world.x - screenPoint.x / clamped,
    y: world.y - screenPoint.y / clamped,
  };
}

/** Camera that fits `bounds` inside a viewport with padding, centered. */
export function cameraToFit(bounds: Rect, viewportW: number, viewportH: number, padding = 64): Camera {
  const zx = (viewportW - padding * 2) / Math.max(bounds.width, 1);
  const zy = (viewportH - padding * 2) / Math.max(bounds.height, 1);
  const zoom = clamp(Math.min(zx, zy), 0.02, 4);
  return {
    zoom,
    x: bounds.x + bounds.width / 2 - viewportW / 2 / zoom,
    y: bounds.y + bounds.height / 2 - viewportH / 2 / zoom,
  };
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Round for display in inputs: at most 2 decimals, no trailing zeros. */
export function roundTo(v: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export const degToRad = (d: number): number => (d * Math.PI) / 180;
export const radToDeg = (r: number): number => (r * 180) / Math.PI;

/** Normalize degrees to (-180, 180]. */
export function normalizeDeg(d: number): number {
  let v = d % 360;
  if (v > 180) v -= 360;
  if (v <= -180) v += 360;
  return v;
}

/** Distance from point to segment ab. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return vDist(p, a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = clamp(t, 0, 1);
  return vDist(p, { x: a.x + abx * t, y: a.y + aby * t });
}

/** Evaluate a cubic bezier at t. */
export function cubicAt(p0: Vec2, c0: Vec2, c1: Vec2, p1: Vec2, t: number): Vec2 {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c0.x + c * c1.x + d * p1.x,
    y: a * p0.y + b * c0.y + c * c1.y + d * p1.y,
  };
}
