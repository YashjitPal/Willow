import { useEffect, useLayoutEffect } from 'react';
import { goToSparkDot } from '../spark-store';
import { usePrewarmCharacterShaders } from './character/orbit/shader-prewarm';
import { XmarkMdLight20Icon } from './codex-icons/xmark-md-light-20';
import { ComputerStep } from './creation/computer-step';
import { OnboardingFlow } from './creation/onboarding-flow';
import { useEvent } from './creation/use-event';
import { closeDotOnboarding, completeDotOnboarding, createOnboardingSession, useCreationStore } from './state/creation-store';
import { useDotStore } from './state/dot-store';

/**
 * Codex's bot onboarding as `/dots/home` runs it (`KsComponent`): welcome, connectors, creating and the
 * computer step, then the ring flies into the new bot's conversation. "New bot" can back out of it.
 */
export function DotsOnboarding({ canCancel }: { canCancel: boolean }) {
  usePrewarmCharacterShaders();
  const session = useCreationStore((s) => s.session);
  const updateSession = useCreationStore((s) => s.updateSession);
  const dots = useDotStore((s) => s.dots);
  const acceptedThreadId = session.step === 'accepted' || session.step === 'complete' ? session.acceptedThreadId : null;
  const acceptedDotExists = acceptedThreadId != null && dots.some((dot) => dot.conversationId === acceptedThreadId);
  const readyThreadId = acceptedDotExists ? acceptedThreadId : null;

  useLayoutEffect(() => {
    if (session.step === 'complete') updateSession(() => createOnboardingSession());
  }, [session.step, updateSession]);

  useEffect(() => {
    if (acceptedThreadId == null || acceptedDotExists) return;
    updateSession((s) => ((s.step === 'accepted' || s.step === 'complete') && s.acceptedThreadId === acceptedThreadId ? { ...s, step: 'unknown' } : s));
  }, [acceptedThreadId, acceptedDotExists, updateSession]);

  const leave = useEvent(() => {
    if (readyThreadId == null) return;
    goToSparkDot(readyThreadId);
    completeDotOnboarding(readyThreadId);
  });

  const cancellable = canCancel && session.step !== 'creating' && session.step !== 'accepted';
  return (
    <div className="willow-dots spark-dots-onboarding">
      <OnboardingFlow
        available
        computerSetup={session.step === 'accepted' && readyThreadId != null ? <ComputerStep conversationId={readyThreadId} onContinue={leave} /> : null}
      />
      {cancellable ? (
        <button
          type="button"
          className="absolute top-4 right-4 z-40 flex size-8 items-center justify-center rounded-full text-text/80 hover:bg-primary-ghost-hover focus-visible:ring-2 focus-visible:ring-ring focus:outline-none"
          aria-label="Cancel"
          onClick={closeDotOnboarding}
        >
          <XmarkMdLight20Icon />
        </button>
      ) : null}
    </div>
  );
}
