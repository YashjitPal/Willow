import clsx from "clsx";
import { type MouseEventHandler, type ReactNode, type Ref, type RefObject, useImperativeHandle, useRef } from "react";
import { useReducedMotion } from "../../lib/reduced-motion";
import { legacyAvatarImage } from "../avatar/legacy-avatars";
import type { CharacterFraming } from "./character-frame";
import { useConversationCharacter } from "./conversation-character";
import { OrbitCharacter } from "./orbit-character";

/** Share of the default ring artwork's box that is transparent padding on each side. */
const DEFAULT_RING_INSET = 0.099609375;

export interface ConversationOrbitCharacterHandle {
  /** Screen bounds of what is painted, excluding the default ring's padding. */
  getPaintedBounds: () => DOMRect | null;
}

export interface ConversationOrbitCharacterProps {
  ref?: Ref<ConversationOrbitCharacterHandle>;
  className?: string;
  conversationId: string;
  avatar?: string | null;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
  active?: boolean;
  framing?: CharacterFraming;
  interactionTarget?: RefObject<HTMLElement | null>;
  onClick?: MouseEventHandler<HTMLSpanElement>;
}

/** The live character of a conversation's bot, acting out its activity (`VYa1Component`). */
export function ConversationOrbitCharacter({
  ref,
  className,
  conversationId,
  avatar,
  fallback,
  loadingFallback,
  active = true,
  framing = "activity",
  interactionTarget,
  onClick,
}: ConversationOrbitCharacterProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      getPaintedBounds: () => {
        const root = rootRef.current;
        if (root == null) return null;
        const painted = root.firstElementChild;
        const { left, top, width, height } = (painted ?? root).getBoundingClientRect();
        const inset = painted instanceof HTMLImageElement && painted.src === legacyAvatarImage(null).src ? DEFAULT_RING_INSET : 0;
        return new DOMRect(left + width * inset, top + height * inset, width * (1 - 2 * inset), height * (1 - 2 * inset));
      },
    }),
    [],
  );
  const character = useConversationCharacter(avatar === "pet" ? null : conversationId);
  const reducedMotion = useReducedMotion();
  return (
    <span ref={rootRef} className={clsx("block", className)} role="presentation" onClick={onClick}>
      {character?.state != null && character.renderCanvas ? (
        <OrbitCharacter
          key={conversationId}
          state={character.state}
          conversationId={conversationId}
          fallback={fallback}
          loadingFallback={loadingFallback}
          reducedMotion={reducedMotion}
          active={active}
          framing={framing}
          interactionTarget={interactionTarget}
        />
      ) : (
        fallback
      )}
    </span>
  );
}
