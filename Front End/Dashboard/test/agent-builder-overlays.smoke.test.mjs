import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, it } from 'node:test';
import { build } from 'esbuild';

const dashboardDir = path.resolve(import.meta.dirname, '..');
const agentBuilderClient = path.resolve(dashboardDir, '..', '..', 'Back End', 'agent-builder', 'client', 'index.ts');
let bundleDir = '';
let smoke;

before(async () => {
  const cacheDir = path.join(dashboardDir, 'node_modules', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  bundleDir = fs.mkdtempSync(path.join(cacheDir, 'willow-agent-builder-smoke-'));
  const outfile = path.join(bundleDir, 'smoke.mjs');
  await build({
    stdin: {
      resolveDir: dashboardDir,
      sourcefile: 'agent-builder-smoke-entry.tsx',
      loader: 'tsx',
      contents: `
        import React from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { AgentBuilderContent } from './components/agents/AgentBuilder.tsx';
        import { AgentsWorkspace } from './components/agents/AgentsWorkspace.tsx';
        import { CollaborationPanel } from './components/agents/CollaborationPanel.tsx';
        import { WorkflowSecretsPanel } from './components/agents/WorkflowSecretsPanel.tsx';
        import { DeploymentSecretsSection } from './components/agents/DeploymentSecretsSection.tsx';
        import { ChatKitDeployPanel } from './components/agents/ChatKitDeployPanel.tsx';
        import { GovernanceTab } from './components/settings/GovernanceTab.tsx';

        const noop = () => {};
        export function renderSmokeSurfaces() {
          return {
            builder: renderToStaticMarkup(<AgentBuilderContent onClose={noop} />),
            agentsHome: renderToStaticMarkup(<AgentsWorkspace />),
            collaboration: renderToStaticMarkup(<CollaborationPanel open workflowId="wf_smoke" selectedNodeIds={[]} onFocusNode={noop} onClose={noop} />),
            workflowSecrets: renderToStaticMarkup(<WorkflowSecretsPanel open workflowId="wf_smoke" workflowName="Smoke workflow" onClose={noop} />),
            deploymentSecrets: renderToStaticMarkup(<DeploymentSecretsSection workflowId="wf_smoke" deploymentId="dep_smoke" environment="production" />),
            closedDeployment: renderToStaticMarkup(<ChatKitDeployPanel open={false} workflowId="wf_smoke" workflowName="Smoke workflow" latestVersion={1} onClose={noop} />),
            governance: renderToStaticMarkup(<GovernanceTab />),
          };
        }
      `,
    },
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node23',
    jsx: 'automatic',
    alias: { '@agentbuilder': agentBuilderClient },
    plugins: [
      {
        name: 'smoke-browser-boundaries',
        setup(buildApi) {
          buildApi.onResolve({ filter: /UserDataContext$/ }, () => ({ path: 'user-data-context', namespace: 'smoke' }));
          buildApi.onLoad({ filter: /.*/, namespace: 'smoke' }, () => ({
            loader: 'tsx',
            contents: `const apiKeys = Object.freeze({ gemini: Object.freeze([]), openai: Object.freeze([]), anthropic: Object.freeze([]) }); const value = Object.freeze({ apiKeys }); export const useUserDataContext = () => value;`,
          }));
          buildApi.onResolve({ filter: /\.css$/ }, () => ({ path: 'empty.css', namespace: 'smoke-css' }));
          buildApi.onLoad({ filter: /.*/, namespace: 'smoke-css' }, () => ({ loader: 'css', contents: '' }));
        },
      },
    ],
    logLevel: 'silent',
  });
  smoke = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
});

after(() => {
  if (bundleDir) fs.rmSync(bundleDir, { recursive: true, force: true });
});

it('renders the Agent Builder canvas shell without a browser or Vite', () => {
  const surfaces = smoke.renderSmokeSurfaces();
  assert.match(surfaces.builder, /Templates/);
  assert.match(surfaces.builder, /Search nodes/);
  assert.match(surfaces.builder, /Workflow/);
  assert.match(surfaces.builder, /Close Agent Builder/);
  assert.match(surfaces.builder, /Preview workflow/);
  assert.match(surfaces.builder, /Evaluate workflow/);
  assert.match(surfaces.builder, /Export workflow code/);
  assert.match(surfaces.builder, /Publish workflow/);
  assert.match(surfaces.builder, /Human approval/);
  assert.match(surfaces.builder, /data-testid="agent-builder-initializing"/);
});

it('renders the Agents home with an inert prompt and workflow entry points', () => {
  const surfaces = smoke.renderSmokeSurfaces();
  const agentsWorkspaceSource = fs.readFileSync(
    path.join(dashboardDir, 'components', 'agents', 'AgentsWorkspace.tsx'),
    'utf8',
  );
  const backendHookSource = fs.readFileSync(path.join(dashboardDir, 'hooks', 'useAgentBuilderBackend.ts'), 'utf8');

  assert.match(surfaces.agentsHome, /data-testid="agents-home"/);
  assert.match(surfaces.agentsHome, /Describe an agent you want to build/);
  assert.match(surfaces.agentsHome, /New agent/);
  assert.match(surfaces.agentsHome, /Your agents/);
  assert.match(agentsWorkspaceSource, /onSubmit=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(agentsWorkspaceSource, /event\.key === 'Enter' && !event\.shiftKey/);
  assert.match(agentsWorkspaceSource, /requestedWorkflowId\.set\(NEW_WORKFLOW\)/);
  assert.match(agentsWorkspaceSource, /requestedWorkflowId\.set\(workflowId\)/);

  const saveStart = backendHookSource.indexOf('const saveCurrentDraftUnlocked');
  const flushStart = backendHookSource.indexOf('const flushDraft', saveStart);
  const switchStart = backendHookSource.indexOf('// ---- init:', flushStart);
  const autosaveStart = backendHookSource.indexOf('// ---- debounced autosave', switchStart);
  const publishStart = backendHookSource.indexOf('const publish =', autosaveStart);
  const exportStart = backendHookSource.indexOf('const exportCode =', publishStart);
  const metadataStart = backendHookSource.indexOf('const updateMetadata =', autosaveStart);
  const approvalStart = backendHookSource.indexOf('const resolveApproval =', metadataStart);
  const saveBlock = backendHookSource.slice(saveStart, flushStart);
  const switchBlock = backendHookSource.slice(switchStart, autosaveStart);
  const publishBlock = backendHookSource.slice(publishStart, exportStart);
  const metadataBlock = backendHookSource.slice(metadataStart, approvalStart);

  assert.match(saveBlock, /while \(true\)/);
  assert.match(saveBlock, /graphSignature\(nodesRef\.current, edgesRef\.current\) === lastSavedSig\.current/);
  assert.ok(switchBlock.indexOf('withDraftWriteLock') < switchBlock.indexOf('client.getWorkflow(targetId)'));
  assert.ok(publishBlock.indexOf('withDraftWriteLock') < publishBlock.indexOf('saveCurrentDraftUnlocked'));
  assert.ok(publishBlock.indexOf('saveCurrentDraftUnlocked') < publishBlock.indexOf('publishWorkflow'));
  assert.doesNotMatch(publishBlock, /await flushDraft\(\)/);
  assert.ok(metadataBlock.indexOf('saveCurrentDraftUnlocked') < metadataBlock.indexOf('updateWorkflow'));
  assert.match(metadataBlock, /expectedRevision/);
  assert.match(metadataBlock, /draftRevisionRef\.current = workflow\.draftRevision/);
});

it('renders collaboration and secret overlays with stable controls', () => {
  const surfaces = smoke.renderSmokeSurfaces();
  assert.match(surfaces.collaboration, /Workflow review/);
  assert.match(surfaces.collaboration, /Add comment/);
  assert.match(surfaces.workflowSecrets, /Workflow secrets/);
  assert.match(surfaces.workflowSecrets, /New secret/);
  assert.match(surfaces.deploymentSecrets, /Environment secret overrides/);
  assert.equal(surfaces.closedDeployment, '');
  assert.match(surfaces.governance, /Agent Builder governance/);
  assert.match(surfaces.governance, /Loading governance controls/);
});

it('keeps Agent Builder reachable from app navigation and a direct route', () => {
  const appSource = fs.readFileSync(path.join(dashboardDir, 'App.tsx'), 'utf8');
  const sidebarSource = fs.readFileSync(path.join(dashboardDir, 'components', 'Sidebar.tsx'), 'utf8');
  const agentBuilderSource = fs.readFileSync(path.join(dashboardDir, 'components', 'agents', 'AgentBuilder.tsx'), 'utf8');
  const nodeConfigSource = fs.readFileSync(path.join(dashboardDir, 'components', 'agents', 'NodeConfigPanel.tsx'), 'utf8');
  const chatPreviewSource = fs.readFileSync(path.join(dashboardDir, 'components', 'agents', 'ChatPreviewPanel.tsx'), 'utf8');
  const runPanelSource = fs.readFileSync(path.join(dashboardDir, 'components', 'agents', 'RunPanel.tsx'), 'utf8');
  const runHistorySource = fs.readFileSync(path.join(dashboardDir, 'components', 'agents', 'RunHistoryPanel.tsx'), 'utf8');
  const evaluationPanelSource = fs.readFileSync(path.join(dashboardDir, 'components', 'agents', 'EvaluationPanel.tsx'), 'utf8');
  const viteConfigSource = fs.readFileSync(path.join(dashboardDir, 'vite.config.ts'), 'utf8');
  const settingsSource = fs.readFileSync(path.join(dashboardDir, 'components', 'SettingsModal.tsx'), 'utf8');
  const modelsTabSource = fs.readFileSync(path.join(dashboardDir, 'components', 'settings', 'ModelsTab.tsx'), 'utf8');
  const userDataSource = fs.readFileSync(path.join(dashboardDir, 'hooks', 'useUserData.ts'), 'utf8');
  const governanceSource = fs.readFileSync(path.join(dashboardDir, 'components', 'settings', 'GovernanceTab.tsx'), 'utf8');
  const variablePickerSource = fs.readFileSync(path.join(dashboardDir, 'components', 'agents', 'VariablePicker.tsx'), 'utf8');
  const deployPanelSource = fs.readFileSync(path.join(dashboardDir, 'components', 'agents', 'ChatKitDeployPanel.tsx'), 'utf8');
  const batchPanelSource = fs.readFileSync(path.join(dashboardDir, 'components', 'agents', 'BatchRunPanel.tsx'), 'utf8');
  const backendHookSource = fs.readFileSync(path.join(dashboardDir, 'hooks', 'useAgentBuilderBackend.ts'), 'utf8');
  const publishModalSource = fs.readFileSync(path.join(dashboardDir, 'components', 'agents', 'PublishWorkflowModal.tsx'), 'utf8');
  const codeExportModalSource = fs.readFileSync(path.join(dashboardDir, 'components', 'agents', 'CodeExportModal.tsx'), 'utf8');
  assert.match(sidebarSource, /currentView === 'agents'/);
  assert.match(sidebarSource, /onViewChange\('agents'\)/);
  assert.match(appSource, /path="\/agents"/);
  assert.match(appSource, /<AgentBuilderContent/);
  assert.match(appSource, /user \? <Navigate to="\/\?view=agents" replace \/> : <Navigate to="\/login" replace \/>/);
  assert.match(appSource, /const sequence = \+\+viewChangeSequenceRef\.current/);
  assert.match(appSource, /if \(sequence !== viewChangeSequenceRef\.current\) return/);
  assert.match(appSource, /sequence === viewChangeSequenceRef\.current/);
  assert.match(chatPreviewSource, /aria-label="Attach files"/);
  assert.match(chatPreviewSource, /sendChatMessage\(thread\.id, text, clientSecret, crypto\.randomUUID\(\), outgoingAttachments\)/);
  assert.match(chatPreviewSource, /getRun\(runId, secret\)/);
  assert.match(chatPreviewSource, /Inspect trace/);
  assert.match(chatPreviewSource, /resolveApproval\(activeRun\.id, approval\.id/);
  assert.match(chatPreviewSource, /submitClientToolResult\(activeRun\.id, approval\.id/);
  assert.match(chatPreviewSource, /Retry with credentials/);
  assert.match(chatPreviewSource, /stepDebugRun\(activeRun\.id, clientSecret\)/);
  assert.match(chatPreviewSource, /continueDebugRun\(activeRun\.id, clientSecret\)/);
  assert.match(chatPreviewSource, /Paused in a nested workflow/);
  assert.match(agentBuilderSource, /Basic Auth/);
  assert.match(agentBuilderSource, /inert=\{!backend\.ready\}/);
  assert.match(agentBuilderSource, /auth: basicAuth/);
  assert.match(agentBuilderSource, /autoComplete="username"/);
  assert.match(agentBuilderSource, /aria-label="Expand instructions"/);
  assert.match(agentBuilderSource, /aria-label="Include chat history"/);
  assert.match(agentBuilderSource, /useNodeConnections/);
  assert.doesNotMatch(agentBuilderSource, /useHandleConnections/);
  assert.match(agentBuilderSource, /inset-x-3 top-16 max-h-\[calc\(100%-148px\)\]/);
  assert.match(agentBuilderSource, /agent-builder-minimap !mb-24 !mr-4 hidden md:block/);
  assert.match(agentBuilderSource, /w-\[min\(380px,calc\(100vw-24px\)\)\]/);
  assert.match(nodeConfigSource, /inset-x-3 top-16 max-h-\[calc\(100%-148px\)\]/);
  assert.match(nodeConfigSource, /max=\{50\} step=\{1\}[\s\S]*Math\.round\(Number\(e\.target\.value\) \|\| 1\)/);
  assert.match(nodeConfigSource, /min=\{100\} max=\{600000\} step=\{1\}[\s\S]*Math\.round\(Number\(e\.target\.value\) \|\| defaultTimeout\)/);
  assert.match(nodeConfigSource, /min=\{0\} max=\{5\} step=\{1\}[\s\S]*Math\.round\(Number\(e\.target\.value\) \|\| 0\)/);
  assert.match(nodeConfigSource, /max=\{604800\} step=\{1\}[\s\S]*Math\.min\(604800000, Math\.round\(Number\(e\.target\.value\) \* 1000\)\)/);
  assert.match(nodeConfigSource, /source\.kind === 'state'/);
  assert.match(nodeConfigSource, /Select state variable/);
  assert.match(nodeConfigSource, /undeclared/);
  assert.match(nodeConfigSource, /min=\{1\} max=\{32\} step=\{1\}[\s\S]*Math\.round\(Number\(event\.target\.value\) \|\| 8\)/);
  assert.match(nodeConfigSource, /mapping\.type && !VAR_TYPES\.includes\(mapping\.type\)/);
  assert.match(nodeConfigSource, /\(unsupported\)/);
  assert.match(runHistorySource, /awaiting_debug/);
  assert.match(runHistorySource, /'debug', 'subflow'/);
  assert.match(evaluationPanelSource, /min=\{1\} max=\{1001\} step=\{1\}/);
  assert.match(evaluationPanelSource, /Math\.min\(1000, Math\.round\(Number\(event\.target\.value \|\| 1\)\) - 1\)/);
  assert.match(evaluationPanelSource, /'queued', 'running', 'awaiting_approval', 'awaiting_client_tool', 'awaiting_credentials', 'awaiting_debug', 'completed', 'failed', 'cancelled'/);
  assert.match(evaluationPanelSource, /Array\.from\(new Set\(event\.target\.value\.split/);
  assert.match(viteConfigSource, /strictPort:\s*true/);
  assert.match(viteConfigSource, /open:\s*false/);
  assert.match(viteConfigSource, /hmr:\s*false/);
  assert.match(settingsSource, /activeTab === 'governance'/);
  assert.match(settingsSource, /\.join\(', '\)/);
  assert.match(modelsTabSource, /Separate multiple keys with commas/);
  assert.match(modelsTabSource, /type="password"/);
  assert.match(userDataSource, /\.split\(\/\[\\r\\n,\]\+\/\)/);
  assert.match(governanceSource, /listApiKeys\(\)/);
  assert.match(governanceSource, /createApiKey\(/);
  assert.match(governanceSource, /revokeApiKey\(/);
  assert.match(governanceSource, /listAuditEvents\(50\)/);
  assert.match(governanceSource, /rotateCredentialVault\(\)/);
  assert.match(governanceSource, /retireUnusedCredentialVaultKeys\(\)/);
  assert.match(governanceSource, /setAgentBuilderApiToken\(response\.token\)/);
  assert.match(governanceSource, /Managed admin API token/);
  assert.match(governanceSource, /It will not be shown again/);
  assert.match(variablePickerSource, /Workflow variables and node outputs/);
  assert.match(deployPanelSource, /createDeployment\([\s\S]*crypto\.randomUUID\(\)/);
  assert.match(chatPreviewSource, /role="dialog"/);
  assert.match(chatPreviewSource, /aria-modal="true"/);
  assert.match(chatPreviewSource, /aria-labelledby="chat-preview-dialog-title"/);
  assert.match(deployPanelSource, /role="dialog"/);
  assert.match(deployPanelSource, /aria-labelledby="chatkit-deploy-dialog-title"/);
  assert.match(variablePickerSource, /mode === 'template'/);
  assert.match(deployPanelSource, /previousReleaseId/);
  assert.match(deployPanelSource, /releaseId: target\.id/);
  assert.match(deployPanelSource, /Roll back .* to release #/);
  assert.match(deployPanelSource, /This deployment changed in another session/);
  assert.match(batchPanelSource, /listBatches\(\{ workflowId, limit: 10, offset: 0 \}\)/);
  assert.match(batchPanelSource, /batchResponse\?\.batch\?\.workflowId === workflowId/);
  assert.match(batchPanelSource, /historyRequestRef\.current \+= 1/);
  assert.match(batchPanelSource, /Recent batches/);
  assert.match(batchPanelSource, /aria-label="Reload recent batches"/);
  assert.match(batchPanelSource, /No recent batches/);
  assert.match(batchPanelSource, /grid-cols-1 md:grid-cols-\[360px_minmax\(0,1fr\)\]/);
  assert.match(batchPanelSource, /role="dialog" aria-modal="true" aria-labelledby="batch-runs-dialog-title"/);
  assert.match(batchPanelSource, /if \(event\.key === 'Escape'\) \{ onClose\(\); return; \}/);
  assert.match(batchPanelSource, /previouslyFocusedRef\.current = document\.activeElement/);
  assert.match(batchPanelSource, /previouslyFocused\?\.isConnected/);
  assert.match(batchPanelSource, /querySelectorAll<HTMLElement>/);
  assert.match(batchPanelSource, /event\.shiftKey && document\.activeElement === first/);
  assert.match(runHistorySource, /role="dialog" aria-modal="true" aria-labelledby="run-history-dialog-title"/);
  assert.match(evaluationPanelSource, /role="dialog" aria-modal="true" aria-labelledby="evaluation-dialog-title"/);
  assert.match(runHistorySource, /event\.key === 'Escape'\) runHistoryPanelOpen\.set\(false\)/);
  assert.match(evaluationPanelSource, /event\.key === 'Escape'\) evaluationPanelOpen\.set\(false\)/);
  assert.match(chatPreviewSource, /event\.key === 'Escape'\) onClose\(\)/);
  assert.match(deployPanelSource, /event\.key === 'Escape'\) onClose\(\)/);
  assert.match(runHistorySource, /previouslyFocusedRef\.current = document\.activeElement/);
  assert.match(evaluationPanelSource, /previouslyFocusedRef\.current = document\.activeElement/);
  assert.match(chatPreviewSource, /previouslyFocusedRef\.current = document\.activeElement/);
  assert.match(deployPanelSource, /previouslyFocusedRef\.current = document\.activeElement/);
  assert.match(runHistorySource, /trapDialogFocus\(event, 'run-history-dialog-title'\)/);
  assert.match(evaluationPanelSource, /trapDialogFocus\(event, 'evaluation-dialog-title'\)/);
  assert.match(chatPreviewSource, /trapDialogFocus\(event, 'chat-preview-dialog-title'\)/);
  assert.match(deployPanelSource, /trapDialogFocus\(event, 'chatkit-deploy-dialog-title'\)/);
  const dialogFocusSource = fs.readFileSync(path.join(dashboardDir, 'lib', 'dialogFocus.ts'), 'utf8');
  assert.match(dialogFocusSource, /\[contenteditable="true"\]/);
  assert.match(dialogFocusSource, /focusable\.length === 0/);
  assert.match(batchPanelSource, /border-b border-\[#303030\][\s\S]*md:border-b-0 md:border-r/);
  assert.match(deployPanelSource, /refreshDeploymentDetails/);
  assert.match(agentBuilderSource, /variableSources/);
  assert.match(agentBuilderSource, /Workflow input: input_as_text/);
  assert.match(agentBuilderSource, /const entered = Number\(event\.target\.value\) \|\| 0;[\s\S]*Math\.max\(0\.1, Math\.min\(600, entered\)\)/);
  assert.match(agentBuilderSource, /model\.maxOutputTokens !== undefined && modelParams\.maxTokens > model\.maxOutputTokens/);
  assert.match(agentBuilderSource, /if \(selectedEdgeIds\.length > 0\) takeSnapshot\(\);[\s\S]*snapshot: selectedEdgeIds\.length === 0/);
  assert.match(agentBuilderSource, /graphClipboard\.current = null;[\s\S]*\[wfInfo\?\.id\]/);
  assert.match(agentBuilderSource, /w-\[min\(240px,60%\)\]/);
  assert.match(agentBuilderSource, /w-\[min\(220px,60%\)\]/);
  assert.match(agentBuilderSource, /Number\.isFinite\(settings\.confidenceThreshold\)/);
  assert.match(agentBuilderSource, /confidenceThreshold\.toFixed\(2\)/);
  assert.match(agentBuilderSource, /setCodeInterpreterTimeoutMs\(Number\.isFinite\(value\) \? Math\.max\(100, Math\.min\(120000, Math\.round\(value\)\)\) : 5000\)/);
  assert.match(agentBuilderSource, /\^\[A-Za-z_\]\[A-Za-z0-9_-\]\{0,63\}\$/);
  assert.match(agentBuilderSource, /Function parameters must be an object JSON schema/);
  assert.match(agentBuilderSource, /setMcpApprovalTimeoutMs\(event\.target\.value === '' \? 0 : Math\.max\(0, Math\.min\(604800000/);
  assert.match(agentBuilderSource, /toolExecutionPolicy\.timeoutMs.*Number\.isFinite\(value\)/);
  assert.match(agentBuilderSource, /selectedPreviewNodeId=\{selectedPreviewNodeId\}/);
  assert.match(agentBuilderSource, /onPreviewNodeChange=\{setSelectedPreviewNodeId\}/);
  assert.match(agentBuilderSource, /previewOpen && node\.type !== 'note'/);
  assert.match(agentBuilderSource, /useNanoStore\(runState\)/);
  assert.match(agentBuilderSource, /agent-run-node-running/);
  assert.match(agentBuilderSource, /agent-run-node-ok/);
  assert.match(agentBuilderSource, /agent-run-node-error/);
  assert.match(agentBuilderSource, /<PublishWorkflowModal backend=\{backend\} onFocusNode=\{focusRunNode\}/);
  assert.match(publishModalSource, /RELEASE_BLOCKING_SAFETY_CODES/);
  assert.match(publishModalSource, /SAFETY_PRIVILEGED_PATH_UNGUARDED/);
  assert.match(publishModalSource, /disabled=\{publishing \|\| publishBlocked\}/);
  assert.match(publishModalSource, /Fix blockers to publish/);
  assert.match(publishModalSource, /Open node/);
  assert.match(publishModalSource, /validationErrors = workflow\.errorIssues/);
  assert.match(publishModalSource, /issue\.nodeId && onFocusNode/);
  assert.match(codeExportModalSource, /role="dialog"/);
  assert.match(codeExportModalSource, /aria-modal="true"/);
  assert.match(codeExportModalSource, /aria-labelledby="code-export-dialog-title"/);
  assert.match(codeExportModalSource, /event\.key === 'Escape'/);
  assert.match(codeExportModalSource, /event\.key !== 'Tab'/);
  assert.match(codeExportModalSource, /previouslyFocused\?\.isConnected/);
  assert.match(codeExportModalSource, /aria-label="Close export dialog"/);
  assert.match(runPanelSource, /Node inspector/);
  assert.match(runPanelSource, /Resolved input/);
  assert.match(runPanelSource, /State after/);
  assert.match(runPanelSource, /Open raw trace/);
  assert.match(runPanelSource, /previewSelectionPinned/);
  assert.match(runPanelSource, /Paused in subflow/);
  assert.match(runPanelSource, /inset-x-3 top-16 bottom-3 w-auto[\s\S]*md:right-6 md:top-24 md:bottom-6 md:w-\[380px\]/);
  assert.match(backendHookSource, /nestedWait/);
  assert.match(backendHookSource, /streamRunEventsRealtime\(runId, handleRunEvent/);
  assert.match(backendHookSource, /streamRunEvents\(runId, handleRunEvent/);
  assert.match(backendHookSource, /afterEventId: lastEventId/);
  assert.match(backendHookSource, /preserveExistingNodeSelection\(rf\.nodes, nodesRef\.current\)/);
  assert.match(backendHookSource, /const \{ validation \} = await clientRef\.current\.validateGraph\(workflow\.id\);[\s\S]*readyRef\.current = false;[\s\S]*setNodes\(refreshedNodes\)/);
});

it('keeps the QA user-data dependency identity stable across renders', async () => {
  const module = await import(`${pathToFileURL(path.join(dashboardDir, 'test', 'agent-builder-qa-user-data.ts')).href}?v=${Date.now()}`);
  assert.equal(module.useUserDataContext(), module.useUserDataContext());
  assert.equal(module.useUserDataContext().apiKeys, module.useUserDataContext().apiKeys);
});
