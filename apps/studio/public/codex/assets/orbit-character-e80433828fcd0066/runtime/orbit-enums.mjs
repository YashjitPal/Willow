/** Stable numeric enums shared with OrbitCharacters.h. */
export const Category = Object.freeze({ Shape: 0, Color: 1, Eyes: 2, Eyewear: 3, Accessory: 4 });
/** Detailed is intentionally unexposed for compatibility with Compact/Balanced web bundles. */
export const Quality = Object.freeze({ Automatic: 0, Compact: 1, Balanced: 2 });
export const PointerPhase = Object.freeze({ Down: 0, Move: 1, Up: 2, Cancel: 3 });
export const ReactionKind = Object.freeze({ Wave: 1, Signature: 2 });
export const ReactionResult = Object.freeze({ Accepted: 0, Busy: 1, Unsupported: 2, Unavailable: 3 });
export const ActivityCommandType = Object.freeze({ Start: 1, Stop: 2, Restore: 3 });
export const ActivityKind = Object.freeze({
  None: 0, Working: 1, Searching: 2, Creating: 3, Payment: 4, Thinking: 5,
  NeedsInput: 6, Ready: 7, Paused: 8, Error: 9,
});
export const ActivityOutcome = Object.freeze({
  Neutral: 0, ArtifactReady: 1, PaymentPaid: 2, InputReceived: 3, ThinkingResolved: 4,
});
export const ActivityEntry = Object.freeze({ Start: 0, Sustained: 1 });
export const ActivityApplyResult = Object.freeze({
  Applied: 0, Unchanged: 1, IgnoredSequence: 2, IgnoredEpisode: 3,
  InvalidArgument: -1, WrongThread: -2, SequenceConflict: -3,
  EpisodeKindConflict: -4, RestoreAfterBinding: -5,
});
export const ActivityTheme = Object.freeze({ Light: 0, Dark: 1 });
export const RenderOutcome = Object.freeze({
  NotCalled: 0, Inactive: 1, InvalidTime: 2, Idle: 3, Preparing: 4,
  NotAdmitted: 5, Submitted: 6, Failed: 7,
});
export const TimingStatus = Object.freeze({ Unknown: 0, Unsupported: 1, Pending: 2, Available: 3 });
export const CharacterSource = Object.freeze({ None: 0, Compiled: 1, Bundled: 2, DiskCache: 3, Resident: 4 });
