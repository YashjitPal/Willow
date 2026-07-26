import React from 'react';
import { createPortal } from 'react-dom';
import { Bot, Check, CircleAlert, Eye, Loader2, MessageSquare, Paperclip, Play, Send, Square, StepForward, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { useUserDataContext } from '../../context/UserDataContext';
import { getAgentBuilderClient, type ChatThread, type JsonValue, type Run, type RunAttachment, type RunStatus, type WorkflowVersion } from '../../lib/agentBuilder';
import { requestedRunHistoryRunId, runHistoryPanelOpen } from '../../lib/stores/agent-builder-store';
import { trapDialogFocus } from '../../lib/dialogFocus';

type Deployment = {
  selection: 'latest' | 'pinned' | 'draft';
  source: 'published' | 'draft';
  requestedVersion: number | 'latest';
  resolvedVersion: number;
  resolvedAt: string;
};

type PreviewSession = {
  id: string;
  workflowVersion: number;
  status: string;
  expiresAt: string;
  deployment: Deployment;
};

const CHAT_ATTACHMENT_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'audio/aac', 'audio/flac', 'audio/mp3', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-wav',
  'video/3gpp', 'video/avi', 'video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm', 'video/x-flv', 'video/x-ms-wmv', 'video/x-msvideo',
  'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const ACTIVE_RUN_STATUSES = new Set<RunStatus>([
  'queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug',
]);
const PAUSED_RUN_STATUSES = new Set<RunStatus>([
  'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug',
]);

function runStatusLabel(status: RunStatus): string {
  return status.replaceAll('_', ' ');
}

function runStatusTone(status: RunStatus): string {
  if (status === 'completed') return 'border-green-400/30 bg-green-400/10 text-green-200';
  if (status === 'failed') return 'border-red-400/30 bg-red-400/10 text-red-200';
  if (status === 'cancelled') return 'border-[#555] bg-[#292929] text-[#aaa]';
  if (PAUSED_RUN_STATUSES.has(status)) return 'border-amber-400/30 bg-amber-400/10 text-amber-200';
  return 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200';
}

async function toRunAttachment(file: File): Promise<RunAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const mimeType = file.type.toLowerCase().split(';')[0].trim();
  return {
    name: file.name,
    mimeType,
    contentBase64: btoa(binary),
    kind: mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : 'document',
    bytes: bytes.length,
  };
}

export const ChatPreviewPanel: React.FC<{
  open: boolean;
  workflowId: string;
  latestVersion: number;
  onClose: () => void;
}> = ({ open, workflowId, latestVersion, onClose }) => {
  const { apiKeys } = useUserDataContext();
  const [versions, setVersions] = React.useState<WorkflowVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = React.useState<number>(-1);
  const [session, setSession] = React.useState<PreviewSession | null>(null);
  const [clientSecret, setClientSecret] = React.useState('');
  const [thread, setThread] = React.useState<ChatThread | null>(null);
  const [message, setMessage] = React.useState('');
  const [attachments, setAttachments] = React.useState<RunAttachment[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const previouslyFocused = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); else trapDialogFocus(event, 'chat-preview-dialog-title'); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);
  const [activeRun, setActiveRun] = React.useState<Run | null>(null);
  const [runsById, setRunsById] = React.useState<Record<string, Run>>({});
  const [runAction, setRunAction] = React.useState<'approve' | 'reject' | 'client-tool' | 'credentials' | 'debug-step' | 'debug-continue' | null>(null);
  const [clientToolResult, setClientToolResult] = React.useState('');
  const [clientToolError, setClientToolError] = React.useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const runPollGeneration = React.useRef(0);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    getAgentBuilderClient(apiKeys).listVersions(workflowId)
      .then(({ versions: items }) => { if (!cancelled) setVersions(items); })
      .catch((reason) => { if (!cancelled) setError((reason as Error).message); });
    return () => { cancelled = true; };
  }, [apiKeys, open, workflowId, latestVersion]);

  React.useEffect(() => {
    if (!open) {
      runPollGeneration.current += 1;
      setSession(null);
      setClientSecret('');
      setThread(null);
      setMessage('');
      setAttachments([]);
      setActiveRun(null);
      setRunsById({});
      setRunAction(null);
      setClientToolResult('');
      setClientToolError(null);
      setRejectionReason('');
      setError(null);
    }
  }, [open]);

  const startSession = async () => {
    setBusy(true);
    setError(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const created = await client.createChatSession({ workflowId, version: selectedVersion, user: 'builder-preview' });
      const nextSession = created.session as unknown as PreviewSession;
      const nextThread = await client.createThread(nextSession.id, created.client_secret);
      setSession(nextSession);
      setClientSecret(created.client_secret);
      setThread(nextThread.thread);
      setActiveRun(null);
      setRunsById({});
      setClientToolResult('');
      setClientToolError(null);
      setRejectionReason('');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancelSession = async () => {
    if (!session || !clientSecret) return;
    setBusy(true);
    setError(null);
    try {
      await getAgentBuilderClient(apiKeys).cancelChatSession(session.id, clientSecret);
      setSession((current) => current ? { ...current, status: 'cancelled' } : current);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rememberRun = (run: Run) => {
    setActiveRun(run);
    setRunsById((current) => ({ ...current, [run.id]: run }));
  };

  const pollRun = async (client: ReturnType<typeof getAgentBuilderClient>, runId: string, secret: string) => {
    const generation = ++runPollGeneration.current;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (runPollGeneration.current !== generation) return;
      const response = await client.getRun(runId, secret);
      if (runPollGeneration.current !== generation) return;
      rememberRun(response.run);
      const currentThread = thread?.id ? await client.getThread(thread.id, secret) : null;
      if (currentThread && runPollGeneration.current === generation) setThread(currentThread.thread);
      const status = response.run.status;
      if (!ACTIVE_RUN_STATUSES.has(status) || PAUSED_RUN_STATUSES.has(status)) return;
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
  };

  const sendMessage = async () => {
    const text = message.trim();
    const paused = activeRun ? PAUSED_RUN_STATUSES.has(activeRun.status) : false;
    if ((!text && attachments.length === 0) || !thread || !clientSecret || sending || paused) return;
    const outgoingAttachments = attachments;
    setSending(true);
    setError(null);
    setMessage('');
    setAttachments([]);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const sent = await client.sendChatMessage(thread.id, text, clientSecret, crypto.randomUUID(), outgoingAttachments);
      setThread(sent.thread);
      rememberRun(sent.run);
      await pollRun(client, sent.run.id, clientSecret);
    } catch (reason) {
      setMessage(text);
      setAttachments(outgoingAttachments);
      setError((reason as Error).message);
    } finally {
      setSending(false);
    }
  };

  const addAttachments = async (files: FileList | File[]) => {
    const incoming = Array.from(files);
    if (attachments.length + incoming.length > 8) {
      setError('A chat message can include up to 8 attachments.');
      return;
    }
    const unsupported = incoming.find((file) => !CHAT_ATTACHMENT_TYPES.has(file.type.toLowerCase().split(';')[0].trim()));
    if (unsupported) {
      setError(`Unsupported attachment type for ${unsupported.name}.`);
      return;
    }
    const oversized = incoming.find((file) => file.size > 5 * 1024 * 1024);
    if (oversized) {
      setError(`${oversized.name} exceeds the 5 MB attachment limit.`);
      return;
    }
    const totalBytes = attachments.reduce((sum, attachment) => sum + (attachment.bytes ?? 0), 0) + incoming.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 20 * 1024 * 1024) {
      setError('Chat message attachments exceed 20 MB total.');
      return;
    }
    setError(null);
    const converted = await Promise.all(incoming.map(toRunAttachment));
    setAttachments((current) => [...current, ...converted]);
  };

  const inspectRun = (runId: string) => {
    requestedRunHistoryRunId.set(runId);
    runHistoryPanelOpen.set(true);
  };

  const resolvePendingApproval = async (approved: boolean) => {
    if (!activeRun?.pendingApproval || !clientSecret || runAction) return;
    const approval = activeRun.pendingApproval;
    setRunAction(approved ? 'approve' : 'reject');
    setError(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const response = await client.resolveApproval(activeRun.id, approval.id, approved, clientSecret, crypto.randomUUID(), approved ? undefined : rejectionReason);
      rememberRun(response.run);
      setRejectionReason('');
      await pollRun(client, response.run.id, clientSecret);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setRunAction(null);
    }
  };

  const submitClientToolResult = async () => {
    if (!activeRun?.pendingApproval || !clientSecret || runAction) return;
    const raw = clientToolResult.trim();
    if (!raw) {
      setClientToolError('Enter the result returned by the client tool.');
      return;
    }
    let result: JsonValue = raw;
    try {
      result = JSON.parse(raw) as JsonValue;
    } catch {
      // Plain text is a valid client-tool result.
    }
    const approval = activeRun.pendingApproval;
    setRunAction('client-tool');
    setClientToolError(null);
    setError(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const response = await client.submitClientToolResult(activeRun.id, approval.id, result, clientSecret, crypto.randomUUID());
      setClientToolResult('');
      rememberRun(response.run);
      await pollRun(client, response.run.id, clientSecret);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setRunAction(null);
    }
  };

  const resumeCredentials = async () => {
    if (!activeRun || !clientSecret || runAction) return;
    setRunAction('credentials');
    setError(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const response = await client.resumeRun(activeRun.id, clientSecret);
      rememberRun(response.run);
      await pollRun(client, response.run.id, clientSecret);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setRunAction(null);
    }
  };

  const resumeDebugger = async (mode: 'step' | 'continue') => {
    if (!activeRun || !clientSecret || runAction) return;
    setRunAction(mode === 'step' ? 'debug-step' : 'debug-continue');
    setError(null);
    try {
      const client = getAgentBuilderClient(apiKeys);
      const response = mode === 'step'
        ? await client.stepDebugRun(activeRun.id, clientSecret)
        : await client.continueDebugRun(activeRun.id, clientSecret);
      rememberRun(response.run);
      await pollRun(client, response.run.id, clientSecret);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setRunAction(null);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="chat-preview-dialog-title" className="flex h-[min(720px,calc(100vh-32px))] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[#333] bg-[#171717] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#303030] px-5 py-4">
          <div>
            <h2 id="chat-preview-dialog-title" className="text-[15px] font-semibold text-white">Chat preview</h2>
            <p className="mt-1 text-[11px] text-[#888]">Test a pinned deployment as a multi-turn conversation.</p>
          </div>
          <button type="button" onClick={onClose} title="Close chat preview" className="text-[#888] hover:text-white"><X size={17} /></button>
        </div>

        {!session ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="w-full max-w-md">
              <label className="text-[11px] font-medium uppercase text-[#888]">Deployment</label>
              <select value={selectedVersion} onChange={(event) => setSelectedVersion(Number(event.target.value))} className="mt-2 h-10 w-full rounded-md border border-[#3a3a3a] bg-[#202020] px-3 text-[12px] text-white outline-none focus:border-[#666]">
                <option value={-1} disabled={latestVersion === 0}>Latest published{latestVersion > 0 ? ` (v${latestVersion})` : ' (publish required)'}</option>
                {versions.map((version) => <option key={version.version} value={version.version}>Pinned version {version.version}</option>)}
                <option value={0}>Draft preview (mutable)</option>
              </select>
              <div className="mt-3 border-l-2 border-[#444] pl-3 text-[11px] leading-relaxed text-[#999]">
                {selectedVersion === 0
                  ? 'Draft preview runs the current autosaved graph. Use a published version to verify an immutable deployment.'
                  : selectedVersion === -1
                    ? `The session will resolve latest to version ${latestVersion} and remain pinned to it.`
                    : `This session will remain pinned to published version ${selectedVersion}.`}
              </div>
              {error && <div className="mt-3 text-[11px] text-red-300">{error}</div>}
              <button type="button" disabled={busy || (selectedVersion === -1 && latestVersion === 0)} onClick={() => void startSession()} className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-white text-[12px] font-medium text-black disabled:opacity-40">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                Start session
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#292929] bg-[#1d1d1d] px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-[#999]">
                <span className="text-white">{session.deployment.source === 'draft' ? 'Draft preview' : `Published v${session.deployment.resolvedVersion}`}</span>
                <span>{session.deployment.selection === 'latest' ? 'Resolved from latest' : session.deployment.selection === 'pinned' ? 'Explicitly pinned' : 'Mutable draft'}</span>
                <span>Expires {new Date(session.expiresAt).toLocaleTimeString()}</span>
                {activeRun && <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] capitalize ${runStatusTone(activeRun.status)}`}>
                  {ACTIVE_RUN_STATUSES.has(activeRun.status) && <Loader2 size={10} className="animate-spin" />}
                  {activeRun.status === 'completed' && <Check size={10} />}
                  {['failed', 'cancelled'].includes(activeRun.status) && <CircleAlert size={10} />}
                  {runStatusLabel(activeRun.status)}
                </span>}
              </div>
              <button type="button" disabled={busy || session.status !== 'active'} onClick={() => void cancelSession()} className="flex h-8 items-center gap-1.5 rounded-md border border-[#444] px-2.5 text-[11px] text-[#ccc] hover:border-red-400/50 hover:text-red-300 disabled:opacity-40">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Square size={11} />}
                Cancel session
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {thread?.messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center text-[#777]">
                  <Bot size={22} />
                  <div className="mt-2 text-[12px]">Send a message to start the conversation.</div>
                </div>
              )}
              <div className="space-y-4">
                {thread?.messages.map((item) => {
                  const isUser = item.role === 'user';
                  const messageRun = item.runId ? runsById[item.runId] : undefined;
                  const status = messageRun?.status;
                  const isThinking = item.status === 'in_progress' || (status ? ACTIVE_RUN_STATUSES.has(status) : false);
                  return (
                    <div key={item.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[78%] whitespace-pre-wrap rounded-md px-3 py-2 text-[12px] leading-relaxed ${isUser ? 'bg-white text-black' : 'border border-[#333] bg-[#222] text-[#eee]'}`}>
                        {item.attachments?.length ? <div className="mb-1.5 flex flex-wrap gap-1">{item.attachments.map((attachment) => <span key={`${attachment.name}-${attachment.sha256 ?? attachment.bytes ?? 0}`} className={`rounded px-1.5 py-0.5 text-[9.5px] ${isUser ? 'bg-black/10 text-black/70' : 'bg-black/30 text-[#bbb]'}`}>{attachment.name}</span>)}</div> : null}
                        {item.content || (isThinking ? 'Thinking...' : '')}
                        {item.role === 'assistant' && item.runId && (
                          <div className="mt-2 flex items-center gap-2 text-[#888]">
                            {status && <span className="capitalize">{runStatusLabel(status)}</span>}
                            <button type="button" onClick={() => inspectRun(item.runId!)} className="inline-flex items-center gap-1 text-[10px] hover:text-white" title="Inspect run trace">
                              <Eye size={11} /> Inspect trace
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-[#303030] p-4">
              {activeRun && PAUSED_RUN_STATUSES.has(activeRun.status) && (
                <div className="mb-3 rounded-md border border-amber-400/25 bg-amber-400/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium capitalize text-amber-100">
                      <CircleAlert size={13} /> {runStatusLabel(activeRun.status)}
                    </div>
                    <button type="button" onClick={() => inspectRun(activeRun.id)} className="inline-flex shrink-0 items-center gap-1 text-[10px] text-[#aaa] hover:text-white" title="Inspect run trace"><Eye size={11} /> Trace</button>
                  </div>
                  {activeRun.nestedWait && (
                    <div className="mt-2 rounded border border-[#3b4654] bg-[#1b222b] p-2.5 text-[10px] text-[#9fb1c4]">
                      <div className="font-medium text-[#d5e0ec]">Paused in a nested workflow</div>
                      <div className="mt-1">Leaf status: {activeRun.nestedWait.leafStatus.replaceAll('_', ' ')}</div>
                      <div className="mt-1 truncate font-mono" title={activeRun.nestedWait.leafRunId}>Leaf run: {activeRun.nestedWait.leafRunId}</div>
                      {activeRun.pendingApproval?.nested?.leafNodeId && <div className="mt-1 truncate font-mono" title={activeRun.pendingApproval.nested.leafNodeId}>Leaf node: {activeRun.pendingApproval.nested.leafNodeId}</div>}
                    </div>
                  )}
                  {activeRun.pendingApproval && (
                    <>
                      <div className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[#ddd]">{activeRun.pendingApproval.message}</div>
                      {activeRun.pendingApproval.toolCall && <div className="mt-2 overflow-auto rounded bg-[#171717] p-2 font-mono text-[10px] text-[#aaa]">{activeRun.pendingApproval.toolCall.tool}({JSON.stringify(activeRun.pendingApproval.toolCall.arguments)})</div>}
                      {activeRun.pendingApproval.kind === 'client_tool' ? (
                        <div className="mt-2 space-y-2">
                          <textarea value={clientToolResult} onChange={(event) => { setClientToolResult(event.target.value); setClientToolError(null); }} rows={2} placeholder="Client tool result (text or JSON)" className="w-full resize-y rounded border border-[#393939] bg-[#202020] px-2.5 py-2 text-[11px] text-white outline-none placeholder:text-[#666] focus:border-[#666]" />
                          {clientToolError && <div className="text-[10.5px] text-red-300">{clientToolError}</div>}
                          <button type="button" disabled={runAction !== null} onClick={() => void submitClientToolResult()} className="flex h-8 w-full items-center justify-center gap-1.5 rounded bg-white text-[11px] font-medium text-black disabled:opacity-40">
                            {runAction === 'client-tool' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Submit result
                          </button>
                        </div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          <textarea
                            value={rejectionReason}
                            onChange={(event) => setRejectionReason(event.target.value)}
                            rows={2}
                            maxLength={2000}
                            placeholder="Reason for rejection (optional)"
                            aria-label="Reason for rejection"
                            className="w-full resize-y rounded border border-[#393939] bg-[#202020] px-2.5 py-2 text-[11px] text-white outline-none placeholder:text-[#666] focus:border-[#666]"
                          />
                          <div className="flex gap-2">
                          <button type="button" disabled={runAction !== null} onClick={() => void resolvePendingApproval(true)} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded bg-white text-[11px] font-medium text-black disabled:opacity-40">
                            {runAction === 'approve' ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />} Approve
                          </button>
                          <button type="button" disabled={runAction !== null} onClick={() => void resolvePendingApproval(false)} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded border border-[#444] bg-[#252525] text-[11px] font-medium text-[#ddd] disabled:opacity-40">
                            {runAction === 'reject' ? <Loader2 size={12} className="animate-spin" /> : <ThumbsDown size={12} />} Reject
                          </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {activeRun.status === 'awaiting_credentials' && (
                    <div className="mt-2 space-y-2">
                      <div className="text-[10.5px] text-[#bbb]">Required providers: {(activeRun.credentialRequirements?.providers ?? []).join(', ') || 'configured credentials'}</div>
                      <button type="button" disabled={runAction !== null} onClick={() => void resumeCredentials()} className="flex h-8 w-full items-center justify-center gap-1.5 rounded bg-white text-[11px] font-medium text-black disabled:opacity-40">
                        {runAction === 'credentials' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Retry with credentials
                      </button>
                    </div>
                  )}
                  {activeRun.status === 'awaiting_debug' && (
                    <div className="mt-2 space-y-2">
                      <div className="text-[10.5px] leading-relaxed text-[#bbb]">This run is paused at a debugger breakpoint.</div>
                      {activeRun.debugPause && <div className="truncate font-mono text-[10px] text-[#888]" title={activeRun.debugPause.nodeId}>Paused before: {activeRun.debugPause.nodeId}</div>}
                      <div className="flex gap-2">
                        <button type="button" disabled={runAction !== null} onClick={() => void resumeDebugger('step')} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded border border-[#444] bg-[#252525] text-[11px] font-medium text-[#ddd] disabled:opacity-40">
                          {runAction === 'debug-step' ? <Loader2 size={12} className="animate-spin" /> : <StepForward size={12} />} Step
                        </button>
                        <button type="button" disabled={runAction !== null} onClick={() => void resumeDebugger('continue')} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded bg-white text-[11px] font-medium text-black disabled:opacity-40">
                          {runAction === 'debug-continue' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Continue
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {error && <div className="mb-2 text-[11px] text-red-300">{error}</div>}
              {attachments.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`} className="flex items-center gap-1 rounded-md border border-[#383838] bg-[#222] px-2 py-1 text-[10px] text-[#bbb]"><span className="max-w-44 truncate">{attachment.name}</span><button type="button" title={`Remove ${attachment.name}`} aria-label={`Remove ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-[#777] hover:text-white"><X size={10} /></button></span>)}</div>}
              <div className="flex gap-2">
                <input ref={fileInputRef} type="file" multiple className="hidden" accept="image/png,image/jpeg,image/webp,image/gif,audio/*,video/*,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { if (event.target.files) void addAttachments(event.target.files); event.target.value = ''; }} />
                <button type="button" title="Attach files" aria-label="Attach files" disabled={sending || session.status !== 'active' || (activeRun ? PAUSED_RUN_STATUSES.has(activeRun.status) : false)} onClick={() => fileInputRef.current?.click()} className="flex w-11 shrink-0 items-center justify-center rounded-md border border-[#393939] bg-[#202020] text-[#aaa] hover:text-white disabled:opacity-40"><Paperclip size={15} /></button>
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} disabled={sending || session.status !== 'active' || (activeRun ? PAUSED_RUN_STATUSES.has(activeRun.status) : false)} rows={2} placeholder={session.status === 'active' ? (activeRun && PAUSED_RUN_STATUSES.has(activeRun.status) ? 'Resolve the pending run action first' : 'Message the deployed workflow') : 'Session cancelled'} className="min-h-11 flex-1 resize-none rounded-md border border-[#393939] bg-[#202020] px-3 py-2 text-[12px] text-white outline-none focus:border-[#666] disabled:opacity-50" />
                <button type="button" title="Send message" disabled={(!message.trim() && attachments.length === 0) || sending || session.status !== 'active' || (activeRun ? PAUSED_RUN_STATUSES.has(activeRun.status) : false)} onClick={() => void sendMessage()} className="flex w-11 shrink-0 items-center justify-center rounded-md bg-white text-black disabled:opacity-40">
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default ChatPreviewPanel;
