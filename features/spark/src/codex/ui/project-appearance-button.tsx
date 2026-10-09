import type { MouseEvent, ReactNode } from "react";
import { useIntl } from "react-intl";
import { FolderLight16Icon, FolderLight20Icon, FolderLight32Icon } from "../icons";
import { Button, type ButtonColor } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { normalizeProjectIcon, projectColorName, projectColorTheme, resolveProjectColor } from "./project-appearance";
import { SymbolPicker } from "./symbol-picker";
import { SymbolTile } from "./symbol-tile";
import { useIsDarkTheme } from "./use-is-dark-theme";

const buttonSizes = {
  input: "icon",
  settings: "inputIcon",
  header: "entityHeader",
  large: "iconLarge",
  card: "iconCircle",
} as const;

export type ProjectAppearanceButtonVariant = keyof typeof buttonSizes;

function stopPropagation(event: MouseEvent) {
  event.stopPropagation();
}

export interface ProjectAppearanceButtonProps {
  canEditProject: boolean;
  defaultIcon?: ReactNode;
  /** Stored icon id (`emoji` in the API). */
  emoji: string | null;
  isSaving: boolean;
  onEmojiChange: (emoji: string | null) => void;
  onOpenChange?: (open: boolean) => void;
  onThemeChange: (theme: string | null) => void;
  projectName: string;
  theme: string | null;
  triggerIcon?: ReactNode;
  variant?: ProjectAppearanceButtonVariant;
}

/** `t` of `chatgpt-project-appearance-button-d47263f183f0.js` (`HComponent`): icon button opening an icon and color picker. */
export function ProjectAppearanceButton({
  canEditProject,
  defaultIcon,
  emoji,
  isSaving,
  onEmojiChange,
  onOpenChange,
  onThemeChange,
  projectName,
  theme,
  triggerIcon,
  variant = "input",
}: ProjectAppearanceButtonProps) {
  const intl = useIntl();
  const scheme = useIsDarkTheme() ? "dark" : "light";
  const color = projectColorName(theme);
  const modal = variant === "settings" || variant === "header" || variant === "card";
  const tinted = variant === "large" || variant === "card";
  const resolvedColor = resolveProjectColor(theme, scheme);
  let iconClassName = variant === "large" ? "size-8" : undefined;
  if (modal) iconClassName = "size-5";
  let buttonColor: ButtonColor = "ghostActive";
  if (tinted) buttonColor = resolvedColor == null ? "secondary" : "tinted";
  let fallbackIcon = <FolderLight16Icon />;
  if (variant === "large") fallbackIcon = <FolderLight32Icon />;
  else if (modal) fallbackIcon = <FolderLight20Icon />;
  const changeTheme = (next: string | null) => {
    onThemeChange(next);
    if ((variant === "settings" || variant === "header") && !emoji) onEmojiChange("folder");
  };
  return (
    <Popover modal={modal} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          className={variant === "input" ? "!h-full !w-10 !rounded-none !border-0 !p-0 focus-visible:ring-2 focus-visible:ring-ring" : undefined}
          aria-label={intl.formatMessage(
            {
              id: "chatgptConversations.sidebar.projectSettings.changeAppearance",
              defaultMessage: "Change icon and color for {projectName}",
              description: "Accessible label for changing a ChatGPT project's icon and color",
            },
            { projectName },
          )}
          color={buttonColor}
          disabled={!canEditProject || (variant !== "large" && isSaving)}
          size={buttonSizes[variant]}
          style={tinted && resolvedColor != null ? { color: resolvedColor } : undefined}
          onClick={stopPropagation}
        >
          {triggerIcon ?? (
            <SymbolTile className={iconClassName} color={theme} defaultIcon={defaultIcon} size={variant === "input" ? 16 : undefined} fallbackIcon={fallbackIcon} icon={emoji} />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-50 outline-hidden"
        align={modal ? "start" : "center"}
        alignOffset={modal ? -8 : undefined}
        sideOffset={modal ? 0 : 6}
        unstyled
        onClick={stopPropagation}
      >
        <SymbolPicker
          capabilities={{
            icons: {
              selectedIcon: normalizeProjectIcon(emoji),
              color: color ?? undefined,
              onColorChange: (next) => changeTheme(projectColorTheme(next)),
            },
          }}
          disabled={!canEditProject || isSaving}
          onSelect={(selection) => {
            if (selection.kind === "icon") onEmojiChange(selection.value);
          }}
          onClear={emoji == null ? undefined : () => onEmojiChange(null)}
        />
      </PopoverContent>
    </Popover>
  );
}
