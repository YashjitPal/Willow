import clsx from "clsx";

interface PreviewSource {
  element: HTMLElement;
  previewBounds: DOMRect;
}

/** `uB`: the drop line, optionally with its start marker and above the drag preview. */
function createDropIndicator(ownerDocument: Document, { startMarker = true, abovePreview = false }: { startMarker?: boolean; abovePreview?: boolean } = {}) {
  const indicator = ownerDocument.createElement("div");
  indicator.className = clsx(
    "pointer-events-none absolute before:absolute before:-top-px before:inset-x-0 before:h-0.5 before:rounded-full before:bg-text-info before:content-['']",
    abovePreview ? "z-50" : "z-20",
    startMarker && "after:absolute after:-top-1 after:-start-1 after:size-2 after:rounded-full after:border-2 after:border-text-info after:bg-surface after:content-['']",
  );
  indicator.dataset.pageBlockDropIndicator = "";
  indicator.setAttribute("aria-hidden", "true");
  indicator.hidden = true;
  return indicator;
}

/** `wz`: positions an overlay over a viewport rect, in the container's coordinates. */
function placeOverlay(overlay: HTMLElement, rect: DOMRect | null, container: DOMRect, zoom: number) {
  overlay.hidden = rect == null;
  if (rect == null) return;
  Object.assign(overlay.style, {
    left: `${(rect.left - container.left) / zoom}px`,
    top: `${(rect.top - container.top) / zoom}px`,
    width: `${rect.width / zoom}px`,
    height: `${rect.height / zoom}px`,
  });
}

/** `Sz`: a rect (the element's own by default) clipped to the viewport and to every ancestor of the element that clips overflow. */
export function clippedRect(element: HTMLElement, rect = element.getBoundingClientRect()) {
  const view = element.ownerDocument.defaultView;
  if (view == null) return null;
  let left = Math.max(0, rect.left);
  let right = Math.min(view.innerWidth, rect.right);
  let top = Math.max(0, rect.top);
  let bottom = Math.min(view.innerHeight, rect.bottom);
  if (right <= left || bottom <= top) return null;
  for (let parent = element.parentElement; parent != null; parent = parent.parentElement) {
    const style = view.getComputedStyle(parent);
    const box = parent.getBoundingClientRect();
    const scale = parent.offsetWidth > 0 ? box.width / parent.offsetWidth : 1;
    const innerLeft = box.left + parent.clientLeft * scale;
    const innerTop = box.top + parent.clientTop * scale;
    if (/auto|scroll|hidden|clip/u.test(style.overflowX)) {
      left = Math.max(left, innerLeft);
      right = Math.min(right, innerLeft + parent.clientWidth * scale);
    }
    if (/auto|scroll|hidden|clip/u.test(style.overflowY)) {
      top = Math.max(top, innerTop);
      bottom = Math.min(bottom, innerTop + parent.clientHeight * scale);
    }
  }
  return right > left && bottom > top ? DOMRect.fromRect({ x: left, y: top, width: right - left, height: bottom - top }) : null;
}

/** `Qz` */
export function scrollParent(element: HTMLElement | null) {
  const view = element?.ownerDocument.defaultView;
  for (let current = element; current != null; current = current.parentElement) {
    if (/auto|scroll/u.test(view?.getComputedStyle(current).overflowY ?? "") && current.scrollHeight > current.clientHeight) return current;
  }
  return null;
}

/** `$z`: scrolls while the pointer is within 32px of the scroller's top or bottom edge. */
function autoScroll(scroller: HTMLElement | null, view: Window, y: number) {
  const rect = scroller?.getBoundingClientRect();
  const top = rect?.top ?? 0;
  const bottom = rect?.bottom ?? view.innerHeight;
  let delta = 0;
  if (y < top + 32) delta = -Math.min(16, (top + 32 - y) / 2);
  else if (y > bottom - 32) delta = Math.min(16, (y - bottom + 32) / 2);
  if (delta !== 0) {
    if (scroller == null) view.scrollBy(0, delta);
    else scroller.scrollTop += delta;
  }
  return delta;
}

/** `sB`: a positioned clone of one dragged element, wrapped in shallow `contents` copies of its ancestors. */
function cloneInContext({ element, previewBounds }: PreviewSource, preview: HTMLElement, zoom: number, left: number, top: number) {
  const content = element.cloneNode(true);
  if (!(content instanceof HTMLElement)) return null;
  content.classList.add("absolute!", "m-0!");
  content.style.left = `${(previewBounds.left - left) / zoom}px`;
  content.style.top = `${(previewBounds.top - top) / zoom}px`;
  content.style.width = `${previewBounds.width / zoom}px`;
  content.style.height = `${previewBounds.height / zoom}px`;
  if (content instanceof HTMLLIElement && element.parentElement instanceof HTMLOListElement) {
    content.value = element.parentElement.start + Array.from(element.parentElement.children).indexOf(element);
  }
  let context: HTMLElement = content;
  for (let parent = element.parentElement; parent != null && parent !== preview.parentElement; parent = parent.parentElement) {
    const shell = parent.cloneNode(false);
    if (shell instanceof HTMLElement) {
      shell.classList.add("contents!");
      shell.append(context);
      context = shell;
    }
  }
  for (const node of [context, ...context.querySelectorAll("*")]) {
    node.removeAttribute("id");
    if (node.hasAttribute("contenteditable")) node.setAttribute("contenteditable", "false");
  }
  return { context, content };
}

/** `oB`: fills the drag preview with clones of the dragged elements, keeping their scroll positions. */
function fillPreview(sources: PreviewSource[], preview: HTMLElement, zoom: number) {
  const left = Math.min(...sources.map(({ previewBounds }) => previewBounds.left));
  const top = Math.min(...sources.map(({ previewBounds }) => previewBounds.top));
  const right = Math.max(...sources.map(({ previewBounds }) => previewBounds.right));
  const bottom = Math.max(...sources.map(({ previewBounds }) => previewBounds.bottom));
  const scrolls = sources.map(({ element }) => [element, ...element.querySelectorAll("*")].map((node) => ({ left: node.scrollLeft, top: node.scrollTop })));
  const fragment = preview.ownerDocument.createDocumentFragment();
  const restore: { element: Element; left: number; top: number }[] = [];
  preview.style.width = `${(right - left) / zoom}px`;
  preview.style.height = `${(bottom - top) / zoom}px`;
  for (const [index, source] of sources.entries()) {
    const clone = cloneInContext(source, preview, zoom, left, top);
    if (clone == null) continue;
    fragment.append(clone.context);
    for (const [nodeIndex, node] of [clone.content, ...clone.content.querySelectorAll("*")].entries()) {
      const scroll = scrolls[index]?.[nodeIndex];
      if (scroll != null && (scroll.left !== 0 || scroll.top !== 0)) restore.push({ element: node, ...scroll });
    }
  }
  preview.append(fragment);
  for (const { element, left: scrollLeft, top: scrollTop } of restore) {
    element.scrollLeft = scrollLeft;
    element.scrollTop = scrollTop;
  }
}

/**
 * One level of `dB`: the gap between `children` (gap `index` sits before child `index`) whose midline is nearest
 * the pointer, skipping gaps strictly inside a dragged range and preferring, on ties, gaps that are not a dragged
 * range's edge; none while the pointer is more than 32px outside `container`.
 */
export function nearestGap(container: HTMLElement, children: HTMLElement[], dragged: { from: number; to: number }[], point: { x: number; y: number }, zoom: number) {
  const bounds = clippedRect(container);
  const margin = 32 * zoom;
  if (bounds == null || point.x < bounds.left - margin || point.x > bounds.right + margin || point.y < bounds.top - margin || point.y > bounds.bottom + margin) return null;
  const inside = (index: number) => dragged.some(({ from, to }) => index > from && index < to);
  const boundary = (index: number) => dragged.some(({ from, to }) => index === from || index === to);
  let best: { index: number; visible: boolean; rect: DOMRect; distance: number } | null = null;
  let previous: DOMRect | null = null;
  for (let index = 0; index <= children.length; index += 1) {
    const rect = children[index]?.getBoundingClientRect() ?? null;
    const reference = rect ?? previous;
    if (reference != null && !inside(index)) {
      const y = ((previous?.bottom ?? reference.top) + (rect?.top ?? reference.bottom)) / 2;
      const left = Math.max(bounds.left, reference.left);
      const right = Math.min(bounds.right, reference.right);
      const distance = Math.abs(point.y - y);
      if (best == null || distance < best.distance || (distance === best.distance && boundary(best.index) && !boundary(index))) {
        best = { index, visible: y >= bounds.top && y <= bounds.bottom, rect: DOMRect.fromRect({ x: left, y, width: right - left, height: 2 * zoom }), distance };
      }
    }
    previous = rect;
  }
  return best == null ? null : { index: best.index, rect: best.visible ? best.rect : null };
}

export interface BlockDragOptions<Target> {
  event: PointerEvent;
  handle: HTMLElement;
  /** Positioned element the indicator and preview are placed in. */
  container: HTMLElement;
  root: HTMLElement;
  /** Elements of the dragged blocks or list rows, in document order; the preview shows the first one. */
  dragged: HTMLElement[];
  /** `dB`: where dropping at the pointer moves the dragged content, with the indicator rect (none while hidden). */
  dropAt: (point: { x: number; y: number }, zoom: number) => { target: Target; rect: DOMRect | null } | null;
  onClick: () => void;
  onDragStart: () => void;
  onFinish: () => void;
  onDrop: (target: Target) => void;
}

/** `LV`: drags blocks or list rows from their grip, or opens the grip's menu on a click without movement. */
export function startBlockDrag<Target>({ event, handle, container, root, dragged, dropAt, onClick, onDragStart, onFinish, onDrop }: BlockDragOptions<Target>) {
  const ownerDocument = root.ownerDocument;
  const view = ownerDocument.defaultView;
  const zoom = 1;
  const abort = new AbortController();
  let point = { x: event.clientX, y: event.clientY };
  let dragging = false;
  let target: Target | null = null;
  let frame: number | undefined;
  const fades = new Map<HTMLElement, Animation>();
  const indicator = createDropIndicator(ownerDocument);
  const preview = ownerDocument.createElement("div");
  preview.className = "pointer-events-none absolute z-50 bg-surface opacity-70 elevation-prominent select-none";
  preview.inert = true;
  const sources = dragged.slice(0, 1).map((element) => ({ element, previewBounds: element.getBoundingClientRect() }));
  const previewLeft = Math.min(...sources.map(({ previewBounds }) => previewBounds.left));
  const previewTop = Math.min(...sources.map(({ previewBounds }) => previewBounds.top));
  preview.setAttribute("aria-hidden", "true");
  preview.hidden = true;
  handle.setPointerCapture?.(event.pointerId);
  const scroller = scrollParent(root.parentElement);

  const finish = () => {
    if (abort.signal.aborted) return;
    abort.abort();
    for (const fade of fades.values()) fade.cancel();
    fades.clear();
    container.removeAttribute("data-page-content-dragging");
    indicator.remove();
    preview.remove();
    if (frame != null) view?.cancelAnimationFrame(frame);
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    onFinish();
  };

  const update = () => {
    if (!root.isConnected || dragged.some((element) => !element.isConnected)) {
      finish();
      return;
    }
    for (const element of dragged) {
      if (!fades.has(element)) fades.set(element, element.animate({ opacity: 0.2 }, { duration: 0, fill: "forwards" }));
    }
    const origin = container.getBoundingClientRect();
    const drop = dropAt(point, zoom);
    target = drop?.target ?? null;
    placeOverlay(indicator, drop?.rect ?? null, origin, zoom);
    preview.hidden = false;
    preview.style.left = `${(previewLeft + point.x - event.clientX - origin.left) / zoom}px`;
    preview.style.top = `${(previewTop + point.y - event.clientY - origin.top) / zoom}px`;
  };

  const tick = () => {
    if (!dragging || abort.signal.aborted || view == null) return;
    if (autoScroll(scroller, view, point.y) !== 0) update();
    if (!abort.signal.aborted) frame = view.requestAnimationFrame(tick);
  };

  ownerDocument.addEventListener(
    "pointermove",
    (move) => {
      if (move.pointerId !== event.pointerId) return;
      point = { x: move.clientX, y: move.clientY };
      if (!dragging) {
        if (Math.hypot(point.x - event.clientX, point.y - event.clientY) < 4) return;
        dragging = true;
        container.setAttribute("data-page-content-dragging", "");
        onDragStart();
        container.append(indicator, preview);
        fillPreview(sources, preview, zoom);
        frame = view?.requestAnimationFrame(tick);
      }
      move.preventDefault();
      update();
    },
    { capture: true, signal: abort.signal },
  );
  ownerDocument.addEventListener(
    "pointerup",
    (up) => {
      if (up.pointerId !== event.pointerId) return;
      up.preventDefault();
      if (dragging) {
        point = { x: up.clientX, y: up.clientY };
        update();
        if (abort.signal.aborted) return;
      }
      const drop = target;
      const moved = dragging;
      finish();
      if (moved && drop != null) onDrop(drop);
      else if (!moved) onClick();
    },
    { capture: true, signal: abort.signal },
  );
  ownerDocument.addEventListener("pointercancel", finish, { signal: abort.signal });
  ownerDocument.addEventListener(
    "keydown",
    (key) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      key.stopPropagation();
      finish();
      root.focus({ preventScroll: true });
    },
    { capture: true, signal: abort.signal },
  );
  view?.addEventListener("blur", finish, { signal: abort.signal });
  return finish;
}

export interface TableAxisDragOptions {
  event: PointerEvent;
  handle: HTMLElement;
  /** Positioned element the indicator and preview are placed in. */
  container: HTMLElement;
  /** The editor root, whose scroll parent autoscrolls. */
  root: HTMLElement;
  table: HTMLTableElement;
  axis: "row" | "column";
  index: number;
  /** Whether the document and table are still the ones the drag started on. */
  isCurrent: () => boolean;
  onClick: () => void;
  onDragStart: () => void;
  onFinish: () => void;
  /** Moves the dragged row or column to index `destination`. */
  onDrop: (destination: number) => void;
}

/**
 * `pB`: drags a table row or column by its axis handle, or opens the handle's menu on a click
 * without movement. Only uniform tables drag, and nothing moves above the header row.
 */
export function startTableAxisDrag({ event, handle, container, root, table, axis, index, isCurrent, onClick, onDragStart, onFinish, onDrop }: TableAxisDragOptions) {
  const ownerDocument = root.ownerDocument;
  const view = ownerDocument.defaultView;
  const zoom = 1;
  const rows = Array.from(table.rows);
  const columns = rows[0]?.cells.length ?? 0;
  if (!isCurrent() || index < 0 || rows.some((row) => row.cells.length !== columns || Array.from(row.cells).some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1))) return null;
  const items: HTMLElement[] = axis === "row" ? rows : Array.from(rows[0]?.cells ?? []);
  const abort = new AbortController();
  const indicator = createDropIndicator(ownerDocument, { startMarker: false, abovePreview: true });
  indicator.dataset.pageTableDropIndicator = "";
  indicator.hidden = false;
  indicator.style.visibility = "hidden";
  if (axis === "column") indicator.classList.add("origin-top-left", "rotate-90");
  const preview = ownerDocument.createElement("div");
  preview.className = "pointer-events-none absolute z-50 bg-surface elevation-prominent select-none";
  preview.dataset.pageTableDragPreview = "";
  preview.inert = true;
  preview.contentEditable = "false";
  preview.setAttribute("aria-hidden", "true");
  preview.style.visibility = "hidden";
  container.append(preview, indicator);
  handle.setPointerCapture?.(event.pointerId);
  handle.dataset.dragging = "true";
  const cells = axis === "row" ? Array.from(rows[index]?.cells ?? []) : rows.flatMap((row) => (row.cells[index] == null ? [] : [row.cells[index]]));
  const sources = cells.map((element) => ({ element, previewBounds: element.getBoundingClientRect() }));
  const previewLeft = Math.min(...sources.map(({ previewBounds }) => previewBounds.left));
  const previewTop = Math.min(...sources.map(({ previewBounds }) => previewBounds.top));
  const rtl = view?.getComputedStyle(table).direction === "rtl";
  const controls = handle.closest<HTMLElement>("[data-page-table-controls]");
  const scroller = scrollParent(root.parentElement);
  const viewport = table.closest<HTMLElement>("[data-page-block-viewport]");
  let point = { x: event.clientX, y: event.clientY };
  let dragging = false;
  let destination: number | null = null;
  let frame: number | undefined;

  const finish = () => {
    if (abort.signal.aborted) return;
    abort.abort();
    delete handle.dataset.dragging;
    indicator.remove();
    preview.remove();
    if (frame != null) view?.cancelAnimationFrame(frame);
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    onFinish();
  };

  /** The boundary nearest the pointer along the dragged axis, while the pointer is within 32px of the table and its rail. */
  const dropTarget = () => {
    if (axis === "row" && index === 0) return null;
    const bounds = clippedRect(table);
    if (bounds == null) return null;
    const rail = controls?.querySelector<HTMLElement>(`[data-page-table-menu="${axis}"]:not([data-page-table-clipped])`);
    const railBounds = rail == null ? null : clippedRect(rail);
    const left = Math.min(bounds.left, railBounds?.left ?? bounds.left);
    const right = Math.max(bounds.right, railBounds?.right ?? bounds.right);
    const top = Math.min(bounds.top, railBounds?.top ?? bounds.top);
    const bottom = Math.max(bounds.bottom, railBounds?.bottom ?? bounds.bottom);
    if (axis === "row" ? point.x < left - 32 * zoom || point.x > right + 32 * zoom : point.y < top - 32 * zoom || point.y > bottom + 32 * zoom) return null;
    const along = axis === "row" ? point.y : point.x;
    let best: { distance: number; boundary: number; position: number } | null = null;
    for (let boundary = axis === "row" ? 1 : 0; boundary <= items.length; boundary += 1) {
      const rect = items[Math.min(boundary, items.length - 1)]?.getBoundingClientRect();
      if (rect == null) continue;
      const end = boundary === items.length;
      const position = axis === "row" ? (end ? rect.bottom : rect.top) : end === rtl ? rect.left : rect.right;
      if (axis === "row" ? position < bounds.top - zoom || position > bounds.bottom + zoom : position < bounds.left - zoom || position > bounds.right + zoom) continue;
      const distance = Math.abs(along - position);
      if (best == null || distance < best.distance) best = { distance, boundary, position };
    }
    if (best == null) return null;
    const to = best.boundary > index ? best.boundary - 1 : best.boundary;
    return to === index ? null : { destination: to, rect: axis === "row" ? new DOMRect(left, best.position, right - left, 0) : new DOMRect(best.position, top, bottom - top, 0) };
  };

  const update = () => {
    if (!isCurrent()) {
      finish();
      return;
    }
    const origin = container.getBoundingClientRect();
    const drop = dropTarget();
    destination = drop?.destination ?? null;
    preview.style.left = `${(previewLeft + point.x - event.clientX - origin.left) / zoom}px`;
    preview.style.top = `${(previewTop + point.y - event.clientY - origin.top) / zoom}px`;
    preview.style.visibility = "visible";
    indicator.style.visibility = drop == null ? "hidden" : "visible";
    if (drop != null) {
      Object.assign(indicator.style, {
        left: `${(drop.rect.left - origin.left) / zoom}px`,
        top: `${(drop.rect.top - origin.top) / zoom}px`,
        width: `${drop.rect.width / zoom}px`,
        height: `${drop.rect.height / zoom}px`,
      });
    }
  };

  const tick = () => {
    if (abort.signal.aborted || view == null) return;
    if (!isCurrent()) {
      finish();
      return;
    }
    let scrolled = autoScroll(scroller, view, point.y) !== 0;
    if (axis === "column" && viewport != null) {
      const rect = viewport.getBoundingClientRect();
      const before = viewport.scrollLeft;
      if (point.x < rect.left + 32) viewport.scrollLeft -= Math.min(16, (rect.left + 32 - point.x) / 2);
      else if (point.x > rect.right - 32) viewport.scrollLeft += Math.min(16, (point.x - rect.right + 32) / 2);
      scrolled ||= viewport.scrollLeft !== before;
    }
    if (scrolled) update();
    if (!abort.signal.aborted) frame = view.requestAnimationFrame(tick);
  };

  ownerDocument.addEventListener(
    "pointermove",
    (move) => {
      if (move.pointerId !== event.pointerId) return;
      if (!isCurrent()) {
        finish();
        return;
      }
      point = { x: move.clientX, y: move.clientY };
      if (!dragging) {
        if (Math.hypot(point.x - event.clientX, point.y - event.clientY) < 4) return;
        dragging = true;
        onDragStart();
        fillPreview(sources, preview, zoom);
        frame = view?.requestAnimationFrame(tick);
      }
      move.preventDefault();
      update();
    },
    { capture: true, signal: abort.signal },
  );
  ownerDocument.addEventListener(
    "pointerup",
    (up) => {
      if (up.pointerId !== event.pointerId) return;
      up.preventDefault();
      const moved = dragging;
      if (moved) {
        point = { x: up.clientX, y: up.clientY };
        update();
      }
      if (abort.signal.aborted) return;
      const drop = destination;
      finish();
      if (moved && drop != null) onDrop(drop);
      else if (moved) root.focus({ preventScroll: true });
      else onClick();
    },
    { capture: true, signal: abort.signal },
  );
  ownerDocument.addEventListener(
    "pointercancel",
    (cancel) => {
      if (cancel.pointerId === event.pointerId) finish();
    },
    { signal: abort.signal },
  );
  handle.addEventListener("lostpointercapture", finish, { signal: abort.signal });
  ownerDocument.addEventListener(
    "keydown",
    (key) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      key.stopPropagation();
      finish();
      root.focus({ preventScroll: true });
    },
    { capture: true, signal: abort.signal },
  );
  view?.addEventListener("blur", finish, { signal: abort.signal });
  return finish;
}
