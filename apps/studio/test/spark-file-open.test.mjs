/**
 * A file a Spark run creates opens beside the chat, as Gemini's does: the card's "Open"
 * puts it in the side panel the remote browser uses (`showing-embedded-doc`), and at
 * 960px and below in the full-screen overlay. The page is read from the run's OPFS
 * workspace (`readSparkWorkspaceFile`).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const workspace = await importTs(path.join(ROOT, 'features/spark/src/harness/workspace/workspace.ts'));
const openFiles = await importTs(path.join(ROOT, 'features/spark/src/spark-open-file.ts'));

/** Just enough OPFS: nested directories by name, files as strings. */
const fakeOpfs = (tree) => {
  const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
  const directory = (entries) => ({
    async getDirectoryHandle(name, { create = false } = {}) {
      if (!(name in entries)) {
        if (!create) throw notFound();
        entries[name] = {};
      }
      if (typeof entries[name] === 'string') throw notFound();
      return directory(entries[name]);
    },
    async getFileHandle(name) {
      if (typeof entries[name] !== 'string') throw notFound();
      const text = entries[name];
      return { getFile: async () => ({ size: text.length, text: async () => text }) };
    },
  });
  return { getDirectory: async () => directory(tree) };
};

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const useStorage = (storage) => {
  Object.defineProperty(globalThis, 'navigator', { value: { storage }, configurable: true, writable: true });
};
afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
});

describe('reading a created file back', () => {
  const tree = () => ({
    'willow-spark': {
      'signed-out::abc': {
        workspace: { workspace: { 'We are happy.md': '# We Are Happy\n', site: { 'index.html': '<h1>Hi</h1>' } } },
      },
    },
  });

  it('finds it under the path the run reported, in the workspace the harness wrote', async () => {
    useStorage(fakeOpfs(tree()));
    assert.equal(await workspace.readSparkWorkspaceFile('signed-out::abc', '/workspace/We are happy.md'), '# We Are Happy\n');
    assert.equal(await workspace.readSparkWorkspaceFile('signed-out::abc', 'workspace/site/index.html'), '<h1>Hi</h1>');
  });

  it('reports nothing, rather than throwing, for a file that is not there', async () => {
    useStorage(fakeOpfs(tree()));
    assert.equal(await workspace.readSparkWorkspaceFile('signed-out::abc', '/workspace/gone.md'), null);
    assert.equal(await workspace.readSparkWorkspaceFile('someone-else', '/workspace/We are happy.md'), null, 'another scope');
    assert.equal(await workspace.readSparkWorkspaceFile('signed-out::abc', '/workspace/site'), null, 'a folder');
    assert.equal(await workspace.readSparkWorkspaceFile('signed-out::abc', '/workspace/../secret'), null, 'a path the harness would refuse');
    useStorage({});
    assert.equal(await workspace.readSparkWorkspaceFile('signed-out::abc', '/workspace/We are happy.md'), null, 'no OPFS');
  });

  it('never creates what it looks for', async () => {
    const files = tree();
    useStorage(fakeOpfs(files));
    await workspace.readSparkWorkspaceFile('new-scope', '/workspace/a/b.md');
    assert.deepEqual(Object.keys(files['willow-spark']), ['signed-out::abc']);
  });
});

describe('which file each task has open', () => {
  it('keeps one per task, and closing one leaves the others', () => {
    openFiles.openSparkFile('task-a', 'file-1');
    openFiles.openSparkFile('task-b', 'file-2');
    openFiles.openSparkFile('task-a', 'file-3');
    assert.deepEqual({ ...openFiles.sparkOpenFiles.get() }, { 'task-a': 'file-3', 'task-b': 'file-2' });
    openFiles.closeSparkFile('task-a');
    assert.deepEqual({ ...openFiles.sparkOpenFiles.get() }, { 'task-b': 'file-2' });
    openFiles.closeSparkFile('task-b');
  });

  it('tells no one when nothing changed', () => {
    openFiles.openSparkFile('task-c', 'file-1');
    let calls = 0;
    const stop = openFiles.sparkOpenFiles.listen(() => { calls += 1; });
    openFiles.openSparkFile('task-c', 'file-1');
    openFiles.closeSparkFile('task-none');
    stop();
    assert.equal(calls, 0);
    openFiles.closeSparkFile('task-c');
  });
});

describe('the card and the side panel', () => {
  const detail = read('features/spark/src/SparkTaskDetail.tsx');
  const css = read('features/spark/src/SparkTaskDetail.css');
  const viewer = read('features/spark/src/SparkFileViewer.tsx');
  const viewerCss = read('features/spark/src/SparkFileViewer.css');
  // Every `(max-width: 960px)` block, and the stylesheet without them.
  const NARROW = '@media (max-width: 960px) {';
  const narrowBlocks = [];
  let desktop = '';
  for (let at = 0, start = css.indexOf(NARROW); ; start = css.indexOf(NARROW, at)) {
    if (start === -1) {
      desktop += css.slice(at);
      break;
    }
    const end = css.indexOf('\n}', start) + 2;
    desktop += css.slice(at, start);
    narrowBlocks.push(css.slice(start, end));
    at = end;
  }
  const narrow = narrowBlocks.join('\n');

  it('says Open, and the whole card opens the file', () => {
    assert.match(detail, /<button\s+type="button"\s+className="spark-task-detail__generated-file-card"[\s\S]{0,120}?onClick=\{\(\) => onOpen\(file\)\}/);
    assert.match(detail, /<span className="spark-task-detail__generated-file-open">Open<\/span>/);
    assert.doesNotMatch(detail, /generated-file-close|dismissedGeneratedFileIds|>\s*Close\s*<\/button>\s*<\/div>\s*<\/div>\s*\);\s*\n\nconst SparkProgressMarker/);
    assert.doesNotMatch(css, /generated-file-close/);
  });

  it('opens it in the remote browser\'s side panel, collapsing the list the same way', () => {
    assert.match(detail, /const sidePanel = isFileOpen \? 'file' : isRemoteBrowserOpen \? 'browser' : isProgressPanelOpen \? 'progress' : null;/);
    assert.match(detail, /const isLibraryCollapsed = libraryCollapsed \|\| isRemoteBrowserOpen \|\| isFileOpen;/);
    assert.match(detail, /className=\{`spark-task-detail__side-panel is-file\$\{sidePanelHandoff === 'file' \? widePanelHandoff : ''\}`\}/);
    assert.match(detail, /revealDelayMs=\{previousSidePanel === 'browser' \? 0 : 450\}/, 'the page waits out the growth, except in a swap at full width');
    assert.match(detail, /if \(remoteBrowserPane === 'open'\) closeRemoteBrowserPane\(currentTask\.id\);\s*openSparkFile\(currentTask\.id, file\.id\);/);
    assert.match(detail, /if \(remoteBrowserPane === 'open'\) closeSparkFile\(currentTask\.id\);/, 'a browser the run opens takes the file\'s place');
    assert.match(css, /@starting-style \{\s*\.spark-task-detail__side-panel\.is-file \{\s*flex: 0 0 0%;\s*opacity: 0;/, 'Gemini starts showing-embedded-doc at flex 0');
    assert.ok(css.indexOf('.spark-task-detail__side-panel.is-file {') < css.indexOf('.spark-task-detail__side-panel.is-taking-over {'), 'growing out of Progress wins');
    assert.match(css, /\.spark-task-detail__side-panel\.is-replacing \{\s*flex: 2 1 0%;\s*opacity: 1;/);
    assert.match(css, /\.spark-task-detail\.has-open-file \.spark-task-detail__progress-panel \{\s*display: none;/);
  });

  it('opens it from the Files rows as well', () => {
    assert.equal(detail.match(/onClick=\{\(\) => openGeneratedFile\(file\)\}/g)?.length, 3, 'the Progress panel, its popover and the narrow overlay');
  });

  it('opens it full-screen at 960px and below, as the browser does', () => {
    assert.match(detail, /const isFileOverlayOpen = shownFile !== null && isCompact;/);
    assert.match(detail, /\{isFileOverlayOpen && shownFile && \(\s*<div className="spark-task-detail__progress-overlay" role="dialog" aria-modal="true"/);
    assert.match(detail, /<SparkFileViewer\s+file=\{shownFile\}\s+onClose=\{closeGeneratedFile\}\s+compact/);
    assert.match(narrow, /\.spark-task-detail__generated-file-card \{\s*background: #141414;/);
    assert.match(narrow, /\.spark-task-detail__generated-file-wrapper \{\s*margin-right: 0;\s*margin-left: 0;/, 'the card spans the 24px column, as the reply does');
    assert.ok(narrowBlocks.length > 1 && desktop.includes('.spark-task-detail__generated-file-card {'), 'the blocks were found');
    assert.doesNotMatch(desktop, /\.spark-task-detail__generated-file-card \{\s*background: #141414;/, 'the desktop card keeps #171717');
    assert.doesNotMatch(desktop, /\.spark-task-detail__generated-file-wrapper \{\s*margin-right: 0;/);
  });

  it('draws Docs\' chrome where it can do something: Download, Open in new tab, Close, Print, Zoom', () => {
    for (const label of ['Download', 'aria-label="Open in new tab"', 'aria-label="Close"', 'aria-label="Print"']) {
      assert.ok(viewer.includes(label), label);
    }
    assert.match(viewer, /const ZOOM_STEPS = \[50, 75, 90, 100, 125, 150, 200\] as const;/);
    assert.match(viewer, /\{!compact && \(/, 'the phone and tablet embed is the page alone');
  });

  it('opens a page in a new tab where it cannot reach Willow\'s storage', () => {
    assert.match(viewer, /<iframe sandbox="allow-scripts allow-forms allow-popups allow-modals" srcdoc=/);
    assert.doesNotMatch(viewer, /allow-same-origin/);
    assert.match(viewer, /new Blob\(\[text\], \{ type: 'text\/plain;charset=utf-8' \}\)/, 'anything else is text');
  });

  it('sets the page as Docs does, measured off Gemini', () => {
    assert.match(viewerCss, /\.spark-file-viewer__appbar \{[^}]*height: 55px;[^}]*padding: 0 12px 0 25px;/);
    assert.match(viewerCss, /\.spark-file-viewer__toolbar \{[^}]*height: 40px;[^}]*margin: 6px 16px 8\.8px;[^}]*border-radius: 28px;\s*background: #f0f4f9;/);
    assert.match(viewerCss, /\.spark-file-viewer__primary \{[^}]*height: 36px;[^}]*background: #c2e7ff;\s*color: #004a77;/);
    assert.match(viewerCss, /\.spark-file-viewer__page \{\s*max-width: 840px;\s*padding: 49px 80px 96px;[^}]*font-family: Arial[^;]*;\s*font-size: 14\.6667px;\s*line-height: 20px;/);
    assert.match(viewerCss, /\.spark-file-viewer\.is-compact \.spark-file-viewer__page \{\s*max-width: none;\s*padding: 101px calc\(9\.3px \+ 0\.585vw\) 48px;\s*line-height: 16\.8px;/);
  });
});
