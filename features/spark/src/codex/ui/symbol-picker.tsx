import clsx from "clsx";
import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from "react";
import { FormattedMessage } from "react-intl";
import { normalizeProjectIcon, projectColorName, type ProjectColor } from "./project-appearance";
import { SymbolPickerHeader, SymbolPickerLayout, SymbolSkeletonCell } from "./symbol-picker-layout";
import type { IconCapability, SymbolBrowserOptions, SymbolBrowserProps, SymbolKind, SymbolPickerCapabilities, SymbolSelection, SymbolValue } from "./symbol-picker-types";

const SymbolBrowser = lazy(() => import("./symbol-browser").then((module) => ({ default: module.SymbolBrowser })));

/** `Ixr1Component`: the header over a shimmering grid while the browser loads, or the load error. */
export function SymbolPickerFallback({ error = false, ...props }: SymbolBrowserProps & { error?: boolean }) {
  const { availableHeight, capabilities, disabled, kind, onClear, onKindChange, query, inputValue, layout = "grid", showSearch = true } = props;
  const count =
    kind === "teamIcon"
      ? Math.min(capabilities.teamIcons?.choices.length ?? 32, 64)
      : kind === "emoji"
        ? (capabilities.emoji?.allowedEmojis?.length ?? 64)
        : (capabilities.icons?.allowedIcons?.length ?? 32);
  return (
    <SymbolPickerLayout
      availableHeight={availableHeight}
      collapseSearchOnScroll={kind !== "teamIcon"}
      compact={layout === "compact"}
      hasSearch={showSearch}
      header={
        <SymbolPickerHeader
          capabilities={capabilities}
          disabled={disabled}
          kind={kind}
          onClear={onClear}
          onKindChange={onKindChange}
          search={showSearch ? { disabled: true, value: inputValue ?? query } : undefined}
        />
      }
      footer={query.trim() === "" ? props.footer : undefined}
    >
      {error ? (
        <div className="py-4 text-center text-sm text-secondary" role="alert">
          <FormattedMessage id="symbolPicker.loadError" defaultMessage="Could not load symbols" description="Error shown when the symbol picker could not be loaded" />
        </div>
      ) : (
        <>
          <div className="sr-only" role="status">
            <FormattedMessage id="symbolPicker.loading" defaultMessage="Loading symbols…" description="Accessible loading label for the symbol picker" />
          </div>
          <div className={layout === "compact" ? "flex w-max gap-2.5" : "grid grid-cols-8 gap-1"} aria-hidden>
            {Array.from({ length: count }, (_, index) => (
              <div key={index} className="flex justify-center">
                <div className={clsx("flex items-center justify-center", layout === "compact" ? "size-11 shrink-0" : "size-8")}>
                  <SymbolSkeletonCell />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </SymbolPickerLayout>
  );
}

class SymbolBrowserBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** `hxr`: the browser chunk, loaded on first render, with the load error in place of the grid. */
function LazySymbolBrowser(props: SymbolBrowserProps) {
  return (
    <SymbolBrowserBoundary fallback={<SymbolPickerFallback {...props} error />}>
      <SymbolBrowser {...props} />
    </SymbolBrowserBoundary>
  );
}

interface SymbolPickerCommonProps extends SymbolBrowserOptions {
  onSelect?: (selection: SymbolSelection) => void;
  /** Shows a Clear action. With `onChange`, it appears while there is a value and runs after `onChange({ kind: "none" })`. */
  onClear?: () => void;
}

/** Either explicit `capabilities`, or a stored symbol edited through `value` / `onChange` (emoji and icon tabs). */
export type SymbolPickerProps = SymbolPickerCommonProps &
  (
    | { capabilities: SymbolPickerCapabilities; value?: undefined; onChange?: undefined; defaultColor?: undefined; allowedKinds?: undefined }
    | {
        capabilities?: undefined;
        value?: SymbolValue | null;
        onChange: (value: SymbolValue) => void;
        /** Color for icons picked while the value is not an icon. */
        defaultColor?: string | null;
        allowedKinds?: ("emoji" | "icon")[];
      }
  );

/** `IXt` (app-initial, `Fxr1Component`): the shared emoji, icon and team icon picker. */
export function SymbolPicker(props: SymbolPickerProps) {
  return <SymbolPickerBase {...props} content={LazySymbolBrowser} />;
}

export type SymbolPickerBaseProps = SymbolPickerProps & {
  /** Renders the grid; may suspend while it loads. */
  content: ComponentType<SymbolBrowserProps>;
};

/** `RXt` (app-initial, `Sxr1Component`): `SymbolPicker` with the browser component passed in. */
export function SymbolPickerBase({ content: Content, ...props }: SymbolPickerBaseProps) {
  const { value, onChange, defaultColor, allowedKinds, ...rest } = props;
  const [pendingColor, setPendingColor] = useState<ProjectColor | null>(null);
  const color = value?.kind === "icon" ? (projectColorName(value.color) ?? "black") : (pendingColor ?? projectColorName(defaultColor) ?? "black");

  let capabilities: SymbolPickerCapabilities;
  if (onChange == null) {
    capabilities = rest.capabilities ?? {};
  } else {
    const emoji = { selectedEmojis: value?.kind === "emoji" ? [value.value] : [] };
    const icons: IconCapability = {
      selectedIcon: value?.kind === "icon" ? normalizeProjectIcon(value.value) : null,
      color,
      onColorChange: (next) => {
        if (rest.disabled) return;
        if (value?.kind === "icon") onChange({ ...value, color: next });
        else setPendingColor(next);
      },
    };
    capabilities = allowedKinds?.includes("emoji") === false ? { icons } : { emoji, icons: allowedKinds?.includes("icon") === false ? undefined : icons };
  }

  let preferredKind: SymbolKind = "emoji";
  if (capabilities.icons?.selectedIcon != null) preferredKind = "icon";
  if (capabilities.teamIcons?.selectedIcon != null) preferredKind = "teamIcon";
  const [requestedKind, setRequestedKind] = useState<SymbolKind>(rest.defaultKind ?? preferredKind);
  const available: Record<SymbolKind, boolean> = { emoji: capabilities.emoji != null, icon: capabilities.icons != null, teamIcon: capabilities.teamIcons != null };
  const kind = available[requestedKind] ? requestedKind : ((["emoji", "icon", "teamIcon"] as const).find((option) => available[option]) ?? "emoji");

  const [uncontrolledQuery, setUncontrolledQuery] = useState("");
  const onQueryChange = (query: string) => {
    if (rest.query === undefined) setUncontrolledQuery(query);
    rest.onQueryChange?.(query);
  };

  let onClear = rest.onClear;
  if (onChange != null) {
    onClear = undefined;
    if (value != null && value.kind !== "none") {
      onClear = () => {
        if (rest.disabled) return;
        onChange({ kind: "none" });
        rest.onClear?.();
      };
    }
  }

  const browserProps: SymbolBrowserProps = {
    ...rest,
    capabilities,
    onSelect: (selection) => {
      if (rest.disabled) return;
      if (selection.kind !== "teamIcon") onChange?.(selection.kind === "emoji" ? { kind: "emoji", value: selection.value } : { kind: "icon", value: selection.value, color });
      rest.onSelect?.(selection);
    },
    onClear,
    availableHeight: rest.availableHeight ?? "var(--autocomplete-overlay-available-height, var(--radix-popover-content-available-height, 100vh))",
    kind,
    query: rest.query ?? uncontrolledQuery,
    onQueryChange,
    onKindChange: (next) => {
      setRequestedKind(next);
      onQueryChange("");
    },
  };

  return (
    <Suspense fallback={<SymbolPickerFallback {...browserProps} />}>
      <Content {...browserProps} />
    </Suspense>
  );
}
