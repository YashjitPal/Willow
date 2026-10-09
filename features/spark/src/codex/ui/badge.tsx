import clsx from "clsx";
import type { ReactNode, Ref } from "react";

const badgeVariantClasses = {
  unread:
    "h-3.75 min-w-3.75 shrink-0 justify-center rounded-unread-badge bg-info-solid px-0.5 text-unread-badge text-(--color-text-unread-badge) tabular-nums select-none",
  default: "bg-secondary-soft text-secondary-solid rounded-sm px-2 py-1 text-sm leading-none",
  info: "bg-text-info/10 text-info rounded-sm px-2 py-1 text-sm leading-none",
  outline: "rounded-sm border border-default bg-transparent px-2 py-1 text-xs leading-none font-medium text-secondary",
  outlinePill: "h-6 rounded-full border border-subtle px-2.5 text-xs leading-4 font-semibold text-secondary",
  neutral: "h-7 gap-1.5 rounded-full border border-default bg-surface-secondary px-2.5 text-sm leading-none font-medium whitespace-nowrap text-secondary",
  promotion: "min-h-6 rounded-full bg-chart-purple/10 px-2.5 text-sm leading-none font-medium whitespace-nowrap text-chart-purple",
  success: "min-h-5 rounded-full bg-chart-green/15 px-2 text-xs font-medium text-chart-green tabular-nums",
  warning: "min-h-5 rounded-full bg-warning-soft-alpha px-2 text-xs font-medium text-warning-surface",
  caution: "min-h-5 rounded-full bg-yellow/15 px-2 text-xs font-medium text-yellow light:text-default",
  danger: "min-h-5 rounded-full bg-danger-soft-alpha px-2 text-xs font-medium text-danger-surface",
  tip: "min-h-5 rounded-full bg-tip-soft px-2 text-xs leading-none font-medium text-tip",
  internal: "rounded-full bg-(--color-background-internal-badge) px-2.5 py-1 text-xs font-medium text-(--color-text-internal-badge)",
  reserve: "gap-1 rounded-full bg-chart-yellow/15 px-3 py-1 text-sm leading-5 font-semibold text-chart-yellow",
} as const;

export type BadgeVariant = keyof typeof badgeVariantClasses;

export interface BadgeProps {
  ref?: Ref<HTMLSpanElement>;
  children?: ReactNode;
  className?: string;
  variant?: BadgeVariant;
}

/** Inline status badge (`JFt` / `Kfi` in app-initial). */
export function Badge({ ref, children, className, variant = "default" }: BadgeProps) {
  return (
    <span ref={ref} className={clsx("inline-flex items-center", badgeVariantClasses[variant], className)}>
      {variant === "unread" ? <span className="text-cap-trim">{children}</span> : children}
    </span>
  );
}
