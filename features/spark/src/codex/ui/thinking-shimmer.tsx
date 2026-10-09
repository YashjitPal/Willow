import clsx from "clsx";
import type { ReactNode } from "react";
import { FormattedMessage } from "react-intl";
import { ShimmerText, type ShimmerTextProps } from "./shimmer-text";

export interface ThinkingShimmerProps extends Omit<ShimmerTextProps, "children"> {
  message?: ReactNode;
}

/** `yC` (`AVs`): one-line shimmering status in chat text size, "Thinking" by default. */
export function ThinkingShimmer({ className, message, ...rest }: ThinkingShimmerProps) {
  return (
    <ShimmerText className={clsx("text-size-chat leading-[calc(var(--codex-chat-font-size)_+_8px)] select-none truncate", className)} {...rest}>
      {message ?? <FormattedMessage id="thinkingShimmer.default" defaultMessage="Thinking" description="Default placeholder shown while the assistant is thinking" />}
    </ShimmerText>
  );
}
