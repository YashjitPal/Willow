import clsx from "clsx";
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type WheelEvent } from "react";
import { Button, type ButtonColor, type ButtonRadius, type ButtonSize } from "./button";
import { Tooltip } from "./tooltip";

export interface SegmentedControlOption<Id extends string = string> {
  id: Id;
  label: ReactNode;
  ariaLabel?: string;
  tooltipContent?: ReactNode;
  disabled?: boolean;
}

export type SegmentedControlVariant = "default" | "inset" | "field" | "form" | "pricing" | "filter" | "viewer" | "mode";

export interface SegmentedControlProps<Id extends string = string> {
  options?: SegmentedControlOption<Id>[];
  selectedId?: Id;
  onHover?: (id: Id) => void;
  onSelect?: (id: Id) => void;
  size?: ButtonSize;
  className?: string;
  buttonClassName?: string;
  fullWidth?: boolean;
  uniform?: boolean;
  selectedColor?: ButtonColor;
  unselectedColor?: ButtonColor;
  variant?: SegmentedControlVariant;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}

function scrollHorizontally(event: WheelEvent<HTMLDivElement>) {
  const delta = event.deltaX || event.deltaY;
  if (delta !== 0) event.currentTarget.scrollLeft = event.currentTarget.scrollLeft + delta;
}

/** Row of toggle buttons with one selected (`qu` in app-initial). Router-link options (`to`) are not cloned. */
export function SegmentedControl<Id extends string = string>({
  options = [],
  selectedId,
  onHover,
  onSelect,
  size,
  className,
  buttonClassName,
  fullWidth = false,
  uniform,
  selectedColor = "segmentedSelected",
  unselectedColor = "ghost",
  variant = "default",
  ariaLabel,
  ariaLabelledBy,
}: SegmentedControlProps<Id>) {
  const ref = useRef<HTMLDivElement>(null);
  const selectedIndex = options.findIndex((option) => option.id === selectedId);
  const indicatorStyle =
    selectedIndex === -1
      ? undefined
      : ({
          "--segmented-form-indicator-width": `${100 / options.length}%`,
          "--segmented-form-indicator-offset": `${selectedIndex * 100}%`,
        } as CSSProperties);

  let buttonSize: ButtonSize = size ?? "default";
  let radius: ButtonRadius = "default";
  let selected = selectedColor;
  let unselected = unselectedColor;
  if (variant === "inset") {
    buttonSize = size ?? "compact";
    radius = "large";
    selected = "segmentedInsetSelected";
  } else if (variant === "field") {
    buttonSize = "fieldSegment";
    selected = "segmentedInsetSelected";
  } else if (variant === "form") {
    buttonSize = "recoveryAction";
    radius = "full";
    selected = "segmentedFormSelected";
    unselected = "segmentedFormUnselected";
  } else if (variant === "pricing") {
    buttonSize = "dialog";
    radius = "extraLarge";
  } else if (variant === "filter") {
    buttonSize = "compact";
    radius = "full";
    selected = "secondary";
    unselected = "ghostTertiary";
  } else if (variant === "viewer") {
    buttonSize = "inline";
    radius = "full";
    unselected = "ghostActive";
  }
  const uniformButtons = uniform ?? (buttonSize === "icon" && options.length > 2);

  useLayoutEffect(() => {
    const container = ref.current;
    if (container == null) return;
    const reveal = () => {
      const active = container.querySelector<HTMLElement>('button[aria-pressed="true"], a[aria-current="page"]');
      if (active == null) return;
      const start = active.offsetLeft;
      const end = start + active.offsetWidth;
      if (start < container.scrollLeft) container.scrollLeft = start;
      else if (end > container.scrollLeft + container.clientWidth) container.scrollLeft = end - container.clientWidth;
    };
    reveal();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    for (const child of container.querySelectorAll("button, a")) observer.observe(child);
    return () => observer.disconnect();
  }, [options, selectedId]);

  return (
    <div
      ref={ref}
      className={clsx(
        "ws-segmented",
        `ws-segmented--${variant}`,
        "relative min-w-0 max-w-full items-center",
        variant === "mode"
          ? [fullWidth ? "grid w-full" : "inline-grid", "isolate h-9 auto-cols-fr grid-flow-col gap-0 rounded-full select-none"]
          : [fullWidth ? "flex w-full" : "inline-flex", "hide-scrollbar overflow-x-auto overflow-y-hidden", variant === "field" || variant === "form" ? "gap-0" : "gap-0.5"],
        variant === "inset" && "rounded-[10px] bg-(--segmented-control-background) p-0.5",
        variant === "field" && "h-8 rounded-md bg-surface-secondary",
        variant === "form" &&
          "isolate rounded-full bg-background-segmented-form-track p-1 dark:inset-shadow-sm dark:inset-ring-1 dark:inset-ring-border-subtle",
        variant === "pricing" && "rounded-[20px] bg-surface-secondary p-1",
        variant === "viewer" && "h-full p-0.5",
        className,
      )}
      role="group"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onWheel={scrollHorizontally}
    >
      {variant === "form" && selectedIndex !== -1 ? (
        <span aria-hidden className="pointer-events-none absolute inset-1 z-10 flex forced-colors:hidden" style={indicatorStyle}>
          <span className="h-full w-(--segmented-form-indicator-width) rounded-full bg-background-segmented-form-selected shadow-md motion-safe:transition-transform motion-safe:duration-basic motion-safe:ease-in-out ltr:translate-x-(--segmented-form-indicator-offset) rtl:-translate-x-(--segmented-form-indicator-offset) dark:shadow-lg-stronger dark:inset-shadow-2xs dark:inset-shadow-border" />
        </span>
      ) : null}
      {variant === "mode" ? (
        <span aria-hidden className="pointer-events-none absolute inset-x-px top-1/2 z-0 h-8.5 -translate-y-1/2 rounded-full bg-background-mode-toggle-track" />
      ) : null}
      {options.map((option) => {
        const isSelected = option.id === selectedId;
        const disabled = option.disabled ?? false;
        const button = (
          <Button
            key={option.id}
            unstyled={variant === "mode"}
            color={isSelected ? selected : unselected}
            focusRing={variant === "inset" || variant === "field" ? undefined : "inset"}
            size={buttonSize}
            radius={radius}
            onPointerEnter={onHover == null || disabled ? undefined : () => onHover(option.id)}
            uniform={uniformButtons}
            aria-label={option.ariaLabel}
            disabled={disabled}
            className={clsx(
              fullWidth ? "flex-1 justify-center" : "shrink-0",
              variant === "form" && "relative min-w-0 flex-1 basis-0 focus-visible:z-20 motion-safe:transition-colors motion-safe:duration-basic",
              variant === "mode" && [
                "relative z-10 h-full min-w-0 justify-center rounded-full border px-10 text-sm font-medium @max-lg/home-mode-toggle:px-2.5",
                isSelected
                  ? "border-mode-toggle-selected bg-background-mode-toggle-selected text-mode-toggle-primary shadow-mode-toggle-selected"
                  : "border-transparent text-mode-toggle-inactive hover:text-mode-toggle-primary focus-visible:text-mode-toggle-primary",
              ],
              variant === "viewer" && "h-full px-2.5",
              buttonClassName,
            )}
            onClick={() => onSelect?.(option.id)}
            aria-pressed={isSelected}
          >
            {variant === "form" ? <span className="relative z-20">{option.label}</span> : option.label}
          </Button>
        );
        return option.tooltipContent ? (
          <Tooltip key={option.id} tooltipContent={option.tooltipContent}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
