/**
 * The Media project's details file (`platform/storage/src/media-details.ts`): what each file was made
 * with, kept beside the files so a browser that starts over gets its items back with their prompts,
 * models, tags, lyrics and song audio instead of as "External Source" files. And the song pairing the
 * reconcile does: a cover with its audio beside it is one song.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
let d;
before(async () => {
  d = await importTs(path.join(repoRoot, 'platform', 'storage', 'src', 'media-details.ts'));
});

const KIND_FOLDERS = { image: 'Images', video: 'Videos', audio: 'Audio' };
const folders = { trip: 'Trip', day: 'Trip/Day 1' };
const placeOf = (item) => (item.fsName ? `${item.collectionId ? folders[item.collectionId] : KIND_FOLDERS[item.kind]}/${item.fsName}` : undefined);

const cat = {
  id: 'gen-1', kind: 'image', status: 'completed', prompt: 'A cat on a sofa', shortenedPrompt: 'Cat', modelId: 'imagen-5',
  modelName: 'Imagen 5', ratio: '1:1', timestamp: 1_700_000_000_000, favorite: true, characterId: 'character-1',
  batchId: 'batch-1', isSavedToFS: true, fsName: 'Cat.png', url: 'blob:x',
};
const song = {
  id: 'song-1', kind: 'audio', status: 'completed', prompt: 'A song about rain', shortenedPrompt: 'Rain', modelId: 'lyria-3',
  lyrics: [{ time: 0, text: 'Rain falls' }, { time: 4.5, text: 'On the roof' }], isSavedToFS: true, fsName: 'Rain.png',
  audioFsName: 'Rain.mp3', collectionId: 'trip',
};

describe('the details file', () => {
  it('keeps what each saved file was made with, by where the file is', () => {
    const built = d.buildMediaDetails([
      cat,
      song,
      { id: 'busy', kind: 'image', status: 'generating', isSavedToFS: true, fsName: 'Busy.png' },
      { id: 'failed', kind: 'image', status: 'failed', isSavedToFS: true, fsName: 'Failed.png' },
      { id: 'here-only', kind: 'image', status: 'completed', prompt: 'Not on disk' },
    ], placeOf, [{ path: 'Trip', favorite: true, coverId: 'song-1' }, { path: 'Trip/Day 1' }]);
    assert.deepEqual(Object.keys(built.items).sort(), ['Images/Cat.png', 'Trip/Rain.png']);
    assert.deepEqual(built.items['Images/Cat.png'], {
      id: 'gen-1', kind: 'image', prompt: 'A cat on a sofa', shortenedPrompt: 'Cat', modelId: 'imagen-5', modelName: 'Imagen 5',
      ratio: '1:1', timestamp: 1_700_000_000_000, favorite: true, characterId: 'character-1', batchId: 'batch-1',
    });
    assert.equal(built.items['Trip/Rain.png'].audio, 'Rain.mp3');
    assert.deepEqual(built.items['Trip/Rain.png'].lyrics, song.lyrics);
    assert.deepEqual(built.collections, { Trip: { favorite: true, coverId: 'song-1' } });
  });

  it('reads back only what it wrote, and leaves a newer Willow\'s file alone', () => {
    const text = d.mediaDetailsText(d.buildMediaDetails([cat, song], placeOf, []));
    assert.deepEqual(d.parseMediaDetails(text), d.buildMediaDetails([cat, song], placeOf, []));
    assert.equal(d.parseMediaDetails('{ half typed'), null);
    assert.equal(d.parseMediaDetails(JSON.stringify({ format: 'something-else', items: {} })), null);
    assert.equal(d.parseMediaDetails(JSON.stringify({ format: d.MEDIA_DETAILS_FORMAT, version: d.MEDIA_DETAILS_VERSION + 1, items: {} })), null);
    const narrowed = d.parseMediaDetails(JSON.stringify({
      format: d.MEDIA_DETAILS_FORMAT,
      version: 1,
      items: {
        'Images/Ok.png': { id: 'ok', kind: 'image', prompt: 7, favorite: 'yes', lyrics: [{ time: 'x', text: 'y' }] },
        'NoFolder.png': { id: 'loose', kind: 'image' },
        'Images/NoId.png': { kind: 'image' },
        'Audio/Song.png': { id: 's', kind: 'audio', audio: '../elsewhere/Song.mp3' },
      },
      collections: { Trip: { favorite: true }, Empty: {} },
    }));
    assert.deepEqual(narrowed.items, { 'Images/Ok.png': { id: 'ok', kind: 'image' }, 'Audio/Song.png': { id: 's', kind: 'audio' } });
    assert.deepEqual(narrowed.collections, { Trip: { favorite: true } });
  });

  it('writes the same contents the same way, so an unchanged file is never written again', () => {
    const a = d.buildMediaDetails([cat, song], placeOf, [{ path: 'Trip', favorite: true }]);
    const b = d.buildMediaDetails([song, cat], placeOf, [{ path: 'Trip', favorite: true }]);
    assert.equal(d.mediaDetailsText(a), d.mediaDetailsText(b));
  });

  describe('written over the folder\'s copy', () => {
    const folderCopy = () => d.buildMediaDetails([
      cat,
      song,
      { id: 'gen-2', kind: 'image', status: 'completed', prompt: 'A dog', modelId: 'imagen-5', isSavedToFS: true, fsName: 'Dog.png' },
      { id: 'gen-3', kind: 'image', status: 'completed', prompt: 'Deleted outside', modelId: 'imagen-5', isSavedToFS: true, fsName: 'Gone.png' },
    ], placeOf, [{ path: 'Trip', favorite: true }, { path: 'Old', coverId: 'x' }]);
    const still = (present) => ({ file: async (place) => present.has(place), folder: async (place) => present.has(place) });

    it('keeps the entries a browser starting over has not met yet, while their files are there', async () => {
      const merged = await d.mergeMediaDetails(folderCopy(), d.buildMediaDetails([], placeOf, []), still(new Set(['Images/Cat.png', 'Trip/Rain.png', 'Images/Dog.png', 'Trip'])));
      assert.deepEqual(Object.keys(merged.items).sort(), ['Images/Cat.png', 'Images/Dog.png', 'Trip/Rain.png']);
      assert.deepEqual(merged.items['Images/Cat.png'], folderCopy().items['Images/Cat.png']);
      assert.deepEqual(merged.collections, { Trip: { favorite: true } }, 'a collection whose folder is gone is dropped');
    });

    it('never replaces what a generated file was made with by this browser knowing it only as found', async () => {
      const found = { id: 'disk_image_Cat.png', kind: 'image', status: 'completed', prompt: 'Cat', modelId: 'external', isSavedToFS: true, fsName: 'cat.PNG' };
      const merged = await d.mergeMediaDetails(folderCopy(), d.buildMediaDetails([found], placeOf, []), still(new Set()));
      assert.equal(merged.items['Images/Cat.png'].modelId, 'imagen-5');
      assert.equal(merged.items['Images/cat.PNG'], undefined);
    });

    it('takes this browser\'s change to an entry', async () => {
      const merged = await d.mergeMediaDetails(folderCopy(), d.buildMediaDetails([{ ...cat, favorite: false }], placeOf, []), still(new Set()));
      assert.equal(merged.items['Images/Cat.png'].favorite, undefined);
    });
  });

  it('gives a found file the item it was, under its old id unless another item has that id now', () => {
    const found = { id: 'disk_image_Cat.png', kind: 'image', status: 'completed', url: '', prompt: 'Cat', shortenedPrompt: 'Cat', modelId: 'external', modelName: 'External Source', ratio: '16:9', timestamp: 5, isSavedToFS: true, fsName: 'Cat.png' };
    const entry = d.buildMediaDetails([cat], placeOf, []).items['Images/Cat.png'];
    const item = d.itemFromDetails(found, entry, () => false);
    assert.equal(item.id, 'gen-1');
    assert.equal(item.prompt, 'A cat on a sofa');
    assert.equal(item.modelId, 'imagen-5');
    assert.equal(item.ratio, '1:1');
    assert.equal(item.favorite, true);
    assert.equal(item.characterId, 'character-1');
    assert.equal(item.fsName, 'Cat.png');
    assert.equal(item.kind, 'image');
    assert.equal(d.itemFromDetails(found, entry, (id) => id === 'gen-1').id, 'disk_image_Cat.png');
    assert.ok(d.isExternalDefault(found));
    assert.ok(!d.isExternalDefault(item));
  });

  it('looks places up as Windows and macOS compare names', () => {
    const lookup = d.mediaDetailsLookup(d.buildMediaDetails([cat], placeOf, [{ path: 'Trip', favorite: true }]));
    assert.equal(lookup.item('images/CAT.png')?.id, 'gen-1');
    assert.equal(lookup.collection('trip')?.favorite, true);
    assert.equal(d.mediaDetailsLookup(null).item('Images/Cat.png'), undefined);
  });

  it('names a song\'s audio on its item, or takes the name off', () => {
    assert.equal(d.withSongAudio({ id: 's' }, 'S.mp3').audioFsName, 'S.mp3');
    const named = { id: 's', audioFsName: 'S.mp3' };
    assert.equal(d.withSongAudio(named, 'S.mp3'), named);
    assert.ok(!('audioFsName' in d.withSongAudio(named, undefined)));
  });
});

describe('songs on disk', () => {
  const file = (folder, fsName, collectionId) => ({ folder, fsName, ...(collectionId ? { collectionId } : {}) });
  const none = () => undefined;
  const pairs = (map) => [...map].map(([cover, audio]) => `${cover.folder}/${cover.fsName} + ${audio.fsName}`).sort();

  it('pairs a cover with the audio its item names, else the one named after it', () => {
    const files = [
      file('Audio', 'Rain.png'), file('Audio', 'Rain (1).mp3'),
      file('Audio', 'Sun.png'), file('Audio', 'Sun.mp3'),
      file('Trip', 'Snow.jpg', 'trip'), file('Trip', 'Snow.wav', 'trip'),
      file('Images', 'Moon.png'), file('Images', 'Moon.mp3'),
    ];
    const known = [{ kind: 'audio', fsName: 'Rain.png', audioFsName: 'Rain (1).mp3' }];
    assert.deepEqual(pairs(d.pairSongFiles(files, known, none)), [
      'Audio/Rain.png + Rain (1).mp3',
      'Audio/Sun.png + Sun.mp3',
      'Trip/Snow.jpg + Snow.wav',
    ]);
  });

  it('pairs by the details file when the browser has no record', () => {
    const files = [file('Audio', 'Rain.png'), file('Audio', 'Take 2.mp3')];
    const details = { 'Audio/Rain.png': { id: 's', kind: 'audio', audio: 'take 2.MP3' } };
    assert.deepEqual(pairs(d.pairSongFiles(files, [], (place) => details[place])), ['Audio/Rain.png + Take 2.mp3']);
  });

  it('never takes a file that is an item of its own as another\'s audio', () => {
    const files = [file('Audio', 'Song.png'), file('Audio', 'Song.mp3'), file('Trip', 'Beat.png', 'trip'), file('Trip', 'Beat.mp3', 'trip')];
    const known = [{ kind: 'audio', fsName: 'Song.mp3' }];
    const details = { 'Trip/Beat.mp3': { id: 'b', kind: 'audio' } };
    assert.deepEqual(pairs(d.pairSongFiles(files, known, (place) => details[place])), []);
  });

  it('finds a renamed audio by its cover\'s name, and gives no file to two songs', () => {
    const files = [file('Audio', 'Storm.png'), file('Audio', 'Storm.mp3')];
    const known = [{ kind: 'audio', fsName: 'Storm.png', audioFsName: 'Rain.mp3' }];
    assert.deepEqual(pairs(d.pairSongFiles(files, known, none)), ['Audio/Storm.png + Storm.mp3']);

    // "A.png"'s record names "B.mp3", which "B.png" (listed first, named by nothing) would take by its name.
    const crossed = [file('Audio', 'B.png'), file('Audio', 'A.png'), file('Audio', 'B.mp3')];
    const records = [{ kind: 'audio', fsName: 'A.png', audioFsName: 'B.mp3' }];
    assert.deepEqual(pairs(d.pairSongFiles(crossed, records, none)), ['Audio/A.png + B.mp3']);
  });

  it('tells a song\'s cover in a collection from a picture', () => {
    const cover = file('Trip', 'Rain.png', 'trip');
    assert.ok(d.isSongCover(cover, true, [], none), 'its audio is beside it');
    assert.ok(d.isSongCover(cover, false, [{ kind: 'audio', fsName: 'Rain.png', collectionId: 'trip' }], none), 'its record says so');
    assert.ok(d.isSongCover(cover, false, [], (place) => (place === 'Trip/Rain.png' ? { id: 's', kind: 'audio' } : undefined)), 'its entry says so');
    assert.ok(!d.isSongCover(cover, false, [{ kind: 'image', fsName: 'Rain.png', collectionId: 'trip' }], none));
    assert.ok(!d.isSongCover(file('Trip', 'Rain.mp3', 'trip'), true, [], none), 'an audio file is no cover');
  });
});
