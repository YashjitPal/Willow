// A scene's file in the project folder (features/media/src/scenes/scene-files.ts): a pointer to
// its videos by place, never a copy, read back into a gallery rebuilt from the folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importTs } from './ts-module.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const files = await importTs(path.join(REPO_ROOT, 'features/media/src/scenes/scene-files.ts'));
const { mediaPlace, sceneToFile, sceneFileText, parseSceneFile, sceneFromFile, clipResolver } = files;

const folders = { trip: 'Trips', beach: 'Trips/Beach' };
const folderOf = (id) => folders[id];

const scene = {
  id: 'scene-1',
  name: 'Sunset cut',
  createdAt: 1000,
  updatedAt: 2000,
  aspectRatio: '16:9',
  favorite: true,
  poster: 'data:image/jpeg;base64,POSTER',
  fsName: 'Sunset cut.json',
  clips: [
    { id: 'c1', mediaId: 'v-cat', trimStart: 0, trimEnd: 8, sourceDuration: 8, thumb: 'data:image/jpeg;base64,T1' },
    { id: 'c2', mediaId: 'v-wave', trimStart: 1.5, trimEnd: 6, sourceDuration: 8, thumb: 'data:image/jpeg;base64,T2' },
    { id: 'c3', mediaId: 'v-gone', trimStart: 0, trimEnd: 4, sourceDuration: 4, file: 'Videos/Old clip.mp4' },
  ],
};

const gallery = [
  { id: 'v-cat', kind: 'video', fsName: 'Cat running.mp4' },
  { id: 'v-wave', kind: 'video', fsName: 'Wave.mp4', collectionId: 'beach' },
  { id: 'v-new', kind: 'video' },
];

test('a video is placed by its folder and file name; one not on disk has no place', () => {
  assert.equal(mediaPlace(gallery[0], folderOf), 'Videos/Cat running.mp4');
  assert.equal(mediaPlace(gallery[1], folderOf), 'Trips/Beach/Wave.mp4');
  assert.equal(mediaPlace(gallery[2], folderOf), undefined);
  assert.equal(mediaPlace({ id: 'i', kind: 'image', fsName: 'a.png' }, folderOf), 'Images/a.png');
  assert.equal(mediaPlace({ id: 'x', kind: 'video', fsName: 'a.mp4', collectionId: 'deleted' }, folderOf), undefined);
});

test('the file points at each clip by place and holds no pictures', () => {
  const locate = (id) => mediaPlace(gallery.find((m) => m.id === id) ?? { id, kind: 'video' }, folderOf);
  const file = sceneToFile(scene, locate);
  assert.equal(file.format, 'willow-scene');
  assert.equal(file.version, 1);
  assert.deepEqual(file.clips.map((c) => c.file), ['Videos/Cat running.mp4', 'Trips/Beach/Wave.mp4', 'Videos/Old clip.mp4']);
  assert.deepEqual(file.clips[1], { id: 'c2', file: 'Trips/Beach/Wave.mp4', mediaId: 'v-wave', trimStart: 1.5, trimEnd: 6, sourceDuration: 8 });
  const text = sceneFileText(file);
  assert.doesNotMatch(text, /data:image|thumb|poster|fsName/);
  assert.ok(text.endsWith('\n'));
  assert.ok(text.length < 2000, `a few hundred bytes for three clips, got ${text.length}`);
  assert.equal(file.favorite, true);
  assert.equal('trashedAt' in file, false);
  assert.deepEqual(parseSceneFile(text), file);
});

test('anything that is not a scene file of this version is left alone', () => {
  assert.equal(parseSceneFile('not json'), null);
  assert.equal(parseSceneFile('{"id":"x","clips":[]}'), null);
  assert.equal(parseSceneFile(JSON.stringify({ format: 'willow-scene', version: 2, id: 'x', clips: [] })), null);
  assert.equal(parseSceneFile(JSON.stringify({ format: 'willow-scene', version: 1, clips: [] })), null);
  const odd = parseSceneFile(JSON.stringify({
    format: 'willow-scene', version: 1, id: 'x', name: '  ', aspectRatio: 'square',
    clips: [{ id: 'a', mediaId: 'm', trimStart: 3, trimEnd: 1, sourceDuration: 2 }, { id: 'b' }, null],
  }));
  assert.equal(odd.name, 'Scene');
  assert.equal(odd.aspectRatio, '16:9');
  assert.deepEqual(odd.clips, [{ id: 'a', mediaId: 'm', trimStart: 3, trimEnd: 3, sourceDuration: 3 }]);
});

test('read into a gallery rebuilt from the folder, clips find their videos by place', () => {
  const file = sceneToFile(scene, (id) => mediaPlace(gallery.find((m) => m.id === id) ?? { id, kind: 'video' }, folderOf));
  // Another machine: the same files, new ids, and the collection adopted from its folder.
  const rebuilt = [
    { id: 'disk_video_Cat running.mp4', kind: 'video', fsName: 'Cat running.mp4' },
    { id: 'disk_video_beach2_Wave.mp4', kind: 'video', fsName: 'Wave.mp4', collectionId: 'beach2' },
  ];
  const resolve = clipResolver(rebuilt, (id) => (id === 'beach2' ? 'trips/beach' : undefined));
  const back = sceneFromFile(file, 'Sunset cut.json', resolve);
  assert.deepEqual(back.clips.map((c) => c.mediaId), ['disk_video_Cat running.mp4', 'disk_video_beach2_Wave.mp4', 'v-gone']);
  assert.equal(back.clips[2].file, 'Videos/Old clip.mp4', 'a missing clip keeps its place');
  assert.equal(back.fsName, 'Sunset cut.json');
  assert.equal(back.poster, undefined);
  assert.equal(back.clips[0].thumb, undefined);
  assert.equal(back.favorite, true);
  assert.equal(back.updatedAt, 2000);
});

test('read back in the same browser, a clip keeps its id and its pictures', () => {
  const file = sceneToFile(scene, () => undefined);
  const resolve = clipResolver(gallery, folderOf);
  const back = sceneFromFile(file, 'Sunset cut.json', resolve, scene);
  assert.deepEqual(back.clips.map((c) => c.mediaId), ['v-cat', 'v-wave', 'v-gone']);
  assert.equal(back.clips[0].thumb, 'data:image/jpeg;base64,T1');
  assert.equal(back.poster, 'data:image/jpeg;base64,POSTER');
  // A clip trimmed differently in the file gets its picture drawn again.
  const retrimmed = { ...file, clips: file.clips.map((c) => (c.id === 'c1' ? { ...c, trimStart: 2 } : c)) };
  const again = sceneFromFile(retrimmed, 'Sunset cut.json', resolve, scene);
  assert.equal(again.clips[0].thumb, undefined);
  assert.equal(again.poster, undefined);
});
