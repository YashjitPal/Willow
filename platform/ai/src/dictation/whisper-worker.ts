/**
 * Whisper, off the main thread: a module worker that loads transformers.js once and keeps the
 * pipeline for every later take. Messages in: `{ id, samples, language? }` (16 kHz mono), or
 * `{ id, warm: true }` to load the model only; out: `{ id, progress }` while the model
 * downloads, then `{ id, text }` or `{ id, error }`.
 *
 * transformers.js comes from jsDelivr's `+esm` build rather than npm: the npm package pulls
 * native Node binaries (`sharp`, `onnxruntime-node`) a browser never runs, and this only
 * loads for a take that needs it. WebAssembly runs it in every browser and webview.
 *
 * whisper-tiny, 8-bit: a 39 MB download, cached by the browser after the first, and a 6 s
 * take transcribed in 4.8 s on one WebAssembly thread (measured in Chrome 154). whisper-base
 * heard the same sentence no better and took 11.7 s; single-threaded is all a page without
 * cross-origin isolation gets.
 */

const TRANSFORMERS_JS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/+esm';
const MODEL = 'onnx-community/whisper-tiny';

interface WorkerScope {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const scope = self as unknown as WorkerScope;

type Transcriber = (samples: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string } | Array<{ text?: string }>>;

let transcriber: Promise<Transcriber> | null = null;
let currentId = 0;

const load = (): Promise<Transcriber> => {
  transcriber ??= (async () => {
    const transformers = await import(/* @vite-ignore */ TRANSFORMERS_JS_URL);
    transformers.env.allowLocalModels = false;
    const files = new Map<string, { loaded: number; total: number }>();
    return transformers.pipeline('automatic-speech-recognition', MODEL, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (event: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (event.status !== 'progress' || !event.file || !event.total) return;
        files.set(event.file, { loaded: event.loaded || 0, total: event.total });
        let loaded = 0;
        let total = 0;
        files.forEach((file) => { loaded += file.loaded; total += file.total; });
        scope.postMessage({ id: currentId, progress: total ? loaded / total : 0 });
      },
    }) as Promise<Transcriber>;
  })();
  transcriber.catch(() => { transcriber = null; });
  return transcriber;
};

const textOf = (output: { text?: string } | Array<{ text?: string }>) => (
  Array.isArray(output) ? output.map((part) => part.text || '').join(' ') : output.text || ''
);

scope.onmessage = async (event) => {
  const { id, samples, language, warm } = event.data as { id: number; samples?: Float32Array; language?: string; warm?: boolean };
  currentId = id;
  try {
    const run = await load();
    if (warm || !samples) {
      scope.postMessage({ id, text: '' });
      return;
    }
    const options = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 };
    let output;
    try {
      output = await run(samples, language ? { ...options, language } : options);
    } catch (error) {
      // A language Whisper doesn't know is an error rather than a hint; let it detect.
      if (!language) throw error;
      output = await run(samples, options);
    }
    scope.postMessage({ id, text: textOf(output) });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
