import clsx from "clsx";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { useReducedMotion } from "../../codex/lib/theme-engine";
import { FloatingNavigationRailMarker, FloatingNavigationRailPanel, hasFloatingNavigationRailRoom, scrollFloatingNavigationRailItemIntoView, Tooltip } from "../../codex/ui";
import { outlineMessages, pageMessages } from "./messages";
import { inlinePlainText, type PageBlock } from "./state/page-document";

/** `LX`: the fewest document headings that show the rail. */
const minimumHeadings = 2;
/** `RX`: a heading becomes current once its top is this far below the top of the scroll viewport. */
const activeOffset = 24;
/** `zX`: hover list indentation by heading level. */
const levelIndent: Partial<Record<number, string>> = { 2: "ms-3", 3: "ms-6" };
const titleHeadingId = "page-title";

interface OutlineHeading {
  id: string;
  level: number;
  title: string;
}

/** `qK`: headings of levels 1–3 that have text. */
function outlineHeadings(blocks: PageBlock[]): OutlineHeading[] {
  return blocks.flatMap((block) => {
    if (block.type !== "heading" || block.level > 3) return [];
    const title = inlinePlainText(block.content).trim();
    return title.length === 0 ? [] : [{ id: block.id, level: block.level, title }];
  });
}

/** `jX`: the rendered heading of a heading block. */
function headingElement(root: HTMLElement | null, id: string) {
  return root?.querySelector<HTMLElement>(`[data-page-block-id="${CSS.escape(id)}"] > [data-page-block-viewport] > :is(h1, h2, h3)`) ?? null;
}

/** `MX`: the last heading whose top has passed `threshold`, or the title when none has. */
function activeHeadingAt(root: HTMLElement, headings: OutlineHeading[], threshold: number) {
  let active = titleHeadingId;
  for (const heading of headings) {
    const element = headingElement(root, heading.id);
    if (element == null || element.getBoundingClientRect().top > threshold) break;
    active = heading.id;
  }
  return active;
}

export interface PageOutlineProps {
  disabled?: boolean;
  /** The reading column; the rail needs room before its start edge. */
  contentElement: HTMLElement | null;
  scrollElement: HTMLElement | null;
  title: string;
  blocks: PageBlock[];
}

/** `TX`: the floating "Page contents" rail for a page with at least two headings, led by the page title. */
export function PageOutline({ disabled = false, contentElement, scrollElement, title, blocks }: PageOutlineProps) {
  const intl = useIntl();
  const documentHeadings = useMemo(() => outlineHeadings(blocks), [blocks]);
  const pageTitle = title.trim() || intl.formatMessage(pageMessages.untitled);
  const headings = useMemo(() => [{ id: titleHeadingId, level: 1, title: pageTitle }, ...documentHeadings], [pageTitle, documentHeadings]);
  if (disabled || documentHeadings.length < minimumHeadings) return null;
  return <PageOutlineRail contentElement={contentElement} scrollElement={scrollElement} headings={headings} documentRevision={blocks} />;
}

interface PageOutlineRailProps {
  contentElement: HTMLElement | null;
  scrollElement: HTMLElement | null;
  headings: OutlineHeading[];
  documentRevision: unknown;
}

/** `OX`: tracks the current heading while the page scrolls and portals the rail beside the canvas. */
function PageOutlineRail({ contentElement, scrollElement, headings, documentRevision }: PageOutlineRailProps) {
  const intl = useIntl();
  const reducedMotion = useReducedMotion();
  const [activeHeadingId, setActiveHeadingId] = useState(headings[0]?.id);
  const [previewHeadingId, setPreviewHeadingId] = useState<string | null>(null);
  const [hasRoom, setHasRoom] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigating = useRef(false);
  const latestHeadings = useRef(headings);
  latestHeadings.current = headings;
  const update = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (scrollElement == null || contentElement == null) return;
    const measure = () => setHasRoom(hasFloatingNavigationRailRoom(scrollElement, contentElement, 64));
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(scrollElement);
    resizeObserver.observe(contentElement);
    const canvas = contentElement.closest("[data-page-document-canvas]");
    const mutationObserver = new MutationObserver(measure);
    if (canvas != null) mutationObserver.observe(canvas, { attributeFilter: ["style"] });
    window.addEventListener("resize", measure);
    measure();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [contentElement, scrollElement]);

  useEffect(() => {
    if (!hasRoom || scrollElement == null || contentElement == null) return;
    let frame: number | null = null;
    const track = () => {
      frame ??= window.requestAnimationFrame(() => {
        frame = null;
        if (navigating.current) return;
        const documentHeadings = latestHeadings.current.filter((heading) => heading.id !== titleHeadingId);
        let active = titleHeadingId;
        if (scrollElement.scrollTop > 0 && scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop <= 1) {
          active = documentHeadings.at(-1)?.id ?? active;
        } else {
          const threshold = scrollElement.getBoundingClientRect().top + activeOffset;
          if (contentElement.getBoundingClientRect().top <= threshold) active = activeHeadingAt(scrollElement, documentHeadings, threshold);
        }
        setActiveHeadingId(active);
        const rail = railRef.current;
        if (!rail?.hasAttribute("data-scrubbing")) scrollFloatingNavigationRailItemIntoView(rail, rail?.querySelector<HTMLElement>(`[data-page-heading-id="${CSS.escape(active)}"]`) ?? null);
      });
    };
    update.current = track;
    const stopNavigating = () => {
      if (!navigating.current) return;
      navigating.current = false;
      if (frame != null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
    };
    const stopEvents = ["scrollend", "wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const type of stopEvents) scrollElement.addEventListener(type, stopNavigating, { passive: true });
    scrollElement.addEventListener("scroll", track, { passive: true });
    const resizeObserver = new ResizeObserver(track);
    resizeObserver.observe(scrollElement);
    resizeObserver.observe(contentElement);
    window.addEventListener("resize", track);
    track();
    return () => {
      update.current = null;
      if (frame != null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      for (const type of stopEvents) scrollElement.removeEventListener(type, stopNavigating);
      navigating.current = false;
      scrollElement.removeEventListener("scroll", track);
      window.removeEventListener("resize", track);
    };
  }, [contentElement, hasRoom, scrollElement]);

  useEffect(() => update.current?.(), [documentRevision]);

  const container = scrollElement?.parentElement;
  if (!hasRoom || container == null) return null;

  const navigate = (heading: OutlineHeading, behavior: ScrollBehavior = reducedMotion ? "auto" : "smooth") => {
    const element = heading.id === titleHeadingId ? null : headingElement(scrollElement, heading.id);
    if (heading.id !== titleHeadingId && element == null) return;
    navigating.current = true;
    setActiveHeadingId(heading.id);
    if (element == null) scrollElement?.scrollTo({ top: 0, behavior });
    else element.scrollIntoView({ behavior, block: "start" });
  };

  return createPortal(
    <nav aria-label={intl.formatMessage(outlineMessages.ariaLabel)} className="absolute top-1/2 left-1.5 z-20 -translate-y-1/2 electron:left-2">
      <Tooltip
        align="center"
        delayOpen
        interactive
        side="right"
        sideOffset={0}
        skipDelayKey="page-table-of-contents"
        tooltipMaxWidth="min(20rem, calc(100vw - 16px))"
        variant="floating-navigation-rail"
        onPointerLeave={() => {
          if (listRef.current == null) setPreviewHeadingId(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPreviewHeadingId(null);
        }}
        tooltipContent={
          <OutlineList ref={listRef} activeHeadingId={activeHeadingId} headings={headings} previewHeadingId={previewHeadingId} onNavigate={navigate} onPreview={setPreviewHeadingId} />
        }
      >
        <OutlineMarkers ref={railRef} activeHeadingId={activeHeadingId} headings={headings} previewHeadingId={previewHeadingId} onNavigate={navigate} onPreview={setPreviewHeadingId} />
      </Tooltip>
    </nav>,
    container,
  );
}

interface OutlineViewProps {
  activeHeadingId: string | undefined;
  headings: OutlineHeading[];
  previewHeadingId: string | null;
  onNavigate: (heading: OutlineHeading, behavior?: ScrollBehavior) => void;
  onPreview: (headingId: string | null) => void;
}

/** `bX`: one marker per heading; pressing and dragging along the rail scrubs through the headings. */
function OutlineMarkers({ ref, activeHeadingId, headings, previewHeadingId, onNavigate, onPreview }: OutlineViewProps & { ref: Ref<HTMLDivElement> }) {
  const intl = useIntl();
  const [scrubHeadingId, setScrubHeadingId] = useState<string | null>(null);
  const scrub = useRef<{ pointerId: number; target: HTMLElement; headingId: string } | null>(null);
  const scrubbed = useRef(false);
  const endScrub = (event: PointerEvent<HTMLDivElement>) => {
    const current = scrub.current;
    if (current?.pointerId !== event.pointerId) return;
    if (event.type === "pointercancel" || event.type === "lostpointercapture") scrubbed.current = false;
    scrub.current = null;
    setScrubHeadingId(null);
    if (current.target.hasPointerCapture?.(event.pointerId)) current.target.releasePointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = scrub.current;
    if (current == null || current.pointerId !== event.pointerId) return;
    if (event.buttons % 2 === 0) {
      endScrub(event);
      return;
    }
    const list = event.currentTarget;
    const rect = list.getBoundingClientRect();
    const target = list.ownerDocument.elementFromPoint(rect.left + rect.width / 2, Math.max(rect.top, Math.min(event.clientY, rect.bottom - 1)))?.closest<HTMLElement>("[data-page-heading-id]");
    if (target == null || !list.contains(target)) return;
    const heading = headings.find((entry) => entry.id === target.dataset.pageHeadingId);
    if (heading == null || heading.id === current.headingId) return;
    current.headingId = heading.id;
    scrubbed.current = true;
    setScrubHeadingId(heading.id);
    onPreview(heading.id);
    onNavigate(heading, "instant");
  };
  return (
    <div
      ref={ref}
      className="vertical-scroll-fade-mask hide-scrollbar flex max-h-[min(70vh,40rem)] touch-none flex-col overflow-y-auto overscroll-contain select-none [--edge-fade-distance:2.5rem]"
      data-floating-navigation-rail-list
      data-scrubbing={scrubHeadingId != null || undefined}
      onLostPointerCapture={endScrub}
      onPointerCancel={endScrub}
      onPointerUp={endScrub}
      onPointerMove={onPointerMove}
    >
      {headings.map((heading, index) => (
        <button
          key={heading.id}
          ref={(element) => {
            if (previewHeadingId === heading.id && scrubHeadingId == null) scrollFloatingNavigationRailItemIntoView(element?.parentElement ?? null, element);
          }}
          className="flex h-2.5 w-10.5 shrink-0 cursor-interaction items-center ps-1.5 outline-none electron:w-11 electron:ps-2"
          aria-current={activeHeadingId === heading.id ? "true" : undefined}
          aria-label={intl.formatMessage(outlineMessages.jumpAriaLabel, { position: index + 1, title: heading.title })}
          data-page-heading-id={heading.id}
          data-scrub-target={(scrubHeadingId ?? previewHeadingId) === heading.id || undefined}
          type="button"
          onPointerDown={(event) => {
            if (event.button !== 0 || scrub.current != null) return;
            scrubbed.current = false;
            scrub.current = { pointerId: event.pointerId, target: event.currentTarget, headingId: heading.id };
            setScrubHeadingId(heading.id);
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onClick={(event) => {
            if (scrubbed.current && event.detail !== 0) {
              scrubbed.current = false;
              return;
            }
            onNavigate(heading);
          }}
          onPointerEnter={() => onPreview(heading.id)}
          onFocus={() => onPreview(heading.id)}
        >
          <FloatingNavigationRailMarker hierarchyLevel={heading.level} />
        </button>
      ))}
    </div>
  );
}

/** `kX`: the hover list of headings beside the rail. */
function OutlineList({ ref, activeHeadingId, headings, previewHeadingId, onNavigate, onPreview }: OutlineViewProps & { ref: RefObject<HTMLDivElement | null> }) {
  const highlighted = previewHeadingId ?? activeHeadingId;
  return (
    <FloatingNavigationRailPanel
      ref={(element) => {
        ref.current = element;
        scrollFloatingNavigationRailItemIntoView(element, element?.querySelector<HTMLElement>("[data-heading-preview]") ?? null);
      }}
      className="flex max-h-[min(70vh,40rem)] flex-col overflow-y-auto"
    >
      {headings.map((heading) => (
        <button
          key={heading.id}
          ref={(element) => {
            if (highlighted === heading.id) scrollFloatingNavigationRailItemIntoView(ref.current, element);
          }}
          aria-current={activeHeadingId === heading.id ? "location" : undefined}
          data-heading-preview={highlighted === heading.id ? "" : undefined}
          className={clsx(
            "w-full shrink-0 cursor-interaction rounded-lg px-2 py-1.5 text-start wrap-anywhere whitespace-normal outline-hidden hover:bg-background-primary-ghost-hover/50 focus-visible:bg-background-primary-ghost-hover/50",
            activeHeadingId === heading.id ? "text-default" : "text-secondary",
            previewHeadingId === heading.id && "bg-background-primary-ghost-hover/50",
          )}
          type="button"
          onClick={() => onNavigate(heading)}
          onPointerEnter={() => onPreview(heading.id)}
          onFocus={() => onPreview(heading.id)}
        >
          <span className={clsx("block", levelIndent[heading.level])}>{heading.title}</span>
        </button>
      ))}
    </FloatingNavigationRailPanel>
  );
}
