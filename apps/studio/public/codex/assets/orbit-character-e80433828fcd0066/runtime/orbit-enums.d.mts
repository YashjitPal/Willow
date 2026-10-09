/** Named numeric enums; also re-exported by orbit-characters.mjs. */
export const Category: Readonly<{ Shape: 0; Color: 1; Eyes: 2; Eyewear: 3; Accessory: 4 }>;
export type Category = typeof Category[keyof typeof Category];
export const Quality: Readonly<{ Automatic: 0; Compact: 1; Balanced: 2 }>;
export type Quality = typeof Quality[keyof typeof Quality];
export const PointerPhase: Readonly<{ Down: 0; Move: 1; Up: 2; Cancel: 3 }>;
export type PointerPhase = typeof PointerPhase[keyof typeof PointerPhase];
export const ReactionKind: Readonly<{ Wave: 1; Signature: 2 }>;
export type ReactionKind = typeof ReactionKind[keyof typeof ReactionKind];
export const ReactionResult: Readonly<{ Accepted: 0; Busy: 1; Unsupported: 2; Unavailable: 3 }>;
export type ReactionResult = typeof ReactionResult[keyof typeof ReactionResult];
export const ActivityCommandType: Readonly<{ Start: 1; Stop: 2; Restore: 3 }>;
export type ActivityCommandType = typeof ActivityCommandType[keyof typeof ActivityCommandType];
export const ActivityKind: Readonly<{
  None: 0; Working: 1; Searching: 2; Creating: 3; Payment: 4; Thinking: 5;
  NeedsInput: 6; Ready: 7; Paused: 8; Error: 9;
}>;
export type ActivityKind = typeof ActivityKind[keyof typeof ActivityKind];
export const ActivityOutcome: Readonly<{
  Neutral: 0; ArtifactReady: 1; PaymentPaid: 2; InputReceived: 3; ThinkingResolved: 4;
}>;
export type ActivityOutcome = typeof ActivityOutcome[keyof typeof ActivityOutcome];
export const ActivityEntry: Readonly<{ Start: 0; Sustained: 1 }>;
export type ActivityEntry = typeof ActivityEntry[keyof typeof ActivityEntry];
export const ActivityApplyResult: Readonly<{
  Applied: 0; Unchanged: 1; IgnoredSequence: 2; IgnoredEpisode: 3;
  InvalidArgument: -1; WrongThread: -2; SequenceConflict: -3;
  EpisodeKindConflict: -4; RestoreAfterBinding: -5;
}>;
export type ActivityApplyResult = typeof ActivityApplyResult[keyof typeof ActivityApplyResult];
export const ActivityTheme: Readonly<{ Light: 0; Dark: 1 }>;
export type ActivityTheme = typeof ActivityTheme[keyof typeof ActivityTheme];
export const RenderOutcome: Readonly<{
  NotCalled: 0; Inactive: 1; InvalidTime: 2; Idle: 3; Preparing: 4;
  NotAdmitted: 5; Submitted: 6; Failed: 7;
}>;
export type RenderOutcome = typeof RenderOutcome[keyof typeof RenderOutcome];
export const TimingStatus: Readonly<{ Unknown: 0; Unsupported: 1; Pending: 2; Available: 3 }>;
export type TimingStatus = typeof TimingStatus[keyof typeof TimingStatus];
export const CharacterSource: Readonly<{ None: 0; Compiled: 1; Bundled: 2; DiskCache: 3; Resident: 4 }>;
export type CharacterSource = typeof CharacterSource[keyof typeof CharacterSource];
