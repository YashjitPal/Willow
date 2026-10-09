import clsx from "clsx";
import type { ComponentPropsWithRef, SVGProps } from "react";
import type { HandoffRect } from "../state/creation-store";

const easeEnterCurve = [0.23, 1, 0.32, 1];
const easeMoveCurve = [0.65, 0, 0.35, 1];

export const onboardingMotion = {
  easeEnter: `cubic-bezier(${easeEnterCurve.join(", ")})`,
  easeMove: `cubic-bezier(${easeMoveCurve.join(", ")})`,
  easeTravel: "cubic-bezier(0.77, 0, 0.175, 1)",
  easeFade: "cubic-bezier(0.37, 0, 0.63, 1)",
  easeSettle: "cubic-bezier(0.22, 1, 0.36, 1)",
  growDuration: 650,
  holeDuration: 400,
  holeDelay: 250,
  welcomeExitDuration: 240,
  stepExitDuration: 280,
  flightDuration: 650,
  flightDelay: 80,
  longFlightDuration: 1050,
  birthFlightDelay: 140,
  revealDuration: 800,
  revealStagger: 100,
  copyOffset: "translateY(calc(var(--spacing) * 1.5))",
} as const;

/** Runs Web Animations that can be finished or cancelled together. */
export function createOnboardingAnimator() {
  const animations: Animation[] = [];
  function animate(element: Element, keyframes: Keyframe[], duration: number, delay = 0, easing: string = onboardingMotion.easeEnter) {
    const animation = element.animate(keyframes, { duration, delay, easing, fill: "both" });
    animations.push(animation);
    return animation.finished;
  }
  return {
    animate,
    reveal: (elements: (Element | null | undefined)[]) =>
      Promise.all(
        elements.flatMap((element, index) => {
          if (element == null) return [];
          return [
            animate(element, [{ opacity: 0 }, { opacity: 1 }], onboardingMotion.revealDuration, index * onboardingMotion.revealStagger, onboardingMotion.easeFade),
            animate(
              element,
              [{ transform: onboardingMotion.copyOffset }, { transform: "none" }],
              onboardingMotion.revealDuration,
              index * onboardingMotion.revealStagger,
              onboardingMotion.easeSettle,
            ),
          ];
        }),
      ),
    finish: () => animations.forEach((animation) => animation.finish()),
    cancel: () => animations.forEach((animation) => animation.cancel()),
  };
}

/** Translation that moves the center of `source` onto the center of `destination`. */
export function flightTranslate(source: HandoffRect, destination: HandoffRect, scaleX: number, scaleY = scaleX) {
  return `translate(${(destination.left + destination.width / 2 - source.left - source.width / 2) / scaleX}px, ${(destination.top + destination.height / 2 - source.top - source.height / 2) / scaleY}px)`;
}

/** Positions an overlay over `rect`, relative to its (possibly zoomed) container. */
export function placeOverlay(element: HTMLElement, rect: HandoffRect, container: HandoffRect, scaleX: number, scaleY = scaleX) {
  Object.assign(element.style, {
    left: `${(rect.left - container.left) / scaleX}px`,
    top: `${(rect.top - container.top) / scaleY}px`,
    width: `${rect.width / scaleX}px`,
    height: `${rect.height / scaleY}px`,
    transform: "none",
  });
}

export const ringPath =
  "M512 102C738.437 102 922 285.563 922 512C922 738.437 738.437 922 512 922C285.563 922 102 738.437 102 512C102 285.563 285.563 102 512 102ZM512 349.796C422.417 349.796 349.796 422.417 349.796 512C349.796 601.583 422.417 674.204 512 674.204C601.583 674.204 674.204 601.583 674.204 512C674.204 422.417 601.583 349.796 512 349.796Z";

function RingGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={1024} height={1024} viewBox="102 102 820 820" fill="#BAC1D3" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d={ringPath} />
    </svg>
  );
}

export type DotOnboardingRingProps = ComponentPropsWithRef<"span"> & Record<`data-${string}`, string | boolean | undefined>;

/** The bot ring glyph shared by onboarding, its step transitions and the flight overlay. */
export function DotOnboardingRing({ className, ...rest }: DotOnboardingRingProps) {
  return (
    <span {...rest} className={clsx("block", className)}>
      <RingGlyph className="size-full" fill="currentColor" aria-hidden focusable="false" />
    </span>
  );
}
