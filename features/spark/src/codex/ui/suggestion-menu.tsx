import clsx from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, Ref } from "react";
import { menuClasses, menuContentWidthClassName, menuSurfaceClassName, type MenuContentWidth } from "./menu";

export interface SuggestionSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
  /** Inner padding of the default (composer-docked) surface. */
  padded?: boolean;
  variant?: "default" | "floating";
  width?: MenuContentWidth;
}

/** Surface of composer and editor suggestion menus (`zEc` in app-initial). */
export function SuggestionSurface({ className, padded = true, variant = "default", width, ...rest }: SuggestionSurfaceProps) {
  return (
    <div
      className={clsx(
        "flex flex-col overflow-hidden",
        variant === "floating"
          ? ["select-none", menuSurfaceClassName("menu")]
          : [
              "border-default bg-surface-elevated-secondary relative w-full rounded-[var(--radius-suggestion-menu,var(--radius-2xl))] border-(length:--suggestion-menu-border-width,1px) shadow-(--suggestion-menu-shadow,none) text-sm",
              padded && menuClasses.suggestionMenu,
            ],
        menuContentWidthClassName(width),
        className,
      )}
      {...rest}
    />
  );
}

export interface SuggestionMenuRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  highlighted?: boolean;
}

/** One row of a suggestion menu (`BEc` in app-initial). */
export function SuggestionMenuRow({ className, highlighted, ...rest }: SuggestionMenuRowProps) {
  return (
    <button
      className={clsx(
        "text-default outline-hidden focus:bg-primary-ghost-hover cursor-interaction flex w-full min-h-[var(--app-menu-item-height,0px)] shrink-0 items-center overflow-hidden rounded-[var(--suggestion-menu-item-radius,var(--radius-xl))] p-[var(--suggestion-menu-item-padding,var(--app-menu-item-padding,var(--padding-row-y)_var(--padding-row-x)))] text-start text-sm",
        "[content-visibility:auto] [contain-intrinsic-block-size:auto_1lh]",
        highlighted ? "bg-primary-ghost-hover opacity-100" : "menu-row-opacity",
        className,
      )}
      type="button"
      {...rest}
    />
  );
}
