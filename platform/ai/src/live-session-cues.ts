/**
 * The cues ChatGPT plays when a voice session connects and when it ends.
 *
 * ChatGPT ships these as OGG files under `/cdn/assets/` and plays them through
 * `<audio>` elements, chosen by a config gate in its voice module:
 *
 *   connected_2026_05_r2   session connected   1500 ms   peak 0.378
 *   hangup_2026_04_09      session ended       1582 ms   peak 0.401
 *   hangup_0db             legacy fallback      289 ms   peak 0.994
 *
 * The 2026 pair is the current design and is what this reproduces. `hangup_0db`
 * is the pre-redesign fallback that plays for accounts outside the gate, and is
 * deliberately not modelled: it is a *sampled* handset click, not a synthesised
 * tone — three separate bursts, 21 short inharmonic partial tracks, and a crest
 * factor near 6 (0.994 peak against 0.166 frame RMS). Nothing about it is
 * reconstructible from a partial list, and it does not match the current sound.
 *
 * Both cues are the same gesture in opposite directions: a single voice glides a
 * perfect fifth, then a chord fills in underneath it and decays for ~800 ms.
 *
 *   connect  A3 219.66 -> E4 330.89 Hz over 176 ms, rising   (+697.8 cents)
 *   hangup   E4 342.88 -> A3 219.88 Hz over 117 ms, falling  (-772.4 cents)
 *
 * The connect glide *starts* on the note the hangup glide *lands* on, which is
 * what makes the pair read as one idea. Every number here was measured off the
 * decoded files: partials tracked across a 2048-point STFT hopping 5.33 ms with
 * parabolic peak interpolation, then the stationary tails re-measured on a
 * 16384-point window (2.93 Hz bins) to pin the chord tuning.
 *
 * The chords are not quite equal-tempered, and the deviation is real rather than
 * measurement error — on a 2.93 Hz bin the other partials land within 1.4 cents:
 *
 *   connect  C#4 277.40 (+1.4c)  E4 330.89 (+6.6c)  C#5 554.28 (-0.3c)
 *   hangup   A3  219.88 (-0.9c)  E4 329.84 (+1.1c)  A4  439.75 (-1.0c)
 *
 * Connect's third is 6.6 cents sharp: 330.89/277.40 = 1.1928, which sits between
 * equal temperament's minor third (1.1892) and the just 6/5 (1.2). Hangup's
 * open fifth is equal-tempered to within a cent. Both are kept as measured.
 *
 * We synthesize rather than redistribute someone else's audio files.
 */

/** Frame spacing of every envelope below. */
const ENVELOPE_STEP_SECONDS = 0.0106667;

/**
 * Attack ramp in front of each envelope, as a fraction of one frame.
 *
 * Same reasoning as the mic earcons: a per-frame envelope cannot say where inside
 * its first frame a partial began. These frames are 5x longer than the earcons'
 * 2 ms, but the partials also rise far more gradually — every envelope's first
 * entry is a small fraction of its peak rather than most of it — so the ramp
 * matters much less here. Half a frame splits the difference.
 */
const ATTACK_FRAMES = 0.5;

/**
 * How the amplitudes below were arrived at, because it took four attempts and the
 * failures are the useful part.
 *
 * Frequencies were easy; amplitudes were not, because every obvious way to measure
 * a partial's amplitude is biased for these particular signals:
 *
 *   - Peak-tracking an STFT over-reads a pure sine (23.4 Hz bins plus parabolic
 *     interpolation) and silently *loses* a partial when a louder neighbour takes
 *     its frame. That truncated connect's C#4 to 341 ms when it actually runs
 *     ~990 ms, which left the rendered chord with a quarter of the C#4 it needed
 *     (0.141 against the file's 0.533, relative to E4).
 *   - A Goertzel at a fixed frequency is selective but assumes the frequency is
 *     stationary. Connect's glide moves ~170 cents inside one 42.7 ms window, so
 *     its energy spreads and the amplitude reads ~40% low (0.147 where the time
 *     domain says 0.206). It also averages across its window, so it over-reads
 *     during an attack and under-reads during a decay.
 *   - Time-domain peak has neither problem but cannot separate partials, so it is
 *     only the lead's amplitude while the lead is genuinely alone.
 *   - A least-squares fit against known frequencies separates them properly, but
 *     goes singular exactly where the glide crosses a chord tone: fitting connect
 *     at 96 ms, where the glide is at 277.24 Hz against C#4's 277.40 Hz, returned
 *     19.79 and 19.70 for the two — enormous and cancelling, because within one
 *     window they are the same signal and no method can apportion them.
 *
 * What is used, per partial: the fixed chord tones from a Goertzel at their exact
 * frequency (stationary, so unbiased), with onsets masked wherever the glide is
 * within one Hann main lobe (2 bins, 46.9 Hz) of the tone — the frames where the
 * reading would be the glide rather than the tone. The lead comes from the same
 * basis along its own glide path.
 *
 * That leaves the *shape* of every envelope and the balance between them measured,
 * but the overall level still low, since the lead's glide is under-read no matter
 * which stationary basis is used. So one gain per cue is fitted against total
 * energy — connect 1.2189, end 1.0794 — already folded into the peaks below.
 * Energy is the right target because it does not depend on the phase relationships
 * between partials, which are not recoverable and which a synthesized cue cannot
 * reproduce anyway: each oscillator here starts at phase zero at its own onset,
 * where the file's partials hold fixed relative phases and sum constructively.
 *
 * The fitted gain is corroborated rather than circular: it puts connect's lead at
 * 0.1799, between the Goertzel's 0.147 and the independent time-domain measurement
 * of 0.206 taken where that partial plays alone.
 *
 * Rendered back and measured the same way, the result matches each original's
 * total energy exactly, its sustained chord frequencies to within 0.11 Hz, the
 * chord's internal balance to within 0.02, and its 20 ms energy envelope to
 * RMSE 0.0087 (connect) and 0.0069 (end) against envelope peaks of ~0.185.
 * Instantaneous peak differs on connect (0.300 against 0.386) purely from those
 * unrecoverable phases; the end cue happens to land at 0.411 against 0.400.
 */

/**
 * One measured partial: a sine with a frequency glide and an amplitude envelope.
 *
 * `startSeconds` is the partial's own onset relative to the start of the cue, so
 * the chord arriving under the glide is a property of the data rather than
 * something the scheduler imposes.
 */
type CuePartial = {
  /** For reading the data against the source measurement. */
  readonly name: string;
  /** Onset relative to the cue's start. */
  readonly startSeconds: number;
  /** Starting frequency of the glide. Equals `toHz` for the static chord tones. */
  readonly fromHz: number;
  /** Frequency held for the rest of the partial. */
  readonly toHz: number;
  /** Glide duration. Zero for a partial that never moves. */
  readonly glideSeconds: number;
  /** Absolute peak amplitude, so the balance between partials is preserved. */
  readonly peak: number;
  /** Envelope normalised to this partial's own peak, landing on zero. */
  readonly envelope: readonly number[];
};

type SessionCue = {
  readonly partials: readonly CuePartial[];
};

/**
 * Session connected — a rising fifth into a C#-minor fragment.
 *
 * C#5 arrives at 128 ms and C#4 at 171 ms, so the chord fills in under the lead
 * before its 176 ms glide has finished. The lead then sustains on E4, which is why
 * E4 is not listed separately: it IS the lead.
 */
const CONNECT_CUE: SessionCue = {
  partials: [
    {
      // One continuous voice. Its envelope ripples through the glide (0.93, 0.53,
      // 0.71, 1.00, 0.99, 0.90, 0.90, 0.98) — real amplitude modulation in the file,
      // seen independently by the tracker and the Goertzel, so it is kept unsmoothed.
      name: 'lead A3->E4',
      startSeconds: 0,
      fromHz: 219.66,
      toHz: 330.89,
      glideSeconds: 0.176,
      peak: 0.1799,
      envelope: [
        0.2257, 0.352, 0.4674, 0.5442, 0.635, 0.69, 0.9314, 0.5313, 0.7141, 1,
        0.9922, 0.896, 0.8989, 0.9796, 0.8579, 0.9037, 0.9192, 0.867, 0.7635,
        0.6899, 0.6198, 0.5718, 0.5377, 0.4653, 0.4239, 0.3894, 0.3438, 0.3055,
        0.2676, 0.2492, 0.219, 0.2022, 0.1977, 0.1817, 0.1609, 0.1364, 0.1299,
        0.118, 0.1098, 0.1028, 0.0883, 0.0784, 0.0671, 0.0638, 0.06, 0.0592,
        0.0554, 0.0499, 0.0456, 0.0426, 0.043, 0.0395, 0.0369, 0.0315, 0.026,
        0.0217, 0.0207, 0.0189, 0.0167, 0.0156, 0.0129, 0.011, 0.0091, 0.0083,
        0.0075, 0.0073, 0.0065, 0.0057, 0.0043, 0.0034, 0.0033, 0.0039, 0.0048,
        0.0044, 0.0042, 0.0043, 0.0047, 0.0051, 0,
      ],
    },
    {
      // Onset masked to 171 ms: the glide passes through 277.4 Hz around 96-107 ms, so
      // earlier frames measure the glide, not this tone. 171 ms is also where the
      // independent peak-tracker first found it.
      name: 'C#4',
      startSeconds: 0.17067,
      fromHz: 277.4,
      toHz: 277.4,
      glideSeconds: 0,
      peak: 0.07467,
      envelope: [
        0.9024, 1, 0.7639, 0.743, 0.6795, 0.6001, 0.6144, 0.5381, 0.5481, 0.4476,
        0.3815, 0.3918, 0.3238, 0.3254, 0.2867, 0.2532, 0.2134, 0.2055, 0.2337,
        0.1994, 0.1964, 0.1741, 0.1594, 0.1405, 0.1107, 0.1107, 0.107, 0.1135,
        0.0942, 0.087, 0.0711, 0.0596, 0.0669, 0.0566, 0.0469, 0.0392, 0.0446,
        0.0446, 0.0374, 0.0285, 0.0299, 0.0309, 0.0263, 0.0218, 0.019, 0.0231,
        0.0218, 0.0194, 0.0146, 0.0128, 0.0112, 0.0104, 0.0137, 0.0144, 0.0124,
        0.0105, 0.0075, 0.0071, 0.0099, 0.0108, 0.0104, 0.0057, 0.0025, 0.0016,
        0.0027, 0.0041, 0.0034, 0.0031, 0.0036, 0.0048, 0.0031, 0.0026, 0.0024,
        0.0019, 0.003, 0.0045, 0.004, 0,
      ],
    },
    {
      // Enters at 128 ms, before the 176 ms glide has finished — the chord assembles
      // underneath the lead while it is still rising. Never masked: at 554 Hz it is far
      // above anything the glide reaches.
      name: 'C#5',
      startSeconds: 0.128,
      fromHz: 554.28,
      toHz: 554.28,
      glideSeconds: 0,
      peak: 0.1509,
      envelope: [
        0.1239, 0.6282, 1, 0.9, 0.748, 0.6392, 0.5471, 0.477, 0.4205, 0.3645,
        0.3171, 0.2773, 0.2401, 0.2083, 0.1825, 0.1605, 0.1408, 0.1243, 0.118,
        0.1198, 0.1129, 0.0978, 0.0851, 0.0757, 0.0672, 0.0586, 0.0505, 0.0443,
        0.0397, 0.0353, 0.0306, 0.0261, 0.0226, 0.0197, 0.017, 0.0147, 0.0143,
        0.0141, 0.0126, 0.0109, 0.0092, 0.0077, 0.0066, 0.006, 0.0057, 0.0051,
        0.0045, 0,
      ],
    },
  ],
};

/**
 * Session ended — a falling fifth into an A open fifth.
 *
 * The mirror of the connect cue in every respect: the glide falls the same interval
 * it rises, the chord likewise assembles mid-glide (E4 at 53 ms, A4 at 85 ms), and
 * the lead sustains on A3 rather than being listed as its own partial.
 *
 * The longest tail of the two — the lead is still measurable at ~907 ms against the
 * file's 1582 ms, the remainder being below the analysis floor.
 */
const HANGUP_CUE: SessionCue = {
  partials: [
    {
      // Includes the short lead-in (342.88 -> ~296 Hz over the first 43 ms) as one
      // continuous descent, since it is the same voice.
      name: 'lead E4->A3',
      startSeconds: 0.01067,
      fromHz: 342.88,
      toHz: 219.88,
      glideSeconds: 0.1173,
      peak: 0.18542,
      envelope: [
        0.0205, 0.0595, 0.1241, 0.2154, 0.3377, 0.4221, 0.4653, 0.5339, 0.562,
        0.8125, 0.9595, 1, 0.9636, 0.8916, 0.8202, 0.7662, 0.7111, 0.6519, 0.5984,
        0.5463, 0.5066, 0.4712, 0.436, 0.4052, 0.3757, 0.3505, 0.3275, 0.3022,
        0.2795, 0.2576, 0.2355, 0.2171, 0.2031, 0.1881, 0.1742, 0.1626, 0.1528,
        0.1441, 0.1324, 0.1214, 0.1132, 0.1042, 0.0968, 0.089, 0.0787, 0.0709,
        0.066, 0.0621, 0.057, 0.0509, 0.0468, 0.0431, 0.039, 0.0361, 0.0344,
        0.0329, 0.03, 0.0274, 0.0261, 0.0244, 0.0228, 0.0211, 0.0197, 0.0192,
        0.0184, 0.0172, 0.0156, 0.0142, 0.0134, 0.0133, 0.0134, 0.0126, 0.0117,
        0.011, 0.0102, 0.0092, 0.0081, 0.0072, 0.0064, 0.0059, 0.0054, 0.0049,
        0.0045, 0.0041, 0,
      ],
    },
    {
      // Enters at 85 ms, mid-glide, the mirror of connect's C#5 at 128 ms.
      name: 'A4',
      startSeconds: 0.08533,
      fromHz: 439.75,
      toHz: 439.75,
      glideSeconds: 0,
      peak: 0.20583,
      envelope: [
        0.0566, 0.4271, 0.9185, 1, 0.8559, 0.746, 0.6567, 0.5733, 0.5044, 0.4551,
        0.412, 0.3678, 0.3251, 0.2855, 0.251, 0.2235, 0.2014, 0.1805, 0.1582,
        0.1307, 0.1077, 0.0952, 0.0857, 0.0783, 0.0716, 0.065, 0.0582, 0.0508,
        0.0439, 0.0382, 0.034, 0.0308, 0.0276, 0.0246, 0.0218, 0.0191, 0.0178,
        0.018, 0.0171, 0.0155, 0.0138, 0.0119, 0.0104, 0.0093, 0.0083, 0.0077,
        0.0075, 0.0068, 0.006, 0.0055, 0.0053, 0.0051, 0.0049, 0.0044, 0,
      ],
    },
    {
      // Onset masked to 53 ms: the falling glide starts at 342.88 Hz and crosses
      // 329.84 Hz almost immediately, so the first frames are the glide. By 53 ms it
      // has fallen to ~258 Hz and this tone is measurable on its own.
      name: 'E4',
      startSeconds: 0.05333,
      fromHz: 329.84,
      toHz: 329.84,
      glideSeconds: 0,
      peak: 0.04577,
      envelope: [
        0.5079, 0.722, 0.8385, 0.7553, 0.6103, 0.8023, 0.7974, 0.9315, 1, 0.8008,
        0.6852, 0.6982, 0.651, 0.5522, 0.4821, 0.431, 0.3904, 0.3566, 0.3269,
        0.3035, 0.2784, 0.2434, 0.2186, 0.1993, 0.1724, 0.1549, 0.142, 0.1276,
        0.1142, 0.1025, 0.0932, 0.0856, 0.0785, 0.0724, 0.0672, 0.0611, 0.0545,
        0.0498, 0.0472, 0.0452, 0.0424, 0.0374, 0.0313, 0.0286, 0.0277, 0.0261,
        0.0228, 0.019, 0.0155, 0.0137, 0.0133, 0.0129, 0.0115, 0.0101, 0.0085,
        0.0062, 0.0052, 0.0045, 0,
      ],
    },
  ],
};

/** Exported for the tests, which assert the data against the measurement. */
export const LIVE_SESSION_CUES = {
  connect: CONNECT_CUE,
  end: HANGUP_CUE,
  stepSeconds: ENVELOPE_STEP_SECONDS,
  attackFrames: ATTACK_FRAMES,
} as const;

/**
 * Shared context for both cues.
 *
 * Created lazily so nothing is constructed until a session actually starts, and
 * rebuilt if it has been closed. `primeLiveSessionCues` exists so the first cue
 * can be created inside the click that starts voice mode, which is what keeps it
 * out of the autoplay blocklist.
 */
let cueCtx: AudioContext | null = null;

function ensureCueCtx(): AudioContext | null {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!cueCtx || cueCtx.state === 'closed') cueCtx = new Ctx();
  void cueCtx.resume?.();
  return cueCtx;
}

/**
 * Schedule one measured partial.
 *
 * Frequency uses `exponentialRampToValueAtTime` because both glides were fitted
 * against the alternatives and are linear in *cents*, not in Hz: over the connect
 * glide the exponential fit scores RMSE 3.61 against the linear fit's 5.18, and
 * over the hangup lead-in 2.03 against 2.55. An exponential ramp in Hz is exactly
 * a linear ramp in pitch, so this is the shape the files have — and it is also
 * what a glide sounds like musically.
 *
 * Amplitude uses `setValueCurveAtTime` over the measured envelope, as with the
 * mic earcons: these decays are not single exponentials — the connect lead ripples
 * through its glide and every partial has a long low tail well below where an
 * exponential fitted to the initial drop would put it.
 */
function schedulePartial(
  ctx: AudioContext,
  destination: AudioNode,
  partial: CuePartial,
  cueStartAt: number,
): number {
  const attackSeconds = ATTACK_FRAMES * ENVELOPE_STEP_SECONDS;
  const startAt = cueStartAt + partial.startSeconds;
  const curveSeconds = (partial.envelope.length - 1) * ENVELOPE_STEP_SECONDS;

  const osc = ctx.createOscillator();
  // Pure sines: a DFT of each cue found no partial that was not accounted for by
  // one of the tracked components or its own window smearing.
  osc.type = 'sine';
  osc.frequency.setValueAtTime(partial.fromHz, startAt);
  if (partial.glideSeconds > 0) {
    osc.frequency.exponentialRampToValueAtTime(partial.toHz, startAt + partial.glideSeconds);
  }

  const gain = ctx.createGain();
  // The envelope's first element is the onset frame's level, not silence, so a
  // short ramp leads into it before the curve takes over.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(partial.envelope[0] * partial.peak, startAt + attackSeconds);
  gain.gain.setValueCurveAtTime(
    Float32Array.from(partial.envelope, (v) => v * partial.peak),
    startAt + attackSeconds,
    curveSeconds,
  );

  osc.connect(gain).connect(destination);
  const endAt = startAt + attackSeconds + curveSeconds;
  osc.start(startAt);
  osc.stop(endAt);
  return endAt;
}

function playCue(cue: SessionCue): void {
  try {
    const ctx = ensureCueCtx();
    if (!ctx) return;
    // A small lead so every partial is scheduled in the future even if the audio
    // thread is already past `currentTime` by the time these land.
    const cueStartAt = ctx.currentTime + 0.02;

    // One shared output per cue rather than per partial, so the chord sums at a
    // single point and the measured peaks stay in proportion to each other.
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(ctx.destination);

    let endAt = cueStartAt;
    for (const partial of cue.partials) {
      endAt = Math.max(endAt, schedulePartial(ctx, out, partial, cueStartAt));
    }
    // Release the summing node once the last partial has finished, so a long
    // session does not accumulate one live gain node per cue.
    window.setTimeout(() => out.disconnect(), Math.ceil((endAt - ctx.currentTime + 0.1) * 1000));
  } catch {
    /* Audio unsupported or blocked — the cue is decoration, so stay silent. */
  }
}

/**
 * Create the audio context ahead of the first cue.
 *
 * Call inside the click that starts voice mode: a context created outside a user
 * gesture starts suspended, and the connect cue would be swallowed.
 */
export function primeLiveSessionCues(): void {
  try { ensureCueCtx(); } catch { /* noop */ }
}

/** Play the connect or end cue. `kind` names the event, not the sound. */
export function playLiveSessionCue(kind: 'connect' | 'end'): void {
  playCue(kind === 'connect' ? CONNECT_CUE : HANGUP_CUE);
}
