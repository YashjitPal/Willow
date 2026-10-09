import { useStore } from '@nanostores/react';
import { atom } from 'nanostores';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { isDesktopApp } from '@willow/core/desktop-bridge';
import { skillLibrary } from '@willow/core/skill-library';
import { CONNECTORS, connectionsStore } from '@willow/personal';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { Tooltip } from '@willow/ui/Tooltip';
import { goToSparkTask, sparkTasks } from '../../spark-store';
import { formatSparkRelativeTime } from '../../spark-types';
import { AppearancePicker } from '../character/appearance-picker/appearance-picker';
import { dotComputerFrames, dotComputers, dotComputerView, openDotComputer, setUpDotComputer, turnOnDotComputer, type DotComputerView } from '../computer/dot-computer-store';
import { dotWallpaperColors, dotWallpaperUrl } from '../computer/dot-wallpaper';
import { DiscordLogo, SlackLogo } from '../dot-icons';
import { dotTintHex, useDotTint } from '../dot-tint';
import { prefillSparkDotComposer, setSparkDotCategory, sparkDotName, sparkDots, type SparkDot } from '../dots-store';
import {
  MAX_INSTRUCTIONS,
  installDotMachineSupport,
  pauseDot,
  resumeDot,
  retryDot,
  setDotInstructions,
  setDotNotifications,
  setDotQuietHours,
  setDotResearch,
  setDotTriggerPaused,
  type DotActivity,
} from '../harness/dot-runtime';
import { pendingEdits } from '../harness/runtime/edits';
import { pendingScreenRequests } from '../harness/runtime/screen-control';
import { pendingOutgoing } from '../harness/runtime/outgoing';
import { quietHoursOf } from '../harness/runtime/proactive';
import type { DotDelegation, DotItem, DotThread } from '../harness/thread/thread-types';
import { pendingApprovals } from '../harness/tools/computer-tools';
import { openHelpRequests, pendingSetupRequests } from '../harness/tools/machine-tools';
import { describeWhen } from '../harness/triggers/trigger-spec';
import { triggersOf } from '../harness/triggers/trigger-store';
import { M3Switch } from '../m3/M3Switch';
import { M3_SCOPE } from '../m3/m3';
import { ICONS as TRIGGER_ICONS, TriggerRow, triggerTime } from '../triggers/DotTriggers';
import { DotSkillsAndAppsSection } from './DotSkillsAndApps';
import { DotPhonePushRow } from './DotPhonePush';
import { DotTelegramRow } from './DotTelegram';
import { DotLearnedSection } from './DotLearned';
import { DotPermissionsSection } from './DotPermissions';
import { DotDiscordPage } from './DotDiscord';
import { DotCommandsPage } from '../commands/DotCommands';
import { commandGroups, groupSummary } from '../commands/dot-commands';
import { discordLinks, discordStates } from '../harness/runtime/discord';
import './DotProfilePanel.css';

type ProfileTab = 'overview' | 'activity' | 'settings';
/** A "Works with" row's page, or one trigger's, by id. */
type ProfilePage = 'skills' | 'helpers' | 'discord' | `trigger:${string}` | `commands:${string}`;

const TABS: ReadonlyArray<{ id: ProfileTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];

/** The profile's tab, kept as the user moves between bots and between the docked and the floating profile. */
const profileTab = atom<ProfileTab>('overview');

const ICON = { size: 20, opticalSize: 20, weight: 320 } as const;
const LIST_LIMIT = 3;

const STATUS_WORDS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  'needs-input': 'Needs input',
  complete: 'Done',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
  stopped: 'Stopped',
};

const WORKING_WORDS: Record<string, string> = {
  'setting-up': 'Setting up…',
  creating: 'Setting up…',
  starting: 'Turning on…',
  stopping: 'Turning off…',
  resetting: 'Resetting…',
};

const SUGGESTIONS = [
  { icon: 'wb_twilight', text: 'Brief me every morning' },
  { icon: 'sell', text: 'Watch a price for me' },
  { icon: 'event_repeat', text: 'Sum up my week on Fridays' },
] as const;

const relative = (time: number, now: number) => formatSparkRelativeTime(new Date(time).toISOString(), now);

const clockLabel = (clock: string) => {
  const [hour, minute] = clock.split(':').map(Number);
  return new Date(2000, 0, 1, hour ?? 0, minute ?? 0).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const hostOf = (url: string | undefined): string => {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const lastItem = (thread: DotThread | undefined, matches: (item: DotItem) => boolean): DotItem | undefined => {
  const items = thread?.items ?? [];
  for (let index = items.length - 1; index >= 0; index -= 1) if (matches(items[index]!)) return items[index];
  return undefined;
};

/** The nearest ancestor that scrolls: the docked panel, the floating card, or the full-screen overlay. */
const scrollParentOf = (node: HTMLElement | null): HTMLElement | null => {
  for (let element = node?.parentElement ?? null; element; element = element.parentElement) {
    const { overflowY } = getComputedStyle(element);
    if (overflowY === 'auto' || overflowY === 'scroll') return element;
  }
  return null;
};

/** What the bot waits on the user for, oldest first: commands, changes to files, emails, its computer, a hand at it. */
const asksOf = (thread: DotThread | undefined): DotItem[] =>
  thread ? [...pendingApprovals(thread), ...pendingEdits(thread), ...pendingScreenRequests(thread), ...pendingOutgoing(thread), ...pendingSetupRequests(thread), ...openHelpRequests(thread)].sort((a, b) => a.at - b.at) : [];

const askTitle = (item: DotItem): string => {
  if (item.kind === 'approval') return item.approval?.background ? 'Wants to start a background job' : 'Wants to run a command';
  if (item.kind === 'edit') return item.edit?.proposed?.copy ? 'Wants to copy a file to your computer' : item.edit?.files.length === 1 ? 'Wants to change a file' : 'Wants to change files';
  if (item.kind === 'screen') return 'Wants to use your screen';
  if (item.kind === 'outgoing') return item.discordPost ? 'Wants to post on Discord' : 'Wants to send an email';
  if (item.kind === 'machine') return 'Asks for a computer of its own';
  return 'Needs a hand at its computer';
};

/**
 * The header's status, in a word or two so it always shares a line with the category chip. What the bot says
 * about itself (its "Up next" line) can run long, so it sits in the Now card instead.
 */
const headerStatus = (thread: DotThread | undefined, activity: DotActivity | undefined, asks: DotItem[]): string => {
  const runtime = thread?.runtime;
  if (!runtime) return 'Getting ready';
  if (asks.length) return 'Waiting for you';
  if (activity?.working) return activity.typingItemId ? 'Writing…' : 'Working…';
  if (runtime.status === 'sleeping') return 'Resting';
  if (runtime.status === 'paused') return 'Paused';
  if (runtime.status === 'error') return 'Needs attention';
  return 'Ready to help';
};

const sinceLabel = (at: number, now: number) => {
  const time = triggerTime(at, now);
  return time.startsWith('Today ') ? time.slice('Today '.length) : time;
};

const helpersOf = (thread: DotThread | undefined): DotDelegation[] =>
  (thread?.runtime.delegations ?? []).filter((delegation) => delegation.kind === 'helper').sort((a, b) => b.updatedAt - a.updatedAt);

export interface DotProfilePanelProps {
  dot: SparkDot;
  thread: DotThread | undefined;
  activity: DotActivity | undefined;
  now: number;
  /** The user's own computer, connected from its row in Works with: its folder, its whole computer, its commands. */
  folderAccess: ReactNode;
  /** Puts a floating profile away, so what it points at in the conversation can be seen. */
  onDismiss?: () => void;
}

/**
 * A bot's profile in three tabs: Overview (what it is doing, and what it works with), Activity (what it has
 * scheduled, did and made) and Settings (how it behaves). The character says what state it is in, so nothing
 * else badges it. The two computers act from their rows; the other "Works with" rows open a page for the details.
 */
export function DotProfilePanel({ dot, thread, activity, now, folderAccess, onDismiss }: DotProfilePanelProps) {
  const tab = useStore(profileTab);
  const [page, setPage] = useState<ProfilePage | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const returnScroll = useRef(0);
  const pendingScroll = useRef<number | null>(null);
  const baseId = useId();
  const tint = useDotTint(dot);
  const name = sparkDotName(dot);
  const asks = asksOf(thread);

  useEffect(() => setPage(null), [dot.id]);

  useLayoutEffect(() => {
    if (pendingScroll.current == null) return;
    const scroller = scrollParentOf(rootRef.current);
    if (scroller) scroller.scrollTop = pendingScroll.current;
    pendingScroll.current = null;
  }, [page]);

  const openPage = (next: ProfilePage) => {
    returnScroll.current = scrollParentOf(rootRef.current)?.scrollTop ?? 0;
    pendingScroll.current = 0;
    setPage(next);
  };

  const closePage = () => {
    pendingScroll.current = returnScroll.current;
    setPage(null);
  };

  const selectTab = (next: ProfileTab) => {
    profileTab.set(next);
    // Past the header, the new tab starts under the pinned tab bar rather than wherever the old one was read to.
    const scroller = scrollParentOf(rootRef.current);
    const identity = rootRef.current?.querySelector('.dot-panel__identity');
    if (!scroller || !identity) return;
    const overshoot = identity.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top;
    if (overshoot < 0) scroller.scrollTop += overshoot;
  };

  const review = () => {
    const card = rootRef.current?.closest('.spark-task-detail')?.querySelector<HTMLElement>('.spark-task-detail__conversation :is(.spark-dots-approval.is-pending, .dot-email-card.is-pending, .dot-edit-card.is-pending, .dot-screen-card.is-pending)');
    onDismiss?.();
    if (!card) return;
    window.requestAnimationFrame(() => {
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.querySelector<HTMLElement>('button, md-filled-tonal-button, md-text-button')?.focus({ preventScroll: true });
    });
  };

  return (
    <div ref={rootRef} className={`dot-panel ${M3_SCOPE}`} style={tint}>
      {page ? (
        <ProfilePageView page={page} dot={dot} name={name} thread={thread} now={now} onBack={closePage} />
      ) : (
        <>
          <ProfileIdentity dot={dot} name={name} status={headerStatus(thread, activity, asks)} onDiscord={() => openPage('discord')} />
          <ProfileTabs baseId={baseId} tab={tab} attention={asks.length > 0} onSelect={selectTab} />
          <div key={tab} id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} className="dot-panel__tabpanel">
            {tab === 'overview' && (
              <OverviewTab dot={dot} name={name} thread={thread} activity={activity} now={now} asks={asks} folderAccess={folderAccess} onPage={openPage} onReview={review} />
            )}
            {tab === 'activity' && <ActivityTab dot={dot} name={name} thread={thread} now={now} onPage={openPage} onDismiss={onDismiss} />}
            {tab === 'settings' && <SettingsTab dot={dot} name={name} thread={thread} />}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Header ─────────────────────────────────────────────────────────────── */

function ProfileIdentity({ dot, name, status, onDiscord }: { dot: SparkDot; name: string; status: string; onDiscord: () => void }) {
  const discord = useStore(discordLinks)[dot.id];
  const discordStatus = useStore(discordStates)[dot.id]?.status;
  return (
    <header className="dot-panel__identity">
      <span className="willow-dots dot-panel__avatar">
        <AppearancePicker conversationId={dot.id} variant="hero" />
      </span>
      <span className="willow-dots dot-panel__name">
        <AppearancePicker conversationId={dot.id} variant="name" />
      </span>
      <span className="dot-panel__meta">
        <span className="dot-panel__status">{status}</span>
        <span className="dot-panel__meta-separator" aria-hidden="true" />
        <CategoryChip dot={dot} />
      </span>
      {/* Other ways to reach a bot, as Codex's profile shows them. Discord is wired up; the others say they are coming. */}
      <div className="spark-dots-profile__actions dot-panel__contact" role="group" aria-label={`Contact ${name}`}>
        <ContactButton label={`Call ${name}`} tip="Calls · coming soon">
          <MaterialSymbol name="call" {...ICON} />
        </ContactButton>
        <ContactButton label={`Message ${name} on Slack`} tip="Slack · coming soon">
          <SlackLogo />
        </ContactButton>
        <ContactButton label={`Email ${name}`} tip="Email · coming soon">
          <MaterialSymbol name="mail" {...ICON} />
        </ContactButton>
        <ContactButton
          label={discord ? `${name} on Discord` : `Set up ${name} on Discord`}
          tip={discord ? 'Discord' : 'Set up Discord'}
          onClick={onDiscord}
          className={discord && (discordStatus === 'online' || discordStatus === 'error') ? `has-status is-${discordStatus}` : undefined}
        >
          <DiscordLogo />
        </ContactButton>
      </div>
    </header>
  );
}

/** A way to reach the bot: wired up when it has `onClick`, otherwise shown as coming soon. */
function ContactButton({ label, tip, onClick, className, children }: { label: string; tip: string; onClick?: () => void; className?: string; children: ReactNode }) {
  return (
    <Tooltip content={tip}>
      <button
        type="button"
        className={`spark-dots-profile__action${className ? ` ${className}` : ''}`}
        aria-label={onClick ? label : `${label} (coming soon)`}
        aria-disabled={onClick ? undefined : 'true'}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** The bot's category as a chip under its name, changed from a small menu of the categories made on the Bots list. */
function CategoryChip({ dot }: { dot: SparkDot }) {
  const { categories } = useStore(sparkDots);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Centred under the chip, but kept 16px inside the window: a menu as wide as a long category
  // would pass the edge under a chip near the docked profile's side, or on a phone.
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const anchor = menu?.parentElement;
    if (!open || !menu || !anchor) return;
    const box = anchor.getBoundingClientRect();
    const left = box.left + box.width / 2 - menu.offsetWidth / 2;
    setShift(Math.max(16, Math.min(window.innerWidth - 16 - menu.offsetWidth, left)) - left);
  }, [open, categories]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
      (menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? items?.[0])?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const choose = (category: string | null) => {
    setSparkDotCategory(dot.id, category);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!open) return;
    if (event.key === 'Escape') {
      // Only the menu closes; a floating profile stays open.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <span className="dot-panel__category" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="dot-panel__category-chip"
        aria-label={`Category: ${dot.category ?? 'none'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={dot.category ?? undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="dot-panel__category-label">{dot.category ?? 'No category'}</span>
        <MaterialSymbol name="arrow_drop_down" size={18} opticalSize={20} weight={320} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="spark-task-detail__task-menu dot-panel__category-menu"
          role="menu"
          aria-label="Category"
          style={shift ? { translate: `calc(-50% + ${shift}px) 0`, transformOrigin: `calc(50% - ${shift}px) 0` } : undefined}
        >
          {[null, ...categories].map((category) => (
            <button key={category ?? ''} type="button" role="menuitemradio" aria-checked={dot.category === category} title={category ?? undefined} onClick={() => choose(category)}>
              <span className="dot-panel__menu-check">{dot.category === category && <MaterialSymbol name="check" size={18} opticalSize={20} weight={320} />}</span>
              <span>{category ?? 'No category'}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/* ── Tabs ───────────────────────────────────────────────────────────────── */

function ProfileTabs({ baseId, tab, attention, onSelect }: { baseId: string; tab: ProfileTab; attention: boolean; onSelect: (tab: ProfileTab) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const place = () => {
      const label = list.querySelector<HTMLElement>(`[data-tab="${tab}"] .dot-panel__tab-label`);
      if (!label) return;
      const a = label.getBoundingClientRect();
      const b = list.getBoundingClientRect();
      setIndicator({ left: a.left - b.left, width: a.width });
    };
    place();
    const observer = new ResizeObserver(place);
    list.querySelectorAll('.dot-panel__tab-label').forEach((label) => observer.observe(label));
    return () => observer.disconnect();
  }, [tab]);

  // The indicator lands without sliding in from the start; after that it glides between tabs.
  useEffect(() => {
    if (!indicator || animated) return undefined;
    const frame = window.requestAnimationFrame(() => setAnimated(true));
    return () => window.cancelAnimationFrame(frame);
  }, [indicator, animated]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((entry) => entry.id === tab);
    const next =
      event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index - 1 + TABS.length) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    onSelect(TABS[next]!.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${TABS[next]!.id}"]`)?.focus();
  };

  return (
    <div className="dot-panel__tabs-bar">
      <div ref={listRef} className="dot-panel__tabs" role="tablist" aria-label="Profile" onKeyDown={onKeyDown}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${baseId}-tab-${id}`}
            aria-controls={`${baseId}-panel`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            data-tab={id}
            className="dot-panel__tab"
            onClick={() => onSelect(id)}
          >
            <span className="dot-panel__tab-label">
              {label}
              {id === 'activity' && attention && <span className="dot-panel__tab-dot" aria-hidden="true" />}
            </span>
          </button>
        ))}
        {indicator && (
          <span
            className={`dot-panel__tab-indicator${animated ? ' is-animated' : ''}`}
            style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

/* ── Shared rows ────────────────────────────────────────────────────────── */

const Chevron = () => <MaterialSymbol name="chevron_right" size={20} opticalSize={20} weight={300} className="dot-panel__chevron" />;

function LinkRow({ icon, iconFamily, title, sub, hint, trail, onClick }: { icon: string; iconFamily?: 'luminous'; title: string; sub?: ReactNode; hint?: string; trail?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="dot-panel__row" onClick={onClick}>
      <MaterialSymbol name={icon} {...ICON} family={iconFamily} roundness={iconFamily === 'luminous' ? 100 : undefined} className="dot-panel__row-icon" />
      <span className="dot-panel__row-copy">
        <span className="dot-panel__row-title">{title}</span>
        {sub && (
          <span className="dot-panel__row-sub" title={hint}>
            {sub}
          </span>
        )}
      </span>
      <span className="dot-panel__row-trail">{trail ?? <Chevron />}</span>
    </button>
  );
}

function InfoRow({ icon, title, sub, children }: { icon: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="dot-panel__row">
      <MaterialSymbol name={icon} {...ICON} className="dot-panel__row-icon" />
      <span className="dot-panel__row-copy">
        <span className="dot-panel__row-title">{title}</span>
        {sub && <span className="dot-panel__row-sub">{sub}</span>}
      </span>
      {children}
    </div>
  );
}

/* ── Overview ───────────────────────────────────────────────────────────── */

interface OverviewProps {
  dot: SparkDot;
  name: string;
  thread: DotThread | undefined;
  activity: DotActivity | undefined;
  now: number;
  asks: DotItem[];
  folderAccess: ReactNode;
  onPage: (page: ProfilePage) => void;
  onReview: () => void;
}

function OverviewTab({ dot, name, thread, activity, now, asks, folderAccess, onPage, onReview }: OverviewProps) {
  const runtime = thread?.runtime;
  const next =
    runtime?.status === 'paused'
      ? undefined
      : triggersOf(runtime)
          .filter((trigger) => trigger.status === 'active' && trigger.nextAt != null)
          .sort((a, b) => a.nextAt! - b.nextAt!)[0];
  const helpers = helpersOf(thread);
  const helping = helpers.filter((helper) => helper.status === 'running').length;

  return (
    <>
      <div className="dot-panel__group">
        <NowCard dot={dot} name={name} thread={thread} activity={activity} now={now} asks={asks} onReview={onReview} />
        {next && <LinkRow icon="schedule" title={next.name} sub={`Up next · ${triggerTime(next.nextAt!, now)}`} onClick={() => onPage(`trigger:${next.id}`)} />}
      </div>

      <h3 className="dot-panel__label">Works with</h3>
      <div className="dot-panel__group">
        <ComputerRow dot={dot} name={name} />
        <div className="dot-panel__segment dot-panel__folder-access">{folderAccess}</div>
        <SkillsSummary onOpen={() => onPage('skills')} />
        <AppsSummary onOpen={() => onPage('skills')} />
        <LinkRow icon="group" title="Helpers" sub={helpers.length === 0 ? 'None yet' : helping ? `${helping} working now` : `${helpers.length} recently`} onClick={() => onPage('helpers')} />
      </div>
    </>
  );
}

/**
 * What the bot is doing right now, in words, with the one action that fits: Review what it waits on, Resume it,
 * Try again, or Pause it. While it works the words shimmer, as Gemini's do, rather than wearing a badge.
 */
function NowCard({ dot, name, thread, activity, now, asks, onReview }: { dot: SparkDot; name: string; thread: DotThread | undefined; activity: DotActivity | undefined; now: number; asks: DotItem[]; onReview: () => void }) {
  const runtime = thread?.runtime;
  // One button that pauses and resumes: pausing turns it into play where it is, as a player's does.
  const playPause = (paused: boolean) => (
    <Tooltip content={paused ? `Resume ${name}` : `Pause ${name}`}>
      <button
        type="button"
        className="dot-panel__icon-button"
        aria-label={paused ? `Resume ${name}` : `Pause ${name}`}
        onClick={() => (paused ? resumeDot(dot.id) : pauseDot(dot.id))}
      >
        <MaterialSymbol name={paused ? 'play_arrow' : 'pause'} {...ICON} />
      </button>
    </Tooltip>
  );
  const pause = playPause(false);
  const ask = asks[0];
  let card: { title: string; sub?: string; action?: ReactNode; stacked?: boolean; working?: boolean };

  if (!runtime) {
    card = { title: 'Getting ready' };
  } else if (ask) {
    card = {
      title: askTitle(ask),
      sub: `Waiting since ${sinceLabel(ask.at, now)}`,
      action: (
        <button type="button" className="dot-panel__button" onClick={onReview}>
          Review
        </button>
      ),
      stacked: true,
    };
  } else if (runtime.status === 'paused') {
    card = { title: 'Taking a break', sub: 'No wake-ups or routines until you resume', action: playPause(true) };
  } else if (runtime.status === 'error') {
    card = {
      title: 'Couldn’t finish',
      sub: runtime.lastError ?? 'Something went wrong',
      action: (
        <button type="button" className="dot-panel__button" onClick={() => retryDot(dot.id)}>
          Try again
        </button>
      ),
      stacked: true,
    };
  } else if (activity?.working) {
    const input = lastItem(thread, (item) => item.kind === 'user' || item.kind === 'event');
    const request = input?.kind === 'user' ? input.text.replace(/\s+/g, ' ').trim() : '';
    card = {
      title: activity.typingItemId ? 'Writing a reply' : activity.status ?? activity.label ?? 'Working on it',
      sub: request ? `For “${request.length > 60 ? `${request.slice(0, 59)}…` : request}”` : undefined,
      action: pause,
      working: true,
    };
  } else if (runtime.status === 'sleeping') {
    card = { title: 'Resting', sub: runtime.upNext ?? (runtime.wakeAt ? `Until ${triggerTime(runtime.wakeAt, now)}` : undefined), action: pause };
  } else {
    const last = lastItem(thread, (item) => item.kind === 'dot' || item.kind === 'user');
    const ago = last ? relative(last.at, now) : '';
    const lastActive = !last ? 'Ask anything, or set a routine' : ago === 'Just now' ? 'Active just now' : `Last active ${ago}`;
    card = { title: last ? 'All caught up' : 'Ready when you are', sub: runtime.upNext ?? lastActive, action: pause };
  }

  return (
    <div className={`dot-panel__now${card.stacked ? ' is-stacked' : ''}${card.working ? ' is-working' : ''}`}>
      <div className="dot-panel__now-copy">
        <p className="dot-panel__now-title">{card.title}</p>
        {card.sub && <p className="dot-panel__now-sub">{card.sub}</p>}
      </div>
      {card.action}
      {card.working && <span className="dot-panel__progress" aria-hidden="true" />}
    </div>
  );
}

const progressLine = (view: DotComputerView) => (view.progress ? `${view.progress.detail} · ${Math.round(view.progress.fraction * 100)}%` : 'Starting…');

/**
 * The bot's own computer, acted on from its row: Start when it is off (setting it up the first time), its screen
 * once it is on, which opens it. Turning off and resetting live in the computer's pane.
 */
function ComputerRow({ dot, name }: { dot: SparkDot; name: string }) {
  const desktop = isDesktopApp();
  const view = useStore(dotComputers, { keys: [dot.id] })[dot.id] ?? dotComputerView(dot.id);
  const frame = useStore(dotComputerFrames, { keys: [dot.id] })[dot.id]?.frame ?? null;
  const tint = dotTintHex(dot);
  const wallpaper = useMemo(() => `url("${dotWallpaperUrl(dotWallpaperColors(tint))}")`, [tint]);
  const [installing, setInstalling] = useState(false);
  const state = view.summary?.state ?? 'none';
  const reason = view.status?.reason;
  const working = WORKING_WORDS[view.busy ?? ''] ?? WORKING_WORDS[state];
  const host = state === 'running' ? hostOf(view.screen?.url) : '';

  let sub: string;
  let action: ReactNode = null;
  if (!desktop || reason === 'not-desktop') sub = 'In the Willow desktop app';
  else if (!view.status) sub = 'Checking…';
  else if (reason === 'unsupported-os') sub = 'Needs Windows for now';
  else if (reason === 'unreachable') sub = 'Starting up…';
  else if (working) sub = state === 'creating' || state === 'resetting' || view.busy === 'setting-up' ? progressLine(view) : working;
  else if (state === 'running') {
    sub = view.control?.holder === 'human' ? 'You have it' : host ? `On · ${host}` : 'On';
    action = (
      <Tooltip content={`Open ${name}’s computer`}>
        <button
          type="button"
          className="dot-panel__thumb"
          style={{ backgroundImage: frame ? `url("${frame}")` : wallpaper }}
          aria-label={`Open ${name}’s computer`}
          onClick={() => openDotComputer(dot.id)}
        />
      </Tooltip>
    );
  } else if (state === 'none' && reason === 'wsl-missing') {
    // Without WSL, setting up goes as far as Windows' own installer, which asks for permission and may restart.
    sub = installing ? 'Follow Windows’ prompts, then Start' : 'Needs WSL first';
    if (!installing) {
      action = (
        <button type="button" className="dot-panel__button is-small" onClick={() => void installDotMachineSupport().then(() => setInstalling(true))}>
          Install WSL
        </button>
      );
    }
  } else {
    sub = state === 'none' ? 'Not set up yet' : 'Off';
    const about =
      state === 'none'
        ? `${name}’s own Linux computer on this PC, to browse and run things without touching yours.`
        : `${name} also turns it on by itself when it needs it. It turns off after half an hour unused.`;
    action = (
      <Tooltip content={about}>
        <button type="button" className="dot-panel__button is-small" onClick={() => void (state === 'none' ? setUpDotComputer(dot.id) : turnOnDotComputer(dot.id))}>
          Start
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="dot-panel__segment">
      <InfoRow icon="desktop_windows" title={`${name}’s computer`} sub={sub}>
        {action}
      </InfoRow>
      {view.problem && (
        <p className="dot-panel__segment-note is-problem" role="alert">
          {view.problem}
        </p>
      )}
    </div>
  );
}

function SkillsSummary({ onOpen }: { onOpen: () => void }) {
  const skills = useStore(skillLibrary).filter((skill) => skill.enabled);
  const sub = skills.length === 0 ? 'None turned on' : `${skills[0]!.name}${skills.length > 1 ? ` +${skills.length - 1}` : ''}`;
  return <LinkRow icon="contract" iconFamily="luminous" title="Skills" sub={sub} hint={skills.map((skill) => skill.name).join(', ')} onClick={onOpen} />;
}

function AppsSummary({ onOpen }: { onOpen: () => void }) {
  const { enabled } = useStore(connectionsStore);
  const apps = CONNECTORS.filter((connector) => enabled.includes(connector.id));
  const sub = apps.length === 0 ? 'None connected' : apps.length === 1 ? apps[0]!.label : `${apps.length} connected`;
  return <LinkRow icon="apps" title="Apps" sub={sub} hint={apps.map((app) => app.label).join(', ')} onClick={onOpen} />;
}

/* ── Activity ───────────────────────────────────────────────────────────── */

function ActivityTab({ dot, name, thread, now, onPage, onDismiss }: { dot: SparkDot; name: string; thread: DotThread | undefined; now: number; onPage: (page: ProfilePage) => void; onDismiss?: () => void }) {
  const tasks = useStore(sparkTasks);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const runtime = thread?.runtime;
  const triggers = triggersOf(runtime);
  const delegations = [...(runtime?.delegations ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const requests = delegations.length ? [] : (thread?.items ?? []).filter((item) => item.kind === 'user').slice(-5).reverse();
  const finished = delegations.filter((delegation) => delegation.kind === 'spark-task' && tasks.find((task) => task.id === delegation.id)?.status === 'complete');
  const commands = thread ? commandGroups(thread).map((group) => {
    const { title, status, busy } = groupSummary(thread, group);
    return <LinkRow key={group.key} icon={busy ? 'progress_activity' : 'terminal'} title={title} sub={`${status} · ${relative(group.at, now)}`} onClick={() => onPage(`commands:${group.key}`)} />;
  }) : [];

  if (!triggers.length && !delegations.length && !requests.length && !commands.length) return <EmptyActivity dotId={dot.id} name={name} onDismiss={onDismiss} />;

  const recent: ReactNode[] = [
    ...delegations.map((delegation) => {
      const task = delegation.kind === 'spark-task' ? tasks.find((candidate) => candidate.id === delegation.id) : undefined;
      const word = task ? STATUS_WORDS[task.status] ?? task.status : STATUS_WORDS[delegation.status] ?? delegation.status;
      const icon = delegation.kind === 'spark-task' ? 'bolt' : 'neurology';
      const sub = `${word} · ${relative(delegation.updatedAt, now)}`;
      return task ? (
        <LinkRow key={delegation.id} icon={icon} title={task.title || delegation.title} sub={sub} onClick={() => goToSparkTask(task.id)} />
      ) : (
        <InfoRow key={delegation.id} icon={icon} title={delegation.title} sub={sub} />
      );
    }),
    ...requests.map((request) => <InfoRow key={request.id} icon="chat_bubble" title={request.text} sub={relative(request.at, now)} />),
  ];
  const outputs = finished.map((delegation) => (
    <LinkRow key={delegation.id} icon="description" title={delegation.title} sub={`Done · ${relative(delegation.updatedAt, now)}`} onClick={() => goToSparkTask(delegation.id)} />
  ));
  const toggle = (key: string) => setExpanded((open) => ({ ...open, [key]: !open[key] }));

  return (
    <>
      {triggers.length > 0 && <ScheduledList dotId={dot.id} name={name} thread={thread} onOpen={(triggerId) => onPage(`trigger:${triggerId}`)} />}
      {recent.length > 0 && <ActivityList title="Recent" rows={recent} open={Boolean(expanded.recent)} onToggle={() => toggle('recent')} />}
      {commands.length > 0 && <ActivityList title="Commands" rows={commands} open={Boolean(expanded.commands)} onToggle={() => toggle('commands')} />}
      {outputs.length > 0 && <ActivityList title="Outputs" rows={outputs} open={Boolean(expanded.outputs)} onToggle={() => toggle('outputs')} />}
    </>
  );
}

/** The bot's triggers in a line each, with a switch to pause one; a row opens the trigger's page, with Run now and Delete. */
function ScheduledList({ dotId, name, thread, onOpen }: { dotId: string; name: string; thread: DotThread | undefined; onOpen: (triggerId: string) => void }) {
  const [showEnded, setShowEnded] = useState(false);
  const triggers = triggersOf(thread?.runtime);
  const live = triggers.filter((trigger) => trigger.status !== 'ended');
  const ended = triggers.filter((trigger) => trigger.status === 'ended').sort((a, b) => b.updatedAt - a.updatedAt);
  const shown = showEnded ? [...live, ...ended] : live;

  return (
    <>
      <h3 className="dot-panel__label">
        Scheduled
        {ended.length > 0 && (
          <button type="button" className="dot-panel__label-action" onClick={() => setShowEnded((open) => !open)}>
            {showEnded ? 'Hide completed' : `Completed (${ended.length})`}
          </button>
        )}
      </h3>
      <div className="dot-panel__group">
        {shown.length === 0 && <InfoRow icon="schedule" title="Nothing scheduled" sub={`Ask ${name} to do something on a schedule`} />}
        {shown.map((trigger) => {
          const troubled = trigger.status === 'active' && Boolean(trigger.problem);
          const sub = troubled ? trigger.problem : trigger.status === 'active' ? describeWhen(trigger.when, trigger.timeZone, 'user') : trigger.status === 'paused' ? 'Paused' : 'Ended';
          return (
            <div key={trigger.id} className="dot-panel__row has-control">
              <button type="button" className="dot-panel__row-main" onClick={() => onOpen(trigger.id)}>
                <MaterialSymbol name={TRIGGER_ICONS[trigger.when.type]} {...ICON} className="dot-panel__row-icon" />
                <span className="dot-panel__row-copy">
                  <span className="dot-panel__row-title">{trigger.name}</span>
                  <span className={`dot-panel__row-sub${troubled ? ' is-problem' : ''}`}>{sub}</span>
                </span>
              </button>
              {trigger.status !== 'ended' && (
                <M3Switch
                  selected={trigger.status === 'active'}
                  label={trigger.status === 'active' ? `Pause ${trigger.name}` : `Resume ${trigger.name}`}
                  onToggle={(on) => setDotTriggerPaused(dotId, trigger.id, !on)}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function ActivityList({ title, rows, open, onToggle }: { title: string; rows: ReactNode[]; open: boolean; onToggle: () => void }) {
  return (
    <>
      <h3 className="dot-panel__label">
        {title}
        {rows.length > LIST_LIMIT && (
          <button type="button" className="dot-panel__label-action" onClick={onToggle}>
            {open ? 'Show less' : `See all ${rows.length}`}
          </button>
        )}
      </h3>
      <div className="dot-panel__group">{open ? rows : rows.slice(0, LIST_LIMIT)}</div>
    </>
  );
}

/** A new bot's Activity: one card, with things to ask for that would fill it, instead of a stack of empty sections. */
function EmptyActivity({ dotId, name, onDismiss }: { dotId: string; name: string; onDismiss?: () => void }) {
  return (
    <div className="dot-panel__empty">
      <span className="dot-panel__empty-art" aria-hidden="true">
        <MaterialSymbol name="history" size={28} opticalSize={24} weight={320} />
      </span>
      <p className="dot-panel__empty-title">Nothing here yet</p>
      <p className="dot-panel__empty-text">What {name} has scheduled, what it did and what it made will show up here.</p>
      <div className="dot-panel__suggestions">
        {SUGGESTIONS.map(({ icon, text }) => (
          <button
            key={text}
            type="button"
            className="dot-panel__suggestion"
            onClick={() => {
              prefillSparkDotComposer(dotId, text);
              onDismiss?.();
            }}
          >
            <MaterialSymbol name={icon} size={18} opticalSize={20} weight={320} />
            <span>{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Settings ───────────────────────────────────────────────────────────── */

function SettingsTab({ dot, name, thread }: { dot: SparkDot; name: string; thread: DotThread | undefined }) {
  const runtime = thread?.runtime;
  const paused = runtime?.status === 'paused';
  const notificationsOn = Boolean(runtime?.notifications);
  const quiet = quietHoursOf(runtime);
  const researching = !runtime?.research?.off;
  const [blocked, setBlocked] = useState(false);
  const [timesOpen, setTimesOpen] = useState(false);
  const research = `Every few hours, when you're not busy, ${name} looks through what it can reach for ways to help, and plans work worth doing. Research only looks: acting on what it finds follows ${name}'s permissions.`;

  return (
    <>
      <InstructionsCard dotId={dot.id} name={name} thread={thread} />
      <DotPermissionsSection dotId={dot.id} name={name} thread={thread} />
      <DotLearnedSection dotId={dot.id} name={name} thread={thread} />

      <h3 className="dot-panel__label">Behavior</h3>
      <div className="dot-panel__group">
        <InfoRow icon="autorenew" title="Background work" sub={paused ? 'Paused · replies wait' : 'Wake-ups and routines'}>
          <M3Switch selected={!paused} label="Background work" disabled={!runtime} onToggle={(on) => (on ? resumeDot(dot.id) : pauseDot(dot.id))} />
        </InfoRow>
        <div className="dot-panel__segment">
          <InfoRow icon="notifications" title="Notifications" sub={notificationsOn ? 'When it needs you' : 'Off'}>
            <M3Switch
              selected={notificationsOn}
              label="Notifications"
              disabled={!runtime}
              onToggle={(on) => void setDotNotifications(dot.id, on).then((granted) => setBlocked(on && !granted))}
            />
          </InfoRow>
          {blocked && (
            <p className="dot-panel__segment-note" role="status">
              Notifications are blocked for Willow. Allow them in your system or browser settings, then try again.
            </p>
          )}
          {notificationsOn && <DotPhonePushRow name={name} />}
          <DotTelegramRow dotId={dot.id} name={name} />
        </div>
        <div className="dot-panel__segment">
          <InfoRow
            icon="bedtime"
            title="Quiet hours"
            sub={
              <button type="button" className="dot-panel__times-toggle" disabled={quiet.off} aria-expanded={timesOpen && !quiet.off} onClick={() => setTimesOpen((value) => !value)}>
                {quiet.off ? 'Off' : `${clockLabel(quiet.from)} – ${clockLabel(quiet.to)}`}
                {!quiet.off && <MaterialSymbol name="expand_more" size={16} opticalSize={20} weight={320} />}
              </button>
            }
          >
            <M3Switch
              selected={!quiet.off}
              label="Quiet hours"
              disabled={!runtime}
              onToggle={(on) => {
                setDotQuietHours(dot.id, { ...quiet, off: !on });
                if (!on) setTimesOpen(false);
              }}
            />
          </InfoRow>
          {timesOpen && !quiet.off && (
            <div className="dot-panel__times">
              <label>
                <span>From</span>
                <input type="time" value={quiet.from} onChange={(event) => event.target.value && setDotQuietHours(dot.id, { ...quiet, from: event.target.value })} />
              </label>
              <label>
                <span>Until</span>
                <input type="time" value={quiet.to} onChange={(event) => event.target.value && setDotQuietHours(dot.id, { ...quiet, to: event.target.value })} />
              </label>
            </div>
          )}
        </div>
        <InfoRow
          icon="travel_explore"
          title="Background research"
          sub={
            <>
              Looks, never acts
              <Tooltip content={research}>
                <button type="button" className="dot-panel__info" aria-label="About background research">
                  <MaterialSymbol name="info" size={15} opticalSize={20} weight={320} />
                </button>
              </Tooltip>
            </>
          }
        >
          <M3Switch selected={researching} label="Background research" disabled={!runtime} onToggle={(on) => setDotResearch(dot.id, on)} />
        </InfoRow>
      </div>

      <p className="dot-panel__footnote">Rename, pin or delete {name} from the ⋮ menu at the top.</p>
    </>
  );
}

/**
 * The user's standing instructions, read into the bot's prompt every turn: shown as they are, and edited in place.
 * Changed in another window, they are taken up unless this one is being edited.
 */
function InstructionsCard({ dotId, name, thread }: { dotId: string; name: string; thread: DotThread | undefined }) {
  const saved = thread?.runtime.instructions ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(saved);
  const fieldRef = useRef<HTMLElement>(null);
  const dirty = draft.trim() !== saved.trim();

  useEffect(() => setEditing(false), [dotId]);

  useEffect(() => {
    if (!editing) setDraft(saved);
  }, [saved, editing]);

  useEffect(() => {
    if (!editing) return undefined;
    const frame = window.requestAnimationFrame(() => fieldRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  const cancel = () => {
    setDraft(saved);
    setEditing(false);
  };

  return (
    <div className="dot-panel__group">
      <div className="dot-panel__instructions">
        <div className="dot-panel__instructions-head">
          <span className="dot-panel__instructions-title">
            <MaterialSymbol name="edit_note" {...ICON} className="dot-panel__row-icon" />
            Instructions
          </span>
          {!editing && <md-text-button onClick={() => setEditing(true)}>{saved ? 'Edit' : 'Add'}</md-text-button>}
        </div>
        {editing ? (
          <>
            <md-outlined-text-field
              ref={fieldRef}
              className="dot-panel__instructions-field"
              type="textarea"
              rows={5}
              aria-label={`How ${name} should work with you`}
              placeholder={`What should ${name} always do, never do, or check with you first?`}
              value={draft}
              maxLength={MAX_INSTRUCTIONS}
              onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.stopPropagation();
                cancel();
              }}
            />
            <div className="dot-panel__instructions-actions">
              <md-text-button onClick={cancel}>Cancel</md-text-button>
              <md-filled-tonal-button
                disabled={!dirty}
                onClick={() => {
                  setDotInstructions(dotId, draft);
                  setEditing(false);
                }}
              >
                Save
              </md-filled-tonal-button>
            </div>
          </>
        ) : (
          <p className={`dot-panel__instructions-body${saved ? '' : ' is-empty'}`}>{saved || `Tell ${name} what to always do, never do, or check with you first.`}</p>
        )}
      </div>
    </div>
  );
}

/* ── Pages ──────────────────────────────────────────────────────────────── */

function ProfilePageView({ page, dot, name, thread, now, onBack }: { page: ProfilePage; dot: SparkDot; name: string; thread: DotThread | undefined; now: number; onBack: () => void }) {
  const backRef = useRef<HTMLButtonElement>(null);
  const triggerId = page.startsWith('trigger:') ? page.slice('trigger:'.length) : null;
  const trigger = triggerId == null ? undefined : triggersOf(thread?.runtime).find((candidate) => candidate.id === triggerId);
  const commandsKey = page.startsWith('commands:') ? page.slice('commands:'.length) : null;
  const commandCount = commandsKey == null ? 0 : commandGroups(thread).find((group) => group.key === commandsKey)?.items.length ?? 0;
  const titles = { skills: 'Skills and apps', helpers: 'Helpers', discord: 'Discord' };
  const title = commandsKey != null
    ? commandCount > 1 ? `${commandCount} commands` : 'Command'
    : triggerId == null ? titles[page as keyof typeof titles] : trigger?.name ?? 'Scheduled';
  const helpers = helpersOf(thread);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, [page]);

  // A trigger deleted from its page takes the page with it.
  useEffect(() => {
    if (triggerId != null && trigger == null) onBackRef.current();
  }, [triggerId, trigger]);

  return (
    <section
      className="dot-panel__page"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        // Back to the tabs first; a floating profile closes on the next Escape.
        event.stopPropagation();
        onBack();
      }}
    >
      <div className="dot-panel__page-head">
        <button ref={backRef} type="button" className="dot-panel__back" aria-label="Back" onClick={onBack}>
          <MaterialSymbol name="arrow_back" size={20} opticalSize={20} weight={350} />
        </button>
        <h3 className="dot-panel__page-title">{title}</h3>
      </div>

      {trigger && (
        <div className="dot-panel__page-card">
          <TriggerRow dotId={dot.id} trigger={trigger} now={now} />
        </div>
      )}
      {commandsKey != null && <DotCommandsPage dotId={dot.id} name={name} thread={thread} groupKey={commandsKey} />}
      {page === 'discord' && <DotDiscordPage dotId={dot.id} name={name} thread={thread} />}
      {page === 'skills' && (
        <div className="dot-panel__page-card">
          <DotSkillsAndAppsSection dotId={dot.id} name={name} sendTo={thread?.runtime.sendTo} />
        </div>
      )}
      {page === 'helpers' &&
        (helpers.length ? (
          <div className="dot-panel__group">
            {helpers.map((helper) => (
              <InfoRow key={helper.id} icon="neurology" title={helper.title} sub={`${STATUS_WORDS[helper.status] ?? helper.status} · ${relative(helper.updatedAt, now)}`} />
            ))}
          </div>
        ) : (
          <div className="dot-panel__empty">
            <span className="dot-panel__empty-art" aria-hidden="true">
              <MaterialSymbol name="group" size={28} opticalSize={24} weight={320} />
            </span>
            <p className="dot-panel__empty-title">No helpers yet</p>
            <p className="dot-panel__empty-text">When {name} splits big work into pieces, the helpers it starts show up here, each with what it’s doing.</p>
          </div>
        ))}
    </section>
  );
}
