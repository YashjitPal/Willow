// What the Scenebuilder needs from the Media view that hosts it. MediaView owns the gallery's
// items, the route and the API keys; the editor reaches them only through this.
import React from 'react';
import type { MediaItem } from '../types';
import { captureFrame, capturedFrame } from './scene-frames';

export interface SceneHost {
  projectName: string;
  /** The id the project is saved under; absent until a new project is first saved. */
  projectId?: string;
  /** The user's Media projects, which the picker can browse like Flow's. */
  listProjects(): { id: string; name: string }[];
  /** Another project's items, as saved. */
  loadProjectMedia(projectId: string): Promise<MediaItem[]>;
  /** Every item in the project, edit history included. */
  mediaItems: MediaItem[];
  close(): void;
  /** Leaves the Scenebuilder for a gallery item's own viewer. */
  openMedia(item: MediaItem): void;
  addMediaItem(item: MediaItem): void;
  updateMediaItem(id: string, patch: Partial<MediaItem>): void;
  removeMediaItem(id: string): void;
  /** Uploads files into the project and resolves with the finished items. */
  importFiles(files: File[]): Promise<MediaItem[]>;
  geminiKey(): string | undefined;
  /** The Interactions model id behind "Omni 1.1 Flash". */
  omniApiModelId: string;
  omniModelName: string;
  /** Writes a finished generation to the connected folder, if there is one. */
  saveGenerated(item: MediaItem, url: string): void;
}

/**
 * Still frames of `url` at `times`, filled in as they decode. Frames already made are there on the
 * first render, so an editor's rail that mounts again (a switch to another item) doesn't blink.
 */
export function useFrames(url: string | undefined, times: number[], width: number): (string | undefined)[] {
  const key = `${url ? `${url.length}:${url.slice(-32)}` : ''}|${times.map((t) => t.toFixed(2)).join(',')}|${width}`;
  const known = () => times.map((t) => (url ? capturedFrame(url, t, width) : undefined));
  const [frames, setFrames] = React.useState<(string | undefined)[]>(known);
  React.useEffect(() => {
    let cancelled = false;
    const now = known();
    setFrames((prev) => (prev.length === now.length && prev.every((f, i) => f === now[i]) ? prev : now));
    if (!url) return undefined;
    times.forEach((t, i) => {
      if (now[i]) return;
      void captureFrame(url, t, width).then((f) => {
        if (cancelled) return;
        setFrames((prev) => {
          const next = prev.length === times.length ? [...prev] : times.map(() => undefined);
          next[i] = f;
          return next;
        });
      }).catch(() => undefined);
    });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return frames;
}

/** A gallery item's edit lineage, oldest first: the original and every edit made from it. */
export function historyOf(item: MediaItem | undefined, items: MediaItem[]): MediaItem[] {
  if (!item) return [];
  const root = item.historyGroupId || item.id;
  const steps = items.filter((m) => m.kind === 'video' && (m.id === root || m.historyGroupId === root));
  if (!steps.some((m) => m.id === item.id)) steps.push(item);
  return steps.sort((a, b) => a.timestamp - b.timestamp);
}
