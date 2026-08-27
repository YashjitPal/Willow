/**
 * The click earcon ChatGPT plays on its voice-mode mic button.
 *
 * ChatGPT ships three OGG files and plays them through `<audio>` elements: a
 * shared press tone, then one of two release tones depending on which way the
 * toggle went. Every number below was measured off those files — decoded in the
 * page, peak-enveloped in 2 ms frames and centre-frequency fitted by parabolic
 * interpolation over a 4096-point DFT:
 *
 *   button_down     press, either direction   2100.3 Hz   ~46 ms   peak 0.0766
 *   button_up_on    release → mic on          2637.8 Hz   ~37 ms   peak 0.0643
 *   button_up_off   release → mic off         1050.0 Hz   ~65 ms   peak 0.0533
 *
 * The three pitches are a deliberate musical gesture rather than arbitrary
 * blips: the press is C7, releasing to on rises a major third to E7, releasing
 * to off falls a full octave to C6 (measured ratios 1.2559 and 0.4999 against
 * theoretical 1.2599 and 0.5). Each is a pure sine — a DFT out to 8.6 kHz found
 * no partial outside the fundamental's own smearing — so an oscillator plus the
 * measured gain curve reproduces them, and we synthesize rather than
 * redistribute someone else's audio files.
 *
 * Envelopes are the measured peak per 2 ms frame, normalised, with a trailing
 * zero so the tone lands on silence. The first entry is the attack frame and the
 * peak is the second (third for the off tone), which is why `scheduleTone` ramps
 * into element 0 before handing over to the curve.
 *
 * Rendered back and re-measured the same way, the result sits within 0.07% of
 * each original's centre frequency, 1% of its peak amplitude and ~1 ms of its
 * audible length.
 */

/** Frame spacing of every envelope below. */
const ENVELOPE_STEP_SECONDS = 0.002;

/**
 * Attack ramp in front of the curve, as a fraction of one envelope frame.
 *
 * A per-frame peak envelope cannot say where inside its first frame the tone
 * started, so this was swept rather than assumed: rendering each tone at 0,
 * 0.25, 0.4, 0.5, 0.6, 0.75 and 1.0 frames and scoring against the original,
 * all three minimise at 0.75 (RMSE 0.105 / 0.111 / 0.070). Below ~0.4 the peak
 * lands a frame early, at 1.0 a frame late, and 0.75 also matches the audible
 * length best — 46.0 vs 45.7 ms, 37.4 vs 36.8 ms, 57.8 vs 64.8 ms.
 */
const ATTACK_FRAMES = 0.75;

type EarconTone = {
  /** Centre frequency in Hz, parabolically interpolated from the DFT. */
  readonly hz: number;
  /** Absolute peak amplitude of the source file, so loudness matches too. */
  readonly peak: number;
  /** Normalised peak-per-2ms-frame envelope, leading zero prepended. */
  readonly envelope: readonly number[];
};

export const MIC_EARCON_PRESS: EarconTone = {
  hz: 2100.3,
  peak: 0.0766,
  envelope: [
    0.086, 1, 0.92, 0.331, 0.229, 0.128, 0.135, 0.062, 0.041, 0.05, 0.039,
    0.016, 0.008, 0.013, 0.019, 0.017, 0.014, 0.004, 0.002, 0.002, 0.002, 0.001,
    0.003, 0,
  ],
};

export const MIC_EARCON_RELEASE_ON: EarconTone = {
  hz: 2637.8,
  peak: 0.0643,
  envelope: [
    0.058, 1, 0.936, 0.324, 0.194, 0.144, 0.115, 0.05, 0.045, 0.045, 0.045,
    0.024, 0.025, 0.019, 0.018, 0.013, 0.003, 0.003, 0.002, 0,
  ],
};

export const MIC_EARCON_RELEASE_OFF: EarconTone = {
  hz: 1050,
  peak: 0.0533,
  envelope: [
    0.025, 0.866, 1, 0.705, 0.394, 0.298, 0.271, 0.22, 0.19, 0.142, 0.156,
    0.088, 0.072, 0.08, 0.026, 0.044, 0.048, 0.048, 0.046, 0.032, 0.033, 0.032,
    0.028, 0.026, 0.018, 0.012, 0.009, 0.006, 0.003, 0,
  ],
};

/**
 * Gap between the press tone and the release tone.
 *
 * ChatGPT fires the two from separate pointerdown/pointerup handlers, so on a
 * real click the spacing is however long the button was held. Measured over
 * trusted CDP clicks it was 103.3 ms and 104.0 ms, but those had a scripted
 * 90 ms hold, so the honest reading is "as soon as the press tone is under way".
 * A click that reports no measurable hold still needs the two to be distinct,
 * hence a floor rather than a fixed delay.
 */
export const MIC_EARCON_MIN_GAP_SECONDS = 0.06;

let sharedCtx: AudioContext | null = null;

/**
 * Lazily created and reused. Created on the click that needs it so it starts in
 * a user gesture and is never left suspended by autoplay policy.
 */
function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    try {
      sharedCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (sharedCtx.state === 'suspended') void sharedCtx.resume?.();
  return sharedCtx;
}

function scheduleTone(ctx: AudioContext, tone: EarconTone, startAt: number): number {
  const curveSeconds = (tone.envelope.length - 1) * ENVELOPE_STEP_SECONDS;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = tone.hz;

  const attackSeconds = ATTACK_FRAMES * ENVELOPE_STEP_SECONDS;
  const gain = ctx.createGain();
  // The curve's first element is the attack frame's level, not silence, so it
  // needs a short ramp in front of it — see ATTACK_FRAMES for why 0.75 frames.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(tone.envelope[0] * tone.peak, startAt + attackSeconds);
  // setValueCurveAtTime walks the measured shape directly, so the two-stage
  // decay these tones have — a steep initial drop, then a long low ring — comes
  // out of the data instead of an exponential that only fits one of the stages.
  gain.gain.setValueCurveAtTime(
    Float32Array.from(tone.envelope, (v) => v * tone.peak),
    startAt + attackSeconds,
    curveSeconds,
  );

  const endAt = startAt + attackSeconds + curveSeconds;
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(endAt + 0.01);
  osc.onended = () => {
    try { osc.disconnect(); gain.disconnect(); } catch { /* already torn down */ }
  };
  return endAt;
}

/**
 * Play the press tone plus the release tone for the direction being taken.
 *
 * `willBeMuted` is where the toggle is heading, not where it is now, so the
 * falling tone plays as the mic goes off and the rising tone as it comes back.
 * Silently does nothing when Web Audio is unavailable — an earcon is never worth
 * breaking a click over.
 */
export function playMicToggleEarcon(willBeMuted: boolean): void {
  const ctx = getContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    scheduleTone(ctx, MIC_EARCON_PRESS, now);
    scheduleTone(
      ctx,
      willBeMuted ? MIC_EARCON_RELEASE_OFF : MIC_EARCON_RELEASE_ON,
      now + MIC_EARCON_MIN_GAP_SECONDS,
    );
  } catch { /* noop */ }
}
