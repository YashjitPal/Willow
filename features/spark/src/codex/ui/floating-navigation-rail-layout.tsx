import clsx from "clsx";
import type { HTMLAttributes, Ref } from "react";

const railCss = { Marker: "_Marker_k7ebw_2", BookmarkDot: "_BookmarkDot_k7ebw_2", MarkerLine: "_MarkerLine_k7ebw_2" } as const;

export interface FloatingNavigationRailMarkerProps extends HTMLAttributes<HTMLSpanElement> {
  bookmarked?: boolean;
  /** 1–3; deeper levels draw shorter lines. */
  hierarchyLevel?: number;
  /** Distance from the scrub target, which lengthens nearby markers while scrubbing. */
  neighborDistance?: number;
}

/** A line marker on a floating navigation rail; a bookmarked marker shows a dot. */
export function FloatingNavigationRailMarker({ className, bookmarked = false, hierarchyLevel, neighborDistance, ...rest }: FloatingNavigationRailMarkerProps) {
  return (
    <span {...rest} className={clsx("flex h-0.5 w-[30px] items-center", className)}>
      <span className={railCss.Marker} data-hierarchy-level={hierarchyLevel} data-neighbor-distance={neighborDistance}>
        <span className={railCss.MarkerLine} />
        {bookmarked ? <span aria-hidden className={clsx(railCss.BookmarkDot, "size-0.5 rounded-full")} /> : null}
      </span>
    </span>
  );
}

/** The elevated panel listing a rail's entries on hover. */
export function FloatingNavigationRailPanel({ className, ...rest }: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> }) {
  return (
    <div
      {...rest}
      className={clsx("w-80 max-w-[calc(100vw-1rem)] rounded-xl bg-surface-elevated-secondary p-2 text-sm leading-5 text-default shadow-xl-spread ring-[0.5px] ring-border", className)}
    />
  );
}

/** Whether the content starts far enough from the scroll element's start edge (48px plus `gap`) for a rail. */
export function hasFloatingNavigationRailRoom(scrollElement: HTMLElement, contentElement: HTMLElement, gap = 0) {
  const scrollRect = scrollElement.getBoundingClientRect();
  const contentRect = contentElement.getBoundingClientRect();
  const scale = scrollElement.offsetWidth > 0 ? scrollRect.width / scrollElement.offsetWidth : 1;
  return (contentRect.left - scrollRect.left) / (scale > 0 ? scale : 1) >= 48 + gap;
}

/** Scrolls `container` just enough to show `element`. */
export function scrollFloatingNavigationRailItemIntoView(container: HTMLElement | null, element: HTMLElement | null) {
  if (container == null || element == null) return;
  let top = element.offsetTop;
  for (let parent = element.offsetParent; parent instanceof HTMLElement && parent !== container && parent !== container.offsetParent; parent = parent.offsetParent) top += parent.offsetTop;
  if (top < container.scrollTop) container.scrollTop = top;
  else if (top + element.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = top + element.offsetHeight - container.clientHeight + 1;
}
