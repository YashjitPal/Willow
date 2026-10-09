import clsx from "clsx";
import type { ReactNode } from "react";

export interface StatusMessageProps {
  className?: string;
  align?: "center" | "start";
  layout?: "default" | "settings-row";
  children?: ReactNode;
}

/** Secondary-text status line used for empty, loading and unavailable states. */
export function StatusMessage({ className, align = "center", layout = "default", children }: StatusMessageProps) {
  return (
    <div
      className={clsx(
        "flex items-center px-4 text-sm text-secondary",
        layout === "settings-row" && "min-h-[var(--height-token-settings-row)]",
        align === "center" ? "justify-center text-center" : "justify-start text-start",
        className,
      )}
    >
      {children}
    </div>
  );
}
