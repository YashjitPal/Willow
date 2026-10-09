// A video's length and size for the batch info's "720p • 8s". Willow stores neither, so they are
// read from the file's metadata alone (preload="metadata"), once per URL and two at a time; the
// element is released as soon as it has answered.
import React from 'react';

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
}

const resolved = new Map<string, VideoMeta | null>();
const pending = new Map<string, Promise<VideoMeta | null>>();
const queue: (() => void)[] = [];
const CONCURRENCY = 2;
let running = 0;

function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running += 1;
      job().then(resolve, reject).finally(() => {
        running -= 1;
        queue.shift()?.();
      });
    };
    if (running < CONCURRENCY) run();
    else queue.push(run);
  });
}

function readMeta(url: string): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    const finish = (meta: VideoMeta | null) => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      resolve(meta);
    };
    video.onloadedmetadata = () => finish({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => finish(null);
    video.src = url;
  });
}

export function videoMeta(url: string): Promise<VideoMeta | null> {
  if (resolved.has(url)) return Promise.resolve(resolved.get(url) ?? null);
  let job = pending.get(url);
  if (!job) {
    job = schedule(() => readMeta(url)).then((meta) => {
      resolved.set(url, meta);
      pending.delete(url);
      return meta;
    });
    pending.set(url, job);
  }
  return job;
}

/** undefined while reading, null when the file can't be read. */
export function useVideoMeta(url: string | undefined): VideoMeta | null | undefined {
  const [meta, setMeta] = React.useState<VideoMeta | null | undefined>(() => (url ? resolved.get(url) : undefined));
  React.useEffect(() => {
    if (!url) {
      setMeta(undefined);
      return undefined;
    }
    if (resolved.has(url)) {
      setMeta(resolved.get(url));
      return undefined;
    }
    let live = true;
    void videoMeta(url).then((m) => { if (live) setMeta(m); });
    return () => { live = false; };
  }, [url]);
  return meta;
}
