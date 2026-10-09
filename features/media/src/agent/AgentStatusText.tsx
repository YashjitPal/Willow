// What the agent is doing right now, as one short label. Its own component so the label can
// follow every phase and tool change without re-rendering whatever hosts it.

import React from 'react';
import { useStore } from '@nanostores/react';
import { TextShimmer } from '@willow/ui/text-shimmer';
import type { MediaAgent } from './agent-session';

export function useAgentStatusLabel(agent: MediaAgent): string {
  const turn = useStore(agent.$turn);
  const activities = useStore(agent.$activities);
  const approvals = useStore(agent.$approvals);
  if (approvals.length) return 'Waiting for your go-ahead...';
  if (activities.length) {
    return activities.length === 1
      ? `${activities[0].label}...`
      : `${activities[0].label} and ${activities.length - 1} more...`;
  }
  if (turn.phase === 'searching') return 'Searching...';
  if (turn.phase === 'executing') return 'Running code...';
  if (turn.phase === 'responding' && !turn.waiting) return 'Writing...';
  return 'Thinking...';
}

export function AgentStatusText({ agent, className }: { agent: MediaAgent; className?: string }) {
  const label = useAgentStatusLabel(agent);
  return (
    <TextShimmer className={className} duration={1.5}>
      {label}
    </TextShimmer>
  );
}
