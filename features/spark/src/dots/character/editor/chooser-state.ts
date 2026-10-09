import { encodeAppearanceManifest } from "../orbit/appearance-codec";

/** Body colors offered as plain rings in the avatar chooser. */
export const RING_COLORS = ["gray", "cyan", "yellow", "orchid", "lime", "pink", "coral", "teal", "blue", "violet"] as const;
export type RingColor = (typeof RING_COLORS)[number];

export function asRingColor(value: string): RingColor | null {
  return RING_COLORS.find((color) => color === value) ?? null;
}

/** A featureless ring of `color`; gray uses the authored body color. */
export function ringAppearance(color: RingColor) {
  const state = encodeAppearanceManifest({
    schema_version: 1,
    appearance: { schemaVersion: 1, shape: "circle", color: color === "gray" ? "authored" : color, eyes: "none", eyewear: "none", accessories: [], depth: 0.5 },
  });
  if (!state) throw Error("Invalid default avatar");
  return state;
}

/** The character the "Customize" action starts from when there is no custom one yet. */
export function customStarterAppearance() {
  const state = encodeAppearanceManifest({
    schema_version: 1,
    appearance: { schemaVersion: 1, shape: "rounded_triangle", color: "pink", eyes: "oval", eyewear: "none", accessories: [], depth: 0.5 },
  });
  if (!state) throw Error("Invalid custom avatar");
  return state;
}
