// The Scenebuilder plays without re-rendering itself every frame (measured by
// tools/scratch/w-scene-perf.cjs: a 10-clip scene went from ~44fps with 50ms p95 frames, half the
// main thread in React, to 60fps). The playhead lives in its own store, read only by what draws
// it, and the gallery under a full-window editor is not painted. Cuts don't hold the picture
// either (tools/scratch/w-scene-cuts.cjs): the next clip starts a frame early, and a cut renders
// only the canvas overlays, not the editor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importTs } from './ts-module.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');

// Just enough of a <video> for the player to manage it.
const fakeVideo = () => {
  const attrs = new Map();
  return {
    playsInline: false, preload: '', muted: false, currentTime: 0, paused: true, ended: false, readyState: 0, videoWidth: 0, videoHeight: 0, style: {}, parentElement: null,
    addEventListener() {}, setAttribute: (k, v) => attrs.set(k, v), getAttribute: (k) => attrs.get(k) ?? null, removeAttribute: (k) => attrs.delete(k),
    load() {}, remove() {}, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); },
  };
};
globalThis.document = { createElement: () => fakeVideo() };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
const { ScenePlayer } = await importTs(path.join(REPO_ROOT, 'features/media/src/scenes/scene-player.ts'));

test('moving the playhead touches only $time, never the state the editor renders from', () => {
  const player = new ScenePlayer();
  player.setClips([
    { id: 'a', trimStart: 0, trimEnd: 4, url: 'a.mp4' },
    { id: 'b', trimStart: 1, trimEnd: 5, url: 'b.mp4' },
  ]);
  const states = [];
  const times = [];
  const offState = player.$state.listen((s) => states.push(s));
  const offTime = player.$time.listen((t) => times.push(t));
  player.seek(2);
  player.seek(6.5);
  player.skipPrevious();
  assert.deepEqual(times, [2, 6.5, 4]);
  assert.equal(states.length, 0);
  assert.equal('time' in player.$state.get(), false);
  assert.deepEqual(player.currentSource(), { clipId: 'b', sourceTime: 1 });
  offState();
  offTime();
});

test('the next clip starts a frame before the cut, and the cut takes it as it runs', () => {
  const player = new ScenePlayer();
  player.setClips([
    { id: 'a', trimStart: 0, trimEnd: 4, url: 'a.mp4' },
    { id: 'b', trimStart: 1, trimEnd: 5, url: 'b.mp4' },
  ]);
  const a = player.videos.get('a');
  const b = player.videos.get('b');
  player.play();
  assert.equal(b.paused, true);
  assert.equal(b.currentTime, 1, 'parked on its first frame');

  a.currentTime = 3.9;
  player.tick();
  assert.equal(b.paused, true, 'too early to lead');
  a.currentTime = 3.97;
  player.tick();
  assert.equal(b.paused, false, 'led');
  b.currentTime = 1.03;
  a.currentTime = 4;
  player.tick();
  assert.equal(player.active, 1);
  assert.equal(player.$time.get(), 4);
  assert.equal(b.currentTime, 1.03, 'taken as it runs, not sent back to its start');
  assert.equal(a.paused, true);
  assert.equal(a.currentTime, 0, 'the first clip parked again for the loop');

  // At the last clip's end, with loop on, the first clip leads the same way.
  b.currentTime = 4.97;
  player.tick();
  assert.equal(a.paused, false);
  a.currentTime = 0.02;
  b.currentTime = 5;
  player.tick();
  assert.equal(player.active, 0);
  assert.equal(player.$time.get(), 0);
  assert.equal(a.currentTime, 0.02);
  player.dispose();
});

test('half a second before the cut, the next clip is seeked on its first frame, once', () => {
  const player = new ScenePlayer();
  player.setClips([
    { id: 'a', trimStart: 0, trimEnd: 4, url: 'a.mp4' },
    { id: 'b', trimStart: 1, trimEnd: 5, url: 'b.mp4' },
  ]);
  const a = player.videos.get('a');
  const b = player.videos.get('b');
  player.play();
  // Chrome suspends paused <video>s and resumes one on a seek, but skips a seek to the time it's
  // already at: the wake goes a millisecond on, the same frame.
  const seeks = [];
  let at = b.currentTime;
  Object.defineProperty(b, 'currentTime', { get: () => at, set: (x) => { at = x; seeks.push(x); }, configurable: true });
  a.currentTime = 3.4;
  player.tick();
  assert.deepEqual(seeks, []);
  a.currentTime = 3.6;
  player.tick();
  a.currentTime = 3.8;
  player.tick();
  assert.deepEqual(seeks, [1.001]);
  assert.equal(b.paused, true);
  // Led from there: within a frame of its start.
  a.currentTime = 3.97;
  player.tick();
  assert.equal(b.paused, false);
  player.dispose();
});

test('a pause or seek during the lead stops the next clip and parks it again', () => {
  const player = new ScenePlayer();
  player.setClips([
    { id: 'a', trimStart: 0, trimEnd: 4, url: 'a.mp4' },
    { id: 'b', trimStart: 1, trimEnd: 5, url: 'b.mp4' },
  ]);
  const a = player.videos.get('a');
  const b = player.videos.get('b');
  player.play();
  a.currentTime = 3.97;
  player.tick();
  b.currentTime = 1.02;
  player.pause();
  assert.equal(b.paused, true);
  assert.equal(b.currentTime, 1);

  player.play();
  a.currentTime = 3.97;
  player.tick();
  assert.equal(b.paused, false);
  player.seek(1);
  assert.equal(b.paused, true);
  assert.equal(b.currentTime, 1);
  assert.equal(a.paused, false, 'still playing from the seek');
  player.dispose();
});

test('a clip with no video plays as a gap of its length, and playback goes on past it', () => {
  let now = 1000;
  const realNow = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { value: () => now, configurable: true, writable: true });
  try {
    const player = new ScenePlayer();
    player.setClips([
      { id: 'a', trimStart: 0, trimEnd: 4, url: 'a.mp4' },
      { id: 'gone', trimStart: 0.5, trimEnd: 2.5 },
      { id: 'c', trimStart: 0, trimEnd: 3, url: 'c.mp4' },
    ]);
    const a = player.videos.get('a');
    const c = player.videos.get('c');
    player.play();
    a.currentTime = 4;
    player.tick();
    assert.equal(player.active, 1);
    assert.equal(player.$time.get(), 4);
    player.tick();
    now += 1000;
    player.tick();
    assert.equal(player.$time.get(), 5, 'the wall clock moves the playhead through the gap');
    // Paused and played again, it goes on from where it was.
    player.pause();
    now += 5000;
    player.play();
    player.tick();
    assert.equal(player.$time.get(), 5);
    now += 1000;
    player.tick();
    assert.equal(player.active, 2, 'cut to the next clip at the gap\'s end');
    assert.equal(c.paused, false);
    assert.equal(player.$time.get(), 6);
    player.dispose();
  } finally {
    if (realNow) Object.defineProperty(performance, 'now', realNow);
    else delete performance.now;
  }
});

test('the editor reads the playhead only where it is drawn, and draws it without React', () => {
  const builder = read('features/media/src/scenes/SceneBuilder.tsx');
  assert.doesNotMatch(builder, /useStore\(player\.\$time\)/);
  assert.doesNotMatch(builder, /playback\.time/);
  // The clip under the playhead changes at a cut, and renders only the canvas overlays then: a
  // render of the whole editor held the picture for ~60ms at every cut.
  assert.match(builder, /return player\.\$time\.listen\(\(t\) => setIndex\(indexAt\(t\)\)\);/);
  assert.equal(builder.match(/usePlayheadClip\(/g)?.length, 2);
  assert.match(builder, /const CanvasOverlays: React\.FC<[\s\S]*?> = \([^)]*\) => \{\r?\n  const playheadIndex = usePlayheadClip\(player, clips\);/);
  // The timecode changes its one text node in place: a new node per frame is a childList
  // mutation, which the Tailwind CDN's observer answers by rescanning the page.
  assert.match(builder, /return time\.listen\(\(t\) => \{ text\.data = formatTimecode\(t\); \}\);/);
  const timeline = read('features/media/src/scenes/SceneTimeline.tsx');
  assert.match(timeline, /time: ReadableAtom<number>;/);
  assert.match(timeline, /if \(playheadRef\.current\) playheadRef\.current\.style\.left = left;/);
  assert.doesNotMatch(timeline, /time \* pps/);
});

test('the gallery is not painted under a full-window editor, as Flow drops its grid', () => {
  const view = read('features/media/src/MediaView.tsx');
  assert.match(view, /style=\{activeSceneId \|\| \(selectedItem && selectedItem\.kind !== 'audio'\) \? \{ visibility: 'hidden' \} : undefined\}/);
});
