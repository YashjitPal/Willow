// Pure helpers for the Scenebuilder: timecodes, names and timeline geometry.
//
// Every number here was read off Flow's Scenebuilder (flow.google.com) with the recorder in
// `tools/ui-research/scrapers/flow/scenebuilder/` — see 09-zoom-levels.json and
// 09-playback-samples.json for the samples they reproduce.

/** Flow counts frames at 24 per second: 13.5s reads `00:13:12`, 14.24s reads `00:14:05`. */
export const TIMECODE_FPS = 24;

export function formatTimecode(seconds: number): string {
  const frames = Math.floor(Math.max(0, seconds) * TIMECODE_FPS + 1e-6);
  const ff = frames % TIMECODE_FPS;
  const totalSeconds = Math.floor(frames / TIMECODE_FPS);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(mm)}:${two(ss)}:${two(ff)}`;
}

/** The trim badge: `7.06s`. */
export const formatTrimSeconds = (seconds: number): string => `${Math.max(0, seconds).toFixed(2)}s`;

/**
 * Flow names a new scene after the moment it was made, in UTC: a scene created at 22:31 IST
 * came back as `Untitled Scene 10-01 17:01:34`.
 */
export function defaultSceneName(at: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `Untitled Scene ${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())} `
    + `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())}`;
}

/** Seconds per ruler unit at each zoom step; zoom-in stops at 1, zoom-out at 8. */
export const ZOOM_LEVELS = [1, 2, 4, 8] as const;
/** Width of one ruler unit, and of the first, unlabelled-width `00` unit. */
export const UNIT_WIDTH = 102;
export const FIRST_UNIT_WIDTH = 21;
/** The ruler always draws at least this many units, so it overruns a 1528px timeline. */
export const MIN_UNITS = 17;
/** The playhead's hit target is 16px wide and centred on its time. */
export const PLAYHEAD_HALF = 8;

export const pxPerSecond = (secondsPerUnit: number): number => UNIT_WIDTH / secondsPerUnit;

export const timeToX = (seconds: number, secondsPerUnit: number): number =>
  FIRST_UNIT_WIDTH + seconds * pxPerSecond(secondsPerUnit);

export const xToTime = (x: number, secondsPerUnit: number): number =>
  Math.max(0, (x - FIRST_UNIT_WIDTH) / pxPerSecond(secondsPerUnit));

export function rulerUnitCount(totalSeconds: number, secondsPerUnit: number): number {
  return Math.max(MIN_UNITS, Math.ceil(totalSeconds / secondsPerUnit) + 3);
}

/** Ruler labels are whole seconds, two digits: `00 01 02` at 1s, `00 08 16 24` at 8s. */
export const rulerLabel = (index: number, secondsPerUnit: number): string =>
  String(index * secondsPerUnit).padStart(2, '0');

/**
 * Filmstrip frames for a clip `width` px wide: one per ~unit of width, at least one. Measured:
 * 816px → 8, 636px (a 6.24s trim) → 7, 408px → 4, 204px → 2, 102px → 1.
 */
export const filmstripCount = (width: number): number => Math.max(1, Math.ceil(width / UNIT_WIDTH - 0.01));

export interface ClipSpan {
  trimStart: number;
  trimEnd: number;
}

export const clipDuration = (clip: ClipSpan): number => Math.max(0, clip.trimEnd - clip.trimStart);

/** Start time of every clip on the scene's clock, plus the total. */
export function clipStarts(clips: ClipSpan[]): { starts: number[]; total: number } {
  const starts: number[] = [];
  let at = 0;
  for (const clip of clips) {
    starts.push(at);
    at += clipDuration(clip);
  }
  return { starts, total: at };
}

/** Which clip plays at scene time `t`, and where inside its source. */
export function locateTime(clips: ClipSpan[], t: number): { index: number; sourceTime: number } | null {
  if (!clips.length) return null;
  const { starts, total } = clipStarts(clips);
  const time = Math.min(Math.max(0, t), total);
  for (let i = clips.length - 1; i >= 0; i -= 1) {
    if (time >= starts[i] - 1e-6) {
      const local = Math.min(time - starts[i], clipDuration(clips[i]));
      return { index: i, sourceTime: clips[i].trimStart + local };
    }
  }
  return { index: 0, sourceTime: clips[0].trimStart };
}

/** The smallest a trim may leave a clip. */
export const MIN_CLIP_SECONDS = 0.5;

/* ---- Reordering clips by drag: Angular CDK's single-axis sort, as Flow's timeline runs it ---- */

/** Each clip's left edge (track px) when laid end to end in `order`. */
export function placeInOrder(order: readonly string[], widthOf: (id: string) => number): Map<string, number> {
  const out = new Map<string, number>();
  let x = 0;
  for (const id of order) {
    out.set(id, x);
    x += widthOf(id);
  }
  return out;
}

/** The clip a drag last traded places with, which way the pointer was going, and whether it is still on it. */
export interface DragSwap {
  id: string;
  delta: number;
  overlaps: boolean;
}

/**
 * One step of the sort: the clip under the pointer (`x`, in track px) takes the dragged clip's
 * place and the dragged clip its. Null when that changes nothing. The clip last traded with is
 * passed over while the pointer is still on it and still going the same way (`direction`, -1 or
 * 1): clips of different widths would otherwise trade back on the next move, and again after.
 */
export function sortDragOrder(
  order: readonly string[],
  dragged: string,
  x: number,
  widthOf: (id: string) => number,
  direction: number,
  lastSwap: DragSwap,
): { order: string[]; lastSwap: DragSwap } | null {
  const at = placeInOrder(order, widthOf);
  const over = order.find((id) => {
    if (id === dragged) return false;
    if (id === lastSwap.id && lastSwap.overlaps && direction === lastSwap.delta) return false;
    const left = at.get(id) ?? 0;
    return x >= Math.floor(left) && x < Math.floor(left + widthOf(id));
  });
  if (!over) return null;
  const next = order.filter((id) => id !== dragged);
  next.splice(order.indexOf(over), 0, dragged);
  const overLeft = placeInOrder(next, widthOf).get(over) ?? 0;
  return { order: next, lastSwap: { id: over, delta: direction, overlaps: x >= overLeft && x < overLeft + widthOf(over) } };
}
