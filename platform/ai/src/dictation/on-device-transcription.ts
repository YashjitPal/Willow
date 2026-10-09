/**
 * Speech to text on this device: Whisper in a worker (`whisper-worker.ts`), for any browser
 * or webview with WebAssembly — what dictation falls back to when the browser has no
 * recognizer (Firefox, Brave, the desktop app's WebView2) and no API model can take the
 * recording, and what the "On this device" setting always uses.
 */

const SAMPLE_RATE = 16000;
/**
 * The loudest 100ms of a recording, as RMS, below which no one spoke. Whisper does not
 * answer silence with silence — it writes "Thank you." — so a quiet take never reaches it.
 * Speech at a normal distance measures 0.02–0.2 after the browser's gain control.
 */
export const SILENCE_LEVEL = 0.008;

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number) => void;
}>();

const ensureWorker = (): Worker => {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; text?: string; error?: string; progress?: number }>) => {
    const { id, text, error, progress } = event.data;
    // One download serves every take waiting on it, whichever one started it.
    if (typeof progress === 'number') {
      pending.forEach((job) => job.onProgress?.(progress));
      return;
    }
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (error) job.reject(new Error(error));
    else job.resolve(text || '');
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'The on-device speech model could not start.');
    pending.forEach((job) => job.reject(error));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
};

/** A recording as 16 kHz mono samples, the only input Whisper takes. */
export const decodeToMono16k = async (audio: Blob): Promise<Float32Array> => {
  const Context = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await audio.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    await context.close().catch(() => undefined);
  }
};

/** RMS of the loudest 100ms window. */
export const speechLevel = (samples: Float32Array, sampleRate = SAMPLE_RATE): number => {
  const window = Math.max(1, Math.floor(sampleRate / 10));
  let loudest = 0;
  for (let start = 0; start < samples.length; start += window) {
    let sum = 0;
    const end = Math.min(samples.length, start + window);
    for (let index = start; index < end; index += 1) sum += samples[index] * samples[index];
    loudest = Math.max(loudest, Math.sqrt(sum / (end - start)));
  }
  return loudest;
};

/** Whisper's stock outputs for a pause or a noise, which are never what was said. */
const cleanWhisperText = (text: string): string => text
  .replace(/\[[^\]]*\]|\((?:silence|music|applause|laughs?|inaudible|blank_audio)\)/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Starts the model download early (a take that will need it), so it overlaps the speaking. */
let warmed = false;
export const warmOnDeviceTranscription = (): void => {
  if (warmed || typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return;
  warmed = true;
  try {
    const id = nextId++;
    pending.set(id, { resolve: () => undefined, reject: () => { warmed = false; } });
    ensureWorker().postMessage({ id, warm: true });
  } catch {
    warmed = false;
  }
};

export interface OnDeviceOptions {
  /** BCP 47; its language part is Whisper's hint. */
  language?: string;
  /** 0–1 while the model downloads the first time. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  /** Already-decoded samples, when the caller has them. */
  samples?: Float32Array;
}

/** Transcribes a recording on this device. Resolves "" for a take no one spoke in. */
export const transcribeOnDevice = async (audio: Blob, { language, onProgress, signal, samples }: OnDeviceOptions = {}): Promise<string> => {
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
    throw new Error('This browser cannot run the on-device speech model.');
  }
  const input = samples ?? await decodeToMono16k(audio);
  if (speechLevel(input) < SILENCE_LEVEL) return '';
  const id = nextId++;
  const text = await new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    signal?.addEventListener('abort', () => {
      pending.delete(id);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
    ensureWorker().postMessage({ id, samples: input, language: language?.split('-')[0]?.toLowerCase() });
  });
  return cleanWhisperText(text);
};
