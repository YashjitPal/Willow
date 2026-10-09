import { type Category, type Quality, ReactionResult } from "./engine-enums";

/** The isolated character renderer page shipped with the orbit runtime. */
export function getCharacterFrameUrl() {
  return "/codex/assets/orbit-character-e80433828fcd0066/63e795251e6b8c04/frame.html";
}

export type CharacterFraming = "content" | "activity";

export interface CharacterSwatch {
  id: string;
  title: string;
  color: string;
}

export interface CharacterCatalogOption {
  id: string;
  title: string;
  slot: string;
  selected: boolean;
  available: boolean;
  retired: boolean;
  thumbnail?: string;
  color?: string;
  colors?: CharacterSwatch[];
  colorOverride?: string;
}

export interface CharacterEditorPreview {
  state: Uint8Array;
  customThumbnail?: string;
  presets: { id: string; title: string; thumbnail?: string | null }[];
  /** One option list per engine `Category`. */
  catalog: CharacterCatalogOption[][];
  depth: number;
  quality: Quality;
  constrained: boolean;
  preparation: {
    generation: bigint;
    committedGeneration: bigint;
    revision: bigint;
    pending: boolean;
    failed: boolean;
  };
}

export type CharacterEditorRequest =
  | { action: "catalog"; thumbnails?: boolean; customState?: Uint8Array; savedSelections?: unknown }
  | { action: "custom-thumbnail"; state: Uint8Array }
  | { action: "preset"; value: string }
  | { action: "restore"; state: Uint8Array }
  | { action: "select"; category: Category; value: string }
  | { action: "color"; accessory: string; value: string }
  | { action: "depth"; value: number }
  | { action: "quality"; value: Quality }
  | { action: "constrained"; value: boolean }
  | { action: "reset" }
  | { action: "randomize"; seed: bigint }
  | { action: "snapshot"; renderOffscreen?: boolean }
  | { action: "reaction" }
  | { action: "preset-thumbnail"; value: string; visible: boolean }
  | { action: "preset-preview"; value: string; port: MessagePort }
  | { action: "preset-preview-stop"; value: string };

export interface CharacterEditorResponse {
  type: "orbit-character-editor";
  id: number;
  error?: boolean;
  reaction?: ReactionResult;
  rejected?: boolean;
  preview?: CharacterEditorPreview;
  state?: Uint8Array;
  png?: Uint8Array;
}

export interface CharacterFrameStatus {
  type: "orbit-character";
  status: "loaded" | "ready" | "failed" | "snapshot";
  state?: Uint8Array;
  reason?: "renderer" | "runtime" | "context-lost" | "appearance" | "unsupported";
  phase?: "initializing" | "preparing" | "ready";
  framing?: CharacterFraming;
  png?: Uint8Array;
}

const MAX_STATE_BYTES = 65536;
const MAX_PNG_BYTES = 8388608;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isBytes = (value: unknown, max: number) => value instanceof Uint8Array && value.length <= max;
const isOptional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value);
const isBlobUrl = (value: unknown) => typeof value === "string" && value.startsWith("blob:");
const isSwatch = (value: unknown) =>
  isObject(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  typeof value.color === "string" &&
  /^#[0-9a-f]{6}$/i.test(value.color);

function isCatalogOption(value: unknown) {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.slot === "string" &&
    typeof value.selected === "boolean" &&
    typeof value.available === "boolean" &&
    typeof value.retired === "boolean" &&
    isOptional(value.thumbnail, isBlobUrl) &&
    isOptional(value.color, (color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) &&
    isOptional(value.colors, (colors) => Array.isArray(colors) && colors.every(isSwatch)) &&
    isOptional(value.colorOverride, (color) => typeof color === "string")
  );
}

function isEditorPreview(value: unknown): value is CharacterEditorPreview {
  if (!isObject(value) || !isBytes(value.state, MAX_STATE_BYTES)) return false;
  const preparation = value.preparation;
  return (
    isOptional(value.customThumbnail, isBlobUrl) &&
    Array.isArray(value.presets) &&
    value.presets.every(
      (preset) =>
        isObject(preset) &&
        typeof preset.id === "string" &&
        typeof preset.title === "string" &&
        (preset.thumbnail == null || isBlobUrl(preset.thumbnail)),
    ) &&
    Array.isArray(value.catalog) &&
    value.catalog.length === 5 &&
    value.catalog.every((options) => Array.isArray(options) && options.every(isCatalogOption)) &&
    typeof value.depth === "number" &&
    (value.quality === 0 || value.quality === 1 || value.quality === 2) &&
    typeof value.constrained === "boolean" &&
    isObject(preparation) &&
    typeof preparation.generation === "bigint" &&
    typeof preparation.committedGeneration === "bigint" &&
    typeof preparation.revision === "bigint" &&
    typeof preparation.pending === "boolean" &&
    typeof preparation.failed === "boolean"
  );
}

export function parseCharacterEditorResponse(data: unknown): CharacterEditorResponse | null {
  if (!isObject(data) || data.type !== "orbit-character-editor") return null;
  if (typeof data.id !== "number" || !Number.isInteger(data.id)) return null;
  const valid =
    isOptional(data.error, (error) => typeof error === "boolean") &&
    isOptional(data.reaction, (reaction) => Object.values(ReactionResult).some((value) => value === reaction)) &&
    isOptional(data.rejected, (rejected) => typeof rejected === "boolean") &&
    isOptional(data.preview, isEditorPreview) &&
    isOptional(data.state, (state) => isBytes(state, MAX_STATE_BYTES)) &&
    isOptional(data.png, (png) => isBytes(png, MAX_PNG_BYTES));
  return valid ? (data as unknown as CharacterEditorResponse) : null;
}

const FRAME_STATUSES = ["loaded", "ready", "failed", "snapshot"];
const FAILURE_REASONS = ["renderer", "runtime", "context-lost", "appearance", "unsupported"];
const FAILURE_PHASES = ["initializing", "preparing", "ready"];

export function parseCharacterFrameStatus(data: unknown): CharacterFrameStatus | null {
  if (!isObject(data) || data.type !== "orbit-character" || !FRAME_STATUSES.includes(data.status as string)) return null;
  const valid =
    isOptional(data.state, (state) => state instanceof Uint8Array) &&
    isOptional(data.reason, (reason) => FAILURE_REASONS.includes(reason as string)) &&
    isOptional(data.phase, (phase) => FAILURE_PHASES.includes(phase as string)) &&
    isOptional(data.framing, (framing) => framing === "content" || framing === "activity") &&
    isOptional(data.png, (png) => isBytes(png, MAX_PNG_BYTES));
  return valid ? (data as unknown as CharacterFrameStatus) : null;
}

/** The frame's heartbeat while it waits for its shaders to compile (Willow's compile-wait.js); renderer timeouts restart on it. */
export function isCharacterFrameProgress(data: unknown) {
  return isObject(data) && data.type === "orbit-character-progress";
}

interface PendingRequest {
  resolve: (response: CharacterEditorResponse) => void;
  reject: (error: Error) => void;
  timeout: number;
  restartTimeout: () => void;
  animation?: number;
}

/** Request/response channel to a mounted character frame (`orbit-character-editor` messages). */
export class CharacterEditorClient {
  readonly #frame: Window;
  nextId = 0;
  closed = false;
  listeners = new Set<(preview: CharacterEditorPreview) => void>();
  pending = new Map<number, PendingRequest>();

  constructor(frame: Window) {
    this.#frame = frame;
    window.addEventListener("message", this.receive);
  }

  receive = (event: MessageEvent) => {
    if (event.source !== this.#frame || event.origin !== window.location.origin) return;
    if (isCharacterFrameProgress(event.data)) {
      for (const pending of this.pending.values()) pending.restartTimeout();
      return;
    }
    const response = parseCharacterEditorResponse(event.data);
    if (response == null) return;
    if (response.id === 0 && response.preview) {
      for (const listener of this.listeners) listener(response.preview);
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    window.clearTimeout(pending.timeout);
    if (pending.animation != null) window.cancelAnimationFrame(pending.animation);
    if (response.error) pending.reject(Error("Character edit failed"));
    else pending.resolve(response);
  };

  async request(request: CharacterEditorRequest): Promise<CharacterEditorResponse> {
    if (this.closed) throw Error("Character editor closed");
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeoutMs = request.action === "snapshot" ? 120000 : 30000;
      const expire = () => {
        const pending = this.pending.get(id);
        if (pending?.animation != null) window.cancelAnimationFrame(pending.animation);
        this.pending.delete(id);
        reject(Error("Character editor timed out"));
      };
      const timeout = window.setTimeout(expire, timeoutMs);
      const entry: PendingRequest = {
        resolve,
        reject,
        timeout,
        restartTimeout: () => {
          window.clearTimeout(entry.timeout);
          entry.timeout = window.setTimeout(expire, timeoutMs);
        },
      };
      this.pending.set(id, entry);
      try {
        this.#frame.postMessage(
          { type: "orbit-character-editor", id, ...request },
          window.location.origin,
          request.action === "preset-preview" ? [request.port] : [],
        );
        if (request.action === "snapshot" && request.renderOffscreen) {
          const pumpFrame = () => {
            const pending = this.pending.get(id);
            if (pending) {
              this.#frame.postMessage({ type: "orbit-character-editor", id, action: "snapshot-frame" }, window.location.origin);
              pending.animation = window.requestAnimationFrame(pumpFrame);
            }
          };
          const pending = this.pending.get(id);
          if (pending) pending.animation = window.requestAnimationFrame(pumpFrame);
        }
      } catch (error) {
        this.pending.delete(id);
        window.clearTimeout(entry.timeout);
        reject(Error("Could not send character request", { cause: error }));
      }
    });
  }

  subscribe(listener: (preview: CharacterEditorPreview) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose() {
    this.closed = true;
    window.removeEventListener("message", this.receive);
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      if (pending.animation != null) window.cancelAnimationFrame(pending.animation);
      pending.reject(Error("Character editor closed"));
    }
    this.pending.clear();
    this.listeners.clear();
  }
}
