import clsx from "clsx";
import { useEffect, useRef, useState, type KeyboardEventHandler, type MouseEvent, type MouseEventHandler, type ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { toast } from "sonner";
import { CheckmarkMdLight16Icon } from "../icons/checkmark-md-light-16";
import { CheckmarkMdLight20Icon } from "../icons/checkmark-md-light-20";
import { LegacyCopyIcon } from "../icons/legacy-copy";
import { LegacySharedT7A513Icon } from "../icons/legacy-shared-t7-a513";
import { SquareOnSquareLight16Icon } from "../icons/square-on-square-light-16";
import { SquareOnSquareLight20Icon } from "../icons/square-on-square-light-20";
import { Button, type ButtonProps } from "./button";
import { SizedIcon } from "./sized-icon";
import { Tooltip } from "./tooltip";

export type CopyResult = boolean | void;

export type CopyButtonVariant = "default" | "toolbar" | "codeBlock" | "blockAction" | "primaryAction" | "secondaryAction" | "inline";

/** `HNi`: Button styling per copy button variant. */
const variantButtonProps = {
  default: { color: "ghost", size: "icon" },
  toolbar: { color: "ghostActive", size: "imageToolbar", uniform: true },
  codeBlock: { color: "ghost", size: "composerSm", uniform: true },
  blockAction: { color: "blockAction", radius: "full", size: "inputIcon" },
  primaryAction: { color: "composerPrimary", size: "dialog" },
  secondaryAction: { color: "outlineCard", size: "actionSm" },
  inline: { color: "ghostMuted", size: "inline" },
} as const satisfies Record<CopyButtonVariant, Pick<ButtonProps, "color" | "radius" | "size" | "uniform">>;

export interface CopyButtonRenderProps {
  className?: string;
  "aria-label": string;
  "aria-busy"?: boolean;
  "aria-disabled"?: boolean;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  children: ReactNode;
}

export interface CopyButtonProps {
  /** `true` shows the default "Copy" label. */
  buttonText?: ReactNode;
  iconClassName?: string;
  showIcon?: boolean;
  /** Replaces the variant's default copy/copied icons. */
  icons?: { copy: ReactNode; copied: ReactNode };
  /** Returning `false` (or a promise resolving to it) skips the "Copied" state. */
  onCopy: (event: MouseEvent<HTMLButtonElement>) => CopyResult | Promise<CopyResult>;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  ariaLabel?: string;
  className?: string;
  isDisabled?: boolean;
  iconOnly?: boolean;
  showTooltip?: boolean;
  tooltipSideOffset?: number;
  variant?: CopyButtonVariant;
  /** Renders a custom button with the computed props instead of `Button`. */
  renderButton?: (props: CopyButtonRenderProps) => ReactNode;
}

/** `Lg` (`RNi`): copy button that confirms with "Copied" for two seconds (one second inline). */
export function CopyButton({
  buttonText,
  iconClassName = "icon-sm",
  showIcon = true,
  icons,
  onCopy,
  onKeyDown,
  ariaLabel,
  className,
  isDisabled,
  iconOnly = false,
  showTooltip = true,
  tooltipSideOffset,
  variant = "default",
  renderButton,
}: CopyButtonProps) {
  const intl = useIntl();
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const finish = (succeeded: boolean) => {
    if (!mountedRef.current) return;
    pendingRef.current = false;
    setPending(false);
    if (!succeeded) return;
    setCopied(true);
    window.setTimeout(
      () => {
        if (mountedRef.current) setCopied(false);
      },
      variant === "inline" ? 1000 : 2000,
    );
  };

  const copy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (pendingRef.current) return;
    const result = onCopy(event);
    if (result != null && typeof result !== "boolean") {
      pendingRef.current = true;
      setPending(true);
      void Promise.resolve(result).then(
        (value) => finish(value !== false),
        () => finish(false),
      );
    } else {
      finish(result !== false);
    }
  };

  const copiedLabel = <FormattedMessage id="copyButton.copied" tagName="span" defaultMessage="Copied" description="Text displayed when the content has been copied" />;
  let label: ReactNode = copied && variant !== "inline" ? copiedLabel : buttonText;
  if (label === true) label = <FormattedMessage id="copyButton.copy" tagName="span" defaultMessage="Copy" description="Text displayed when the content can be copied" />;
  else if (typeof label === "string") label = <span>{label}</span>;
  const accessibleLabel = copied
    ? intl.formatMessage({ id: "copyButton.copiedAriaLabel", defaultMessage: "Copied", description: "Aria label for a button state when text has been copied" })
    : (ariaLabel ?? intl.formatMessage({ id: "copyButton.copyAriaLabel", defaultMessage: "Copy", description: "Aria label for a button for content that can be copied" }));

  const defaultIcons = showIcon && icons == null;
  const children = (
    <>
      {variant === "inline" && !iconOnly && (
        <span className="grid min-w-0 text-start">
          <span
            className={clsx("col-start-1 row-start-1 truncate transition-opacity duration-basic group-hover/copy:underline motion-reduce:transition-none", copied ? "opacity-0" : "opacity-100")}
            aria-hidden={copied}
          >
            {label}
          </span>
          <span
            className={clsx("col-start-1 row-start-1 truncate text-success transition-opacity duration-basic motion-reduce:transition-none", copied ? "opacity-100" : "opacity-0")}
            aria-hidden={!copied}
          >
            {copiedLabel}
          </span>
        </span>
      )}
      {showIcon && icons != null && (copied ? icons.copied : icons.copy)}
      {defaultIcons &&
        variant === "blockAction" &&
        (copied ? <SizedIcon icon={{ 16: CheckmarkMdLight16Icon, 20: CheckmarkMdLight20Icon }} /> : <SizedIcon icon={{ 16: SquareOnSquareLight16Icon, 20: SquareOnSquareLight20Icon }} />)}
      {defaultIcons &&
        (variant === "toolbar" || variant === "primaryAction" || variant === "codeBlock" || variant === "secondaryAction") &&
        (copied ? <CheckmarkMdLight16Icon /> : <SquareOnSquareLight16Icon />)}
      {defaultIcons && variant === "default" && (copied ? <LegacySharedT7A513Icon className={iconClassName} /> : <LegacyCopyIcon className={iconClassName} />)}
      {variant !== "inline" && !iconOnly && label}
    </>
  );

  const buttonProps: CopyButtonRenderProps = {
    className,
    "aria-label": accessibleLabel,
    "aria-busy": pending || undefined,
    "aria-disabled": pending || undefined,
    disabled: isDisabled,
    onClick: copied ? undefined : copy,
    onKeyDown,
    children,
  };
  const button =
    renderButton == null ? (
      <Button
        {...variantButtonProps[variant]}
        {...buttonProps}
        className={clsx(copied && variant !== "primaryAction" && "text-default", variant === "inline" && "group/copy max-w-full", className)}
      />
    ) : (
      renderButton(buttonProps)
    );

  if (!iconOnly || !showTooltip) return button;
  return (
    <Tooltip
      sideOffset={tooltipSideOffset}
      tooltipContent={
        copied
          ? copiedLabel
          : (buttonText ?? <FormattedMessage id="CopyButton.copyTooltip" tagName="span" defaultMessage="Copy" description="Tooltip on copy message icon button" />)
      }
    >
      {button}
    </Tooltip>
  );
}

/** `BS`: writes text, or several representations keyed by MIME type, to the clipboard and reports a failure in a toast. */
export async function copyToClipboard(content: string | Record<string, string>) {
  try {
    if (typeof content === "string") {
      await navigator.clipboard.writeText(content);
    } else if (typeof ClipboardItem === "undefined" || typeof navigator.clipboard.write !== "function") {
      await navigator.clipboard.writeText(content["text/plain"] ?? "");
    } else {
      const items = Object.fromEntries(Object.entries(content).map(([type, value]) => [type, new Blob([value], { type })]));
      await navigator.clipboard.write([new ClipboardItem(items)]);
    }
    return true;
  } catch {
    toast.error(
      <FormattedMessage id="clipboard.copyError.title" defaultMessage="Couldn’t copy to clipboard" description="Toast title shown when copying to the clipboard fails" />,
      {
        id: "copy-to-clipboard-error",
        description: (
          <FormattedMessage
            id="clipboard.copyError.description"
            defaultMessage="The content wasn’t copied. Try again while Willow is focused"
            description="Toast description shown when copying to the clipboard fails"
          />
        ),
      },
    );
    return false;
  }
}
