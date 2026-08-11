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

import { connect as markConnected, disconnect as markDisconnected } from './connections-store';
import { connectorById, scopeUrls } from './registry';
import { tokenSource, type TokenSource } from './token-source';
import type { ConnectorId } from './types';

export type ConnectOutcome =
  /** Authorized, and recorded as connected. */
  | { ok: true; feedsProfile: boolean }
  /** The user closed the popup, declined, or Google refused. */
  | { ok: false; reason: 'declined' | 'not-configured' | 'unknown-connector' };

export interface ConnectOptions {
  tokens?: TokenSource;
  /**
   * Whether this product's data may describe the user.
   *
   * Defaults to the registry's `providesSignals`, which is the honest default:
   * connecting Calendar for personalization should feed the profile, and
   * connecting Drive to save a file should not. The UI passes an explicit value
   * when the user has said otherwise on the card.
   */
  feedsProfile?: boolean;
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

  const tokens = options.tokens ?? tokenSource();
  const token = await tokens.request(scopes);
  if (!token) return { ok: false, reason: 'declined' };

  const feedsProfile = options.feedsProfile ?? definition.providesSignals;
  markConnected(id, { feedsProfile });
  return { ok: true, feedsProfile };
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
  const tokens = options.tokens ?? tokenSource();
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

  const tokens = options.tokens ?? tokenSource();
  const token = await tokens.request(scopes);
  if (!token) return { ok: false, reason: 'declined' };

  for (const id of known) {
    const feedsProfile = options.feedsProfile ?? Boolean(connectorById(id)?.providesSignals);
    markConnected(id, { feedsProfile });
  }
  return { ok: true, feedsProfile: options.feedsProfile ?? true };
};

/**
 * Disconnect a product and drop its token.
 *
 * The token is invalidated locally, which stops Willow using it, but Google's
 * grant survives — revoking that is a page on the user's own account and not
 * something an app should do silently on their behalf. What this does guarantee
 * is that nothing in this session reads the product again.
 *
 * Bullets already derived from it stay. They are still true, still labelled with
 * their source, and still individually deletable; deleting them here would mean
 * a toggle flipped for an unrelated reason quietly destroying part of a profile.
 */
export const disconnectProduct = (
  id: ConnectorId,
  options: { tokens?: TokenSource } = {},
): void => {
  const tokens = options.tokens ?? tokenSource();
  const scopes = [...scopeUrls([id], 'read'), ...scopeUrls([id], 'write')];
  if (scopes.length > 0) tokens.invalidate(scopes);
  markDisconnected(id);
};
