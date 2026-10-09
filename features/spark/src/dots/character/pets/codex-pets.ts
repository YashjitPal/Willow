export interface CodexPet {
  assetRef: string;
  description: string;
  displayName: string;
  id: string;
  spriteVersionNumber: number;
  spritesheetUrl?: string;
  spritesheetFingerprint?: string;
  updatedAt?: number;
}

/** Pets bundled with Codex (`pZ`). */
export const BUILT_IN_PETS: readonly CodexPet[] = [
  { assetRef: "codex", description: "The original Codex companion.", displayName: "Codex", id: "codex", spriteVersionNumber: 2 },
  { assetRef: "dewey", description: "A calm companion for focused workspace days", displayName: "Dewey", id: "dewey", spriteVersionNumber: 2 },
  { assetRef: "fireball", description: "Hot path energy for fast iteration.", displayName: "Fireball", id: "fireball", spriteVersionNumber: 2 },
  { assetRef: "hoots", description: "A sharp-eyed owl for polished work in a blink.", displayName: "Hoots", id: "hoots", spriteVersionNumber: 2 },
  { assetRef: "rocky", description: "A steady rock when the diff gets large.", displayName: "Rocky", id: "rocky", spriteVersionNumber: 2 },
  { assetRef: "seedy", description: "Small green shoots for new ideas.", displayName: "Seedy", id: "seedy", spriteVersionNumber: 2 },
  { assetRef: "stacky", description: "A balanced stack for deep work.", displayName: "Stacky", id: "stacky", spriteVersionNumber: 2 },
  { assetRef: "bsod", description: "A tiny blue-screen gremlin.", displayName: "BSOD", id: "bsod", spriteVersionNumber: 2 },
  { assetRef: "null-signal", description: "Quiet signal from the void.", displayName: "Null Signal", id: "null-signal", spriteVersionNumber: 2 },
];

/** Spritesheets of the bundled pets. */
export const PET_ASSET_MAP: Readonly<Record<string, string>> = {
  bsod: "/codex/assets/bsod-spritesheet-v5-cc54136ce042.webp",
  codex: "/codex/assets/codex-spritesheet-v6-51045ae208c0.webp",
  dewey: "/codex/assets/dewey-spritesheet-v5-f5285016f310.webp",
  fireball: "/codex/assets/fireball-spritesheet-v5-9c2a4146d3f9.webp",
  hoots: "/codex/assets/hoots-spritesheet-v8-21cacd193ace.webp",
  "null-signal": "/codex/assets/null-signal-spritesheet-v7-1e7dbf89200f.webp",
  rocky: "/codex/assets/rocky-spritesheet-v5-97b5d14cdd54.webp",
  seedy: "/codex/assets/seedy-spritesheet-v10-0f6f906a2aec.webp",
  stacky: "/codex/assets/stacky-spritesheet-v6-18d0359c82af.webp",
};

/** A bundled pet by id (`jqa`); user-made `pet_`/`custom:` pets come from the server and are not mocked. */
export function findPet(petId: string | null | undefined): CodexPet | null {
  if (petId == null) return null;
  return BUILT_IN_PETS.find((pet) => pet.id === petId) ?? null;
}

const SPRITE_ROWS_BY_VERSION: Record<number, number> = { 1: 9, 2: 11 };

export type PetSpriteSource = { assetRef: string; petId?: undefined; spriteRowCount?: undefined; spritesheetUrl?: undefined } | { assetRef?: undefined; petId: string; spriteRowCount: number; spritesheetUrl: string };

/** `oKa` */
export function petSpriteSource(pet: CodexPet): PetSpriteSource {
  if (pet.spritesheetUrl == null) return { assetRef: pet.assetRef };
  return { petId: pet.id, spriteRowCount: SPRITE_ROWS_BY_VERSION[pet.spriteVersionNumber] ?? SPRITE_ROWS_BY_VERSION[1], spritesheetUrl: pet.spritesheetUrl };
}

export function petSpritesheetUrl(pet: CodexPet) {
  return pet.spritesheetUrl ?? PET_ASSET_MAP[pet.assetRef] ?? null;
}

interface SpriteSpec {
  version: number;
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
  requiredFramesByRow: number[];
}

export const SPRITE_SPEC_V1: SpriteSpec = {
  version: 1,
  width: 1536,
  height: 1872,
  cellWidth: 192,
  cellHeight: 208,
  columns: 8,
  rows: 9,
  requiredFramesByRow: [6, 8, 8, 4, 5, 8, 6, 6, 6],
};

export const SPRITE_SPEC_V2: SpriteSpec = {
  version: 2,
  width: 1536,
  height: 2288,
  cellWidth: 192,
  cellHeight: 208,
  columns: 8,
  rows: 11,
  requiredFramesByRow: [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8],
};

function findSpriteSpec(width: number, height: number) {
  return [SPRITE_SPEC_V1, SPRITE_SPEC_V2].find((spec) => spec.width === width && spec.height === height) ?? null;
}

export interface PetFrame {
  rowIndex: number;
  columnIndex: number;
  frameDurationMs: number;
}

export type PetAnimationState = "failed" | "idle" | "jumping" | "review" | "running" | "running-left" | "running-right" | "waving" | "waiting";

function rowFrames(rowIndex: number, count: number, frameDurationMs: number, lastFrameDurationMs: number): PetFrame[] {
  return Array.from({ length: count }, (_, columnIndex) => ({
    columnIndex,
    frameDurationMs: columnIndex === count - 1 ? lastFrameDurationMs : frameDurationMs,
    rowIndex,
  }));
}

const IDLE_FRAMES: PetFrame[] = [
  { rowIndex: 0, columnIndex: 0, frameDurationMs: 280 },
  { rowIndex: 0, columnIndex: 1, frameDurationMs: 110 },
  { rowIndex: 0, columnIndex: 2, frameDurationMs: 110 },
  { rowIndex: 0, columnIndex: 3, frameDurationMs: 140 },
  { rowIndex: 0, columnIndex: 4, frameDurationMs: 140 },
  { rowIndex: 0, columnIndex: 5, frameDurationMs: 320 },
];
const IDLE_SLOWDOWN = 6;
const SLOW_IDLE_FRAMES = IDLE_FRAMES.map((frame) => ({ ...frame, frameDurationMs: frame.frameDurationMs * IDLE_SLOWDOWN }));

const ANIMATIONS: Record<PetAnimationState, PetFrame[]> = {
  failed: rowFrames(5, 8, 140, 240),
  idle: IDLE_FRAMES,
  jumping: rowFrames(4, 5, 140, 280),
  review: rowFrames(8, 6, 150, 280),
  running: rowFrames(7, 6, 120, 220),
  "running-left": rowFrames(2, 8, 120, 220),
  "running-right": rowFrames(1, 8, 120, 220),
  waving: rowFrames(3, 4, 140, 280),
  waiting: rowFrames(6, 6, 150, 260),
};

export interface PetAnimation {
  frames: PetFrame[];
  loopStartIndex: number | null;
}

/** `dGa`: a state plays three times, then settles into the slow idle loop. */
export function petAnimation(state: PetAnimationState, reducedMotion: boolean, loop = false): PetAnimation {
  const frames = ANIMATIONS[state];
  if (reducedMotion) return { frames: [petFrame(frames, 0)], loopStartIndex: null };
  if (state === "idle") return { frames: SLOW_IDLE_FRAMES, loopStartIndex: 0 };
  if (loop) return { frames, loopStartIndex: 0 };
  const repeated = [...frames, ...frames, ...frames];
  return { frames: [...repeated, ...SLOW_IDLE_FRAMES], loopStartIndex: repeated.length };
}

export function petFrame(frames: PetFrame[], index: number) {
  const frame = frames[index];
  if (frame == null) throw RangeError("Codex pet animation frame is out of range");
  return frame;
}

/** CSS `background-position` of a frame (`pGa`). */
export function petBackgroundPosition(frame: PetFrame, rowCount: number | undefined) {
  const x = (frame.columnIndex / (SPRITE_SPEC_V2.columns - 1)) * 100;
  const y = rowCount == null ? `calc(-${frame.rowIndex} * var(--codex-pet-frame-height))` : `${(frame.rowIndex / (rowCount - 1)) * 100}%`;
  return `${x}% ${y}`;
}

const LOOK_STEP_DEGREES = 22.5;
const LOOK_DIRECTIONS = 16;
const LOOK_FIRST_ROW = 9;
const LOOK_COLUMNS = 8;
const LOOK_DEAD_ZONE = 1;

/** The v2 "look" frame facing `point` from the pet's content center (`OGa`). */
export function petLookFrame(bounds: { left: number; top: number; width: number; height: number }, point: { x: number; y: number }, version = SPRITE_SPEC_V1.version): PetFrame | null {
  if (version !== SPRITE_SPEC_V2.version) return null;
  const dx = point.x - (bounds.left + bounds.width / 2);
  const dy = point.y - (bounds.top + bounds.height / 2);
  if (Math.hypot(dx, dy) <= LOOK_DEAD_ZONE) return null;
  const angle = ((Math.atan2(dx, -dy) * (180 / Math.PI)) + 360) % 360;
  const direction = Math.round(angle / LOOK_STEP_DEGREES) % LOOK_DIRECTIONS;
  return { columnIndex: direction % LOOK_COLUMNS, frameDurationMs: 0, rowIndex: LOOK_FIRST_ROW + Math.floor(direction / LOOK_COLUMNS) };
}

export interface PetContentBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
}

/** Opaque bounds of the first idle frame (`iJa`). */
export function measurePetContentBounds(image: HTMLImageElement): PetContentBounds {
  const spec = findSpriteSpec(image.naturalWidth, image.naturalHeight);
  if (spec == null) throw Error("Pet spritesheet has unsupported dimensions");
  const frame = petFrame(petAnimation("idle", true).frames, 0);
  const canvas = new OffscreenCanvas(spec.cellWidth, spec.cellHeight);
  const context = canvas.getContext("2d");
  if (context == null) throw Error("Unable to read pet avatar frame");
  context.drawImage(image, frame.columnIndex * spec.cellWidth, frame.rowIndex * spec.cellHeight, spec.cellWidth, spec.cellHeight, 0, 0, spec.cellWidth, spec.cellHeight);
  const { data } = context.getImageData(0, 0, spec.cellWidth, spec.cellHeight);
  let left = spec.cellWidth;
  let top = spec.cellHeight;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < spec.cellHeight; y++) {
    for (let x = 0; x < spec.cellWidth; x++) {
      if (data[(y * spec.cellWidth + x) * 4 + 3] > 0) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
  }
  if (right <= left || bottom <= top) throw Error("Pet avatar frame is empty");
  return { left, top, width: right - left, height: bottom - top, frameWidth: spec.cellWidth, frameHeight: spec.cellHeight };
}
