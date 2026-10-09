import type { ConnectorId } from '@willow/personal';

/**
 * The apps a chat turn can reach, as Gemini draws them: in the composer's "@" menu, and on the
 * thinking row's "Connecting to <app>" line while one of their tools runs. The logos are the
 * ones Gemini's own "@" menu and status line load (captured Oct 2026); Spotify, which Gemini
 * does not list, keeps the mark Willow's Connected apps card draws. Gemini's order for the apps
 * it shares with Willow.
 */
export interface ChatApp {
  id: ConnectorId;
  label: string;
  logo: string;
}

const SPOTIFY_MARK = `data:image/svg+xml,${encodeURIComponent(
  [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">',
    '<circle cx="48" cy="48" r="48" fill="#1ED760"/>',
    '<g fill="none" stroke="#000" stroke-linecap="round">',
    '<path d="M25 35c15-4 33-3 46 4" stroke-width="9"/>',
    '<path d="M29 50c12-3 27-2 38 4" stroke-width="7.5"/>',
    '<path d="M32 63c10-2 21-1 29 3" stroke-width="6"/>',
    '</g></svg>',
  ].join(''),
)}`;

const PRODUCT = 'https://www.gstatic.com/images/branding/productlogos';

export const CHAT_APPS: readonly ChatApp[] = [
  { id: 'calendar', label: 'Google Calendar', logo: `${PRODUCT}/calendar_2026/v2/web-96dp/logo_calendar_2026_color_2x_web_96dp.png` },
  { id: 'tasks', label: 'Google Tasks', logo: `${PRODUCT}/tasks_2026/v2/web-96dp/logo_tasks_2026_color_2x_web_96dp.png` },
  { id: 'docs', label: 'Google Docs', logo: `${PRODUCT}/docs_2026/v2/web-96dp/logo_docs_2026_color_2x_web_96dp.png` },
  { id: 'drive', label: 'Google Drive', logo: `${PRODUCT}/drive_2026/v2/web-96dp/logo_drive_2026_color_2x_web_96dp.png` },
  { id: 'youtube', label: 'YouTube', logo: `${PRODUCT}/youtube/v9/192px.svg` },
  { id: 'gmail', label: 'Gmail', logo: `${PRODUCT}/gmail_2026/v2/web-96dp/logo_gmail_2026_color_2x_web_96dp.png` },
  { id: 'spotify', label: 'Spotify', logo: SPOTIFY_MARK },
  { id: 'github', label: 'GitHub', logo: 'https://www.gstatic.com/lamda/images/tools/logo_github_dark_018b0501d5dc2dd3e532c.svg' },
];

export const chatApp = (id: string | null | undefined): ChatApp | null => CHAT_APPS.find((app) => app.id === id) ?? null;
