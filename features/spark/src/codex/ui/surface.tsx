import clsx from "clsx";
import { cloneElement, type HTMLAttributes, type ReactElement, type Ref } from "react";

const css = {
  floatingSurface: "_floatingSurface_1bdwx_1",
  singleLineSurface: "_singleLineSurface_1bdwx_10",
  canvasSurface: "_canvasSurface_1bdwx_16",
  composerRadius: "_composerRadius_1bdwx_20",
} as const;

export type SurfaceVariant = "default" | "single-line" | "notice" | "canvas" | "island";

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  radius?: "composer";
  unstyled?: boolean;
  variant?: SurfaceVariant;
  ref?: Ref<HTMLDivElement>;
}

export function Surface({ asChild, children, className, radius, unstyled = false, variant = "default", ...rest }: SurfaceProps) {
  const surfaceClassName = clsx(
    !unstyled &&
      (variant === "island"
        ? [
            radius !== "composer" && "rounded-2xl",
            "bg-surface-elevated-secondary electron:elevation-prominent extension:border extension:border-default extension:shadow-md",
          ]
        : [
            css.floatingSurface,
            (variant === "single-line" || variant === "notice") && css.singleLineSurface,
            variant === "canvas" && css.canvasSurface,
            variant === "canvas" ? "bg-surface-canvas" : "bg-surface-elevated-secondary",
            "ring-[0.5px] ring-border",
            variant === "notice" ? "shadow-[0_0_2px_0_rgb(0_0_0/5%),0_4px_6px_0_rgb(0_0_0/2%)]" : "shadow-2xl",
          ]),
    !unstyled && radius === "composer" && css.composerRadius,
    className,
  );
  if (asChild) {
    const child = children as ReactElement<{ className?: string }>;
    return cloneElement(child, { className: clsx(surfaceClassName, child.props.className) });
  }
  return (
    <div className={surfaceClassName} {...rest}>
      {children}
    </div>
  );
}
