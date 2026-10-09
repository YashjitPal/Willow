// The frame owns its module, worker pool and WebGL context. Removing the frame
// releases all three, including failed or still-initializing WASM instances.
import {
  ActivityKind,
  Category,
  Quality,
  ReactionKind,
  ReactionResult,
} from "../runtime/orbit-enums.mjs";
import { CharacterActivityController } from "./activity.mjs";
import { presetMotion, PresetPreviews } from "./preset-previews.mjs";

/** @type {PresetPreviews | undefined} */
let presetPreviews;

const canvas = document.querySelector("canvas");
// Activity avatars use a different animation controller from editor previews.
const activityAnimation =
  new URLSearchParams(location.search).get("animation") === "activity";
const activity = new CharacterActivityController();
/** @type {import("../runtime/orbit-characters.mjs").Character | undefined} */
let character;
/** @type {{character: import("../runtime/orbit-characters.mjs").Character, canvas: HTMLCanvasElement, state: Uint8Array} | undefined} */
let snapshot;
/** @type {import("../runtime/orbit-characters.mjs").OrbitModule["PointerPhase"] | undefined} */
let pointerPhases;
/** @type {number | undefined} */
let pointerId;
let hoverResumeAt = 0;
/** @type {number | undefined} */
let hoverTransitionStartedAt;
/** @type {{id: number, x: number, y: number} | undefined} */
let deferredHover;
const pointerEvents = new AbortController();
let started = false;
/** @type {Uint8Array | undefined} */
let requestedAppearance;
/** @type {Uint8Array | undefined} */
let restoredAppearance;
let disposed = false;
let active = true;
let reducedMotion = false;
let ready = false;
let phase = "initializing";
let firstFrameCompleted = false;
let framing = "content";
let needsFraming = false;
let framingSubmitted = false;
let fitReadbackRetries = 0;
let contentScale = 1;
/** @type {boolean | undefined} */
let readbackAvailable;
/** @type {import("../runtime/orbit-characters.mjs").OrbitModule | undefined} */
let engine;
/** @type {Array<Array<import("../runtime/orbit-characters.mjs").CatalogItem & {retired: boolean}>> | undefined} */
let catalog;
/** @type {Map<string, string | undefined>} */
const thumbnailUrls = new Map();
/** @type {import("../runtime/orbit-characters.mjs").PreparationStats | undefined} */
let lastPreparation;
let editorListening = false;
let generatingThumbnails = false;
/** @type {Array<import("../runtime/orbit-characters.mjs").CharacterPreset>} */
const presets = [];
/** @type {Set<string>} */
const visiblePresets = new Set();
/** @type {Set<string>} */
const attemptedThumbnails = new Set();
/** @type {Set<string>} */
const failedThumbnails = new Set();
/** @type {Uint8Array | undefined} */
let customThumbnailState;
let completingEdit = false;
let editSubmitted = false;
/** @type {import("../runtime/orbit-enums.mjs").Quality} */
let quality = Quality.Automatic;
let constrained = false;
/** @type {{id: number, renderOffscreen?: boolean, submitted?: boolean, encoding?: boolean} | undefined} */
let pending;
/** @type {number | undefined} */
let animation;
const notify = (status, state) =>
  parent.postMessage(
    state == null
      ? { type: "orbit-character", status }
      : { type: "orbit-character", status, state },
    location.origin,
  );

function fail(reason = "renderer") {
  if (disposed) {
    return;
  }
  disposed = true;
  try {
    dispose();
  } catch {
    // Failed native calls can also reject cleanup. The owner removes the whole
    // frame, releasing its worker pool and contexts even in that case.
  }
  parent.postMessage(
    { type: "orbit-character", status: "failed", reason, phase },
    location.origin,
  );
}

function dispose() {
  cancelPointer();
  pointerEvents.abort();
  disposed = true;
  if (animation != null) {
    cancelAnimationFrame(animation);
  }
  observer.disconnect();
  presetPreviews?.dispose();
  presetPreviews = undefined;
  character?.delete();
  character = undefined;
  snapshot?.character.delete();
  snapshot?.canvas.remove();
  snapshot = undefined;
  for (const url of thumbnailUrls.values()) {
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
  thumbnailUrls.clear();
  engine = undefined;
}

function render(seconds) {
  animation = undefined;
  if (
    disposed ||
    !character ||
    (!active && !pending && !completingEdit) ||
    document.hidden ||
    pending?.encoding
  ) {
    return;
  }
  try {
    if (snapshot) {
      renderSnapshot();
      schedule();
      return;
    }
    const admitted = character.render(seconds / 1000);
    if (character.renderError()) {
      return fail();
    }
    const preparation = character.preparationStats();
    if (!ready && preparation.failed) {
      return fail();
    }
    if (
      editorListening &&
      (preparation.revision !== lastPreparation?.revision ||
        preparation.generation !== lastPreparation?.generation ||
        preparation.pending !== lastPreparation?.pending)
    ) {
      reply(0, { preview: preview() });
    }
    if (preparation.failed) {
      needsFraming = false;
      framingSubmitted = false;
    }
    if (
      needsFraming &&
      admitted &&
      !character.hasPendingUpdate() &&
      !preparation.pending
    ) {
      if (!framingSubmitted && canReadback()) {
        // Measure a drawn frame in a neutral pose, including reduced motion.
        framingSubmitted = true;
        character.setReducedMotion(true);
        schedule();
        return;
      }
      const snapshot = fittedFrame(canvas);
      if (snapshot) {
        applyPresentation(snapshot.presentation);
      } else if (snapshot === false && fitReadbackRetries < 2) {
        fitReadbackRetries += 1;
        character.setReducedMotion(true);
        schedule();
        return;
      }
      needsFraming = false;
      framingSubmitted = false;
      fitReadbackRetries = 0;
      if (activityAnimation && !activity.apply(character, false)) {
        return fail();
      }
      if (!reducedMotion) {
        character.setReducedMotion(false);
      }
    }
    if (
      completingEdit &&
      !preparation.pending &&
      (admitted || preparation.failed)
    ) {
      if (admitted && !editSubmitted) {
        // Admission queues the frame. Pump once more before sleeping so a
        // reduced-motion or offscreen preview displays the committed edit.
        editSubmitted = true;
        character.setReducedMotion(reducedMotion);
      } else {
        completingEdit = false;
        if (!activityAnimation) {
          hoverResumeAt = performance.now() + 300;
        }
        character.setActive(active || pending != null);
      }
    }
    if (deferredHover && pointerPhases && performance.now() >= hoverResumeAt) {
      const now = performance.now();
      if (hoverTransitionStartedAt == null) {
        hoverTransitionStartedAt = now;
      }
      const progress = reducedMotion
        ? 1
        : Math.min(1, (now - hoverTransitionStartedAt) / 200);
      const eased = progress * progress * (3 - 2 * progress);
      // Match the engine's clamped pointer range before easing; a cursor far
      // outside the preview must not reach the edge early and appear to snap.
      const x = Math.max(0, Math.min(1, deferredHover.x));
      const y = Math.max(0, Math.min(1, deferredHover.y));
      character.pointer(
        pointerPhases.Move,
        deferredHover.id,
        0.5 + (x - 0.5) * eased,
        0.5 + (y - 0.5) * eased,
        now / 1000,
      );
      if (progress === 1) {
        deferredHover = undefined;
        hoverTransitionStartedAt = undefined;
        hoverResumeAt = 0;
      }
    }
    if (pending && !preparation.pending) {
      if (!engine) {
        return fail();
      }
      // Wait for edits to commit; the snapshot renderer supplies its own frame.
      // An idle live preview may never submit another frame.
      // Use the same crop as the studio without live gaze or reaction props.
      const capture = document.createElement("canvas");
      capture.id = "character-snapshot";
      capture.hidden = true;
      document.body.append(capture);
      snapshot = {
        canvas: capture,
        state: character.state(),
        character: new engine.Character("#character-snapshot", 512, 512),
      };
      if (snapshot.character.restore(snapshot.state)) {
        return fail();
      }
      snapshot.character.setQuality(quality);
      snapshot.character.setConstrained(constrained);
      snapshot.character.setDisplayScale(
        512 / Math.max(1, Math.min(innerWidth, innerHeight)) / contentScale,
      );
      snapshot.character.setReducedMotion(true);
      character.setActive(false);
      schedule();
      return;
    }
    if (
      !ready &&
      firstFrameCompleted &&
      !needsFraming &&
      !character.hasPendingUpdate()
    ) {
      // Give WebGL a presentation opportunity before replacing the saved PNG.
      ready = true;
      const presentedAppearance = restoredAppearance;
      requestAnimationFrame(() => {
        if (!disposed && ready && presentedAppearance === restoredAppearance) {
          performance.measure("orbit-character.first-frame", { start: 0 });
          phase = "ready";
          canvas.classList.add("ready");
          notify("ready", presentedAppearance);
        }
      });
    }
    // Keep polling while visible, including in reduced motion: the engine skips
    // idle frames, but gaze smoothing and drag release still need time to settle.
    // https://github.com/openai/orbit-character-engine/blob/99e40752539923873e2e17808e532b90b4c2b319/sdk/web/README.md#pointer-input
    schedule();
  } catch {
    fail();
  }
}

function renderSnapshot() {
  if (!snapshot || !pending) {
    return;
  }
  const capture = snapshot;
  const admitted = capture.character.render(0);
  if (
    capture.character.renderError() ||
    capture.character.preparationStats().failed
  ) {
    return fail();
  }
  if (!admitted || capture.character.hasPendingUpdate()) {
    return;
  }
  if (!pending.submitted) {
    // Admission queues a frame; pump again before reading the drawing buffer.
    pending.submitted = true;
    capture.character.setReducedMotion(true);
    return;
  }
  const request = pending;
  request.encoding = true;
  /** @param {Blob | null} blob */
  const finish = (blob) => {
    if (disposed) {
      return;
    }
    capture.character.delete();
    capture.canvas.remove();
    snapshot = undefined;
    pending = undefined;
    updateActive();
    resize();
    if (!blob) {
      reply(request.id, { error: true });
      return;
    }
    void blob.arrayBuffer().then(
      (bytes) => {
        if (!disposed) {
          reply(request.id, {
            state: capture.state,
            png: new Uint8Array(bytes),
          });
        }
      },
      () => {
        if (!disposed) {
          reply(request.id, { error: true });
        }
      },
    );
  };
  const frame = fittedFrame(capture.canvas);
  const image = frame && uploadThumbnail(frame);
  if (image) {
    image.toBlob(finish, "image/png");
  } else {
    finish(null);
  }
}

function updateActive() {
  character?.setActive(
    !document.hidden &&
      !snapshot &&
      (active || pending != null || completingEdit),
  );
  snapshot?.character.setActive(!document.hidden);
}

function schedule() {
  if (
    animation == null &&
    !disposed &&
    !pending?.renderOffscreen &&
    (active || pending || completingEdit) &&
    !document.hidden
  ) {
    animation = requestAnimationFrame(render);
  }
}

function pixelSize() {
  return Math.max(
    1,
    Math.min(
      1024,
      Math.round(
        Math.min(innerWidth, innerHeight) * devicePixelRatio * contentScale,
      ),
    ),
  );
}

function resize() {
  if (!character || disposed || pending != null) {
    return;
  }
  const size = pixelSize();
  setSize(size);
  schedule();
}

const observer = new ResizeObserver(resize);
observer.observe(canvas);
canvas.addEventListener("webglcontextlost", () => fail("context-lost"));
// Emscripten worker errors are thrown globally rather than rejecting the module
// promise. Surface them immediately instead of waiting for the owner's timeout.
// https://github.com/openai/orbit-character-engine/blob/44565ad33ed9ac0da064fee79eb15aa148698769/sdk/web/index.html
for (const type of ["error", "unhandledrejection"]) {
  addEventListener(
    type,
    (event) => {
      event.preventDefault();
      fail("runtime");
    },
    { signal: pointerEvents.signal },
  );
}
addEventListener("pagehide", dispose, { once: true });
addEventListener("blur", cancelPointer, { signal: pointerEvents.signal });
document.addEventListener(
  "visibilitychange",
  () => {
    if (document.hidden) {
      cancelPointer();
    }
    updateActive();
    if (document.hidden && animation != null) {
      cancelAnimationFrame(animation);
      animation = undefined;
    }
    schedule();
  },
  { signal: pointerEvents.signal },
);
canvas.addEventListener(
  "pointerdown",
  (event) => {
    if (!event.isPrimary || event.button !== 0 || pointerId != null) {
      return;
    }
    if (movePointer("Down", event)) {
      pointerId = event.pointerId;
      canvas.setPointerCapture(pointerId);
    }
  },
  { signal: pointerEvents.signal },
);
canvas.addEventListener("pointermove", (event) => movePointer("Move", event), {
  signal: pointerEvents.signal,
});
canvas.addEventListener(
  "pointerup",
  (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }
    movePointer("Up", event);
    pointerId = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    const bounds = canvas.getBoundingClientRect();
    if (
      event.pointerType === "touch" ||
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      sendPointer("Move", event.pointerId, 0.5, 0.5);
    }
  },
  { signal: pointerEvents.signal },
);
canvas.addEventListener(
  "pointerleave",
  (event) => {
    if (event.isPrimary && pointerId == null) {
      sendPointer("Move", event.pointerId, 0.5, 0.5);
    }
  },
  { signal: pointerEvents.signal },
);
for (const type of ["pointercancel", "lostpointercapture"]) {
  canvas.addEventListener(
    type,
    (event) => {
      if (event.pointerId === pointerId) {
        cancelPointer();
      }
    },
    { signal: pointerEvents.signal },
  );
}
addEventListener(
  "message",
  /** @param {MessageEvent<Record<string, unknown>>} event */ (event) => {
    void receive(event).catch(() => fail("runtime"));
  },
);

/**
 * @param {"Down" | "Move" | "Up" | "Cancel"} phase
 * @param {number} id
 * @param {number} x
 * @param {number} y
 */
function sendPointer(phase, id, x, y) {
  if (
    !character ||
    !pointerPhases ||
    !ready ||
    disposed ||
    !active ||
    document.hidden ||
    pending != null
  ) {
    return false;
  }
  if (activityAnimation) {
    if (phase !== "Move") {
      return false;
    }
    // Native attention preserves the underlying Ready clock and blends back on release.
    // https://github.com/openai/orbit-character-engine/pull/117
    character.setReadyGaze(x, y, performance.now() / 1000);
  } else {
    if (phase === "Move" && pointerId == null && hoverResumeAt > 0) {
      deferredHover = { id, x, y };
      schedule();
      return false;
    }
    deferredHover = undefined;
    hoverTransitionStartedAt = undefined;
    hoverResumeAt = 0;
    character.pointer(pointerPhases[phase], id, x, y, performance.now() / 1000);
  }
  schedule();
  return true;
}

/**
 * @param {"Down" | "Move" | "Up"} phase
 * @param {PointerEvent} event
 */
function movePointer(phase, event) {
  if (
    !event.isPrimary ||
    (pointerId != null && pointerId !== event.pointerId)
  ) {
    return false;
  }
  const bounds = canvas.getBoundingClientRect();
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    sendPointer(
      phase,
      event.pointerId,
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    )
  );
}

function cancelPointer() {
  deferredHover = undefined;
  hoverTransitionStartedAt = undefined;
  if (!character || !pointerPhases || disposed) {
    return;
  }
  if (activityAnimation) {
    character.clearReadyGaze(performance.now() / 1000);
    schedule();
    return;
  }
  const id = pointerId;
  pointerId = undefined;
  if (id != null) {
    character.pointer(pointerPhases.Cancel, id, 0, 0, performance.now() / 1000);
    if (canvas.hasPointerCapture(id)) {
      canvas.releasePointerCapture(id);
    }
  }
  character.pointer(
    pointerPhases.Move,
    id ?? 0,
    0.5,
    0.5,
    performance.now() / 1000,
  );
  schedule();
}

/** @param {MessageEvent<Record<string, unknown>>} event */
async function receive({ source, origin, data }) {
  if (source !== parent || origin !== location.origin || disposed) {
    return;
  }
  if (data?.type === "orbit-character-gesture") {
    const { id, x, y } = data;
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      id < 0 ||
      id > 0xffffffff ||
      typeof x !== "number" ||
      !Number.isFinite(x) ||
      typeof y !== "number" ||
      !Number.isFinite(y)
    ) {
      return;
    }
    let phase;
    switch (data.phase) {
      case "down":
        phase = "Down";
        break;
      case "move":
        phase = "Move";
        break;
      case "up":
        phase = "Up";
        break;
      case "cancel":
        phase = "Cancel";
        break;
      default:
        return;
    }
    const bounds = canvas.getBoundingClientRect();
    if (
      bounds.width > 0 &&
      bounds.height > 0 &&
      sendPointer(
        phase,
        id,
        (x * innerWidth - bounds.left) / bounds.width,
        (y * innerHeight - bounds.top) / bounds.height,
      )
    ) {
      if (phase === "Down") {
        pointerId = id;
      } else if (phase === "Up" || phase === "Cancel") {
        pointerId = undefined;
      }
    }
    return;
  }
  if (data?.type === "orbit-character-pointer-cancel") {
    cancelPointer();
    return;
  }
  if (data?.type === "orbit-character-pointer") {
    const { x, y } = data;
    if (
      pointerId == null &&
      typeof x === "number" &&
      typeof y === "number" &&
      Number.isFinite(x) &&
      Number.isFinite(y)
    ) {
      // Owner coordinates are relative to the iframe; account for fitted canvas zoom.
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        sendPointer(
          "Move",
          0,
          (x * innerWidth - bounds.left) / bounds.width,
          (y * innerHeight - bounds.top) / bounds.height,
        );
      }
    }
    return;
  }
  if (data?.type === "orbit-character-editor") {
    if (
      typeof data.id !== "number" ||
      !Number.isSafeInteger(data.id) ||
      data.id <= 0
    ) {
      return;
    }
    if (data.action === "snapshot-frame") {
      if (pending?.id === data.id && pending.renderOffscreen) {
        render(performance.now());
      }
      return;
    }
    if (data.action === "preset-preview-stop") {
      if (typeof data.value === "string") {
        presetPreviews?.remove(data.value);
      }
      return reply(data.id, {});
    }
    if (data.action === "preset-preview") {
      if (
        !engine ||
        typeof data.value !== "string" ||
        !(data.port instanceof MessagePort)
      ) {
        return reply(data.id, { error: true });
      }
      try {
        if (!presetPreviews) {
          presetPreviews = new PresetPreviews(engine, fittedFrame);
        }
        const index = presets.findIndex((preset) => preset.id === data.value);
        if (index < 0) {
          data.port.close();
          return reply(data.id, { error: true });
        }
        await presetPreviews.add(data.value, data.port, index);
        reply(data.id, {});
      } catch {
        reply(data.id, { error: true });
      }
      return;
    }
    if (data.action === "reaction") {
      const reaction =
        ready &&
        character &&
        !pending &&
        !needsFraming &&
        !completingEdit &&
        active &&
        !document.hidden
          ? character.playReaction(ReactionKind.Signature)
          : ReactionResult.Unavailable;
      reply(data.id, { reaction });
      if (reaction === ReactionResult.Accepted) {
        schedule();
      }
      return;
    }
    if (data.action === "preset-thumbnail") {
      if (
        typeof data.value !== "string" ||
        typeof data.visible !== "boolean" ||
        !presets.some((preset) => preset.id === data.value)
      ) {
        return reply(data.id, { error: true });
      }
      if (data.visible) {
        visiblePresets.add(data.value);
        void generateThumbnails();
      } else {
        visiblePresets.delete(data.value);
        attemptedThumbnails.delete(data.value);
        const clearedFailure = failedThumbnails.delete(data.value);
        if (trimPresetThumbnails() || clearedFailure) {
          reply(0, { preview: preview() });
        }
      }
      return reply(data.id, {});
    }
    if (!ready || !character || pending) {
      return reply(data.id, { error: true });
    }
    if (data.action === "catalog" || data.action === "custom-thumbnail") {
      const state = data.action === "catalog" ? data.customState : data.state;
      if (state != null || data.action === "custom-thumbnail") {
        if (!(state instanceof Uint8Array) || state.length > 65536) {
          return reply(data.id, { error: true });
        }
        customThumbnailState = state;
      }
    }
    if (data.action === "custom-thumbnail") {
      void generateThumbnails();
      return reply(data.id, {});
    }
    if (data.action === "catalog") {
      if (
        data.savedSelections != null &&
        !addSavedSelections(data.savedSelections)
      ) {
        return reply(data.id, { error: true });
      }
      try {
        if (presets.length === 0) {
          // Load metadata without preparing hidden portraits.
          presets.push(...engine.hereCharacters());
        }
      } catch {
        return reply(data.id, { error: true });
      }
      editorListening = true;
      if (data.thumbnails !== false) {
        void generateThumbnails();
      }
      return reply(data.id, { state: character.state(), preview: preview() });
    }
    if (data.action === "snapshot") {
      cancelPointer();
      pending = { id: data.id, renderOffscreen: data.renderOffscreen === true };
      if (pending.renderOffscreen && animation != null) {
        cancelAnimationFrame(animation);
        animation = undefined;
      }
      character.setActive(true);
      schedule();
      return;
    }
    let accepted = false;
    const { value, accessory, seed } = data;
    try {
      switch (data.action) {
        case "preset":
          accepted =
            typeof value === "string" &&
            value.length <= 63 &&
            engine != null &&
            !character.restore(engine.presetAppearance(value));
          break;
        case "restore":
          accepted =
            data.state instanceof Uint8Array &&
            data.state.length <= 65536 &&
            !character.restore(data.state);
          break;
        case "select": {
          const category = Object.values(Category).find(
            (category) => category === data.category,
          );
          accepted =
            category !== undefined &&
            typeof value === "string" &&
            value.length <= 63 &&
            character.select(category, value);
          break;
        }
        case "color":
          accepted =
            typeof accessory === "string" &&
            accessory.length <= 63 &&
            typeof value === "string" &&
            value.length <= 63 &&
            (value === ""
              ? character.clearAccessoryColor(accessory)
              : character.setAccessoryColor(accessory, value));
          break;
        case "depth":
          if (typeof value === "number") {
            character.setDepth(value);
            accepted = true;
          }
          break;
        case "quality": {
          const selectedQuality = Object.values(Quality).find(
            (quality) => quality === value,
          );
          if (
            selectedQuality !== undefined &&
            character.setQuality(selectedQuality)
          ) {
            quality = selectedQuality;
            accepted = true;
          }
          break;
        }
        case "constrained":
          if (typeof value === "boolean") {
            character.setConstrained(value);
            constrained = value;
            accepted = true;
          }
          break;
        case "reset":
          character.reset();
          accepted = true;
          break;
        case "randomize":
          if (engine && typeof seed === "bigint") {
            const state = engine.generateCuratedAppearance(seed);
            accepted = !character.restore(state);
          }
          break;
        default:
          break;
      }
    } catch {
      // Native generation rejects malformed/out-of-range seeds without changing state.
      accepted = false;
    }
    if (accepted) {
      if (!activityAnimation) {
        // Discard the old gaze and wait for fresh movement plus a settled preview.
        cancelPointer();
        hoverResumeAt = Infinity;
      }
      needsFraming = true;
      framingSubmitted = false;
      fitReadbackRetries = 0;
      completingEdit = true;
      editSubmitted = false;
      character.setActive(true);
      schedule();
    }
    reply(data.id, { rejected: !accepted, preview: preview() });
    return;
  }
  if (data?.type !== "orbit-character") {
    return;
  }
  if (
    typeof data.active !== "boolean" ||
    typeof data.reducedMotion !== "boolean" ||
    (data.framing != null &&
      data.framing !== "content" &&
      data.framing !== "activity")
  ) {
    return;
  }
  if (activityAnimation && data.activity != null) {
    if (
      !Object.values(ActivityKind).some(
        (kind) => kind === data.activity.kind,
      ) ||
      (data.activity.turnId != null && typeof data.activity.turnId !== "string")
    ) {
      return;
    }
    activity.requested = {
      kind: data.activity.kind,
      turnId: data.activity.turnId ?? null,
    };
  }
  if (data.state != null) {
    if (!(data.state instanceof Uint8Array) || data.state.length > 65536) {
      return;
    }
    requestedAppearance = data.state;
  } else if (!started) {
    return;
  }
  if (!data.active) {
    cancelPointer();
  }
  const nextFraming = data.framing ?? framing;
  if (framing !== nextFraming) {
    framing = nextFraming;
    needsFraming = true;
    framingSubmitted = false;
    fitReadbackRetries = 0;
    contentScale = 1;
    canvas.style.transform = "";
    if (started) {
      ready = false;
    }
    setSize(pixelSize());
  }
  active = data.active;
  reducedMotion = data.reducedMotion;
  if (!started) {
    started = true;
    await initialize();
  }
  if (!engine || disposed) {
    return;
  }
  // Use the latest owner state, including updates received during WASM startup.
  // Visibility messages repeat these bytes; they must not reset editor changes.
  const state = requestedAppearance;
  if (
    state &&
    (restoredAppearance?.length !== state.length ||
      !state.every((byte, index) => byte === restoredAppearance[index]))
  ) {
    if (engine.validateAppearance(state)) {
      return fail("appearance");
    }
    // Validate and normalize before creating a renderer; keep supported historical fields.
    const normalized = engine.normalizeAppearance(state);
    createCharacter();
    ready = false;
    needsFraming = true;
    framingSubmitted = false;
    fitReadbackRetries = 0;
    if (character.restore(normalized)) {
      return fail();
    }
    restoredAppearance = state;
    phase = "preparing";
  }
  if (character) {
    if (activityAnimation && !activity.apply(character, needsFraming)) {
      return fail();
    }
    updateActive();
    character.setReducedMotion(reducedMotion);
    schedule();
  }
}

async function initialize() {
  performance.mark("orbit-character.module-start");
  // Without document-level isolation this embedded frame cannot use pthreads.
  // Load the independent non-threaded build on those hosts.
  // https://github.com/openai/orbit-character-engine/pull/139
  const threaded =
    crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
  const runtime = threaded ? "../runtime/" : "../runtime/single-thread/";
  const { default: createOrbitModule } = threaded
    ? await import("../runtime/orbit-characters.mjs")
    : await import("../runtime/single-thread/orbit-characters.mjs");
  if (disposed) {
    return;
  }
  engine = await createOrbitModule({
    // Emscripten resolves the data archive against the document by default.
    locateFile: (file) => new URL(`${runtime}${file}`, import.meta.url).href,
    onAbort: () => fail("runtime"),
  });
  if (disposed) {
    return;
  }
  performance.measure(
    "orbit-character.module-initialization",
    "orbit-character.module-start",
  );
  pointerPhases = engine.PointerPhase;
  catalog = Object.values(Category).map((category) =>
    engine.catalog(category).map((item) => ({ ...item, retired: false })),
  );
}

function createCharacter() {
  if (character || !engine || disposed) {
    return;
  }
  const size = pixelSize();
  character = new engine.Character("#character", size, size, {
    activities: activityAnimation,
  });
  character.onFirstFrame(() => {
    firstFrameCompleted = true;
  });
  if (activityAnimation && !activity.bind(character)) {
    fail();
    return;
  }
  character.setQuality(quality);
  character.setConstrained(constrained);
  setSize(size);
}

/** @param {number} size */
function setSize(size) {
  character?.resize(size, size);
  setDisplayScale();
}

function setDisplayScale() {
  character?.setDisplayScale(
    canvas.width /
      Math.max(1, Math.min(innerWidth, innerHeight)) /
      contentScale,
  );
}

/** @param {unknown} selections */
function addSavedSelections(selections) {
  if (
    !engine ||
    !catalog ||
    !Array.isArray(selections) ||
    selections.length !== 5
  ) {
    return false;
  }
  for (const category of Object.values(Category)) {
    /** @type {unknown} */
    const ids = selections[category];
    if (!Array.isArray(ids) || ids.length > 32) {
      return false;
    }
    for (const id of ids) {
      if (typeof id !== "string" || id.length > 63) {
        return false;
      }
      if (catalog[category].some((item) => item.id === id)) {
        continue;
      }
      const item = engine.findSupportedItem(category, id);
      if (item) {
        catalog[category].push({ ...item, retired: true });
      }
    }
  }
  return true;
}

function preview() {
  if (!catalog || !character || !engine) {
    throw new Error("Character is not initialized");
  }
  lastPreparation = character.preparationStats();
  return {
    state: character.state(),
    customThumbnail: thumbnailUrls.get("custom"),
    presets: presets.map((preset) => ({
      ...preset,
      thumbnail:
        thumbnailUrls.get(`preset:${preset.id}`) ??
        (!canReadback() || failedThumbnails.has(preset.id) ? null : undefined),
    })),
    depth: character.depth(),
    quality,
    constrained,
    preparation: lastPreparation,
    catalog: catalog.map((options, category) =>
      options
        .filter(
          (item) => !item.retired || character.isSelected(category, item.id),
        )
        .map((item) => ({
          id: item.id,
          title: item.title,
          slot: item.slot,
          retired: item.retired,
          selected: character.isSelected(category, item.id),
          available: character.isAvailable(category, item.id),
          thumbnail:
            category === Category.Shape ? thumbnail(item.thumbnail) : undefined,
          color: category === Category.Color ? swatch(item).color : undefined,
          colors:
            category === Category.Accessory
              ? engine.accessoryColorsFor(item.id).map(swatch)
              : undefined,
          colorOverride:
            category === Category.Accessory
              ? character.accessoryColor(item.id)
              : undefined,
        })),
    ),
  };
}

/** @param {import("../runtime/orbit-characters.mjs").CatalogItem} item */
function swatch(item) {
  return {
    id: item.id,
    title: item.title,
    color: `#${[item.red, item.green, item.blue]
      .map((value) =>
        Math.round(value * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`,
  };
}

/** @param {string} path */
function thumbnail(path) {
  if (!engine || !path) {
    return undefined;
  }
  if (!thumbnailUrls.has(path)) {
    let url;
    try {
      const bytes = engine.FS.readFile(`/orbit/${path}`);
      url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    } catch {
      // Historical metadata may refer to artwork absent from the current bundle.
      // The choice remains usable with its title; availability belongs to the engine.
    }
    thumbnailUrls.set(path, url);
  }
  return thumbnailUrls.get(path);
}

/** Keep 40 cached portraits, plus any additional currently visible tiles. */
function trimPresetThumbnails() {
  const cached = [...thumbnailUrls.keys()].filter((key) =>
    key.startsWith("preset:"),
  );
  let remaining = cached.length;
  for (const key of cached) {
    if (remaining <= 40) {
      break;
    }
    if (!visiblePresets.has(key.slice("preset:".length))) {
      const url = thumbnailUrls.get(key);
      if (url) {
        URL.revokeObjectURL(url);
      }
      thumbnailUrls.delete(key);
      remaining--;
    }
  }
  return remaining < cached.length;
}

/** Render portraits one at a time, matching each preset's static and animated view. */
async function generateThumbnails() {
  if (generatingThumbnails || !engine || !canReadback()) {
    return;
  }
  generatingThumbnails = true;
  let portrait;
  let renderer;
  let activityBound = false;
  try {
    while (!disposed) {
      const state = customThumbnailState;
      customThumbnailState = undefined;
      const waitingPresets = state
        ? []
        : presets.filter(
            (item) =>
              visiblePresets.has(item.id) &&
              !attemptedThumbnails.has(item.id) &&
              !thumbnailUrls.has(`preset:${item.id}`),
          );
      // Reuse the current camera binding before creating another WebGL context.
      const preset =
        waitingPresets.find(
          (item) =>
            renderer != null &&
            activityBound === (presetMotion(presets.indexOf(item)) === "gaze"),
        ) ?? waitingPresets[0];
      if (!state && !preset) {
        break;
      }
      if (preset) {
        attemptedThumbnails.add(preset.id);
      }
      try {
        const needsActivity =
          preset != null && presetMotion(presets.indexOf(preset)) === "gaze";
        if (!renderer || activityBound !== needsActivity) {
          renderer?.delete();
          renderer = undefined;
          portrait?.remove();
          portrait = document.createElement("canvas");
          portrait.id = "character-portrait";
          portrait.style.display = "none";
          document.body.append(portrait);
          renderer = new engine.Character("#character-portrait", 256, 256, {
            activities: needsActivity,
          });
          renderer.setQuality(Quality.Compact);
          renderer.setReducedMotion(true);
          activityBound = false;
        }
        let key;
        if (state) {
          key = "custom";
          if (renderer.restore(state)) {
            continue;
          }
        } else {
          if (!preset) {
            break;
          }
          key = `preset:${preset.id}`;
          if (renderer.restore(engine.presetAppearance(preset.id))) {
            continue;
          }
        }
        if (needsActivity && !activityBound) {
          // Match Ready's camera and ground shadow before the first portrait frame.
          // https://github.com/openai/orbit-character-engine/blob/5ba3b5359729aa7c25728a380d5b6b669fd5f3b9/sdk/native/CharacterRenderer.cpp#L1612
          if (!new CharacterActivityController().bind(renderer)) {
            throw new Error("Could not initialize preset portrait");
          }
          activityBound = true;
        }
        const deadline = performance.now() + 15_000;
        let submitted = false;
        while (!disposed && performance.now() < deadline) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- A single GPU renderer is pumped sequentially.
          await new Promise((resolve) => requestAnimationFrame(resolve));
          if (disposed) {
            return;
          }
          if (
            (state && customThumbnailState) ||
            (preset && !visiblePresets.has(preset.id))
          ) {
            break;
          }
          const admitted = renderer.render(performance.now() / 1000);
          const preparation = renderer.preparationStats();
          if (preparation.failed || renderer.renderError()) {
            break;
          }
          if (!admitted || preparation.pending || renderer.hasPendingUpdate()) {
            continue;
          }
          if (!submitted) {
            submitted = true;
            renderer.setReducedMotion(true);
            continue;
          }
          const fitted = fittedFrame(portrait);
          const image = fitted && uploadThumbnail(fitted, preset ? 256 : 512);
          if (!image) {
            renderer.setReducedMotion(true);
            continue;
          }
          // oxlint-disable-next-line eslint/no-await-in-loop -- Capture this portrait before reusing its renderer.
          const blob = await new Promise(
            /** @param {(value: Blob | null) => void} resolve */
            (resolve) => image.toBlob(resolve, "image/png"),
          );
          if (disposed) {
            return;
          }
          if (
            (state && customThumbnailState) ||
            (preset && !visiblePresets.has(preset.id))
          ) {
            break;
          }
          if (blob) {
            const previous = thumbnailUrls.get(key);
            thumbnailUrls.set(key, URL.createObjectURL(blob));
            if (previous) {
              URL.revokeObjectURL(previous);
            }
            trimPresetThumbnails();
            reply(0, { preview: preview() });
          }
          break;
        }
      } catch {
        // Release a failed renderer, then continue with the remaining visible tiles.
        renderer?.delete();
        renderer = undefined;
        portrait?.remove();
        portrait = undefined;
      } finally {
        if (
          !disposed &&
          preset &&
          visiblePresets.has(preset.id) &&
          !thumbnailUrls.has(`preset:${preset.id}`)
        ) {
          failedThumbnails.add(preset.id);
          reply(0, { preview: preview() });
        }
      }
    }
  } finally {
    generatingThumbnails = false;
    renderer?.delete();
    portrait?.remove();
    if (!disposed && editorListening) {
      reply(0, { preview: preview() });
    }
  }
}

function reply(id, result) {
  parent.postMessage(
    { type: "orbit-character-editor", id, ...result },
    location.origin,
  );
}

function canReadback() {
  if (readbackAvailable === undefined) {
    try {
      readbackAvailable = !!document.createElement("canvas").getContext("2d", {
        willReadFrequently: true,
      });
    } catch {
      readbackAvailable = false;
    }
  }
  return readbackAvailable;
}

/** @param {{scale: number, translateX: number, translateY: number}} presentation */
function applyPresentation({ scale, translateX, translateY }) {
  // Match the centered, half-size saved portrait while leaving room for reactions.
  const frameScale = framing === "activity" ? 0.5 : 1;
  const inset = (1 - frameScale) / 2;
  contentScale = scale * frameScale;
  const x = translateX * frameScale + inset;
  const y = translateY * frameScale + inset;
  canvas.style.transform = `translate(${x * 100}%, ${y * 100}%) scale(${contentScale})`;
  captureTransitionSnapshot(contentScale, x, y);
  // Rasterize at the fitted size so CSS enlargement preserves display density.
  setSize(pixelSize());
}

/** @param {number} scale @param {number} x @param {number} y */
function captureTransitionSnapshot(scale, x, y) {
  const state = restoredAppearance;
  const snapshotFraming = framing;
  // Unsaved editor changes no longer belong to the parent's appearance bytes.
  if (!state || editorListening) {
    return;
  }
  try {
    const image = document.createElement("canvas");
    image.width = image.height = 512;
    const context = image.getContext("2d");
    if (!context) {
      return;
    }
    // Preserve the full renderer viewport, including its transparent margins.
    // Read the neutral frame before resizing clears the drawing buffer.
    context.drawImage(canvas, x * 512, y * 512, scale * 512, scale * 512);
    image.toBlob((blob) => {
      if (!blob || disposed) {
        return;
      }
      void blob.arrayBuffer().then(
        (bytes) => {
          if (
            !disposed &&
            state === restoredAppearance &&
            snapshotFraming === framing
          ) {
            parent.postMessage(
              {
                type: "orbit-character",
                status: "snapshot",
                state,
                framing: snapshotFraming,
                png: new Uint8Array(bytes),
              },
              location.origin,
            );
          }
        },
        () => {},
      );
    }, "image/png");
  } catch {
    // Optional readback or encoding must never delay or fail the live renderer.
  }
}

// Match Android's neutral content fit and full-footprint presentation:
// https://github.com/openai/openai-android/blob/c94fd093c4e3b3cd6e02a95c1366db54210507a1/feature/orbit-characters/impl/src/main/kotlin/com/openai/feature/orbitcharacters/impl/OrbitAvatarContentFit.kt
/** @param {HTMLCanvasElement} source */
function fittedFrame(source) {
  if (!canReadback()) {
    return null;
  }
  try {
    const width = source.width;
    const height = source.height;
    const raw = document.createElement("canvas");
    raw.width = width;
    raw.height = height;
    const rawContext = raw.getContext("2d", { willReadFrequently: true });
    const framed = document.createElement("canvas");
    framed.width = 512;
    framed.height = 512;
    const framedContext = framed.getContext("2d", { willReadFrequently: true });
    if (!rawContext || !framedContext || width <= 0 || height <= 0) {
      return false;
    }
    rawContext.drawImage(source, 0, 0);
    const neutralBounds = alphaBounds(
      rawContext.getImageData(0, 0, width, height),
      8,
    );
    if (!neutralBounds) {
      return false;
    }
    const neutralScale =
      Math.min(width / neutralBounds.width, height / neutralBounds.height) *
      0.9;
    const neutralX =
      0.5 -
      ((neutralBounds.left + neutralBounds.right) / (2 * width)) * neutralScale;
    const neutralY = 0.95 - (neutralBounds.bottom / height) * neutralScale;
    framedContext.drawImage(
      raw,
      neutralX * 512,
      neutralY * 512,
      neutralScale * 512,
      neutralScale * 512,
    );
    const bounds = alphaBounds(framedContext.getImageData(0, 0, 512, 512), 1);
    if (!bounds) {
      return false;
    }
    const presentationScale = Math.min(512 / bounds.width, 512 / bounds.height);
    const presentationX =
      0.5 - ((bounds.left + bounds.right) / 1024) * presentationScale;
    const presentationY =
      0.5 - ((bounds.top + bounds.bottom) / 1024) * presentationScale;
    return {
      framed,
      bounds,
      presentation: {
        scale: neutralScale * presentationScale,
        translateX: neutralX * presentationScale + presentationX,
        translateY: neutralY * presentationScale + presentationY,
      },
    };
  } catch {
    // A readback race must not hide the live character or replace its saved PNG.
    return false;
  }
}

/** @param {ImageData} image @param {number} minimumAlpha */
function alphaBounds(image, minimumAlpha) {
  const { data, width, height } = image;
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= minimumAlpha) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
  }
  return right > left && bottom > top
    ? { left, top, right, bottom, width: right - left, height: bottom - top }
    : null;
}

// Android uploads a separate 512px crop of the fitted neutral snapshot:
// https://github.com/openai/openai-android/blob/c94fd093c4e3b3cd6e02a95c1366db54210507a1/feature/orbit-characters/impl/src/main/kotlin/com/openai/feature/orbitcharacters/impl/OrbitAvatarSnapshotBitmap.kt
/** @param {{framed: HTMLCanvasElement, bounds: {left: number, top: number, width: number, height: number}}} snapshot */
function uploadThumbnail({ framed, bounds }, size = 512) {
  try {
    const thumbnail = document.createElement("canvas");
    thumbnail.width = size;
    thumbnail.height = size;
    const context = thumbnail.getContext("2d");
    if (!context) {
      return null;
    }
    context.imageSmoothingQuality = "high";
    const scale = size / Math.max(bounds.width, bounds.height);
    const width = bounds.width * scale;
    const height = bounds.height * scale;
    context.drawImage(
      framed,
      bounds.left,
      bounds.top,
      bounds.width,
      bounds.height,
      (size - width) / 2,
      (size - height) / 2,
      width,
      height,
    );
    return thumbnail;
  } catch {
    return null;
  }
}
notify("loaded");
