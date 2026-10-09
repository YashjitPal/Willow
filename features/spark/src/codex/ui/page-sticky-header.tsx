import clsx from "clsx";
import type { ReactNode } from "react";

export interface PageStickyHeaderProps {
  children?: ReactNode;
  className?: string;
  fadeSize?: "default" | "compact";
  showScrollFade?: boolean;
  sticky?: boolean;
}

/** `a9` (`YMa`): surface-colored band that sticks while the page scrolls, fading into the content below. */
export function PageStickyHeader({ children, className, fadeSize = "default", showScrollFade = true, sticky = true }: PageStickyHeaderProps) {
  return (
    <div
      className={clsx(
        "ws-sticky-header",
        "bg-surface",
        sticky &&
          "sticky z-30 after:pointer-events-none after:absolute after:top-full after:right-0 after:left-0 after:bg-linear-to-b after:from-surface after:to-transparent after:content-['']",
        sticky && (fadeSize === "compact" ? "after:h-2" : "after:h-8"),
        sticky && !showScrollFade && "after:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface PageControlsRowProps {
  children?: ReactNode;
  inset?: boolean;
  wrap?: boolean;
}

/** `r9` (`XMa`): the row holding a page's navigation (tabs) and trailing controls. */
export function PageControlsRow({ children, inset = true, wrap = false }: PageControlsRowProps) {
  return <div className={clsx("ws-controls-row", "flex items-center justify-between gap-4 pb-2", wrap && "flex-wrap", inset && "px-3")}>{children}</div>;
}
