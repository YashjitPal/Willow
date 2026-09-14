import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (relativePath) =>
  readFile(new URL(`../../../${relativePath}`, import.meta.url), 'utf8');

test('flow-loading-page.css matches Google Flow keyframes and specs', async () => {
  const css = await readSource('features/media/src/flow-loading-page.css');

  // Exact letter-fade keyframe: 0%, 100% { opacity: 1; } 50% { opacity: 0.2; }
  assert.match(css, /@keyframes willow-flow-letter-fade\s*\{[\s\S]*0%,\s*100%\s*\{[\s\S]*opacity:\s*1;?[\s\S]*\}[\s\S]*50%\s*\{[\s\S]*opacity:\s*0\.2;?[\s\S]*\}/);

  // Exact 1.6s ease-in-out letter animation with variable delay
  assert.match(css, /animation-name:\s*willow-flow-letter-fade;/);
  assert.match(css, /animation-delay:\s*var\(--animation-delay,\s*0ms\);/);
  assert.match(css, /animation-duration:\s*1\.6s;/);
  assert.match(css, /animation-iteration-count:\s*infinite;/);
  assert.match(css, /animation-timing-function:\s*ease-in-out;/);

  // Fade-in and fade-out animations for page lifecycle
  assert.match(css, /@keyframes willow-flow-fade-in/);
  assert.match(css, /@keyframes willow-flow-fade-out/);
  assert.match(css, /\.loading-page-fade-in/);
  assert.match(css, /\.loading-page-fade-out/);

  // Text container opacity 0.25 and Google Sans typography
  assert.match(css, /\.flow-loading-text-container\s*\{[\s\S]*opacity:\s*0\.25;/);
  assert.match(css, /Google Sans/);
});

test('FlowLoadingPage component defines 8 staggered character slots and lifecycle props', async () => {
  const tsx = await readSource('features/media/src/FlowLoadingPage.tsx');

  // Staggered letters array: L, o, a, d, i, n, g, ...
  assert.match(tsx, /const LETTERS = \['L', 'o', 'a', 'd', 'i', 'n', 'g', '\.\.\.'\];/);
  assert.match(tsx, /index \* 100/);

  // Lifecycle props: isFadingOut, onFadedOut, optional disclaimer
  assert.match(tsx, /isFadingOut/);
  assert.match(tsx, /onFadedOut/);
  assert.match(tsx, /disclaimer\?: string;/);
  // Disclaimer footer is omitted by default
  assert.doesNotMatch(tsx, /Willow can make mistakes, so double check it/);
  assert.match(tsx, /willow-flow-fade-out/);
});

test('MediaView integrates FlowLoadingPage for project loading lifecycle', async () => {
  const mediaView = await readSource('features/media/src/MediaView.tsx');

  assert.match(mediaView, /import \{ FlowLoadingPage \} from '\.\/FlowLoadingPage';/);
  assert.match(mediaView, /isInitialLoading/);
  assert.match(mediaView, /isInitialLoadingFadingOut/);
  assert.match(mediaView, /<FlowLoadingPage/);
});

test('App.tsx uses a black Suspense fallback for /media/* and routes through MediaRouteHost', async () => {
  const app = await readSource('apps/studio/src/app/App.tsx');

  // Suspense fallback is a plain black div — no FlowLoadingPage instance, so
  // MediaView's own FlowLoadingPage is the single animation source with no restart.
  assert.doesNotMatch(app, /import \{ FlowLoadingPage \}/);
  assert.match(app, /<Route path="\/media\/\*" element=\{[\s\S]*?<Suspense fallback=\{<div className="h-screen w-screen bg-\[#000000\]"/);
  assert.match(app, /const MediaRouteHost/);
  assert.match(app, /<MediaView key=\{projectId \|\| 'empty'\}/);
});

test('MediaView suppresses empty canvas flash and preloads gallery images', async () => {
  const mediaView = await readSource('features/media/src/MediaView.tsx');

  // Renders FlowLoadingPage as a continuous overlay without DOM tree swapping
  assert.match(mediaView, /\{isInitialLoading && \(\s*<FlowLoadingPage\s+isFadingOut=\{isInitialLoadingFadingOut\}/);

  // Preloads images before committing items to state
  assert.match(mediaView, /const preloadAllImages = async/);
  assert.match(mediaView, /await preloadAllImages\(imageUrls\);/);

  // Suppresses sunflower empty state while loading
  assert.match(mediaView, /\{\(!isInitialLoading \|\| isInitialLoadingFadingOut\) && displayMediaItems\.length === 0/);
});

test('FlowLoadingPage synchronizes letter pulsing phase to global timeline for continuous progress', async () => {
  const tsx = await readSource('features/media/src/FlowLoadingPage.tsx');

  // Uses 1600ms period matching the 1.6s CSS animation-duration
  assert.match(tsx, /const CYCLE_DURATION_MS = 1600;/);
  assert.match(tsx, /getGlobalAnimationTime/);
  assert.match(tsx, /document\.timeline\?\.currentTime/);
  assert.match(tsx, /performance\.now\(\)/);

  // Computes phase-locked negative animation delay so handoffs never reset the animation
  assert.match(tsx, /\(cycleOffset - baseDelay\)/);
  assert.match(tsx, /`\$\{-phase\}ms`/);
});

