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

/* ---------------------------------------------------------------------- */
/* Stores                                                                  */
/* ---------------------------------------------------------------------- */

/** Every tool call ever made this session, flat and keyed by id. */
export const calls = map<Record<string, ToolCall>>({});

/** Every sub-agent, flat and keyed by id. */
export const agents = map<Record<string, SubAgent>>({});

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

/**
 * Folds one harness event into the store.
 *
 * Text and `turn-end` are handled by the caller — the sidebar owns the message
 * body and its own generating flags — so this deliberately ignores them rather
 * than keeping a second copy of the transcript.
 */
export function applyHarnessEvent(turnId: string, event: HarnessEvent): void {
  switch (event.type) {
    case 'call-start': {
      calls.setKey(event.call.id, event.call);
      patchTurn(turnId, (turn) =>
        turn.callIds.includes(event.call.id)
          ? turn
          : { ...turn, callIds: [...turn.callIds, event.call.id] },
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
      patchTurn(turnId, (turn) => ({ ...turn, agentIds: [...turn.agentIds, ...ids] }));
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
      // 'text', 'thought' and 'turn-end' belong to the caller.
      break;
  }
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
