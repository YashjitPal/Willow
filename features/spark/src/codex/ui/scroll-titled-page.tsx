import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { HeaderToolbar } from "./header-toolbar";
import { PaneHeader } from "./pane-header";

const contentWidthClasses = {
  extraWide: "max-w-[1440px]",
  wide: "max-w-5xl",
  medium: "max-w-[960px]",
  default: "max-w-[var(--thread-content-max-width)]",
} as const;

const headerVariantClasses = {
  default: { inset: "pt-panel", title: "heading-xl" },
  inset: { inset: "pt-panel", title: "heading-xl" },
  hero: { inset: "pt-4", title: "text-3xl font-bold md:text-5xl" },
  catalog: { inset: "pt-4", title: "heading-xl font-semibold" },
  compact: { inset: "pt-6", title: "heading-lg" },
} as const;

const headingTransition = { type: "spring", duration: 0.5, bounce: 0.1 } as const;

export interface ScrollTitledPageProps {
  title: ReactNode;
  subtitle?: ReactNode;
  headerAction?: ReactNode;
  toolbarActions?: ReactNode;
  toolbarInset?: boolean;
  children?: ReactNode;
  animateContentLayout?: boolean;
  contentClassName?: string;
  contentInset?: boolean;
  contentWidth?: keyof typeof contentWidthClasses;
  headerVariant?: keyof typeof headerVariantClasses;
}

/**
 * `i9` (`KMa` in app-initial) with `headerPlacement="scroll"`: the title scrolls away with the page and, once it has
 * left the scroll container, reappears with the header action in the pane toolbar.
 */
export function ScrollTitledPage({
  title,
  subtitle,
  headerAction,
  toolbarActions,
  toolbarInset = true,
  children,
  animateContentLayout = true,
  contentClassName,
  contentInset = true,
  contentWidth = "default",
  headerVariant = "default",
}: ScrollTitledPageProps) {
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion ? { duration: 0 } : headingTransition;
  const scrollRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [actionSize, setActionSize] = useState<{ width: number; height: number }>();
  const variant = headerVariantClasses[headerVariant];
  const isCompact = headerVariant === "compact";
  const widthClassName = contentWidthClasses[contentWidth];
  const paddingClassName = clsx("px-panel", (contentWidth === "medium" || contentWidth === "extraWide") && isCompact ? "px-6 lg:px-12" : undefined);

  useLayoutEffect(() => {
    const heading = headingRef.current;
    const root = scrollRef.current;
    if (heading == null || root == null) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0)),
      { root, threshold: 0 },
    );
    observer.observe(heading);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const action = actionRef.current;
    if (scrolled || action == null) return;
    const observer = new ResizeObserver(() => setActionSize({ width: action.offsetWidth, height: action.offsetHeight }));
    observer.observe(action);
    return () => observer.disconnect();
  }, [scrolled]);

  return (
    <>
      {scrolled || toolbarActions != null ? (
        <PaneHeader>
          <HeaderToolbar inset={toolbarInset}>
            <AnimatePresence initial={false}>
              {scrolled ? (
                <motion.div
                  key="toolbar-heading"
                  animate={{ opacity: 1, transform: "translateY(0)" }}
                  className="min-w-0 flex-1 overflow-hidden"
                  data-app-shell-overlay-page-header={toolbarActions == null || undefined}
                  exit={{ opacity: 0, transform: "translateY(4px)" }}
                  initial={{ opacity: 0, transform: "translateY(4px)" }}
                  transition={transition}
                >
                  <h1 className={clsx("ws-page__toolbar-title", "min-w-0 truncate text-base text-default electron:font-medium", headerVariant === "inset" ? "px-2" : null)}>{title}</h1>
                </motion.div>
              ) : null}
            </AnimatePresence>
            {toolbarActions == null && !scrolled ? null : (
              <div className="ms-auto flex min-w-0 items-center justify-end gap-2">
                {scrolled ? headerAction : null}
                {toolbarActions}
              </div>
            )}
          </HeaderToolbar>
        </PaneHeader>
      ) : null}
      <div
        ref={scrollRef}
        className={clsx("ws-page gemini-chat-scrollbar", "relative h-full min-h-0 flex-1 [scrollbar-gutter:stable] overflow-x-hidden overflow-y-auto", scrolled && "vertical-scroll-fade-mask-top")}
        data-app-shell-inline-page-header={toolbarActions == null || undefined}
      >
        <div className="flex min-h-full w-full flex-col">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key="page-heading"
              ref={headingRef}
              aria-hidden={scrolled || undefined}
              inert={scrolled}
              animate={{ opacity: 1, transform: "translateY(0)" }}
              exit={{ opacity: 0, transform: "translateY(-4px)" }}
              initial={{ opacity: 0, transform: "translateY(-4px)" }}
              transition={transition}
            >
              <div className={clsx("ws-page__header", `ws-page__header--${headerVariant}`, "mx-auto w-full", widthClassName, variant.inset, isCompact ? "pb-6" : "pb-4", paddingClassName)}>
                <div
                  className={clsx(
                    "flex justify-between gap-4",
                    isCompact ? "flex-wrap items-center" : "items-start",
                    headerVariant === "hero" && "justify-center text-center",
                    headerVariant === "inset" ? "px-2" : null,
                  )}
                >
                  <div className={clsx("flex min-w-0 flex-col", headerVariant === "inset" || headerVariant === "hero" ? "gap-2" : "gap-1")}>
                    <h1 className={clsx("ws-page__title", "text-default", variant.title)}>{title}</h1>
                    {subtitle == null ? null : <div className="ws-page__subtitle text-base leading-6 text-secondary">{subtitle}</div>}
                  </div>
                  {headerAction == null ? null : (
                    <div ref={actionRef} className={clsx("ws-page__actions", "min-w-0", isCompact ? "max-w-full" : "shrink-0")} style={scrolled ? actionSize : undefined}>
                      {scrolled ? null : headerAction}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
          <motion.div
            layout={animateContentLayout ? "position" : false}
            className={clsx(
              "ws-page__content", "mx-auto flex min-h-0 w-full flex-1 flex-col",
              "pb-panel",
              widthClassName,
              contentInset && isCompact && "pt-3.5",
              contentInset && !isCompact && "pt-panel",
              contentClassName,
              paddingClassName,
            )}
            transition={transition}
          >
            {children}
          </motion.div>
        </div>
      </div>
    </>
  );
}
