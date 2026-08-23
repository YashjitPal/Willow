import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspaceSource = await readFile(
  new URL('../../../features/spark/src/SparkWorkspace.tsx', import.meta.url),
  'utf8',
);
const workspaceCss = await readFile(
  new URL('../../../features/spark/src/SparkWorkspace.css', import.meta.url),
  'utf8',
);
const detailSource = await readFile(
  new URL('../../../features/spark/src/SparkTaskDetail.tsx', import.meta.url),
  'utf8',
);
const allTasksSource = await readFile(
  new URL('../../../features/spark/src/SparkAllTasks.tsx', import.meta.url),
  'utf8',
);
const allTasksCss = await readFile(
  new URL('../../../features/spark/src/SparkAllTasks.css', import.meta.url),
  'utf8',
);

test('connects task-list navigation without wrapping or embedding the task views', () => {
  assert.match(workspaceSource, /startViewTransition/);
  assert.match(workspaceSource, /flushSync\(navigate\)/);
  assert.match(workspaceSource, /flushSync\(navigate\);\s*attachSharedComposer\(\)/);
  assert.match(workspaceSource, /createPortal\(/);
  assert.match(workspaceSource, /onOpenTask=\{openTaskWithTransition\}/);
  assert.match(workspaceSource, /onBack=\{closeTaskWithTransition\}/);
  assert.doesNotMatch(workspaceSource, /spark-tasks-surface/);
  assert.doesNotMatch(workspaceSource, /<SparkTaskDetail[^>]*embedded/);
});

test('keeps the task detail as the owner of its divider and Progress panel', () => {
  assert.match(detailSource, /const \[libraryCollapsed, setLibraryCollapsed\] = useState\(false\)/);
  assert.match(detailSource, /const isProgressPanelOpen = isLibraryCollapsed/);
  assert.match(detailSource, /className="spark-task-detail__library-divider"/);
  assert.match(detailSource, /className=\{`spark-task-detail__progress-panel\$\{isProgressPanelOpen \? ' is-open' : ''\}`\}/);
  assert.doesNotMatch(detailSource, /controlledLibraryCollapsed|onLibraryCollapsedChange|embedded\?:/);
});

test('keeps connected-view CSS transition-only', () => {
  assert.match(workspaceCss, /view-transition-name: spark-task-workspace/);
  assert.doesNotMatch(workspaceCss, /view-transition-name: spark-task-library/);
  assert.match(workspaceSource, /const liveMove =/);
  assert.match(workspaceSource, /taskListFrom/);
  assert.match(workspaceSource, /liveMove\([\s\S]*?taskListFrom[\s\S]*?false/);
  assert.match(workspaceSource, /taskFilterFrom/);
  assert.match(workspaceCss, /data-spark-task-filter/);
  assert.doesNotMatch(workspaceSource, /sharedTaskSearch|liveSearchMove|data-spark-task-search/);
  assert.doesNotMatch(workspaceCss, /spark-connected-search|data-spark-task-search/);
  assert.match(workspaceCss, /--spark-live-dx/);
  assert.match(workspaceCss, /--spark-live-dy/);
  assert.match(workspaceCss, /\.spark-connected-glow\s*\{/);
  assert.match(workspaceCss, /\.spark-connected-composer\s*\{/);
  assert.match(workspaceCss, /\.spark-connected-composer\s*\{\s*position:\s*relative/);
  assert.doesNotMatch(workspaceCss, /\.spark-connected-composer\s*\{[^}]*position:\s*absolute/);
  assert.doesNotMatch(workspaceCss, /left 450ms/);
  assert.doesNotMatch(workspaceCss, /width 450ms/);
  assert.match(workspaceCss, /animation-duration: 450ms/);
  assert.match(workspaceCss, /cubic-bezier\(0\.2, 0, 0, 1\)/);
  assert.doesNotMatch(workspaceCss, /\.spark-tasks-surface\s*\{/);
});

test('keeps the All Tasks composer as the shared prompt surface', () => {
  assert.match(allTasksSource, /className="spark-all-tasks" aria-label="Spark tasks"/);
  assert.doesNotMatch(allTasksSource, /Put Willow Spark to work for you/);
  assert.match(allTasksSource, /data-spark-new-composer-anchor/);
  assert.match(allTasksSource, /data-spark-glow-anchor/);
  assert.match(allTasksSource, /className="spark-task-detail__filter-button"/);
  assert.match(allTasksCss, /\.spark-all-tasks \.spark-task-detail__filter-button\s*\{[\s\S]*?margin-top:\s*8px/);
  assert.match(allTasksCss, /\.spark-all-tasks__composer-anchor\s*\{[\s\S]*?margin-top:\s*-6px/);
  assert.match(allTasksCss, /\.spark-all-tasks__composer-anchor\.spark-task-detail__new-composer\s*\{/);
  assert.match(workspaceSource, /host\.className = 'spark-connected-composer'/);
  assert.match(workspaceSource, /composerRef=\{sharedComposerRef\}/);
  assert.match(detailSource, /data-spark-new-composer-anchor/);
  assert.match(detailSource, /data-spark-glow-anchor/);
  assert.doesNotMatch(allTasksCss, /background:\s*rgb\(20,\s*32,\s*79\)/);
  assert.doesNotMatch(detailSource, /spark-task-detail__new-composer::before/);
});
