import React, { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { ToolCallView } from './ToolCallView';
import { AgentGroup } from './Agents';
import { CollapsedWork, TurnStatus } from './TurnStatus';
import {
  agents as agentsStore,
  calls as callsStore,
  splitTurn,
  turns as turnsStore,
  type TurnSegment,
} from '../code-beta-store';

/** Renders a run of prose. Supplied by the caller so Code Beta keeps the
 *  transcript's own markdown renderer rather than growing a second one. */
export type RenderText = (text: string, streaming: boolean) => React.ReactNode;

/**
 * A turn's timeline.
 *
 * Subscribes to the stores rather than taking data as props: calls are patched
 * continuously while a patch streams, and threading every update through the
 * sidebar's render would re-render the whole 4,000-line component on every
 * diff line.
 */
function useTurn(turnId: string | undefined) {
  const turns = useStore(turnsStore);
  // Subscribed to purely so a card's own progress re-renders this list; the
  // segments hold ids, and `ToolCallView` reads the call itself.
  useStore(callsStore);
  useStore(agentsStore);

  return useMemo(() => (turnId ? turns[turnId] : undefined), [turnId, turns]);
}

/**
 * One stretch of the timeline, in order.
 *
 * This is the shape of the whole design: prose, then the card for the work it
 * just described, then more prose. Rendering the cards as a block above the
 * text — which is what this used to do — breaks the narration away from what it
 * narrates, and the transcript stops reading as an account of what happened.
 */
function Segments({
  segments,
  renderText,
  streaming,
}: {
  segments: TurnSegment[];
  renderText: RenderText;
  streaming: boolean;
}) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          const text = segment.text.trim();
          if (!text) return null;
          // Only the final segment of a live turn is still arriving.
          const live = streaming && index === segments.length - 1;
          return (
            <div key={`text-${index}`} className="cb-prose">
              {renderText(segment.text, live)}
            </div>
          );
        }

        if (segment.kind === 'agents') {
          return <AgentGroup key={`agents-${index}`} agentIds={segment.ids} />;
        }

        return <ToolCallStep key={segment.id} id={segment.id} />;
      })}
    </>
  );
}

function ToolCallStep({ id }: { id: string }) {
  const all = useStore(callsStore);
  const call = all[id];
  if (!call) return null;
  return <ToolCallView call={call} />;
}

/**
 * The in-flight view: the narration and the work, interleaved, as it happens.
 *
 * While a turn runs the work *is* the content — there is no answer yet — so it
 * shows in full, with the activity line above it.
 */
export function LiveTurnActivity({
  turnId,
  onStop,
  renderText,
}: {
  turnId: string | null;
  onStop?: () => void;
  renderText: RenderText;
}) {
  const turn = useTurn(turnId ?? undefined);
  if (!turn) return null;

  return (
    <div className="cb-root cb-timeline">
      <TurnStatus
        startedAt={turn.startedAt}
        activity={turn.activity}
        running={turn.running}
        onStop={onStop}
      />
      <Segments segments={turn.timeline} renderText={renderText} streaming={turn.running} />
    </div>
  );
}

/**
 * The settled view: the answer, with the work that produced it folded away.
 *
 * Everything above the closing paragraph collapses behind a single row. It is
 * not discarded — "what did it actually change" is the first question anyone
 * asks on re-reading a turn — but it stops competing with the answer.
 */
export function SettledTurnActivity({
  turnId,
  renderText,
  fallback,
}: {
  turnId: string | undefined;
  renderText: RenderText;
  /** Shown when the turn is no longer in the session store, e.g. after a
   *  reload. The stored message text is all that survives. */
  fallback: React.ReactNode;
}) {
  const turn = useTurn(turnId);
  if (!turn || turn.timeline.length === 0) return <>{fallback}</>;

  const { work, answer } = splitTurn(turn.timeline);
  const steps = work.filter((segment) => segment.kind !== 'text').length;

  return (
    <div className="cb-root cb-timeline">
      {work.length > 0 && (
        <CollapsedWork count={steps}>
          <div className="cb-timeline">
            <Segments segments={work} renderText={renderText} streaming={false} />
          </div>
        </CollapsedWork>
      )}

      {answer.trim() && <div className="cb-prose">{renderText(answer, false)}</div>}
    </div>
  );
}
