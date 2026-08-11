/**
 * Which connectors the user has turned on.
 *
 * Same nanostore-plus-localStorage arrangement as the profile store, minus the
 * disk half. This one deliberately stays in browser storage: it is a list of
 * products the user connected in *this browser*, and the tokens behind it live
 * in memory and die with the tab. Writing it into their folder would sync a
 * claim of "Gmail is connected" to a machine where no token exists and no
 * connection was ever made.
 *
 * Connection state is intentionally not the same thing as authorization. A
 * connector is *enabled* here because the user asked for it; whether a usable
 * token exists is a question for `TokenSource`, answered fresh each time. Storing
 * "authorized" would be storing a fact with a one-hour shelf life.
 */

import { atom } from 'nanostores';

import type { ConnectorId } from './types';

const STORAGE_KEY = 'willow:personal-connections';

export interface ConnectionsState {
  /** Connectors the user has enabled, in the order they enabled them. */
  enabled: ConnectorId[];
  /**
   * Connectors whose read data may feed the profile.
   *
   * A separate list from `enabled` because connecting a product and letting it
   * describe you are different decisions. Someone can connect Calendar so Willow
   * can create events without agreeing that their meeting titles become bullets
   * in a stored profile.
   */
  signalSources: ConnectorId[];
}

const VALID: ReadonlySet<string> = new Set<ConnectorId>([
  'calendar', 'gmail', 'youtube', 'contacts', 'tasks', 'drive', 'docs',
]);

const EMPTY: ConnectionsState = { enabled: [], signalSources: [] };

const asIds = (value: unknown): ConnectorId[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((entry): entry is ConnectorId => typeof entry === 'string' && VALID.has(entry))))
    : [];

const readStored = (): ConnectionsState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<ConnectionsState>;
    return {
      enabled: asIds(parsed?.enabled),
      signalSources: asIds(parsed?.signalSources),
    };
  } catch {
    return EMPTY;
  }
};

export const connectionsStore = atom<ConnectionsState>(readStored());

const commit = (next: ConnectionsState): void => {
  connectionsStore.set(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A failed write costs persistence, not correctness.
  }
};

export const isConnected = (id: ConnectorId): boolean =>
  connectionsStore.get().enabled.includes(id);

export const isSignalSource = (id: ConnectorId): boolean => {
  const state = connectionsStore.get();
  return state.enabled.includes(id) && state.signalSources.includes(id);
};

/**
 * Mark a connector connected.
 *
 * `feedsProfile` defaults to true for products whose whole purpose here is
 * personalization, and the caller passes false for the ones the user connected
 * to get work done. The registry decides which is which; this function just
 * records it.
 */
export const connect = (id: ConnectorId, { feedsProfile = true } = {}): void => {
  const state = connectionsStore.get();
  commit({
    enabled: state.enabled.includes(id) ? state.enabled : [...state.enabled, id],
    signalSources: feedsProfile && !state.signalSources.includes(id)
      ? [...state.signalSources, id]
      : state.signalSources,
  });
};

/**
 * Disconnect, and stop it feeding the profile.
 *
 * Bullets already derived from it are left alone. They are still true, still
 * shown with their source, and still individually deletable — silently deleting
 * them would be the app discarding the user's profile as a side effect of a
 * toggle they flipped for an unrelated reason. "Delete all" exists for that.
 */
export const disconnect = (id: ConnectorId): void => {
  const state = connectionsStore.get();
  commit({
    enabled: state.enabled.filter((entry) => entry !== id),
    signalSources: state.signalSources.filter((entry) => entry !== id),
  });
};

/** Toggle whether an already-connected product feeds the profile. */
export const setFeedsProfile = (id: ConnectorId, feeds: boolean): void => {
  const state = connectionsStore.get();
  if (!state.enabled.includes(id)) return;
  commit({
    ...state,
    signalSources: feeds
      ? Array.from(new Set([...state.signalSources, id]))
      : state.signalSources.filter((entry) => entry !== id),
  });
};
