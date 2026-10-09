import clsx from "clsx";
import type { FocusEventHandler, MouseEventHandler, PointerEventHandler, ReactNode, Ref } from "react";
import { SettingsRowLabel } from "./settings-row";

export interface SettingsButtonRowProps {
  ref?: Ref<HTMLButtonElement>;
  actions?: ReactNode;
  ariaLabel?: string;
  className?: string;
  description?: ReactNode;
  disabled?: boolean;
  edgeRounding?: "row" | "surface";
  icon?: ReactNode;
  label?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
  onPointerEnter?: PointerEventHandler<HTMLButtonElement>;
  trailing?: ReactNode;
  variant?: "default" | "recommendation" | "nested" | "empty";
}

/** Settings row that is one button, e.g. a link to a sub-page (`Ay` / `GOi` in app-shared). */
export function SettingsButtonRow({
  ref,
  actions,
  ariaLabel,
  className,
  description,
  disabled,
  edgeRounding = "row",
  icon,
  label,
  onClick,
  onFocus,
  onPointerEnter,
  trailing,
  variant = "default",
}: SettingsButtonRowProps) {
  return (
    <div
      className={clsx(
        "group flex w-full items-center",
        edgeRounding === "row" && "first:rounded-t-2xl last:rounded-b-2xl",
        variant === "recommendation" && "dark:bg-primary-ghost-hover",
        !disabled && "hover:bg-primary-ghost-hover focus-within:bg-primary-ghost-hover",
        !disabled && variant === "recommendation" && "dark:hover:bg-background-secondary-soft-alpha dark:focus-within:bg-background-secondary-soft-alpha",
      )}
    >
      <button
        ref={ref}
        aria-label={ariaLabel}
        className={clsx(
          "flex min-w-0 flex-1 cursor-interaction items-center rounded-[inherit] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:cursor-default disabled:opacity-60",
          variant === "empty"
            ? "flex-col justify-center gap-4 px-6 py-10 text-center text-base text-tertiary select-none"
            : clsx("px-4 text-start", variant === "nested" ? "min-h-10 gap-3 py-0.5" : "gap-6 py-3"),
          className,
        )}
        disabled={disabled}
        onClick={onClick}
        onFocus={onFocus}
        onPointerEnter={onPointerEnter}
        type="button"
      >
        {variant === "empty" ? (
          <>
            {icon}
            {label}
          </>
        ) : (
          <SettingsRowLabel
            label={label}
            labelSizing="grow"
            labelWeight="medium"
            description={description}
            icon={icon}
            variant={variant}
            verticalAlignment="center"
          />
        )}
        {trailing == null ? null : <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
      </button>
      {!disabled && actions != null ? <div className="flex shrink-0 items-center gap-1 pe-4">{actions}</div> : null}
    </div>
  );
}
