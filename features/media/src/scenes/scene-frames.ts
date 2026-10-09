// Still frames from gallery videos, for scene tiles, filmstrips, posters and Save frame.
//
// Flow draws these client-side too: its timeline thumbnails are `data:image/jpeg` URLs, and a
// freshly reordered clip shows its first frame repeated until the real frames land.
//
// One hidden <video> per source does all the seeking for that source, one seek at a time —
// eight filmstrip frames from one clip is eight seeks on one element, not eight decoders.

interface Grabber {
  url: string;
  video: HTMLVideoElement;
  ready: Promise<void>;
  queue: Promise<unknown>;
  lastUsed: number;
  /** Jobs queued on it that haven't settled; a busy grabber is never evicted. */
  busy: number;
  releaseTimer?: number;
}

const MAX_GRABBERS = 6;
/**
 * An idle grabber lets its <video> go after this long. Kept, they count among the page's idle
 * players, and past eight of those Chrome suspends every one, the Scenebuilder's parked clips too.
 */
const GRABBER_IDLE_MS = 4000;
/** A video that has neither loaded nor failed by then is treated as failed, so no caller waits forever. */
const READY_TIMEOUT_MS = 20_000;
const grabbers = new Map<string, Grabber>();
const frameCache = new Map<string, Promise<string>>();
/** The frames `frameCache` has finished, readable without waiting: a remounted strip draws them at once. */
const settledFrames = new Map<string, string>();
const MAX_CACHED_FRAMES = 400;

const frameKey = (url: string, time: number, maxWidth: number): string => `${url.length}:${url.slice(-48)}@${time.toFixed(2)}@${maxWidth}`;

/** A frame `captureFrame` has already made, or undefined. */
export const capturedFrame = (url: string, time: number, maxWidth = 320): string | undefined =>
  settledFrames.get(frameKey(url, time, maxWidth));

function createGrabber(url: string): Grabber {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  if (/^https?:/i.test(url)) video.crossOrigin = 'anonymous';
  const ready = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => done(new Error(`Timed out loading video for frames: ${url.slice(0, 60)}`)), READY_TIMEOUT_MS);
    const ok = () => done();
    const fail = () => done(new Error(`Could not load video for frames: ${url.slice(0, 60)}`));
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
  ready.catch(() => undefined);
  video.src = url;
  return { url, video, ready, queue: Promise.resolve(), lastUsed: Date.now(), busy: 0 };
}

function release(g: Grabber): void {
  window.clearTimeout(g.releaseTimer);
  g.video.removeAttribute('src');
  g.video.load();
  if (grabbers.get(g.url) === g) grabbers.delete(g.url);
}

function grabberFor(url: string): Grabber {
  let g = grabbers.get(url);
  if (!g) {
    if (grabbers.size >= MAX_GRABBERS) {
      // An element losing its source mid-load fires neither 'loadeddata' nor 'error', so only an idle
      // grabber goes; with none idle the cap gives way until one is.
      const idle = [...grabbers.entries()].filter(([, x]) => x.busy === 0).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (idle) release(idle[1]);
    }
    g = createGrabber(url);
    grabbers.set(url, g);
  }
  g.lastUsed = Date.now();
  return g;
}

/** Runs `job` on the grabber's queue, one at a time, keeping the grabber busy until it settles. */
function enqueue<T>(g: Grabber, job: () => Promise<T>): Promise<T> {
  g.busy += 1;
  window.clearTimeout(g.releaseTimer);
  const run = g.queue.then(job);
  const settled = run.finally(() => {
    g.busy -= 1;
    if (g.busy === 0) g.releaseTimer = window.setTimeout(() => { if (g.busy === 0) release(g); }, GRABBER_IDLE_MS);
  });
  g.queue = settled.catch(() => undefined);
  return run;
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) {
      resolve();
      return;
    }
    const timer = window.setTimeout(done, 4000);
    function done() {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', done);
      resolve();
    }
    video.addEventListener('seeked', done);
    video.currentTime = time;
  });
}

function drawFrame(video: HTMLVideoElement, maxWidth: number): string {
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const scale = Math.min(1, maxWidth / vw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(vw * scale));
  canvas.height = Math.max(1, Math.round(vh * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context for frame capture');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** A JPEG data URL of the frame at `time` seconds, at most `maxWidth` px wide. Cached. */
export function captureFrame(url: string, time: number, maxWidth = 320): Promise<string> {
  const key = frameKey(url, time, maxWidth);
  const hit = frameCache.get(key);
  if (hit) return hit;
  const g = grabberFor(url);
  const job = enqueue(g, async () => {
    await g.ready;
    const duration = Number.isFinite(g.video.duration) ? g.video.duration : time;
    await seek(g.video, Math.min(Math.max(0, time), Math.max(0, duration - 0.04)));
    g.lastUsed = Date.now();
    return drawFrame(g.video, maxWidth);
  });
  frameCache.set(key, job);
  job.then((frame) => { if (frameCache.get(key) === job) settledFrames.set(key, frame); }, () => frameCache.delete(key));
  if (frameCache.size > MAX_CACHED_FRAMES) {
    const first = frameCache.keys().next().value;
    if (first !== undefined) {
      frameCache.delete(first);
      settledFrames.delete(first);
    }
  }
  return job;
}

/** Duration and natural size of a video, without keeping it open. */
export async function probeVideo(url: string): Promise<{ duration: number; width: number; height: number }> {
  const g = grabberFor(url);
  return enqueue(g, async () => {
    await g.ready;
    const v = g.video;
    let duration = v.duration;
    if (!Number.isFinite(duration)) {
      // MediaRecorder output reports Infinity until it has been seeked past its end once.
      await seek(v, 1e7);
      duration = v.duration;
      await seek(v, 0);
    }
    return { duration: Number.isFinite(duration) ? duration : 8, width: v.videoWidth, height: v.videoHeight };
  });
}

/** The full-size frame at `time`, as a PNG data URL — what Save frame stores. */
export async function captureFullFrame(url: string, time: number): Promise<{ dataUrl: string; width: number; height: number }> {
  const g = grabberFor(url);
  return enqueue(g, async () => {
    await g.ready;
    const duration = Number.isFinite(g.video.duration) ? g.video.duration : time;
    await seek(g.video, Math.min(Math.max(0, time), Math.max(0, duration - 0.04)));
    const canvas = document.createElement('canvas');
    canvas.width = g.video.videoWidth || 1280;
    canvas.height = g.video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context for frame capture');
    ctx.drawImage(g.video, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  });
}
