import type { PageBlockLayout } from "./state/page-document";

export type TableFitMode = "normal" | "readability";

interface FitColumn {
  minimum: number;
  maximum: number;
  padding: number;
  textLength: number;
}

/**
 * `zV`: readable column widths. Each column aims for 20–60 characters (more for longer text) within
 * its min/max-content widths; when that exceeds twice the reading width, the space above the minimums
 * is shared by the square root of each column's text length.
 */
function readableWidths(columns: FitColumn[], readingWidth: number, ch: number) {
  const ideal = columns.map(({ minimum, maximum, textLength, padding }) => Math.max(minimum, Math.min(maximum, ch * Math.min(60, Math.max(20, 1.5 * Math.sqrt(textLength))) + padding)));
  if (ideal.reduce((sum, width) => sum + width, 0) <= readingWidth * 2) return ideal;
  const widths = columns.map((column) => column.minimum);
  let remaining = readingWidth * 2 - widths.reduce((sum, width) => sum + width, 0);
  let open = columns.map((column, index) => ({ index, weight: Math.sqrt(Math.max(1, column.textLength)) }));
  while (remaining > 0.001 && open.length > 0) {
    const total = open.reduce((sum, entry) => sum + entry.weight, 0);
    const share = remaining;
    for (const { index, weight } of open) {
      const grow = Math.min((ideal[index] ?? 0) - (widths[index] ?? 0), (share * weight) / total);
      widths[index] = (widths[index] ?? 0) + grow;
      remaining -= grow;
    }
    open = open.filter(({ index }) => (ideal[index] ?? 0) - (widths[index] ?? 0) > 0.001);
  }
  return widths;
}

/** `Od` for one row of widths: every width is a positive number. */
function validWidths(widths: number[]) {
  return widths.length > 0 && widths.every((width) => Number.isFinite(width) && width > 0);
}

/**
 * `VV`: lays a copy of the table out in the reading column of a hidden twin of the editor root and
 * reads the column widths a Fit action stores. "normal" fits the reading width; "readability" sizes
 * columns for comfortable line lengths and becomes Flexible when wider than the reading column.
 */
export function measureTableFit(root: HTMLElement, table: HTMLTableElement, zoom: number, mode: TableFitMode): { layout: PageBlockLayout; widths: number[] } | null {
  const clone = table.cloneNode(true);
  if (!(clone instanceof HTMLTableElement)) return null;
  const host = root.ownerDocument.createElement("div");
  host.className = root.className;
  host.classList.add("absolute", "invisible", "pointer-events-none");
  host.inert = true;
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = root.style.cssText;
  host.style.display = "grid";
  host.style.inlineSize = `${root.getBoundingClientRect().width / zoom}px`;
  host.style.gridTemplateColumns = getComputedStyle(root).gridTemplateColumns;
  clone.removeAttribute("data-page-table-resized");
  clone.querySelectorAll("th, td").forEach((cell) => {
    cell.removeAttribute("data-page-column-width");
    if (cell instanceof HTMLElement) cell.style.width = "";
  });
  clone.removeAttribute("data-page-layout");
  clone.querySelectorAll("colgroup, [data-page-column-resize]").forEach((element) => element.remove());
  clone.style.gridColumn = "reading";
  clone.style.inlineSize = "100%";
  clone.style.maxInlineSize = "none";
  clone.style.tableLayout = "auto";
  clone.style.overflowWrap = mode === "normal" ? "anywhere" : "normal";
  host.append(clone);
  root.after(host);
  let widths: number[] | undefined;
  let layout: PageBlockLayout = "normal";
  try {
    const columnWidths = () => Array.from(clone.rows[0]?.cells ?? [], (cell) => cell.getBoundingClientRect().width / zoom);
    if (mode === "readability") {
      const probe = root.ownerDocument.createElement("div");
      probe.style.gridColumn = "reading";
      host.append(probe);
      const readingWidth = probe.getBoundingClientRect().width / zoom;
      probe.style.inlineSize = "1ch";
      const ch = probe.getBoundingClientRect().width / zoom;
      if (readingWidth <= 0 || ch <= 0) return null;
      clone.querySelectorAll<HTMLElement>("th").forEach((cell) => {
        cell.style.whiteSpace = "nowrap";
      });
      clone.style.inlineSize = "min-content";
      const minimums = columnWidths();
      clone.style.inlineSize = "max-content";
      const maximums = columnWidths();
      widths = readableWidths(
        minimums.map((minimum, column) => {
          const style = getComputedStyle(clone.rows[0]?.cells[column] ?? clone);
          return {
            minimum,
            maximum: maximums[column] ?? minimum,
            padding: (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0),
            textLength: Array.from(clone.rows).reduce((longest, row) => Math.max(longest, row.cells[column]?.textContent?.length ?? 0), 0),
          };
        }),
        readingWidth,
        ch,
      );
      if (widths.reduce((sum, width) => sum + width, 0) > readingWidth) layout = "flexible";
    } else widths = columnWidths();
  } finally {
    host.remove();
  }
  return widths != null && validWidths(widths) ? { layout, widths } : null;
}

/** `BV`: the current total width shared equally by every column. */
export function evenColumnWidths(table: HTMLTableElement, zoom: number, columns: number) {
  const total = Array.from(table.rows[0]?.cells ?? []).reduce((sum, cell) => sum + cell.getBoundingClientRect().width, 0);
  const widths = Array.from({ length: columns }, () => total / zoom / columns);
  return validWidths(widths) ? widths : null;
}

/** The slash menu's table sizing (`h2a`): equal columns filling the block viewport. */
export function viewportColumnWidths(table: HTMLTableElement, columns: number) {
  const viewport = table.closest<HTMLElement>("[data-page-block-viewport]");
  if (viewport == null || columns === 0) return null;
  const viewportStyle = getComputedStyle(viewport);
  const tableStyle = getComputedStyle(table);
  const width =
    (Number.parseFloat(viewportStyle.width) -
      (Number.parseFloat(viewportStyle.paddingLeft) || 0) -
      (Number.parseFloat(viewportStyle.paddingRight) || 0) -
      (Number.parseFloat(tableStyle.borderLeftWidth) || 0) -
      (Number.parseFloat(tableStyle.borderRightWidth) || 0)) /
    columns;
  return width > 0 ? Array.from({ length: columns }, () => width) : null;
}
