// Media's Characters tab. Its grid is All media's (gallery-layout.ts lays out both), New character
// one more square in it and the last row never larger than the rows above; the avatar flow is gone;
// and the character pages never open onto the grid: preloaded, a black fallback, an empty tab
// decided in render, and the page a click asked for shown on that click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importTs } from './ts-module.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const { layoutGallery } = await importTs(path.join(REPO_ROOT, 'features/media/src/gallery-layout.ts'));
const { preloadableLazy } = await importTs(path.join(REPO_ROOT, 'features/media/src/preloadable-lazy.tsx'));

const squares = (n) => Array.from({ length: n }, (_, i) => ({ item: i, ar: 1 }));
const heights = (cells) => cells.map((c) => Math.round(c.finalHeight * 100) / 100);
// The grid's width at 1536x826 with the sidebar open, where the target height is 270.
const W = 1361;

test('full rows fill the width with 12px gaps, as All media', () => {
  const full = layoutGallery(squares(7), W, 270).filter((c) => !c.isLastRow);
  assert.equal(full.length, 4);
  assert.ok(Math.abs(full.reduce((sum, c) => sum + c.finalWidth, 0) + 3 * 12 - W) < 1e-9);
});

test("All media's last row may grow up to 1.5x; the Characters grid's keeps the rows' size", () => {
  // Four squares a row, three left over.
  assert.deepEqual(heights(layoutGallery(squares(7), W, 270)), [331.25, 331.25, 331.25, 331.25, 445.67, 445.67, 445.67]);
  assert.deepEqual(heights(layoutGallery(squares(7), W, 270, { uniformLastRow: true })), Array(7).fill(331.25));
  assert.deepEqual(heights(layoutGallery(squares(5), W, 270, { uniformLastRow: true })), Array(5).fill(331.25));
});

test('an only row follows the target rule in both grids', () => {
  for (const uniformLastRow of [false, true]) {
    // Three squares fill the width: 445.67 is under 1.5x the 324 the wrapping aims at...
    assert.deepEqual(heights(layoutGallery(squares(3), W, 270, { uniformLastRow })), Array(3).fill(445.67));
    // ...two would be 674.5 tall, so they are held at it.
    assert.deepEqual(heights(layoutGallery(squares(2), W, 270, { uniformLastRow })), [324, 324]);
  }
});

test('the Characters grid uses the gallery rows, New character as one more square, and no avatar tile', () => {
  const grid = read('features/media/src/characters/CharactersGrid.tsx');
  assert.match(grid, /layoutGallery<[^>]+>\(\[\s*\{ item: NEW_CHARACTER, ar: 1 \}/);
  assert.match(grid, /uniformLastRow: true/);
  assert.doesNotMatch(grid, /Create my avatar|onAvatar/);
  // Flow badges every character tile, not only those with a body.
  assert.match(grid, /<span className="cg-tile__type"><FlowIcon name="accessibility_new"/);
  assert.doesNotMatch(grid, /bodyId && <span className="cg-tile__type"/);
  const view = read('features/media/src/MediaView.tsx');
  assert.match(view, /layoutGallery\(sortedMediaItems\.map/);
  assert.doesNotMatch(view, /'avatar'/);
  assert.doesNotMatch(read('features/media/src/characters/NewCharacterPage.tsx'), /avatar/);
  assert.doesNotMatch(read('features/media/src/characters/characters.css'), /\.cg-grid|width: 400px;\s*height: 400px/);
});

test('a preloaded page renders without suspending; one still loading shows the fallback', async () => {
  const ready = preloadableLazy(async () => ({ default: () => React.createElement('b', null, 'page') }));
  await ready.preload();
  assert.equal(renderToStaticMarkup(React.createElement(React.Suspense, { fallback: 'loading' }, React.createElement(ready))), '<b>page</b>');
  const cold = preloadableLazy(() => new Promise(() => {}));
  assert.equal(renderToStaticMarkup(React.createElement(React.Suspense, { fallback: 'loading' }, React.createElement(cold))), 'loading');
});

test('the character pages never open onto the grid', () => {
  const view = read('features/media/src/MediaView.tsx');
  assert.match(view, /const NewCharacterPage = preloadableLazy\(/);
  assert.match(view, /const CharacterEditPage = preloadableLazy\(/);
  // An empty tab is New character in render, not only once the redirect effect has run.
  assert.match(view, /const characterPage = \(pendingCharacterRequest \? pendingCharacterRequest\.page : activeCharacter\) \?\? \(charactersTabEmpty \? 'new' : null\);/);
  // A click's request lapses as soon as any navigation lands, so none can outlive its URL.
  assert.match(view, /const pendingCharacterRequest = characterRequest\?\.from === location\.key \? characterRequest : null;/);
  // The grid is drawn only with characters to show; a page still loading is the pages' own black.
  assert.match(view, /activeSidebarTab === 'characters' && characters\.length > 0 && \(\s*<CharactersGrid/);
  assert.match(view, /<React\.Suspense fallback=\{<div className="cp-page" aria-hidden \/>\}>\s*\{characterPage === 'new'/);
  // Start generation shows the character's page on its own click, ahead of the router's transition.
  assert.match(view, /onCreated=\{\(id\) => \{\s*setCharacterRequest\(\{ page: id, from: location\.key \}\);/);
});
