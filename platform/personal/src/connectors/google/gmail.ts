/**
 * Gmail: headers by default, contents when the user allows them.
 *
 * The default scope is `gmail.metadata`, which returns headers and labels and *cannot*
 * return a message body — the restriction is enforced by Google, not by this
 * file. It cannot search either (`q` is a 403 under it), so with it Willow lists the
 * newest mail and filters headers itself (`parseMailSearch`). Email contents
 * (`gmail.readonly`) are a separate choice the user makes in Settings
 * (`connector-options.ts`); with them, Gmail searches and `readMailMessage` reads.
 * Sending is `gmail.send`, a write scope, one approved message at a time.
 *
 * What headers support is a narrow, genuinely useful set of facts: which services
 * someone uses, who they correspond with regularly, and what is arriving now.
 * Subjects are read but almost never stored verbatim — a subject line is often
 * the most sensitive part of an email, and "Your test results are ready" is
 * exactly the kind of thing this feature must not write into a file.
 */

import { paginate, query } from '../authorized-fetch';
import { gmailContentsAllowed } from '../connector-options';
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
    const url = `${GMAIL_API}/messages${query({ ...(canSearch() ? { q: QUERY } : {}), maxResults: PAGE_SIZE, pageToken })}`;
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

// ---------------------------------------------------------------------------
// Live reads — recent headers, for a question asked right now.
// ---------------------------------------------------------------------------

/**
 * How many messages a live read will fetch.
 *
 * Low, and not for quota reasons. The Gmail API has no batch metadata endpoint,
 * so this is one HTTP round trip per message with the user watching a cursor
 * blink. Fifteen headers answer "what came in today"; a hundred would answer the
 * same question a minute later.
 */
const LIVE_DEFAULT = 15;
const LIVE_MAX = 30;
/** How far back a filtered read without search looks for matches: one request per message read. */
const LIVE_SCAN = 40;
/** The standing filter's window, applied by hand where Gmail cannot search. */
const RECENT_MS = 60 * 86_400_000;

/** Gmail's search, and reading what messages say, need email contents; metadata access gets neither. */
export const canSearch = (): boolean => gmailContentsAllowed();
export const canReadContents = (): boolean => gmailContentsAllowed();

export interface MailHeader {
  /** Gmail's id for the message, which `read_email` takes. */
  id: string;
  /** Display name if the sender set one, else the local part of their address. */
  from: string;
  /** The sending domain — enough to recognise a service or an institution. */
  domain: string;
  subject: string;
  /** The `Date` header, verbatim, because it is what Gmail returned. */
  date: string;
  unread: boolean;
}

/**
 * Recent message headers, or `null` if the read failed.
 *
 * Headers only, whatever the access: what a message says is `readMailMessage`'s,
 * and only with email contents. Without them a search is applied by hand to the
 * newest mail (`parseMailSearch`) — senders, recipients and subjects, not bodies.
 *
 * Addresses are reduced to a name and a domain. The full address is contact data,
 * and the sentence that needs it ("did the college email me") is answered by the
 * domain alone. That is the same rule the stored profile follows, kept here even
 * though nothing is written to disk, because the model's reply is saved with the
 * chat and sent to a provider either way.
 */
export const listRecentMail = async (
  fetchJson: ConnectorFetch,
  options: { search?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<MailHeader[] | null> => {
  const limit = Math.min(Math.max(options.limit ?? LIVE_DEFAULT, 1), LIVE_MAX);
  const search = (options.search ?? '').trim();
  const searching = canSearch();
  // Without search, Willow filters headers itself, so it reads more of them to find the ones asked for.
  const filter = search && !searching ? parseMailSearch(search) : null;
  const ids = await listMailIds(fetchJson, { search, limit: filter ? LIVE_SCAN : limit, signal: options.signal });
  if (!ids) return null;
  if (ids.length === 0) return [];

  const headers: MailHeader[] = [];
  let failures = 0;
  for (const id of ids) {
    if (options.signal?.aborted || headers.length >= limit) break;
    const read = await readMail(fetchJson, id, { signal: options.signal });
    if (!read) {
      failures += 1;
      continue;
    }
    if (Date.now() - read.facts.at > RECENT_MS) break;
    if (filter && !mailMatches(read.facts, filter)) continue;
    headers.push(read.header);
  }

  // The list worked and every header request failed — a broken connection, not an empty inbox.
  if (headers.length === 0 && failures > 0 && failures === Math.min(ids.length, limit)) return null;
  return headers;
};

// ---------------------------------------------------------------------------
// Watching — what is new since the last look, for a trigger that runs by itself.
// ---------------------------------------------------------------------------

/**
 * Ids of the newest messages, newest first, or `null` if the list failed. One request: a watcher compares ids with
 * the ones it has seen and reads only the new ones.
 *
 * With email contents allowed, Gmail's own search narrows the list (`search` on top of the standing filter, so no
 * call reaches spam or trash). Metadata access cannot search, so the list is the newest mail, spam and trash left
 * out by Gmail's default, and the caller filters headers with `parseMailSearch`.
 */
export const listMailIds = async (
  fetchJson: ConnectorFetch,
  options: { search?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<string[] | null> => {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const search = (options.search ?? '').trim();
  const params = canSearch() ? { q: search ? `${QUERY} ${search}` : QUERY, maxResults: limit } : { maxResults: limit };
  const found = await fetchJson<{ messages?: MessageRef[] }>(`${GMAIL_API}/messages${query(params)}`, { signal: options.signal });
  if (!found) return null;
  return (found.messages ?? []).map((ref) => ref.id).filter((id): id is string => Boolean(id));
};

/** What filtering needs to know about a message, beyond what `MailHeader` shows. */
export interface MailFacts {
  /** The `From` header as sent, lower-cased: the name and the address. */
  from: string;
  to: string;
  subject: string;
  unread: boolean;
  inbox: boolean;
  /** When Gmail received it. */
  at: number;
}

export interface MailMessage extends MailHeader {
  /** The sender's address — only with email contents, which the user allowed to include it. */
  address: string;
  to: string;
  cc: string;
  threadId: string;
  /** The `Message-ID` header, for threading a reply. */
  messageId: string;
  references: string;
  body: string;
  attachments: string[];
}

interface MessagePart {
  mimeType?: string;
  filename?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string; size?: number };
  parts?: MessagePart[];
}

interface FullMessage extends MessageMetadata {
  threadId?: string;
  internalDate?: string;
  payload?: MessagePart;
}

const LIST_HEADERS = ['From', 'To', 'Subject', 'Date'].map((header) => `metadataHeaders=${header}`).join('&');

const toHeader = (id: string, message: MessageMetadata): MailHeader | null => {
  const { name, email, domain } = parseAddress(headerValue(message, 'From'));
  if (!email) return null;
  return {
    id,
    from: name || (email.split('@')[0] ?? email),
    domain,
    subject: headerValue(message, 'Subject') || '(no subject)',
    date: headerValue(message, 'Date'),
    unread: Boolean(message.labelIds?.includes('UNREAD')),
  };
};

const toFacts = (message: FullMessage): MailFacts => ({
  from: headerValue(message, 'From').toLowerCase(),
  to: headerValue(message, 'To').toLowerCase(),
  subject: headerValue(message, 'Subject').toLowerCase(),
  unread: Boolean(message.labelIds?.includes('UNREAD')),
  inbox: Boolean(message.labelIds?.includes('INBOX')),
  at: Number(message.internalDate) || Date.parse(headerValue(message, 'Date')) || Date.now(),
});

/** One message's header, and the facts a filter checks, or `null`. Metadata is enough, so any access can. */
export const readMail = async (
  fetchJson: ConnectorFetch,
  id: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ header: MailHeader; facts: MailFacts } | null> => {
  const message = await fetchJson<FullMessage>(`${GMAIL_API}/messages/${id}?format=metadata&${LIST_HEADERS}`, { signal: options.signal });
  if (!message) return null;
  const header = toHeader(id, message);
  return header ? { header, facts: toFacts(message) } : null;
};

const decodeBase64Url = (data: string): string => {
  try {
    const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return '';
  }
};

/** Readable text from HTML mail: no tags, scripts or styles, entities that matter decoded, whitespace folded. */
export const textFromHtml = (html: string): string =>
  html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

/** The message's own words: its plain-text part when it has one, else its HTML as text; attachments by name. */
export const messageText = (payload: MessagePart | undefined): { body: string; attachments: string[] } => {
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: string[] = [];
  const walk = (part: MessagePart | undefined) => {
    if (!part) return;
    if (part.filename) attachments.push(part.filename);
    else if (part.mimeType === 'text/plain' && part.body?.data) plain.push(decodeBase64Url(part.body.data));
    else if (part.mimeType === 'text/html' && part.body?.data) html.push(decodeBase64Url(part.body.data));
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  const body = plain.length ? plain.join('\n\n') : textFromHtml(html.join('\n'));
  return { body: body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), attachments };
};

/**
 * A whole message, or `null` — email contents only: metadata access gets a 403 from Google, which comes back here as
 * `null`. Callers check `canReadContents` first so they can say why.
 */
export const readMailMessage = async (
  fetchJson: ConnectorFetch,
  id: string,
  options: { signal?: AbortSignal } = {},
): Promise<MailMessage | null> => {
  const message = await fetchJson<FullMessage>(`${GMAIL_API}/messages/${encodeURIComponent(id)}?format=full`, { signal: options.signal });
  if (!message?.payload) return null;
  const view = { ...message, payload: { headers: message.payload.headers } };
  const header = toHeader(id, view);
  if (!header) return null;
  const { body, attachments } = messageText(message.payload);
  return {
    ...header,
    address: parseAddress(headerValue(view, 'From')).email,
    to: headerValue(view, 'To'),
    cc: headerValue(view, 'Cc'),
    threadId: message.threadId ?? '',
    messageId: headerValue(view, 'Message-ID') || headerValue(view, 'Message-Id'),
    references: headerValue(view, 'References'),
    body,
    attachments,
  };
};

/** What a reply needs to land in the same conversation. Headers only, so any access can read it. */
export interface ReplyContext {
  threadId: string;
  messageId: string;
  references: string;
  subject: string;
  /** The `Reply-To` or `From` header, where a reply goes. */
  replyTo: string;
}

export const readReplyContext = async (fetchJson: ConnectorFetch, id: string, signal?: AbortSignal): Promise<ReplyContext | null> => {
  const headers = ['Message-ID', 'References', 'Subject', 'From', 'Reply-To'].map((header) => `metadataHeaders=${header}`).join('&');
  const message = await fetchJson<FullMessage>(`${GMAIL_API}/messages/${encodeURIComponent(id)}?format=metadata&${headers}`, { signal });
  if (!message?.threadId) return null;
  return {
    threadId: message.threadId,
    messageId: headerValue(message, 'Message-ID'),
    references: headerValue(message, 'References'),
    subject: headerValue(message, 'Subject'),
    replyTo: headerValue(message, 'Reply-To') || headerValue(message, 'From'),
  };
};

// ---------------------------------------------------------------------------
// Filtering headers — Gmail's search terms, applied by Willow where it cannot search.
// ---------------------------------------------------------------------------

/** Gmail search terms Willow can apply to headers itself. */
export interface MailFilter {
  from: string[];
  to: string[];
  subject: string[];
  /** Plain words and phrases, looked for in the sender and the subject. */
  words: string[];
  unread: boolean;
  inbox: boolean;
  /** Only mail received within this many milliseconds. */
  within?: number;
  /** `OR` between terms: any one of them is enough. */
  any: boolean;
  /** Terms it could not apply, so its results are wider than the search by these. */
  skipped: string[];
}

const SEARCH_TERM = /(-?)(?:([a-z_]+):)?(?:"([^"]*)"|(\S+))/gi;
const UNIT_MS: Record<string, number> = { h: 3_600_000, d: 86_400_000, m: 2_592_000_000, y: 31_536_000_000 };

export const parseMailSearch = (search: string): MailFilter => {
  const filter: MailFilter = { from: [], to: [], subject: [], words: [], unread: false, inbox: false, any: false, skipped: [] };
  for (const match of search.matchAll(SEARCH_TERM)) {
    const [term, negated, operator, quoted, bare] = match;
    const value = (quoted ?? bare ?? '').toLowerCase().replace(/^[({]+|[)}]+$/g, '');
    if (!value) continue;
    if (!operator && (value === 'or' || bare === '|')) {
      filter.any = true;
      continue;
    }
    if (negated) {
      filter.skipped.push(term);
      continue;
    }
    switch (operator?.toLowerCase()) {
      case undefined:
        if (value !== 'and') filter.words.push(value);
        break;
      case 'from':
      case 'to':
      case 'subject':
        filter[operator.toLowerCase() as 'from' | 'to' | 'subject'].push(value);
        break;
      case 'is':
        if (value === 'unread') filter.unread = true;
        else filter.skipped.push(term);
        break;
      case 'in':
        if (value === 'inbox') filter.inbox = true;
        else if (value !== 'anywhere') filter.skipped.push(term);
        break;
      case 'newer_than': {
        const amount = /^(\d+)([hdmy])$/.exec(value);
        if (amount) filter.within = Math.min(filter.within ?? Infinity, Number(amount[1]) * UNIT_MS[amount[2]!]!);
        else filter.skipped.push(term);
        break;
      }
      default:
        filter.skipped.push(term);
    }
  }
  return filter;
};

export const mailMatches = (mail: MailFacts, filter: MailFilter, now = Date.now()): boolean => {
  if (filter.within !== undefined && now - mail.at > filter.within) return false;
  if (filter.unread && !mail.unread) return false;
  if (filter.inbox && !mail.inbox) return false;
  const checks = [
    ...filter.from.map((value) => mail.from.includes(value)),
    ...filter.to.map((value) => mail.to.includes(value)),
    ...filter.subject.map((value) => mail.subject.includes(value)),
    ...filter.words.map((value) => mail.from.includes(value) || mail.subject.includes(value)),
  ];
  if (checks.length === 0) return true;
  return filter.any ? checks.some(Boolean) : checks.every(Boolean);
};

// ---------------------------------------------------------------------------
// Sending — one message the user approved, through `gmail.send`.
// ---------------------------------------------------------------------------

export interface OutgoingMail {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  /** Replying: the thread, and the message answered, so the reply lands in the same conversation. */
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

const encodeHeaderWord = (value: string): string =>
  // eslint-disable-next-line no-control-regex
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(value)))}?=`;

const base64Lines = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return (btoa(binary).match(/.{1,76}/g) ?? []).join('\r\n');
};

/** The message as RFC 2822 text: UTF-8 throughout, the body base64 so no line or character is mangled. */
export const composeMail = (mail: OutgoingMail): string => {
  const lines = [
    `To: ${mail.to.join(', ')}`,
    ...(mail.cc?.length ? [`Cc: ${mail.cc.join(', ')}`] : []),
    `Subject: ${encodeHeaderWord(mail.subject)}`,
    ...(mail.inReplyTo ? [`In-Reply-To: ${mail.inReplyTo}`, `References: ${[mail.references, mail.inReplyTo].filter(Boolean).join(' ')}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(mail.body),
  ];
  return lines.join('\r\n');
};

const base64Url = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Sends one message; its Gmail id, or `null` when Gmail refused it. */
export const sendMail = async (fetchJson: ConnectorFetch, mail: OutgoingMail, signal?: AbortSignal): Promise<string | null> => {
  const sent = await fetchJson<{ id?: string }>(`${GMAIL_API}/messages/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: base64Url(composeMail(mail)), ...(mail.threadId ? { threadId: mail.threadId } : {}) }),
    signal,
  });
  return sent?.id ?? null;
};
