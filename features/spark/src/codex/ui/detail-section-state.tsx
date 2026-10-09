import clsx from "clsx";
import type { HTMLAttributes } from "react";

export interface DetailSectionStateProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "secondary" | "danger";
}

/** `t` in detail-section-state: a row-height loading, empty or error line inside a detail section. */
export function DetailSectionState({ children, className, tone = "secondary", ...rest }: DetailSectionStateProps) {
  return (
    <div
      className={clsx(
        "flex min-h-[var(--height-token-row)] items-center justify-center gap-2 py-row-y text-[length:var(--detail-row-font-size,var(--text-base))] leading-5",
        tone === "danger" ? "text-chart-red" : "text-tertiary",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
