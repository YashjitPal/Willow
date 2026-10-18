/**
 * Gemini's "Get app": the button and the page it opens at `/app/download` (`app-download-page`),
 * measured in tools/ui-research/captures/gemini/download/ and read out of Gemini's bundle.
 * Gemini offers its own apps; Willow offers Willow's: the desktop app and the Android app, which
 * the dev server hands out at `/download/<platform>` (`appDownloads` in apps/studio/vite.config.ts).
 */

export type DesktopPlatform = 'mac' | 'windows' | 'other';

/** What the page needs to know about the browser: `navigator.userAgent`, and the client hints' platform. */
export interface BrowserAgent {
  userAgent: string;
  hintsPlatform?: string;
}

/** Gemini's own test: the client hints' platform where there is one, else the user agent. */
export const desktopPlatformOf = ({ userAgent, hintsPlatform }: BrowserAgent): DesktopPlatform => {
  if (hintsPlatform) return hintsPlatform === 'macOS' ? 'mac' : hintsPlatform === 'Windows' ? 'windows' : 'other';
  if (/Macintosh/.test(userAgent)) return 'mac';
  if (/Windows/.test(userAgent)) return 'windows';
  return 'other';
};

/** An Android phone, the one phone Willow has an app for. Gemini's phone button also shows on iPhones. */
export const isAndroidPhone = ({ userAgent }: BrowserAgent): boolean => /Android/.test(userAgent) && /Mobile/.test(userAgent);

export const currentAgent = (): BrowserAgent => {
  if (typeof navigator === 'undefined') return { userAgent: '' };
  const hints = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return { userAgent: navigator.userAgent, hintsPlatform: hints?.platform || undefined };
};

/**
 * Where the desktop pill shows: Gemini's `desktop-get-app-button` is Mac and Windows only, and never
 * inside one of the apps it offers. Its layout rule (960px and below) is the stylesheet's.
 */
export const showsDesktopGetApp = (agent: BrowserAgent, inApp: boolean): boolean =>
  !inApp && desktopPlatformOf(agent) !== 'other';

/** Where the phone button shows: an Android phone's browser, not Willow's Android app. */
export const showsPhoneGetApp = (agent: BrowserAgent, inApp: boolean): boolean => !inApp && isAndroidPhone(agent);

/** The page's desktop row, per platform, in Gemini's words with Willow's name. */
export const desktopOffer = (platform: DesktopPlatform): { title: string; cta: string; href: string } => {
  if (platform === 'mac') return { title: 'Willow on your Mac', cta: 'Download for macOS', href: '/download/macos' };
  if (platform === 'windows') return { title: 'Willow on your Windows PC', cta: 'Download for Windows', href: '/download/windows' };
  return { title: 'Willow on your desktop', cta: 'Download for desktop', href: '/download/linux' };
};

/** Gemini draws the desktop row on a Mac or a Windows PC only. */
export const showsDesktopRow = (platform: DesktopPlatform): boolean => platform !== 'other';

export const ANDROID_DOWNLOAD_PATH = '/download/android';

/** The address a phone opens for the Android app: the page's own server, which serves the APK. */
export const androidDownloadUrl = (origin: string): string => new URL(ANDROID_DOWNLOAD_PATH, origin).href;

export const APP_DOWNLOAD_PATH = '/app/download';

export const DOWNLOAD_COPY = {
  desktopText: 'From image creation to getting help with what\u2019s on your desktop, Willow is just a shortcut away.',
  phoneTitle: 'Willow on your phone',
  phoneText: 'Take Willow anywhere you go. Talk with Willow, use your camera for real-time help, create images, and more.',
  phoneCta: 'Download for mobile',
  qrAlt: 'QR code to download Willow mobile app',
  desktopAlt: 'Willow on desktop preview',
  phoneAlt: 'Willow on mobile preview',
} as const;
