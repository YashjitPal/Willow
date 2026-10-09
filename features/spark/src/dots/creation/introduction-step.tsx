import { useIsPresent } from "framer-motion";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { FormattedMessage } from "../lib/intl";
import { useReducedMotion } from "../lib/reduced-motion";
import { boltLight20 } from "../codex-icons/bolt-light-20";
import { Icon } from "../codex-icons/icon";
import type { IconAsset } from "../codex-icons/icon-asset";
import { personalizationLight20 } from "../codex-icons/personalization-light-20";
import { shieldCheckmarkLight20 } from "../codex-icons/shield-checkmark-light-20";
import { Button } from "../codex-ui/button";
import { ExternalLink } from "../codex-ui/external-link";
import { useCreationStore } from "../state/creation-store";
import { createOnboardingAnimator, flightTranslate, onboardingMotion } from "./dot-onboarding-ring";
import { useOnboardingColor } from "./onboarding-color-scope";
import { OnboardingHeading, OnboardingStepLayout } from "./onboarding-layout";
import { OnboardingLogo } from "./onboarding-logo";
import { useEvent } from "./use-event";

const dots = "Bots";

interface IntroductionStepProps {
  isContinuing?: boolean;
  onContinue: () => void;
  previewStage?: string | null;
}

/** `OComponent`: the welcome step; `learn_more_url` comes from dynamic config `588640677`. */
export function IntroductionStep({ isContinuing = false, onContinue, previewStage }: IntroductionStepProps) {
  const learnMoreUrl = useCreationStore((s) => s.learnMoreUrl) ?? "";
  return <Introduction learnMoreUrl={learnMoreUrl} isContinuing={isContinuing} onContinue={onContinue} previewStage={previewStage} />;
}

type BirthStage = "birth" | "revealing" | "ready";

/** `Ts1Component`: the avatar is born from a pulsing bot, flies into place, then the copy reveals. */
function Introduction({ learnMoreUrl, isContinuing, onContinue, previewStage }: Required<Omit<IntroductionStepProps, "previewStage">> & { learnMoreUrl: string; previewStage?: string | null }) {
  const backgroundColor = useOnboardingColor();
  const reducedMotion = useReducedMotion();
  const isPresent = useIsPresent();
  const overlayRef = useRef<HTMLSpanElement>(null);
  const growRef = useRef<HTMLSpanElement>(null);
  const pulseRef = useRef<HTMLSpanElement>(null);
  const holeRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<BirthStage>(reducedMotion || previewStage === "welcome" ? "ready" : "birth");
  const landed = stage !== "birth";
  const revealComplete = stage === "ready";

  const runBirth = useEvent(() => {
    if (!isPresent) {
      overlayRef.current?.style.setProperty("visibility", "hidden");
      return;
    }
    if (stage === "ready") return;
    if (reducedMotion) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setStage("ready");
      });
      return () => {
        cancelled = true;
      };
    }
    const overlay = overlayRef.current;
    const grow = growRef.current;
    const pulse = pulseRef.current;
    const hole = holeRef.current;
    const target = targetRef.current;
    if (overlay == null || grow == null || pulse == null || hole == null || target == null) return;
    const { animate, reveal, cancel } = createOnboardingAnimator();
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all(pulse.getAnimations().map((animation) => animation.finished));
        if (cancelled) return;
        await Promise.all([
          animate(grow, [{ transform: "scale(0.1714286)" }, { transform: "scale(1)" }], onboardingMotion.growDuration, 0, onboardingMotion.easeTravel),
          animate(hole, [{ transform: "scale(0)" }, { transform: "scale(1)" }], onboardingMotion.holeDuration, onboardingMotion.holeDelay),
        ]);
        if (cancelled) return;
        const source = grow.getBoundingClientRect();
        const destination = target.getBoundingClientRect();
        const scale = overlay.getBoundingClientRect().height / overlay.offsetHeight;
        await animate(
          overlay,
          [{ transform: "none" }, { transform: flightTranslate(source, destination, scale) }],
          onboardingMotion.longFlightDuration,
          onboardingMotion.birthFlightDelay,
          onboardingMotion.easeMove,
        );
        if (cancelled) return;
        target.closest("button")?.style.setProperty("visibility", "visible");
        overlay.style.visibility = "hidden";
        setStage("revealing");
        await reveal([titleRef.current, featuresRef.current, actionsRef.current]);
        if (!cancelled) setStage("ready");
      } catch {
        if (!cancelled) setStage("ready");
      }
    })();
    return () => {
      cancelled = true;
      cancel();
    };
  });

  useLayoutEffect(() => runBirth(), [reducedMotion, isPresent, runBirth]);

  const hidden = { opacity: Number(revealComplete) };

  return (
    <section className="relative isolate flex h-full min-h-0 flex-col bg-surface" aria-labelledby="orbit-introduction-title">
      <OnboardingStepLayout
        step="welcome"
        actions={
          <div ref={actionsRef} inert={!revealComplete} style={hidden}>
            <Button className="w-full justify-center" color="chatgptPrimary" loading={isContinuing} radius="full" size="detailAction" onClick={onContinue}>
              <FormattedMessage
                id="restricted.orbitIntroduction.continue"
                defaultMessage="Continue"
                description="Advances from the bot introduction to connector setup"
              />
            </Button>
          </div>
        }
      >
        <div>
          <OnboardingLogo landed={landed} revealComplete={revealComplete} targetRef={targetRef} />
          <div ref={titleRef} data-dot-copy inert={!revealComplete} style={hidden}>
            <OnboardingHeading
              titleId="orbit-introduction-title"
              title={
                <FormattedMessage
                  id="restricted.orbitIntroduction.title.brandName"
                  defaultMessage="Create your {productName}"
                  description="Title of the one-time bot onboarding introduction. {productName} is the untranslated term for the user's agent."
                  values={{ productName: "bot" }}
                />
              }
            >
              {learnMoreUrl ? (
                <FormattedMessage
                  id="restricted.orbitIntroduction.subtitleWithLearnMore.capableDot"
                  defaultMessage="{dots} are remarkably capable always-on agents. <learnMore>Learn more</learnMore>"
                  description="Subtitle of the one-time bot onboarding introduction. {dots} is the untranslated plural term for users' agents, capitalized at the start of the English sentence. The link opens more information about bots."
                  values={{
                    dots,
                    learnMore: (chunks) => (
                      <ExternalLink key="learn-more" appearance="inherit" href={learnMoreUrl} underline="always">
                        {chunks}
                      </ExternalLink>
                    ),
                  }}
                />
              ) : (
                <FormattedMessage
                  id="restricted.orbitIntroduction.subtitle.capableDot"
                  defaultMessage="{dots} are remarkably capable always-on agents"
                  description="Subtitle of the one-time bot onboarding introduction when no Learn more link is configured. {dots} is the untranslated plural term for users' agents, capitalized at the start of the English sentence."
                  values={{ dots }}
                />
              )}
            </OnboardingHeading>
          </div>
          <div ref={featuresRef} data-dot-copy inert={!revealComplete} className="mt-8 flex flex-col gap-6" style={hidden}>
            <IntroductionFeature
              icon={boltLight20}
              title={
                <FormattedMessage
                  id="restricted.orbitIntroduction.complexWork.title"
                  defaultMessage="Built to take on complex work"
                  description="First feature heading on the bot onboarding introduction, describing the agent's ability to take on complex work."
                />
              }
            >
              <FormattedMessage
                id="restricted.orbitIntroduction.firstDetailBody.brandName"
                defaultMessage="Powered by GPT-6 Astra, your {productName} can work through projects and ongoing responsibilities on your behalf."
                description="First feature description on the bot onboarding introduction. {productName} is the untranslated term for the user's agent."
                values={{ productName: "bot" }}
              />
            </IntroductionFeature>
            <IntroductionFeature
              icon={personalizationLight20}
              title={
                <FormattedMessage
                  id="restricted.orbitIntroduction.proactiveHelp.title"
                  defaultMessage="Proactively helpful"
                  description="Second feature heading on the bot onboarding introduction, describing proactive help based on connected apps."
                />
              }
            >
              <FormattedMessage
                id="restricted.orbitIntroduction.proactiveHelp.body"
                defaultMessage="Your {productName} will suggest how it can be helpful based on information in your <connectedApps>connected apps</connectedApps>."
                description="Second feature description on the bot onboarding introduction. {productName} is the untranslated term for the user's agent. The connectedApps link opens the user's connected app settings."
                values={{ productName: "bot", connectedApps: connectedAppsLink }}
              />
            </IntroductionFeature>
            <IntroductionFeature
              icon={shieldCheckmarkLight20}
              title={
                <FormattedMessage
                  id="restricted.orbitIntroduction.dataControls.title"
                  defaultMessage="Respects your choices"
                  description="Third feature heading on the bot onboarding introduction, describing the user's choices about data use."
                />
              }
            >
              <FormattedMessage
                id="restricted.orbitIntroduction.dataControls.body"
                defaultMessage="Depending on your settings, we may use conversations with your {productName} to improve our models. <dataControls>Manage data controls</dataControls>"
                description="Data-use disclosure on the bot onboarding introduction. {productName} is the untranslated term for the user's agent. The dataControls link opens the user's data controls."
                values={{ productName: "bot", dataControls: dataControlsLink }}
              />
            </IntroductionFeature>
          </div>
        </div>
      </OnboardingStepLayout>
      {/* `Wr placement="home"`: the browser composer disclaimer renders nothing for a personal account on home. */}
      <footer className="shrink-0 bg-surface px-6 pb-4 text-center text-xs text-tertiary" />
      {landed ? null : (
        <span ref={overlayRef} aria-hidden className="pointer-events-none absolute inset-0 z-30 flex justify-center">
          <span className="grid h-full w-full max-w-md place-items-center">
            <span ref={growRef} className="block size-18" style={{ transform: "scale(0.1714286)" }}>
              <span ref={pulseRef} className="relative block size-full pulsing-dot rounded-full [animation-iteration-count:1]" style={{ backgroundColor }}>
                <span ref={holeRef} className="absolute inset-[30.219%] rounded-full bg-surface" style={{ transform: "scale(0)" }} />
              </span>
            </span>
          </span>
        </span>
      )}
    </section>
  );
}

function dataControlsLink(chunks: ReactNode[]) {
  return (
    <IntroductionLink key="data-controls" href="https://chatgpt.com/data-controls">
      {chunks}
    </IntroductionLink>
  );
}

function connectedAppsLink(chunks: ReactNode[]) {
  return (
    <IntroductionLink key="connected-apps" href="https://chatgpt.com/settings/Plugins">
      {chunks}
    </IntroductionLink>
  );
}

/** `As1Component`: one feature row of the welcome step. */
function IntroductionFeature({ icon, title, children }: { icon: IconAsset; title: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary-soft">
        <Icon asset={icon} className="text-blue" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base leading-5 font-medium text-default" dir="auto">
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-4.5 text-secondary" dir="auto">
          {children}
        </p>
      </div>
    </div>
  );
}

/** `Os1Component`: an inline link of the welcome step copy. */
function IntroductionLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <ExternalLink appearance="inherit" href={href} underline="always">
      {children}
    </ExternalLink>
  );
}
