import { createPageId, inlinePlainText, type PageBlock, type PageBlockLayout, type PageTableAlign, type PageTableCell, type PageTableRow } from "./state/page-document";

export type TableBlock = Extract<PageBlock, { type: "table" }>;
export type TableAxis = "row" | "column";
/** `_B`/`Lf` actions offered by the row and column menus (`cH`). */
export type TableAxisAction = "insert-before" | "insert-after" | "move-before" | "move-after" | "delete";

/** `IB`: narrowest column the resize handles allow. */
export const minimumColumnWidth = 64;

/** `L0a` */
function clampTableSize(value: number) {
  return Math.max(1, Math.min(20, value));
}

/** `k0a` */
const tableQuery = /^table(?:\s+(\d+)\s*[xX]\s*(\d+))?$/;

/** `S1a`: the size a slash query asks for (`/table 4x5` is 4 rows by 5 columns), 3×3 otherwise. */
export function tableSizeFromQuery(query: string | undefined) {
  const trimmed = (query ?? "").trim().toLowerCase();
  const match = tableQuery.exec(trimmed.startsWith("/") ? trimmed.slice(1).trim() : trimmed);
  if (match == null) return { rows: 3, columns: 3 };
  const rows = Number.parseInt(match[1] ?? "", 10);
  const columns = Number.parseInt(match[2] ?? "", 10);
  return Number.isNaN(rows) || Number.isNaN(columns) ? { rows: 3, columns: 3 } : { rows: clampTableSize(rows), columns: clampTableSize(columns) };
}

function emptyCell(align?: PageTableAlign): PageTableCell {
  return align == null ? { content: [] } : { content: [], align };
}

/** `C1a`: an empty table whose first row is the header. */
export function createTable(rows = 3, columns = 3): TableBlock {
  const rowCount = clampTableSize(rows);
  const columnCount = clampTableSize(columns);
  return { id: createPageId("block"), type: "table", rows: Array.from({ length: rowCount }, () => ({ cells: Array.from({ length: columnCount }, () => emptyCell()) })) };
}

/** `T1a` */
export function tableColumnCount(table: TableBlock) {
  return Math.max(0, ...table.rows.map((row) => row.cells.length));
}

/** Every row has the same number of cells (`XB`'s uniform check; the model has no spans). */
export function isUniformTable(table: TableBlock) {
  const count = table.rows[0]?.cells.length ?? 0;
  return table.rows.every((row) => row.cells.length === count);
}

/** `p` in address-utils: 0 is A, 25 is Z, 26 is AA. */
export function columnLetter(index: number) {
  let label = "";
  for (let value = index + 1; value > 0; ) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - remainder) / 26);
  }
  return label;
}

/** `$1a`: an empty row at `index`. A row inserted at 0 becomes the header (`K1a` demotes the old one); new cells copy the first row's `align`. */
export function insertTableRow(table: TableBlock, index: number): TableBlock {
  const columns = tableColumnCount(table);
  if (columns <= 0) return table;
  const at = Math.max(0, Math.min(index, table.rows.length));
  const row: PageTableRow = { cells: Array.from({ length: columns }, (_, column) => emptyCell(table.rows[0]?.cells[column]?.align)) };
  return { ...table, rows: [...table.rows.slice(0, at), row, ...table.rows.slice(at)] };
}

/** `e0a`: removes row `index`; when the header goes, the next row becomes the header (`K1a`). */
export function deleteTableRow(table: TableBlock, index: number): TableBlock | null {
  if (table.rows.length <= 1) return null;
  const at = Math.max(0, Math.min(index, table.rows.length - 1));
  return { ...table, rows: table.rows.filter((_, row) => row !== at) };
}

/** `Q1a` (`Z1a`): an empty column at `index`; it has no stored width until resized or fitted. */
export function insertTableColumn(table: TableBlock, index: number): TableBlock {
  const at = Math.max(0, index);
  const rows = table.rows.map((row) => {
    const position = Math.min(at, row.cells.length);
    return { ...row, cells: [...row.cells.slice(0, position), emptyCell(), ...row.cells.slice(position)] };
  });
  const widths = tableColumnWidths(table);
  if (widths == null) return { ...table, rows };
  const position = Math.min(at, widths.length);
  return { ...table, rows, columnWidths: [...widths.slice(0, position), null, ...widths.slice(position)] };
}

/** `t0a`'s check: whether column `index` holds text (`D0a` asks before the slash menu deletes it). */
export function tableColumnHasContent(table: TableBlock, index: number) {
  return table.rows.some((row) => index < row.cells.length && inlinePlainText(row.cells[index]?.content ?? []).trim().length > 0);
}

/** `t0a`: removes column `index`; null when a row would be left without cells. */
export function deleteTableColumn(table: TableBlock, index: number): TableBlock | null {
  const affected = table.rows.filter((row) => index < row.cells.length);
  if (affected.length === 0 || affected.some((row) => row.cells.length <= 1)) return null;
  const rows = table.rows.map((row) => (index < row.cells.length ? { ...row, cells: row.cells.filter((_, column) => column !== index) } : row));
  const widths = tableColumnWidths(table);
  return withColumnWidths({ ...table, rows }, widths?.filter((_, column) => column !== index) ?? null);
}

function moveItem<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

/** `o0a`: moves row or column `from` to index `to`. The header row never moves and nothing moves above it; ragged tables don't move. */
export function moveTableAxis(table: TableBlock, axis: TableAxis, from: number, to: number): TableBlock | null {
  const count = axis === "row" ? table.rows.length : tableColumnCount(table);
  if (!Number.isInteger(to) || to < 0 || to >= count || to === from || (axis === "row" && (from === 0 || to === 0)) || !isUniformTable(table)) return null;
  if (axis === "row") return { ...table, rows: moveItem(table.rows, from, to) };
  const widths = tableColumnWidths(table);
  return {
    ...table,
    rows: table.rows.map((row) => ({ ...row, cells: moveItem(row.cells, from, to) })),
    ...(widths == null ? {} : { columnWidths: moveItem(widths, from, to) }),
  };
}

/** `V$` (`Qm`, validated by `C9t`): stored column widths, undefined unless at least one is set. */
export function tableColumnWidths(table: TableBlock): (number | null)[] | undefined {
  const widths = table.columnWidths;
  if (widths == null || !widths.some((width) => width != null && width > 0)) return undefined;
  return Array.from({ length: tableColumnCount(table) }, (_, column) => {
    const width = widths[column];
    return width != null && width > 0 ? width : null;
  });
}

/** `B$` (`hd`): stores a width for every column; nothing is stored when no width is set. */
export function withColumnWidths(table: TableBlock, widths: (number | null)[] | null): TableBlock {
  const { columnWidths: _previous, ...rest } = table;
  if (widths == null || !widths.some((width) => width != null && width > 0)) return rest;
  return { ...rest, columnWidths: Array.from({ length: tableColumnCount(table) }, (_, column) => widths[column] ?? null) };
}

/** `MB` for rows: the `pageRowHeight` of one row. */
export function withRowHeight(table: TableBlock, index: number, height: number): TableBlock {
  return { ...table, rows: table.rows.map((row, rowIndex) => (rowIndex === index ? { ...row, height } : row)) };
}

/**
 * `a` in the render chunk (`ST`): column widths, their total and the sized-table attributes, using
 * `override` while a resize previews. Unset columns take the average of the set ones.
 */
export function tableSizing(table: TableBlock, layout: PageBlockLayout, override?: number[] | null) {
  const stored = override == null ? tableColumnWidths(table) : undefined;
  const known = stored?.filter((width): width is number => width != null) ?? [];
  const average = known.length > 0 ? known.reduce((sum, width) => sum + width, 0) / known.length : 0;
  const widths = override ?? stored?.map((width) => width ?? average);
  if (widths == null) return undefined;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  return {
    widths,
    totalWidth,
    style: { inlineSize: `${totalWidth}px`, minInlineSize: layout === "full-width" ? "100%" : "0", maxInlineSize: "none" },
  };
}
