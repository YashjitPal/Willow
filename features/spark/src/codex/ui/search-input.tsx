import clsx from "clsx";
import { useRef, type AriaRole, type FocusEventHandler, type Key, type KeyboardEventHandler, type ReactNode, type RefObject } from "react";
import { useIntl } from "react-intl";
import { LegacySharedFvi2dd2Icon } from "../icons/legacy-shared-fvi-2dd2";
import { MagnifyingGlassLgLight16Icon } from "../icons/magnifying-glass-lg-light-16";
import { MagnifyingGlassLgLight20Icon } from "../icons/magnifying-glass-lg-light-20";
import { XmarkCircleFillRegular16Icon } from "../icons/xmark-circle-fill-regular-16";
import { SizedIcon } from "./sized-icon";

export type SearchInputVariant = "default" | "toolbar" | "toolbar-action" | "toolbar-compact" | "sidebar-header" | "catalog" | "catalog-filter";

export interface SearchInputProps {
  id?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
  autoFocus?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  inputKey?: Key;
  inputRole?: AriaRole;
  isClearable?: boolean;
  label?: ReactNode;
  maxLength?: number;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  onSearchQueryChange: (query: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  searchQuery: string;
  trailingControl?: ReactNode;
  variant?: SearchInputVariant;
}

const clearSearchMessage = {
  id: "skills.pageSearchInput.clear",
  defaultMessage: "Clear search",
  description: "Accessible label for clearing a search field",
};

/** Rounded search field (`u9` in app-initial); the `sidebar` variant is not reproduced. */
export function SearchInput({
  id,
  inputRef,
  className,
  autoFocus,
  clearLabel,
  disabled,
  inputKey,
  inputRole,
  isClearable = true,
  label,
  maxLength,
  onFocus,
  onKeyDown,
  onSearchQueryChange,
  placeholder,
  readOnly,
  searchQuery,
  trailingControl,
  variant = "default",
}: SearchInputProps) {
  const intl = useIntl();
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  const isToolbar = variant === "toolbar" || variant === "toolbar-action" || variant === "toolbar-compact";
  return (
    <div
      className={clsx(
        "ws-search",
        `ws-search--${variant}`,
        "no-drag flex items-center py-0 text-base leading-[18px]",
        variant === "default" && "h-page-search gap-2 rounded-full border border-primary-outline bg-page-search px-2.5",
        isToolbar && "gap-2 rounded-full border border-primary-outline bg-transparent px-3 text-sm leading-5",
        variant === "toolbar" && "h-9",
        variant === "toolbar-action" && "h-token-button-composer",
        variant === "toolbar-compact" && "h-8 browser:h-9",
        variant === "sidebar-header" && "h-9 shrink-0 gap-2 rounded-full bg-background-secondary-soft-alpha px-3",
        variant === "catalog" && "h-14 gap-3 rounded-xl border border-primary-outline bg-surface px-5",
        variant === "catalog-filter" && "h-12 gap-3 rounded-xl border border-primary-outline bg-surface-secondary px-4",
        className,
      )}
      data-sidebar-header-search={variant === "sidebar-header" || undefined}
    >
      <span className="flex shrink-0 items-center justify-center">
        {isToolbar && <SizedIcon icon={{ 16: MagnifyingGlassLgLight16Icon, 20: MagnifyingGlassLgLight20Icon }} className="text-secondary" />}
        {!isToolbar && (variant === "sidebar-header" ? <MagnifyingGlassLgLight16Icon className="text-secondary" /> : <LegacySharedFvi2dd2Icon className="icon-sm text-secondary" />)}
      </span>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        key={inputKey}
        autoFocus={autoFocus}
        id={id}
        ref={ref}
        className={clsx(
          "min-w-0 flex-1 bg-transparent text-default outline-none select-text placeholder:text-tertiary [&::placeholder]:select-none",
          isToolbar ? "text-sm leading-5" : "text-base leading-[18px]",
        )}
        autoComplete="off"
        disabled={disabled}
        maxLength={maxLength}
        readOnly={readOnly}
        role={inputRole}
        type="text"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />
      {isClearable && searchQuery.length > 0 ? (
        <button
          disabled={disabled}
          aria-label={clearLabel ?? intl.formatMessage(clearSearchMessage)}
          className="flex shrink-0 cursor-interaction items-center justify-center text-secondary hover:text-default"
          type="button"
          onClick={() => {
            ref.current?.focus();
            onSearchQueryChange("");
          }}
        >
          <XmarkCircleFillRegular16Icon />
        </button>
      ) : null}
      {trailingControl == null ? null : <div className="flex shrink-0 items-center">{trailingControl}</div>}
    </div>
  );
}
