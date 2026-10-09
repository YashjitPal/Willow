import { useCharacterStore } from "../../state/character-store";
import { sameBytes } from "../orbit/appearance-codec";
import { CharacterEditorClient, type CharacterFrameStatus, getCharacterFrameUrl, isCharacterFrameProgress, parseCharacterFrameStatus } from "../orbit/character-frame";
import { prewarmCharacterShaders } from "../orbit/shader-prewarm";
import { blobToDataUrl, characterSnapshotCache } from "../orbit/snapshot-cache";

/** As `OrbitCharacter`'s: long enough for a first boot on a cold shader cache, which must not be cut short. */
const RENDERER_TIMEOUT_MS = 180000;
const SAVED_AVATARS_CACHE = "dot-saved-avatars";
const SAVED_AVATARS_LIMIT = 32;

const noop = () => {};

/** The Cache Storage request of a captured avatar. The frame URL carries the engine build, so a new build captures again. */
function savedAvatarRequest(state: Uint8Array) {
  const hex = Array.from(state, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request(new URL(`${getCharacterFrameUrl()}?saved-avatar=${hex}`, window.location.origin));
}

async function readSavedAvatar(state: Uint8Array) {
  try {
    const response = await (await caches.open(SAVED_AVATARS_CACHE)).match(savedAvatarRequest(state));
    return response == null ? null : await blobToDataUrl(await response.blob());
  } catch {
    return null;
  }
}

/** Keeps an avatar image for the appearance it shows, for this and later page loads (captures and editor saves). */
export async function writeSavedAvatar(state: Uint8Array, png: Blob) {
  try {
    const cache = await caches.open(SAVED_AVATARS_CACHE);
    await cache.put(savedAvatarRequest(state), new Response(png, { headers: { "Content-Type": "image/png" } }));
    const stored = await cache.keys();
    await Promise.all(stored.slice(0, -SAVED_AVATARS_LIMIT).map((request) => cache.delete(request)));
  } catch {
    // An image that cannot be stored is captured again on the next load.
  }
}

/** Character frames, live or capture, that have reported ready or failed. */
const settledFrames = new WeakSet<MessageEventSource>();
/** When any character frame last reported compile progress. */
let lastFrameProgress = 0;
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.source == null) return;
  if (isCharacterFrameProgress(event.data)) {
    lastFrameProgress = performance.now();
    return;
  }
  const status = parseCharacterFrameStatus(event.data)?.status;
  if (status === "ready" || status === "failed") settledFrames.add(event.source);
});

/** Character frames on the page that have not reported ready or failed. */
function bootingFrames() {
  const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>(`iframe[src^="${getCharacterFrameUrl()}"]`));
  return frames.filter((frame) => frame.contentWindow != null && !settledFrames.has(frame.contentWindow));
}

/**
 * Resolves once the page's live characters have booted, or after the renderer timeout without compile progress. An
 * engine boot keeps the GPU process busy, and Codex boots none for saved avatars, so a capture must not delay or slow
 * the live characters, nor compile their shaders a second time while they still compile. Live characters mount only
 * after a rendering update reports them visible, hence the frames and idle period first.
 */
async function waitForLiveCharacters() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestIdleCallback(resolve, { timeout: 1000 }));
  const started = performance.now();
  while (bootingFrames().length > 0 && performance.now() - Math.max(started, lastFrameProgress) < RENDERER_TIMEOUT_MS) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
}

/**
 * Fails like `OrbitCharacter` when no renderer is ready in time; the timer restarts on visibility changes and on the
 * frame's compile progress.
 */
function withRendererTimeout<T>(work: Promise<T>, signal: AbortSignal, frame: HTMLIFrameElement): Promise<T> {
  let timer: number | undefined;
  let restart = noop;
  let abort = noop;
  const timeout = new Promise<never>((_, reject) => {
    restart = () => {
      window.clearTimeout(timer);
      if (!document.hidden) {
        timer = window.setTimeout(() => {
          console.warn(`Character renderer timed out after ${RENDERER_TIMEOUT_MS} ms`);
          reject(Error("Character renderer timed out"));
        }, RENDERER_TIMEOUT_MS);
      }
    };
    abort = () => reject(signal.reason);
  });
  const onProgress = (event: MessageEvent) => {
    if (event.source === frame.contentWindow && event.origin === window.location.origin && isCharacterFrameProgress(event.data)) restart();
  };
  document.addEventListener("visibilitychange", restart);
  window.addEventListener("message", onProgress);
  signal.addEventListener("abort", abort);
  restart();
  return Promise.race([work, timeout]).finally(() => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", restart);
    window.removeEventListener("message", onProgress);
    signal.removeEventListener("abort", abort);
  });
}

/**
 * A hidden 256 px character frame that snapshots one appearance after another, rendered offscreen with
 * reduced motion like the frame Codex mounts to save an avatar (`B2` in the onboarding page).
 */
class CaptureFrame {
  readonly #container = document.createElement("div");
  readonly #iframe = document.createElement("iframe");
  readonly #listeners = new Set<(status: CharacterFrameStatus) => void>();
  readonly #loaded: Promise<CharacterFrameStatus>;
  readonly #disposed = new AbortController();
  #client: CharacterEditorClient | null = null;
  #readyState: Uint8Array | null = null;

  constructor() {
    this.#container.className = "pointer-events-none fixed top-0 left-0 size-64 opacity-0";
    this.#container.inert = true;
    this.#container.setAttribute("aria-hidden", "true");
    this.#iframe.className = "size-full border-0 scheme-normal";
    this.#iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    this.#iframe.setAttribute("allow", "cross-origin-isolated");
    this.#iframe.tabIndex = -1;
    this.#iframe.src = getCharacterFrameUrl();
    window.addEventListener("message", this.#receive);
    this.#loaded = this.#waitFor((status) => status.status === "loaded");
    this.#loaded.catch(noop);
    this.#container.append(this.#iframe);
    document.body.append(this.#container);
  }

  get iframe() {
    return this.#iframe;
  }

  #receive = (event: MessageEvent) => {
    if (event.source !== this.#iframe.contentWindow || event.origin !== window.location.origin) return;
    const status = parseCharacterFrameStatus(event.data);
    if (status == null) return;
    if (status.status === "snapshot") {
      if (status.framing === "content" && status.state != null && status.png != null) {
        void characterSnapshotCache.save(JSON.stringify([getCharacterFrameUrl(), "content", Array.from(status.state)]), status.png);
      }
      return;
    }
    if (status.status === "failed") console.warn("Character renderer failed", status.reason, status.phase);
    for (const listener of [...this.#listeners]) listener(status);
  };

  #waitFor(match: (status: CharacterFrameStatus) => boolean) {
    return new Promise<CharacterFrameStatus>((resolve, reject) => {
      const listener = (status: CharacterFrameStatus) => {
        if (status.status !== "failed" && !match(status)) return;
        this.#listeners.delete(listener);
        if (status.status === "failed") reject(Error("Character renderer failed"));
        else resolve(status);
      };
      this.#listeners.add(listener);
    });
  }

  async capture(state: Uint8Array) {
    if (!sameBytes(this.#readyState, state)) {
      this.#readyState = null;
      const ready = this.#waitFor((status) => status.status === "ready" && sameBytes(status.state, state));
      ready.catch(noop);
      await withRendererTimeout(
        this.#loaded.then(() => {
          this.#iframe.contentWindow?.postMessage({ type: "orbit-character", state, reducedMotion: true, active: true, framing: "content" }, window.location.origin);
          return ready;
        }),
        this.#disposed.signal,
        this.#iframe,
      );
      this.#readyState = state;
    }
    const frameWindow = this.#iframe.contentWindow;
    if (frameWindow == null) throw Error("Character frame is gone");
    this.#client ??= new CharacterEditorClient(frameWindow);
    const { png } = await this.#client.request({ action: "snapshot", renderOffscreen: true });
    if (png == null) throw Error("Character snapshot unavailable");
    return png;
  }

  /** Removing the frame releases its engine module, worker pool and WebGL context. */
  dispose() {
    this.#disposed.abort();
    this.#client?.dispose();
    this.#client = null;
    this.#listeners.clear();
    window.removeEventListener("message", this.#receive);
    this.#container.remove();
  }
}

interface CaptureRequest {
  conversationId: string;
  state: Uint8Array;
  holders: number;
  /** Cache Storage has no image for the state, so the engine has to render it. */
  missing: boolean;
}

const requests = new Map<string, CaptureRequest>();
/** Appearances whose capture failed this session; their avatars keep the fallback instead of booting another engine. */
const failedStates = new Set<string>();
let draining = false;

const requestsFor = (state: Uint8Array) => [...requests].filter(([, request]) => sameBytes(request.state, state));

function drop(state: Uint8Array) {
  for (const [key] of requestsFor(state)) requests.delete(key);
}

function publish(state: Uint8Array, src: string) {
  const updatedAt = Date.now();
  for (const [key, request] of requestsFor(state)) {
    requests.delete(key);
    useCharacterStore.getState().setSavedImage(request.conversationId, { src, state: request.state, updatedAt });
  }
}

function nextMissing() {
  for (const request of requests.values()) if (request.missing) return request;
  return null;
}

async function drain() {
  if (draining) return;
  draining = true;
  let frame: CaptureFrame | null = null;
  try {
    for (let next = nextMissing(); next != null; next = nextMissing()) {
      const { state } = next;
      const stateKey = state.join(",");
      if (failedStates.has(stateKey) || useCharacterStore.getState().rendererFailure) {
        drop(state);
        continue;
      }
      try {
        await prewarmCharacterShaders();
        await waitForLiveCharacters();
        if (requestsFor(state).length === 0) continue;
        // Once booting, the capture runs to the end even if a live character mounts meanwhile: removing a frame that
        // is still compiling stalls Chrome's GPU process, every tab with it, until the orphaned compile finishes.
        frame ??= new CaptureFrame();
        const png = new Blob([new Uint8Array(await frame.capture(state))], { type: "image/png" });
        void writeSavedAvatar(state, png);
        publish(state, await blobToDataUrl(png));
      } catch {
        frame?.dispose();
        frame = null;
        failedStates.add(stateKey);
        drop(state);
      }
    }
  } finally {
    frame?.dispose();
    draining = false;
  }
}

function createRequest(key: string, conversationId: string, state: Uint8Array) {
  const request: CaptureRequest = { conversationId, state, holders: 0, missing: false };
  requests.set(key, request);
  void readSavedAvatar(state).then((src) => {
    if (requests.get(key) !== request) return;
    if (src != null) {
      publish(state, src);
    } else {
      request.missing = true;
      void drain();
    }
  });
  return request;
}

/**
 * Requests the saved avatar image of an orbit bot, which Codex downloads from the bot's profile (`BYa`: the
 * `avatar_manifest.snapshot` asset, else `avatar_url`).
 * Images captured on an earlier load come from Cache Storage. Missing ones are rendered in order by one shared frame
 * once the page's live characters have booted, so pages never boot an engine per avatar; bots with the same
 * appearance share one snapshot. Returns a release function; released requests that have not started are dropped.
 */
export function requestSavedAvatarCapture(conversationId: string, state: Uint8Array) {
  const key = `${conversationId}:${state.join(",")}`;
  const request = requests.get(key) ?? createRequest(key, conversationId, state);
  request.holders++;
  return () => {
    request.holders--;
    if (request.holders === 0 && requests.get(key) === request) requests.delete(key);
  };
}
