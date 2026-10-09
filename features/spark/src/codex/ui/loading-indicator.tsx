import clsx from "clsx";
import type { CSSProperties, HTMLAttributes } from "react";

const css = { LoadingIndicator: "_LoadingIndicator_mlrw0_1" } as const;

export interface LoadingIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  /** Diameter; numbers are pixels. */
  size?: number | string;
  /** Ring thickness; numbers are pixels. */
  strokeWidth?: number | string;
}

/** Maps `{ name: value }` to `--name` custom properties, skipping empty values (`WSe` in the bundles). */
function cssVariables(values: Record<string, number | string | undefined>): CSSProperties {
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!value && value !== 0) continue;
    style[`${key.startsWith("--") ? "" : "--"}${key}`] = typeof value === "number" ? `${value}px` : value;
  }
  return style as CSSProperties;
}

/** Design-system ring spinner (`oCe` in app-shared), animated by the `_LoadingIndicator_mlrw0_1` CSS module. */
export function LoadingIndicator({ className, size, strokeWidth, style, ...rest }: LoadingIndicatorProps) {
  return (
    <div
      {...rest}
      className={clsx(css.LoadingIndicator, className)}
      style={style || cssVariables({ "indicator-size": size, "indicator-stroke": strokeWidth })}
    />
  );
}
