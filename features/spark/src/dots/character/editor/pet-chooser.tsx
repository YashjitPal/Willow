import clsx from "clsx";
import { type ReactNode, useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "../../lib/intl";
import { useReducedMotion } from "../../lib/reduced-motion";
import { Button } from "../../codex-ui/button";
import { Skeleton } from "../../codex-ui/skeleton";
import { Icon } from "../../codex-icons/icon";
import { petHatchedEggLight32 } from "../../codex-icons/pet-hatched-egg-light-32";
import { useCharacterStore } from "../../state/character-store";
import { AppearanceOptionGroup } from "../appearance-picker/appearance-option-group";
import { CodexPetSprite } from "../pets/codex-pet-sprite";
import { BUILT_IN_PETS, type CodexPet, PET_ASSET_MAP, petSpriteSource } from "../pets/codex-pets";

/** The pets a bot can wear (`use-avatar-options`): the bundled pets; saved pets are server data and not mocked. */
function useAvatarOptions() {
  const petsLoad = useCharacterStore((s) => s.petsLoad);
  return { avatarOptions: BUILT_IN_PETS, isLoading: petsLoad === "pending", isError: petsLoad === "error" };
}

function CreatePetOption({ disabled = false, onCreate }: { disabled?: boolean; onCreate?: () => void }) {
  const intl = useIntl();
  return (
    <AppearanceOptionGroup
      variant="artwork-row"
      selectedId={null}
      disabled={disabled}
      onChange={() => onCreate?.()}
      options={[
        {
          id: "create-pet",
          label: intl.formatMessage({
            id: "restricted.avatarChooser.createPet",
            defaultMessage: "Create a pet",
            description: "Open the pet creation experience from the avatar chooser",
          }),
          icon: (
            <span className="flex size-full items-center justify-center rounded-full bg-text/10">
              <Icon asset={petHatchedEggLight32} />
            </span>
          ),
        },
      ]}
    />
  );
}

const decodedSpritesheets = new Set<string>();

/** A pet's spritesheet, faded in once decoded (`GeComponent`). */
export function PetArtwork({ pet }: { pet: CodexPet }) {
  const reducedMotion = useReducedMotion();
  const source = petSpriteSource(pet);
  const url = source.spritesheetUrl ?? PET_ASSET_MAP[source.assetRef ?? ""];
  const [result, setResult] = useState<{ url: string; failed: boolean } | null>(null);
  useEffect(() => {
    if (url == null || decodedSpritesheets.has(url)) return;
    let cancelled = false;
    const image = new Image();
    image.src = url;
    image.decode().then(
      () => {
        decodedSpritesheets.add(url);
        if (!cancelled) setResult({ url, failed: false });
      },
      () => !cancelled && setResult({ url, failed: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [url]);
  const decoded = url != null && decodedSpritesheets.has(url);
  const isError = !decoded && result?.url === url && result.failed;
  const isPending = !decoded && !isError;
  return (
    <span className="relative flex size-full items-center justify-center">
      {isPending && (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <Skeleton className="size-full rounded-full" variant="prominent" animate={!reducedMotion} />
        </span>
      )}
      <CodexPetSprite
        key={url}
        className={clsx("transition-opacity duration-basic ease-in-out motion-reduce:transition-none starting:opacity-0", !isError && !decoded && "opacity-0")}
        size="container"
        source={source}
      />
    </span>
  );
}

export interface PetChooserProps {
  selectedPet?: CodexPet | null;
  disabled?: boolean;
  onSelect?: (pet: CodexPet) => void;
  layout?: "grid" | "row";
  heading?: ReactNode;
  onCreatePet?: () => void;
}

/** Saved and bundled pets, with loading and error states (`Me1Component`). */
export function PetChooser({ selectedPet, disabled, onSelect, layout = "grid", heading, onCreatePet }: PetChooserProps) {
  const setPetsLoad = useCharacterStore((s) => s.setPetsLoad);
  const { avatarOptions, isLoading, isError } = useAvatarOptions();
  const reducedMotion = useReducedMotion();
  const options = (isLoading ? [] : avatarOptions).map((pet) => ({ id: pet.id, label: pet.displayName, icon: <PetArtwork pet={pet} /> }));
  return (
    <>
      <AppearanceOptionGroup
        heading={heading}
        variant={layout === "row" ? "artwork-row" : "artwork"}
        fullBleed={layout === "row"}
        disabled={disabled}
        leading={onCreatePet ? <CreatePetOption disabled={disabled} onCreate={onCreatePet} /> : undefined}
        loadingItems={isLoading ? { count: 5, icon: <Skeleton className="size-full rounded-full" variant="prominent" animate={!reducedMotion} /> } : undefined}
        options={options}
        selectedId={selectedPet?.id ?? null}
        onChange={(id) => {
          const pet = avatarOptions.find((option) => option.id === id);
          if (pet != null) onSelect?.(pet);
        }}
      />
      {isLoading && (
        <p className="pt-3 text-sm text-secondary" role="status">
          <FormattedMessage id="restricted.characterEditor.petsLoading" defaultMessage="Loading your pets…" description="Status while fetching saved pets for the bot appearance picker" />
        </p>
      )}
      {isError && (
        <div className="flex items-center gap-3 pt-3">
          <p className="text-sm text-danger" role="alert">
            <FormattedMessage
              id="restricted.characterEditor.petsLoadError"
              defaultMessage="Some pets couldn’t be loaded"
              description="Error when the bot appearance picker could not load all saved pets"
            />
          </p>
          <Button type="button" color="ghost" disabled={disabled} onClick={() => setPetsLoad("default")}>
            <FormattedMessage id="restricted.characterEditor.petsRetry" defaultMessage="Try again" description="Button to reload saved pets in the bot appearance picker" />
          </Button>
        </div>
      )}
    </>
  );
}
