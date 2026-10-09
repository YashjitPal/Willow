// A song on disk is its cover with its audio beside it, named after the cover ("Song.png" and
// "Song.mp3"), so the folder holds the song itself rather than only its picture. The media reconcile
// pairs the two back (`pairSongFiles` in @willow/storage/media-details).

import { IMAGE_FILE_NAME } from '@willow/storage/media-details';
import type { MediaItem } from './types';

const EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/flac': 'flac',
  'audio/opus': 'opus',
};

/** The name, without its extension, that a song's audio takes from its cover's file name. */
export function songAudioBaseName(coverFsName: string): string {
  const dot = coverFsName.lastIndexOf('.');
  return dot > 0 ? coverFsName.slice(0, dot) : coverFsName;
}

/** The audio file's name for the song whose cover is `coverFsName`. */
export function songAudioFileName(coverFsName: string, mimeType: string): string {
  return `${songAudioBaseName(coverFsName)}.${EXTENSIONS[mimeType.split(';')[0].trim().toLowerCase()] ?? 'mp3'}`;
}

/**
 * A song whose cover is in the folder but whose audio is only in this browser: saved before songs
 * kept their audio beside the cover. The cover counts as there once the gallery shows it from disk.
 */
export const needsSongAudioFile = (m: MediaItem): boolean =>
  m.kind === 'audio'
  && !!m.isSavedToFS
  && !!m.fsName
  && IMAGE_FILE_NAME.test(m.fsName)
  && !m.audioFsName
  && !!m.audioUrl?.startsWith('data:')
  && !!m.url?.startsWith('blob:');

/**
 * The song's audio file, to move, rename or delete with its cover: unless another item in its folder
 * has that file as its own.
 */
export function ownSongAudio(item: MediaItem, items: readonly MediaItem[]): string | undefined {
  if (!item.audioFsName) return undefined;
  const folder = item.collectionId || undefined;
  const taken = items.some((m) => m.id !== item.id && m.fsName === item.audioFsName && (m.collectionId || undefined) === folder);
  return taken ? undefined : item.audioFsName;
}
