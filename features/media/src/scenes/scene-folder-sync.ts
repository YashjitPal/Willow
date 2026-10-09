// Keeps a project's scenes in its folder, one small file each in `Media/<project>/Scenes/`
// (scene-files.ts has what goes in them), and brings back from there what this browser lacks.
//
// MediaView drives both halves. `readScenesFromFolder` runs after each reconcile of the project's
// media: it adopts the scene files this browser has no copy of, or an older one, their clips
// pointed at whatever video is at each clip's place now. `useSceneFolderSync` writes: whenever a
// scene's file would read differently (an edit, a rename, one of its videos renamed or moved in
// Willow) that file is written again. It also finds a missing clip again once a video is at its
// place, and draws the pictures a scene read from its file has none of.
//
// Nothing is written for a project before its folder has been read once: a browser coming back
// with an old copy of a scene must not overwrite what another one saved since.

import React from 'react';
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { $sceneProjectLoaded, $scenePhases, $scenes, adoptScenes, patchSceneQuietly, setSceneDeletionListener, type Scene } from './scene-store';
import { clipResolver, mediaPlace, parseSceneFile, sceneFileText, sceneFromFile, sceneToFile, type PlacedMedia, type SceneFile } from './scene-files';
import { captureFrame } from './scene-frames';

/** The project folder's Scenes/, as LocalFSContext reaches it. */
export interface SceneFolder {
  /** Which folder is connected: what was written to one has to be written again to another. */
  key: string;
  list(projectName: string): Promise<{ fsName: string; text: string }[] | null>;
  save(projectName: string, previousFsName: string | undefined, sceneName: string, text: string): Promise<string | null>;
  remove(projectName: string, fsName: string): Promise<boolean>;
}

/** Trims arrive many times a second while dragged; the file is written once they stop. */
const WRITE_DELAY_MS = 800;

interface ProjectSync {
  key: string;
  /** The folder has been read once since the project was opened (or renamed). */
  read: boolean;
  reading: Promise<void> | null;
  /** What each scene's file holds, as far as this browser knows. */
  written: Map<string, string>;
}

let sync: ProjectSync | null = null;
/** Bumped after each read, so the writer runs with what it learned. */
const $reads = atom(0);

function syncFor(folder: SceneFolder, projectId: string, projectName: string): ProjectSync {
  const key = `${folder.key}\u0000${projectId}\u0000${projectName}`;
  if (sync?.key !== key) sync = { key, read: false, reading: null, written: new Map() };
  return sync;
}

function scenesLoaded(projectId: string, ms = 10_000): Promise<boolean> {
  return new Promise((resolve) => {
    if ($sceneProjectLoaded.get() === projectId) { resolve(true); return; }
    const timer = window.setTimeout(() => { off(); resolve(false); }, ms);
    const off = $sceneProjectLoaded.listen((id) => {
      if (id !== projectId) return;
      window.clearTimeout(timer);
      off();
      resolve(true);
    });
  });
}

/**
 * Reads the project's Scenes/ and adopts what is newer there. `items` are the gallery's, with
 * their places settled by the reconcile that just ran.
 */
export function readScenesFromFolder(
  folder: SceneFolder,
  projectId: string,
  projectName: string,
  items: readonly PlacedMedia[],
  folderOf: (collectionId: string) => string | undefined,
): Promise<void> {
  if (!projectId || !projectName) return Promise.resolve();
  const state = syncFor(folder, projectId, projectName);
  // One read at a time; a reconcile landing during one reads again after it.
  const run = (state.reading ?? Promise.resolve()).then(async () => {
    if (!(await scenesLoaded(projectId)) || sync !== state) return;
    const files = await folder.list(projectName);
    // Unreadable: writes stay off until a read gets through.
    if (!files || sync !== state || $sceneProjectLoaded.get() !== projectId) return;
    const resolve = clipResolver(items, folderOf);
    const local = new Map($scenes.get().map((s) => [s.id, s]));
    // Two files can hold one scene (a copy made outside Willow): the newest speaks for it.
    const newest = new Map<string, { file: SceneFile; fsName: string; text: string }>();
    for (const f of files) {
      const file = parseSceneFile(f.text);
      if (!file) continue;
      const seen = newest.get(file.id);
      if (!seen || file.updatedAt > seen.file.updatedAt) newest.set(file.id, { file, fsName: f.fsName, text: f.text });
    }
    const onDisk = new Set(files.map((f) => f.fsName.toLowerCase()));
    const adopted: Scene[] = [];
    for (const { file, fsName, text } of newest.values()) {
      const mine = local.get(file.id);
      if (!mine || file.updatedAt > mine.updatedAt) {
        adopted.push(sceneFromFile(file, fsName, resolve, mine));
        state.written.set(file.id, text);
        continue;
      }
      // This browser's copy is as new. It keeps its file (renamed outside Willow, it follows),
      // and that file is written again if it reads differently.
      const own = mine.fsName && onDisk.has(mine.fsName.toLowerCase()) ? mine.fsName : fsName;
      if (own !== mine.fsName) patchSceneQuietly(mine.id, { fsName: own });
      if (own === fsName) state.written.set(mine.id, text);
    }
    if (adopted.length) adoptScenes(projectId, adopted);
    // A scene whose file has gone is written again.
    for (const scene of $scenes.get()) {
      if (scene.fsName && !onDisk.has(scene.fsName.toLowerCase()) && !newest.has(scene.id)) state.written.delete(scene.id);
    }
    state.read = true;
    $reads.set($reads.get() + 1);
  }).catch((error) => console.warn('[Scenes] Could not read the Scenes folder:', error));
  state.reading = run;
  return run;
}

/** Media items as the sync needs them: their places, and a URL to draw pictures from. */
export type SyncedMedia = PlacedMedia & { url?: string };

export function useSceneFolderSync({
  folder,
  projectId,
  projectName,
  connected,
  items,
  folderOf,
  collectionsKey,
}: {
  folder: SceneFolder;
  projectId: string;
  projectName: string;
  /** The folder is connected and may be written, and this project has one. */
  connected: boolean;
  items: readonly SyncedMedia[];
  folderOf: (collectionId: string) => string | undefined;
  /** Changes when collections do: a collection renamed or moved moves its videos' places. */
  collectionsKey: unknown;
}): void {
  const scenes = useStore($scenes);
  const reads = useStore($reads);

  // Where each video is. The writer depends on the signature, not the items: those change with
  // every progress tick of a generation, which would hold a write back for as long as it runs.
  const placesRef = React.useRef(new Map<string, string | undefined>());
  const placesKey = React.useMemo(() => {
    const places = new Map(items.map((m) => [m.id, mediaPlace(m, folderOf)]));
    placesRef.current = places;
    return [...places].map(([id, place]) => `${id}=${place ?? ''}`).join('\n');
  }, [items, folderOf, collectionsKey]);

  React.useEffect(() => {
    if (!connected || !projectId || !projectName) return undefined;
    const state = syncFor(folder, projectId, projectName);
    if (!state.read) return undefined;
    const timer = window.setTimeout(() => {
      if (sync !== state) return;
      const placeOf = (mediaId: string) => placesRef.current.get(mediaId);
      for (const scene of $scenes.get()) {
        // Still "Creating...": not saved anywhere yet, and gone again if its clip can't be read.
        if ($scenePhases.get()[scene.id] === 'creating') continue;
        const text = sceneFileText(sceneToFile(scene, placeOf));
        if (state.written.get(scene.id) === text) continue;
        state.written.set(scene.id, text);
        void folder.save(projectName, scene.fsName, scene.name, text).then((fsName) => {
          if (!fsName) {
            // Not written: tried again on the scene's next change, or the next read.
            if (state.written.get(scene.id) === text) state.written.delete(scene.id);
            return;
          }
          const now = $scenes.get().find((s) => s.id === scene.id);
          if (now && now.fsName !== fsName) patchSceneQuietly(scene.id, { fsName });
        });
      }
    }, WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [scenes, placesKey, reads, connected, projectId, projectName, folder]);

  // A scene deleted for good takes its file with it.
  React.useEffect(() => {
    if (!connected || !projectName) return undefined;
    setSceneDeletionListener((scene) => {
      sync?.written.delete(scene.id);
      if (scene.fsName) void folder.remove(projectName, scene.fsName);
    });
    return () => setSceneDeletionListener(null);
  }, [connected, projectName, folder]);

  // A clip whose video isn't in this gallery plays again once one is at its place: its file came
  // back, or the collection holding it has loaded since the scene was read.
  React.useEffect(() => {
    const resolve = clipResolver(items, folderOf);
    const ids = new Set(items.map((m) => m.id));
    for (const scene of $scenes.get()) {
      if (!scene.clips.some((c) => c.file && !ids.has(c.mediaId))) continue;
      let changed = false;
      const clips = scene.clips.map((c) => {
        if (!c.file || ids.has(c.mediaId)) return c;
        const found = resolve(c);
        if (!found || found === c.mediaId) return c;
        changed = true;
        return { ...c, mediaId: found, thumb: undefined };
      });
      if (changed) patchSceneQuietly(scene.id, { clips });
    }
  }, [scenes, placesKey]);

  // Scene files carry no pictures: a scene read from one gets its tile's poster and filmstrip
  // drawn from its videos, once they have URLs.
  const tried = React.useRef(new Set<string>());
  React.useEffect(() => {
    const urlOf = new Map(items.filter((m) => m.url).map((m) => [m.id, m.url as string]));
    for (const scene of scenes) {
      const first = scene.clips[0];
      const posterUrl = first ? urlOf.get(first.mediaId) : undefined;
      const posterKey = first ? `${scene.id}:poster:${first.mediaId}:${first.trimStart}` : '';
      if (!scene.poster && posterUrl && !tried.current.has(posterKey)) {
        tried.current.add(posterKey);
        void captureFrame(posterUrl, first.trimStart, 640).then((poster) => {
          const now = $scenes.get().find((s) => s.id === scene.id);
          if (now && !now.poster && now.clips[0]?.mediaId === first.mediaId) patchSceneQuietly(scene.id, { poster });
        }).catch(() => undefined);
      }
      for (const clip of scene.clips) {
        const url = urlOf.get(clip.mediaId);
        const key = `${scene.id}:${clip.id}:${clip.mediaId}:${clip.trimStart}`;
        if (clip.thumb || !url || tried.current.has(key)) continue;
        tried.current.add(key);
        void captureFrame(url, clip.trimStart, 192).then((thumb) => {
          patchSceneQuietly(scene.id, (s) => ({
            clips: s.clips.map((c) => (c.id === clip.id && c.mediaId === clip.mediaId && !c.thumb ? { ...c, thumb } : c)),
          }));
        }).catch(() => undefined);
      }
    }
  }, [scenes, items]);
}
