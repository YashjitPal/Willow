import clsx from "clsx";
import type { ReactNode } from "react";

export type KbdVariant = "default" | "tooltip" | "tooltipInline" | "button";

export interface KbdProps {
  keysLabel: ReactNode;
  variant?: KbdVariant;
  className?: string;
}

/** Keyboard shortcut chip (tooltips, menu items, buttons). */
export function Kbd({ keysLabel, variant = "default", className }: KbdProps) {
  return (
    <kbd
      className={clsx(
        "inline-flex !border-0 !font-sans !shadow-none",
        variant === "tooltip" || variant === "tooltipInline"
          ? "h-4.5 min-w-4 items-center justify-center rounded-lg !bg-[var(--color-background-tooltip-shortcut)] !px-1.5 !py-0 !text-sm !leading-4.5 !text-[var(--color-text-tooltip-shortcut)]"
          : "!rounded-md !bg-current/10 !text-xs !text-current",
        variant === "tooltip" && "-me-1.75",
        variant === "button" ? "h-4 min-w-4 items-center justify-center !px-1.5 !py-0 !leading-4" : variant === "default" && "!px-1.5 !py-0.5 !leading-none",
        className,
      )}
    >
      {keysLabel}
    </kbd>
  );
}
