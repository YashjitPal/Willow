import React, { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { swarmChatroomLog, swarmAgents, isSwarmRunning } from '../../lib/agent-swarm/swarm-store';
import { AgentId, AGENT_NAMES, ChatroomMessage } from '../../lib/agent-swarm/types';

// Agent visual config
const AGENT_CONFIG: Record<AgentId, { color: string; bg: string; ring: string; avatar: string }> = {
  willow:   { color: 'text-purple-400',  bg: 'bg-purple-500/15', ring: 'ring-purple-500/30', avatar: 'W' },
  orion:    { color: 'text-blue-400',    bg: 'bg-blue-500/15',   ring: 'ring-blue-500/30',   avatar: 'O' },
  ethan:    { color: 'text-emerald-400', bg: 'bg-emerald-500/15',ring: 'ring-emerald-500/30', avatar: 'E' },
  meredith: { color: 'text-amber-400',   bg: 'bg-amber-500/15',  ring: 'ring-amber-500/30',  avatar: 'M' },
};

const AGENT_ROLES: Record<AgentId, string> = {
  willow: 'Team Lead',
  orion: 'Developer',
  ethan: 'Developer',
  meredith: 'Developer',
};

// Truncate long code blocks for display
function formatMessageContent(content: string): string {
  // If content has code blocks, keep them but truncate very long ones
  if (content.length > 2000) {
    return content.slice(0, 2000) + '\n... (truncated)';
  }
  return content;
}

// Format relative time
function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = Math.floor((now - timestamp) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

const ChatMessage: React.FC<{ message: ChatroomMessage; prevMessage?: ChatroomMessage }> = React.memo(({ message, prevMessage }) => {
  const config = AGENT_CONFIG[message.from];
  const role = AGENT_ROLES[message.from];
  const isSameAuthor = prevMessage?.from === message.from;
  const isCloseInTime = prevMessage && (message.timestamp - prevMessage.timestamp) < 30000;
  const isGrouped = isSameAuthor && isCloseInTime;

  const toLabel = message.to === 'all'
    ? null
    : AGENT_NAMES[message.to as AgentId];

  return (
    <div className={`px-4 ${isGrouped ? 'pt-0.5' : 'pt-3'} group`}>
      {!isGrouped && (
        <div className="flex items-center gap-2 mb-1">
          {/* Avatar */}
          <div className={`w-6 h-6 rounded-full ${config.bg} ring-1 ${config.ring} flex items-center justify-center flex-shrink-0`}>
            <span className={`text-[11px] font-bold ${config.color}`}>{config.avatar}</span>
          </div>
          {/* Name + role + recipient */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-[13px] font-semibold ${config.color}`}>{AGENT_NAMES[message.from]}</span>
            <span className="text-[11px] text-gray-600">{role}</span>
            {toLabel && (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-gray-600 flex-shrink-0">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
                <span className={`text-[11px] font-medium ${AGENT_CONFIG[message.to as AgentId]?.color || 'text-gray-400'}`}>
                  {toLabel}
                </span>
              </>
            )}
          </div>
          {/* Timestamp */}
          <span className="text-[10px] text-gray-600 ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {formatTime(message.timestamp)}
          </span>
        </div>
      )}
      {/* Message body */}
      <div className={`${!isGrouped ? 'pl-8' : 'pl-8'}`}>
        <div className="text-[13px] text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
          {formatMessageContent(message.content)}
        </div>
      </div>
    </div>
  );
});

// Typing indicator for active agents
const AgentTypingIndicator: React.FC = () => {
  const agents = useStore(swarmAgents);
  const activeAgents = (Object.entries(agents) as [AgentId, typeof agents[AgentId]][])
    .filter(([, state]) => state.status === 'thinking' || state.status === 'coding' || state.status === 'assessing' || state.status === 'synthesizing')
    .map(([id]) => id);

  if (activeAgents.length === 0) return null;

  return (
    <div className="px-4 py-2">
      <div className="flex items-center gap-2">
        <div className="flex -space-x-1.5">
          {activeAgents.map((id) => {
            const config = AGENT_CONFIG[id];
            return (
              <div key={id} className={`w-5 h-5 rounded-full ${config.bg} ring-1 ${config.ring} flex items-center justify-center`}>
                <span className={`text-[9px] font-bold ${config.color}`}>{config.avatar}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[12px] text-gray-500">
            {activeAgents.length === 1
              ? `${AGENT_NAMES[activeAgents[0]]} is thinking`
              : `${activeAgents.length} agents working`}
          </span>
          <div className="flex gap-0.5 items-center ml-0.5">
            <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    </div>
  );
};

// Agent status badges at the top
const AgentStatusBar: React.FC = () => {
  const agents = useStore(swarmAgents);
  const running = useStore(isSwarmRunning);

  return (
    <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-[#27272a] flex-shrink-0">
      {(Object.entries(agents) as [AgentId, typeof agents[AgentId]][]).map(([id, state]) => {
        const config = AGENT_CONFIG[id];
        const isActive = state.status !== 'idle' && state.status !== 'done' && state.status !== 'error';
        return (
          <div
            key={id}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium transition-all duration-300 ${
              isActive ? `${config.bg} ${config.color} ring-1 ${config.ring}` : 'text-gray-600 bg-[#1c1c1c]'
            }`}
          >
            <div className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
              state.status === 'error' ? 'bg-red-500' :
              state.status === 'done' ? 'bg-green-500' :
              isActive ? 'bg-current animate-pulse' : 'bg-gray-700'
            }`} />
            <span>{AGENT_NAMES[id as AgentId]}</span>
            {isActive && state.statusMessage && (
              <span className="text-[10px] opacity-60 ml-0.5 hidden sm:inline">{state.statusMessage}</span>
            )}
          </div>
        );
      })}
      {running && (
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-purple-400">
          <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
          Live
        </div>
      )}
    </div>
  );
};

export const SwarmChatroom: React.FC = () => {
  const messages = useStore(swarmChatroomLog);
  const running = useStore(isSwarmRunning);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrollRef = useRef(true);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isAutoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Detect manual scroll to pause auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAutoScrollRef.current = scrollHeight - scrollTop - clientHeight < 80;
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#141414] rounded-[12px] border border-[#27272a] overflow-hidden">
      {/* Agent status bar */}
      <AgentStatusBar />

      {/* Messages area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 overscroll-contain pb-3"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-500">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="text-gray-500 text-sm text-center px-8">
              {running
                ? 'Agents are initializing...'
                : 'Agent chatroom will appear here when a swarm generation starts'}
            </p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              prevMessage={i > 0 ? messages[i - 1] : undefined}
            />
          ))
        )}

        {/* Typing indicator */}
        {running && <AgentTypingIndicator />}
      </div>

      {/* Scroll to bottom button */}
      {!isAutoScrollRef.current && messages.length > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <button
            onClick={() => {
              if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                isAutoScrollRef.current = true;
              }
            }}
            className="px-3 py-1 bg-[#27272a] hover:bg-[#3f3f46] text-gray-300 text-[11px] rounded-full border border-[#3f3f46] transition-colors shadow-lg"
          >
            Scroll to bottom
          </button>
        </div>
      )}
    </div>
  );
};
