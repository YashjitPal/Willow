import clsx from "clsx";
import type { ReactNode } from "react";
import { ListRow } from "./list-row";

export type LoadingRowsDensity = "default" | "compact" | "row" | "sidebar";

export interface LoadingRowsProps {
  density?: LoadingRowsDensity;
  icon?: ReactNode;
  loadingLabel?: ReactNode;
  rowCount?: number;
}

const placeholderRows = [
  { key: "first", secondLineWidth: "w-1/2", titleWidth: "w-2/3" },
  { key: "second", secondLineWidth: "w-2/5", titleWidth: "w-1/2" },
  { key: "third", secondLineWidth: "w-3/5", titleWidth: "w-3/4" },
  { key: "fourth", secondLineWidth: "w-1/3", titleWidth: "w-5/12" },
  { key: "fifth", secondLineWidth: "w-1/2", titleWidth: "w-7/12" },
];

/** `Y7` (`UX1Component`): pulsing placeholder rows with a screen-reader status. */
export function LoadingRows({ density = "default", icon, loadingLabel, rowCount }: LoadingRowsProps) {
  const rows = placeholderRows.slice(0, rowCount ?? 5).map((row) => {
    if (density === "row") {
      return (
        <div key={row.key} aria-hidden>
          <ListRow
            density="row"
            icon={icon}
            compactSecondLine
            title={<span className="inline-block h-4 w-32 rounded bg-text/10 motion-safe:animate-pulse" />}
            secondLine={<span className="inline-block h-3 w-24 rounded bg-text/10 motion-safe:animate-pulse" />}
            isSelected={false}
            hasInteractiveContent
            buttonProps={{ disabled: true }}
          />
        </div>
      );
    }
    return (
      <div
        key={row.key}
        aria-hidden
        className={clsx(
          "flex w-full gap-2 motion-safe:animate-pulse",
          density === "sidebar" ? "h-[var(--height-token-row)] items-center px-[var(--padding-row-cell-x,var(--padding-row-x))]" : "min-h-10 px-3",
          density === "compact" && "items-center rounded-xl py-2.5",
          density === "default" && "items-start rounded-lg py-3",
        )}
      >
        {icon ?? (density === "compact" ? null : <div className={clsx("shrink-0 rounded-full bg-text/10", density === "sidebar" ? "size-4" : "size-5")} />)}
        <div className={clsx("flex min-w-0 flex-1 flex-col", density === "compact" && "gap-0", density === "sidebar" && "gap-1.5", density === "default" && "gap-2")}>
          <div className={clsx("flex min-w-0 items-center gap-3", density === "compact" && "h-6")}>
            <div className={clsx("h-4 max-w-full rounded bg-text/10", row.titleWidth)} />
            {density === "default" ? <div className="ms-auto h-3 w-12 shrink-0 rounded bg-text/10" /> : null}
          </div>
          {density === "sidebar" ? null : (
            <div className={clsx("flex items-center", density === "compact" && "h-4")}>
              <div className={clsx("h-3 max-w-full rounded bg-text/10", row.secondLineWidth)} />
            </div>
          )}
        </div>
      </div>
    );
  });
  return (
    <div role="status">
      <span className="sr-only">{loadingLabel}</span>
      {density === "sidebar" ? (
        // `uH` (`NavList`, `itemSpacing="default"`), which lives in the shell.
        <div
          data-appearance="plain"
          className="group/nav-list flex flex-col gap-px browser:not-empty:pb-px browser:[--nav-item-height:calc(var(--height-token-row)-1px)]"
        >
          {rows}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">{rows}</div>
      )}
    </div>
  );
}
