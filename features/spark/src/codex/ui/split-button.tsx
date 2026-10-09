import clsx from "clsx";
import { useState, type MouseEvent, type ReactNode } from "react";
import { useIntl, type MessageDescriptor } from "react-intl";
import { ChevronDownMdLight16Icon } from "../icons/chevron-down-md-light-16";
import { ChevronDownMdLight20Icon } from "../icons/chevron-down-md-light-20";
import { LegacySharedGxiDba3Icon } from "../icons/legacy-shared-gxi-dba3";
import { Button, type ButtonProps } from "./button";
import { DropdownMenu, type DropdownMenuAlign } from "./dropdown-menu";
import { SizedIcon } from "./sized-icon";

const radiusClasses = {
  toolbar: "rounded-button-toolbar",
  default: "rounded-full",
  pageAction: "rounded-full",
  compact: "rounded-button-action",
  composer: "rounded-full",
} as const;

export interface SplitButtonProps {
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  color?: ButtonProps["color"];
  size?: keyof typeof radiusClasses;
  separated?: boolean;
  disabled?: boolean;
  primaryDisabled?: boolean;
  dropdownDisabled?: boolean;
  loading?: boolean;
  className?: string;
  primaryClassName?: string;
  primaryAriaLabel?: string | MessageDescriptor;
  secondaryAriaLabel?: string;
  dropdownContent: ReactNode;
  dropdownAlign?: DropdownMenuAlign;
  dropdownOpen?: boolean;
  onDropdownOpenChange?: (open: boolean) => void;
}

/** `Ax` (`ACi`): a primary action joined to a chevron that opens a menu of related actions. */
export function SplitButton({
  children,
  onClick,
  color = "primary",
  size = "default",
  separated = false,
  disabled = false,
  primaryDisabled,
  dropdownDisabled,
  loading = false,
  className,
  primaryClassName,
  primaryAriaLabel,
  secondaryAriaLabel,
  dropdownContent,
  dropdownAlign = "start",
  dropdownOpen,
  onDropdownOpenChange,
}: SplitButtonProps) {
  const intl = useIntl();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isDisabled = disabled || loading;
  const isPrimaryDisabled = isDisabled || primaryDisabled === true;
  const isDropdownDisabled = dropdownDisabled ?? isDisabled;
  const isControlled = dropdownOpen !== undefined;
  const open = isControlled ? dropdownOpen : uncontrolledOpen;
  const dimsPrimaryContent = color === "outline" && isPrimaryDisabled && !isDropdownDisabled;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onDropdownOpenChange?.(next);
  };
  const secondaryLabel =
    secondaryAriaLabel ?? intl.formatMessage({ id: "compoundButton.secondaryAction", defaultMessage: "Secondary action", description: "Aria label for the secondary target on the compound button" });
  const primaryLabel = typeof primaryAriaLabel === "string" ? primaryAriaLabel : primaryAriaLabel == null ? undefined : intl.formatMessage(primaryAriaLabel);
  const chevronClassName = color === "outline" && isDropdownDisabled && !isPrimaryDisabled ? "opacity-20" : "opacity-50";
  const dropdownButton = (
    <Button
      aria-label={secondaryLabel}
      color={color}
      size={size}
      disabled={isDropdownDisabled}
      focusRing="inset"
      className={clsx(
        "gap-0 rounded-s-none border-s-0",
        separated ? "relative ps-2 pe-2 before:pointer-events-none before:absolute before:inset-y-2 before:start-0 before:w-px before:bg-current/25" : "ps-0.5 pe-1.5",
        color === "outline" && isDropdownDisabled && "disabled:opacity-100",
      )}
      onMouseDown={(event) => event.preventDefault()}
      type="button"
    >
      {size === "toolbar" || size === "pageAction" ? (
        <SizedIcon icon={{ 16: ChevronDownMdLight16Icon, 20: ChevronDownMdLight20Icon }} className={chevronClassName} />
      ) : (
        <LegacySharedGxiDba3Icon className={clsx("icon-2xs", chevronClassName)} />
      )}
    </Button>
  );
  return (
    <div
      className={clsx(
        "inline-flex self-start items-stretch overflow-hidden",
        radiusClasses[size],
        color === "outline" && isPrimaryDisabled && isDropdownDisabled && "opacity-40",
        className,
      )}
    >
      <Button
        color={color}
        size={size}
        disabled={isPrimaryDisabled}
        focusRing="inset"
        loading={loading}
        className={clsx(
          "rounded-e-none border-e-0",
          separated ? "pe-3" : "pe-1",
          color === "outline" && isPrimaryDisabled && "disabled:opacity-100",
          dimsPrimaryContent && "disabled:[&>*]:opacity-40",
          primaryClassName,
        )}
        aria-label={primaryLabel}
        onClick={(event) => {
          if (isPrimaryDisabled) return;
          if (onClick) {
            onClick(event);
            return;
          }
          setOpen(!open);
        }}
      >
        {dimsPrimaryContent && (typeof children === "string" || typeof children === "number") ? <span>{children}</span> : children}
      </Button>
      <DropdownMenu
        open={!isDropdownDisabled && open}
        onOpenChange={(next) => {
          if (!isDropdownDisabled) setOpen(next);
        }}
        align={dropdownAlign}
        triggerButton={dropdownButton}
      >
        <div className="flex min-w-[160px] flex-col gap-0.5">{dropdownContent}</div>
      </DropdownMenu>
    </div>
  );
}
