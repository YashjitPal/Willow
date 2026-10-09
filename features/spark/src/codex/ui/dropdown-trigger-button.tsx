import clsx from "clsx";
import type { ReactNode } from "react";
import { LegacySharedGxiDba3Icon } from "../icons/legacy-shared-gxi-dba3";
import { Button, type ButtonProps } from "./button";

export type DropdownTriggerButtonProps = Omit<Extract<ButtonProps, { as?: "button" }>, "as"> & {
  contentClassName?: string;
  chevronClassName?: string;
  leadingVisual?: ReactNode;
};

/** Button that opens a settings dropdown, with a trailing chevron (`HD` in app-initial). */
export function DropdownTriggerButton({
  children,
  className,
  contentClassName,
  chevronClassName,
  leadingVisual,
  color = "outline",
  size = "toolbar",
  ...rest
}: DropdownTriggerButtonProps) {
  return (
    <Button
      color={color}
      size={size}
      className={clsx(
        "max-w-full justify-between",
        size === "toolbar" && (leadingVisual == null ? "px-3" : "pe-3 ps-[calc((var(--spacing-token-button-composer)-var(--spacing)*5)/2-1px)]"),
        className,
      )}
      {...rest}
    >
      <span className={clsx("flex min-w-0 flex-1 items-center gap-1.5", contentClassName)}>
        {leadingVisual}
        {children}
      </span>
      <LegacySharedGxiDba3Icon className={clsx("icon-2xs shrink-0 text-tertiary", chevronClassName)} />
    </Button>
  );
}
