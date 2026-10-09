import { useMemo } from "react";
import { IDLE_ACTIVITY, useCharacterStore } from "../../state/character-store";
import { type Dot, useDotStore } from "../../state/dot-store";
import { ActivityKind, type OrbitActivity } from "./engine-enums";
import { getPresetAppearance } from "./preset-appearances";

const PAUSED_ACTIVITY: OrbitActivity = { kind: ActivityKind.Paused, turnId: null };

/** Activities during which the agent is mid-turn (the conversation status `working`). */
const WORKING_KINDS: ReadonlySet<number> = new Set([
  ActivityKind.Working,
  ActivityKind.Searching,
  ActivityKind.Creating,
  ActivityKind.Payment,
  ActivityKind.Thinking,
]);

export const DRAFT_IDENTITIES = ["orbit-draft", "legacy-draft"] as const;
export type DraftIdentity = (typeof DRAFT_IDENTITIES)[number];

/** A conversation id, a draft marker, or the bot kind (`orbit`/`legacy`) standing for the dot in view. */
export type DotAvatarIdentity = DraftIdentity | "orbit" | "legacy" | (string & {});

export function isDraftIdentity(identity: string | null | undefined): identity is DraftIdentity {
  return identity === "orbit-draft" || identity === "legacy-draft";
}

function findDot(dots: Dot[], conversationId: string | null) {
  return conversationId == null ? undefined : dots.find((dot) => dot.conversationId === conversationId);
}

/** Maps an avatar identity to the conversation whose saved character it shows (`null` for drafts). */
export function useIdentityConversationId(identity: DotAvatarIdentity): string | null {
  return useDotStore((s) => {
    if (isDraftIdentity(identity)) return null;
    if (identity === "orbit" || identity === "legacy") {
      return s.activeConversationId ?? s.dots.find((dot) => dot.isPrimary)?.conversationId ?? s.dots[0]?.conversationId ?? null;
    }
    return identity;
  });
}

/** Whether an identity uses the legacy avatars rather than an orbit character (`_4`). */
export function useIsLegacyIdentity(identity: DotAvatarIdentity) {
  const conversationId = useIdentityConversationId(identity);
  const dotIdentity = useDotStore((s) => findDot(s.dots, conversationId)?.identity);
  if (identity === "orbit-draft" || identity === "orbit") return false;
  if (identity === "legacy-draft" || identity === "legacy") return true;
  return dotIdentity === "legacy" || dotIdentity === "legacy-draft";
}

/** Appearance bytes of an orbit dot: its customized state, otherwise its preset's. */
export function getDotState(dot: Pick<Dot, "appearance" | "presetId">) {
  return dot.appearance ?? getPresetAppearance(dot.presetId);
}

/** The agent activity a conversation's character acts out (`XJa`). */
export function useConversationActivity(conversationId: string | null): OrbitActivity | null {
  const override = useCharacterStore((s) => (conversationId == null ? undefined : s.activityByConversation[conversationId]));
  const status = useDotStore((s) => findDot(s.dots, conversationId)?.status);
  if (conversationId == null) return null;
  if (override) return override;
  return status === "paused" ? PAUSED_ACTIVITY : IDLE_ACTIVITY;
}

export interface ConversationCharacter {
  state: Uint8Array | null;
  identity: string;
  renderCanvas: boolean;
}

/** The saved character of an orbit conversation (`dJa`), or `null` when it has none. */
export function useConversationCharacter(conversationId: string | null): ConversationCharacter | null {
  const dot = useDotStore((s) => findDot(s.dots, conversationId));
  const isOrbit = dot?.identity === "orbit";
  const state = dot && isOrbit ? getDotState(dot) : null;
  return useMemo(
    () => (conversationId == null || !isOrbit ? null : { state, identity: `${conversationId}:${state?.join(",") ?? ""}`, renderCanvas: true }),
    [conversationId, isOrbit, state],
  );
}

/** Whether a conversation's pet runs or idles (`Dqa`). */
export function usePetAnimationState(identity: DotAvatarIdentity): "idle" | "running" {
  const conversationId = useIdentityConversationId(identity);
  const activity = useConversationActivity(conversationId);
  return activity != null && WORKING_KINDS.has(activity.kind) ? "running" : "idle";
}
