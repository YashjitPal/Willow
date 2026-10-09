import clsx from "clsx";
import { Children, cloneElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { Button, type ButtonProps } from "./button";

const css = {
  body: "_body_1k5bv_2",
  section: "_section_1k5bv_2",
  largeSection: "_largeSection_1k5bv_2",
  footer: "_footer_1k5bv_2",
} as const;

export type DialogBodySize = "scrollable" | "viewport" | "full" | "tall";

function bodySizeClass(size: DialogBodySize | undefined) {
  switch (size) {
    case "scrollable":
      return "max-h-[min(calc(85dvh/var(--codex-window-zoom)),calc(var(--spacing)*176))] overflow-hidden";
    case "viewport":
      return "max-h-[calc(100dvh/var(--codex-window-zoom)-2rem)] overflow-y-auto";
    case "full":
      return "h-full min-h-0";
    case "tall":
      return "min-h-[520px] max-h-[560px]";
    default:
      return undefined;
  }
}

interface DialogBodyOwnProps {
  children?: ReactNode;
  className?: string;
  size?: DialogBodySize;
  /** Only `default` and `confirmation` change the layout; other values (e.g. `chatgpt`) render like neither. */
  variant?: "default" | "confirmation" | (string & {});
}

export type DialogBodyProps = DialogBodyOwnProps &
  ((Omit<ComponentProps<"div">, keyof DialogBodyOwnProps> & { as?: "div" }) | (Omit<ComponentProps<"form">, keyof DialogBodyOwnProps> & { as: "form" }));

/** Dialog content column (`US` in the bundles); renders a `<form>` with `as="form"`. */
export function DialogBody(props: DialogBodyProps) {
  const { children, className, size, variant = "default" } = props;
  const classes = clsx(
    "flex flex-col text-base leading-normal tracking-normal",
    variant === "confirmation" ? "gap-6 p-8" : "gap-0",
    variant === "default" && css.body,
    bodySizeClass(size),
    className,
  );
  if (props.as === "form") {
    const { as: _as, children: _children, className: _className, size: _size, variant: _variant, ...formProps } = props;
    return (
      <form {...formProps} className={classes}>
        {children}
      </form>
    );
  }
  const { as: _as, children: _children, className: _className, size: _size, variant: _variant, ...divProps } = props;
  return (
    <div {...divProps} className={classes}>
      {children}
    </div>
  );
}

export interface DialogHeaderProps {
  icon?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
  iconClassName?: string;
  iconBackgroundClassName?: string;
  titleSize?: "dialog" | "lg" | "base" | "sm";
  titleClassName?: string;
  subtitleSize?: "base" | "sm";
  subtitleTone?: "default" | "secondary" | "tertiary";
  subtitleClassName?: string;
}

const subtitleToneClass = { default: "text-default", secondary: "text-secondary", tertiary: "text-codex-description" } as const;

/** Icon + title + subtitle block at the top of a dialog (`GS` in the bundles). */
export function DialogHeader({
  icon,
  title,
  subtitle,
  className,
  iconClassName,
  iconBackgroundClassName,
  titleSize = "dialog",
  titleClassName,
  subtitleSize = "base",
  subtitleTone = "tertiary",
  subtitleClassName,
}: DialogHeaderProps) {
  const titleClass = titleSize === "lg" ? "heading-lg" : titleSize === "base" ? "heading-base" : titleSize === "sm" ? "heading-sm" : "heading-dialog";
  const subtitleClass = subtitleSize === "base" ? "text-base leading-normal tracking-normal" : "text-sm leading-normal tracking-normal";
  return (
    <div className={clsx("flex flex-col items-start gap-3", className)}>
      {icon ? (
        <span className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl p-2", iconBackgroundClassName ?? "bg-text/5", iconClassName)}>{icon}</span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1 self-stretch">
        {title ? <div className={clsx(titleClass, "min-w-0 font-semibold", titleClassName)}>{title}</div> : null}
        {subtitle ? <div className={clsx(subtitleToneClass[subtitleTone], subtitleClass, subtitleClassName)}>{subtitle}</div> : null}
      </div>
    </div>
  );
}

export interface DialogSectionProps {
  children?: ReactNode;
  className?: string;
  spacing?: "default" | "large";
}

/** Vertical section inside a dialog body (`KS` in the bundles). */
export function DialogSection({ children, className, spacing = "default" }: DialogSectionProps) {
  return <div className={clsx("flex w-full flex-col", css.section, spacing === "large" && css.largeSection, className)}>{children}</div>;
}

export interface DialogFooterProps {
  children?: ReactNode;
  className?: string;
  /** A lone `Button` child stretches to the full width. */
  expandSingleButton?: boolean;
}

/** Right-aligned action row (`WS` in the bundles); `Button` children default to `size="medium"`. */
export function DialogFooter({ children, className, expandSingleButton = true }: DialogFooterProps) {
  const items = Children.toArray(children);
  const buttonCount = items.filter((child) => isValidElement(child) && child.type === Button).length;
  return (
    <div className={clsx("flex w-full flex-wrap items-center justify-end gap-3", css.footer, className)}>
      {items.map((child) => {
        if (!isValidElement(child) || child.type !== Button) return child;
        const button = child as ReactElement<ButtonProps>;
        return cloneElement(button, {
          size: button.props.size ?? "medium",
          className: clsx(button.props.className, expandSingleButton && buttonCount === 1 ? "w-full justify-center" : undefined),
        });
      })}
    </div>
  );
}

export interface FieldStackProps {
  children?: ReactNode;
  className?: string;
}

/** Vertical stack of form fields (`qS` in the bundles). */
export function FieldStack({ children, className }: FieldStackProps) {
  return <div className={clsx("flex flex-col gap-2", className)}>{children}</div>;
}
