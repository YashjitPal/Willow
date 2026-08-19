/**
 * Code Beta's harness activity store.
 *
 * Scope changed when Code Beta became a fork of the Code tab rather than a
 * standalone surface: the copied workbench already owns the project files, the
 * chat messages, and the preview, so duplicating them here would create two
 * sources of truth for the same thing.
 *
 * What is left is the part the workbench has no concept of — the Codex
 * harness's tool calls and sub-agents — keyed by the turn that produced them.
 * The sidebar assigns a turn id per assistant message and renders the activity
 * belonging to it.
 */

import { atom, map } from 'nanostores';
import type { HarnessEvent, SubAgent, ToolCall } from './harness/runtime/protocol';
import { levelToEffort, type CodexEffort } from './harness/overlay/effort';

/* ---------------------------------------------------------------------- */
/* Stores                                                                  */
/* ---------------------------------------------------------------------- */

/**
 * Whether Ultra is engaged.
 *
 * Only Ultra is tracked, because it is the only effort Willow cannot already
 * express: the numeric levels are part of the selected model itself
 * (`…::effort-N`), so storing them again here would create a second source of
 * truth that could drift from the model pill. Ultra has nowhere else to live —
 * it is not a saved-model id, and writing one into `selectedModelId` would
 * leave the Code tab unable to resolve the selection after a tab switch.
 *
 * It sits in a store rather than a component because both composers offer it,
 * and a choice made on the landing screen has to hold once the workbench takes
 * over.
 */
const ULTRA_KEY = 'willow:code-beta:ultra';

export const ultraEngaged = atom<boolean>(readStoredUltra());

function readStoredUltra(): boolean {
  try {
    return localStorage.getItem(ULTRA_KEY) === 'true';
  } catch {
    /* Private-mode or blocked storage; off is the right default. */
    return false;
  }
}

export function setUltraEngaged(engaged: boolean): void {
  ultraEngaged.set(engaged);
  try {
    localStorage.setItem(ULTRA_KEY, String(engaged));
  } catch {
    /* Not worth failing a click over. */
  }
}

/**
 * The effort a turn should run at.
 *
 * Ultra wins when engaged; otherwise the model's own level is authoritative, so
 * the composer never asks for an effort the pill is not showing.
 */
export function effectiveEffort(
  ultra: boolean,
  thinkingLevel: number | undefined,
): CodexEffort {
  return ultra ? 'ultra' : levelToEffort(thinkingLevel);
}

/** Every tool call ever made this session, flat and keyed by id. */
export const calls = map<Record<string, ToolCall>>({});

/** Every sub-agent, flat and keyed by id. */
export const agents = map<Record<string, SubAgent>>({});

/**
 * One entry in a turn's transcript, in the order it happened.
 *
 * Codex reads as a single narrated stream: the agent says what it is about to
 * do, the card for that work appears at that point, then it carries on. That is
 * only possible if prose and tool calls share one ordered list — keeping them in
 * separate collections loses the interleaving, and the cards end up bunched
 * above prose that refers to them in a different order.
 */
export type TurnSegment =
  | { kind: 'text'; text: string }
  | { kind: 'call'; id: string }
  | { kind: 'agents'; ids: string[] };

export interface TurnActivity {
  id: string;
  startedAt: number;
  endedAt?: number;
  running: boolean;
  /** The harness's current phase, e.g. "Editing files". */
  activity: string | null;
  /** Ordered, so the transcript renders work in the order it happened. */
  callIds: string[];
  agentIds: string[];
  /** Narration and work, interleaved. */
  timeline: TurnSegment[];
  error?: string;
}

export const turns = map<Record<string, TurnActivity>>({});

/** The turn currently in flight, if any. */
export const activeTurnId = atom<string | null>(null);

/**
 * Which sub-agent is expanded.
 *
 * UI state, but it lives here rather than in a component because two surfaces
 * drive it: the chip in the transcript and the row in the agents panel, which
 * are in different subtrees.
 */
export const focusedAgentId = atom<string | null>(null);

export const focusAgent = (id: string | null): void => {
  focusedAgentId.set(id);
};

/**
 * The live preview iframe.
 *
 * Registered by the preview component and read by the computer-use tool, which
 * needs a real element to screenshot and drive. A store rather than a prop
 * because the tool runs inside the harness, far from React's tree.
 */
export const previewFrame = atom<HTMLIFrameElement | null>(null);

export const setPreviewFrame = (frame: HTMLIFrameElement | null): void => {
  previewFrame.set(frame);
};

/* ---------------------------------------------------------------------- */
/* Turn lifecycle                                                          */
/* ---------------------------------------------------------------------- */

export function beginTurn(id: string): void {
  turns.setKey(id, {
    id,
    startedAt: Date.now(),
    running: true,
    activity: null,
    callIds: [],
    agentIds: [],
    timeline: [],
  });
  activeTurnId.set(id);
}

export function endTurn(id: string, error?: string): void {
  const turn = turns.get()[id];
  if (turn) {
    turns.setKey(id, {
      ...turn,
      running: false,
      endedAt: Date.now(),
      activity: null,
      error: error ?? turn.error,
    });
  }
  if (activeTurnId.get() === id) activeTurnId.set(null);
}

/** Marks everything in flight as cancelled. */
export function cancelTurn(id: string): void {
  const now = Date.now();

  const nextCalls = { ...calls.get() };
  for (const [callId, call] of Object.entries(nextCalls)) {
    if (call.status === 'running' || call.status === 'queued') {
      nextCalls[callId] = { ...call, status: 'cancelled', endedAt: now } as ToolCall;
    }
  }
  calls.set(nextCalls);

  const nextAgents = { ...agents.get() };
  for (const [agentId, agent] of Object.entries(nextAgents)) {
    if (agent.status === 'running' || agent.status === 'queued') {
      nextAgents[agentId] = { ...agent, status: 'cancelled', endedAt: now, activity: undefined };
    }
  }
  agents.set(nextAgents);

  endTurn(id);
}

/* ---------------------------------------------------------------------- */
/* Event application                                                       */
/* ---------------------------------------------------------------------- */

const patchTurn = (id: string, update: (turn: TurnActivity) => TurnActivity): void => {
  const turn = turns.get()[id];
  if (turn) turns.setKey(id, update(turn));
};

/** Appends to the trailing prose segment, or starts one. */
const withText = (timeline: TurnSegment[], chunk: string): TurnSegment[] => {
  const last = timeline[timeline.length - 1];
  if (last?.kind === 'text') {
    return [...timeline.slice(0, -1), { kind: 'text', text: last.text + chunk }];
  }
  return [...timeline, { kind: 'text', text: chunk }];
};

/**
 * Folds one harness event into the store.
 *
 * `turn-end` is handled by the caller, which owns the message body and its own
 * generating flags. Text is handled *here* as well as there: the sidebar still
 * accumulates it for the stored message, while this keeps its position relative
 * to the tool calls, which is the only place that ordering exists.
 */
export function applyHarnessEvent(turnId: string, event: HarnessEvent): void {
  switch (event.type) {
    case 'text': {
      if (event.chunk === '') break;
      patchTurn(turnId, (turn) => ({
        ...turn,
        timeline: withText(turn.timeline, event.chunk),
      }));
      break;
    }

    case 'call-start': {
      calls.setKey(event.call.id, event.call);
      patchTurn(turnId, (turn) =>
        turn.callIds.includes(event.call.id)
          ? turn
          : {
              ...turn,
              callIds: [...turn.callIds, event.call.id],
              timeline: [...turn.timeline, { kind: 'call', id: event.call.id }],
            },
      );
      break;
    }

    case 'call-progress':
    case 'call-end': {
      const existing = calls.get()[event.id];
      if (existing) calls.setKey(event.id, { ...existing, ...event.patch } as ToolCall);
      break;
    }

    case 'agents-start': {
      const ids: string[] = [];
      for (const agent of event.agents) {
        agents.setKey(agent.id, agent);
        ids.push(agent.id);
      }
      patchTurn(turnId, (turn) => ({
        ...turn,
        agentIds: [...turn.agentIds, ...ids],
        timeline: [...turn.timeline, { kind: 'agents', ids }],
      }));
      break;
    }

    case 'agent-progress': {
      const existing = agents.get()[event.id];
      if (existing) agents.setKey(event.id, { ...existing, ...event.patch });
      break;
    }

    case 'activity':
      patchTurn(turnId, (turn) => ({ ...turn, activity: event.label }));
      break;

    default:
      // 'thought' and 'turn-end' belong to the caller.
      break;
  }
}

/* ---------------------------------------------------------------------- */
/* Splitting a turn into work and answer                                   */
/* ---------------------------------------------------------------------- */

export interface SplitTurn {
  /** Narration and tool calls, in order — everything before the answer. */
  work: TurnSegment[];
  /** The closing prose. What stays on screen once the turn settles. */
  answer: string;
}

/**
 * Splits a turn into the work that produced the answer and the answer itself.
 *
 * The answer is the prose after the last piece of work, which is what Codex
 * leaves on screen when a turn finishes. Everything before it — the running
 * commentary and the cards it refers to — collapses behind one row, because
 * once there is an answer the narration is evidence rather than the point.
 *
 * A turn with no tool calls is all answer: there was no work to hide, and
 * collapsing a plain reply behind a disclosure would be absurd.
 */
export function splitTurn(timeline: TurnSegment[]): SplitTurn {
  const lastWork = timeline.reduce(
    (found, segment, index) => (segment.kind === 'text' ? found : index),
    -1,
  );

  if (lastWork === -1) {
    const answer = timeline.map((s) => (s.kind === 'text' ? s.text : '')).join('');
    return { work: [], answer };
  }

  const trailing = timeline.slice(lastWork + 1);
  return {
    work: timeline.slice(0, lastWork + 1),
    answer: trailing.map((s) => (s.kind === 'text' ? s.text : '')).join(''),
  };
}

const EMPTY_TIMELINE: TurnSegment[] = [];

export function turnTimeline(turnId: string | undefined): TurnSegment[] {
  if (!turnId) return EMPTY_TIMELINE;
  return turns.get()[turnId]?.timeline ?? EMPTY_TIMELINE;
}

/* ---------------------------------------------------------------------- */
/* Selectors                                                              */
/* ---------------------------------------------------------------------- */

const EMPTY_CALLS: ToolCall[] = [];
const EMPTY_AGENTS: SubAgent[] = [];

export function turnCalls(turnId: string | undefined): ToolCall[] {
  if (!turnId) return EMPTY_CALLS;
  const turn = turns.get()[turnId];
  if (!turn || turn.callIds.length === 0) return EMPTY_CALLS;
  const all = calls.get();
  return turn.callIds.map((id) => all[id]).filter(Boolean) as ToolCall[];
}

export function turnAgents(turnId: string | undefined): SubAgent[] {
  if (!turnId) return EMPTY_AGENTS;
  const turn = turns.get()[turnId];
  if (!turn || turn.agentIds.length === 0) return EMPTY_AGENTS;
  const all = agents.get();
  return turn.agentIds.map((id) => all[id]).filter(Boolean) as SubAgent[];
}

/** Clears everything. Called when the workbench starts a new session. */
export function resetActivity(): void {
  calls.set({});
  agents.set({});
  turns.set({});
  activeTurnId.set(null);
}

let counter = 0;
export const nextTurnId = (): string =>
  `turn_${Date.now().toString(36)}_${(counter += 1).toString(36)}`;
