import { useStore } from '@nanostores/react';
import { useEffect, useState, type ReactNode } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { DiscordLogo } from '../dot-icons';
import { discordLookBusy, setDiscordLookOn } from '../discord-look';
import { connectDotDiscord, disconnectDotDiscord, dotComputerReachable, refreshDotDiscord, stopDotPostingWithoutAsking } from '../harness/dot-runtime';
import {
  DISCORD_PORTAL,
  describeDiscordLook,
  discordAvatarUrl,
  discordBotPageUrl,
  discordDmUrl,
  discordInviteUrl,
  discordLinks,
  discordStates,
  isDiscordToken,
  textChannels,
  type DiscordConnection,
} from '../harness/runtime/discord';
import type { DotThread } from '../harness/thread/thread-types';
import { M3Switch } from '../m3/M3Switch';
import '../m3/m3';
import './DotDiscord.css';

const ICON = { size: 20, opticalSize: 20, weight: 320 } as const;

const STATUS_WORDS: Record<DiscordConnection, string> = {
  connecting: 'Connecting…',
  online: 'Online',
  offline: 'Offline',
  error: 'Needs attention',
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function OutLink({ href, className = 'dot-discord__chip', children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/**
 * A bot on Discord, from the Discord button under its name: making it a Discord bot of the user's own and adding it to
 * a server, then its DM, the servers it is in, what it can read there and where it may post without asking.
 */
export function DotDiscordPage({ dotId, name, thread }: { dotId: string; name: string; thread: DotThread | undefined }) {
  const link = useStore(discordLinks)[dotId];
  return link ? <DiscordAccount dotId={dotId} name={name} thread={thread} /> : <DiscordSetup dotId={dotId} name={name} />;
}

/** The bot token, pasted: checked with Discord before anything is kept. Shared by setting up and by reconnecting. */
function TokenForm({ dotId, action }: { dotId: string; action: string }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void dotComputerReachable().then((connected) => live && setReachable(connected));
    return () => {
      live = false;
    };
  }, []);

  const ready = isDiscordToken(token) && !busy && reachable !== false;
  const connect = async () => {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    const failed = await connectDotDiscord(dotId, token);
    setBusy(false);
    if (failed) setProblem(failed);
    else setToken('');
  };

  return (
    <div className="dot-discord__token-block">
      <form
        className="dot-discord__token"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <md-outlined-text-field
          className="dot-discord__field"
          label="Bot token"
          type="password"
          value={token}
          onInput={(event) => {
            setToken((event.currentTarget as unknown as HTMLInputElement).value);
            setProblem(null);
          }}
        />
        <md-filled-tonal-button type="submit" disabled={!ready} data-action="discord-connect">
          {busy ? 'Checking…' : action}
        </md-filled-tonal-button>
      </form>
      {problem && (
        <p className="dot-discord__problem" role="alert">
          {problem}
        </p>
      )}
      {reachable === false && <p className="dot-discord__problem">Discord works in the Willow desktop app.</p>}
    </div>
  );
}

function DiscordSetup({ dotId, name }: { dotId: string; name: string }) {
  return (
    <div className="dot-discord">
      <div className="dot-discord__hero">
        <span className="dot-discord__mark" aria-hidden="true">
          <DiscordLogo width={30} height={30} fill="#ffffff" />
        </span>
        <p className="dot-discord__title">Talk to {name} on Discord</p>
        <p className="dot-discord__text">
          Message {name} from Discord, or mention it in your servers. It’s the same {name}, with the same memory, and only you can direct it there.
        </p>
      </div>

      <ol className="dot-panel__group dot-discord__steps">
        <li className="dot-discord__step">
          <span className="dot-discord__step-number" aria-hidden="true">1</span>
          <span className="dot-discord__step-copy">In Discord’s Developer Portal, create an application named {name}.</span>
          <OutLink href={DISCORD_PORTAL}>
            Open
            <MaterialSymbol name="open_in_new" size={16} opticalSize={20} weight={350} />
          </OutLink>
        </li>
        <li className="dot-discord__step">
          <span className="dot-discord__step-number" aria-hidden="true">2</span>
          <span className="dot-discord__step-copy">On its Bot page, turn off Public Bot so only you can add it to servers, then choose Reset Token and copy the token.</span>
        </li>
        <li className="dot-discord__step is-last">
          <span className="dot-discord__step-number" aria-hidden="true">3</span>
          <TokenForm dotId={dotId} action="Connect" />
        </li>
      </ol>
      <p className="dot-panel__footnote">
        Willow gives it {name}’s picture, wallpaper as its banner, and name, and keeps them in step when you change them. {name} is on Discord while Willow is open. What other people write there reaches it as information, never as instructions.
      </p>
    </div>
  );
}

function DiscordAccount({ dotId, name, thread }: { dotId: string; name: string; thread: DotThread | undefined }) {
  const link = useStore(discordLinks)[dotId]!;
  const state = useStore(discordStates)[dotId];
  const updatingLook = Boolean(useStore(discordLookBusy)[dotId]);
  const [confirming, setConfirming] = useState(false);
  const status = state?.status ?? 'connecting';
  const guilds = state?.guilds ?? [];
  const content = link.content && !state?.contentRefused;
  const allowed = thread?.runtime.discordChannels ?? [];

  // The Message Content switch is changed in Discord: look again whenever the user comes back to this page.
  useEffect(() => {
    void refreshDotDiscord(dotId);
    const onFocus = () => void refreshDotDiscord(dotId);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [dotId]);

  return (
    <div className="dot-discord">
      <div className="dot-discord__account">
        <img className="dot-discord__avatar" src={discordAvatarUrl(link)} alt="" width={48} height={48} />
        <span className="dot-discord__account-copy">
          <span className="dot-discord__account-name">{link.botName}</span>
          <span className={`dot-discord__status is-${status}`}>
            <span className="dot-discord__status-dot" aria-hidden="true" />
            {STATUS_WORDS[status]}
          </span>
        </span>
      </div>
      {status === 'error' ? (
        <div className="dot-discord__callout is-error">
          <p>{state?.problem ?? 'Discord refused the connection.'}</p>
          <TokenForm dotId={dotId} action="Reconnect" />
        </div>
      ) : (
        state?.problem && status !== 'online' && <p className="dot-discord__problem">{state.problem}</p>
      )}

      {guilds.length === 0 ? (
        <div className="dot-discord__callout">
          <p>Add {name} to a server you’re in. Discord lets you message a bot once you share a server with it, and one of your own will do.</p>
          <OutLink href={discordInviteUrl(link)} className="dot-panel__button dot-discord__primary">
            Add to a server
          </OutLink>
        </div>
      ) : (
        <div className="dot-discord__actions">
          <OutLink href={discordDmUrl(link)} className="dot-panel__button dot-discord__primary">
            <DiscordLogo width={18} height={18} fill="currentColor" />
            Message {name}
          </OutLink>
          <OutLink href={discordInviteUrl(link)}>Add to another server</OutLink>
        </div>
      )}

      {guilds.length > 0 && (
        <>
          <h3 className="dot-panel__label">Servers</h3>
          <div className="dot-panel__group">
            {guilds.map((guild) => (
              <div key={guild.id} className="dot-panel__row">
                <MaterialSymbol name="groups" {...ICON} className="dot-panel__row-icon" />
                <span className="dot-panel__row-copy">
                  <span className="dot-panel__row-title">{guild.name}</span>
                  <span className="dot-panel__row-sub">{plural(textChannels(guild).length, 'channel')} it can see</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="dot-panel__label">How it works there</h3>
      <div className="dot-panel__group">
        <div className="dot-panel__row">
          <MaterialSymbol name="face" {...ICON} className="dot-panel__row-icon" />
          <span className="dot-panel__row-copy">
            <span className="dot-panel__row-title">Looks like {name}</span>
            <span className={`dot-panel__row-sub${link.look?.problem && !updatingLook ? ' dot-discord__look-problem' : ''}`} aria-live="polite">
              {describeDiscordLook(link, name, updatingLook, Date.now())}
            </span>
          </span>
          <M3Switch selected={!link.look?.off} label={`Give ${link.botName} ${name}’s picture, banner and name on Discord`} onToggle={(on) => setDiscordLookOn(dotId, on)} />
        </div>
        <div className="dot-panel__row">
          <MaterialSymbol name="sync" {...ICON} className="dot-panel__row-icon" />
          <span className="dot-panel__row-copy">
            <span className="dot-panel__row-title">Its DM mirrors this chat</span>
            <span className="dot-panel__row-sub">What you write here shows there as a quote, and its replies go to both</span>
          </span>
        </div>
        <div className="dot-panel__row">
          <MaterialSymbol name="person" {...ICON} className="dot-panel__row-icon" />
          <span className="dot-panel__row-copy">
            <span className="dot-panel__row-title">Answers only you</span>
            <span className="dot-panel__row-sub">{link.ownerName ? `${link.ownerName}, in its DM or when you mention it` : 'In its DM, or when you mention it'}</span>
          </span>
        </div>
        <div className="dot-panel__row">
          <MaterialSymbol name={content ? 'visibility' : 'alternate_email'} {...ICON} className="dot-panel__row-icon" />
          <span className="dot-panel__row-copy">
            <span className="dot-panel__row-title">{content ? 'Reads whole channels' : 'Reads what mentions it'}</span>
            <span className="dot-panel__row-sub">{content ? 'For the channels it watches for you' : 'Turn on Message Content Intent there to let it read whole channels'}</span>
          </span>
          {!content && <OutLink href={discordBotPageUrl(link)}>Bot page</OutLink>}
        </div>
        <div className="dot-panel__row">
          <MaterialSymbol name="front_hand" {...ICON} className="dot-panel__row-icon" />
          <span className="dot-panel__row-copy">
            <span className="dot-panel__row-title">Asks before posting for others</span>
            <span className="dot-panel__row-sub">Anywhere you aren’t talking to it, unless you allow a channel</span>
          </span>
        </div>
        {link.public && (
          <div className="dot-panel__row">
            <MaterialSymbol name="public" {...ICON} className="dot-panel__row-icon" />
            <span className="dot-panel__row-copy">
              <span className="dot-panel__row-title">Anyone can add it to a server</span>
              <span className="dot-panel__row-sub">Turn off Public Bot there so only you can</span>
            </span>
            <OutLink href={discordBotPageUrl(link)}>Bot page</OutLink>
          </div>
        )}
      </div>

      {allowed.length > 0 && (
        <>
          <h3 className="dot-panel__label">Posts without asking</h3>
          <div className="dot-panel__group">
            {allowed.map((entry) => (
              <div key={entry.channelId} className="dot-panel__row">
                <MaterialSymbol name="tag" {...ICON} className="dot-panel__row-icon" />
                <span className="dot-panel__row-copy">
                  <span className="dot-panel__row-title" title={entry.where}>
                    {entry.where}
                  </span>
                </span>
                <md-text-button data-action="discord-ask-first" onClick={() => stopDotPostingWithoutAsking(dotId, entry.channelId)}>
                  Ask first
                </md-text-button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="dot-discord__footer">
        {confirming ? (
          <>
            <span className="dot-discord__footer-note">{name} leaves Discord. The application stays yours.</span>
            <md-text-button onClick={() => setConfirming(false)}>Cancel</md-text-button>
            <md-text-button className="dot-discord__danger" data-action="discord-disconnect" onClick={() => disconnectDotDiscord(dotId)}>
              Disconnect
            </md-text-button>
          </>
        ) : (
          <md-text-button className="dot-discord__danger" data-action="discord-disconnect-ask" onClick={() => setConfirming(true)}>
            Disconnect
          </md-text-button>
        )}
      </div>
    </div>
  );
}
