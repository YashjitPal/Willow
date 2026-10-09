// The agent chat's thinking row, drawn as Chat draws it: Gemini's three dots, then the newest
// heading of the model's thought summary wiping in beside them. Before the first heading the row
// is the dots alone, as Gemini's own is.

import React from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@nanostores/react';
import { GeminiThinkingVisualizer } from '@willow/chat/GeminiThinkingVisualizer';
import { ThoughtSummaryLine, latestThoughtHeading } from '@willow/chat/ThoughtSummaryLine';
import type { MediaAgent } from './agent-session';

/**
 * `status` names what the agent is doing when it is not thinking: a web search, or a tool with no
 * card in the chat. It takes over at once, without waiting out the hold on a thought heading.
 */
export function AgentThinkingRow({ agent, status }: { agent: MediaAgent; status: string | null }) {
  const thinking = useStore(agent.$thinking);
  const heading = status ?? latestThoughtHeading(thinking);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
      className="agent-thinking-row flex items-center gap-3 min-h-[24px]"
    >
      <GeminiThinkingVisualizer />
      {heading && (
        <ThoughtSummaryLine key={status ? `status:${status}` : 'thought-summary'} heading={heading} />
      )}
    </motion.div>
  );
}
