import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

class MemoryStorage {
  constructor() { this.items = new Map(); }
  get length() { return this.items.size; }
  key(index) { return [...this.items.keys()][index] ?? null; }
  getItem(key) { return this.items.has(key) ? this.items.get(key) : null; }
  setItem(key, value) { this.items.set(key, String(value)); }
  removeItem(key) { this.items.delete(key); }
  clear() { this.items.clear(); }
}

const SCOPE = 'user-1::root';
const TASK_ID = 'task-1';
const jobKey = `willow:job:spark:${SCOPE}:${TASK_ID}`;
const liveJob = (heartbeatAt) => JSON.stringify({
  id: `spark:${SCOPE}:${TASK_ID}`,
  kind: 'spark-run',
  scopeId: SCOPE,
  payload: { taskId: TASK_ID },
  owner: 'another-tab',
  startedAt: heartbeatAt,
  heartbeatAt,
  takeovers: 0,
});
const runningTask = {
  id: TASK_ID,
  prompt: 'Explain rainbows',
  title: 'Rainbows',
  status: 'running',
  description: 'Working on your task',
  progressLabel: 'Thinking it through…',
  response: 'Light bends',
  turns: [],
  createdAt: '2026-10-03T10:00:00.000Z',
  updatedAt: '2026-10-03T10:00:05.000Z',
};

describe('a run another tab is still doing is not "interrupted"', () => {
  let jobs;
  let spark;
  before(async () => {
    globalThis.localStorage = new MemoryStorage();
    // Spark's cross-tab channel would hold the test process open.
    globalThis.BroadcastChannel = undefined;
    jobs = await importTs(path.join(ROOT, 'platform/core/src/background-jobs.ts'));
    spark = await importTs(path.join(ROOT, 'features/spark/src/spark-store.ts'));
  });

  it('reads a job record as live only while its heartbeat is fresh', () => {
    localStorage.clear();
    const now = Date.now();
    assert.equal(jobs.readLiveBackgroundJob(`spark:${SCOPE}:${TASK_ID}`, now), null);
    localStorage.setItem(jobKey, liveJob(now - 10_000));
    assert.equal(jobs.readLiveBackgroundJob(`spark:${SCOPE}:${TASK_ID}`, now)?.owner, 'another-tab');
    localStorage.setItem(jobKey, liveJob(now - jobs.JOB_STALE_MS - 1));
    assert.equal(jobs.readLiveBackgroundJob(`spark:${SCOPE}:${TASK_ID}`, now), null);
    localStorage.setItem(jobKey, '{not json');
    assert.equal(jobs.readLiveBackgroundJob(`spark:${SCOPE}:${TASK_ID}`, now), null);
  });

  it('names the job the way the run starts it', () => {
    assert.equal(spark.sparkRunJobId(SCOPE, TASK_ID), `spark:${SCOPE}:${TASK_ID}`);
    assert.match(read('features/spark/src/SparkWorkspace.tsx'), /id: sparkRunJobId\(scopeId, taskId\),/);
  });

  it('never rewrites a task read back from disk as interrupted', () => {
    localStorage.clear();
    const parsed = spark.parseSparkTask(JSON.stringify(runningTask), TASK_ID);
    assert.equal(parsed.status, 'running');
    assert.equal(parsed.response, 'Light bends');
    assert.notEqual(parsed.description, 'Run interrupted');
  });

  // Loading a body keeps the summary's status; what the recovery changes is the
  // body, so a run saved before any text shows the "interrupted" notice.
  const loadBody = (withLiveJob) => {
    localStorage.clear();
    spark.hydrateSparkState(SCOPE);
    const created = spark.createSparkTask(runningTask.prompt, { status: 'running' });
    const record = { ...runningTask, id: created.id, response: '' };
    localStorage.setItem(
      `willow:spark:task:v1:${encodeURIComponent(SCOPE)}:${encodeURIComponent(created.id)}`,
      JSON.stringify(record),
    );
    spark.sparkState.set({
      ...spark.sparkState.get(),
      tasks: spark.sparkState.get().tasks.map((task) => task.id === created.id ? { ...task, bodyLoaded: false } : task),
    });
    if (withLiveJob) {
      localStorage.setItem(`willow:job:spark:${SCOPE}:${created.id}`, liveJob(Date.now()).replaceAll(TASK_ID, created.id));
    }
    return spark.ensureSparkTaskBodyLoaded(created.id);
  };

  it('still recovers a run no tab is doing as interrupted when its body loads', () => {
    const task = loadBody(false);
    assert.equal(task.response, 'This task was interrupted when Willow closed. Retry it to continue.');
  });

  it('keeps a run another tab is doing as running when its body loads', () => {
    const task = loadBody(true);
    assert.equal(task.status, 'running');
    assert.equal(task.response, '');
  });
});

describe('background work wiring', () => {
  const app = read('apps/studio/src/app/App.tsx');
  const chatView = read('features/chat/src/ChatView.tsx');
  const spark = read('features/spark/src/SparkWorkspace.tsx');

  it('makes every Spark run a job, finished on every exit', () => {
    assert.match(spark, /const beginSparkRun = \(scopeId: string, taskId: string, turnId\?: string\)/);
    assert.match(spark, /beginSparkRun\(executionScope, taskId, turnId\)/, 'a follow-up records which turn to retry');
    const finish = spark.slice(spark.indexOf('const finishSparkRun'), spark.indexOf('const settleInterruptedSparkRun'));
    assert.match(finish, /sparkRunJobs\.get\(key\)\?\.finish\(\)/);
  });

  it('resumes a Spark run by retrying the task or the follow-up it was on', () => {
    const takeover = spark.slice(spark.indexOf('registerBackgroundJobKind<SparkRunJob>'), spark.indexOf('const changeResponseReaction'));
    assert.match(takeover, /canTakeOver: \(job\) => job\.scopeId === getActiveSparkStorageScope\(\)/);
    assert.match(takeover, /if \(turnId\) retryRef\.current\.retryTurn\(taskId, turnId\);\s*else retryRef\.current\.retryTask\(taskId\);/);
    assert.match(takeover, /abandon: \(job\) => settleInterruptedSparkRun\(job\.payload\)/);
  });

  it('only gives a saved chat turn a job, and always finishes it', () => {
    assert.match(chatView, /const job = !isIncognito && isLocalFolderConnected\s*\? startChatTurnJob\(record, \{ selectedModelId, notebookId, gemId, tool: tool \?\? null \}\)\s*: null;/);
    assert.match(chatView, /\} finally \{\s*job\?\.finish\(\);\s*\}/);
    assert.match(read('features/chat/src/chat-turn-store.ts'), /record\.chatId = to;\s*record\.job\?\.update\(\{ chatId: to \}\);/,
      'a renamed chat must reach the job, or another tab would look for the old file');
  });

  it('lets every tab resume chat turns, and shows one resumed in the open chat', () => {
    assert.match(app, /<ChatTurnTakeover modelConfig=\{modelConfig\} \/>/);
    const attach = chatView.slice(chatView.indexOf('const turnsVersion = useStore(chatTurnsVersion);'));
    assert.match(attach, /if \(!activeChatId \|\| attachedTurnIdRef\.current \|\| sendInFlightRef\.current\) return;/);
    assert.match(attach, /forceExternalReloadRef\.current = true;\s*setExternalReloadVersion/);
  });

  it('keeps Code and Design mounted outside the view switch while they work', () => {
    // A working Code home stays, and the one on show once it has been opened: Code is one of the rail's tabs.
    assert.match(app, /const mountedCodeHomes = codeHomes\.filter\(\(home\) =>\s*keptCodeHomes\.has\(home\.key\) \|\| \(home === shownCodeHome && codeHomeOpenedRef\.current\)\);/);
    assert.match(app, /const workingCodeHomes = runningCodeScreens\.filter\(isCodeHomeScreen\);/,
      'a Code home stays for its own turn, not for a project\'s');
    assert.match(app, /\{isShownCodeHomeMounted && isCodeSurface && <CodeHomeSlot container=\{shownCodeHome\.container\} parking=\{codeParkingRef\} \/>\}/);
    assert.match(app, /\{mountedCodeHomes\.map\(\(home\) => \{/, 'their trees live above the routes, so the Media editor does not unmount them');
    assert.match(app, /\(isDesignSurface \|\| keepDesignAlive\) && \(/);
    // New chat is Chat's: it never resets a Code home, so a working one carries on.
    assert.doesNotMatch(app, /codeResetKey|setCodeResetKey/);
    assert.doesNotMatch(read('features/code/src/CodeHome.tsx'), /chatResetKey/);
    assert.match(app, /onWorkspaceActive=\{isShown \? setIsSidebarHidden : undefined\}/);
    assert.match(read('features/code/src/workbench/WorkbenchSidebar.tsx'), /setCodeScreenRunning\(codeSession\.screenKey, isCurrentlyGenerating\)/);
    assert.match(read('features/design/src/DesignChat.tsx'), /designTurnRunning\.set\(isCurrentlyGenerating\)/);
  });

  it('moves the Code home without reloading its preview', () => {
    const move = app.slice(app.indexOf('const moveInto = '), app.indexOf('const CodeHomeSlot'));
    assert.match(move, /if \(moveBefore && node\.isConnected && parent\.isConnected\) moveBefore\.call\(parent, node, null\);\s*else parent\.appendChild\(node\);/);
    const slot = app.slice(app.indexOf('const CodeHomeSlot'), app.indexOf('/** Set while a guarded route'));
    assert.match(slot, /React\.useLayoutEffect\(\(\) => \{[\s\S]*moveInto\(slot, container\);[\s\S]*return \(\) => \{\s*if \(parking\.current\) moveInto\(parking\.current, container\);/);
    // After the routes, so a slot mounting in the same commit has moved it before it measures.
    assert.ok(app.indexOf('<div ref={codeParkingRef}') > app.lastIndexOf('</Routes>'));
  });

  it('hides a kept-alive screen in a way no descendant can undo', () => {
    const style = app.slice(app.indexOf('const BACKGROUND_SURFACE_STYLE'), app.indexOf('const VISIBLE_SURFACE_STYLE'));
    assert.match(style, /opacity: 0,/);
    assert.match(style, /position: 'fixed',/);
    assert.match(app, /<div ref=\{codeParkingRef\} style=\{BACKGROUND_SURFACE_STYLE\} inert aria-hidden="true" \/>/);
    assert.match(app, /inert=\{!isDesignSurface\}/);
  });

  it('keeps the Media editor above the routes, rendered against its own last location', () => {
    const keeper = app.slice(app.indexOf('const MediaKeepAlive'), app.indexOf('/** Make projects created on another device'));
    assert.match(keeper, /useKeepAlive\(useStore\(\$mediaWorkRunning\) \|\| resume !== null \|\| leftOpen\)/);
    assert.match(keeper, /const leftOpen = useStore\(\$railReturns\)\.media !== null;/, 'a project left for another rail place waits as it was');
    assert.match(keeper, /<Routes location=\{shown\}>/);
    assert.match(keeper, /<MediaBackgroundContext\.Provider value=\{!isOnMedia\}>/);
    assert.match(app, /<MediaKeepAlive\s+modelConfig=\{modelConfig\}/);
    const media = read('features/media/src/MediaView.tsx');
    assert.match(media, /\$mediaWorkRunning\.set\(isMediaWorking\)/);
    assert.match(media, /\{activeSceneId && createPortal\(\s*<div\s+inert=\{isBackground\}/, 'the Scenebuilder is portalled outside the hidden host');
    assert.match(media, /\{!isBackground && <SceneSnackbarHost \/>\}/);
    assert.match(media, /if \(!window\.location\.pathname\.startsWith\('\/media'\)(?: \|\| [^)]+\))?\) return;/, 'gallery keys only on screen');
  });

  it('keeps Spark running in the background on every route', () => {
    const backgroundSpark = app.indexOf('<SparkWorkspace\n                backgroundOnly') >= 0
      ? app.indexOf('<SparkWorkspace\n                backgroundOnly')
      : app.search(/<SparkWorkspace\s+backgroundOnly/);
    assert.ok(backgroundSpark > app.indexOf('<LocalFSProvider') && backgroundSpark < app.indexOf('<Routes>'),
      'the background Spark instance sits above the routes');
    // Until Spark's own workspace is mounted, kept tab that it is: that one does the same work, hidden or not.
    assert.match(app, /!\(shellShownRef\.current && keptShellTabs\.includes\('spark'\)\)/);
  });

  it('makes every saved Code turn a job that follows its conversation and dies with its screen', () => {
    const sidebar = read('features/code/src/workbench/WorkbenchSidebar.tsx');
    const start = sidebar.slice(sidebar.indexOf('const startHarnessGeneration = async ('), sidebar.indexOf('const runHarnessGeneration = async ('));
    assert.match(start, /const job = place && isLocalFolderConnected\s*\? startCodeTurnJob\(options\.jobId, chatScopeId \|\| 'guest', \{ place, mode, tool, selectedModelId: turnModelId \}\)\s*: null;/);
    assert.match(start, /\} finally \{\s*if \(turnJobRef\.current === job\) turnJobRef\.current = null;\s*job\?\.finish\(\);\s*\}/);
    assert.match(sidebar, /if \(!isProjectPromoted\) return \{ target: 'chat', chatId: codeChatTitle \|\| codeChatSessionId \};/);
    assert.match(sidebar, /if \(place\) turnJobRef\.current\?\.update\(\{ place \}\);/, 'promotion and naming move the job with the chat');
    assert.match(sidebar, /isMountedRef\.current = false;\s*turnJobRef\.current\?\.finish\(\);/);
    assert.match(sidebar, /isLive: \(\) => isMountedRef\.current,/);
  });

  it('gives every Code screen its own files, transcript, preview and testing overlay', async () => {
    const { createCodeSession, $activeCodeSession, $codeScreenSwitches, activeWorkbench, isOwnPreviewMessage } = await importTs(path.join(ROOT, 'features/code/src/session/code-session.ts'));
    const home = createCodeSession('home');
    const project = createCodeSession('project');
    project.workbench.setFile('/App.tsx', 'export default () => "project";');
    home.workbench.resetToTemplate();
    home.workbench.isGenerating.set(true);
    home.harness.publish({ steps: [], phase: null, thoughts: 'planning' });
    home.preview.requestRebuild();
    home.preview.viewport.set('mobile');
    home.test.enterTestMode();
    home.newChat.set(1);
    assert.equal(project.workbench.getFile('/App.tsx'), 'export default () => "project";', 'the Code home resetting its files left the project alone');
    assert.equal(project.workbench.isGenerating.get(), false);
    assert.equal(project.harness.liveTurn.get(), null);
    assert.equal(project.preview.rebuildRequest.get(), 0);
    assert.equal(project.preview.viewport.get(), null);
    assert.equal(project.test.isTestMode.get(), false);
    assert.equal(project.newChat.get(), 0);

    // Visual editing acts on the screen last on show, and on nothing when none is mounted.
    $activeCodeSession.set(project);
    assert.equal(activeWorkbench(), project.workbench);
    $activeCodeSession.set(null);
    assert.ok(activeWorkbench() !== home.workbench && activeWorkbench() !== project.workbench);
    // The tab-wide panels start over when a different screen comes on show, not when the same one returns.
    const switches = $codeScreenSwitches.get();
    $activeCodeSession.set(home);
    assert.equal($codeScreenSwitches.get(), switches + 1);
    $activeCodeSession.set(null);
    $activeCodeSession.set(home);
    assert.equal($codeScreenSwitches.get(), switches + 1);
    $activeCodeSession.set(null);

    // Every screen hears every frame's messages; each takes its own.
    const hadWindow = 'window' in globalThis;
    if (!hadWindow) globalThis.window = globalThis;
    const frame = { contentWindow: {} };
    home.test.setIframeRef(frame);
    assert.equal(isOwnPreviewMessage(home, { source: frame.contentWindow, data: { type: 'PREVIEW_ERROR' } }), true);
    assert.equal(isOwnPreviewMessage(project, { source: frame.contentWindow, data: { type: 'PREVIEW_ERROR' } }), false);
    assert.equal(isOwnPreviewMessage(project, { source: window, data: { type: 'PREVIEW_ERROR', screen: 'project' } }), true, "its own build's error");
    assert.equal(isOwnPreviewMessage(home, { source: window, data: { type: 'PREVIEW_ERROR', screen: 'project' } }), false);
    if (!hadWindow) delete globalThis.window;
  });

  it("streams a hidden screen's transcript a few times a second, and the one on show every frame", async () => {
    const { createCodeSession } = await importTs(path.join(ROOT, 'features/code/src/session/code-session.ts'));
    const hidden = createCodeSession('project:a', false);
    const shown = createCodeSession('project:b', true);
    const turn = { steps: [], phase: null, thoughts: 'checking the layout' };
    hidden.harness.publish(turn);
    shown.harness.publish(turn);
    assert.equal(shown.harness.liveTurn.get(), turn, 'no animation frames here, so the one on show publishes at once');
    assert.equal(hidden.harness.liveTurn.get(), null);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(hidden.harness.liveTurn.get(), turn);
  });

  it('runs a turn against its own screen, and lets one whose screen unmounted write nothing', () => {
    const runTurn = read('features/code/src/harness/run-turn.ts');
    assert.match(runTurn, /const \{ workbench: sandpackStore, harness \} = options\.session;/);
    assert.match(runTurn, /syncFiles: \(workspace\) => isLive\(\) && applyToWorkbench\(sandpackStore, workspace, assets\),/);
    assert.match(runTurn, /const committed = isLive\(\) && applyToWorkbench\(sandpackStore, result\.workspace, assets\);/);
    assert.match(runTurn, /onUpdate: \(state\) => \{ if \(isLive\(\)\) harness\.publish\(state\); \},/);
    assert.match(read('features/code/src/workbench/WorkbenchSidebar.tsx'), /session: codeSession,\s*isLive: \(\) => isMountedRef\.current,/);
  });

  it('keeps a list of the Code screens running, by name', async () => {
    const { $runningCodeScreens, setCodeScreenRunning } = await importTs(path.join(ROOT, 'features/code/src/workbench/code-turn-activity.ts'));
    setCodeScreenRunning('home', true);
    setCodeScreenRunning('project:a', true);
    const both = $runningCodeScreens.get();
    setCodeScreenRunning('home', true);
    assert.equal($runningCodeScreens.get(), both, 'no change, no new list: App re-renders only when it changes');
    setCodeScreenRunning('home', false);
    assert.deepEqual($runningCodeScreens.get(), ['project:a']);
    setCodeScreenRunning('project:a', false);
    assert.deepEqual($runningCodeScreens.get(), []);
  });

  it('resumes an inherited Code turn by sending its message again once the conversation loaded', () => {
    const sidebar = read('features/code/src/workbench/WorkbenchSidebar.tsx');
    const resume = sidebar.slice(sidebar.indexOf('const codeResume = useStore($codeResume);'), sidebar.indexOf('const handleSendMessage = async'));
    assert.match(resume, /if \(!codeResume \|\| resumedJobRef\.current === codeResume\.job\.id \|\| !isSessionHydrated \|\| isCurrentlyGenerating\) return;/);
    assert.match(resume, /if \(question\?\.role !== 'user'\) \{\s*codeResume\.settle\(\);\s*return;\s*\}/, 'a conversation that ends on a reply has nothing to resume');
    assert.match(resume, /jobId: codeResume\.job\.id,\s*selectedModelId: jobModelId,/);
    const home = read('features/code/src/CodeHome.tsx');
    assert.match(home, /codeResume\.job\.payload\.place\.target !== 'chat'/);
    assert.match(home, /setResumeChatId\(chatId\);\s*setWorkbenchInstanceKey\(`job-\$\{jobId\}`\);/);
  });

  it('opens every project in a screen of its own, kept while it works, and never one project twice', () => {
    const screens = app.slice(app.indexOf('const CodeProjectScreens'), app.indexOf('/** The first project to open when'));
    assert.match(screens, /if \(visible\) locations\.set\(visible, location\);/);
    assert.match(screens, /const busy = running\.filter\(\(key\) => locations\.has\(key\)\);/);
    assert.match(screens, /if \(key !== visible && !kept\.has\(key\)\) locations\.delete\(key\);/, 'an idle project leaves as soon as it is left');
    assert.match(screens, /<Routes location=\{shown\}>/);
    assert.match(screens, /<WorkbenchView screenKey=\{screenKey\} isOnShow=\{isOnShow\} \{\.\.\.workbenchProps\} \/>/);
    assert.match(screens, /Object\.entries\(savingInto\)\.find\(\(\[key, name\]\) => isCodeHomeScreen\(key\) && name === requestedName\)/,
      'a project a Code home has open opens there, not in a second screen writing the same folder');
    assert.match(app, /<RouteMarker store=\{\$workbenchRouteActive\} \/>/, 'the route guard still decides when a project shows');
    // The one-screen rules are gone: Code opens the Code home, and the Home button lands on it.
    assert.doesNotMatch(app, /lastCodeHostRef|isWorkbenchKept|setStudioMode\('chat'\);\s*\}, \[isCodeSurface/);

    const takeover = app.slice(app.indexOf('const CodeTurnTakeover'), app.indexOf('/** `useKeepAlive` for a set of screens'));
    assert.match(takeover, /if \(place\.target === 'chat'\) return !gate\.current\.homeMounted;/);
    assert.match(takeover, /return !gate\.current\.projectScreens\.has\(projectScreenFor\(place\.projectId\)\)\s*&& !Object\.values\(\$codeScreenProjects\.get\(\)\)\.includes\(place\.projectName\);/);
  });

  it('opens a Recents Code chat where it already is, or beside a Code home still working', () => {
    const routing = app.slice(app.indexOf('const codeChatOpenRequest = useStore(pendingCodeChatOpen);'), app.indexOf('// A project a Code home has open reopens there'));
    assert.match(routing, /if \(holder && homes\.some\(\(home\) => home\.key === holder\)\) return showCodeHome\(homes, holder\);/,
      'a chat already open is shown as it is, never read back over a running turn');
    assert.match(routing, /if \(\$runningCodeScreens\.get\(\)\.includes\(shown\.key\)\) return \[\.\.\.homes, makeCodeHome\(freshKey, request\)\];/,
      'a working Code home keeps working');
    assert.match(routing, /return \[\.\.\.homes\.slice\(0, -1\), \{ \.\.\.shown, open: request \}\];/);
    const home = read('features/code/src/CodeHome.tsx');
    assert.match(home, /if \(!openRequest \|\| openRequest\.epoch === handledOpenEpochRef\.current\) return;\s*handledOpenEpochRef\.current = openRequest\.epoch;\s*onOpenHandled\?\.\(openRequest\.epoch\);/);
    assert.doesNotMatch(home, /pendingCodeChatOpen/, 'only the Code home App picks reads the request');
    assert.match(read('features/code/src/workbench/WorkbenchSidebar.tsx'), /setCodeScreenChat\(codeSession\.screenKey, isProjectPromoted \? null : codeChatTitle \|\| codeChatSessionId\);/);
  });

  it('publishes the folder each Code screen saves into, and only for as long as it does', async () => {
    const autoSave = read('features/code/src/use-auto-save.ts');
    assert.match(autoSave, /setCodeScreenProject\(screenKey, enabled \? projectName : null\);/);
    assert.match(autoSave, /useEffect\(\(\) => \(\) => setCodeScreenProject\(screenKey, null\), \[screenKey\]\);/);
    const { $codeScreenProjects, setCodeScreenProject } = await importTs(path.join(ROOT, 'features/code/src/workbench/code-turn-activity.ts'));
    setCodeScreenProject('home', 'Todo app');
    setCodeScreenProject('project:#1234', 'Weather');
    const both = $codeScreenProjects.get();
    setCodeScreenProject('home', 'Todo app');
    assert.equal($codeScreenProjects.get(), both);
    setCodeScreenProject('home', null);
    assert.deepEqual($codeScreenProjects.get(), { 'project:#1234': 'Weather' });
    setCodeScreenProject('project:#1234', null);
  });

  it("keeps one screen's preview out of another's: messages, build errors, visual editing", () => {
    const preview = read('features/code/src/workbench/WorkbenchPreview.tsx');
    assert.match(preview, /if \(!isOwnPreviewMessage\(codeSession, event\) \|\| !codeSession\.onShow\.get\(\)\) return;/);
    assert.match(preview, /const isVisualEdit = useStore\(isVisualEditMode\) && isOnShow;/);
    assert.match(preview, /if \(codeSession\.onShow\.get\(\)\) visualEditorStore\.setIframeRef\(el\);/);
    assert.equal((preview.match(/screen: codeSession\.screenKey/g) ?? []).length, 11, 'every preview build names its screen');
    const bundler = read('features/code/src/runtime/preview/bundler.ts');
    assert.equal((bundler.match(/screen: options\.screen \}, '\*'\)/g) ?? []).length, 4, 'every build error says whose build it was');
    assert.match(read('features/code/src/workbench/WorkbenchSidebar.tsx'), /if \(!isOwnPreviewMessage\(codeSession, event\)\) return;/);
    assert.match(read('features/code/src/visual-editing/VisualEditingOverlay.tsx'), /if \(e\.source !== iframeRef\.current\?\.contentWindow\) return;/);
    assert.match(read('features/design/src/ColorPickerMenu.tsx'), /if \(e\.source !== getIframeRef\(\)\?\.contentWindow\) return;/);
  });

  it('makes busy Media work a job and starts its generations and agent turn again in an inheriting tab', () => {
    const media = read('features/media/src/MediaView.tsx');
    assert.match(media, /workJobRef\.current = startMediaWorkJob\(inheritedJobIdRef\.current \?\? undefined, chatScopeId \|\| 'guest', payload\);/);
    assert.match(media, /\.filter\(\(item\) => !\(agentRunning && agentTurnItemIdsRef\.current\.has\(item\.id\)\)\)/,
      'items the interrupted agent turn made are its to make again');
    assert.match(media, /&& \(m\.status !== 'generating' \|\| resumingIds\?\.has\(m\.id\)\)/, 'only the inherited items survive the load');
    assert.match(media, /const url = source\?\.url \|\| \(attachment\.url && !attachment\.url\.startsWith\('blob:'\) \? attachment\.url : ''\);/);
    assert.match(media, /if \(agentPrompt && question\?\.content !== agentPrompt\) mediaAgent\.send\(\{ text: agentPrompt \}\);\s*else mediaAgent\.resumeInterrupted\(\);/);
    const agent = read('features/media/src/agent/agent-session.ts');
    assert.match(agent, /\$turn\.set\(\{ running: true, phase: 'thinking', waiting: true \}\);[\s\S]{0,400}scheduleSave\(\);/, 'the question is saved as the turn starts');
    assert.match(agent, /if \(last\.status === 'done'\) return 'finished';/);
    assert.match(app, /useKeepAlive\(useStore\(\$mediaWorkRunning\) \|\| resume !== null \|\| leftOpen\)/);
    assert.match(app, /registerMediaWorkTakeover\(\(job\) =>\s*job\.scopeId === \(gateRef\.current\.scopeId \|\| 'guest'\) && !gateRef\.current\.mounted\)/);
  });

  it('does not take a sign-in record mid-rewrite for a sign-out', () => {
    const auth = read('platform/auth/src/AuthContext.tsx');
    assert.match(auth, /if \(!firebaseUser && activeAuthUidRef\.current && !explicitSignOutRef\.current\) \{/);
    assert.match(auth, /if \(!auth\.currentUser\) void applyAuthUser\(null\);\s*\}, SIGN_OUT_CONFIRM_MS\);/);
    assert.match(auth, /explicitSignOutRef\.current = true;\s*await firebaseSignOut\(auth\);/, 'signing out here applies at once');
  });
});
