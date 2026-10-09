/**
 * What Media keeps in a project's folder besides its media, as files a browser that starts over reads
 * back: a character's file (`features/media/src/characters/character-files.ts`), the agent's chats
 * (`features/media/src/agent/agent-session-files.ts`), and a song's audio beside its cover
 * (`features/media/src/song-audio.ts`). And what this browser deleted (`deleted-here.ts`), which a
 * copy left in the folder must not bring back.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const src = (...parts) => path.join(repoRoot, 'features', 'media', 'src', ...parts);

const storage = new Map();
beforeEach(() => {
  storage.clear();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
});

let characters;
let sessions;
let songs;
let deleted;
before(async () => {
  characters = await importTs(src('characters', 'character-files.ts'));
  sessions = await importTs(src('agent', 'agent-session-files.ts'));
  songs = await importTs(src('song-audio.ts'));
  deleted = await importTs(src('deleted-here.ts'));
});

describe('a character\'s file', () => {
  const ada = {
    id: 'character-1', name: 'Ada', createdAt: 10, updatedAt: 20, favorite: true, personality: 'Curious and dry',
    voice: { name: 'Achernar', sample: 'Hello there', performance: 'Calm' }, prompt: 'A woman in a red coat',
    portraitId: 'gen-portrait', bodyId: 'gen-body',
  };
  const places = { 'gen-portrait': 'Images/Characters/Ada.png' };

  it('keeps the character, its pictures by id and by where their files are', () => {
    const file = characters.characterToFile(ada, (id) => places[id]);
    assert.deepEqual(file.portrait, { id: 'gen-portrait', file: 'Images/Characters/Ada.png' });
    assert.deepEqual(file.body, { id: 'gen-body' });
    const back = characters.parseCharacterFile(characters.characterFileText(file));
    assert.deepEqual(back, file);
    assert.deepEqual(characters.characterFromFile(back, (link) => link.id), ada);
  });

  it('finds its pictures in a gallery read back under new ids, by place', () => {
    const file = characters.characterToFile(ada, (id) => places[id]);
    const resolve = characters.characterMediaResolver(
      [{ id: 'disk-new-id', kind: 'image', fsName: 'ada.PNG', collectionId: 'chars' }],
      (collectionId) => (collectionId === 'chars' ? 'Images/Characters' : undefined),
    );
    const back = characters.characterFromFile(file, resolve);
    assert.equal(back.portraitId, 'disk-new-id');
    assert.equal(back.bodyId, 'gen-body', 'one not found keeps its id, for an item that may yet arrive');
    assert.equal(characters.knownPlace(file, 'gen-portrait'), 'Images/Characters/Ada.png');
  });

  it('reads nothing that is not one, nor one a newer Willow wrote', () => {
    assert.equal(characters.parseCharacterFile('{'), null);
    assert.equal(characters.parseCharacterFile(JSON.stringify({ format: 'willow-scene', id: 'x' })), null);
    assert.equal(characters.parseCharacterFile(JSON.stringify({ format: characters.CHARACTER_FILE_FORMAT, version: 2, id: 'x' })), null);
    const narrowed = characters.parseCharacterFile(JSON.stringify({ format: characters.CHARACTER_FILE_FORMAT, version: 1, id: 'x', name: 3, voice: { sample: 'no name' }, portrait: { file: 'no id' } }));
    assert.deepEqual(narrowed, { format: characters.CHARACTER_FILE_FORMAT, version: 1, id: 'x', name: '', createdAt: 0, updatedAt: 0 });
  });

  it('is named by the character\'s id', () => {
    assert.equal(characters.characterFileName('character-1'), 'character-1.json');
    assert.equal(characters.characterFileName('a/b:c'), 'a_b_c.json');
  });
});

describe('the agent\'s chats read back', () => {
  const chat = (id, updatedAt, extra = {}) => ({
    id, title: `Chat ${id}`, createdAt: updatedAt - 5, updatedAt,
    messages: [{ id: `${id}-m1`, role: 'user', content: 'Make a cat', createdAt: updatedAt - 5 }],
    ...extra,
  });

  it('narrows a chat\'s file, keeping its uploads\' names and thumbnails', () => {
    const parsed = sessions.parseAgentSessionFile(JSON.stringify(chat('a', 100, {
      messages: [
        {
          id: 'm1', role: 'user', content: 'Use this', createdAt: 1, status: 'streaming',
          attachments: [
            { mimeType: 'image/png', name: 'cat.png', thumb: 'data:image/jpeg;base64,AAAA', file: 'attachments/cat-1a2b.png' },
            { mimeType: 'image/png', thumb: 'https://example.com/tracker.png' },
            { name: 'no type' },
          ],
          links: [{ kind: 'character', id: 'character-1', at: 4 }, { kind: 'nope', id: 'x' }],
          actions: ['retry', 5],
        },
        { id: 'm2', role: 'system', content: 'not ours', createdAt: 2 },
        { role: 'assistant', content: 'no id' },
      ],
    })));
    assert.equal(parsed.messages.length, 1);
    assert.deepEqual(parsed.messages[0], {
      id: 'm1', role: 'user', content: 'Use this', createdAt: 1,
      attachments: [
        { mimeType: 'image/png', name: 'cat.png', thumb: 'data:image/jpeg;base64,AAAA', file: 'attachments/cat-1a2b.png' },
        { mimeType: 'image/png' },
      ],
      links: [{ kind: 'character', id: 'character-1', at: 4 }],
      actions: ['retry'],
    });
    assert.equal(sessions.parseAgentSessionFile('{"id":"x","messages":[]}'), null, 'an empty chat is no chat');
    assert.equal(sessions.parseAgentSessionFile('nope'), null);
  });

  it('puts back the ones this browser lacks and did not delete, newest first, as many as fit', async () => {
    const local = [{ id: 'kept' }];
    const fromFolder = [chat('old', 10), chat('kept', 50), chat('new', 90), chat('deleted', 80), chat('new', 70)];
    const picked = sessions.sessionsToImport(local, fromFolder, (id) => id === 'deleted');
    assert.deepEqual(picked.map((s) => `${s.id}@${s.updatedAt}`), ['new@90', 'old@10']);

    const { MAX_AGENT_SESSIONS_PER_PROJECT } = await importTs(path.join(repoRoot, 'platform', 'storage', 'src', 'media-agent-sessions.ts'));
    const full = Array.from({ length: MAX_AGENT_SESSIONS_PER_PROJECT }, (_, i) => ({ id: `local-${i}` }));
    assert.deepEqual(sessions.sessionsToImport(full, [chat('more', 1)], () => false), [], 'no chat of this browser\'s is pushed out');
    const almost = full.slice(1);
    assert.deepEqual(sessions.sessionsToImport(almost, [chat('a', 1), chat('b', 2)], () => false).map((s) => s.id), ['b']);
  });
});

describe('a song\'s audio beside its cover', () => {
  it('is named after the cover, with the audio\'s own extension', () => {
    assert.equal(songs.songAudioFileName('Rain.png', 'audio/mpeg'), 'Rain.mp3');
    assert.equal(songs.songAudioFileName('Rain (1).png', 'audio/wav; codecs=1'), 'Rain (1).wav');
    assert.equal(songs.songAudioFileName('Rain.png', ''), 'Rain.mp3');
    assert.equal(songs.songAudioFileName('v1.2 mix.jpeg', 'audio/ogg'), 'v1.2 mix.ogg');
    assert.equal(songs.songAudioBaseName('Rain.png'), 'Rain');
  });

  it('is written for a song saved before songs kept their audio beside the cover', () => {
    const old = { id: 's', kind: 'audio', status: 'completed', isSavedToFS: true, fsName: 'Rain.png', url: 'blob:cover', audioUrl: 'data:audio/mp3;base64,AAAA', prompt: 'p', timestamp: 1 };
    assert.ok(songs.needsSongAudioFile(old));
    assert.ok(!songs.needsSongAudioFile({ ...old, audioFsName: 'Rain.mp3' }), 'already beside it');
    assert.ok(!songs.needsSongAudioFile({ ...old, url: 'data:image/png;base64,AAAA' }), 'the cover is not shown from the folder yet');
    assert.ok(!songs.needsSongAudioFile({ ...old, audioUrl: 'blob:from-disk' }), 'its audio came from the folder');
    assert.ok(!songs.needsSongAudioFile({ ...old, fsName: 'Rain.mp3' }), 'the file is the audio itself');
    assert.ok(!songs.needsSongAudioFile({ ...old, kind: 'image' }));
  });

  it('is moved, renamed and deleted with the song unless it is another item\'s own file', () => {
    const song = { id: 's', kind: 'audio', fsName: 'Rain.png', audioFsName: 'Rain.mp3', collectionId: 'trip' };
    assert.equal(songs.ownSongAudio(song, [song]), 'Rain.mp3');
    assert.equal(songs.ownSongAudio(song, [song, { id: 'x', kind: 'audio', fsName: 'Rain.mp3', collectionId: 'trip' }]), undefined);
    assert.equal(songs.ownSongAudio(song, [song, { id: 'x', kind: 'audio', fsName: 'Rain.mp3' }]), 'Rain.mp3', 'one in another folder is another file');
    assert.equal(songs.ownSongAudio({ ...song, audioFsName: undefined }, [song]), undefined);
  });
});

describe('what this browser deleted', () => {
  it('is remembered per folder and project, whoever is signed in', () => {
    deleted.rememberDeleted('agent-session', 'user-1::folder-1::My Willow', 'project-1', 'chat-1');
    assert.ok(deleted.deletedHere('agent-session', 'user-2::folder-1::My Willow', 'project-1')('chat-1'));
    assert.ok(!deleted.deletedHere('agent-session', 'user-1::folder-2::Other', 'project-1')('chat-1'));
    assert.ok(!deleted.deletedHere('agent-session', 'user-1::folder-1::My Willow', 'project-2')('chat-1'));
    assert.ok(!deleted.deletedHere('character', 'user-1::folder-1::My Willow', 'project-1')('chat-1'));
  });

  it('keeps the latest two hundred', () => {
    for (let i = 0; i < 205; i += 1) deleted.rememberDeleted('character', 's::f', 'p', `c${i}`);
    const isDeleted = deleted.deletedHere('character', 's::f', 'p');
    assert.ok(isDeleted('c204'));
    assert.ok(isDeleted('c5'));
    assert.ok(!isDeleted('c4'));
  });
});
