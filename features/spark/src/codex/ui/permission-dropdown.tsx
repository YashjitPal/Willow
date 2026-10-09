import type { ReactNode } from "react";
import { CheckmarkMdLight16Icon } from "../icons/checkmark-md-light-16";
import { ChevronDownMdLight16Icon } from "../icons/chevron-down-md-light-16";
import { DropdownMenu } from "./dropdown-menu";
import { Menu } from "./menu";

export interface PermissionDropdownOption<T extends string> {
  value: T;
  ariaLabel?: string;
  description?: string;
  disabled?: boolean;
  tooltipText?: ReactNode;
}

export interface PermissionDropdownProps<T extends string> {
  options: PermissionDropdownOption<T>[];
  value: T;
  disabled?: boolean;
  renderLabel: (value: T) => ReactNode;
  variant?: "default" | "inline";
  removeLabel?: ReactNode;
  onChange?: (value: T) => void;
  /** Adds a danger "remove" item below the roles. */
  onRemoveAccess?: () => void;
}

/** `t` in permission-dropdown: a role menu on a bordered (or inline) trigger, with an optional danger remove item. */
export function PermissionDropdown<T extends string>({
  options,
  value,
  disabled = false,
  renderLabel,
  variant = "default",
  removeLabel,
  onChange,
  onRemoveAccess,
}: PermissionDropdownProps<T>) {
  return (
    <DropdownMenu
      align="end"
      contentWidth="xs"
      disabled={disabled}
      triggerButton={
        <button
          type="button"
          disabled={disabled}
          className={
            variant === "inline"
              ? "flex shrink-0 cursor-interaction items-center gap-1 text-base text-default"
              : "flex cursor-interaction items-center gap-1 rounded-md border border-default px-2 py-1 text-sm text-default"
          }
        >
          {renderLabel(value)}
          <ChevronDownMdLight16Icon className="text-codex-description" />
        </button>
      }
    >
      {options.map((option) => (
        <Menu.Item
          key={option.value}
          aria-description={option.description}
          aria-label={option.ariaLabel}
          disabled={disabled || option.disabled}
          RightIcon={option.value === value ? CheckmarkMdLight16Icon : undefined}
          SubText={option.description}
          subTextAllowWrap
          tooltipText={option.tooltipText}
          onSelect={() => onChange?.(option.value)}
        >
          {renderLabel(option.value)}
        </Menu.Item>
      ))}
      {onRemoveAccess == null ? null : (
        <>
          <Menu.Separator />
          <Menu.Item disabled={disabled} onSelect={onRemoveAccess}>
            <span className="text-danger">{removeLabel}</span>
          </Menu.Item>
        </>
      )}
    </DropdownMenu>
  );
}
