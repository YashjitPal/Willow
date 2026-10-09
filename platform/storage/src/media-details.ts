/**
 * What a Media project's files cannot say about themselves, in one small file in the project folder:
 *
 *   Media/<project>/.willow-media.json
 *
 * Each file on disk is a gallery item, and the item's details — the prompt and model it was made
 * with, its aspect ratio, its favourite and character tags, a song's lyrics and the audio file beside
 * its cover, the batch and version it belongs to — live in IndexedDB, which a reinstall wipes. This
 * file keeps them beside the media, keyed by where each file is ("Images/Cat.png", "Trip/Cat.png"),
 * with each collection's favourite and cover keyed by its folder ("Trip", "Trip/Day 1").
 *
 * A browser that kept its storage never needs it. The media reconcile reads it only for a file it
 * has no record of, which then comes back under its old id with its details rather than as an
 * "External Source" file named after itself. The files stay the source of truth: an entry whose file
 * is gone is dropped the next time the file is written, and a file with no entry comes back as it
 * always has.
 */

export const MEDIA_DETAILS_FILE = '.willow-media.json';
export const MEDIA_DETAILS_FORMAT = 'willow-media-details';
export const MEDIA_DETAILS_VERSION = 1;

type MediaKind = 'image' | 'video' | 'audio';

export interface MediaFileDetails {
  id: string;
  kind: MediaKind;
  prompt?: string;
  shortenedPrompt?: string;
  modelId?: string;
  modelName?: string;
  ratio?: string;
  timestamp?: number;
  favorite?: boolean;
  characterId?: string;
  batchId?: string;
  historyGroupId?: string;
  historyParentId?: string;
  lyrics?: { time: number; text: string }[];
  effort?: string;
  quality?: string;
  resolution?: string;
  /** A song's audio: a file beside its cover, in the same folder. */
  audio?: string;
}

export interface CollectionDetails {
  favorite?: boolean;
  coverId?: string;
}

export interface MediaDetailsFile {
  format: typeof MEDIA_DETAILS_FORMAT;
  version: number;
  items: Record<string, MediaFileDetails>;
  collections: Record<string, CollectionDetails>;
}

/** A gallery item as far as its details go; `fsName` and a place are what put it in the file. */
export interface MediaDetailsSource {
  id: string;
  kind: MediaKind;
  status?: string;
  prompt?: string;
  shortenedPrompt?: string;
  modelId?: string;
  modelName?: string;
  ratio?: string;
  timestamp?: number;
  favorite?: boolean;
  characterId?: string;
  batchId?: string;
  historyGroupId?: string;
  historyParentId?: string;
  lyrics?: { time: number; text: string }[];
  effort?: string;
  quality?: string;
  resolution?: string;
  isSavedToFS?: boolean;
  fsName?: string;
  audioFsName?: string;
  collectionId?: string;
}

const KINDS = new Set<MediaKind>(['image', 'video', 'audio']);
const TEXT_FIELDS = ['prompt', 'shortenedPrompt', 'modelId', 'modelName', 'ratio', 'characterId', 'batchId', 'historyGroupId', 'historyParentId', 'effort', 'quality', 'resolution'] as const;

/** Places compare as Windows and macOS compare names: without case. */
export const placeKey = (place: string): string => place.normalize('NFC').toLowerCase();

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const lyricsOf = (value: unknown): { time: number; text: string }[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const lines = value
    .filter((line) => line && typeof line.text === 'string' && typeof line.time === 'number' && Number.isFinite(line.time))
    .map((line) => ({ time: line.time as number, text: line.text as string }));
  return lines.length ? lines : undefined;
};

/** The fields worth keeping from an item or an entry, each narrowed; null without an id and a kind. */
function detailsFrom(raw: any): MediaFileDetails | null {
  if (!raw || typeof raw !== 'object' || !text(raw.id) || !KINDS.has(raw.kind)) return null;
  const details: MediaFileDetails = { id: raw.id, kind: raw.kind };
  for (const field of TEXT_FIELDS) {
    if (text(raw[field])) details[field] = raw[field];
  }
  if (typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp) && raw.timestamp > 0) details.timestamp = raw.timestamp;
  if (raw.favorite === true) details.favorite = true;
  const lyrics = lyricsOf(raw.lyrics);
  if (lyrics) details.lyrics = lyrics;
  const audio = raw.audio ?? raw.audioFsName;
  if (text(audio) && !audio.includes('/')) details.audio = audio;
  return details;
}

/** A file Willow found in the folder and knew nothing about. */
export const isExternalDetails = (details: { modelId?: string }): boolean => !details.modelId || details.modelId === 'external';

/** An item the reconcile made for a file it had no record of, still with nothing but its defaults. */
export const isExternalDefault = (item: any): boolean =>
  item?.modelId === 'external' && typeof item?.id === 'string' && item.id.startsWith('disk_');

/** The file's contents for a project's items and collections. Items without a file are left out. */
export function buildMediaDetails(
  items: readonly MediaDetailsSource[],
  placeOf: (item: MediaDetailsSource) => string | undefined,
  collections: readonly { path?: string; favorite?: boolean; coverId?: string }[],
): MediaDetailsFile {
  const out: MediaDetailsFile = { format: MEDIA_DETAILS_FORMAT, version: MEDIA_DETAILS_VERSION, items: {}, collections: {} };
  for (const item of items) {
    if (!item?.isSavedToFS || !item.fsName || item.status === 'generating' || item.status === 'failed') continue;
    const place = placeOf(item);
    const details = place ? detailsFrom(item) : null;
    if (place && details) out.items[place] = details;
  }
  for (const collection of collections) {
    if (!collection.path || (!collection.favorite && !collection.coverId)) continue;
    out.collections[collection.path] = {
      ...(collection.favorite ? { favorite: true } : {}),
      ...(text(collection.coverId) ? { coverId: collection.coverId } : {}),
    };
  }
  return out;
}

/** The file read back; null for anything else, and for a file a newer Willow wrote, which is left alone. */
export function parseMediaDetails(source: string): MediaDetailsFile | null {
  let raw: any;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || raw.format !== MEDIA_DETAILS_FORMAT) return null;
  if (typeof raw.version === 'number' && raw.version > MEDIA_DETAILS_VERSION) return null;
  const out: MediaDetailsFile = { format: MEDIA_DETAILS_FORMAT, version: MEDIA_DETAILS_VERSION, items: {}, collections: {} };
  if (raw.items && typeof raw.items === 'object') {
    for (const [place, entry] of Object.entries(raw.items)) {
      const details = place.includes('/') ? detailsFrom(entry) : null;
      if (details) out.items[place] = details;
    }
  }
  if (raw.collections && typeof raw.collections === 'object') {
    for (const [path, entry] of Object.entries<any>(raw.collections)) {
      if (!path || !entry || typeof entry !== 'object') continue;
      const details: CollectionDetails = {
        ...(entry.favorite === true ? { favorite: true } : {}),
        ...(text(entry.coverId) ? { coverId: entry.coverId } : {}),
      };
      if (details.favorite || details.coverId) out.collections[path] = details;
    }
  }
  return out;
}

const sorted = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.keys(record).sort((a, b) => a.localeCompare(b)).map((key) => [key, record[key]]));

/** The same contents always read the same, so an unchanged file is never written again. */
export const mediaDetailsText = (file: MediaDetailsFile): string =>
  `${JSON.stringify({ format: MEDIA_DETAILS_FORMAT, version: MEDIA_DETAILS_VERSION, items: sorted(file.items), collections: sorted(file.collections) }, null, 2)}\n`;

/**
 * What to write over `previous` (the folder's copy) from `next` (this browser's). An entry this browser
 * has no item for is kept while its file is still there: a browser starting over, or one whose
 * reconcile could not finish, must not drop what it has not met yet. And an entry for a generated file
 * is never replaced by this browser's knowing that file only as found in the folder.
 */
export async function mergeMediaDetails(
  previous: MediaDetailsFile | null,
  next: MediaDetailsFile,
  still: { file: (place: string) => Promise<boolean>; folder: (path: string) => Promise<boolean> },
): Promise<MediaDetailsFile> {
  if (!previous) return next;
  const items: Record<string, MediaFileDetails> = {};
  const before = new Map(Object.entries(previous.items).map(([place, details]) => [placeKey(place), { place, details }]));
  const mine = new Set<string>();
  for (const [place, details] of Object.entries(next.items)) {
    const key = placeKey(place);
    mine.add(key);
    const old = before.get(key);
    if (old && isExternalDetails(details) && !isExternalDetails(old.details)) items[old.place] = old.details;
    else items[place] = details;
  }
  for (const [key, { place, details }] of before) {
    if (!mine.has(key) && await still.file(place)) items[place] = details;
  }
  const collections: Record<string, CollectionDetails> = { ...next.collections };
  const ours = new Set(Object.keys(next.collections).map(placeKey));
  for (const [path, details] of Object.entries(previous.collections)) {
    if (!ours.has(placeKey(path)) && await still.folder(path)) collections[path] = details;
  }
  return { format: MEDIA_DETAILS_FORMAT, version: MEDIA_DETAILS_VERSION, items, collections };
}

/** Case-blind lookups into a file read back; finds nothing when there was no file. */
export function mediaDetailsLookup(file: MediaDetailsFile | null): {
  item: (place: string) => MediaFileDetails | undefined;
  collection: (path: string) => CollectionDetails | undefined;
} {
  const items = new Map(Object.entries(file?.items ?? {}).map(([place, details]) => [placeKey(place), details]));
  const collections = new Map(Object.entries(file?.collections ?? {}).map(([path, details]) => [placeKey(path), details]));
  return {
    item: (place) => items.get(placeKey(place)),
    collection: (path) => collections.get(placeKey(path)),
  };
}

/**
 * The item for a file the reconcile had no record of: `fallback` (what it makes of any file it finds)
 * with the entry's details over it, under the entry's id unless another item has that one now.
 */
export function itemFromDetails<T extends Record<string, any>>(fallback: T, details: MediaFileDetails, idTaken: (id: string) => boolean): T {
  const { id, kind: _kind, audio: _audio, ...fields } = details;
  return { ...fallback, ...fields, id: idTaken(id) ? fallback.id : id };
}

/** The item with its song audio named, or with none. */
export function withSongAudio<T extends Record<string, any>>(item: T, audioFsName: string | undefined): T {
  if (audioFsName) return item.audioFsName === audioFsName ? item : { ...item, audioFsName };
  if (!('audioFsName' in item)) return item;
  const { audioFsName: _gone, ...rest } = item;
  return rest as T;
}

/* ------------------------------------------------------------------ *
 * Songs: a cover image with its audio beside it, in Audio/ or a collection's folder.
 * ------------------------------------------------------------------ */

export const AUDIO_FILE_NAME = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i;
export const IMAGE_FILE_NAME = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;

/** A file in the project folder as the reconcile lists it: `folder` is "Audio", "Images", "Videos" or a collection's path. */
export interface ListedFile {
  fsName: string;
  folder: string;
  collectionId?: string;
}

/** What the reconcile knows of an item before it matches files to items. */
export interface KnownFile {
  kind?: string;
  fsName?: string;
  audioFsName?: string;
  collectionId?: string;
}

const baseName = (fsName: string): string => {
  const dot = fsName.lastIndexOf('.');
  return placeKey(dot === -1 ? fsName : fsName.slice(0, dot));
};

const FOLDER_KINDS: Record<string, string> = { Images: 'image', Videos: 'video', Audio: 'audio' };

/** Whether an item's record puts it in the folder `file` is in: a kind folder holds one kind. */
const inFolderOf = (file: ListedFile, item: KnownFile): boolean =>
  file.collectionId
    ? item.collectionId === file.collectionId
    : !item.collectionId && (!item.kind || item.kind === FOLDER_KINDS[file.folder]);

const sameFile = (file: ListedFile, item: KnownFile): boolean =>
  !!item.fsName && placeKey(item.fsName) === placeKey(file.fsName) && inFolderOf(file, item);

/**
 * Each song cover in `files` with the audio file that goes with it. The audio is the one its item
 * names (`audioFsName`), or its entry in the details file does, else one of the same name beside it
 * (a song's audio is written named after its cover). A file that is an item of its own — a record or
 * an entry under its own name — is never taken as another's audio.
 */
export function pairSongFiles<F extends ListedFile>(
  files: readonly F[],
  known: readonly KnownFile[],
  detailsAt: (place: string) => MediaFileDetails | undefined,
): Map<F, F> {
  const pairs = new Map<F, F>();
  const byFolder = new Map<string, F[]>();
  for (const file of files) {
    if (file.folder === 'Images' || file.folder === 'Videos') continue;
    const list = byFolder.get(file.folder) ?? [];
    list.push(file);
    byFolder.set(file.folder, list);
  }
  for (const [folder, inFolder] of byFolder) {
    const standalone = (audio: F) => known.some((m) => sameFile(audio, m)) || !!detailsAt(`${folder}/${audio.fsName}`);
    const audios = inFolder.filter((f) => AUDIO_FILE_NAME.test(f.fsName) && !standalone(f));
    const covers = inFolder.filter((f) => IMAGE_FILE_NAME.test(f.fsName));
    const taken = new Set<F>();
    const pair = (cover: F, audio: F | undefined) => {
      if (!audio) return;
      taken.add(audio);
      pairs.set(cover, audio);
    };
    // Named ones first, so no file named for one song goes to another by its name.
    for (const cover of covers) {
      const named = known.find((m) => sameFile(cover, m))?.audioFsName || detailsAt(`${folder}/${cover.fsName}`)?.audio;
      if (named) pair(cover, audios.find((a) => !taken.has(a) && placeKey(a.fsName) === placeKey(named)));
    }
    // Then by the cover's name, which also finds a named file a rename has just changed.
    for (const cover of covers) {
      if (!pairs.has(cover)) pair(cover, audios.find((a) => !taken.has(a) && baseName(a.fsName) === baseName(cover.fsName)));
    }
  }
  return pairs;
}

/**
 * Whether an image file in a collection's folder is a song's cover rather than a picture: it has its
 * audio beside it, or its record or entry says it is a song's. (Everything in Audio/ is a song's.)
 */
export function isSongCover(
  file: ListedFile,
  paired: boolean,
  known: readonly KnownFile[],
  detailsAt: (place: string) => MediaFileDetails | undefined,
): boolean {
  if (!file.collectionId || !IMAGE_FILE_NAME.test(file.fsName)) return false;
  if (paired) return true;
  if (detailsAt(`${file.folder}/${file.fsName}`)?.kind === 'audio') return true;
  return known.some((m) => m.kind === 'audio' && sameFile(file, m));
}
