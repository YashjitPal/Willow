import { type ReactNode, useMemo } from "react";
import { useIntl } from "../../lib/intl";
import { toast } from "../../lib/toast";
import { useCharacterStore } from "../../state/character-store";
import { type Dot, useDot, useDotStore } from "../../state/dot-store";
import { AVATAR_COLORS, DEFAULT_APPEARANCE, type DotAppearance, asLegacyAvatarId } from "../avatar/legacy-avatars";
import type { CodexPet } from "../pets/codex-pets";
import { AppearancePickerDialog, type AppearancePickerSave, type AppearancePickerVariant } from "./appearance-picker-dialog";
import { DotNameRejectedError, isDotNameRejected } from "./dot-names";

function legacyAppearanceOf(dot: Dot | null | undefined): DotAppearance | null {
  if (dot == null) return DEFAULT_APPEARANCE;
  if (dot.petId != null) return { color: AVATAR_COLORS.pet, avatar: "pet" };
  const avatar = asLegacyAvatarId(dot.legacyAvatar);
  if (avatar != null) return { color: AVATAR_COLORS[avatar], avatar };
  return dot.identity === "orbit" ? null : DEFAULT_APPEARANCE;
}

/** A bot's legacy avatar and color (`h4`); orbit bots without one have none. */
export function useDotLegacyAppearance(conversationId: string) {
  const dot = useDot(conversationId);
  return useMemo(() => legacyAppearanceOf(dot), [dot]);
}

function appearancePatch(appearance: DotAppearance, pet: CodexPet | undefined): Partial<Dot> {
  return appearance.avatar === "pet" ? { petId: pet?.id ?? null } : { legacyAvatar: appearance.avatar, petId: null };
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

/** Stands in for renaming the bot's thread; the outcome is picked by the character scenarios. */
async function renameDot(conversationId: string, name: string) {
  const { saveOutcome, saveDelayMs } = useCharacterStore.getState();
  await wait(saveDelayMs);
  if (saveOutcome === "name-rejected") throw new DotNameRejectedError();
  useDotStore.getState().updateDot(conversationId, { name });
}

/** Stands in for saving a durable bot's avatar to its profile. */
async function saveDurableAvatar(conversationId: string, appearance: DotAppearance, pet: CodexPet | undefined) {
  const { saveOutcome, saveDelayMs } = useCharacterStore.getState();
  await wait(saveDelayMs);
  if (saveOutcome === "error" || saveOutcome === "changed-elsewhere") throw Error("Character save was not confirmed");
  useDotStore.getState().updateDot(conversationId, appearancePatch(appearance, pet));
}

export interface AppearancePickerProps {
  conversationId: string;
  variant?: AppearancePickerVariant;
  onClose?: () => void;
  triggerContent?: ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}

/** The appearance picker for an existing bot, saving its name and avatar (`TtComponent`). */
export function AppearancePicker({ conversationId, variant, onClose, triggerContent, onCloseAutoFocus }: AppearancePickerProps) {
  const intl = useIntl();
  const dot = useDot(conversationId);
  const appearance = useDotLegacyAppearance(conversationId);
  // Willow has no archived conversation previews, which are the only read-only names in Codex.
  const readOnlyName = false;
  const durable = dot?.runtime === "cloud";

  const onSave: AppearancePickerSave = async (nextAppearance, name, pet) => {
    const current = () => useDotStore.getState().dots.find((candidate) => candidate.conversationId === conversationId);
    if (current() == null) return false;
    if (!readOnlyName && name !== current()?.name) {
      try {
        await renameDot(conversationId, name);
      } catch (error) {
        if (isDotNameRejected(error)) throw error;
        return false;
      }
    }
    const saved = current();
    if (saved == null) return false;
    const savedAppearance = legacyAppearanceOf(saved);
    if (nextAppearance == null || (pet == null && nextAppearance.avatar === savedAppearance?.avatar && nextAppearance.color === savedAppearance.color)) return true;
    if (saved.runtime !== "cloud") {
      useDotStore.getState().updateDot(conversationId, appearancePatch(nextAppearance, pet));
      return true;
    }
    try {
      await saveDurableAvatar(conversationId, nextAppearance, pet);
      return current() != null;
    } catch (error) {
      if (current() == null) return false;
      console.warn("Failed to update an Orbit avatar", error);
      toast.error(
        intl.formatMessage({
          id: "restricted.aeonAppearancePicker.saveError.dot",
          defaultMessage: "Unable to save your bot’s avatar",
          description: "Error toast when a selected bot avatar could not be saved. Keep the singular term bot untranslated.",
        }),
        { id: "restricted.aeonAppearancePicker.saveError" },
      );
      return false;
    }
  };

  return (
    <AppearancePickerDialog
      key={JSON.stringify([dot?.runtime, conversationId])}
      appearance={appearance}
      name={dot?.name ?? null}
      identity={conversationId}
      characterConversationId={durable ? conversationId : undefined}
      variant={variant}
      triggerContent={triggerContent}
      onCloseAutoFocus={onCloseAutoFocus}
      readOnlyName={readOnlyName}
      onClose={onClose}
      onSave={onSave}
    />
  );
}
