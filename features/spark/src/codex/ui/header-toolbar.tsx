import clsx from "clsx";
import type { ReactNode } from "react";

const css = {
  DefaultInset: "_DefaultInset_11q0v_2",
  PageInset: "_PageInset_11q0v_2",
  TabStripInset: "_TabStripInset_11q0v_2",
  TabStripFlushStart: "_TabStripFlushStart_11q0v_2",
  Toolbar: "_Toolbar_11q0v_2",
} as const;

export interface HeaderToolbarProps {
  children?: ReactNode;
  inset?: boolean | "page" | "tab-strip" | "tab-strip-flush-start";
  size?: "header" | "pane";
}

/** Row laid out inside the app-shell header (`XGt` / `BYr` in app-initial). */
export function HeaderToolbar({ children, inset = true, size = "header" }: HeaderToolbarProps) {
  return (
    <div
      className={clsx(
        css.Toolbar,
        "@container/app-shell-header-toolbar flex w-full min-w-0 items-center justify-between gap-2",
        size === "pane" ? "h-toolbar-pane" : "electron:h-[var(--app-shell-header-height,var(--height-toolbar))] extension:py-row-y",
        inset === true && css.DefaultInset,
        inset === "page" && css.PageInset,
        (inset === "tab-strip" || inset === "tab-strip-flush-start") && css.TabStripInset,
        inset === "tab-strip-flush-start" && css.TabStripFlushStart,
      )}
      data-app-shell-header-toolbar
    >
      {children}
    </div>
  );
}

/** Trailing action cluster of a header toolbar (`ZGt` / `VYr` in app-initial); `secondary` shows from the 2xl container size. */
export function HeaderToolbarActions({ children, compact = false, secondary }: { children?: ReactNode; compact?: boolean; secondary?: ReactNode }) {
  return (
    <div className={clsx("ms-auto flex shrink-0 items-center justify-end", compact ? "gap-px" : "gap-1.5")}>
      {secondary == null ? null : <div className="hidden @2xl/app-shell-header-toolbar:contents">{secondary}</div>}
      {children}
    </div>
  );
}
