import clsx from "clsx";
import type { AnimationEvent, ComponentType, ElementType } from "react";
import { Icon as AssetIcon } from "../codex-icons/icon";
import { SpinnerIcon } from "../codex-icons/spinner";
import { spinnerRaysGradedRegular20 } from "../codex-icons/spinner-rays-graded-regular-20";

const css = { rays: "_rays_va20p_2" } as const;

export type SpinnerVariant = "default" | "rays";

export interface SpinnerProps {
  as?: ElementType;
  Icon?: ComponentType<{ className?: string }>;
  variant?: SpinnerVariant;
  className?: string;
  containerClassName?: string;
}

/** Keeps every spinner on the page rotating in phase. */
function alignAnimationStart(event: AnimationEvent<HTMLElement>) {
  for (const animation of event.currentTarget.getAnimations()) animation.startTime = 0;
}

export function Spinner({ as: Container = "div", Icon, variant = "default", className, containerClassName }: SpinnerProps) {
  const Glyph = Icon ?? SpinnerIcon;
  return (
    <Container
      className={clsx(
        "inline-flex h-fit w-fit items-center justify-center leading-none contain-layout contain-paint contain-style motion-safe:animate-spin",
        containerClassName,
      )}
      onAnimationStart={alignAnimationStart}
    >
      {Icon == null && variant === "rays" ? (
        <AssetIcon className={clsx("shrink-0", css.rays, className)} asset={spinnerRaysGradedRegular20} focusable="false" />
      ) : (
        <Glyph className={clsx(variant === "rays" && css.rays, className)} />
      )}
    </Container>
  );
}
