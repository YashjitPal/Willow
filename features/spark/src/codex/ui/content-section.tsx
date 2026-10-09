import clsx from "clsx";
import type { ReactNode, Ref } from "react";
import { Spinner } from "./spinner";

export interface ContentSectionProps {
  actions?: ReactNode;
  ariaLabel?: string;
  children?: ReactNode;
  /** Keeps the section at its content height instead of filling the page. */
  compact?: boolean;
  ref?: Ref<HTMLElement>;
  tabIndex?: number;
  title?: ReactNode;
}

/** `content-section` chunk `AComponent`: a Space collection section with an optional title row. */
export function ContentSection({ actions, ariaLabel, children, compact = false, ref, tabIndex, title }: ContentSectionProps) {
  return (
    <section ref={ref} aria-label={ariaLabel} className={clsx("ws-section flex min-h-0 flex-col gap-2", !compact && "flex-1")} tabIndex={tabIndex}>
      {title != null || actions != null ? (
        <div className="ws-section__header flex min-h-9 flex-wrap items-center justify-between gap-2">
          <h2 className="ws-section__title text-base font-medium">{title}</h2>
          <div className="ws-section__actions flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** `content-grid` chunk `RComponent`: responsive card grid for a Space collection. */
export function ContentGrid({ children }: { children?: ReactNode }) {
  return <div className="ws-content-grid grid grid-cols-1 gap-3 @md:grid-cols-2 @2xl:grid-cols-3">{children}</div>;
}

/** `layout` chunk `LComponent`: centered spinner while a Space collection loads. */
export function ContentLoading() {
  return (
    <div className="flex min-h-96 items-center justify-center">
      <Spinner />
    </div>
  );
}
