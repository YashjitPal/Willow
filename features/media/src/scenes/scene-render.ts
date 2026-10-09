// Renders a scene to an MP4 frame by frame, with WebCodecs.
//
// Every frame of every clip is decoded, placed at its exact time and encoded once, so the file is
// as smooth as its sources however busy the page is, and takes less time than the scene runs.
// Each clip keeps its own frame rate (a 24 fps clip stays 24 fps beside a 30 fps one; MP4 lets
// frame durations vary). A clip whose MP4 holds H.264 is decoded straight from the file; anything
// else (WebM, HEVC, a rotated phone video) is stepped through frame by frame on a <video>, which
// applies what the decoder alone would not. Audio is decoded from the files, cut to the trims, and
// laid at the same clip boundaries as the picture.
import { readMp4VideoTrack, type Mp4VideoTrack } from './mp4-read';
import { writeMp4, type MuxAudio, type MuxVideo } from './mp4-write';

export interface RenderClip {
  /** A URL the page can fetch: blob:, data: or same-origin. */
  url: string;
  trimStart: number;
  trimEnd: number;
}

const VIDEO_CODEC = 'avc1.640028';
const VIDEO_BITRATE = 8_000_000;
const AUDIO_CODEC = 'mp4a.40.2';
const AUDIO_BITRATE = 192_000;
const SAMPLE_RATE = 48_000;
const AAC_FRAME = 1024;
const KEYFRAME_SECONDS = 2;
/** For a source whose rate can't be read (the <video> path). */
const FALLBACK_FPS = 30;

export function canRenderScenes(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined'
    && typeof AudioEncoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

/** A run of frames for the encoder: each `draw` puts one picture on the frame it is given. */
type Emit = (source: CanvasImageSource | VideoFrame, width: number, height: number) => Promise<void>;

/** The frame rate of a track: from its median frame duration, snapped to the common rates. */
function frameRate(track: Mp4VideoTrack): number {
  const durations = track.samples.map((s) => s.duration).filter((d) => d > 0).sort((a, b) => a - b);
  if (!durations.length) return FALLBACK_FPS;
  const fps = 1 / durations[durations.length >> 1];
  for (const common of [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60]) if (Math.abs(fps - common) < 0.02 * common) return common;
  return Math.min(60, Math.max(1, Math.round(fps * 1000) / 1000));
}

/** Calls `emit` for the clip's frames, `count` of them at `fps`, decoding the MP4 with WebCodecs. */
async function decodeClip(buffer: ArrayBuffer, track: Mp4VideoTrack, clip: RenderClip, fps: number, count: number, emit: Emit): Promise<void> {
  const samples = track.samples;
  // From the last keyframe at or before the trim start (in decode order) to well past the end.
  const order = samples.map((s, i) => ({ s, i })).sort((a, b) => a.s.dts - b.s.dts);
  let first = 0;
  for (let k = 0; k < order.length; k += 1) if (order[k].s.key && order[k].s.pts <= clip.trimStart + 1e-3) first = k;
  const end = clip.trimEnd + 1;

  const ready: VideoFrame[] = [];
  let failure: Error | null = null;
  const decoder = new VideoDecoder({
    output: (frame) => { ready.push(frame); },
    error: (e) => { failure = e instanceof Error ? e : new Error(String(e)); },
  });
  decoder.configure({ codec: track.codec!, description: track.description ?? undefined, codedWidth: track.width, codedHeight: track.height });

  let next = 0;
  let held: VideoFrame | null = null;
  const timeOf = (j: number) => clip.trimStart + j / fps + 1e-4;
  /** Each target time goes to the frame showing then: the last whose start is not after it. */
  const take = async (frame: VideoFrame | null) => {
    const start = frame ? frame.timestamp / 1e6 : Infinity;
    if (held) {
      while (next < count && timeOf(next) < start) { await emit(held, held.displayWidth, held.displayHeight); next += 1; }
      held.close();
    }
    held = frame;
  };
  const drain = async () => {
    ready.sort((a, b) => a.timestamp - b.timestamp);
    while (ready.length) {
      const frame = ready.shift()!;
      if (frame.timestamp / 1e6 + 1e-3 < clip.trimStart && ready.length && ready[0].timestamp / 1e6 <= clip.trimStart + 1e-3) { frame.close(); continue; }
      await take(frame);
    }
  };
  try {
    for (let k = first; k < order.length && next < count; k += 1) {
      const { s } = order[k];
      if (s.dts > end && s.key) break;
      decoder.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.pts * 1e6), duration: Math.round(s.duration * 1e6), data: new Uint8Array(buffer, s.offset, s.size) }));
      // Keep a few frames in flight. Frames are handed on while waiting: a hardware decoder stops
      // when too many of its frames are held.
      while (decoder.decodeQueueSize > 4 && !failure) {
        if (ready.length) await drain();
        else await new Promise((r) => setTimeout(r, 0));
      }
      if (failure) throw failure;
      if (ready.length > 2) await drain();
    }
    let flushed = false;
    const flushing = decoder.flush().finally(() => { flushed = true; });
    while (!flushed && !failure) {
      if (ready.length) await drain();
      else await new Promise((r) => setTimeout(r, 0));
    }
    await flushing;
    if (failure) throw failure;
    await drain();
    await take(null);
    if (next < count) throw new Error('The clip ended before its trim.');
  } finally {
    for (const f of ready) f.close();
    if (decoder.state !== 'closed') decoder.close();
  }
}

/** The same, stepping a <video> to each frame's time. Slower; used when the file can't be read here. */
async function seekClip(url: string, clip: RenderClip, fps: number, count: number, emit: Emit): Promise<void> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  const once = (event: string) => new Promise<void>((resolve, reject) => {
    const ok = () => { video.removeEventListener('error', bad); resolve(); };
    const bad = () => { video.removeEventListener(event, ok); reject(new Error('A clip could not be loaded.')); };
    video.addEventListener(event, ok, { once: true });
    video.addEventListener('error', bad, { once: true });
  });
  try {
    await once('loadeddata');
    for (let j = 0; j < count; j += 1) {
      // The middle of the frame's interval, so rounding can't land on its neighbour.
      video.currentTime = Math.min(clip.trimStart + (j + 0.5) / fps, Math.max(0, video.duration - 1e-3));
      await once('seeked');
      await emit(video, video.videoWidth, video.videoHeight);
    }
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

/** The audio of every clip, cut to its trim and laid end to end at the picture's clip boundaries. */
async function sceneAudio(buffers: ArrayBuffer[], clips: RenderClip[], lengths: number[]): Promise<Float32Array[] | null> {
  const total = Math.round(lengths.reduce((a, b) => a + b, 0) * SAMPLE_RATE);
  const out = [new Float32Array(total), new Float32Array(total)];
  const ctx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
  let at = 0;
  let any = false;
  for (let i = 0; i < clips.length; i += 1) {
    const span = Math.round(lengths[i] * SAMPLE_RATE);
    try {
      const decoded = await ctx.decodeAudioData(buffers[i].slice(0));
      const from = Math.round(clips[i].trimStart * decoded.sampleRate);
      for (let c = 0; c < 2; c += 1) {
        const data = decoded.getChannelData(Math.min(c, decoded.numberOfChannels - 1));
        out[c].set(data.subarray(from, Math.min(data.length, from + span)), at);
      }
      any = true;
    } catch {
      // No audio track: the clip is silent.
    }
    at += span;
  }
  return any ? out : null;
}

async function encodeAudio(pcm: Float32Array[]): Promise<MuxAudio> {
  const chunks: MuxAudio['chunks'] = [];
  let description: Uint8Array | null = null;
  let failure: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? Math.round((AAC_FRAME / SAMPLE_RATE) * 1e6) });
      if (meta?.decoderConfig?.description && !description) description = new Uint8Array(meta.decoderConfig.description as ArrayBuffer);
    },
    error: (e) => { failure = e instanceof Error ? e : new Error(String(e)); },
  });
  encoder.configure({ codec: AUDIO_CODEC, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: AUDIO_BITRATE });
  try {
    for (let at = 0; at < pcm[0].length; at += AAC_FRAME) {
      const n = Math.min(AAC_FRAME, pcm[0].length - at);
      const planar = new Float32Array(n * 2);
      planar.set(pcm[0].subarray(at, at + n), 0);
      planar.set(pcm[1].subarray(at, at + n), n);
      const data = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / SAMPLE_RATE) * 1e6), data: planar });
      encoder.encode(data);
      data.close();
      if (encoder.encodeQueueSize > 32) await new Promise((r) => setTimeout(r, 0));
      if (failure) throw failure;
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (!description) throw new Error('The audio encoder gave no configuration.');
  return { sampleRate: SAMPLE_RATE, channels: 2, description, chunks };
}

/** The scene's clips as one MP4, `width` x `height`, each clip's picture cover-cropped to fill it. */
export async function renderScene(clips: RenderClip[], width: number, height: number): Promise<Blob> {
  const buffers = await Promise.all(clips.map(async (c) => (await fetch(c.url)).arrayBuffer()));
  const tracks = buffers.map((b) => { try { return readMp4VideoTrack(b); } catch { return null; } });
  const rates = tracks.map((t) => (t ? frameRate(t) : FALLBACK_FPS));
  const counts = clips.map((c, i) => Math.max(1, Math.round((c.trimEnd - c.trimStart) * rates[i])));
  const lengths = counts.map((n, i) => n / rates[i]);

  const chunks: MuxVideo['chunks'] = [];
  let description: Uint8Array | null = null;
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? 0, key: chunk.type === 'key' });
      if (meta?.decoderConfig?.description && !description) description = new Uint8Array(meta.decoderConfig.description as ArrayBuffer);
    },
    error: (e) => { failure = e instanceof Error ? e : new Error(String(e)); },
  });
  encoder.configure({ codec: VIDEO_CODEC, width, height, bitrate: VIDEO_BITRATE, framerate: Math.max(...rates), latencyMode: 'quality', avc: { format: 'avc' } });

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot export scenes.');
  let time = 0;
  let lastKey = -Infinity;
  try {
    for (let i = 0; i < clips.length; i += 1) {
      const fps = rates[i];
      let j = 0;
      const emit: Emit = async (source, sw, sh) => {
        const timestamp = Math.round((time + j / fps) * 1e6);
        const duration = Math.round((time + (j + 1) / fps) * 1e6) - timestamp;
        const key = timestamp / 1e6 - lastKey >= KEYFRAME_SECONDS - 1e-6;
        if (key) lastKey = timestamp / 1e6;
        let frame: VideoFrame;
        if (source instanceof VideoFrame && sw === width && sh === height) {
          // Already the output size: the decoded picture goes to the encoder as it is.
          frame = new VideoFrame(source, { timestamp, duration });
        } else {
          const scale = Math.max(width / sw, height / sh);
          const cw = width / scale;
          const ch = height / scale;
          ctx.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, width, height);
          frame = new VideoFrame(canvas, { timestamp, duration });
        }
        encoder.encode(frame, { keyFrame: key });
        frame.close();
        j += 1;
        while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
        if (failure) throw failure;
      };
      const track = tracks[i];
      if (track?.codec && !track.transformed && (await VideoDecoder.isConfigSupported({ codec: track.codec, description: track.description ?? undefined, codedWidth: track.width, codedHeight: track.height })).supported) {
        await decodeClip(buffers[i], track, clips[i], fps, counts[i], emit);
      } else {
        await seekClip(clips[i].url, clips[i], fps, counts[i], emit);
      }
      time += lengths[i];
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (!description) throw new Error('The video encoder gave no configuration.');

  const pcm = await sceneAudio(buffers, clips, lengths);
  const audio = pcm ? await encodeAudio(pcm) : null;
  return writeMp4({ width, height, description, chunks }, audio);
}
