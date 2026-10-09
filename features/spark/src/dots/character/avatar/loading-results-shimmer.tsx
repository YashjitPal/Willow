import clsx from "clsx";
import type { CSSProperties, ElementType } from "react";
import { useReducedMotion } from "../../lib/reduced-motion";

const css = { loadingResultsShimmer: "_LoadingResultsShimmer_ps6cr_2" } as const;

export interface LoadingResultsShimmerProps {
  className?: string;
  animate?: boolean;
  as?: ElementType;
  delayMs?: number;
  size?: "sm" | "md" | "fill";
  variant?: string;
  widthPercent?: number;
}

/** Shimmering placeholder bar (`KS1`, exported from app-initial as `WFn`). */
export function LoadingResultsShimmer({ className, animate = true, as: Element = "div", delayMs, size = "md", variant, widthPercent }: LoadingResultsShimmerProps) {
  const reducedMotion = useReducedMotion();
  const style = {
    width: widthPercent == null ? undefined : `${Math.max(1, Math.min(100, widthPercent))}%`,
    "--loading-results-shimmer-delay": delayMs == null ? undefined : `${delayMs}ms`,
  } as CSSProperties;
  return (
    <Element
      className={clsx(css.loadingResultsShimmer, className)}
      aria-hidden
      data-reduced-motion={!animate || reducedMotion || undefined}
      data-size={size}
      data-variant={variant}
      style={style}
    />
  );
}
