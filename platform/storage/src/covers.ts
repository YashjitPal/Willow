/**
 * Cover utilities.
 *
 * Project covers in Willow are always STILL IMAGES (so the studio shows a
 * static thumbnail, never an autoplaying video). When a cover is sourced from a
 * video — the first generated item, a "Set as cover" on a video, or a disk
 * cover.mp4 — we grab a single frame and use that PNG as the cover (saved to
 * IndexedDB and as cover.png on disk).
 */

/**
 * Extract a still frame from a video as a PNG data URL.
 *
 * Loads the video off-DOM via a blob object URL (so the canvas isn't tainted and
 * `toDataURL` won't throw), seeks slightly past the start to avoid a black first
 * frame, and draws that frame to a canvas. Returns null on any failure/timeout
 * so callers can fall back gracefully.
 *
 * Accepts a URL/data-URL string OR a Blob/File (e.g. a disk video file).
 */
export async function extractVideoFrame(src: string | Blob): Promise<string | null> {
  let blob: Blob;
  try {
    blob = typeof src === 'string' ? await fetch(src).then((r) => r.blob()) : src;
  } catch {
    return null;
  }

  const objectUrl = URL.createObjectURL(blob);

  return new Promise<string | null>((resolve) => {
    const video = document.createElement('video');
    let settled = false;

    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      try {
        video.removeAttribute('src');
        video.load();
      } catch {}
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };

    const drawFrame = () => {
      try {
        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 720;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return finish(null);
        ctx.drawImage(video, 0, 0, w, h);
        finish(canvas.toDataURL('image/png'));
      } catch {
        finish(null);
      }
    };

    video.muted = true;
    (video as any).playsInline = true;
    video.preload = 'auto';
    video.onloadeddata = () => {
      // Seek a touch past the start to avoid a black/blank first frame.
      const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
      const t = Math.min(0.1, dur / 2);
      try {
        video.currentTime = t;
      } catch {
        drawFrame();
      }
    };
    video.onseeked = () => drawFrame();
    video.onerror = () => finish(null);
    // Safety net in case the video never loads/seeks.
    setTimeout(() => finish(null), 10000);

    video.src = objectUrl;
  });
}

/**
 * Resolve a media source into a still IMAGE data URL suitable for a cover.
 * Videos become a captured frame; images pass through unchanged. Returns null
 * only if a video frame couldn't be captured (caller decides the fallback).
 */
export async function toCoverImage(src: string, isVideo: boolean): Promise<string | null> {
  if (!src) return null;
  if (!isVideo) return src;
  return await extractVideoFrame(src);
}
