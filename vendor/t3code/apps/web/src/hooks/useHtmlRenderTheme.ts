import { HTML_RENDER_DEFAULT_FONTS, htmlRenderTheme } from "@t3tools/shared/htmlRender";
import { useMemo, useSyncExternalStore } from "react";

import { appearanceFontStack } from "../appearanceFonts";
import { isWillowEmbedded } from "../willow/harness";
import {
  getStandardThemeColors,
  getThemeColorsForMode,
  getThemeDefinition,
  resolveThemeHalf,
  subscribeToCustomThemes,
  type ThemeAppearance,
  type ThemeHalves,
  type ThemePreference,
} from "../themePalette";
import { useClientSettings } from "./useSettings";
import { useTheme } from "./useTheme";

/** The palette `applyTheme` paints for a preference, or the stock look when no theme applies. */
function resolveActiveThemeColors(
  theme: ThemePreference,
  halves: ThemeHalves | null,
  appearance: ThemeAppearance,
) {
  const definition = getThemeDefinition(resolveThemeHalf(theme, halves, appearance));
  return definition === null
    ? getStandardThemeColors(appearance)
    : (getThemeColorsForMode(definition, appearance) ?? definition.colors);
}

/**
 * Willow paints the thread in its own colours rather than T3's palette, so a render takes the
 * page's: past a picture narrower than the frame it would otherwise show T3's darker canvas.
 */
function willowColors(colors: ReturnType<typeof getStandardThemeColors>) {
  if (!isWillowEmbedded() || typeof document === "undefined") return colors;
  const style = getComputedStyle(document.documentElement);
  const canvas = style.getPropertyValue("--background").trim();
  const codeBackground = style.getPropertyValue("--code-background").trim();
  return {
    ...colors,
    ...(canvas ? { canvas } : {}),
    ...(codeBackground ? { codeBackground } : {}),
  };
}

/** The app's active theme and fonts, as handed to agent HTML renders. Stable until one changes. */
export function useHtmlRenderTheme() {
  const { theme, resolvedTheme, themeHalves } = useTheme();
  // Custom and published palettes can be edited in place, under an unchanged preference.
  const colors = useSyncExternalStore(
    subscribeToCustomThemes,
    () => resolveActiveThemeColors(theme, themeHalves, resolvedTheme),
    () => getStandardThemeColors(resolvedTheme),
  );
  const sans = useClientSettings((settings) => settings.fontFamilySans);
  const mono = useClientSettings((settings) => settings.fontFamilyCode);
  return useMemo(
    () =>
      htmlRenderTheme(willowColors(colors), resolvedTheme, {
        sans: appearanceFontStack(sans, HTML_RENDER_DEFAULT_FONTS.sans),
        mono: appearanceFontStack(mono, HTML_RENDER_DEFAULT_FONTS.mono),
      }),
    [colors, resolvedTheme, sans, mono],
  );
}
