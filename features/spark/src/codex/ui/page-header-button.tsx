import type { ComponentType } from "react";
import { DsButton, type DsButtonProps } from "./ds-button";

export interface PageHeaderButtonProps extends Omit<DsButtonProps, "size" | "iconSize"> {
  icon?: { 16: ComponentType; 20?: ComponentType };
  /** Accepted for parity with Codex callers; the button itself ignores it. */
  squareOnMobile?: boolean;
}

/** Large page-header action with an optional leading 16 px icon (`page-header-button` chunk). */
export function PageHeaderButton({ icon, children, squareOnMobile: _squareOnMobile, className, ...rest }: PageHeaderButtonProps) {
  const Icon = icon?.[16];
  return (
    <DsButton {...rest} className={className} size="lg" iconSize="sm">
      {Icon == null ? null : <Icon />}
      {children}
    </DsButton>
  );
}
