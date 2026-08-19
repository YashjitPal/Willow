/* ════════════════════════════════════════════════════════════════════════════
 * GeminiLiveSession
 *
 * Thin, browser-only wrapper around the Gemini Live API WebSocket endpoint,
 * driving the `gemini-3.1-flash-live-preview` model.
 *
 * What it does
 *   • Opens a WSS bidi stream and sends the setup frame
 *   • Captures the microphone → 16-bit PCM @ 16 kHz → base64 → realtimeInput
 *   • Surfaces three independent text streams via callbacks:
 *       – onUserTranscript   : what *you* said (inputTranscription)
 *       – onModelText        : what the *model* said (modelTurn parts, TEXT)
 *       – onTurnComplete     : server finished this turn (ready for next)
 *   • onTurnStart fires the first time either a transcript *or* a model token
 *     arrives for a new turn — the UI uses this to push the user/assistant
 *     bubbles so the scroll-to-top + reserve logic runs exactly like typed chat.
 *
 * Why raw WebSocket instead of the @google/genai SDK's `client.live.connect`:
 *   the SDK's live client pulls in a Node `ws` polyfill path that bloats the
 *   browser bundle, and we only need ~150 lines of protocol. Keeping it raw
 *   means one fewer dependency surface and full control of reconnection /
 *   frame handling.
 *
 * Protocol reference: https://ai.google.dev/api/live
 * Model card:         https://deepmind.google/models/model-cards/gemini-3-1-flash-audio/
 * ══════════════════════════════════════════════════════════════════════════ */

export const LIVE_MODEL_ID = 'gemini-3.1-flash-live-preview';

// ────────────────────────────────────────────────────────────────────────────
// Live-mode session cues
//
// The connect and end cues are reproduced from measurements of the sounds
// ChatGPT plays, and live in their own module with the data they were built
// from. Re-exported here because this is where callers already import them
// from, and because they belong to a live session conceptually even though
// nothing in this file plays them.
//
// `primeLiveSessionCues()` must be called from the live-button click: a context
// created outside a user gesture starts suspended and the connect cue is lost.
// ────────────────────────────────────────────────────────────────────────────
export { playLiveSessionCue, primeLiveSessionCues, LIVE_SESSION_CUES } from './live-session-cues';


const LIVE_WSS_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// Live API input spec: raw little-endian signed 16-bit PCM, mono, 16 kHz.
// (https://ai.google.dev/gemini-api/docs/live-guide — "audio/pcm;rate=16000")
const INPUT_SAMPLE_RATE = 16_000;
const INPUT_MIME = 'audio/pcm;rate=16000';
// ScriptProcessor buffer: 2048 samples @16 kHz ≈ 128 ms — comfortably inside
// the 20–40 ms-per-chunk *recommendation* once base64 overhead is amortised,
// and large enough that we're not spamming the socket with tiny frames.
const CAPTURE_BUFFER_SIZE = 2048;
// Live API output spec: raw little-endian signed 16-bit PCM, mono, 24 kHz.
// We still parse `rate=` from the inlineData mimeType in case this changes.
const OUTPUT_SAMPLE_RATE_DEFAULT = 24_000;

/**
 * Analyser settings for the visualiser taps.
 *
 * These four values were read off the analysers a live voice session actually
 * built, and the voice orb's motion is calibrated against them: its speaking
 * gate levels were fitted to band means measured under exactly this window and
 * resolution, so changing any of them here invalidates those levels. `fftSize`
 * and `smoothingTimeConstant` are both non-default; the decibel window happens
 * to equal the Web Audio defaults but is set explicitly so a UA default change
 * cannot move it silently. Kept as literals rather than imported from the orb,
 * which sits above this module and would make the dependency circular — see
 * ANALYSER_SETTINGS in features/chat/src/voice-orb/horizon-constants.ts.
 *
 * Only the *settings* transfer. Bin indices do not: these contexts run at 16 kHz
 * (mic) and 24 kHz (playback) against the reference 48 kHz, so a given index
 * covers a different frequency here. Consumers convert a frequency to an index
 * per analyser instead of reusing indices (`bandMaxBin`).
 */
const VISUALISER_ANALYSER = {
  fftSize: 2048,
  smoothingTimeConstant: 0.8,
  minDecibels: -100,
  maxDecibels: -30,
} as const;

function applyVisualiserAnalyserSettings(node: AnalyserNode): void {
  node.fftSize = VISUALISER_ANALYSER.fftSize;
  node.smoothingTimeConstant = VISUALISER_ANALYSER.smoothingTimeConstant;
  // Order matters: the setters reject a window where min >= max, so widening the
  // floor first keeps both assignments valid whatever the incoming defaults are.
  node.minDecibels = VISUALISER_ANALYSER.minDecibels;
  node.maxDecibels = VISUALISER_ANALYSER.maxDecibels;
}

export interface LiveHistoryTurn {
  role: 'user' | 'model';
  text: string;
}

export interface LiveSessionOptions {
  apiKey: string;
  /** Defaults to LIVE_MODEL_ID. Must be a Live-API-capable model. */
  model?: string;
  /** Sent as the session system instruction. */
  systemPrompt?: string;
  /**
   * Prior conversation to prime the session with. Sent as a single
   * `clientContent` frame with `turnComplete:false` right after `setupComplete`,
   * so the model has context but does NOT respond to it.
   */
  history?: LiveHistoryTurn[];
  /**
   * Expose Google Search as a native tool (`tools:[{googleSearch:{}}]` in the
   * setup frame). The model decides if/when to call it — no prompting needed.
   * Defaults to `true`.
   * https://ai.google.dev/gemini-api/docs/live-tools#search-tool
   */
  enableSearch?: boolean;
  /**
   * Prebuilt voice for the model's speech, e.g. `'Kore'`.
   *
   * Sent as `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`. Omitted
   * leaves the API on its own default.
   * https://ai.google.dev/gemini-api/docs/live-guide#change-voice
   */
  voiceName?: string;
  /**
   * BCP-47 code for the model's speech, e.g. `'hi-IN'`.
   *
   * Only sent when `languageMode` is `'speechConfig'`. Native-audio Live models —
   * which is what `LIVE_MODEL_ID` is — pick the language themselves and reject an
   * explicit `languageCode`, so for those the caller steers via the system prompt
   * instead and leaves this unset. Half-cascade models accept it.
   * https://ai.google.dev/gemini-api/docs/live-guide#change-language
   */
  languageCode?: string;
  /** Fired once the server ACKs setup and mic capture has begun. */
  onOpen?: () => void;
  /**
   * A new conversational turn has started — i.e. the server produced its first
   * inputTranscription OR modelTurn token since the last turnComplete. The UI
   * should create the user bubble ("Transcribing…") + assistant placeholder on
   * this signal so spacing/scroll behaves identically to a typed send.
   */
  onTurnStart?: () => void;
  /** Incremental transcript of the user's speech (append-only per turn). */
  onUserTranscript?: (fullTranscript: string) => void;
  /** Incremental model text (delta chunk, not accumulated). */
  onModelText?: (chunk: string) => void;
  /** Server signalled end of this turn. `aborted` = user barge-in interrupted it. */
  onTurnComplete?: (info: { aborted: boolean }) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
  /** Discard all model audio/text and only emit input transcription */
  transcribeOnly?: boolean;
}

export class GeminiLiveSession {
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  // Analysers are read-only taps for visualisers. They sit on side-branches, so
  // they never affect what is sent upstream or what the user hears.
  private micAnalyserNode: AnalyserNode | null = null;
  private outputAnalyserNode: AnalyserNode | null = null;
  private procNode: ScriptProcessorNode | null = null;
  // ── Playback (model → speakers) ──
  private playCtx: AudioContext | null = null;
  private playGain: GainNode | null = null;
  private playCursor = 0; // AudioContext time at which the next chunk should start
  // Keep a small jitter buffer so socket burstiness cannot force sources to be
  // scheduled directly at the render deadline.
  private static readonly PLAYBACK_LEAD_SECONDS = 0.08;
  private activeSources = new Set<AudioBufferSourceNode>();
  private lastAudioRate: number = OUTPUT_SAMPLE_RATE_DEFAULT;
  // Hidden <audio> sink — see initAudio() for why playback is routed through
  // an HTMLMediaElement instead of AudioContext.destination.
  private playSinkEl: HTMLAudioElement | null = null;
  // ── Audio-synced text release ──
  // outputTranscription arrives over the socket far ahead of real-time
  // playback. We queue each text chunk stamped with the play-clock time at
  // which its audio will be heard, and a small drain loop releases it only
  // when playback reaches that point — so on-screen words track the voice.
  private textQueue: { text: string; at: number }[] = [];
  private drainTimer: number | null = null;
  private pendingTurnComplete = false;

  private readonly opts: LiveSessionOptions;
  private ready = false;          // setup ACKed → safe to stream audio
  private turnOpen = false;       // between onTurnStart and onTurnComplete
  private userTranscriptAcc = ''; // accumulated for the current turn
  private disposed = false;
  private micMuted = false;       // see setMicMuted

  constructor(opts: LiveSessionOptions) {
    this.opts = opts;
  }

  // ── Public ────────────────────────────────────────────────────────────────

  /** Acquire mic (user-gesture), then connect the socket and send setup. */
  async start(): Promise<void> {
    if (this.ws) return;

    // 1. Mic + AudioContext FIRST, while we're still inside the click gesture.
    //    Browsers gate both getUserMedia prompts and AudioContext autoplay on
    //    user activation; deferring these to the ws.onmessage callback (as the
    //    original flow did) can silently suspend the context.
    try {
      await this.initAudio();
    } catch (e: any) {
      // Raw DOMException name/message — the in-thread bubble shows the
      // friendly version, this is for diagnosing "site says Ask but no prompt".
      // eslint-disable-next-line no-console
      console.error('[GeminiLive] getUserMedia failed', e?.name, e?.message, e);
      // getUserMedia is only the first step in here; a throw from anything after
      // it leaves an acquired stream with no owner, and nothing else runs on this
      // path. Null-safe throughout, so the common case of failing at the prompt
      // itself is a no-op.
      this.teardownAudio();
      this.opts.onError?.(new Error(describeMicError(e)));
      this.opts.onClose?.();
      return;
    }
    // `stop()` while `initAudio()` was awaiting the getUserMedia prompt: its
    // teardown ran when there was still nothing to tear down, and the stream
    // arrived afterwards. Releasing it here is the only chance — otherwise the
    // mic stays hot and the tab indicator lit for the life of the page, once per
    // abandoned connect. A voice change during the connect window does exactly
    // this, which is how it accumulated.
    if (this.disposed) {
      this.teardownAudio();
      return;
    }

    // 2. Open the bidi socket.
    const url = `${LIVE_WSS_ENDPOINT}?key=${encodeURIComponent(this.opts.apiKey)}`;
    const ws = new WebSocket(url);
    // Some server builds reply with Blob frames; normalise to ArrayBuffer so a
    // single decode path handles both.
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      // First frame MUST be the setup message.
      //
      // KNOWN ISSUE (googleapis/python-genai#2238, Apr 2026): requesting
      // responseModalities:["TEXT"] on gemini-3.1-flash-live-preview makes the
      // server close immediately with `1011 Internal error encountered`. The
      // sanctioned workaround is to request AUDIO + `outputAudioTranscription`
      // and read the reply from the transcript stream while discarding the PCM
      // bytes. Revisit once Google ships the TEXT modality fix.
      const setup = {
        setup: {
          model: `models/${this.opts.model ?? LIVE_MODEL_ID}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            // Voice and language for the spoken output. Left off entirely when
            // neither is set, so a caller that passes nothing gets exactly the
            // request shape this sent before either option existed.
            ...(this.opts.voiceName || this.opts.languageCode
              ? {
                  speechConfig: {
                    ...(this.opts.voiceName
                      ? {
                          voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: this.opts.voiceName },
                          },
                        }
                      : {}),
                    ...(this.opts.languageCode
                      ? { languageCode: this.opts.languageCode }
                      : {}),
                  },
                }
              : {}),
          },
          systemInstruction: this.opts.systemPrompt
            ? { role: 'user', parts: [{ text: this.opts.systemPrompt }] }
            : undefined,
          // Native Google Search grounding — model may invoke it at its own
          // discretion; we don't steer it via the system prompt.
          tools:
            this.opts.enableSearch === false
              ? undefined
              : [{ googleSearch: {} }],
          // Transcribe BOTH directions: input → fills the user bubble,
          // output → the text we actually render (audio is dropped).
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      };
      ws.send(JSON.stringify(setup));
    };

    ws.onmessage = (ev) => this.handleMessage(ev.data);

    // Browsers expose almost nothing on `error`; the close frame carries the
    // real reason. We therefore defer onError to onclose and just flag here.
    let hadSocketError = false;
    ws.onerror = () => { hadSocketError = true; };

    ws.onclose = (ev) => {
      const clean = ev.code === 1000 || this.disposed;
      if (!clean || hadSocketError) {
        const why =
          ev.reason ||
          (ev.code === 1006
            ? 'connection dropped before setup (invalid API key, no Live API access for this key, or network/firewall)'
            : ev.code === 1008 || ev.code === 1011
              ? 'server rejected setup (model id / config)'
              : 'unknown');
        // eslint-disable-next-line no-console
        console.error('[GeminiLive] closed', ev.code, ev.reason);
        this.opts.onError?.(new Error(`Live session closed (${ev.code}): ${why}`));
      }
      this.teardownAudio();
      this.opts.onClose?.();
    };
  }

  /** Stop mic + close socket. Safe to call multiple times. */
  stop(): void {
    this.disposed = true;
    this.teardownAudio();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      try {
        // Best-effort end-of-stream hint so the server can flush a partial turn.
        this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } catch { /* socket may already be closing */ }
      try { this.ws.close(1000); } catch { /* noop */ }
    }
    this.ws = null;
  }

  /**
   * Stop in-flight audio playback immediately and mark the current turn interrupted.
   */
  interrupt(): void {
    this.flushPlayback();
    this.textQueue = [];
    this.pendingTurnComplete = false;
    if (this.turnOpen) {
      this.turnOpen = false;
      this.userTranscriptAcc = '';
      this.opts.onTurnComplete?.({ aborted: true });
    }
  }

  /**
   * Mute the microphone at the source by disabling the capture tracks.
   *
   * Disabling the track rather than gating our own PCM copy is deliberate: it is
   * a real source mute, so the browser tab and OS mic indicators go out and the
   * user can trust that nothing is being heard. It also silences the visualiser
   * for free, since `micAnalyser` is a side-tap off `sourceNode`.
   *
   * A disabled track still produces buffers, just silent ones, so the socket
   * keeps receiving audio frames and the server's voice-activity detection sees
   * an unbroken — merely quiet — timeline instead of a stream that stopped.
   *
   * Recorded even before the graph exists so a mute chosen between `start()` and
   * the mic actually being acquired is not lost.
   */
  setMicMuted(muted: boolean): void {
    this.micMuted = muted;
    this.micStream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  }

  get isMicMuted(): boolean {
    return this.micMuted;
  }

  /**
   * Microphone analyser, for visualisers. Null until the audio graph is built
   * (and if the browser refused to create the node).
   */
  get micAnalyser(): AnalyserNode | null {
    return this.micAnalyserNode;
  }

  /** Model-output analyser, for visualisers. Null in `transcribeOnly` mode. */
  get outputAnalyser(): AnalyserNode | null {
    return this.outputAnalyserNode;
  }

  get isActive(): boolean {
    return !!this.ws && !this.disposed;
  }

  // ── Incoming ──────────────────────────────────────────────────────────────

  private async handleMessage(raw: string | ArrayBuffer | Blob): Promise<void> {
    let text: string;
    if (typeof raw === 'string') {
      text = raw;
    } else if (raw instanceof ArrayBuffer) {
      text = new TextDecoder().decode(raw);
    } else {
      // Blob fallback (binaryType should make this unreachable, but be safe)
      text = await (raw as Blob).text();
    }

    let msg: any;
    try { msg = JSON.parse(text); } catch { return; }

    // Setup ACK — socket is ready; audio graph was already built in start().
    if (msg.setupComplete) {
      this.ready = true;
      // Prime with prior chat history so mid-conversation live mode has full
      // context. `turnComplete:false` = "this is context, don't reply to it".
      const hist = this.opts.history;
      if (hist && hist.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            clientContent: {
              turns: hist.map((h) => ({
                role: h.role,
                parts: [{ text: h.text }],
              })),
              turnComplete: false,
            },
          })
        );
      }
      this.opts.onOpen?.();
      return;
    }

    const sc = msg.serverContent;
    if (!sc) return;

    // User barge-in — server dropped the in-flight generation. Stop talking
    // immediately, discard any queued-but-unspoken text (so the on-screen
    // transcript ends exactly where the voice stopped), then close the turn
    // with `aborted:true` so the UI can append '—' and hide the action row.
    if (sc.interrupted) {
      this.flushPlayback();
      this.textQueue = [];
      this.pendingTurnComplete = false;
      if (this.turnOpen) {
        this.turnOpen = false;
        this.userTranscriptAcc = '';
        this.opts.onTurnComplete?.({ aborted: true });
      }
      return;
    }

    // ── inputTranscription: what *you* said ──
    const inTx = sc.inputTranscription?.text;
    if (typeof inTx === 'string' && inTx.length > 0) {
      this.ensureTurnOpen();
      this.userTranscriptAcc += inTx;
      this.opts.onUserTranscript?.(this.userTranscriptAcc);
    }

    // ── model reply ──
    // outputTranscription streams the model's own words. Processed BEFORE the
    // audio parts in the same frame so `playCursor` at this instant = end of
    // *previously* enqueued audio = the moment THIS chunk's audio will START —
    // i.e. words appear right as they're spoken, not after.
    const outTx = sc.outputTranscription?.text;
    if (typeof outTx === 'string' && outTx.length > 0) {
      if (!this.opts.transcribeOnly) {
        this.ensureTurnOpen();
        this.queueText(outTx);
      }
    }
    // modelTurn parts: text (future-proofing) OR inlineData audio (play it).
    const parts = sc.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (typeof p?.text === 'string' && p.text.length > 0) {
          if (!this.opts.transcribeOnly) {
            this.ensureTurnOpen();
            this.queueText(p.text);
          }
        }
        const inline = p?.inlineData;
        if (inline?.data && typeof inline.data === 'string') {
          if (!this.opts.transcribeOnly) {
            this.ensureTurnOpen();
            this.enqueueAudio(inline.data, inline.mimeType);
          }
        }
      }
    }

    // ── turnComplete / generationComplete ──
    // The server is done, but audio is still playing and text is still queued.
    // Defer the UI-side completion until both drain so the action row / next
    // turn don't appear while the voice is mid-sentence.
    if (sc.turnComplete || sc.generationComplete) {
      if (this.turnOpen) {
        this.pendingTurnComplete = true;
        this.kickDrain();
      }
    }
  }

  private ensureTurnOpen(): void {
    if (this.turnOpen) return;
    this.turnOpen = true;
    this.userTranscriptAcc = '';
    this.pendingTurnComplete = false;
    // New turn: any prior scheduling is meaningless; reset the play clock so
    // the first chunk starts ~now instead of after stale silence.
    if (this.playCtx) this.playCursor = this.playCtx.currentTime;
    this.opts.onTurnStart?.();
  }

  // ── Audio-synced text release ────────────────────────────────────────────

  private queueText(chunk: string): void {
    const ctx = this.playCtx;
    // Stamp with the play-clock moment this chunk should become visible.
    // If no playback context (shouldn't happen), release immediately.
    const at = ctx ? Math.max(this.playCursor, ctx.currentTime) : 0;
    this.textQueue.push({ text: chunk, at });
    this.kickDrain();
  }

  private kickDrain(): void {
    if (this.drainTimer !== null) return;
    const step = () => {
      const ctx = this.playCtx;
      const now = ctx ? ctx.currentTime : Infinity;
      // Release every chunk whose audio moment has arrived.
      while (this.textQueue.length > 0 && this.textQueue[0].at <= now + 0.01) {
        this.opts.onModelText?.(this.textQueue.shift()!.text);
      }
      // Deferred completion: fire once queue is empty AND speakers have caught up.
      if (
        this.pendingTurnComplete &&
        this.textQueue.length === 0 &&
        (!ctx || now >= this.playCursor - 0.02)
      ) {
        this.pendingTurnComplete = false;
        this.turnOpen = false;
        this.userTranscriptAcc = '';
        this.drainTimer = null;
        this.opts.onTurnComplete?.({ aborted: false });
        return;
      }
      if (this.textQueue.length === 0 && !this.pendingTurnComplete) {
        this.drainTimer = null;
        return;
      }
      this.drainTimer = window.setTimeout(step, 30);
    };
    this.drainTimer = window.setTimeout(step, 0);
  }

  // ── Audio capture → PCM16 → base64 → realtimeInput ───────────────────────

  /**
   * Build the full capture graph (getUserMedia → AudioContext → ScriptProcessor)
   * but gate actual socket writes on `this.ready`, so we can call this while
   * still inside the user-gesture (autoplay-safe) and let the WS catch up.
   */
  private async initAudio(): Promise<void> {
    // Each session starts from the documented Live output format. Do not let a
    // missing MIME rate in a later session inherit a value from an old stream.
    this.lastAudioRate = OUTPUT_SAMPLE_RATE_DEFAULT;
    // `mediaDevices` is undefined on insecure origins (non-HTTPS, non-localhost)
    // — catch that explicitly so the user sees a useful message instead of
    // "Cannot read properties of undefined".
    if (!navigator.mediaDevices?.getUserMedia) {
      const err: any = new Error(
        'getUserMedia unavailable (insecure context)'
      );
      err.name = 'SecurityError';
      throw err;
    }
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    // Re-apply a mute requested before the stream existed, and carry the current
    // mute across a reconnect, which builds a fresh stream on the same session.
    if (this.micMuted) this.setMicMuted(true);

    // Request a 16 kHz context so no manual resampling is needed. Supported in
    // all evergreen browsers; fall back to default rate + downsample if not.
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    try {
      this.audioCtx = new Ctx({ sampleRate: INPUT_SAMPLE_RATE });
    } catch {
      this.audioCtx = new Ctx();
    }
    // Chrome may create the context `suspended` outside a gesture; resume is a
    // noop if already running.
    void this.audioCtx.resume?.();
    const actualRate = this.audioCtx.sampleRate;
    const needResample = actualRate !== INPUT_SAMPLE_RATE;

    this.sourceNode = this.audioCtx.createMediaStreamSource(this.micStream);
    // ScriptProcessorNode is deprecated but remains the simplest zero-dependency
    // way to tap raw PCM in every browser. An AudioWorklet would be cleaner but
    // requires a separate module file + bundler wiring.
    this.procNode = this.audioCtx.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1);

    this.procNode.onaudioprocess = (ev) => {
      if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = ev.inputBuffer.getChannelData(0);
      const pcm = needResample
        ? float32ToPCM16(downsample(input, actualRate, INPUT_SAMPLE_RATE))
        : float32ToPCM16(input);
      const b64 = int16ToBase64(pcm);
      this.ws.send(
        JSON.stringify({
          realtimeInput: { audio: { data: b64, mimeType: INPUT_MIME } },
        })
      );
    };

    this.sourceNode.connect(this.procNode);
    // Must be connected to a destination for onaudioprocess to fire in Chrome.
    this.procNode.connect(this.audioCtx.destination);

    // Mic analyser tap for visualisers: a leaf node off the source, so it adds
    // no path to any destination and cannot colour the captured signal.
    try {
      this.micAnalyserNode = this.audioCtx.createAnalyser();
      applyVisualiserAnalyserSettings(this.micAnalyserNode);
      this.sourceNode.connect(this.micAnalyserNode);
    } catch {
      // A visualiser tap is optional; losing it must not break the session.
      this.micAnalyserNode = null;
    }

    // Separate playback context (output is 24 kHz, input is 16 kHz). Create it
    // here — inside the user gesture — so autoplay policy lets it run.
    if (!this.opts.transcribeOnly) {
      try {
        this.playCtx = new Ctx({ sampleRate: OUTPUT_SAMPLE_RATE_DEFAULT });
      } catch {
        this.playCtx = new Ctx();
      }
      void this.playCtx.resume?.();
      this.playGain = this.playCtx.createGain();
      this.playGain.gain.value = 1;

      // Output analyser tap, on the same leaf-node basis as the mic one.
      try {
        this.outputAnalyserNode = this.playCtx.createAnalyser();
        applyVisualiserAnalyserSettings(this.outputAnalyserNode);
        this.playGain.connect(this.outputAnalyserNode);
      } catch {
        this.outputAnalyserNode = null;
      }

      // ── Echo-cancellation workaround ──────────────────────────────────────
      // Chrome's getUserMedia AEC only cancels audio it can "see" on the
      // render side: HTMLMediaElement / WebRTC output. Audio written straight
      // to AudioContext.destination is invisible to it (crbug.com/687574), so
      // the mic re-captures the model's own voice and ships it back as user
      // speech. Routing the Web-Audio graph through a MediaStreamDestination
      // and into a hidden <audio> element puts the model's voice on an
      // AEC-visible path — the mic stream then comes back clean. Falls back to
      // the direct destination if anything here throws.
      try {
        const sink = this.playCtx.createMediaStreamDestination();
        this.playGain.connect(sink);
        const el = new Audio();
        el.srcObject = sink.stream;
        el.autoplay = true;
        // Keep the element attached so iOS/Safari don't GC the stream.
        el.style.display = 'none';
        document.body.appendChild(el);
        void el.play().catch(() => {});
        this.playSinkEl = el;
      } catch {
        this.playGain.connect(this.playCtx.destination);
      }
    }
    this.playCursor = 0;
  }

  // ── Playback: gapless PCM queue ──────────────────────────────────────────
  // Each inbound chunk is scheduled to start exactly where the previous one
  // ends (`playCursor`), so the model's speech is seamless regardless of how
  // bursty the socket is. On barge-in / stop we hard-flush the queue.

  private enqueueAudio(b64: string, mimeType?: string): void {
    const ctx = this.playCtx;
    const gain = this.playGain;
    if (!ctx || !gain) return;

    const rate = parseRate(mimeType) ?? this.lastAudioRate;
    this.lastAudioRate = rate;
    const float = base64PCM16ToFloat32(b64);
    if (float.length === 0) return;

    const buf = ctx.createBuffer(1, float.length, rate);
    buf.copyToChannel(float, 0);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);

    const now = ctx.currentTime;
    // A larger lead absorbs normal WebSocket delivery jitter. Starting chunks
    // only 20ms ahead made occasional late sources audible as clicks or pitchy
    // boundary artifacts on a busy browser audio thread.
    const startAt = Math.max(this.playCursor, now + GeminiLiveSession.PLAYBACK_LEAD_SECONDS);
    src.start(startAt);
    this.playCursor = startAt + buf.duration;

    this.activeSources.add(src);
    src.onended = () => this.activeSources.delete(src);
  }

  private flushPlayback(): void {
    for (const s of this.activeSources) {
      try { s.stop(); } catch { /* already ended */ }
    }
    this.activeSources.clear();
    if (this.playCtx) this.playCursor = this.playCtx.currentTime;
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  private teardownAudio(): void {
    this.flushPlayback();
    try { this.procNode?.disconnect(); } catch { /* noop */ }
    try { this.sourceNode?.disconnect(); } catch { /* noop */ }
    try { this.micAnalyserNode?.disconnect(); } catch { /* noop */ }
    try { this.audioCtx?.close(); } catch { /* noop */ }
    try { this.playGain?.disconnect(); } catch { /* noop */ }
    try { this.outputAnalyserNode?.disconnect(); } catch { /* noop */ }
    try { this.playCtx?.close(); } catch { /* noop */ }
    if (this.playSinkEl) {
      try {
        this.playSinkEl.pause();
        this.playSinkEl.srcObject = null;
        this.playSinkEl.remove();
      } catch { /* noop */ }
    }
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.procNode = null;
    this.sourceNode = null;
    this.micAnalyserNode = null;
    this.audioCtx = null;
    this.micStream = null;
    this.playCtx = null;
    this.playGain = null;
    this.outputAnalyserNode = null;
    this.playSinkEl = null;
  }
}

// ── Mic-error → human-readable ──────────────────────────────────────────────
// Browsers never re-prompt for a permission the user already blocked, and
// `mediaDevices` doesn't exist at all on insecure origins — both look like
// "live mode instantly errors with no prompt". Map the DOMException name to
// something actionable so the in-thread error bubble actually helps.
function describeMicError(e: any): string {
  const name: string = e?.name || '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return (
        'Microphone access is blocked for this site. Click the 🔒 / 🎤 icon ' +
        'in the address bar → Site settings → set **Microphone** to *Allow*, ' +
        'then try again.'
      );
    case 'SecurityError':
      return (
        'Microphone access requires a secure context. Open the app over ' +
        '**https://** or **http://localhost** — browsers disable ' +
        '`getUserMedia` on plain-HTTP IP addresses.'
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError':
      return (
        'The microphone is in use by another application (or the OS denied ' +
        'access). Close the other app / check OS privacy settings and retry.'
      );
    case 'OverconstrainedError':
      return 'The requested microphone settings aren’t supported on this device.';
    default:
      return `Microphone unavailable: ${e?.message || e}`;
  }
}

// ── PCM helpers ─────────────────────────────────────────────────────────────

function float32ToPCM16(buf: Float32Array): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Naive linear downsampler — fine for speech into a speech model. */
function downsample(buf: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buf;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(buf.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = buf[Math.floor(i * ratio)];
  }
  return out;
}

function parseRate(mime?: string): number | undefined {
  const m = mime?.match(/rate=(\d+)/);
  return m ? parseInt(m[1], 10) : undefined;
}

function base64PCM16ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const len = bin.length;
  // len should be even (2 bytes/sample); guard against an odd trailing byte.
  const samples = len >> 1;
  const out = new Float32Array(samples);
  for (let i = 0, j = 0; i < samples; i++, j += 2) {
    // little-endian signed 16-bit
    let s = bin.charCodeAt(j) | (bin.charCodeAt(j + 1) << 8);
    if (s >= 0x8000) s -= 0x10000;
    out[i] = s / 0x8000;
  }
  return out;
}

function int16ToBase64(pcm: Int16Array): string {
  // Int16Array → raw little-endian bytes → base64. Chunked to keep
  // String.fromCharCode argument lists under engine limits.
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[]
    );
  }
  return btoa(bin);
}
