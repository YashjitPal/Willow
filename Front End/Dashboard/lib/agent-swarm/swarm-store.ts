import { atom, map } from 'nanostores';
import { AgentId, AgentStatus, ChatroomMessage } from './types';

const MAX_CHATROOM_LOG = 200;

export interface SwarmAgentState {
  status: AgentStatus;
  statusMessage: string;
  streamingText: string;
}

/** Whether the swarm is currently running */
export const isSwarmRunning = atom<boolean>(false);

/** Per-agent state for the UI */
export const swarmAgents = map<Record<AgentId, SwarmAgentState>>({
  willow: { status: 'idle', statusMessage: '', streamingText: '' },
  orion: { status: 'idle', statusMessage: '', streamingText: '' },
  ethan: { status: 'idle', statusMessage: '', streamingText: '' },
  meredith: { status: 'idle', statusMessage: '', streamingText: '' },
});

/** Chatroom log for display / debugging */
export const swarmChatroomLog = atom<ChatroomMessage[]>([]);

/** Append a message to the chatroom log (with size cap) */
export function appendChatroomMessage(msg: ChatroomMessage): void {
  const current = swarmChatroomLog.get();
  const next = current.length >= MAX_CHATROOM_LOG
    ? [...current.slice(-(MAX_CHATROOM_LOG - 1)), msg]
    : [...current, msg];
  swarmChatroomLog.set(next);
}

/** Reset all swarm state to defaults */
export function resetSwarmState(): void {
  isSwarmRunning.set(false);
  swarmAgents.set({
    willow: { status: 'idle', statusMessage: '', streamingText: '' },
    orion: { status: 'idle', statusMessage: '', streamingText: '' },
    ethan: { status: 'idle', statusMessage: '', streamingText: '' },
    meredith: { status: 'idle', statusMessage: '', streamingText: '' },
  });
  swarmChatroomLog.set([]);
}
