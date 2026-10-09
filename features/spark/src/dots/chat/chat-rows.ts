/**
 * A bot's conversation as rows, as its chat draws them: day separators, bubbles grouped into bursts, the cards between
 * them, and centred marks where the bot reached an app or had the user's screen. Apart from the component, so it can
 * be read, and tested, without a page.
 */
import { decidedCommands } from '../commands/dot-commands';
import { activeScreen, screenState } from '../harness/runtime/screen-control';
import { dotReactionsByMessage, userReactionsByMessage } from '../harness/thread/reactions';
import type { DotItem, DotThread } from '../harness/thread/thread-types';
import type { DotAppMark } from './app-marks';

/** Messages from one side closer together than this read as one burst. */
const GROUP_GAP_MS = 5 * 60_000;

export interface MessageRow {
  type: 'message';
  key: string;
  item: DotItem;
  from: 'user' | 'dot';
  joinedAbove: boolean;
  joinedBelow: boolean;
  /** On the user's messages: the bot's reactions. */
  dotReactions: DotItem[];
  /** On the bot's messages: the user's reaction. */
  userReaction: string | null;
}

/** Calls that see or use the user's screen. */
const SCREEN_TOOLS = new Set(['user_screenshot', 'user_zoom', 'user_apps', 'user_elements', 'user_element', 'user_focus_window', 'user_open_app']);
export const isScreenCall = (tool: string | undefined): boolean => Boolean(tool && (SCREEN_TOOLS.has(tool) || tool.startsWith('user_desktop_')));

/**
 * What the user's screen in the bot's hands leaves in the conversation: each turn that used it, at its first look —
 * `using` while that turn is under way and the go-ahead holds, with Stop, and `used` after — then `allowed` for a
 * go-ahead not used yet, `declined`, and `stopped` where the user took it back.
 */
export type ScreenMark = 'using' | 'used' | 'allowed' | 'declined' | 'stopped';

/** A line of the conversation's own, centred like a day: an app the bot reached, or the user's screen in its hands. */
export type MarkRow =
  | { type: 'app'; key: string; mark: DotAppMark; turnId?: string; pending: boolean }
  | { type: 'screen'; key: string; item: DotItem; mark: ScreenMark };

export type ChatRow = { type: 'day'; key: string; label: string } | { type: 'card'; key: string; item: DotItem } | MessageRow | MarkRow;

const isMessage = (item: DotItem) => (item.kind === 'user' || item.kind === 'dot') && Boolean(item.text.trim() || item.streaming || item.attachments?.length);
const isCard = (item: DotItem) =>
  (item.kind === 'approval' && Boolean(item.approval)) || item.kind === 'machine' || (item.kind === 'help' && Boolean(item.help)) || item.kind === 'trigger-card'
  || (item.kind === 'outgoing' && Boolean(item.outgoing || item.discordPost)) || (item.kind === 'edit' && Boolean(item.edit)) || item.kind === 'plan-card'
  || item.kind === 'screen';

const dayKey = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

const DAY = 86_400_000;
const startOfDay = (at: number) => {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** "Today", "Yesterday", a weekday within the week, else the date — a messenger's day labels. */
const dayLabel = (at: number, now: number): string => {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return new Date(at).toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
};


/**
 * The conversation as a messenger shows it: day separators, bubbles grouped into bursts, the cards between them, and
 * centred marks where the bot reached an app (`appOf`, once an app a turn) or had the user's screen. `liveTurn` is the
 * turn under way, if any: only its use of the screen is live.
 */
export const chatRows = (
  thread: (Pick<DotThread, 'items'> & Partial<Pick<DotThread, 'runtime'>>) | undefined,
  now: number,
  appOf?: (tool: string | undefined) => DotAppMark | null,
  liveTurn?: string,
): ChatRow[] => {
  if (!thread) return [];
  const dotReactions = dotReactionsByMessage(thread);
  const userReactions = userReactionsByMessage(thread);
  const decided = decidedCommands(thread);
  const answered = new Set(thread.items.filter((item) => item.kind === 'result' && item.callId).map((item) => item.callId));
  const marked = new Set<string>();

  // Where the screen was used, a turn at a time: the first call that saw or used it while a go-ahead held.
  const screenUse = new Map<string, { turnId: string; request: string }>();
  const allowedRequests = new Set<string>();
  const usedRequests = new Set<string>();
  let grant: string | null = null;
  const usedTurns = new Set<string>();
  for (const item of thread.items) {
    if (item.kind === 'event' && item.event === 'screen' && item.ref) {
      if (item.screenStep === 'allowed') {
        grant = item.ref;
        allowedRequests.add(item.ref);
      } else if ((item.screenStep === 'stopped' || item.screenStep === 'ended') && grant === item.ref) {
        grant = null;
      }
    } else if (item.kind === 'call' && grant && item.turnId && isScreenCall(item.tool) && !usedTurns.has(item.turnId)) {
      usedTurns.add(item.turnId);
      screenUse.set(item.id, { turnId: item.turnId, request: grant });
      usedRequests.add(grant);
    }
  }
  const grantHolds = (request: string) => Boolean(thread.runtime) && activeScreen(thread as DotThread, now)?.itemId === request;

  /** The mark an item about the screen leaves: undefined when it is not one, null when it leaves none. */
  const screenRow = (item: DotItem): MarkRow | null | undefined => {
    const use = item.kind === 'call' ? screenUse.get(item.id) : undefined;
    if (use) return { type: 'screen', key: `screen-use-${item.id}`, item, mark: use.turnId === liveTurn && grantHolds(use.request) ? 'using' : 'used' };
    if (item.kind === 'event' && item.event === 'screen' && item.screenStep === 'stopped') return { type: 'screen', key: `screen-stop-${item.id}`, item, mark: 'stopped' };
    if (item.kind !== 'screen' || !thread.runtime) return undefined;
    const state = screenState(thread as DotThread, item, now);
    if (state === 'pending') return undefined;
    if (state === 'declined') return { type: 'screen', key: item.id, item, mark: 'declined' };
    // A go-ahead shows as its own line only until the screen is used under it, or where it was never used.
    return allowedRequests.has(item.id) && !usedRequests.has(item.id) && state !== 'stopped' ? { type: 'screen', key: item.id, item, mark: 'allowed' } : null;
  };

  const rows: ChatRow[] = [];
  let day = '';
  let previous: MessageRow | null = null;
  for (const item of thread.items) {
    const message = isMessage(item);
    const app = item.kind === 'call' && appOf ? appOf(item.tool) : null;
    if (app && marked.has(`${item.turnId}:${app.key}`)) continue;
    const screen = screenRow(item);
    if (screen === null) continue;
    if (!message && !isCard(item) && !app && !screen) continue;
    if (item.kind === 'approval' && decided.has(item.id)) continue;
    const key = dayKey(item.at);
    if (key !== day) {
      rows.push({ type: 'day', key: `day-${key}`, label: dayLabel(item.at, now) });
      day = key;
      previous = null;
    }
    if (app) {
      marked.add(`${item.turnId}:${app.key}`);
      rows.push({ type: 'app', key: `app-${item.id}`, mark: app, turnId: item.turnId, pending: !answered.has(item.id) });
      previous = null;
      continue;
    }
    if (screen) {
      rows.push(screen);
      previous = null;
      continue;
    }
    if (!message) {
      rows.push({ type: 'card', key: item.id, item });
      previous = null;
      continue;
    }
    const row: MessageRow = {
      type: 'message',
      key: item.id,
      item,
      from: item.kind === 'user' ? 'user' : 'dot',
      joinedAbove: false,
      joinedBelow: false,
      dotReactions: dotReactions.get(item.id) ?? [],
      userReaction: userReactions.get(item.id) ?? null,
    };
    // Reactions hang below a bubble, so a bubble wearing them ends its burst.
    const reacted = previous && (previous.dotReactions.length > 0 || previous.userReaction !== null);
    if (previous && !reacted && previous.from === row.from && item.at - previous.item.at < GROUP_GAP_MS) {
      previous.joinedBelow = true;
      row.joinedAbove = true;
    }
    rows.push(row);
    previous = row;
  }
  return rows;
};

