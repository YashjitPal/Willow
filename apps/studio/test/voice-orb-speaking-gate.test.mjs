/**
 * The voice orb's reaction to speech, checked against the session it came from.
 *
 * Two defects motivated this file and each has a test that fails without its fix:
 *
 *  1. The orb was static while the user spoke. The speaking boolean was derived
 *     from transcript state, which is set for a whole listening window, so the
 *     140ms ramp pinned at 1 and the shader's per-syllable pulse never moved.
 *     Upstream picks its trigger by session type --
 *     `speakingListeningTrigger(){return sessionType()==='vp'?'server':'energy'}`
 *     -- and the captured session used `energy`, i.e. a gate on mic level.
 *  2. Bin indices were about to be copied across sample rates. An index only
 *     means a frequency alongside the rate and FFT size it was recorded under.
 *
 * The gate's two levels are checked by replaying the capture: `fixtures/
 * voice-orb-mic-gate.json` holds every frame that carried both uniforms (3476 of
 * them), pairing uMicLevel with the boolean recovered from the uUserSpeakingScale
 * ramp direction. The whole trace is used rather than an excerpt -- selecting a
 * window on any property related to the gate would fit the fixture to the answer.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const orbDir = path.resolve(here, '../../../features/chat/src/voice-orb');

const capture = JSON.parse(
  fs.readFileSync(path.join(here, 'fixtures/voice-orb-mic-gate.json'), 'utf8'),
);

const { MicSpeakingGate } = await importTs(path.join(orbDir, 'horizon-motion.ts'));
const { MIC_SPEAKING_GATE, ANALYSER_SETTINGS, MIC_BAND_CONFIG, MIC_BAND_MAX_HZ, bandMaxBin } =
  await importTs(path.join(orbDir, 'horizon-constants.ts'));

/** Replay the captured mic levels through a gate, counting disagreements. */
const replay = (step) => {
  let errors = 0;
  for (const [, micLevel, speaking] of capture.samples) {
    if ((step(micLevel) ? 1 : 0) !== speaking) errors += 1;
  }
  return errors;
};

describe('mic-energy speaking gate', () => {
  it('replays the captured session within its measured error rate', () => {
    const gate = new MicSpeakingGate();
    const errors = replay((micLevel) => gate.update(micLevel));

    assert.equal(capture.samples.length, capture.frames);
    assert.equal(
      errors,
      capture.pairErrors,
      'gate should reproduce the error count the levels were fitted at',
    );
    assert.ok(
      errors / capture.frames < 0.02,
      `misclassified ${errors}/${capture.frames} frames`,
    );
  });

  it('beats every single threshold on the same trace', () => {
    // The reason the constants are a pair rather than one number. A bare
    // threshold chatters through the troughs between syllables, and the best one
    // available (0.16) still misses more frames than the pair does.
    const gate = new MicSpeakingGate();
    const pairErrors = replay((micLevel) => gate.update(micLevel));

    let best = null;
    for (let threshold = 0.01; threshold <= 0.9; threshold += 0.01) {
      const errors = replay((micLevel) => micLevel > threshold);
      if (!best || errors < best.errors) best = { threshold, errors };
    }

    assert.equal(best.errors, capture.bestSingleErrors);
    assert.ok(
      pairErrors < best.errors,
      `pair ${pairErrors} should beat best single ${best.errors}`,
    );
  });

  it('holds through troughs between the two levels', () => {
    // The gap between the levels is the point: once open, energy dipping into it
    // must not close the gate, and from rest the same value must not open it.
    const { onLevel, offLevel } = MIC_SPEAKING_GATE;
    assert.ok(offLevel < onLevel, 'levels should be asymmetric');
    const trough = (onLevel + offLevel) / 2;

    const open = new MicSpeakingGate();
    assert.equal(open.update(onLevel + 0.01), true, 'rises above the on level');
    assert.equal(open.update(trough), true, 'holds through a trough');
    assert.equal(open.update(offLevel - 0.01), false, 'falls below the off level');

    const rest = new MicSpeakingGate();
    assert.equal(rest.update(trough), false, 'does not rise from rest inside the band');
    assert.equal(rest.update(onLevel), false, 'rise is strictly above the on level');
  });

  it('separates the speaking and silent populations it was fitted to', () => {
    // Sanity on the fixture itself: the two levels have to bracket the gap
    // between the populations, or the replay above would be meaningless.
    assert.ok(
      capture.medianSpeakingLevel > MIC_SPEAKING_GATE.onLevel,
      `median speaking level ${capture.medianSpeakingLevel} should exceed the on level`,
    );
    assert.ok(
      capture.medianSilentLevel < MIC_SPEAKING_GATE.offLevel,
      `median silent level ${capture.medianSilentLevel} should sit under the off level`,
    );
    assert.ok(capture.transitions >= 8, 'trace should contain real on/off cycles');
  });
});

describe('frequency band across sample rates', () => {
  // Upstream's analyser: 48kHz at fftSize 2048 gives 23.4375Hz per bin, so the
  // captured index 400 is 9375Hz. That frequency is what transfers, not the index.
  const REFERENCE_RATE = 48_000;

  it('reproduces the captured bin index at the rate it was captured under', () => {
    const binCount = ANALYSER_SETTINGS.fftSize / 2;
    assert.equal(
      bandMaxBin(REFERENCE_RATE, ANALYSER_SETTINGS.fftSize, binCount),
      MIC_BAND_CONFIG.maxFrequencyBin,
      'the helper should be an identity at the reference rate',
    );
    assert.equal(
      (MIC_BAND_CONFIG.maxFrequencyBin * REFERENCE_RATE) / ANALYSER_SETTINGS.fftSize,
      MIC_BAND_MAX_HZ,
    );
  });

  it('preserves the frequency rather than the index at other rates', () => {
    const { fftSize } = ANALYSER_SETTINGS;
    const binCount = fftSize / 2;

    // Playback runs at 24kHz: half the reference rate, so twice the index.
    assert.equal(bandMaxBin(24_000, fftSize, binCount), 800);

    // Reusing the index would have covered 4687.5Hz instead of 9375Hz.
    assert.equal((MIC_BAND_CONFIG.maxFrequencyBin * 24_000) / fftSize, 4687.5);
  });

  it('clamps to the spectrum when the band runs past Nyquist', () => {
    // Capture runs at 16kHz, whose Nyquist is 8kHz -- under the band's upper
    // edge. The closest available match to the captured band is everything.
    const { fftSize } = ANALYSER_SETTINGS;
    const binCount = fftSize / 2;
    assert.ok(16_000 / 2 < MIC_BAND_MAX_HZ, 'Nyquist should sit below the band edge');
    assert.equal(bandMaxBin(16_000, fftSize, binCount), binCount);
  });

  it('falls back to the whole spectrum on a nonsense analyser', () => {
    assert.equal(bandMaxBin(0, 2048, 1024), 1024);
    assert.equal(bandMaxBin(48_000, 0, 1024), 1024);
    assert.equal(bandMaxBin(Number.NaN, 2048, 1024), 1024);
  });
});
