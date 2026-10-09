import clsx from "clsx";
import type { ReactNode } from "react";
import { createQrModules } from "./qr-code-encoder";

export interface QrCodeProps {
  value: string;
  ariaLabel?: string;
  size?: "default" | "compact";
  children?: ReactNode;
  fallback?: ReactNode;
}

/**
 * `S` in app-initial. The original's `portrait` variant (rounded modules shaped around the dot's portrait) is not
 * reproduced.
 */
export function QrCode({ value, ariaLabel, size = "default", children, fallback }: QrCodeProps) {
  let modules;
  try {
    modules = createQrModules(value, { errorCorrectionLevel: "M" });
  } catch {
    return fallback;
  }
  const viewBoxSize = modules.size + 8;
  const path = modules.data
    .flatMap((dark, index) => {
      if (!dark) return [];
      const x = (index % modules.size) + 4;
      const y = Math.floor(index / modules.size) + 4;
      return [`M${x},${y}h1v1h-1z`];
    })
    .join("");

  return (
    <div className="flex flex-col items-center gap-3">
      <div className={clsx("max-w-full shrink-0 self-center", size === "compact" ? "size-40" : "size-60")} data-dd-privacy="hidden">
        <svg
          className="size-full rounded-xl"
          aria-label={ariaLabel}
          data-dd-privacy="hidden"
          focusable="false"
          role="img"
          shapeRendering="crispEdges"
          viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        >
          <rect width={viewBoxSize} height={viewBoxSize} fill="white" />
          <path d={path} fill="black" />
        </svg>
      </div>
      {children}
    </div>
  );
}
