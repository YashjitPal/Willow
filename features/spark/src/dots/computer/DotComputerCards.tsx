import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore } from '@nanostores/react';
import { isDesktopApp } from '@willow/core/desktop-bridge';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { DesktopIcon } from '../dot-icons';
import { dotTintHex } from '../dot-tint';
import { sparkDots } from '../dots-store';
import { dotWallpaperColors, dotWallpaperUrl } from './dot-wallpaper';
import './DotComputerCards.css';
import { declineDotMachine, dismissDotHelp, enterDotSecret, installDotMachineSupport } from '../harness/dot-runtime';
import { helpOutcome, helpTaken, setupAnswer } from '../harness/tools/machine-tools';
import type { DotItem, DotThread } from '../harness/thread/thread-types';
import {
  dotComputerFrames,
  dotComputers,
  dotComputerView,
  handBackDotComputer,
  loadDotShot,
  openDotComputer,
  refreshDotComputer,
  setUpDotComputer,
  takeOverDotComputer,
  turnOnDotComputer,
  type DotComputerView,
} from './dot-computer-store';

const SYMBOL_PROPS = { family: 'luminous' as const, weight: 320, roundness: 100 };

const useView = (dotId: string): DotComputerView => useStore(dotComputers, { keys: [dotId] })[dotId] ?? dotComputerView(dotId);

const percent = (view: DotComputerView) => (view.progress ? `${view.progress.detail} · ${Math.round(view.progress.fraction * 100)}%` : 'Starting…');

const hostOf = (url: string | undefined): string => {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const MonitorSymbol = () => <MaterialSymbol family="google-symbols" name="monitor" size={18} weight={330} roundness={100} opticalSize={18} />;

/**
 * Without WSL, setting up goes as far as Windows' own installer: Willow starts
 * it, Windows asks for permission, and a restart may follow.
 */
function InstallWsl({ name, className = 'spark-dots-approval__approve' }: { name: string; className?: string }) {
  const [started, setStarted] = useState(false);
  return started ? (
    <p className="spark-dots-approval__where">Follow Windows&rsquo; prompts; restart if it asks, then set up {name}&rsquo;s computer again.</p>
  ) : (
    <button type="button" className={className} onClick={() => void installDotMachineSupport().then(() => setStarted(true))}>
      Install WSL
    </button>
  );
}

/** The bot asked for a computer of its own: what it is, with Set up and Not now until answered. */
export function DotMachineSetupCard({ dotId, name, item, thread }: { dotId: string; name: string; item: DotItem; thread: DotThread }) {
  const view = useView(dotId);
  useEffect(() => {
    void refreshDotComputer(dotId);
  }, [dotId]);
  const answer = setupAnswer(thread, item.id);
  const state = !answer ? 'pending' : answer.machineStep === 'allowed' ? 'working' : answer.machineStep ?? 'pending';
  const working = state === 'working' || view.busy === 'setting-up';
  const desktop = isDesktopApp();
  const needsWsl = view.status?.reason === 'wsl-missing';
  const heading = working
    ? `Setting up ${name}'s computer`
    : state === 'ready'
      ? `${name}'s computer is ready`
      : state === 'failed'
        ? `Setting up ${name}'s computer didn't finish`
        : state === 'declined'
          ? 'You declined this'
          : `${name} would like a computer of its own`;

  return (
    <article className={`spark-dots-approval is-${state === 'pending' ? 'pending' : state === 'failed' ? 'failed' : 'done'}`} aria-label={heading}>
      <div className="spark-dots-approval__heading">
        {working ? (
          <MaterialSymbol {...SYMBOL_PROPS} name="progress_activity" size={18} opticalSize={18} className="spark-dots-approval__spinner" />
        ) : (
          <MonitorSymbol />
        )}
        <span>{heading}</span>
      </div>
      {state === 'pending' && (
        <p className="spark-dots-approval__reason">
          {name}&rsquo;s own account on a Linux computer on this PC that your bots share, with its own desktop, browser, files and shell, which {name} uses without asking at every step. You can watch its screen, take it over or turn it off at any time. {view.status?.base.ready ? 'Setting it up takes a few seconds.' : 'Setting up the computer takes a few minutes and about 2 GB, once for all your bots.'}
        </p>
      )}
      {working && <p className="spark-dots-approval__where">{percent(view)}</p>}
      {state === 'failed' && <p className="spark-dots-approval__reason">{answer?.text.replace(/^Setting up your computer \(i\d+\) failed: /, '')}</p>}
      {state === 'pending' && needsWsl && (
        <p className="spark-dots-approval__where">It runs on Windows Subsystem for Linux, which isn&rsquo;t on this PC yet.</p>
      )}
      {state === 'pending' && !desktop && <p className="spark-dots-approval__where">This needs the Willow desktop app.</p>}
      {desktop && (state === 'pending' || state === 'failed') && !working && (
        <div className="spark-dots-approval__actions">
          {state === 'pending' && (
            <button type="button" className="spark-dots-approval__deny" onClick={() => declineDotMachine(dotId, item.id)}>
              Not now
            </button>
          )}
          {needsWsl ? (
            <InstallWsl name={name} />
          ) : (
            <button type="button" className="spark-dots-approval__approve" onClick={() => void setUpDotComputer(dotId)}>
              {state === 'failed' ? 'Try again' : 'Set up'}
            </button>
          )}
        </div>
      )}
      {state === 'ready' && (
        <div className="spark-dots-approval__outcome">
          <span>It turns on by itself when {name} needs it.</span>
          <button type="button" className="spark-dots-approval__toggle" onClick={() => openDotComputer(dotId)}>
            Open
          </button>
        </div>
      )}
    </article>
  );
}

const HELP_ENDED: Record<string, string> = {
  returned: 'You handed it back',
  cancelled: 'Dismissed',
  expired: 'This request lapsed',
  interrupted: 'This request ended',
  entered: 'Entered',
};

/** The secret's own little form: what is typed goes to the field on the bot's computer and nowhere else. */
function SecretForm({ dotId, name, item }: { dotId: string; name: string; item: DotItem }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      className="dot-computer-secret"
      onSubmit={(event) => {
        event.preventDefault();
        if (!value) return;
        setBusy(true);
        setProblem(null);
        void enterDotSecret(dotId, item.id, value).then((issue) => {
          setBusy(false);
          setValue('');
          setProblem(issue);
        });
      }}
    >
      <input
        className="dot-computer-secret__input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        aria-label={item.help?.label ?? 'Secret'}
        placeholder={item.help?.label ?? ''}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="spark-dots-approval__actions">
        <button type="button" className="spark-dots-approval__deny" disabled={busy} onClick={() => void dismissDotHelp(dotId, item.id)}>
          Not now
        </button>
        <button type="submit" className="spark-dots-approval__approve" disabled={busy || !value}>
          {busy ? 'Entering…' : 'Enter'}
        </button>
      </div>
      <p className="spark-dots-approval__where">It goes straight into the page on {name}&rsquo;s computer. {name} never sees it.</p>
      {problem && <p className="spark-dots-profile__problem" role="alert">{problem}</p>}
    </form>
  );
}

/** The bot — or a page it was on — asked for a person at its computer. */
export function DotHelpCard({ dotId, name, item, thread }: { dotId: string; name: string; item: DotItem; thread: DotThread }) {
  const view = useView(dotId);
  const help = item.help!;
  const outcome = helpOutcome(thread, item.id);
  const taken = !outcome && (helpTaken(thread, item.id) || (view.control?.request?.id === help.requestId && view.control.request.status === 'taken'));
  const state = outcome?.machineStep ?? (taken ? 'taken' : 'waiting');
  const host = hostOf(help.url);
  const secret = help.kind === 'secret';
  const heading = state === 'waiting'
    ? secret
      ? `${name} needs ${help.label ?? 'a secret'}`
      : help.source === 'model'
        ? `${name} needs your help on its computer`
        : `A page on ${name}'s computer needs a person`
    : state === 'taken'
      ? `You have ${name}'s computer`
      : HELP_ENDED[state] ?? 'Done';

  return (
    <article className={`spark-dots-approval is-${state === 'waiting' ? 'pending' : state === 'taken' ? 'running' : 'done'}`} aria-label={heading}>
      <div className="spark-dots-approval__heading">
        <MonitorSymbol />
        <span>{heading}</span>
      </div>
      {!secret && <p className="spark-dots-approval__reason">{help.reason}</p>}
      {host && <p className="spark-dots-approval__where" title={help.url}>On {host}</p>}
      {secret && state === 'waiting' && <SecretForm dotId={dotId} name={name} item={item} />}
      {!secret && state === 'waiting' && (
        <div className="spark-dots-approval__actions">
          <button type="button" className="spark-dots-approval__deny" onClick={() => void dismissDotHelp(dotId, item.id)}>
            Dismiss
          </button>
          <button type="button" className="spark-dots-approval__approve" disabled={view.busy === 'taking-over'} onClick={() => void takeOverDotComputer(dotId, help.requestId)}>
            Take over
          </button>
        </div>
      )}
      {state === 'taken' && (
        <div className="spark-dots-approval__actions">
          <button type="button" className="spark-dots-approval__deny" onClick={() => openDotComputer(dotId)}>
            Show
          </button>
          <button type="button" className="spark-dots-approval__approve" onClick={() => void handBackDotComputer(dotId)}>
            Go back to {name}
          </button>
        </div>
      )}
      {view.problem && (state === 'waiting' || state === 'taken') && <p className="spark-dots-profile__problem" role="alert">{view.problem}</p>}
    </article>
  );
}

const STATE_WORDS: Record<string, string> = {
  none: 'Not set up',
  creating: 'Setting up…',
  stopped: 'Off',
  starting: 'Turning on…',
  running: 'On',
  stopping: 'Turning off…',
  resetting: 'Resetting…',
};

/**
 * The latest picture of the computer for the profile: the live frame, or its
 * last step since it turned on — and none, so the wallpaper stands in, until
 * its screen is up. A step from an earlier run shows a screen it no longer has.
 */
const usePreview = (dotId: string, view: DotComputerView): string | null => {
  const live = useStore(dotComputerFrames, { keys: [dotId] })[dotId];
  const [shot, setShot] = useState<string | null>(null);
  const screen = view.screen;
  const screenUp = screen?.desktop === 'on' || (screen?.display === 'browser' && screen.browser === 'running');
  const last = view.shots.at(-1);
  const current = screenUp && last && last.at >= (screen?.startedAt ?? Number.POSITIVE_INFINITY) ? last : undefined;
  useEffect(() => {
    let cancelled = false;
    setShot(null);
    if (!current || view.summary?.state !== 'running') return undefined;
    void loadDotShot(dotId, current).then((url) => {
      if (!cancelled && url) setShot(url);
    });
    return () => {
      cancelled = true;
    };
  }, [dotId, current?.id, view.summary?.state]);
  return screenUp ? live?.frame ?? (current ? shot : null) : null;
};

/** The bot's computer's wallpaper, standing in for its screen as Codex's Blue Hour does: the same picture, in the bot's colour. */
const useWallpaper = (dotId: string): CSSProperties | undefined => {
  const dot = useStore(sparkDots).dots.find((entry) => entry.id === dotId);
  const tint = dot ? dotTintHex(dot) : null;
  const found = dot != null;
  return useMemo(() => (found ? { backgroundImage: `url("${dotWallpaperUrl(dotWallpaperColors(tint))}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined), [found, tint]);
};

/** What the row's button says while the computer is between states. */
const WORKING_WORDS: Record<string, string> = {
  'setting-up': 'Setting up…',
  creating: 'Setting up…',
  starting: 'Turning on…',
  stopping: 'Turning off…',
  resetting: 'Resetting…',
};

/**
 * The profile's "<name>'s computer": what it is doing, and in the place of the
 * Connect button beside it, the one thing to do — set it up, turn it on, or, on,
 * its screen, which opens it. Turning off and resetting live in the pane.
 */
export function DotComputerRow({ dotId, name }: { dotId: string; name: string }) {
  const desktop = isDesktopApp();
  const view = useView(dotId);
  const preview = usePreview(dotId, view);
  const wallpaper = useWallpaper(dotId);
  useEffect(() => {
    if (desktop) void refreshDotComputer(dotId);
  }, [desktop, dotId]);

  const state = view.summary?.state ?? 'none';
  const reason = view.status?.reason;
  const known = Boolean(view.status);
  const unavailable = !desktop || reason === 'not-desktop' || reason === 'unsupported-os';
  const host = state === 'running' ? hostOf(view.screen?.url) : '';
  const status = !desktop
    ? 'In the Willow desktop app'
    : !known
      ? 'Checking…'
      : reason === 'unsupported-os'
        ? 'Needs Windows for now'
        : reason === 'unreachable'
          ? 'Starting up…'
          : state === 'creating' || state === 'resetting' || view.busy === 'setting-up'
            ? percent(view)
            : view.control?.holder === 'human'
              ? 'You have it'
              : host
                ? `On · ${host}`
                : STATE_WORDS[state] ?? state;
  const working = WORKING_WORDS[view.busy ?? ''] ?? WORKING_WORDS[state];

  let action: ReactNode;
  if (unavailable || !known || reason === 'unreachable') {
    action = <span className="spark-dots-profile__computer-preview" style={wallpaper} aria-hidden="true" />;
  } else if (working) {
    action = (
      <button type="button" className="spark-dots-profile__toggle" disabled>
        {working}
      </button>
    );
  } else if (state === 'running') {
    action = (
      <button
        type="button"
        className={`spark-dots-profile__computer-preview dot-computer-preview${preview ? ' has-picture' : ''}`}
        style={preview ? undefined : wallpaper}
        aria-label={`Open ${name}'s computer`}
        onClick={() => openDotComputer(dotId)}
      >
        {preview && <img src={preview} alt="" draggable={false} />}
      </button>
    );
  } else if (state === 'none') {
    action = reason === 'wsl-missing' ? (
      <InstallWsl name={name} className="spark-dots-profile__toggle" />
    ) : (
      <button type="button" className="spark-dots-profile__toggle" onClick={() => void setUpDotComputer(dotId)}>
        Set up
      </button>
    );
  } else {
    action = (
      <button type="button" className="spark-dots-profile__toggle" onClick={() => void turnOnDotComputer(dotId)}>
        Turn on
      </button>
    );
  }

  return (
    <>
      <div className="spark-dots-profile__computer">
        <span className={`spark-dots-profile__computer-icon${state === 'running' ? ' is-connected' : ''}`}>
          <DesktopIcon />
        </span>
        <span className="spark-dots-profile__computer-copy">
          <span>{name}&rsquo;s computer</span>
          <span className="spark-dots-profile__muted">{status}</span>
        </span>
        {action}
      </div>
      {view.problem && (
        <p className="spark-dots-profile__problem" role="alert">
          {view.problem}
        </p>
      )}
      <p className="spark-dots-profile__muted spark-dots-profile__note">
        {!desktop
          ? `${name} can have a computer of its own in the Willow desktop app.`
          : state === 'none'
            ? `${name}'s own account on a Linux computer on this PC, to browse and run things without touching yours.`
            : `${name} turns it on whenever it needs it, and it turns off after half an hour unused.`}
      </p>
    </>
  );
}
