/**
 * RunPanel — live preview output for an Agent Builder run. Shows the node
 * trace, streamed agent text, the final output, and inline approve/reject
 * controls when the run pauses on a User approval / MCP tool node.
 *
 * Reads the shared run store; actions come from the backend hook via props.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@nanostores/react';
import {
  CheckCircle2,
  Loader2,
  XCircle,
  X,
  Play,
  ThumbsUp,
  ThumbsDown,
  Square,
  ListTree,
  ChevronDown,
  ChevronUp,
  Braces,
} from 'lucide-react';
import { runPanelOpen, runState } from '../../lib/stores/agent-builder-store';
import type { AgentBuilderBackend } from '../../hooks/useAgentBuilderBackend';
import type { JsonObject } from '../../lib/agentBuilder';

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, { label: string; cls: string }> = {
    idle: { label: 'Idle', cls: 'bg-[#333] text-gray-300' },
    queued: { label: 'Queued', cls: 'bg-[#3a3a1a] text-yellow-300' },
    running: { label: 'Running', cls: 'bg-[#1a2a3a] text-blue-300' },
    awaiting_approval: { label: 'Awaiting approval', cls: 'bg-[#3a2a1a] text-orange-300' },
    awaiting_client_tool: { label: 'Awaiting tool', cls: 'bg-[#3a2a1a] text-orange-300' },
    completed: { label: 'Completed', cls: 'bg-[#1a3a24] text-green-300' },
    failed: { label: 'Failed', cls: 'bg-[#3a1a1a] text-red-300' },
    cancelled: { label: 'Cancelled', cls: 'bg-[#333] text-gray-400' },
  };
  const s = map[status] ?? map.idle;
  return <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${s.cls}`}>{s.label}</span>;
};

export const RunPanel: React.FC<{ backend: AgentBuilderBackend }> = ({ backend }) => {
  const open = useStore(runPanelOpen);
  const run = useStore(runState);
  const [input, setInput] = React.useState('');
  const [variablesText, setVariablesText] = React.useState('');
  const [showVariables, setShowVariables] = React.useState(false);
  const [inputError, setInputError] = React.useState<string | null>(null);
  const [showTrace, setShowTrace] = React.useState(false);

  if (!open) return null;

  const isActive = run.status === 'running' || run.status === 'queued';
  const outputText =
    run.output == null
      ? ''
      : typeof run.output === 'string'
        ? run.output
        : JSON.stringify(run.output, null, 2);

  const runWithInputs = () => {
    let variables: JsonObject | undefined;
    if (variablesText.trim()) {
      try {
        const parsed = JSON.parse(variablesText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Variables must be a JSON object.');
        }
        variables = parsed as JsonObject;
      } catch (error) {
        setInputError((error as Error).message || 'Variables must be valid JSON.');
        return;
      }
    }
    setInputError(null);
    void backend.run(input || 'Hello', variables);
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          className="fixed right-6 top-24 bottom-6 w-[380px] bg-[#1a1a1a] rounded-[20px] shadow-2xl flex flex-col z-[60] pointer-events-auto border border-[#2b2b2b]"
        >
          {/* header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#2b2b2b]">
            <div className="flex items-center gap-2.5">
              <h2 className="text-white text-[15px] font-semibold">Preview</h2>
              <StatusPill status={run.status} />
            </div>
            <div className="flex items-center gap-2 text-[#a1a1aa]">
              <button
                title={showTrace ? 'Hide trace' : 'Show trace'}
                onClick={() => setShowTrace((value) => !value)}
                className={`transition-colors ${showTrace ? 'text-white' : 'hover:text-white'}`}
              >
                <ListTree size={15} strokeWidth={2.25} />
              </button>
              {isActive && (
                <button title="Cancel run" onClick={() => backend.cancelRun()} className="hover:text-white transition-colors">
                  <Square size={15} strokeWidth={2.5} />
                </button>
              )}
              <button title="Close" onClick={() => runPanelOpen.set(false)} className="hover:text-white transition-colors">
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* input */}
          <div className="px-5 py-3 border-b border-[#2b2b2b]">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setInputError(null);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isActive) runWithInputs(); }}
                placeholder="Message to run the workflow…"
                className="flex-1 bg-[#2b2b2b] rounded-lg px-3 h-9 text-white text-[13px] outline-none placeholder:text-[#6a6a6a]"
              />
              <button
                title={showVariables ? 'Hide workflow variables' : 'Set workflow variables'}
                aria-label={showVariables ? 'Hide workflow variables' : 'Set workflow variables'}
                onClick={() => setShowVariables((value) => !value)}
                className={`h-9 w-9 rounded-lg flex items-center justify-center ${
                  showVariables ? 'bg-[#454545] text-white' : 'bg-[#2b2b2b] text-[#9a9a9a] hover:text-white'
                }`}
              >
                <Braces size={15} />
              </button>
              <button
                disabled={isActive}
                onClick={runWithInputs}
                className={`h-9 px-3 rounded-lg flex items-center gap-1.5 text-[13px] font-medium transition-colors ${isActive ? 'bg-[#2b2b2b] text-gray-500 cursor-not-allowed' : 'bg-white text-black hover:bg-gray-100'}`}
              >
                <Play size={13} className="fill-current" /> Run
              </button>
            </div>
            {showVariables && (
              <div className="mt-2">
                <textarea
                  value={variablesText}
                  onChange={(event) => {
                    setVariablesText(event.target.value);
                    setInputError(null);
                  }}
                  placeholder='{"customer_name":"Ada"}'
                  aria-label="Workflow variables JSON"
                  className="w-full min-h-16 resize-y bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-white text-[12px] font-mono outline-none placeholder:text-[#666]"
                />
                <div className="text-[#666] text-[10px] mt-1">
                  Values are exposed as <code>workflow.&lt;name&gt;</code>.
                </div>
              </div>
            )}
            {inputError && <div className="text-red-300 text-[11px] mt-1">{inputError}</div>}
          </div>

          {/* trace + output */}
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
            {run.nodeStatuses.length === 0 && run.status === 'idle' && (
              <div className="text-[#6a6a6a] text-[13px] text-center mt-8">Enter a message and run to preview the workflow.</div>
            )}

            {run.nodeStatuses.map((n) => (
              <div key={n.nodeId} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  {n.status === 'running' && <Loader2 size={14} className="text-blue-400 animate-spin" />}
                  {n.status === 'ok' && <CheckCircle2 size={14} className="text-green-400" />}
                  {n.status === 'error' && <XCircle size={14} className="text-red-400" />}
                  <span className="text-white text-[13px] font-medium">{n.name}</span>
                  {n.detail && <span className="text-[#8a8a8a] text-[11px]">· {n.detail}</span>}
                </div>
                {run.streamingByNode[n.nodeId] && (
                  <div className="ml-6 text-[#c4c4c4] text-[12.5px] whitespace-pre-wrap leading-relaxed bg-[#222] rounded-lg p-2.5">
                    {run.streamingByNode[n.nodeId]}
                  </div>
                )}
              </div>
            ))}

            {showTrace && (
              <div className="mt-1 rounded-lg border border-[#303030] bg-[#181818] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#303030]">
                  <span className="text-[#a1a1aa] text-[11px] font-semibold uppercase tracking-wide">Trace</span>
                  {showTrace ? <ChevronUp size={13} className="text-[#777]" /> : <ChevronDown size={13} className="text-[#777]" />}
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-[#252525]">
                  {run.events.filter((event) => event.type !== 'llm.delta').map((event, index) => (
                    <div key={`${event.type}-${event.at}-${index}`} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#d4d4d4] text-[11px] font-mono">{event.type}</span>
                        <span className="text-[#666] text-[10px]">{event.at ? new Date(event.at).toLocaleTimeString() : ''}</span>
                      </div>
                      <div className="text-[#777] text-[10px] mt-0.5 truncate">
                        {String(event.nodeId ?? event.tool ?? event.error ?? '')}
                      </div>
                    </div>
                  ))}
                  {run.events.filter((event) => event.type !== 'llm.delta').length === 0 && (
                    <div className="px-3 py-4 text-[#666] text-[11px]">Trace events will appear here.</div>
                  )}
                </div>
              </div>
            )}

            {run.error && (
              <div className="bg-[#2a1717] border border-[#502] rounded-lg p-3 text-red-300 text-[12.5px]">{run.error}</div>
            )}

            {outputText && (
              <div className="mt-1">
                <div className="text-[#8a8a8a] text-[11px] font-semibold uppercase tracking-wide mb-1.5">Output</div>
                <div className="bg-[#222] rounded-lg p-3 text-white text-[13px] whitespace-pre-wrap leading-relaxed">{outputText}</div>
              </div>
            )}
          </div>

          {/* approval bar */}
          {run.pendingApproval && (
            <div className="px-5 py-4 border-t border-[#2b2b2b] flex flex-col gap-3">
              <div className="text-white text-[13px] whitespace-pre-wrap">{run.pendingApproval.message}</div>
              {run.pendingApproval.toolCall && (
                <div className="text-[#8a8a8a] text-[11.5px] font-mono bg-[#222] rounded-lg p-2">
                  {run.pendingApproval.toolCall.tool}({JSON.stringify(run.pendingApproval.toolCall.arguments)})
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => backend.resolveApproval(run.pendingApproval!.id, true)}
                  className="flex-1 h-9 rounded-lg bg-white text-black text-[13px] font-medium flex items-center justify-center gap-1.5 hover:bg-gray-100"
                >
                  <ThumbsUp size={13} /> Approve
                </button>
                <button
                  onClick={() => backend.resolveApproval(run.pendingApproval!.id, false)}
                  className="flex-1 h-9 rounded-lg bg-[#2b2b2b] text-white text-[13px] font-medium flex items-center justify-center gap-1.5 hover:bg-[#3a3a3a]"
                >
                  <ThumbsDown size={13} /> Reject
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default RunPanel;
