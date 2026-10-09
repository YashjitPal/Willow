import clsx from "clsx";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { FormattedMessage } from "react-intl";
import { LegacySharedDbi838cIcon } from "../icons/legacy-shared-dbi-838c";
import { xmarkMdLight16 } from "../icons/xmark-md-light-16";
import { AdaptiveIcon } from "./adaptive-icon";
import { Avatar } from "./avatar";
import { Button } from "./button";
import { MenuMessage } from "./menu";
import { Popover, PopoverAnchor, PopoverContent } from "./popover";
import { Spinner } from "./spinner";
import { useListNavigation } from "./use-list-navigation";

export interface ShareInviteOption {
  id: string;
  label: string;
  /** Chip text once selected; defaults to `label`. */
  chipLabel?: string;
  secondaryLabel?: ReactNode;
  avatar?: ReactNode;
  colorKey?: string;
  disabledReason?: ReactNode;
}

export interface ShareInviteOptionSection<T extends ShareInviteOption> {
  id: string;
  label: ReactNode;
  options: T[];
}

/** Lookups that failed or are still loading; each adds a status line below the results. */
export interface ShareInviteSearchStatus {
  peopleError?: boolean;
  groupsError?: boolean;
  teamsError?: boolean;
  teamsLoading?: boolean;
}

export interface ShareInviteAutocompleteProps<T extends ShareInviteOption> {
  ariaDescribedBy?: string;
  ariaLabel?: string;
  clearQueryOnSelect?: boolean;
  disabled?: boolean;
  emptyMessage?: ReactNode;
  /** Chips get a remove button only when this and `onRemoveOption` are both set. */
  getRemoveLabel?: (option: T) => string;
  loadingLabel?: string;
  /** `undefined` while suggestions load. */
  options?: T[];
  optionSections?: ShareInviteOptionSection<T>[];
  placeholder?: string;
  portalContainer?: HTMLElement | null;
  query: string;
  searchStatus?: ShareInviteSearchStatus;
  /** Shown as chips before the input. */
  selectedOptions?: T[];
  showLoadingDropdown?: boolean;
  showSuggestionsOnFocus?: boolean;
  size?: "medium" | "large";
  trailingContent?: ReactNode;
  onEscape?: () => void;
  onQueryChange: (query: string) => void;
  onRemoveOption?: (option: T) => void;
  onSelectOption: (option: T) => void;
}

const listboxMaxHeight = "min(16rem, var(--radix-popover-content-available-height), calc(100vh - 16px))";

function optionKey(option: ShareInviteOption) {
  return option.id;
}

/** `OBo1Component` (app-initial): lookups that failed or are still loading, below the results. */
function SearchStatusMessages({ peopleError, groupsError, teamsError, teamsLoading }: ShareInviteSearchStatus) {
  return (
    <>
      {peopleError ? (
        <MenuMessage compact role="status">
          <FormattedMessage id="shareRecipientSearchStatus.peopleError" defaultMessage="Couldn't load people" description="Error when the people lookup in a sharing dialog fails" />
        </MenuMessage>
      ) : null}
      {groupsError ? (
        <MenuMessage compact role="status">
          <FormattedMessage
            id="shareRecipientSearchStatus.groupsError"
            defaultMessage="Couldn't load groups"
            description="Muted status below sharing search results when workspace group lookup fails"
          />
        </MenuMessage>
      ) : null}
      {teamsError ? (
        <MenuMessage compact role="status">
          <FormattedMessage
            id="shareRecipientSearchStatus.teamsError"
            defaultMessage="Couldn't load teams"
            description="Error when team suggestions in a sharing dialog fail but people search remains available"
          />
        </MenuMessage>
      ) : null}
      {teamsLoading ? (
        <MenuMessage compact role="status">
          <FormattedMessage id="shareRecipientSearchStatus.teamsLoading" defaultMessage="Loading your teams…" description="Status while loading team suggestions in a sharing dialog" />
        </MenuMessage>
      ) : null}
    </>
  );
}

/**
 * `WR` (app-initial), `field` variant: chips for the selected options, then a search input whose suggestions open in a
 * listbox popover, optionally in sections.
 */
export function ShareInviteAutocomplete<T extends ShareInviteOption>({
  ariaDescribedBy,
  ariaLabel,
  clearQueryOnSelect = true,
  disabled = false,
  emptyMessage,
  getRemoveLabel,
  loadingLabel,
  options,
  optionSections,
  placeholder,
  portalContainer,
  query,
  searchStatus,
  selectedOptions = [],
  showLoadingDropdown = true,
  showSuggestionsOnFocus = false,
  size = "medium",
  trailingContent,
  onEscape,
  onQueryChange,
  onRemoveOption,
  onSelectOption,
}: ShareInviteAutocompleteProps<T>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [openedByFocus, setOpenedByFocus] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const allOptions = optionSections?.flatMap((section) => section.options) ?? options;
  const hasStatus = searchStatus?.peopleError || searchStatus?.groupsError || searchStatus?.teamsError || searchStatus?.teamsLoading;
  const isOpen =
    !disabled &&
    !dismissed &&
    (query.trim().length > 0 || (showSuggestionsOnFocus && openedByFocus)) &&
    (hasStatus || (showLoadingDropdown && allOptions == null) || (allOptions != null && (allOptions.length > 0 || emptyMessage != null)));
  const selectable = allOptions?.filter((option) => option.disabledReason == null);
  const optionId = (option: T) => `${listboxId}-option-${encodeURIComponent(option.id)}`;

  const selectOption = (option: T) => {
    if (option.disabledReason != null) return;
    onSelectOption(option);
    if (clearQueryOnSelect) onQueryChange("");
    inputRef.current?.focus();
    setOpenedByFocus(false);
  };

  const { highlightedIndex, listRef, handleKeyDown, getItemProps } = useListNavigation({
    items: selectable,
    isActive: isOpen,
    getItemKey: optionKey,
    preserveHighlightOnItemsChange: true,
    onSelect: selectOption,
    onEscape: () => {
      setOpenedByFocus(false);
      onQueryChange("");
      onEscape?.();
    },
  });
  const highlighted = isOpen ? selectable?.[highlightedIndex] : undefined;

  const reopen = () => {
    setDismissed(false);
    setOpenedByFocus(showSuggestionsOnFocus);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (handleKeyDown(event)) return;
    if (query === "" && (event.key === "Backspace" || event.key === "Delete") && !event.nativeEvent.isComposing) {
      const last = selectedOptions.at(-1);
      if (last != null && onRemoveOption != null) {
        event.preventDefault();
        onRemoveOption(last);
      }
    }
    if (isOpen && event.key === "Enter") event.preventDefault();
  };

  const renderOption = (option: T) => {
    const isHighlighted = option === highlighted;
    const isDisabled = disabled || option.disabledReason != null;
    return (
      <button
        key={option.id}
        id={optionId(option)}
        type="button"
        {...(option.disabledReason == null ? getItemProps(selectable?.findIndex((item) => item.id === option.id) ?? -1) : {})}
        aria-selected={isHighlighted}
        disabled={isDisabled}
        className={clsx(
          "cursor-interaction flex w-full gap-2 rounded-sm text-start disabled:cursor-not-allowed",
          "items-start px-2 py-1.5",
          isDisabled && "opacity-50",
          isHighlighted && "bg-primary-ghost-hover",
        )}
        role="option"
      >
        {option.avatar ?? (option.colorKey == null ? null : <Avatar alt="" colorKey={option.colorKey} name={option.label} size="sm" />)}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={clsx("text-default", "text-sm")}>{option.label}</span>
          {option.secondaryLabel == null ? null : <span className="text-sm text-codex-description">{option.secondaryLabel}</span>}
        </span>
        {option.disabledReason == null ? null : <span className="shrink-0 self-center text-end text-sm text-codex-description">{option.disabledReason}</span>}
      </button>
    );
  };

  let listbox: ReactNode = null;
  if (allOptions == null) {
    listbox = (
      <div aria-label={loadingLabel} className="flex flex-1 items-center justify-center text-codex-description" role={loadingLabel == null ? undefined : "status"}>
        <Spinner className="icon-xs" />
      </div>
    );
  } else if (allOptions.length === 0) {
    listbox = <MenuMessage compact>{emptyMessage}</MenuMessage>;
  } else if (optionSections == null) {
    listbox = allOptions.map(renderOption);
  } else {
    listbox = optionSections
      .filter((section) => section.options.length > 0)
      .map((section) => (
        <div key={section.id} className="flex flex-col">
          <div className="px-2 pt-2 pb-1 text-xs font-medium text-codex-description">{section.label}</div>
          {section.options.map(renderOption)}
        </div>
      ));
  }
  if (hasStatus) {
    listbox = (
      <>
        {(allOptions?.length ?? 0) > 0 ? listbox : null}
        <SearchStatusMessages {...searchStatus} />
      </>
    );
  }

  const chips = selectedOptions.map((option) => (
    <span key={option.id} className={clsx("inline-flex min-w-0 items-center", "gap-1 rounded-md px-1 py-[1px] text-sm", "bg-secondary-soft text-secondary-solid")}>
      <span className="truncate">{option.chipLabel ?? option.label}</span>
      {getRemoveLabel != null && onRemoveOption != null ? (
        <Button aria-label={getRemoveLabel(option)} color="ghostTertiary" disabled={disabled} size="inline" onClick={() => onRemoveOption(option)}>
          <AdaptiveIcon legacyIcon={LegacySharedDbi838cIcon} asset16={xmarkMdLight16} legacyClassName="icon-2xs" aria-hidden />
        </Button>
      ) : null}
    </span>
  ));

  return (
    <div>
      <Popover
        modal={false}
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDismissed(true);
            setOpenedByFocus(false);
          }
        }}
      >
        <PopoverAnchor asChild>
          <div
            className={clsx(
              "flex w-full items-center text-base text-default",
              "max-h-64 gap-1 overflow-y-auto border border-primary-outline bg-primary-soft py-1 focus-within:border-ring",
              size === "large" ? "min-h-12 rounded-lg px-4" : "min-h-9 rounded-md px-2",
              disabled && "cursor-default opacity-50",
            )}
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {chips}
              <input
                ref={inputRef}
                aria-describedby={ariaDescribedBy}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={isOpen}
                aria-controls={isOpen ? listboxId : undefined}
                aria-activedescendant={highlighted == null ? undefined : optionId(highlighted)}
                aria-label={ariaLabel}
                className={clsx("flex-1 bg-transparent outline-none placeholder:text-tertiary", "min-w-[min(100%,9rem)]")}
                disabled={disabled}
                placeholder={selectedOptions.length === 0 ? placeholder : undefined}
                value={query}
                onFocus={reopen}
                onClick={reopen}
                onKeyDown={handleInputKeyDown}
                onChange={(event) => {
                  setDismissed(false);
                  setOpenedByFocus(false);
                  onQueryChange(event.currentTarget.value);
                }}
              />
            </div>
            {trailingContent == null ? null : <div className="shrink-0 self-start">{trailingContent}</div>}
          </div>
        </PopoverAnchor>
        {isOpen ? (
          <PopoverContent
            id={listboxId}
            ref={listRef}
            align="start"
            aria-label={ariaLabel}
            role="listbox"
            size="anchor"
            variant="menu"
            opaque
            sideOffset={8}
            portalContainer={portalContainer}
            style={{
              ...(portalContainer == null ? {} : { maxWidth: "var(--radix-popover-content-available-width)" }),
              maxHeight: listboxMaxHeight,
              minHeight: allOptions == null && !hasStatus ? listboxMaxHeight : undefined,
            }}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onInteractOutside={(event) => {
              if (event.target === inputRef.current) event.preventDefault();
            }}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            {listbox}
          </PopoverContent>
        ) : null}
      </Popover>
    </div>
  );
}
