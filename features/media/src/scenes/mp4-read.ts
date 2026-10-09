// Reads the video track of an MP4 well enough to decode it with WebCodecs: the codec, its
// configuration record, and every sample (where it sits in the file, its decode and presentation
// time, whether it is a keyframe). Progressive files (sample tables) and fragmented ones
// (moof/trun, as Chrome's MediaRecorder writes) both work. Times are in seconds, presentation
// times already shifted by the track's edit list — the same clock a <video>'s currentTime runs on.

export interface Mp4Sample {
  offset: number;
  size: number;
  dts: number;
  pts: number;
  duration: number;
  key: boolean;
}

export interface Mp4VideoTrack {
  /** WebCodecs codec string, e.g. avc1.64001f. Only H.264 tracks get one. */
  codec: string | null;
  format: string;
  description: Uint8Array | null;
  width: number;
  height: number;
  /** The track header's transform is not the identity: the picture is rotated or flipped. */
  transformed: boolean;
  samples: Mp4Sample[];
}

interface Box { type: string; start: number; end: number; body: number }

function readBoxes(view: DataView, start: number, end: number): Box[] {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = String.fromCharCode(view.getUint8(p + 4), view.getUint8(p + 5), view.getUint8(p + 6), view.getUint8(p + 7));
    let header = 8;
    if (size === 1) { size = Number(view.getBigUint64(p + 8)); header = 16; }
    else if (size === 0) size = end - p;
    if (size < header || p + size > end) break;
    out.push({ type, start: p, end: p + size, body: p + header });
    p += size;
  }
  return out;
}

export function readMp4VideoTrack(buffer: ArrayBuffer): Mp4VideoTrack | null {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const kids = (box: Box) => readBoxes(view, box.body, box.end);
  const kid = (box: Box | undefined, type: string) => (box ? kids(box).find((b) => b.type === type) : undefined);
  const full = (box: Box) => ({ version: view.getUint8(box.body), flags: view.getUint32(box.body) & 0xffffff, at: box.body + 4 });

  const top = readBoxes(view, 0, buffer.byteLength);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) return null;
  const trak = kids(moov).filter((b) => b.type === 'trak').find((t) => {
    const hdlr = kid(kid(t, 'mdia'), 'hdlr');
    return !!hdlr && String.fromCharCode(...bytes.subarray(hdlr.body + 8, hdlr.body + 12)) === 'vide';
  });
  if (!trak) return null;

  const tkhdBox = kid(trak, 'tkhd');
  if (!tkhdBox) return null;
  const tkhd = full(tkhdBox);
  const trackId = view.getUint32(tkhd.at + (tkhd.version === 1 ? 16 : 8));
  const matrixAt = tkhd.at + (tkhd.version === 1 ? 32 : 20) + 8 + 8;
  const matrix = Array.from({ length: 9 }, (_, i) => view.getInt32(matrixAt + i * 4));
  const transformed = !(matrix[0] === 0x10000 && matrix[1] === 0 && matrix[3] === 0 && matrix[4] === 0x10000);

  const mdia = kid(trak, 'mdia');
  const mdhdBox = kid(mdia, 'mdhd');
  const stbl = kid(kid(mdia, 'minf'), 'stbl');
  const stsdBox = kid(stbl, 'stsd');
  if (!mdhdBox || !stbl || !stsdBox) return null;
  const mdhd = full(mdhdBox);
  const timescale = view.getUint32(mdhd.at + (mdhd.version === 1 ? 16 : 8));

  const entry = readBoxes(view, full(stsdBox).at + 4, stsdBox.end)[0];
  if (!entry) return null;
  const track: Mp4VideoTrack = {
    codec: null,
    format: entry.type,
    description: null,
    width: view.getUint16(entry.body + 24),
    height: view.getUint16(entry.body + 26),
    transformed,
    samples: [],
  };
  const avcC = readBoxes(view, entry.body + 78, entry.end).find((b) => b.type === 'avcC');
  if ((entry.type === 'avc1' || entry.type === 'avc3') && avcC) {
    track.description = bytes.slice(avcC.body, avcC.end);
    track.codec = `avc1.${[1, 2, 3].map((i) => track.description![i].toString(16).padStart(2, '0')).join('')}`;
  }

  let editShift = 0;
  const elstBox = kid(kid(trak, 'edts'), 'elst');
  if (elstBox) {
    const elst = full(elstBox);
    if (view.getUint32(elst.at) > 0) {
      const mediaTime = elst.version === 1 ? Number(view.getBigInt64(elst.at + 12)) : view.getInt32(elst.at + 8);
      if (mediaTime > 0) editShift = mediaTime;
    }
  }
  const push = (offset: number, size: number, dts: number, cto: number, duration: number, key: boolean) => {
    track.samples.push({ offset, size, dts: dts / timescale, pts: (dts + cto - editShift) / timescale, duration: duration / timescale, key });
  };

  // Progressive: the sample tables.
  const stszBox = kid(stbl, 'stsz');
  const sizes: number[] = [];
  if (stszBox) {
    const { at } = full(stszBox);
    const fixed = view.getUint32(at);
    const count = view.getUint32(at + 4);
    for (let i = 0; i < count; i += 1) sizes.push(fixed || view.getUint32(at + 8 + i * 4));
  }
  if (sizes.length) {
    const deltas: number[] = [];
    const sttsBox = kid(stbl, 'stts');
    if (sttsBox) {
      const { at } = full(sttsBox);
      for (let i = 0, n = view.getUint32(at); i < n; i += 1) {
        const count = view.getUint32(at + 4 + i * 8);
        const delta = view.getUint32(at + 8 + i * 8);
        for (let k = 0; k < count; k += 1) deltas.push(delta);
      }
    }
    const offsets: number[] = [];
    const cttsBox = kid(stbl, 'ctts');
    if (cttsBox) {
      const { at, version } = full(cttsBox);
      for (let i = 0, n = view.getUint32(at); i < n; i += 1) {
        const count = view.getUint32(at + 4 + i * 8);
        const offset = version === 1 ? view.getInt32(at + 8 + i * 8) : view.getUint32(at + 8 + i * 8);
        for (let k = 0; k < count; k += 1) offsets.push(offset);
      }
    }
    const stssBox = kid(stbl, 'stss');
    const sync = new Set<number>();
    if (stssBox) {
      const { at } = full(stssBox);
      for (let i = 0, n = view.getUint32(at); i < n; i += 1) sync.add(view.getUint32(at + 4 + i * 4) - 1);
    }
    const chunkBox = kid(stbl, 'stco') ?? kid(stbl, 'co64');
    const chunks: number[] = [];
    if (chunkBox) {
      const { at } = full(chunkBox);
      for (let i = 0, n = view.getUint32(at); i < n; i += 1) {
        chunks.push(chunkBox.type === 'co64' ? Number(view.getBigUint64(at + 4 + i * 8)) : view.getUint32(at + 4 + i * 4));
      }
    }
    const runs: { first: number; per: number }[] = [];
    const stscBox = kid(stbl, 'stsc');
    if (stscBox) {
      const { at } = full(stscBox);
      for (let i = 0, n = view.getUint32(at); i < n; i += 1) runs.push({ first: view.getUint32(at + 4 + i * 12) - 1, per: view.getUint32(at + 8 + i * 12) });
    }
    let sample = 0;
    let dts = 0;
    let run = 0;
    for (let c = 0; c < chunks.length && sample < sizes.length; c += 1) {
      while (run + 1 < runs.length && runs[run + 1].first <= c) run += 1;
      let offset = chunks[c];
      for (let k = 0; k < (runs[run]?.per ?? 0) && sample < sizes.length; k += 1, sample += 1) {
        const delta = deltas[sample] ?? deltas[deltas.length - 1] ?? 0;
        push(offset, sizes[sample], dts, offsets[sample] ?? 0, delta, stssBox ? sync.has(sample) : true);
        offset += sizes[sample];
        dts += delta;
      }
    }
  }

  // Fragmented: each moof's runs for this track.
  const defaults = { duration: 0, size: 0, flags: 0 };
  const trex = kid(moov, 'mvex') ? kids(kid(moov, 'mvex')!).filter((b) => b.type === 'trex') : [];
  for (const t of trex) {
    const { at } = full(t);
    if (view.getUint32(at) !== trackId) continue;
    defaults.duration = view.getUint32(at + 8);
    defaults.size = view.getUint32(at + 12);
    defaults.flags = view.getUint32(at + 16);
  }
  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of kids(moof).filter((b) => b.type === 'traf')) {
      const tfhdBox = kid(traf, 'tfhd');
      if (!tfhdBox) continue;
      const tfhd = full(tfhdBox);
      if (view.getUint32(tfhd.at) !== trackId) continue;
      let p = tfhd.at + 4;
      let base = moof.start;
      const d = { ...defaults };
      if (tfhd.flags & 0x1) { base = Number(view.getBigUint64(p)); p += 8; }
      if (tfhd.flags & 0x2) p += 4;
      if (tfhd.flags & 0x8) { d.duration = view.getUint32(p); p += 4; }
      if (tfhd.flags & 0x10) { d.size = view.getUint32(p); p += 4; }
      if (tfhd.flags & 0x20) { d.flags = view.getUint32(p); p += 4; }
      let dts = 0;
      const tfdtBox = kid(traf, 'tfdt');
      if (tfdtBox) {
        const tfdt = full(tfdtBox);
        dts = tfdt.version === 1 ? Number(view.getBigUint64(tfdt.at)) : view.getUint32(tfdt.at);
      }
      for (const trunBox of kids(traf).filter((b) => b.type === 'trun')) {
        const trun = full(trunBox);
        let q = trun.at;
        const count = view.getUint32(q); q += 4;
        let dataOffset = 0;
        if (trun.flags & 0x1) { dataOffset = view.getInt32(q); q += 4; }
        let firstFlags: number | null = null;
        if (trun.flags & 0x4) { firstFlags = view.getUint32(q); q += 4; }
        let offset = base + dataOffset;
        for (let i = 0; i < count; i += 1) {
          const duration = trun.flags & 0x100 ? view.getUint32(q) : d.duration; if (trun.flags & 0x100) q += 4;
          const size = trun.flags & 0x200 ? view.getUint32(q) : d.size; if (trun.flags & 0x200) q += 4;
          let flags = trun.flags & 0x400 ? view.getUint32(q) : d.flags; if (trun.flags & 0x400) q += 4;
          if (i === 0 && firstFlags !== null) flags = firstFlags;
          const cto = trun.flags & 0x800 ? (trun.version === 1 ? view.getInt32(q) : view.getUint32(q)) : 0; if (trun.flags & 0x800) q += 4;
          // sample_is_non_sync_sample is bit 16 of the sample flags.
          push(offset, size, dts, cto, duration, !((flags >>> 16) & 0x1));
          offset += size;
          dts += duration;
        }
      }
    }
  }
  return track.samples.length ? track : null;
}
