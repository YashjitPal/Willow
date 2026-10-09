// Keeps a project's characters in its folder, one small file each in
// `Media/<project>/Images/Characters/` (character-files.ts has what goes in them), and brings back
// from there what this browser lacks. Driven by MediaView as the scenes' sync is
// (../scenes/scene-folder-sync.ts): `readCharactersFromFolder` runs after each reconcile of the
// project's media and adopts the files this browser has no copy of, or an older one;
// `useCharacterFolderSync` writes a character's file whenever it would read differently, and moves
// a deleted character's file to the Recycle Bin.
//
// Nothing is written for a project before its folder has been read once: a browser coming back with
// an old copy of a character, or none of them yet, must not overwrite what the folder holds.

import React from 'react';
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { mediaPlace, type PlacedMedia } from '../scenes/scene-files';
import { $characters, $charactersLoaded, adoptCharacters, loadedCharacterProject, setCharacterDeletionListener } from './character-store';
import {
  characterFileName,
  characterFileText,
  characterFromFile,
  characterMediaResolver,
  characterToFile,
  knownPlace,
  parseCharacterFile,
  type CharacterFile,
} from './character-files';

/** The project folder's `Images/Characters/`, as LocalFSContext reaches it. */
export interface CharacterFolder {
  /** Which folder is connected: what was written to one has to be written again to another. */
  key: string;
  list(projectName: string): Promise<{ fsName: string; text: string }[] | null>;
  save(projectName: string, fsName: string, text: string): Promise<boolean>;
  remove(projectName: string, fsName: string): Promise<boolean>;
}

const WRITE_DELAY_MS = 800;

interface ProjectSync {
  key: string;
  /** The folder has been read once since the project was opened. */
  read: boolean;
  reading: Promise<void> | null;
  /** What each character's file holds, as far as this browser knows. */
  written: Map<string, string>;
  /** Each character's file as last read, for the places of pictures this browser has no file for. */
  files: Map<string, CharacterFile>;
}

let sync: ProjectSync | null = null;
/** Bumped after each read, so the writer runs with what it learned. */
const $reads = atom(0);

function syncFor(folder: CharacterFolder, projectId: string, projectName: string): ProjectSync {
  const key = `${folder.key}\u0000${projectId}\u0000${projectName}`;
  if (sync?.key !== key) sync = { key, read: false, reading: null, written: new Map(), files: new Map() };
  return sync;
}

/**
 * Reads the project's characters folder and adopts what is newer there. `items` are the gallery's,
 * with their places settled by the reconcile that just ran.
 */
export function readCharactersFromFolder(
  folder: CharacterFolder,
  projectId: string,
  scopeId: string,
  projectName: string,
  items: readonly PlacedMedia[],
  folderOf: (collectionId: string) => string | undefined,
): Promise<void> {
  if (!projectId || !projectName) return Promise.resolve();
  const state = syncFor(folder, projectId, projectName);
  const run = (state.reading ?? Promise.resolve()).then(async () => {
    const listed = await folder.list(projectName);
    // Unreadable: writes stay off until a read gets through.
    if (!listed || sync !== state) return;
    // Two files can hold one character (a copy made outside Willow): the newest speaks for it.
    const newest = new Map<string, { file: CharacterFile; text: string }>();
    for (const { text } of listed) {
      const file = parseCharacterFile(text);
      if (!file) continue;
      const seen = newest.get(file.id);
      if (!seen || file.updatedAt > seen.file.updatedAt) newest.set(file.id, { file, text });
    }
    const resolve = characterMediaResolver(items, folderOf);
    await adoptCharacters(projectId, scopeId, [...newest.values()].map(({ file }) => characterFromFile(file, resolve)));
    if (sync !== state) return;
    for (const [id, { file, text }] of newest) {
      state.files.set(id, file);
      state.written.set(id, text);
    }
    state.read = true;
    $reads.set($reads.get() + 1);
  }).catch((error) => console.warn('[Characters] Could not read the characters folder:', error));
  state.reading = run;
  return run;
}

export function useCharacterFolderSync({
  folder,
  projectId,
  projectName,
  connected,
  items,
  folderOf,
  collectionsKey,
}: {
  folder: CharacterFolder;
  projectId: string;
  projectName: string;
  /** The folder is connected and may be written, and this project has one. */
  connected: boolean;
  items: readonly PlacedMedia[];
  folderOf: (collectionId: string) => string | undefined;
  /** Changes when collections do: a collection renamed or moved moves its pictures' places. */
  collectionsKey: unknown;
}): void {
  const characters = useStore($characters);
  const loaded = useStore($charactersLoaded);
  const reads = useStore($reads);

  // Where each picture is. The writer depends on the signature, not the items: those change with
  // every progress tick of a generation.
  const placesRef = React.useRef(new Map<string, string | undefined>());
  const placesKey = React.useMemo(() => {
    const places = new Map(items.map((m) => [m.id, mediaPlace(m, folderOf)]));
    placesRef.current = places;
    return [...places].map(([id, place]) => `${id}=${place ?? ''}`).join('\n');
  }, [items, folderOf, collectionsKey]);

  React.useEffect(() => {
    if (!connected || !loaded || !projectId || !projectName) return undefined;
    const state = syncFor(folder, projectId, projectName);
    if (!state.read) return undefined;
    const timer = window.setTimeout(() => {
      if (sync !== state || loadedCharacterProject() !== projectId) return;
      for (const character of $characters.get()) {
        const previous = state.files.get(character.id);
        const text = characterFileText(characterToFile(character, (mediaId) => placesRef.current.get(mediaId) ?? knownPlace(previous, mediaId)));
        if (state.written.get(character.id) === text) continue;
        state.written.set(character.id, text);
        void folder.save(projectName, characterFileName(character.id), text).then((saved) => {
          // Not written: tried again on the character's next change, or the next read.
          if (!saved && state.written.get(character.id) === text) state.written.delete(character.id);
        });
      }
    }, WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [characters, placesKey, reads, connected, loaded, projectId, projectName, folder]);

  // A character deleted takes its file with it.
  React.useEffect(() => {
    if (!connected || !projectName) return undefined;
    setCharacterDeletionListener((id) => {
      sync?.written.delete(id);
      sync?.files.delete(id);
      void folder.remove(projectName, characterFileName(id));
    });
    return () => setCharacterDeletionListener(null);
  }, [connected, projectName, folder]);
}
