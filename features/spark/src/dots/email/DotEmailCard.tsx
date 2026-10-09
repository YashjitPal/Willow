import { useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { DiscordLogo } from '../dot-icons';
import { declineDotEmail, sendDotEmail } from '../harness/dot-runtime';
import { outgoingProblem, outgoingState } from '../harness/runtime/outgoing';
import type { DotItem, DotThread } from '../harness/thread/thread-types';
import { M3_SCOPE } from '../m3/m3';
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

const TITLES = {
  pending: 'Send this email?',
  sending: 'Sending…',
  sent: 'Sent',
  declined: 'Not sent',
  failed: 'Not sent',
} as const;

const POST_TITLES = {
  pending: 'Post this on Discord?',
  sending: 'Posting…',
  sent: 'Posted on Discord',
  declined: 'Not posted',
  failed: 'Not posted',
} as const;

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

/** A post the bot wrote for a Discord channel where people other than the user read it: exactly what will go. */
function DiscordPostCard({ dotId, name, item, thread }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const message = item.discordPost!;
  const state = outgoingState(thread, item);
  const problem = state === 'failed' ? outgoingProblem(thread, item) : undefined;
  const channel = message.where.match(/^#[^\s(]+/)?.[0] ?? 'this channel';
  const lines = message.text.split('\n');
  const long = lines.length > PREVIEW_LINES || message.text.length > 480;
  const body = expanded || !long ? message.text : `${lines.slice(0, PREVIEW_LINES).join('\n').slice(0, 480).trimEnd()}…`;

  return (
    <article className={`dot-email-card is-${state} ${M3_SCOPE}`} aria-label={`${POST_TITLES[state]} ${message.where}`}>
      <md-outlined-card>
        <div className="dot-email-card__body">
          <div className="dot-email-card__head">
            <span className="dot-email-card__icon" aria-hidden="true">
              <DiscordLogo width={20} height={20} />
            </span>
            <span className="dot-email-card__title">{POST_TITLES[state]}</span>
            {state === 'sending' && <md-circular-progress indeterminate aria-label="Posting" />}
          </div>
          <dl className="dot-email-card__fields">
            <dt>In</dt>
            <dd>{message.where}</dd>
          </dl>
          <p className="dot-email-card__text">{body}</p>
          {long && (
            <md-text-button className="dot-email-card__more" data-action="discord-expand" onClick={() => setExpanded((open) => !open)}>
              {expanded ? 'Show less' : 'Show all'}
            </md-text-button>
          )}
          {message.reason && state === 'pending' && <p className="dot-email-card__note">{message.reason}</p>}
          {problem && <p className="dot-email-card__note is-error">{problem}</p>}
          {message.standing && state === 'sent' && <p className="dot-email-card__note">{message.standing === 'mode' ? `Posted without asking, as ${name}'s permissions allow.` : `Posted without asking: you let ${name} post in ${channel}.`}</p>}
          {state === 'pending' && (
            <div className="dot-email-card__actions">
              <md-filled-tonal-button data-action="discord-post" onClick={() => void sendDotEmail(dotId, item.id)}>
                Post
              </md-filled-tonal-button>
              <md-text-button data-action="discord-decline" onClick={() => declineDotEmail(dotId, item.id)}>
                Don&apos;t post
              </md-text-button>
              <md-text-button data-action="discord-always" aria-label={`Post, and let ${name} post in ${channel} without asking`} onClick={() => void sendDotEmail(dotId, item.id, true)}>
                Always allow {channel}
              </md-text-button>
            </div>
          )}
        </div>
      </md-outlined-card>
    </article>
  );
}

/** An email a bot wrote in the user's name: exactly what will go, and until they decide, Send. */
function EmailCard({ dotId, name, item, thread }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const mail = item.outgoing;
  if (!mail) return null;
  const state = outgoingState(thread, item);
  const problem = state === 'failed' ? outgoingProblem(thread, item) : undefined;
  const recipients = [...mail.to, ...(mail.cc ?? [])];
  const who = recipients.length === 1 ? shortName(recipients[0]!) : `${recipients.length} people`;
  const lines = mail.body.split('\n');
  const long = lines.length > PREVIEW_LINES || mail.body.length > 480;
  const body = expanded || !long ? mail.body : `${lines.slice(0, PREVIEW_LINES).join('\n').slice(0, 480).trimEnd()}…`;

  return (
    <article className={`dot-email-card is-${state} ${M3_SCOPE}`} aria-label={`${TITLES[state]} ${mail.subject}`}>
      <md-outlined-card>
        <div className="dot-email-card__body">
          <div className="dot-email-card__head">
            <span className="dot-email-card__icon" aria-hidden="true">
              <MaterialSymbol name={state === 'sent' ? 'mark_email_read' : state === 'failed' || state === 'declined' ? 'unsubscribe' : 'outgoing_mail'} size={20} opticalSize={20} weight={350} />
            </span>
            <span className="dot-email-card__title">{TITLES[state]}</span>
            {state === 'sending' && <md-circular-progress indeterminate aria-label="Sending" />}
          </div>
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
            <dd>{mail.subject}</dd>
          </dl>
          <p className="dot-email-card__text">{body}</p>
          {long && (
            <md-text-button className="dot-email-card__more" data-action="email-expand" onClick={() => setExpanded((open) => !open)}>
              {expanded ? 'Show less' : 'Show all'}
            </md-text-button>
          )}
          {mail.reason && state === 'pending' && <p className="dot-email-card__note">{mail.reason}</p>}
          {problem && <p className="dot-email-card__note is-error">{problem}</p>}
          {mail.standing && state === 'sent' && <p className="dot-email-card__note">{mail.standing === 'mode' ? `Sent without asking, as ${name}'s permissions allow.` : `Sent without asking: you let ${name} email ${who}.`}</p>}
          {state === 'pending' && (
            <div className="dot-email-card__actions">
              <md-filled-tonal-button data-action="email-send" onClick={() => void sendDotEmail(dotId, item.id)}>
                Send
              </md-filled-tonal-button>
              <md-text-button data-action="email-decline" onClick={() => declineDotEmail(dotId, item.id)}>
                Don&apos;t send
              </md-text-button>
              <md-text-button data-action="email-always" aria-label={`Send, and let ${name} email ${who} without asking`} onClick={() => void sendDotEmail(dotId, item.id, true)}>
                Always allow {who}
              </md-text-button>
            </div>
          )}
        </div>
      </md-outlined-card>
    </article>
  );
}
