import clsx from "clsx";
import { AnimatePresence, motion, useIsPresent, useMotionValue, useTransform } from "framer-motion";
import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from "react";
import { flushSync } from "react-dom";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { useReducedMotion } from "../lib/theme-engine";
import { Button } from "./button";
import { Input, type InputProps } from "./input";
import { LoadingShimmer } from "./loading-shimmer";
import { menuContentMaxHeight, menuContentWidthClassName } from "./menu";
import type { SymbolKind, SymbolPickerCapabilities } from "./symbol-picker-types";

const css = {
  header: "_header_8mxdx_2",
  footer: "_footer_8mxdx_10",
  bodyContent: "_bodyContent_8mxdx_15",
  body: "_body_8mxdx_15",
  compact: "_compact_8mxdx_31",
} as const;

const ease = [0.23, 1, 0.32, 1] as const;

const tabMessages = defineMessages({
  emoji: {
    id: "symbolPicker.tab.emoji",
    defaultMessage: "Emoji",
    description: "Button for choosing an emoji in the symbol picker",
  },
  icon: {
    id: "symbolPicker.tab.icons",
    defaultMessage: "Icons",
    description: "Button for choosing an icon in the symbol picker",
  },
  teamIcon: {
    id: "symbolPicker.tab.teamIcons",
    defaultMessage: "Team icons",
    description: "Button for choosing an illustrated team icon in the symbol picker",
  },
});

/** `Jbr1Component`: refocuses the search field (or grid) of its picker, then clears. */
function SymbolPickerClearButton({ disabled, onClear }: { disabled?: boolean; onClear?: () => void }) {
  if (onClear == null) return null;
  return (
    <Button
      color="secondary"
      size="compact"
      radius="full"
      disabled={disabled}
      onClick={(event) => {
        (event.currentTarget as HTMLElement)
          .closest("[data-symbol-picker]")
          ?.querySelector<HTMLElement>('input:not(:disabled), [role="grid"]')
          ?.focus({ preventScroll: true });
        onClear();
      }}
    >
      <FormattedMessage id="symbolPicker.clear" defaultMessage="Clear" description="Action that clears the current symbol selection" />
    </Button>
  );
}

export type SymbolPickerSearchProps = Omit<InputProps, "ref" | "variant" | "type" | "autoComplete" | "spellCheck" | "aria-label" | "placeholder">;

export interface SymbolPickerHeaderProps {
  ref?: Ref<HTMLInputElement>;
  capabilities: SymbolPickerCapabilities;
  disabled?: boolean;
  kind: SymbolKind;
  onClear?: () => void;
  onKindChange: (kind: SymbolKind) => void;
  search?: SymbolPickerSearchProps;
}

/** `KXt` (`Abr`): tab buttons for each available symbol kind, the search field and the clear action. */
export function SymbolPickerHeader({ ref, capabilities, disabled, kind, onClear, onKindChange, search }: SymbolPickerHeaderProps) {
  const intl = useIntl();
  const kinds: SymbolKind[] = [];
  if (capabilities.emoji != null) kinds.push("emoji");
  if (capabilities.icons != null) kinds.push("icon");
  if (capabilities.teamIcons != null) kinds.push("teamIcon");
  const hasTabs = kinds.length > 1;
  const searchLabel =
    kind === "emoji"
      ? intl.formatMessage({
          id: "emoji.search.label",
          defaultMessage: "Search emojis",
          description: "Accessible label and placeholder for searching emoji names and shortcodes",
        })
      : kind === "teamIcon"
        ? intl.formatMessage({
            id: "symbolPicker.search.teamIcons",
            defaultMessage: "Search team icons",
            description: "Accessible label and placeholder for searching illustrated team icons by name or meaning",
          })
        : intl.formatMessage({
            id: "symbolPicker.search.icons",
            defaultMessage: "Search icons",
            description: "Accessible label and placeholder for searching icons by name or meaning",
          });
  const clear = <SymbolPickerClearButton disabled={disabled} onClear={onClear} />;
  return (
    <>
      {hasTabs || (search == null && onClear != null) ? (
        <div className="flex items-center justify-end gap-2 p-[var(--app-menu-gutter,var(--spacing))] select-none">
          {hasTabs ? (
            <div
              className="me-auto flex items-center gap-1"
              role="group"
              aria-label={intl.formatMessage({
                id: "symbolPicker.tabs.label",
                defaultMessage: "Symbol type",
                description: "Accessible name for the symbol source controls",
              })}
            >
              {kinds.map((option) => (
                <Button
                  key={option}
                  color={kind === option ? "secondary" : "ghost"}
                  size="compact"
                  radius="full"
                  disabled={disabled}
                  aria-pressed={kind === option}
                  onClick={() => onKindChange(option)}
                >
                  <FormattedMessage {...tabMessages[option]} />
                </Button>
              ))}
            </div>
          ) : null}
          {clear}
        </div>
      ) : null}
      {search == null ? null : (
        <div className="flex min-h-[var(--app-menu-item-height,0px)] items-center gap-[var(--spacing-menu-item-content,calc(var(--spacing)*1.5))] p-[var(--app-menu-item-padding,var(--padding-row-y)_calc(var(--spacing)*1.5))]">
          <Input {...search} ref={ref} variant="compact" type="search" autoComplete="off" spellCheck={false} aria-label={searchLabel} placeholder={searchLabel} />
          {hasTabs ? null : clear}
        </div>
      )}
    </>
  );
}

/** `WXt` (`Fbr`): a shimmering placeholder glyph. */
export function SymbolSkeletonCell() {
  return (
    <span className="block size-6 overflow-hidden rounded-full" aria-hidden>
      <LoadingShimmer as="span" size="fill" />
    </span>
  );
}

/** `$x` (app-shared): the border-box size of a resize observer entry. */
function entrySize(entry: ResizeObserverEntry) {
  if (entry.borderBoxSize) {
    const box = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : (entry.borderBoxSize as unknown as ResizeObserverSize);
    return { width: box.inlineSize, height: box.blockSize };
  }
  return { width: entry.contentRect.width, height: entry.contentRect.height };
}

/** `zbr`: reports height changes of `target` (including the first measurement); returns the disconnect. */
function observeHeight(target: HTMLElement | null, onChange: (height: number) => void) {
  if (target == null || typeof ResizeObserver === "undefined") return;
  let previousHeight: number | null = null;
  let initial = true;
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { height } = entrySize(entry);
      const changed = (initial || previousHeight != null) && previousHeight !== height;
      previousHeight = height;
      initial = false;
      if (changed) onChange(height);
    }
  });
  observer.observe(target);
  return () => observer.disconnect();
}

function cssZoom(element: Element) {
  return (element as Element & { currentCSSZoom?: number }).currentCSSZoom || 1;
}

/** `$br`: focuses the first enabled symbol below the sticky header, else the grid. */
function focusFirstVisibleSymbol(container: HTMLElement) {
  const bounds = container.getBoundingClientRect();
  const visibleTop = bounds.top + (Number.parseFloat(getComputedStyle(container).scrollPaddingTop) || 0) * cssZoom(container);
  let target: HTMLElement | null = null;
  for (const row of container.querySelectorAll('[role="row"]')) {
    const rowBounds = row.getBoundingClientRect();
    if (rowBounds.bottom > visibleTop && rowBounds.top < bounds.bottom) {
      target = row.querySelector<HTMLElement>("button:not(:disabled)");
      if (target != null) break;
    }
  }
  (target ?? container.querySelector<HTMLElement>('[role="grid"]'))?.focus({ preventScroll: true });
}

/** `Exr1Component`: slides in under the results while they are scrolled to the top. */
function SymbolPickerFooter({ children, compact }: { children: ReactNode; compact: boolean }) {
  const isPresent = useIsPresent();
  const reducedMotion = useReducedMotion();
  const hidden = { opacity: 0, transform: reducedMotion ? "translateY(0)" : "translateY(100%)" };
  return (
    <motion.div
      className={clsx("shrink-0", compact ? "border-t border-subtle" : css.footer)}
      data-symbol-picker-footer=""
      aria-hidden={!isPresent || undefined}
      inert={!isPresent}
      initial={hidden}
      animate={{ opacity: 1, transform: "translateY(0)" }}
      exit={hidden}
      transition={{ duration: reducedMotion ? 0 : 0.15, ease }}
    >
      <div className={clsx("flex items-center justify-end gap-2 select-none", compact ? "px-2" : "min-h-[var(--app-menu-item-height,0px)] p-[var(--app-menu-gutter,var(--spacing))]")}>
        {children}
      </div>
    </motion.div>
  );
}

interface ScrollState {
  resultsKey: string;
  hasScrolled: boolean;
  controlsCollapsed: boolean;
  /** Keeps the picker at its maximum height while the collapsed controls animate. */
  heightPinned: boolean;
}

function initialScrollState(resultsKey: string): ScrollState {
  return { resultsKey, hasScrolled: false, controlsCollapsed: false, heightPinned: false };
}

export interface SymbolPickerLayoutProps {
  availableHeight?: string;
  categories?: ReactNode;
  children?: ReactNode;
  collapseSearchOnScroll?: boolean;
  compact?: boolean;
  footer?: ReactNode;
  hasSearch?: boolean;
  header?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
  /** Identifies the current results; scrolling state resets when it changes. */
  resultsKey?: string;
  resultsRef?: Ref<HTMLDivElement>;
}

/**
 * `BXt` (`Jbr`): picker surface with a sticky header whose search controls collapse while scrolling down
 * the results, a category bar, and a footer shown until the results scroll.
 */
export function SymbolPickerLayout({
  availableHeight = "100vh",
  categories,
  children,
  collapseSearchOnScroll = true,
  compact = false,
  footer,
  hasSearch = false,
  header,
  onKeyDown,
  onMouseDown,
  resultsKey = "",
  resultsRef,
}: SymbolPickerLayoutProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const lastScroll = useRef({ resultsKey, top: 0 });
  const scrolledByCategory = useRef(false);
  const headerHeight = useMotionValue("0px");
  const negativeHeaderHeight = useTransform(headerHeight, (height) => `-${height}`);
  const reducedMotion = useReducedMotion();
  const hasHeader = header != null || categories != null;
  const maxHeight = menuContentMaxHeight("tall", availableHeight);
  const [contentHeight, setContentHeight] = useState<number>();
  const [overflowing, setOverflowing] = useState(false);
  const [scroll, setScroll] = useState(() => initialScrollState(resultsKey));
  if (scroll.resultsKey !== resultsKey) setScroll(initialScrollState(resultsKey));

  const observeContentHeight = useCallback((element: HTMLDivElement | null) => observeHeight(element, setContentHeight), []);
  const observeHeaderHeight = useCallback((element: HTMLDivElement | null) => observeHeight(element, (height) => headerHeight.set(`${height}px`)), [headerHeight]);
  const observeOverflow = useCallback((element: HTMLDivElement | null) => {
    const container = element?.parentElement;
    if (element == null || container == null) return;
    const observer = new ResizeObserver(() => setOverflowing(container.scrollHeight > container.clientHeight + 1));
    observer.observe(container);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const transition = { duration: reducedMotion ? 0 : 0.15, ease };
  return (
    <motion.div
      ref={rootRef}
      data-symbol-picker=""
      onKeyDown={onKeyDown}
      onKeyDownCapture={(event) => {
        scrolledByCategory.current = false;
        if (
          scroll.controlsCollapsed &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          (event.key.length === 1 || event.key === "ArrowUp" || event.key === "Home" || event.key === "Tab")
        ) {
          flushSync(() => setScroll((current) => ({ ...current, controlsCollapsed: false })));
        }
      }}
      onMouseDown={onMouseDown}
      role="presentation"
      className={clsx(
        "ws-picker no-drag flex min-w-0 flex-col overflow-hidden font-sans text-sm text-default shadow-lg outline-hidden [font-weight:var(--font-ui-weight)]",
        compact
          ? [css.compact, "w-max max-w-[var(--radix-popover-content-available-width,100%)] border border-subtle bg-surface-elevated", footer == null ? "rounded-full" : "rounded-3xl"]
          : ["ring-border max-w-full rounded-xl bg-surface-elevated-secondary ring-[0.5px]", menuContentWidthClassName("panelWide")],
      )}
      initial={false}
      animate={{ height: compact ? "auto" : (contentHeight ?? "auto") }}
      transition={transition}
      style={{ maxHeight }}
    >
      <div ref={observeContentHeight} className="flex shrink-0 flex-col rounded-[inherit]" style={{ height: scroll.heightPinned ? maxHeight : undefined, maxHeight }}>
        {hasHeader ? (
          <div ref={observeHeaderHeight} data-symbol-picker-header="" className={clsx(css.header, "relative z-10 shrink-0 bg-surface-elevated-secondary empty:hidden")}>
            <motion.div
              ref={controlsRef}
              className="grid"
              inert={scroll.controlsCollapsed}
              aria-hidden={scroll.controlsCollapsed || undefined}
              initial={false}
              animate={{ gridTemplateRows: scroll.controlsCollapsed ? "0fr" : "1fr", opacity: scroll.controlsCollapsed ? 0 : 1 }}
              transition={transition}
              onAnimationComplete={() => setScroll((current) => (!current.controlsCollapsed && current.heightPinned ? { ...current, heightPinned: false } : current))}
            >
              <div className="min-h-0 overflow-hidden">{header}</div>
            </motion.div>
            {categories == null ? null : (
              <div
                data-symbol-picker-categories=""
                onClickCapture={() => {
                  scrolledByCategory.current = true;
                }}
                className="min-h-[var(--app-menu-item-height,0px)] p-[var(--app-menu-item-padding,var(--padding-row-y)_calc(var(--spacing)*1.5))] select-none"
              >
                {categories}
              </div>
            )}
            <div
              aria-hidden="true"
              data-symbol-picker-overflow=""
              className={clsx(
                "pointer-events-none absolute inset-x-0 top-full h-4 bg-linear-to-b from-surface-elevated-secondary to-transparent transition-opacity duration-basic ease-basic after:absolute after:inset-x-0 after:top-0 after:h-[0.5px] after:bg-text/10 after:content-[''] motion-reduce:transition-none",
                overflowing && scroll.hasScrolled && (categories != null || !scroll.controlsCollapsed) ? "opacity-100" : "opacity-0",
              )}
            />
          </div>
        ) : null}
        {children == null ? null : (
          <motion.div
            data-symbol-picker-body=""
            style={{ marginTop: hasHeader ? negativeHeaderHeight : undefined }}
            className={clsx(css.body, "flex min-h-0 flex-col overflow-hidden", scroll.heightPinned && "flex-1")}
          >
            <motion.div
              key={resultsKey}
              ref={resultsRef}
              className={clsx("hide-scrollbar flex min-h-0 flex-col overflow-y-auto [overflow-anchor:none]", scroll.heightPinned && "flex-1")}
              style={{ scrollPaddingTop: hasHeader ? headerHeight : undefined }}
              onPointerDown={() => {
                scrolledByCategory.current = false;
              }}
              onWheel={(event) => {
                scrolledByCategory.current = false;
                if (event.deltaY < 0) setScroll((current) => (current.controlsCollapsed ? { ...current, controlsCollapsed: false } : current));
              }}
              onScroll={(event) => {
                if (categories == null && !hasSearch) return;
                const container = event.currentTarget;
                const top = container.scrollTop;
                const previousTop = lastScroll.current.resultsKey === resultsKey ? lastScroll.current.top : 0;
                const maxTop = container.scrollHeight - container.clientHeight;
                const clampedAtBottom = previousTop > maxTop && top >= maxTop - 1;
                const activeElement = container.ownerDocument.activeElement;
                let controlsCollapsed = scroll.controlsCollapsed;
                if (top < previousTop && !clampedAtBottom) controlsCollapsed = false;
                else if (top > previousTop && !scrolledByCategory.current && hasSearch && collapseSearchOnScroll) controlsCollapsed = true;
                lastScroll.current = { resultsKey, top };
                scrolledByCategory.current = false;
                const hasScrolled = top > 0;
                if (
                  (controlsCollapsed && controlsRef.current?.contains(activeElement)) ||
                  (hasScrolled && rootRef.current?.querySelector("[data-symbol-picker-footer]")?.contains(activeElement))
                ) {
                  focusFirstVisibleSymbol(container);
                }
                setScroll((current) =>
                  current.hasScrolled === hasScrolled && current.controlsCollapsed === controlsCollapsed
                    ? current
                    : { resultsKey, hasScrolled, controlsCollapsed, heightPinned: current.heightPinned || controlsCollapsed },
                );
              }}
            >
              <motion.div ref={observeOverflow} style={{ paddingTop: hasHeader ? headerHeight : undefined }} className={clsx(css.bodyContent, "flex min-w-0 shrink-0 flex-col")}>
                <div className={compact ? "px-2.5 py-1.25" : "p-[var(--app-menu-item-padding,var(--padding-row-y)_calc(var(--spacing)*1.5))]"}>{children}</div>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
        <AnimatePresence initial={false}>
          {footer != null && !scroll.hasScrolled ? <SymbolPickerFooter compact={compact}>{footer}</SymbolPickerFooter> : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
