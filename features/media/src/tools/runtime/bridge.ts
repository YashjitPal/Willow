/**
 * The host half of Flow's tool runtime: compiles a tool, puts it in a sandboxed frame, hands
 * the frame the SDK's MessagePort, and answers every `FLOW_*` request through a `ToolSdkHost`.
 * The requests and their payloads are Flow's (`flow-sdk-source.ts` is the other end); so are
 * the events a view sees (compiling, compile_error, app_mounted, runtime_error, csp_violation)
 * and the camera and microphone, which run in the host page and reach the tool as frames and
 * recordings, as Flow's do.
 */
import { compileTool, type CompileResult, type ToolFile } from './compiler';
import { buildRunnerDocument } from './runner-html';

export type MediaFilter = 'image' | 'video' | 'audio' | 'all';

export interface ToolMediaItem {
  mediaId: string;
  base64: string;
  mimeType: string;
  type: 'image' | 'video' | 'audio';
  name: string;
}

export interface GenerateImagePayload {
  prompt: string;
  modelDisplayName?: string;
  referenceImageMediaIds?: string[];
  aspectRatio: string;
}

export interface GenerateVideoPayload {
  prompt: string;
  modelDisplayName?: string;
  firstFrameImageMediaId?: string;
  lastFrameImageMediaId?: string;
  referenceImageMediaIds?: string[];
  sourceVideoMediaId?: string;
  sourceVideoMode?: string;
  audioReferenceMediaIds?: string[];
  aspectRatio: string;
  durationSeconds?: number;
  resolution?: string;
}

export interface InlineMedia {
  base64: string;
  mimeType: string;
}

export interface GenerateTextPayload {
  prompt: string;
  systemInstruction?: string;
  thinkingLevel?: 'low' | 'medium' | 'high';
  images?: InlineMedia[];
  videos?: InlineMedia[];
  audios?: InlineMedia[];
}

export type StorageValue = string | number | boolean | null | StorageValue[] | { [key: string]: StorageValue };

export interface ToolStorage {
  getItem(key: string): Promise<StorageValue | null>;
  setItem(key: string, value: StorageValue): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

/** What a running tool may ask Willow for. Every method rejects with a message for the tool. */
export interface ToolSdkHost {
  generateImage(payload: GenerateImagePayload): Promise<{ mediaId: string; base64: string; mimeType: string }>;
  generateVideo(payload: GenerateVideoPayload): Promise<{ mediaId: string; base64: string; mimeType: string }>;
  generateText(payload: GenerateTextPayload): Promise<{ text: string }>;
  /** Flow.save puts the file in the gallery with a snackbar; Flow.upload quietly. */
  saveMedia(file: { base64: string; mimeType: string; name: string }, options: { announce: boolean }): Promise<{ id: string }>;
  selectMedia(request: { filter: MediaFilter; multiple: boolean; maxCount?: number; preSelectedIds?: string[] }): Promise<ToolMediaItem[] | null>;
  mediaBase64(mediaId: string): Promise<{ base64: string; mimeType: string }>;
  storage: ToolStorage;
  /** The tool's localStorage changed (the frame's shim reports every change). */
  persistLocalStorage(entries: Record<string, string>): void;
}

export type RunnerEvent =
  | { type: 'compiling' }
  | { type: 'compile_error'; errors: string[] }
  | { type: 'sdk_ready' }
  | { type: 'app_mounted' }
  | { type: 'runtime_error'; error: string; stack: string }
  | { type: 'csp_violation'; blockedURI: string; violatedDirective: string; effectiveDirective: string };

export const RUNNER_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock';
const RUNNER_ALLOW = 'clipboard-read; clipboard-write; fullscreen; autoplay; display-capture';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []);

const RESOLUTIONS: Record<string, { width: number; height: number }> = {
  low: { width: 640, height: 360 },
  medium: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 },
};

const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
  reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
  reader.readAsDataURL(blob);
});

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/^data:[^,]*,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 16-bit PCM WAV of an AudioBuffer, mixed down to at most two channels. */
function encodeWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + frames * channels * 2));
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i += 1) data.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF');
  data.setUint32(4, 36 + frames * channels * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, channels, true);
  data.setUint32(24, buffer.sampleRate, true);
  data.setUint32(28, buffer.sampleRate * channels * 2, true);
  data.setUint16(32, channels * 2, true);
  data.setUint16(34, 16, true);
  write(36, 'data');
  data.setUint32(40, frames * channels * 2, true);
  const inputs = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const sample = Math.max(-1, Math.min(1, inputs[c]![i]!));
      data.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([data.buffer], { type: 'audio/wav' });
}

interface CameraStream {
  id: string;
  stream: MediaStream;
  video: HTMLVideoElement;
  timer: number;
}

/**
 * One running tool. `run` replaces whatever ran before (a new version, Reload, Reset); `dispose`
 * tears the frame, the port and any camera down.
 */
export class ToolRunner {
  private frame: HTMLIFrameElement | null = null;
  private port: MessagePort | null = null;
  private runId = 0;
  private camera: CameraStream | null = null;
  private readonly onWindowMessage = (event: MessageEvent) => this.handleFrameMessage(event);
  private readonly onVisibility = () => { if (document.visibilityState === 'hidden') this.stopCamera(); };

  constructor(
    private readonly container: HTMLElement,
    private host: ToolSdkHost,
    private readonly emit: (event: RunnerEvent) => void,
  ) {
    window.addEventListener('message', this.onWindowMessage);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  setHost(host: ToolSdkHost): void {
    this.host = host;
  }

  /** The live frame, for drag-and-drop and tests. */
  get iframe(): HTMLIFrameElement | null {
    return this.frame;
  }

  async run(
    files: readonly ToolFile[],
    localStorage: Record<string, string> = {},
    options: { compiled?: CompileResult; probeScript?: string } = {},
  ): Promise<void> {
    const run = ++this.runId;
    this.teardownFrame();
    this.emit({ type: 'compiling' });
    const result = options.compiled ?? await compileTool(files);
    if (run !== this.runId) return;
    if (result.success === false) {
      this.emit({ type: 'compile_error', errors: result.errors });
      return;
    }
    const styles = files.filter((f) => f.path.endsWith('.css')).map((f) => ({ name: f.path, content: f.content }));
    const html = buildRunnerDocument({
      code: result.code,
      externalImports: result.externalImports,
      styles,
      parentOrigin: window.location.origin,
      localStorage,
      probeScript: options.probeScript,
    });
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', RUNNER_SANDBOX);
    frame.setAttribute('allow', RUNNER_ALLOW);
    frame.style.cssText = 'border:0;width:100%;height:100%;display:block;background:transparent';
    frame.srcdoc = html;
    this.frame = frame;
    this.container.appendChild(frame);
  }

  dispose(): void {
    this.runId += 1;
    this.teardownFrame();
    window.removeEventListener('message', this.onWindowMessage);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Posts a host-to-frame message on the SDK's port (drag over, drop). */
  post(message: Record<string, unknown>): void {
    this.port?.postMessage(message);
  }

  private teardownFrame(): void {
    this.stopCamera();
    this.port?.close();
    this.port = null;
    this.frame?.remove();
    this.frame = null;
  }

  private handleFrameMessage(event: MessageEvent): void {
    if (!this.frame || event.source !== this.frame.contentWindow) return;
    const data = event.data;
    if (!isRecord(data)) return;
    switch (data.type) {
      case 'WILLOW_RUNNER_READY':
        this.connectPort();
        return;
      case 'WILLOW_TOOL_STORAGE':
        if (isRecord(data.entries)) {
          this.host.persistLocalStorage(Object.fromEntries(Object.entries(data.entries).map(([k, v]) => [k, String(v)])));
        }
        return;
      case 'FLOW_APP_MOUNTED':
        this.emit({ type: 'app_mounted' });
        return;
      case 'FLOW_RUNTIME_ERROR': {
        const payload = isRecord(data.payload) ? data.payload : {};
        this.emit({ type: 'runtime_error', error: String(payload.error ?? 'Unknown error'), stack: String(payload.stack ?? '') });
        return;
      }
      case 'FLOW_CSP_VIOLATION': {
        const payload = isRecord(data.payload) ? data.payload : {};
        this.emit({
          type: 'csp_violation',
          blockedURI: String(payload.blockedURI ?? ''),
          violatedDirective: String(payload.violatedDirective ?? ''),
          effectiveDirective: String(payload.effectiveDirective ?? ''),
        });
        return;
      }
      default:
    }
  }

  private connectPort(): void {
    const frame = this.frame;
    if (!frame?.contentWindow || this.port) return;
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (event) => { void this.handleRequest(event.data); };
    frame.contentWindow.postMessage({ kind: 'port_init' }, '*', [channel.port2]);
    this.emit({ type: 'sdk_ready' });
  }

  private async handleRequest(data: unknown): Promise<void> {
    if (!isRecord(data) || typeof data.id !== 'number' || typeof data.type !== 'string') return;
    const port = this.port;
    const id = data.id;
    try {
      const payload = await this.dispatch(data.type, isRecord(data.payload) ? data.payload : {});
      port?.postMessage({ type: 'FLOW_RESPONSE', id, payload });
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message : 'Service temporarily unavailable. Please try again.';
      port?.postMessage({ type: 'FLOW_RESPONSE', id, error: message });
    }
  }

  private async dispatch(type: string, payload: Record<string, unknown>): Promise<unknown> {
    const host = this.host;
    switch (type) {
      case 'FLOW_GEN_IMAGE': {
        const prompt = str(payload.prompt);
        if (!prompt) throw new Error('Flow.generate.image() needs a prompt.');
        return host.generateImage({
          prompt,
          modelDisplayName: str(payload.modelDisplayName),
          referenceImageMediaIds: strList(payload.referenceImageMediaIds),
          aspectRatio: str(payload.aspectRatio) ?? '16:9',
        });
      }
      case 'FLOW_GEN_VIDEO': {
        const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
        const mode = str(payload.sourceVideoMode);
        const duration = typeof payload.durationSeconds === 'number' ? payload.durationSeconds : undefined;
        if (mode === 'extend') {
          if (!str(payload.sourceVideoMediaId)) throw new Error('Extending a video needs sourceVideoMediaId.');
          if (str(payload.firstFrameImageMediaId) || str(payload.lastFrameImageMediaId)) throw new Error('Extending a video takes no first or last frame.');
          if (duration !== undefined && ![4, 6, 8, 10].includes(duration)) throw new Error(`Unsupported extension length: ${duration}`);
        }
        return host.generateVideo({
          prompt,
          modelDisplayName: str(payload.modelDisplayName),
          firstFrameImageMediaId: str(payload.firstFrameImageMediaId),
          lastFrameImageMediaId: str(payload.lastFrameImageMediaId),
          referenceImageMediaIds: strList(payload.referenceImageMediaIds),
          sourceVideoMediaId: str(payload.sourceVideoMediaId),
          sourceVideoMode: mode,
          audioReferenceMediaIds: strList(payload.audioReferenceMediaIds),
          aspectRatio: str(payload.aspectRatio) ?? '16:9',
          durationSeconds: duration,
          resolution: str(payload.resolution),
        });
      }
      case 'FLOW_GEN_TEXT': {
        const level = payload.thinkingLevel;
        const media = (v: unknown): InlineMedia[] | undefined => (Array.isArray(v)
          ? v.filter(isRecord).map((m) => ({ base64: String(m.base64 ?? '').replace(/^data:[^,]*,/, ''), mimeType: String(m.mimeType ?? '') })).filter((m) => m.base64)
          : undefined);
        return host.generateText({
          prompt: typeof payload.prompt === 'string' ? payload.prompt : '',
          systemInstruction: str(payload.systemInstruction),
          thinkingLevel: level === 'low' || level === 'medium' || level === 'high' ? level : undefined,
          images: media(payload.images),
          videos: media(payload.videos),
          audios: media(payload.audios),
        });
      }
      case 'FLOW_SAVE':
      case 'FLOW_UPLOAD': {
        const base64 = str(payload.base64)?.trim().replace(/^data:[^,]*,/, '');
        if (!base64) throw new Error('No file content to save.');
        const mimeType = str(payload.mimeType)?.trim() || 'image/png';
        const name = str(payload.name)?.trim() || 'Mini-app output';
        const saved = await host.saveMedia({ base64, mimeType, name }, { announce: type === 'FLOW_SAVE' });
        return { id: saved.id, mediaId: saved.id };
      }
      case 'FLOW_DOWNLOAD': {
        const base64 = str(payload.base64)?.trim().replace(/^data:[^,]*,/, '');
        if (!base64) throw new Error('Base64 content is required.');
        const mimeType = str(payload.mimeType)?.trim() || 'application/octet-stream';
        const ext = mimeType.split('/')[1]?.split(/[;+]/)[0] || 'bin';
        const filename = str(payload.filename)?.trim() || `download.${ext}`;
        const url = URL.createObjectURL(new Blob([base64ToBytes(base64) as BlobPart], { type: mimeType }));
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        try { a.click(); } finally { a.remove(); }
        setTimeout(() => URL.revokeObjectURL(url), 100);
        return { isSuccess: true };
      }
      case 'FLOW_SELECT_MEDIA':
      case 'FLOW_SELECT_MEDIA_MULTI': {
        const raw = payload.filter ?? payload.type;
        const filter: MediaFilter = raw === 'image' || raw === 'video' || raw === 'audio' ? raw : 'all';
        const multiple = type === 'FLOW_SELECT_MEDIA_MULTI';
        const picked = await host.selectMedia({
          filter,
          multiple,
          maxCount: typeof payload.maxCount === 'number' ? payload.maxCount : undefined,
          preSelectedIds: multiple ? strList(payload.preSelectedIds) : str(payload.preSelectId) ? [String(payload.preSelectId)] : [],
        });
        if (!picked || picked.length === 0) return multiple ? [] : null;
        return multiple ? picked : picked[0];
      }
      case 'FLOW_MEDIA_GET_BASE64': {
        const mediaId = str(payload.mediaId);
        if (!mediaId) throw new Error('A mediaId is required.');
        return host.mediaBase64(mediaId);
      }
      case 'FLOW_CAPTURE_CAMERA':
        return this.captureCamera(payload.facingMode === 'environment' ? 'environment' : 'user');
      case 'FLOW_CAMERA_STREAM_START':
        return this.startCamera(payload);
      case 'FLOW_CAMERA_STREAM_STOP': {
        const streamId = str(payload.streamId);
        if (!streamId) throw new Error('A streamId is required.');
        if (this.camera?.id === streamId) this.stopCamera();
        return { isStopped: true };
      }
      case 'FLOW_RECORD_MIC':
        return this.recordMicrophone(typeof payload.durationMs === 'number' ? payload.durationMs : 5000);
      case 'FLOW_STORAGE_GET_ITEM':
        if (typeof payload.key !== 'string') throw new Error('A storage key is required.');
        return host.storage.getItem(payload.key);
      case 'FLOW_STORAGE_SET_ITEM':
        if (typeof payload.key !== 'string') throw new Error('A storage key is required.');
        if (!('value' in payload)) throw new Error('A storage value is required.');
        await host.storage.setItem(payload.key, payload.value as StorageValue);
        return null;
      case 'FLOW_STORAGE_REMOVE_ITEM':
        if (typeof payload.key !== 'string') throw new Error('A storage key is required.');
        await host.storage.removeItem(payload.key);
        return null;
      case 'FLOW_STORAGE_CLEAR':
        await host.storage.clear();
        return null;
      case 'FLOW_STORAGE_KEYS':
        return host.storage.keys(typeof payload.prefix === 'string' ? payload.prefix : undefined);
      default:
        throw new Error(`Unsupported request: ${type}`);
    }
  }

  private async openCamera(facingMode: string, width: number, height: number, frameRate?: number): Promise<{ stream: MediaStream; video: HTMLVideoElement }> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access.');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: width }, height: { ideal: height }, ...(frameRate ? { frameRate: { ideal: frameRate } } : {}) },
      audio: false,
    });
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));
    return { stream, video };
  }

  private async captureCamera(facingMode: string): Promise<{ base64: string; mimeType: string; width: number; height: number }> {
    const { stream, video } = await this.openCamera(facingMode, 1280, 720);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      return { base64: canvas.toDataURL('image/png').split(',')[1] ?? '', mimeType: 'image/png', width: canvas.width, height: canvas.height };
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  private async startCamera(payload: Record<string, unknown>): Promise<{ streamId: string; width: number; height: number }> {
    this.stopCamera();
    const size = RESOLUTIONS[String(payload.resolution ?? 'medium')] ?? RESOLUTIONS.medium!;
    const frameRate = typeof payload.frameRate === 'number' && payload.frameRate > 0 ? payload.frameRate : 30;
    const { stream, video } = await this.openCamera(payload.facingMode === 'environment' ? 'environment' : 'user', size.width, size.height, frameRate);
    const id = `camera-${Date.now().toString(36)}`;
    const camera: CameraStream = { id, stream, video, timer: 0 };
    const tick = () => {
      const target = this.frame?.contentWindow;
      if (this.camera !== camera || !target) return;
      void createImageBitmap(video).then((bitmap) => {
        if (this.camera !== camera) { bitmap.close(); return; }
        target.postMessage({ type: 'FLOW_CAMERA_FRAME', streamId: id, bitmap, width: bitmap.width, height: bitmap.height, timestamp: performance.now() }, '*', [bitmap]);
      }).catch(() => undefined);
    };
    camera.timer = window.setInterval(tick, 1000 / frameRate);
    this.camera = camera;
    return { streamId: id, width: video.videoWidth, height: video.videoHeight };
  }

  private stopCamera(): void {
    const camera = this.camera;
    if (!camera) return;
    this.camera = null;
    window.clearInterval(camera.timer);
    camera.stream.getTracks().forEach((t) => t.stop());
    this.frame?.contentWindow?.postMessage({ type: 'FLOW_CAMERA_FRAME', streamId: camera.id, isStopped: true }, '*');
  }

  private async recordMicrophone(durationMs: number): Promise<{ base64: string; mimeType: string; durationMs: number }> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no microphone access.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      const started = performance.now();
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, Math.max(250, durationMs)));
      recorder.stop();
      await stopped;
      const recorded = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const ctx = new AudioContext();
      try {
        const buffer = await ctx.decodeAudioData(await recorded.arrayBuffer());
        return { base64: await blobToBase64(encodeWav(buffer)), mimeType: 'audio/wav', durationMs: Math.round(buffer.duration * 1000) };
      } catch {
        return { base64: await blobToBase64(recorded), mimeType: recorded.type, durationMs: Math.round(performance.now() - started) };
      } finally {
        void ctx.close();
      }
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }
}
