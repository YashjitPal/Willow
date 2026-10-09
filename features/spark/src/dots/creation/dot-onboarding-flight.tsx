import { useStore } from "@nanostores/react";
import { useId, useLayoutEffect, useRef } from "react";
import { sparkPathFor } from "../../spark-routes";
import { sparkLocation } from "../../spark-store";
import { useReducedMotion } from "../lib/reduced-motion";
import { orbitConversationPath, useCreationStore, type HandoffRect } from "../state/creation-store";
import { createOnboardingAnimator, DotOnboardingRing, flightTranslate, onboardingMotion, placeOverlay } from "./dot-onboarding-ring";

function ignore() {}

/** Global overlay that flies the onboarding ring into the new bot's room. Mount once in the app shell. */
export function DotOnboardingFlight() {
  const id = useId();
  const overlayRef = useRef<HTMLSpanElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const handoff = useCreationStore((s) => s.handoff);
  const location = useStore(sparkLocation);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const current = useCreationStore.getState().handoff;
    if (current != null && (current.phase !== "flying" || current.conversationId == null || sparkPathFor(location) !== orbitConversationPath(current.conversationId))) {
      useCreationStore.getState().setHandoff(null);
    }
  }, [location]);

  useLayoutEffect(() => () => useCreationStore.getState().setHandoff(null), []);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const container = containerRef.current;
    if (overlay == null || container == null || handoff?.phase === "departing") return;
    if (handoff == null || handoff.phase === "arrived" || handoff.source == null) {
      overlay.style.visibility = "hidden";
      return;
    }
    const source = handoff.source;
    const bounds = container.getBoundingClientRect();
    const scaleX = bounds.width / container.offsetWidth;
    const scaleY = bounds.height / container.offsetHeight;
    placeOverlay(overlay, source, bounds, scaleX, scaleY);
    overlay.style.color = handoff.sourceColor ?? handoff.color;
    overlay.style.visibility = "visible";
    const animator = createOnboardingAnimator();
    let cancelled = false;
    const arrive = () => {
      if (!cancelled && useCreationStore.getState().handoff === handoff) {
        useCreationStore.getState().setHandoff({ ...handoff, phase: "arrived" });
      }
    };
    const finish = () => {
      animator.finish();
      arrive();
    };
    const destination: HandoffRect | null | undefined = handoff.destination;
    if (destination != null) {
      animator
        .animate(
          overlay,
          [
            { transform: "none", color: handoff.sourceColor ?? handoff.color },
            { transform: `${flightTranslate(source, destination, scaleX, scaleY)} scale(${destination.width / source.width})`, color: handoff.color },
          ],
          reduced ? 0 : onboardingMotion.flightDuration,
          0,
          onboardingMotion.easeTravel,
        )
        .then(arrive, ignore);
    }
    const timeout = destination == null ? window.setTimeout(arrive, onboardingMotion.longFlightDuration + onboardingMotion.revealDuration) : undefined;
    window.addEventListener("resize", finish);
    document.addEventListener("visibilitychange", finish);
    return () => {
      cancelled = true;
      animator.cancel();
      window.clearTimeout(timeout);
      window.removeEventListener("resize", finish);
      document.removeEventListener("visibilitychange", finish);
    };
  }, [handoff, reduced]);

  const registerOverlay = (element: HTMLSpanElement | null) => {
    overlayRef.current = element;
    if (element == null) return;
    useCreationStore.setState({ flightElementId: id });
    return () => {
      overlayRef.current = null;
      if (useCreationStore.getState().flightElementId === id) useCreationStore.setState({ flightElementId: null });
    };
  };

  return (
    <div ref={containerRef} className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      <DotOnboardingRing id={id} ref={registerOverlay} className="invisible absolute origin-center" />
    </div>
  );
}

/** Lets the room header land the flight on its avatar: call with the avatar's client rect. */
export function setDotOnboardingHandoffDestination(conversationId: string, destination: HandoffRect) {
  const handoff = useCreationStore.getState().handoff;
  if (handoff?.conversationId === conversationId && handoff.phase !== "arrived") {
    useCreationStore.getState().setHandoff({ ...handoff, destination });
  }
}
