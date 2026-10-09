import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type Ref } from "react";
import { defineMessages, FormattedMessage } from "../lib/intl";
import { useReducedMotion } from "../lib/reduced-motion";
import { Button } from "../codex-ui/button";
import { EmptyState } from "../codex-ui/empty-state";
import { ShimmerText } from "../codex-ui/shimmer-text";
import { DotOnboardingRing } from "./dot-onboarding-ring";
import { OnboardingStatusLayout } from "./onboarding-layout";
import { OnboardingLogo, type OnboardingLogoHandle } from "./onboarding-logo";

const creatingTitles = Object.values(
  defineMessages({
    settingUp: {
      id: "orbit.onboarding.creating.brandName",
      defaultMessage: "Setting up your {productName}",
      description: "Initial loading title while the user's bot assistant is being created. {productName} is the untranslated term for the user's agent.",
    },
    creating: {
      id: "orbit.onboarding.creatingProgress.brandName",
      defaultMessage: "Creating your {productName}",
      description: "Second loading title while the user's bot assistant is being created. {productName} is the untranslated term for the user's agent.",
    },
    preparingSkills: {
      id: "orbit.onboarding.creatingPreparingSkills",
      defaultMessage: "Preparing skills",
      description: "Loading title about preparing skills during bot setup",
    },
    gettingPluginsReady: {
      id: "orbit.onboarding.creatingGettingPluginsReady",
      defaultMessage: "Getting plugins ready",
      description: "Loading title about preparing plugins during bot setup",
    },
    almostFinished: {
      id: "orbit.onboarding.creatingAlmostFinished",
      defaultMessage: "Almost finished",
      description: "Final loading title held until bot setup finishes",
    },
  }),
);

/** `SoComponent`: the avatar spins through the palette while the bot is created; each spin advances the title. */
export function CreatingStep({ ref, entered }: { ref?: Ref<OnboardingLogoHandle | null>; entered: boolean }) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const spunOnce = useRef(false);

  const advance = () => {
    if (spunOnce.current) setIndex((i) => Math.min(i + 1, creatingTitles.length - 1));
    spunOnce.current = true;
  };

  useEffect(() => {
    if (!entered || !reducedMotion || index === creatingTitles.length - 1) return;
    let timeout: number | undefined;
    const schedule = () => {
      window.clearTimeout(timeout);
      if (!document.hidden) timeout = window.setTimeout(() => setIndex((i) => i + 1), 5000);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [entered, index, reducedMotion]);

  return (
    <OnboardingStatusLayout logo={<OnboardingLogo ref={ref} onSpinStart={advance} revealComplete={entered} variant="creating" />} title={<CreatingTitle index={index} />}>
      <ShimmerText active={!reducedMotion}>
        <FormattedMessage
          id="orbit.onboarding.creatingNext"
          defaultMessage="This may take a few moments"
          description="Loading subtitle asking the user to wait while their bot assistant is being created"
        />
      </ShimmerText>
    </OnboardingStatusLayout>
  );
}

/** `ToComponent`: crossfades between the creating titles. */
function CreatingTitle({ index }: { index: number }) {
  const reducedMotion = useReducedMotion();
  const title = <FormattedMessage {...creatingTitles[index]} values={{ productName: "bot" }} />;
  if (reducedMotion) return title;
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.span key={index} className="block" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: "easeInOut" }}>
        {title}
      </motion.span>
    </AnimatePresence>
  );
}

/** `MoComponent`: creating the bot was rejected; retrying is offered while the user is still eligible. */
export function CreationFailedStep({ onRetry }: { onRetry?: () => void }) {
  return (
    <OnboardingStatusLayout
      logo={<DotOnboardingRing className="size-28 text-orange/60" data-dot-anchor aria-hidden />}
      title={
        <FormattedMessage
          id="orbit.onboarding.failed.brandName"
          defaultMessage="Couldn’t create your {productName}"
          description="Heading after creating the user's agent was rejected. {productName} is the untranslated term for the user's agent."
          values={{ productName: "bot" }}
        />
      }
      actions={
        onRetry == null ? undefined : (
          <Button color="chatgptPrimary" radius="full" size="detailAction" onClick={onRetry}>
            <FormattedMessage id="orbit.onboarding.retry" defaultMessage="Try again" description="Button to retry bot creation after a definite rejection" />
          </Button>
        )
      }
    >
      <FormattedMessage
        id="orbit.onboarding.failedDescription"
        defaultMessage="Something went wrong during setup"
        description="Explanation beneath the creation failure heading in bot onboarding"
      />
    </OnboardingStatusLayout>
  );
}

/** The `unknown` branch of `Ds1Component`: creation may have succeeded, so it must not be resubmitted. */
export function CreationUnknownStep({ unknown }: { unknown: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col select-none" role={unknown ? "status" : undefined}>
      <EmptyState
        layout="page"
        title={
          <h1 aria-live="polite">
            <FormattedMessage
              id="orbit.onboarding.unknown"
              defaultMessage="Setup may still be running"
              description="Heading when bot creation may have succeeded but the result is unknown"
            />
          </h1>
        }
        description={
          unknown ? (
            <FormattedMessage
              id="orbit.onboarding.unknownDescription"
              defaultMessage="Check the sidebar before trying again"
              description="Guidance when bot creation may have succeeded and must not be submitted again"
            />
          ) : undefined
        }
      />
    </div>
  );
}
