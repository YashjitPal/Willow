import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { sparkDotName, sparkDots } from '../dots-store';
import { isTelegramToken, newPairingCode, setTelegramLink, telegramLink } from '../harness/runtime/telegram';
import '../m3/m3';

/**
 * Talking to a bot from Telegram: the user's own bot, linked to one bot at a time, answering only the chat that
 * sent the pairing code. Shown in a bot's settings under Notifications.
 */
export function DotTelegramRow({ dotId, name }: { dotId: string; name: string }) {
  const link = useStore(telegramLink);
  const { dots } = useStore(sparkDots);
  const dotName = (id: string) => {
    const dot = dots.find((entry) => entry.id === id);
    return dot ? sparkDotName(dot) : 'another bot';
  };
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const here = link?.dotId === dotId;
  const sub = !link ? 'Talk to it from your phone' : !here ? `Linked to ${dotName(link.dotId)}` : link.chatId !== undefined ? `With ${link.chatName ?? 'you'}` : 'Waiting for your first message';

  return (
    <>
      <div className="dot-panel__row">
        <MaterialSymbol name="send" size={20} opticalSize={20} weight={350} className="dot-panel__row-icon" />
        <span className="dot-panel__row-copy">
          <span className="dot-panel__row-title">Telegram</span>
          <span className="dot-panel__row-sub">{sub}</span>
        </span>
        {here ? (
          <md-text-button data-action="telegram-unlink" onClick={() => setTelegramLink(null)}>
            Disconnect
          </md-text-button>
        ) : link ? (
          <md-text-button data-action="telegram-move" onClick={() => setTelegramLink({ ...link, dotId, chatId: link.chatId, offset: link.offset })}>
            Move here
          </md-text-button>
        ) : (
          <md-text-button data-action="telegram-connect" onClick={() => setEditing((open) => !open)}>
            {editing ? 'Cancel' : 'Connect'}
          </md-text-button>
        )}
      </div>
      {!link && editing && (
        <form
          className="dot-panel__segment-note"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isTelegramToken(token)) return;
            setTelegramLink({ token: token.trim(), dotId, code: newPairingCode() });
            setToken('');
            setEditing(false);
          }}
        >
          <p>In Telegram, ask @BotFather for a new bot, and paste the token it gives you. Only you will be able to talk to {name} through it.</p>
          <md-outlined-text-field
            label="Bot token"
            type="password"
            value={token}
            onInput={(event) => setToken((event.currentTarget as unknown as HTMLInputElement).value)}
          />
          <md-text-button type="submit" disabled={!isTelegramToken(token)}>
            Save
          </md-text-button>
        </form>
      )}
      {here && link.chatId === undefined && (
        <p className="dot-panel__segment-note">
          Open your bot in Telegram and send <strong>{link.code}</strong>. Willow answers only the chat that sends it.
        </p>
      )}
    </>
  );
}
