import clsx from "clsx";
import { Spinner } from "./spinner";

const css = {
  delayedIndicator: "_delayedIndicator_ovcb0_1",
  reveal: "_reveal_ovcb0_33",
  delayedBlossom: "_delayedBlossom_ovcb0_16",
  fadeIn: "_fadeIn_ovcb0_33",
} as const;

export interface LoadingPageProps {
  overlay?: boolean;
  fillParent?: boolean;
  /** Reveals the spinner after a short delay so fast loads show nothing. */
  delay?: boolean;
  debugName?: string;
}

/** `Zqt`: a centered page spinner (`page` variant; the startup `blossom` variant is not ported). */
export function LoadingPage({ overlay = false, fillParent = false, delay = true }: LoadingPageProps) {
  return (
    <div
      role="presentation"
      className={clsx(
        "flex items-center justify-center",
        overlay ? "absolute inset-0 z-10 bg-surface-secondary/70" : fillParent ? "absolute inset-0 bg-transparent" : "relative size-full bg-transparent",
      )}
    >
      {overlay || fillParent ? null : <div className="absolute inset-x-0 top-0 draggable electron:h-toolbar extension:h-toolbar-sm" />}
      <div className={clsx("flex flex-col items-center gap-2", delay && css.delayedIndicator)}>
        <Spinner className="icon-lg text-secondary" />
      </div>
    </div>
  );
}
