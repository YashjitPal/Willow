/**
 * Background update checker for Willow.
 *
 * Checks GitHub releases (https://github.com/YashjitPal/Willow/releases/latest)
 * for newer versions of Willow. When a newer release is published, it resolves
 * the appropriate asset download link (Windows setup EXE, Android APK, or the
 * release page) and surfaces it via `updateStore`.
 */

import { atom } from 'nanostores';

export const CURRENT_WILLOW_VERSION = '0.1.0';
export const GITHUB_RELEASES_LATEST_API = 'https://api.github.com/repos/YashjitPal/Willow/releases/latest';
const STORAGE_KEY = 'willow:update-checker';
const CHECK_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface ReleaseInfo {
  tagName: string;
  version: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
  downloadUrl: string;
  windowsAssetUrl?: string;
  androidAssetUrl?: string;
}

export interface UpdateState {
  checking: boolean;
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  downloadUrl: string | null;
  lastChecked: number | null;
  error: string | null;
}

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/** Parses a tag like "v0.1.0" or "0.1.0" into semver components. */
export const parseSemver = (tag: string): ParsedSemver | null => {
  if (!tag) return null;
  const clean = tag.trim().replace(/^v/i, '');
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
};

/**
 * Returns positive if `a > b`, negative if `a < b`, 0 if equal.
 * Stable releases are considered newer than prereleases of the same version.
 */
export const compareSemver = (a: string, b: string): number => {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && !pb.prerelease) return -1;
  return 0;
};

/** Whether `remoteTag` is strictly newer than `currentTag`. */
export const isNewerVersion = (
  remoteTag: string,
  currentTag: string = CURRENT_WILLOW_VERSION,
): boolean => compareSemver(remoteTag, currentTag) > 0;

/** Resolves the best download URL for the current operating system from release assets. */
export const resolveDownloadUrl = (release: {
  html_url?: string;
  assets?: ReleaseAsset[];
}): { downloadUrl: string; windowsAssetUrl?: string; androidAssetUrl?: string } => {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const exe = assets.find((a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe'));
  const apk = assets.find((a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.apk'));

  const windowsAssetUrl = exe?.browser_download_url;
  const androidAssetUrl = apk?.browser_download_url;

  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  let downloadUrl = release.html_url || 'https://github.com/YashjitPal/Willow/releases/latest';

  if (isAndroid && androidAssetUrl) {
    downloadUrl = androidAssetUrl;
  } else if (windowsAssetUrl) {
    downloadUrl = windowsAssetUrl;
  }

  return { downloadUrl, windowsAssetUrl, androidAssetUrl };
};

const readStoredUpdate = (): Partial<UpdateState> => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return {};
    return JSON.parse(raw) as Partial<UpdateState>;
  } catch {
    return {};
  }
};

const writeStoredUpdate = (state: Partial<UpdateState>): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore storage errors
  }
};

const initialStored = readStoredUpdate();

export const updateStore = atom<UpdateState>({
  checking: false,
  available: initialStored.available ?? false,
  currentVersion: CURRENT_WILLOW_VERSION,
  latestVersion: initialStored.latestVersion ?? null,
  releaseName: initialStored.releaseName ?? null,
  releaseNotes: initialStored.releaseNotes ?? null,
  releaseUrl: initialStored.releaseUrl ?? null,
  downloadUrl: initialStored.downloadUrl ?? null,
  lastChecked: initialStored.lastChecked ?? null,
  error: null,
});

/**
 * Checks GitHub for the latest Willow release.
 * Honors a 30-minute cache cooldown unless `force: true` is passed.
 */
export const checkForUpdates = async (options: { force?: boolean } = {}): Promise<UpdateState> => {
  const current = updateStore.get();
  const now = Date.now();

  if (!options.force && current.lastChecked && now - current.lastChecked < CHECK_COOLDOWN_MS) {
    return current;
  }

  updateStore.set({ ...current, checking: true, error: null });

  try {
    const res = await fetch(GITHUB_RELEASES_LATEST_API, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });

    if (!res.ok) {
      throw new Error(`GitHub release check failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    const tagName = data.tag_name || '';
    const cleanVersion = tagName.replace(/^v/i, '');
    const available = isNewerVersion(tagName, CURRENT_WILLOW_VERSION);
    const { downloadUrl, windowsAssetUrl, androidAssetUrl } = resolveDownloadUrl(data);

    const nextState: UpdateState = {
      checking: false,
      available,
      currentVersion: CURRENT_WILLOW_VERSION,
      latestVersion: cleanVersion || null,
      releaseName: data.name || null,
      releaseNotes: data.body || null,
      releaseUrl: data.html_url || null,
      downloadUrl,
      lastChecked: now,
      error: null,
    };

    updateStore.set(nextState);
    writeStoredUpdate({
      available: nextState.available,
      latestVersion: nextState.latestVersion,
      releaseName: nextState.releaseName,
      releaseUrl: nextState.releaseUrl,
      downloadUrl: nextState.downloadUrl,
      lastChecked: nextState.lastChecked,
    });

    return nextState;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const fallback: UpdateState = {
      ...current,
      checking: false,
      error: errorMsg,
      lastChecked: now,
    };
    updateStore.set(fallback);
    return fallback;
  }
};

/**
 * Starts a recurring background update checker.
 * Checks shortly after startup (3 seconds), and repeats every `intervalMs`.
 * Returns a teardown function.
 */
export const startBackgroundUpdateChecker = (
  intervalMs: number = 2 * 60 * 60 * 1000, // 2 hours
): (() => void) => {
  if (typeof window === 'undefined') return () => {};

  const startupTimer = window.setTimeout(() => {
    void checkForUpdates();
  }, 3000);

  const intervalId = window.setInterval(() => {
    void checkForUpdates();
  }, intervalMs);

  return () => {
    window.clearTimeout(startupTimer);
    window.clearInterval(intervalId);
  };
};

/**
 * Test & verification helper: simulates an update being available or cleared.
 */
export const setSimulatedUpdateAvailable = (
  available: boolean,
  version = '0.1.1',
  downloadUrl = 'https://github.com/YashjitPal/Willow/releases',
): void => {
  updateStore.set({
    ...updateStore.get(),
    available,
    latestVersion: available ? version : null,
    releaseName: available ? `Willow ${version}` : null,
    releaseUrl: available ? downloadUrl : null,
    downloadUrl: available ? downloadUrl : null,
  });
};
