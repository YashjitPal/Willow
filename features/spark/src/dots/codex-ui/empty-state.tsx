import clsx from "clsx";
import type { ReactNode } from "react";

export type EmptyStateLayout = "default" | "page" | "browse" | "popover" | "withPreview";
export type EmptyStateIllustrationSize = "default" | "tile" | "icon" | "hero";

export interface EmptyStateProps {
  className?: string;
  contentClassName?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  illustration?: ReactNode;
  illustrationSize?: EmptyStateIllustrationSize;
  layout?: EmptyStateLayout;
  spacing?: "compact" | "default";
  tone?: "default" | "faded";
}

/** `Aqt`: a centered empty or status state with optional illustration and actions. */
export function EmptyState({
  className,
  contentClassName,
  title,
  description,
  actions,
  illustration,
  illustrationSize = "default",
  layout = "default",
  spacing = "compact",
  tone = "default",
}: EmptyStateProps) {
  const browse = layout === "browse";
  return (
    <div
      className={clsx(
        "w-full items-center px-3",
        browse ? "grid grid-rows-2 justify-items-center" : "flex flex-col justify-center",
        layout !== "withPreview" && "py-6",
        layout === "popover" && "min-h-80",
        (layout === "page" || browse) && "min-h-[var(--height-token-empty-state-page)] flex-1",
        layout === "withPreview" && "min-h-0 flex-none pt-8 pb-0 sm:pt-2",
        className,
      )}
    >
      <div
        className={clsx(
          "flex w-full max-w-xl flex-col items-center text-center",
          browse ? "row-start-2 self-start justify-start" : "justify-center",
          spacing === "compact" ? "gap-3" : "gap-4",
          tone === "faded" && "opacity-60",
          contentClassName,
        )}
      >
        {illustration || browse ? (
          <div
            className={clsx(
              "pointer-events-none flex items-center justify-center",
              browse && illustrationSize !== "tile" && "h-5",
              illustrationSize === "tile" && "size-12 shrink-0 rounded-xl bg-background-primary-soft-active text-default",
              illustrationSize === "icon" && "[&>svg]:size-8 [&>svg]:text-secondary",
              illustrationSize === "hero" && "relative h-32 w-[30rem] max-w-full overflow-visible",
            )}
          >
            {illustrationSize === "hero" ? (
              <div className="absolute top-1/2 left-1/2 size-[30rem] max-h-[55vh] max-w-full -translate-x-1/2 -translate-y-1/2">{illustration}</div>
            ) : (
              illustration
            )}
          </div>
        ) : null}
        {title != null || description != null ? (
          <div className="flex flex-col items-center gap-2">
            {title == null ? null : <div className="text-lg leading-6 font-medium text-default">{title}</div>}
            {description || browse ? <div className={clsx("text-sm text-secondary", browse && "min-h-10")}>{description}</div> : null}
          </div>
        ) : null}
        {actions ? <div className="flex w-full flex-wrap items-center justify-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
