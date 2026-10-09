import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";

const css = { daybreak: "_daybreak_vyuj8_1" } as const;

/** Divider recipes for settings rows (`Dy` / `Oy` in app-shared). */
export const settingsRowDividers = {
  inset:
    "flex flex-col [&>*:not(:last-child)]:relative [&>*:not(:last-child)]:after:pointer-events-none [&>*:not(:last-child)]:after:absolute [&>*:not(:last-child)]:after:inset-x-4 [&>*:not(:last-child)]:after:bottom-0 [&>*:not(:last-child)]:after:h-px [&>*:not(:last-child)]:after:bg-border [&>*:not(:last-child)]:after:content-['']",
  flush: "flex flex-col [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-border",
} as const;

export type SettingsGroupVariant = "default" | "flat" | "recommendation" | "metered" | "secondary" | "muted" | "form" | "outlined" | "input";

export interface SettingsGroupProps {
  children?: ReactNode;
  className?: string;
  contentOverflow?: "hidden" | "visible";
  dividers?: boolean;
  variant?: SettingsGroupVariant;
  decoration?: "daybreak";
}

/** Rounded group of settings rows (`Ty` / `nki` in app-shared). */
export function SettingsGroup({ children, className, contentOverflow = "hidden", dividers = true, variant = "default", decoration }: SettingsGroupProps) {
  const style: CSSProperties | undefined =
    variant === "default" || variant === "metered" ? { backgroundColor: "var(--color-background-panel, var(--color-background-primary-soft-alpha))" } : undefined;
  return (
    <div
      className={clsx(
        "ws-settings-group",
        `ws-settings-group--${variant}`,
        dividers ? (variant === "flat" ? settingsRowDividers.flush : settingsRowDividers.inset) : "flex flex-col",
        variant === "recommendation" && "rounded-[20px]",
        variant !== "recommendation" && variant !== "flat" && "rounded-2xl",
        decoration === "daybreak" && css.daybreak,
        contentOverflow === "visible" ? "overflow-visible" : "overflow-hidden",
        variant === "default" &&
          "border border-default group-data-[density=compact]/settings:border-0 group-data-[density=compact]/settings:py-1 group-data-[density=compact]/settings:ring-1 group-data-[density=compact]/settings:ring-inset group-data-[density=compact]/settings:ring-border",
        variant === "metered" && "ring-1 ring-inset ring-border-subtle",
        variant === "secondary" && "bg-surface-secondary/92",
        variant === "muted" && "bg-(--color-background-primary-soft-alpha)/50 dark:bg-primary-soft-alpha",
        variant === "form" &&
          "border border-subtle bg-surface dark:bg-surface-secondary/92 group-data-[density=form]/settings:border-default group-data-[density=form]/settings:bg-transparent dark:group-data-[density=form]/settings:bg-transparent group-data-[density=form]/settings:[&>*:not(:last-child)]:after:inset-x-5 group-data-[density=form]/settings:[&>*:not(:last-child)]:after:h-px group-data-[density=form]/settings:[&>*:not(:last-child)]:after:bg-border-subtle",
        variant === "outlined" && "border border-subtle bg-transparent",
        variant === "flat" &&
          "relative bg-transparent before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-border before:content-[''] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border after:content-['']",
        variant === "input" && "border border-primary-outline bg-primary-soft",
        variant === "recommendation" && "border border-default bg-secondary-soft dark:bg-transparent",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
