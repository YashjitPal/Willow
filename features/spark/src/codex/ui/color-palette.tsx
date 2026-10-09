import clsx from "clsx";
import { defineMessages, useIntl, type IntlShape } from "react-intl";
import { Button } from "./button";
import { projectColorClasses, type ProjectColor } from "./project-appearance";

const colorLabels = defineMessages({
  black: {
    id: "codex.projectAppearance.color.option.black",
    defaultMessage: "Default",
    description: "Color option name in the project marker popover.",
  },
  blue: {
    id: "codex.projectAppearance.color.option.blue",
    defaultMessage: "Blue",
    description: "Color option name in the project marker popover.",
  },
  green: {
    id: "codex.projectAppearance.color.option.green",
    defaultMessage: "Green",
    description: "Color option name in the project marker popover.",
  },
  orange: {
    id: "codex.projectAppearance.color.option.orange",
    defaultMessage: "Orange",
    description: "Color option name in the project marker popover.",
  },
  pink: {
    id: "codex.projectAppearance.color.option.pink",
    defaultMessage: "Pink",
    description: "Color option name in the project marker popover.",
  },
  purple: {
    id: "codex.projectAppearance.color.option.purple",
    defaultMessage: "Purple",
    description: "Color option name in the project marker popover.",
  },
  red: {
    id: "codex.projectAppearance.color.option.red",
    defaultMessage: "Red",
    description: "Color option name in the project marker popover.",
  },
  yellow: {
    id: "codex.projectAppearance.color.option.yellow",
    defaultMessage: "Yellow",
    description: "Color option name in the project marker popover.",
  },
});

/** `d`: the display name of a color. */
export function projectColorLabel(intl: IntlShape, color: ProjectColor) {
  return intl.formatMessage(colorLabels[color]);
}

/** `f`: swatch order. */
const paletteColors: ProjectColor[] = ["black", "red", "orange", "yellow", "green", "blue", "purple", "pink"];

export interface ColorPaletteProps {
  color?: ProjectColor;
  /** Paints the default swatch instead of the icon color. */
  defaultSwatchColor?: string | null;
  disabled?: boolean;
  groupAriaLabel?: string;
  onColorChange: (color: ProjectColor) => void;
}

/** `t` of `color-palette-6c089705fd0a.js` (`MComponent`): a row of color swatch toggles. */
export function ColorPalette({ color, defaultSwatchColor, disabled = false, groupAriaLabel, onColorChange }: ColorPaletteProps) {
  const intl = useIntl();
  return (
    <div
      className="flex items-center justify-between gap-1 select-none"
      role="group"
      aria-label={
        groupAriaLabel ??
        intl.formatMessage({
          id: "symbolPicker.icons.colors",
          defaultMessage: "Icon colors",
          description: "Accessible label for the icon picker color presets",
        })
      }
    >
      {paletteColors.map((swatch) => {
        const customDefault = swatch === "black" && defaultSwatchColor != null;
        return (
          <Button
            key={swatch}
            color={color === swatch ? "secondary" : "ghost"}
            size="iconCircle"
            radius="full"
            disabled={disabled}
            aria-label={intl.formatMessage(
              {
                id: "codex.projectAppearance.color.option.aria_label",
                defaultMessage: "Use {colorName}",
                description: "Accessible label for a project marker color swatch. Placeholder {colorName} is a color name such as Blue or Green.",
              },
              { colorName: projectColorLabel(intl, swatch) },
            )}
            aria-pressed={color === swatch}
            onClick={() => onColorChange(swatch)}
          >
            <span
              className={clsx("size-6 rounded-full", customDefault ? undefined : projectColorClasses[swatch].swatchClassName)}
              style={customDefault ? { backgroundColor: defaultSwatchColor } : undefined}
              aria-hidden
            />
          </Button>
        );
      })}
    </div>
  );
}
