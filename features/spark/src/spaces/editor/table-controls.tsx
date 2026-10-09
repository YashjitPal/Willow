import { motion, useIsPresent } from "framer-motion";
import { useContext, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { useIntl } from "react-intl";
import { useReducedMotion } from "../../codex/lib/theme-engine";
import { PlusLgLight12Icon, TrashLight16Icon } from "../../codex/icons";
import { Button, Tooltip } from "../../codex/ui";
import { clippedRect } from "./block-drag";
import { tableControlsCss } from "./css";
import { tableMessages } from "./messages";
import { ControlTooltipDelay, type ControlKind } from "./page-block-controls";
import { SelectionToolbarFrame } from "./selection-toolbar";
import { menuEase } from "./slash-menu";
import { columnLetter, isUniformTable, type TableAxis, type TableBlock } from "./table-model";

/** `mV`: how long the controls stay hidden after an ancestor of the table scrolls. */
const scrollHideMs = 300;
/** `hV`: grace period after a pointer interaction inside the controls ends. */
const pointerGraceMs = 100;
/** `gV` */
const overflowRowLabel = "·";

const edgeMessages = { bottom: tableMessages.appendRow, left: tableMessages.addColumnLeft, right: tableMessages.addColumnRight } as const;

function preventDefault(event: { preventDefault: () => void }) {
  event.preventDefault();
}

interface AxisItem {
  kind: TableAxis;
  index: number;
  label: string;
  current: boolean;
}

/** `uV`: the fading, scroll-aware frame of the table controls. */
function TableControlsFrame({ ref, table, interacting, label, onKeyDownCapture, children }: { ref: RefObject<HTMLDivElement | null>; table: HTMLTableElement; interacting: boolean; label: string; onKeyDownCapture: (event: KeyboardEvent<HTMLDivElement>) => void; children: ReactNode }) {
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  const [scrolledTable, setScrolledTable] = useState<HTMLTableElement | null>(null);
  const scrolling = scrolledTable === table;
  const isInteracting = useEffectEvent(() => interacting || ref.current?.contains(table.ownerDocument.activeElement) === true);
  useLayoutEffect(() => {
    const ownerDocument = table.ownerDocument;
    const view = ownerDocument.defaultView;
    if (view == null) return;
    let hideTimer: number | undefined;
    let graceTimer: number | undefined;
    let pointerInside = false;
    const onPointerDown = (event: Event) => {
      view.clearTimeout(graceTimer);
      pointerInside = event.target instanceof Node && ref.current?.contains(event.target) === true;
    };
    const onPointerUp = () => {
      if (pointerInside) graceTimer = view.setTimeout(() => (pointerInside = false), pointerGraceMs);
    };
    const onBlur = () => {
      pointerInside = false;
    };
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !event.target.contains(table) || pointerInside || isInteracting()) return;
      setScrolledTable(table);
      view.clearTimeout(hideTimer);
      hideTimer = view.setTimeout(() => setScrolledTable(null), scrollHideMs);
    };
    ownerDocument.addEventListener("scroll", onScroll, { capture: true, passive: true });
    ownerDocument.addEventListener("pointerdown", onPointerDown, true);
    ownerDocument.addEventListener("pointerup", onPointerUp, true);
    ownerDocument.addEventListener("pointercancel", onPointerUp, true);
    view.addEventListener("blur", onBlur);
    return () => {
      ownerDocument.removeEventListener("scroll", onScroll, true);
      ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
      ownerDocument.removeEventListener("pointerup", onPointerUp, true);
      ownerDocument.removeEventListener("pointercancel", onPointerUp, true);
      view.removeEventListener("blur", onBlur);
      view.clearTimeout(hideTimer);
      view.clearTimeout(graceTimer);
    };
  }, [ref, table]);
  const hidden = !present || (scrolling && !interacting);
  return (
    <ControlTooltipDelay value={700}>
      <motion.div
        ref={ref}
        className="pointer-events-none absolute overflow-clip"
        data-page-table-controls={present ? "" : undefined}
        role="group"
        aria-label={label}
        aria-hidden={hidden}
        inert={hidden}
        initial={!reducedMotion && { opacity: 0 }}
        animate={{ opacity: scrolling && !interacting ? 0 : 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.15, ease: menuEase }}
        onKeyDownCapture={onKeyDownCapture}
      >
        {children}
      </motion.div>
    </ControlTooltipDelay>
  );
}

/** `cV`: the round button that appends a row or column at an edge. */
function TableAddButton({ label, dragging, disabled, onClick }: { label: string; dragging: boolean; disabled: boolean; onClick: () => void }) {
  const present = useIsPresent();
  const delay = useContext(ControlTooltipDelay);
  return (
    <Tooltip tooltipContent={label} open={!present || dragging ? false : undefined} closeOnTriggerClick delayDuration={delay}>
      <Button aria-label={label} color="outlineSurface" size="iconCircleSm" radius="small" data-page-table-add="" disabled={disabled} onMouseDown={preventDefault} onClick={onClick}>
        <PlusLgLight12Icon />
      </Button>
    </Tooltip>
  );
}

/** `RB`: the table toolbar with the table menu and Delete table. */
function TableToolbar({ dragging, tableMenu, onDelete }: { dragging: boolean; tableMenu: ReactNode; onDelete: () => void }) {
  const intl = useIntl();
  const present = useIsPresent();
  const delay = useContext(ControlTooltipDelay);
  const label = intl.formatMessage(tableMessages.toolbarDelete);
  return (
    <SelectionToolbarFrame>
      {tableMenu}
      <Tooltip tooltipContent={label} open={!present || dragging ? false : undefined} disableHoverOpen={!present || dragging} closeOnTriggerClick delayDuration={delay}>
        <Button aria-label={label} color="ghost" size="formatToolbarIcon" radius="full" disabled={dragging} onClick={onDelete}>
          <TrashLight16Icon />
        </Button>
      </Tooltip>
    </SelectionToolbarFrame>
  );
}

export interface TableControlsProps {
  block: TableBlock;
  table: HTMLTableElement;
  /** The caret's cell. */
  target: { row: number; column: number };
  /** `[data-page-document-selection]`, the positioned ancestor of the editor controls. */
  container: HTMLElement;
  dragging: boolean;
  /** Id of the open control menu: `row:<index>`, `column:<index>` or `block:<block id>`. */
  openMenu: string | null;
  renderMenu: (kind: ControlKind, index: number | undefined, label: string | undefined, allowDrag: boolean, tabIndex: number | undefined) => ReactNode;
  onAppend: (axis: TableAxis) => void;
  onDelete: () => void;
  onResizePointerDown: (event: PointerEvent<HTMLElement>, axis: TableAxis, index: number) => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLElement>, axis: TableAxis, index: number) => void;
  onEscape: () => void;
}

/**
 * `XB`: row numbers and column letters on rails beside the table (each opening that row's or
 * column's menu, dragging it and resizing it), add buttons at the bottom and side edges, and the
 * table toolbar below the table. Everything is placed against the visible part of the table.
 */
export function TableControls({ block, table, target, container, dragging, openMenu, renderMenu, onAppend, onDelete, onResizePointerDown, onResizeKeyDown, onEscape }: TableControlsProps) {
  const intl = useIntl();
  const rootRef = useRef<HTMLDivElement>(null);
  const rtl = getComputedStyle(table).direction === "rtl";
  const uniform = isUniformTable(block);
  const rowCount = block.rows.length;
  const columnCount = block.rows[0]?.cells.length ?? 0;
  const items: AxisItem[] = [
    ...block.rows.map((_, index) => ({ kind: "row" as const, index, label: intl.formatNumber(index + 1), current: index === target.row })),
    ...Array.from({ length: columnCount }, (_, index) => ({ kind: "column" as const, index, label: columnLetter(index), current: uniform && index === target.column })),
  ];

  const layout = useEffectEvent(() => {
    const controls = rootRef.current;
    const view = container.ownerDocument.defaultView;
    if (controls == null || view == null || !table.isConnected) return;
    const tableRect = table.getBoundingClientRect();
    const visibleTable = clippedRect(table, tableRect);
    const region = clippedRect(controls, new DOMRect(0, 0, view.innerWidth, view.innerHeight));
    if (visibleTable == null || region == null) {
      controls.hidden ||= true;
      return;
    }
    controls.hidden &&= false;
    const toolbar = controls.querySelector<HTMLElement>("[data-page-table-toolbar]");
    const maxWidth = `${region.width}px`;
    if (toolbar != null && toolbar.style.maxWidth !== maxWidth) toolbar.style.maxWidth = maxWidth;
    const origin = container.getBoundingClientRect();
    const place = (element: HTMLElement, left: number, top: number, width?: number, height?: number, relative: DOMRect = region) => {
      for (const [property, value] of [
        ["left", left - relative.left],
        ["top", top - relative.top],
        ["width", width],
        ["height", height],
      ] as const) {
        if (value == null) continue;
        const next = `${value}px`;
        if (element.style[property] !== next) element.style[property] = next;
      }
    };
    const elements = Array.from(controls.querySelectorAll<HTMLElement>("[data-page-table-menu]"));
    const rowItem = elements.find((element) => element.dataset.pageTableMenu === "row");
    const columnItem = elements.find((element) => element.dataset.pageTableMenu === "column");
    if (rowItem == null || columnItem == null) return;
    const railWidth = Number.parseFloat(view.getComputedStyle(rowItem).width) || rowItem.offsetWidth;
    const railHeight = Number.parseFloat(view.getComputedStyle(columnItem).height) || columnItem.offsetHeight;
    const half = railWidth / 2;
    const rowRailLeft = rtl ? Math.min(visibleTable.right + half, region.right - railWidth) : Math.max(visibleTable.left - railWidth - half, region.left);
    const columnRailTop = Math.max(tableRect.top - railHeight - half, region.top);
    const rowRailTop = Math.max(visibleTable.top, columnRailTop + railHeight);
    const rowRail = new DOMRect(rowRailLeft, rowRailTop, railWidth, Math.max(0, visibleTable.bottom - rowRailTop));
    const columnRail = new DOMRect(visibleTable.left, columnRailTop, visibleTable.width, railHeight);
    const rowResize = controls.querySelector<HTMLElement>("[data-page-table-row-resize]");
    const columnResize = controls.querySelector<HTMLElement>("[data-page-table-column-resize]");
    if (rowResize != null && tableRect.bottom <= visibleTable.bottom + 1) rowRail.height += (Number.parseFloat(view.getComputedStyle(rowResize).height) || rowResize.offsetHeight) / 2;
    if (columnResize != null) {
      const extra = (Number.parseFloat(view.getComputedStyle(columnResize).width) || columnResize.offsetWidth) / 2;
      if (rtl && tableRect.left >= visibleTable.left - 1) {
        columnRail.x -= extra;
        columnRail.width += extra;
      } else if (!rtl && tableRect.right <= visibleTable.right + 1) columnRail.width += extra;
    }
    const byId = new Map(elements.map((element) => [element.dataset.pageTableMenuId, element]));
    const rows = Array.from(table.rows);
    const headerCells = Array.from(rows[0]?.cells ?? []);
    const placed = items.flatMap((item) => {
      const element = byId.get(`${item.kind}:${item.index}`);
      const source = item.kind === "row" ? rows[item.index] : headerCells[item.index];
      if (element == null || source == null) return [];
      const rect = source.getBoundingClientRect();
      const start = item.kind === "row" ? Math.max(rect.top, visibleTable.top, columnRailTop + railHeight) : Math.max(rect.left, visibleTable.left);
      const end = item.kind === "row" ? Math.min(rect.bottom, visibleTable.bottom) : Math.min(rect.right, visibleTable.right);
      const edge = item.kind === "row" ? rect.bottom : rtl ? rect.left : rect.right;
      return [{ item, element, start, end, resizeClipped: edge < start - 1 || edge > end + 1, size: item.kind === "row" ? rect.height : rect.width }];
    });
    const toolbarSize = toolbar == null ? null : { width: toolbar.offsetWidth, height: toolbar.offsetHeight };
    place(controls, region.left, region.top, region.width, region.height, origin);
    for (const { item, element, start, end, resizeClipped, size } of placed) {
      const clipped = end <= start;
      if (element.hasAttribute("data-page-table-clipped") !== clipped) element.toggleAttribute("data-page-table-clipped", clipped);
      if (clipped) continue;
      if (element.hasAttribute("data-page-table-resize-clipped") !== resizeClipped) element.toggleAttribute("data-page-table-resize-clipped", resizeClipped);
      const separator = element.querySelector("[role='separator']");
      const now = `${Math.round(size)}`;
      if (separator != null && separator.getAttribute("aria-valuenow") !== now) separator.setAttribute("aria-valuenow", now);
      if (item.kind === "row") place(element, rowRailLeft, start, railWidth, end - start, rowRail);
      else place(element, start, columnRailTop, end - start, railHeight, columnRail);
    }
    for (const kind of ["row", "column"] as const) {
      const rail = controls.querySelector<HTMLElement>(`[data-page-table-rail="${kind}"]`);
      const box = kind === "row" ? rowRail : columnRail;
      if (rail != null) {
        place(rail, box.x, box.y, box.width, box.height);
        const fades =
          kind === "row"
            ? { "--top-fade": tableRect.top < box.top - 1, "--bottom-fade": tableRect.bottom > box.bottom + 1 }
            : { "--left-fade": tableRect.left < box.left - 1, "--right-fade": tableRect.right > box.right + 1 };
        for (const [name, faded] of Object.entries(fades)) {
          const value = faded ? "var(--edge-fade-distance, 1rem)" : "0px";
          if (rail.style.getPropertyValue(name) !== value) rail.style.setProperty(name, value);
        }
      }
      const visible = placed.filter((entry) => entry.item.kind === kind && entry.end > entry.start);
      const backdrop = controls.querySelector<HTMLElement>(`[data-page-table-backdrop="${kind}"]`);
      if (backdrop != null) {
        const none = visible.length === 0;
        if (backdrop.hasAttribute("data-page-table-clipped") !== none) backdrop.toggleAttribute("data-page-table-clipped", none);
        if (!none) {
          const from = Math.min(...visible.map((entry) => entry.start));
          const to = Math.max(...visible.map((entry) => entry.end));
          if (kind === "row") place(backdrop, rowRailLeft - half, from - half, railWidth + half * 2, to - from + half * 2);
          else place(backdrop, from - half, columnRailTop - half, to - from + half * 2, railHeight + half * 2);
        }
      }
      const focusTarget = visible.find((entry) => entry.item.current) ?? visible[0];
      const resizable = visible.filter((entry) => !entry.resizeClipped);
      const resizeTarget = resizable.find((entry) => entry.item.current) ?? resizable[0];
      for (const entry of visible) {
        const button = entry.element.querySelector("button");
        const buttonIndex = entry === focusTarget ? 0 : -1;
        if (button != null && button.tabIndex !== buttonIndex) button.tabIndex = buttonIndex;
        const separator = entry.element.querySelector<HTMLElement>("[role='separator']");
        const separatorIndex = entry === resizeTarget ? 0 : -1;
        if (separator != null && separator.tabIndex !== separatorIndex) separator.tabIndex = separatorIndex;
      }
    }
    const bottomAdd = controls.querySelector<HTMLElement>('[data-page-table-edge="bottom"]');
    if (bottomAdd != null) {
      const hide = !uniform || tableRect.bottom > visibleTable.bottom + 1;
      if (bottomAdd.hidden !== hide) bottomAdd.hidden = hide;
      if (!hide) place(bottomAdd, rowRailLeft, Math.min(tableRect.bottom + half, region.bottom - railHeight));
    }
    const sideAdd = controls.querySelector<HTMLElement>('[data-page-table-edge="left"], [data-page-table-edge="right"]');
    if (sideAdd != null) {
      const x = rtl ? tableRect.left - railWidth - half : tableRect.right + half;
      const hide = !uniform || x < region.left || x + railWidth > region.right || (rtl ? tableRect.left < visibleTable.left - 1 : tableRect.right > visibleTable.right + 1);
      if (sideAdd.hidden !== hide) sideAdd.hidden = hide;
      if (!hide) place(sideAdd, x, columnRailTop);
    }
    if (toolbar != null && toolbarSize != null) {
      const left = Math.max(region.left, Math.min((visibleTable.left + visibleTable.right - toolbarSize.width) / 2, region.right - toolbarSize.width));
      const overlapsAdd = uniform && left < rowRailLeft + railWidth && left + toolbarSize.width > rowRailLeft;
      const top = tableRect.bottom + (overlapsAdd ? railHeight + half : 0);
      place(toolbar, left, Math.max(visibleTable.top, Math.min(top, region.bottom - toolbarSize.height)));
    }
  });

  useLayoutEffect(() => layout());

  useEffect(() => {
    const view = container.ownerDocument.defaultView;
    if (view == null) return;
    let frame: number | undefined;
    const schedule = () => {
      frame ??= view.requestAnimationFrame(() => {
        frame = undefined;
        layout();
      });
    };
    const observer = new ResizeObserver(schedule);
    for (const element of [table, container, table.closest("[data-page-block-viewport]")]) if (element != null) observer.observe(element);
    container.ownerDocument.addEventListener("scroll", schedule, { capture: true, passive: true });
    view.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      container.ownerDocument.removeEventListener("scroll", schedule, true);
      view.removeEventListener("resize", schedule);
      if (frame != null) view.cancelAnimationFrame(frame);
    };
  }, [container, table]);

  /** Roves focus between the visible axis buttons with the arrow keys, Home and End. */
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || event.target.matches("[data-page-table-column-resize], [data-page-table-row-resize]")) return;
    const item = event.target.closest<HTMLElement>("[data-page-table-menu]");
    if (item == null) return;
    const kind = item.dataset.pageTableMenu;
    const back = kind === "row" ? "ArrowUp" : "ArrowLeft";
    if (![back, kind === "row" ? "ArrowDown" : "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const siblings = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(`[data-page-table-menu="${kind}"]:not([data-page-table-clipped])`));
    let step = event.key === back ? -1 : 1;
    if (kind === "column" && rtl) step *= -1;
    let next = siblings.indexOf(item) + step;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = siblings.length - 1;
    siblings[next]?.querySelector("button")?.focus();
  };

  const sideEdge = rtl ? "left" : "right";
  return (
    <TableControlsFrame ref={rootRef} table={table} interacting={dragging || openMenu != null} label={intl.formatMessage(tableMessages.controls)} onKeyDownCapture={onKeyDownCapture}>
      <div className={tableControlsCss.backdrop} aria-hidden="true" data-page-table-backdrop="row" />
      <div className={tableControlsCss.backdrop} aria-hidden="true" data-page-table-backdrop="column" />
      {(["row", "column"] as const).map((kind) => (
        <div key={kind} className={`pointer-events-none absolute animate-none ${kind === "row" ? "vertical-scroll-fade-mask" : "horizontal-scroll-fade-mask"}`} data-page-table-rail={kind}>
          {items
            .filter((item) => item.kind === kind)
            .map((item) => (
              <div
                key={`${item.kind}:${item.index}`}
                className={tableControlsCss.axis}
                data-page-table-menu={item.kind}
                data-page-table-menu-id={`${item.kind}:${item.index}`}
                data-page-table-axis-index={item.index}
                data-current={item.current || undefined}
                data-open={openMenu === `${item.kind}:${item.index}` || undefined}
                data-first={item.index === 0 || undefined}
                data-last={item.index === (item.kind === "row" ? rowCount : columnCount) - 1 || undefined}
              >
                <div className={tableControlsCss.label}>
                  {uniform ? (
                    renderMenu(item.kind, item.index, item.label, item.kind !== "row" || item.index > 0, item.current ? 0 : -1)
                  ) : (
                    <span title={item.label}>
                      {item.kind === "row" && item.index >= 999 ? (
                        <>
                          <span aria-hidden="true">{overflowRowLabel}</span>
                          <span className="sr-only">{item.label}</span>
                        </>
                      ) : (
                        item.label
                      )}
                    </span>
                  )}
                </div>
                {uniform ? (
                  <span
                    className={tableControlsCss.resize}
                    role="separator"
                    aria-orientation={item.kind === "row" ? "horizontal" : "vertical"}
                    aria-label={
                      item.kind === "row" ? intl.formatMessage(tableMessages.resizeRowNumber, { row: item.label }) : intl.formatMessage(tableMessages.resizeColumnLetter, { column: item.label })
                    }
                    aria-valuemin={item.kind === "row" ? 1 : 64}
                    tabIndex={item.current ? 0 : -1}
                    data-page-table-column-resize={item.kind === "column" ? item.index : undefined}
                    data-page-table-row-resize={item.kind === "row" ? item.index : undefined}
                    onPointerDown={(event) => onResizePointerDown(event, item.kind, item.index)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        onEscape();
                        return;
                      }
                      onResizeKeyDown(event, item.kind, item.index);
                    }}
                  />
                ) : null}
              </div>
            ))}
        </div>
      ))}
      {(["bottom", sideEdge] as const).map((edge) => (
        <div key={edge} className={tableControlsCss.add} data-page-table-edge={edge}>
          <TableAddButton label={intl.formatMessage(edgeMessages[edge])} dragging={dragging} disabled={!uniform} onClick={() => onAppend(edge === "bottom" ? "row" : "column")} />
        </div>
      ))}
      <div className={tableControlsCss.toolbar} data-page-table-toolbar="">
        <TableToolbar dragging={dragging} tableMenu={<div data-page-table-menu-id={`block:${block.id}`}>{renderMenu("block", undefined, undefined, false, undefined)}</div>} onDelete={onDelete} />
      </div>
    </TableControlsFrame>
  );
}
