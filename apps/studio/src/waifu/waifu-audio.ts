/**
 * Audio, TTS, and Live2D Lip-Sync Pipeline
 * Drives character mouth parameters (ParamMouthOpenY / ParamMouthForm) in real-time
 * via Web Audio frequency analysis or animated speech envelope.
 */

export interface LipSyncTarget {
  setMouth: (openY: number, form: number) => void;
}

let activeTarget: LipSyncTarget | null = null;
let activeRafId: any = null;
let activeIntervalId: any = null;
let activeUtterance: any = null;
let activeAnalyser: AnalyserNode | null = null;
const activeUtterancesSet = new Set<any>();

function safeRequestAnimationFrame(callback: () => void): any {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  const timer = setTimeout(callback, 16);
  if (typeof (timer as any)?.unref === 'function') {
    (timer as any).unref();
  }
  return timer;
}

function safeCancelAnimationFrame(id: any): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(id);
  } else {
    clearTimeout(id);
  }
}

export function registerLipSyncTarget(target: LipSyncTarget | null) {
  activeTarget = target;
}

export function isLipSyncActive(): boolean {
  return activeRafId !== null;
}

/**
 * Real-time high-fidelity Lip Sync driven directly by Web Audio AnalyserNode.
 * Uses instantaneous time-domain RMS waveform amplitude and wideband formant analysis.
 * Perfectly synchronizes Live2D mouth movements with streaming native voice from Gemini Live.
 */
export function startLipSyncFromAnalyser(analyser: AnalyserNode): () => void {
  // If already running on this analyser and RAF loop is active, reuse it
  if (activeAnalyser === analyser && activeRafId !== null) {
    return () => {
      stopLipSync();
    };
  }

  stopLipSync();
  activeAnalyser = analyser;

  const fftSize = analyser.fftSize || 1024;
  const floatTimeData = new Float32Array(fftSize);
  const byteFreqData = new Uint8Array(analyser.frequencyBinCount);
  let smoothedOpenY = 0;
  let smoothedForm = 0;

  const loop = () => {
    // 1. Calculate instantaneous RMS volume from time-domain waveform
    let rms = 0;
    if (typeof analyser.getFloatTimeDomainData === 'function') {
      analyser.getFloatTimeDomainData(floatTimeData);
      let sumSq = 0;
      for (let i = 0; i < floatTimeData.length; i++) {
        const sample = floatTimeData[i];
        sumSq += sample * sample;
      }
      rms = Math.sqrt(sumSq / floatTimeData.length);
    }

    // 2. Sample wideband frequency spectrum for vowel shape (100Hz - 3500Hz)
    analyser.getByteFrequencyData(byteFreqData);
    let lowEnergy = 0;
    let highEnergy = 0;
    const binCount = Math.min(byteFreqData.length, 128);
    for (let i = 2; i < binCount; i++) {
      const v = byteFreqData[i];
      if (i < 32) {
        lowEnergy += v;
      } else {
        highEnergy += v;
      }
    }

    // Strict speech threshold eliminates noise-floor flapping when silent
    const SPEECH_THRESHOLD = 0.008;
    if (rms > SPEECH_THRESHOLD) {
      // Scale dynamic range to mouth opening 0.0 - 1.0 with natural exponent curve
      const normalizedAmp = Math.min(1.0, (rms - SPEECH_THRESHOLD) / 0.12);
      const rawOpenY = Math.min(1.0, Math.pow(normalizedAmp, 0.72));

      // Fast attack for crisp consonant/vowel onset, natural syllable release
      smoothedOpenY = rawOpenY > smoothedOpenY
        ? rawOpenY * 0.88 + smoothedOpenY * 0.12
        : smoothedOpenY * 0.70 + rawOpenY * 0.30;

      // Formant balance controls smiling vowel /i/, /e/ vs round /o/, /u/
      const totalFreq = lowEnergy + highEnergy || 1;
      const rawForm = Math.max(-0.8, Math.min(0.8, (highEnergy - lowEnergy) / totalFreq));
      smoothedForm = smoothedForm * 0.8 + rawForm * 0.2;

      activeTarget?.setMouth(smoothedOpenY, smoothedForm);
    } else {
      // Exponential decay to closed resting position (0) when silent
      smoothedOpenY *= 0.35;
      if (smoothedOpenY < 0.005) {
        smoothedOpenY = 0;
      }
      smoothedForm *= 0.5;
      activeTarget?.setMouth(smoothedOpenY, smoothedForm);
    }

    activeRafId = safeRequestAnimationFrame(loop);
  };

  activeRafId = safeRequestAnimationFrame(loop);

  return () => {
    stopLipSync();
  };
}

/**
 * Stops all active lip-sync loops and returns mouth to closed resting state.
 */
export function stopLipSync() {
  activeAnalyser = null;
  if (activeRafId !== null) {
    safeCancelAnimationFrame(activeRafId);
    activeRafId = null;
  }
  if (activeIntervalId !== null) {
    clearInterval(activeIntervalId);
    activeIntervalId = null;
  }
  activeTarget?.setMouth(0, 0);
}

/**
 * Text-to-Speech playback using the browser's SpeechSynthesis API
 * with immediate animated syllable rhythm driving Live2D Lip-Sync.
 * Prevents Chromium garbage-collection bug and fires mouth animation instantaneously.
 */
export async function speakWithLipSync(
  text: string,
  options?: {
    pitch?: number;
    rate?: number;
    volume?: number;
    lang?: string;
    onEnd?: () => void;
  }
): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return;
  }

  stopSpeaking();

  const spokenText = text
    .replace(/\*[^*]+\*/g, '')
    .replace(/\[[^\]]+\]/g, '')
    .trim();

  if (!spokenText) {
    options?.onEnd?.();
    return;
  }

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.rate = options?.rate ?? 1.05;
    utterance.pitch = options?.pitch ?? 1.25;
    utterance.volume = options?.volume ?? 1.0;

    // Retain persistent reference to prevent Chrome V8 garbage collection dropping events
    activeUtterance = utterance;
    activeUtterancesSet.add(utterance);

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(
      (v) =>
        (v.name.includes('Natural') ||
          v.name.includes('Female') ||
          v.name.includes('Girl') ||
          v.name.includes('Google') ||
          v.name.includes('Zira') ||
          v.name.includes('Samantha')) &&
        v.lang.startsWith('en')
    ) || voices.find((v) => v.lang.startsWith('en')) || voices[0];

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    let isSpeaking = true;
    let animStart = Date.now();
    let safetyTimer: any = null;

    const finish = () => {
      if (!isSpeaking) return;
      isSpeaking = false;
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      activeUtterancesSet.delete(utterance);
      if (activeUtterance === utterance) {
        activeUtterance = null;
      }
      stopLipSync();
      options?.onEnd?.();
      resolve();
    };

    // Boundary-driven phonetic syllable envelope
    let currentWordVowelOpen = 0.65;
    let currentWordVowelForm = 0;
    let wordStartTime = Date.now();
    let wordDurationMs = 280;

    utterance.onboundary = (e: any) => {
      if (e.name === 'word' || !e.name) {
        wordStartTime = Date.now();
        const charIndex = e.charIndex ?? 0;
        const charLength = e.charLength ?? 5;
        const word = spokenText.slice(charIndex, charIndex + charLength).toLowerCase();

        // Detect vowel structure to drive mouth open and form parameters
        if (/[ao]/.test(word)) {
          currentWordVowelOpen = 0.82;
          currentWordVowelForm = -0.15;
        } else if (/[ei]/.test(word)) {
          currentWordVowelOpen = 0.58;
          currentWordVowelForm = 0.42;
        } else if (/u|oo/.test(word)) {
          currentWordVowelOpen = 0.42;
          currentWordVowelForm = -0.38;
        } else {
          currentWordVowelOpen = 0.52;
          currentWordVowelForm = 0.05;
        }
        wordDurationMs = Math.max(160, Math.min(500, Math.max(word.length, 3) * 65));
      }
    };

    const runPhoneticAnimation = () => {
      if (activeRafId !== null) {
        safeCancelAnimationFrame(activeRafId);
        activeRafId = null;
      }
      animStart = Date.now();

      const loop = () => {
        if (!isSpeaking) return;

        const now = Date.now();
        const elapsedSinceWord = now - wordStartTime;
        const wordProgress = Math.min(1.0, elapsedSinceWord / wordDurationMs);

        // Acoustic envelope: quick attack, sustained nucleus, soft release
        let envelope = 0;
        if (wordProgress < 0.25) {
          envelope = wordProgress / 0.25;
        } else if (wordProgress < 0.75) {
          envelope = 1.0 - (wordProgress - 0.25) * 0.3;
        } else {
          envelope = Math.max(0, (1.0 - wordProgress) / 0.25 * 0.7);
        }

        const openY = currentWordVowelOpen * envelope;
        const form = currentWordVowelForm * envelope;

        activeTarget?.setMouth(openY, form);
        activeRafId = safeRequestAnimationFrame(loop);
      };

      activeRafId = safeRequestAnimationFrame(loop);
    };

    utterance.onstart = () => {
      runPhoneticAnimation();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    // Start mouth animation immediately
    runPhoneticAnimation();

    // Safety timeout prevents mouth getting stuck if Chrome drops onend
    const maxDurationMs = Math.max(3000, spokenText.length * 130);
    safetyTimer = setTimeout(finish, maxDurationMs);

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.speak(utterance);
    } catch {
      finish();
    }
  });
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch {}
  }
  activeUtterancesSet.clear();
  activeUtterance = null;
  // If an active live AnalyserNode is currently running, preserve the live audio tap
  if (!activeAnalyser) {
    stopLipSync();
  }
}
