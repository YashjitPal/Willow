/**
 * Gmail, headers only.
 *
 * The scope is `gmail.metadata`, which returns headers and labels and *cannot*
 * return a message body — the restriction is enforced by Google, not by this
 * file, so there is no code path here that could be changed to start reading
 * mail. That was the point of choosing it over `gmail.readonly`, which would have
 * given the same signals plus the entire contents of the user's inbox.
 *
 * What headers support is a narrow, genuinely useful set of facts: which services
 * someone uses, who they correspond with regularly, and what is arriving now.
 * Subjects are read but almost never stored verbatim — a subject line is often
 * the most sensitive part of an email, and "Your test results are ready" is
 * exactly the kind of thing this feature must not write into a file.
 */

import { paginate, query } from '../google-fetch';
import type { ConnectorFetch, ConnectorReader, ConnectorSignal } from '../types';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Recent mail only. A profile describes a life now, not an archive. */
const QUERY = 'newer_than:60d -in:spam -in:trash';
const PAGE_SIZE = 100;
const MAX_PAGES = 2;

/** Correspondents seen this many times count as a relationship. */
const CORRESPONDENT_THRESHOLD = 5;
/** Services seen this many times count as something the user actually uses. */
const SERVICE_THRESHOLD = 3;

interface MessageRef { id?: string }

interface MessageMetadata {
  id?: string;
  labelIds?: string[];
  payload?: { headers?: { name?: string; value?: string }[] };
}

const headerValue = (message: MessageMetadata, name: string): string => {
  const match = message.payload?.headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  );
  return (match?.value ?? '').trim();
};

/** `Jane Doe <jane@example.com>` → `{ name: 'Jane Doe', domain: 'example.com' }` */
export const parseAddress = (raw: string): { name: string; email: string; domain: string } => {
  const angle = raw.match(/^(.*?)<([^>]+)>\s*$/);
  const name = (angle?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  const email = (angle?.[2] ?? raw).trim().toLowerCase();
  const domain = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : '';
  return { name, email, domain };
};

/**
 * Domains that say nothing about a person.
 *
 * Mail providers, because everyone has one. Willow's own domain, because the app
 * emailing the user is not a relationship.
 */
const IGNORED_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'google.com', 'outlook.com', 'hotmail.com',
  'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
]);

/** Local parts that mark a sender as a machine rather than a person. */
const AUTOMATED = /^(no-?reply|do-?not-?reply|notifications?|alerts?|support|info|hello|team|updates?|news|billing|receipts?|security|mailer|postmaster|bounce)/i;

const isAutomated = (email: string): boolean => AUTOMATED.test(email.split('@')[0] ?? '');

/**
 * A service name from a domain: `mail.notion.so` → `Notion`.
 *
 * The registrable-name guess is deliberately crude. It is only used to name a
 * product the user already receives mail from, and a wrong guess produces a
 * slightly odd bullet the user can delete — not a wrong fact about them.
 */
export const serviceNameFromDomain = (domain: string): string | null => {
  const parts = domain.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const generic = new Set(['com', 'co', 'org', 'net', 'io', 'app', 'so', 'ai', 'dev', 'uk', 'in', 'us']);
  const core = [...parts].reverse().find((part) => !generic.has(part) && part.length > 2);
  if (!core) return null;
  return core.charAt(0).toUpperCase() + core.slice(1);
};

export const readGmailSignals = async (
  fetchJson: ConnectorFetch,
  signal?: AbortSignal,
): Promise<ConnectorSignal[]> => {
  const refs = await paginate<MessageRef>(async (pageToken) => {
    const url = `${GMAIL_API}/messages${query({ q: QUERY, maxResults: PAGE_SIZE, pageToken })}`;
    const page = await fetchJson<{ messages?: MessageRef[]; nextPageToken?: string }>(url, { signal });
    if (!page) return null;
    return { items: page.messages ?? [], nextPageToken: page.nextPageToken };
  }, MAX_PAGES);

  const ids = refs.map((ref) => ref.id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  // One request per message is how the Gmail API works — there is no batch
  // metadata endpoint. Sequential rather than parallel: this is a background job
  // and a hundred simultaneous requests is how an app gets rate-limited.
  const messages: MessageMetadata[] = [];
  // `metadataHeaders` repeats rather than taking a list, so it is built here
  // instead of through `query()`, which is a flat key/value helper.
  const headerParams = ['From', 'Subject', 'List-Unsubscribe', 'Date']
    .map((header) => `metadataHeaders=${header}`)
    .join('&');
  for (const id of ids) {
    if (signal?.aborted) break;
    const url = `${GMAIL_API}/messages/${id}?format=metadata&${headerParams}`;
    const message = await fetchJson<MessageMetadata>(url, { signal });
    if (message) messages.push(message);
  }

  const people = new Map<string, { name: string; count: number }>();
  const services = new Map<string, number>();

  for (const message of messages) {
    const from = headerValue(message, 'From');
    if (!from) continue;
    const { name, email, domain } = parseAddress(from);
    if (!domain) continue;

    // Bulk mail names a service; a person's address names a person.
    const bulk = Boolean(headerValue(message, 'List-Unsubscribe')) || isAutomated(email);
    if (bulk) {
      const service = serviceNameFromDomain(domain);
      if (service) services.set(service, (services.get(service) ?? 0) + 1);
      continue;
    }
    if (IGNORED_DOMAINS.has(domain) && !name) continue;

    const existing = people.get(email);
    people.set(email, { name: name || existing?.name || '', count: (existing?.count ?? 0) + 1 });
  }

  const signals: ConnectorSignal[] = [];

  for (const [service, count] of [...services.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    if (count < SERVICE_THRESHOLD) continue;
    signals.push({
      section: 'demographics',
      text: `Uses ${service}`,
      source: 'Gmail',
      evidence: `Received ${count} emails from ${service} in the last 60 days.`,
    });
  }

  const named = [...people.entries()]
    .filter(([, entry]) => entry.count >= CORRESPONDENT_THRESHOLD && entry.name)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 4);

  for (const [, entry] of named) {
    signals.push({
      section: 'relationships',
      // The name, never the address. An email address in a stored profile is
      // contact data the user did not ask to have written down.
      text: `Corresponds regularly with ${entry.name}`,
      source: 'Gmail',
      evidence: `Exchanged ${entry.count} emails with ${entry.name} in the last 60 days.`,
    });
  }

  return signals;
};

export const gmailConnector: ConnectorReader = {
  id: 'gmail',
  readSignals: readGmailSignals,
};
