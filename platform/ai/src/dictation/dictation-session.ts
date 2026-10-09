/**
 * One dictation take, start to finish, on any browser or webview.
 *
 * Every take records the microphone, whatever transcribes it, so no route is a dead end:
 *
 * - **Browser** (the default, "Browser speech recognition"): the browser's recognizer listens
 *   alongside the recording. Its text wins when it worked; when it broke (an error, silent
 *   sessions, or no recognizer at all — Firefox, Brave, the desktop app's WebView2), the
 *   recording is transcribed instead: by a keyed Gemini or OpenAI model when there is one
 *   (seconds), else by Whisper on this device.
 * - **Model** (a Gemini or OpenAI model chosen in Settings): the recording goes to it; if
 *   that fails, to any other keyed model, then on this device.
 * - **On this device**: Whisper in a worker, and nothing else — chosen to keep audio local.
 *
 * A take no one spoke in is silence, not an error, and never reaches a model (Whisper would
 * write "Thank you.").
 */

import {
  canTranscribeAudio,
  isOnDeviceTranscriptionModel,
  selectedTranscriptionCandidate,
  transcribeRecordedAudio,
  transcriptionCandidates,
  transcriptionKeys,
  type TranscriptionCandidate,
} from '../transcription';
import { browserRecognitionAvailable, startBrowserRecognition, type BrowserRecognition } from './browser-recognizer';
import { decodeToMono16k, SILENCE_LEVEL, speechLevel, transcribeOnDevice, warmOnDeviceTranscription } from './on-device-transcription';

export type DictationSource = 'browser' | 'model' | 'on-device';

export interface DictationProgress {
  /** `transcribing` once the take stops; `preparing` while the on-device model first downloads. */
  stage: 'transcribing' | 'preparing';
  /** 0–1, for `preparing`. */
  progress?: number;
}

export interface DictationResult {
  text: string;
  source?: DictationSource;
  /** Why nothing came back, when something failed (a silent take has none). */
  error?: string;
}

export interface DictationSession {
  /** The microphone, for a waveform. */
  readonly stream: MediaStream;
  /** Stops recording and resolves with the transcript. */
  stop(): Promise<DictationResult>;
  /** Throws the take away. */
  cancel(): void;
}

export type DictationStep = { kind: 'model'; candidate: TranscriptionCandidate } | { kind: 'on-device' };

export interface DictationPlan {
  /** What listens while the take runs. `record` alone when the browser has no recognizer. */
  first: 'browser' | 'model' | 'on-device' | 'record';
  /** What transcribes the recording, in order, when the first route gives no text. */
  steps: DictationStep[];
  /** A chosen model that can't be used, and why (the take falls back to the browser). */
  unusableSelection?: string;
}

/** The route and fallback chain for a take, from the settings and the browser. Pure. */
export const planDictation = (
  modelConfig: any,
  apiKeys: unknown,
  environment: { browserRecognizer: boolean },
): DictationPlan => {
  const models = transcriptionCandidates(modelConfig, apiKeys);
  const modelSteps = (exclude?: TranscriptionCandidate): DictationStep[] => models
    .filter((candidate) => !exclude || candidate.provider !== exclude.provider || candidate.modelId !== exclude.modelId)
    .map((candidate) => ({ kind: 'model' as const, candidate }));
  const onDevice: DictationStep = { kind: 'on-device' };

  if (isOnDeviceTranscriptionModel(modelConfig?.systemDefaults?.transcription)) {
    return { first: 'on-device', steps: [onDevice] };
  }

  const selected = selectedTranscriptionCandidate(modelConfig);
  let unusableSelection: string | undefined;
  if (selected) {
    if (!canTranscribeAudio(selected.provider, selected.modelId)) {
      unusableSelection = `${selected.name || selected.modelId} can't transcribe audio`;
    } else if (!transcriptionKeys(modelConfig, apiKeys, selected).length) {
      unusableSelection = `${selected.name || selected.modelId} has no API key`;
    } else {
      return { first: 'model', steps: [{ kind: 'model', candidate: selected }, ...modelSteps(selected), onDevice] };
    }
  }

  // The browser's recognizer (the default). When it can't, a keyed model answers in seconds;
  // Whisper on this device is the floor that needs nothing.
  return {
    first: environment.browserRecognizer ? 'browser' : 'record',
    steps: [...modelSteps(), onDevice],
    unusableSelection,
  };
};

const microphoneError = (error: unknown): Error => {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new Error('Microphone access is blocked. Allow it in the browser or system settings, then try again.');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new Error('No microphone was found.');
  if (name === 'NotReadableError' || name === 'AbortError') return new Error('The microphone is in use by another app.');
  return error instanceof Error ? error : new Error('The microphone could not be started.');
};

const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export interface DictationOptions {
  modelConfig: any;
  apiKeys: unknown;
  /** BCP 47; the browser's language when omitted. */
  language?: string;
  onProgress?: (progress: DictationProgress) => void;
}

/** Starts a take: asks for the microphone, starts recording and, on the browser route, listening. */
export const startDictation = async ({ modelConfig, apiKeys, language, onProgress }: DictationOptions): Promise<DictationSession> => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot record from a microphone.');
  }
  const lang = language || navigator.language || 'en-US';
  const plan = planDictation(modelConfig, apiKeys, { browserRecognizer: browserRecognitionAvailable() });
  if (plan.unusableSelection) console.warn(`[Dictation] ${plan.unusableSelection}; using the browser instead.`);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    throw microphoneError(error);
  }

  const chunks: Blob[] = [];
  let recorder: MediaRecorder | null = null;
  if (typeof MediaRecorder !== 'undefined') {
    const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type));
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.start(1000);
    } catch {
      recorder = null;
    }
  }
  if (!recorder && plan.first !== 'browser') {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('This browser cannot record audio.');
  }

  const warmIfNeeded = () => {
    if (plan.steps[0]?.kind === 'on-device') warmOnDeviceTranscription();
  };
  let recognition: BrowserRecognition | null = null;
  if (plan.first === 'browser') {
    recognition = await startBrowserRecognition({
      language: lang,
      onFailure: (reason) => {
        console.warn(`[Dictation] The browser's speech recognition failed (${reason}); the recording will be transcribed instead.`);
        warmIfNeeded();
      },
    });
  }
  if (plan.first === 'on-device' || plan.first === 'record' || (plan.first === 'browser' && !recognition)) warmIfNeeded();

  const controller = new AbortController();
  const release = () => stream.getTracks().forEach((track) => track.stop());
  const stopRecorder = () => new Promise<Blob | null>((resolve) => {
    if (!recorder || recorder.state === 'inactive') {
      resolve(chunks.length ? new Blob(chunks, { type: recorder?.mimeType || chunks[0]?.type }) : null);
      return;
    }
    const active = recorder;
    active.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: active.mimeType || chunks[0]?.type }) : null);
    try { active.stop(); } catch { resolve(null); }
  });

  return {
    stream,
    async stop() {
      onProgress?.({ stage: 'transcribing' });
      const heard = recognition ? await recognition.stop() : null;
      const audio = await stopRecorder();
      release();
      if (controller.signal.aborted) return { text: '' };
      if (heard && !heard.failed && heard.text) return { text: heard.text, source: 'browser' };
      if (!audio) {
        return heard?.text
          ? { text: heard.text, source: 'browser' }
          : { text: '', error: heard?.failed ? "This browser's speech recognition isn't working here. Choose another model in Settings." : undefined };
      }

      let samples: Float32Array | undefined;
      try {
        samples = await decodeToMono16k(audio);
      } catch {
        samples = undefined;
      }
      // Whether anyone spoke is the recording's to say: a recognizer can end with no text,
      // no error and no `speechstart` while someone talked. Only an undecodable recording
      // leaves it to the recognizer.
      if (samples ? speechLevel(samples) < SILENCE_LEVEL : heard && !heard.failed && !heard.heardSpeech) return { text: '' };

      let firstError = '';
      for (const step of plan.steps) {
        if (controller.signal.aborted) return { text: '' };
        try {
          const text = step.kind === 'on-device'
            ? await transcribeOnDevice(audio, {
                language: lang,
                samples,
                signal: controller.signal,
                onProgress: (progress) => onProgress?.({ stage: progress < 1 ? 'preparing' : 'transcribing', progress }),
              })
            : await transcribeRecordedAudio({ audio, apiKeys, modelConfig, candidate: step.candidate, language: lang, signal: controller.signal });
          onProgress?.({ stage: 'transcribing' });
          if (text.trim()) return { text: text.trim(), source: step.kind === 'on-device' ? 'on-device' : 'model' };
          // A step that heard nothing is believed: the take was silence, not a failure.
          return { text: heard?.text || '', source: heard?.text ? 'browser' : undefined };
        } catch (error) {
          if (controller.signal.aborted) return { text: '' };
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[Dictation] ${step.kind === 'on-device' ? 'On-device transcription' : step.candidate.name || step.candidate.modelId} failed: ${message}`);
          firstError ||= message;
        }
      }
      if (heard?.text) return { text: heard.text, source: 'browser' };
      return { text: '', error: firstError || 'Voice transcription failed. Try again.' };
    },
    cancel() {
      controller.abort();
      recognition?.abort();
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* already stopped */ }
      }
      release();
    },
  };
};
