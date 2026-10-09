import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

export type LibraryItemViewMode = "list" | "grid";

/** `a` in the library item `layout` chunk: an item as a row of the list's subgrid or as a bordered card. */
export function LibraryItemFrame({ className, viewMode, ...rest }: ComponentProps<"div"> & { viewMode: LibraryItemViewMode }) {
  return (
    <div
      className={clsx(
        "relative grid min-w-0 items-center overflow-hidden rounded-xl hover:bg-background-primary-ghost-hover/50",
        viewMode === "list" ? "col-span-full grid-cols-subgrid p-3" : "grid-rows-[auto_auto] border border-subtle bg-primary-soft-alpha",
        className,
      )}
      {...rest}
    />
  );
}

export interface LibraryItemThumbnailProps extends ComponentProps<"div"> {
  aspectRatio?: "square" | "landscape";
  viewMode: LibraryItemViewMode;
}

/** `i`: the thumbnail well of a row or card. */
export function LibraryItemThumbnail({ children, className, aspectRatio = "square", viewMode, ...rest }: LibraryItemThumbnailProps) {
  return (
    <div
      className={clsx(
        "relative shrink-0 overflow-hidden",
        viewMode === "list" ? "h-[50px] w-20" : "w-full",
        viewMode === "grid" && (aspectRatio === "landscape" ? "aspect-230/150" : "aspect-square"),
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** `o`: the item's name. */
export function LibraryItemTitle({ className, viewMode, ...rest }: ComponentProps<"div"> & { viewMode: LibraryItemViewMode }) {
  return <div className={clsx("truncate font-medium text-default", viewMode === "list" ? "text-sm leading-5" : "text-xs leading-[18px]", className)} {...rest} />;
}

/** `r`: the secondary line under the name. */
export function LibraryItemSubtitle({ className, ...rest }: ComponentProps<"div">) {
  return <div className={clsx("text-xs leading-[18px] text-secondary", className)} {...rest} />;
}

/** `n`: a card's footer, its details beside trailing actions. */
export function LibraryItemCardFooter({ actions, children }: { actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="pointer-events-none relative z-10 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center border-t border-subtle">
      {children}
      <div className="pointer-events-auto relative z-10 flex items-center gap-1 pe-2">{actions}</div>
    </div>
  );
}
