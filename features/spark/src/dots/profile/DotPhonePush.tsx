import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { DEFAULT_PUSH_SERVER, newPhoneTopic, phonePush, phoneTopicUrl, pushToPhone, setPhonePush } from '../harness/runtime/phone-push';
import { M3Switch } from '../m3/M3Switch';

/**
 * Notifications on the user's phone, through ntfy: one topic for every bot, which the user subscribes to in the ntfy
 * app. Shown under a bot's Notifications switch while it is on.
 */
export function DotPhonePushRow({ name }: { name: string }) {
  const push = useStore(phonePush);
  const [test, setTest] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  return (
    <>
      <div className="dot-panel__row">
        <MaterialSymbol name="phone_iphone" size={20} opticalSize={20} weight={350} className="dot-panel__row-icon" />
        <span className="dot-panel__row-copy">
          <span className="dot-panel__row-title">On your phone</span>
          <span className="dot-panel__row-sub">{push ? 'Through the ntfy app' : 'Off'}</span>
        </span>
        <M3Switch
          selected={Boolean(push)}
          label="Notifications on your phone"
          onToggle={(on) => {
            setTest('idle');
            setPhonePush(on ? { server: DEFAULT_PUSH_SERVER, topic: newPhoneTopic() } : null);
          }}
        />
      </div>
      {push && (
        <div className="dot-panel__segment-note">
          <p>
            In the ntfy app, subscribe to{' '}
            <a href={phoneTopicUrl(push)} target="_blank" rel="noreferrer">
              {push.topic}
            </a>
            . Anyone with that name can read what arrives there, so keep it to yourself.
          </p>
          <md-text-button
            data-action="phone-test"
            disabled={test === 'sending'}
            onClick={() => {
              setTest('sending');
              void pushToPhone(push, name, `${name} can reach you here.`).then((ok) => setTest(ok ? 'sent' : 'failed'));
            }}
          >
            {test === 'sent' ? 'Sent' : test === 'failed' ? "Couldn't send — try again" : 'Send a test'}
          </md-text-button>
        </div>
      )}
    </>
  );
}
