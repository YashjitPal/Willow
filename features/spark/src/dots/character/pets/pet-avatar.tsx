import clsx from "clsx";
import { type ReactNode, type Ref, type RefObject, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../../lib/reduced-motion";
import { useCharacterStore } from "../../state/character-store";
import { useDotStore } from "../../state/dot-store";
import { LegacyAvatarImage } from "../avatar/avatar-images";
import { type DotAvatarIdentity, useIdentityConversationId, usePetAnimationState } from "../orbit/conversation-character";
import { trackCharacterGaze } from "../orbit/pointer-tracking";
import { CodexPetSprite } from "./codex-pet-sprite";
import {
  type CodexPet,
  type PetAnimationState,
  type PetContentBounds,
  type PetFrame,
  type PetSpriteSource,
  SPRITE_SPEC_V2,
  findPet,
  measurePetContentBounds,
  petAnimation,
  petLookFrame,
  petSpriteSource,
  petSpritesheetUrl,
} from "./codex-pets";

/** The pet picked on this device (`Tqa`), used by drafts and local bots. */
export function useSelectedPet() {
  const selectedAvatarId = useCharacterStore((s) => s.selectedAvatarId);
  return findPet(selectedAvatarId);
}

/** The pet a bot wears (`Nqa`): local bots and drafts follow the device selection, cloud bots their profile. */
export function useIdentityPet(identity: DotAvatarIdentity) {
  const conversationId = useIdentityConversationId(identity);
  const dot = useDotStore((s) => (conversationId == null ? undefined : s.dots.find((d) => d.conversationId === conversationId)));
  const selectedPet = useSelectedPet();
  if (conversationId == null || dot?.runtime === "local") return selectedPet;
  return findPet(dot?.petId);
}

const boundsBySpritesheet = new Map<string, PetContentBounds | null>();

/** Opaque bounds of a pet's idle frame, measured once per spritesheet (`oJa`). */
export function usePetContentBounds(pet: CodexPet | null) {
  const url = pet == null ? null : petSpritesheetUrl(pet);
  const [result, setResult] = useState<{ url: string; bounds: PetContentBounds | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (url == null || boundsBySpritesheet.has(url)) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url;
    image.decode().then(
      () => {
        let bounds: PetContentBounds | null = null;
        try {
          bounds = measurePetContentBounds(image);
        } catch {
          bounds = null;
        }
        boundsBySpritesheet.set(url, bounds);
        if (!cancelled) setResult({ url, bounds, failed: false });
      },
      () => {
        if (!cancelled) setResult({ url, bounds: null, failed: true });
      },
    );
    return () => {
      cancelled = true;
      image.src = "";
    };
  }, [url]);
  if (url == null) return { data: null, isPending: false, isError: false };
  if (boundsBySpritesheet.has(url)) return { data: boundsBySpritesheet.get(url) ?? null, isPending: false, isError: false };
  if (result?.url === url) return { data: result.bounds, isPending: false, isError: result.failed };
  return { data: undefined, isPending: true, isError: false };
}

function useIsInView(ref: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element == null) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) setInView(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

interface PetFrameViewProps {
  ref?: Ref<HTMLSpanElement>;
  className?: string;
  source: PetSpriteSource;
  bounds?: PetContentBounds | null;
  state: PetAnimationState;
  lookFrame?: PetFrame | null;
}

/** Centers and enlarges the pet's opaque content within its box (`WYa1Component`). */
export function PetFrameView({ ref, className, source, bounds, state, lookFrame }: PetFrameViewProps) {
  let transform: string | undefined;
  if (bounds != null) {
    const extent = Math.max(bounds.width, bounds.height);
    const scale = Math.min(bounds.frameHeight / extent, 1.5);
    const x = ((bounds.frameWidth / 2 - (bounds.left + bounds.width / 2)) / bounds.frameHeight) * scale * 100;
    const y = ((bounds.frameHeight / 2 - (bounds.top + bounds.height / 2)) / bounds.frameHeight) * scale * 100;
    transform = `translate(${x}%, ${y}%) scale(${scale})`;
  }
  return (
    <span ref={ref} className={clsx("inline-flex items-center justify-center", className)}>
      <span className="pointer-events-none inline-flex size-full origin-center items-center justify-center" style={{ transform }}>
        <CodexPetSprite size="container" source={source} state={state} lookFrame={lookFrame} loop />
      </span>
    </span>
  );
}

interface PetCharacterProps {
  className?: string;
  pet: CodexPet;
  bounds?: PetContentBounds | null;
  identity: DotAvatarIdentity;
  animated: boolean;
  interactionTarget?: RefObject<HTMLElement | null>;
}

/** A pet avatar that runs while its bot works and looks toward the pointer while idle (`OYa`). */
function PetCharacter({ className, pet, bounds, identity, animated, interactionTarget }: PetCharacterProps) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const inView = useIsInView(frameRef);
  const state = usePetAnimationState(identity);
  const reducedMotion = useReducedMotion();
  const moving = animated && inView && !reducedMotion;
  const tracksPointer = moving && state === "idle" && pet.spriteVersionNumber === SPRITE_SPEC_V2.version;
  const [gazeFrame, setGazeFrame] = useState<PetFrame | null>(null);
  const interactionElement = interactionTarget?.current;

  useEffect(() => {
    const frame = frameRef.current;
    const target = interactionTarget?.current;
    if (!tracksPointer || frame == null || target == null) return;
    return trackCharacterGaze(target, frame, frame, (message) => {
      if (message.type === "orbit-character-pointer-cancel") {
        setGazeFrame(null);
        return;
      }
      const { bounds: rect } = message;
      const next = petLookFrame(rect, { x: rect.left + message.x * rect.width, y: rect.top + message.y * rect.height }, pet.spriteVersionNumber);
      setGazeFrame((previous) => (previous?.rowIndex === next?.rowIndex && previous?.columnIndex === next?.columnIndex ? previous : next));
    });
  }, [tracksPointer, interactionTarget, interactionElement, pet.spriteVersionNumber]);

  const lookFrame = moving ? (tracksPointer ? gazeFrame : null) : petAnimation(state, true).frames[0];
  return <PetFrameView ref={frameRef} className={className} source={petSpriteSource(pet)} bounds={bounds} state={state} lookFrame={lookFrame} />;
}

export interface PetAvatarProps {
  className?: string;
  petId?: string | null;
  identity: DotAvatarIdentity;
  useSavedAvatar: boolean;
  animated: boolean;
  interactionTarget?: RefObject<HTMLElement | null>;
  loadingFallback?: ReactNode;
}

/** A bot shown as a Codex pet (`JYa`); without a pet it shows the default ring. */
export function PetAvatar({ className, petId, identity, useSavedAvatar, animated, interactionTarget, loadingFallback }: PetAvatarProps) {
  const petIdentity: DotAvatarIdentity = useSavedAvatar ? identity : "orbit-draft";
  const identityPet = useIdentityPet(petIdentity);
  const pet = petId == null ? identityPet : findPet(petId);
  const bounds = usePetContentBounds(pet);
  if (loadingFallback != null && pet != null && bounds.isPending) return loadingFallback;
  if (pet == null || (loadingFallback != null && bounds.isError)) return <LegacyAvatarImage className={className} avatar={null} />;
  return <PetCharacter key={identity} className={className} pet={pet} bounds={bounds.data} identity={identity} animated={animated} interactionTarget={interactionTarget} />;
}
