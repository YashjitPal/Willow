import React from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, ExternalLink, Loader2, Package, Pause, Play, Plus, Rocket, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { trapDialogFocus } from '@willow/core/dialog-focus';
import { AgentBuilderApiError, getAgentBuilderClient, type ChatDeployment, type DeploymentRelease, type DeploymentUsage, type WorkflowVersion } from './agent-builder';
import { DeploymentSecretsSection } from './DeploymentSecretsSection';

type SnippetLanguage = 'react' | 'javascript';
type VersionMode = 'deployment' | 'pinned' | 'latest';

interface Props {
  open: boolean;
  workflowId: string;
  workflowName: string;
  latestVersion: number;
  onClose: () => void;
}

export const ChatKitDeployPanel: React.FC<Props> = ({ open, workflowId, workflowName, latestVersion, onClose }) => {
  const { apiKeys } = useUserDataContext();

  React.useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); else trapDialogFocus(event, 'chatkit-deploy-dialog-title'); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);
  const [versions, setVersions] = React.useState<WorkflowVersion[]>([]);
  const [deployments, setDeployments] = React.useState<ChatDeployment[]>([]);
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
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);
  const [versionMode, setVersionMode] = React.useState<VersionMode>('pinned');
  const [selectedVersion, setSelectedVersion] = React.useState(latestVersion);
  const [language, setLanguage] = React.useState<SnippetLanguage>('react');
  const [copied, setCopied] = React.useState<string | null>(null);
  const [selectedDeploymentId, setSelectedDeploymentId] = React.useState('');
  const [environment, setEnvironment] = React.useState('production');
  const [allowedOrigins, setAllowedOrigins] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [showCreateDeployment, setShowCreateDeployment] = React.useState(false);
  const [usage, setUsage] = React.useState<DeploymentUsage | null>(null);
  const [releases, setReleases] = React.useState<DeploymentRelease[]>([]);
  const [policyOrigins, setPolicyOrigins] = React.useState('');
  const [policyRate, setPolicyRate] = React.useState(60);
  const [policyActive, setPolicyActive] = React.useState(1000);
  const [policyMaxConcurrentRuns, setPolicyMaxConcurrentRuns] = React.useState(100);
  const [policyMaxRunsPerMinute, setPolicyMaxRunsPerMinute] = React.useState(600);
  const [policyMaxRunsPerDay, setPolicyMaxRunsPerDay] = React.useState(100000);
  const [policyMaxTokensPerDay, setPolicyMaxTokensPerDay] = React.useState('');
  const [policyMaxEstimatedCostUsdPerDay, setPolicyMaxEstimatedCostUsdPerDay] = React.useState('');
  const [canaryPercent, setCanaryPercent] = React.useState(10);
  const [canaryVersion, setCanaryVersion] = React.useState(latestVersion);
  const [releaseMetrics, setReleaseMetrics] = React.useState<Record<string, { sessions: number; runs: number; estimatedCostUsd: number }>>({});

  React.useEffect(() => {
    if (!open) return;
    setSelectedVersion(latestVersion);
    setVersionMode('deployment');
    setError(null);
    if (latestVersion === 0) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    const client = getAgentBuilderClient(apiKeys);
    Promise.all([client.listVersions(workflowId), client.listDeployments(workflowId)])
      .then(([{ versions: published }, { deployments: available }]) => {
        if (!cancelled) {
          setVersions([...published].sort((a, b) => b.version - a.version));
          setDeployments(available);
          setSelectedDeploymentId(available[0]?.id ?? '');
          setVersionMode(available.length ? 'deployment' : 'pinned');
        }
      })
      .catch((reason) => {
        if (!cancelled) setError((reason as Error).message);
      });
    return () => { cancelled = true; };
  }, [apiKeys, latestVersion, open, workflowId]);

  const selectedDeployment = deployments.find((deployment) => deployment.id === selectedDeploymentId);
  React.useEffect(() => {
    if (!open || !selectedDeploymentId) { setUsage(null); return; }
    let cancelled = false;
    const client = getAgentBuilderClient(apiKeys);
    Promise.all([client.getDeploymentUsage(selectedDeploymentId), client.listDeploymentReleases(selectedDeploymentId), client.getDeploymentReleaseMetrics(selectedDeploymentId)]).then(([{ usage: next }, { releases: history }, { metrics }]) => { if (!cancelled) { setUsage(next); setReleases(history); setReleaseMetrics(Object.fromEntries(metrics.map((item) => [item.releaseId, item]))); } }).catch(() => { if (!cancelled) { setUsage(null); setReleases([]); setReleaseMetrics({}); } });
    return () => { cancelled = true; };
  }, [apiKeys, open, selectedDeploymentId, deployments]);
  React.useEffect(() => {
    if (!selectedDeployment) return;
    setPolicyOrigins(selectedDeployment.allowedOrigins.join('\n'));
    setPolicyRate(selectedDeployment.sessionRateLimitPerMinute);
    setPolicyActive(selectedDeployment.maxActiveSessions);
    setPolicyMaxConcurrentRuns(selectedDeployment.maxConcurrentRuns);
    setPolicyMaxRunsPerMinute(selectedDeployment.maxRunsPerMinute);
    setPolicyMaxRunsPerDay(selectedDeployment.maxRunsPerDay);
    setPolicyMaxTokensPerDay(selectedDeployment.maxTokensPerDay?.toString() ?? '');
    setPolicyMaxEstimatedCostUsdPerDay(selectedDeployment.maxEstimatedCostUsdPerDay?.toString() ?? '');
  }, [selectedDeploymentId, selectedDeployment?.revision]);

  if (!open) return null;

  const deployedVersion = versionMode === 'latest' ? -1 : versionMode === 'deployment' ? selectedDeployment?.activeVersion ?? selectedVersion : selectedVersion;
  const workflowIdLiteral = JSON.stringify(workflowId);
  const deploymentIdLiteral = JSON.stringify(versionMode === 'deployment' ? selectedDeploymentId : '');
  const componentName = `${workflowName.replace(/[^A-Za-z0-9_$]/g, '') || 'Workflow'}Chat`;
  const rotateSecret = `function sessionIdFromSecret(secret) {
  const match = /^chatkit_token_(cks_[a-z0-9]+)_/.exec(secret);
  if (!match) throw new Error('Invalid ChatKit session secret');
  return match[1];
}

async function getClientSecret(currentClientSecret) {
  const rotating = Boolean(currentClientSecret);
  const sessionId = rotating ? sessionIdFromSecret(currentClientSecret) : null;
  const response = await fetch(
    rotating
      ? \`/api/v1/chatkit/sessions/\${sessionId}/rotate\`
      : '/api/v1/chatkit/sessions',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(rotating ? { 'x-chatkit-client-secret': currentClientSecret } : {}),
      },
      body: rotating ? undefined : JSON.stringify({
        workflow: { id: WORKFLOW_ID, version: WORKFLOW_VERSION },
        ...(DEPLOYMENT_ID ? { deployment_id: DEPLOYMENT_ID } : {}),
        user: 'replace-with-authenticated-user-id',
      }),
    },
  );
  if (!response.ok) throw new Error(await response.text());
  const { client_secret } = await response.json();
  return client_secret;
}`;
  const reactSnippet = `import { ChatKit, useChatKit } from '@openai/chatkit-react';

const WORKFLOW_ID = ${workflowIdLiteral};
const WORKFLOW_VERSION = ${deployedVersion};
const DEPLOYMENT_ID = ${deploymentIdLiteral};

${rotateSecret}

export function ${componentName}() {
  const { control } = useChatKit({ api: { getClientSecret } });
  return <ChatKit control={control} className="h-[640px] w-full" />;
}`;
  const javascriptSnippet = `<script
  src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js"
  async
></script>
<openai-chatkit id="workflow-chat" style="display:block;height:640px"></openai-chatkit>

<script type="module">
  const WORKFLOW_ID = ${workflowIdLiteral};
  const WORKFLOW_VERSION = ${deployedVersion};
  const DEPLOYMENT_ID = ${deploymentIdLiteral};

  ${rotateSecret.replace(/^/gm, '  ')}

  await customElements.whenDefined('openai-chatkit');
  document.getElementById('workflow-chat').setOptions({
    api: { getClientSecret },
  });
</script>`;
  const snippet = language === 'react' ? reactSnippet : javascriptSnippet;
  const versionLabel = versionMode === 'deployment' ? `${selectedDeployment?.environment ?? 'No environment'}${selectedDeployment ? ` -> v${selectedDeployment.activeVersion}` : ''}` : versionMode === 'latest' ? `Latest published, currently v${latestVersion}` : `Pinned v${selectedVersion}`;
  const activeRelease = releases.find((release) => release.id === selectedDeployment?.activeReleaseId);
  const previousRelease = releases.find((release) => release.id === activeRelease?.previousReleaseId);

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? null : current), 1500);
    } catch { /* clipboard access can be blocked by browser permissions */ }
  };

  const replaceDeployment = (deployment: ChatDeployment) => {
    setDeployments((current) => current.map((item) => item.id === deployment.id ? deployment : item));
  };

  const refreshDeploymentDetails = async (deploymentId: string) => {
    const client = getAgentBuilderClient(apiKeys);
    const [{ deployment }, { usage: nextUsage }, { releases: history }, { metrics }] = await Promise.all([
      client.getDeployment(deploymentId),
      client.getDeploymentUsage(deploymentId),
      client.listDeploymentReleases(deploymentId),
      client.getDeploymentReleaseMetrics(deploymentId),
    ]);
    replaceDeployment(deployment);
    setUsage(nextUsage);
    setReleases(history);
    setReleaseMetrics(Object.fromEntries(metrics.map((item) => [item.releaseId, item])));
    return deployment;
  };

  const mutationError = async (reason: unknown, deploymentId: string) => {
    if (reason instanceof AgentBuilderApiError && reason.status === 409) {
      try { await refreshDeploymentDetails(deploymentId); } catch { /* retain the mutation error */ }
      setError('This deployment changed in another session. Its latest release state has been loaded; review it and try again.');
      return;
    }
    setError((reason as Error).message);
  };

  const createDeployment = async () => {
    setBusy(true); setError(null);
    try {
      const { deployment } = await getAgentBuilderClient(apiKeys).createDeployment(
        { workflowId, name: environment.trim(), environment: environment.trim().toLowerCase(), activeVersion: selectedVersion, allowedOrigins: allowedOrigins.split(/[,\n]/).map((value) => value.trim()).filter(Boolean) },
        crypto.randomUUID(),
      );
      setDeployments((current) => [deployment, ...current]); setSelectedDeploymentId(deployment.id); setVersionMode('deployment');
      setShowCreateDeployment(false);
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  };

  const rollout = async (version: number) => {
    if (!selectedDeployment) return;
    setBusy(true); setError(null);
    try {
      await getAgentBuilderClient(apiKeys).rolloutDeployment(selectedDeployment.id, version, selectedDeployment.revision);
      await refreshDeploymentDetails(selectedDeployment.id);
    }
    catch (reason) { await mutationError(reason, selectedDeployment.id); } finally { setBusy(false); }
  };

  const rollback = async (releaseId?: string) => {
    if (!selectedDeployment) return;
    const target = releases.find((release) => release.id === releaseId)
      ?? releases.find((release) => release.id === releases.find((candidate) => candidate.id === selectedDeployment.activeReleaseId)?.previousReleaseId);
    if (!target) return;
    if (releaseId && !window.confirm(`Roll back ${selectedDeployment.environment} to release #${target.sequence} (v${target.workflowVersion})?`)) return;
    setBusy(true); setError(null);
    try {
      await getAgentBuilderClient(apiKeys).rollbackDeployment(selectedDeployment.id, { expectedRevision: selectedDeployment.revision, releaseId: target.id });
      await refreshDeploymentDetails(selectedDeployment.id);
    }
    catch (reason) { await mutationError(reason, selectedDeployment.id); } finally { setBusy(false); }
  };

  const toggleStatus = async () => {
    if (!selectedDeployment) return;
    setBusy(true); setError(null);
    try { replaceDeployment((await getAgentBuilderClient(apiKeys).updateDeployment(selectedDeployment.id, { expectedRevision: selectedDeployment.revision, status: selectedDeployment.status === 'active' ? 'paused' : 'active' })).deployment); }
    catch (reason) { await mutationError(reason, selectedDeployment.id); } finally { setBusy(false); }
  };

  const savePolicy = async () => {
    if (!selectedDeployment) return;
    setBusy(true); setError(null);
    try {
      replaceDeployment((await getAgentBuilderClient(apiKeys).updateDeployment(selectedDeployment.id, {
        expectedRevision: selectedDeployment.revision,
        allowedOrigins: policyOrigins.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
        sessionRateLimitPerMinute: policyRate,
        maxActiveSessions: policyActive,
        maxConcurrentRuns: policyMaxConcurrentRuns,
        maxRunsPerMinute: policyMaxRunsPerMinute,
        maxRunsPerDay: policyMaxRunsPerDay,
        maxTokensPerDay: policyMaxTokensPerDay.trim() ? Number(policyMaxTokensPerDay) : null,
        maxEstimatedCostUsdPerDay: policyMaxEstimatedCostUsdPerDay.trim() ? Number(policyMaxEstimatedCostUsdPerDay) : null,
        unpricedCostPolicy: policyMaxEstimatedCostUsdPerDay.trim() ? 'deny' : null,
      })).deployment);
    }
    catch (reason) { await mutationError(reason, selectedDeployment.id); } finally { setBusy(false); }
  };

  const stageCanary = async () => {
    if (!selectedDeployment) return;
    setBusy(true); setError(null);
    try {
      await getAgentBuilderClient(apiKeys).stageDeployment(selectedDeployment.id, canaryVersion, canaryPercent, selectedDeployment.revision);
      await refreshDeploymentDetails(selectedDeployment.id);
    }
    catch (reason) { await mutationError(reason, selectedDeployment.id); } finally { setBusy(false); }
  };

  const finishCanary = async (promote: boolean) => {
    if (!selectedDeployment) return;
    setBusy(true); setError(null);
    try {
      if (promote) await getAgentBuilderClient(apiKeys).promoteDeployment(selectedDeployment.id, selectedDeployment.revision);
      else await getAgentBuilderClient(apiKeys).cancelStagedDeployment(selectedDeployment.id, selectedDeployment.revision);
      await refreshDeploymentDetails(selectedDeployment.id);
    }
    catch (reason) { await mutationError(reason, selectedDeployment.id); } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="chatkit-deploy-dialog-title" className="flex h-[min(760px,calc(100vh-32px))] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[#303030] bg-[#171717] shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#303030] px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-white"><Rocket size={16} /><h2 id="chatkit-deploy-dialog-title" className="text-[15px] font-semibold">Deploy with ChatKit</h2></div>
            <p className="mt-1 text-[11px] text-[#888]">Generate a browser integration for an immutable workflow deployment.</p>
          </div>
          <button type="button" onClick={onClose} title="Close ChatKit deployment" className="text-[#888] hover:text-white"><X size={17} /></button>
        </div>

        {latestVersion === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-md text-center">
              <Rocket size={24} className="mx-auto text-[#777]" />
              <div className="mt-3 text-[14px] font-medium text-white">Publish before deploying</div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-[#888]">Drafts are mutable and cannot be deployed with ChatKit. Publish version 1, then return here to pin it or follow the latest published version.</p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <aside className="max-h-[48%] w-full shrink-0 overflow-y-auto border-b border-[#303030] bg-[#141414] p-4 lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r">
              <div className="text-[10px] font-semibold uppercase text-[#666]">Version policy</div>
              <div className="mt-3 grid grid-cols-3 rounded-md border border-[#333] p-0.5">
                {(['deployment', 'pinned', 'latest'] as const).map((mode) => <button key={mode} type="button" onClick={() => setVersionMode(mode)} className={`h-8 rounded text-[10px] ${versionMode === mode ? 'bg-[#333] text-white' : 'text-[#888] hover:text-white'}`}>{mode === 'deployment' ? 'Environment' : mode === 'pinned' ? 'Pinned' : 'Latest'}</button>)}
              </div>
              {versionMode === 'deployment' && deployments.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-1"><select value={selectedDeploymentId} onChange={(event) => setSelectedDeploymentId(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-[#333] bg-[#202020] px-2.5 text-[11.5px] text-white outline-none">
                    {deployments.map((deployment) => <option key={deployment.id} value={deployment.id}>{deployment.environment} - v{deployment.activeVersion} ({deployment.status})</option>)}
                  </select><button type="button" title="Create environment" onClick={() => setShowCreateDeployment((value) => !value)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[#333] text-[#aaa] hover:text-white"><Plus size={13} /></button></div>
                  {showCreateDeployment && <div className="space-y-2 rounded-md border border-[#303030] p-2.5"><input value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="Environment" className="h-8 w-full rounded border border-[#333] bg-[#202020] px-2 text-[10.5px] text-white outline-none" /><textarea value={allowedOrigins} onChange={(event) => setAllowedOrigins(event.target.value)} placeholder="Allowed origins, one per line" rows={2} className="w-full resize-none rounded border border-[#333] bg-[#202020] px-2 py-1.5 text-[10.5px] text-white outline-none" /><button type="button" disabled={busy || !environment.trim()} onClick={() => void createDeployment()} className="flex h-8 w-full items-center justify-center gap-1 rounded bg-white text-[10.5px] font-medium text-black disabled:opacity-40">{busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}Create</button></div>}
                  {selectedDeployment && <>
                    <div className="grid grid-cols-2 gap-2">
                      <select value={selectedDeployment.activeVersion} disabled={busy} onChange={(event) => void rollout(Number(event.target.value))} className="h-8 rounded border border-[#333] bg-[#202020] px-2 text-[10.5px] text-white">{versions.map((version) => <option key={version.version} value={version.version}>Promote v{version.version}</option>)}</select>
                      <button type="button" disabled={busy} onClick={() => void toggleStatus()} className="flex h-8 items-center justify-center gap-1 rounded border border-[#333] text-[10.5px] text-[#ccc] hover:text-white disabled:opacity-50">{selectedDeployment.status === 'active' ? <Pause size={11} /> : <Play size={11} />}{selectedDeployment.status === 'active' ? 'Pause' : 'Activate'}</button>
                    </div>
                    <button type="button" disabled={busy || !previousRelease} onClick={() => void rollback(previousRelease?.id)} className="flex h-8 w-full items-center justify-center gap-1 rounded border border-[#333] text-[10.5px] text-[#ccc] hover:text-white disabled:opacity-40"><RotateCcw size={11} />Rollback{previousRelease ? ` to #${previousRelease.sequence} (v${previousRelease.workflowVersion})` : ''}</button>
                    {selectedDeployment.candidateReleaseId ? <div className="rounded border border-cyan-900/60 bg-cyan-950/20 p-2"><div className="flex items-center justify-between text-[10px]"><span className="text-cyan-200">Canary at {selectedDeployment.candidateTrafficPercent}%</span><span className="text-[#777]">v{releases.find((release) => release.id === selectedDeployment.candidateReleaseId)?.workflowVersion ?? '?'}</span></div><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={() => void finishCanary(true)} className="h-7 rounded bg-white text-[10px] font-medium text-black disabled:opacity-40">Promote</button><button type="button" disabled={busy} onClick={() => void finishCanary(false)} className="h-7 rounded border border-[#3a3a3a] text-[10px] text-[#ccc] disabled:opacity-40">Cancel</button></div></div> : <details className="rounded border border-[#292929] bg-[#1b1b1b] p-2"><summary className="cursor-pointer text-[9.5px] text-[#aaa]">Stage canary</summary><div className="mt-2 space-y-2"><select value={canaryVersion} onChange={(event) => setCanaryVersion(Number(event.target.value))} className="h-7 w-full rounded border border-[#333] bg-[#202020] px-2 text-[10px] text-white">{versions.filter((version) => version.version !== selectedDeployment.activeVersion).map((version) => <option key={version.version} value={version.version}>Version {version.version}</option>)}</select><label className="block text-[9px] text-[#777]">Traffic {canaryPercent}%<input type="range" min={0} max={100} step={1} value={canaryPercent} onChange={(event) => setCanaryPercent(Number(event.target.value))} className="mt-1 w-full" /></label><button type="button" disabled={busy || canaryVersion === selectedDeployment.activeVersion} onClick={() => void stageCanary()} className="h-7 w-full rounded border border-cyan-900/70 text-[10px] text-cyan-200 disabled:opacity-40">Start canary</button></div></details>}
                    <div className="rounded border border-[#292929] bg-[#1b1b1b] p-2 text-center"><div className="grid grid-cols-3 gap-1"><div><div className="text-[9px] text-[#666]">Sessions</div><div className="mt-0.5 text-[11px] text-white">{usage?.activeSessions ?? '-'} active</div></div><div><div className="text-[9px] text-[#666]">Runs today</div><div className="mt-0.5 text-[11px] text-white">{usage?.runsToday ?? '-'}</div></div><div><div className="text-[9px] text-[#666]">Active runs</div><div className="mt-0.5 text-[11px] text-white">{usage?.activeRuns ?? '-'}</div></div></div>{usage && <><div className="mt-2 grid grid-cols-2 gap-1 border-t border-[#292929] pt-2 text-left"><div><div className="text-[9px] text-[#666]">Tokens today</div><div className="text-[10px] text-[#ccc]">{usage.tokensUsedToday.toLocaleString()}{usage.maxTokensPerDay ? ` / ${usage.maxTokensPerDay.toLocaleString()}` : ''}</div></div><div><div className="text-[9px] text-[#666]">Estimated cost today</div><div className="text-[10px] text-[#ccc]">${usage.estimatedCostUsdUsedToday.toFixed(4)}{usage.maxEstimatedCostUsdPerDay ? ` / $${usage.maxEstimatedCostUsdPerDay.toFixed(2)}` : ''}</div></div></div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-[#292929] pt-2 text-left text-[9.5px] text-[#777]"><span>File search <strong className="font-medium text-[#bbb]">{usage.embeddingOperations.toLocaleString()}</strong></span><span>Embedding input <strong className="font-medium text-[#bbb]">{usage.embeddingInputTokens.toLocaleString()}</strong></span>{usage.unpricedEmbeddingOperations > 0 && <span className="text-amber-300" title="These embedding operations are not included in the estimated cost.">{usage.unpricedEmbeddingOperations.toLocaleString()} unpriced</span>}</div></>}</div>
                    <details className="rounded border border-[#292929] bg-[#1b1b1b] p-2 text-[9.5px] text-[#777]"><summary className="cursor-pointer text-[#aaa]">Release history ({releases.length})</summary><div className="mt-2 space-y-1.5">{releases.slice(0, 10).map((release) => {
                      const isActive = release.id === selectedDeployment.activeReleaseId;
                      const isCandidate = release.id === selectedDeployment.candidateReleaseId;
                      const metrics = releaseMetrics[release.id];
                      return <div key={release.id} className="rounded border border-[#292929] bg-[#181818] px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[#aaa]">#{release.sequence} v{release.workflowVersion} · {release.kind}{isActive ? ' · active' : isCandidate ? ' · candidate' : ''}</span>
                          <button type="button" title={`Roll back to release ${release.sequence}`} disabled={busy || isActive || isCandidate} onClick={() => void rollback(release.id)} className="flex h-6 shrink-0 items-center gap-1 rounded border border-[#333] px-1.5 text-[9px] text-[#aaa] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"><RotateCcw size={9} />Rollback</button>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[#555]"><span className="truncate">{release.createdBy} · {new Date(release.createdAt).toLocaleString()}</span><span className="shrink-0">{metrics?.sessions ?? 0}s / {metrics?.runs ?? 0}r · ${(metrics?.estimatedCostUsd ?? 0).toFixed(4)}</span></div>
                      </div>;
                    })}</div></details>
                    <DeploymentSecretsSection workflowId={workflowId} deploymentId={selectedDeployment.id} environment={selectedDeployment.environment} />
                    <details className="rounded border border-[#292929] bg-[#1b1b1b] p-2 text-[9.5px] text-[#777]"><summary className="cursor-pointer text-[#aaa]">Origin and quota policy</summary><div className="mt-2 space-y-2"><textarea value={policyOrigins} onChange={(event) => setPolicyOrigins(event.target.value)} placeholder="Allowed origins" rows={2} className="w-full resize-none rounded border border-[#333] bg-[#202020] px-2 py-1.5 text-[10px] text-white outline-none" /><div className="grid grid-cols-2 gap-2"><label>Sessions/min<input type="number" min={1} value={policyRate} onChange={(event) => setPolicyRate(Number(event.target.value))} className="mt-1 h-7 w-full rounded border border-[#333] bg-[#202020] px-2 text-white" /></label><label>Max active sessions<input type="number" min={1} value={policyActive} onChange={(event) => setPolicyActive(Number(event.target.value))} className="mt-1 h-7 w-full rounded border border-[#333] bg-[#202020] px-2 text-white" /></label><label>Concurrent runs<input type="number" min={1} value={policyMaxConcurrentRuns} onChange={(event) => setPolicyMaxConcurrentRuns(Number(event.target.value))} className="mt-1 h-7 w-full rounded border border-[#333] bg-[#202020] px-2 text-white" /></label><label>Runs/min<input type="number" min={1} value={policyMaxRunsPerMinute} onChange={(event) => setPolicyMaxRunsPerMinute(Number(event.target.value))} className="mt-1 h-7 w-full rounded border border-[#333] bg-[#202020] px-2 text-white" /></label><label>Runs/day<input type="number" min={1} value={policyMaxRunsPerDay} onChange={(event) => setPolicyMaxRunsPerDay(Number(event.target.value))} className="mt-1 h-7 w-full rounded border border-[#333] bg-[#202020] px-2 text-white" /></label><label>Tokens/day<input type="number" min={1} value={policyMaxTokensPerDay} onChange={(event) => setPolicyMaxTokensPerDay(event.target.value)} placeholder="Unlimited" className="mt-1 h-7 w-full rounded border border-[#333] bg-[#202020] px-2 text-white" /></label></div><label className="block">Estimated USD/day<input type="number" min={0.000001} step="any" value={policyMaxEstimatedCostUsdPerDay} onChange={(event) => setPolicyMaxEstimatedCostUsdPerDay(event.target.value)} placeholder="Unlimited" className="mt-1 h-7 w-full rounded border border-[#333] bg-[#202020] px-2 text-white" /></label>{(policyMaxTokensPerDay.trim() || policyMaxEstimatedCostUsdPerDay.trim()) && <p className="rounded border border-[#363636] bg-[#202020] px-2 py-1.5 leading-relaxed text-[#aaa]">Limits include agent replies, model-based safety checks, and file-search embeddings.</p>}{policyMaxEstimatedCostUsdPerDay.trim() && <p className="rounded border border-amber-900/60 bg-amber-950/20 px-2 py-1.5 leading-relaxed text-amber-200">USD limits deny runs when any model or embedding operation cannot be priced.</p>}<button type="button" disabled={busy} onClick={() => void savePolicy()} className="h-7 w-full rounded border border-[#3a3a3a] text-[10px] text-[#ccc] hover:text-white disabled:opacity-40">Save policy</button></div></details>
                  </>}
                </div>
              )}
              {versionMode === 'deployment' && deployments.length === 0 && <div className="mt-3 space-y-2 rounded-md border border-[#303030] p-2.5"><input value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="Environment" className="h-8 w-full rounded border border-[#333] bg-[#202020] px-2 text-[10.5px] text-white outline-none" /><textarea value={allowedOrigins} onChange={(event) => setAllowedOrigins(event.target.value)} placeholder="Allowed origins, one per line" rows={2} className="w-full resize-none rounded border border-[#333] bg-[#202020] px-2 py-1.5 text-[10.5px] text-white outline-none" /><button type="button" disabled={busy || !environment.trim()} onClick={() => void createDeployment()} className="flex h-8 w-full items-center justify-center gap-1 rounded bg-white text-[10.5px] font-medium text-black disabled:opacity-40">{busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}Create environment</button></div>}
              {versionMode === 'pinned' && (
                <label className="mt-3 block text-[10.5px] text-[#777]">Published version
                  <select value={selectedVersion} onChange={(event) => setSelectedVersion(Number(event.target.value))} className="mt-1.5 h-9 w-full rounded-md border border-[#333] bg-[#202020] px-2.5 text-[11.5px] text-white outline-none">
                    {versions.map((version) => <option key={version.version} value={version.version}>Version {version.version}</option>)}
                  </select>
                </label>
              )}
              <div className="mt-4 space-y-3 border-t border-[#292929] pt-4 text-[10.5px]">
                <div><div className="text-[#666]">Workflow ID</div><div className="mt-1 flex items-center gap-1"><code className="min-w-0 flex-1 truncate text-[#ccc]">{workflowId}</code><button type="button" title="Copy workflow ID" onClick={() => void copyText('workflow', workflowId)} className="text-[#777] hover:text-white">{copied === 'workflow' ? <Check size={12} /> : <Copy size={12} />}</button></div></div>
                <div><div className="text-[#666]">Deployment</div><div className="mt-1 text-[#ccc]">{versionLabel}</div></div>
                <div><div className="text-[#666]">Mint endpoint</div><code className="mt-1 block break-all text-[#ccc]">POST /api/v1/chatkit/sessions</code></div>
                <div className="flex items-center gap-1.5 text-green-300"><ShieldCheck size={12} /> Hashed, rotatable session secrets</div>
              </div>
              {error && <div className="mt-3 text-[11px] text-red-300">{error}</div>}
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#303030] px-4 py-3">
                <div className="flex rounded-md border border-[#333] p-0.5">{(['react', 'javascript'] as const).map((item) => <button key={item} type="button" onClick={() => setLanguage(item)} className={`h-8 rounded px-3 text-[11px] ${language === item ? 'bg-[#333] text-white' : 'text-[#888] hover:text-white'}`}>{item === 'react' ? 'React' : 'JavaScript'}</button>)}</div>
                <button type="button" onClick={() => void copyText('snippet', snippet)} className="flex h-8 items-center gap-1.5 rounded-md border border-[#3a3a3a] px-2.5 text-[11px] text-[#ccc] hover:text-white">{copied === 'snippet' ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}{copied === 'snippet' ? 'Copied' : 'Copy snippet'}</button>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre p-4 font-mono text-[11.5px] leading-relaxed text-[#d4d4d4]">{snippet}</pre>
              <div className="border-t border-[#303030] bg-[#151515] px-4 py-3">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-[#666]"><Package size={12} /> Prerequisites</div>
                <div className="mt-2 grid gap-1.5 text-[10.5px] leading-relaxed text-[#999] sm:grid-cols-2">
                  <div>Install <code className="text-[#ccc]">@openai/chatkit-react</code> for React, or load the official ChatKit script for JavaScript.</div>
                  <div>Serve the session endpoints from the same authenticated origin and replace the placeholder user ID.</div>
                  <div>Keep provider credentials server-side. Never embed API keys or minted client secrets in source code.</div>
                  <div>The snippet rotates expiring secrets through the session-specific rotate endpoint without changing the pinned workflow version.</div>
                </div>
                <a href="https://developers.openai.com/api/docs/guides/chatkit" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10.5px] text-[#aaa] hover:text-white">Open ChatKit documentation <ExternalLink size={11} /></a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default ChatKitDeployPanel;
