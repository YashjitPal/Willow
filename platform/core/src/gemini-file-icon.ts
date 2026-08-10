// Resolves an attachment to its vendored file-type icon.
//
// Gemini requests these per attachment from Drive's third-party icon endpoint. We ship
// the same PNGs instead, so a filename is never sent to Google and a tile never blanks
// out on a slow network. The mime → icon step is Gemini's own (`iconMimeType`); only
// the transport differs.

import { FILE_TYPE_ICON_BY_MIME } from './file-type-icons';
import { GeminiFileType, iconMimeType } from './gemini-file-info';

/** Shown when a mime resolves to nothing — Drive's blank-page icon. */
const FALLBACK_ICON = FILE_TYPE_ICON_BY_MIME['application/octet-stream'];

/**
 * The icon a tile paints for this file.
 *
 * `fileType` only matters for the two types whose icon isn't mime-derived: a folder and
 * a Gemini notebook. Everything else goes through Gemini's mime resolution.
 */
export function fileTypeIcon(options: {
  name: string;
  mimeType: string;
  fileType?: number;
  driveMimeType?: string;
}): string {
  if (options.fileType === GeminiFileType.FOLDER) {
    return FILE_TYPE_ICON_BY_MIME['application/vnd.google-apps.folder'] ?? FALLBACK_ICON;
  }
  const mime = iconMimeType(options.mimeType, options.name, options.driveMimeType);
  return FILE_TYPE_ICON_BY_MIME[mime] ?? FALLBACK_ICON;
}
