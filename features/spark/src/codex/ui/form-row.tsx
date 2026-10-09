import clsx from "clsx";
import type { ReactNode } from "react";

export interface FormRowProps {
  children?: ReactNode;
  className?: string;
}

/** Horizontal form row (`JS` in the bundles), e.g. a checkbox with its label. */
export function FormRow({ children, className }: FormRowProps) {
  return <div className={clsx("relative flex items-center gap-2", className)}>{children}</div>;
}
