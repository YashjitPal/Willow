import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (relativePath) =>
  readFile(new URL(`../../../${relativePath}`, import.meta.url), 'utf8');

test('MediaView uses home icon for navigation button with 40x40 rounded-xl size', async () => {
  const mediaView = await readSource('features/media/src/MediaView.tsx');

  // Home icon replaced arrow_back
  assert.match(mediaView, /<MaterialSymbol name="home" family="google-symbols" size=\{24\}/);
  assert.doesNotMatch(mediaView, /<MaterialSymbol name="arrow_back"/);

  // 40x40 (w-10 h-10) with 12px radius (rounded-xl)
  assert.match(mediaView, /className="w-10 h-10 shrink-0 flex items-center justify-center hover:bg-white\/10 rounded-xl transition-colors text-white"/);
  assert.match(mediaView, /title="Home"/);
});

test('MediaView header left cluster has 8px gap without redundant padding', async () => {
  const mediaView = await readSource('features/media/src/MediaView.tsx');

  // Left cluster aligns Home and Title in flow-navigation-header with 8px gap
  assert.match(mediaView, /className="flex items-center gap-2"/);
  assert.match(mediaView, /<div className="flex items-center min-w-0" style=\{\{ fontFamily: PROJECT_NAME_FONT \}\}>/);
  // Header left padding is pl-5 (20px) matching Google Flow
  assert.match(mediaView, /className="absolute top-0 left-0 right-0 h-\[76px\] flex items-center justify-between pl-5 pr-5/);

  // More options button has matching 40x40 rounded-xl dimensions
  assert.match(mediaView, /className="w-10 h-10 shrink-0 flex items-center justify-center hover:bg-white\/10 rounded-xl transition-colors hover:text-white"/);
});

test('MediaView scroll animations match Google Flow timing, header fade, and 62px sidebar offset', async () => {
  const mediaView = await readSource('features/media/src/MediaView.tsx');

  // 0.38s ease-in-out matching Google Flow's smooth glide
  assert.match(mediaView, /const sidebarShowTransition = '0\.38s ease-in-out';/);
  assert.match(mediaView, /const sidebarHideTransition = '0\.38s ease-in-out';/);

  // Header fades in place over 0.5s ease-in-out (noticeable, smooth dissolve)
  assert.match(mediaView, /const headerFadeTransition = 'opacity 0\.5s ease-in-out, visibility 0\.5s ease-in-out';/);
  assert.match(mediaView, /transition: headerFadeTransition/);

  // Sidebar translates up by 62px (leaving 14px top padding, matching Flow's .875rem)
  assert.match(mediaView, /transform: isHeaderVisible \? 'translateY\(0\)' : 'translateY\(-62px\)'/);

  // Scroll threshold: <= 40px always visible, >= 100px scroll-up to reveal
  assert.match(mediaView, /if \(scrollTop <= 40\)/);
  assert.match(mediaView, /maxScrollTop\.current - scrollTop >= 100/);
});

test('Sidebars match Google Flow 76px/14px top positioning', async () => {
  const agentSidebar = await readSource('features/media/src/AgentSidebar.tsx');
  assert.match(agentSidebar, /top: isHeaderVisible \? '76px' : '14px'/);

  const musicSidebar = await readSource('features/media/src/music/MusicPlayerSidebar.tsx');
  assert.match(musicSidebar, /top: isHeaderVisible \? '76px' : '14px'/);
});
