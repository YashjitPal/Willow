/**
 * Sending email the user approved.
 *
 * The one caller is a bot's send card: the user's tap on Send is the gesture, so nothing here runs from a model's
 * call alone. The token is the `gmail.send` grant the user gave in Settings → Connected Apps (`authorizeWrites`),
 * read with `get` — never requested here, so a send can fail with a sentence but never open a sign-in.
 */
import { authLossHandler } from '../connectors/authorization';
import { createAuthorizedFetch } from '../connectors/authorized-fetch';
import { isConnected } from '../connectors/connections-store';
import { canReadContents, readReplyContext, sendMail, type OutgoingMail, type ReplyContext } from '../connectors/google/gmail';
import { authLossStatusesFor, readScopesFor, tokensFor, writeScopesFor } from '../connectors/registry';

export interface MailAccess {
  connected: boolean;
  /** Reading what messages say, and Gmail's own search. */
  contents: boolean;
}

export const mailAccess = (): MailAccess => ({ connected: isConnected('gmail'), contents: canReadContents() });

/** Whether the user allowed sending. Silent: it checks the grant and never opens a window. */
export const canSendMail = async (): Promise<boolean> => {
  const scopes = writeScopesFor('gmail');
  return scopes.length > 0 && isConnected('gmail') && Boolean(await tokensFor('gmail').get(scopes));
};

const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/** The address in `Name <address>` or a bare address, or null when it is not one. */
export const mailAddress = (value: string): string | null => {
  const address = (value.match(/<([^>]+)>\s*$/)?.[1] ?? value).trim();
  return ADDRESS.test(address) ? address : null;
};

/** The thread and headers a reply to message `id` needs. Read access only: it reads, and never opens a sign-in. */
export const mailReplyContext = async (id: string): Promise<ReplyContext | { problem: string }> => {
  if (!isConnected('gmail')) return { problem: 'Gmail is not connected.' };
  const scopes = readScopesFor('gmail');
  const tokens = tokensFor('gmail');
  if (!(await tokens.get(scopes))) return { problem: "Willow's access to Gmail has expired. The user can reconnect it in Settings → Connected Apps." };
  const fetchJson = createAuthorizedFetch({ tokens, scopes, authLossStatuses: authLossStatusesFor('gmail'), onAuthLost: authLossHandler('gmail') });
  return (await readReplyContext(fetchJson, id)) ?? { problem: `No message with id "${id}" could be found to reply to.` };
};

export const sendApprovedMail = async (mail: OutgoingMail): Promise<{ id: string } | { problem: string }> => {
  if (!isConnected('gmail')) return { problem: 'Gmail is not connected. Connect it in Settings → Connected Apps.' };
  const scopes = writeScopesFor('gmail');
  const tokens = tokensFor('gmail');
  if (!(await tokens.get(scopes))) {
    return { problem: 'Willow is not allowed to send email yet. Allow it under Google in Settings → Connected Apps, then send again.' };
  }
  const fetchJson = createAuthorizedFetch({ tokens, scopes, authLossStatuses: authLossStatusesFor('gmail'), onAuthLost: authLossHandler('gmail') });
  const id = await sendMail(fetchJson, mail);
  return id ? { id } : { problem: 'Gmail did not accept the message. Check the addresses and send again.' };
};
