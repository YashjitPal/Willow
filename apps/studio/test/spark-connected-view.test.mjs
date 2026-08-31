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
const detailCss = await readFile(
  new URL('../../../features/spark/src/SparkTaskDetail.css', import.meta.url),
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
  // The body read sits inside the same `flushSync` as the navigation on purpose.
  // Deferred, the detail route renders `bodyLoaded === false` for a frame, and
  // that placeholder has no composer anchor — which leaves the shared prompt box
  // in a detached subtree at the moment `liveMove` measures its destination.
  assert.match(workspaceSource, /const openTaskWithTransition = \(taskId: string\) => \{[\s\S]*?if \(location\.page === 'task'\) \{[\s\S]*?goToSparkTask\(taskId\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?transitionTaskNavigation\(\(\) => \{[\s\S]*?ensureSparkTaskBodyLoaded\(taskId\);[\s\S]*?goToSparkTask\(taskId\);[\s\S]*?\}\)/);
  assert.doesNotMatch(workspaceSource, /spark-tasks-surface/);
  assert.doesNotMatch(workspaceSource, /<SparkTaskDetail[^>]*embedded/);
});

test('keeps the task detail as the owner of its divider and Progress panel', () => {
  assert.match(detailSource, /const \[libraryCollapsed, setLibraryCollapsed\] = useState\(false\)/);
  assert.match(detailSource, /const isProgressPanelOpen = isLibraryCollapsed/);
  assert.match(detailSource, /className="spark-task-detail__library-divider"/);
  assert.match(detailSource, /className=\{`spark-task-detail__progress-panel\$\{isProgressPanelOpen \? ' is-open' : ''\}`\}/);
  assert.match(detailCss, /\.spark-task-detail__progress-panel\.is-open\s*\{[\s\S]*?flex:\s*0 0 var\(--spark-progress-panel-width\)/);
  // The basis animation is the only motion. The slab inside is pinned to the
  // panel's open width, so it rides the shrinking box's edge and is clipped
  // rather than re-wrapping; a transform here would be a second motion in the
  // same direction, which used to empty the panel in half the duration.
  assert.match(detailCss, /\.spark-task-detail__progress-panel-scroll\s*\{[\s\S]*?width:\s*var\(--spark-progress-panel-width\)/);
  assert.doesNotMatch(detailCss, /\.spark-task-detail__progress-panel\s*\{[^}]*transform:/);
  assert.match(detailCss, /flex 450ms cubic-bezier\(0\.2, 0, 0, 1\)/);
  assert.doesNotMatch(detailSource, /controlledLibraryCollapsed|onLibraryCollapsedChange|embedded\?:/);
});

test('keeps connected-view CSS transition-only', () => {
  assert.match(workspaceCss, /view-transition-name: spark-task-workspace/);
  assert.doesNotMatch(workspaceCss, /view-transition-name: spark-task-library/);
  assert.match(workspaceSource, /const liveMove =/);
  // Both rects have to be real. A missing element, or one in a subtree React has
  // just unmounted, measures 0x0 at the origin — which would translate it by its
  // whole old offset and animate the composer's width to zero.
  assert.match(workspaceSource, /if \(!element \|\| !element\.isConnected \|\| !isMeasurable\(from\)\) return;/);
  assert.match(workspaceSource, /const to = element\.getBoundingClientRect\(\);\s*if \(!isMeasurable\(to\)\) return;/);
  assert.match(workspaceSource, /taskListFrom/);
  assert.match(workspaceSource, /liveMove\([\s\S]*?taskListFrom[\s\S]*?false/);
  assert.match(workspaceSource, /taskFilterFrom/);
  assert.match(workspaceCss, /data-spark-task-filter/);
  assert.doesNotMatch(workspaceSource, /sharedTaskSearch|liveSearchMove|data-spark-task-search/);
  assert.doesNotMatch(workspaceCss, /spark-connected-search|data-spark-task-search/);
  assert.match(workspaceCss, /--spark-live-dx/);
  assert.match(workspaceCss, /--spark-live-dy/);
  /*
   * The composer's route resize is a DELTA on a live `100%`, never a measured
   * pixel width. `to` is read in the commit that renders the task route, and
   * `App` collapses the global sidebar on that same navigation — a 300ms width
   * animation — so the anchor keeps growing for the first half of this
   * animation. A pinned `width: ${toWidth}px` froze the prompt box ~98px narrow
   * and snapped it out when the 470ms cleanup ran. `@property` is what makes the
   * delta interpolable; unregistered it would swap discretely.
   */
  assert.match(workspaceCss, /@property --spark-live-dw\s*\{[\s\S]*?syntax:\s*'<length>'/);
  assert.match(workspaceCss, /width:\s*calc\(100% \+ var\(--spark-live-dw, 0px\)\)/);
  assert.match(workspaceSource, /const dw = from\.width - to\.width;/);
  assert.match(workspaceSource, /'--spark-live-dw 450ms cubic-bezier|--spark-live-dw 450ms cubic-bezier/);
  assert.doesNotMatch(workspaceSource, /element\.style\.width = /);
  assert.match(workspaceCss, /\.spark-connected-glow\s*\{/);
  assert.match(workspaceCss, /\.spark-connected-composer\s*\{/);
  assert.match(workspaceCss, /\.spark-connected-composer\s*\{\s*position:\s*relative/);
  assert.doesNotMatch(workspaceCss, /\.spark-connected-composer\s*\{[^}]*position:\s*absolute/);
  assert.doesNotMatch(workspaceCss, /left 450ms/);
  assert.doesNotMatch(workspaceCss, /width 450ms/);
  assert.match(workspaceCss, /animation-duration: 450ms/);
  assert.match(workspaceCss, /cubic-bezier\(0\.2, 0, 0, 1\)/);
  assert.match(workspaceCss, /::view-transition-new\(spark-task-workspace\)[\s\S]*?animation:\s*spark-task-workspace-enter 450ms/);
  assert.match(workspaceCss, /::view-transition-old\(spark-task-workspace\)[\s\S]*?animation:\s*spark-task-workspace-exit 450ms/);
  assert.match(workspaceCss, /@keyframes spark-task-workspace-enter\s*\{[\s\S]*?translateX\(calc\(100% \+ 8px\)\)[\s\S]*?translateX\(0\)/);
  assert.match(workspaceCss, /@keyframes spark-task-workspace-exit\s*\{[\s\S]*?translateX\(0\)[\s\S]*?translateX\(calc\(100% \+ 8px\)\)/);
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
