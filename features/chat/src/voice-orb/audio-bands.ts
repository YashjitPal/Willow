/**
 * The assistant-audio band reader, transcribed from the shipped implementation.
 *
 * Recovered from `conversation-small-ili7uvemamkqaklg.js`, which was located by
 * searching the bundle set for `getByteFrequencyData`/`createAnalyser` — the two
 * calls minification cannot rename. Chasing the minified symbols themselves does
 * not work: they are per-chunk and recycled (`vRe` is lodash's DataView guard in
 * one bundle and a markdown tokenizer in another), and the eight names on this
 * path all turned out to be re-exports whose targets collided too.
 *
 * The chain, in order, with the shipped identifiers kept in the comments so this
 * can be diffed against the source if the upstream visual ever changes:
 *
 *   l5i  read 240 raw magnitudes from the spectrum
 *   m5i  decibels → linear
 *   b5i  fold those into 3 log-spaced bands with per-band gains
 *   y5i  the fold itself: median → abs → gain → x/(x+1)
 *   j5i  per-frame smoothing and cumulative accumulation
 *
 * What Willow had before this read three *contiguous linear* bands of plain mean
 * off `getByteFrequencyData`, with no gains, no median and no compression. That
 * is why the orb barely moved while the assistant spoke: the band the motion
 * model weights most heavily is supposed to be 20–212 Hz with a ×10 gain, and it
 * was instead the unweighted mean of everything up to 3125 Hz — speech energy
 * spread over a hundred times the intended bandwidth, diluted to nothing.
 */

import {
  ASSISTANT_BAND_CONFIG,
  AUDIO_FPS_SCALE,
  AUDIO_GAIN,
  AUDIO_TIME_CONSTANT_SECONDS,
  BAND_DECIBEL_CEILING,
  BAND_DECIBEL_FLOOR,
  CUMULATIVE_AUDIO_GAIN,
  CUMULATIVE_AUDIO_TIME_CONSTANT_SECONDS,
  CUMULATIVE_RAW_BAND_COUNT,
} from './horizon-constants';

/**
 * Decibels → linear, per entry. Shipped as `m5i`.
 *
 * `-Infinity` is digital silence and resolves to 0 rather than to the floor.
 * Everything else is clamped into the decibel window, mapped linearly onto 0..1
 * and square-rooted, so a full-scale -10 dB entry reads 0.9487, not 1.
 */
export const decibelToLinear = (value: number): number => {
  if (value === -Infinity) return 0;
  const clamped = Math.max(BAND_DECIBEL_FLOOR, Math.min(BAND_DECIBEL_CEILING, value));
  return Math.sqrt(1 + clamped / 100);
};

/** Median of a slice. Even lengths take the mean of the two middle values. */
const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/**
 * The gained median fold. Shipped as `y5i`.
 *
 * `x / (x + 1)` is a soft compressor: it is near-linear for small inputs and
 * asymptotic to 1, which is what lets the ×10 gain on the low band lift quiet
 * speech without the loud parts clipping to a flat 1.
 */
export const foldBand = (magnitudes: number[], gainMultiplier: number): number => {
  const gained = Math.abs(median(magnitudes)) * gainMultiplier;
  return gained / (gained + 1);
};

/**
 * The three log-spaced band edges, in Hz. Shipped as the `u` table inside `b5i`.
 *
 * `u[k] = 20 * (nyquist / 20) ^ (k / bandCount)` — a geometric split of 20 Hz to
 * Nyquist, so each band spans the same ratio rather than the same width. At the
 * reference 48 kHz this is 20, 212.53, 2258.49, 24000.
 */
export const bandEdgeFrequencies = (sampleRate: number, bandCount: number): number[] => {
  const nyquist = sampleRate / 2;
  const edges: number[] = [];
  for (let k = 0; k <= bandCount; k += 1) {
    edges.push(20 * (nyquist / 20) ** (k / bandCount));
  }
  return edges;
};

/**
 * Which of the 240 entries each band draws from.
 *
 * Upstream derives the entry spacing as `sampleRate / (length * 2)`, i.e. it
 * assumes the 240 entries span 0..Nyquist. They do not — they are folded from
 * bins 0..400, which at 48 kHz with `fftSize` 2048 is 0..9375 Hz, so the true
 * spacing is 39.06 Hz and not the 100 Hz this computes. That mislabelling is
 * upstream's, it is what ships, and it is what the visual was tuned against, so
 * it is reproduced rather than corrected.
 *
 * Because both the spacing and the edges come from the same reference rate and
 * the entry count is fixed at 240, the partition is a constant — it does not
 * depend on the local analyser at all. It works out as entries 1–2, 3–22 and
 * 23–239; entry 0 sits below the 20 Hz edge and is used by no band, as upstream
 * leaves it.
 */
export const bandEntryRanges = (
  entryCount = CUMULATIVE_RAW_BAND_COUNT,
  sampleRate: number = ASSISTANT_BAND_CONFIG.sampleRate,
  bandCount: number = ASSISTANT_BAND_CONFIG.bands,
): Array<{ start: number; end: number }> => {
  const hzPerEntry = sampleRate / (entryCount * 2);
  const edges = bandEdgeFrequencies(sampleRate, bandCount);
  const ranges = Array.from({ length: bandCount }, () => ({ start: -1, end: -1 }));

  for (let entry = 0; entry < entryCount; entry += 1) {
    const frequency = entry * hzPerEntry;
    for (let band = 0; band < bandCount; band += 1) {
      if (frequency < edges[band] || frequency >= edges[band + 1]) continue;
      if (ranges[band].start === -1) ranges[band].start = entry;
      ranges[band].end = entry + 1;
      break;
    }
  }

  return ranges.map(({ start, end }) => (start === -1 ? { start: 0, end: 0 } : { start, end }));
};

/**
 * Fold a spectrum into the 240 raw magnitudes the band split consumes.
 *
 * Shipped as `l5i`: take bins `[minBin, maxBin)`, convert each to linear, then
 * average them into `entryCount` contiguous chunks of `ceil(span / entryCount)`.
 *
 * Two details are load-bearing and easy to "improve" by mistake:
 *
 *   - the decibel conversion happens per bin, *before* the chunk mean. Averaging
 *     decibels and converting afterwards is a different number entirely.
 *   - each chunk sum is divided by the nominal chunk size, not by how many bins
 *     actually landed in it. Upstream's 400 bins over 240 chunks of 2 reach only
 *     to entry 199, so entries 200-239 are permanently 0 and the log-spaced split
 *     above treats them as a silent top end. Dividing by the real count would
 *     leave the same entries 0 here but would change any partial chunk, so the
 *     nominal divisor is what is transcribed.
 *
 * Willow's playback analyser lands on the same partition rather than by luck: at
 * 24 kHz its 9375 Hz band is 800 bins, and 800 over 240 chunks of 4 also reaches
 * entry 199 — and 4 bins of 11.72 Hz is the same 46.875 Hz per entry as
 * upstream's 2 bins of 23.44 Hz. Entry for entry, the two cover identical
 * frequencies.
 */
export const readRawMagnitudes = (
  decibels: Float32Array,
  minBin: number,
  maxBin: number,
  entryCount = CUMULATIVE_RAW_BAND_COUNT,
): number[] => {
  const end = Math.min(maxBin, decibels.length);
  const span = Math.max(0, end - minBin);
  const chunk = Math.max(1, Math.ceil(span / entryCount));
  const out: number[] = new Array(entryCount);

  for (let entry = 0; entry < entryCount; entry += 1) {
    const from = minBin + entry * chunk;
    const to = Math.min(from + chunk, end);
    let total = 0;
    for (let bin = from; bin < to; bin += 1) {
      total += decibelToLinear(decibels[bin]);
    }
    out[entry] = total / chunk;
  }

  return out;
};

/**
 * The four values the shader's motion model consumes: three bands, then one
 * whole-spectrum magnitude.
 *
 * The cumulative entry is the same fold over all 240 entries at unit gain — not
 * a sum of the three bands, and not restricted to the range they cover.
 */
export const readAssistantBands = (
  decibels: Float32Array,
  minBin: number,
  maxBin: number,
): number[] => {
  const magnitudes = readRawMagnitudes(decibels, minBin, maxBin);
  const ranges = bandEntryRanges();
  const gains = ASSISTANT_BAND_CONFIG.gainMultipliers;

  const bands = ranges.map((range, index) =>
    foldBand(magnitudes.slice(range.start, range.end), gains[index] ?? 1),
  );

  return [...bands, foldBand(magnitudes, 1)];
};

/**
 * Per-frame smoothing and accumulation. Shipped as `j5i`.
 *
 * Both halves are the same exponential lerp — `1 - exp(-dt / tc)` — over a
 * 2-second time constant, and both scale the raw value by `dt * 60` so the
 * result is frame-rate independent. They differ in what they approach:
 * `audioData` approaches the *scaled sample*, so it decays back to 0 when the
 * audio stops, while `cumulative` approaches *its own value plus* the sample at
 * forty times the gain, so it integrates. The motion model then divides the
 * cumulative peak by `CUMULATIVE_AUDIO_DIVISOR` before clamping.
 *
 * Mutates both arrays in place — the render loop holds them across frames and
 * hands `cumulative` straight to the snapshot.
 */
export const integrateAudio = (
  audioData: number[],
  cumulative: number[],
  raw: readonly number[],
  dt: number,
): void => {
  const audioAlpha = 1 - Math.exp(-dt / AUDIO_TIME_CONSTANT_SECONDS);
  const cumulativeAlpha = 1 - Math.exp(-dt / CUMULATIVE_AUDIO_TIME_CONSTANT_SECONDS);
  const step = dt * AUDIO_FPS_SCALE;

  for (let i = 0; i < audioData.length; i += 1) {
    const sample = raw[i] ?? 0;
    audioData[i] += (sample * step * AUDIO_GAIN - audioData[i]) * audioAlpha;
    cumulative[i] += sample * step * CUMULATIVE_AUDIO_GAIN * cumulativeAlpha;
  }
};
