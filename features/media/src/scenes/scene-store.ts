// The Scenebuilder's state: the bound project's scenes, their pending/reveal phase, and the
// snackbar Flow shows around scene actions. Lives outside React so the gallery tile menu, the
// scene tiles and the editor all read one copy.
//
// Persistence goes through `@willow/storage/media-scenes`. A scene stores clip references
// (gallery media ids + trims) and small JPEG thumbnails — never media bytes.

import { atom } from 'nanostores';
import {
  deleteScene as deleteStoredScene,
  listScenes,
  saveScene,
  type StoredScene,
  type StoredSceneClip,
} from '@willow/storage/media-scenes';
import { captureFrame, probeVideo } from './scene-frames';
import { defaultSceneName } from './scene-format';

export type SceneClip = StoredSceneClip;
export type Scene = StoredScene;

/**
 * `creating` is Flow's "Creating..." tile: the scene exists but its clip is still being read.
 * `revealing` is the ~2.65s the pending layer takes to fade off the finished tile.
 */
export type ScenePhase = 'creating' | 'revealing';

export interface SceneMediaRef {
  id: string;
  url?: string;
  ratio?: string;
}

export const $scenes = atom<Scene[]>([]);
export const $scenePhases = atom<Record<string, ScenePhase>>({});
/** The project whose scenes `$scenes` holds once they have loaded; null while they load. */
export const $sceneProjectLoaded = atom<string | null>(null);

let bound: { projectId: string; scopeId: string } | null = null;
let loadGeneration = 0;

/** Points the store at a project. Scenes from the previous project are dropped first. */
export async function bindSceneProject(projectId: string, scopeId: string): Promise<void> {
  const gen = ++loadGeneration;
  bound = projectId ? { projectId, scopeId } : null;
  $scenes.set([]);
  $scenePhases.set({});
  $sceneProjectLoaded.set(null);
  if (!projectId) return;
  try {
    const scenes = await listScenes(projectId, scopeId);
    if (gen === loadGeneration) $scenes.set(scenes);
  } catch (error) {
    console.warn('[Scenes] Could not load scenes:', error);
  }
  if (gen === loadGeneration) $sceneProjectLoaded.set(projectId);
}

/*
 * For the folder sync (scene-folder-sync.ts): changes that are bookkeeping, not edits. They save
 * the scene but leave `updatedAt` alone, which says when the user last changed it and decides
 * which copy wins when the folder's and the browser's differ.
 */

/** Patches one scene of the bound project without counting it as an edit. */
export function patchSceneQuietly(id: string, patch: Partial<Scene> | ((scene: Scene) => Partial<Scene>)): void {
  let updated: Scene | undefined;
  $scenes.set($scenes.get().map((scene) => {
    if (scene.id !== id) return scene;
    updated = { ...scene, ...(typeof patch === 'function' ? patch(scene) : patch) };
    return updated;
  }));
  if (updated && $scenePhases.get()[id] !== 'creating') persist(updated);
}

/** Scenes read from the project's folder: added, or replacing the browser's copy. */
export function adoptScenes(projectId: string, scenes: Scene[]): void {
  if (!scenes.length || bound?.projectId !== projectId) return;
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const kept = $scenes.get().map((s) => byId.get(s.id) ?? s);
  const known = new Set(kept.map((s) => s.id));
  $scenes.set([...kept, ...scenes.filter((s) => !known.has(s.id))].sort((a, b) => a.createdAt - b.createdAt));
  for (const scene of scenes) persist(scene);
}

let deletionListener: ((scene: Scene) => void) | null = null;

/** Told of each scene deleted for good, so its file goes too. */
export function setSceneDeletionListener(fn: ((scene: Scene) => void) | null): void {
  deletionListener = fn;
}

/**
 * The video view's scenes: the Scenebuilder opened on one gallery video, as Flow opens a video at
 * /edit/<videoId>. Kept apart from the project's scenes, so they are never saved, never listed and
 * never shown as tiles; an edit made in one still lands in the video's own history.
 */
export const $videoScenes = atom<Record<string, Scene>>({});
export const videoSceneId = (mediaId: string): string => `video:${mediaId}`;
export const isVideoScene = (id: string): boolean => id.startsWith('video:');

export const getScene = (id: string): Scene | undefined =>
  (isVideoScene(id) ? $videoScenes.get()[id] : $scenes.get().find((s) => s.id === id));

function persist(scene: Scene): void {
  if (!bound) return;
  const { projectId, scopeId } = bound;
  void saveScene(projectId, scene, scopeId).catch((error) => console.warn('[Scenes] Could not save scene:', error));
}

function setPhase(id: string, phase: ScenePhase | null): void {
  const next = { ...$scenePhases.get() };
  if (phase) next[id] = phase;
  else delete next[id];
  $scenePhases.set(next);
}

/** Replaces one scene and saves it. Returns the updated scene. */
export function updateScene(id: string, patch: Partial<Scene> | ((scene: Scene) => Partial<Scene>)): Scene | undefined {
  let updated: Scene | undefined;
  if (isVideoScene(id)) {
    const scene = $videoScenes.get()[id];
    if (!scene) return undefined;
    const changes = typeof patch === 'function' ? patch(scene) : patch;
    updated = { ...scene, ...changes, updatedAt: Date.now() };
    $videoScenes.set({ ...$videoScenes.get(), [id]: updated });
    return updated;
  }
  $scenes.set($scenes.get().map((scene) => {
    if (scene.id !== id) return scene;
    const changes = typeof patch === 'function' ? patch(scene) : patch;
    updated = { ...scene, ...changes, updatedAt: Date.now() };
    return updated;
  }));
  if (updated && $scenePhases.get()[id] !== 'creating') persist(updated);
  return updated;
}

const uid = (prefix: string): string =>
  `${prefix}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;

/** A clip for a whole video, with its opening frame as the filmstrip thumbnail. */
export async function buildClip(item: SceneMediaRef): Promise<{ clip: SceneClip; poster?: string }> {
  if (!item.url) throw new Error('This video has no file yet.');
  const { duration } = await probeVideo(item.url);
  const [thumb, poster] = await Promise.all([
    captureFrame(item.url, 0, 192).catch(() => undefined),
    captureFrame(item.url, 0, 640).catch(() => undefined),
  ]);
  return {
    clip: { id: uid('clip'), mediaId: item.id, trimStart: 0, trimEnd: duration, sourceDuration: duration, thumb },
    poster,
  };
}

/**
 * How long a finished scene tile keeps its pending layer while it reveals. The tile plays the
 * gallery's own reveal (`gallery-tile.css`, 2692.5ms), so this has to outlast it.
 */
export const SCENE_REVEAL_MS = 2700;

/**
 * The shortest a new scene stays in "Creating...". Flow's lasts as long as its server takes
 * (~17s measured); reading a local clip takes milliseconds, which would skip the state entirely.
 * This is long enough to read as a state and no longer.
 */
const MIN_CREATING_MS = 1200;

/**
 * New scene from one video. The tile appears at once in its "Creating..." state, exactly as
 * Flow's does; it resolves when the clip has been read, and only then is the scene saved and
 * the "Added to scene" snackbar shown — Flow raises it on completion, not on the click.
 */
export async function createSceneWithVideo(item: SceneMediaRef): Promise<string> {
  const now = Date.now();
  const scene: Scene = {
    id: uid('scene'),
    name: defaultSceneName(new Date(now)),
    createdAt: now,
    updatedAt: now,
    aspectRatio: item.ratio === '9:16' ? '9:16' : '16:9',
    clips: [],
  };
  setPhase(scene.id, 'creating');
  $scenes.set([...$scenes.get(), scene]);
  try {
    const [{ clip, poster }] = await Promise.all([
      buildClip(item),
      new Promise((resolve) => window.setTimeout(resolve, MIN_CREATING_MS)),
    ]);
    const ready: Scene = { ...scene, clips: [clip], poster, updatedAt: Date.now() };
    $scenes.set($scenes.get().map((s) => (s.id === scene.id ? ready : s)));
    persist(ready);
    setPhase(scene.id, 'revealing');
    window.setTimeout(() => setPhase(scene.id, null), SCENE_REVEAL_MS);
    showSnack({
      icon: 'check_circle',
      text: 'Added to scene',
      actions: [
        { label: 'Switch to SceneBuilder', run: () => openScene(scene.id) },
        { label: 'Dismiss' },
      ],
    });
  } catch (error) {
    setPhase(scene.id, null);
    $scenes.set($scenes.get().filter((s) => s.id !== scene.id));
    showSnack({ icon: 'error', tone: 'error', text: error instanceof Error ? error.message : 'Could not create the scene.', actions: [{ label: 'Dismiss' }] });
  }
  return scene.id;
}

/**
 * New scene from several videos at once, in order: the Media agent's create_scene. The tile shows
 * "Creating..." until every clip has been read, like `createSceneWithVideo`'s, but no snackbar is
 * raised; the agent's chat card stands for it. Rejects, leaving no scene, if a clip can't be read.
 */
export async function createSceneFromVideos(items: SceneMediaRef[], name?: string): Promise<Scene> {
  const now = Date.now();
  const scene: Scene = {
    id: uid('scene'),
    name: name?.trim() || defaultSceneName(new Date(now)),
    createdAt: now,
    updatedAt: now,
    aspectRatio: items[0]?.ratio === '9:16' ? '9:16' : '16:9',
    clips: [],
  };
  setPhase(scene.id, 'creating');
  $scenes.set([...$scenes.get(), scene]);
  try {
    const [built] = await Promise.all([
      Promise.all(items.map((item) => buildClip(item))),
      new Promise((resolve) => window.setTimeout(resolve, MIN_CREATING_MS)),
    ]);
    const ready: Scene = { ...scene, clips: built.map((b) => b.clip), poster: built[0]?.poster, updatedAt: Date.now() };
    $scenes.set($scenes.get().map((s) => (s.id === scene.id ? ready : s)));
    persist(ready);
    setPhase(scene.id, 'revealing');
    window.setTimeout(() => setPhase(scene.id, null), SCENE_REVEAL_MS);
    return ready;
  } catch (error) {
    setPhase(scene.id, null);
    $scenes.set($scenes.get().filter((s) => s.id !== scene.id));
    throw error;
  }
}

/**
 * Sets a scene's clips in one go: entries that are already clips are kept as they are, trims
 * included, and videos are read in whole. The poster follows the first clip when it changes.
 */
export async function setSceneClips(
  sceneId: string,
  plan: (SceneClip | SceneMediaRef)[],
  urlOf: (mediaId: string) => string | undefined,
): Promise<Scene | undefined> {
  const before = getScene(sceneId);
  if (!before) return undefined;
  const built = await Promise.all(plan.map(async (entry) => ('mediaId' in entry ? { clip: entry } : buildClip(entry))));
  const clips = built.map((b) => b.clip);
  let poster = before.poster;
  if (clips[0] && clips[0].mediaId !== before.clips[0]?.mediaId) {
    const first = built[0];
    const url = urlOf(clips[0].mediaId);
    poster = ('poster' in first && first.poster) || (url ? await captureFrame(url, clips[0].trimStart, 640).catch(() => poster) : poster);
  }
  return updateScene(sceneId, { clips, poster: clips.length ? poster : undefined });
}

/** Flow's New scene, from the + menu or the canvas's context menu: an empty scene, opened at once. */
export function createEmptyScene(): string {
  const now = Date.now();
  const scene: Scene = {
    id: uid('scene'),
    name: defaultSceneName(new Date(now)),
    createdAt: now,
    updatedAt: now,
    aspectRatio: '16:9',
    clips: [],
  };
  $scenes.set([...$scenes.get(), scene]);
  persist(scene);
  openScene(scene.id);
  return scene.id;
}

/**
 * The video view's scene for `item`, built once per open: the whole video as its only clip. Until
 * it exists the view is an empty page, so it is made as soon as the duration is known; the clip's
 * thumbnail follows, and the editor draws the poster itself.
 */
export async function ensureVideoScene(item: SceneMediaRef & { name: string }): Promise<void> {
  const id = videoSceneId(item.id);
  if ($videoScenes.get()[id]) return;
  if (!item.url) throw new Error('This video has no file yet.');
  const url = item.url;
  const now = Date.now();
  const { duration } = await probeVideo(url);
  if ($videoScenes.get()[id]) return;
  const clip: SceneClip = { id: uid('clip'), mediaId: item.id, trimStart: 0, trimEnd: duration, sourceDuration: duration };
  $videoScenes.set({
    ...$videoScenes.get(),
    [id]: { id, name: item.name, createdAt: now, updatedAt: now, aspectRatio: item.ratio === '9:16' ? '9:16' : '16:9', clips: [clip] },
  });
  void captureFrame(url, 0, 192).then((thumb) => {
    const scene = $videoScenes.get()[id];
    if (!scene?.clips.some((c) => c.id === clip.id)) return;
    $videoScenes.set({ ...$videoScenes.get(), [id]: { ...scene, clips: scene.clips.map((c) => (c.id === clip.id ? { ...c, thumb } : c)) } });
  }).catch(() => undefined);
}

export function dropVideoScene(mediaId: string): void {
  const id = videoSceneId(mediaId);
  if (!$videoScenes.get()[id]) return;
  const next = { ...$videoScenes.get() };
  delete next[id];
  $videoScenes.set(next);
}

/** Appends a video to an existing scene. */
export async function addVideoToScene(sceneId: string, item: SceneMediaRef): Promise<void> {
  try {
    const { clip, poster } = await buildClip(item);
    updateScene(sceneId, (scene) => ({ clips: [...scene.clips, clip], poster: scene.poster || poster }));
    showSnack({
      icon: 'check_circle',
      text: 'Added to scene',
      actions: [
        { label: 'Switch to SceneBuilder', run: () => openScene(sceneId) },
        { label: 'Dismiss' },
      ],
    });
  } catch (error) {
    showSnack({ icon: 'error', tone: 'error', text: error instanceof Error ? error.message : 'Could not add to the scene.', actions: [{ label: 'Dismiss' }] });
  }
}

/** Flow's Move to trash: no confirmation, just an Undo on the snackbar. */
export function trashScene(sceneId: string, onUndo?: () => void): void {
  updateScene(sceneId, { trashedAt: Date.now() });
  showSnack({
    icon: 'info',
    text: '1 item moved to trash',
    actions: [
      { label: 'Undo', run: () => { updateScene(sceneId, { trashedAt: undefined }); onUndo?.(); } },
      { label: 'View in trash' },
      { label: 'Dismiss' },
    ],
  });
}

export function deleteScenePermanently(sceneId: string): void {
  const scene = $scenes.get().find((s) => s.id === sceneId);
  $scenes.set($scenes.get().filter((s) => s.id !== sceneId));
  if (bound) void deleteStoredScene(bound.projectId, sceneId, bound.scopeId).catch(() => undefined);
  if (scene) deletionListener?.(scene);
}

/* ------------------------------------------------------------------ *
 * Opening the editor, and the clip clipboard
 * ------------------------------------------------------------------ */

let opener: ((sceneId: string) => void) | null = null;

/** MediaView registers how a scene is opened (it owns the route); everything else calls `openScene`. */
export function setSceneOpener(fn: ((sceneId: string) => void) | null): void {
  opener = fn;
}

export function openScene(sceneId: string): void {
  opener?.(sceneId);
}

/**
 * Edits in flight, by clip id → the generating gallery item. Runtime only: a clip keeps pointing
 * at its source until the edit lands, so a reload mid-generation never leaves it dangling.
 */
export const $pendingEdits = atom<Record<string, string>>({});

export function setPendingEdit(clipId: string, itemId: string | null): void {
  const next = { ...$pendingEdits.get() };
  if (itemId) next[clipId] = itemId;
  else delete next[clipId];
  $pendingEdits.set(next);
}

/** What a clip's or a scene tile's Copy put aside, for a timeline's Paste. */
export const $sceneClipboard = atom<SceneClip[] | null>(null);

export function copyClips(clips: SceneClip[]): void {
  $sceneClipboard.set(clips.map((c) => ({ ...c })));
}

/** Copies of the clipboard's clips with fresh ids, ready to insert. */
export function pasteClips(): SceneClip[] {
  return ($sceneClipboard.get() || []).map((c) => ({ ...c, id: uid('clip') }));
}

export const newClipId = (): string => uid('clip');

/* ------------------------------------------------------------------ *
 * Snackbar
 * ------------------------------------------------------------------ */

export interface SnackAction {
  label: string;
  /** Runs before the snackbar closes. Every action closes it. */
  run?: () => void;
}

export interface SnackSpec {
  /** A Google Symbols ligature, or `spinner` for the progress ring. */
  icon: string;
  text: string;
  actions: SnackAction[];
  tone?: 'accent' | 'error' | 'warning';
}

export interface SnackState extends SnackSpec {
  id: number;
}

export const $snack = atom<SnackState | null>(null);
let snackSeq = 0;

/** Shows a snackbar, replacing the current one. Returns its id so a caller can update it. */
export function showSnack(spec: SnackSpec): number {
  snackSeq += 1;
  $snack.set({ ...spec, id: snackSeq });
  return snackSeq;
}

/** Replaces the snackbar only if `id` is still the one showing. */
export function updateSnack(id: number, spec: SnackSpec): void {
  if ($snack.get()?.id === id) $snack.set({ ...spec, id });
}

export function dismissSnack(id?: number): void {
  const current = $snack.get();
  if (current && (id === undefined || current.id === id)) $snack.set(null);
}
