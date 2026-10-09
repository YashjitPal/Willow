import { getCharacterFrameUrl } from "./character-frame";

/** PNG snapshots posted by character frames, keyed by frame URL, framing and state (at most 32). */
const snapshots = new Map<string, string>();
const listeners = new Set<() => void>();
const SNAPSHOT_LIMIT = 32;

/**
 * Willow keeps the snapshots in Cache Storage too, so on the next page load a character shows the frame it last
 * presented while its engine boots again, rather than an empty placeholder.
 */
const PERSISTED_SNAPSHOTS = "dot-character-snapshots";
const persistedRequest = (key: string) =>
  new Request(new URL(`${getCharacterFrameUrl()}?transition-snapshot=${encodeURIComponent(key)}`, window.location.origin));

export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(Error("Could not read image data URL"));
    };
    reader.onerror = () => reject(reader.error ?? Error("Could not read image data URL"));
    reader.readAsDataURL(blob);
  });
}

function remember(key: string, dataUrl: string) {
  snapshots.delete(key);
  snapshots.set(key, dataUrl);
  if (snapshots.size > SNAPSHOT_LIMIT) {
    const oldest = snapshots.keys().next().value;
    if (oldest != null) snapshots.delete(oldest);
  }
}

async function persist(key: string, png: Blob) {
  try {
    const cache = await caches.open(PERSISTED_SNAPSHOTS);
    await cache.delete(persistedRequest(key));
    await cache.put(persistedRequest(key), new Response(png, { headers: { "Content-Type": "image/png" } }));
    const stored = await cache.keys();
    await Promise.all(stored.slice(0, -SNAPSHOT_LIMIT).map((request) => cache.delete(request)));
  } catch {
    // A snapshot that cannot be stored is posted again by the frame on its next boot.
  }
}

void (async () => {
  try {
    const cache = await caches.open(PERSISTED_SNAPSHOTS);
    for (const request of await cache.keys()) {
      const key = new URL(request.url).searchParams.get("transition-snapshot");
      if (key == null || snapshots.has(key)) continue;
      const response = await cache.match(request);
      if (response != null && !snapshots.has(key)) remember(key, await blobToDataUrl(await response.blob()));
    }
    for (const listener of listeners) listener();
  } catch {
    // Without Cache Storage, characters show their placeholder until the engine is ready, as in Codex.
  }
})();

export const characterSnapshotCache = {
  get(key: string) {
    return snapshots.get(key);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  async save(key: string, png: Uint8Array) {
    try {
      const blob = new Blob([new Uint8Array(png)], { type: "image/png" });
      remember(key, await blobToDataUrl(blob));
      for (const listener of listeners) listener();
      void persist(key, blob);
    } catch {
      // A snapshot that cannot be read is simply not cached.
    }
  },
};
