/**
 * What a bot is doing, as its status on Discord: a few words while it works, none between turns. A bot's status is
 * the same in every server it is in, and everyone there sees it, so it says what kind of thing the bot is doing and
 * never what about — not the status line the bot writes, not a tool's own words, not an app's name.
 *
 * A change shows once it has held for a moment, so what passes in a moment never does, and words still true are said
 * again now and then: the companion takes down words nobody renews (the window that set them is gone), and sends
 * Discord at most one change in a few seconds (`discord.presence`).
 */
import type { DotActivity } from '../dot-runtime';
import type { DiscordLink, DiscordRelay } from './discord';

/** Each kind of tool, in the words its status shows; a tool on none of these is just working. */
const KINDS: [RegExp, string][] = [
  [/^(user_desktop_\w+|user_(screenshot|elements?|focus_window|open_app|apps|zoom)|computer_desktop_\w+|computer_(navigate|read|snapshot|click|type|key|scroll|screenshot|zoom))$/, 'Using a computer'],
  [/^(user_files|read_file|list_files|search_files|transfer_file|open_attachment|(user|computer)_apply_patch|computer_(list_files|read_file|write_file))$/, 'Working with files'],
  [/^(user_(run_command|start_job|check_job|send_to_job|stop_job)|computer_run_command)$/, 'Running a command'],
  [/^read_web_page$/, 'Reading the web'],
  [/^send_file$/, 'Sending a file'],
  [/^send_email$/, 'Writing an email'],
  [/^discord$/, 'On Discord'],
  [/^computer_request_(help|secret)$/, 'Asking for a hand'],
  [/^(app|mcp):/, 'Using an app'],
  [/^(memory|recall|update_plan|use_skill|create_skill|improve_skill|sleep|trigger)$/, 'Thinking'],
];

/** What the model does with no tool in hand, where it is more than thinking. */
const PHASES: Record<string, string> = {
  'Searching the web': 'Searching the web',
  'Running code': 'Running code',
  'Writing a file': 'Working with files',
};

/** The words a bot's Discord status shows for what it is doing, or null for none. */
export const discordStatusOf = (activity: DotActivity | undefined): string | null => {
  if (!activity?.working) return null;
  if (activity.typingItemId) return 'Writing a reply';
  const tool = activity.tool;
  if (tool) return KINDS.find(([kind]) => kind.test(tool))?.[1] ?? 'Working';
  return (activity.label && PHASES[activity.label]) || 'Thinking';
};

/** How long a change holds before it shows. */
const SETTLE_MS = 1_500;
/** How often words still true are said again; the companion takes down what goes unsaid for five minutes. */
const RENEW_MS = 2 * 60_000;

export interface DiscordPresence {
  /** The bot's activity is now this. */
  update: (dotId: string, activity: DotActivity | undefined) => void;
}

interface Shown {
  wanted: string | null;
  shown: string | null;
  timer?: ReturnType<typeof setTimeout>;
  renew?: ReturnType<typeof setInterval>;
}

export const createDiscordPresence = ({
  relay,
  linkFor,
  settleMs = SETTLE_MS,
  renewMs = RENEW_MS,
}: {
  relay: () => DiscordRelay;
  linkFor: (dotId: string) => DiscordLink | undefined;
  settleMs?: number;
  renewMs?: number;
}): DiscordPresence => {
  const bots = new Map<string, Shown>();
  const send = (link: DiscordLink, words: string | null) => void relay().presence?.(link.token, words).catch(() => undefined);

  /** Shows the words wanted now, where the user lets it; renews them while they are up. */
  const show = (dotId: string, bot: Shown, words: string | null) => {
    const link = linkFor(dotId);
    if (!link) {
      clearInterval(bot.renew);
      bots.delete(dotId);
      return;
    }
    const allowed = link.statusOff ? null : words;
    if (allowed !== bot.shown) {
      bot.shown = allowed;
      send(link, allowed);
    }
    if (allowed && !bot.renew) {
      bot.renew = setInterval(() => {
        const current = linkFor(dotId);
        if (current && !current.statusOff && bot.shown) send(current, bot.shown);
        else show(dotId, bot, null);
      }, renewMs);
      bot.renew.unref?.();
    } else if (!allowed && bot.renew) {
      clearInterval(bot.renew);
      bot.renew = undefined;
    }
  };

  return {
    update(dotId, activity) {
      const wanted = discordStatusOf(activity);
      let bot = bots.get(dotId);
      if (!bot) {
        if (!wanted || !linkFor(dotId)) return;
        bot = { wanted, shown: null };
        bots.set(dotId, bot);
      }
      bot.wanted = wanted;
      if (bot.timer) return;
      const held = bot;
      held.timer = setTimeout(() => {
        held.timer = undefined;
        show(dotId, held, held.wanted);
      }, settleMs);
      held.timer.unref?.();
    },
  };
};
