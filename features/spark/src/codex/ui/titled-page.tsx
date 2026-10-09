import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { HeaderToolbar } from "./header-toolbar";
import { PaneHeader } from "./pane-header";
import { SearchInput, type SearchInputProps } from "./search-input";

export interface TitledPageProps {
  title: ReactNode;
  subtitle?: ReactNode;
  headerAction?: ReactNode;
  children?: ReactNode;
  /** `toolbar` moves the title into the pane header (see `PaneHeader`). */
  headerPlacement?: "page" | "toolbar";
  toolbarActions?: ReactNode;
  toolbarInset?: boolean;
  /** Sticky search field above the content. */
  search?: Omit<SearchInputProps, "variant">;
  searchToolbar?: ReactNode;
  contentClassName?: string;
  /** `inset` indents the heading to line up with inset content (the plugins directory). */
  headerVariant?: "default" | "inset";
  contentWidth?: keyof typeof contentWidthClasses;
  /** Row above the content (a filter); in the `toolbar` placement it replaces the toolbar title. */
  navigation?: ReactNode;
  /** Trailing actions of the row above the content. */
  pageActions?: ReactNode;
}

const headingTransition = { type: "spring", duration: 0.5, bounce: 0.1 } as const;

const contentWidthClasses = {
  extraWide: "max-w-[1440px]",
  wide: "max-w-5xl",
  medium: "max-w-[960px]",
  default: "max-w-[var(--thread-content-max-width)]",
};

/**
 * `i9`: a scrolling page with a title header. Ported: the default layout and the `toolbar` header placement, with
 * an optional sticky search row (`search`, `searchToolbar`), the `navigation` / `pageActions` row, the `inset` header
 * variant and the content widths. Not ported: sticky / inline / scroll headers, banners, sticky controls and the other
 * header variants.
 */
export function TitledPage({
  title,
  subtitle,
  headerAction,
  children,
  headerPlacement = "page",
  toolbarActions,
  toolbarInset = true,
  search,
  searchToolbar,
  contentClassName,
  headerVariant = "default",
  contentWidth = "default",
  navigation,
  pageActions,
}: TitledPageProps) {
  const widthClassName = contentWidthClasses[contentWidth];
  const isInset = headerVariant === "inset";
  const reduceMotion = useReducedMotion();
  const [initialActiveElement] = useState(() => document.activeElement);
  const isToolbar = headerPlacement === "toolbar";
  const hasSearch = search != null;
  const activeElement = document.activeElement;
  const autoFocusSearch =
    search?.autoFocus ?? (activeElement == null || activeElement === document.body || activeElement === document.documentElement || activeElement === initialActiveElement);
  return (
    <>
      {isToolbar || toolbarActions != null ? (
        <PaneHeader>
          <HeaderToolbar inset={toolbarInset}>
            <AnimatePresence initial={false}>
              {isToolbar ? (
                <motion.div
                  key="toolbar-heading"
                  animate={{ opacity: 1, transform: "translateY(0)" }}
                  className="min-w-0 flex-1 overflow-hidden"
                  exit={{ opacity: 0, transform: "translateY(4px)" }}
                  initial={{ opacity: 0, transform: "translateY(4px)" }}
                  transition={reduceMotion ? { duration: 0 } : headingTransition}
                >
                  {navigation == null ? (
                    <h1 className={clsx("min-w-0 truncate text-base text-default electron:font-medium", isInset ? "px-2" : null)}>{title}</h1>
                  ) : (
                    <>
                      <h1 className="sr-only">{title}</h1>
                      {navigation}
                    </>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
            {toolbarActions == null ? null : <div className="ms-auto flex min-w-0 items-center justify-end gap-2">{toolbarActions}</div>}
          </HeaderToolbar>
        </PaneHeader>
      ) : null}
      <div
        className="ws-page relative h-full min-h-0 flex-1 [scrollbar-gutter:stable] overflow-x-hidden overflow-y-auto"
        data-app-shell-inline-page-header={(!isToolbar && toolbarActions == null) || undefined}
      >
        <div className="flex min-h-full w-full flex-col">
          {isToolbar ? null : (
            <div>
              <div className={clsx("ws-page__header", "mx-auto w-full", widthClassName, "pt-panel", !hasSearch && "pb-4", "px-panel")}>
                <div className={clsx("flex justify-between gap-4 items-start", isInset ? "px-2" : null)}>
                  <div className={clsx("flex min-w-0 flex-col", isInset ? "gap-2" : "gap-1")}>
                    <h1 className="ws-page__title text-default heading-xl">{title}</h1>
                    {subtitle == null ? null : <div className="ws-page__subtitle text-base leading-6 text-secondary">{subtitle}</div>}
                  </div>
                  {headerAction == null ? null : <div className="ws-page__actions min-w-0 shrink-0">{headerAction}</div>}
                </div>
              </div>
            </div>
          )}
          {hasSearch ? (
            <div
              className={clsx(
                "bg-surface",
                "sticky z-30 after:pointer-events-none after:absolute after:top-full after:right-0 after:left-0 after:bg-linear-to-b after:from-surface after:to-transparent after:content-['']",
                "after:h-8",
                "top-0",
              )}
            >
              <div className={clsx("mx-auto flex w-full items-center gap-2 pb-2", widthClassName, "pt-panel", "px-panel")}>
                <SearchInput {...search} autoFocus={autoFocusSearch} className={clsx("min-w-0 flex-1", search.className)} />
                {searchToolbar}
              </div>
            </div>
          ) : null}
          <div
            className={clsx(
              "mx-auto flex min-h-0 w-full flex-1 flex-col",
              "pb-panel",
              widthClassName,
              hasSearch ? "pt-5" : "pt-panel",
              contentClassName,
              "px-panel",
            )}
          >
            {(!isToolbar && navigation != null) || pageActions != null ? (
              <div className="flex items-center justify-between gap-4 px-3 pb-2">
                {isToolbar ? null : navigation}
                {pageActions == null ? null : <div className="ms-auto">{pageActions}</div>}
              </div>
            ) : null}
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
