// Download scene: one file for the whole timeline, trims applied.
//
// Flow renders this on its servers behind an "Exporting your scene…" snackbar. Willow renders it
// in the page, frame by frame with WebCodecs (scene-render.ts), so every source frame lands once at
// its exact time whatever else the page is doing. Without WebCodecs — or if rendering fails — the
// scene is played through onto a canvas and recorded instead, which takes as long as it runs and
// is only as smooth as playback was. A scene that is a single untrimmed clip skips all of that and
// hands back the clip's own file.
import { clipDuration } from './scene-format';
import { canRenderScenes, renderScene } from './scene-render';
import { dismissSnack, showSnack, updateSnack, type Scene, type SceneClip } from './scene-store';
import { toPlayableUrl } from './scene-media-url';

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '').trim() || 'Scene';

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * MP4 first: Chrome records it with a real duration in the header, where its WebM leaves the
 * duration unknown (players then show no length and can't seek). Flow hands back MP4 as well.
 */
const RECORDING_TYPES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const exporting = new Set<string>();

/** A hidden tab stops painting, so the recording waits rather than capturing frozen frames. */
function whenVisible(): Promise<void> {
  if (document.visibilityState !== 'hidden') return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState === 'hidden') return;
      document.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

export const isExporting = (sceneId: string): boolean => exporting.has(sceneId);

function waitFor(el: HTMLMediaElement, event: string, ms = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${event}`)); }, ms);
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('A clip could not be loaded.')); };
    const cleanup = () => {
      window.clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener('error', fail);
    };
    el.addEventListener(event, ok);
    el.addEventListener('error', fail);
  });
}

/**
 * Exports `scene`. `resolveUrl` maps a clip's media id to its file. Resolves when the download
 * has been handed to the browser; rejects (after showing an error snackbar) on failure.
 */
export async function exportScene(scene: Scene, resolveUrl: (mediaId: string) => string | undefined, onChange?: () => void): Promise<void> {
  if (exporting.has(scene.id)) return;
  const clips = scene.clips.filter((c) => clipDuration(c) > 0);
  if (!clips.length) return;
  exporting.add(scene.id);
  onChange?.();
  const snackId = showSnack({ icon: 'spinner', text: 'Exporting your scene…', actions: [{ label: 'Dismiss' }] });
  try {
    const sources = clips.map((c) => resolveUrl(c.mediaId));
    if (sources.some((s) => !s)) throw new Error('A clip in this scene no longer has a file.');

    const only = clips.length === 1 ? clips[0] : null;
    if (only && only.trimStart < 0.05 && only.trimEnd > only.sourceDuration - 0.05) {
      const blob = await (await fetch(sources[0] as string)).blob();
      const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
      download(blob, `${safeName(scene.name)}.${ext}`);
      dismissSnack(snackId);
      return;
    }

    const [w, h] = scene.aspectRatio === '9:16' ? [720, 1280] : [1280, 720];
    if (canRenderScenes()) {
      try {
        const urls = await Promise.all(sources.map((s) => toPlayableUrl(s as string)));
        const blob = await renderScene(clips.map((c, i) => ({ url: urls[i], trimStart: c.trimStart, trimEnd: c.trimEnd })), w, h);
        download(blob, `${safeName(scene.name)}.mp4`);
        dismissSnack(snackId);
        return;
      } catch (error) {
        console.warn('[scene-export] Rendering failed; recording the scene instead.', error);
      }
    }
    await recordScene(scene.name, clips, sources as string[], w, h);
    dismissSnack(snackId);
  } catch (error) {
    updateSnack(snackId, {
      icon: 'error',
      tone: 'error',
      text: error instanceof Error ? error.message : 'The scene could not be exported.',
      actions: [{ label: 'Dismiss' }],
    });
    throw error;
  } finally {
    exporting.delete(scene.id);
    onChange?.();
  }
}

/** The fallback: plays the scene through once onto a canvas and records it. */
async function recordScene(name: string, clips: SceneClip[], sources: string[], w: number, h: number): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot export scenes.');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  const audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => undefined);
  const dest = audioCtx.createMediaStreamDestination();
  audioCtx.createMediaElementSource(video).connect(dest);

  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mimeType = RECORDING_TYPES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  // The recorder runs only while a clip is actually playing: it pauses while the next clip
  // loads (or a gap of frozen frames would be recorded) and while the tab is hidden.
  let playing = false;
  const record = () => {
    if (recorder.state === 'inactive') recorder.start(250);
    else if (recorder.state === 'paused') recorder.resume();
  };
  const hold = () => { if (recorder.state === 'recording') recorder.pause(); };
  const onVisibility = () => {
    if (!playing) return;
    if (document.visibilityState === 'hidden') { video.pause(); hold(); }
    else { void video.play().then(record).catch(() => undefined); }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const draw = () => {
    const vw = video.videoWidth || w;
    const vh = video.videoHeight || h;
    const scale = Math.max(w / vw, h / vh);
    const sw = w / scale;
    const sh = h / scale;
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
  };

  try {
    for (let i = 0; i < clips.length; i += 1) {
      const clip = clips[i];
      playing = false;
      hold();
      video.src = await toPlayableUrl(sources[i]);
      await waitFor(video, 'loadeddata');
      video.currentTime = clip.trimStart;
      await waitFor(video, 'seeked');
      draw();
      await whenVisible();
      await video.play();
      record();
      playing = true;
      if (document.visibilityState === 'hidden') onVisibility();
      await new Promise<void>((resolve) => {
        const tick = () => {
          draw();
          if (video.ended || video.currentTime >= clip.trimEnd - 0.02) { video.pause(); resolve(); return; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }
  } catch (error) {
    if (recorder.state !== 'inactive') recorder.stop();
    void audioCtx.close();
    video.removeAttribute('src');
    throw error;
  } finally {
    playing = false;
    document.removeEventListener('visibilitychange', onVisibility);
  }
  recorder.stop();
  await stopped;
  void audioCtx.close();
  video.removeAttribute('src');
  const type = (recorder.mimeType || mimeType || 'video/webm').split(';')[0];
  download(new Blob(chunks, { type }), `${safeName(name)}.${type === 'video/mp4' ? 'mp4' : 'webm'}`);
}
