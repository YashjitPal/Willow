import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * The subset of `@floating-ui/react-dom` (vendored in the app-shared bundle) that `Tooltip` uses:
 * `useFloating` with `offset`, `flip`, `shift`, `size`, `arrow` and `autoUpdate`, absolute strategy.
 * Overflow is measured against the viewport only.
 */

export type FloatingSide = "top" | "right" | "bottom" | "left";
export type FloatingAlignment = "start" | "end";
export type FloatingPlacement = FloatingSide | `${FloatingSide}-${FloatingAlignment}`;

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

type Rect = Point & Size;

type SideOverflow = Record<FloatingSide, number>;

export interface FloatingReference {
  getBoundingClientRect(): Rect;
  readonly contextElement?: Element;
}

export interface FloatingSizeState {
  availableWidth: number;
  availableHeight: number;
  floating: HTMLElement;
  reference: Rect;
}

export interface FloatingPositionOptions {
  reference: Element | FloatingReference | null | undefined;
  placement: FloatingPlacement;
  /** Evaluated on every update, like the function form of `offset()`. */
  offset: () => { mainAxis: number; crossAxis: number };
  flip: { padding: number; flipAlignment: boolean; crossAxis: boolean };
  shift: { padding: number };
  size?: { padding: number; apply: (state: FloatingSizeState) => void };
  arrow?: { element: HTMLElement | null; padding: number };
  /** Runs before each automatic update (scroll, resize, element resize). */
  onAutoUpdate?: () => void;
}

export interface FloatingArrowData {
  x?: number;
  y?: number;
}

export interface FloatingPositionResult {
  placement: FloatingPlacement;
  arrow?: FloatingArrowData;
  floatingStyles: CSSProperties;
  setFloating: (node: HTMLElement | null) => void;
  update: () => void;
}

interface FloatingData {
  x: number;
  y: number;
  placement: FloatingPlacement;
  arrow?: FloatingArrowData;
}

const OPPOSITE_SIDE: Record<FloatingSide, FloatingSide> = { top: "bottom", right: "left", bottom: "top", left: "right" };
const OPPOSITE_ALIGNMENT: Record<FloatingAlignment, FloatingAlignment> = { start: "end", end: "start" };
const MAX_RESETS = 50;

function parsePlacement(placement: FloatingPlacement) {
  const [side, alignment] = placement.split("-") as [FloatingSide, FloatingAlignment | undefined];
  return { side, alignment };
}

function joinPlacement(side: FloatingSide, alignment: FloatingAlignment | undefined): FloatingPlacement {
  return alignment == null ? side : `${side}-${alignment}`;
}

function isVerticalSide(side: FloatingSide) {
  return side === "top" || side === "bottom";
}

function clamp(start: number, value: number, end: number) {
  return Math.max(start, Math.min(value, end));
}

function cssDimensions(element: HTMLElement): Size {
  const style = getComputedStyle(element);
  const width = parseFloat(style.width) || 0;
  const height = parseFloat(style.height) || 0;
  if (Math.round(width) !== element.offsetWidth || Math.round(height) !== element.offsetHeight) {
    return { width: element.offsetWidth, height: element.offsetHeight };
  }
  return { width, height };
}

function viewportRect(): Rect {
  const html = document.documentElement;
  return { x: 0, y: 0, width: html.clientWidth, height: html.clientHeight };
}

function detectOverflow(element: Rect, clip: Rect, padding: number): SideOverflow {
  return {
    top: clip.y - element.y + padding,
    bottom: element.y + element.height - (clip.y + clip.height) + padding,
    left: clip.x - element.x + padding,
    right: element.x + element.width - (clip.x + clip.width) + padding,
  };
}

function coordsFromPlacement(reference: Rect, floating: Size, placement: FloatingPlacement, rtl: boolean): Point {
  const { side, alignment } = parsePlacement(placement);
  const vertical = isVerticalSide(side);
  const commonX = reference.x + reference.width / 2 - floating.width / 2;
  const commonY = reference.y + reference.height / 2 - floating.height / 2;
  const commonAlign = vertical ? reference.width / 2 - floating.width / 2 : reference.height / 2 - floating.height / 2;
  const coords: Point =
    side === "top"
      ? { x: commonX, y: reference.y - floating.height }
      : side === "bottom"
        ? { x: commonX, y: reference.y + reference.height }
        : side === "right"
          ? { x: reference.x + reference.width, y: commonY }
          : { x: reference.x - floating.width, y: commonY };
  const direction = rtl && vertical ? -1 : 1;
  const alignShift = alignment === "start" ? -commonAlign * direction : alignment === "end" ? commonAlign * direction : 0;
  if (vertical) coords.x += alignShift;
  else coords.y += alignShift;
  return coords;
}

function offsetCoords(placement: FloatingPlacement, value: { mainAxis: number; crossAxis: number }, rtl: boolean): Point {
  const { side } = parsePlacement(placement);
  const vertical = isVerticalSide(side);
  const mainMultiplier = side === "left" || side === "top" ? -1 : 1;
  const crossMultiplier = rtl && vertical ? -1 : 1;
  return vertical
    ? { x: value.crossAxis * crossMultiplier, y: value.mainAxis * mainMultiplier }
    : { x: value.mainAxis * mainMultiplier, y: value.crossAxis * crossMultiplier };
}

function alignmentSides(placement: FloatingPlacement, reference: Rect, floating: Size, rtl: boolean): [FloatingSide, FloatingSide] {
  const { side, alignment } = parsePlacement(placement);
  const vertical = isVerticalSide(side);
  let main: FloatingSide = vertical ? (alignment === (rtl ? "end" : "start") ? "right" : "left") : alignment === "start" ? "bottom" : "top";
  const length = vertical ? "width" : "height";
  if (reference[length] > floating[length]) main = OPPOSITE_SIDE[main];
  return [main, OPPOSITE_SIDE[main]];
}

function fallbackPlacements(placement: FloatingPlacement, flipAlignment: boolean): FloatingPlacement[] {
  const { side, alignment } = parsePlacement(placement);
  const opposite = joinPlacement(OPPOSITE_SIDE[side], alignment);
  if (alignment == null || !flipAlignment) return [opposite];
  return [joinPlacement(side, OPPOSITE_ALIGNMENT[alignment]), opposite, joinPlacement(OPPOSITE_SIDE[side], OPPOSITE_ALIGNMENT[alignment])];
}

function flipPlacement(reference: Rect, floating: Size, clip: Rect, options: FloatingPositionOptions, offset: { mainAxis: number; crossAxis: number }, rtl: boolean) {
  const tried: { placement: FloatingPlacement; overflows: number[] }[] = [];
  for (const placement of [options.placement, ...fallbackPlacements(options.placement, options.flip.flipAlignment)]) {
    const base = coordsFromPlacement(reference, floating, placement, rtl);
    const delta = offsetCoords(placement, offset, rtl);
    const overflow = detectOverflow({ x: base.x + delta.x, y: base.y + delta.y, ...floating }, clip, options.flip.padding);
    const overflows = [overflow[parsePlacement(placement).side]];
    if (options.flip.crossAxis) {
      const [start, end] = alignmentSides(placement, reference, floating, rtl);
      overflows.push(overflow[start], overflow[end]);
    }
    tried.push({ placement, overflows });
    if (overflows.every((value) => value <= 0)) return placement;
  }
  const fitsMainAxis = tried.filter((entry) => entry.overflows[0] <= 0).sort((a, b) => (a.overflows[1] ?? 0) - (b.overflows[1] ?? 0))[0];
  if (fitsMainAxis != null) return fitsMainAxis.placement;
  return tried
    .map((entry) => ({ placement: entry.placement, total: entry.overflows.filter((value) => value > 0).reduce((sum, value) => sum + value, 0) }))
    .sort((a, b) => a.total - b.total)[0].placement;
}

function offsetParentOrigin(floating: HTMLElement): Point {
  const parent = floating.offsetParent;
  const isRoot = parent === document.body || parent === document.documentElement;
  if (parent instanceof HTMLElement && !(isRoot && getComputedStyle(parent).position === "static")) {
    const rect = parent.getBoundingClientRect();
    return { x: rect.left + parent.clientLeft - parent.scrollLeft, y: rect.top + parent.clientTop - parent.scrollTop };
  }
  return { x: -window.scrollX, y: -window.scrollY };
}

function roundByDevicePixelRatio(value: number) {
  const ratio = window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}

function computeFloatingPosition(reference: Element | FloatingReference, floatingElement: HTMLElement, options: FloatingPositionOptions): FloatingData {
  const rtl = getComputedStyle(floatingElement).direction === "rtl";
  const clip = viewportRect();
  let floating = cssDimensions(floatingElement);
  let result: FloatingData = { x: 0, y: 0, placement: options.placement };
  for (let reset = 0; reset <= MAX_RESETS; reset += 1) {
    const box = reference.getBoundingClientRect();
    const referenceRect: Rect = { x: box.x, y: box.y, width: box.width, height: box.height };
    const offset = options.offset();
    const placement = flipPlacement(referenceRect, floating, clip, options, offset, rtl);
    const { side } = parsePlacement(placement);
    const vertical = isVerticalSide(side);
    const base = coordsFromPlacement(referenceRect, floating, placement, rtl);
    const delta = offsetCoords(placement, offset, rtl);
    const coords = { x: base.x + delta.x, y: base.y + delta.y };

    const shiftOverflow = detectOverflow({ ...coords, ...floating }, clip, options.shift.padding);
    if (vertical) coords.x = clamp(coords.x + shiftOverflow.left, coords.x, coords.x - shiftOverflow.right);
    else coords.y = clamp(coords.y + shiftOverflow.top, coords.y, coords.y - shiftOverflow.bottom);

    if (options.size != null) {
      const overflow = detectOverflow({ ...coords, ...floating }, clip, options.size.padding);
      const maximumWidth = floating.width - overflow.left - overflow.right;
      const maximumHeight = floating.height - overflow.top - overflow.bottom;
      options.size.apply({
        availableWidth: vertical ? maximumWidth : Math.min(floating.width - overflow[side], maximumWidth),
        availableHeight: vertical ? Math.min(floating.height - overflow[side], maximumHeight) : maximumHeight,
        floating: floatingElement,
        reference: referenceRect,
      });
      const next = cssDimensions(floatingElement);
      if (reset < MAX_RESETS && (next.width !== floating.width || next.height !== floating.height)) {
        floating = next;
        continue;
      }
    }

    let arrow: FloatingArrowData | undefined;
    const arrowElement = options.arrow?.element;
    if (options.arrow != null && arrowElement != null) {
      const arrowSize = cssDimensions(arrowElement);
      const length = vertical ? "width" : "height";
      const axis = vertical ? "x" : "y";
      const endDiff = referenceRect[length] + referenceRect[axis] - coords[axis] - floating[length];
      const startDiff = coords[axis] - referenceRect[axis];
      const clientSize = (vertical ? floatingElement.clientWidth : floatingElement.clientHeight) || floating[length];
      const padding = Math.min(options.arrow.padding, clientSize / 2 - arrowSize[length] / 2 - 1);
      const center = clientSize / 2 - arrowSize[length] / 2 + (endDiff / 2 - startDiff / 2);
      const arrowOffset = clamp(padding, center, clientSize - arrowSize[length] - padding);
      arrow = vertical ? { x: arrowOffset } : { y: arrowOffset };
    }

    const origin = offsetParentOrigin(floatingElement);
    result = { x: roundByDevicePixelRatio(coords.x - origin.x), y: roundByDevicePixelRatio(coords.y - origin.y), placement, arrow };
    break;
  }
  return result;
}

function sameData(a: FloatingData, b: FloatingData) {
  return a.x === b.x && a.y === b.y && a.placement === b.placement && a.arrow?.x === b.arrow?.x && a.arrow?.y === b.arrow?.y;
}

export function useFloatingPosition(options: FloatingPositionOptions): FloatingPositionResult {
  const [floating, setFloating] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<FloatingData>({ x: 0, y: 0, placement: options.placement });
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const update = useCallback(() => {
    const latest = optionsRef.current;
    if (floating == null || latest.reference == null) return;
    const next = computeFloatingPosition(latest.reference, floating, latest);
    setData((previous) => (sameData(previous, next) ? previous : next));
  }, [floating]);

  const { reference, placement, flip, shift, size, arrow } = options;
  useLayoutEffect(() => {
    update();
  }, [update, reference, placement, flip.padding, flip.flipAlignment, flip.crossAxis, shift.padding, size?.padding, arrow?.element, arrow?.padding]);

  useLayoutEffect(() => {
    if (floating == null || reference == null) return;
    const referenceElement = reference instanceof Element ? reference : reference.contextElement;
    const autoUpdate = () => {
      optionsRef.current.onAutoUpdate?.();
      update();
    };
    autoUpdate();
    window.addEventListener("scroll", autoUpdate, { capture: true, passive: true });
    window.addEventListener("resize", autoUpdate);
    const observer = new ResizeObserver(autoUpdate);
    if (referenceElement != null) observer.observe(referenceElement);
    observer.observe(floating);
    return () => {
      window.removeEventListener("scroll", autoUpdate, { capture: true });
      window.removeEventListener("resize", autoUpdate);
      observer.disconnect();
    };
  }, [floating, reference, update]);

  const floatingStyles: CSSProperties =
    floating == null
      ? { position: "absolute", left: 0, top: 0 }
      : {
          position: "absolute",
          left: 0,
          top: 0,
          transform: `translate(${data.x}px, ${data.y}px)`,
          ...(window.devicePixelRatio >= 1.5 ? { willChange: "transform" } : {}),
        };

  return { placement: data.placement, arrow: data.arrow, floatingStyles, setFloating, update };
}
