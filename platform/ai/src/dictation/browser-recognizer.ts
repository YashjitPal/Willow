/**
 * The browser's own speech recognition (the Web Speech API), for one dictation take.
 *
 * Chrome, Edge and Safari have one; Firefox doesn't, and Chromium builds without Google's
 * key (Brave, Electron, WebView2 — so the Windows desktop app) have the constructor but no
 * service behind it. So this never decides a take on its own: it reports what it heard and
 * whether it failed, and the session transcribes the recording when it did.
 *
 * Failure comes in two shapes. Loud: an `error` event (`network`, `service-not-allowed`,
 * `not-allowed`, `audio-capture`). Silent: the recognizer hears speech (`speechstart`) and
 * ends with no result and no error — measured in headless Chrome, which has no speech key.
 * Restarting into that forever is what made dictation "listen" and then find nothing.
 */

interface NativeSpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0?: { transcript?: string };
  }>;
}

interface NativeSpeechRecognitionErrorEvent extends Event {
  error?: string;
}

interface NativeSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  processLocally?: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: NativeSpeechRecognitionEvent) => void) | null;
  onerror: ((event: NativeSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
}

type NativeSpeechRecognitionAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface NativeSpeechRecognitionConstructor {
  new (): NativeSpeechRecognition;
  available?: (options: { langs: string[]; processLocally: true }) => Promise<NativeSpeechRecognitionAvailability>;
  install?: (options: { langs: string[]; processLocally: true }) => Promise<boolean>;
}

const getNativeSpeechRecognition = (): NativeSpeechRecognitionConstructor | null => {
  if (typeof window === 'undefined') return null;
  const browserWindow = window as typeof window & {
    SpeechRecognition?: NativeSpeechRecognitionConstructor;
    webkitSpeechRecognition?: NativeSpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition || null;
};

/** Whether this browser has a speech recognizer at all (it may still have no service behind it). */
export const browserRecognitionAvailable = (): boolean => getNativeSpeechRecognition() !== null;

/**
 * Chrome's on-device recognizer, when its language pack is installed. Never holds the take
 * on a download: the standard recognizer answers this one and the pack installs in the
 * background, so the next take runs on the device.
 */
const prepareOnDevice = async (Recognition: NativeSpeechRecognitionConstructor, language: string): Promise<boolean> => {
  if (!Recognition.available || !Recognition.install) return false;
  const options = { langs: [language], processLocally: true as const };
  let availability: NativeSpeechRecognitionAvailability;
  try {
    availability = await Recognition.available(options);
  } catch {
    return false;
  }
  if (availability === 'available') return true;
  if (availability === 'unavailable') return false;
  void Recognition.install(options).catch(() => false);
  return false;
};

/** Errors after which the recognizer will not produce text this take. */
const FATAL_ERRORS = new Set(['network', 'service-not-allowed', 'not-allowed', 'audio-capture', 'bad-grammar', 'language-not-supported']);
/** Sessions that heard speech and ended with nothing, before the recognizer counts as broken. */
const SILENT_ENDS_TO_FAIL = 2;
/** How long `stop()` waits for the final result before taking what it has. */
const FINALIZE_TIMEOUT_MS = 2500;

export interface BrowserRecognitionOutcome {
  text: string;
  /** The recognizer broke (an error, or silent sessions): its text, if any, is not the whole take. */
  failed: boolean;
  /** It detected speech at some point this take (`speechstart`). */
  heardSpeech: boolean;
  /** Why, for the console. */
  reason?: string;
}

export interface BrowserRecognition {
  /** Stops listening and resolves with everything heard, once the recognizer has finalized. */
  stop(): Promise<BrowserRecognitionOutcome>;
  abort(): void;
  /** True as soon as the recognizer is known to be broken, while the take is still running. */
  readonly failed: boolean;
}

export interface BrowserRecognitionOptions {
  /** BCP 47, e.g. `en-US`. */
  language: string;
  /** Everything heard so far (committed sessions plus the live one), on every result. */
  onText?: (text: string) => void;
  /** Called once, the moment the recognizer is known to be broken. */
  onFailure?: (reason: string) => void;
}

/** Starts the browser's recognizer, or resolves null when the browser has none. */
export const startBrowserRecognition = async ({
  language,
  onText,
  onFailure,
}: BrowserRecognitionOptions): Promise<BrowserRecognition | null> => {
  const Recognition = getNativeSpeechRecognition();
  if (!Recognition) return null;
  const onDevice = await prepareOnDevice(Recognition, language);

  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = language;
  recognition.maxAlternatives = 1;
  recognition.processLocally = onDevice;

  let committed = '';
  let session = '';
  let sessionHeardSpeech = false;
  let heardSpeech = false;
  let sessionGotResult = false;
  let silentEnds = 0;
  let failed = false;
  let failure = '';
  let stopping = false;
  let ended = false;
  let finish: (() => void) | null = null;

  const text = () => [committed, session].filter(Boolean).join(' ').trim();
  const fail = (reason: string) => {
    if (failed) return;
    failed = true;
    failure = reason;
    onFailure?.(reason);
  };
  const restart = () => {
    window.setTimeout(() => {
      if (stopping || failed) return;
      try {
        recognition.start();
      } catch (error) {
        // Already listening: the language-pack retry below started it first.
        if ((error as { name?: string } | null)?.name === 'InvalidStateError') return;
        fail(error instanceof Error ? error.message : 'restart failed');
      }
    }, 80);
  };

  recognition.onspeechstart = () => {
    sessionHeardSpeech = true;
    heardSpeech = true;
  };
  recognition.onresult = (event) => {
    let heard = '';
    for (let index = 0; index < event.results.length; index += 1) {
      heard += event.results[index]?.[0]?.transcript || '';
    }
    session = heard.trim();
    sessionGotResult = true;
    silentEnds = 0;
    onText?.(text());
  };
  recognition.onerror = (event) => {
    const error = event.error || 'unknown';
    if (error === 'aborted' || error === 'no-speech') return;
    // A pack can report installed a moment before Chrome can start it: retry this take on
    // the standard recognizer.
    if (error === 'language-not-supported' && recognition.processLocally) {
      recognition.processLocally = false;
      window.setTimeout(() => {
        if (stopping || failed) return;
        try { recognition.start(); } catch { /* onend restarts */ }
      }, 120);
      return;
    }
    if (FATAL_ERRORS.has(error)) fail(error);
  };
  recognition.onend = () => {
    if (session) committed = text();
    const silentSession = sessionHeardSpeech && !sessionGotResult;
    session = '';
    sessionHeardSpeech = false;
    sessionGotResult = false;
    if (stopping) {
      ended = true;
      finish?.();
      return;
    }
    if (failed) return;
    if (silentSession) {
      silentEnds += 1;
      if (silentEnds >= SILENT_ENDS_TO_FAIL) {
        fail('ended without results after hearing speech');
        return;
      }
    }
    // `continuous` is advisory: the recognizer still ends on silence, device changes and
    // some punctuation boundaries. Keep the take alive until the user stops it.
    restart();
  };

  try {
    recognition.start();
  } catch (error) {
    fail(error instanceof Error ? error.message : 'start failed');
  }

  return {
    get failed() {
      return failed;
    },
    stop() {
      stopping = true;
      return new Promise<BrowserRecognitionOutcome>((resolve) => {
        const done = () => resolve({ text: text(), failed, heardSpeech, reason: failure || undefined });
        if (ended || failed) {
          try { recognition.abort(); } catch { /* already stopped */ }
          done();
          return;
        }
        const timer = window.setTimeout(() => {
          finish = null;
          try { recognition.abort(); } catch { /* already stopped */ }
          done();
        }, FINALIZE_TIMEOUT_MS);
        finish = () => {
          window.clearTimeout(timer);
          finish = null;
          done();
        };
        try {
          recognition.stop();
        } catch {
          finish();
        }
      });
    },
    abort() {
      stopping = true;
      try { recognition.abort(); } catch { /* already stopped */ }
    },
  };
};
