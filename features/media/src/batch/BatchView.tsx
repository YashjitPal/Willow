// Flow's batch view: the gallery's tiles grouped by batch, each batch a grid of its rows (left)
// and its flow-batch-info (right), 64px apart. MediaView hands over the tiles in display order and
// renders each one at the size given here, so tiles keep every gallery behaviour.
import React from 'react';
import { batchTilesWidth, groupBatches, layoutBatchRows, BATCH_PHONE_MAX_WIDTH, type BatchRow, type GridSize } from './batch-layout';
import './batch.css';

export interface LaidOutBatch<T> {
  key: string;
  tiles: T[];
  rows: BatchRow<T>[];
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function useViewportWidth(): number {
  const [width, setWidth] = React.useState(() => window.innerWidth);
  React.useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export function BatchView<T>({
  tiles,
  gridSize,
  keyOf,
  idOf,
  aspectOf,
  renderTile,
  renderInfo,
}: {
  tiles: T[];
  gridSize: GridSize;
  keyOf: (tile: T) => string;
  idOf: (tile: T) => string;
  aspectOf: (tile: T) => number;
  renderTile: (tile: T, width: number, height: number) => React.ReactNode;
  renderInfo: (batch: LaidOutBatch<T>) => React.ReactNode;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listWidth = useWidth(rootRef);
  const viewportWidth = useViewportWidth();
  const phone = viewportWidth <= BATCH_PHONE_MAX_WIDTH;
  const tilesWidth = batchTilesWidth(listWidth, viewportWidth, gridSize);
  const batches = React.useMemo(
    (): LaidOutBatch<T>[] => groupBatches(tiles, keyOf).map((b) => ({ ...b, rows: layoutBatchRows(b.tiles, tilesWidth, gridSize, aspectOf) })),
    [tiles, keyOf, tilesWidth, gridSize, aspectOf],
  );
  return (
    <div ref={rootRef} className="bv-list">
      {listWidth > 0 && batches.map((batch) => (
        <div key={batch.key} className={`bv-batch${gridSize === 'L' ? ' bv-batch--large' : ''}${phone ? ' bv-batch--phone' : ''}`}>
          <div className="bv-tiles">
            {batch.rows.map((row) => (
              <div key={idOf(row.tiles[0])} className="bv-row" style={{ height: row.height }}>
                {row.tiles.map((tile) => renderTile(tile, aspectOf(tile) * row.height, row.height))}
              </div>
            ))}
          </div>
          {renderInfo(batch)}
        </div>
      ))}
    </div>
  );
}
