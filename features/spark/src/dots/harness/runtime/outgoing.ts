/**
 * What a bot sends where other people read it: email in the user's name, and posts on Discord.
 *
 * The bot writes the message whole and asks (`send_email`, `discord` post). The user sees exactly that message on a
 * card and sends it, sends it and lets the bot write to those people (or in that channel) again without asking, or
 * declines; what is approved is what goes. A `sending` step is written under a lock before the send, so a second
 * window or a reload never sends it twice, and every outcome is an event the bot hears.
 *
 * Mail to people the user already allowed (`runtime.sendTo`), and posts in channels they allowed
 * (`runtime.discordChannels`), go at once. Their card is the record, with the outcome on the card itself: the bot
 * learns it from its own tool call, so no event wakes it to hear it again.
 */
import type { OutgoingMail } from '@willow/personal';
import { appendDotItem, getDotThread, updateDotItem, updateDotRuntime } from '../thread/thread-store';
import type { DotDiscordPost, DotItem, DotOutgoingMail, DotThread } from '../thread/thread-types';
import { withWebLock } from './web-lock';

export interface DotMailDeps {
  send: (mail: OutgoingMail) => Promise<{ id: string } | { problem: string }>;
  /** Discord, when the bot is a Discord bot: posts a message as it was approved. */
  post?: (post: DotDiscordPost) => Promise<{ id: string } | { problem: string }>;
  wake: (dotId: string) => void;
  now: () => number;
}

export type OutgoingState = NonNullable<DotItem['outgoingStep']> | 'pending';

const addressOf = (value: string): string => (value.match(/<([^>]+)>\s*$/)?.[1] ?? value).trim().toLowerCase();

export const recipientsOf = (mail: DotOutgoingMail): string[] => [...new Set([...mail.to, ...(mail.cc ?? [])].map(addressOf))];

export const describeRecipients = (mail: DotOutgoingMail): string => {
  const all = [...mail.to, ...(mail.cc ?? [])];
  return all.length <= 2 ? all.join(' and ') : `${all.slice(0, 2).join(', ')} and ${all.length - 2} more`;
};

/** What a card asks, in a few words: for the profile's "waiting for you" and notifications. */
export const describeOutgoing = (item: DotItem): string =>
  item.discordPost ? `post on Discord in ${item.discordPost.where}` : `send an email to ${item.outgoing ? describeRecipients(item.outgoing) : 'someone'}: ${item.outgoing?.subject ?? item.text}`;

/** Whether every recipient is someone the user lets this bot email without asking. */
export const mayEmailWithoutAsking = (thread: DotThread, mail: DotOutgoingMail): boolean => {
  const allowed = new Set((thread.runtime.sendTo ?? []).map((entry) => entry.address));
  return recipientsOf(mail).every((address) => allowed.has(address));
};

/** Whether the user lets this bot post in a Discord channel without asking. */
export const mayPostWithoutAsking = (thread: DotThread, channelId: string): boolean =>
  (thread.runtime.discordChannels ?? []).some((entry) => entry.channelId === channelId);

const outgoingItem = (thread: DotThread, itemId: string): DotItem | undefined =>
  thread.items.find((item) => item.id === itemId && item.kind === 'outgoing' && (item.outgoing || item.discordPost));

export const outgoingState = (thread: DotThread, item: DotItem): OutgoingState => {
  if (item.outgoingStep) return item.outgoingStep;
  for (let index = thread.items.length - 1; index >= 0; index -= 1) {
    const entry = thread.items[index]!;
    if (entry.kind === 'event' && entry.event === 'outgoing' && entry.ref === item.id && entry.outgoingStep) return entry.outgoingStep;
  }
  return 'pending';
};

/** Emails and posts waiting for the user, oldest first. */
export const pendingOutgoing = (thread: DotThread): DotItem[] =>
  thread.items.filter((item) => item.kind === 'outgoing' && (item.outgoing || item.discordPost) && outgoingState(thread, item) === 'pending');

const toOutgoingMail = (mail: DotOutgoingMail): OutgoingMail => ({
  to: mail.to,
  ...(mail.cc?.length ? { cc: mail.cc } : {}),
  subject: mail.subject,
  body: mail.body,
  ...(mail.threadId ? { threadId: mail.threadId } : {}),
  ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo, references: mail.references } : {}),
});

const sendSafely = async (mail: DotOutgoingMail, deps: DotMailDeps): Promise<{ id: string } | { problem: string }> => {
  try {
    return await deps.send(toOutgoingMail(mail));
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
};

const postSafely = async (message: DotDiscordPost, deps: DotMailDeps): Promise<{ id: string } | { problem: string }> => {
  if (!deps.post) return { problem: 'The bot is not connected to Discord any more.' };
  try {
    return await deps.post(message);
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
};

const post = (dotId: string, ref: string, outgoingStep: NonNullable<DotItem['outgoingStep']>, text: string, problem?: string) =>
  appendDotItem(dotId, { kind: 'event', event: 'outgoing', ref, outgoingStep, text, ...(problem ? { failed: true, problem } : {}) });

/** Why a card's email or post did not go, when it failed. */
export const outgoingProblem = (thread: DotThread, item: DotItem): string | undefined => {
  if (item.outgoingStep) return item.problem;
  for (let index = thread.items.length - 1; index >= 0; index -= 1) {
    const entry = thread.items[index]!;
    if (entry.kind === 'event' && entry.event === 'outgoing' && entry.ref === item.id && entry.outgoingStep === 'failed') return entry.problem;
  }
  return undefined;
};

export const allowEmailing = (dotId: string, addresses: string[], now: number): void => {
  updateDotRuntime(dotId, (runtime) => {
    const known = new Set((runtime.sendTo ?? []).map((entry) => entry.address));
    const added = addresses.map((address) => address.toLowerCase()).filter((address) => !known.has(address));
    return added.length ? { ...runtime, sendTo: [...(runtime.sendTo ?? []), ...added.map((address) => ({ address, grantedAt: now }))] } : runtime;
  });
};

export const stopEmailingWithoutAsking = (dotId: string, address: string): void => {
  updateDotRuntime(dotId, (runtime) => ({ ...runtime, sendTo: (runtime.sendTo ?? []).filter((entry) => entry.address !== address.toLowerCase()) }));
};

export const allowPosting = (dotId: string, channelId: string, where: string, now: number): void => {
  updateDotRuntime(dotId, (runtime) => ((runtime.discordChannels ?? []).some((entry) => entry.channelId === channelId)
    ? runtime
    : { ...runtime, discordChannels: [...(runtime.discordChannels ?? []), { channelId, where, grantedAt: now }] }));
};

export const stopPostingWithoutAsking = (dotId: string, channelId: string): void => {
  updateDotRuntime(dotId, (runtime) => ({ ...runtime, discordChannels: (runtime.discordChannels ?? []).filter((entry) => entry.channelId !== channelId) }));
};

/**
 * The user tapped Send (or Post) on a card, and with `always` let the bot write to those recipients — or in that
 * channel — again without asking.
 */
export const sendOutgoing = async (dotId: string, itemId: string, options: { always?: boolean }, deps: DotMailDeps): Promise<void> => {
  const thread = getDotThread(dotId);
  const item = thread && outgoingItem(thread, itemId);
  if (!thread || !item || outgoingState(thread, item) !== 'pending') return;
  await withWebLock(`willow-dot-send:${itemId}`, async () => {
    const latest = getDotThread(dotId);
    const current = latest && outgoingItem(latest, itemId);
    if (!latest || !current || outgoingState(latest, current) !== 'pending') return;
    const message = current.discordPost;
    if (message) {
      if (options.always) allowPosting(dotId, message.channelId, message.where, deps.now());
      post(dotId, itemId, 'sending', `The user approved posting your message in ${message.where} (${itemId}).${options.always ? ` They also let you post in ${message.where} from now on without asking each time.` : ''}`);
      const result = await postSafely(message, deps);
      if (!getDotThread(dotId)) return;
      if ('problem' in result) post(dotId, itemId, 'failed', `Your message for ${message.where} (${itemId}) was not posted: ${result.problem}`, result.problem);
      else post(dotId, itemId, 'sent', `Posted your message in ${message.where} (${itemId}).`);
      deps.wake(dotId);
      return;
    }
    const mail = current.outgoing!;
    const who = describeRecipients(mail);
    if (options.always) allowEmailing(dotId, recipientsOf(mail), deps.now());
    post(dotId, itemId, 'sending', `The user approved sending “${mail.subject}” to ${who} (${itemId}).${options.always ? ` They also let you email ${who} from now on without asking each time.` : ''}`);
    const result = await sendSafely(mail, deps);
    if (!getDotThread(dotId)) return;
    if ('problem' in result) post(dotId, itemId, 'failed', `“${mail.subject}” to ${who} (${itemId}) was not sent: ${result.problem}`, result.problem);
    else post(dotId, itemId, 'sent', `Sent “${mail.subject}” to ${who} (${itemId}).`);
    deps.wake(dotId);
  });
};

export const declineOutgoing = (dotId: string, itemId: string, deps: Pick<DotMailDeps, 'wake'>): void => {
  const thread = getDotThread(dotId);
  const item = thread && outgoingItem(thread, itemId);
  if (!thread || !item || outgoingState(thread, item) !== 'pending') return;
  post(dotId, itemId, 'declined', item.discordPost
    ? `The user chose not to post your message in ${item.discordPost.where} (${itemId}).`
    : `The user chose not to send “${item.outgoing!.subject}” to ${describeRecipients(item.outgoing!)} (${itemId}).`);
  deps.wake(dotId);
};

/**
 * Sends at once, under the user's standing permission — or, `byMode`, because they let the bot act without asking:
 * the card is posted already sending and closed with the outcome, which is returned for the tool to report.
 */
export const sendStanding = async (dotId: string, mail: DotOutgoingMail, turnId: string | undefined, deps: DotMailDeps, byMode = false): Promise<{ item: DotItem; problem?: string }> => {
  const item = appendDotItem(dotId, { kind: 'outgoing', text: mail.subject, outgoing: { ...mail, standing: byMode ? 'mode' : true }, outgoingStep: 'sending', ...(turnId ? { turnId } : {}) });
  const result = await sendSafely(mail, deps);
  if ('problem' in result) {
    updateDotItem(dotId, item.id, { outgoingStep: 'failed', failed: true, problem: result.problem });
    return { item, problem: result.problem };
  }
  updateDotItem(dotId, item.id, { outgoingStep: 'sent' });
  return { item };
};

/** Posts at once in a channel the user allowed — or anywhere, `byMode` — with a card as the record. */
export const postStanding = async (dotId: string, message: DotDiscordPost, turnId: string | undefined, deps: DotMailDeps, byMode = false): Promise<{ item: DotItem; problem?: string }> => {
  const item = appendDotItem(dotId, { kind: 'outgoing', text: message.text.slice(0, 200), discordPost: { ...message, standing: byMode ? 'mode' : true }, outgoingStep: 'sending', ...(turnId ? { turnId } : {}) });
  const result = await postSafely(message, deps);
  if ('problem' in result) {
    updateDotItem(dotId, item.id, { outgoingStep: 'failed', failed: true, problem: result.problem });
    return { item, problem: result.problem };
  }
  updateDotItem(dotId, item.id, { outgoingStep: 'sent' });
  return { item };
};
