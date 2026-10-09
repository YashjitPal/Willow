// One-off: features/media/src/gallery-layout.ts against the inline algorithm MediaView's
// galleryLayoutItems had before it moved there, on random galleries. Prints the first mismatch.
//   node tools/scratch/gallery-layout-equivalence.mjs
import path from 'node:path';
import { importTs } from '../../apps/studio/test/ts-module.mjs';

const REPO = path.resolve(import.meta.dirname, '../..');
const { layoutGallery } = await importTs(path.join(REPO, 'features/media/src/gallery-layout.ts'));

function original(cellsIn, visibleWidth, targetH) {
  const gap = 12;
  const layoutTargetH = targetH * 1.2;
  const rows = [];
  let currentRow = [];
  let currentRowSumAR = 0;
  const getRowHeight = (sumAR, count) => (count === 0 ? 0 : (visibleWidth - (count - 1) * gap) / sumAR);
  const getDiff = (h) => Math.abs(h - layoutTargetH);
  cellsIn.forEach(({ item, ar }) => {
    const arWithItem = currentRowSumAR + ar;
    const countWithItem = currentRow.length + 1;
    const heightWithItem = getRowHeight(arWithItem, countWithItem);
    if (currentRow.length === 0) {
      currentRow.push({ item, ar });
      currentRowSumAR = ar;
    } else {
      const heightWithoutItem = getRowHeight(currentRowSumAR, currentRow.length);
      if (getDiff(heightWithItem) <= getDiff(heightWithoutItem)) {
        currentRow.push({ item, ar });
        currentRowSumAR = arWithItem;
      } else {
        rows.push({ items: currentRow, height: heightWithoutItem, sumAR: currentRowSumAR, isLast: false });
        currentRow = [{ item, ar }];
        currentRowSumAR = ar;
      }
    }
  });
  if (currentRow.length > 0) rows.push({ items: currentRow, height: getRowHeight(currentRowSumAR, currentRow.length), sumAR: currentRowSumAR, isLast: true });
  let sumHeights = 0;
  let fullRowsCount = 0;
  for (const r of rows) if (!r.isLast) { sumHeights += r.height; fullRowsCount++; }
  const averageFullRowHeight = fullRowsCount > 0 ? sumHeights / fullRowsCount : layoutTargetH;
  const out = [];
  rows.forEach((row) => {
    let finalRowHeight = row.height;
    let isCapped = false;
    if (row.isLast) {
      const capHeight = fullRowsCount > 0 ? averageFullRowHeight : layoutTargetH;
      if (finalRowHeight > capHeight * 1.5) { finalRowHeight = capHeight; isCapped = true; }
    }
    row.items.forEach((cell) => out.push({ item: cell.item, ar: cell.ar, finalHeight: finalRowHeight, finalWidth: finalRowHeight * cell.ar, isCapped, isLastRow: row.isLast }));
  });
  return out;
}

const ARS = [16 / 9, 4 / 3, 1, 3 / 4, 9 / 16, 21 / 9, 2 / 3];
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
let checked = 0;
for (let trial = 0; trial < 5000; trial++) {
  const n = Math.floor(rand() * 40);
  const cells = Array.from({ length: n }, (_, i) => ({ item: i, ar: ARS[Math.floor(rand() * ARS.length)] }));
  const width = 200 + rand() * 2200;
  const target = rand() < 0.5 ? 230 : 270;
  const a = JSON.stringify(original(cells, width, target));
  const b = JSON.stringify(layoutGallery(cells, width, target));
  if (a !== b) {
    console.log('MISMATCH', { n, width, target });
    console.log(a.slice(0, 400));
    console.log(b.slice(0, 400));
    process.exit(1);
  }
  checked++;
}
console.log(`identical on ${checked} random galleries`);
