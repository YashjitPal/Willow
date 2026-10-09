// The gallery's View menu settings. Flow keeps these per account, across projects and visits;
// Willow keeps them in this browser, and in `settings.json` too (`media.view`, ./media-settings.ts).

export type ViewSettings = {
  viewMode: 'grid' | 'batch';
  gridSize: 'S' | 'M' | 'L';
  soundOnHover: boolean;
  silentVideos: boolean;
  tileDetails: boolean;
  clearPromptOnSubmit: boolean;
};

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  viewMode: 'grid',
  gridSize: 'M',
  soundOnHover: false,
  silentVideos: false,
  tileDetails: true,
  clearPromptOnSubmit: true,
};

const VIEW_SETTINGS_KEY = 'willow-media-view-settings';
export const VIEW_SETTINGS_CHANGED_EVENT = 'willow:media-view-settings-changed';

const storage = (): Storage | null => (typeof localStorage !== 'undefined' ? localStorage : null);

/** Settings from storage or from the file, which is the user's to edit; null for anything that isn't settings. */
export function narrowViewSettings(raw: unknown): ViewSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<Record<keyof ViewSettings, unknown>>;
  const flag = (key: 'soundOnHover' | 'silentVideos' | 'tileDetails' | 'clearPromptOnSubmit') =>
    (typeof value[key] === 'boolean' ? value[key] as boolean : DEFAULT_VIEW_SETTINGS[key]);
  return {
    viewMode: value.viewMode === 'batch' ? 'batch' : 'grid',
    gridSize: value.gridSize === 'S' || value.gridSize === 'L' ? value.gridSize : 'M',
    soundOnHover: flag('soundOnHover'),
    silentVideos: flag('silentVideos'),
    tileDetails: flag('tileDetails'),
    clearPromptOnSubmit: flag('clearPromptOnSubmit'),
  };
}

/** What this browser saved, or null when it never saved any. */
export function readSavedViewSettings(): ViewSettings | null {
  try {
    return narrowViewSettings(JSON.parse(storage()?.getItem(VIEW_SETTINGS_KEY) || 'null'));
  } catch {
    return null;
  }
}

export function loadViewSettings(): ViewSettings {
  return readSavedViewSettings() ?? DEFAULT_VIEW_SETTINGS;
}

export function saveViewSettings(settings: ViewSettings): void {
  try {
    const text = JSON.stringify(settings);
    const store = storage();
    if (!store || store.getItem(VIEW_SETTINGS_KEY) === text) return;
    store.setItem(VIEW_SETTINGS_KEY, text);
  } catch {
    // Private mode or a full quota: the settings still apply for this visit.
    return;
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VIEW_SETTINGS_CHANGED_EVENT));
}

/** Calls `listener` whenever the saved settings may have changed, here or in another tab. */
export function onViewSettingsChange(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === VIEW_SETTINGS_KEY) listener();
  };
  window.addEventListener(VIEW_SETTINGS_CHANGED_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(VIEW_SETTINGS_CHANGED_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
