// Agent Swarm Type Definitions

export type AgentId = 'willow' | 'orion' | 'ethan' | 'meredith';

export const AGENT_NAMES: Record<AgentId, string> = {
  willow: 'Willow',
  orion: 'Orion',
  ethan: 'Ethan',
  meredith: 'Meredith',
};

export interface ChatroomMessage {
  id: string;
  from: AgentId;
  to: AgentId | 'all';
  content: string;
  timestamp: number;
}

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'assessing'
  | 'distributing'
  | 'coding'
  | 'reviewing'
  | 'waiting'
  | 'synthesizing'
  | 'done'
  | 'error';

export interface AgentState {
  id: AgentId;
  displayName: string;
  status: AgentStatus;
  statusMessage: string;
  messageHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  pendingChatroomMessages: ChatroomMessage[];
  currentStreamingText: string;
  isComplete: boolean;
  lastSeenTimestamp: number;
}

export interface ToolCall {
  name: 'chatroom_send' | 'wait';
  args: Record<string, string>;
}

export interface SwarmConfig {
  apiKeys: { gemini: string[]; openai: string[]; anthropic: string[]; moonshot?: string[]; spacexai?: string[]; zhipuai?: string[] };
  modelConfig: any;
  selectedModelId: string;
  projectFiles: Record<string, { type: string; content: string }>;
  /** Recent chat history so agents have conversation context */
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onAgentStatusChange: (agentId: AgentId, status: AgentStatus, message: string) => void;
  onToken: (agentId: AgentId, token: string) => void;
  onChatroomMessage: (message: ChatroomMessage) => void;
  /** Fires for each token during Willow's final synthesis — use this to stream to the UI parser */
  onSynthesisToken?: (token: string) => void;
  onComplete: (finalResponse: string) => void;
  onError: (error: Error) => void;
  abortSignal?: AbortSignal;
}

export interface SwarmResult {
  finalResponse: string;
  agentOutputs: Record<AgentId, string>;
  chatroomLog: ChatroomMessage[];
  totalDuration: number;
}
