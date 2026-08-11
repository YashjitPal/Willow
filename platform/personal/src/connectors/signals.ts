/**
 * Reading connectors into profile bullets.
 *
 * The join between two halves that otherwise know nothing about each other:
 * connectors return `ConnectorSignal`s, the profile merge consumes
 * `CandidateBullet`s, and this file converts one into the other and decides who
 * gets asked at all.
 *
 * Three rules govern that decision, and all three are the user's, not the
 * builder's:
 *
 * 1. The connector is enabled.
 * 2. The user left it feeding the profile.
 * 3. A token for its scopes already exists.
 *
 * Rule three is the one that matters most. A profile build runs by itself in the
 * background, and a background job must never open an OAuth popup — so this asks
 * for a token that is already held and skips the connector when there is none.
 * A connector whose token expired contributes nothing until the user reconnects,
 * which is quiet and correct, rather than a popup appearing mid-sentence.
 */

import { connectionsStore } from './connections-store';
import { createGoogleFetch } from './google-fetch';
import { canProvideSignals, connectorById, scopeUrls } from './registry';
import { tokenSource, type TokenSource } from './token-source';
import type { ConnectorId, ConnectorSignal } from './types';
import type { CandidateBullet } from '../profile/types';

export interface CollectOptions {
  tokens?: TokenSource;
  signal?: AbortSignal;
  /** Overridable so tests do not have to stand up a store. */
  connectors?: ConnectorId[];
  onAuthLost?: (id: ConnectorId) => void;
}

/** Connectors eligible to describe the user right now. */
export const activeSignalConnectors = (): ConnectorId[] => {
  const state = connectionsStore.get();
  return state.enabled.filter(
    (id) => state.signalSources.includes(id) && canProvideSignals(id),
  );
};

/** A signal is already shaped like a candidate; its `section` is the same union
 *  the profile uses, so nothing needs coercing here. */
const toCandidate = (signal: ConnectorSignal): CandidateBullet => ({
  section: signal.section,
  text: signal.text,
  source: signal.source,
  evidence: signal.evidence,
  ...(signal.date ? { date: signal.date } : {}),
});

/**
 * Read one connector. Never throws.
 *
 * A connector that fails is a connector that contributed nothing to this build.
 * Letting it throw would take the whole build with it, and the user would see a
 * profile that silently stopped updating because one product's token expired.
 */
export const readConnector = async (
  id: ConnectorId,
  options: CollectOptions = {},
): Promise<CandidateBullet[]> => {
  const definition = connectorById(id);
  if (!definition || !canProvideSignals(id)) return [];

  const { READERS } = await import('./registry');
  const reader = READERS[id];
  if (!reader) return [];

  const tokens = options.tokens ?? tokenSource();
  const scopes = scopeUrls([id], 'read');
  if (scopes.length === 0) return [];

  // Background builds never prompt: if no token is held, this connector sits
  // this build out.
  const token = await tokens.get(scopes);
  if (!token) return [];

  const fetchJson = createGoogleFetch({
    tokens,
    scopes,
    onAuthLost: () => options.onAuthLost?.(id),
  });

  try {
    const signals = await reader.readSignals(fetchJson, options.signal);
    return signals.map(toCandidate);
  } catch {
    return [];
  }
};

/**
 * Read every eligible connector.
 *
 * Sequential rather than parallel. This is a background job with no deadline, and
 * five products' worth of simultaneous requests is how an app meets Google's rate
 * limiter — a limit that, once hit, makes the *next* build fail too.
 */
export const collectConnectorSignals = async (
  options: CollectOptions = {},
): Promise<CandidateBullet[]> => {
  const ids = options.connectors ?? activeSignalConnectors();
  const candidates: CandidateBullet[] = [];

  for (const id of ids) {
    if (options.signal?.aborted) break;
    candidates.push(...(await readConnector(id, options)));
  }

  return candidates;
};
