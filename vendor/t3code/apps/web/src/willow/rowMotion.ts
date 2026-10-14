/**
 * How timeline rows come and go, after the ChatGPT app (Codex's webview, willow/activity.css):
 * a row that arrives while a turn runs fades in as the app's streamed markdown does, and opening
 * or closing a disclosure grows or shrinks its rows as one block, as the app's motion.div does,
 * the top row filling first. Flags live outside React state so a row's re-renders only that row.
 */
import { createContext, use, useSyncExternalStore } from "react";

/** `fold-enter` keeps a row folded shut until the motion below measures it and takes over. */
export type RowMotion = "arrive" | "fold-enter" | "fold-exit";

/** A row that never paints, scrolled out of the list's window, drops its flag after this. */
export const ROW_MOTION_STALE_MS = 2000;

export interface RowMotionStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly get: (rowId: string) => RowMotion | undefined;
  readonly set: (rowIds: Iterable<string>, motion: RowMotion | undefined) => void;
}

export function createRowMotionStore(): RowMotionStore {
  const motions = new Map<string, RowMotion>();
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: (rowId) => motions.get(rowId),
    set: (rowIds, motion) => {
      for (const rowId of rowIds) {
        if (motion === undefined) motions.delete(rowId);
        else motions.set(rowId, motion);
      }
      for (const listener of listeners) listener();
    },
  };
}

export const RowMotionCtx = createContext<RowMotionStore | null>(null);

const subscribeNowhere = () => () => {};
const noMotion = () => undefined;

export function useRowMotion(rowId: string): RowMotion | undefined {
  const store = use(RowMotionCtx);
  return useSyncExternalStore(
    store?.subscribe ?? subscribeNowhere,
    store ? () => store.get(rowId) : noMotion,
    noMotion,
  );
}

/**
 * The rows that arrived since the previous render. Rows above every row it had are history
 * loading in, so only those after one of them count.
 */
export function arrivedRowIds(
  rowIds: ReadonlyArray<string>,
  previous: ReadonlySet<string>,
): ReadonlyArray<string> {
  const arrived: string[] = [];
  let afterPrevious = false;
  for (const rowId of rowIds) {
    if (previous.has(rowId)) {
      afterPrevious = true;
      continue;
    }
    if (afterPrevious) arrived.push(rowId);
  }
  return arrived;
}

/** The rows that left since the previous render, in runs that were next to each other. */
export function leftRowBlocks<Row extends { readonly id: string }>(
  previous: ReadonlyArray<Row>,
  current: ReadonlySet<string>,
): ReadonlyArray<{
  readonly rows: ReadonlyArray<Row>;
  readonly afterId: string | null;
  readonly beforeId: string | null;
}> {
  const blocks: Array<{ rows: Row[]; afterId: string | null; beforeId: string | null }> = [];
  let open: { rows: Row[]; afterId: string | null; beforeId: string | null } | null = null;
  let lastKept: string | null = null;
  for (const row of previous) {
    if (current.has(row.id)) {
      if (open) {
        open.beforeId = row.id;
        blocks.push(open);
        open = null;
      }
      lastKept = row.id;
      continue;
    }
    if (!open) open = { rows: [], afterId: lastKept, beforeId: null };
    open.rows.push(row);
  }
  if (open) blocks.push(open);
  return blocks;
}

/** A CSS cubic-bezier as a function of progress, for motion drawn frame by frame. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const axis = (c1: number, c2: number, u: number) => {
    const a = 3 * c1;
    const b = 3 * (c2 - c1) - a;
    const c = 1 - a - b;
    return ((c * u + b) * u + a) * u;
  };
  const slope = (c1: number, c2: number, u: number) => {
    const a = 3 * c1;
    const b = 3 * (c2 - c1) - a;
    const c = 1 - a - b;
    return (3 * c * u + 2 * b) * u + a;
  };
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i += 1) {
      const s = slope(x1, x2, u);
      if (Math.abs(s) < 1e-6) break;
      u -= (axis(x1, x2, u) - t) / s;
    }
    // Newton can leave the curve's domain on a steep start; settle it by halving.
    if (!(u >= 0 && u <= 1) || Math.abs(axis(x1, x2, u) - t) > 1e-4) {
      let low = 0;
      let high = 1;
      u = t;
      for (let i = 0; i < 24; i += 1) {
        if (axis(x1, x2, u) < t) low = u;
        else high = u;
        u = (low + high) / 2;
      }
    }
    return axis(y1, y2, u);
  };
}

export interface MotionPreset {
  readonly durationMs: number;
  readonly ease: (t: number) => number;
  /** How far up the block starts or ends, Codex's translateY(-8px). */
  readonly lift: number;
}

/** "Worked for": collapsed-turn-disclosure's AO, 300ms on the enter curve, out in 150ms snappy. */
export const TURN_FOLD_OPEN: MotionPreset = {
  durationMs: 300,
  ease: cubicBezier(0.19, 1, 0.22, 1),
  lift: -8,
};
export const TURN_FOLD_CLOSE: MotionPreset = {
  durationMs: 150,
  ease: cubicBezier(0.23, 1, 0.32, 1),
  lift: -8,
};
/** A row's own disclosure (a group of calls, a command's output): height and fade, 300ms. */
export const GROUP_TOGGLE: MotionPreset = {
  durationMs: 300,
  ease: cubicBezier(0.19, 1, 0.22, 1),
  lift: 0,
};

const DRIVEN = "motionDriven";

/**
 * Grows (`enter`) or shrinks (`exit`) rows as one block: the block's height runs on the preset's
 * curve and each row shows what of it reaches that row, so the top row fills first, as in a
 * single container. Rows the list mounts mid-flight join in. Reduced motion only fades.
 */
export function runGroupMotion(input: {
  readonly scrollNode: HTMLElement;
  readonly rowIds: ReadonlyArray<string>;
  readonly direction: "enter" | "exit";
  readonly preset: MotionPreset;
  readonly reducedMotion: boolean;
  readonly onDone: () => void;
}): () => void {
  const { scrollNode, rowIds, direction, preset, reducedMotion } = input;
  const natural = new Map<string, number>();
  const find = (rowId: string) =>
    scrollNode.querySelector<HTMLElement>(`[data-timeline-row-id="${CSS.escape(rowId)}"]`);
  const clear = (element: HTMLElement) => {
    delete element.dataset[DRIVEN];
    for (const property of ["height", "padding-bottom", "opacity", "transform", "clip-path"]) {
      element.style.removeProperty(property);
    }
  };
  const measure = (rowId: string, element: HTMLElement) => {
    const known = natural.get(rowId);
    if (known !== undefined) return known;
    element.dataset[DRIVEN] = "";
    const saved = element.style.cssText;
    clear(element);
    element.dataset[DRIVEN] = "";
    const height = element.getBoundingClientRect().height;
    element.style.cssText = saved;
    natural.set(rowId, height);
    return height;
  };
  const draw = (progress: number) => {
    const rows = rowIds.flatMap((rowId) => {
      const element = find(rowId);
      return element ? [{ element, height: measure(rowId, element) }] : [];
    });
    const total = rows.reduce((sum, row) => sum + row.height, 0);
    const visible = progress * total;
    let top = 0;
    for (const { element, height } of rows) {
      element.dataset[DRIVEN] = "";
      const shown = reducedMotion ? height : Math.min(height, Math.max(0, visible - top));
      top += height;
      element.style.setProperty("height", `${shown}px`);
      element.style.setProperty("padding-bottom", "0px");
      element.style.setProperty("clip-path", "inset(0 -8px)");
      element.style.setProperty("opacity", String(progress));
      if (preset.lift && !reducedMotion) {
        element.style.setProperty("transform", `translateY(${(1 - progress) * preset.lift}px)`);
      }
    }
  };
  const duration = reducedMotion ? 150 : preset.durationMs;
  const at = (t: number) => (direction === "enter" ? preset.ease(t) : 1 - preset.ease(t));
  let frame: number | null = null;
  let done = false;
  draw(at(0));
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    draw(at(t));
    if (t < 1) {
      frame = requestAnimationFrame(step);
      return;
    }
    frame = null;
    done = true;
    if (direction === "enter") {
      for (const rowId of rowIds) {
        const element = find(rowId);
        if (element) clear(element);
      }
    }
    input.onDone();
  };
  frame = requestAnimationFrame(step);
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (done) return;
    done = true;
    for (const rowId of rowIds) {
      const element = find(rowId);
      if (element) clear(element);
    }
  };
}
