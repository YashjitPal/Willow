/**
 * OAuth client ids the user supplies, for builds that ship without them.
 *
 * Google's and Spotify's flows need a client id, which the deployed web app takes from
 * its environment. A desktop build reads no environment files, so out of the box it has
 * none, and every Google and Spotify card would sit disabled with a banner about a
 * variable the user cannot set. Willow already runs on the user's own model keys; this
 * lets it run on their own OAuth clients too, created in Google Cloud and Spotify's
 * dashboard for exactly this app.
 *
 * A client id is public by design — it appears in every consent URL — so it is kept in
 * localStorage, unlike the tokens it is used to obtain. The environment, when it has one,
 * wins: a deployment's own client is the one its consent screen was set up for.
 */

import { atom } from 'nanostores';

export type ClientIdProvider = 'google' | 'spotify';

const STORAGE_KEY = 'willow:connectors:client-ids';

const read = (): Partial<Record<ClientIdProvider, string>> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const userClientIds = atom<Partial<Record<ClientIdProvider, string>>>(read());

/** The client id the user supplied for a provider, if any. */
export const userClientId = (provider: ClientIdProvider): string | undefined => userClientIds.get()[provider]?.trim() || undefined;

/**
 * Plausible ids only: a Google client id ends in `.apps.googleusercontent.com`; a Spotify
 * one is 32 hexadecimal characters. Catching a pasted secret or a project number here is
 * kinder than a consent screen that fails with `invalid_client`.
 */
export const clientIdProblem = (provider: ClientIdProvider, value: string): string | null => {
  const id = value.trim();
  if (!id) return 'Paste the client id.';
  if (provider === 'google' && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) {
    return 'A Google client id ends in .apps.googleusercontent.com.';
  }
  if (provider === 'spotify' && !/^[0-9a-f]{32}$/i.test(id)) return 'A Spotify client id is 32 letters and digits.';
  return null;
};

/** Saves or (with `null`) forgets the client id for a provider. */
export const setUserClientId = (provider: ClientIdProvider, value: string | null): void => {
  const next = { ...userClientIds.get() };
  if (value?.trim()) next[provider] = value.trim();
  else delete next[provider];
  userClientIds.set(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode: it works for this session.
  }
};
