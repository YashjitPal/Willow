import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { DotAskCard, DotAskFacts, DotAskNote, type DotAskTone } from '../ask/DotAskCard';
import { allowDotScreen, declineDotScreen, stopDotScreen } from '../harness/dot-runtime';
import { SCREEN_QUIET_MS, screenState, type ScreenState } from '../harness/runtime/screen-control';
import type { DotItem, DotThread } from '../harness/thread/thread-types';

type Platform = 'windows' | 'mac' | 'linux';

/** The screen shared is the one Willow runs on: the app and the companion that works the screen live there together. */
const platformHere = (): Platform => {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Macintosh|Mac OS X/.test(agent)) return 'mac';
  if (/Linux|X11|CrOS/.test(agent) && !/Android/.test(agent)) return 'linux';
  return 'windows';
};

/** What the go-ahead lets the bot do, as each system lets a screen be used, and how the user takes it back. */
const FACTS: Record<Platform, (name: string) => { icon: string; text: string }[]> = {
  windows: () => [
    { icon: 'visibility', text: 'Sees what is on your screen' },
    { icon: 'mouse', text: 'Uses your mouse and keyboard, alongside you' },
    { icon: 'back_hand', text: 'Moving your mouse pauses it; Esc or Stop gives your screen back at once' },
  ],
  mac: () => [
    { icon: 'visibility', text: 'Sees the windows of your apps' },
    { icon: 'apps', text: 'Works your apps in the background, without taking your pointer' },
    { icon: 'back_hand', text: 'Stop gives your screen back at once' },
  ],
  linux: (name) => [
    { icon: 'desktop_windows', text: `Opens apps on a desktop of ${name}’s own, off your screen` },
    { icon: 'mouse', text: 'Never touches your own pointer or keyboard' },
    { icon: 'back_hand', text: 'Stop ends it at once' },
  ],
};

const TITLES: Record<ScreenState, (name: string) => string> = {
  pending: (name) => `${name} wants to use your screen`,
  allowed: (name) => `${name} has your screen`,
  declined: () => 'You didn’t allow this',
  stopped: () => 'You took your screen back',
  ended: (name) => `${name} is done with your screen`,
};

const TONES: Record<ScreenState, DotAskTone> = { pending: 'ask', allowed: 'live', declined: 'off', stopped: 'off', ended: 'done' };
const GLYPHS: Record<ScreenState, string> = { pending: 'desktop_windows', allowed: 'screen_share', declined: 'desktop_access_disabled', stopped: 'stop_screen_share', ended: 'desktop_windows' };

/**
 * A bot's request for the user's own screen — to see it and use their mouse and keyboard — and, while it has it, the
 * way to take it back. Once answered, the conversation shows it as a line instead (`chatRows`).
 */
export function DotScreenCard({ dotId, name, item, thread, now }: { dotId: string; name: string; item: DotItem; thread: DotThread; now: number }) {
  const state = screenState(thread, item, now);
  const reason = item.screen?.reason ?? item.text;
  const title = TITLES[state](name);
  return (
    <DotAskCard
      kind="screen"
      tone={TONES[state]}
      icon={<MaterialSymbol name={GLYPHS[state]} size={22} opticalSize={24} weight={350} />}
      kicker="Screen access"
      title={title}
      label={title}
      reason={reason}
      footer={
        state === 'pending' ? (
          <>
            <md-text-button data-action="screen-decline" onClick={() => declineDotScreen(dotId, item.id)}>
              Don&rsquo;t allow
            </md-text-button>
            <md-filled-button data-action="screen-allow" onClick={() => allowDotScreen(dotId, item.id)}>
              Allow
            </md-filled-button>
          </>
        ) : state === 'allowed' ? (
          <button type="button" className="dot-ask__chip is-stop" data-action="screen-stop" onClick={() => stopDotScreen(dotId)}>
            Stop
          </button>
        ) : undefined
      }
    >
      {state === 'pending' && <DotAskFacts facts={FACTS[platformHere()](name)} />}
      {state === 'pending' && <DotAskNote>Until you stop it, or until {name} leaves it unused for {Math.round(SCREEN_QUIET_MS / 60_000)} minutes.</DotAskNote>}
      {state === 'allowed' && <DotAskNote>{item.screen?.standing === 'mode' ? `As ${name}’s permissions allow. ` : ''}Moving your mouse or typing pauses it.</DotAskNote>}
    </DotAskCard>
  );
}
