import clsx from "clsx";
import {
  Children,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { buttonColorClasses, buttonRadiusBySize, buttonRadiusClasses, buttonSizeClasses } from "./button-classes";
import { Spinner, type SpinnerVariant } from "./spinner";

export type ButtonColor = keyof typeof buttonColorClasses;
export type ButtonSize = keyof typeof buttonSizeClasses;
export type ButtonRadius = "default" | keyof typeof buttonRadiusClasses;
export type ButtonFocusRing = "surface" | "native" | "none" | "inset";
export type ButtonContentLayout = "default" | "balanced" | "dropdown";
export type ButtonDisabledAppearance = "dimmed" | "unchanged";

interface ButtonOwnProps {
  uniform?: boolean;
  uniformAtMobile?: boolean;
  unstyled?: boolean;
  allowShrink?: boolean;
  color?: ButtonColor;
  contentLayout?: ButtonContentLayout;
  radius?: ButtonRadius;
  size?: ButtonSize;
  focusRing?: ButtonFocusRing;
  disabled?: boolean;
  disabledAppearance?: ButtonDisabledAppearance;
  className?: string;
  children?: ReactNode;
  /** Every label the button can show; the widest one reserves the button width. */
  sizingLabels?: ReactNode;
  loading?: boolean;
  spinnerVariant?: SpinnerVariant;
}

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonOwnProps>;
type NativeAnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonOwnProps>;

export type ButtonLinkRenderProps = NativeAnchorProps & { className: string; children: ReactNode };

export type ButtonProps = ButtonOwnProps &
  (
    | (NativeButtonProps & { as?: "button"; ref?: Ref<HTMLButtonElement> })
    | (NativeAnchorProps & { as: "a"; renderLink?: (props: ButtonLinkRenderProps) => ReactNode; ref?: Ref<HTMLAnchorElement> })
  );

const UNIFORM_LG_RADIUS_SIZES = new Set<ButtonSize>(["toolbar", "compact", "medium", "dialogGhost"]);
const WRAPPING_SIZES = new Set<ButtonSize>(["auth", "surveyOption", "surveyCard", "settingsOption"]);
const NO_GAP_SIZES = new Set<ButtonSize>([
  "composerPill",
  "headerUpsell",
  "entityRowAction",
  "conversationPill",
  "actionChip",
  "actionChipWithIcon",
  "surveyCard",
  "settingsOption",
]);

export function Button(props: ButtonProps) {
  const {
    uniform = false,
    uniformAtMobile = false,
    unstyled = false,
    allowShrink = false,
    color = "primary",
    contentLayout = "default",
    radius = "default",
    size = "default",
    focusRing,
    disabled = false,
    disabledAppearance = "dimmed",
    className,
    children,
    sizingLabels,
    loading = false,
    spinnerVariant = "default",
    ...rest
  } = props;

  const sizeRadius = uniform && UNIFORM_LG_RADIUS_SIZES.has(size) ? "rounded-lg" : buttonRadiusBySize[size];
  const classes = clsx(
    "ws-btn",
    !unstyled && `ws-btn--${color} ws-btn--size-${size}`,
    "no-drag cursor-interaction items-center select-none disabled:cursor-default aria-disabled:cursor-default",
    focusRing === "surface" &&
      "focus:outline-none focus-visible:bg-primary-ghost-hover forced-colors:focus-visible:bg-[Highlight] forced-colors:focus-visible:text-[HighlightText] forced-colors:focus-visible:forced-color-adjust-none",
    focusRing === "native" && "focus-visible:outline-auto",
    focusRing !== "surface" && focusRing !== "native" && color !== "chatgptPrimary" && "focus:outline-hidden",
    disabledAppearance === "dimmed" &&
      (color === "cardAction" ? "disabled:opacity-50 aria-disabled:opacity-50" : "disabled:opacity-40 aria-disabled:opacity-40"),
    focusRing !== "none" && focusRing !== "surface" && focusRing !== "native" && "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
    WRAPPING_SIZES.has(size) ? "whitespace-normal" : "whitespace-nowrap",
    contentLayout === "balanced" ? "grid grid-cols-[1fr_auto_1fr]" : "flex",
    !unstyled && [
      size === "composerPill" ? "gap-1.5 border-0" : "border",
      !NO_GAP_SIZES.has(size) && spinnerVariant !== "rays" && "gap-1",
      size === "headerUpsell" && "gap-0.75",
      spinnerVariant === "rays" && "gap-1.5",
      radius === "default" ? sizeRadius : buttonRadiusClasses[radius],
      buttonColorClasses[color === "segmentedInsetSelected" && size === "fieldSegment" ? "segmentedFieldSelected" : color],
      buttonSizeClasses[size],
      contentLayout === "dropdown" && "pe-1",
    ],
    (size === "fieldSegment" || focusRing === "inset" || (focusRing == null && (size === "inputSegment" || size === "fieldControl"))) &&
      "focus-visible:ring-inset",
    allowShrink && "min-w-0",
    sizingLabels != null && "min-w-0 max-w-full",
    uniform && "aspect-square shrink-0 items-center justify-center !px-0",
    uniformAtMobile && "browser:max-md:aspect-square browser:max-md:shrink-0 browser:max-md:justify-center browser:max-md:!px-0",
    className,
  );

  const spinner =
    spinnerVariant === "rays" ? (
      <Spinner variant="rays" />
    ) : (
      <Spinner className={size === "imageActionIcon" || size === "floatingAction" ? "icon" : "icon-xxs"} />
    );
  const content = (
    <>
      {loading && spinner}
      {children}
    </>
  );
  const body =
    sizingLabels == null ? (
      content
    ) : (
      <span className="grid min-w-0 text-center whitespace-normal">
        {Children.map(sizingLabels, (label) => (
          <span className="invisible col-start-1 row-start-1 flex min-w-0 items-center justify-center gap-1" aria-hidden>
            {spinner}
            <span className="min-w-0 break-words">{label}</span>
          </span>
        ))}
        <span className="col-start-1 row-start-1 flex min-w-0 items-center justify-center gap-1">{content}</span>
      </span>
    );

  if (rest.as === "a") {
    const { as: _as, renderLink, href, onClick, onAuxClick, onKeyDown, tabIndex, ...anchorProps } = rest;
    const inactive = disabled || loading;
    const linkProps: ButtonLinkRenderProps = {
      ...anchorProps,
      className: clsx(classes, "button-link"),
      href: inactive ? undefined : href,
      role: inactive ? "link" : anchorProps.role,
      "aria-disabled": inactive || anchorProps["aria-disabled"],
      tabIndex: inactive ? -1 : tabIndex,
      children: body,
      onClick: (event: MouseEvent<HTMLAnchorElement>) => (inactive ? event.preventDefault() : onClick?.(event)),
      onAuxClick: (event: MouseEvent<HTMLAnchorElement>) => (inactive ? event.preventDefault() : onAuxClick?.(event)),
      onKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => {
        if (!inactive) onKeyDown?.(event);
        else if (event.key === "Enter" || event.key === " ") event.preventDefault();
      },
    };
    return renderLink != null && !inactive ? renderLink(linkProps) : <a {...linkProps}>{body}</a>;
  }

  const { as: _as, type, ...buttonProps } = rest;
  return (
    <button type={type ?? "button"} className={classes} disabled={disabled || loading} {...buttonProps}>
      {body}
    </button>
  );
}
