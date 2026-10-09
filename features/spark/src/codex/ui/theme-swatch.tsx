import clsx from "clsx";
import { FormattedMessage } from "react-intl";

export interface ThemeSwatchColors {
  accent: string;
  ink: string;
  surface: string;
}

export interface ThemeSwatchProps {
  size?: "default" | "trigger";
  theme: ThemeSwatchColors;
}

/** `$C` (app-initial): round "Aa" preview of a theme's surface, ink and accent. */
export function ThemeSwatch({ size = "default", theme }: ThemeSwatchProps) {
  return (
    <span
      aria-hidden
      className={clsx("flex shrink-0 items-center justify-center rounded-full border text-xs leading-none font-semibold", size === "trigger" ? "h-5 w-5" : "h-6 w-6")}
      style={{ backgroundColor: theme.surface, borderColor: `color-mix(in srgb, ${theme.ink} 16%, ${theme.surface})`, color: theme.accent }}
    >
      <FormattedMessage id="settings.general.appearance.codeTheme.previewGlyph" defaultMessage="Aa" description="Preview glyph shown in the code theme selector" />
    </span>
  );
}
