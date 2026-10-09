import { AnimatePresence, usePresence } from "framer-motion";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useReducedMotion } from "../lib/reduced-motion";
import { useCreationStore } from "../state/creation-store";
import { createOnboardingAnimator, DotOnboardingRing, flightTranslate, onboardingMotion, placeOverlay } from "./dot-onboarding-ring";
import type { OnboardingLogoHandle } from "./onboarding-logo";
import { useEvent } from "./use-event";

export type TransitionStep = "welcome" | "connectors" | "creating" | "failed" | "unknown" | "computer";

interface Departure {
  rect: DOMRect;
  color: string;
  step: TransitionStep;
}

interface TransitionRequest {
  element: HTMLDivElement;
  present: boolean;
  step: TransitionStep;
  remove: (() => void) | null | undefined;
  onEntered: () => void;
  logo: OnboardingLogoHandle | null;
}

type StepContent = (revealed: boolean, logoRef: RefObject<OnboardingLogoHandle | null>) => ReactNode;

/** `UoComponent`: crossfades onboarding steps and flies the avatar ring between them. */
export function OnboardingStepTransition({ step, children }: { step: TransitionStep; children: StepContent }) {
  const localOverlayRef = useRef<HTMLSpanElement>(null);
  const previousRef = useRef<Departure | null>(null);
  const flightElementId = useCreationStore((s) => s.flightElementId);
  const handoff = useCreationStore((s) => s.handoff);
  const leavingForChat = step === "computer" && handoff != null && handoff.phase !== "arrived";
  const reducedMotion = useReducedMotion();

  const transition = (request: TransitionRequest) => {
    const onDeparture = (departure: Departure | null) => {
      previousRef.current = departure;
      const { handoff: current, setHandoff } = useCreationStore.getState();
      if (request.step !== "computer" || current?.phase !== "departing") return;
      if (departure != null) {
        const { left, top, width, height } = departure.rect;
        setHandoff({ ...current, source: { left, top, width, height }, sourceColor: departure.color, phase: "flying" });
      } else {
        setHandoff({ ...current, phase: "arrived" });
      }
    };
    const id = useCreationStore.getState().flightElementId;
    const overlay = id == null ? localOverlayRef.current : request.element.ownerDocument.getElementById(id);
    const container = overlay?.parentElement;
    if (overlay == null || container == null) {
      if (request.present) request.onEntered();
      else {
        onDeparture(null);
        queueMicrotask(() => request.remove?.());
      }
      return () => {};
    }
    const stop = runStepTransition({ ...request, overlay, container, previous: previousRef.current, onDeparture, reducedMotion });
    return () => {
      stop();
      if (useCreationStore.getState().handoff?.phase !== "flying") overlay.style.visibility = "hidden";
    };
  };

  return (
    <div className="relative isolate h-full min-h-0 w-full overflow-hidden bg-surface">
      {flightElementId == null && <DotOnboardingRing ref={localOverlayRef} aria-hidden className="pointer-events-none invisible absolute z-30 origin-center" />}
      <AnimatePresence initial={false} mode="wait">
        <StepPresence key={step} step={step} leavingForChat={leavingForChat} transition={transition}>
          {children}
        </StepPresence>
      </AnimatePresence>
    </div>
  );
}

interface StepPresenceProps {
  step: TransitionStep;
  leavingForChat: boolean;
  transition: (request: TransitionRequest) => () => void;
  children: StepContent;
}

/** `GoComponent`: one step, kept mounted by `AnimatePresence` until its exit transition ends. */
function StepPresence({ step, children, leavingForChat, transition }: StepPresenceProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<OnboardingLogoHandle | null>(null);
  const [isPresent, safeToRemove] = usePresence();
  const [entered, setEntered] = useState(false);
  const reducedMotion = useReducedMotion();
  const runTransition = useEvent(transition);

  useLayoutEffect(() => {
    if (elementRef.current == null) return;
    return runTransition({
      element: elementRef.current,
      present: isPresent && !leavingForChat,
      step,
      remove: leavingForChat ? null : safeToRemove,
      onEntered: () => setEntered(true),
      logo: logoRef.current,
    });
  }, [isPresent, safeToRemove, step, reducedMotion, leavingForChat, runTransition]);

  return (
    <div ref={elementRef} className="absolute inset-0 h-full min-h-0 outline-none" inert={!isPresent || leavingForChat} tabIndex={-1}>
      {children(isPresent && entered, logoRef)}
    </div>
  );
}

interface StepTransitionOptions extends TransitionRequest {
  overlay: HTMLElement;
  container: HTMLElement;
  previous: Departure | null;
  onDeparture: (departure: Departure | null) => void;
  reducedMotion: boolean;
}

/** `Ko`: the exit (ring departs, copy fades) or entry (ring flies in, copy reveals) of one step. */
function runStepTransition({ element, overlay, container, previous, onDeparture, present, step, reducedMotion, remove, onEntered, logo }: StepTransitionOptions) {
  const { animate, reveal, finish, cancel } = createOnboardingAnimator();
  let cancelled = false;
  let focused = false;
  let copyHidden = false;
  const anchor = element.querySelector<HTMLElement>("[data-dot-anchor]");
  const copy = Array.from(element.querySelectorAll<HTMLElement>("[data-dot-copy]"));
  const fading = copy.length > 0 ? copy : [element];

  function restore() {
    anchor?.style.removeProperty("visibility");
    if (step === "connectors" || step === "creating") anchor?.style.removeProperty("animation");
    if (copyHidden) fading.forEach((e) => e.style.removeProperty("opacity"));
    element.inert = !present;
  }

  async function run() {
    try {
      if (!present) {
        if (!reducedMotion && logo != null) {
          await logo.settle();
          if (cancelled) return;
        }
        const rect = anchor?.getBoundingClientRect();
        const currentColor = anchor == null ? null : getComputedStyle(anchor).color;
        const departureColor = anchor?.dataset.dotDepartureColor ?? anchor?.dataset.dotColor ?? currentColor;
        if (anchor != null && rect != null && departureColor != null && currentColor != null && !reducedMotion) {
          const bounds = container.getBoundingClientRect();
          placeOverlay(overlay, rect, bounds, bounds.width / container.offsetWidth, bounds.height / container.offsetHeight);
          overlay.style.color = currentColor;
          overlay.style.visibility = "visible";
          anchor.style.visibility = "hidden";
        }
        if (!reducedMotion) {
          await Promise.all([
            ...fading.map((e) =>
              animate(
                e,
                [{ opacity: 1 }, { opacity: 0 }],
                step === "welcome" ? onboardingMotion.welcomeExitDuration : onboardingMotion.stepExitDuration,
                0,
                step === "welcome" ? onboardingMotion.easeEnter : "ease-out",
              ),
            ),
            ...(departureColor == null
              ? []
              : [animate(overlay, [{ color: overlay.style.color }, { color: departureColor }], onboardingMotion.stepExitDuration)]),
          ]);
        }
        if (cancelled) return;
        if (rect != null && departureColor != null && !reducedMotion) {
          onDeparture({ rect, color: departureColor, step });
          overlay.style.color = departureColor;
        } else {
          onDeparture(null);
        }
        return;
      }
      if (previous == null || reducedMotion || anchor == null || step === "welcome") return;
      if (step === "connectors" || step === "creating") anchor.style.animation = "none";
      const destination = anchor.getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      const scaleX = bounds.width / container.offsetWidth;
      const scaleY = bounds.height / container.offsetHeight;
      placeOverlay(overlay, previous.rect, bounds, scaleX, scaleY);
      overlay.style.visibility = "visible";
      anchor.style.visibility = "hidden";
      copyHidden = true;
      fading.forEach((e) => (e.style.opacity = "0"));
      element.inert = true;
      const toComputer = step === "computer";
      const preview = element.querySelector("[data-dot-computer-preview]");
      await Promise.all([
        animate(
          overlay,
          [
            { transform: "none", color: previous.color },
            {
              transform: `${flightTranslate(previous.rect, destination, scaleX, scaleY)} scale(${destination.width / previous.rect.width})`,
              color: anchor.dataset.dotColor ?? getComputedStyle(anchor).color,
            },
          ],
          toComputer ? onboardingMotion.longFlightDuration : onboardingMotion.flightDuration,
          !toComputer && previous.step === "welcome" ? onboardingMotion.flightDelay : 0,
          toComputer ? onboardingMotion.easeMove : onboardingMotion.easeTravel,
        ),
        ...(preview == null ? [] : [animate(preview, [{ opacity: 0 }, { opacity: 1 }], onboardingMotion.revealDuration, 0, onboardingMotion.easeFade)]),
      ]);
      if (cancelled) return;
      anchor.style.removeProperty("visibility");
      overlay.style.visibility = "hidden";
      if (step === "connectors" || step === "creating") anchor.style.removeProperty("animation");
      element.inert = false;
      element.focus({ preventScroll: true });
      focused = true;
      await reveal(fading.filter((e) => e !== preview));
    } catch {
      if (!cancelled && !present) onDeparture(null);
    } finally {
      if (!cancelled && present) {
        onDeparture(null);
        overlay.style.visibility = "hidden";
        restore();
        if (!focused) element.focus({ preventScroll: true });
        onEntered();
      }
      if (!present) {
        queueMicrotask(() => {
          if (!cancelled) remove?.();
        });
      }
    }
  }

  window.addEventListener("resize", finish);
  void run();
  return () => {
    window.removeEventListener("resize", finish);
    cancelled = true;
    cancel();
    restore();
  };
}
