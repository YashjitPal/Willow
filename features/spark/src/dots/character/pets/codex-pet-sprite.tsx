import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../../lib/reduced-motion";
import {
  PET_ASSET_MAP,
  type PetAnimationState,
  type PetFrame,
  type PetSpriteSource,
  SPRITE_SPEC_V2,
  petAnimation,
  petBackgroundPosition,
  petFrame,
} from "./codex-pets";

const css = { root: "_Root_1h8zz_1", container: "_Container_1h8zz_11" } as const;

export interface CodexPetSpriteProps {
  assetMap?: Readonly<Record<string, string>>;
  className?: string;
  /** A fixed frame (e.g. a look direction) instead of the state's animation. */
  lookFrame?: PetFrame | null;
  loop?: boolean;
  respondToHover?: boolean;
  size?: "default" | "container";
  source: PetSpriteSource;
  state?: PetAnimationState;
}

/** Animated Codex pet spritesheet (`EGa`). */
export function CodexPetSprite({
  assetMap = PET_ASSET_MAP,
  className,
  lookFrame,
  loop = false,
  respondToHover = false,
  size = "default",
  source,
  state = "idle",
}: CodexPetSpriteProps) {
  const [hovered, setHovered] = useState(false);
  const spriteRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const animationState = respondToHover && hovered ? "jumping" : state;
  const rowCount = source.assetRef == null ? source.spriteRowCount : SPRITE_SPEC_V2.rows;

  useEffect(() => {
    const sprite = spriteRef.current;
    if (sprite == null) return;
    if (lookFrame != null) {
      sprite.style.backgroundPosition = petBackgroundPosition(lookFrame, rowCount);
      return;
    }
    const animation = petAnimation(animationState, reducedMotion, loop);
    const { frames } = animation;
    let index = 0;
    let timeout: number | null = null;
    sprite.style.backgroundPosition = petBackgroundPosition(petFrame(frames, index), rowCount);
    if (frames.length === 1) return;
    const scheduleNext = () => {
      timeout = window.setTimeout(() => {
        const next = index + 1;
        if (next >= frames.length) {
          if (animation.loopStartIndex != null) {
            index = animation.loopStartIndex;
            sprite.style.backgroundPosition = petBackgroundPosition(petFrame(frames, index), rowCount);
            scheduleNext();
            return;
          }
          timeout = null;
          return;
        }
        index = next;
        sprite.style.backgroundPosition = petBackgroundPosition(petFrame(frames, index), rowCount);
        scheduleNext();
      }, petFrame(frames, index).frameDurationMs);
    };
    scheduleNext();
    return () => {
      if (timeout != null) window.clearTimeout(timeout);
    };
  }, [animationState, lookFrame, loop, reducedMotion, rowCount]);

  const spritesheetUrl = source.spritesheetUrl ?? (source.assetRef == null ? undefined : assetMap[source.assetRef]);
  return (
    <div
      ref={spriteRef}
      className={clsx(css.root, size === "container" && css.container, className)}
      data-codex-pet-asset-ref={source.assetRef}
      data-codex-pet-id={source.assetRef ?? source.petId}
      data-codex-pet-state={animationState}
      onPointerEnter={() => {
        if (respondToHover) setHovered(true);
      }}
      onPointerLeave={() => {
        if (respondToHover) setHovered(false);
      }}
      style={{
        backgroundImage: `url(${spritesheetUrl})`,
        backgroundSize: rowCount == null ? undefined : `${SPRITE_SPEC_V2.columns * 100}% ${rowCount * 100}%`,
      }}
      aria-hidden="true"
    />
  );
}
