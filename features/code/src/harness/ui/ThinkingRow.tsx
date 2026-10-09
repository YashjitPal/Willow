/**
 * The row above a reply while its turn runs, drawn as Chat draws its thinking
 * row: Gemini's three dots, and beside them the newest heading of the model's
 * thought summary, wiping in. Before the first heading, and for models whose
 * thoughts come without headings, it is the dots alone. It stays for the whole
 * turn, through every round; the saved reply shows "Thought for Ns" in its place.
 */

import React, { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { GeminiThinkingVisualizer } from '@willow/chat/GeminiThinkingVisualizer';
import { ThoughtSummaryLine, latestThoughtHeading } from '@willow/chat/ThoughtSummaryLine';
import { useCodeSession } from '../../session/code-session';

export const LiveThinkingRow: React.FC = () => {
  const thoughts = useStore(useCodeSession().harness.liveThoughts);
  const heading = useMemo(() => latestThoughtHeading(thoughts), [thoughts]);
  return (
    <div className="flex min-h-[24px] items-center gap-3 animate-textFadeIn">
      <GeminiThinkingVisualizer />
      {heading && <ThoughtSummaryLine heading={heading} />}
    </div>
  );
};
