import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { AlertTriangle, CheckCircle2, Crosshair, Loader2, X } from 'lucide-react';
import type { AgentBuilderBackend } from './use-agent-builder-backend';
import type { ValidationIssue } from '@agentbuilder';
import { currentWorkflow, publishDialogOpen, versionPanelOpen } from './agent-builder-store';

const RELEASE_BLOCKING_SAFETY_CODES = new Set([
  'SAFETY_UNTRUSTED_INSTRUCTIONS',
  'SAFETY_MCP_APPROVAL_DISABLED',
  'SAFETY_FREEFORM_OUTPUT_TO_MCP',
  'SAFETY_PRIVILEGED_PATH_UNGUARDED',
]);

export const PublishWorkflowModal: React.FC<{ backend: AgentBuilderBackend; onFocusNode?: (nodeId: string) => void }> = ({ backend, onFocusNode }) => {
  const open = useStore(publishDialogOpen);
  const workflow = useStore(currentWorkflow);
  const [notes, setNotes] = React.useState('');
  const [publishing, setPublishing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setNotes('');
    setError(null);
  }, [open]);

  if (!open || !workflow) return null;

  const safetyIssues = workflow.safetyFindings.map((finding) => ({
      nodeId: finding.nodeId,
      message: finding.message,
      code: finding.code,
      remediation: finding.remediation,
      severity: finding.severity,
      blocksPublish: RELEASE_BLOCKING_SAFETY_CODES.has(finding.code),
    }));
  const blockingSafetyIssues = safetyIssues.filter((issue) => issue.blocksPublish);
  const advisoryWarnings = [
    ...workflow.warningIssues.map((issue) => ({ ...issue, blocksPublish: false })),
    ...safetyIssues.filter((issue) => !issue.blocksPublish),
  ];
  const publishBlocked = !workflow.valid || blockingSafetyIssues.length > 0;
  const hasWarnings = advisoryWarnings.length > 0 || workflow.warnings.length > 0;

  // Keep validation diagnostics actionable: node-scoped issues should jump
  // directly to the offending canvas node from the publish gate.
  const validationErrors = workflow.errorIssues.length > 0
    ? workflow.errorIssues
    : workflow.errors.map((message): ValidationIssue => ({ message }));

  const focusNode = (nodeId: string) => {
    publishDialogOpen.set(false);
    onFocusNode?.(nodeId);
  };

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      await backend.publish(notes.trim() || undefined);
      publishDialogOpen.set(false);
      versionPanelOpen.set(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999999] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="w-full max-w-[520px] overflow-hidden rounded-lg border border-[#303030] bg-[#1a1a1a] shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#303030] px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-white">Publish workflow</h2>
            <p className="mt-1 text-[12px] text-[#888]">Create immutable version {workflow.latestVersion + 1} from the current draft.</p>
          </div>
          <button type="button" title="Close" aria-label="Close publish dialog" onClick={() => publishDialogOpen.set(false)} className="text-[#888] hover:text-white"><X size={17} /></button>
        </div>
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className={`flex max-h-[min(420px,55vh)] items-start gap-3 overflow-y-auto rounded-md border px-3 py-3 ${publishBlocked ? 'border-red-900/60 bg-red-950/20' : hasWarnings ? 'border-amber-900/60 bg-amber-950/20' : 'border-green-900/60 bg-green-950/20'}`}>
            {publishBlocked ? <AlertTriangle size={17} className="mt-0.5 shrink-0 text-red-300" /> : hasWarnings ? <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-300" /> : <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-green-300" />}
            <div className="min-w-0">
              <div className={`text-[13px] font-medium ${publishBlocked ? 'text-red-200' : hasWarnings ? 'text-amber-200' : 'text-green-200'}`}>{publishBlocked ? 'Publishing is blocked' : hasWarnings ? 'Draft is ready to publish with warnings' : 'Draft is ready to publish'}</div>
              {!workflow.valid && validationErrors.map((issue, index) => <div key={`${issue.message}-${index}`} className="mt-1.5 text-[11.5px] text-red-300">
                <div className="flex items-start justify-between gap-3">
                  <div>{issue.code ? `${issue.code}: ` : ''}{issue.message}</div>
                  {issue.nodeId && onFocusNode && <button type="button" onClick={() => focusNode(issue.nodeId!)} className="flex h-7 shrink-0 items-center gap-1 rounded border border-red-800/70 px-2 text-[10.5px] font-medium text-red-100 hover:border-red-500 hover:bg-red-950/60"><Crosshair size={11} />Open node</button>}
                </div>
                {issue.remediation && <div className="mt-0.5 text-[10.5px] leading-relaxed text-red-200/75"><span className="font-medium text-red-100">Fix:</span> {issue.remediation}</div>}
              </div>)}
              {blockingSafetyIssues.map((issue, index) => (
                <div key={`${issue.code}-${issue.nodeId}-${index}`} className="mt-2 border-t border-red-900/50 pt-2 text-[11.5px] text-red-200">
                  <div className="flex items-start justify-between gap-3">
                    <div><span className="font-semibold">{issue.code}</span>: {issue.message}</div>
                    {issue.nodeId && onFocusNode && <button type="button" onClick={() => focusNode(issue.nodeId)} className="flex h-7 shrink-0 items-center gap-1 rounded border border-red-800/70 px-2 text-[10.5px] font-medium text-red-100 hover:border-red-500 hover:bg-red-950/60"><Crosshair size={11} />Open node</button>}
                  </div>
                  <div className="mt-1 leading-relaxed text-red-200/75"><span className="font-medium text-red-100">Fix:</span> {issue.remediation}</div>
                </div>
              ))}
              {!publishBlocked && (advisoryWarnings.length > 0 ? advisoryWarnings : workflow.warnings.map((message) => ({ message, code: undefined, remediation: undefined, nodeId: undefined }))).map((issue, index) => (
                <div key={`${issue.message}-${index}`} className="mt-1.5 text-[11.5px] text-amber-300">
                  <div className="flex items-start justify-between gap-3"><div>{issue.code ? `${issue.code}: ` : 'Warning: '}{issue.message}</div>{issue.nodeId && onFocusNode && <button type="button" onClick={() => focusNode(issue.nodeId)} className="flex h-7 shrink-0 items-center gap-1 rounded border border-amber-800/60 px-2 text-[10.5px] text-amber-100 hover:border-amber-500"><Crosshair size={11} />Open node</button>}</div>
                  {issue.remediation && <div className="mt-0.5 text-[10.5px] leading-relaxed text-amber-200/75">{issue.remediation}</div>}
                </div>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-2 text-[12px] font-medium text-white">
            Release notes <span className="font-normal text-[#777]">Optional</span>
            <textarea
              rows={5}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              placeholder="Describe what changed in this version"
              className="resize-y rounded-md border border-[#333] bg-[#222] px-3 py-2 text-[13px] font-normal text-white outline-none placeholder:text-[#666] focus:border-[#555]"
            />
            <span className="self-end text-[10px] font-normal text-[#666]">{notes.length}/2000</span>
          </label>
          {error && <div className="whitespace-pre-wrap text-[12px] text-red-300">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#303030] px-5 py-4">
          <button type="button" disabled={publishing} onClick={() => publishDialogOpen.set(false)} className="h-9 rounded-md bg-[#2b2b2b] px-4 text-[13px] font-medium text-white disabled:opacity-40">Cancel</button>
          <button type="button" disabled={publishing || publishBlocked} onClick={() => void publish()} className="flex h-9 items-center gap-2 rounded-md bg-white px-4 text-[13px] font-medium text-black disabled:cursor-not-allowed disabled:opacity-40">
            {publishing && <Loader2 size={13} className="animate-spin" />}
            {publishBlocked ? 'Fix blockers to publish' : hasWarnings ? 'Publish with warnings' : `Publish version ${workflow.latestVersion + 1}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default PublishWorkflowModal;
