import clsx from "clsx";
import type { ComponentProps } from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { checkmarkMdLight20 } from "../icons/checkmark-md-light-20";
import { Icon, createIconComponent } from "../icons/icon";
import { LegacySharedKoi5a19Icon } from "../icons/legacy-shared-koi-5a19";
import { LegacySharedT7A513Icon } from "../icons/legacy-shared-t7-a513";
import { minusMdLight16 } from "../icons/minus-md-light-16";

const MinusIcon = createIconComponent(minusMdLight16);

const variantClasses = {
  default: "icon-2xs rounded-xs data-[state=checked]:bg-primary-soft data-[state=indeterminate]:bg-primary-soft",
  accent:
    "icon-2xs rounded-xs data-[state=checked]:bg-info-solid data-[state=indeterminate]:bg-info-solid data-[state=checked]:border-transparent data-[state=indeterminate]:border-transparent data-[state=checked]:text-control-thumb-on-accent data-[state=indeterminate]:text-control-thumb-on-accent disabled:opacity-50",
  overlay: "size-5 rounded-full bg-surface disabled:bg-surface-secondary",
  choice:
    "size-5 rounded-xs border-default bg-surface data-[state=checked]:border-transparent data-[state=checked]:bg-primary-solid data-[state=checked]:text-primary-solid data-[state=indeterminate]:border-transparent data-[state=indeterminate]:bg-primary-solid data-[state=indeterminate]:text-primary-solid",
  task: "grid size-6 place-items-center rounded-full data-[state=checked]:bg-primary-solid data-[state=checked]:text-primary-solid data-[state=indeterminate]:bg-primary-solid data-[state=indeterminate]:text-primary-solid disabled:opacity-50",
} as const;

export type CheckboxVariant = keyof typeof variantClasses;

export interface CheckboxProps extends Omit<ComponentProps<typeof CheckboxPrimitive.Root>, "onCheckedChange" | "asChild" | "children"> {
  /** Indeterminate reports `true`, like the bundles' wrapper. */
  onCheckedChange?: (checked: boolean) => void;
  variant?: CheckboxVariant;
}

/** Checkbox (`Ry` in the bundles); the `secondary` and `checklist` variants are not cloned yet. */
export function Checkbox({ className, checked, defaultChecked, onCheckedChange, disabled = false, variant = "default", ...rest }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      className={clsx(
        "group peer shrink-0 outline-none",
        "transition-[background-color,border-color,box-shadow]",
        variantClasses[variant],
        variant === "choice" ? "border" : "border border-strong shadow-sm",
        variant !== "accent" && variant !== "choice" && variant !== "task" && "data-[state=checked]:text-default data-[state=indeterminate]:text-default",
        variant !== "choice" && "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
        "aria-invalid:ring-2 aria-invalid:ring-text-danger/20",
        "aria-invalid:border-text-danger",
        "disabled:cursor-not-allowed",
        !disabled && variant === "task" && "data-[state=unchecked]:hover:bg-surface-tertiary",
        !disabled &&
          variant !== "task" &&
          variant !== "choice" &&
          (variant === "accent"
            ? "data-[state=unchecked]:hover:bg-surface-tertiary data-[state=checked]:hover:bg-info-solid/90 data-[state=indeterminate]:hover:bg-info-solid/90"
            : "hover:bg-surface-tertiary"),
        className,
      )}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={(state) => onCheckedChange?.(state === "indeterminate" || state)}
      disabled={disabled}
      {...rest}
    >
      <CheckboxPrimitive.Indicator className="flex h-full w-full items-center justify-center text-current">
        {variant === "choice" && (checked === "indeterminate" ? <MinusIcon /> : <Icon asset={checkmarkMdLight20} />)}
        {variant !== "choice" &&
          (checked === "indeterminate" ? (
            <LegacySharedKoi5a19Icon className="icon-2xs flex-shrink-0" />
          ) : (
            <LegacySharedT7A513Icon className="icon-xxs flex-shrink-0" />
          ))}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
