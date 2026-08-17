import React, { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { ToolCallView } from './ToolCallView';
import { AgentGroup } from './Agents';
import { CollapsedWork, TurnStatus } from './TurnStatus';
import {
  agents as agentsStore,
  calls as callsStore,
  turns as turnsStore,
} from '../code-beta-store';
import type { SubAgent, ToolCall } from '../harness/runtime/protocol';

/**
 * A turn's tool calls and sub-agents.
 *
 * Subscribes to all three stores rather than taking data as props: calls are
 * patched continuously while a patch streams, and threading every update
 * through the sidebar's render would re-render the whole 4,000-line component
 * on every diff line.
 */
function useTurn(turnId: string | undefined) {
  const turns = useStore(turnsStore);
  const allCalls = useStore(callsStore);
  const allAgents = useStore(agentsStore);

  return useMemo(() => {
    const turn = turnId ? turns[turnId] : undefined;
    if (!turn) {
      return { turn: undefined, calls: [] as ToolCall[], agents: [] as SubAgent[] };
    }
    return {
      turn,
      calls: turn.callIds.map((id) => allCalls[id]).filter(Boolean) as ToolCall[],
      agents: turn.agentIds.map((id) => allAgents[id]).filter(Boolean) as SubAgent[],
    };
  }, [turnId, turns, allCalls, allAgents]);
}

/**
 * The in-flight view: everything the agent is doing, expanded.
 *
 * While a turn runs the work *is* the content — there is no answer yet — so it
 * shows in full, with the "Working for 12s" status above it.
 */
export function LiveTurnActivity({
  turnId,
  onStop,
}: {
  turnId: string | null;
  onStop?: () => void;
}) {
  const { turn, calls, agents } = useTurn(turnId ?? undefined);
  if (!turn) return null;

  return (
    <div className="cb-root space-y-2.5 bg-transparent">
      <TurnStatus
        startedAt={turn.startedAt}
        activity={turn.activity}
        running={turn.running}
        onStop={onStop}
      />

      {agents.length > 0 && <AgentGroup agentIds={turn.agentIds} />}

      {calls.map((call) => (
        <ToolCallView key={call.id} call={call} />
      ))}
    </div>
  );
}

/**
 * The settled view: the same work, collapsed behind one row.
 *
 * Once the answer arrives, the steps that produced it are supporting evidence
 * rather than the point — but they are not thrown away, because "what did it
 * actually change" is the first question anyone asks on re-reading a turn.
 */
export function SettledTurnActivity({ turnId }: { turnId: string | undefined }) {
  const { turn, calls, agents } = useTurn(turnId);
  if (!turn) return null;

  const total = calls.length + agents.length;
  if (total === 0) return null;

  return (
    <div className="cb-root bg-transparent">
      <CollapsedWork count={total}>
        {agents.length > 0 && <AgentGroup agentIds={turn.agentIds} />}
        {calls.map((call) => (
          <ToolCallView key={call.id} call={call} />
        ))}
      </CollapsedWork>
    </div>
  );
}
