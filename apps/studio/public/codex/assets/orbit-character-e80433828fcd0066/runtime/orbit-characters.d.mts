import type { Category, Quality, PointerPhase, ReactionKind, ReactionResult, ActivityCommandType, ActivityKind, ActivityOutcome, ActivityEntry, ActivityApplyResult, ActivityTheme, RenderOutcome, TimingStatus, CharacterSource } from './orbit-enums.mjs';
export { Category, Quality, PointerPhase, ReactionKind, ReactionResult, ActivityCommandType, ActivityKind, ActivityOutcome, ActivityEntry, ActivityApplyResult, ActivityTheme, RenderOutcome, TimingStatus, CharacterSource } from './orbit-enums.mjs';

export interface CharacterOptions {
  /** Enable native activity preparation and commands for this renderer's lifetime.
   * Defaults to false for lightweight previews/editors. Cannot be changed later. */
  activities?: boolean;
}

/** Native V1 activity command. The binding supplies the ABI size/version.
 * Counters are exact bigints in [0n, 2n**63n-1n], not timestamps or server IDs.
 * Native validation owns command combinations, ordering, and episode identity. */
export interface ActivityCommand {
  /** Strictly increases for new commands within one host controller lifetime. */
  sequence: bigint;
  /** Positive for live commands; never reuse for a new activation. */
  episodeId: bigint;
  /** Restore only: highest allocated episode ID. Zero for Start/Stop. */
  episodeHighWater: bigint;
  command: ActivityCommandType;
  /** None is only valid for an empty Restore (episodeId 0n, entry Sustained). */
  activity: ActivityKind;
  /** Neutral except on Stop. Use other outcomes only for authoritative results. */
  outcome: ActivityOutcome;
  /** Start for live commands. Restore can resume without replaying an entrance. */
  entry: ActivityEntry;
}

/** Owned metadata snapshot. RGB is sRGB in [0, 1]; not all entries are swatches. */
export interface CatalogItem {
  id: string;
  title: string;
  /** Path relative to /orbit in module.FS; empty when no image exists. */
  thumbnail: string;
  /** Native slot, or an empty string when not applicable. */
  slot: string;
  red: number;
  green: number;
  blue: number;
}
/** Owned metadata for a complete character preset. */
export interface CharacterPreset {
  id: string;
  title: string;
}
/** One of the original eight named Here outfits. */
export type HereCharacter = CharacterPreset;
/** Existing Embind enum handle from an initialized module. */
export interface PointerPhaseHandle {
  readonly value: PointerPhase;
}
export interface FrameStats {
  vertices: number;
  triangles: number;
  renderables: number;
  meshBuilds: number;
  renderedFrames: number;
  lastCpuFrameMs: number;
  /** Currently selected native tier; use preparation state to check readiness. */
  effectiveQuality: Quality;
}
/** Owned snapshot; all counters are exact unsigned 64-bit bigints. */
export interface PreparationStats {
  generation: bigint;
  committedGeneration: bigint;
  /** Advances on installation or rejection, including rollback of a failed edit. */
  revision: bigint;
  started: bigint;
  completed: bigint;
  discarded: bigint;
  lastCpuPrepareMs: number;
  pending: boolean;
  failed: boolean;
}
export interface CharacterCacheStats {
  version: number;
  compiled: bigint;
  bundledHits: bigint;
  diskHits: bigint;
  lastSourceBytes: bigint;
  lastSource: CharacterSource;
}
/** Native diagnostics, without inferred timings or presentation guarantees. */
export interface RenderDiagnostics {
  version: number;
  lastOutcome: RenderOutcome;
  renderCalls: bigint;
  idleSkips: bigint;
  preparationSkips: bigint;
  admissionAttempts: bigint;
  admissionRejections: bigint;
  submittedFrames: bigint;
  lastSubmittedGeneration: bigint;
  /** Timing may lag counters and is not associated with lastSubmittedGeneration. */
  hasTimingSample: boolean;
  frameId: number;
  gpuDurationStatus: TimingStatus;
  gpuCompletionStatus: TimingStatus;
  presentationStatus: TimingStatus;
  /** Nanoseconds; nonpositive means unmeasured. */
  gpuDurationNs: bigint;
  /** Steady-clock nanoseconds; nonpositive means unmeasured. */
  gpuCompletionNs: bigint;
  /** Steady-clock nanoseconds; -1n unsupported, -2n unavailable. Check status too. */
  presentationNs: bigint;
  /** Steady-clock nanoseconds, not the render animation clock. */
  cpuBeginNs: bigint;
  cpuEndNs: bigint;
  backendBeginNs: bigint;
  backendEndNs: bigint;
  /** Zero when no platform timing was supplied (including ordinary web render). */
  vsyncNs: bigint;
  callbackNs: bigint;
}
/** Use only on the browser main thread where created. Call delete() exactly once,
 * stop callbacks first, and use only isDeleted() after deletion. */
export interface Character {
  /** Monotonic seconds. True means submitted, not necessarily presented.
   * Keep polling while visible, including when idle, to install or reject preparation. */
  render(seconds: number): boolean;
  /** One-shot callback from render() after the first successful GPU frame completes.
   * Keep rendering until called, including with reduced motion. No pixel readback or
   * blocking GPU wait; does not guarantee physical display presentation.
   * Replaces any pending callback; null cancels. If a frame already completed,
   * runs on the next successful render() call, even if no new frame is admitted. */
  onFirstFrame(callback: (() => void) | null): void;
  /** Backing-store pixels, not CSS pixels. */
  resize(width: number, height: number): void;
  /** Drawable pixels per CSS pixel, including render-resolution caps. Defaults to 1.
   * Nonpositive/nonfinite values are ignored by the native engine. */
  setDisplayScale(pixelsPerPoint: number): void;
  setActive(active: boolean): void;
  setReducedMotion(reduced: boolean): void;
  /** Requires construction with { activities: true }; otherwise returns InvalidArgument.
   * Copies synchronously; bind before the first admitted render(). Binding lasts
   * until delete(), including after Stop, and disables legacy pointer/reaction playback.
   * Does not prepare geometry, change appearance bytes, or prove frame presentation.
   * Malformed JS values return InvalidArgument without numeric coercion. Negative
   * results leave activity state unchanged and do not change error()/renderError().
   * Replays may return Unchanged/ignored results; never assume every nonnegative result applied. */
  applyActivity(command: ActivityCommand): ActivityApplyResult;
  /** Temporarily follow a point over Ready without restarting its clock. Coordinates
   * match pointer(): normalized 0..1, top left origin; seconds match render().
   * Active characters accept targets before the first render or resumed frame.
   * Returns false for invalid input, inactive/non-Ready characters or passive rings. */
  setReadyGaze(x: number, y: number, seconds: number): boolean;
  /** Ease back into the continuing Ready animation. */
  clearReadyGaze(seconds: number): void;
  /** Owned desired-state snapshot, or null before binding. Reconcile with current
   * host truth before applying to a new renderer. After binding, only an exact
   * Restore replay before any live command is allowed (returns Unchanged).
   * Survives later calls, WASM memory growth, and delete(). Not part of ORBAST1. */
  copyActivityRestore(): ActivityCommand | null;
  /** Convey the background behind the transparent canvas. Defaults to Light.
   * Current native prop artwork uses the same palette in both themes.
   * Invalid values are ignored. Requests redraw without preparing geometry, changing
   * appearance bytes, or advancing the activity clock. Reapply on a new renderer. */
  setActivityTheme(theme: ActivityTheme): void;
  /** Finite wave or current hero's signature, starting on frame admission. No queue or saved state.
   * Busy while playing/releasing; unavailable when inactive, pressed or activity-bound;
   * unsupported for unknown kinds, passive circles, or signatures on custom characters. Drag interrupts;
   * setActive(false), reset() and delete() cancel. Call only on a live instance. */
  playReaction(kind: ReactionKind): ReactionResult;
  /** False for unsupported tiers; leaves quality unchanged. */
  setQuality(quality: Quality): boolean;
  /** Native low-power/thermal/memory-pressure signal, overriding quality. */
  setConstrained(constrained: boolean): void;
  /** False for unknown/unavailable additions; does not mutate appearance.
   * Selecting the active accessory removes it, including a supported retired item. */
  select(category: Category, id: string): boolean;
  /** Replaces the whole appearance with a canonical Here preset at depth 0.5.
   * Unknown IDs return false without mutation. True means accepted, not rendered;
   * preparation is asynchronous and may roll back, as with restore(). */
  selectHereCharacter(id: string): boolean;
  isSelected(category: Category, id: string): boolean;
  /** Availability for a NEW choice in the requested appearance, not removal. */
  isAvailable(category: Category, id: string): boolean;
  /** Empty or native default color restores original paint. Invalid IDs return false without mutation. */
  setAccessoryColor(accessory: string, color: string): boolean;
  clearAccessoryColor(accessory: string): boolean;
  /** Explicit override or empty string. Overrides may survive deselection. */
  accessoryColor(accessory: string): string;
  /** Unitless preview deformation. Native clamps finite values to [0, 1]; circle is unchanged. */
  setDepth(depth: number): void;
  depth(): number;
  /** Native appearance/pose reset; circle appearances are unchanged. May prepare asynchronously. */
  reset(): void;
  /** Normalized canvas coordinates, top-left origin; monotonic seconds.
   * pointerId is uint32. Forward cancellation when a gesture ends without pointer-up. */
  pointer(phase: PointerPhase | PointerPhaseHandle, pointerId: number, x: number, y: number, seconds: number): void;
  /** Latest native render/API error. Empty string means no error. */
  renderError(): string;
  /** Separate nonfatal preparation failure; cleared by the next accepted geometry change. */
  preparationError(): string;
  /** Compatibility convenience: renderError() if nonempty, otherwise preparationError(). */
  error(): string;
  hasPendingUpdate(): boolean;
  /** Owned ORBAST1 bytes of requested appearance; may roll back after preparation failure. */
  state(): Uint8Array;
  /** Copies input synchronously. Empty string on acceptance, diagnostic on invalid state.
   * Invalid state does not mutate appearance. Later preparation failure rolls back.
   * Historical saves require their original verified resource bundle. */
  restore(state: Uint8Array): string;
  stats(): FrameStats;
  preparationStats(): PreparationStats;
  diagnostics(): RenderDiagnostics;
  characterCacheStats(): CharacterCacheStats;
  isDeleted(): boolean;
  delete(): void;
}
export interface OrbitModule {
  /** Compatibility handles; pointer() also accepts the named numeric PointerPhase exports. */
  PointerPhase: Readonly<{
    Down: PointerPhaseHandle; Move: PointerPhaseHandle; Up: PointerPhaseHandle; Cancel: PointerPhaseHandle;
  }>;
  /** CSS selector for a canvas; dimensions in backing pixels. Options are copied.
   * Throws TypeError for malformed options, Error on native creation failure. */
  Character: new (canvas: string, width: number, height: number, options?: CharacterOptions) => Character;
  /** New choices only; invalid category returns []. No renderer required. */
  catalog(category: Category): CatalogItem[];
  /** Named Here presets only; no renderer required. Entries are independently owned. */
  hereCharacters(): HereCharacter[];
  /** All 108 presets in display order, with the eight heroes first. Owned metadata. */
  presets(): CharacterPreset[];
  /** Metadata only. Defaults: offset 0, limit 20. Limit 1...100; no fitting or rendering.
   * Past-end offsets return an empty terminal page. All results are owned copies. */
  presetPage(options?: { offset?: number; limit?: number }): {
    items: CharacterPreset[]; totalCount: number; nextOffset: number | null;
  };
  /** Owned complete ORBAST1 appearance. Throws Error for an unknown preset ID. */
  presetAppearance(id: string): Uint8Array;
  /** Includes supported retired IDs. Unknown category/ID returns null. */
  findSupportedItem(category: Category, id: string): CatalogItem | null;
  accessoryColors(): CatalogItem[];
  /** Includes supported retired accessories; invalid ID returns []. */
  accessoryColorsFor(accessory: string): CatalogItem[];
  /** Native validation/availability; malformed bytes or unknown/retired choice returns false. */
  isAvailable(category: Category, id: string, state: Uint8Array): boolean;
  /** Empty string on validity, native diagnostic otherwise. Does not create a renderer. */
  validateAppearance(state: Uint8Array): string;
  /** Owned normalized ORBAST1 bytes. Throws Error on invalid input; input is never mutated. */
  normalizeAppearance(state: Uint8Array): Uint8Array;
  /** Seed must be a bigint in [0n, 2n**64n-1n]. Throws TypeError/RangeError otherwise.
   * Returns owned ORBAST1 bytes without a renderer. Persist bytes, not just the seed. */
  generateCuratedAppearance(seed: bigint): Uint8Array;
  curatedRandomizerVersion(): number;
  FS: {
    readFile(path: string, options?: { encoding?: 'binary' }): Uint8Array;
  };
}
export interface OrbitModuleOptions {
  locateFile?: (path: string, prefix: string) => string;
  print?: (message: string) => void;
  printErr?: (message: string) => void;
}
/** Requires WebGL2 for Character, shared WASM memory and cross-origin isolation.
 * Await module initialization even for renderer-independent state functions.
 * All state inputs must be Uint8Array, or throw TypeError. */
export default function createOrbitModule(options?: OrbitModuleOptions): Promise<OrbitModule>;
