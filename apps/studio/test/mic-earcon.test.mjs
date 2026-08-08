/**
 * The mic-button earcon, exercised rather than read as text.
 *
 * `mic-earcon.ts` carries three tones measured off ChatGPT's own OGG assets, and
 * the numbers themselves are verified in that file's comment against the
 * originals. What can still break is the scheduling around them: which release
 * tone pairs with which direction, the gap between press and release, and the
 * attack ramp that has to sit in front of a peak-per-frame envelope. So this runs
 * the real module against a recording AudioContext and asserts on what it
 * scheduled.
 *
 * Expected values are read off the module's own exported tone objects, not
 * restated here — editing an envelope changes both sides together, which is the
 * point: this test guards the scheduler, not the measurements.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it, before, beforeEach } from 'node:test';

import { importTs } from './ts-module.mjs';

const STEP = 0.002;
const ATTACK = 0.75 * STEP;

/** Records every automation call so the gain curve can be asserted on. */
class FakeParam {
  constructor(log) { this.log = log; }
  setValueAtTime(value, time) { this.log.push({ op: 'set', value, time }); }
  linearRampToValueAtTime(value, time) { this.log.push({ op: 'ramp', value, time }); }
  setValueCurveAtTime(curve, time, duration) {
    this.log.push({ op: 'curve', curve: Array.from(curve), time, duration });
  }
}

class FakeContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = { id: 'destination' };
    this.tones = [];
  }

  createOscillator() {
    const tone = { type: null, hz: null, startAt: null, stopAt: null, gain: [] };
    this.tones.push(tone);
    const node = {
      frequency: { set value(hz) { tone.hz = hz; }, get value() { return tone.hz; } },
      set type(t) { tone.type = t; },
      get type() { return tone.type; },
      connect: (next) => next,
      disconnect() {},
      start(t) { tone.startAt = t; },
      stop(t) { tone.stopAt = t; },
    };
    this._pendingTone = tone;
    return node;
  }

  createGain() {
    // `createGain` always follows the `createOscillator` for the same tone, so the
    // gain log can be attached to it without threading an id through.
    const tone = this._pendingTone;
    return { gain: new FakeParam(tone.gain), connect: (next) => next, disconnect() {} };
  }
}

const loadModule = () =>
  importTs(
    path.resolve(
      import.meta.dirname,
      '../../../features/chat/src/composer/mic-earcon.ts',
    ),
  );

// First, and in its own suite: the module caches its context on the first
// successful call, so the unavailable-Web-Audio path has to run before any fake
// is installed. A `beforeEach` in the main suite would already have installed one.
describe('mic toggle earcon without Web Audio', () => {
  it('is a silent no-op', async () => {
    const mod = await loadModule();
    assert.equal(globalThis.window, undefined, 'expected no window before install');
    assert.doesNotThrow(() => mod.playMicToggleEarcon(true));
    assert.doesNotThrow(() => mod.playMicToggleEarcon(false));
  });
});

describe('mic toggle earcon', () => {
  let mod;
  // One context for the whole suite, because the module creates one lazily and
  // reuses it — a fresh fake per test would be handed out but never used.
  const ctx = new FakeContext();

  before(async () => {
    globalThis.window = { AudioContext: function () { return ctx; } };
    mod = await loadModule();
  });

  beforeEach(() => { ctx.tones.length = 0; });

  const scheduled = () => ctx.tones;

  it('plays the press tone then the falling release when muting', () => {
    mod.playMicToggleEarcon(true);
    const [press, release] = scheduled();
    assert.equal(press.hz, mod.MIC_EARCON_PRESS.hz);
    assert.equal(release.hz, mod.MIC_EARCON_RELEASE_OFF.hz);
    assert.ok(release.hz < press.hz, 'muting should fall in pitch');
  });

  it('plays the rising release when unmuting', () => {
    mod.playMicToggleEarcon(false);
    const [press, release] = scheduled();
    assert.equal(press.hz, mod.MIC_EARCON_PRESS.hz);
    assert.equal(release.hz, mod.MIC_EARCON_RELEASE_ON.hz);
    assert.ok(release.hz > press.hz, 'unmuting should rise in pitch');
  });

  it('separates the two tones by the measured minimum gap', () => {
    mod.playMicToggleEarcon(true);
    const [press, release] = scheduled();
    assert.equal(press.startAt, 0);
    assert.equal(release.startAt, mod.MIC_EARCON_MIN_GAP_SECONDS);
  });

  it('uses pure sines, matching the harmonic-free originals', () => {
    mod.playMicToggleEarcon(false);
    for (const tone of scheduled()) assert.equal(tone.type, 'sine');
  });

  it('ramps into the envelope before handing over to the curve', () => {
    mod.playMicToggleEarcon(true);
    const { gain } = scheduled()[0];
    const { envelope, peak } = mod.MIC_EARCON_PRESS;

    assert.deepEqual(gain[0], { op: 'set', value: 0, time: 0 });
    // The curve's first entry is the attack frame's level, not silence, so the
    // ramp has to reach it rather than starting the curve from zero.
    assert.deepEqual(gain[1], { op: 'ramp', value: envelope[0] * peak, time: ATTACK });
    assert.equal(gain[2].op, 'curve');
    assert.equal(gain[2].time, ATTACK);
  });

  it('walks the measured envelope at its own frame spacing', () => {
    mod.playMicToggleEarcon(true);
    for (const [tone, source] of [
      [scheduled()[0], mod.MIC_EARCON_PRESS],
      [scheduled()[1], mod.MIC_EARCON_RELEASE_OFF],
    ]) {
      const curve = tone.gain.find((entry) => entry.op === 'curve');
      assert.equal(curve.curve.length, source.envelope.length);
      curve.curve.forEach((value, i) => {
        // The curve is a Float32Array, so the comparison carries a float32
        // tolerance rather than expecting the double back exactly.
        const want = source.envelope[i] * source.peak;
        assert.ok(
          Math.abs(value - want) <= Math.max(want, 1) * 1e-7,
          `frame ${i}: ${value} != ${want}`,
        );
      });
      assert.equal(curve.duration, (source.envelope.length - 1) * STEP);
      // Amplitude is scaled to the source file's own peak, so loudness matches too.
      assert.ok(Math.abs(Math.max(...curve.curve) - source.peak) <= source.peak * 1e-7);
      // Every envelope ends on silence, so the tone lands rather than cutting.
      assert.equal(curve.curve.at(-1), 0);
    }
  });

  it('stops each oscillator after its envelope finishes', () => {
    mod.playMicToggleEarcon(false);
    for (const [tone, source] of [
      [scheduled()[0], mod.MIC_EARCON_PRESS],
      [scheduled()[1], mod.MIC_EARCON_RELEASE_ON],
    ]) {
      const body = (source.envelope.length - 1) * STEP;
      assert.ok(tone.stopAt >= tone.startAt + ATTACK + body);
    }
  });
});
