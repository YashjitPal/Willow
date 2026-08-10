// Gemini's attachment-tile decision logic, transcribed from its client bundle.
//
// Every function here has a one-to-one counterpart in Gemini's minified source; the
// original identifier is named in each doc comment so a future re-extraction can diff
// against it. Nothing in this file is invented — where the behaviour looks odd (see
// `middleTruncate`), it is odd upstream too, and matching it is the point.
//
// The tables it reads live in ./gemini-file-tables.

import {
  CODE_BASENAMES,
  CODE_EXTENSIONS,
  EXTENSION_MIME,
  KNOWN_EXTENSIONS,
  KNOWN_MIME_TYPES,
  MIME_EXTENSION,
  MIME_FILE_TYPE,
  THUMBNAIL_IMAGE_EXTENSIONS,
  THUMBNAIL_VIDEO_EXTENSIONS,
} from './gemini-file-tables';

/**
 * Gemini's internal file-type number. Only the members the tile logic branches on are
 * named; the rest of the range is carried through as a plain number.
 */
export const GeminiFileType = {
  UNKNOWN: 0,
  IMAGE: 1,
  VIDEO: 2,
  TEXT: 3,
  AUDIO: 4,
  SPREADSHEET_GOOGLE: 6,
  XLS: 7,
  DOC_GOOGLE: 8,
  ZIP: 9,
  DOCX: 10,
  PDF: 11,
  SLIDES_GOOGLE: 13,
  CODE: 16,
  FOLDER: 17,
  NOTEBOOK: 20,
} as const;

/** Filename after the last `/`. Gemini: `ijc`. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Lowercased extension, or `''`. Gemini: `UH`.
 *
 * A leading dot yields `''` — `.gitignore` has no extension, it *is* the name. This is
 * deliberately stricter than a naive `lastIndexOf('.')` split.
 */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot === 0 || dot === -1) return '';
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/** Extension-less names that are still code, e.g. `makefile`. Gemini: `ljc`. */
export function isCodeBaseName(name: string): boolean {
  return CODE_BASENAMES.includes(baseName(name));
}

/** Whether the file is source code, by basename or extension. Gemini: `kwc`. */
export function isCodeFile(name: string): boolean {
  if (isCodeBaseName(name)) return true;
  const ext = fileExtension(name);
  return ext !== '' && CODE_EXTENSIONS.includes(ext);
}

/** Mime inferred from the filename when the browser reports none. Gemini: `ojc`. */
export function mimeTypeFromName(name: string): string {
  if (isCodeBaseName(name)) return 'text/plain';
  const ext = fileExtension(name);
  if (ext === '') return 'application/octet-stream';
  const index = KNOWN_EXTENSIONS.indexOf(ext);
  return index === -1 ? 'application/octet-stream' : EXTENSION_MIME[index];
}

/** The file-type number for a mime/name pair. Gemini: `mwc`. */
export function fileTypeOf(mimeType: string, name: string): number {
  if (isCodeFile(name)) return GeminiFileType.CODE;
  const index = KNOWN_MIME_TYPES.indexOf(mimeType);
  if (index !== -1) return MIME_FILE_TYPE[index];
  if (mimeType.startsWith('text/')) return GeminiFileType.TEXT;
  if (mimeType.startsWith('image/')) return GeminiFileType.IMAGE;
  if (mimeType.startsWith('audio/')) return GeminiFileType.AUDIO;
  return GeminiFileType.UNKNOWN;
}

/**
 * The mime whose Drive icon the tile shows. Gemini: `Yid`.
 *
 * `driveMimeType` wins when Drive names a type Gemini recognises. `text/html` is
 * re-derived from the extension because browsers report it for a wide range of files.
 * Anything unrecognised collapses to the generic blank-page icon.
 */
export function iconMimeType(mimeType: string, name: string, driveMimeType?: string): string {
  let mime = driveMimeType && KNOWN_MIME_TYPES.includes(driveMimeType) ? driveMimeType : mimeType;

  if (mime === 'text/html') {
    const ext = fileExtension(name);
    if (ext && ext !== 'html' && ext !== 'htm') {
      const derived = mimeTypeFromName(name);
      if (KNOWN_MIME_TYPES.includes(derived)) mime = derived;
    }
  }

  if (mime !== 'application/vnd.google-apps.folder' && !KNOWN_MIME_TYPES.includes(mime)) {
    return 'application/octet-stream';
  }
  return isCodeFile(name) ? 'text/code' : mime;
}

/** Canonical extension for a mime, or `''`. Gemini: `X8f`. */
export function extensionForMimeType(mimeType: string): string {
  const index = KNOWN_MIME_TYPES.indexOf(mimeType);
  return index === -1 ? '' : MIME_EXTENSION[index];
}

/**
 * Whether the tile shows a text extension label instead of an icon. Gemini: `!e9f`.
 *
 * True for PDF, plain text, audio and unknown — the four types whose Drive icon carries
 * no more information than the word itself.
 */
export function showsExtensionLabel(fileType: number): boolean {
  return fileType === GeminiFileType.PDF
    || fileType === GeminiFileType.TEXT
    || fileType === GeminiFileType.AUDIO
    || fileType === GeminiFileType.UNKNOWN;
}

/** Strips a recognised extension off the display name. Gemini: `T8f`. */
export function stripKnownExtension(name: string, fileType: number): string {
  const dot = name.lastIndexOf('.');
  const known = KNOWN_EXTENSIONS.includes(fileExtension(name));
  const keepsExtension = fileType === GeminiFileType.DOC_GOOGLE
    || fileType === GeminiFileType.SPREADSHEET_GOOGLE
    || fileType === GeminiFileType.SLIDES_GOOGLE;
  return known && !keepsExtension ? name.substring(0, dot) : name;
}

/**
 * Middle-truncates to `limit` characters. Gemini: `U8f`.
 *
 * Upstream declares an uninitialised local for a caller-supplied split point and then
 * branches on it, so that branch is permanently dead and every name splits evenly:
 * `floor(limit/2) + limit%2` head characters, `floor(limit/2)` tail characters. Ported
 * with the dead branch removed and the surviving arithmetic kept exactly.
 */
export function middleTruncate(text: string, limit = 20): string {
  if (text.length < limit) return text;
  const half = Math.floor(limit / 2);
  return text.substring(0, half + (limit % 2)) + '...' + text.substring(text.length - half);
}

/** The name rendered on the tile. Gemini: `p2`. */
export function tileDisplayName(name: string, fileType: number, limit = 20): string {
  return middleTruncate(stripKnownExtension(name, fileType), limit);
}

/** Human-readable format for the Google-native types. Gemini: `V8f`. */
function googleFormatLabel(fileType: number): string {
  switch (fileType) {
    case GeminiFileType.SPREADSHEET_GOOGLE: return 'Google Sheets';
    case GeminiFileType.DOC_GOOGLE: return 'Google Docs';
    case GeminiFileType.SLIDES_GOOGLE: return 'Google Slides';
    case GeminiFileType.FOLDER: return 'Folder';
    case GeminiFileType.NOTEBOOK: return 'Gemini Notebook';
    default: return '';
  }
}

/** Last-resort format name, keyed on file type. Gemini: `Y8f`. */
function fallbackFormatLabel(fileType: number): string {
  switch (fileType) {
    case GeminiFileType.PDF: return 'PDF';
    case GeminiFileType.TEXT: return 'TXT';
    case GeminiFileType.DOCX: return 'DOCX';
    case GeminiFileType.XLS: return 'XLS';
    case GeminiFileType.ZIP: return 'ZIP';
    default: return 'Unknown';
  }
}

/**
 * The format string shown under a file's name in the sent-message list. Gemini: `Z8f`.
 *
 * Distinct from {@link tileDisplayName} — this names the *format*, that names the file.
 */
export function formatLabel(options: {
  name: string;
  mimeType?: string;
  fileType: number;
  driveMimeType?: string;
  isGitHub?: boolean;
  isCodeFolder?: boolean;
}): string {
  if (options.isGitHub) return 'GitHub';
  if (options.isCodeFolder) return 'Code folder';

  const google = googleFormatLabel(options.fileType);
  if (google) return google;

  const ext = fileExtension(options.name);
  if (ext && KNOWN_EXTENSIONS.includes(ext)) return ext.toUpperCase();

  if (options.mimeType) {
    const fromMime = extensionForMimeType(options.mimeType);
    if (fromMime) return fromMime.toUpperCase();
  }
  if (options.driveMimeType) {
    const fromDrive = extensionForMimeType(options.driveMimeType);
    if (fromDrive) return fromDrive.toUpperCase();
  }
  return fallbackFormatLabel(options.fileType);
}

/** Renders as a cover-cropped image thumbnail. Gemini: `q_c` feeding `mqe`. */
export function hasImageThumbnail(name: string): boolean {
  return THUMBNAIL_IMAGE_EXTENSIONS.includes(fileExtension(name));
}

/** Renders as a video thumbnail with a duration overlay. Gemini: `dK` feeding `Ete`. */
export function hasVideoThumbnail(name: string): boolean {
  return THUMBNAIL_VIDEO_EXTENSIONS.includes(fileExtension(name));
}

/** The three tile shapes Gemini renders in the composer strip. */
export type GeminiTileShape = 'image' | 'video' | 'generic';

/** Which tile shape a filename gets. Gemini: the `mqe ? … : Ete ? … : …` template branch. */
export function tileShape(name: string): GeminiTileShape {
  if (hasImageThumbnail(name)) return 'image';
  if (hasVideoThumbnail(name)) return 'video';
  return 'generic';
}
