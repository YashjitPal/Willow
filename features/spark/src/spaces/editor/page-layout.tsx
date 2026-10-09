import clsx from "clsx";
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform, type HTMLMotionProps } from "framer-motion";
import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { useIntl } from "react-intl";
import { useReducedMotion } from "../../codex/lib/theme-engine";
import { LoadingShimmerLines } from "../../codex/ui/loading-shimmer";
import { usePagesViewSettings } from "../../codex/lib/pages-view-settings";
import { pageCss } from "./css";
import { pageMessages } from "./messages";

/** `_Fn`: the rail, sidebar and attribution spring. */
export const pageLayoutSpring = { type: "spring", duration: 0.5, bounce: 0.1 } as const;

export interface PageCommentsLayout {
  /** Rail element the floating comments render into. */
  container: HTMLElement | null;
  /** The canvas fits the reading column plus the comments rail. */
  hasRoom: boolean;
  scrollElement: HTMLElement | null;
}

interface LayoutMetrics {
  hasRoom: boolean;
  direction: 1 | -1;
  railWidth: number;
  railOffset: number;
  sidebarWidth: number;
}

const initialMetrics: LayoutMetrics = { hasRoom: false, direction: 1, railWidth: 0, railOffset: 0, sidebarWidth: 0 };

function sameMetrics(a: LayoutMetrics, b: LayoutMetrics) {
  return a.hasRoom === b.hasRoom && a.direction === b.direction && a.railWidth === b.railWidth && a.railOffset === b.railOffset && a.sidebarWidth === b.sidebarWidth;
}

export interface PageLayoutProps {
  children?: ReactNode;
  comments: (layout: PageCommentsLayout) => ReactNode;
  headerOverlay?: boolean;
  /** Page outline; told whether comments are showing inline beside the document. */
  navigation?: (inlineComments: boolean) => ReactNode;
  /** Floating comments rail requested. */
  open: boolean;
  /** Reading column (`data-page-reading-column`) whose width the rail is measured against. */
  readingColumn: HTMLElement | null;
  scrollElement: HTMLElement | null;
  scrollElementRef: Ref<HTMLDivElement>;
  scrollable?: boolean;
  sidebar?: ReactNode;
  sidebarOpen?: boolean;
}

/** `$P`: document canvas with the floating comments rail beside the reading column and the comments sidebar at the end. */
export function PageLayout({
  children,
  comments,
  headerOverlay = false,
  navigation,
  open,
  readingColumn,
  scrollElement,
  scrollElementRef,
  scrollable = true,
  sidebar,
  sidebarOpen = false,
}: PageLayoutProps) {
  const reducedMotion = useReducedMotion();
  const canvasRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [railContainer, setRailContainer] = useState<HTMLDivElement | null>(null);
  const [rail, setRail] = useState<HTMLDivElement | null>(null);
  const [, setRevision] = useState(0);
  const [metrics, setMetrics] = useState(initialMetrics);

  const railProgress = useMotionValue(0);
  const reservedWidth = useMotionValue(0);
  const sidebarWidth = useMotionValue(0);
  const reserved = useTransform(reservedWidth, (value) => Math.max(0, value));
  const railOpacity = useTransform(railProgress, (value) => Math.max(0, Math.min(1, value)));
  const documentTransform = useTransform(reserved, (value) => `translateX(${(-metrics.direction * value) / 2}px)`);
  const documentWidth = useTransform(reserved, (value) => `calc(100% - ${value}px)`);
  const scrollWidth = useTransform(sidebarWidth, (value) => `calc(100% - ${Math.max(0, value)}px)`);
  const gridWidth = useTransform(sidebarWidth, (value) => `calc(100% + ${Math.max(0, value)}px)`);
  const railTransform = useTransform(reserved, (value) => `translateX(${metrics.railOffset - (metrics.direction * value) / 2}px)`);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const column = readingColumn?.parentElement;
    if (canvas == null || readingColumn == null || column == null || rail == null) return;
    const defaultWidth = column.querySelector<HTMLElement>("[data-page-default-reading-width]");
    const contentWidth = column.querySelector<HTMLElement>("[data-page-comment-content-width]");
    const measure = () => {
      if (canvas.clientWidth === 0) return;
      const readingStyle = getComputedStyle(readingColumn);
      const readingWidth = defaultWidth?.offsetWidth ?? Number.parseFloat(readingStyle.maxInlineSize);
      const contentInlineSize = contentWidth?.offsetWidth ?? Number.parseFloat(readingStyle.inlineSize);
      const columnStyle = getComputedStyle(column);
      const canvasStyle = getComputedStyle(canvas);
      const gap = Number.parseFloat(canvasStyle.columnGap);
      const paddingStart = Number.parseFloat(columnStyle.paddingInlineStart);
      const paddingEnd = Number.parseFloat(columnStyle.paddingInlineEnd);
      const railWidth = rail.offsetWidth + gap;
      const direction = canvasStyle.direction === "rtl" ? -1 : 1;
      const sidebarElement = sidebarRef.current;
      const staticSidebarWidth = sidebarElement != null && getComputedStyle(sidebarElement).position === "static" ? sidebarElement.offsetWidth : 0;
      const next: LayoutMetrics = {
        hasRoom: canvas.clientWidth - (sidebarOpen ? staticSidebarWidth : 0) >= readingWidth + 2 * paddingEnd + railWidth,
        direction,
        railWidth,
        railOffset: (direction * (contentInlineSize + rail.offsetWidth + 2 * gap + paddingStart - paddingEnd)) / 2,
        sidebarWidth: staticSidebarWidth,
      };
      setMetrics((current) => (sameMetrics(current, next) ? current : next));
    };
    const observer = new ResizeObserver(measure);
    for (const element of [canvas, readingColumn, column, rail]) observer.observe(element);
    if (defaultWidth != null) observer.observe(defaultWidth);
    if (contentWidth != null) observer.observe(contentWidth);
    if (sidebarRef.current != null) observer.observe(sidebarRef.current);
    measure();
    return () => observer.disconnect();
  }, [rail, readingColumn, sidebarOpen]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (scrollElement == null || grid == null) return;
    const keepHeight = () => {
      grid.style.minHeight = `${Math.min(scrollElement.scrollHeight, Math.ceil(scrollElement.scrollTop + scrollElement.clientHeight) + 1)}px`;
    };
    keepHeight();
    scrollElement.addEventListener("scroll", keepHeight, { passive: true });
    const observer = new ResizeObserver(keepHeight);
    observer.observe(scrollElement);
    return () => {
      scrollElement.removeEventListener("scroll", keepHeight);
      observer.disconnect();
    };
  }, [scrollElement]);

  const railShown = open && metrics.hasRoom;
  const reservedTarget = (sidebarOpen ? metrics.sidebarWidth : 0) + (railShown ? metrics.railWidth : 0);
  const inlineComments = metrics.hasRoom && (railShown || (!reducedMotion && railProgress.get() > 0));

  useMotionValueEvent(railProgress, "animationComplete", () => {
    if (railProgress.get() === 0) setRevision((revision) => revision + 1);
  });

  useLayoutEffect(() => {
    if (reducedMotion || !metrics.hasRoom) {
      railProgress.jump(railShown ? 1 : 0);
      return;
    }
    const controls = animate(railProgress, railShown ? 1 : 0, pageLayoutSpring);
    return () => controls.stop();
  }, [railProgress, railShown, reducedMotion, metrics.hasRoom]);

  useLayoutEffect(() => {
    const sidebarTarget = sidebarOpen ? metrics.sidebarWidth : 0;
    if (reducedMotion) {
      reservedWidth.jump(reservedTarget);
      sidebarWidth.jump(sidebarTarget);
      return;
    }
    const reservedControls = animate(reservedWidth, reservedTarget, pageLayoutSpring);
    const sidebarControls = animate(sidebarWidth, sidebarTarget, pageLayoutSpring);
    return () => {
      reservedControls.stop();
      sidebarControls.stop();
    };
  }, [reservedWidth, reducedMotion, reservedTarget, sidebarOpen, sidebarWidth, metrics.sidebarWidth]);

  return (
    <>
      <div
        ref={canvasRef}
        className="@container/page relative min-h-0 w-full min-w-0 flex-1 gap-x-6 overflow-hidden"
        data-page-document-canvas=""
        data-page-comments-inline={inlineComments ? "" : undefined}
      >
        <motion.div
          ref={scrollElementRef}
          className={clsx(
            "gemini-chat-scrollbar h-full min-h-0 overflow-x-hidden scrollbar-stable [container-type:size] [overflow-anchor:none]",
            headerOverlay && "viewer-header-scroll-mask scroll-pt-[var(--viewer-header-height)]",
            scrollable ? "overflow-y-auto" : "overflow-y-hidden",
          )}
          data-page-document-scroll=""
          data-page-document-viewport=""
          style={{ width: scrollWidth }}
        >
          <motion.div ref={gridRef} className={clsx("relative grid min-h-full grid-cols-1 gap-x-6", headerOverlay && "pt-[var(--viewer-header-height)]")} style={{ width: gridWidth }}>
            <motion.div
              className="@container/page-document col-start-1 row-start-1 w-full min-w-0 self-start justify-self-center"
              style={{ transform: documentTransform, width: documentWidth }}
            >
              {comments({ container: railContainer, hasRoom: metrics.hasRoom, scrollElement })}
              {children}
            </motion.div>
            <motion.div
              ref={setRail}
              className={clsx("col-start-1 row-start-1 w-80 self-start justify-self-center", inlineComments ? "relative" : "invisible absolute end-0 top-0 h-0 overflow-hidden")}
              inert={!railShown}
              aria-hidden={!railShown}
              style={{ opacity: railOpacity, transform: railTransform }}
            >
              <div ref={setRailContainer} />
            </motion.div>
          </motion.div>
        </motion.div>
        {sidebar == null ? null : (
          <div className="pointer-events-none absolute inset-0 flex justify-end">
            <div
              ref={sidebarRef}
              className={clsx("ws-page-sidebar", "pointer-events-auto absolute inset-y-0 end-0 z-20 flex max-w-full @3xl/page-comments:static", headerOverlay && "pt-[var(--viewer-header-height)]")}
            >
              {sidebar}
            </div>
          </div>
        )}
      </div>
      {navigation?.(inlineComments)}
    </>
  );
}

export interface PageDocumentPresentationProps extends Omit<HTMLMotionProps<"div">, "children" | "className"> {
  children?: ReactNode;
  heading?: ReactNode;
  headingRef?: Ref<HTMLDivElement>;
  messages?: ReactNode;
  compact?: boolean;
}

/** `presentation` chunk `t`: the Page content column, its reading-width probes, status messages and heading. */
export function PageDocumentPresentation({ heading, messages, compact = false, headingRef, children, ...rest }: PageDocumentPresentationProps) {
  const { fullWidth } = usePagesViewSettings();
  return (
    <motion.div
      {...rest}
      className={clsx(pageCss.PageContent, compact ? "py-4" : "pt-10 pb-panel")}
      data-compact={compact || undefined}
      data-page-full-width={fullWidth || undefined}
    >
      <div ref={headingRef} className={`${pageCss.PageReadingColumn} flex flex-col gap-6`} data-page-reading-column="">
        <span className={pageCss.PageReadingWidthMeasure} aria-hidden data-page-comment-content-width="">
          <span data-page-default-reading-width="" />
        </span>
        <div className={clsx("flex flex-col gap-2 empty:hidden", compact && "mb-4")}>{messages}</div>
        {heading}
      </div>
      {children}
    </motion.div>
  );
}

/** `presentation` chunk `n`: status shown while the document loads under its title. */
export function PageContentLoading({ pageId }: { pageId: string }) {
  const intl = useIntl();
  return (
    <div className={pageCss.PageReadingColumn} aria-label={intl.formatMessage(pageMessages.contentLoading)} role="status">
      <LoadingShimmerLines seed={pageId} size="md" />
    </div>
  );
}
