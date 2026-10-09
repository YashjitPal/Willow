import clsx from "clsx";
import { Children, type ReactNode } from "react";

export type ConnectorLogoStackSize = "small" | "medium";
export type ConnectorLogoStackSurface = "default" | "white" | "transparent";

const sizeClassNames: Record<ConnectorLogoStackSize, string> = {
  small: "-ms-1 size-5",
  medium: "-ms-1.5 size-6",
};

export interface ConnectorLogoStackProps {
  ariaLabel?: string;
  children?: ReactNode;
  size?: ConnectorLogoStackSize;
  surface?: ConnectorLogoStackSurface;
}

/** Overlapping row of connector logos, each on a rounded tile; hidden from assistive tech unless labelled. */
export function ConnectorLogoStack({ ariaLabel, children, size = "small", surface = "default" }: ConnectorLogoStackProps) {
  const logos = Children.toArray(children);
  if (logos.length === 0) return null;
  return (
    <span aria-hidden={ariaLabel == null || undefined} aria-label={ariaLabel} className="flex shrink-0 items-center" role={ariaLabel == null ? undefined : "img"}>
      {logos.map((logo, index) => (
        <span
          key={index}
          className={clsx(
            "flex items-center justify-center overflow-hidden rounded-md first:ms-0",
            surface !== "transparent" && "ring-1 ring-inset",
            surface === "white" ? "bg-brand-logo-background text-brand-logo-foreground ring-brand-logo-foreground/10" : "text-default",
            surface === "default" && "bg-surface ring-border",
            surface === "transparent" && "bg-transparent",
            sizeClassNames[size],
          )}
        >
          {logo}
        </span>
      ))}
    </span>
  );
}
