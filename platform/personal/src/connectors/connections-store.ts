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
 * token exists is a question for `authorization.ts`, answered fresh each load.
 * Storing "authorized" would be storing a fact with a one-hour shelf life.
 *
 * There used to be a second list here, `signalSources`, so that connecting a
 * product and letting it describe you were separate switches. It is gone. Two
 * toggles on one card asked the user to hold a distinction the app itself barely
 * maintained — a connected product was already readable by the live tools whatever
 * the second switch said, so the switch governed the stored profile and nothing
 * else while appearing to govern access. One switch per product, and what a
 * product may contribute is the registry's `providesSignals` — a property of the
 * product, not a preference. Drive and Docs still never describe the user.
 */

import { atom } from 'nanostores';

import type { ConnectorId } from './types';

const STORAGE_KEY = 'willow:personal-connections';

export interface ConnectionsState {
  /** Connectors the user has enabled, in the order they enabled them. */
  enabled: ConnectorId[];
}

/*
 * Spelled out rather than derived from the registry, and the reason is import
 * order: `registry.ts` reaches every connector module, several of which reach back
 * here, so importing it from this file is a cycle. The cost of the duplication is
 * one line per new product; the cost of getting it wrong is a connector that
 * connects, works for the rest of the session, and is silently dropped on reload
 * because this list did not recognise its id.
 */
const VALID: ReadonlySet<string> = new Set<ConnectorId>([
  'calendar', 'gmail', 'youtube', 'tasks', 'drive', 'docs', 'spotify', 'github',
]);

const EMPTY: ConnectionsState = { enabled: [] };

const asIds = (value: unknown): ConnectorId[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((entry): entry is ConnectorId => typeof entry === 'string' && VALID.has(entry))))
    : [];

/**
 * Reads the stored shape, including the older two-list one.
 *
 * `signalSources` is ignored rather than migrated. Someone who had connected a
 * product but left it out of that list keeps the product connected, which is the
 * reading that loses nothing: the live tools could already reach it, so treating
 * the narrower list as authoritative would disconnect products that were working.
 */
const readStored = (): ConnectionsState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<ConnectionsState>;
    return { enabled: asIds(parsed?.enabled) };
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

/** Mark a connector connected. */
export const connect = (id: ConnectorId): void => {
  const state = connectionsStore.get();
  if (state.enabled.includes(id)) return;
  commit({ enabled: [...state.enabled, id] });
};

/**
 * Disconnect.
 *
 * Bullets already derived from it are left alone. They are still true, still
 * shown with their source, and still individually deletable — silently deleting
 * them would be the app discarding the user's profile as a side effect of a
 * toggle they flipped for an unrelated reason. "Delete all" exists for that.
 */
export const disconnect = (id: ConnectorId): void => {
  const state = connectionsStore.get();
  commit({ enabled: state.enabled.filter((entry) => entry !== id) });
};
