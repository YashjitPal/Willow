import clsx from "clsx";
import type { AnchorHTMLAttributes } from "react";

export type ExternalLinkAppearance = "default" | "secondary" | "inherit" | "source";
export type ExternalLinkUnderline = "always" | "hover" | "none";

export interface ExternalLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  appearance?: ExternalLinkAppearance;
  underline?: ExternalLinkUnderline;
}

/** `Bln`: a link that opens outside the app. */
export function ExternalLink({
  appearance = "default",
  underline = appearance === "secondary" ? "always" : undefined,
  className,
  children,
  ...rest
}: ExternalLinkProps) {
  return (
    <a
      {...rest}
      className={clsx(
        className,
        appearance === "secondary" && "text-secondary!",
        appearance === "inherit" &&
          "cursor-interaction rounded-xs text-inherit! underline-offset-4 hover:text-default! focus-visible:text-default! focus-visible:outline-2 focus-visible:-outline-offset-2",
        appearance === "source" &&
          "inline-flex h-6 max-w-40 cursor-interaction items-center gap-2 rounded-full bg-secondary-soft py-1 ps-1 pe-2 text-xs text-secondary! no-underline! select-none hover:bg-primary-ghost-hover hover:no-underline! focus-visible:outline-2 focus-visible:outline-offset-2",
        underline === "always" && "underline!",
        underline === "hover" && "no-underline hover:underline",
        underline === "none" && "no-underline! hover:no-underline!",
      )}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}
