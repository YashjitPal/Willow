/** Numeric enums shared with the orbit character runtime (`runtime/orbit-enums.mjs`). */

export const Category = { Shape: 0, Color: 1, Eyes: 2, Eyewear: 3, Accessory: 4 } as const;
export type Category = (typeof Category)[keyof typeof Category];

export const Quality = { Automatic: 0, Compact: 1, Balanced: 2 } as const;
export type Quality = (typeof Quality)[keyof typeof Quality];

export const ReactionResult = { Accepted: 0, Busy: 1, Unsupported: 2, Unavailable: 3 } as const;
export type ReactionResult = (typeof ReactionResult)[keyof typeof ReactionResult];

export const ActivityKind = {
  None: 0,
  Working: 1,
  Searching: 2,
  Creating: 3,
  Payment: 4,
  Thinking: 5,
  NeedsInput: 6,
  Ready: 7,
  Paused: 8,
  Error: 9,
} as const;
export type ActivityKind = (typeof ActivityKind)[keyof typeof ActivityKind];

export interface OrbitActivity {
  kind: ActivityKind;
  turnId: string | null;
}
