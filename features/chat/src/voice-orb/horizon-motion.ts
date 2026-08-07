/**
 * Motion model for the voice orb.
 *
 * A direct port of the shipped driver's solvers and per-frame update. The two
 * integrators are reproduced exactly rather than swapped for equivalents,
 * because their transient behaviour is visible: the spring is a semi-implicit
 * Euler at a fixed 1/120s substep, and the smoother uses split attack/release
 * time constants, so a critically-damped closed form would not match.
 */

import {
  CUMULATIVE_AUDIO_DIVISOR,
  HORIZON_MOTION,
  MIC_SPEAKING_GATE,
  SPRING_SUBSTEP_SECONDS,
  WATERCOLOR_INITIAL_PHASES,
  WATERCOLOR_PHASE_SPEEDS,
} from './horizon-constants';

export interface VoiceSnapshot {
  /** 0..1 ramp for the listening state. */
  stateListen: number;
  /** 0..1 ramp for the assistant-speaking state. */
  stateSpeak: number;
  /** 0..1 ramp latched while the user is speaking. */
  userSpeakingScale: number;
  /** Mean level across the assistant's frequency bands. */
  assistantWaveformLevel: number;
  /** Peak of the first three assistant bands. */
  assistantMotionLevel: number;
  /** Per-band running totals, divided by 12 before use. */
  cumulativeAudio: number[];
  /** Scaled microphone level. */
  micLevel: number;
}

export const EMPTY_VOICE_SNAPSHOT: VoiceSnapshot = {
  stateListen: 0,
  stateSpeak: 0,
  userSpeakingScale: 0,
  assistantWaveformLevel: 0,
  assistantMotionLevel: 0,
  cumulativeAudio: [0, 0, 0, 0],
  micLevel: 0,
};

/** Values the interior shader's uniform block consumes. */
export interface HorizonOutput {
  waveMotionSpeed: number;
  waveAmplitude: number;
  textureEdgeWarp: number;
  listeningTextureNoiseScale: number;
  textureFlowSpeed: number;
  speakingWatercolorOffsets: [number, number][];
}

const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(Math.max(value, min), max);

/**
 * Semi-implicit Euler spring, substepped at a fixed rate.
 *
 * Substepping keeps the result frame-rate independent; integrating the whole
 * frame in one step would let a slow frame overshoot.
 */
const solveSpring = (
  current: number,
  velocity: number,
  target: number,
  dt: number,
  frequency: number = HORIZON_MOTION.speakingSpringFrequency,
  dampingRatio: number = HORIZON_MOTION.speakingSpringDampingRatio,
): { value: number; velocity: number } => {
  const omega = 2 * Math.PI * frequency;
  const stiffness = omega * omega;
  const damping = 2 * dampingRatio * omega;
  const steps = Math.max(1, Math.ceil(dt / SPRING_SUBSTEP_SECONDS));
  const h = dt / steps;

  let value = current;
  let vel = velocity;
  for (let i = 0; i < steps; i += 1) {
    const acceleration = (target - value) * stiffness - vel * damping;
    vel += acceleration * h;
    value += vel * h;
  }
  return { value, velocity: vel };
};

/** Exponential smoothing with separate rise and fall time constants. */
const smoothToward = (
  current: number,
  target: number,
  dt: number,
  attack: number,
  release: number,
): number => {
  const tau = target > current ? attack : release;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
};

/**
 * Linear ramp toward a target over a fixed duration.
 *
 * Transcribed from the shipped transition helper. Two details of its behaviour
 * matter and neither is what a proportional ease would do:
 *
 *  1. It is genuinely linear on a clock. Progress is `(now - start) / duration`,
 *     so the value lands exactly on the target after `duration` and stays there.
 *     A proportional step of `dt / duration` per frame never arrives — at 60fps
 *     over a 500ms ramp it reaches about 0.635.
 *  2. When the target changes mid-ramp it restarts from wherever the value
 *     currently sits and still takes the *full* duration to cover the remaining
 *     distance. So a flip part-way through travels slower in absolute terms
 *     rather than continuing at a fixed rate.
 */
export class LinearRamp {
  private readonly durationMs: number;
  private value: number;
  private from: number;
  private target: number;
  private startedAt: number | null = null;

  constructor(durationMs: number, initial = 0) {
    this.durationMs = durationMs;
    this.value = initial;
    this.from = initial;
    this.target = initial;
  }

  /** Advance to `now` against `target`, returning the current value. */
  update(target: number, now: number): number {
    if (target !== this.target) {
      this.from = this.value;
      this.target = target;
      this.startedAt = now;
    }

    if (this.startedAt == null) return this.value;

    const progress =
      this.durationMs <= 0 ? 1 : Math.min((now - this.startedAt) / this.durationMs, 1);
    this.value = this.from + progress * (this.target - this.from);
    if (progress >= 1) this.startedAt = null;
    return this.value;
  }
}

/**
 * Schmitt trigger over mic energy, producing the user-speaking boolean.
 *
 * This is the input to `LinearRamp` for `userSpeakingScale`, and it is what makes
 * the orb react to speech at all: the shader multiplies `userSpeaking` by
 * `micLevel` for its pulse, so a boolean that never sets leaves the orb static
 * no matter how loud the mic is.
 *
 * Asymmetric by measurement, not by taste — see `MIC_SPEAKING_GATE`. Once set it
 * holds while energy stays at or above `offLevel`, which keeps the boolean from
 * chattering through the troughs between syllables; those troughs dip well under
 * the rise level but not under the fall level.
 */
export class MicSpeakingGate {
  private speaking: boolean;

  constructor(initial = false) {
    this.speaking = initial;
  }

  /** Fold one frame's mic energy in, returning the gate's current state. */
  update(micLevel: number): boolean {
    this.speaking = this.speaking
      ? micLevel >= MIC_SPEAKING_GATE.offLevel
      : micLevel > MIC_SPEAKING_GATE.onLevel;
    return this.speaking;
  }

  /** Current state without advancing. */
  get isSpeaking(): boolean {
    return this.speaking;
  }
}

/** Perceptual curve applied to the assistant's waveform level. */
const assistantWaveCurve = (snapshot: VoiceSnapshot): number =>
  (1 - Math.exp(-clamp(snapshot.assistantWaveformLevel) * 4)) ** 1.15;

/** Product of the two user-speaking drivers, used for edge warp and noise. */
const userSpeakingDrive = (snapshot: VoiceSnapshot): number =>
  clamp(snapshot.userSpeakingScale) * clamp(snapshot.micLevel);

interface MotionState {
  speakingSpeedDrive: number;
  speakingBoost: number;
  speakingVelocity: number;
  waveAmplitude: number;
  textureEdgeWarp: number;
  textureEdgeWarpVelocity: number;
  textureFlowBoost: number;
  speakingWatercolorAudio: number[];
  speakingWatercolorPhase: number[];
}

const createMotionState = (): MotionState => ({
  speakingSpeedDrive: 0,
  speakingBoost: 0,
  speakingVelocity: 0,
  waveAmplitude: 1,
  textureEdgeWarp: 0,
  textureEdgeWarpVelocity: 0,
  textureFlowBoost: 0,
  speakingWatercolorAudio: [0, 0, 0],
  speakingWatercolorPhase: [...WATERCOLOR_INITIAL_PHASES],
});

const createOutput = (waveMotionSpeed: number): HorizonOutput => ({
  waveMotionSpeed,
  waveAmplitude: 1,
  textureEdgeWarp: 0,
  listeningTextureNoiseScale: 1,
  textureFlowSpeed: 1,
  speakingWatercolorOffsets: [
    [0, 0],
    [0, 0],
    [0, 0],
  ],
});

/**
 * Per-frame motion solver.
 *
 * `update` mutates and returns the same output object each frame, as upstream
 * does — the renderer reads it immediately and never retains it.
 */
export class HorizonMotion {
  private readonly state: MotionState = createMotionState();

  private readonly output: HorizonOutput = createOutput(
    HORIZON_MOTION.idleWaveMotionSpeed,
  );

  initialOutput(): HorizonOutput {
    return this.output;
  }

  update(snapshot: VoiceSnapshot, dt: number): HorizonOutput {
    const waveCurve = assistantWaveCurve(snapshot);
    const speakingDrive = userSpeakingDrive(snapshot);

    this.output.waveMotionSpeed = this.solveWaveMotionSpeed(snapshot, dt, waveCurve);
    this.output.waveAmplitude = this.solveWaveAmplitude(snapshot, dt, waveCurve);
    this.output.textureEdgeWarp = this.solveTextureEdgeWarp(dt, speakingDrive);
    this.output.listeningTextureNoiseScale =
      1 + speakingDrive * (HORIZON_MOTION.listeningTextureNoiseScale - 1);
    this.output.textureFlowSpeed = this.solveTextureFlowSpeed(snapshot, dt);
    this.output.speakingWatercolorOffsets = this.solveWatercolorOffsets(snapshot, dt);

    return this.output;
  }

  private solveWaveMotionSpeed(
    snapshot: VoiceSnapshot,
    dt: number,
    waveCurve: number,
  ): number {
    const cumulativePeak = clamp(
      Math.max(...snapshot.cumulativeAudio) / CUMULATIVE_AUDIO_DIVISOR,
    );
    const speak = clamp(snapshot.stateSpeak);
    const speedTarget = speak * waveCurve;

    this.state.speakingSpeedDrive = smoothToward(
      this.state.speakingSpeedDrive,
      speedTarget,
      dt,
      HORIZON_MOTION.speakingSpeedAttackDuration,
      HORIZON_MOTION.speakingSpeedReleaseDuration,
    );

    const energy = Math.max(snapshot.assistantMotionLevel, cumulativePeak);
    const springTarget =
      speak *
      this.state.speakingSpeedDrive *
      HORIZON_MOTION.speakingWaveSpeedScale *
      (HORIZON_MOTION.speakingSpeedBase + energy * HORIZON_MOTION.speakingSlowEnergyScale);

    const solved = solveSpring(
      this.state.speakingBoost,
      this.state.speakingVelocity,
      springTarget,
      dt,
      HORIZON_MOTION.speakingSpringFrequency,
      HORIZON_MOTION.speakingSpringDampingRatio,
    );
    this.state.speakingBoost = solved.value;
    this.state.speakingVelocity = solved.velocity;

    // Listening and speaking both pull the idle drift down toward 1.0.
    const activity = Math.max(clamp(snapshot.stateListen), speak);
    const idleSpeed =
      HORIZON_MOTION.idleWaveMotionSpeed -
      activity * (HORIZON_MOTION.idleWaveMotionSpeed - 1);

    return Math.max(
      HORIZON_MOTION.minimumWaveMotionSpeed,
      idleSpeed + this.state.speakingBoost,
    );
  }

  private solveWaveAmplitude(
    snapshot: VoiceSnapshot,
    dt: number,
    waveCurve: number,
  ): number {
    const target =
      1 -
      clamp(snapshot.stateSpeak) * waveCurve * (1 - HORIZON_MOTION.speakingWaveAmplitude);

    this.state.waveAmplitude = smoothToward(
      this.state.waveAmplitude,
      target,
      dt,
      HORIZON_MOTION.speakingWaveAmplitudeAttackDuration,
      HORIZON_MOTION.speakingWaveAmplitudeReleaseDuration,
    );
    return this.state.waveAmplitude;
  }

  private solveTextureEdgeWarp(dt: number, speakingDrive: number): number {
    const target = speakingDrive * HORIZON_MOTION.listeningTextureEdgeWarpDistance;
    const solved = solveSpring(
      this.state.textureEdgeWarp,
      this.state.textureEdgeWarpVelocity,
      target,
      dt,
      HORIZON_MOTION.textureEdgeWarpSpringFrequency,
      HORIZON_MOTION.textureEdgeWarpSpringDampingRatio,
    );
    this.state.textureEdgeWarp = solved.value;
    this.state.textureEdgeWarpVelocity = solved.velocity;
    return this.state.textureEdgeWarp;
  }

  private solveTextureFlowSpeed(snapshot: VoiceSnapshot, dt: number): number {
    const cumulativePeak = clamp(
      Math.max(...snapshot.cumulativeAudio) / CUMULATIVE_AUDIO_DIVISOR,
    );
    const target =
      clamp(snapshot.stateSpeak) *
      Math.max(snapshot.assistantMotionLevel, cumulativePeak) *
      HORIZON_MOTION.speakingTextureFlowSpeedScale;

    this.state.textureFlowBoost = smoothToward(
      this.state.textureFlowBoost,
      target,
      dt,
      HORIZON_MOTION.textureFlowAttackDuration,
      HORIZON_MOTION.textureFlowReleaseDuration,
    );
    return 1 + this.state.textureFlowBoost;
  }

  /**
   * Three watercolour layers drift independently.
   *
   * The per-layer coefficients below (0.55, 0.75, 0.82, 0.91, 1.07, 0.7, 0.65,
   * 0.8, 1.1, 1.5) are taken verbatim from the shipped driver; they are what
   * stops the layers from moving in lockstep.
   */
  private solveWatercolorOffsets(
    snapshot: VoiceSnapshot,
    dt: number,
  ): [number, number][] {
    const speak = clamp(snapshot.stateSpeak);
    const audio = this.state.speakingWatercolorAudio;

    for (let i = 0; i < audio.length; i += 1) {
      const bandTarget =
        speak * clamp((snapshot.cumulativeAudio[i] ?? 0) / CUMULATIVE_AUDIO_DIVISOR);
      audio[i] = smoothToward(
        audio[i],
        bandTarget,
        dt,
        HORIZON_MOTION.speakingWatercolorDriftAttackDuration,
        HORIZON_MOTION.speakingWatercolorDriftReleaseDuration,
      );
    }

    const [audio0, audio1, audio2] = audio;
    const phase = this.state.speakingWatercolorPhase;

    if (speak > 0) {
      for (let i = 0; i < phase.length; i += 1) {
        phase[i] +=
          dt *
          speak *
          HORIZON_MOTION.speakingWatercolorWindSpeed *
          WATERCOLOR_PHASE_SPEEDS[i] *
          (1 + audio[i] * 1.5);
      }
    }

    const [phase0, phase1, phase2] = phase;
    const drift = HORIZON_MOTION.speakingWatercolorDriftScale;
    const wind = HORIZON_MOTION.speakingWatercolorWindScale;
    const offsets = this.output.speakingWatercolorOffsets;

    offsets[0][0] = audio0 * drift + Math.sin(phase0) * audio0 * wind;
    offsets[0][1] = -audio1 * drift * 0.55 + Math.cos(phase0 * 0.82) * audio1 * wind * 0.65;
    offsets[1][0] = -audio1 * drift * 0.75 + Math.cos(phase1 * 0.91) * audio1 * wind * 0.8;
    offsets[1][1] = audio2 * drift + Math.sin(phase1) * audio2 * wind;
    offsets[2][0] = audio2 * drift * 1.1 + Math.sin(phase2 * 1.07) * audio2 * wind * 1.1;
    offsets[2][1] = audio0 * drift * 0.7 + Math.cos(phase2) * audio0 * wind * 0.75;

    return offsets;
  }
}

export { clamp as clampUnit, solveSpring, smoothToward };
