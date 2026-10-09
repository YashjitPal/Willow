// Keeps the project folder's details file (`@willow/storage/media-details`) in step with the gallery:
// what each file was made with, its favourite and character tags, a song's lyrics and audio file, and
// each collection's favourite and cover. A browser that starts over reads it back in its reconcile.
//
// Written a moment after the last change, and only once this view has read the project's media from
// the folder. What is written is merged with the file's own entries (LocalFSContext keeps every entry
// whose file is still there), so a browser that has not met every file yet loses none of theirs.

import React from 'react';
import { buildMediaDetails, mediaDetailsText, type MediaDetailsFile, type MediaDetailsSource } from '@willow/storage/media-details';
import { mediaPlace } from './scenes/scene-files';
import type { MediaItem } from './types';

const WRITE_DELAY_MS = 1500;

interface CollectionDetailsSource {
  id: string;
  favorite?: boolean;
  coverId?: string;
}

/** The details file's contents for the gallery's items and collections. */
export function mediaDetailsFor(
  items: readonly MediaItem[],
  collections: readonly CollectionDetailsSource[],
  folderOf: (collectionId: string) => string | undefined,
): MediaDetailsFile {
  return buildMediaDetails(
    items as readonly MediaDetailsSource[],
    (item) => mediaPlace(item, folderOf),
    collections.map((c) => ({ path: folderOf(c.id), favorite: c.favorite, coverId: c.coverId })),
  );
}

export function useMediaDetailsSync({
  ready,
  isLoaded,
  projectId,
  projectName,
  items,
  collections,
  folderOf,
  save,
}: {
  /** The folder is connected and writable, this project has one, and its collections are read. */
  ready: boolean;
  /** The project's media have been read from the folder in this view. */
  isLoaded: () => boolean;
  projectId: string;
  projectName: string;
  items: readonly MediaItem[];
  collections: readonly CollectionDetailsSource[];
  folderOf: (collectionId: string) => string | undefined;
  save: (projectName: string, details: MediaDetailsFile) => Promise<boolean>;
}): void {
  const written = React.useRef<{ key: string; text: string } | null>(null);
  React.useEffect(() => {
    if (!ready || !projectId || !projectName) {
      // The folder may be another one when it is back.
      written.current = null;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      if (!isLoaded()) return;
      const details = mediaDetailsFor(items, collections, folderOf);
      const text = mediaDetailsText(details);
      const key = `${projectId}\u0000${projectName}`;
      if (written.current?.key === key && written.current.text === text) return;
      written.current = { key, text };
      void save(projectName, details).then((saved) => {
        // Not written: tried again on the next change.
        if (!saved && written.current?.key === key && written.current.text === text) written.current = null;
      });
    }, WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, isLoaded, projectId, projectName, items, collections, folderOf, save]);
}
