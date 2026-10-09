/**
 * ORBAST1 character state <-> appearance manifest conversion, ported from the Codex
 * client: the manifest schema and encoder live in app-shared (`KFn`, `qFn`, `HFn`),
 * the decoder in the save-character chunk (`s`).
 */

export type Vector2 = [number, number];
export type Vector3 = [number, number, number];

export interface OrbitPartTransform {
  offset?: Vector3;
  rotation?: Vector3;
  scale?: Vector3;
}

export interface OrbitAppearanceModel {
  body?: {
    variant?: string;
    scale?: Vector3;
    upperStart?: number;
    upperScale?: number;
    volume?: {
      halfDepth?: number;
      shoulderFullness?: number;
      lobes?: { center: Vector2; radius: Vector2; strength: number }[];
    };
  };
  eyes?: { position: Vector3; rotation?: Vector3; scale?: Vector3; reflectX?: boolean; surfaceRelative?: boolean }[];
  eyeMount?: "authored" | "body" | "body-fixed";
  closedLidScale?: Vector3;
  pupilScale?: Vector3;
  eyewear?: OrbitPartTransform;
  eyewearBridge?: boolean;
  eyewearVariant?: "round_sunglasses_no_sidecaps";
  accessories?: Record<string, OrbitPartTransform>;
  materials?: Record<string, { albedo?: Vector3; roughness?: number; reflectance?: number }>;
  headphones?: { top?: number; cushionScale?: Vector3; bandThicknessScale?: number };
  restingEyeClosure?: number;
  eyewearSurfaceAlignment?: number;
  eyeGazeScale?: Vector2;
}

export interface OrbitAppearance {
  schemaVersion: 1 | 2 | 3;
  studioShape?: "donut";
  shape: string;
  color: string;
  eyes: string;
  eyewear: string;
  accessories: string[];
  accessoryColors?: Record<string, string>;
  flowerCenter?: false;
  depth: number;
  model?: OrbitAppearanceModel;
  hereCharacter?: { id: string; name: string };
}

export interface OrbitAvatarSnapshot {
  schema_version: 1;
  asset_pointer: string;
}

/** Server-side `avatar_manifest` of a bot with a `rendered-interactive` avatar. */
export interface OrbitAvatarManifest {
  schema_version: 1;
  appearance: OrbitAppearance;
  resource_bundle_id?: string;
  snapshot?: OrbitAvatarSnapshot;
}

/** sha256 of `orbit-characters.data` in the bundled runtime manifest. */
export const ORBIT_RESOURCE_BUNDLE_ID = "ffefb69b44f815cccb5f07b4d951d479e527dbabdca68ad9986cf695f9b9c440";

const MAX_STATE_BYTES = 65536;
const MAX_TEXT_BYTES = 63;
const COLOR_RESET_ACCESSORIES = ["feather", "halo", "piercings", "moustache", "teardrop"];

type Check = (value: unknown) => boolean;

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const optional =
  (check: Check): Check =>
  (value) =>
    value === undefined || check(value);
const isOrbitText: Check = (value) =>
  typeof value === "string" && !value.includes("\0") && new TextEncoder().encode(value).length <= MAX_TEXT_BYTES;
const isNumber: Check = (value) => typeof value === "number" && Number.isFinite(value);
const isBoolean: Check = (value) => typeof value === "boolean";
const literal =
  (...values: unknown[]): Check =>
  (value) =>
    values.includes(value);
const numbers =
  (length: number): Check =>
  (value) =>
    Array.isArray(value) && value.length === length && value.every(isNumber);
const arrayOf =
  (item: Check, limits: { max?: number; length?: number }): Check =>
  (value) =>
    Array.isArray(value) &&
    (limits.max == null || value.length <= limits.max) &&
    (limits.length == null || value.length === limits.length) &&
    value.every(item);
const recordOf =
  (item: Check): Check =>
  (value) =>
    isRecordObject(value) && Object.entries(value).every(([key, entry]) => isOrbitText(key) && item(entry));
const strictObject =
  (shape: Record<string, Check>): Check =>
  (value) =>
    isRecordObject(value) &&
    Object.keys(value).every((key) => Object.hasOwn(shape, key)) &&
    Object.entries(shape).every(([key, check]) => check(value[key]));

const isVector2 = numbers(2);
const isVector3 = numbers(3);
const isPart = strictObject({ offset: optional(isVector3), rotation: optional(isVector3), scale: optional(isVector3) });

const isModel = strictObject({
  body: optional(
    strictObject({
      variant: optional((value) => isOrbitText(value) && (value as string).length >= 1),
      scale: optional(isVector3),
      upperStart: optional(isNumber),
      upperScale: optional(isNumber),
      volume: optional(
        strictObject({
          halfDepth: optional(isNumber),
          shoulderFullness: optional(isNumber),
          lobes: optional(
            arrayOf(strictObject({ center: isVector2, radius: isVector2, strength: isNumber }), { max: 16 }),
          ),
        }),
      ),
    }),
  ),
  eyes: optional(
    arrayOf(
      strictObject({
        position: isVector3,
        rotation: optional(isVector3),
        scale: optional(isVector3),
        reflectX: optional(isBoolean),
        surfaceRelative: optional(isBoolean),
      }),
      { length: 2 },
    ),
  ),
  eyeMount: optional(literal("authored", "body", "body-fixed")),
  closedLidScale: optional(isVector3),
  pupilScale: optional(isVector3),
  eyewear: optional(isPart),
  eyewearBridge: optional(isBoolean),
  eyewearVariant: optional(literal("round_sunglasses_no_sidecaps")),
  accessories: optional(recordOf(isPart)),
  materials: optional(
    recordOf(strictObject({ albedo: optional(isVector3), roughness: optional(isNumber), reflectance: optional(isNumber) })),
  ),
  headphones: optional(
    strictObject({ top: optional(isNumber), cushionScale: optional(isVector3), bandThicknessScale: optional(isNumber) }),
  ),
  restingEyeClosure: optional(isNumber),
  eyewearSurfaceAlignment: optional(isNumber),
  eyeGazeScale: optional(isVector2),
});

const hasAppearanceShape = strictObject({
  schemaVersion: literal(1, 2, 3),
  studioShape: optional(literal("donut")),
  shape: isOrbitText,
  color: isOrbitText,
  eyes: isOrbitText,
  eyewear: isOrbitText,
  accessories: arrayOf(isOrbitText, { max: 32 }),
  accessoryColors: optional(recordOf(isOrbitText)),
  flowerCenter: optional(literal(false)),
  depth: isNumber,
  model: optional(isModel),
  hereCharacter: optional(strictObject({ id: isOrbitText, name: isOrbitText })),
});

export function isOrbitAppearance(value: unknown): value is OrbitAppearance {
  if (!hasAppearanceShape(value)) return false;
  const appearance = value as OrbitAppearance;
  return (
    (appearance.model == null || appearance.schemaVersion === 2) &&
    (appearance.schemaVersion === 3) === (appearance.hereCharacter != null) &&
    (appearance.model?.eyeMount !== "body-fixed" || appearance.model.eyes != null) &&
    (appearance.model?.eyewearVariant == null || appearance.eyewear === "round_sunglasses")
  );
}

export function isOrbitAvatarManifest(value: unknown): value is OrbitAvatarManifest {
  return isRecordObject(value) && value.schema_version === 1 && isOrbitAppearance(value.appearance);
}

export function isOrbitAvatarSnapshot(value: unknown): value is OrbitAvatarSnapshot {
  return isRecordObject(value) && value.schema_version === 1 && typeof value.asset_pointer === "string";
}

class AppearanceWriter {
  bytes: number[] = [];
  valid = true;

  tag(value: string) {
    this.bytes.push(...new TextEncoder().encode(value));
  }

  text(value: string) {
    const encoded = new TextEncoder().encode(value);
    this.count(encoded.length);
    this.bytes.push(...encoded);
  }

  count(value: number) {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setUint32(0, value, true);
    this.bytes.push(...new Uint8Array(buffer));
  }

  scalar(value: number) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setFloat32(0, value === 0 ? 0 : value, true);
    this.valid = this.valid && Number.isFinite(view.getFloat32(0, true));
    this.bytes.push(...new Uint8Array(buffer));
  }

  flag(value: boolean) {
    this.bytes.push(+!!value);
  }

  vector(values: readonly number[]) {
    values.forEach((value) => this.scalar(value));
  }

  part(part: OrbitPartTransform) {
    this.vector(part.offset ?? [0, 0, 0]);
    this.vector(part.rotation ?? [0, 0, 0]);
    this.vector(part.scale ?? [1, 1, 1]);
  }

  entries<T>(record: Record<string, T>, writeValue: (value: T) => void) {
    const sorted = Object.entries(record).sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1));
    this.valid = this.valid && sorted.length <= 32;
    this.count(sorted.length);
    for (const [key, value] of sorted) {
      this.text(key);
      writeValue(value);
    }
  }
}

/** Encodes a saved `avatar_manifest` into the ORBAST1 bytes the character frame restores (`K_t`). */
export function encodeAppearanceManifest(manifest: unknown): Uint8Array | null {
  if (!isOrbitAvatarManifest(manifest)) return null;
  const { appearance } = manifest;
  const resolved: OrbitAppearance =
    appearance.studioShape === "donut"
      ? {
          schemaVersion: 2,
          shape: "circle",
          color: appearance.color === "gray" ? "authored" : appearance.color,
          eyes: "none",
          eyewear: "none",
          accessories: [],
          depth: 0.5,
        }
      : appearance;
  const writer = new AppearanceWriter();
  writer.tag("ORBAST1\0");
  for (const text of [resolved.shape, resolved.color, resolved.eyes, resolved.eyewear]) writer.text(text);
  writer.count(resolved.accessories.length);
  for (const accessory of resolved.accessories) writer.text(accessory);
  const accessoryColors = Object.fromEntries(
    Object.entries(resolved.accessoryColors ?? {}).filter(
      ([accessory]) => resolved.accessories.includes(accessory) || !COLOR_RESET_ACCESSORIES.includes(accessory),
    ),
  );
  writer.entries(accessoryColors, (color) => writer.text(color));
  writer.flag(false);
  writer.scalar(resolved.depth);
  writer.flag(resolved.model != null);
  const model = resolved.model;
  if (model != null) {
    writer.text(model.body?.variant ?? "");
    writer.vector(model.body?.scale ?? [1, 1, 1]);
    writer.scalar(model.body?.upperStart ?? 0.35);
    writer.scalar(model.body?.upperScale ?? 1);
    const volume = model.body?.volume;
    writer.flag(volume != null);
    if (volume != null) {
      writer.scalar(volume.halfDepth ?? 0.4);
      writer.scalar(volume.shoulderFullness ?? 1);
      writer.count(volume.lobes?.length ?? 0);
      for (const lobe of volume.lobes ?? []) {
        writer.vector(lobe.center);
        writer.vector(lobe.radius);
        writer.scalar(lobe.strength);
      }
    }
    writer.flag(model.eyes != null);
    for (const eye of model.eyes ?? []) {
      writer.vector(eye.position);
      writer.vector(eye.rotation ?? [0, 0, 0]);
      writer.vector(eye.scale ?? [1, 1, 1]);
      writer.flag(eye.reflectX ?? false);
      writer.flag(eye.surfaceRelative ?? false);
    }
    writer.bytes.push({ "body-fixed": 2, body: 1, authored: 0 }[model.eyeMount ?? "authored"]);
    writer.text("");
    writer.vector(model.closedLidScale ?? [1, 1, 1]);
    writer.vector(model.pupilScale ?? [1, 1, 1]);
    writer.flag(model.eyewear != null);
    if (model.eyewear != null) writer.part(model.eyewear);
    writer.flag(model.eyewearBridge ?? false);
    writer.entries(model.accessories ?? {}, (part) => writer.part(part));
    writer.entries(model.materials ?? {}, (material) => {
      writer.bytes.push(
        (material.albedo == null ? 0 : 1) + (material.roughness == null ? 0 : 2) + (material.reflectance == null ? 0 : 4),
      );
      if (material.albedo != null) writer.vector(material.albedo);
      if (material.roughness != null) writer.scalar(material.roughness);
      if (material.reflectance != null) writer.scalar(material.reflectance);
    });
    writer.flag(model.headphones?.top != null);
    if (model.headphones?.top != null) writer.scalar(model.headphones.top);
    writer.vector(model.headphones?.cushionScale ?? [1, 1, 1]);
    if (model.eyewearVariant != null) {
      writer.tag("ORBEYE1\0");
      writer.text(model.eyewearVariant);
    }
    const restingEyeClosure = model.restingEyeClosure ?? 0;
    const bandThicknessScale = model.headphones?.bandThicknessScale ?? 1;
    const eyewearSurfaceAlignment = model.eyewearSurfaceAlignment ?? 1;
    const eyeGazeScale = model.eyeGazeScale ?? [1, 1];
    if (
      restingEyeClosure !== 0 ||
      bandThicknessScale !== 1 ||
      eyewearSurfaceAlignment !== 1 ||
      eyeGazeScale.some((value) => value !== 1)
    ) {
      writer.tag("ORBRIG1\0");
      writer.scalar(restingEyeClosure);
      writer.scalar(bandThicknessScale);
      writer.scalar(eyewearSurfaceAlignment);
      writer.vector(eyeGazeScale);
    }
  }
  if (resolved.hereCharacter != null) {
    writer.tag("ORBHERE1");
    writer.text(resolved.hereCharacter.id);
    writer.text(resolved.hereCharacter.name);
  }
  return writer.valid && writer.bytes.length <= MAX_STATE_BYTES ? Uint8Array.from(writer.bytes) : null;
}

class AppearanceReader {
  private offset = 0;
  private readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    if (bytes.length > MAX_STATE_BYTES) throw Error("Character state too large");
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  done() {
    return this.offset === this.bytes.length;
  }

  byte() {
    return this.view.getUint8(this.offset++);
  }

  flag() {
    const value = this.byte();
    if (value > 1) throw Error("Invalid character flag");
    return value === 1;
  }

  count(max: number) {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    if (value > max) throw Error("Character collection too large");
    return value;
  }

  scalar() {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    if (!Number.isFinite(value)) throw Error("Invalid character number");
    return value;
  }

  pair(): Vector2 {
    return [this.scalar(), this.scalar()];
  }

  vector(): Vector3 {
    return [this.scalar(), this.scalar(), this.scalar()];
  }

  part(): OrbitPartTransform {
    return { offset: this.vector(), rotation: this.vector(), scale: this.vector() };
  }

  text() {
    const length = this.count(MAX_TEXT_BYTES);
    if (this.offset + length > this.bytes.length) throw Error("Truncated character text");
    const value = new TextDecoder("utf-8", { fatal: true }).decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  array<T>(readItem: () => T, max = 32): T[] {
    return Array.from({ length: this.count(max) }, readItem);
  }

  entries<T>(readValue: () => T): Record<string, T> {
    const entries = this.array(() => [this.text(), readValue()] as const);
    if (new Set(entries.map(([key]) => key)).size !== entries.length) throw Error("Duplicate character key");
    return Object.fromEntries(entries);
  }

  nextTag(tag: string) {
    if (new TextEncoder().encode(tag).every((byte, index) => this.bytes[this.offset + index] === byte)) {
      this.offset += tag.length;
      return true;
    }
    return false;
  }

  tag(tag: string) {
    if (!this.nextTag(tag)) throw Error("Invalid character state header");
  }
}

/** Decodes engine ORBAST1 bytes into the appearance stored in `avatar_manifest`. */
export function decodeCharacterState(state: Uint8Array): OrbitAppearance {
  const reader = new AppearanceReader(state);
  reader.tag("ORBAST1\0");
  const shape = reader.text();
  const color = reader.text();
  const eyes = reader.text();
  const eyewear = reader.text();
  const accessories = reader.array(() => reader.text());
  const accessoryColors = reader.entries(() => reader.text());
  if (reader.flag()) throw Error("Unsupported flower center");
  const depth = reader.scalar();
  const model: OrbitAppearanceModel | undefined = reader.flag() ? {} : undefined;
  if (model) {
    model.body = {
      variant: reader.text() || undefined,
      scale: reader.vector(),
      upperStart: reader.scalar(),
      upperScale: reader.scalar(),
    };
    if (reader.flag()) {
      model.body.volume = {
        halfDepth: reader.scalar(),
        shoulderFullness: reader.scalar(),
        lobes: reader.array(() => ({ center: reader.pair(), radius: reader.pair(), strength: reader.scalar() }), 16),
      };
    }
    if (reader.flag()) {
      model.eyes = Array.from({ length: 2 }, () => ({
        position: reader.vector(),
        rotation: reader.vector(),
        scale: reader.vector(),
        reflectX: reader.flag(),
        surfaceRelative: reader.flag(),
      }));
    }
    const eyeMount = reader.byte();
    if (eyeMount > 2) throw Error("Unsupported eye mount");
    model.eyeMount = (["authored", "body", "body-fixed"] as const)[eyeMount];
    if (reader.text() !== "") throw Error("Unsupported eye variant");
    model.closedLidScale = reader.vector();
    model.pupilScale = reader.vector();
    if (reader.flag()) model.eyewear = reader.part();
    model.eyewearBridge = reader.flag();
    model.accessories = reader.entries(() => reader.part());
    model.materials = reader.entries(() => {
      const fields = reader.byte();
      if (fields > 7) throw Error("Unsupported material");
      return {
        albedo: fields & 1 ? reader.vector() : undefined,
        roughness: fields & 2 ? reader.scalar() : undefined,
        reflectance: fields & 4 ? reader.scalar() : undefined,
      };
    });
    model.headphones = { top: reader.flag() ? reader.scalar() : undefined, cushionScale: reader.vector() };
    if (reader.nextTag("ORBEYE1\0")) {
      const variant = reader.text();
      if (variant !== "round_sunglasses_no_sidecaps") throw Error("Unsupported eyewear variant");
      model.eyewearVariant = variant;
    }
    if (reader.nextTag("ORBRIG1\0")) {
      model.restingEyeClosure = reader.scalar();
      model.headphones.bandThicknessScale = reader.scalar();
      model.eyewearSurfaceAlignment = reader.scalar();
      model.eyeGazeScale = reader.pair();
    }
  }
  const hereCharacter = reader.nextTag("ORBHERE1") ? { id: reader.text(), name: reader.text() } : undefined;
  if (!reader.done()) throw Error("Unsupported character state extension");
  const appearance = {
    schemaVersion: hereCharacter ? 3 : model ? 2 : 1,
    shape,
    color,
    eyes,
    eyewear,
    accessories,
    accessoryColors,
    depth,
    model,
    hereCharacter,
  };
  if (!isOrbitAppearance(appearance)) throw Error("Invalid character appearance");
  return appearance;
}

/**
 * The appearance a save uploads: decoded state without undefined fields, with the
 * eyeless circle stored as the studio "donut" shape.
 */
export function toSavedAppearance(state: Uint8Array): OrbitAppearance {
  const appearance = JSON.parse(JSON.stringify(decodeCharacterState(state))) as OrbitAppearance;
  if (appearance.shape === "circle" && appearance.eyes === "none") {
    appearance.studioShape = "donut";
    appearance.eyes = "oval";
    appearance.color = appearance.color === "authored" ? "gray" : appearance.color;
  }
  return appearance;
}

export function sameBytes(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined) {
  if (a === b) return true;
  if (a == null || b == null || a.length !== b.length) return false;
  return a.every((byte, index) => byte === b[index]);
}
