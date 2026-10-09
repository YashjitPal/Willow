import clsx from "clsx";
import { Button, type ButtonProps } from "./button";

export const floatingControlCss = {
  button: "_button_14ans_2",
  dropdown: "_dropdown_14ans_2",
  zoom: "_zoom_14ans_2",
  selected: "_selected_14ans_2",
  primary: "_primary_14ans_2",
  controlSurface: "_controlSurface_14ans_2",
  inputSurface: "_inputSurface_14ans_2",
  capsule: "_capsule_14ans_2",
  control: "_control_14ans_2",
  compound: "_compound_14ans_2",
  compoundControl: "_compoundControl_14ans_2",
  title: "_title_14ans_2",
  group: "_group_14ans_2",
  shareIcon: "_shareIcon_14ans_2",
  divider: "_divider_14ans_2",
  joined: "_joined_14ans_2",
  zoomGroup: "_zoomGroup_14ans_2",
  label: "_label_14ans_2",
  avatarGroup: "_avatarGroup_14ans_2",
} as const;

export type FloatingControlButtonVariant = "default" | "primary" | "selected" | "dropdown" | "zoom" | "label" | "avatarGroup";

export type FloatingControlButtonProps = ButtonProps & { variant?: FloatingControlButtonVariant };

/** Button on a floating control surface (`ex` in the bundles). */
export function FloatingControlButton({ className, variant = "default", uniform, ...rest }: FloatingControlButtonProps) {
  const classes = clsx(
    "ws-floating-control",
    `ws-floating-control--${variant}`,
    floatingControlCss.button,
    floatingControlCss.controlSurface,
    variant === "primary" && floatingControlCss.primary,
    variant === "selected" && floatingControlCss.selected,
    (variant === "dropdown" || variant === "zoom") && floatingControlCss.dropdown,
    variant === "zoom" && floatingControlCss.zoom,
    variant === "label" && floatingControlCss.label,
    variant === "avatarGroup" && floatingControlCss.avatarGroup,
    variant !== "primary" && "disabled:text-disabled disabled:opacity-100 aria-disabled:text-disabled aria-disabled:opacity-100",
    className,
  );
  return <Button className={classes} unstyled uniform={uniform} {...(rest as ButtonProps)} />;
}
