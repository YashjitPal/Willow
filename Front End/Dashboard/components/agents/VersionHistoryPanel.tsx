import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { Check, History, Loader2, RotateCcw, X } from 'lucide-react';
import { useUserDataContext } from '../../context/UserDataContext';
import { AgentBuilderApiError, getAgentBuilderClient, type WorkflowVersion } from '../../lib/agentBuilder';
import {
  autosaveConflict,
  currentWorkflow,
  requestedWorkflowId,
  saveStatus,
  versionPanelOpen,
} from '../../lib/stores/agent-builder-store';

export const VersionHistoryPanel: React.FC = () => {
  const open = useStore(versionPanelOpen);
  const workflow = useStore(currentWorkflow);
  const { apiKeys } = useUserDataContext();
  const [versions, setVersions] = React.useState<WorkflowVersion[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [restoring, setRestoring] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !workflow) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAgentBuilderClient(apiKeys).listVersions(workflow.id)
      .then((response) => {
        if (!cancelled) setVersions(response.versions);
      })
      .catch((reason) => {
        if (!cancelled) setError((reason as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKeys, open, workflow]);

  if (!open) return null;

  const restore = async (version: number) => {
    if (!workflow) return;
    setRestoring(version);
    setError(null);
    try {
      await getAgentBuilderClient(apiKeys).restoreVersion(workflow.id, version, workflow.draftRevision);
      requestedWorkflowId.set(workflow.id);
      versionPanelOpen.set(false);
    } catch (reason) {
      if (reason instanceof AgentBuilderApiError && reason.status === 409 && reason.code === 'draft_revision_conflict') {
        let currentRevision = workflow.draftRevision;
        try {
          const { workflow: remote } = await getAgentBuilderClient(apiKeys).getWorkflow(workflow.id);
          currentRevision = remote.draftRevision;
        } catch { /* retain the observed revision when the remote cannot be reloaded */ }
        autosaveConflict.set({
          workflowId: workflow.id,
          expectedRevision: workflow.draftRevision,
          currentRevision,
          message: reason.message,
        });
        saveStatus.set('conflict');
        versionPanelOpen.set(false);
        return;
      }
      setError((reason as Error).message);
    } finally {
      setRestoring(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-sm p-6">
      <div className="w-full max-w-lg bg-[#1a1a1a] border border-[#303030] rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#303030]">
          <div>
            <h2 className="text-white text-[16px] font-semibold">Version history</h2>
            <p className="text-[#8a8a8a] text-[12px] mt-1">
              Published versions are immutable. Restore one to replace the current draft.
            </p>
          </div>
          <button
            title="Close version history"
            aria-label="Close version history"
            onClick={() => versionPanelOpen.set(false)}
            className="text-[#8a8a8a] hover:text-white"
          >
            <X size={17} />
          </button>
        </div>

        <div className="p-4 max-h-[480px] overflow-y-auto">
          {loading && (
            <div className="h-28 flex items-center justify-center text-[#888]">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
          {!loading && versions.length === 0 && (
            <div className="h-28 flex flex-col items-center justify-center text-[#777] text-[12px]">
              <History size={18} className="mb-2" />
              Publish the workflow to create version 1.
            </div>
          )}
          <div className="flex flex-col gap-2">
            {versions.map((version) => {
              const current = workflow?.latestVersion === version.version;
              const previous = versions.find((candidate) => candidate.version === version.version - 1);
              const nodeDelta = previous ? version.graph.nodes.length - previous.graph.nodes.length : version.graph.nodes.length;
              const edgeDelta = previous ? version.graph.edges.length - previous.graph.edges.length : version.graph.edges.length;
              const formatDelta = (value: number) => value > 0 ? `+${value}` : String(value);
              return (
                <div
                  key={version.version}
                  className="flex items-center gap-3 rounded-md border border-[#303030] bg-[#202020] px-3 py-3"
                >
                  <div className="w-9 h-9 rounded-md bg-[#2c2c2c] flex items-center justify-center text-white text-[12px] font-semibold">
                    v{version.version}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-[13px]">Published version {version.version}</span>
                      {current && (
                        <span className="flex items-center gap-1 text-green-300 text-[10px]">
                          <Check size={11} />
                          Latest
                        </span>
                      )}
                    </div>
                    <div className="text-[#777] text-[11px] mt-0.5">
                      {new Date(version.publishedAt).toLocaleString()}
                    </div>
                    <div className="mt-1 text-[10.5px] text-[#888]">
                      {version.graph.nodes.length} nodes · {version.graph.edges.length} connections
                      <span className="ml-2 text-[#666]">({formatDelta(nodeDelta)} nodes, {formatDelta(edgeDelta)} connections)</span>
                    </div>
                    {version.notes && (
                      <div className="text-[#aaa] text-[11px] mt-1 whitespace-pre-wrap">{version.notes}</div>
                    )}
                  </div>
                  <button
                    title={`Restore version ${version.version}`}
                    disabled={restoring !== null}
                    onClick={() => restore(version.version)}
                    className="h-8 px-2.5 rounded-md border border-[#3a3a3a] text-[#d4d4d4] hover:text-white text-[11px] flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {restoring === version.version
                      ? <Loader2 size={12} className="animate-spin" />
                      : <RotateCcw size={12} />}
                    Restore
                  </button>
                </div>
              );
            })}
          </div>
          {error && <div className="text-red-300 text-[12px] mt-3">{error}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default VersionHistoryPanel;
