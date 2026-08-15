/**
 * Connecting and disconnecting a product — the only place a popup may open.
 *
 * Everything else in this package calls `tokens.get`, which never prompts. This
 * file calls `tokens.request`, which can, and it exists as its own file so that
 * rule is checkable by looking at the imports rather than by reading every
 * function body. If `request` appears anywhere outside here, that is a bug.
 *
 * The whole flow is therefore required to run from a click. Browsers block popups
 * that are not traceable to a user gesture, so a connect started from an effect
 * or a timer does not merely misbehave — it silently fails, which looks to the
 * user like a button that does nothing.
 *
 * What the user actually sees, given they are already signed into Willow with a
 * Google account: one screen listing the permissions, and an Allow button. No
 * account chooser, because the signed-in email is passed as the login hint, and
 * no second sign-in, because they are already signed in. If they have granted
 * these scopes before, they see nothing at all.
 */

import { markAuthorized, markExpired, forgetAuthorization } from './authorization';
import {
  connect as markConnected,
  connectionsStore,
  disconnect as markDisconnected,
} from './connections-store';
import { connectorById, promptsForConsent, providerOf, scopeUrls, tokensFor } from './registry';
import { type TokenSource } from './token-source';
import type { ConnectorId } from './types';

/** Whether any *other* still-connected product draws on the same provider's grant. */
const otherConnectorSharesProvider = (id: ConnectorId): boolean => {
  const provider = providerOf(id);
  return connectionsStore
    .get()
    .enabled.some((other) => other !== id && providerOf(other) === provider);
};

export type ConnectOutcome =
  /** Authorized, and recorded as connected. */
  | { ok: true }
  /**
   * Nothing was granted. Which of the three depends on how the provider grants:
   *
   * - `declined` — a consent screen was closed, declined, or blocked.
   * - `needs-token` — the provider has no consent screen and no token is stored, so
   *   there was nothing to grant. GitHub only, and the fix is to paste one.
   * - `not-configured` / `unknown-connector` — the build, not the user.
   */
  | { ok: false; reason: 'declined' | 'needs-token' | 'not-configured' | 'unknown-connector' };

/** What an empty `request` means for this provider. See `promptsForConsent`. */
const refusalReason = (id: ConnectorId): 'declined' | 'needs-token' =>
  promptsForConsent(id) ? 'declined' : 'needs-token';

export interface ConnectOptions {
  tokens?: TokenSource;
}

/**
 * Ask for a product's read scopes and record it as connected.
 *
 * Read scopes only. Write access is requested separately, when a tool first
 * needs it, so connecting Calendar to see your week does not also hand over the
 * ability to change it before you have asked for anything of the kind.
 *
 * Nothing is recorded unless the token actually arrives. A card that flips to
 * "Connected" after the user closed the consent window is the worst outcome
 * available: the profile then quietly never updates and the UI insists it should.
 */
export const connectProduct = async (
  id: ConnectorId,
  options: ConnectOptions = {},
): Promise<ConnectOutcome> => {
  const definition = connectorById(id);
  if (!definition) return { ok: false, reason: 'unknown-connector' };

  const scopes = scopeUrls([id], 'read');
  if (scopes.length === 0) return { ok: false, reason: 'unknown-connector' };

  const tokens = options.tokens ?? tokensFor(id);
  const token = await tokens.request(scopes);
  if (!token) {
    // Declining leaves an already-connected product marked expired rather than
    // untouched: the user was asked to reconnect and did not, so the tools should
    // stay withdrawn instead of waiting for the next failed read to withdraw them.
    markExpired(id);
    return { ok: false, reason: refusalReason(id) };
  }

  markConnected(id);
  markAuthorized(id);
  return { ok: true };
};

/**
 * Request the write scopes for a product, from a click.
 *
 * Separate from `connectProduct` because it answers a different question at a
 * different time. The UI calls this from the "Allow Willow to create events"
 * control on a connected card; a tool call must never reach it, which is why
 * `tools/actions.ts` uses `get` and fails with a sentence instead.
 */
export const authorizeWrites = async (
  id: ConnectorId,
  options: { tokens?: TokenSource } = {},
): Promise<boolean> => {
  const scopes = scopeUrls([id], 'write');
  if (scopes.length === 0) return false;
  const tokens = options.tokens ?? tokensFor(id);
  return Boolean(await tokens.request(scopes));
};

/**
 * Connect several products in one consent screen.
 *
 * One combined request rather than a loop over `connectProduct`, because a loop
 * would open one popup per product and browsers block every popup after the
 * first — the user would authorize Calendar and watch the rest fail for no
 * visible reason.
 *
 * All or nothing: Google grants the whole scope set or none of it, so a partial
 * result is not a case that needs handling.
 */
export const connectProducts = async (
  ids: ConnectorId[],
  options: ConnectOptions = {},
): Promise<ConnectOutcome> => {
  const known = ids.filter((id) => connectorById(id));
  if (known.length === 0) return { ok: false, reason: 'unknown-connector' };

  const scopes = scopeUrls(known, 'read');
  if (scopes.length === 0) return { ok: false, reason: 'unknown-connector' };

  /*
   * One provider per call.
   *
   * Every card in the UI maps to connectors from a single provider — the Workspace
   * card is five Google products, the Spotify card is one Spotify product — so this
   * is a guard against a future caller, not a case that happens today. It matters
   * because the failure would be quiet and strange: the first provider's source
   * would be handed the second provider's scope strings and the consent screen
   * would list scopes that host has never heard of.
   */
  const providers = new Set(known.map((id) => providerOf(id)));
  if (providers.size > 1) return { ok: false, reason: 'unknown-connector' };

  const tokens = options.tokens ?? tokensFor(known[0]);
  const token = await tokens.request(scopes);
  if (!token) {
    for (const id of known) markExpired(id);
    return { ok: false, reason: refusalReason(known[0]) };
  }

  for (const id of known) {
    markConnected(id);
    markAuthorized(id);
  }
  return { ok: true };
};

/**
 * Disconnect a product and drop its token.
 *
 * The token is invalidated locally, which stops Willow using it, but the
 * provider's grant survives — revoking that is a page on the user's own account and
 * not something an app should do silently on their behalf. What this does guarantee
 * is that nothing in this session reads the product again.
 *
 * `forget()` is the part that matters for a provider holding a durable grant. Google
 * has none, so invalidating the scopes is the end of it; Spotify keeps a refresh
 * token on disk, and leaving that in place would mean a switch the user turned off
 * with a live credential still sitting behind it.
 *
 * Bullets already derived from it stay. They are still true, still labelled with
 * their source, and still individually deletable; deleting them here would mean
 * a toggle flipped for an unrelated reason quietly destroying part of a profile.
 */
export const disconnectProduct = (
  id: ConnectorId,
  options: { tokens?: TokenSource } = {},
): void => {
  const tokens = options.tokens ?? tokensFor(id);
  const scopes = [...scopeUrls([id], 'read'), ...scopeUrls([id], 'write')];
  if (scopes.length > 0) tokens.invalidate(scopes);
  // Only when no other connector shares this provider's grant. Disconnecting Gmail
  // must not drop the credential Calendar is still using; Spotify is one connector,
  // so there is never anything left to share.
  if (!otherConnectorSharesProvider(id)) tokens.forget?.();
  markDisconnected(id);
  // Cleared rather than marked expired: "expired" is a prompt to reconnect, and a
  // product the user just switched off should not be asking them to switch it on.
  forgetAuthorization(id);
};
