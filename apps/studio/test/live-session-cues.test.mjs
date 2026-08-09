/**
 * The connect and end session cues, exercised rather than read as text.
 *
 * The measurements themselves are verified in the module's own comment, against a
 * round-trip render scored on the originals. What can still break is everything
 * around them: which cue plays on which event, the exponential frequency ramp the
 * glide fit chose, the attack that has to lead a per-frame envelope, and the
 * internal consistency of the data (a partial whose envelope does not land on
 * silence, or whose peak is not its own maximum).
 *
 * Two properties are worth stating as tests because they encode findings that were
 * expensive to establish and easy to "fix" wrongly later: the chord assembles
 * *during* the glide, not after it, and the two cues are mirrors — one rises a
 * fifth, one falls one.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, before, beforeEach } from 'node:test';

import { importTs } from './ts-module.mjs';

/** Records automation so the ramps and curves can be asserted on. */
class FakeParam {
  constructor(log, name) { this.log = log; this.name = name; }
  setValueAtTime(value, time) { this.log.push({ op: 'set', param: this.name, value, time }); }
  linearRampToValueAtTime(value, time) { this.log.push({ op: 'linear', param: this.name, value, time }); }
  exponentialRampToValueAtTime(value, time) { this.log.push({ op: 'exp', param: this.name, value, time }); }
  setValueCurveAtTime(curve, time, duration) {
    this.log.push({ op: 'curve', param: this.name, curve: Array.from(curve), time, duration });
  }
}

class FakeContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = { id: 'destination' };
    this.voices = [];
    this.gains = [];
    this.resumed = 0;
  }

  resume() { this.resumed++; }

  createOscillator() {
    const voice = { type: null, freq: [], startAt: null, stopAt: null, gain: [] };
    this.voices.push(voice);
    this._pending = voice;
    return {
      frequency: new FakeParam(voice.freq, 'frequency'),
      set type(t) { voice.type = t; },
      get type() { return voice.type; },
      connect: (next) => next,
      disconnect() {},
      start(t) { voice.startAt = t; },
      stop(t) { voice.stopAt = t; },
    };
  }

  createGain() {
    // A per-voice gain always follows that voice's createOscillator; the cue's
    // single summing bus is created before any oscillator, so `_pending` is unset.
    const voice = this._pending;
    if (voice) {
      this._pending = null;
      return { gain: new FakeParam(voice.gain, 'gain'), connect: (n) => n, disconnect() {} };
    }
    const bus = { log: [], disconnected: 0 };
    this.gains.push(bus);
    return {
      gain: { set value(v) { bus.value = v; }, get value() { return bus.value; } },
      connect: (n) => n,
      disconnect() { bus.disconnected++; },
    };
  }
}

const STEP = 0.0106667;
const ATTACK = 0.5 * STEP;

describe('live session cues without Web Audio', () => {
  it('are a silent no-op', async () => {
    const mod = await importTs(
      path.resolve(import.meta.dirname, '../../../platform/ai/src/live-session-cues.ts'),
    );
    assert.equal(globalThis.window, undefined, 'expected no window before install');
    assert.doesNotThrow(() => mod.playLiveSessionCue('connect'));
    assert.doesNotThrow(() => mod.playLiveSessionCue('end'));
    assert.doesNotThrow(() => mod.primeLiveSessionCues());
  });
});

describe('live session cues', () => {
  let mod;
  const ctx = new FakeContext();

  before(async () => {
    globalThis.window = {
      AudioContext: function () { return ctx; },
      setTimeout: () => 0,
    };
    mod = await importTs(
      path.resolve(import.meta.dirname, '../../../platform/ai/src/live-session-cues.ts'),
    );
  });

  beforeEach(() => { ctx.voices.length = 0; ctx.gains.length = 0; });

  const cueOf = (kind) => (kind === 'connect' ? mod.LIVE_SESSION_CUES.connect : mod.LIVE_SESSION_CUES.end);

  it('exports the step and attack the envelopes were measured on', () => {
    assert.equal(mod.LIVE_SESSION_CUES.stepSeconds, STEP);
    assert.equal(mod.LIVE_SESSION_CUES.attackFrames, 0.5);
  });

  describe('data integrity', () => {
    for (const kind of ['connect', 'end']) {
      it(`${kind}: every envelope is normalised and lands on silence`, () => {
        for (const p of cueOf(kind).partials) {
          assert.equal(p.envelope.at(-1), 0, `${p.name} does not end on silence`);
          assert.equal(Math.max(...p.envelope), 1, `${p.name} is not normalised to 1`);
          assert.ok(p.envelope.every((v) => v >= 0), `${p.name} has a negative frame`);
          assert.ok(p.peak > 0 && p.peak < 1, `${p.name} peak ${p.peak} out of range`);
        }
      });

      it(`${kind}: exactly one partial glides, and it is the lead`, () => {
        const gliding = cueOf(kind).partials.filter((p) => p.glideSeconds > 0);
        assert.equal(gliding.length, 1);
        assert.match(gliding[0].name, /^lead /);
        // A static partial must not carry two different frequencies, or the
        // scheduler would silently ignore one of them.
        for (const p of cueOf(kind).partials) {
          if (p.glideSeconds === 0) assert.equal(p.fromHz, p.toHz, `${p.name} has a glide with no duration`);
        }
      });
    }

    it('the two cues are mirrors: one rises a fifth, the other falls one', () => {
      const lead = (kind) => cueOf(kind).partials.find((p) => p.glideSeconds > 0);
      const cents = (a, b) => 1200 * Math.log2(a / b);
      const up = cents(lead('connect').toHz, lead('connect').fromHz);
      const down = cents(lead('end').toHz, lead('end').fromHz);
      assert.ok(up > 0, `connect should rise, got ${up} cents`);
      assert.ok(down < 0, `end should fall, got ${down} cents`);
      // Both within a quartertone (50 cents) of a perfect fifth.
      assert.ok(Math.abs(up - 700) < 50, `connect glide ${up.toFixed(1)} cents is not a fifth`);
      assert.ok(Math.abs(Math.abs(down) - 700) < 80, `end glide ${down.toFixed(1)} cents is not a fifth`);
      // The connect glide starts on the note the end glide lands on.
      assert.ok(
        Math.abs(cents(lead('connect').fromHz, lead('end').toHz)) < 10,
        'connect should start on the pitch end lands on',
      );
    });

    it('the chord assembles during the glide, not after it', () => {
      // This is a measured property of both files and the thing most likely to be
      // "tidied" into a sequential attack later.
      for (const kind of ['connect', 'end']) {
        const lead = cueOf(kind).partials.find((p) => p.glideSeconds > 0);
        const others = cueOf(kind).partials.filter((p) => p.glideSeconds === 0);
        assert.ok(others.length > 0);
        const glideEnds = lead.startSeconds + lead.glideSeconds;
        for (const p of others) {
          assert.ok(
            p.startSeconds < glideEnds,
            `${kind}/${p.name} starts at ${p.startSeconds}s, after the glide ends at ${glideEnds}s`,
          );
        }
      }
    });
  });

  describe('scheduling', () => {
    it('plays a different cue for connect than for end', () => {
      mod.playLiveSessionCue('connect');
      const connectFreqs = ctx.voices.map((v) => v.freq[0].value).sort();
      ctx.voices.length = 0;
      mod.playLiveSessionCue('end');
      const endFreqs = ctx.voices.map((v) => v.freq[0].value).sort();
      assert.notDeepEqual(connectFreqs, endFreqs);
    });

    for (const kind of ['connect', 'end']) {
      it(`${kind}: schedules one sine per measured partial`, () => {
        mod.playLiveSessionCue(kind);
        const partials = cueOf(kind).partials;
        assert.equal(ctx.voices.length, partials.length);
        for (const v of ctx.voices) assert.equal(v.type, 'sine');
      });

      it(`${kind}: ramps frequency exponentially, which is linear in pitch`, () => {
        mod.playLiveSessionCue(kind);
        const lead = cueOf(kind).partials.find((p) => p.glideSeconds > 0);
        const voice = ctx.voices.find((v) => v.freq[0].value === lead.fromHz);
        assert.ok(voice, 'no voice starts at the lead frequency');
        // The glide was fitted against both alternatives and is linear in cents,
        // which an exponential ramp in Hz is exactly.
        const ramp = voice.freq.find((e) => e.op === 'exp');
        assert.ok(ramp, 'lead does not ramp exponentially');
        assert.equal(ramp.value, lead.toHz);
        assert.ok(Math.abs(ramp.time - (voice.startAt + lead.glideSeconds)) < 1e-9);
        // No partial should ramp linearly in Hz.
        for (const v of ctx.voices) assert.equal(v.freq.some((e) => e.op === 'linear'), false);
      });

      it(`${kind}: a static partial gets no frequency ramp at all`, () => {
        mod.playLiveSessionCue(kind);
        for (const p of cueOf(kind).partials) {
          if (p.glideSeconds > 0) continue;
          const voice = ctx.voices.find((v) => v.freq[0].value === p.fromHz);
          assert.ok(voice, `no voice for ${p.name}`);
          assert.equal(voice.freq.length, 1, `${p.name} should only set its frequency once`);
        }
      });

      it(`${kind}: ramps into each envelope before handing over to the curve`, () => {
        mod.playLiveSessionCue(kind);
        for (const p of cueOf(kind).partials) {
          const voice = ctx.voices.find((v) => v.freq[0].value === p.fromHz);
          const [zero, ramp, curve] = voice.gain;
          assert.equal(zero.op, 'set');
          assert.equal(zero.value, 0);
          // The envelope's first entry is the onset frame's level, not silence.
          assert.equal(ramp.op, 'linear');
          assert.ok(Math.abs(ramp.value - p.envelope[0] * p.peak) < 1e-12, `${p.name} ramp target`);
          assert.ok(Math.abs(ramp.time - zero.time - ATTACK) < 1e-6, `${p.name} attack length`);
          assert.equal(curve.op, 'curve');
          assert.ok(Math.abs(curve.time - ramp.time) < 1e-9, `${p.name} curve must start where the ramp ends`);
        }
      });

      it(`${kind}: walks each envelope at the measured frame spacing`, () => {
        mod.playLiveSessionCue(kind);
        for (const p of cueOf(kind).partials) {
          const voice = ctx.voices.find((v) => v.freq[0].value === p.fromHz);
          const curve = voice.gain.find((e) => e.op === 'curve');
          assert.equal(curve.curve.length, p.envelope.length);
          curve.curve.forEach((value, i) => {
            // Float32Array, so compare with a float32 tolerance.
            const want = p.envelope[i] * p.peak;
            assert.ok(
              Math.abs(value - want) <= Math.max(want, 1) * 1e-7,
              `${p.name} frame ${i}: ${value} != ${want}`,
            );
          });
          assert.ok(Math.abs(curve.duration - (p.envelope.length - 1) * STEP) < 1e-9);
          assert.equal(curve.curve.at(-1), 0);
        }
      });

      it(`${kind}: honours each partial's own onset`, () => {
        mod.playLiveSessionCue(kind);
        // The cue's own t0, recovered from any partial: the scheduler adds a small
        // lead ahead of currentTime, and the earliest partial is not necessarily at
        // offset zero (the end cue's lead starts at 10.67 ms).
        const base = Math.min(...ctx.voices.map((v, i) => {
          const p = cueOf(kind).partials.find((q) => q.fromHz === ctx.voices[i].freq[0].value);
          return v.startAt - p.startSeconds;
        }));
        for (const p of cueOf(kind).partials) {
          const voice = ctx.voices.find((v) => v.freq[0].value === p.fromHz);
          assert.ok(
            Math.abs(voice.startAt - base - p.startSeconds) < 1e-9,
            `${p.name} starts at ${voice.startAt - base}, expected ${p.startSeconds}`,
          );
          // Runs to the end of its curve, so nothing is cut off.
          const wantEnd = voice.startAt + ATTACK + (p.envelope.length - 1) * STEP;
          assert.ok(voice.stopAt >= wantEnd - 1e-6, `${p.name} stops before its envelope ends`);
        }
      });

      it(`${kind}: sums through one shared bus so the balance is preserved`, () => {
        mod.playLiveSessionCue(kind);
        // One bus per cue, not one per partial: the measured peaks are only in
        // proportion to each other if they sum at a single point.
        assert.equal(ctx.gains.length, 1);
        assert.equal(ctx.gains[0].value, 1);
      });

      it(`${kind}: schedules everything in the future`, () => {
        mod.playLiveSessionCue(kind);
        for (const v of ctx.voices) assert.ok(v.startAt > ctx.currentTime, 'scheduled at or before currentTime');
      });
    }

    it('resumes the context when primed, for autoplay', () => {
      const before = ctx.resumed;
      mod.primeLiveSessionCues();
      assert.ok(ctx.resumed > before);
    });
  });
});

/**
 * Where the cues are triggered from. Read as text — the convention in this
 * directory — since what matters is which event each cue is attached to, and a
 * React tree is not needed to check that.
 */
describe('session cue wiring', () => {
  const chatView = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../../features/chat/src/ChatView.tsx'),
    'utf8',
  );
  const live = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../../platform/ai/src/live.ts'),
    'utf8',
  );

  it('plays connect on the socket ACK, not on the click', () => {
    // The cue is named for the event it was measured against: ChatGPT plays it when
    // the session is connected. Firing it on the click would put it before the mic
    // is live, which is a different moment.
    const onOpen = chatView.slice(chatView.indexOf('onOpen: () =>'), chatView.indexOf('onTurnStart:'));
    assert.match(onOpen, /playLiveSessionCue\('connect'\)/);
  });

  it('plays end only on an explicit user stop', () => {
    const stop = chatView.slice(
      chatView.indexOf('const handleStopLive = useCallback('),
      chatView.indexOf('const handleStopGenerating'),
    );
    assert.match(stop, /playLiveSessionCue\('end'\)/);
    // An error close or a reconnect must stay silent: the session is not ending in
    // the sense the cue means, and a reconnect would fire it on every voice change.
    const onError = chatView.slice(chatView.indexOf('onError:'), chatView.indexOf('onClose:'));
    assert.doesNotMatch(onError, /playLiveSessionCue/);
    const restart = chatView.slice(
      chatView.indexOf('const restartLiveSession = useCallback('),
      chatView.indexOf('// A change while live reconnects'),
    );
    assert.doesNotMatch(restart, /playLiveSessionCue/);
  });

  it('primes the context inside the click gesture', () => {
    // A context created outside a user gesture starts suspended, so the connect cue
    // would be swallowed when onOpen fires later.
    const start = chatView.slice(
      chatView.indexOf('const handleStartLive = useCallback('),
      chatView.indexOf('const openLiveSession = useCallback(') > chatView.indexOf('const handleStartLive = useCallback(')
        ? chatView.indexOf('const openLiveSession = useCallback(')
        : chatView.length,
    );
    assert.match(start, /primeLiveSessionCues\(\)/);
  });

  it('is re-exported from live.ts, where callers import it', () => {
    assert.match(
      live,
      /export \{ playLiveSessionCue, primeLiveSessionCues, LIVE_SESSION_CUES \} from '\.\/live-session-cues';/,
    );
    // The old invented bell/two-sine synthesis is gone, not left alongside.
    assert.doesNotMatch(live, /playLiveChime|primeLiveChimes|ensureBellBus|chimeBellBus/);
  });

  it('leaves no caller on the old chime API', () => {
    assert.doesNotMatch(chatView, /playLiveChime|primeLiveChimes/);
  });
});
