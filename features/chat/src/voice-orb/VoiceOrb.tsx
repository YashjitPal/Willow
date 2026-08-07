/**
 * The voice orb.
 *
 * A faithful reproduction of the shipped visual: shaders, texture, geometry and
 * every motion constant were captured from a live WebGL2 context and the driver
 * module, then transcribed without adjustment. See `horizon-constants.ts`.
 *
 * Structure mirrors the original so the pieces line up:
 *  - an outer `motion.div` carries the scale-in/scale-out transition
 *  - a square, responsive box sizes the canvas
 *  - the canvas backing buffer is `floor(cssSize * dpr)`
 *
 * Audio is optional. With no `analyser` the orb renders its idle drift, which is
 * exactly what the original shows before a session produces sound.
 */

import React from 'react';
import { motion } from 'framer-motion';

import interiorVertexSource from './shaders/interior.vert.glsl?raw';
import interiorFragmentSource from './shaders/interior.frag.glsl?raw';
import compositeVertexSource from './shaders/composite.vert.glsl?raw';
import compositeFragmentSource from './shaders/composite.frag.glsl?raw';
import watercolorUrl from '@willow/assets/voice-orb/watercolor.webp';

import {
  ASSISTANT_BAND_CONFIG,
  AUDIO_UPDATE_INTERVAL_MS,
  MAX_TIMESTEP_SECONDS,
  MIC_BAND_CONFIG,
  MIC_LEVEL_SCALE,
  ORB_SCALE_HIDDEN,
  ORB_SCALE_VISIBLE,
  ORB_TRANSITION,
  PALETTE_INDEX_BY_NAME,
  PRE_CONNECTION_DOT_COLOR_DARK,
  PRE_CONNECTION_DOT_COLOR_LIGHT,
  REVEAL_RAMP_DURATION_MS,
  SHADER_FRAME_RATE,
  STATE_RAMP_DURATION_MS,
  USER_SPEAKING_RAMP_DURATION_MS,
  bandMaxBin,
  type PaletteName,
} from './horizon-constants';
import {
  WORKSPACE_PALETTE_INDEX,
  type WorkspaceColorName,
} from './orb-palette';
import {
  EMPTY_VOICE_SNAPSHOT,
  HorizonMotion,
  LinearRamp,
  MicSpeakingGate,
  clampUnit,
  solveSpring,
  type VoiceSnapshot,
} from './horizon-motion';
import { HorizonRenderer, type HorizonFrameVariables } from './horizon-renderer';

export interface VoiceOrbProps {
  /**
   * False while the session is still connecting: the orb shows the pulsing dot
   * and only reveals itself once this flips true.
   */
  connected: boolean;
  /** Drives the listening ramp. */
  isUserSpeaking?: boolean;
  /** Drives the speaking ramp and the watercolour drift. */
  isAssistantSpeaking?: boolean;
  /** Mic analyser, for the user-speaking pulse. */
  analyser?: AnalyserNode | null;
  /** Assistant output analyser, for the waveform-driven motion. */
  assistantAnalyser?: AnalyserNode | null;
  palette?: PaletteName;
  /**
   * Workspace colour from the user's profile, which tints the orb.
   *
   * Takes precedence over `palette` when set: this is the app-driven colour, while
   * `palette` is upstream's own name map, kept for the shipped palettes. Undefined
   * leaves `palette` in charge, so an orb rendered without a profile is unchanged.
   */
  workspaceColor?: WorkspaceColorName;
  /** Pre-connection dot colour follows the theme. */
  theme?: 'dark' | 'light';
  /**
   * Scale the shader should draw at — the canvas itself stays at the focus size.
   *
   * Defaults to 1. For the collapse animation, the caller springs this prop from
   * 1 to the ratio `(floatingSize / focusSize)` and back.
   */
  renderScale?: number;
  className?: string;
}

/** Mean magnitude across a frequency-bin range, normalised to 0..1. */
const readBandLevel = (
  analyser: AnalyserNode,
  scratch: Uint8Array,
  minBin: number,
  maxBin: number,
): number => {
  analyser.getByteFrequencyData(scratch);
  const end = Math.min(maxBin, scratch.length);
  if (end <= minBin) return 0;
  let total = 0;
  for (let i = minBin; i < end; i += 1) total += scratch[i];
  return total / (end - minBin) / 255;
};

/** Split a spectrum into N contiguous bands of mean magnitude. */
const readBands = (
  analyser: AnalyserNode,
  scratch: Uint8Array,
  bands: number,
  minBin: number,
  maxBin: number,
): number[] => {
  analyser.getByteFrequencyData(scratch);
  const end = Math.min(maxBin, scratch.length);
  const span = Math.max(1, Math.floor((end - minBin) / bands));
  const out: number[] = [];
  for (let band = 0; band < bands; band += 1) {
    const start = minBin + band * span;
    const stop = band === bands - 1 ? end : start + span;
    let total = 0;
    for (let i = start; i < stop; i += 1) total += scratch[i];
    out.push(stop > start ? total / (stop - start) / 255 : 0);
  }
  return out;
};

export const VoiceOrb: React.FC<VoiceOrbProps> = ({
  connected,
  isUserSpeaking = false,
  isAssistantSpeaking = false,
  analyser = null,
  assistantAnalyser = null,
  palette = 'default',
  workspaceColor,
  theme = 'dark',
  renderScale = 1,
  className,
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  // Live inputs are mirrored into refs so the render loop reads current values
  // without being torn down and rebuilt on every prop change.
  const connectedRef = React.useRef(connected);
  const userSpeakingRef = React.useRef(isUserSpeaking);
  const assistantSpeakingRef = React.useRef(isAssistantSpeaking);
  const analyserRef = React.useRef(analyser);
  const assistantAnalyserRef = React.useRef(assistantAnalyser);
  const paletteRef = React.useRef(palette);
  const workspaceColorRef = React.useRef(workspaceColor);
  const themeRef = React.useRef(theme);
  const renderScaleRef = React.useRef(renderScale);

  connectedRef.current = connected;
  userSpeakingRef.current = isUserSpeaking;
  assistantSpeakingRef.current = isAssistantSpeaking;
  analyserRef.current = analyser;
  assistantAnalyserRef.current = assistantAnalyser;
  paletteRef.current = palette;
  workspaceColorRef.current = workspaceColor;
  themeRef.current = theme;
  renderScaleRef.current = renderScale;

  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;

    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true });
    if (!gl) {
      setFailed(true);
      return;
    }

    let renderer: HorizonRenderer | null = null;
    let frame = 0;
    let disposed = false;

    // Frame counters advance in shader frames, not seconds.
    let waveFrame = 1;
    let baseShaderFrame = 1;
    let textureFlowFrame = 1;
    let previousTime: number | null = null;

    // Ramps and springs held across frames. The ramps are clock-driven linear
    // transitions (extracted from the shipped transition helper), not
    // proportional approaches.
    const listenRampState = new LinearRamp(STATE_RAMP_DURATION_MS);
    const speakRampState = new LinearRamp(STATE_RAMP_DURATION_MS);
    const userSpeakingRampState = new LinearRamp(USER_SPEAKING_RAMP_DURATION_MS);
    const revealRampState = new LinearRamp(REVEAL_RAMP_DURATION_MS);
    const micSpeakingGate = new MicSpeakingGate();
    // Starts at the requested scale rather than 1, so an orb mounted already
    // collapsed does not spring open on its first frame.
    let surfaceScale = renderScaleRef.current;
    let surfaceVelocity = 0;
    let revealAmount = 0;
    const cumulativeAudio = [0, 0, 0, 0];
    let lastCumulativeAt = 0;

    const motionModel = new HorizonMotion();
    let micScratch: Uint8Array | null = null;
    let assistantScratch: Uint8Array | null = null;

    /**
     * Match the backing buffer to the CSS box at the current DPR.
     *
     * Measured from the computed style rather than `getBoundingClientRect()`:
     * the wrapper animates `scale` from 0.2, and a rect is post-transform, so
     * measuring it mid-animation would leave the canvas permanently
     * low-resolution. `offsetWidth` avoids that but rounds, and the box sizes
     * are fractional (204.8px) — rounding up there yields a 256px buffer where
     * the original has 255. Computed style keeps the fraction so the floor
     * matches.
     */
    const resize = () => {
      const computed = parseFloat(getComputedStyle(box).width);
      const cssSize = Math.max(1, Math.floor(Number.isFinite(computed) ? computed : 0));
      const dpr = window.devicePixelRatio || 1;
      const buffer = Math.max(1, Math.floor(cssSize * dpr));
      if (canvas.width !== buffer || canvas.height !== buffer) {
        canvas.width = buffer;
        canvas.height = buffer;
      }
      canvas.style.width = `${cssSize}px`;
      canvas.style.height = `${cssSize}px`;
    };

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(box);
    resize();

    const buildSnapshot = (dt: number, now: number): VoiceSnapshot => {
      const micAnalyser = analyserRef.current;
      const outAnalyser = assistantAnalyserRef.current;

      let micLevel = 0;
      if (micAnalyser) {
        if (!micScratch || micScratch.length !== micAnalyser.frequencyBinCount) {
          micScratch = new Uint8Array(micAnalyser.frequencyBinCount);
        }
        micLevel = clampUnit(
          readBandLevel(
            micAnalyser,
            micScratch,
            MIC_BAND_CONFIG.minFrequencyBin,
            // Upstream's bin 400 resolved against this analyser's own rate, so the
            // band covers the same frequencies here as it does at 48 kHz.
            bandMaxBin(
              micAnalyser.context.sampleRate,
              micAnalyser.fftSize,
              micAnalyser.frequencyBinCount,
            ),
          ) * MIC_LEVEL_SCALE,
        );
      }

      let assistantBands = [0, 0, 0, 0];
      if (outAnalyser) {
        if (!assistantScratch || assistantScratch.length !== outAnalyser.frequencyBinCount) {
          assistantScratch = new Uint8Array(outAnalyser.frequencyBinCount);
        }
        // Same frequency band as the mic, resolved against the playback rate:
        // at 24 kHz the reference index 400 would cover only 4687.5 Hz, which
        // would concentrate all three bands on the low end of the spectrum.
        const assistantMaxBin = bandMaxBin(
          outAnalyser.context.sampleRate,
          outAnalyser.fftSize,
          outAnalyser.frequencyBinCount,
        );
        // Three band magnitudes plus one whole-spectrum magnitude, which is the
        // four-value shape the shader's motion model consumes.
        const bands = readBands(
          outAnalyser,
          assistantScratch,
          ASSISTANT_BAND_CONFIG.bands,
          ASSISTANT_BAND_CONFIG.minFrequencyBin,
          assistantMaxBin,
        );
        const whole = readBandLevel(
          outAnalyser,
          assistantScratch,
          ASSISTANT_BAND_CONFIG.minFrequencyBin,
          assistantMaxBin,
        );
        assistantBands = [...bands, whole];
      }

      // Cumulative audio accumulates on a fixed interval, as upstream does.
      if (now - lastCumulativeAt > AUDIO_UPDATE_INTERVAL_MS) {
        lastCumulativeAt = now;
        for (let i = 0; i < cumulativeAudio.length; i += 1) {
          cumulativeAudio[i] += assistantBands[i] ?? 0;
        }
      }

      // Upstream selects exactly one trigger by session type —
      // `speakingListeningTrigger(){return sessionType()==='vp'?'server':'energy'}`
      // — and a live session here is the non-`vp` path, so mic energy is it.
      //
      // Deliberately not OR-ed with the reported boolean: that boolean stays set
      // for the whole listening window, which would hold the gate open across the
      // turn and erase the per-syllable reaction the energy trigger exists to
      // produce. It is the fallback only when there is no analyser to measure.
      const userSpeaking = micAnalyser
        ? micSpeakingGate.update(micLevel)
        : userSpeakingRef.current;

      // Listening/speaking ramps interpolate linearly toward their targets, taking
      // the full duration to complete when the flag flips. The transition helper
      // upstream is linear over a fixed duration, restarting from wherever the
      // value currently sits if the target changes mid-ramp.
      const listenRamp = listenRampState.update(userSpeaking ? 1 : 0, now);
      const speakRamp = speakRampState.update(assistantSpeakingRef.current ? 1 : 0, now);

      // userSpeakingScale ramps toward 0 or 1 over its own 140 ms duration, with
      // no latch — the upstream wiring feeds the boolean straight through a linear
      // transition and has no hold logic ahead of it.
      const userSpeakingRamp = userSpeakingRampState.update(userSpeaking ? 1 : 0, now);

      const assistantMean =
        assistantBands.reduce((sum, value) => sum + value, 0) / assistantBands.length;
      const assistantPeak = Math.max(...assistantBands.slice(0, 3));

      return {
        stateListen: listenRamp,
        stateSpeak: speakRamp,
        userSpeakingScale: userSpeakingRamp,
        assistantWaveformLevel: assistantMean,
        assistantMotionLevel: assistantPeak,
        cumulativeAudio,
        micLevel,
      };
    };

    const renderFrame = (now: number) => {
      if (disposed || !renderer) return;

      const dt =
        previousTime == null
          ? 0
          : Math.min((now - previousTime) / 1000, MAX_TIMESTEP_SECONDS);
      previousTime = now;

      const snapshot = dt === 0 ? EMPTY_VOICE_SNAPSHOT : buildSnapshot(dt, now);
      const output = dt === 0 ? motionModel.initialOutput() : motionModel.update(snapshot, dt);

      if (dt > 0) {
        waveFrame += dt * SHADER_FRAME_RATE * output.waveMotionSpeed;
        baseShaderFrame += dt * SHADER_FRAME_RATE;
        textureFlowFrame += dt * SHADER_FRAME_RATE * output.textureFlowSpeed;

        // Reveal ramps toward 1 once connected, over the same 500 ms the state
        // ramps use.
        revealAmount = revealRampState.update(connectedRef.current ? 1 : 0, now);

        // The surface scale springs toward whatever the caller asks for, which is
        // how the collapse is animated: the canvas never resizes, the shader
        // shrinks what it draws inside it.
        const spring = solveSpring(
          surfaceScale,
          surfaceVelocity,
          renderScaleRef.current,
          dt,
        );
        surfaceScale = spring.value;
        surfaceVelocity = spring.velocity;
      }

      const dotColor =
        themeRef.current === 'light'
          ? PRE_CONNECTION_DOT_COLOR_LIGHT
          : PRE_CONNECTION_DOT_COLOR_DARK;

      // Read per frame, so switching workspace colour re-tints the running orb
      // rather than waiting for the render loop to be torn down and rebuilt.
      const workspaceIndex =
        workspaceColorRef.current === undefined
          ? undefined
          : WORKSPACE_PALETTE_INDEX[workspaceColorRef.current];

      const variables: HorizonFrameVariables = {
        paletteIndex: workspaceIndex ?? PALETTE_INDEX_BY_NAME[paletteRef.current] ?? 0,
        waveFrame,
        baseShaderFrame,
        waveAmplitude: output.waveAmplitude,
        textureFlowFrame,
        textureEdgeWarp: output.textureEdgeWarp,
        listeningTextureNoiseScale: output.listeningTextureNoiseScale,
        micLevel: snapshot.micLevel,
        surfaceScale,
        userSpeakingScale: snapshot.userSpeakingScale,
        connectionRevealAmount: revealAmount,
        // The dot shows only until the session connects.
        preConnectionDotVisibility: connectedRef.current ? 0 : 1,
        preConnectionDotColor: dotColor,
        speakingWatercolorOffset0: output.speakingWatercolorOffsets[0],
        speakingWatercolorOffset1: output.speakingWatercolorOffsets[1],
        speakingWatercolorOffset2: output.speakingWatercolorOffsets[2],
      };

      renderer.render(variables);
      frame = requestAnimationFrame(renderFrame);
    };

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) return;
      try {
        renderer = new HorizonRenderer(
          gl,
          {
            interiorVertex: interiorVertexSource,
            interiorFragment: interiorFragmentSource,
            compositeVertex: compositeVertexSource,
            compositeFragment: compositeFragmentSource,
          },
          image,
        );
        frame = requestAnimationFrame(renderFrame);
      } catch (error) {
        console.error('[VoiceOrb] renderer init failed:', error);
        setFailed(true);
      }
    };
    image.onerror = () => {
      if (!cancelled) setFailed(true);
    };
    image.src = watercolorUrl;

    return () => {
      cancelled = true;
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      renderer?.dispose();
    };
  }, []);

  // A failed context should leave no empty box behind.
  if (failed) return null;

  return (
    <motion.div
      initial={{ scale: ORB_SCALE_HIDDEN }}
      animate={{ scale: ORB_SCALE_VISIBLE }}
      exit={{ scale: ORB_SCALE_HIDDEN }}
      transition={ORB_TRANSITION}
      className={className ?? 'h-full w-full'}
    >
      {/* Sizing and centring stay on separate nodes, as upstream has them: the
          outer node takes its size from the parent, the inner wrapper fills it
          and centres the canvas. Merging the two makes `h-full` resolve against
          an unsized parent and collapse the canvas.

          The box is sized by the caller rather than here, matching upstream:
          the focus surface owns the size so the canvas can stay at the focus
          size across both states while the shader scales what it draws. */}
      <div ref={boxRef} className="h-full w-full">
        <div className="flex h-full w-full items-center justify-center">
          <canvas ref={canvasRef} className="block" />
        </div>
      </div>
    </motion.div>
  );
};

export default VoiceOrb;
