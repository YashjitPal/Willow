// Writes an MP4 from encoded WebCodecs chunks: one H.264 video track, optionally one AAC audio
// track. Progressive, with the index (moov) ahead of the media so a player can start and seek
// at once, and the two tracks interleaved in chunks of about a second.

export interface MuxVideo {
  width: number;
  height: number;
  /** The encoder's decoderConfig.description: the avcC record. */
  description: Uint8Array;
  /** In decode order, as the encoder emitted them. Timestamps and durations in microseconds. */
  chunks: { data: Uint8Array; timestamp: number; duration: number; key: boolean }[];
}

export interface MuxAudio {
  sampleRate: number;
  channels: number;
  /** The encoder's decoderConfig.description: the AudioSpecificConfig. */
  description: Uint8Array;
  chunks: { data: Uint8Array; timestamp: number; duration: number }[];
}

const VIDEO_TIMESCALE = 90_000;
const MOVIE_TIMESCALE = 1000;
const CHUNK_SECONDS = 1;

const u8 = (...values: number[]) => Uint8Array.from(values);
const u16 = (v: number) => u8((v >>> 8) & 0xff, v & 0xff);
const u32 = (v: number) => u8((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
const i32 = (v: number) => u32(v >>> 0);
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  return concat([u32(body.length + 8), ascii(type), body]);
}
const fullBox = (type: string, version: number, flags: number, ...parts: Uint8Array[]) =>
  box(type, u8(version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff), ...parts);

const MATRIX = concat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);

/** Run-length entries [count, value] of a list. */
function runs(values: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const v of values) {
    const last = out[out.length - 1];
    if (last && last[1] === v) last[0] += 1;
    else out.push([1, v]);
  }
  return out;
}

interface TrackLayout {
  timescale: number;
  sizes: number[];
  durations: number[];
  /** Presentation minus decode time, per sample (video with reordering only). */
  offsets: number[] | null;
  keys: number[] | null;
  /** Samples per chunk, in order; chunk offsets are filled in once the moov's size is known. */
  chunkSamples: number[];
  duration: number;
}

function sampleTable(t: TrackLayout, chunkOffsets: number[], sampleEntry: Uint8Array): Uint8Array {
  const stts = runs(t.durations);
  const stsc: [number, number][] = [];
  t.chunkSamples.forEach((n, i) => { if (!stsc.length || stsc[stsc.length - 1][1] !== n) stsc.push([i + 1, n]); });
  const parts = [
    fullBox('stsd', 0, 0, u32(1), sampleEntry),
    fullBox('stts', 0, 0, u32(stts.length), ...stts.map(([c, d]) => concat([u32(c), u32(d)]))),
  ];
  if (t.offsets) {
    const ctts = runs(t.offsets);
    parts.push(fullBox('ctts', 1, 0, u32(ctts.length), ...ctts.map(([c, o]) => concat([u32(c), i32(o)]))));
  }
  if (t.keys) parts.push(fullBox('stss', 0, 0, u32(t.keys.length), ...t.keys.map((k) => u32(k))));
  parts.push(
    fullBox('stsc', 0, 0, u32(stsc.length), ...stsc.map(([first, n]) => concat([u32(first), u32(n), u32(1)]))),
    fullBox('stsz', 0, 0, u32(0), u32(t.sizes.length), ...t.sizes.map((s) => u32(s))),
    fullBox('stco', 0, 0, u32(chunkOffsets.length), ...chunkOffsets.map((o) => u32(o))),
  );
  return box('stbl', ...parts);
}

function trak(id: number, t: TrackLayout, chunkOffsets: number[], kind: 'video' | 'audio', sampleEntry: Uint8Array, width = 0, height = 0): Uint8Array {
  const movieDuration = Math.round((t.duration / t.timescale) * MOVIE_TIMESCALE);
  const tkhd = fullBox('tkhd', 0, 0x3,
    u32(0), u32(0), u32(id), u32(0), u32(movieDuration),
    u32(0), u32(0),
    u16(0), u16(kind === 'audio' ? 1 : 0), u16(kind === 'audio' ? 0x0100 : 0), u16(0),
    MATRIX,
    u32(width << 16), u32(height << 16));
  const mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(t.timescale), u32(t.duration), u16(0x55c4), u16(0));
  const hdlr = fullBox('hdlr', 0, 0, u32(0), ascii(kind === 'video' ? 'vide' : 'soun'), u32(0), u32(0), u32(0), ascii(kind === 'video' ? 'VideoHandler\0' : 'SoundHandler\0'));
  const header = kind === 'video' ? fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)) : fullBox('smhd', 0, 0, u16(0), u16(0));
  const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
  return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', header, dinf, sampleTable(t, chunkOffsets, sampleEntry))));
}

function avc1(v: MuxVideo): Uint8Array {
  return box('avc1',
    u8(0, 0, 0, 0, 0, 0), u16(1),
    u16(0), u16(0), u32(0), u32(0), u32(0),
    u16(v.width), u16(v.height),
    u32(0x00480000), u32(0x00480000), u32(0), u16(1),
    new Uint8Array(32), u16(0x0018), u16(0xffff),
    box('avcC', v.description));
}

/** An MPEG-4 descriptor: tag, then the length in the four-byte form every reader accepts. */
function descriptor(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  const n = body.length;
  return concat([u8(tag, 0x80 | ((n >>> 21) & 0x7f), 0x80 | ((n >>> 14) & 0x7f), 0x80 | ((n >>> 7) & 0x7f), n & 0x7f), body]);
}

function mp4a(a: MuxAudio, bitrate: number): Uint8Array {
  const esds = fullBox('esds', 0, 0, descriptor(0x03, u16(2), u8(0),
    descriptor(0x04, u8(0x40, 0x15), u8(0, 0, 0), u32(bitrate), u32(bitrate), descriptor(0x05, a.description)),
    descriptor(0x06, u8(0x02))));
  return box('mp4a',
    u8(0, 0, 0, 0, 0, 0), u16(1),
    u32(0), u32(0),
    u16(a.channels), u16(16), u16(0), u16(0),
    u32(a.sampleRate << 16),
    esds);
}

/** The MP4 file for `video` (and `audio`), as a Blob. */
export function writeMp4(video: MuxVideo, audio: MuxAudio | null): Blob {
  // Video: decode order is the order the encoder gave; presentation times are its timestamps.
  const vTicks = (us: number) => Math.round((us * VIDEO_TIMESCALE) / 1e6);
  const vPts = video.chunks.map((c) => vTicks(c.timestamp));
  const sortedPts = [...vPts].sort((a, b) => a - b);
  // Decode times are the presentation times in order, so dts <= pts for every sample.
  const vDts = sortedPts.map((t) => t - sortedPts[0]);
  const vDur = vDts.map((t, i) => (i + 1 < vDts.length ? vDts[i + 1] - t : vTicks(video.chunks[i].duration)));
  const reordered = vPts.some((t, i) => t - sortedPts[0] !== vDts[i]);
  const videoLayout: TrackLayout = {
    timescale: VIDEO_TIMESCALE,
    sizes: video.chunks.map((c) => c.data.length),
    durations: vDur,
    offsets: reordered ? vPts.map((t, i) => t - sortedPts[0] - vDts[i]) : null,
    keys: video.chunks.flatMap((c, i) => (c.key ? [i + 1] : [])),
    chunkSamples: [],
    duration: vDur.reduce((a, b) => a + b, 0),
  };
  const aRate = audio?.sampleRate ?? 48000;
  const aTicks = (us: number) => Math.round((us * aRate) / 1e6);
  const audioLayout: TrackLayout | null = audio ? {
    timescale: aRate,
    sizes: audio.chunks.map((c) => c.data.length),
    durations: audio.chunks.map((c) => aTicks(c.duration)),
    offsets: null,
    keys: null,
    chunkSamples: [],
    duration: audio.chunks.reduce((n, c) => n + aTicks(c.duration), 0),
  } : null;

  // Interleave: one chunk of each track per second of presentation, video first.
  const media: { track: 'v' | 'a'; data: Uint8Array }[][] = [];
  let vi = 0;
  let ai = 0;
  for (let second = 0; vi < video.chunks.length || (audio && ai < audio.chunks.length); second += CHUNK_SECONDS) {
    const limit = (second + CHUNK_SECONDS) * 1e6;
    const vPart: Uint8Array[] = [];
    while (vi < video.chunks.length && (vDts[vi] * 1e6) / VIDEO_TIMESCALE < limit) vPart.push(video.chunks[vi++].data);
    if (vPart.length) { videoLayout.chunkSamples.push(vPart.length); media.push(vPart.map((data) => ({ track: 'v', data }))); }
    if (audio && audioLayout) {
      const aPart: Uint8Array[] = [];
      while (ai < audio.chunks.length && audio.chunks[ai].timestamp < limit) aPart.push(audio.chunks[ai++].data);
      if (aPart.length) { audioLayout.chunkSamples.push(aPart.length); media.push(aPart.map((data) => ({ track: 'a', data }))); }
    }
  }

  const bitrate = audio ? Math.round((audio.chunks.reduce((n, c) => n + c.data.length, 0) * 8) / Math.max(1e-3, audio.chunks.reduce((n, c) => n + c.duration, 0) / 1e6)) : 0;
  const ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
  const moov = (vOffsets: number[], aOffsets: number[]) => {
    const movieDuration = Math.round((videoLayout.duration / VIDEO_TIMESCALE) * MOVIE_TIMESCALE);
    const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(MOVIE_TIMESCALE), u32(movieDuration),
      u32(0x10000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, new Uint8Array(24), u32(audio ? 3 : 2));
    const tracks = [trak(1, videoLayout, vOffsets, 'video', avc1(video), video.width, video.height)];
    if (audio && audioLayout) tracks.push(trak(2, audioLayout, aOffsets, 'audio', mp4a(audio, bitrate)));
    return box('moov', mvhd, ...tracks);
  };
  // The moov's size doesn't depend on the offsets' values, only on how many there are.
  const moovSize = moov(videoLayout.chunkSamples.map(() => 0), (audioLayout?.chunkSamples ?? []).map(() => 0)).length;
  const mediaBytes = media.reduce((n, chunk) => n + chunk.reduce((m, s) => m + s.data.length, 0), 0);
  const mdatHeader = mediaBytes + 8 > 0xffffffff ? concat([u32(1), ascii('mdat'), u32(Math.floor((mediaBytes + 16) / 2 ** 32)), u32((mediaBytes + 16) >>> 0)]) : concat([u32(mediaBytes + 8), ascii('mdat')]);
  let at = ftyp.length + moovSize + mdatHeader.length;
  const vOffsets: number[] = [];
  const aOffsets: number[] = [];
  for (const chunk of media) {
    (chunk[0].track === 'v' ? vOffsets : aOffsets).push(at);
    at += chunk.reduce((n, s) => n + s.data.length, 0);
  }
  return new Blob([ftyp, moov(vOffsets, aOffsets), mdatHeader, ...media.flatMap((chunk) => chunk.map((s) => s.data))], { type: 'video/mp4' });
}
