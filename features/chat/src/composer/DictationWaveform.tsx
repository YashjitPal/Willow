// Live canvas waveform shown while the user is dictating into the composer.
//
// Draws mirrored bars on a <canvas> from a MediaStream's analyser node, with a
// smoothed history so quiet speech doesn't collapse the display. Pure visual —
// the recording/transcription lifecycle lives in Composer's InputBar.
import React from 'react';

const DICTATION_WAVE_MIN_HEIGHT = 4;
const DICTATION_WAVE_BAR_PITCH = 7;

const getDictationWaveHeight = (canvasHeight: number, normalizedLevel: number) => {
  const threeQuarterHeight = canvasHeight * 0.75;

  if (normalizedLevel <= 0.1) return DICTATION_WAVE_MIN_HEIGHT;
  if (normalizedLevel < 0.75) {
    return DICTATION_WAVE_MIN_HEIGHT
      + ((normalizedLevel - 0.1) / 0.65)
      * (threeQuarterHeight - DICTATION_WAVE_MIN_HEIGHT);
  }

  return threeQuarterHeight
    + ((normalizedLevel - 0.75) / 0.25)
    * (canvasHeight - threeQuarterHeight);
};

const drawDictationWaveBar = (
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  height: number,
  color: string,
) => {
  context.fillStyle = color;

  const x = centerX - 0.5;
  const y = centerY - height / 2;
  const width = 1;
  const radius = Math.min(0.5, height / 2);

  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
  context.fill();
};

const DictationWaveform = ({ stream }: { stream: MediaStream | null }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!container || !canvas || !context) return;

    let disposed = false;
    let animationFrame = 0;
    let sampleTimer = 0;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let audioSamples: Float32Array | null = null;

    let barsPerSide = 0;
    let targetHistory: number[] = [];
    let renderedHeights: number[] = [];
    let queuedLevels: number[] = [];
    let lastLevel = 0;
    let missedLevelUpdates = 0;
    let lastHistoryUpdate = 0;
    let audioMeterReady = false;
    const visualizerStartedAt = performance.now();

    const resizeCanvas = (width: number, height: number) => {
      const sideInset = window.matchMedia('(max-width: 767px)').matches ? 24 : 48;
      const nextWidth = Math.max(3, Math.floor(width - sideInset * 2));
      const nextHeight = Math.max(1, Math.floor(height || 24));
      const nextBarsPerSide = Math.floor(nextWidth / 2 / DICTATION_WAVE_BAR_PITCH);
      const dimensionsChanged = canvas.width !== nextWidth || canvas.height !== nextHeight;
      const waveBuffersMissing = targetHistory.length !== nextBarsPerSide + 1
        || renderedHeights.length !== nextBarsPerSide * 2 + 1;

      if (!dimensionsChanged && !waveBuffersMissing) return;

      if (dimensionsChanged) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      barsPerSide = nextBarsPerSide;
      targetHistory = Array(barsPerSide + 1).fill(DICTATION_WAVE_MIN_HEIGHT);
      renderedHeights = Array(barsPerSide * 2 + 1).fill(DICTATION_WAVE_MIN_HEIGHT);
    };

    const initialRect = container.getBoundingClientRect();
    resizeCanvas(initialRect.width || 200, initialRect.height || 24);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            resizeCanvas(entry.contentRect.width, entry.contentRect.height);
          }
        })
      : null;
    resizeObserver?.observe(container);

    const sampleAudio = () => {
      if (!analyser || !audioSamples) return;

      analyser.getFloatTimeDomainData(audioSamples);
      let sumOfSquares = 0;
      for (let index = 0; index < audioSamples.length; index += 1) {
        const sample = audioSamples[index];
        sumOfSquares += sample * sample;
      }

      queuedLevels.push(Math.sqrt(sumOfSquares / audioSamples.length));
    };

    const updateWaveHistory = (now: number) => {
      let level: number;

      if (queuedLevels.length > 0) {
        level = queuedLevels.shift() ?? 0;
        lastLevel = level;
        missedLevelUpdates = 0;
      } else if (!audioMeterReady) {
        // The browser can take a moment to initialize its analyser after the
        // microphone stream is acquired. Gemini still renders
        // its butterfly immediately, so keep a quiet living waveform on screen
        // during that warm-up rather than showing an apparently blank state.
        const elapsed = (now - visualizerStartedAt) / 1000;
        level = 0.022
          + Math.max(0, Math.sin(elapsed * 3.1)) * 0.012
          + Math.max(0, Math.sin(elapsed * 5.7 + 1.2)) * 0.006;
      } else {
        missedLevelUpdates += 1;
        level = missedLevelUpdates <= 3 ? lastLevel : 0;
      }

      const centerHeight = level > 0
        ? getDictationWaveHeight(
            canvas.height,
            Math.min(1, Math.max(0, level * 15)),
          )
        : DICTATION_WAVE_MIN_HEIGHT;

      targetHistory = [centerHeight, ...targetHistory];
      if (targetHistory.length > barsPerSide + 1) targetHistory.pop();
    };

    const render = (now: number) => {
      if (disposed) return;

      if (now - lastHistoryUpdate >= 30) {
        updateWaveHistory(now);
        lastHistoryUpdate = now;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);

      const centerY = canvas.height / 2;
      const barCount = barsPerSide * 2 + 1;
      const occupiedWidth = barCount + (barCount - 1) * 6;
      const startX = (canvas.width - occupiedWidth) / 2 + 0.5;
      const color = getComputedStyle(canvas)
        .getPropertyValue('--willow-dictation-wave-color')
        .trim() || '#e0e0e0';

      for (let index = 0; index < barCount; index += 1) {
        const distanceFromCenter = Math.abs(index - barsPerSide);
        const targetHeight = Math.max(
          DICTATION_WAVE_MIN_HEIGHT,
          (targetHistory[distanceFromCenter] || DICTATION_WAVE_MIN_HEIGHT)
            * (1 - distanceFromCenter / (barsPerSide + 1)),
        );

        renderedHeights[index] += (targetHeight - renderedHeights[index]) * 0.25;
        drawDictationWaveBar(
          context,
          startX + index * DICTATION_WAVE_BAR_PITCH,
          centerY,
          renderedHeights[index],
          color,
        );
      }

      animationFrame = requestAnimationFrame(render);
    };

    async function initAudio() {
      if (!stream) return;
      try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        audioSamples = new Float32Array(analyser.fftSize);
        await audioCtx.resume().catch(() => undefined);
        audioMeterReady = true;
      } catch {
        // Keep the immediate low-amplitude butterfly when metering is unavailable.
      }
    }

    sampleTimer = window.setInterval(sampleAudio, 50);
    animationFrame = requestAnimationFrame(render);
    initAudio();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      window.clearInterval(sampleTimer);
      resizeObserver?.disconnect();
      if (audioCtx) void audioCtx.close();
    };
  }, [stream]);

  return (
    <div
      ref={containerRef}
      className="willow-butterfly-wave-view entering-dictation"
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="willow-butterfly-wave-canvas" />
    </div>
  );
};


export { DictationWaveform };
