/**
 * A bot's conversation as rows, as its chat draws them: day separators, bubbles grouped into bursts, the cards between
 * them, and centred marks where the bot reached an app or had the user's screen. Apart from the component, so it can
 * be read, and tested, without a page.
 */
import { decidedCommands } from '../commands/dot-commands';
import { screenState, type ScreenState } from '../harness/runtime/screen-control';
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

/** A line of the conversation's own, centred like a day: an app the bot reached, or the user's screen in its hands. */
export type MarkRow =
  | { type: 'app'; key: string; mark: DotAppMark; turnId?: string; pending: boolean }
  | { type: 'screen'; key: string; item: DotItem; state: Exclude<ScreenState, 'pending'> };

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
 * centred marks where the bot reached an app (`appOf`, once an app a turn) or had the user's screen.
 */
export const chatRows = (
  thread: (Pick<DotThread, 'items'> & Partial<Pick<DotThread, 'runtime'>>) | undefined,
  now: number,
  appOf?: (tool: string | undefined) => DotAppMark | null,
): ChatRow[] => {
  if (!thread) return [];
  const dotReactions = dotReactionsByMessage(thread);
  const userReactions = userReactionsByMessage(thread);
  const decided = decidedCommands(thread);
  const answered = new Set(thread.items.filter((item) => item.kind === 'result' && item.callId).map((item) => item.callId));
  const marked = new Set<string>();
  const rows: ChatRow[] = [];
  let day = '';
  let previous: MessageRow | null = null;
  for (const item of thread.items) {
    const message = isMessage(item);
    const app = item.kind === 'call' && appOf ? appOf(item.tool) : null;
    if (app && marked.has(`${item.turnId}:${app.key}`)) continue;
    if (!message && !isCard(item) && !app) continue;
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
    const screen = item.kind === 'screen' && thread.runtime ? screenState(thread as DotThread, item, now) : null;
    if (screen && screen !== 'pending') {
      rows.push({ type: 'screen', key: item.id, item, state: screen });
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

