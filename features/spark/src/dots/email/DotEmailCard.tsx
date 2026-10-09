import { useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { DotAskAlways, DotAskCard, DotAskNote, type DotAskTone } from '../ask/DotAskCard';
import { DiscordLogo } from '../dot-icons';
import { declineDotEmail, sendDotEmail } from '../harness/dot-runtime';
import { outgoingProblem, outgoingState } from '../harness/runtime/outgoing';
import type { DotItem, DotThread } from '../harness/thread/thread-types';
import './DotEmailCard.css';

const PREVIEW_LINES = 6;

const shortName = (recipient: string): string => {
  const name = recipient.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim();
  return name || recipient.replace(/<|>/g, '').trim();
};

/** A name above its address, muted; a bare address alone. */
const recipient = (value: string) => {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return (
    <span key={value} className="dot-email-card__recipient">
      {match?.[1] ? (
        <>
          <span>{match[1]}</span>
          <span className="dot-email-card__address">{match[2]}</span>
        </>
      ) : (
        <span>{match?.[2] ?? value}</span>
      )}
    </span>
  );
};

type OutgoingState = ReturnType<typeof outgoingState>;

const TONES: Record<OutgoingState, DotAskTone> = { pending: 'ask', sending: 'busy', sent: 'done', declined: 'off', failed: 'error' };

const TITLES: Record<OutgoingState, (name: string) => string> = {
  pending: (name) => `${name} wants to send an email`,
  sending: () => 'Sending…',
  sent: () => 'Sent',
  declined: () => 'Not sent',
  failed: () => 'Not sent',
};

const POST_TITLES: Record<OutgoingState, (name: string) => string> = {
  pending: (name) => `${name} wants to post on Discord`,
  sending: () => 'Posting…',
  sent: () => 'Posted on Discord',
  declined: () => 'Not posted',
  failed: () => 'Not posted',
};

interface CardProps {
  dotId: string;
  name: string;
  item: DotItem;
  thread: DotThread;
}

/** What a bot asked to send where other people read it: an email in the user's name, or a post on Discord. */
export function DotEmailCard(props: CardProps) {
  return props.item.discordPost ? <DiscordPostCard {...props} /> : <EmailCard {...props} />;
}

/** The text that would go, trimmed to a few lines until asked for all of it. */
function MessageText({ text, action }: { text: string; action: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n');
  const long = lines.length > PREVIEW_LINES || text.length > 480;
  const shown = expanded || !long ? text : `${lines.slice(0, PREVIEW_LINES).join('\n').slice(0, 480).trimEnd()}…`;
  return (
    <>
      <p className="dot-email-card__text">{shown}</p>
      {long && (
        <button type="button" className="dot-email-card__more" data-action={action} aria-expanded={expanded ? 'true' : 'false'} onClick={() => setExpanded((open) => !open)}>
          {expanded ? 'Show less' : 'Show all'}
          <MaterialSymbol name={expanded ? 'expand_less' : 'expand_more'} size={18} opticalSize={20} weight={400} />
        </button>
      )}
    </>
  );
}

/** A post the bot wrote for a Discord channel where people other than the user read it: exactly what will go. */
function DiscordPostCard({ dotId, name, item, thread }: CardProps) {
  const [always, setAlways] = useState(false);
  const message = item.discordPost!;
  const state = outgoingState(thread, item);
  const problem = state === 'failed' ? outgoingProblem(thread, item) : undefined;
  const channel = message.where.match(/^#[^\s(]+/)?.[0] ?? 'this channel';
  const title = POST_TITLES[state](name);

  return (
    <DotAskCard
      kind="discord"
      tone={TONES[state]}
      icon={<DiscordLogo width={20} height={20} />}
      kicker="Discord"
      title={title}
      label={`${title} ${message.where}`}
      reason={state === 'pending' ? message.reason : undefined}
      footer={
        state === 'pending' ? (
          <>
            <DotAskAlways action="discord-always" checked={always} onChange={setAlways}>
              Always allow posts in {channel}
            </DotAskAlways>
            <md-text-button data-action="discord-decline" onClick={() => declineDotEmail(dotId, item.id)}>
              Don&rsquo;t post
            </md-text-button>
            <md-filled-button data-action="discord-post" onClick={() => void sendDotEmail(dotId, item.id, always)}>
              Post
            </md-filled-button>
          </>
        ) : undefined
      }
    >
      <div className="dot-email-card__letter">
        <dl className="dot-email-card__fields">
          <dt>In</dt>
          <dd>{message.where}</dd>
        </dl>
        <MessageText text={message.text} action="discord-expand" />
      </div>
      {problem && <DotAskNote error>{problem}</DotAskNote>}
      {message.standing && state === 'sent' && (
        <DotAskNote>{message.standing === 'mode' ? `Posted without asking, as ${name}’s permissions allow.` : `Posted without asking: you let ${name} post in ${channel}.`}</DotAskNote>
      )}
    </DotAskCard>
  );
}

/** An email a bot wrote in the user's name: exactly what will go, and until they decide, Send. */
function EmailCard({ dotId, name, item, thread }: CardProps) {
  const [always, setAlways] = useState(false);
  const mail = item.outgoing;
  if (!mail) return null;
  const state = outgoingState(thread, item);
  const problem = state === 'failed' ? outgoingProblem(thread, item) : undefined;
  const recipients = [...mail.to, ...(mail.cc ?? [])];
  const who = recipients.length === 1 ? shortName(recipients[0]!) : `${recipients.length} people`;
  const title = TITLES[state](name);

  return (
    <DotAskCard
      kind="email"
      tone={TONES[state]}
      icon={<MaterialSymbol name={state === 'sent' ? 'mark_email_read' : state === 'failed' || state === 'declined' ? 'unsubscribe' : 'outgoing_mail'} size={22} opticalSize={24} weight={350} />}
      kicker="Email"
      title={title}
      label={`${title}: ${mail.subject}`}
      reason={state === 'pending' ? mail.reason : undefined}
      footer={
        state === 'pending' ? (
          <>
            <DotAskAlways action="email-always" checked={always} onChange={setAlways}>
              Always allow emails to {who}
            </DotAskAlways>
            <md-text-button data-action="email-decline" onClick={() => declineDotEmail(dotId, item.id)}>
              Don&rsquo;t send
            </md-text-button>
            <md-filled-button data-action="email-send" onClick={() => void sendDotEmail(dotId, item.id, always)}>
              Send
            </md-filled-button>
          </>
        ) : undefined
      }
    >
      <div className="dot-email-card__letter">
        <dl className="dot-email-card__fields">
          <dt>To</dt>
          <dd>{mail.to.map(recipient)}</dd>
          {mail.cc?.length ? (
            <>
              <dt>Cc</dt>
              <dd>{mail.cc.map(recipient)}</dd>
            </>
          ) : null}
          <dt>Subject</dt>
          <dd className="dot-email-card__subject">{mail.subject}</dd>
        </dl>
        <MessageText text={mail.body} action="email-expand" />
      </div>
      {problem && <DotAskNote error>{problem}</DotAskNote>}
      {mail.standing && state === 'sent' && (
        <DotAskNote>{mail.standing === 'mode' ? `Sent without asking, as ${name}’s permissions allow.` : `Sent without asking: you let ${name} email ${who}.`}</DotAskNote>
      )}
    </DotAskCard>
  );
}
