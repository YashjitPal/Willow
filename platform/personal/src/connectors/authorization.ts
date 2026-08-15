/**
 * Whether a connected product can actually be read *right now*.
 *
 * `connections-store` answers a different question: which products the user
 * clicked connect on. That answer is persistent and survives a reload. The token
 * behind it does not — Google issues no refresh token to a browser client, so the
 * access token lives about an hour and dies with the tab. The two facts were being
 * treated as one, and the gap between them is what the user saw:
 *
 *   "My YouTube connection has expired, so I can't check what you've been liking."
 *
 * That message is the *model* reporting a failure it should never have been set up
 * to hit. The tool was declared because YouTube was in `enabled`, the prompt block
 * named it, the model called it, and only then did anything discover there was no
 * token. Three of those four steps were wasted, and the fourth was a bad reply.
 *
 * So this store holds the second fact separately, and the tool surface is built
 * from the intersection. No token means no declaration, no prompt block, and no
 * mention of the product — the model is never told about a door it cannot open, so
 * it cannot walk into it and report back.
 *
 * Deliberately NOT persisted. It describes tokens that live in memory, so a stored
 * copy would claim authorization on the next load that no token backs — which is
 * precisely the bug this exists to end, moved one layer down.
 */

import { atom } from 'nanostores';

import { isConnected, connectionsStore } from './connections-store';
import { providerOf, readScopesFor, tokensFor } from './registry';
import { type TokenSource } from './token-source';
import type { ConnectorId, ConnectorProvider } from './types';

/**
 * - `authorized` — a token was held the last time anything looked.
 * - `expired` — a request came back 401/403, or a silent refresh found nothing.
 * - `unknown` — nothing has looked yet. The state every connector is in at load.
 *
 * `unknown` and `expired` gate identically today. They are separate because they
 * say different things to the user: one is "reconnect this", the other is "still
 * checking", and a card that accuses the user of an expired connection while the
 * refresh is still in flight is wrong about a quarter of the time.
 */
export type AuthorizationState = 'authorized' | 'expired' | 'unknown';

export const authorizationStore = atom<Partial<Record<ConnectorId, AuthorizationState>>>({});

export const authorizationOf = (id: ConnectorId): AuthorizationState =>
  authorizationStore.get()[id] ?? 'unknown';

const set = (id: ConnectorId, state: AuthorizationState): void => {
  const current = authorizationStore.get();
  if (current[id] === state) return;
  authorizationStore.set({ ...current, [id]: state });
};

export const markAuthorized = (id: ConnectorId): void => set(id, 'authorized');

/**
 * Record that this product's access is gone.
 *
 * Called from the fetch layer's `onAuthLost` and from every gate that finds no
 * token. Cheap and idempotent, so callers do not need to know whether it was
 * already marked — which matters because the honest place to call it is every
 * place that discovers the fact, not one designated place that owns it.
 */
export const markExpired = (id: ConnectorId): void => set(id, 'expired');

export const forgetAuthorization = (id: ConnectorId): void => {
  const current = authorizationStore.get();
  if (!(id in current)) return;
  const next = { ...current };
  delete next[id];
  authorizationStore.set(next);
};

/**
 * The products whose tools may be declared: connected *and* holding a token.
 *
 * This is the function the tool surface is built from. Everything else about a
 * connector — its scopes, its readers, its actions — is downstream of a yes here.
 */
export const usableConnectors = (): ConnectorId[] =>
  connectionsStore.get().enabled.filter((id) => authorizationOf(id) === 'authorized');

/** Connected, but with nothing behind it. What the UI offers a Reconnect button for. */
export const expiredConnectors = (): ConnectorId[] =>
  connectionsStore.get().enabled.filter((id) => authorizationOf(id) === 'expired');

/**
 * Group connectors into sets whose scopes may be asked for together.
 *
 * Two separate reasons a batch has to split, and they compose:
 *
 * 1. **Different providers.** A Spotify token and a Google token come from
 *    different sources, so they can never share a request.
 * 2. **YouTube.** Google refuses to issue YouTube's scopes alongside another
 *    API's — the request dies on `invalid_request` naming two scopes the app never
 *    meant to pair. Which pairs conflict is Google's business and undocumented, so
 *    this splits on the one known offender rather than inventing a general rule.
 */
const batchesFor = (ids: ConnectorId[]): ConnectorId[][] => {
  const byProvider = new Map<ConnectorProvider, ConnectorId[]>();
  for (const id of ids) {
    const provider = providerOf(id);
    const batch = byProvider.get(provider) ?? [];
    batch.push(id);
    byProvider.set(provider, batch);
  }

  const batches: ConnectorId[][] = [];
  for (const [, group] of byProvider) {
    const youtube = group.filter((id) => id === 'youtube');
    const rest = group.filter((id) => id !== 'youtube');
    if (youtube.length > 0) batches.push(youtube);
    if (rest.length > 0) batches.push(rest);
  }
  return batches;
};

/**
 * Ask, silently, which connected products still have live access.
 *
 * Run on load and after a tab has been asleep. `tokens.get` never prompts: it
 * checks the cache and then tries a hidden-iframe refresh of a grant the user has
 * already given, which succeeds whenever the grant is intact and a Google session
 * exists. That covers the ordinary reload, and covers it without a popup — the
 * user reconnected once, and being asked again on every refresh is the thing that
 * made this feel broken.
 *
 * Batched rather than one request per product: five connectors would otherwise mean
 * five hidden iframes and five round trips at load, and one token covering the union
 * of scopes satisfies every connector's later lookup from cache.
 *
 * Single-flighted, because two providers install their token sources independently
 * at boot and each one wants to know what survived. Without this, whichever
 * installed second would run a second set of silent refreshes over the same
 * connectors — the answer would be identical and the iframes would not be.
 */
let inFlight: Promise<void> | null = null;

export const refreshAuthorizations = async (tokens?: TokenSource): Promise<void> => {
  if (inFlight) return inFlight;
  inFlight = runRefresh(tokens).finally(() => {
    inFlight = null;
  });
  return inFlight;
};

const runRefresh = async (tokens?: TokenSource): Promise<void> => {
  const enabled = connectionsStore.get().enabled;
  if (enabled.length === 0) return;

  await Promise.all(
    batchesFor(enabled).map(async (batch) => {
      const scopes = [...new Set(batch.flatMap((id) => readScopesFor(id)))];
      if (scopes.length === 0) {
        for (const id of batch) markExpired(id);
        return;
      }
      // An explicit source overrides every provider, which is what tests want. In
      // the app there is none, and each batch resolves its own provider's source —
      // asking Google for `user-top-read` would produce a consent screen listing a
      // scope Google has never heard of.
      const source = tokens ?? tokensFor(batch[0]);
      const token = await source.get(scopes);
      for (const id of batch) {
        if (token) markAuthorized(id);
        else markExpired(id);
      }
    }),
  );
};

/**
 * The `onAuthLost` every connector fetch should carry.
 *
 * A 401 that survives one retry means the grant is gone, not that the token was
 * stale. Marking it here is what makes the tools disappear for the *next* turn
 * rather than the next reload, so a user whose access lapses mid-conversation stops
 * being offered the product instead of being told about it once per message.
 */
export const authLossHandler = (id: ConnectorId) => (): void => {
  if (isConnected(id)) markExpired(id);
};
