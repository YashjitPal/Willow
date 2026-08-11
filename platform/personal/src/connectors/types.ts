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
  | 'contacts'
  | 'tasks'
  | 'drive'
  | 'docs';

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
  /** Product name as Google writes it. */
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
