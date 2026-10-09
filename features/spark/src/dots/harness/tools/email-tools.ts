/**
 * Email in the user's name: the one way a bot's words leave Willow as the user.
 *
 * Reading mail is the connected-app tools' (`list_recent_emails`, `read_email`). Sending shows the user the message
 * on a card and waits for them (`runtime/outgoing.ts`), except to people they let this bot email without asking.
 */
import { appendDotItem, getDotThread } from '../thread/thread-store';
import type { DotOutgoingMail } from '../thread/thread-types';
import { describeRecipients, mayEmailWithoutAsking, sendStanding } from '../runtime/outgoing';
import { fail, ok, permissionsNow, stringArg, type DotToolEntry, type DotToolEnv } from './tool-env';

const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
const MAX_RECIPIENTS = 20;
const MAX_BODY = 50_000;

/** Addresses from a list or a comma-separated string, or the first one that is not an address. */
export const parseRecipients = (value: unknown): { addresses: string[] } | { invalid: string } => {
  const list = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/[,;]/) : [];
  const addresses: string[] = [];
  for (const entry of list.map((part) => part.trim()).filter(Boolean)) {
    if (!ADDRESS.test((entry.match(/<([^>]+)>\s*$/)?.[1] ?? entry).trim())) return { invalid: entry };
    addresses.push(entry);
  }
  return { addresses };
};

const replySubject = (subject: string): string => (/^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`);

export const emailTools = (env: DotToolEnv): DotToolEntry[] => {
  const mail = env.mail;
  if (!mail) return [];
  return [
    {
      doc: {
        name: 'send_email',
        args: '{"to": ["…"], "cc": ["…"], "subject": "…", "body": "…", "reply_to": "message id, optional", "reason": "…"}',
        description: `Send an email from the user's Gmail. ${env.permissions === 'act'
          ? 'It goes at once — the user lets you act without asking — and they see it on a card as it went.'
          : 'The user sees it exactly as written and sends or declines it — unless they already let you email every recipient without asking, when it goes at once.'} Write it complete and ready to go, plain text, in the user's voice, with every address copied exactly as you found it. "reply_to" (a message id) answers in that conversation; "subject" may then be left out. "reason" tells the user why it is going.${mail.canSend ? '' : ' Not allowed yet: the user allows sending under Google in Settings → Connected Apps. Until then, give them the text instead.'}`,
      },
      handler: {
        id: 'send_email',
        async run(args, context) {
          if (!mail.canSend) return fail('Willow is not allowed to send email yet. The user can allow it under Google in Settings → Connected Apps; until then, give them the text to send themselves.');
          const to = parseRecipients(args.to);
          if ('invalid' in to) return fail(`"${to.invalid}" is not an email address.`);
          const cc = parseRecipients(args.cc ?? []);
          if ('invalid' in cc) return fail(`"${cc.invalid}" is not an email address.`);
          let subject = stringArg(args, 'subject');
          const body = typeof args.body === 'string' ? args.body.trim() : '';
          const reason = stringArg(args, 'reason') ?? '';
          const replyId = stringArg(args, 'reply_to');
          let reply: Pick<DotOutgoingMail, 'threadId' | 'inReplyTo' | 'references'> = {};
          let recipients = to.addresses;
          if (replyId) {
            const found = await mail.replyContext(replyId);
            if ('problem' in found) return fail(found.problem);
            reply = { threadId: found.threadId, ...(found.messageId ? { inReplyTo: found.messageId, references: found.references } : {}) };
            subject ??= replySubject(found.subject);
            if (recipients.length === 0 && found.replyTo) recipients = [found.replyTo];
          }
          if (recipients.length === 0) return fail('Give "to": who the email is for.');
          if (recipients.length + cc.addresses.length > MAX_RECIPIENTS) return fail(`That is more than ${MAX_RECIPIENTS} recipients; Willow does not send bulk mail.`);
          if (!subject) return fail('Give a "subject".');
          if (!body) return fail('Give the "body": the whole message, as it should arrive.');
          if (body.length > MAX_BODY) return fail('That message is too long to send.');

          const outgoing: DotOutgoingMail = {
            to: recipients,
            ...(cc.addresses.length ? { cc: cc.addresses } : {}),
            subject: subject.slice(0, 300),
            body,
            reason: reason.slice(0, 500),
            ...reply,
          };
          const thread = getDotThread(env.dotId);
          const who = describeRecipients(outgoing);
          const allowed = Boolean(thread && mayEmailWithoutAsking(thread, outgoing));
          if (allowed || permissionsNow(env) === 'act') {
            const sent = await sendStanding(env.dotId, outgoing, context.turnId, mail.deps, !allowed);
            return sent.problem
              ? fail(`“${outgoing.subject}” to ${who} was not sent: ${sent.problem}`)
              : ok(`Sent “${outgoing.subject}” to ${who} (${sent.item.id}). ${allowed ? 'The user lets you email them without asking.' : 'The user lets you act without asking.'}`);
          }
          const item = appendDotItem(env.dotId, { kind: 'outgoing', text: outgoing.subject, turnId: context.turnId, outgoing });
          return ok(`Asked the user to approve sending “${outgoing.subject}” to ${who} (${item.id}). Nothing has been sent: their decision will reach you as an event. Carry on with anything that does not depend on it, or end your turn.`);
        },
      },
    },
  ];
};
