/**
 * Constants for the voice orb, transcribed from the shipped implementation.
 *
 * Every value here was read out of a live WebGL2 capture and the shipped driver
 * module — none of it is estimated or hand-tuned. The names match the source so
 * the two can be diffed if the upstream visual ever changes.
 *
 * The internal name for this visual is "Horizon"; it is kept because the shader
 * uniforms and uniform block use it verbatim (`HorizonUniformsObject`), and
 * renaming here would obscure that correspondence.
 */

/** Full-screen quad shared by both passes. */
export const QUAD_POSITIONS = new Float32Array([
  -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
]);

/** Per-vertex `aGenerated` input consumed by the interior shader. */
export const QUAD_GENERATED = new Float32Array([
  0, 0, 0.5, 1, 0, 0.5, 0, 1, 0.5, 0, 1, 0.5, 1, 0, 0.5, 1, 1, 0.5,
]);

export const VERTEX_COUNT = 6;

/** Name of the std140 uniform block in the interior shader. */
export const UNIFORM_BLOCK_NAME = 'HorizonUniformsObject';

/** Texture units: watercolour on 0, interior render target on 1. */
export const WATERCOLOR_TEXTURE_UNIT = 0;
export const INTERIOR_TEXTURE_UNIT = 1;

/**
 * Interior pass renders at this fraction of the drawing buffer.
 *
 * Upstream treats it as both the initial and the maximum value, so the interior
 * never renders above 65% of the display resolution.
 */
export const INTERIOR_SCALE = 0.65;

/** Nominal frame rate the shader's periods are expressed in. */
export const SHADER_FRAME_RATE = 24;

/**
 * Largest timestep fed to the solvers, in seconds.
 *
 * A long frame (tab wake, GC pause) would otherwise make the springs jump; the
 * shipped driver clamps to 1/24s and so does this.
 */
export const MAX_TIMESTEP_SECONDS = 1 / 24;

/** Fixed substep for the spring integrator. */
export const SPRING_SUBSTEP_SECONDS = 1 / 120;

/** Enter/exit transition, matching the upstream Framer Motion config. */
export const ORB_TRANSITION = { duration: 0.35, ease: 'easeOut' } as const;
export const ORB_SCALE_HIDDEN = 0.2;
export const ORB_SCALE_VISIBLE = 1;

/** Responsive orb sizes in CSS pixels, by breakpoint. */
export const ORB_SIZE_BASE = 153.6;
export const ORB_SIZE_SM = 179.2;
export const ORB_SIZE_LG = 204.8;

/** Pre-connection dot colour, by theme. */
export const PRE_CONNECTION_DOT_COLOR_DARK: readonly [number, number, number, number] = [1, 1, 1, 1];
export const PRE_CONNECTION_DOT_COLOR_LIGHT: readonly [number, number, number, number] = [0, 0, 0, 1];

/** Multiplier applied to the raw mic band level before it reaches the shader. */
export const MIC_LEVEL_SCALE = 1.55;

/** Phase speeds and initial phases for the three watercolour layers. */
export const WATERCOLOR_PHASE_SPEEDS = [0.72, 1, 1.28] as const;
export const WATERCOLOR_INITIAL_PHASES = [0, 2.1, 4.2] as const;

/**
 * Motion tuning. Field names and values are exactly as shipped.
 *
 * Durations are time constants in seconds for the exponential smoother, not
 * animation lengths; frequencies are in Hz and damping ratios dimensionless.
 */
export const HORIZON_MOTION = {
  textureEdgeWarpSpringFrequency: 7,
  textureEdgeWarpSpringDampingRatio: 0.36,
  speakingTextureFlowSpeedScale: 0.96,
  textureFlowAttackDuration: 0.055,
  textureFlowReleaseDuration: 0.16,
  speakingWatercolorDriftAttackDuration: 0.07,
  speakingWatercolorDriftReleaseDuration: 0.22,
  minimumWaveMotionSpeed: 0.72,
  idleWaveMotionSpeed: 1.15,
  speakingWaveSpeedScale: 0.187,
  speakingSpeedBase: 1.8,
  speakingSlowEnergyScale: 4.6,
  speakingSpeedAttackDuration: 0.045,
  speakingSpeedReleaseDuration: 0.14,
  speakingSpringFrequency: 6,
  speakingSpringDampingRatio: 0.76,
  speakingWaveAmplitude: 1.167,
  speakingWaveAmplitudeAttackDuration: 0.1,
  speakingWaveAmplitudeReleaseDuration: 0.28,
  speakingWatercolorDriftScale: 0.033,
  speakingWatercolorWindScale: 0.1,
  speakingWatercolorWindSpeed: 0.65,
  listeningTextureEdgeWarpDistance: 0.102,
  listeningTextureNoiseScale: 2.2,
} as const;

/**
 * Palette index by name, as shipped.
 *
 * `default`, `black` and `blue` all map to 0; index 1 exists in the shader but
 * is unreachable through this map. Kept faithful rather than "corrected".
 */
export const PALETTE_INDEX_BY_NAME = {
  default: 0,
  black: 0,
  blue: 0,
  green: 2,
  yellow: 3,
  pink: 4,
  orange: 5,
  purple: 6,
} as const;

export type PaletteName = keyof typeof PALETTE_INDEX_BY_NAME;

/**
 * Mic band settings, read straight off the shipped call site.
 *
 * One band across bins 0..400, whose single value is multiplied by
 * `MIC_LEVEL_SCALE` to become `micLevel`.
 */
export const MIC_BAND_CONFIG = {
  bands: 1,
  minFrequencyBin: 0,
  maxFrequencyBin: 400,
} as const;

/**
 * The upper edge of the mic band as a frequency rather than a bin index.
 *
 * Bin indices are only meaningful against the sample rate and FFT size they were
 * recorded under: upstream's 48 kHz context with `fftSize` 2048 gives 23.4375 Hz
 * per bin, so bin 400 is 9375 Hz. Willow's capture context runs at 16 kHz and
 * playback at 24 kHz, where the same index 400 would mean 3125 Hz and 4687.5 Hz.
 *
 * Reusing the index would narrow the band to the part of the spectrum where
 * speech energy is densest and inflate the mean, which would in turn invalidate
 * the levels in `MIC_SPEAKING_GATE`. `bandMaxBin` converts this frequency back to
 * an index for whichever analyser it is handed, so the *band* is preserved
 * instead of the index.
 */
export const MIC_BAND_MAX_HZ = 9375;

/**
 * Convert `MIC_BAND_MAX_HZ` into a bin index for a given analyser.
 *
 * Clamped to `frequencyBinCount`, which is what a rate below 18.75 kHz needs:
 * 16 kHz puts Nyquist at 8 kHz, under the band's upper edge, so the closest
 * available match to upstream's band is the whole spectrum.
 */
export const bandMaxBin = (sampleRate: number, fftSize: number, binCount: number): number => {
  if (!(sampleRate > 0) || !(fftSize > 0)) return binCount;
  return Math.min(binCount, Math.round(MIC_BAND_MAX_HZ / (sampleRate / fftSize)));
};

/**
 * Assistant band settings.
 *
 * The shipped driver asks for 3 log-spaced bands with per-band gains, then
 * appends one cumulative magnitude, giving the 4 values the shader consumes.
 * The band count is therefore 3 + 1, not a flat 4.
 */
export const ASSISTANT_BAND_CONFIG = {
  bands: 3,
  bins: 1,
  gainMultipliers: [10, 1, 1],
  minFrequencyBin: 0,
  maxFrequencyBin: 400,
  fftSize: 2048,
  sampleRate: 48000,
} as const;

/** Number of values in the audio arrays: 3 bands plus the cumulative magnitude. */
export const AUDIO_DATA_LENGTH = 4;

/**
 * Analyser settings the shipped band reader creates its own analyser with.
 *
 * Read off the live analysers themselves: the recorder wrapped
 * `AudioContext.prototype.createAnalyser`, so these are the four values the
 * page's own nodes were constructed with, not defaults. `fftSize` and
 * `smoothingTimeConstant` are both non-default; the decibel window is left at
 * the Web Audio defaults of -100 and -30. An earlier note here recorded -80 as
 * the ceiling, which the capture disproves.
 */
export const ANALYSER_SETTINGS = {
  fftSize: 2048,
  smoothingTimeConstant: 0.8,
  minDecibels: -100,
  maxDecibels: -30,
} as const;

/**
 * Mic-energy gate behind the user-speaking signal.
 *
 * Upstream selects the trigger by session type —
 * `speakingListeningTrigger(){ return sessionType()==='vp' ? 'server' : 'energy' }`
 * — and the captured session used `energy`, so the boolean that drives
 * `uUserSpeakingScale` is a threshold on mic energy, not on transcript state.
 *
 * Both levels are fitted against the same normalised quantity this module feeds
 * the shader as `micLevel` (one band over bins 0..400, times `MIC_LEVEL_SCALE`).
 * Over 3476 captured frames, mic energy ran at a median of 0.41 while the
 * boolean was set and 0.00 while it was clear. A hysteresis pair misclassifies
 * 1.75% of frames against the single best threshold's 2.91%, so the pair is what
 * this transcribes.
 *
 * Measured edge timing rules out any hold on either side: release lag was 0 ms
 * at the median and the 75th percentile, and attack lag was 18 ms — one frame.
 * The gate is therefore instantaneous, and all of the visible smoothing comes
 * from the 140 ms ramp in `USER_SPEAKING_RAMP_DURATION_MS`.
 */
export const MIC_SPEAKING_GATE = {
  /** Rise when energy exceeds this. */
  onLevel: 0.31,
  /** Fall when energy drops below this. */
  offLevel: 0.12,
} as const;

/** Interval between audio band reads and cumulative accumulations, in ms. */
export const AUDIO_UPDATE_INTERVAL_MS = 16;

/**
 * Divisor applied to cumulative audio before it is clamped to 0..1.
 *
 * Appears verbatim at three call sites in the shipped motion model — the wave
 * speed, texture flow and watercolour drift solvers each divide the cumulative
 * peak by this before clamping.
 */
export const CUMULATIVE_AUDIO_DIVISOR = 12;

/** Raw-band count the cumulative reader requests before log-spaced reduction. */
export const CUMULATIVE_RAW_BAND_COUNT = 240;

/**
 * Audio integration constants for the smoothing and accumulation chain.
 *
 * `*_TIME_CONSTANT_SECONDS` feed `1 - exp(-dt / tc)` to produce the lerp factor,
 * so they are time constants rather than durations. `FPS_SCALE` normalises the
 * per-frame delta to a 60fps baseline.
 */
export const AUDIO_FPS_SCALE = 60;
export const AUDIO_GAIN = 1;
export const AUDIO_TIME_CONSTANT_SECONDS = 2;
export const CUMULATIVE_AUDIO_GAIN = 40;
export const CUMULATIVE_AUDIO_TIME_CONSTANT_SECONDS = 2;

/**
 * Decibel window the band normaliser maps onto 0..1.
 *
 * The raw value is clamped to this window, mapped linearly, then square-rooted.
 * `-Infinity` (digital silence) resolves to 0.
 */
export const BAND_DECIBEL_FLOOR = -100;
export const BAND_DECIBEL_CEILING = -10;

/**
 * Linear ramp durations, in milliseconds.
 *
 * These come from the shipped transition helper, which interpolates LINEARLY
 * from the current value to the target over its duration — restarting from
 * wherever the value currently sits if the target changes mid-ramp. There is no
 * easing and no spring on these four signals.
 */
export const STATE_RAMP_DURATION_MS = 500;
export const REVEAL_RAMP_DURATION_MS = 500;
export const USER_SPEAKING_RAMP_DURATION_MS = 140;
