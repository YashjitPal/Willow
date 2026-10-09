import clsx from "clsx";
import type { MouseEvent, ReactNode } from "react";
import { CheckmarkMdLight16Icon } from "../codex-icons/checkmark-md-light-16";
import { ChevronRightMdLight16Icon } from "../codex-icons/chevron-right-md-light-16";
import { PluginLight20Icon } from "../codex-icons/plugin-light-20";
import { Button } from "../codex-ui/button";
import { ImageWithFallback } from "../codex-ui/image-with-fallback";
import { Spinner } from "../codex-ui/spinner";

const css = { bubble: "_Bubble_nur7j_2" } as const;

interface ConnectionBubbleProps {
  className?: string;
  children: ReactNode;
  logoUrl?: string;
  icon?: ReactNode;
  busy: boolean;
  connected: boolean;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  "data-plugin-impression-id"?: string;
}

/** `t` of `connection-bubble`: a message-bubble shaped connect action in the bot conversation. */
export function ConnectionBubble({
  className,
  children,
  logoUrl,
  icon,
  busy,
  connected,
  disabled,
  onClick,
  "data-plugin-impression-id": pluginImpressionId,
}: ConnectionBubbleProps) {
  return (
    <Button
      className={clsx(
        "message-bubble gap-2 bg-(--orbit-connection-tint) text-[var(--orbit-message-link-color,var(--color-text-info))] data-[owl-native-source-underlay]:bg-transparent",
        css.bubble,
        className,
      )}
      allowShrink
      unstyled
      disabled={disabled}
      aria-busy={busy}
      data-plugin-impression-id={pluginImpressionId}
      onClick={onClick}
    >
      {icon ?? (
        <span className="flex size-5 shrink-0 overflow-hidden rounded-full bg-brand-logo-background text-brand-logo-foreground">
          {logoUrl == null ? (
            <PluginLight20Icon className="rounded-2xs size-5 object-contain" />
          ) : (
            <ImageWithFallback alt="" className="rounded-2xs size-5 object-contain" src={logoUrl} fallback={<PluginLight20Icon />} />
          )}
        </span>
      )}
      <span className="message-bubble-label truncate text-inherit">{children}</span>
      {busy && <Spinner as="span" className="size-4" />}
      {!busy && (connected ? <CheckmarkMdLight16Icon /> : <ChevronRightMdLight16Icon />)}
    </Button>
  );
}
