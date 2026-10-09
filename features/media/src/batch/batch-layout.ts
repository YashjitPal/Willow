// Flow's batch view (View settings > View mode > Batch): the grid regrouped by the submission each
// tile came from. A batch is a two-column grid — its tiles in rows, its info column beside them —
// and its rows are not justified: every row has one height, set by the first tile's shape, and
// tiles keep their own aspect ratio. Numbers from Flow's bundle, measured against it at S, M and L
// (tools/ui-research/captures/flow/media/batch/).
import type { MediaItem } from '../types';

export type GridSize = 'S' | 'M' | 'L';

/** Between tiles in a row, and between rows. */
export const BATCH_ROW_GAP = 16;
/** Between one batch and the next. */
export const BATCH_GAP = 64;
/** Between the tiles column and the info column. */
export const BATCH_COLUMN_GAP = 32;
/** The batch's own max width (96.25rem). */
export const BATCH_MAX_WIDTH = 1540;
/** Flow's phone layout: one column, the info under the tiles. */
export const BATCH_PHONE_MAX_WIDTH = 600;

/** Each grid size's target row height, used when a batch has no width to fill. */
const SIZE_TARGET: Record<GridSize, number> = { S: 150, M: 250, L: 400 };

/** The info column: 25rem from 1280px wide, 16rem below that and at grid size L. */
export function batchInfoWidth(viewportWidth: number, size: GridSize): number {
  return viewportWidth >= 1280 && size !== 'L' ? 400 : 256;
}

/** The width a batch's rows fill, from the width the batch list has. */
export function batchTilesWidth(listWidth: number, viewportWidth: number, size: GridSize): number {
  const width = Math.min(listWidth, BATCH_MAX_WIDTH);
  if (viewportWidth <= BATCH_PHONE_MAX_WIDTH) return width;
  return Math.max(0, width - BATCH_COLUMN_GAP - batchInfoWidth(viewportWidth, size));
}

/**
 * A batch's row height: what fits a set number of tiles of the first tile's shape across the
 * width — portrait 4 (6 at S), anything else 2 (4 at S).
 */
export function batchRowHeight(aspect: number, width: number, size: GridSize): number {
  if (width <= 0 || aspect <= 0) return SIZE_TARGET[size];
  const small = size === 'S';
  const perRow = aspect < 1 ? (small ? 6 : 4) : (small ? 4 : 2);
  const free = width - (perRow - 1) * BATCH_ROW_GAP;
  return free <= 0 ? SIZE_TARGET[size] : free / (perRow * aspect);
}

export interface BatchRow<T> {
  tiles: T[];
  height: number;
}

/**
 * One batch's rows: tiles wrap at the row height. At L a tile alone in its row grows — a portrait
 * or square one to 1.5x, a landscape one to the full width. Below 500px wide every size is L.
 */
export function layoutBatchRows<T>(tiles: T[], width: number, size: GridSize, aspectOf: (tile: T) => number): BatchRow<T>[] {
  if (!tiles.length || width <= 0) return [];
  const effective: GridSize = width < 500 ? 'L' : size;
  const firstAspect = aspectOf(tiles[0]) || 1;
  const height = batchRowHeight(firstAspect, width, effective);
  const rowHeight = (row: T[]): number => {
    if (effective !== 'L' || row.length !== 1) return height;
    const aspect = aspectOf(row[0]) || firstAspect;
    return aspect <= 1 ? height * 1.5 : width / aspect;
  };
  const rows: BatchRow<T>[] = [];
  let row: T[] = [];
  let used = 0;
  for (const tile of tiles) {
    const tileWidth = aspectOf(tile) * height;
    used += (row.length ? BATCH_ROW_GAP : 0) + tileWidth;
    if (used <= width + 0.1 || !row.length) {
      row.push(tile);
    } else {
      rows.push({ tiles: row, height: rowHeight(row) });
      row = [tile];
      used = tileWidth;
    }
  }
  if (row.length) rows.push({ tiles: row, height: rowHeight(row) });
  return rows;
}

/** A batch's height: its rows and the gaps between them. */
export function batchHeight(rows: BatchRow<unknown>[]): number {
  return rows.length ? rows.reduce((sum, r) => sum + r.height, 0) + (rows.length - 1) * BATCH_ROW_GAP : 0;
}

/** The batches, in the order their first tile appears. */
export function groupBatches<T>(tiles: T[], keyOf: (tile: T) => string): { key: string; tiles: T[] }[] {
  const byKey = new Map<string, T[]>();
  const order: string[] = [];
  for (const tile of tiles) {
    const key = keyOf(tile);
    let list = byKey.get(key);
    if (!list) {
      list = [];
      byKey.set(key, list);
      order.push(key);
    }
    list.push(tile);
  }
  return order.map((key) => ({ key, tiles: byKey.get(key) as T[] }));
}

const UPLOADED_MODELS = new Set(['upload', 'external']);

/** Made by a model from a prompt, rather than uploaded or dropped into the folder. */
export const isGenerated = (item: MediaItem): boolean => !UPLOADED_MODELS.has(item.modelId) && !!item.prompt;

/** Between two outputs of one submission, at most: they land within moments of each other. */
export const LEGACY_BATCH_GAP_MS = 60_000;

/**
 * Batch keys for items with no `batchId`: everything made before it existed, and the files the
 * reconcile adopted back from the folder ("cute army.mp4", "cute army (1).mp4"…, which return
 * with modelId 'external' and their shared name as prompt). One prompt's outputs share kind,
 * model, ratio and prompt and arrived together — stamped 1ms apart, or written to disk as each
 * finished — so items that match are one batch until the next one is more than
 * LEGACY_BATCH_GAP_MS older. Uploads are each a batch of their own, as in Flow.
 */
export function legacyBatchKeys(items: MediaItem[]): Map<string, string> {
  const keys = new Map<string, string>();
  const groups = new Map<string, MediaItem[]>();
  for (const item of items) {
    if (item.batchId || !item.prompt || item.modelId === 'upload') continue;
    const key = [item.kind, item.modelId, item.ratio, item.prompt].join('\u0000');
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => b.timestamp - a.timestamp);
    let runKey = '';
    let prev: MediaItem | undefined;
    for (const item of list) {
      if (!prev || prev.timestamp - item.timestamp > LEGACY_BATCH_GAP_MS) runKey = `legacy-${item.id}`;
      keys.set(item.id, runKey);
      prev = item;
    }
  }
  return keys;
}

/** Flow's ratio names and glyphs (5% tolerance), or the ratio itself on crop_free. */
const NAMED_RATIOS: { value: number; label: string; icon: string }[] = [
  { value: 16 / 9, label: '16:9', icon: 'crop_16_9' },
  { value: 4 / 3, label: '4:3', icon: 'crop_landscape' },
  { value: 1, label: '1:1', icon: 'crop_square' },
  { value: 3 / 4, label: '3:4', icon: 'crop_portrait' },
  { value: 9 / 16, label: '9:16', icon: 'crop_9_16' },
];

export function ratioValue(ratio: string | undefined): number {
  const [w, h] = (ratio || '16:9').split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

export function aspectLabel(ratio: string | undefined): { label: string; icon: string } {
  const value = ratioValue(ratio);
  const named = NAMED_RATIOS.find((r) => Math.abs(value - r.value) / r.value < 0.05);
  return named ? { label: named.label, icon: named.icon } : { label: ratio || '', icon: 'crop_free' };
}

/** Whole seconds, however long: "8s", "75s". */
export const formatDuration = (seconds: number): string => `${Math.round(seconds)}s`;

/** A video's resolution as Flow names it, by its shorter side. */
export function resolutionLabel(width: number, height: number): string | undefined {
  if (width <= 0 || height <= 0) return undefined;
  const side = Math.min(width, height);
  return side <= 400 ? '360p' : side <= 800 ? '720p' : side <= 1200 ? '1080p' : '4K';
}

/** "Created Oct 2, 2026". */
export function createdLabel(time: number): string {
  return `Created ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(time))}`;
}
