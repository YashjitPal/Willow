import clsx from "clsx";
import type { ReactNode, Ref } from "react";
import { normalizeProjectIcon, resolveProjectColor } from "./project-appearance";
import { ProjectIcon, type ProjectIconSize } from "./project-icon";
import { useIsDarkTheme } from "./use-is-dark-theme";

export type SymbolTileVariant = "default" | "roundrect" | "avatar";

export interface SymbolTileProps {
  className?: string;
  /** Stored theme: a color name or CSS color. */
  color?: string | null;
  defaultColor?: "primary" | "secondary";
  /** Shown when `icon` is not a catalog icon. */
  defaultIcon?: ReactNode;
  /** Replaces the folder icon (and a missing icon when there is no `defaultIcon`). */
  fallbackIcon?: ReactNode;
  /** A stored icon id; anything else falls back. */
  icon?: string | null;
  ref?: Ref<HTMLSpanElement>;
  /** Shown instead of `defaultIcon` when `icon` is not a catalog icon. */
  sharedIcon?: ReactNode;
  size?: ProjectIconSize;
  variant?: SymbolTileVariant;
}

/** `J$t` (`YLComponent`): a project or Space icon tinted with its color, or a default icon. */
export function SymbolTile({ className, color, defaultColor = "primary", defaultIcon, fallbackIcon, icon, ref, size, sharedIcon, variant = "default" }: SymbolTileProps) {
  const resolvedColor = resolveProjectColor(color, useIsDarkTheme() ? "dark" : "light");
  const catalogIcon = normalizeProjectIcon(icon);
  let content: ReactNode = (
    <ProjectIcon className={size == null && variant !== "avatar" ? className : undefined} icon={catalogIcon ?? "folder"} size={variant === "avatar" ? 20 : size} />
  );
  if (catalogIcon == null && sharedIcon != null) content = sharedIcon;
  else if (catalogIcon == null && defaultIcon != null) content = defaultIcon;
  else if (fallbackIcon != null && (catalogIcon == null || catalogIcon === "folder")) content = fallbackIcon;
  return (
    <span
      ref={ref}
      className={clsx(
        "ws-symbol-tile inline-flex shrink-0 items-center justify-center",
        defaultColor === "secondary" ? "text-secondary" : "text-codex-icon",
        size != null && className,
        variant === "roundrect" && "size-5 rounded-md text-current",
        variant === "avatar" && "size-8 rounded-lg text-current",
        (variant === "roundrect" || variant === "avatar") && (resolvedColor == null ? "bg-text/5" : "bg-current/15"),
      )}
      style={{ color: resolvedColor ?? undefined }}
    >
      {content}
    </span>
  );
}
