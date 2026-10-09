import clsx from "clsx";
import type { AriaAttributes, AriaRole, ButtonHTMLAttributes, KeyboardEvent, MouseEvent, MouseEventHandler, ReactNode } from "react";

const css = {
  row: "_row_sm7xw_2",
  divider: "_divider_sm7xw_2",
  selected: "_selected_sm7xw_2",
  disabled: "_disabled_sm7xw_2",
} as const;

export type ListRowSelectEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;

export interface ListRowProps {
  ariaCurrent?: AriaAttributes["aria-current"];
  ariaDescribedBy?: string;
  ariaLabel?: string;
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  children?: ReactNode;
  className?: string;
  compactSecondLine?: boolean;
  density?: "default" | "compact" | "row";
  hasInteractiveContent?: boolean;
  icon?: ReactNode;
  isDisabled?: boolean;
  isSelected?: boolean;
  onSelect?: (event: ListRowSelectEvent) => void;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  rightText?: ReactNode;
  rightTextPosition?: "top" | "center";
  role?: AriaRole;
  secondaryTitle?: ReactNode;
  secondLine?: ReactNode;
  secondLineRightText?: ReactNode;
  showDivider?: boolean;
  surface?: "plain" | "raised";
  tone?: "default" | "muted";
  title?: ReactNode;
  titleAdornment?: ReactNode;
  titleWrap?: boolean;
}

function selectableRowProps(onSelect: ListRowProps["onSelect"]) {
  const inert = onSelect == null;
  return {
    role: "button" as AriaRole,
    tabIndex: inert ? -1 : 0,
    "aria-disabled": inert,
    onClick: (event: MouseEvent<HTMLDivElement>) => {
      if (inert || event.defaultPrevented) return;
      if (event.target instanceof Node && event.currentTarget.contains(event.target)) onSelect?.(event);
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (inert || event.defaultPrevented) return;
      if (event.currentTarget === event.target && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        onSelect?.(event);
      }
    },
  };
}

/** Selectable list row (`Z7` in the bundles); the router-link `to` variant is not cloned. */
export function ListRow({
  ariaCurrent,
  ariaDescribedBy,
  ariaLabel,
  buttonProps,
  children,
  className,
  compactSecondLine = false,
  density = "default",
  hasInteractiveContent = false,
  icon,
  isDisabled = false,
  isSelected,
  onSelect,
  onContextMenu,
  rightText,
  rightTextPosition = "top",
  role,
  secondaryTitle,
  secondLine,
  secondLineRightText,
  showDivider,
  surface = "plain",
  tone = "default",
  title,
  titleAdornment,
  titleWrap = false,
}: ListRowProps) {
  const dense = density !== "default";
  const divider = showDivider ?? surface === "plain";
  const selectable = selectableRowProps(onSelect);
  const centeredRightText = rightText != null && rightTextPosition === "center";

  const body = children ?? (
    <div className={clsx("relative flex min-w-0 gap-2", dense && !titleWrap ? "items-center" : "items-start", centeredRightText ? "pe-16" : null)}>
      {icon && <span className={clsx("flex min-w-4 shrink-0 items-center justify-center", dense ? "min-h-5" : "min-h-6")}>{icon}</span>}
      <div className={clsx("flex min-w-0 flex-1 flex-col", compactSecondLine ? "gap-0" : dense ? "gap-0.5" : "gap-1")}>
        <div
          className={clsx(
            "flex min-w-0 gap-3",
            dense && !titleWrap && (density === "row" || !secondLine) && "items-center",
            (titleWrap || (density === "compact" && !!secondLine)) && "items-start",
            !dense && !titleWrap && "items-baseline",
          )}
        >
          <div className={clsx("flex min-w-0 flex-1 items-baseline gap-2", dense && titleWrap ? "text-sm leading-5" : "text-base leading-6")}>
            <span className={clsx("min-w-0", titleWrap ? "wrap-anywhere" : "truncate", tone === "default" && "text-default")}>{title}</span>
            {secondaryTitle == null ? null : <span className="max-w-48 shrink-0 truncate text-codex-description">{secondaryTitle}</span>}
            {titleAdornment == null ? null : <span className="flex min-w-0 shrink self-center">{titleAdornment}</span>}
          </div>
          {rightText != null && !centeredRightText ? (
            <div className={clsx("flex shrink-0 items-center text-codex-description", dense ? "min-h-5 text-xs" : "min-h-6 text-base")}>{rightText}</div>
          ) : null}
        </div>
        {secondLine && (
          <div
            className={clsx(
              "flex min-w-0 items-center justify-between text-codex-description",
              dense ? "gap-2 text-xs" : "gap-3 text-sm",
              dense || compactSecondLine ? "leading-4" : "leading-[22px]",
            )}
          >
            <div className="min-w-0 flex-1">{secondLine}</div>
            {secondLineRightText && <div className={clsx("flex shrink-0 items-center", dense ? "min-h-4" : "min-h-[22px]")}>{secondLineRightText}</div>}
          </div>
        )}
      </div>
      {centeredRightText ? (
        <div className="absolute top-1/2 right-0 flex min-h-6 -translate-y-1/2 items-center text-base text-codex-description">{rightText}</div>
      ) : null}
    </div>
  );

  const rowClassName = clsx(
    "ws-row",
    surface === "raised" ? "ws-row--raised" : "ws-row--plain",
    dense && "ws-row--dense",
    isSelected && "is-selected",
    "group w-full text-start text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
    css.row,
    divider && css.divider,
    isSelected && css.selected,
    isDisabled && css.disabled,
    tone === "muted" && (isSelected ? "text-default" : "text-secondary"),
    tone === "muted" && !isDisabled && "hover:text-default focus-within:text-default",
    density === "row"
      ? "min-h-[var(--height-token-row)] px-[var(--padding-row-cell-x,var(--padding-row-x))] py-row-y"
      : ["min-h-10 px-3", dense ? "py-2.5" : "py-3"],
    surface === "raised" && "rounded-2xl",
    surface === "plain" && (dense ? "rounded-xl" : "rounded-lg"),
    surface === "raised" && "border border-subtle shadow-card",
    surface === "raised" && !isDisabled && !isSelected && "hover:border-strong",
    surface === "raised" && !isSelected && "bg-surface-elevated/60",
    isDisabled ? "cursor-default opacity-50" : isSelected ? "cursor-interaction bg-primary-soft-active" : "cursor-interaction",
    surface === "plain" && !isDisabled && !isSelected && "hover:bg-primary-ghost-hover",
    className,
  );

  if (hasInteractiveContent && role !== "row") {
    const overlayClassName = clsx(
      "absolute inset-0 cursor-interaction outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-default",
      surface === "raised" ? "rounded-2xl" : "rounded-lg",
    );
    return (
      <div className={clsx("relative", rowClassName)} onContextMenu={onContextMenu}>
        <button
          aria-current={ariaCurrent}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          type="button"
          disabled={isDisabled}
          onClick={onSelect}
          {...buttonProps}
          className={clsx(overlayClassName, buttonProps?.className)}
        />
        <div className="pointer-events-none relative">{body}</div>
      </div>
    );
  }

  const rowProps = { "aria-disabled": isDisabled, ...(isDisabled ? {} : selectable) };
  return (
    <div
      aria-current={ariaCurrent}
      aria-describedby={ariaDescribedBy}
      aria-label={ariaLabel}
      {...rowProps}
      className={rowClassName}
      onContextMenu={onContextMenu}
      role={role ?? selectable.role}
      aria-selected={role === "row" ? isSelected : undefined}
    >
      {body}
    </div>
  );
}
