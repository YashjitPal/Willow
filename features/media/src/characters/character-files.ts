// A character as a file in its project's folder, `Media/<project>/Images/Characters/<id>.json`, so a
// browser that starts over finds the project's characters beside their pictures. The portrait and
// body are gallery items: kept by id and, for a gallery whose ids are new, by where their files are,
// as a scene's clips are (../scenes/scene-files.ts).

import type { StoredCharacter, StoredCharacterVoice } from '@willow/storage/media-characters';
import { mediaPlace, type PlacedMedia } from '../scenes/scene-files';

/** Where in the project folder the files are; media-disk makes it beside the first image. */
export const CHARACTERS_FOLDER = 'Images/Characters';
export const CHARACTER_FILE_FORMAT = 'willow-character';
export const CHARACTER_FILE_VERSION = 1;

/** A gallery item the character shows: its id, and its file's place when it has one. */
export interface CharacterMediaLink {
  id: string;
  file?: string;
}

export interface CharacterFile {
  format: typeof CHARACTER_FILE_FORMAT;
  version: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  favorite?: boolean;
  personality?: string;
  voice?: StoredCharacterVoice;
  prompt?: string;
  portrait?: CharacterMediaLink;
  body?: CharacterMediaLink;
}

/** Named by id, which never changes: renaming a character never moves its file. */
export const characterFileName = (id: string): string => `${id.replace(/[^\w.-]+/g, '_')}.json`;

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const time = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback);

/** The character's file. Each picture is placed by `locate`; one with no file now is kept by id alone. */
export function characterToFile(character: StoredCharacter, locate: (mediaId: string) => string | undefined): CharacterFile {
  const link = (id: string | undefined): CharacterMediaLink | undefined => {
    if (!id) return undefined;
    const file = locate(id);
    return file ? { id, file } : { id };
  };
  const portrait = link(character.portraitId);
  const body = link(character.bodyId);
  return {
    format: CHARACTER_FILE_FORMAT,
    version: CHARACTER_FILE_VERSION,
    id: character.id,
    name: character.name,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
    ...(character.favorite ? { favorite: true } : {}),
    ...(character.personality ? { personality: character.personality } : {}),
    ...(character.voice ? { voice: { ...character.voice } } : {}),
    ...(character.prompt ? { prompt: character.prompt } : {}),
    ...(portrait ? { portrait } : {}),
    ...(body ? { body } : {}),
  };
}

export const characterFileText = (file: CharacterFile): string => `${JSON.stringify(file, null, 2)}\n`;

const linkOf = (raw: any): CharacterMediaLink | undefined =>
  raw && typeof raw === 'object' && text(raw.id) ? { id: raw.id, ...(text(raw.file) ? { file: raw.file } : {}) } : undefined;

/** A character file read back, or null for anything else (and for one a newer Willow wrote). */
export function parseCharacterFile(source: string): CharacterFile | null {
  let raw: any;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || raw.format !== CHARACTER_FILE_FORMAT || !text(raw.id)) return null;
  if (typeof raw.version === 'number' && raw.version > CHARACTER_FILE_VERSION) return null;
  const createdAt = time(raw.createdAt, 0);
  const voice = raw.voice && typeof raw.voice === 'object' && text(raw.voice.name)
    ? {
        name: raw.voice.name as string,
        ...(text(raw.voice.sample) ? { sample: raw.voice.sample as string } : {}),
        ...(text(raw.voice.performance) ? { performance: raw.voice.performance as string } : {}),
      }
    : undefined;
  const portrait = linkOf(raw.portrait);
  const body = linkOf(raw.body);
  return {
    format: CHARACTER_FILE_FORMAT,
    version: CHARACTER_FILE_VERSION,
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : '',
    createdAt,
    updatedAt: time(raw.updatedAt, createdAt),
    ...(raw.favorite === true ? { favorite: true } : {}),
    ...(text(raw.personality) ? { personality: raw.personality } : {}),
    ...(voice ? { voice } : {}),
    ...(text(raw.prompt) ? { prompt: raw.prompt } : {}),
    ...(portrait ? { portrait } : {}),
    ...(body ? { body } : {}),
  };
}

/**
 * Which gallery item a link means now: the one with its id, else the one at its place (the gallery
 * was read back under new ids), else its id still, for an item that may yet arrive.
 */
export function characterMediaResolver(items: readonly PlacedMedia[], folderOf: (collectionId: string) => string | undefined): (link: CharacterMediaLink) => string {
  const ids = new Set<string>();
  const byPlace = new Map<string, string>();
  for (const item of items) {
    ids.add(item.id);
    const place = mediaPlace(item, folderOf);
    if (place) byPlace.set(place.normalize('NFC').toLowerCase(), item.id);
  }
  return (link) => {
    if (ids.has(link.id)) return link.id;
    return (link.file && byPlace.get(link.file.normalize('NFC').toLowerCase())) || link.id;
  };
}

export function characterFromFile(file: CharacterFile, resolve: (link: CharacterMediaLink) => string): StoredCharacter {
  return {
    id: file.id,
    name: file.name,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    ...(file.favorite ? { favorite: true } : {}),
    ...(file.personality ? { personality: file.personality } : {}),
    ...(file.voice ? { voice: { ...file.voice } } : {}),
    ...(file.prompt ? { prompt: file.prompt } : {}),
    ...(file.portrait ? { portraitId: resolve(file.portrait) } : {}),
    ...(file.body ? { bodyId: resolve(file.body) } : {}),
  };
}

/** Where a link in `file` last placed an item, for an item this browser has no file for now. */
export function knownPlace(file: CharacterFile | undefined, mediaId: string): string | undefined {
  if (!file) return undefined;
  if (file.portrait?.id === mediaId && file.portrait.file) return file.portrait.file;
  if (file.body?.id === mediaId && file.body.file) return file.body.file;
  return undefined;
}
