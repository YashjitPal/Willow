import clsx from "clsx";
import { useSyncExternalStore, type CSSProperties, type ElementType } from "react";
import { seededRandom } from "./seeded-random";

const css = { LoadingResultsShimmer: "_LoadingResultsShimmer_ps6cr_2" } as const;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const LINE_DELAY_MS = 120;

export type LoadingShimmerSize = "sm" | "md" | "lg" | "fill";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => false);
}

function clampPercent(value: number) {
  return Math.max(1, Math.min(100, value));
}

export interface LoadingShimmerProps {
  className?: string;
  animate?: boolean;
  as?: ElementType;
  delayMs?: number;
  size?: LoadingShimmerSize;
  variant?: string;
  widthPercent?: number;
}

/** Placeholder bar (`WFn` / `KS1` in app-initial); `size="fill"` stretches to its container. */
export function LoadingShimmer({ className, animate = true, as: Component = "div", delayMs, size = "md", variant, widthPercent }: LoadingShimmerProps) {
  const reducedMotion = usePrefersReducedMotion();
  const style = {
    width: widthPercent == null ? undefined : `${clampPercent(widthPercent)}%`,
    "--loading-results-shimmer-delay": delayMs == null ? undefined : `${delayMs}ms`,
  } as CSSProperties;
  return (
    <Component
      className={clsx(css.LoadingResultsShimmer, className)}
      aria-hidden
      data-reduced-motion={!animate || reducedMotion || undefined}
      data-size={size}
      data-variant={variant}
      style={style}
    />
  );
}

function lineWidths({ count, maxWidth, minWidth, seed }: { count: number; maxWidth: number; minWidth: number; seed: string }) {
  const min = clampPercent(Math.min(minWidth, maxWidth));
  const max = clampPercent(Math.max(minWidth, maxWidth));
  const random = seededRandom(`${seed}:${count}:${min}:${max}`);
  return Array.from({ length: Math.max(0, count) }, () => min + random() * (max - min));
}

export interface LoadingShimmerLinesProps {
  className?: string;
  animate?: boolean;
  lineClassName?: string;
  lines?: number;
  maxWidth?: number;
  minWidth?: number;
  seed?: string;
  size?: LoadingShimmerSize;
  variant?: string;
}

/** Stack of shimmer bars with seeded widths (`GFn` / `OSComponent` in app-initial). */
export function LoadingShimmerLines({
  className,
  animate = true,
  lineClassName,
  lines = 3,
  maxWidth = 100,
  minWidth = 55,
  seed = "shimmer-lines",
  size = "md",
  variant,
}: LoadingShimmerLinesProps) {
  const widths = lineWidths({ count: lines, maxWidth, minWidth, seed });
  return (
    <div className={clsx("flex w-full flex-col items-start gap-2", className)}>
      {widths.map((widthPercent, index) => (
        <LoadingShimmer
          key={index}
          className={lineClassName}
          animate={animate}
          delayMs={-index * LINE_DELAY_MS}
          size={size}
          variant={variant}
          widthPercent={widthPercent}
        />
      ))}
    </div>
  );
}
