import clsx from "clsx";
import { createContext, useContext, useEffect, useRef, type HTMLAttributes } from "react";

const css = {
  cadencedShimmer: "_cadencedShimmer_wne66_2",
  cadencedShimmerHighlight: "_cadencedShimmerHighlight_wne66_30",
  cadencedShimmerSweep: "_cadencedShimmerSweep_wne66_35",
  cadencedShimmerActive: "_cadencedShimmerActive_wne66_71",
} as const;

const sweepMs = 1000;
const cadenceMs = 4000;
const firstSweepDelayMs = 600;

/** Turns shimmering text off for a subtree (`yVs`). */
export const ShimmerTextContext = createContext(true);

export interface ShimmerTextProps extends HTMLAttributes<HTMLSpanElement> {
  active?: boolean;
}

/** `vC`: text with a periodic highlight sweep while something is in progress. */
export function ShimmerText({ active = true, className, children, ...rest }: ShimmerTextProps) {
  const enabled = useContext(ShimmerTextContext);
  if (!active || !enabled) {
    return (
      <span className={className} {...rest}>
        {children}
      </span>
    );
  }
  return (
    <CadencedShimmer className={className} {...rest}>
      {children}
    </CadencedShimmer>
  );
}

/** `KVs1Component`. */
function CadencedShimmer({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const element = ref.current;
    if (element == null) return;
    let sweepEnd: number | undefined;
    const clearSweep = () => {
      if (sweepEnd == null) return;
      window.clearTimeout(sweepEnd);
      sweepEnd = undefined;
    };
    const sweep = () => {
      clearSweep();
      element.classList.remove(css.cadencedShimmerActive);
      element.classList.add(css.cadencedShimmerActive);
      sweepEnd = window.setTimeout(() => {
        element.classList.remove(css.cadencedShimmerActive);
        sweepEnd = undefined;
      }, sweepMs);
    };
    let interval: number | undefined;
    const start = window.setTimeout(() => {
      sweep();
      interval = window.setInterval(sweep, cadenceMs);
    }, firstSweepDelayMs);
    return () => {
      clearSweep();
      window.clearTimeout(start);
      if (interval != null) window.clearInterval(interval);
      element.classList.remove(css.cadencedShimmerActive);
    };
  }, []);

  return (
    <span ref={ref} className={clsx("relative inline-block align-top", css.cadencedShimmer, className)} {...rest}>
      {children}
      <span aria-hidden className={css.cadencedShimmerSweep}>
        <span className={css.cadencedShimmerHighlight}>{children}</span>
      </span>
    </span>
  );
}
