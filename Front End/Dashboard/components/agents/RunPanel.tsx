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
  History,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Braces,
  FileText,
  AudioLines,
  Paperclip,
  StepForward,
} from 'lucide-react';
import { requestedRunHistoryRunId, runHistoryPanelOpen, runPanelOpen, runState } from '../../lib/stores/agent-builder-store';
import type { AgentBuilderBackend } from '../../hooks/useAgentBuilderBackend';
import { getAgentBuilderTraceSpans, type JsonObject, type JsonValue, type RunInput, type TraceSpan } from '../../lib/agentBuilder';
import { getUsageCostDisplay, getUsageDetailItems } from '../../lib/agentUsageDisplay';

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, { label: string; cls: string }> = {
    idle: { label: 'Idle', cls: 'bg-[#333] text-gray-300' },
    queued: { label: 'Queued', cls: 'bg-[#3a3a1a] text-yellow-300' },
    running: { label: 'Running', cls: 'bg-[#1a2a3a] text-blue-300' },
    awaiting_approval: { label: 'Awaiting approval', cls: 'bg-[#3a2a1a] text-orange-300' },
    awaiting_client_tool: { label: 'Awaiting tool', cls: 'bg-[#3a2a1a] text-orange-300' },
    awaiting_credentials: { label: 'Credentials needed', cls: 'bg-[#3a2a1a] text-orange-300' },
    awaiting_debug: { label: 'Paused', cls: 'bg-[#3a1f24] text-red-200' },
    completed: { label: 'Completed', cls: 'bg-[#1a3a24] text-green-300' },
    failed: { label: 'Failed', cls: 'bg-[#3a1a1a] text-red-300' },
    cancelled: { label: 'Cancelled', cls: 'bg-[#333] text-gray-400' },
  };
  const s = map[status] ?? map.idle;
  return <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${s.cls}`}>{s.label}</span>;
};

type VariableDeclaration = { name: string; type: 'string' | 'number' | 'boolean' | 'object' | 'list'; description?: string; initialValue?: JsonValue; defaultValue?: JsonValue };
type PreviewAttachment = NonNullable<RunInput['attachments']>[number];

interface RunPanelProps {
  backend: AgentBuilderBackend;
  inputVariables?: VariableDeclaration[];
  stateVariables?: VariableDeclaration[];
  onFocusNode?: (nodeId: string) => void;
  onActiveNodeChange?: (nodeId: string | null) => void;
  selectedPreviewNodeId?: string | null;
  onPreviewNodeChange?: (nodeId: string | null) => void;
  previewSelectionPinned?: boolean;
  onPreviewSelectionPinnedChange?: (pinned: boolean) => void;
}

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const AUDIO_MIME_TYPES = new Set(['audio/aac', 'audio/flac', 'audio/mp3', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-wav']);
const VIDEO_MIME_TYPES = new Set(['video/3gpp', 'video/avi', 'video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm', 'video/x-flv', 'video/x-ms-wmv', 'video/x-msvideo']);
const DOCUMENT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const comma = value.indexOf(',');
      if (comma < 0) reject(new Error(`Unable to read ${file.name}.`));
      else resolve(value.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Unable to read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export const RunPanel: React.FC<RunPanelProps> = ({ backend, inputVariables = [], stateVariables = [], onFocusNode, onActiveNodeChange, selectedPreviewNodeId = null, onPreviewNodeChange, previewSelectionPinned = false, onPreviewSelectionPinnedChange }) => {
  const open = useStore(runPanelOpen);
  const run = useStore(runState);
  const [input, setInput] = React.useState('');
  const [variablesText, setVariablesText] = React.useState('');
  const [variableValues, setVariableValues] = React.useState<Record<string, string>>({});
  const [stateValues, setStateValues] = React.useState<Record<string, string>>({});
  const [showVariables, setShowVariables] = React.useState(false);
  const [inputError, setInputError] = React.useState<string | null>(null);
  const [showTrace, setShowTrace] = React.useState(false);
  const [expandedEventKey, setExpandedEventKey] = React.useState<string | null>(null);
  const [expandedSpanId, setExpandedSpanId] = React.useState<string | null>(null);
  const [traceSpans, setTraceSpans] = React.useState<TraceSpan[]>([]);
  const [showRawEvents, setShowRawEvents] = React.useState(false);
  const [clientResultText, setClientResultText] = React.useState('');
  const [clientResultError, setClientResultError] = React.useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = React.useState('');
  const [resumingCredentials, setResumingCredentials] = React.useState(false);
  const [debugAction, setDebugAction] = React.useState<'step' | 'continue' | null>(null);
  const [debugActionError, setDebugActionError] = React.useState<string | null>(null);
  const [attachments, setAttachments] = React.useState<PreviewAttachment[]>([]);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
  const attachmentInputRef = React.useRef<HTMLInputElement>(null);
  const traceCursorRef = React.useRef(0);
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    const traceIsLive = open && ['queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug'].includes(run.status);
    if (!run.pendingApproval?.expiresAt && !traceIsLive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, run.pendingApproval?.expiresAt, run.status]);

  React.useEffect(() => {
    setClientResultText('');
    setClientResultError(null);
    setRejectionReason('');
  }, [run.pendingApproval?.id]);

  React.useEffect(() => {
    if (run.status === 'queued' && run.runId === null) setAttachments(run.attachments);
  }, [run.attachments, run.runId, run.status]);

  React.useEffect(() => {
    traceCursorRef.current = 0;
    setTraceSpans([]);
    setExpandedSpanId(null);
    setExpandedEventKey(null);
    setShowRawEvents(false);
    onPreviewSelectionPinnedChange?.(false);
    onPreviewNodeChange?.(null);
  }, [run.runId]);

  React.useEffect(() => {
    if (!open || !run.runId) return;
    const active = ['queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug'].includes(run.status);
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const response = await getAgentBuilderTraceSpans(run.runId!, traceCursorRef.current);
        if (!cancelled) {
          traceCursorRef.current = response.cursor;
          if (response.spans.length > 0) {
            setTraceSpans((current) => {
              if (current.length === 0 || traceCursorRef.current === 0) return response.spans;
              const changed = new Map(response.spans.map((span) => [span.id, span]));
              const existingIds = new Set(current.map((span) => span.id));
              return [
                ...current.map((span) => changed.get(span.id) ?? span),
                ...response.spans.filter((span) => !existingIds.has(span.id)),
              ];
            });
          }
        }
      } catch {
        // Preserve the last good snapshot across transient polling failures.
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = active ? window.setInterval(() => void refresh(), 800) : undefined;
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [open, run.runId, run.status]);

  React.useEffect(() => {
    const activeNodeId = open
      ? run.debugPause?.nodeId ?? [...run.nodeStatuses].reverse().find((node) => node.status === 'running')?.nodeId ?? null
      : null;
    onActiveNodeChange?.(activeNodeId);
    if (!previewSelectionPinned && activeNodeId) onPreviewNodeChange?.(activeNodeId);
  }, [onActiveNodeChange, onPreviewNodeChange, open, previewSelectionPinned, run.debugPause?.nodeId, run.nodeStatuses]);

  React.useEffect(() => {
    setDebugAction(null);
    setDebugActionError(null);
  }, [run.runId]);

  React.useEffect(() => () => onActiveNodeChange?.(null), [onActiveNodeChange]);

  if (!open) return null;

  const isActive = ['running', 'queued', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug'].includes(run.status);
  const requiredProviders = run.credentialRequirements?.providers ?? [];
  const nestedPause = run.nestedWait;
  const outputText =
    run.output == null
      ? ''
      : typeof run.output === 'string'
        ? run.output
        : JSON.stringify(run.output, null, 2);
  const durationMs = run.startedAt && run.endedAt
    ? Math.max(0, new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime())
    : null;
  const usageCost = getUsageCostDisplay(run.usage);
  const usageDetails = getUsageDetailItems(run.usage);
  const traceStart = traceSpans.length > 0 ? Math.min(...traceSpans.map((span) => new Date(span.startedAt).getTime())) : now;
  const traceEnd = traceSpans.length > 0
    ? Math.max(...traceSpans.map((span) => span.endedAt ? new Date(span.endedAt).getTime() : now))
    : traceStart;
  const traceDuration = Math.max(1, traceEnd - traceStart);
  const visibleRawEvents = run.events.filter((event) => event.type !== 'llm.delta');
  const selectedNodeStatus = run.nodeStatuses.find((item) => item.nodeId === selectedPreviewNodeId);
  const selectedNodeSpan = [...traceSpans].reverse().find((span) => span.type === 'node' && span.nodeId === selectedPreviewNodeId);
  const selectedNodeChildSpans = selectedNodeSpan
    ? traceSpans.filter((span) => span.parentId === selectedNodeSpan.id)
    : traceSpans.filter((span) => span.nodeId === selectedPreviewNodeId && span.type !== 'node');
  const selectedStateSpan = [...selectedNodeChildSpans].reverse().find((span) => span.type === 'state');
  const selectedUsage = selectedNodeChildSpans
    .filter((span) => span.type === 'llm' && span.data?.usage && typeof span.data.usage === 'object')
    .map((span) => span.data?.usage);
  const selectedDurationMs = selectedNodeSpan
    ? Math.max(0, (selectedNodeSpan.endedAt ? new Date(selectedNodeSpan.endedAt).getTime() : now) - new Date(selectedNodeSpan.startedAt).getTime())
    : null;
  const selectPreviewNode = (nodeId: string, pinned = true) => {
    onPreviewSelectionPinnedChange?.(pinned);
    onPreviewNodeChange?.(nodeId);
    onFocusNode?.(nodeId);
  };

  const addAttachments = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachmentError(null);
    const selected = Array.from(files);
    if (attachments.length + selected.length > MAX_ATTACHMENTS) {
      setAttachmentError(`Choose at most ${MAX_ATTACHMENTS} files per run.`);
      return;
    }
    const existingBytes = attachments.reduce((total, attachment) => total + (attachment.bytes ?? 0), 0);
    const next: PreviewAttachment[] = [];
    let totalBytes = existingBytes;
    try {
      for (const file of selected) {
        const mimeType = file.type.toLowerCase().split(';')[0].trim();
        if (!file.name || file.name.length > 255 || /[\\/\0]/.test(file.name)) throw new Error(`Invalid attachment name: ${file.name || 'untitled'}.`);
        if (!IMAGE_MIME_TYPES.has(mimeType) && !AUDIO_MIME_TYPES.has(mimeType) && !VIDEO_MIME_TYPES.has(mimeType) && !DOCUMENT_MIME_TYPES.has(mimeType)) throw new Error(`Unsupported attachment type: ${file.name}.`);
        if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} exceeds the 5 MB file limit.`);
        totalBytes += file.size;
        if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('Attachments exceed the 20 MB total limit.');
        next.push({
          name: file.name,
          mimeType,
          contentBase64: await readFileAsBase64(file),
          kind: IMAGE_MIME_TYPES.has(mimeType)
            ? 'image'
            : AUDIO_MIME_TYPES.has(mimeType)
              ? 'audio'
              : VIDEO_MIME_TYPES.has(mimeType)
                ? 'video'
                : 'document',
          bytes: file.size,
        });
      }
      setAttachments((current) => [...current, ...next]);
    } catch (error) {
      setAttachmentError((error as Error).message);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((current) => current.filter((_, candidate) => candidate !== index));
    setAttachmentError(null);
  };

  const runWithInputs = () => {
    let variables: JsonObject | undefined;
    let stateOverrides: JsonObject | undefined;
    const parseValue = (raw: string, declaration: VariableDeclaration): JsonValue => {
      if (declaration.type === 'string') return raw;
      if (declaration.type === 'number') {
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error(`${declaration.name} must be a number.`);
        return value;
      }
      if (declaration.type === 'boolean') {
        if (!['true', 'false'].includes(raw)) throw new Error(`${declaration.name} must be true or false.`);
        return raw === 'true';
      }
      const value = JSON.parse(raw) as JsonValue;
      if (declaration.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error(`${declaration.name} must be a JSON object.`);
      if (declaration.type === 'list' && !Array.isArray(value)) throw new Error(`${declaration.name} must be a JSON array.`);
      return value;
    };
    if (inputVariables.length > 0) {
      variables = {};
      try {
        for (const declaration of inputVariables) {
          const raw = variableValues[declaration.name]?.trim() ?? '';
          if (!raw) {
            if (declaration.defaultValue === undefined) throw new Error(`${declaration.name} is required.`);
          } else variables[declaration.name] = parseValue(raw, declaration);
        }
      } catch (error) {
        setInputError((error as Error).message);
        return;
      }
    }
    if (stateVariables.length > 0) {
      stateOverrides = {};
      try {
        for (const declaration of stateVariables) {
          const raw = stateValues[declaration.name]?.trim() ?? '';
          if (raw) stateOverrides[declaration.name] = parseValue(raw, declaration);
        }
      } catch (error) {
        setInputError((error as Error).message);
        return;
      }
      if (Object.keys(stateOverrides).length === 0) stateOverrides = undefined;
    }
    if (variablesText.trim()) {
      try {
        const parsed = JSON.parse(variablesText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Variables must be a JSON object.');
        }
        variables = { ...(variables ?? {}), ...(parsed as JsonObject) };
      } catch (error) {
        setInputError((error as Error).message || 'Variables must be valid JSON.');
        return;
      }
    }
    setInputError(null);
    void backend.run(input || 'Hello', variables, stateOverrides, attachments);
  };

  const submitClientResult = () => {
    const raw = clientResultText.trim();
    if (!raw) {
      setClientResultError('Enter the result returned by the client tool.');
      return;
    }
    let result: JsonValue = raw;
    try {
      result = JSON.parse(raw) as JsonValue;
    } catch {
      // Plain text is a valid client-tool result.
    }
    setClientResultError(null);
    void backend.submitClientToolResult(run.pendingApproval!.id, result);
  };

  const resumeCredentials = async () => {
    setResumingCredentials(true);
    try {
      await backend.resumeRun();
    } finally {
      setResumingCredentials(false);
    }
  };

  const resumeDebugger = async (action: 'step' | 'continue') => {
    setDebugAction(action);
    setDebugActionError(null);
    try {
      if (action === 'step') await backend.stepDebug();
      else await backend.continueDebug();
    } catch (error) {
      setDebugActionError((error as Error).message);
    } finally {
      setDebugAction(null);
    }
  };

  const openRunHistory = (runId?: string) => {
    if (runId) requestedRunHistoryRunId.set(runId);
    runHistoryPanelOpen.set(true);
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          className="fixed inset-x-3 top-16 bottom-3 w-auto bg-[#1a1a1a] rounded-[20px] shadow-2xl flex flex-col z-[60] pointer-events-auto border border-[#2b2b2b] md:inset-x-auto md:right-6 md:top-24 md:bottom-6 md:w-[380px]"
        >
          {/* header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#2b2b2b]">
            <div className="flex items-center gap-2.5">
              <h2 className="text-white text-[15px] font-semibold">Preview</h2>
              <StatusPill status={run.status} />
            </div>
            <div className="flex items-center gap-2 text-[#a1a1aa]">
              {run.status === 'awaiting_debug' && (
                <>
                  <button disabled={debugAction !== null} title="Step one node" aria-label="Step one node" onClick={() => void resumeDebugger('step')} className="rounded p-1 hover:bg-[#303030] hover:text-white disabled:opacity-40">
                    {debugAction === 'step' ? <Loader2 size={15} className="animate-spin" /> : <StepForward size={15} strokeWidth={2.25} />}
                  </button>
                  <button disabled={debugAction !== null} title="Continue run" aria-label="Continue run" onClick={() => void resumeDebugger('continue')} className="rounded p-1 hover:bg-[#303030] hover:text-white disabled:opacity-40">
                    {debugAction === 'continue' ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} strokeWidth={2.25} />}
                  </button>
                </>
              )}
              <button title="Past runs" aria-label="Past runs" onClick={() => openRunHistory()} className="hover:text-white transition-colors">
                <History size={15} strokeWidth={2.25} />
              </button>
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
                type="button"
                title="Attach files"
                aria-label="Attach files"
                disabled={isActive || attachments.length >= MAX_ATTACHMENTS}
                onClick={() => attachmentInputRef.current?.click()}
                className="h-9 w-9 rounded-lg bg-[#2b2b2b] text-[#9a9a9a] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Paperclip size={15} className="mx-auto" />
              </button>
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif,audio/aac,audio/flac,audio/mp4,audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/x-wav,video/3gpp,video/avi,video/mp4,video/mpeg,video/quicktime,video/webm,video/x-flv,video/x-ms-wmv,video/x-msvideo,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(event) => {
                  void addAttachments(event.target.files);
                  event.target.value = '';
                }}
              />
              <button
                disabled={isActive}
                onClick={runWithInputs}
                className={`h-9 px-3 rounded-lg flex items-center gap-1.5 text-[13px] font-medium transition-colors ${isActive ? 'bg-[#2b2b2b] text-gray-500 cursor-not-allowed' : 'bg-white text-black hover:bg-gray-100'}`}
              >
                <Play size={13} className="fill-current" /> Run
              </button>
            </div>
            {attachments.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 text-[10px] text-[#777]">{attachments.length}/{MAX_ATTACHMENTS} files · {(attachments.reduce((total, attachment) => total + (attachment.bytes ?? 0), 0) / (1024 * 1024)).toFixed(2)} MB / 20 MB</div>
                <div className="flex flex-wrap gap-1.5">
                  {attachments.map((attachment, index) => {
                    const previewUrl = `data:${attachment.mimeType};base64,${attachment.contentBase64}`;
                    return (
                      <div key={`${attachment.name}-${index}`} className="max-w-full rounded-md border border-[#3a3a3a] bg-[#222] p-1.5 text-[10.5px] text-[#ccc]">
                        <div className="flex min-w-0 items-center gap-1.5">
                          {attachment.kind === 'image' ? <img src={previewUrl} alt={attachment.name} className="h-10 w-14 shrink-0 rounded object-cover" />
                            : attachment.kind === 'video' ? <video src={previewUrl} muted controls preload="metadata" className="h-12 w-20 shrink-0 rounded bg-black object-cover" />
                              : attachment.kind === 'audio' ? <AudioLines size={13} className="shrink-0 text-[#d7b2f3]" />
                                : <FileText size={12} className="shrink-0 text-[#a8b7d8]" />}
                          <span className="max-w-[150px] truncate" title={attachment.name}>{attachment.name}</span>
                          <span className="shrink-0 text-[#666]">{((attachment.bytes ?? 0) / 1024).toFixed(0)} KB</span>
                          <button type="button" title={`Remove ${attachment.name}`} aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(index)} className="ml-auto shrink-0 text-[#777] hover:text-white"><X size={12} /></button>
                        </div>
                        {attachment.kind === 'audio' && <audio src={previewUrl} controls preload="metadata" aria-label={`Preview ${attachment.name}`} className="mt-1 h-7 w-[250px] max-w-full" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {attachmentError && <div className="mt-1 text-[11px] text-red-300">{attachmentError}</div>}
            {showVariables && (
              <div className="mt-2 space-y-3 rounded-lg border border-[#303030] bg-[#202020] p-3">
                {inputVariables.length > 0 && <div className="space-y-2"><div className="text-[10px] font-semibold uppercase text-[#777]">Workflow inputs</div>{inputVariables.map((declaration) => (
                  <label key={declaration.name} className="block"><div className="mb-1 flex items-center justify-between text-[11px]"><span className="text-[#ccc]">{declaration.name}</span><span className="uppercase text-[#666]">{declaration.type}</span></div>
                    {declaration.type === 'boolean' ? <select value={variableValues[declaration.name] ?? ''} onChange={(event) => setVariableValues((current) => ({ ...current, [declaration.name]: event.target.value }))} className="h-8 w-full rounded border border-[#333] bg-[#252525] px-2 text-[11px] text-white"><option value="">{declaration.defaultValue === undefined ? 'Select...' : `Default: ${String(declaration.defaultValue)}`}</option><option value="true">true</option><option value="false">false</option></select> : <input value={variableValues[declaration.name] ?? ''} onChange={(event) => setVariableValues((current) => ({ ...current, [declaration.name]: event.target.value }))} placeholder={declaration.defaultValue !== undefined ? `Default: ${JSON.stringify(declaration.defaultValue)}` : declaration.description || (declaration.type === 'object' ? '{}' : declaration.type === 'list' ? '[]' : declaration.type)} className="h-8 w-full rounded border border-[#333] bg-[#252525] px-2 text-[11px] text-white outline-none placeholder:text-[#666]" />}
                  </label>
                ))}</div>}
                {stateVariables.length > 0 && <div className="space-y-2"><div className="text-[10px] font-semibold uppercase text-[#777]">State overrides <span className="normal-case font-normal">(optional)</span></div>{stateVariables.map((declaration) => (
                  <label key={declaration.name} className="block"><div className="mb-1 flex items-center justify-between text-[11px]"><span className="text-[#ccc]">{declaration.name}</span><span className="uppercase text-[#666]">{declaration.type}</span></div>
                    {declaration.type === 'boolean' ? <select value={stateValues[declaration.name] ?? ''} onChange={(event) => setStateValues((current) => ({ ...current, [declaration.name]: event.target.value }))} className="h-8 w-full rounded border border-[#333] bg-[#252525] px-2 text-[11px] text-white"><option value="">Use default</option><option value="true">true</option><option value="false">false</option></select> : <input value={stateValues[declaration.name] ?? ''} onChange={(event) => setStateValues((current) => ({ ...current, [declaration.name]: event.target.value }))} placeholder={declaration.initialValue === undefined ? 'Use default' : JSON.stringify(declaration.initialValue)} className="h-8 w-full rounded border border-[#333] bg-[#252525] px-2 text-[11px] text-white outline-none placeholder:text-[#666]" />}
                  </label>
                ))}</div>}
                <div className="border-t border-[#303030] pt-2">
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
                  Additional raw variables JSON. Declared values above take precedence unless overridden here.
                </div>
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
              <button type="button" key={n.nodeId} onClick={() => selectPreviewNode(n.nodeId)} className={`flex flex-col gap-1.5 rounded-md p-2 text-left transition-colors ${selectedPreviewNodeId === n.nodeId ? 'bg-[#292929] ring-1 ring-[#4a4a4a]' : 'hover:bg-[#222]'}`}>
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
              </button>
            ))}

            {selectedPreviewNodeId && selectedNodeStatus && (
              <section className="overflow-hidden rounded-lg border border-[#3a3a3a] bg-[#181818]">
                <div className="flex items-center justify-between gap-3 border-b border-[#303030] px-3 py-2">
                  <div className="min-w-0"><div className="text-[9px] font-semibold uppercase text-[#777]">Node inspector</div><div className="truncate text-[12px] font-medium text-white">{selectedNodeStatus.name}</div></div>
                  <button type="button" onClick={() => onPreviewSelectionPinnedChange?.(!previewSelectionPinned)} className={`shrink-0 rounded border px-2 py-1 text-[9.5px] ${previewSelectionPinned ? 'border-cyan-800 bg-cyan-950/30 text-cyan-200' : 'border-[#383838] text-[#888] hover:text-white'}`}>{previewSelectionPinned ? 'Pinned' : 'Auto-follow'}</button>
                </div>
                <div className="grid grid-cols-3 gap-px bg-[#303030] text-center">
                  <div className="bg-[#1d1d1d] px-2 py-2"><div className="text-[8px] uppercase text-[#666]">Status</div><div className="mt-0.5 text-[10.5px] text-[#ddd]">{selectedNodeSpan?.status ?? selectedNodeStatus.status}</div></div>
                  <div className="bg-[#1d1d1d] px-2 py-2"><div className="text-[8px] uppercase text-[#666]">Duration</div><div className="mt-0.5 text-[10.5px] text-[#ddd]">{selectedDurationMs === null ? '-' : selectedDurationMs < 1000 ? `${selectedDurationMs}ms` : `${(selectedDurationMs / 1000).toFixed(1)}s`}</div></div>
                  <div className="bg-[#1d1d1d] px-2 py-2"><div className="text-[8px] uppercase text-[#666]">Activity</div><div className="mt-0.5 text-[10.5px] text-[#ddd]">{selectedNodeChildSpans.length} spans</div></div>
                </div>
                <div className="space-y-2 p-3">
                  {([['Resolved input', selectedNodeSpan?.data?.input], ['Output', selectedNodeSpan?.data?.output], ['State after', selectedStateSpan?.data?.state], ['Error', selectedNodeSpan?.data?.error ?? selectedNodeChildSpans.find((span) => span.status === 'error')?.data?.error]] as const).map(([label, value]) => value !== undefined && <div key={label}><div className={`mb-1 text-[9px] font-semibold uppercase ${label === 'Error' ? 'text-red-300' : 'text-[#777]'}`}>{label}</div><pre className={`max-h-40 overflow-auto whitespace-pre-wrap break-all rounded p-2 text-[10px] leading-relaxed ${label === 'Error' ? 'bg-red-950/20 text-red-200' : 'bg-[#111] text-[#bbb]'}`}>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre></div>)}
                  {selectedUsage.length > 0 && <div><div className="mb-1 text-[9px] font-semibold uppercase text-[#777]">Model usage</div><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-[#111] p-2 text-[10px] leading-relaxed text-[#bbb]">{JSON.stringify(selectedUsage.length === 1 ? selectedUsage[0] : selectedUsage, null, 2)}</pre></div>}
                  {!selectedNodeSpan && <div className="text-[10.5px] text-[#666]">Waiting for this node's trace data.</div>}
                  <button type="button" onClick={() => { setShowTrace(true); if (selectedNodeSpan) setExpandedSpanId(selectedNodeSpan.id); }} className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-[#363636] text-[10px] text-[#aaa] hover:text-white"><ListTree size={11} /> Open raw trace</button>
                </div>
              </section>
            )}

            {nestedPause && (
              <div className="rounded-lg border border-[#3b4654] bg-[#1b222b] p-3">
                <div className="text-[10px] font-semibold uppercase text-[#8ca5c2]">Paused in subflow</div>
                <div className="mt-1 text-[11.5px] text-[#c3ceda]">The parent run is waiting for a nested workflow at <span className="font-mono text-white">{nestedPause.parentNodeId}</span>.</div>
                <div className="mt-2 grid grid-cols-[70px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10px] text-[#73869a]">
                  <span>Leaf status</span><span className="truncate text-[#b9c7d6]">{nestedPause.leafStatus.replaceAll('_', ' ')}</span>
                  <span>Child run</span><span className="truncate font-mono text-[#b9c7d6]" title={nestedPause.childRunId}>{nestedPause.childRunId}</span>
                  <span>Leaf run</span><span className="truncate font-mono text-[#b9c7d6]" title={nestedPause.leafRunId}>{nestedPause.leafRunId}</span>
                  {run.pendingApproval?.nested?.leafNodeId && <><span>Leaf node</span><span className="truncate font-mono text-[#b9c7d6]" title={run.pendingApproval.nested.leafNodeId}>{run.pendingApproval.nested.leafNodeId}</span></>}
                </div>
              </div>
            )}
            {run.debugPause && (
              <div className="rounded-lg border border-red-900/60 bg-[#24191b] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase text-red-300">Paused before node</div>
                    <button type="button" onClick={() => onFocusNode?.(run.debugPause!.nodeId)} className="mt-1 max-w-full truncate text-left text-[13px] font-medium text-white hover:text-red-200" title={run.debugPause.nodeId}>{run.debugPause.nodeId}</button>
                    {run.debugPause.lastNodeId && <div className="mt-1 text-[10.5px] text-[#927d80]">Previous: {run.debugPause.lastNodeId}</div>}
                  </div>
                  <span className="shrink-0 text-[9.5px] text-[#927d80]">{new Date(run.debugPause.pausedAt).toLocaleTimeString()}</span>
                </div>
                {debugActionError && <div className="mt-2 text-[11px] text-red-300">{debugActionError}</div>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="min-w-0">
                    <div className="mb-1 text-[9px] font-semibold uppercase text-[#8f7a7d]">State</div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-[#151111] p-2 text-[10px] leading-relaxed text-[#d6c8ca]">{JSON.stringify(run.debugPause.state, null, 2)}</pre>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 text-[9px] font-semibold uppercase text-[#8f7a7d]">Node outputs</div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-[#151111] p-2 text-[10px] leading-relaxed text-[#d6c8ca]">{JSON.stringify(run.debugPause.nodeOutputs, null, 2)}</pre>
                  </div>
                </div>
              </div>
            )}

            {run.status !== 'idle' && (
              <div className="rounded-lg border border-[#303030] bg-[#202020] p-2">
                <div className="grid grid-cols-5 gap-1">
                {[
                  ['Input', run.usage.inputTokens],
                  ['Output', run.usage.outputTokens],
                  ['Models', run.usage.llmCalls],
                  ['Tools', run.usage.toolCalls],
                  ['Time', durationMs === null ? '...' : durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`],
                ].map(([label, value]) => (
                  <div key={String(label)} className="min-w-0 text-center">
                    <div className="truncate text-[9px] uppercase text-[#666]">{label}</div>
                    <div className="mt-0.5 truncate text-[11px] font-medium text-[#d4d4d4]">{value}</div>
                  </div>
                ))}
                </div>
                {(usageCost || usageDetails.length > 0) && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#303030] pt-2 text-[9.5px] text-[#888]">
                    {usageCost && <span title={usageCost.detail}>Estimated cost <strong className={usageCost.status === 'unpriced' ? 'font-medium text-amber-300' : 'font-medium text-[#ddd]'}>{usageCost.value}</strong></span>}
                    {usageDetails.map((item) => <span key={item.label}>{item.label} <strong className="font-medium text-[#bbb]">{item.value.toLocaleString()}</strong></span>)}
                  </div>
                )}
              </div>
            )}

            {showTrace && (
              <div className="mt-1 rounded-lg border border-[#303030] bg-[#181818] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#303030]">
                  <span className="flex items-center gap-2 text-[#a1a1aa] text-[11px] font-semibold uppercase tracking-wide">
                    Trace
                    {isActive && <span className="flex items-center gap-1 text-[8px] text-cyan-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />Live</span>}
                  </span>
                  <span className="text-[8px] text-[#666]">{traceSpans.length} spans</span>
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-[#252525]">
                  {traceSpans.map((span) => {
                    let depth = 0;
                    let parentId = span.parentId;
                    while (parentId && depth < 6) { depth += 1; parentId = traceSpans.find((candidate) => candidate.id === parentId)?.parentId; }
                    const startedAt = new Date(span.startedAt).getTime();
                    const endedAt = span.endedAt ? new Date(span.endedAt).getTime() : now;
                    const duration = Math.max(0, endedAt - startedAt);
                    const timelineLeft = Math.max(0, Math.min(100, ((startedAt - traceStart) / traceDuration) * 100));
                    const timelineWidth = Math.max(1.5, Math.min(100 - timelineLeft, (duration / traceDuration) * 100));
                    const expanded = expandedSpanId === span.id;
                    const childRunId = typeof span.data?.childRunId === 'string' ? span.data.childRunId : null;
                    return <React.Fragment key={span.id}><button type="button" onClick={() => { setExpandedSpanId(expanded ? null : span.id); if (span.nodeId) onFocusNode?.(span.nodeId); }} className={`block w-full px-3 py-2 text-left hover:bg-[#202020] ${expanded ? 'bg-[#202020]' : ''}`}><div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 12}px` }}><span className={`h-1.5 w-1.5 rounded-full ${span.status === 'ok' ? 'bg-green-400' : span.status === 'error' ? 'bg-red-400' : span.status === 'cancelled' ? 'bg-[#777]' : 'bg-blue-400'}`} /><span className="w-12 text-[8px] font-semibold uppercase text-[#666]">{span.type}</span><span className="min-w-0 flex-1 truncate text-[10.5px] text-[#ccc]">{span.name}</span><span className="text-[9px] text-[#666]">{span.endedAt ? (duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`) : 'running'}</span>{expanded ? <ChevronUp size={10} className="text-[#666]" /> : <ChevronDown size={10} className="text-[#666]" />}</div><div className="relative mt-1.5 ml-5 h-1 overflow-hidden rounded bg-[#252525]"><span className={`absolute top-0 h-full rounded ${span.status === 'error' ? 'bg-red-400/70' : span.type === 'llm' ? 'bg-cyan-400/70' : span.type === 'tool' ? 'bg-amber-400/70' : 'bg-[#8f8f8f]'}`} style={{ left: `${timelineLeft}%`, width: `${timelineWidth}%` }} /></div></button>{expanded && <><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all border-t border-[#252525] bg-[#111] p-3 text-[10px] leading-relaxed text-[#aaa]">{JSON.stringify({ status: span.status, startedAt: span.startedAt, endedAt: span.endedAt, ...(span.data ?? {}) }, null, 2)}</pre>{childRunId && <div className="border-t border-[#252525] bg-[#171717] px-3 py-2"><button type="button" onClick={() => openRunHistory(childRunId)} className="flex w-full items-center justify-between rounded-md border border-[#343434] bg-[#202020] px-2.5 py-2 text-left text-[10.5px] text-[#ccc] hover:border-[#555] hover:text-white"><span className="min-w-0 truncate">Inspect child run <span className="font-mono text-[#888]">{childRunId}</span></span><ChevronRight size={12} className="shrink-0" /></button></div>}</>}</React.Fragment>;
                  })}
                  {traceSpans.length === 0 && <div className="px-3 py-4 text-[#666] text-[11px]">Materialized spans will appear as the run advances.</div>}
                  <button type="button" onClick={() => setShowRawEvents((value) => !value)} className="flex w-full items-center justify-between bg-[#202020] px-3 py-1.5 text-[8px] font-semibold uppercase text-[#666] hover:text-[#aaa]"><span>Raw events ({visibleRawEvents.length})</span>{showRawEvents ? <ChevronUp size={10} /> : <ChevronDown size={10} />}</button>
                  {showRawEvents && visibleRawEvents.map((event, index) => {
                    const eventKey = `${event.type}-${event.at}-${index}`;
                    const expanded = expandedEventKey === eventKey;
                    const payload = Object.fromEntries(Object.entries(event).filter(([key]) => !['type', 'at', 'runId'].includes(key)));
                    const summary = 'nodeId' in event ? event.nodeId : 'tool' in event ? event.tool : 'error' in event ? event.error : '';
                    return (
                    <button type="button" key={eventKey} onClick={() => setExpandedEventKey(expanded ? null : eventKey)} className="block w-full px-3 py-2 text-left hover:bg-[#202020]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#d4d4d4] text-[11px] font-mono">{event.type}</span>
                        <div className="flex items-center gap-1 text-[#666] text-[10px]">
                          <span>{event.at ? new Date(event.at).toLocaleTimeString() : ''}</span>
                          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        </div>
                      </div>
                      <div className="text-[#777] text-[10px] mt-0.5 truncate">
                        {String(summary)}
                      </div>
                      {expanded && (
                        <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded bg-[#111] p-2 text-[10px] leading-relaxed text-[#aaa]">{JSON.stringify(payload, null, 2)}</pre>
                      )}
                    </button>
                  );})}
                  {showRawEvents && visibleRawEvents.length === 0 && (
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
            {Object.keys(run.state).length > 0 && (
              <div className="mt-1">
                <div className="text-[#8a8a8a] text-[11px] font-semibold uppercase tracking-wide mb-1.5">State</div>
                <pre className="overflow-x-auto bg-[#222] rounded-lg p-3 text-[#d4d4d4] text-[11.5px] leading-relaxed">{JSON.stringify(run.state, null, 2)}</pre>
              </div>
            )}
          </div>

          {/* approval bar */}
          {requiredProviders.length > 0 && (
            <div className="px-5 py-4 border-t border-[#2b2b2b] flex flex-col gap-3">
              <div className="text-white text-[13px]">Provider credentials are required to continue this run.</div>
              <div className="rounded-lg border border-[#5a4320] bg-[#2b2115] p-2.5 text-[11.5px] text-[#e6c98e]">
                Required: {requiredProviders.join(', ')}
              </div>
              <div className="text-[#8a8a8a] text-[11.5px]">Add or update the provider keys in Settings. Keys are sent only with the retry request.</div>
              {run.error && <div className="text-[11.5px] text-red-300">{run.error}</div>}
              {run.status === 'awaiting_credentials' ? (
                <button
                  type="button"
                  disabled={resumingCredentials}
                  onClick={() => void resumeCredentials()}
                  className="h-9 rounded-lg bg-white text-black text-[13px] font-medium hover:bg-gray-100 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {resumingCredentials ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} className="fill-current" />}
                  Retry with configured credentials
                </button>
              ) : (
                <div className="text-[11.5px] text-[#d4b978]">After adding credentials, retry the pending approval or client-tool action below.</div>
              )}
            </div>
          )}
          {run.pendingApproval && (
            <div className="px-5 py-4 border-t border-[#2b2b2b] flex flex-col gap-3">
              <div className="text-white text-[13px] whitespace-pre-wrap">{run.pendingApproval.message}</div>
              {run.pendingApproval.expiresAt && (
                <div className="text-[#d6a86b] text-[11.5px]">
                  Expires in {Math.max(0, Math.ceil((new Date(run.pendingApproval.expiresAt).getTime() - now) / 1000))}s
                </div>
              )}
              {run.pendingApproval.toolCall && (
                <div className="text-[#8a8a8a] text-[11.5px] font-mono bg-[#222] rounded-lg p-2">
                  {run.pendingApproval.toolCall.tool}({JSON.stringify(run.pendingApproval.toolCall.arguments)})
                </div>
              )}
              {run.pendingApproval.kind === 'client_tool' ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    rows={3}
                    value={clientResultText}
                    onChange={(event) => setClientResultText(event.target.value)}
                    placeholder="Client tool result (plain text or JSON)"
                    className="w-full resize-y rounded-lg border border-[#333] bg-[#222] px-3 py-2 text-[12px] text-white outline-none placeholder:text-[#666] focus:border-[#555]"
                  />
                  {clientResultError && <div className="text-[11.5px] text-red-300">{clientResultError}</div>}
                  <button
                    onClick={submitClientResult}
                    className="h-9 rounded-lg bg-white text-black text-[13px] font-medium hover:bg-gray-100"
                  >
                    Submit result
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={rejectionReason}
                    onChange={(event) => setRejectionReason(event.target.value)}
                    placeholder="Reason for rejection (optional)"
                    aria-label="Reason for rejection"
                    className="w-full resize-y rounded-lg border border-[#333] bg-[#222] px-3 py-2 text-[12px] text-white outline-none placeholder:text-[#666] focus:border-[#555]"
                  />
                  <div className="flex items-center gap-2">
                  <button
                    onClick={() => backend.resolveApproval(run.pendingApproval!.id, true)}
                    className="flex-1 h-9 rounded-lg bg-white text-black text-[13px] font-medium flex items-center justify-center gap-1.5 hover:bg-gray-100"
                  >
                    <ThumbsUp size={13} /> Approve
                  </button>
                  <button
                    onClick={() => backend.resolveApproval(run.pendingApproval!.id, false, rejectionReason)}
                    className="flex-1 h-9 rounded-lg bg-[#2b2b2b] text-white text-[13px] font-medium flex items-center justify-center gap-1.5 hover:bg-[#3a3a3a]"
                  >
                    <ThumbsDown size={13} /> Reject
                  </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default RunPanel;
