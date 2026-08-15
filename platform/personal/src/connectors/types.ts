/**
 * What a connector is.
 *
 * A connector is one Google product Willow can read from or act on. Each one
 * owns its scopes, its own idea of what "a signal" means, and nothing else — the
 * token, the fetch, the connection state and the tool surface are all shared, so
 * adding a product is one file in `google/` plus one entry in `registry.ts`.
 *
 * Two shapes of connector, and the difference matters:
 *
 * - **Signal connectors** feed the profile. They return facts about the person,
 *   read on a schedule, folded into bullets, and they are opt-in per product.
 * - **Action connectors** are for tasks — creating a document, adding a task,
 *   making a playlist. They are never read for personalization, even when the
 *   same product could supply signals, because the user connected Docs to write
 *   a document, not to be studied.
 *
 * A connector may be both (YouTube reads likes and writes playlists), and when
 * it is, the two halves have separate scopes and separate consent.
 */

export type ConnectorId =
  | 'calendar'
  | 'gmail'
  | 'youtube'
  | 'tasks'
  | 'drive'
  | 'docs'
  | 'spotify'
  | 'github';

/**
 * Who issues the token — and, in practice, which OAuth flow the connector rides.
 *
 * Not decoration. Google is reachable from a browser through Google Identity
 * Services, which hands back an access token from a popup and refuses to issue a
 * refresh token to a client that cannot keep a secret. Spotify is reachable through
 * authorization code with PKCE, which needs no secret either but *does* return a
 * refresh token, so a Spotify connection survives a reload where a Google one has
 * to be renewed silently on every load. GitHub is reachable by neither, and rides a
 * token the user creates and pastes — the whole of why is in
 * `github/pat-token-source.ts`, and the short version is that its token-exchange
 * endpoint sends no CORS headers, which no amount of client code works around.
 *
 * Three providers, three token sources, one interface between them. Which is the
 * point of naming the provider at all: `TokenSource` already hid whether a token came
 * from a popup or a cache, and this extends that to whose popup it was — or whether
 * there was a popup at all.
 *
 * They also differ in how long a connection lasts, which is worth holding in mind
 * because it is behind most of the surprising behaviour in this package:
 *
 * - **Google** dies with the tab. No refresh token exists to renew it.
 * - **Spotify** survives a reload, silently, from a refresh token on disk.
 * - **GitHub** dies with the tab, because its token is deliberately kept in
 *   `sessionStorage` rather than `localStorage` — a year-long credential for
 *   someone's source code is not a thing to leave at rest in web storage.
 *
 * Providers that are *not* here are absent for a reason worth writing down, since
 * the obvious reading of a short list is that nobody got round to the rest:
 *
 * - **Notion** is GitHub's problem without GitHub's escape hatch: its token endpoint
 *   answered a preflight with a bare 400 and no CORS headers, and it has no
 *   personal-access-token equivalent its API accepts on the same terms.
 * - **Google Photos** is a different kind of no. The `photoslibrary.readonly`
 *   scope was withdrawn on 31 March 2025; what remains is
 *   `photoslibrary.readonly.appcreateddata`, which sees only what the app itself
 *   uploaded. Willow has uploaded nothing, so a Photos connector would read an
 *   empty library and describe the user from it. The Picker API replaced it and is
 *   a per-session file chooser, not a source of standing signals.
 * - **Google Contacts** is the only entry here that was built, worked, and was then
 *   removed — on request, on 15 August 2026 — so what it did is written down rather
 *   than left to the git log. It spent a sensitive scope (`contacts.readonly`) on one
 *   narrow thing: the relationship labels the user had typed themselves, "partner",
 *   "manager", "mum", capped at six. No names, addresses or numbers, because an
 *   address book is mostly other people's personal data and not the user's. Building
 *   it again means that scope, a reader, a `list_contact_relationships` read tool and
 *   a card in `connectedAppsData.ts` — four files, none of them large.
 */
export type ConnectorProvider = 'google' | 'spotify' | 'github';

export interface ConnectorScope {
  /** The literal OAuth scope URL sent to Google. */
  url: string;
  /**
   * What it lets Willow do, in the user's language. Shown on the connect card,
   * because "https://www.googleapis.com/auth/gmail.metadata" tells nobody
   * anything and this is the moment they decide whether to allow it.
   */
  summary: string;
  /**
   * Whether Google classifies it as restricted or sensitive. Restricted scopes
   * need verification and a security assessment before a published app may use
   * them, so a build without that will see Google's unverified-app screen. It is
   * recorded here so the UI can say so rather than letting the user hit it cold.
   */
  tier: 'basic' | 'sensitive' | 'restricted';
}

export interface ConnectorDefinition {
  id: ConnectorId;
  /**
   * Who issues this connector's tokens. Defaults to Google when absent, which
   * keeps the seven original entries reading exactly as they did.
   */
  provider?: ConnectorProvider;
  /** Product name as its owner writes it. */
  label: string;
  /** One line under the name on the card. */
  description: string;
  /** Read scopes, requested when the connector is enabled. */
  readScopes: ConnectorScope[];
  /** Write scopes, requested only when an action tool needs them. */
  writeScopes: ConnectorScope[];
  /** Whether this connector contributes to the profile at all. */
  providesSignals: boolean;
  /**
   * Shown on the card when the product cannot do the obvious thing. YouTube
   * watch history and Google Search history have no API at all, and a card that
   * implies otherwise produces a bug report every time.
   */
  caveat?: string;
}

/** A single fact pulled from a connector, before it becomes a profile bullet. */
export interface ConnectorSignal {
  /** Which section of the profile this belongs under. */
  section: 'demographics' | 'interests' | 'relationships' | 'events';
  text: string;
  /** Product name, shown as `Source:` in the profile. */
  source: string;
  evidence: string;
  date?: string;
}

/** What every connector module exports. */
export interface ConnectorReader {
  id: ConnectorId;
  /**
   * Read the product and return signals. Never throws — a connector that fails
   * is a connector that contributed nothing this run, and one broken product
   * must not fail a whole build.
   */
  readSignals: (fetchJson: ConnectorFetch, signal?: AbortSignal) => Promise<ConnectorSignal[]>;
}

/**
 * The authorized fetch handed to connectors.
 *
 * Connectors never see the token. They get a function that attaches it, retries
 * once on a 401 with a refreshed one, and returns `null` on any failure — so a
 * connector reads like a list of endpoints rather than a pile of error handling,
 * and swapping the browser token flow for a server-side one later changes this
 * one function rather than seven.
 */
export type ConnectorFetch = <T = any>(
  url: string,
  init?: RequestInit & { signal?: AbortSignal },
) => Promise<T | null>;
