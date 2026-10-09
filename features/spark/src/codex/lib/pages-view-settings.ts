import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Codex's Pages view settings (Settings > Appearance > Pages in Codex), with
 * Codex's defaults. Willow keeps them per browser.
 */
export interface PagesViewSettings {
  fontSize: number;
  fullWidth: boolean;
  smartPunctuationEnabled: boolean;
}

export const PAGES_FONT_SIZE_BOUNDS = { min: 12, max: 24 } as const;

interface PagesViewSettingsStore extends PagesViewSettings {
  setPagesViewSetting: <K extends keyof PagesViewSettings>(key: K, value: PagesViewSettings[K]) => void;
}

export const usePagesViewSettingsStore = create<PagesViewSettingsStore>()(
  persist(
    (set) => ({
      fontSize: 14,
      fullWidth: false,
      smartPunctuationEnabled: true,
      setPagesViewSetting: (key, value) => set({ [key]: value } as Partial<PagesViewSettings>),
    }),
    { name: 'willow:spaces:pages-view' },
  ),
);

export function usePagesViewSettings(): PagesViewSettings {
  const fontSize = usePagesViewSettingsStore((state) => state.fontSize);
  const fullWidth = usePagesViewSettingsStore((state) => state.fullWidth);
  const smartPunctuationEnabled = usePagesViewSettingsStore((state) => state.smartPunctuationEnabled);
  return useMemo(() => ({ fontSize, fullWidth, smartPunctuationEnabled }), [fontSize, fullWidth, smartPunctuationEnabled]);
}
