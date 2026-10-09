import { useStore } from '@nanostores/react';
import { useEffect, type ReactNode } from 'react';
import { DotConversation } from './dots/DotConversation';
import { DotsDirectory } from './dots/DotsDirectory';
import { DotsOnboarding } from './dots/DotsOnboarding';
import { DotOnboardingFlight } from './dots/creation/dot-onboarding-flight';
import { sparkDots } from './dots/dots-store';
import { closeDotOnboarding, isOnboardingUnderway, useCreationStore } from './dots/state/creation-store';
import { useSparkAccentVars } from './spark-accent';

export interface SparkDotsPageProps {
  dotId?: string;
  modelConfig?: any;
  selectedModelId?: string;
  setSelectedModelId?: (id: string) => void;
}

/** `/spark/dots`: Codex's bot onboarding, then the bots directory; `/spark/dots/<id>` opens a bot. */
export function SparkDotsPage({ dotId, modelConfig, selectedModelId, setSelectedModelId }: SparkDotsPageProps) {
  const { dots } = useStore(sparkDots);
  const accentVars = useSparkAccentVars();
  const onboarding = useCreationStore((s) => s.onboardingOpen || isOnboardingUnderway(s.session.step));
  const openDot = dotId == null ? undefined : dots.find((dot) => dot.id === dotId);
  const openDotId = openDot?.id;

  // Opening a bot from "New bot"'s welcome step leaves that onboarding, so the Bots tab shows the list again.
  useEffect(() => {
    const { onboardingOpen, session } = useCreationStore.getState();
    if (openDotId != null && onboardingOpen && session.step === 'welcome') closeDotOnboarding();
  }, [openDotId]);

  let page: ReactNode;
  if (openDot != null) {
    page = <DotConversation dot={openDot} modelConfig={modelConfig} selectedModelId={selectedModelId} setSelectedModelId={setSelectedModelId} />;
  } else if (dots.length === 0 || onboarding) {
    page = <DotsOnboarding canCancel={dots.length > 0} />;
  } else {
    page = <DotsDirectory />;
  }
  return (
    // Spark's accent variables, which every other Spark page declares too: "New bot" and the like.
    <div className="spark-dots-page" style={{ display: 'contents', ...accentVars }}>
      {page}
      <span className="willow-dots">
        <DotOnboardingFlight />
      </span>
    </div>
  );
}
