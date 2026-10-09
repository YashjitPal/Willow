import { useStore } from '@nanostores/react';
import { $resolvedTheme, type ResolvedTheme } from '@willow/core/theme-mode';

export type ThemeVariant = ResolvedTheme;

/** Willow's resolved light or dark theme, which the Codex bot artwork follows. */
export function useThemeVariant(): ThemeVariant {
  return useStore($resolvedTheme);
}
