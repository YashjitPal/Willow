// Playable URLs for scene clips.
//
// Gallery videos are often stored as base64 `data:video` URLs, which a <video> must decode in
// full before it can show a frame. GalleryTile converts them to blob: URLs per tile; a scene
// plays the same source in its tile, its timeline frames and its editor at once, so the blob
// is made once per source here and shared.
import React from 'react';

const blobs = new Map<string, Promise<string>>();

const keyOf = (url: string) => `${url.length}:${url.slice(0, 64)}:${url.slice(-64)}`;

export function toPlayableUrl(url: string): Promise<string> {
  if (!url.startsWith('data:video')) return Promise.resolve(url);
  const key = keyOf(url);
  let p = blobs.get(key);
  if (!p) {
    p = fetch(url)
      .then((r) => r.blob())
      .then((blob) => URL.createObjectURL(blob))
      .catch(() => url);
    blobs.set(key, p);
  }
  return p;
}

/** `toPlayableUrl` for a render: undefined until the blob exists. */
export function usePlayableUrl(url: string | undefined): string | undefined {
  const [resolved, setResolved] = React.useState<string | undefined>(url && !url.startsWith('data:video') ? url : undefined);
  React.useEffect(() => {
    if (!url) { setResolved(undefined); return undefined; }
    if (!url.startsWith('data:video')) { setResolved(url); return undefined; }
    let cancelled = false;
    void toPlayableUrl(url).then((u) => { if (!cancelled) setResolved(u); });
    return () => { cancelled = true; };
  }, [url]);
  return resolved;
}

/** The playable URLs for several sources, keyed by the same index. */
export function usePlayableUrls(urls: (string | undefined)[]): (string | undefined)[] {
  const joined = urls.map((u) => (u ? keyOf(u) : '')).join('|');
  const [resolved, setResolved] = React.useState<(string | undefined)[]>(() => urls.map((u) => (u && !u.startsWith('data:video') ? u : undefined)));
  React.useEffect(() => {
    let cancelled = false;
    void Promise.all(urls.map((u) => (u ? toPlayableUrl(u) : Promise.resolve(undefined)))).then((list) => {
      if (!cancelled) setResolved(list);
    });
    return () => { cancelled = true; };
  }, [joined]); // eslint-disable-line react-hooks/exhaustive-deps
  return resolved;
}
