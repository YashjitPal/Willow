// A scene in the project's folder: `Media/<project>/Scenes/<name>.json`, a few KB however many
// clips it has. It holds no media and no thumbnails: each clip points at its video by where the
// file is in the folder ("Videos/Cat.mp4", or a collection's folder), beside the gallery id it
// had and its trims. When the gallery is rebuilt from the folder (a fresh browser, another
// machine) its videos come back under new ids at the same places, so a scene read back finds its
// clips by place. A clip whose file is gone keeps its pointer and plays as a gap.

import type { StoredScene, StoredSceneClip } from '@willow/storage/media-scenes';

export const SCENE_FILE_FORMAT = 'willow-scene';
export const SCENE_FILE_VERSION = 1;

export interface SceneFileClip {
  id: string;
  /** Where the clip's video is in the project folder: "Videos/X.mp4", "<collection path>/X.mp4". */
  file?: string;
  mediaId: string;
  trimStart: number;
  trimEnd: number;
  sourceDuration: number;
}

export interface SceneFile {
  format: typeof SCENE_FILE_FORMAT;
  version: number;
  id: string;
  name: string;
  aspectRatio: '16:9' | '9:16';
  createdAt: number;
  updatedAt: number;
  favorite?: boolean;
  trashedAt?: number;
  clips: SceneFileClip[];
}

/** What of a gallery item says where its file is. */
export interface PlacedMedia {
  id: string;
  kind: 'image' | 'video' | 'audio';
  fsName?: string;
  collectionId?: string;
}

const KIND_FOLDERS = { image: 'Images', video: 'Videos', audio: 'Audio' } as const;

/**
 * Where an item's file is in the project folder, or undefined while it has none. `folderOf` gives
 * a collection's folder path ("A", "A/B"); an item in no collection is in its kind's folder.
 */
export function mediaPlace(item: PlacedMedia, folderOf: (collectionId: string) => string | undefined): string | undefined {
  if (!item.fsName) return undefined;
  const folder = item.collectionId ? folderOf(item.collectionId) : KIND_FOLDERS[item.kind];
  return folder ? `${folder}/${item.fsName}` : undefined;
}

const finite = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/**
 * The scene's file. Each clip is placed by `locate`, or where it was last known to be when its
 * video has no file now (not saved yet, or gone).
 */
export function sceneToFile(scene: StoredScene, locate: (mediaId: string) => string | undefined): SceneFile {
  return {
    format: SCENE_FILE_FORMAT,
    version: SCENE_FILE_VERSION,
    id: scene.id,
    name: scene.name,
    aspectRatio: scene.aspectRatio,
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
    ...(scene.favorite ? { favorite: true } : {}),
    ...(scene.trashedAt ? { trashedAt: scene.trashedAt } : {}),
    clips: scene.clips.map((clip) => {
      const file = locate(clip.mediaId) ?? clip.file;
      return {
        id: clip.id,
        ...(file ? { file } : {}),
        mediaId: clip.mediaId,
        trimStart: clip.trimStart,
        trimEnd: clip.trimEnd,
        sourceDuration: clip.sourceDuration,
      };
    }),
  };
}

export const sceneFileText = (file: SceneFile): string => `${JSON.stringify(file, null, 2)}\n`;

/** A scene file read back, or null for anything that isn't one (another app's JSON, a torn write). */
export function parseSceneFile(text: string): SceneFile | null {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || raw.format !== SCENE_FILE_FORMAT || typeof raw.id !== 'string' || !raw.id || !Array.isArray(raw.clips)) return null;
  // A file from a newer Willow is left alone rather than half read and written back.
  if (finite(raw.version, 1) > SCENE_FILE_VERSION) return null;
  const clips: SceneFileClip[] = [];
  for (const c of raw.clips) {
    if (!c || typeof c.id !== 'string' || typeof c.mediaId !== 'string') continue;
    const sourceDuration = Math.max(0, finite(c.sourceDuration));
    const trimStart = Math.max(0, finite(c.trimStart));
    const trimEnd = Math.max(trimStart, finite(c.trimEnd, sourceDuration));
    clips.push({
      id: c.id,
      ...(typeof c.file === 'string' && c.file ? { file: c.file } : {}),
      mediaId: c.mediaId,
      trimStart,
      trimEnd,
      sourceDuration: Math.max(sourceDuration, trimEnd),
    });
  }
  const now = Date.now();
  return {
    format: SCENE_FILE_FORMAT,
    version: SCENE_FILE_VERSION,
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Scene',
    aspectRatio: raw.aspectRatio === '9:16' ? '9:16' : '16:9',
    createdAt: finite(raw.createdAt, now),
    updatedAt: finite(raw.updatedAt, finite(raw.createdAt, now)),
    ...(raw.favorite === true ? { favorite: true } : {}),
    ...(finite(raw.trashedAt) > 0 ? { trashedAt: raw.trashedAt } : {}),
    clips,
  };
}

/**
 * The scene a file describes. Each clip plays what `resolve` finds for it (the item at its place
 * now), else keeps the id it had; either way it keeps its place, so a missing clip can be found
 * again. Thumbnails and the poster come from `previous` (the browser's copy) where a clip is the
 * same, and are drawn again from the videos otherwise.
 */
export function sceneFromFile(
  file: SceneFile,
  fsName: string,
  resolve: (clip: SceneFileClip) => string | undefined,
  previous?: StoredScene,
): StoredScene {
  const before = new Map((previous?.clips ?? []).map((c) => [c.id, c]));
  const clips: StoredSceneClip[] = file.clips.map((c) => {
    const mediaId = resolve(c) ?? c.mediaId;
    const old = before.get(c.id);
    return {
      id: c.id,
      mediaId,
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
      sourceDuration: c.sourceDuration,
      ...(c.file ? { file: c.file } : {}),
      ...(old?.thumb && old.mediaId === mediaId && old.trimStart === c.trimStart ? { thumb: old.thumb } : {}),
    };
  });
  const sameOpening = previous?.clips[0] && clips[0] && previous.clips[0].mediaId === clips[0].mediaId && previous.clips[0].trimStart === clips[0].trimStart;
  return {
    id: file.id,
    name: file.name,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    aspectRatio: file.aspectRatio,
    ...(file.favorite ? { favorite: true } : {}),
    ...(file.trashedAt ? { trashedAt: file.trashedAt } : {}),
    clips,
    ...(sameOpening && previous?.poster ? { poster: previous.poster } : {}),
    fsName,
  };
}

/**
 * Which item a file's clip plays here: the one at its place, or, with no place or nothing there,
 * the item it named if this gallery has it.
 */
export function clipResolver(items: readonly PlacedMedia[], folderOf: (collectionId: string) => string | undefined): (clip: { file?: string; mediaId: string }) => string | undefined {
  const byPlace = new Map<string, string>();
  const ids = new Set<string>();
  for (const item of items) {
    ids.add(item.id);
    const place = mediaPlace(item, folderOf);
    if (place) byPlace.set(place.normalize('NFC').toLowerCase(), item.id);
  }
  // Places compare as Windows and macOS compare names: without case.
  return (clip) => {
    const atPlace = clip.file ? byPlace.get(clip.file.normalize('NFC').toLowerCase()) : undefined;
    if (atPlace) return atPlace;
    return ids.has(clip.mediaId) ? clip.mediaId : undefined;
  };
}
