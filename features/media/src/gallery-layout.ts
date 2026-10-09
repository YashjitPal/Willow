// The gallery grid's justified rows, shared by All media and the Characters tab so the two arrange
// alike. Tiles keep their aspect ratio and every row is scaled to the width; a row takes the next tile
// while that brings its height nearer the target. The last row keeps its own height unless that is
// more than 1.5x the full rows' average (the target, when it is the only row), and is then held there.
// `uniformLastRow` holds it at the full rows' height whenever it would be taller, as Flow's grid does:
// for a grid of squares, where a larger last row reads as a different size of tile.

export const GALLERY_GAP = 12;

export interface GalleryCell<T> {
  item: T;
  ar: number;
  finalHeight: number;
  finalWidth: number;
  isCapped: boolean;
  isLastRow: boolean;
}

/** Lays `cells` out in rows `visibleWidth` wide that wrap around `targetH`. */
export function layoutGallery<T>(
  cells: ReadonlyArray<{ item: T; ar: number }>,
  visibleWidth: number,
  targetH: number,
  { gap = GALLERY_GAP, uniformLastRow = false }: { gap?: number; uniformLastRow?: boolean } = {},
): GalleryCell<T>[] {
  if (!cells.length) return [];
  // Biased up 20% for the wrapping test: two tiles a row with the left sidebar open, three at full
  // width, and two again when both sidebars are open.
  const layoutTargetH = targetH * 1.2;
  const rowHeight = (sumAR: number, count: number) => (count === 0 ? 0 : (visibleWidth - (count - 1) * gap) / sumAR);
  const diff = (h: number) => Math.abs(h - layoutTargetH);

  const rows: Array<{ cells: Array<{ item: T; ar: number }>; height: number; isLast: boolean }> = [];
  let row: Array<{ item: T; ar: number }> = [];
  let sumAR = 0;
  for (const cell of cells) {
    if (row.length === 0) {
      row = [cell];
      sumAR = cell.ar;
      continue;
    }
    const without = rowHeight(sumAR, row.length);
    if (diff(rowHeight(sumAR + cell.ar, row.length + 1)) <= diff(without)) {
      row.push(cell);
      sumAR += cell.ar;
    } else {
      rows.push({ cells: row, height: without, isLast: false });
      row = [cell];
      sumAR = cell.ar;
    }
  }
  rows.push({ cells: row, height: rowHeight(sumAR, row.length), isLast: true });

  const full = rows.filter((r) => !r.isLast);
  const capHeight = full.length ? full.reduce((sum, r) => sum + r.height, 0) / full.length : layoutTargetH;
  const capScale = uniformLastRow && full.length ? 1 : 1.5;
  const out: GalleryCell<T>[] = [];
  for (const r of rows) {
    const isCapped = r.isLast && r.height > capHeight * capScale;
    const finalHeight = isCapped ? capHeight : r.height;
    for (const cell of r.cells) {
      out.push({ item: cell.item, ar: cell.ar, finalHeight, finalWidth: finalHeight * cell.ar, isCapped, isLastRow: r.isLast });
    }
  }
  return out;
}
