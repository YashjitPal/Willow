/**
 * The composer's model control as Willow's: its prompt box's model pill ("Fable 5.1 Medium" and a
 * chevron, features/chat composer/Composer.tsx) opening its model menu (platform/ui
 * models/ModelsMenu.tsx): the models with a check by the chosen one, then a row for each of the
 * model's traits — effort, context window, speed — whose values open in a menu beside it.
 *
 * Shift-click adds a model alongside the chosen one, for T3's start-on-several-models drafts.
 */
import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { useMemo, type MouseEvent } from "react";

import { resolveModelPickerSelectedModel } from "~/components/chat/ModelPickerContent";
import {
  renderProviderTraitsMenuContent,
  summarizeProviderTraits,
  type TraitsRenderInput,
} from "~/components/chat/composerProviderState";
import { getTriggerDisplayModelName, type ModelEsque } from "~/components/chat/providerIconUtils";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { providerModelKey } from "~/modelOrdering";
import type { ProviderInstanceEntry } from "~/providerInstances";

import { useWillowScope } from "./harness";

/** Willow's short model names: "Claude Fable 5.1" reads "Fable 5.1" (its use-composer-models.ts). */
export const willowShortModelName = (name: string): string =>
  name
    .replace(/Gemini\s+/gi, "")
    .replace(/Claude\s+/gi, "")
    .replace(/GPT\s+/gi, "")
    .replace(/\s+Extended$/gi, "")
    .trim() || name;

const modelStatus = (model: ModelEsque): string | null =>
  model.isUnavailable
    ? "Unavailable"
    : model.badge === "new"
      ? "New"
      : model.isDefault
        ? "Default"
        : model.isLegacy
          ? "Legacy"
          : null;

export function WillowModelPill(props: {
  activeInstanceId: ProviderInstanceId;
  model: string;
  selectedModels?: ReadonlyArray<{ instanceId: ProviderInstanceId; model: string }>;
  onToggleModel?: (instanceId: ProviderInstanceId, model: string) => void;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  traits: TraitsRenderInput | null;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const scope = useWillowScope();
  const activeEntry =
    props.instanceEntries.find((entry) => entry.instanceId === props.activeInstanceId) ?? null;

  // In an agent tab, that agent's instances; elsewhere every enabled one. A thread that has
  // started stays with its agent's family, as T3's picker keeps it.
  const { lockedProvider, lockedContinuationGroupKey } = props;
  const entries = useMemo(
    () =>
      props.instanceEntries.filter(
        (entry) =>
          entry.instanceId === props.activeInstanceId ||
          (entry.enabled &&
            (scope === null || entry.driverKind === scope) &&
            (lockedProvider === null ||
              (entry.driverKind === lockedProvider &&
                (!lockedContinuationGroupKey ||
                  entry.continuationGroupKey === lockedContinuationGroupKey)))),
      ),
    [
      lockedContinuationGroupKey,
      lockedProvider,
      props.activeInstanceId,
      props.instanceEntries,
      scope,
    ],
  );
  const grouped = entries.length > 1;

  const selectedModel = resolveModelPickerSelectedModel({
    driverKind: activeEntry?.driverKind,
    model: props.model,
    options: props.modelOptionsByInstance.get(props.activeInstanceId) ?? [],
  });
  const isSelected = (instanceId: ProviderInstanceId, slug: string) =>
    props.selectedModels && props.selectedModels.length > 1
      ? props.selectedModels.some(
          (selection) => selection.instanceId === instanceId && selection.model === slug,
        )
      : instanceId === props.activeInstanceId && (selectedModel?.slug ?? props.model) === slug;

  const summary = props.traits ? summarizeProviderTraits(props.traits) : null;
  const multiple = props.selectedModels && props.selectedModels.length > 1;
  const modelLabel = multiple
    ? `${props.selectedModels!.length} models`
    : willowShortModelName(
        selectedModel ? getTriggerDisplayModelName(selectedModel) : props.model || "Model",
      );
  const effortLabel = multiple ? null : summary?.effortLabel;

  // T3's order (modelOrdering.ts): favourites first, then the provider's own, legacy models last.
  const favorites = useClientSettings((settings) => settings.favorites ?? []);
  const favoriteKeys = useMemo(
    () => new Set(favorites.map((favorite) => providerModelKey(favorite.provider, favorite.model))),
    [favorites],
  );
  const orderedModels = (instanceId: ProviderInstanceId) => {
    const models = props.modelOptionsByInstance.get(instanceId) ?? [];
    const rank = (model: ModelEsque) =>
      favoriteKeys.has(providerModelKey(instanceId, model.slug)) ? 0 : model.isLegacy ? 2 : 1;
    return models
      .filter((model) => !model.isUnavailable || isSelected(instanceId, model.slug))
      .toSorted((a, b) => rank(a) - rank(b));
  };

  // The chosen model in view as the menu opens, as Willow's list keeps it.
  const showChosen = (list: HTMLDivElement | null) => {
    const row = list?.querySelector<HTMLElement>("[data-checked]");
    if (!list || !row) return;
    list.scrollTop = Math.max(0, row.offsetTop - (list.clientHeight - row.offsetHeight) / 2);
  };

  const choose = (event: MouseEvent, instanceId: ProviderInstanceId, slug: string) => {
    if (event.shiftKey && props.onToggleModel) {
      props.onToggleModel(instanceId, slug);
      return;
    }
    props.onInstanceModelChange(instanceId, slug);
    props.onOpenChange?.(false);
  };

  return (
    <Menu
      {...(props.open !== undefined ? { open: props.open } : {})}
      {...(props.onOpenChange ? { onOpenChange: props.onOpenChange } : {})}
    >
      <MenuTrigger
        disabled={props.disabled}
        aria-label={`Open model picker, currently ${[modelLabel, effortLabel].filter(Boolean).join(" ")}`}
        className="willow-model-pill"
        data-chat-provider-model-picker="true"
      >
        <span className="willow-model-pill__label">
          <span className="willow-model-pill__name">{modelLabel}</span>
          {effortLabel ? <span className="willow-model-pill__effort">{effortLabel}</span> : null}
        </span>
        <span aria-hidden="true" className="willow-model-pill__chevron">
          keyboard_arrow_down
        </span>
      </MenuTrigger>
      <MenuPopup side="top" align="end" sideOffset={8} className="willow-models-menu">
        <div ref={showChosen} className="willow-models-menu__models">
          {entries.every((entry) => orderedModels(entry.instanceId).length === 0) ? (
            <div className="willow-models-menu__empty">No models configured</div>
          ) : null}
          {entries.map((entry) => {
            const models = orderedModels(entry.instanceId);
            if (models.length === 0) return null;
            return (
              <div key={entry.instanceId} role="group" aria-label={entry.displayName}>
                {grouped ? <MenuGroupLabel>{entry.displayName}</MenuGroupLabel> : null}
                {models.map((model) => {
                  const disabledReason = props.getModelDisabledReason?.(
                    entry.instanceId,
                    model.slug,
                  );
                  const selected = isSelected(entry.instanceId, model.slug);
                  // Willow's rows always read two lines; with no status, the agent it runs on.
                  const status = disabledReason ?? modelStatus(model) ?? entry.displayName;
                  return (
                    <MenuItem
                      key={model.slug}
                      closeOnClick={false}
                      disabled={Boolean(disabledReason)}
                      className="willow-models-menu__model"
                      data-checked={selected ? "" : undefined}
                      aria-checked={selected}
                      role="menuitemradio"
                      onClick={(event) => choose(event, entry.instanceId, model.slug)}
                    >
                      <span aria-hidden="true" className="willow-models-menu__check">
                        {selected ? "check" : ""}
                      </span>
                      <span className="willow-models-menu__text">
                        <span className="willow-models-menu__name">
                          {willowShortModelName(getTriggerDisplayModelName(model))}
                        </span>
                        {status ? (
                          <span className="willow-models-menu__description">{status}</span>
                        ) : null}
                      </span>
                    </MenuItem>
                  );
                })}
              </div>
            );
          })}
        </div>
        {summary && props.traits ? (
          <>
            <MenuSeparator className="willow-models-menu__separator" />
            {summary.rows.map((row) => (
              <MenuSub key={row.id}>
                <MenuSubTrigger className="willow-models-menu__trait">
                  <span aria-hidden="true" className="willow-models-menu__check" />
                  <span className="willow-models-menu__text">
                    <span className="willow-models-menu__name">{row.label}</span>
                    {row.value ? (
                      <span className="willow-models-menu__value">{row.value}</span>
                    ) : null}
                  </span>
                  <span aria-hidden="true" className="willow-models-menu__arrow">
                    keyboard_arrow_right
                  </span>
                </MenuSubTrigger>
                <MenuSubPopup
                  sideOffset={8}
                  align="end"
                  alignOffset={0}
                  className={cn("willow-models-menu__sub")}
                >
                  {renderProviderTraitsMenuContent({
                    ...props.traits!,
                    descriptorIds: [row.id],
                    showGroupLabels: false,
                  })}
                </MenuSubPopup>
              </MenuSub>
            ))}
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
