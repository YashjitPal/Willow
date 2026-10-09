import {
  ActivityKind,
  Quality,
  ReactionKind,
  ReactionResult,
} from "../runtime/orbit-enums.mjs";
import { CharacterActivityController } from "./activity.mjs";

/** @typedef {{scale: number, translateX: number, translateY: number}} Presentation */
/**
 * @typedef {object} PresetPreview
 * @property {string} presetId
 * @property {HTMLCanvasElement} canvas
 * @property {OffscreenCanvasRenderingContext2D} context
 * @property {MessagePort} port
 * @property {boolean} waiting
 * @property {import("../runtime/orbit-characters.mjs").Character} character
 * @property {CharacterActivityController} activity
 * @property {"gaze" | "idle" | "signature"} motion
 * @property {number} motionStartedAt
 * @property {number} motionCue
 * @property {Presentation | null} presentation
 * @property {boolean} firstFrame
 * @property {boolean} ready
 * @property {number} elapsed
 * @property {() => void} resolve
 * @property {(reason: unknown) => void} reject
 */

let nextCanvasId = 0;

/** @param {number} index @returns {PresetPreview["motion"]} */
export function presetMotion(index) {
  if (index % 3 === 0) {
    return "gaze";
  }
  return index % 3 === 1 ? "idle" : "signature";
}

/** Reuses the editor's module for the currently interacted preset tile. */
export class PresetPreviews {
  /**
   * Neutral fits for this iframe's fixed 256px Compact preset previews.
   * @type {Map<string, Presentation>}
   */
  presentations = new Map();
  /** @type {PresetPreview | undefined} */
  preview;
  /** @type {number | undefined} */
  animation;
  /** @type {number | undefined} */
  lastTick;
  frameRemainder = 0;
  disposed = false;

  /**
   * @param {import("../runtime/orbit-characters.mjs").OrbitModule} engine
   * @param {(canvas: HTMLCanvasElement) => {presentation: Presentation} | false | null} fittedFrame
   */
  constructor(engine, fittedFrame) {
    this.engine = engine;
    this.fittedFrame = fittedFrame;
    document.addEventListener("visibilitychange", this.visibilityChanged);
  }

  /** @param {string} presetId @param {MessagePort} port @param {number} index @returns {Promise<void>} */
  async add(presetId, port, index) {
    if (this.disposed) {
      port.close();
      throw new Error("Preset previews are disposed");
    }
    this.remove();
    /** @type {OffscreenCanvasRenderingContext2D | null} */
    let context;
    try {
      context = new OffscreenCanvas(384, 384).getContext("2d");
    } catch (error) {
      port.close();
      throw error;
    }
    if (!context) {
      port.close();
      throw new Error("Preset preview needs a drawable canvas");
    }
    context.imageSmoothingQuality = "high";
    // Replace the whole image in one draw, retaining the old image if drawing throws.
    context.globalCompositeOperation = "copy";
    const canvas = document.createElement("canvas");
    canvas.id = `orbit-preset-preview-${++nextCanvasId}`;
    canvas.hidden = true;
    document.body.append(canvas);
    /** @type {import("../runtime/orbit-characters.mjs").Character | undefined} */
    let character;
    const motion = presetMotion(index);
    const activity = new CharacterActivityController();
    try {
      character = new this.engine.Character(`#${canvas.id}`, 256, 256, {
        activities: motion !== "idle",
      });
      if (
        !character.setQuality(Quality.Compact) ||
        character.restore(this.engine.presetAppearance(presetId)) ||
        (motion === "gaze" && !activity.bind(character))
      ) {
        throw new Error("Could not initialize preset preview");
      }
      character.setReducedMotion(true);
      character.setActive(!document.hidden);
    } catch (error) {
      port.close();
      try {
        character?.delete();
      } finally {
        canvas.remove();
      }
      throw error;
    }
    const renderer = character;
    return new Promise((resolve, reject) => {
      /** @type {PresetPreview} */
      const preview = {
        presetId,
        canvas,
        context,
        port,
        waiting: false,
        character: renderer,
        activity,
        motion,
        motionStartedAt: 0,
        motionCue: -1,
        presentation: null,
        firstFrame: false,
        ready: false,
        elapsed: 0,
        resolve,
        reject,
      };
      this.preview = preview;
      try {
        port.onmessage = () => {
          if (this.preview !== preview) {
            return;
          }
          preview.waiting = false;
          this.schedule();
        };
        port.onmessageerror = () => {
          if (this.preview !== preview) {
            return;
          }
          reject(new Error("Preset preview channel failed"));
          this.remove(presetId);
        };
        port.start();
        renderer.onFirstFrame(() => {
          if (this.preview === preview) {
            preview.firstFrame = true;
          }
        });
        this.schedule();
      } catch (error) {
        reject(new Error("Could not start preset preview", { cause: error }));
        this.remove(presetId);
      }
    });
  }

  /** @param {string} [presetId] */
  remove(presetId) {
    const preview = this.preview;
    if (!preview || (presetId !== undefined && presetId !== preview.presetId)) {
      return;
    }
    this.preview = undefined;
    preview.reject(new DOMException("Preset preview removed", "AbortError"));
    // Notify the tile even if the first-frame promise has already resolved.
    preview.port.postMessage(null);
    preview.port.onmessage = null;
    preview.port.onmessageerror = null;
    preview.port.close();
    try {
      try {
        preview.character.onFirstFrame(null);
      } finally {
        preview.character.delete();
      }
    } catch {
      // A failed module may reject native calls; the owning frame handles recovery.
    }
    preview.canvas.remove();
    if (this.animation != null) {
      cancelAnimationFrame(this.animation);
    }
    this.animation = undefined;
    this.lastTick = undefined;
    this.frameRemainder = 0;
  }

  dispose() {
    this.disposed = true;
    this.presentations.clear();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.remove();
  }

  visibilityChanged = () => {
    if (this.animation != null) {
      cancelAnimationFrame(this.animation);
      this.animation = undefined;
    }
    this.lastTick = undefined;
    this.frameRemainder = 0;
    const preview = this.preview;
    if (preview) {
      try {
        preview.character.setActive(!document.hidden);
      } catch (error) {
        preview.reject(error);
        this.remove(preview.presetId);
      }
    }
    this.schedule();
  };

  schedule() {
    if (
      this.animation == null &&
      !this.disposed &&
      !document.hidden &&
      this.preview &&
      !this.preview.waiting
    ) {
      this.animation = requestAnimationFrame(this.tick);
    }
  }

  /** @param {number} timestamp */
  tick = (timestamp) => {
    this.animation = undefined;
    const preview = this.preview;
    if (!preview || this.disposed || document.hidden) {
      return;
    }
    const elapsed = this.lastTick == null ? 0 : timestamp - this.lastTick;
    const frameInterval = 1000 / 30;
    if (
      this.lastTick != null &&
      elapsed + this.frameRemainder < frameInterval
    ) {
      this.schedule();
      return;
    }
    // Carry fractional time forward so rounded display timestamps do not drop frames.
    this.frameRemainder = (this.frameRemainder + elapsed) % frameInterval;
    this.lastTick = timestamp;
    try {
      if (preview.waiting) {
        return;
      }
      if (!preview.ready) {
        preview.elapsed += elapsed;
        if (preview.elapsed > 15_000) {
          throw new Error("Preset preview did not become ready");
        }
      }
      if (!preview.presentation) {
        // Measure the still pose before starting motion, using a fresh drawing
        // buffer while waiting for the first completed frame and its bounds.
        preview.character.setReducedMotion(true);
      } else if (preview.motion === "gaze") {
        const cue = Math.floor((timestamp - preview.motionStartedAt) / 1400);
        if (cue !== preview.motionCue) {
          const step = cue % 8;
          if (step === 1 || step === 2 || step === 3) {
            let x = 0.5;
            if (step === 1) {
              x = 0.05;
            } else if (step === 2) {
              x = 0.95;
            }
            if (
              preview.character.setReadyGaze(
                x,
                step === 3 ? 0.1 : 0.4,
                timestamp / 1000,
              )
            ) {
              preview.motionCue = cue;
            }
          } else {
            preview.character.clearReadyGaze(timestamp / 1000);
            preview.motionCue = cue;
          }
        }
      } else if (preview.motion === "signature") {
        const cue = Math.floor((timestamp - preview.motionStartedAt) / 8000);
        if (cue !== preview.motionCue) {
          preview.motionCue = cue;
          const result = preview.character.playReaction(ReactionKind.Signature);
          if (result === ReactionResult.Unsupported) {
            preview.motion = "idle";
          } else if (
            result !== ReactionResult.Accepted &&
            result !== ReactionResult.Busy
          ) {
            throw new Error("Could not start preset signature");
          }
        }
      }
      const admitted = preview.character.render(timestamp / 1000);
      if (preview.character.renderError()) {
        throw new Error("Preset preview rendering failed");
      }
      if (admitted) {
        // WebGL submission queues work; the next render pumps it before copying.
        // https://github.com/openai/orbit-character-engine/blob/5ba3b5359729aa7c25728a380d5b6b669fd5f3b9/sdk/native/GLESBackend.cpp#L1477
        preview.character.render(timestamp / 1000);
      }
      const preparation = preview.character.preparationStats();
      if (preview.character.renderError() || preparation.failed) {
        throw new Error("Preset preview rendering failed");
      }
      if (!admitted || !preview.firstFrame || preparation.pending) {
        return;
      }
      if (!preview.presentation) {
        let presentation = this.presentations.get(preview.presetId);
        if (!presentation) {
          const fitted = this.fittedFrame(preview.canvas);
          if (!fitted) {
            return;
          }
          presentation = fitted.presentation;
          this.presentations.set(preview.presetId, presentation);
        }
        preview.presentation = presentation;
        preview.motionStartedAt = timestamp;
        if (preview.motion === "gaze") {
          preview.activity.requested = {
            kind: ActivityKind.Ready,
            turnId: null,
          };
          if (!preview.activity.apply(preview.character, false)) {
            throw new Error("Could not start preset Ready animation");
          }
        }
        // The parent only requests previews when its motion setting allows it.
        preview.character.setReducedMotion(false);
      }
      const { context, canvas, presentation } = preview;
      const { width, height } = context.canvas;
      // Match the static thumbnail's size, with extra canvas room for reactions.
      const side = Math.min(canvas.width, canvas.height);
      context.drawImage(
        canvas,
        (width - side) / 2 + presentation.translateX * side,
        (height - side) / 2 + presentation.translateY * side,
        presentation.scale * side,
        presentation.scale * side,
      );
      const bitmap = context.canvas.transferToImageBitmap();
      try {
        preview.waiting = true;
        preview.port.postMessage(bitmap, [bitmap]);
      } catch (error) {
        bitmap.close();
        throw error;
      }
      if (!preview.ready) {
        preview.ready = true;
        preview.resolve();
      }
    } catch (error) {
      preview.reject(error);
      this.remove(preview.presetId);
    } finally {
      this.schedule();
    }
  };
}
