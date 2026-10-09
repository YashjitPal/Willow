import { useEffect, type ReactNode } from "react";
import { FormattedMessage } from "../lib/intl";
import { defaultOnboardingColor, mockRoundTripMs, onboardingPalette, useCreationStore } from "../state/creation-store";
import { creationToasts, type ToastHandle } from "./creation-toasts";

let failureToast: ToastHandle | undefined;

/** `Wi`: retries loading color customization. */
export function retryColorLoad() {
  failureToast?.close();
  failureToast = undefined;
  useCreationStore.setState(({ colorLoad }) => ({ colorLoad: { status: "loading", attempt: colorLoad.attempt + 1 } }));
}

/** `GiComponent`: color customization failed to load. */
function failColorLoad() {
  const { colorLoad } = useCreationStore.getState();
  if (colorLoad.status === "failed") return;
  useCreationStore.setState({ colorLoad: { status: "failed", attempt: colorLoad.attempt } });
  failureToast = creationToasts.danger(
    <FormattedMessage
      id="orbit.onboarding.colorLoadFailed"
      defaultMessage="Couldn’t load color customization"
      description="Error when the avatar renderer or its color palette fails to load during onboarding"
    />,
    {
      errorAnalytics: { toastId: "orbit.onboarding.colorLoadFailed" },
      duration: 0,
      primaryAction: {
        label: (
          <FormattedMessage
            id="orbit.onboarding.retryColorLoad"
            defaultMessage="Try again"
            description="Button to retry loading avatar color customization during onboarding"
          />
        ),
        onClick: retryColorLoad,
      },
    },
  );
}

/** `$i`: the onboarding color, or the default avatar color. */
export function useOnboardingColor() {
  return useCreationStore((s) => s.session.color?.color ?? defaultOnboardingColor);
}

/** `KiComponent`: saves the chosen color onto the new bot before entering it. */
export async function saveOnboardingColor(conversationId: string | null) {
  const { session, savingColor } = useCreationStore.getState();
  if (savingColor) return false;
  if (session.color == null || conversationId == null) return true;
  useCreationStore.setState({ savingColor: true });
  await new Promise((resolve) => window.setTimeout(resolve, mockRoundTripMs));
  useCreationStore.setState({ savingColor: false });
  return true;
}

/**
 * `IoComponent`: the onboarding scope. The original loads the palette from an offscreen orbit
 * character's catalog (`LoComponent`); the clone reads the same catalog colors directly.
 */
export function OnboardingColorScope({ children }: { children: ReactNode }) {
  const colorLoad = useCreationStore((s) => s.colorLoad);
  const fails = useCreationStore((s) => s.colorLoadFails);

  useEffect(() => {
    if (colorLoad.status !== "loading") return;
    const timeout = window.setTimeout(() => {
      if (fails) {
        failColorLoad();
        return;
      }
      useCreationStore.setState({ colorLoad: { status: "ready", attempt: colorLoad.attempt, colors: onboardingPalette } });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [colorLoad, fails]);

  useEffect(
    () => () => {
      failureToast?.close();
      failureToast = undefined;
    },
    [],
  );

  return <>{children}</>;
}
