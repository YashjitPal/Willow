import React, { useRef, useEffect, useCallback, useState, memo } from 'react';

const GRID_SPACING = 16;
const DOT_RADIUS = 1;
const INFLUENCE_RADIUS = 725;
const MAX_DISPLACEMENT = 28;
const DAMPING = 0.035;
const NOISE_DISPLACEMENT = 6;
const NOISE_FREQ = 0.04;
const TIME_SCALE = 8e-4;

// Below this the repel offset, the colour blend and the alpha dip are all far under
// one device pixel, so the two `noise2D` calls and the `atan2` behind them are work
// with no visible result. Culls the outermost ~6% of the influence radius.
const INFLUENCE_EPSILON = 0.06;

// Distinct colours seen since the last prune. Dots are grouped by quantised colour
// so each group can be drawn in one call; the bucket map is reused across frames,
// and pruned if a long session of mouse movement accumulates too many stale keys.
const MAX_COLOR_BUCKETS = 4096;

// Once the pointer has left and every dot is within this many CSS px of its grid
// slot, the canvas is already showing the final image and the next frame would be
// a byte-identical repaint. Below a device pixel at any sane DPR.
const SETTLED_EPSILON = 0.02;

const BASE_COLOR = [68, 68, 68] as const;
const COLOR_START = [96, 86, 240] as const;
const COLOR_END = [64, 217, 198] as const;

// 512-entry permutation table for 2D Perlin noise
const PERMUTATION = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (i * 2654435761 >>> 0) % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    PERMUTATION[i] = p[i & 255];
  }
}

const GRADIENTS: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad(hash: number, x: number, y: number): number {
  const g = GRADIENTS[hash & 7];
  return g[0] * x + g[1] * y;
}

function noise2D(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = PERMUTATION[PERMUTATION[X] + Y];
  const ab = PERMUTATION[PERMUTATION[X] + Y + 1];
  const ba = PERMUTATION[PERMUTATION[X + 1] + Y];
  const bb = PERMUTATION[PERMUTATION[X + 1] + Y + 1];

  const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
  const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v);
}

interface DotPoint {
  gx: number;
  gy: number;
  x: number;
  y: number;
}

interface StitchDotGridProps {
  className?: string;
}

const StitchDotGridComponent: React.FC<StitchDotGridProps> = ({ className }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<DotPoint[]>([]);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dimensionsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const bucketsRef = useRef<Map<number, number[]>>(new Map());
  const settledRef = useRef(false);
  const [isMounted, setIsMounted] = useState(false);

  const buildGrid = useCallback((width: number, height: number) => {
    const points: DotPoint[] = [];
    const cols = Math.ceil(width / GRID_SPACING) + 1;
    const rows = Math.ceil(height / GRID_SPACING) + 1;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * GRID_SPACING;
        const y = r * GRID_SPACING;
        points.push({ gx: x, gy: y, x, y });
      }
    }

    pointsRef.current = points;
    dimensionsRef.current = { w: width, h: height };
    // A resize clears the canvas and moves every slot, so the "already showing the
    // final image" shortcut in renderFrame must not survive it.
    settledRef.current = false;
  }, []);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const mouse = mouseRef.current;

    // With the pointer gone and every dot back in its slot, the canvas already holds
    // the exact image this frame would draw. Bail before touching the context: an
    // untouched canvas keeps its contents, so this is invisible and costs nothing.
    //
    // Verified 2026-08-25 by counting `stroke()` calls per frame: ~1,900 with the
    // cursor over the view, 0 after moving it off and letting the damping settle,
    // ~1,950 again on return. It must be tested with a real cursor move (CDP
    // `Input.dispatchMouseEvent`) — a synthetic `mouseleave` dispatched on `window`
    // never clears `mouseRef`, because Chrome keeps delivering genuine mousemoves at
    // the physical pointer position and immediately sets it again.
    if (!mouse && settledRef.current) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h } = dimensionsRef.current;
    ctx.clearRect(0, 0, w, h);

    const points = pointsRef.current;
    const maxDistSq = INFLUENCE_RADIUS * INFLUENCE_RADIUS;
    const time = performance.now() * TIME_SCALE;

    const buckets = bucketsRef.current;
    if (buckets.size > MAX_COLOR_BUCKETS) buckets.clear();
    for (const coords of buckets.values()) coords.length = 0;

    const fadeStart = h * 0.75;
    const fadeSpan = h - fadeStart;
    let maxDelta = 0;

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      let targetX = pt.gx;
      let targetY = pt.gy;
      let influence = 0;

      if (mouse) {
        const dx = pt.gx - mouse.x;
        const dy = pt.gy - mouse.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < maxDistSq && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const raw = 1 - dist / INFLUENCE_RADIUS;

          if (raw > INFLUENCE_EPSILON) {
            influence = raw;
            const repelDist = influence * influence * influence * MAX_DISPLACEMENT;

            targetX = pt.gx + (dx / dist) * repelDist;
            targetY = pt.gy + (dy / dist) * repelDist;

            const nx = noise2D(pt.gx * NOISE_FREQ, pt.gy * NOISE_FREQ + time);
            const ny = noise2D(pt.gx * NOISE_FREQ + 100, pt.gy * NOISE_FREQ + time);
            const wave = influence * influence * NOISE_DISPLACEMENT;

            targetX += nx * wave;
            targetY += ny * wave;
          }
        }
      }

      const stepX = (targetX - pt.x) * DAMPING;
      const stepY = (targetY - pt.y) * DAMPING;
      pt.x += stepX;
      pt.y += stepY;

      const step = Math.abs(stepX) + Math.abs(stepY);
      if (step > maxDelta) maxDelta = step;

      let r: number = BASE_COLOR[0];
      let g: number = BASE_COLOR[1];
      let b: number = BASE_COLOR[2];
      let alpha = 1;

      if (pt.gy > fadeStart) {
        alpha *= 1 - (pt.gy - fadeStart) / fadeSpan;
      }

      if (influence > 0) {
        alpha *= 1 - influence * influence * 0.85;
        const angle = Math.atan2(pt.gy - mouse!.y, pt.gx - mouse!.x);
        const colorPhase = (Math.sin(angle * 2 + time * 3) + 1) * 0.5;

        const cr = lerp(COLOR_START[0], COLOR_END[0], colorPhase);
        const cg = lerp(COLOR_START[1], COLOR_END[1], colorPhase);
        const cb = lerp(COLOR_START[2], COLOR_END[2], colorPhase);
        const blend = influence * influence;

        r = Math.round(lerp(BASE_COLOR[0], cr, blend));
        g = Math.round(lerp(BASE_COLOR[1], cg, blend));
        b = Math.round(lerp(BASE_COLOR[2], cb, blend));
      }

      if (alpha <= 0.002) continue;

      // 6 bits per channel + 8 bits of alpha, packed into one int32 so grouping
      // needs no string keys. BASE_COLOR's 68 survives the 6-bit round trip
      // exactly; interpolated colours shift by at most 3/255, which is invisible.
      const key =
        ((r >> 2) << 20) | ((g >> 2) << 14) | ((b >> 2) << 8) | (alpha >= 1 ? 255 : (alpha * 255) | 0);

      let coords = buckets.get(key);
      if (coords === undefined) {
        coords = [];
        buckets.set(key, coords);
      }
      coords.push(pt.x, pt.y);
    }

    // Dots are drawn as zero-length round-capped strokes, one stroke per colour
    // group, rather than one filled `arc` per dot.
    //
    // Benchmarked 2026-08-25 at DPR 1.25 with ~2,800 dots: `arc` 14.3ms/frame,
    // round-capped stroke 11.4ms, `rect` 6.2ms. `rect` is the fastest but the dots
    // stop being round — it differs from the `arc` reference by up to 239/255 on a
    // channel across 4% of pixels. The round-cap path is within 3/255 everywhere,
    // i.e. the same image, so that is the one worth having.
    //
    // Don't tune the quantisation in the key above hoping for frame time. Coarser
    // buckets do cut this loop a lot in isolation (an offscreen canvas with 3,402
    // dots went 1018 buckets/4.2ms to 351 buckets/0.7ms), but that does not transfer:
    // profiled in the live app under a real sweeping cursor, this whole draw path is
    // ~0.8ms/frame (`stroke` + `moveTo` + `lineTo` + `beginPath` over 126 frames)
    // while the physics/colour loop above costs ~4.8ms/frame. The loop is where any
    // further time is, and it is bounded by INFLUENCE_RADIUS being large enough
    // (725px) to touch nearly every dot on screen at once.
    ctx.lineCap = 'round';
    ctx.lineWidth = DOT_RADIUS * 2;

    for (const [key, coords] of buckets) {
      const n = coords.length;
      if (n === 0) continue;

      const r = ((key >> 20) & 63) << 2;
      const g = ((key >> 14) & 63) << 2;
      const b = ((key >> 8) & 63) << 2;
      ctx.strokeStyle = `rgba(${r},${g},${b},${(key & 255) / 255})`;

      ctx.beginPath();
      for (let j = 0; j < n; j += 2) {
        const x = coords[j];
        const y = coords[j + 1];
        ctx.moveTo(x, y);
        ctx.lineTo(x + 0.01, y);
      }
      ctx.stroke();
    }

    settledRef.current = !mouse && maxDelta < SETTLED_EPSILON;
  }, []);

  const animateLoop = useCallback(() => {
    renderFrame();
    animationFrameRef.current = requestAnimationFrame(animateLoop);
  }, [renderFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const handleResize = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }

      buildGrid(w, h);
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(parent);
    handleResize();

    return () => {
      observer.disconnect();
    };
  }, [buildGrid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = parent.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        mouseRef.current = null;
        return;
      }
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(animateLoop);
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [animateLoop]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={className}
      style={{
        opacity: isMounted ? 1 : 0,
        transition: 'opacity 1.2s ease-in',
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
        }}
      />
    </div>
  );
};

export const StitchDotGrid = memo(StitchDotGridComponent);
export default StitchDotGrid;
