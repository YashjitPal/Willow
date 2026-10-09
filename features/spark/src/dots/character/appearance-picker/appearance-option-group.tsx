import clsx from "clsx";
import { type FocusEvent, type HTMLAttributes, type ReactNode, useId, useRef, useState } from "react";
import { useIntl } from "../../lib/intl";
import { useReducedMotion } from "../../lib/reduced-motion";
import { Button } from "../../codex-ui/button";
import { ChevronLeftMdLight16Icon } from "../../codex-icons/chevron-left-md-light-16";
import { ChevronRightMdLight16Icon } from "../../codex-icons/chevron-right-md-light-16";
import { carouselPagePosition, carouselScrollBounds } from "./card-carousel-scroll";

export interface AppearanceOption {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  /** Actions (e.g. "Create a pet") never show as selected. */
  action?: boolean;
}

export interface AppearanceOptionGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  className?: string;
  disabled?: boolean;
  options: AppearanceOption[];
  selectedId?: string | null;
  variant: "artwork" | "artwork-row";
  /** Rendered before the options (e.g. a "Create" action). */
  leading?: ReactNode;
  heading?: ReactNode;
  /** Lets an `artwork-row` scroll edge to edge of a `px-6` container. */
  fullBleed?: boolean;
  /** Lets artwork fill the whole tile instead of a centered 64px box. */
  fillArtwork?: boolean;
  onChange: (id: string) => void;
  /** Hover/focus preview: the hovered option id, or the one to fall back to (`null` for the selection). */
  onPreview?: (id: string | null) => void;
  loadingItems?: { count: number; icon: ReactNode };
}

/** Grid or scrolling row of appearance artwork tiles (`EComponent` in appearance-picker-button). */
export function AppearanceOptionGroup({
  className,
  disabled = false,
  options,
  selectedId,
  variant,
  leading,
  heading,
  fullBleed = false,
  fillArtwork = false,
  onChange,
  onPreview,
  loadingItems,
  ...rest
}: AppearanceOptionGroupProps) {
  const hoveredRef = useRef<string | null>(null);
  const focusedRef = useRef<string | null>(null);
  const preview = (id: string | null) => {
    const option = options.find((candidate) => candidate.id === id);
    onPreview?.(!disabled && option && !option.disabled ? option.id : null);
  };

  const tileClassName = clsx("flex aspect-square w-full items-center justify-center rounded-2xl border p-2", fillArtwork && "relative");
  const artworkClassName = fillArtwork ? "absolute inset-0" : "size-16";
  const items = (
    <>
      {leading}
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-label={option.label}
          aria-pressed={option.action ? undefined : selectedId === option.id}
          className={clsx(
            tileClassName,
            "cursor-interaction focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50",
            !option.action && selectedId === option.id ? "border-text ring-1 ring-text ring-inset" : "border-transparent hover:bg-primary-ghost-hover",
          )}
          disabled={disabled || option.disabled}
          onPointerEnter={(event) => {
            if (disabled || option.disabled || !event.isPrimary || event.pointerType === "touch") return;
            hoveredRef.current = option.id;
            preview(option.id);
          }}
          onPointerLeave={(event) => {
            if (event.isPrimary && event.pointerType !== "touch" && hoveredRef.current === option.id) {
              hoveredRef.current = null;
              preview(focusedRef.current);
            }
          }}
          onFocus={(event) => {
            if (disabled || option.disabled || !event.currentTarget.matches(":focus-visible")) return;
            focusedRef.current = option.id;
            preview(option.id);
          }}
          onBlur={() => {
            if (focusedRef.current === option.id) {
              focusedRef.current = null;
              preview(hoveredRef.current);
            }
          }}
          onPointerDown={(event) => {
            if (disabled || option.disabled || !event.isPrimary) return;
            if (event.pointerType === "touch") {
              if (hoveredRef.current == null && focusedRef.current == null) return;
              hoveredRef.current = null;
            } else if (focusedRef.current == null) {
              return;
            }
            focusedRef.current = null;
            preview(hoveredRef.current);
          }}
          onClick={() => onChange(option.id)}
        >
          <span className={artworkClassName}>{option.icon}</span>
        </button>
      ))}
      {loadingItems &&
        Array.from({ length: loadingItems.count }, (_, index) => (
          <span key={index} className={clsx(tileClassName, "border-transparent")} aria-hidden inert>
            <span className={artworkClassName}>{loadingItems.icon}</span>
          </span>
        ))}
    </>
  );
  const layoutClassName =
    variant === "artwork-row"
      ? "horizontal-scroll-fade-mask hide-scrollbar grid grid-flow-col auto-cols-max gap-1 overflow-x-auto overflow-y-hidden"
      : "grid grid-cols-3 gap-2 md:grid-cols-4";
  const groupClassName = clsx(layoutClassName, className, variant === "artwork-row" && fullBleed && "-mx-6 scroll-px-6 px-6");
  if (variant === "artwork-row" && heading != null) {
    return (
      <AppearanceOptionRow
        {...rest}
        className={groupClassName}
        heading={heading}
        disabled={disabled}
        itemCount={options.length + (loadingItems?.count ?? 0)}
        aria-busy={loadingItems != null || undefined}
      >
        {items}
      </AppearanceOptionRow>
    );
  }
  return (
    <div {...rest} className={groupClassName} role="group" aria-busy={loadingItems != null || undefined}>
      {items}
    </div>
  );
}

interface AppearanceOptionRowProps extends HTMLAttributes<HTMLDivElement> {
  heading: ReactNode;
  disabled: boolean;
  itemCount: number;
}

function scrollFocusedIntoView(event: FocusEvent<HTMLDivElement>) {
  if (event.target.matches(":focus-visible")) event.target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
}

/** A headed horizontal row with previous/next paging buttons (`B1Component`). */
function AppearanceOptionRow({ className, heading, disabled, children, itemCount, ...rest }: AppearanceOptionRowProps) {
  const intl = useIntl();
  const headingId = useId();
  const rowId = useId();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);

  const updateScrollState = (row: HTMLDivElement) => {
    const rtl = getComputedStyle(row).direction === "rtl";
    const { minimum, maximum } = carouselScrollBounds(row, rtl ? "rtl" : "ltr");
    setCanScrollBack(rtl ? row.scrollLeft < maximum - 1 : row.scrollLeft > minimum + 1);
    setCanScrollForward(rtl ? row.scrollLeft > minimum + 1 : row.scrollLeft < maximum - 1);
  };
  const scrollPage = (step: 1 | -1) => {
    const row = rowRef.current;
    row?.scrollTo({
      left: carouselPagePosition(row, step, getComputedStyle(row).direction === "rtl" ? "rtl" : "ltr"),
      behavior: reducedMotion ? "instant" : "smooth",
    });
  };
  const observeRow = (row: HTMLDivElement | null) => {
    rowRef.current = row;
    if (row == null) return;
    updateScrollState(row);
    const observer = new ResizeObserver(() => updateScrollState(row));
    observer.observe(row);
    if (itemCount > 0) for (const item of row.children) observer.observe(item);
    return () => {
      observer.disconnect();
      rowRef.current = null;
    };
  };

  return (
    <section className="flex min-w-0 shrink-0 flex-col gap-2" aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={headingId} className="text-sm text-secondary">
          {heading}
        </h3>
        <div className="flex items-center">
          <Button
            type="button"
            color="ghost"
            size="toolbar"
            uniform
            aria-controls={rowId}
            aria-label={intl.formatMessage({
              id: "appearanceOptionGroup.previous",
              defaultMessage: "Previous options",
              description: "Accessible label for scrolling to the previous page of appearance options in this section",
            })}
            disabled={disabled || !canScrollBack}
            onClick={() => scrollPage(-1)}
          >
            <ChevronLeftMdLight16Icon className="rtl:rotate-180" />
          </Button>
          <Button
            type="button"
            color="ghost"
            size="toolbar"
            uniform
            aria-controls={rowId}
            aria-label={intl.formatMessage({
              id: "appearanceOptionGroup.next",
              defaultMessage: "Next options",
              description: "Accessible label for scrolling to the next page of appearance options in this section",
            })}
            disabled={disabled || !canScrollForward}
            onClick={() => scrollPage(1)}
          >
            <ChevronRightMdLight16Icon className="rtl:rotate-180" />
          </Button>
        </div>
      </div>
      <div
        {...rest}
        id={rowId}
        ref={observeRow}
        className={className}
        role="group"
        aria-labelledby={headingId}
        onFocusCapture={scrollFocusedIntoView}
        onScroll={(event) => updateScrollState(event.currentTarget)}
      >
        {children}
      </div>
    </section>
  );
}
