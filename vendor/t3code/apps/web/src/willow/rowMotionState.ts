/**
 * What changed between two renders of the timeline's rows, for its motion (willow/rowMotion.ts):
 * the rows that arrived, the rows a disclosure opened, and the rows that left as a disclosure
 * closed or a turn settled into its "Worked for". Those last stay in the list a moment longer as
 * ghosts so they can shrink away, as the ChatGPT app's AnimatePresence lets them. Pure, so it
 * can run while rendering: the leaving rows are kept in the very render that drops them.
 */
import { arrivedRowIds, leftRowBlocks, TURN_FOLD_CLOSE, type MotionPreset } from "./rowMotion";

interface MotionRow {
  readonly id: string;
  readonly kind: string;
}

/** A disclosure the reader just opened or closed, the toggle's own motion with it. */
export interface DisclosureMotion {
  readonly serial: number;
  readonly kind: "open" | "close";
  readonly preset: MotionPreset;
}

export interface GhostBlock<Row> {
  readonly key: string;
  readonly rows: ReadonlyArray<Row>;
  readonly afterId: string | null;
  readonly beforeId: string | null;
  readonly preset: MotionPreset;
}

export interface RowMotionChange<Row> {
  readonly serial: number;
  readonly arrived: ReadonlyArray<string>;
  readonly opened: { readonly rowIds: ReadonlyArray<string>; readonly preset: MotionPreset } | null;
  readonly left: ReadonlyArray<GhostBlock<Row>>;
}

export interface RowMotionState<Row> {
  readonly key: string;
  readonly rows: ReadonlyArray<Row>;
  readonly ghosts: ReadonlyArray<GhostBlock<Row>>;
  readonly change: RowMotionChange<Row> | null;
  readonly consumedDisclosure: number | null;
}

export function initialRowMotionState<Row>(
  key: string,
  rows: ReadonlyArray<Row>,
  disclosure: DisclosureMotion | null,
): RowMotionState<Row> {
  return { key, rows, ghosts: [], change: null, consumedDisclosure: disclosure?.serial ?? null };
}

export function nextRowMotionState<Row extends MotionRow>(
  state: RowMotionState<Row>,
  rows: ReadonlyArray<Row>,
  key: string,
  disclosure: DisclosureMotion | null,
): RowMotionState<Row> {
  // Another thread: nothing in it arrives or leaves.
  if (state.key !== key) return initialRowMotionState(key, rows, disclosure);
  const previous = state.rows;
  const previousIds = new Set(previous.map((row) => row.id));
  const currentIds = new Set(rows.map((row) => row.id));
  // Toggles count up, so one already used is never used again.
  const pending =
    disclosure && disclosure.serial > (state.consumedDisclosure ?? 0) ? disclosure : null;
  const serial = (state.change?.serial ?? 0) + 1;
  const added = rows.filter((row) => !previousIds.has(row.id)).map((row) => row.id);
  // A settled turn folds its work behind "Worked for", which takes the "Working for" row's place.
  const foldSettled = rows.some((row) => row.kind === "turn-fold" && !previousIds.has(row.id));
  const replacesWorking = previous.some((row) => row.kind === "working");

  // Rows coming back while they leave stop leaving.
  const staying = state.ghosts
    .map((block) => ({ ...block, rows: block.rows.filter((row) => !currentIds.has(row.id)) }))
    .filter((block) => block.rows.length > 0);
  const left: GhostBlock<Row>[] =
    pending?.kind === "close" || foldSettled
      ? leftRowBlocks(previous, currentIds)
          .map((block) => ({ ...block, rows: block.rows.filter((row) => row.kind !== "working") }))
          .filter((block) => block.rows.length > 0)
          .map((block, index) => ({
            ...block,
            key: `${serial}:${index}`,
            preset: pending?.kind === "close" ? pending.preset : TURN_FOLD_CLOSE,
          }))
      : [];
  const opened =
    pending?.kind === "open" && added.length > 0 ? { rowIds: added, preset: pending.preset } : null;
  const kindOf = new Map(rows.map((row) => [row.id, row.kind]));
  const arrived = opened
    ? []
    : arrivedRowIds(
        rows.map((row) => row.id),
        previousIds,
      ).filter((rowId) => !(replacesWorking && kindOf.get(rowId) === "turn-fold"));
  return {
    key,
    rows,
    ghosts: [...staying, ...left],
    change: { serial, arrived, opened, left },
    consumedDisclosure: pending?.serial ?? state.consumedDisclosure,
  };
}

/** The rows with each ghost block back where it was: before the row that followed it. */
export function withGhostRows<Row extends MotionRow>(
  rows: ReadonlyArray<Row>,
  ghosts: ReadonlyArray<GhostBlock<Row>>,
): ReadonlyArray<Row> {
  if (ghosts.length === 0) return rows;
  const out = [...rows];
  const present = new Set(rows.map((row) => row.id));
  for (const block of ghosts) {
    const blockRows = block.rows.filter((row) => !present.has(row.id));
    if (blockRows.length === 0) continue;
    let index = block.beforeId === null ? -1 : out.findIndex((row) => row.id === block.beforeId);
    if (index < 0 && block.afterId !== null) {
      const after = out.findIndex((row) => row.id === block.afterId);
      index = after < 0 ? -1 : after + 1;
    }
    out.splice(index < 0 ? out.length : index, 0, ...blockRows);
    for (const row of blockRows) present.add(row.id);
  }
  return out;
}
