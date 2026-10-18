/**
 * What the connect popup says, per card — Gemini's `tool-consent-dialog`, the dialog
 * gemini.google.com/apps raises when an app's switch is turned on.
 *
 * Gemini draws it in three shapes, and each Willow card takes the one Gemini uses for its
 * counterpart (captures and bundle extracts in
 * `tools/ui-research/captures/gemini/apps-connect/`):
 *
 * - `workspace` is `first-party-tool-consent-dialog` with `toolName: "workspace_tool"`:
 *   six product logos in the banner, a 24px headline, the account pill, two bullets.
 * - `github` is `github-consent-dialog`: the account pill with its photo, a private
 *   repositories lead-in and Google's policy links.
 * - `generic` is what an app with no dialog of its own gets: the server's consent blocks,
 *   measured on Webflow, laid out as the built-in `consent3pDefaultContent` is. YouTube
 *   and Spotify have no Gemini dialog of their own, so they take this one.
 *
 * Copy is Gemini's with the product renamed, as on the rest of this page. Where Gemini
 * names a page Willow calls something else, Willow's name is used ("Connected Apps page").
 */

export type ConsentVariant = 'workspace' | 'github' | 'generic';

export interface ConsentLogo {
  name: string;
  src: string;
}

/** Gemini's `Zqh` logos, in the order its Workspace banner lists them. */
export const WORKSPACE_CONSENT_LOGOS: ConsentLogo[] = [
  { name: 'Google Calendar', src: 'https://www.gstatic.com/images/branding/productlogos/calendar_2026/v2/web/192px.svg' },
  { name: 'Gmail', src: 'https://www.gstatic.com/images/branding/productlogos/gmail_2026/v2/web/192px.svg' },
  { name: 'Google Drive', src: 'https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web/192px.svg' },
  { name: 'Google Docs', src: 'https://www.gstatic.com/images/branding/productlogos/docs_2026/v2/web/192px.svg' },
  { name: 'Google Keep', src: 'https://www.gstatic.com/images/branding/productlogos/keep_2026/v2/web/192px.svg' },
  { name: 'Google Tasks', src: 'https://www.gstatic.com/images/branding/productlogos/tasks_2026/v2/web/192px.svg' },
];

export const CONSENT_LINKS = {
  workspacePrivacy: 'https://support.google.com/gemini?p=ws_ext_privacy',
  contentUse: 'https://support.google.com/gemini?p=ghi_ca_data',
  googlePrivacy: 'https://policies.google.com/privacy',
  googleTerms: 'https://policies.google.com/terms',
} as const;

/**
 * The two app-specific parts of a generic dialog: what the app's items are, said the way
 * the server's blocks say it for Webflow ("like sites, pages, CMS collections, and
 * assets"), and whose privacy policy the second bullet links.
 */
export interface GenericConsentApp {
  items: string;
  privacyUrl: string;
}

export const GENERIC_CONSENT_APPS: Record<string, GenericConsentApp> = {
  youtube: {
    items: 'your liked videos, subscriptions, and playlists',
    privacyUrl: 'https://policies.google.com/privacy',
  },
  spotify: {
    items: 'your top artists and tracks, saved music, and playlists',
    privacyUrl: 'https://www.spotify.com/legal/privacy-policy/',
  },
  // The apps Customize connects as their vendors' MCP servers (`customize-mcp.ts`).
  canva: { items: 'designs, folders, and brand templates', privacyUrl: 'https://www.canva.com/policies/privacy-policy/' },
  dropbox: { items: 'files, folders, and shared links', privacyUrl: 'https://www.dropbox.com/privacy' },
  webflow: { items: 'sites, pages, CMS collections, and assets', privacyUrl: 'https://webflow.com/legal/privacy' },
  wix: { items: 'sites, stores, bookings, and payments', privacyUrl: 'https://www.wix.com/about/privacy' },
  granola: { items: 'meeting notes, transcripts, and action items', privacyUrl: 'https://www.granola.ai/privacy' },
  fever: { items: 'events, venues, and tickets', privacyUrl: 'https://feverup.com/legal/privacy_en.html' },
  wispr: { items: 'meetings and notes', privacyUrl: 'https://wisprflow.ai/privacy-policy' },
  'monday-com': { items: 'boards, items, and updates', privacyUrl: 'https://monday.com/l/privacy/privacy-policy/' },
  'zoho-crm': { items: 'leads, contacts, and deals', privacyUrl: 'https://www.zoho.com/privacy.html' },
  'zoho-desk': { items: 'tickets, replies, and help center articles', privacyUrl: 'https://www.zoho.com/privacy.html' },
  'zoho-mail': { items: 'emails and folders', privacyUrl: 'https://www.zoho.com/privacy.html' },
  'zoho-projects': { items: 'projects, milestones, and tasks', privacyUrl: 'https://www.zoho.com/privacy.html' },
  bigin: { items: 'pipelines, deals, and contacts', privacyUrl: 'https://www.bigin.com/privacy.html' },
  x: { items: 'posts, accounts, bookmarks, and trends', privacyUrl: 'https://x.com/en/privacy' },
  'x-reader': { items: 'posts, threads, accounts, lists, bookmarks, and trends', privacyUrl: 'https://x.com/en/privacy' },
};

export const consentVariant = (cardId: string): ConsentVariant =>
  cardId === 'workspace' ? 'workspace' : cardId === 'github' ? 'github' : 'generic';

/**
 * Gemini's button labels: first-party apps read "Cancel", GitHub and apps without their
 * own dialog read "No thanks" (the `qTb` copy this account is on), and all say "Connect".
 */
export const consentButtons = (variant: ConsentVariant): { cancel: string; confirm: string } => ({
  cancel: variant === 'workspace' ? 'Cancel' : 'No thanks',
  confirm: 'Connect',
});

export const consentTitle = (variant: ConsentVariant, appName: string): string =>
  variant === 'workspace' ? 'Connect Google Workspace?' : `Connect ${appName}?`;
