import clsx from "clsx";
import type { ReactNode, RefObject } from "react";
import { useDotStore } from "../../state/dot-store";
import { type DotAvatarIdentity, getDotState, useIdentityConversationId } from "../orbit/conversation-character";
import { ConversationOrbitCharacter } from "../orbit/conversation-orbit-character";
import { PetAvatar } from "../pets/pet-avatar";
import { AvatarImage, LegacyAvatarImage } from "./avatar-images";
import { asLegacyAvatarId } from "./legacy-avatars";
import { LoadingResultsShimmer } from "./loading-results-shimmer";
import { useSavedAvatarImage } from "./saved-avatar-image";

export interface DotAvatarProps {
  className?: string;
  /** Legacy avatar id, `pet`, or `null` for the default ring. */
  avatar?: string | null;
  petId?: string | null;
  /** Conversation id, draft marker (`orbit-draft`/`legacy-draft`), or `orbit`/`legacy` for the dot in view. */
  identity?: DotAvatarIdentity;
  useSavedAvatar?: boolean;
  animated?: boolean;
  active?: boolean;
  interactionTarget?: RefObject<HTMLElement | null>;
  loadingFallback?: ReactNode;
}

/** A bot's avatar: live character, saved image, legacy artwork or pet (`E2` / `WYa`). */
export function DotAvatar({
  className,
  avatar,
  petId,
  identity = "orbit-draft",
  useSavedAvatar = true,
  animated = true,
  active = true,
  interactionTarget,
  loadingFallback,
}: DotAvatarProps) {
  const conversationId = useIdentityConversationId(identity);
  if (avatar === "pet") {
    return (
      <PetAvatar
        className={className}
        petId={petId}
        identity={identity}
        useSavedAvatar={useSavedAvatar}
        animated={animated && active}
        interactionTarget={interactionTarget}
        loadingFallback={loadingFallback}
      />
    );
  }
  if (conversationId == null || !useSavedAvatar) return <LegacyAvatarImage className={className} avatar={avatar} />;
  const savedAvatar = <SavedDotAvatar className={animated ? "size-full" : className} avatar={avatar} conversationId={conversationId} loadingFallback={loadingFallback} />;
  if (!animated) return savedAvatar;
  return (
    <ConversationOrbitCharacter
      className={className}
      conversationId={conversationId}
      avatar={avatar}
      fallback={savedAvatar}
      active={active}
      interactionTarget={interactionTarget}
    />
  );
}

interface SavedDotAvatarProps {
  className?: string;
  avatar?: string | null;
  conversationId: string;
  loadingFallback?: ReactNode;
}

/** The avatar saved on a bot's profile: its rendered image or legacy artwork (`GYa`). */
function SavedDotAvatar({ className, avatar, conversationId, loadingFallback }: SavedDotAvatarProps) {
  const dot = useDotStore((s) => s.dots.find((d) => d.conversationId === conversationId));
  const isOrbit = dot?.identity === "orbit";
  const image = useSavedAvatarImage(isOrbit ? conversationId : null, dot && isOrbit ? getDotState(dot) : null);
  let legacyAvatar: string | null | undefined = avatar;
  if (dot != null) legacyAvatar = isOrbit ? undefined : asLegacyAvatarId(dot.legacyAvatar);
  const fallback =
    legacyAvatar === undefined ? (
      <span className={clsx("block overflow-hidden rounded-full", className)}>
        <LoadingResultsShimmer as="span" size="fill" />
      </span>
    ) : (
      <LegacyAvatarImage className={className} avatar={legacyAvatar} />
    );
  return (
    <AvatarImage
      className={className}
      identity={conversationId}
      imageUrl={isOrbit ? (image?.src ?? null) : null}
      imageVersion={image?.updatedAt ?? null}
      fallback={fallback}
      loadingFallback={loadingFallback}
    />
  );
}
