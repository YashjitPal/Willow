/**
 * The assistant-audio band reader, checked against the implementation it copies.
 *
 * The defect: the orb reacted per-syllable while the user spoke but barely moved
 * while the assistant did. Willow read three *contiguous linear* bands of plain
 * mean off `getByteFrequencyData`, with no per-band gain, no median and no
 * compression. The shipped reader takes 240 log-spaced entries off
 * `getFloatFrequencyData`, folds them into three geometric bands, and puts a x10
 * gain on the lowest — which is 20-212 Hz. Willow's "low band" was instead the
 * unweighted mean of everything up to 3125 Hz, so the energy the motion model
 * weights most heavily was diluted across a hundred times its intended bandwidth.
 *
 * The chain is `l5i` -> `m5i` -> `b5i` -> `y5i` -> `j5i`; `audio-bands.ts` names
 * each function after what it does and keeps the shipped identifier in its doc
 * comment. This file pins the arithmetic that is easy to "clean up" by mistake:
 * the median, the nominal chunk divisor, the entry partition, and the fact that
 * the fourth value is a whole-spectrum fold rather than a sum of the three bands.
 *
 * It also pins the one adaptation. Willow plays back at 24 kHz, not upstream's
 * 48 kHz, and a bin index means nothing without the rate it was recorded under.
 * The claim being tested is stronger than "close enough": the two rates land on
 * the *same* entry partition, so entry for entry they cover identical frequencies.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const orbDir = path.resolve(here, '../../../features/chat/src/voice-orb');

const {
  bandEdgeFrequencies,
  bandEntryRanges,
  decibelToLinear,
  foldBand,
  integrateAudio,
  readAssistantBands,
  readRawMagnitudes,
} = await importTs(path.join(orbDir, 'audio-bands.ts'));

const {
  ASSISTANT_BAND_CONFIG,
  AUDIO_DATA_LENGTH,
  BAND_DECIBEL_CEILING,
  BAND_DECIBEL_FLOOR,
  CUMULATIVE_RAW_BAND_COUNT,
  MIC_BAND_MAX_HZ,
  bandMaxBin,
} = await importTs(path.join(orbDir, 'horizon-constants.ts'));

/** The two analysers this code actually runs against. */
const REFERENCE = { sampleRate: 48000, fftSize: 2048, binCount: 1024 };
const PLAYBACK = { sampleRate: 24000, fftSize: 2048, binCount: 1024 };

const maxBinFor = ({ sampleRate, fftSize, binCount }) =>
  bandMaxBin(sampleRate, fftSize, binCount);

/** A spectrum in decibels, sampled from a function of frequency. */
const spectrum = ({ sampleRate, fftSize, binCount }, decibelsAt) => {
  const binWidth = sampleRate / fftSize;
  return Float32Array.from({ length: binCount }, (_, bin) => decibelsAt(bin * binWidth));
};

describe('decibels to linear', () => {
  it('treats digital silence as zero rather than as the floor', () => {
    // -Infinity is what an idle graph reports. Clamping it to the floor instead
    // would leave the orb permanently lifted off its rest state.
    assert.equal(decibelToLinear(-Infinity), 0);
    assert.equal(decibelToLinear(BAND_DECIBEL_FLOOR), 0);
  });

  it('clamps to the window and square-roots what is left', () => {
    assert.equal(decibelToLinear(BAND_DECIBEL_CEILING), Math.sqrt(0.9));
    // Full scale reads 0.9487, not 1 — the ceiling is -10 dB, not 0 dB.
    assert.ok(Math.abs(decibelToLinear(0) - Math.sqrt(0.9)) < 1e-12);
    assert.equal(decibelToLinear(-200), 0);
    assert.equal(decibelToLinear(-55), Math.sqrt(0.45));
  });
});

describe('the band fold', () => {
  it('takes the median, not the mean', () => {
    // The distinction is the whole point of the fold: a spectrum is spiky, and a
    // mean lets one bin of transient energy carry a band that is otherwise quiet.
    const flat = [0.2, 0.2, 0.2, 0.2, 0.2];
    const spiked = [0.2, 0.2, 0.2, 0.2, 40];
    assert.equal(foldBand(flat, 1), foldBand(spiked, 1));

    // And a mean would not have been equal, so the assertion above has teeth.
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.notEqual(mean(flat), mean(spiked));
  });

  it('averages the two middle values on an even count', () => {
    assert.equal(foldBand([1, 3], 1), 2 / 3);
  });

  it('compresses toward one instead of clipping at it', () => {
    // x / (x + 1) is near-linear when quiet and asymptotic when loud, which is
    // what lets the x10 low-band gain lift speech without the loud parts
    // flattening into a constant.
    assert.ok(foldBand([0.001], 1) > 0.0009);
    assert.ok(foldBand([1000], 1) < 1);
    assert.ok(foldBand([1000], 1) > foldBand([100], 1));
    assert.equal(foldBand([], 1), 0);
  });

  it('applies the gain before the compression, not after', () => {
    // After would put the x10 band above 1 and out of the shader's range.
    assert.equal(foldBand([0.1], 10), 0.5);
    assert.ok(foldBand([0.1], 10) <= 1);
  });
});

describe('the entry partition', () => {
  it('splits geometrically, so each band spans a ratio not a width', () => {
    const edges = bandEdgeFrequencies(REFERENCE.sampleRate, ASSISTANT_BAND_CONFIG.bands);
    assert.equal(edges.length, ASSISTANT_BAND_CONFIG.bands + 1);
    assert.equal(edges[0], 20);
    assert.equal(edges[3], REFERENCE.sampleRate / 2);

    // 20 * 1200^(k/3): 20, 212.53, 2258.49, 24000.
    const ratio = (REFERENCE.sampleRate / 2 / 20) ** (1 / 3);
    assert.ok(Math.abs(edges[1] - 20 * ratio) < 1e-9);
    assert.ok(Math.abs(edges[2] - 20 * ratio ** 2) < 1e-9);
    assert.equal(Math.round(edges[1] * 100) / 100, 212.53);
    assert.equal(Math.round(edges[2] * 100) / 100, 2258.49);

    // Equal ratios between consecutive edges is what "geometric" means here.
    assert.ok(Math.abs(edges[1] / edges[0] - edges[2] / edges[1]) < 1e-9);
  });

  it('is the partition the shipped reader produces', () => {
    // Entry spacing is `sampleRate / (240 * 2)` = 100 Hz, so entry n sits at
    // n * 100 Hz and the edges above cut it into these three runs. Entry 0 is at
    // 0 Hz, below the 20 Hz edge, and belongs to no band — as upstream leaves it.
    assert.deepEqual(bandEntryRanges(), [
      { start: 1, end: 3 },
      { start: 3, end: 23 },
      { start: 23, end: 240 },
    ]);
  });

  it('does not depend on the analyser it will be run against', () => {
    // Both the spacing and the edges derive from the same reference rate, and the
    // entry count is fixed at 240, so this is a constant. Willow's 24 kHz
    // playback analyser therefore needs no adjustment here — only the bin range
    // handed to the reader changes.
    assert.deepEqual(
      bandEntryRanges(CUMULATIVE_RAW_BAND_COUNT, REFERENCE.sampleRate, ASSISTANT_BAND_CONFIG.bands),
      bandEntryRanges(),
    );
  });

  it('reproduces the spacing upstream computes rather than the true one', () => {
    // Upstream derives 100 Hz per entry by assuming the 240 entries span
    // 0..Nyquist. They do not: they are folded from bins 0..400, which at 48 kHz
    // with fftSize 2048 is 0..9375 Hz, i.e. 39.06 Hz per entry. The mislabelling
    // is upstream's, it ships, and the visual was tuned against it — so it is
    // transcribed, not corrected. This test exists so that stays a decision.
    const assumed = REFERENCE.sampleRate / (CUMULATIVE_RAW_BAND_COUNT * 2);
    const actual = MIC_BAND_MAX_HZ / CUMULATIVE_RAW_BAND_COUNT;
    assert.equal(assumed, 100);
    assert.ok(Math.abs(actual - 39.0625) < 1e-9);
    assert.notEqual(assumed, actual);
  });
});

describe('reading the raw magnitudes', () => {
  const loud = spectrum(REFERENCE, () => BAND_DECIBEL_CEILING);

  it('yields exactly the entry count the split expects', () => {
    const raw = readRawMagnitudes(loud, 0, maxBinFor(REFERENCE));
    assert.equal(raw.length, CUMULATIVE_RAW_BAND_COUNT);
  });

  it('divides by the nominal chunk size, leaving the top entries at rest', () => {
    // 400 bins over 240 chunks of ceil(400/240) = 2 reaches only entry 199, so
    // entries 200-239 are permanently 0 and the geometric split above treats them
    // as a silent top end. Dividing by the number of bins that actually landed in
    // each chunk would change any partial chunk; the nominal divisor is what the
    // shipped `s.push(t / a)` does.
    const raw = readRawMagnitudes(loud, 0, maxBinFor(REFERENCE));
    assert.equal(raw[199], decibelToLinear(BAND_DECIBEL_CEILING));
    assert.equal(raw[200], 0);
    assert.equal(raw[239], 0);
  });

  it('converts each bin before averaging, not the other way round', () => {
    // Averaging decibels and converting afterwards is a different number: the
    // conversion is a square root, so it does not commute with the mean.
    const mixed = spectrum(REFERENCE, (hz) => (hz < 23.4375 ? -10 : -90));
    const raw = readRawMagnitudes(mixed, 0, maxBinFor(REFERENCE));
    const perBin = (decibelToLinear(-10) + decibelToLinear(-90)) / 2;
    assert.ok(Math.abs(raw[0] - perBin) < 1e-12);
    assert.notEqual(perBin, decibelToLinear((-10 + -90) / 2));
  });
});

describe('the 24 kHz playback analyser', () => {
  // The adaptation, and the claim worth testing: this is not "close enough", the
  // two rates land on the same partition. 9375 Hz is 400 bins at 48 kHz and 800
  // at 24 kHz; 400 over 240 chunks of 2 and 800 over 240 chunks of 4 both stop at
  // entry 199, and 2 x 23.4375 Hz is the same 46.875 Hz per entry as 4 x 11.71875.

  it('resolves the reference bin index against its own rate', () => {
    assert.equal(maxBinFor(REFERENCE), 400);
    assert.equal(maxBinFor(PLAYBACK), 800);
    // The literal 400 would have reached only 4687.5 Hz here, squeezing all three
    // bands into the bottom of the spectrum.
    assert.equal((400 * PLAYBACK.sampleRate) / PLAYBACK.fftSize, 4687.5);
  });

  it('covers the same frequencies entry for entry', () => {
    const perEntry = (rate) =>
      Math.ceil(maxBinFor({ ...REFERENCE, sampleRate: rate }) / CUMULATIVE_RAW_BAND_COUNT) *
      (rate / REFERENCE.fftSize);
    assert.equal(perEntry(REFERENCE.sampleRate), 46.875);
    assert.equal(perEntry(PLAYBACK.sampleRate), 46.875);
  });

  it('reads the same bands from the same signal at either rate', () => {
    // Piecewise-constant across each 46.875 Hz entry, so both chunk sizes average
    // the same value exactly and any difference in the result is a real one.
    const decibelsAt = (hz) => {
      const entry = Math.floor(hz / 46.875);
      return entry < 4 ? -20 : entry < 40 ? -55 : -85;
    };
    const atReference = readAssistantBands(
      spectrum(REFERENCE, decibelsAt),
      ASSISTANT_BAND_CONFIG.minFrequencyBin,
      maxBinFor(REFERENCE),
    );
    const atPlayback = readAssistantBands(
      spectrum(PLAYBACK, decibelsAt),
      ASSISTANT_BAND_CONFIG.minFrequencyBin,
      maxBinFor(PLAYBACK),
    );
    for (let i = 0; i < AUDIO_DATA_LENGTH; i += 1) {
      assert.ok(
        Math.abs(atReference[i] - atPlayback[i]) < 1e-12,
        `band ${i}: ${atReference[i]} vs ${atPlayback[i]}`,
      );
    }
  });
});

describe('the four values the shader consumes', () => {
  const voice = spectrum(REFERENCE, (hz) => (hz > 80 && hz < 300 ? -35 : -95));

  it('is three bands plus a whole-spectrum fold', () => {
    const bands = readAssistantBands(voice, 0, maxBinFor(REFERENCE));
    assert.equal(bands.length, AUDIO_DATA_LENGTH);
    assert.equal(AUDIO_DATA_LENGTH, ASSISTANT_BAND_CONFIG.bands + 1);
  });

  it('takes the fourth value over every entry, not as a sum of the three', () => {
    // It is folded from all 240 entries at unit gain — including the 40 that are
    // permanently 0 — so it is not reachable from the bands above it.
    const bands = readAssistantBands(voice, 0, maxBinFor(REFERENCE));
    const sumOfBands = bands[0] + bands[1] + bands[2];
    assert.notEqual(bands[3], sumOfBands);
    assert.ok(bands[3] < sumOfBands);
  });

  it('weights the low band ten to one, which is what the motion model reads', () => {
    assert.deepEqual(ASSISTANT_BAND_CONFIG.gainMultipliers, [10, 1, 1]);
    const flat = spectrum(REFERENCE, () => -40);
    const bands = readAssistantBands(flat, 0, maxBinFor(REFERENCE));
    // Same magnitude in every entry, so the only thing separating band 0 from
    // band 1 is the gain.
    assert.ok(bands[0] > bands[1]);
    assert.ok(Math.abs(bands[1] - bands[2]) < 1e-12);
  });

  it('lifts a voice-band signal far above what a flat linear mean would', () => {
    // The defect, measured. The old reader's low band was the plain mean of the
    // bottom third of 0-9375 Hz, i.e. everything up to 3125 Hz, off byte data.
    // Speech energy sits in the bottom few hundred hertz, so spreading it over
    // that range is what flattened the orb.
    const bands = readAssistantBands(voice, 0, maxBinFor(REFERENCE));

    const binWidth = REFERENCE.sampleRate / REFERENCE.fftSize;
    const previousLowBand = (() => {
      const stop = Math.floor(maxBinFor(REFERENCE) / ASSISTANT_BAND_CONFIG.bands);
      let total = 0;
      for (let bin = 0; bin < stop; bin += 1) {
        // getByteFrequencyData's own mapping over the analyser's -100..-30 window.
        const db = voice[bin];
        total += Math.max(0, Math.min(255, Math.round(((db + 100) / 70) * 255)));
      }
      return total / stop / 255;
    })();

    assert.ok(Math.abs(stopFrequency(binWidth) - 3125) < binWidth);
    assert.ok(
      bands[0] > previousLowBand * 3,
      `low band ${bands[0]} should dominate the old reader's ${previousLowBand}`,
    );
  });

  function stopFrequency(binWidth) {
    return Math.floor(maxBinFor(REFERENCE) / ASSISTANT_BAND_CONFIG.bands) * binWidth;
  }
});

describe('smoothing and accumulation', () => {
  const tick = 16 / 1000;

  it('decays the smoothed value back to rest when the audio stops', () => {
    const audio = new Array(AUDIO_DATA_LENGTH).fill(0);
    const cumulative = new Array(AUDIO_DATA_LENGTH).fill(0);
    const loud = [0.8, 0.8, 0.8, 0.8];
    const silence = [0, 0, 0, 0];

    for (let i = 0; i < 200; i += 1) integrateAudio(audio, cumulative, loud, tick);
    const whileSpeaking = audio[0];
    assert.ok(whileSpeaking > 0);

    for (let i = 0; i < 600; i += 1) integrateAudio(audio, cumulative, silence, tick);
    assert.ok(audio[0] < whileSpeaking / 10, `expected decay, got ${audio[0]}`);
  });

  it('never decays the cumulative term, which is what makes it an integral', () => {
    const audio = new Array(AUDIO_DATA_LENGTH).fill(0);
    const cumulative = new Array(AUDIO_DATA_LENGTH).fill(0);

    for (let i = 0; i < 100; i += 1) integrateAudio(audio, cumulative, [0.5, 0, 0, 0], tick);
    const reached = cumulative[0];
    assert.ok(reached > 0);

    for (let i = 0; i < 100; i += 1) integrateAudio(audio, cumulative, [0, 0, 0, 0], tick);
    assert.equal(cumulative[0], reached);
  });

  it('is why the tick has to be an interval and not a render frame', () => {
    // Each tick contributes in proportion to dt squared — once through `dt * 60`
    // and again through the alpha, which is ~dt/2 for small dt. Over a fixed wall
    // clock that makes the total proportional to the tick interval, so driving
    // this from rAF would tie the orb's motion to the display's refresh rate.
    // VoiceOrb runs it on setInterval(16) for exactly this reason.
    const runFor = (dt, seconds) => {
      const audio = new Array(AUDIO_DATA_LENGTH).fill(0);
      const cumulative = new Array(AUDIO_DATA_LENGTH).fill(0);
      for (let i = 0; i < Math.round(seconds / dt); i += 1) {
        integrateAudio(audio, cumulative, [0.5, 0, 0, 0], dt);
      }
      return cumulative[0];
    };
    const slow = runFor(1 / 60, 1);
    const fast = runFor(1 / 120, 1);
    assert.ok(fast < slow * 0.6, `${fast} should be about half of ${slow}`);
  });
});
