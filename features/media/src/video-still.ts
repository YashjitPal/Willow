// A still of a video's first frame, for tiles that show a video before it ever plays.
//
// A <video> that has loaded holds a media player, a decoder and a queue of decoded frames just to
// show that one frame — one per video tile, the whole time the gallery is open. Flow shows a
// picture until a tile is first hovered and loads the video then; Willow does the same. Each still
// is decoded once, through a short-lived element (two at a time), and the tile's own <video> keeps
// preload="none" with the still as its poster until it is hovered.
import React from 'react';

/** Undefined while being made; null when the video can't be decoded here (the tile loads it instead). */
type Still = string | null;

const resolved = new Map<string, Still>();
const pending = new Map<string, Promise<Still>>();
const waiting: Array<() => void> = [];
let running = 0;
const CONCURRENCY = 2;

function schedule(job: () => Promise<Still>): Promise<Still> {
  return new Promise<Still>((resolve) => {
    const run = () => {
      running += 1;
      job().catch(() => null).then((value) => {
        running -= 1;
        waiting.shift()?.();
        resolve(value);
      });
    };
    if (running < CONCURRENCY) run();
    else waiting.push(run);
  });
}

function loaded(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => done(new Error('timed out')), 20_000);
    const ok = () => done();
    const fail = () => done(new Error('the video could not be decoded'));
    function done(error?: Error) {
      window.clearTimeout(timer);
      video.removeEventListener('loadeddata', ok);
      video.removeEventListener('error', fail);
      if (error) reject(error);
      else resolve();
    }
    video.addEventListener('loadeddata', ok);
    video.addEventListener('error', fail);
  });
}

async function decodeStill(url: string): Promise<Still> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  let temporary: string | null = null;
  try {
    // A data: URL can't stream; the element would hold the whole base64 payload.
    if (url.startsWith('data:')) temporary = URL.createObjectURL(await (await fetch(url)).blob());
    video.src = temporary ?? url;
    await loaded(video);
    // The frame at time 0 — the one a loaded, never-played <video> shows.
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) return null;
    ctx.drawImage(video, 0, 0);
    // A frame that wasn't ready draws nothing, leaving the canvas transparent; a black frame is opaque.
    if (ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data[3] === 0) return null;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    video.removeAttribute('src');
    video.load();
    if (temporary) URL.revokeObjectURL(temporary);
  }
}

export function videoStill(url: string): Promise<Still> {
  if (resolved.has(url)) return Promise.resolve(resolved.get(url) as Still);
  let job = pending.get(url);
  if (!job) {
    job = schedule(() => decodeStill(url)).then((still) => {
      resolved.set(url, still);
      pending.delete(url);
      return still;
    });
    pending.set(url, job);
  }
  return job;
}

/** `url`'s still: undefined until it is ready, null if there won't be one. Asks only while `enabled`. */
export function useVideoStill(url: string | undefined, enabled = true): Still | undefined {
  const [still, setStill] = React.useState<Still | undefined>(() => (url ? resolved.get(url) : undefined));
  React.useEffect(() => {
    if (!url || !enabled) return undefined;
    if (resolved.has(url)) { setStill(resolved.get(url)); return undefined; }
    setStill(undefined);
    let live = true;
    void videoStill(url).then((value) => { if (live) setStill(value); });
    return () => { live = false; };
  }, [url, enabled]);
  return url && resolved.has(url) ? resolved.get(url) : still;
}
