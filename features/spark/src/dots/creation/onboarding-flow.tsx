import { useState, type ReactNode } from "react";
import { goToSparkDots } from "../../spark-store";
import { useDotStore } from "../state/dot-store";
import {
  mockRoundTripMs,
  newOrbitDot,
  scheduleDotReady,
  useCreationStore,
  type CreationOutcome,
  type OnboardingSession,
} from "../state/creation-store";
import { connectorsComplete, ConnectorsStep } from "./connectors-step";
import { CreatingStep, CreationFailedStep, CreationUnknownStep } from "./creation-status-steps";
import { DataUseNoticeDialog } from "./data-use-notice-dialog";
import { IntroductionStep } from "./introduction-step";
import { OnboardingColorScope } from "./onboarding-color-scope";
import { OnboardingStepTransition, type TransitionStep } from "./onboarding-step-transition";

const mockCreationMs = 2 * mockRoundTripMs;

type CreationResult = { status: "accepted"; threadId: string } | { status: "rejected" } | { status: "unknown" };

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Resolves once a scenario moves the outcome off `pending`. */
function settledOutcome(): Promise<Exclude<CreationOutcome, "pending">> {
  return new Promise((resolve) => {
    const current = useCreationStore.getState().creationOutcome;
    if (current !== "pending") {
      resolve(current);
      return;
    }
    const unsubscribe = useCreationStore.subscribe(({ creationOutcome }) => {
      if (creationOutcome === "pending") return;
      unsubscribe();
      resolve(creationOutcome);
    });
  });
}

/** `Jp`: creates the first orbit bot from the onboarding draft. */
async function createOrbitDot(clientThreadId: string): Promise<CreationResult> {
  await delay(mockCreationMs);
  const outcome = await settledOutcome();
  if (outcome !== "accepted") return { status: outcome };
  useDotStore.getState().addDot(newOrbitDot(clientThreadId));
  scheduleDotReady(clientThreadId);
  return { status: "accepted", threadId: clientThreadId };
}

/** The welcome step skips the connectors step when email and calendar are already connected. */
async function connectorsAlreadyComplete() {
  await delay(mockRoundTripMs / 2);
  return connectorsComplete(useCreationStore.getState().connectors);
}

function transitionStep(step: OnboardingSession["step"], computerSetup: ReactNode): TransitionStep {
  if (computerSetup != null) return "computer";
  return step === "accepted" || step === "complete" ? "creating" : step;
}

interface OnboardingFlowProps {
  available: boolean;
  computerSetup: ReactNode;
}

/** `Ds1Component`: Codex's first-dot onboarding steps, which Willow runs for every new bot. */
export function OnboardingFlow({ available, computerSetup }: OnboardingFlowProps) {
  const session = useCreationStore((s) => s.session);
  const updateSession = useCreationStore((s) => s.updateSession);
  const internalUser = useCreationStore((s) => s.internalUser);
  const [continuing, setContinuing] = useState(false);
  const { step } = session;

  const complete = async (fromWelcome = false) => {
    const current = useCreationStore.getState().session;
    if (current.step !== "connectors" && current.step !== "failed" && !(current.step === "welcome" && fromWelcome)) return;
    const { clientThreadId } = current;
    updateSession((s) => ({ ...s, step: "creating", noticeAcknowledged: true }));
    const result = await createOrbitDot(clientThreadId);
    const settle = (next: Partial<OnboardingSession>) =>
      updateSession((s) => (s.step === "creating" && s.clientThreadId === clientThreadId ? { ...s, ...next } : s));
    if (result.status === "rejected") {
      settle({ step: "failed" });
    } else if (result.status === "unknown") {
      settle({ step: "unknown" });
    } else {
      settle({ step: "accepted", acceptedThreadId: result.threadId });
    }
  };

  const continueFromWelcome = () => {
    setContinuing(true);
    connectorsAlreadyComplete()
      .catch(() => false)
      .then((skipConnectors) => {
        if (useCreationStore.getState().session.step !== "welcome") return;
        if (skipConnectors) return complete(true);
        updateSession((s) => ({ ...s, step: "connectors" }));
      })
      .finally(() => setContinuing(false));
  };

  if (internalUser && !session.noticeAcknowledged) {
    return (
      <DataUseNoticeDialog
        onDismiss={goToSparkDots}
        onAcknowledge={() => updateSession((s) => ({ ...s, noticeAcknowledged: true }))}
      />
    );
  }

  return (
    <OnboardingColorScope>
      <OnboardingStepTransition step={transitionStep(step, computerSetup)}>
        {(entered, logoRef) => {
          if (computerSetup != null) return computerSetup;
          switch (step) {
            case "welcome":
              return <IntroductionStep isContinuing={continuing} onContinue={continueFromWelcome} />;
            case "connectors":
              return (
                <ConnectorsStep
                  connectionFailed={session.connectorFailed}
                  onComplete={() => complete()}
                  onConnectionSucceeded={() => updateSession((s) => (s.connectorFailed ? { ...s, connectorFailed: false } : s))}
                />
              );
            case "creating":
            case "accepted":
              return <CreatingStep ref={logoRef} entered={entered} />;
            case "failed":
              return <CreationFailedStep onRetry={available ? () => void complete() : undefined} />;
            default:
              return <CreationUnknownStep unknown={step === "unknown"} />;
          }
        }}
      </OnboardingStepTransition>
    </OnboardingColorScope>
  );
}
