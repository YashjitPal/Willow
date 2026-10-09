/**
 * What the user let Willow do beyond a product's basic access, chosen in Settings → Connected Apps and kept on this
 * device, as the client ids are.
 *
 * Gmail's basic access is headers only (`gmail.metadata`). Turning on email contents swaps it for `gmail.readonly`
 * rather than adding it: Google applies the metadata scope's limits to any token that carries it, so a token with
 * both still cannot search or read a message. Tokens hold only the scopes they were asked for, which is what lets
 * the swap work for a user who granted metadata before.
 */
import { atom } from 'nanostores';

export interface ConnectorOptions {
  /** Read what emails say, and search mail with Gmail's own search. */
  gmailContents?: boolean;
}

const STORAGE_KEY = 'willow:connectors:options';

const read = (): ConnectorOptions => {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}') as ConnectorOptions | null;
    return parsed?.gmailContents === true ? { gmailContents: true } : {};
  } catch {
    return {};
  }
};

export const connectorOptions = atom<ConnectorOptions>(read());

export const gmailContentsAllowed = (): boolean => connectorOptions.get().gmailContents === true;

export const setGmailContentsAllowed = (allowed: boolean): void => {
  const next: ConnectorOptions = allowed ? { ...connectorOptions.get(), gmailContents: true } : { ...connectorOptions.get(), gmailContents: undefined };
  connectorOptions.set(next);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private or embedded contexts; the choice lasts for the session.
  }
};
