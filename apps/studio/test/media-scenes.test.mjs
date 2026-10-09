/**
 * The Scenebuilder's timeline arithmetic (`features/media/src/scenes/scene-format.ts`).
 *
 * Every expected value is a reading off Flow's Scenebuilder: the timecodes its playback row
 * showed, the trim badge, the name it gave a new scene, the ruler labels at each zoom step and
 * how many filmstrip frames a clip of a given width drew.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const {
  clipStarts,
  defaultSceneName,
  filmstripCount,
  formatTimecode,
  formatTrimSeconds,
  locateTime,
  placeInOrder,
  rulerLabel,
  rulerUnitCount,
  sortDragOrder,
  timeToX,
  xToTime,
} = await importTs(path.join(repoRoot, 'features', 'media', 'src', 'scenes', 'scene-format.ts'));

describe('Scenebuilder timecodes', () => {
  it('counts frames at 24 per second, as the playback row does', () => {
    assert.equal(formatTimecode(0), '00:00:00');
    assert.equal(formatTimecode(8), '00:08:00');
    assert.equal(formatTimecode(13.5), '00:13:12');
    assert.equal(formatTimecode(14.24), '00:14:05');
    assert.equal(formatTimecode(8 + 6.24 + 8), '00:22:05');
  });

  it('never reads below zero', () => {
    assert.equal(formatTimecode(-3), '00:00:00');
  });

  it('shows a trim to two decimals', () => {
    assert.equal(formatTrimSeconds(7.0625), '7.06s');
  });
});

describe('Scenebuilder names', () => {
  it('names a new scene after its UTC creation time', () => {
    assert.equal(defaultSceneName(new Date(Date.UTC(2026, 9, 1, 17, 1, 34))), 'Untitled Scene 10-01 17:01:34');
  });
});

describe('Scenebuilder ruler', () => {
  it('labels whole seconds at each zoom step', () => {
    assert.deepEqual([0, 1, 2].map((i) => rulerLabel(i, 1)), ['00', '01', '02']);
    assert.deepEqual([0, 1, 2, 3].map((i) => rulerLabel(i, 8)), ['00', '08', '16', '24']);
  });

  it('draws at least 17 units, and three past the scene', () => {
    assert.equal(rulerUnitCount(8, 1), 17);
    assert.equal(rulerUnitCount(30.24, 1), 34);
  });

  it('maps time to x past the 21px first unit, and back', () => {
    assert.equal(timeToX(0, 1), 21);
    assert.equal(timeToX(8, 1), 21 + 816);
    assert.equal(timeToX(8, 8), 21 + 102);
    assert.equal(xToTime(21 + 408, 2), 8);
    assert.equal(xToTime(0, 1), 0);
  });

  it('draws one filmstrip frame per unit of clip width', () => {
    assert.deepEqual([816, 636, 408, 204, 102, 40].map(filmstripCount), [8, 7, 4, 2, 1, 1]);
  });
});

describe('Scenebuilder clock', () => {
  const clips = [{ trimStart: 0, trimEnd: 8 }, { trimStart: 1, trimEnd: 7.24 }];

  it('lays clips end to end by their trimmed length', () => {
    assert.deepEqual(clipStarts(clips), { starts: [0, 8], total: 14.24 });
  });

  it('finds the clip and source time under a scene time', () => {
    assert.deepEqual(locateTime(clips, 2), { index: 0, sourceTime: 2 });
    assert.deepEqual(locateTime(clips, 8.5), { index: 1, sourceTime: 1.5 });
  });

  it('clamps past either end', () => {
    assert.deepEqual(locateTime(clips, -1), { index: 0, sourceTime: 0 });
    assert.deepEqual(locateTime(clips, 99), { index: 1, sourceTime: 7.24 });
    assert.equal(locateTime([], 1), null);
  });
});

// Reordering by drag follows Angular CDK's single-axis sort, which Flow's timeline runs with its
// defaults. The midpoint rule it replaced moved a wide clip a slot as soon as it was picked up.
describe('Scenebuilder clip reorder', () => {
  const widths = { a: 100, b: 100, c: 100, n: 100, w: 300 };
  const widthOf = (id) => widths[id];
  const none = { id: '', delta: 0, overlaps: false };

  it('lays clips end to end in an order', () => {
    assert.deepEqual([...placeInOrder(['w', 'n'], widthOf)], [['w', 0], ['n', 300]]);
  });

  it('gives the dragged clip the slot of the clip under the pointer', () => {
    assert.deepEqual(sortDragOrder(['a', 'b', 'c'], 'a', 150, widthOf, 1, none)?.order, ['b', 'a', 'c']);
    assert.deepEqual(sortDragOrder(['a', 'b', 'c'], 'a', 250, widthOf, 1, none)?.order, ['b', 'c', 'a'], 'a pointer that jumped two clips');
    assert.deepEqual(sortDragOrder(['a', 'b', 'c'], 'c', 30, widthOf, -1, none)?.order, ['c', 'a', 'b']);
  });

  it('leaves the order alone over the dragged clip itself or past the clips', () => {
    assert.equal(sortDragOrder(['n', 'w'], 'w', 300, widthOf, 1, none), null);
    assert.equal(sortDragOrder(['a', 'b'], 'a', 260, widthOf, 1, none), null);
  });

  it('does not trade back with a wider clip while still on it going the same way', () => {
    // A narrow clip dragged right onto a wide one: one swap...
    const first = sortDragOrder(['n', 'w'], 'n', 120, widthOf, 1, none);
    assert.deepEqual(first?.order, ['w', 'n']);
    assert.deepEqual(first?.lastSwap, { id: 'w', delta: 1, overlaps: true });
    // ...then, still on the wide clip and going right, none, however long it goes on.
    assert.equal(sortDragOrder(first.order, 'n', 200, widthOf, 1, first.lastSwap), null);
    assert.equal(sortDragOrder(first.order, 'n', 290, widthOf, 1, first.lastSwap), null);
    // Turned back on it, it trades back.
    assert.deepEqual(sortDragOrder(first.order, 'n', 250, widthOf, -1, first.lastSwap)?.order, ['n', 'w']);
  });
});
