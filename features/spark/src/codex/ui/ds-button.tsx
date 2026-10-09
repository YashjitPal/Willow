import clsx from "clsx";
import { Children, createContext, use, type ButtonHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from "react";
import { LoadingIndicator } from "./loading-indicator";
import { TransitionGroup } from "./transition-group";

const css = { Button: "_Button_eg66f_2", ButtonInner: "_ButtonInner_eg66f_2", ButtonLoader: "_ButtonLoader_eg66f_2" } as const;

/** Module classes for the buttons below; chunks that bundle their own copy of the component use other hashes. */
export const DsButtonClassNames = createContext<Record<keyof typeof css, string>>(css);

export type DsButtonColor = "primary" | "secondary" | "info" | "danger" | "success" | "warning" | "caution" | "discovery";
export type DsButtonVariant = "solid" | "soft" | "outline" | "ghost" | "transparent";
export type DsButtonSize = "3xs" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

export interface DsButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  ref?: Ref<HTMLButtonElement>;
  color?: DsButtonColor;
  variant?: DsButtonVariant;
  pill?: boolean;
  squircle?: boolean;
  uniform?: boolean;
  size?: DsButtonSize;
  iconSize?: string;
  gutterSize?: string;
  loading?: boolean;
  selected?: boolean;
  block?: boolean;
  opticallyAlign?: "start" | "end";
  disabledTone?: string;
  inert?: boolean;
  children?: ReactNode;
}

function wrapTextChildren(children: ReactNode): ReactNode {
  if (Children.count(children) <= 1) return children;
  return Children.map(children, (child) => (typeof child === "string" && child !== "" ? <span>{child}</span> : child));
}

/** Design-system button (`Cf1` / `GCe` in the bundles), styled through `data-*` attributes on `_Button_eg66f_2`. */
export function DsButton({
  type = "button",
  color = "primary",
  variant = "solid",
  pill = true,
  squircle = !pill,
  uniform = false,
  size = "xs",
  iconSize,
  gutterSize,
  loading,
  selected,
  block,
  opticallyAlign,
  children,
  className,
  onClick,
  disabled,
  disabledTone,
  inert = loading,
  ...rest
}: DsButtonProps) {
  const classNames = use(DsButtonClassNames);
  const isInert = disabled || inert;
  return (
    <button
      type={type}
      className={clsx(classNames.Button, className)}
      data-color={color}
      data-variant={variant}
      data-pill={pill && !squircle ? "" : undefined}
      data-squircle={squircle ? "" : undefined}
      data-uniform={uniform ? "" : undefined}
      data-size={size}
      data-gutter-size={gutterSize}
      data-icon-size={iconSize}
      data-loading={loading ? "" : undefined}
      data-selected={selected ? "" : undefined}
      data-suppress-active-style={selected === false ? "" : undefined}
      data-block={block ? "" : undefined}
      data-optically-align={opticallyAlign}
      disabled={isInert}
      aria-disabled={isInert}
      tabIndex={isInert ? -1 : undefined}
      data-disabled={disabled ? "" : undefined}
      data-disabled-tone={disabled ? disabledTone : undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (!disabled) onClick?.(event);
      }}
      {...rest}
    >
      <TransitionGroup className={classNames.ButtonLoader} enterDuration={250} exitDuration={150}>
        {loading && <LoadingIndicator key="loader" />}
      </TransitionGroup>
      <span className={classNames.ButtonInner}>{wrapTextChildren(children)}</span>
    </button>
  );
}
