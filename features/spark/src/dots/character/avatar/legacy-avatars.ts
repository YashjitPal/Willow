import { legacyAvatarArtwork } from "./legacy-avatar-artwork";

/** Selectable legacy avatars, in picker order (`UCt`). */
export const LEGACY_AVATAR_IDS = [
  "sunglasses",
  "bow-tie",
  "balancing-ball",
  "cowboy",
  "beanie",
  "mustache",
  "pirate",
  "feather",
  "monocle",
  "party-hat",
  "bowler",
  "headphones",
] as const;

export type LegacyAvatarId = (typeof LEGACY_AVATAR_IDS)[number];
export type AppearanceAvatar = LegacyAvatarId | "pet";

/** The accent color each avatar gives its bot (`WCt`). */
export const AVATAR_COLORS = {
  pet: "black",
  sunglasses: "pink",
  "bow-tie": "green",
  "balancing-ball": "orange",
  cowboy: "blue",
  beanie: "blue",
  mustache: "pink",
  pirate: "purple",
  feather: "orange",
  monocle: "blue",
  "party-hat": "yellow",
  bowler: "yellow",
  headphones: "green",
} as const satisfies Record<AppearanceAvatar, string>;

export type AppearanceColor = (typeof AVATAR_COLORS)[AppearanceAvatar];

export interface DotAppearance {
  color: AppearanceColor;
  avatar: AppearanceAvatar;
}

/** `GCt` */
export const DEFAULT_APPEARANCE: DotAppearance = { color: AVATAR_COLORS.sunglasses, avatar: "sunglasses" };

/** A random legacy appearance different from `current` (`YCt`). */
export function randomLegacyAppearance(current: DotAppearance | null = null, random: () => number = Math.random, exclude?: ReadonlySet<string>): DotAppearance {
  const candidates = current == null ? [...LEGACY_AVATAR_IDS] : LEGACY_AVATAR_IDS.filter((id) => id !== current.avatar);
  const allowed = candidates.filter((id) => !exclude?.has(id));
  const pool = allowed.length > 0 ? allowed : candidates;
  const avatar = pool[Math.floor(random() * pool.length)];
  return { color: AVATAR_COLORS[avatar], avatar };
}

/** `UYa` */
export function asLegacyAvatarId(value: string | null | undefined): LegacyAvatarId | null {
  return LEGACY_AVATAR_IDS.find((id) => id === value) ?? null;
}

export interface ImageArtwork {
  kind: "image";
  src: string;
  monochrome: boolean;
}

/** Artwork for a legacy avatar; pets and unknown ids show the default ring (`cJa`). */
export function legacyAvatarImage(avatar: string | null | undefined): ImageArtwork {
  const id = avatar == null || avatar === "pet" || !(avatar in legacyAvatarArtwork) ? "default" : (avatar as keyof typeof legacyAvatarArtwork);
  return { kind: "image", src: legacyAvatarArtwork[id].src, monochrome: false };
}

/** The brand color painted by a legacy artwork (`lJa`). */
export function legacyArtworkColor(artwork: { kind: string; src?: string }) {
  if (artwork.kind === "image") return Object.values(legacyAvatarArtwork).find(({ src }) => src === artwork.src)?.color ?? "currentColor";
  return "currentColor";
}

/** The gray ring shown for a default bot (`uKa`). */
export const DEFAULT_AVATAR_SRC = legacyAvatarArtwork.default.src;
