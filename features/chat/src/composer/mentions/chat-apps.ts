import type { ConnectorId } from '@willow/personal';
import { mcpServers } from '@willow/ai/mcp/mcp-store';

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

/** An app as the thinking row and the "@" menu draw it: one of Willow's connectors, or `mcp:<server>`. */
export interface ChatAppMark {
  id: string;
  label: string;
  logo: string;
}

/**
 * An app reached through its vendor's MCP server (Customize → Connectors), by the server id the
 * preset adds it under (`@willow/spark/mcp-catalog`). `aliases` are other names an "@" may use —
 * not plain words, so "on Monday" never reaches monday.com. `plain` are the names that reach it
 * without an "@", where its label alone is not one (X: a letter, "solve for x").
 */
export interface McpChatApp {
  server: string;
  label: string;
  aliases?: readonly string[];
  plain?: readonly string[];
  logo: string;
}

const LAMDA = 'https://www.gstatic.com/lamda/images/tools';
const LH3 = 'https://lh3.googleusercontent.com';

/** X's mark, white on black, as X draws its own; Gemini lists no X to take a logo from. */
export const X_MARK = `data:image/svg+xml,${encodeURIComponent(
  [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">',
    '<circle cx="48" cy="48" r="48" fill="#000"/>',
    '<path fill="#fff" transform="translate(26 25.5) scale(0.0367)" d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z"/>',
    '</svg>',
  ].join(''),
)}`;

export const MCP_CHAT_APPS: readonly McpChatApp[] = [
  { server: 'canva', label: 'Canva', logo: `${LAMDA}/logo_canva_27c834f6923acc1f886fe.svg` },
  { server: 'dropbox', label: 'Dropbox', logo: `${LAMDA}/logo_dropbox_6a65d8dd07a7543af34ce.svg` },
  { server: 'wispr-flow', label: 'Wispr Flow', aliases: ['Wispr'], logo: `${LH3}/EHqy23HkAnhFJOgVb4qjww2Dk-N7COry46aIsqH6mF3WyTaxZ6BixgZbI7VDDAi9Nppd` },
  { server: 'bigin', label: 'Bigin', aliases: ['Zoho Bigin'], logo: `${LH3}/r2xFxVgF-O0U-l-9eLrUZ4Y_fHD0KMttpmHPxAhqrvUEuE_vd80lrtrzeQRTGM-XNO-H` },
  { server: 'fever', label: 'Fever', logo: `${LAMDA}/logo_fever_2dda28d8d96d128169489.jpg` },
  { server: 'granola', label: 'Granola', logo: `${LAMDA}/logo_granola_0704dc7792e0e2b66fe22.svg` },
  { server: 'monday', label: 'monday.com', aliases: ['monday'], logo: `${LAMDA}/logo_monday_3de539ba285fffda4ed77.svg` },
  { server: 'webflow', label: 'Webflow', logo: `${LH3}/_Nth-QrilI8VaPzyR-loCQblAhBb3ZDjXnCgO0LyB3B0tYeJFxGj9ppId4cKZ27HH9s` },
  { server: 'wix', label: 'Wix', logo: `${LAMDA}/logo_wix_707cd7537d41175b605c8.png` },
  { server: 'zoho-crm', label: 'Zoho CRM', logo: `${LH3}/8u17NbWVKAuYuoTSUK6OjmBQofqPrczzl9LouojBy5Sd23YM7Jv1dfZpRZBqqVe1fsBr` },
  { server: 'zoho-desk', label: 'Zoho Desk', logo: `${LH3}/KLovIX9qF-fUngT8AY8c6Vw4QhKfwkzGNK_W9bjOeIIPuBatMMagh576YHw8pyXDM3c` },
  { server: 'zoho-mail', label: 'Zoho Mail', logo: `${LH3}/i42HK0zjrMWfNXrzIQ1xTJc56i0XukRWY7QHHRWfNl0PtB4oL_p5eJBMXiRmRLiPPjc` },
  { server: 'zoho-projects', label: 'Zoho Projects', logo: `${LH3}/n5Oas9Z57oEnIrFRpuy02GVsZK1sR4lUtkHseoKb7Ug7T3jxwGRoYGM0lyN1nO_G4Rd7` },
  { server: 'x', label: 'X', aliases: ['Twitter'], plain: ['Twitter', 'x.com'], logo: X_MARK },
  // Willow's own program for X: it answers to X's names too, for whoever connected this one instead.
  { server: 'x-reader', label: 'X Reader', aliases: ['X', 'Twitter'], plain: ['X Reader', 'Twitter', 'x.com'], logo: X_MARK },
];

/** Any other server the user added (Spark → Connected apps): a plain app mark. */
export const MCP_APP_MARK = `data:image/svg+xml,${encodeURIComponent(
  [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#8e918f">',
    '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/>',
    '<rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="4"/>',
    '</svg>',
  ].join(''),
)}`;

const MCP_APP_PREFIX = 'mcp:';

/** The id a turn records for an MCP server's app while its tool runs. */
export const mcpAppId = (server: string): `mcp:${string}` => `mcp:${server}`;

export const mcpChatApp = (server: string): McpChatApp | null => MCP_CHAT_APPS.find((app) => app.server === server) ?? null;

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

export const chatApp = (id: string | null | undefined): ChatAppMark | null => {
  if (id?.startsWith(MCP_APP_PREFIX)) {
    const server = id.slice(MCP_APP_PREFIX.length);
    const known = mcpChatApp(server);
    const label = known?.label ?? mcpServers.get().find((entry) => entry.id === server)?.label ?? server;
    return { id, label, logo: known?.logo ?? MCP_APP_MARK };
  }
  return CHAT_APPS.find((app) => app.id === id) ?? null;
};
