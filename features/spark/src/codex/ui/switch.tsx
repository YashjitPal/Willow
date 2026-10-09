import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";
import { SwitchIndicator, type SwitchIndicatorProps } from "./switch-indicator";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  size?: SwitchIndicatorProps["size"];
  tone?: SwitchIndicatorProps["tone"];
  trackClassName?: string;
  thumbClassName?: string;
}

/** `mC`: a toggle switch button around `SwitchIndicator`. */
export function Switch({
  checked,
  onChange,
  disabled = false,
  className,
  id,
  ariaLabel,
  size = "default",
  tone = "accent",
  trackClassName,
  thumbClassName,
  onClick,
  ...rest
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      id={id}
      className={clsx(
        "inline-flex items-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-full",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-interaction",
        className,
      )}
      data-state={checked ? "checked" : "unchecked"}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) onChange(!checked);
      }}
      disabled={disabled}
    >
      <SwitchIndicator checked={checked} size={size} tone={tone} trackClassName={trackClassName} thumbClassName={thumbClassName} />
    </button>
  );
}
