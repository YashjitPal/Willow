import clsx from "clsx";
import type { HTMLAttributes } from "react";

const css = { Placeholder: "_Placeholder_1mjbn_2", pulse: "_pulse_1mjbn_2" } as const;

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  animate?: boolean;
  variant?: "default" | "solid" | "prominent";
}

/** `Jf` in app-initial. */
export function Skeleton({ animate = true, variant = "default", className, ...rest }: SkeletonProps) {
  return (
    <div
      className={clsx(
        css.Placeholder,
        variant === "solid" && "bg-surface-secondary",
        variant === "prominent" && "bg-text/10",
        variant === "prominent" && animate && "motion-safe:animate-pulse",
        className,
      )}
      data-animate={variant === "default" && animate ? true : undefined}
      {...rest}
    />
  );
}
