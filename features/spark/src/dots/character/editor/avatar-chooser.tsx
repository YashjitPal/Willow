import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "../../lib/intl";
import { Skeleton } from "../../codex-ui/skeleton";
import { Icon } from "../../codex-icons/icon";
import { emojiFaceBadgePlusLight32 } from "../../codex-icons/emoji-face-badge-plus-light-32";
import { PhotoLight20Icon } from "../../codex-icons/photo-light-20";
import { useCharacterStore } from "../../state/character-store";
import { AppearanceOptionGroup } from "../appearance-picker/appearance-option-group";
import { DEFAULT_AVATAR_SRC } from "../avatar/legacy-avatars";
import type { CharacterEditorClient, CharacterEditorPreview } from "../orbit/character-frame";
import { Category } from "../orbit/engine-enums";
import type { CodexPet } from "../pets/codex-pets";
import { RING_COLORS, type RingColor } from "./chooser-state";
import { PetChooser } from "./pet-chooser";
import { PresetTile } from "./preset-tile";

/** How long a preset's live preview keeps playing after its first frame. */
const PRESET_PREVIEW_MS = 4000;

export interface AvatarChooserProps {
  preview: CharacterEditorPreview | null;
  client?: CharacterEditorClient;
  reducedMotion?: boolean;
  disabled?: boolean;
  selectedTint: RingColor | null;
  selectedPreset: string | null;
  customSelected: boolean;
  hasCustomCharacter: boolean;
  onTint?: (color: RingColor) => void;
  onPreset?: (presetId: string) => void;
  onCustomize?: () => void;
  onSelectCustom?: () => void;
  pet?: CodexPet | null;
  onSelectPet?: (pet: CodexPet | null) => void;
  petDisabled?: boolean;
  onCreatePet?: () => void;
}

/** Colored rings, preset characters, the custom character and pets (`TeComponent`). */
export function AvatarChooser({
  preview,
  client,
  reducedMotion = false,
  disabled,
  selectedTint,
  selectedPreset,
  customSelected,
  hasCustomCharacter,
  onTint,
  onPreset,
  onCustomize,
  onSelectCustom,
  pet,
  onSelectPet,
  petDisabled,
  onCreatePet,
}: AvatarChooserProps) {
  const intl = useIntl();
  const petsEnabled = useCharacterStore((s) => s.petsEnabled);
  const colorOptions = preview?.catalog[Category.Color];
  const [previewingPreset, setPreviewingPreset] = useState<string | null>(null);
  const previewTimeoutRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(previewTimeoutRef.current), []);
  const stopPresetPreview = () => {
    window.clearTimeout(previewTimeoutRef.current);
    previewTimeoutRef.current = undefined;
    setPreviewingPreset(null);
  };

  const tintOptions = RING_COLORS.map((id) => {
    const option = colorOptions?.find((candidate) => candidate.id === id);
    return {
      id,
      label:
        id === "gray"
          ? intl.formatMessage({ id: "restricted.avatarChooser.gray", defaultMessage: "Gray", description: "Accessible name of the default gray ring avatar" })
          : (option?.title ?? id),
      icon:
        colorOptions == null ? (
          <Skeleton className="size-full rounded-full" variant="prominent" animate={!reducedMotion} aria-hidden="true" />
        ) : (
          <span className={clsx("block size-full", !reducedMotion && "transition-opacity duration-basic ease-in-out motion-reduce:transition-none starting:opacity-0")}>
            {id === "gray" ? (
              <img className="size-full object-contain" src={DEFAULT_AVATAR_SRC} alt="" />
            ) : (
              <span className="block size-full mask-contain mask-center mask-no-repeat" style={{ maskImage: `url("${DEFAULT_AVATAR_SRC}")`, backgroundColor: option?.color }} />
            )}
          </span>
        ),
      disabled: id !== "gray" && option == null,
    };
  });

  const characterOptions = [
    {
      id: "customize",
      action: true,
      label: intl.formatMessage({
        id: "restricted.avatarChooser.customize",
        defaultMessage: "Customize",
        description: "Button that opens the editor to create or edit the saved custom character",
      }),
      icon: (
        <span className="flex size-full items-center justify-center rounded-full bg-text/10">
          <Icon asset={emojiFaceBadgePlusLight32} />
        </span>
      ),
    },
    ...(hasCustomCharacter
      ? [
          {
            id: "custom",
            label: intl.formatMessage({
              id: "restricted.avatarChooser.custom",
              defaultMessage: "Custom avatar",
              description: "Button that selects the saved custom character without opening the editor",
            }),
            icon: preview?.customThumbnail ? (
              <img className="size-full object-contain" src={preview.customThumbnail} alt="" />
            ) : (
              <span className="flex size-full items-center justify-center">
                <PhotoLight20Icon className="text-tertiary" />
              </span>
            ),
          },
        ]
      : []),
    ...(preview?.presets.map((preset) => ({
      id: preset.id,
      label: preset.title,
      icon: (
        <PresetTile
          preset={preset}
          client={client}
          active={!disabled && previewingPreset === preset.id}
          reducedMotion={reducedMotion}
          onFrame={
            previewingPreset === preset.id
              ? () => {
                  previewTimeoutRef.current ??= window.setTimeout(stopPresetPreview, PRESET_PREVIEW_MS);
                }
              : undefined
          }
          onError={() => {
            if (previewingPreset === preset.id) stopPresetPreview();
          }}
        />
      ),
    })) ?? []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-6 py-4 select-none">
      <h2 className="text-heading-lg leading-7 font-semibold">
        <FormattedMessage id="restricted.avatarChooser.title" defaultMessage="Customize your bot" description="Heading of the assistant avatar chooser" />
      </h2>
      <AppearanceOptionGroup
        heading={<FormattedMessage id="restricted.avatarChooser.colors" defaultMessage="Colors" description="Heading above colored ring avatars" />}
        variant="artwork-row"
        fullBleed
        disabled={disabled}
        selectedId={selectedTint}
        onChange={(id) => onTint?.(id as RingColor)}
        options={tintOptions}
      />
      <AppearanceOptionGroup
        heading={
          <FormattedMessage
            id="restricted.avatarChooser.characters"
            defaultMessage="Characters"
            description="Heading above preset characters and the custom character editor button"
          />
        }
        variant="artwork-row"
        fullBleed
        disabled={disabled}
        selectedId={customSelected ? "custom" : selectedPreset}
        onChange={(id) => {
          stopPresetPreview();
          if (id === "customize") {
            onCustomize?.();
            return;
          }
          if (id === "custom") {
            onSelectCustom?.();
            return;
          }
          if (!reducedMotion) setPreviewingPreset(id);
          onPreset?.(id);
        }}
        options={characterOptions}
      />
      {petsEnabled && (
        <div className="flex min-w-0 shrink-0 flex-col gap-2">
          <PetChooser
            heading={<FormattedMessage id="restricted.avatarChooser.pets" defaultMessage="Pets" description="Heading above available pet avatars" />}
            selectedPet={pet}
            disabled={petDisabled}
            onSelect={onSelectPet}
            layout="row"
            onCreatePet={onCreatePet}
          />
        </div>
      )}
    </div>
  );
}
