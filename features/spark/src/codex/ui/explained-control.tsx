import { cloneElement, type ReactElement } from "react";
import { Tooltip, type TooltipProps } from "./tooltip";

export type ExplainedControlProps = Omit<TooltipProps, "children" | "cloneCustomTrigger"> & {
  children: ReactElement<{ ariaLabel?: string; "aria-label"?: string; checked?: boolean; children?: unknown }>;
  isControlDisabled: boolean;
  isExplanationFocusable: boolean;
};

/**
 * app-card `i`: a tooltip around a control that keeps its explanation reachable while the control is disabled (a
 * disabled button or switch receives no pointer or focus events).
 */
export function ExplainedControl({ children, isControlDisabled, isExplanationFocusable, ...tooltipProps }: ExplainedControlProps) {
  let trigger: ReactElement = children;
  if (isControlDisabled && tooltipProps.tooltipContent != null && tooltipProps.disabled !== true) {
    if (isExplanationFocusable) {
      const label =
        children.props.ariaLabel ??
        children.props["aria-label"] ??
        (typeof children.props.children === "string" ? children.props.children : undefined);
      const hidden = cloneElement(children, { "aria-hidden": true } as object);
      trigger =
        typeof children.props.checked === "boolean" ? (
          <div aria-checked={children.props.checked} aria-disabled="true" aria-label={label} role="switch" tabIndex={0}>
            {hidden}
          </div>
        ) : (
          <div aria-disabled="true" aria-label={label} role="button" tabIndex={0}>
            {hidden}
          </div>
        );
    } else {
      trigger = <div>{children}</div>;
    }
  }
  return (
    <Tooltip {...tooltipProps} cloneCustomTrigger>
      {trigger}
    </Tooltip>
  );
}
