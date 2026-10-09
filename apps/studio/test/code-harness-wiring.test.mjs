/**
 * How the harness is wired into the Code tab.
 *
 * These read source rather than render, like the rest of this suite: the
 * properties pinned here — one generation path, no Agent tool, the transcript
 * saved on the message, Stop that keeps finished work — live in a 4,000-line
 * component that has no render harness.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...segments) => fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
const code = (...segments) => read('features', 'code', 'src', ...segments);

it('runs every Code turn on the harness, the Test tool included', () => {
  const sidebar = code('workbench', 'WorkbenchSidebar.tsx');
  assert.match(sidebar, /await startHarnessGeneration\(text, processedAttachments, \{ mode: options\.mode, tool: options\.tool \}\)/);
  assert.match(sidebar, /void startHarnessGeneration\(prompt, processedAttachments, \{\s*history: \[\],\s*mode: initialToolId === 'plan' \? 'plan' : 'build',\s*tool: initialToolId as CodeToolId \| null,\s*\}\)/, 'the opening turn takes the same path');
  assert.match(sidebar, /const result = await runWorkbenchTurn\(\{/);
  assert.match(sidebar, /selectedTool: tool,/);
  for (const gone of ['startAiGeneration', 'startCodexGeneration', 'startTestGeneration', 'runComputerUseTest', 'BOLT_SYSTEM_PROMPT', 'createMessageParser', 'processAIResponse']) {
    assert.doesNotMatch(sidebar, new RegExp(gone), `${gone} is still referenced`);
  }
});

it('builds both Tools menus from the one catalog, with no Agent tool', async () => {
  for (const file of [code('workbench', 'WorkbenchSidebar.tsx'), code('CodeHome.tsx')]) {
    assert.doesNotMatch(file, /id: 'agent'/);
    assert.doesNotMatch(file, /agent-store|agentEngaged|ultraEngaged|extraEfforts=\{/);
    assert.match(file, /const TOOLS = CODE_TOOLS\.map\(/);
  }
  const { CODE_TOOLS } = await importTs(path.join(repoRoot, 'features', 'code', 'src', 'harness', 'code-tools.ts'));
  assert.deepEqual(CODE_TOOLS.map((tool) => tool.label), ['Plan', 'Image', 'Design', 'Annotate', 'Visual Edits', 'Test']);
  assert.equal(fs.existsSync(path.join(repoRoot, 'features', 'code', 'src', 'agent')), false);
  assert.doesNotMatch(code('workbench', 'WorkbenchPreview.tsx'), /agent-store|setPreviewFrame/);
});

it('tests in the workbench preview panel, with the Test tool\'s own visuals, not a frame of its own', () => {
  const bridge = code('harness', 'run-turn.ts');
  assert.match(bridge, /const preview = new PreviewSession\(\{\s*session: options\.session,\s*syncFiles: [^}]*showPreview: options\.environment\?\.showPreview,\s*requestStop: options\.environment\?\.requestStop,\s*\}\);/);
  assert.doesNotMatch(bridge, /getFrame/, 'the workbench never hands the agent a separate frame');
  assert.match(code('harness', 'browser', 'preview-session.ts'), /: this\.#options\.session\.test\.getIframeRef\(\);/, "the screen's own preview frame");
  const preview = code('workbench', 'WorkbenchPreview.tsx');
  assert.match(preview, /testStore\.setIframeRef\(el\);/);
  assert.match(preview, /<TestCursor iframeRef=\{iframeRef\} \/>/);
  assert.match(preview, /<TestModeGlow isActive=\{isTestMode\} \/>/);
  assert.match(preview, /<TestStatusIndicator isActive=\{isTestMode\} \/>/);
});

it('lets the preview\'s Stop button stop the turn that is testing', () => {
  const sidebar = code('workbench', 'WorkbenchSidebar.tsx');
  assert.match(sidebar, /requestStop: \(\) => abortController\.abort\(\)/);
  const store = read('platform', 'ai', 'src', 'computer-use', 'test-store.ts');
  assert.match(store, /const handler = this\._cancelHandler;\s*this\._cancelHandler = null;\s*handler\?\.\(\);/);
  // The live transcript stays on screen while the agent tests.
  assert.match(sidebar, /\{isCurrentlyGenerating && \(/);
  assert.doesNotMatch(sidebar, /isCurrentlyGenerating && !testStore\.isTestMode\.get\(\)/);
});

it('rebuilds the live preview when the harness asks, with source locations', () => {
  const preview = code('workbench', 'WorkbenchPreview.tsx');
  assert.match(preview, /justReverted \|\| justRequested;/);
  assert.match(preview, /const isVisualEdit = \(isVisualEditMode\.get\(\) && codeSession\.onShow\.get\(\)\) \|\| previewInspectable\.get\(\);/);
  assert.match(preview, /activeSnapshotId, rebuildRequest\]\);/);
});

it('hands the landing composer\'s tool to the first turn', () => {
  const home = code('CodeHome.tsx');
  assert.match(home, /setInitialToolId\(selectedToolId\)/);
  assert.match(home, /initialToolId=\{initialToolId\}/);
});

it('saves the transcript on the message and reads it back on reopen', async () => {
  const sidebar = code('workbench', 'WorkbenchSidebar.tsx');
  assert.match(sidebar, /steps: result\.steps,/);
  assert.match(sidebar, /<TurnTimeline steps=\{msg\.steps\} renderText=\{renderTextContent\} resolveAsset=\{resolveProjectAsset\} onOpenDesign=\{openDesign\} \/>/);
  assert.match(sidebar, /<LiveTurnTimeline renderText=\{renderTextContent\} resolveAsset=\{resolveProjectAsset\} onOpenDesign=\{openDesign\} \/>/);

  const { sanitizeResumedCodeMessages } = await importTs(path.join(repoRoot, 'features', 'code', 'src', 'workbench', 'resume-code-chat.ts'));
  const [message] = sanitizeResumedCodeMessages([{
    id: 'a',
    role: 'assistant',
    content: '',
    harnessMode: 'plan',
    steps: [
      { id: '1', kind: 'file', action: 'write', path: '/App.tsx', status: 'running' },
      { id: '2', kind: 'mystery' },
      'junk',
    ],
  }]);
  assert.deepEqual(message.steps.map((step) => [step.id, step.status]), [['1', 'done']], 'unknown steps drop, running ones read as done');
  assert.equal(message.harnessMode, 'plan');
});

it('lets Stop wind the turn down so finished work is kept', () => {
  const sidebar = code('workbench', 'WorkbenchSidebar.tsx');
  assert.match(sidebar, /controller\.abort\(\);\s*setTimeout\(\(\) => \{\s*if \(generationRunIdRef\.current === runId && generationAbortControllerRef\.current === controller\) resetNow\(\);/);

  const bridge = code('harness', 'run-turn.ts');
  // The preview tools let go first, then the commit happens whatever the reason the turn ended —
  // unless the screen that started it has unmounted.
  assert.match(bridge, /preview\.dispose\(\);[\s\S]*const committed = isLive\(\) && applyToWorkbench\(sandpackStore, result\.workspace, assets\);[\s\S]*sandpackStore\.isGenerating\.set\(false\);/);
});

it('offers "Implement plan" under a plan, asked for or proposed, and runs it as a build', () => {
  const sidebar = code('workbench', 'WorkbenchSidebar.tsx');
  assert.match(sidebar, /msg\.harnessMode === 'plan' && isLastAssistantMessage && !isCurrentlyGenerating/);
  assert.match(sidebar, /handleSendMessage\('Implement the plan\.', \{ mode: 'build', tool: null \}\)/);
  assert.match(sidebar, /harnessMode: mode === 'plan' \|\| result\.awaitingApproval \? 'plan' : undefined/);
});

it('reads back the new transcript steps from a saved chat', async () => {
  const { sanitizeResumedCodeMessages } = await importTs(path.join(repoRoot, 'features', 'code', 'src', 'workbench', 'resume-code-chat.ts'));
  const [message] = sanitizeResumedCodeMessages([{
    id: 'b',
    role: 'assistant',
    content: 'Tested it.',
    steps: [
      { id: '1', kind: 'computer', action: 'click', label: '"Add" button', status: 'done' },
      { id: '2', kind: 'image', origin: 'annotation', src: 'data:image/jpeg;base64,AAAA', caption: 'Found', notes: ['One'], status: 'done' },
      { id: '3', kind: 'image', origin: 'annotation', src: 'javascript:alert(1)', caption: 'x', status: 'done' },
      { id: '4', kind: 'design', name: 'Pricing', nodeId: 'design-1', status: 'done' },
    ],
  }]);
  assert.deepEqual(message.steps.map((step) => step.kind), ['computer', 'image', 'image', 'design']);
  assert.equal(message.steps[1].src, 'data:image/jpeg;base64,AAAA');
  assert.equal(message.steps[2].src, undefined, 'only a data: image is kept inline');
});

it('thinks in one row above the reply: dots and the newest thought while the turn runs, "Thought for Ns" after', () => {
  const timeline = code('harness', 'ui', 'TurnTimeline.tsx');
  assert.doesNotMatch(timeline, /Lightbulb|>\s*Thinking\s*</, 'no thinking rows between the work');

  const row = code('harness', 'ui', 'ThinkingRow.tsx');
  assert.match(row, /<GeminiThinkingVisualizer \/>/);
  assert.match(row, /useMemo\(\(\) => latestThoughtHeading\(thoughts\), \[thoughts\]\)/);
  assert.match(row, /\{heading && <ThoughtSummaryLine heading=\{heading\} \/>\}/);

  const sidebar = code('workbench', 'WorkbenchSidebar.tsx');
  assert.match(sidebar, /\{isCurrentlyGenerating && \(\s*<div\s+ref=\{streamingContentRef\}[\s\S]{0,900}?<LiveThinkingRow \/>/, 'the row tops the reply in flight');
  assert.doesNotMatch(sidebar, /thinkingTimerRef|currentThinkingTime|onFirstOutput/, 'no clock that stops at the first output');
  assert.match(sidebar, /const thinkingTime = result\.thinkingMs > 0 \? Math\.max\(1, Math\.round\(result\.thinkingMs \/ 1000\)\) : 0;/);
  assert.match(sidebar, /<Lightbulb size=\{18\} \/>\s*<span className="text-\[15\.15px\] font-medium">\s*Thought for \{Math\.round\(msg\.thinkingTime\)\}s/);

  assert.match(code('harness', 'model.ts'), /includeThoughts: thinkingLevel > 0/);
});

it('resolves the model through the live provider profile, with the whole key bucket', () => {
  const model = code('harness', 'model.ts');
  assert.match(model, /resolveProviderBinding\(modelConfig, provider, selected \? \{ profileId: selected\.profileId \} : undefined\)/);
  assert.match(model, /apiKeyFallbacks: keys\.slice\(1\)/);
  assert.doesNotMatch(model, /apiFormat:\s*selected\??\.apiFormat|toolPolicy:\s*selected\??\.toolPolicy/);
});

it('reads skills and connectors at send time, scoped to the workspace', () => {
  const sidebar = code('workbench', 'WorkbenchSidebar.tsx');
  assert.match(sidebar, /skills: enabledSkills\(chatScopeId \|\| 'guest'\)/);
  assert.match(sidebar, /connectors: mode === 'build' \? boundMcpTools\(\) : \[\]/);
  assert.match(sidebar, /void connectEnabledMcpServers\(\);/);
  assert.match(sidebar, /SKILL_MENTION_AT_CARET/, 'the composer offers $skill mentions');
});

it('keeps the harness check off the channel that raises toasts', () => {
  const verify = code('harness', 'verify.ts');
  assert.match(verify, /errorMessageType: PROBE_ERROR_MESSAGE/);
  assert.doesNotMatch(verify, /PREVIEW_ERROR'/);
  assert.match(verify, /bundleFiles\(files, \{ strict: true \}\)/);
});

it('keeps the Codex sync tool for Spark only', () => {
  const script = read('tools', 'scripts', 'sync-codex-upstream.mjs');
  assert.doesNotMatch(script, /'features', 'code', 'src', 'agent'/);
  assert.match(script, /'features', 'spark', 'src', 'harness', 'upstream'/);
});
