import clsx from "clsx";
import { useEffect, useId, useState } from "react";
import { FormattedMessage, defineMessages, useIntl } from "../../lib/intl";
import { useReducedMotion } from "../../lib/reduced-motion";
import { Button } from "../../codex-ui/button";
import { Skeleton } from "../../codex-ui/skeleton";
import { Tabs, type TabItem } from "../../codex-ui/tabs";
import { ArrowLeftLgLight20Icon } from "../../codex-icons/arrow-left-lg-light-20";
import { useThemeVariant } from "../../lib/theme";
import { AppearanceOptionGroup } from "../appearance-picker/appearance-option-group";
import { type CharacterEditorPreview, type CharacterEditorRequest, getCharacterFrameUrl } from "../orbit/character-frame";
import { Category } from "../orbit/engine-enums";
import type { CodexPet } from "../pets/codex-pets";
import { PetChooser } from "./pet-chooser";

const messages = defineMessages({
  pet: { id: "restricted.characterEditor.pet", defaultMessage: "Pet", description: "Tab for choosing one of your pets as the assistant's appearance" },
  accessoryColor: {
    id: "restricted.characterEditor.accessoryColor",
    defaultMessage: "Accessory color",
    description: "Accessible label for color choices for the selected character accessory",
  },
  categories: {
    id: "restricted.characterEditor.categories",
    defaultMessage: "Character features",
    description: "Accessible label for tabs choosing which part of the assistant character to customize",
  },
  none: { id: "restricted.characterEditor.noAccessory", defaultMessage: "None", description: "Choice that removes all accessories from the assistant character" },
  shape: { id: "restricted.characterEditor.shape", defaultMessage: "Shape", description: "Label for the assistant character's body shape selector" },
  color: { id: "restricted.characterEditor.color", defaultMessage: "Color", description: "Label for the assistant character's body color selector" },
  eyes: { id: "restricted.characterEditor.eyes", defaultMessage: "Eyes", description: "Label for the assistant character's eye style selector" },
  eyewear: { id: "restricted.characterEditor.eyewear", defaultMessage: "Glasses", description: "Label for the assistant character's eyewear selector" },
  accessory: { id: "restricted.characterEditor.accessory", defaultMessage: "Accessories", description: "Label for the assistant character's accessory selector" },
});

/** Categories whose options are drawn by the picker thumbnail runtime. */
const THUMBNAIL_CATEGORIES: Partial<Record<number, string>> = {
  [Category.Eyes]: "eyes",
  [Category.Eyewear]: "eyewear",
  [Category.Accessory]: "accessory",
};

const THUMBNAIL_CANVAS_CSS_PX = 94;

interface PickerThumbnail {
  draw: (canvas: HTMLCanvasElement) => void;
}

interface PickerThumbnailRequest {
  shape: string;
  category: string;
  option: string;
  dark: boolean;
  signal: AbortSignal;
}

interface PickerThumbnailLoader {
  load: (request: PickerThumbnailRequest) => Promise<PickerThumbnail | null>;
  clearCache: () => void;
}

interface OrbitPickerThumbnailsModule {
  OrbitPickerThumbnails: new () => { load: (request: PickerThumbnailRequest) => Promise<PickerThumbnail | null>; clearCache: () => void };
}

/** Loads the engine's `picker-thumbnails.mjs` next to the frame on first use (`Ie`). */
function createPickerThumbnailLoader(): PickerThumbnailLoader | null {
  const frameUrl = getCharacterFrameUrl();
  const href = new URL("../runtime/picker-thumbnails.mjs", new URL(frameUrl, document.baseURI)).href;
  let thumbnails: Promise<InstanceType<OrbitPickerThumbnailsModule["OrbitPickerThumbnails"]>> | undefined;
  return {
    async load(request) {
      thumbnails ??= (import(/* @vite-ignore */ href) as Promise<OrbitPickerThumbnailsModule>).then((module) => new module.OrbitPickerThumbnails());
      return (await thumbnails).load(request);
    },
    clearCache() {
      thumbnails?.then(
        (loaded) => loaded.clearCache(),
        () => {},
      );
    },
  };
}

interface PickerThumbnailViewProps {
  thumbnails: PickerThumbnailLoader | null;
  shape: string | undefined;
  category: string;
  option: string;
  title: string;
}

/** An eyes/eyewear/accessory option drawn on the selected shape (`MeComponent`). */
function PickerThumbnailView({ thumbnails, shape, category, option, title }: PickerThumbnailViewProps) {
  const dark = useThemeVariant() === "dark";
  const reducedMotion = useReducedMotion();
  const requestKey = JSON.stringify([shape, category, option, dark]);
  const enabled = thumbnails != null && shape != null;
  const [result, setResult] = useState<{ key: string; thumbnail: PickerThumbnail | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (thumbnails == null || shape == null) return;
    const controller = new AbortController();
    thumbnails.load({ shape, category, option: option || "none", dark, signal: controller.signal }).then(
      (thumbnail) => !controller.signal.aborted && setResult({ key: requestKey, thumbnail, failed: false }),
      () => !controller.signal.aborted && setResult({ key: requestKey, thumbnail: null, failed: true }),
    );
    return () => controller.abort();
  }, [thumbnails, shape, category, option, dark, requestKey]);
  const settled = result?.key === requestKey ? result : null;
  const isLoading = enabled && settled == null;
  let content;
  if (isLoading) {
    content = <Skeleton className="size-16 rounded-full" variant="prominent" animate={!reducedMotion} aria-hidden="true" />;
  } else if (settled?.thumbnail != null && !settled.failed) {
    const { thumbnail } = settled;
    content = (
      <canvas
        ref={(canvas) => {
          if (canvas != null) {
            canvas.width = canvas.height = Math.round(THUMBNAIL_CANVAS_CSS_PX * window.devicePixelRatio);
            thumbnail.draw(canvas);
          }
        }}
        className="pointer-events-none size-full translate-y-1/10 scale-125"
        aria-hidden="true"
      />
    );
  } else {
    content = <span className="text-xs text-secondary">{title}</span>;
  }
  return (
    <span className="relative flex size-full items-center justify-center" aria-busy={isLoading}>
      {content}
    </span>
  );
}

function ColorSwatch({ color, label, selected, disabled, onClick }: { color: string; label: string; selected: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      className={clsx(
        "flex size-10 shrink-0 cursor-interaction items-center justify-center rounded-full border-2 p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-text" : "border-transparent",
      )}
      type="button"
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="size-full rounded-full" style={{ backgroundColor: color }} />
    </button>
  );
}

export interface CharacterFeaturesProps {
  preview: CharacterEditorPreview | null;
  disabled?: boolean;
  onEdit?: (request: CharacterEditorRequest) => void;
  pet?: CodexPet | null;
  onSelectPet?: (pet: CodexPet | null) => void;
  petDisabled?: boolean;
  onBack?: () => void;
  backDisabled?: boolean;
}

type FeatureTab = "pet" | `${number}`;

/** Shape, eyes, glasses and accessory tabs of the custom character editor (`ReComponent`). */
export function CharacterFeatures({ preview, disabled, onEdit, pet, onSelectPet, petDisabled = disabled, onBack, backDisabled = disabled }: CharacterFeaturesProps) {
  const intl = useIntl();
  const [thumbnails] = useState(createPickerThumbnailLoader);
  useEffect(() => () => thumbnails?.clearCache(), [thumbnails]);
  const baseId = useId();
  const [selectedTab, setSelectedTab] = useState<FeatureTab>(pet == null ? "0" : "pet");
  const category = Number(selectedTab);
  const thumbnailCategory = THUMBNAIL_CATEGORIES[category];
  const catalog = preview?.catalog;
  const categoryOptions = catalog?.[category];
  const selectedId = categoryOptions?.find((option) => option.selected)?.id ?? "";
  const bodyColor = catalog?.[Category.Color]?.find((option) => option.selected)?.color;
  const shape = catalog?.[Category.Shape]?.find((option) => option.selected)?.id;
  const options = [
    ...(category === Category.Accessory ? [{ id: "", title: intl.formatMessage(messages.none), thumbnail: undefined, selected: selectedId === "", available: true }] : []),
    ...(categoryOptions?.filter((option) => option.available || (category === Category.Accessory && option.selected)) ?? []),
  ];
  const selectOption = (id: string) => {
    const editedCategory = Object.values(Category).find((value) => value === category);
    if (editedCategory == null) return;
    const value = category === Category.Accessory && id === "" ? selectedId : id;
    if (value !== "") onEdit?.({ action: "select", category: editedCategory, value });
  };

  const tabs: TabItem<FeatureTab>[] = [
    ...(onSelectPet ? [{ key: "pet" as const, name: <FormattedMessage {...messages.pet} />, panelId: `${baseId}-pet` }] : []),
    { key: "0", name: <FormattedMessage {...messages.shape} />, panelId: `${baseId}-0` },
    { key: "2", name: <FormattedMessage {...messages.eyes} />, panelId: `${baseId}-2` },
    { key: "3", name: <FormattedMessage {...messages.eyewear} />, panelId: `${baseId}-3` },
    { key: "4", name: <FormattedMessage {...messages.accessory} />, panelId: `${baseId}-4` },
  ];

  return (
    <div className="flex h-120 min-h-0 flex-col overflow-hidden select-none sm:h-full">
      <div className="flex h-16 shrink-0 items-center gap-3 px-4">
        {onBack && (
          <Button
            type="button"
            color="ghost"
            size="iconCircle"
            disabled={backDisabled}
            aria-label={intl.formatMessage({
              id: "restricted.avatarChooser.back",
              defaultMessage: "Back to avatars",
              description: "Return from the custom character editor to the avatar chooser",
            })}
            onClick={onBack}
          >
            <ArrowLeftLgLight20Icon />
          </Button>
        )}
        <Tabs ariaLabel={intl.formatMessage(messages.categories)} variant="text" scrollable tabs={tabs} selectedKey={selectedTab} onSelect={(key) => setSelectedTab(key as typeof selectedTab)} />
      </div>
      <div key={selectedTab} id={`${baseId}-${selectedTab}`} className="min-h-0 flex-1 overflow-y-auto px-6 pb-4" role="tabpanel" aria-labelledby={`${baseId}-${selectedTab}-tab`} tabIndex={0}>
        {selectedTab === "pet" ? (
          <PetChooser selectedPet={pet} disabled={petDisabled} onSelect={onSelectPet} />
        ) : (
          <AppearanceOptionGroup
            variant="artwork"
            fillArtwork={thumbnailCategory != null}
            disabled={disabled}
            options={options.map((option) => ({
              id: option.id,
              label: option.title,
              icon: thumbnailCategory ? (
                <PickerThumbnailView thumbnails={thumbnails} shape={shape} category={thumbnailCategory} option={option.id} title={option.title} />
              ) : (
                <span className="relative block size-full">
                  {option.thumbnail && (
                    <span
                      className="absolute inset-0 bg-text mask-contain mask-center mask-no-repeat"
                      style={{ maskImage: `url("${option.thumbnail}")`, backgroundColor: bodyColor }}
                    />
                  )}
                  {!option.thumbnail && <span className="relative flex size-full items-center justify-center text-xs text-secondary">{option.title}</span>}
                </span>
              ),
            }))}
            selectedId={selectedId}
            onChange={selectOption}
          />
        )}
      </div>
      {category === Category.Shape && catalog != null && (
        <div className="shrink-0 px-5 pb-5">
          <div
            className="flex items-center justify-between overflow-x-auto rounded-full border border-default bg-surface p-2 shadow-sm"
            role="group"
            aria-label={intl.formatMessage(messages.color)}
          >
            {catalog[Category.Color]
              ?.filter((option) => option.available)
              .map(
                (option) =>
                  option.color && (
                    <ColorSwatch
                      key={option.id}
                      color={option.color}
                      label={option.title}
                      selected={option.selected}
                      disabled={disabled}
                      onClick={() => onEdit?.({ action: "select", category: Category.Color, value: option.id })}
                    />
                  ),
              )}
          </div>
        </div>
      )}
      {category === Category.Accessory &&
        categoryOptions
          ?.filter((option) => option.selected && option.colors?.length)
          .map((accessory) => (
            <div key={accessory.id} className="shrink-0 px-5 pb-5">
              <div
                className="flex items-center justify-between overflow-x-auto rounded-full border border-default bg-surface p-2 shadow-sm"
                role="group"
                aria-label={intl.formatMessage(messages.accessoryColor)}
              >
                {accessory.colors?.map((swatch) => (
                  <ColorSwatch
                    key={swatch.id}
                    color={swatch.color}
                    label={swatch.title}
                    selected={swatch.id === accessory.colorOverride}
                    disabled={disabled}
                    onClick={() => onEdit?.({ action: "color", accessory: accessory.id, value: swatch.id })}
                  />
                ))}
              </div>
            </div>
          ))}
    </div>
  );
}
