import clsx from "clsx";
import type { ReactNode } from "react";

export interface ControlGroupProps {
  children?: ReactNode;
  className?: string;
}

/** control-group `t`: the trailing controls of a settings row or tile. */
export function ControlGroup({ children, className }: ControlGroupProps) {
  return <div className={clsx("flex items-center gap-2", className)}>{children}</div>;
}
