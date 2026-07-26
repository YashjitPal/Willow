import React from 'react';
import { CheckCircle2, Loader2, MessageSquarePlus, RefreshCw, Reply, Users, X } from 'lucide-react';
import { useUserDataContext } from '../../context/UserDataContext';
import {
  getAgentBuilderClient,
  type WorkflowCollaborationStreamEvent,
  type WorkflowPresence,
  type WorkflowReviewThread,
} from '../../lib/agentBuilder';

interface Props {
  open: boolean;
  workflowId: string;
  selectedNodeIds: string[];
  cursor?: { x: number; y: number };
  onStateChange?: (state: { threads: WorkflowReviewThread[]; presence: WorkflowPresence[]; localClientId: string }) => void;
  onFocusNode: (nodeId: string) => void;
  onClose: () => void;
}

const PRESENCE_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fb7185', '#fbbf24', '#60a5fa'];

function upsertThread(threads: WorkflowReviewThread[], thread: WorkflowReviewThread): WorkflowReviewThread[] {
  return [thread, ...threads.filter((item) => item.id !== thread.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function upsertPresence(current: WorkflowPresence[], presence: WorkflowPresence): WorkflowPresence[] {
  return [...current.filter((item) => !(item.clientId === presence.clientId && item.collaborator.subjectId === presence.collaborator.subjectId)), presence];
}

export const CollaborationPanel: React.FC<Props> = ({ open, workflowId, selectedNodeIds, cursor, onStateChange, onFocusNode, onClose }) => {
  const { apiKeys } = useUserDataContext();
  const [threads, setThreads] = React.useState<WorkflowReviewThread[]>([]);
  const [presence, setPresence] = React.useState<WorkflowPresence[]>([]);
  const [body, setBody] = React.useState('');
  const [replyByThread, setReplyByThread] = React.useState<Record<string, string>>({});
  const [includeResolved, setIncludeResolved] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const clientIdRef = React.useRef(`builder_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`);
  const colorRef = React.useRef(PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)]);
  const selectionRef = React.useRef(selectedNodeIds);
  selectionRef.current = selectedNodeIds;
  const cursorRef = React.useRef(cursor);
  cursorRef.current = cursor;

  React.useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  React.useEffect(() => {
    onStateChange?.({ threads, presence, localClientId: clientIdRef.current });
  }, [onStateChange, presence, threads]);

  React.useEffect(() => {
    const client = getAgentBuilderClient(apiKeys);
    setThreads([]);
    setPresence([]);
    setError(null);
    const stop = client.streamWorkflowCollaboration(workflowId, (event: WorkflowCollaborationStreamEvent) => {
      if (event.type === 'collaboration.snapshot') {
        setThreads([...event.threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        setPresence(event.presence);
      } else if (event.type === 'review.created' || event.type === 'review.updated') {
        if (event.thread) setThreads((current) => upsertThread(current, event.thread!));
      } else if (event.type === 'review.deleted') {
        setThreads((current) => current.filter((thread) => thread.id !== event.threadId));
      } else if (event.type === 'presence.updated') {
        if (event.presence) setPresence((current) => upsertPresence(current, event.presence!));
      } else if (event.type === 'presence.left') {
        if (event.presence) setPresence((current) => current.filter((item) => !(item.clientId === event.presence!.clientId && item.collaborator.subjectId === event.presence!.collaborator.subjectId)));
      }
    }, { onError: (reason) => setError(reason.message) });

    const heartbeat = () => {
      const selected = selectionRef.current;
      void client.updateWorkflowPresence(workflowId, {
        clientId: clientIdRef.current,
        color: colorRef.current,
        cursor: cursorRef.current,
        selectedNodeIds: selected,
        activeNodeId: selected.length === 1 ? selected[0] : undefined,
        ttlSeconds: 45,
      }).catch(() => undefined);
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 20_000);
    return () => {
      stop();
      window.clearInterval(timer);
      void client.leaveWorkflowPresence(workflowId, clientIdRef.current).catch(() => undefined);
    };
  }, [apiKeys, workflowId]);

  React.useEffect(() => {
    const selected = selectionRef.current;
    void getAgentBuilderClient(apiKeys).updateWorkflowPresence(workflowId, {
      clientId: clientIdRef.current,
      color: colorRef.current,
      cursor: cursorRef.current,
      selectedNodeIds: selected,
      activeNodeId: selected.length === 1 ? selected[0] : undefined,
      ttlSeconds: 45,
    }).catch(() => undefined);
  }, [apiKeys, selectedNodeIds.join('\0'), workflowId]);

  React.useEffect(() => {
    const selected = selectionRef.current;
    void getAgentBuilderClient(apiKeys).updateWorkflowPresence(workflowId, {
      clientId: clientIdRef.current,
      color: colorRef.current,
      cursor: cursorRef.current,
      selectedNodeIds: selected,
      activeNodeId: selected.length === 1 ? selected[0] : undefined,
      ttlSeconds: 45,
    }).catch(() => undefined);
  }, [apiKeys, cursor?.x, cursor?.y, workflowId]);

  const createThread = async () => {
    if (!body.trim()) return;
    setBusy('create'); setError(null);
    try {
      const anchor = selectedNodeIds.length === 1
        ? { type: 'node' as const, nodeId: selectedNodeIds[0] }
        : { type: 'canvas' as const, x: cursorRef.current?.x ?? 0, y: cursorRef.current?.y ?? 0 };
      const result = await getAgentBuilderClient(apiKeys).createWorkflowReviewThread(workflowId, { body: body.trim(), anchor });
      setThreads((current) => upsertThread(current, result.thread));
      setBody('');
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(null); }
  };

  const reply = async (thread: WorkflowReviewThread) => {
    const value = replyByThread[thread.id]?.trim();
    if (!value) return;
    setBusy(thread.id); setError(null);
    try {
      const result = await getAgentBuilderClient(apiKeys).replyToWorkflowReviewThread(workflowId, thread.id, { body: value, expectedRevision: thread.revision });
      setThreads((current) => upsertThread(current, result.thread));
      setReplyByThread((current) => ({ ...current, [thread.id]: '' }));
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(null); }
  };

  const toggleStatus = async (thread: WorkflowReviewThread) => {
    setBusy(thread.id); setError(null);
    try {
      const result = await getAgentBuilderClient(apiKeys).setWorkflowReviewThreadStatus(workflowId, thread.id, thread.status === 'open' ? 'resolved' : 'open', thread.revision);
      setThreads((current) => upsertThread(current, result.thread));
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(null); }
  };

  if (!open) return null;
  const visibleThreads = threads.filter((thread) => includeResolved || thread.status === 'open');

  return (
    <aside role="dialog" aria-modal="true" aria-label="Workflow review" className="fixed bottom-4 right-4 top-4 z-[94] flex w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-[#303030] bg-[#171717] shadow-2xl">
      <header className="flex items-center justify-between border-b border-[#303030] px-4 py-3">
        <div><div className="flex items-center gap-2 text-[13px] font-semibold text-white"><Users size={15} /> Review</div><div className="mt-0.5 text-[10px] text-[#777]">{presence.length} active collaborator{presence.length === 1 ? '' : 's'}</div></div>
        <button type="button" title="Close review panel" onClick={onClose} className="text-[#777] hover:text-white"><X size={16} /></button>
      </header>
      <div className="flex items-center gap-1.5 border-b border-[#292929] px-4 py-2">
        {presence.slice(0, 8).map((item) => <button key={`${item.collaborator.subjectId}:${item.clientId}`} type="button" title={item.collaborator.displayName ?? item.collaborator.subjectId} onClick={() => item.activeNodeId && onFocusNode(item.activeNodeId)} className="flex h-7 w-7 items-center justify-center rounded-full border-2 bg-[#252525] text-[9px] font-semibold text-white" style={{ borderColor: item.color ?? '#666' }}>{(item.collaborator.displayName ?? item.collaborator.subjectId).slice(0, 2).toUpperCase()}</button>)}
        <label className="ml-auto flex items-center gap-1.5 text-[9.5px] text-[#888]"><input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} /> Resolved</label>
      </div>
      <div className="border-b border-[#292929] p-3">
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={10000} placeholder={selectedNodeIds.length === 1 ? 'Comment on the selected node' : 'Add a workflow review comment'} className="w-full resize-none rounded border border-[#333] bg-[#202020] px-2.5 py-2 text-[11px] text-white outline-none placeholder:text-[#666] focus:border-[#555]" />
        <button type="button" disabled={!body.trim() || busy !== null} onClick={() => void createThread()} className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded bg-white text-[10.5px] font-medium text-black disabled:opacity-40">{busy === 'create' ? <Loader2 size={12} className="animate-spin" /> : <MessageSquarePlus size={12} />} Add comment</button>
      </div>
      {error && <div className="border-b border-red-900/50 bg-red-950/20 px-3 py-2 text-[10px] text-red-300">{error}</div>}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {visibleThreads.map((thread) => {
          const nodeId = thread.anchor.type === 'node' ? thread.anchor.nodeId : undefined;
          return <article key={thread.id} className={`rounded border p-2.5 ${thread.status === 'resolved' ? 'border-[#292929] bg-[#191919] opacity-70' : 'border-[#343434] bg-[#202020]'}`}>
            <div className="flex items-start justify-between gap-2"><button type="button" disabled={!nodeId} onClick={() => nodeId && onFocusNode(nodeId)} className="min-w-0 truncate text-left text-[9.5px] font-semibold text-[#aaa] disabled:cursor-default">{nodeId ? `Node: ${nodeId}` : thread.anchor.type === 'edge' ? `Edge: ${thread.anchor.edgeId}` : 'Workflow canvas'}</button><button type="button" title={thread.status === 'open' ? 'Resolve thread' : 'Reopen thread'} disabled={busy !== null} onClick={() => void toggleStatus(thread)} className="shrink-0 text-[#777] hover:text-white disabled:opacity-40">{busy === thread.id ? <Loader2 size={12} className="animate-spin" /> : thread.status === 'open' ? <CheckCircle2 size={13} /> : <RefreshCw size={12} />}</button></div>
            <div className="mt-2 space-y-2">{thread.messages.map((message) => <div key={message.id}><div className="text-[9px] text-[#666]">{message.author.displayName ?? message.author.subjectId} · {new Date(message.createdAt).toLocaleString()}</div><div className="mt-0.5 whitespace-pre-wrap break-words text-[10.5px] leading-relaxed text-[#ddd]">{message.body}</div></div>)}</div>
            {thread.status === 'open' && <div className="mt-2 flex gap-1.5"><input value={replyByThread[thread.id] ?? ''} onChange={(event) => setReplyByThread((current) => ({ ...current, [thread.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void reply(thread); } }} placeholder="Reply" className="h-7 min-w-0 flex-1 rounded border border-[#333] bg-[#191919] px-2 text-[10px] text-white outline-none" /><button type="button" title="Reply" disabled={!replyByThread[thread.id]?.trim() || busy !== null} onClick={() => void reply(thread)} className="flex h-7 w-7 items-center justify-center rounded border border-[#333] text-[#aaa] hover:text-white disabled:opacity-40"><Reply size={11} /></button></div>}
          </article>;
        })}
        {visibleThreads.length === 0 && <div className="py-10 text-center text-[10.5px] text-[#666]">No review threads.</div>}
      </div>
    </aside>
  );
};

export default CollaborationPanel;
