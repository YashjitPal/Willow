import clsx from "clsx";
import { cloneElement, createElement, isValidElement, type ComponentType, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from "react";

const css = { Mention: "_Mention_rqv78_2", IconContainer: "_IconContainer_rqv78_2", Icon: "_Icon_rqv78_2", Label: "_Label_rqv78_2" } as const;

type MentionIcon = ReactElement<{ className?: string }> | ComponentType<{ className?: string }>;

export interface InlineMentionProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  children?: ReactNode;
  appearance?: string;
  brandColor?: string;
  dataAttributes?: Record<`data-${string}`, string | undefined>;
  fontWeight?: "medium" | "regular" | (string & {});
  icon?: MentionIcon | null;
  iconClassName?: string;
  iconSlotProps?: HTMLAttributes<HTMLSpanElement>;
  interactive?: boolean;
  labelClassName?: string;
  layout?: "inline-flow" | "selection-pill" | (string & {});
  tone?: "accent" | "neutral" | (string & {});
  underlineOnHover?: boolean;
}

function MentionGlyph({ className, icon }: { className?: string; icon: MentionIcon }) {
  if (isValidElement(icon)) return cloneElement(icon, { className: clsx(css.Icon, className, icon.props.className) });
  return createElement(icon, { className: clsx(css.Icon, className) });
}

function mentionStyle(brandColor: string | undefined, style: CSSProperties | undefined): CSSProperties | undefined {
  if (brandColor == null && style?.color == null) return style;
  return { ...style, color: undefined, "--inline-mention-base-color": brandColor, "--inline-mention-color": style?.color } as CSSProperties;
}

/** Inline mention pill used in composers and documents (`yl` in app-initial). */
export function InlineMention({
  className,
  children,
  appearance = "inline-mention",
  brandColor,
  dataAttributes,
  fontWeight = "medium",
  icon,
  iconClassName,
  iconSlotProps,
  interactive = false,
  labelClassName,
  layout = "inline-flow",
  style,
  tone = "accent",
  underlineOnHover = interactive,
  ...rest
}: InlineMentionProps) {
  return (
    <span
      {...rest}
      {...dataAttributes}
      className={clsx(css.Mention, className)}
      data-appearance={appearance}
      data-brand-color={brandColor == null ? undefined : ""}
      data-font-weight={fontWeight}
      data-layout={layout}
      data-interactive={interactive ? "" : undefined}
      data-inline-mention-interactive={interactive ? "" : undefined}
      data-tone={tone}
      data-underline-on-hover={underlineOnHover ? "" : undefined}
      style={mentionStyle(brandColor, style)}
    >
      {icon == null ? null : (
        <span {...iconSlotProps} className={css.IconContainer}>
          <MentionGlyph className={iconClassName} icon={icon} />
        </span>
      )}
      <span className={clsx(css.Label, labelClassName)}>{children}</span>
    </span>
  );
}
