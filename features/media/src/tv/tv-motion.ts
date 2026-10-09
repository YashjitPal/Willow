// Flow TV's easings (its `ease-*` design tokens) and the one piece of motion it animates by hand:
// a number tweened over time, as motion's `animate(value, to, options)` does for the shader.

export type Ease = (t: number) => number;

/** A CSS cubic-bezier as a function of progress, solved for x by Newton's method then bisection. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i += 1) {
      const err = x(t) - p;
      if (Math.abs(err) < 1e-6) return y(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = p;
    for (let i = 0; i < 30; i += 1) {
      const v = x(t);
      if (Math.abs(v - p) < 1e-6) break;
      if (v < p) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return y(t);
  };
}

export const EASE_LINEAR: Ease = (t) => t;
export const EASE_OUT = cubicBezier(0.26, 1, 0.48, 1);
export const EASE_IN_OUT_1 = cubicBezier(0.34, 0, 0, 1);
export const EASE_IN_OUT_2 = cubicBezier(0.61, 0, 0.39, 1);

export const CSS_EASE_OUT = 'cubic-bezier(0.26, 1, 0.48, 1)';

export interface TweenOptions {
  /** Seconds, as Flow TV writes them. */
  duration: number;
  delay?: number;
  ease?: Ease;
}

/**
 * A number that animates towards a target, starting from wherever it is, as a motion value does:
 * a new `to` stops the one before (whose promise then settles) and carries on from its value.
 */
export class TweenValue {
  value: number;
  private raf = 0;
  private settle: (() => void) | null = null;

  constructor(value = 0) {
    this.value = value;
  }

  set(value: number): void {
    this.stop();
    this.value = value;
  }

  to(target: number, { duration, delay = 0, ease = EASE_LINEAR }: TweenOptions): Promise<void> {
    this.stop();
    const from = this.value;
    return new Promise((resolve) => {
      this.settle = resolve;
      let start = -1;
      const step = (now: number) => {
        if (start < 0) start = now + delay * 1000;
        if (now < start) {
          this.raf = requestAnimationFrame(step);
          return;
        }
        const t = duration > 0 ? Math.min(1, (now - start) / (duration * 1000)) : 1;
        this.value = from + (target - from) * ease(t);
        if (t < 1) {
          this.raf = requestAnimationFrame(step);
          return;
        }
        this.raf = 0;
        this.settle = null;
        resolve();
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const settle = this.settle;
    this.settle = null;
    settle?.();
  }
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
