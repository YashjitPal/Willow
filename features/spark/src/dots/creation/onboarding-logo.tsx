import clsx from "clsx";
import { useIsPresent } from "framer-motion";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { useIntl } from "../lib/intl";
import { useReducedMotion } from "../lib/reduced-motion";
import { useCreationStore } from "../state/creation-store";
import { DotOnboardingRing } from "./dot-onboarding-ring";
import { retryColorLoad, useOnboardingColor } from "./onboarding-color-scope";
import { renderOrbitIntroductionLogo, type LogoSpinRequest, type OrbitIntroductionLogo } from "./orbit-introduction-logo-renderer";
import { useEvent } from "./use-event";

const css = { floating: "_floating_iz62r_1", spinCanvas: "_spinCanvas_iz62r_5" } as const;

export interface OnboardingLogoHandle {
  settle: () => Promise<void>;
}

export type OnboardingLogoVariant = "introduction" | "connectors" | "creating";

interface OnboardingLogoProps {
  ref?: Ref<OnboardingLogoHandle | null>;
  landed?: boolean;
  revealComplete?: boolean;
  targetRef?: Ref<HTMLSpanElement>;
  onSpinStart?: () => void;
  variant?: OnboardingLogoVariant;
}

/** `To1Component`: the onboarding avatar ring, which spins through the palette when clicked. */
export function OnboardingLogo({ ref, landed = true, revealComplete = true, targetRef, onSpinStart, variant = "introduction" }: OnboardingLogoProps) {
  const intl = useIntl();
  const colorLoad = useCreationStore((s) => s.colorLoad);
  const saving = useCreationStore((s) => s.savingColor);
  const color = useOnboardingColor();
  const palette = useMemo(() => (colorLoad.status === "ready" ? colorLoad.colors.map(({ color }) => color) : undefined), [colorLoad]);
  const reducedMotion = useReducedMotion();
  const isPresent = useIsPresent();
  const [request, setRequest] = useState<LogoSpinRequest | null>(null);
  const started = useRef(false);
  const exitingWithSpin = !isPresent && ref != null && request != null;

  useEffect(() => {
    if (!isPresent || !revealComplete || reducedMotion || started.current) return;
    if ((variant === "creating" && palette == null) || (variant !== "introduction" && variant !== "creating")) return;
    const timeout = window.setTimeout(() => {
      if (started.current) return;
      started.current = true;
      setRequest({
        color,
        landingColor: color,
        palette: variant === "creating" ? palette : undefined,
        repeatDelayMs: variant === "creating" ? 5000 : undefined,
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [color, palette, isPresent, reducedMotion, revealComplete, variant]);

  const spin = () => {
    if (!landed || !revealComplete || saving) return;
    const current = useCreationStore.getState().colorLoad;
    if (current.status === "failed") {
      retryColorLoad();
      return;
    }
    if (current.status === "ready") {
      started.current = true;
      setRequest(reducedMotion ? null : { color, landingColor: color, palette, repeatDelayMs: variant === "creating" ? 5000 : undefined });
    }
  };

  const label =
    colorLoad.status === "failed"
      ? intl.formatMessage({
          id: "orbit.onboarding.retryColorLoadLabel",
          defaultMessage: "Retry loading colors",
          description: "Accessible label for clicking the onboarding avatar to retry loading color customization after a failure",
        })
      : intl.formatMessage(
          {
            id: "restricted.orbitIntroduction.animateDot.dotPlaceholder",
            defaultMessage: "Animate your {dot}",
            description: "Action to play the dot animation without changing its color. {dot} is the untranslated term for the user's agent.",
          },
          { dot: "bot" },
        );

  return (
    <button
      aria-label={label}
      className={clsx(
        "pointer-events-auto mx-auto flex shrink-0 cursor-interaction items-center justify-center rounded-full",
        variant === "creating" && "size-28",
        variant === "introduction" && "mb-4 size-20",
        variant === "connectors" && "relative z-10 size-18",
      )}
      disabled={!landed || !revealComplete || saving || colorLoad.status === "loading"}
      onClick={spin}
      style={{ visibility: landed ? "visible" : "hidden", color }}
      type="button"
    >
      <span
        ref={targetRef}
        data-dot-anchor
        aria-hidden
        className={clsx("relative block", variant === "introduction" ? "size-18" : "size-full", (revealComplete || exitingWithSpin) && !reducedMotion && css.floating)}
      >
        {request != null && ((isPresent && revealComplete) || exitingWithSpin) && !reducedMotion ? (
          <SpinningLogo ref={ref} onSpinStart={onSpinStart} request={request} />
        ) : (
          <DotOnboardingRing className="size-full" />
        )}
      </span>
    </button>
  );
}

interface SpinningLogoProps {
  ref?: Ref<OnboardingLogoHandle | null>;
  onSpinStart?: () => void;
  request: LogoSpinRequest;
}

/** `Ro1Component`: the canvas renderer, with the static ring shown until its first frame. */
function SpinningLogo({ ref, onSpinStart, request }: SpinningLogoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<OrbitIntroductionLogo | null>(null);
  const requestRef = useRef(request);
  const [ready, setReady] = useState(false);
  const spinStarted = useEvent(() => onSpinStart?.());

  useImperativeHandle(ref, () => ({ settle: () => rendererRef.current?.settle() ?? Promise.resolve() }), []);

  useEffect(() => {
    requestRef.current = request;
    rendererRef.current?.spin(request);
  }, [request]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (canvas == null || container == null) return;
    rendererRef.current = renderOrbitIntroductionLogo(canvas, container, requestRef.current, () => setReady(false), spinStarted);
    setReady(true);
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [spinStarted]);

  return (
    <>
      <DotOnboardingRing className={`size-full ${ready ? "invisible" : ""}`} />
      <canvas ref={canvasRef} aria-hidden className={clsx(css.spinCanvas, !ready && "invisible")} />
    </>
  );
}
