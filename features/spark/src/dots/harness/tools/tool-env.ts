/**
 * What every bot tool is built with, and the entry shape a tool module exports.
 */
import type { ReplyContext } from '@willow/personal';
import type { DotComputerBridge } from '../runtime/computer-bridge';
import type { DiscordGuild, DiscordMessage } from '../runtime/discord';
import type { DotMachineBridge } from '../runtime/machine-bridge';
import type { DotMailDeps } from '../runtime/outgoing';
import type { DotToolDoc, DotToolHandler } from '../runtime/protocol';
import type { DotScreenBridge, DotScreenPlatform } from '../runtime/screen-bridge';
import type { DotScreenDeps } from '../runtime/screen-control';
import type { DotVision } from '../runtime/screen-view';
import { getDotThread } from '../thread/thread-store';
import type { DotPermissionMode, DotTriggerType } from '../thread/thread-types';
import type { WatchedTask } from '../triggers/trigger-watch';
import type { SparkTaskHost } from '../../../spark-task-host';

export interface DotToolEnv {
  dotId: string;
  dotName: string;
  timeZone: string;
  now: () => number;
  /** Spark's task host, when the Spark workspace is mounted. Delegation tools need it. */
  host: SparkTaskHost | null;
  /** Whether Willow's Memory switch lets personal data reach the model. */
  personalData: boolean;
  /**
   * How freely the bot acts (its profile's Permissions) as the turn began, for the tools' descriptions: `ask` holds
   * its edits for the user too; `act` runs commands and sends at once, each still shown as a card; `auto`, the
   * default, asks before anything that acts on the world. What a tool does follows `permissionsNow`.
   */
  permissions?: DotPermissionMode;
  /** The desktop app, where Spark tasks can work in a folder on the user's computer. */
  desktop?: boolean;
  /**
   * How the model in use points on a screenshot, and how pictures are drawn for it (`runtime/screen-view.ts`). Without
   * it a screenshot goes as it came, and positions on it are its own pixels.
   */
  vision?: DotVision;
  /** Reading web pages, where this window can (`/api/fetch-source`). */
  web?: { read: (url: string) => Promise<{ text: string; title?: string } | { problem: string }> };
  /**
   * Gmail, when connected: whether the user allowed sending (Settings → Connected Apps), the way a message goes out,
   * and the thread a reply belongs to.
   */
  mail?: { canSend: boolean; deps: DotMailDeps; replyContext: (id: string) => Promise<ReplyContext | { problem: string }> };
  /** The folder on the user's computer the bot may work in — or the whole computer — when connected, and the way to reach it. */
  computer?: { root: string; shell: string; bridge: DotComputerBridge; whole?: boolean; home?: string };
  /**
   * The user's own screen, with their computer connected in the desktop app (`tools/user-screen-tools.ts`), and which
   * system's way it works — Windows' shared desktop, macOS's apps in the background, Linux's desktop of the bot's own.
   * `color` is the bot's, for Windows' overlay.
   */
  /** `waitForUserMs`: how long an action waits out a user at the mouse or keyboard (`patiently`); tests shorten it. */
  screen?: { bridge: DotScreenBridge; deps: DotScreenDeps; platform: DotScreenPlatform; color?: string; waitForUserMs?: number };
  /**
   * The bot's own computer, where this window can have one (the desktop app).
   * `ready` once the user has set it up; before that its tools ask them to.
   */
  machine?: { bridge: DotMachineBridge; ready: boolean };
  /**
   * What triggers can watch in this window: every kind but the ones in `unavailable`, each with the reason in a
   * sentence (an app not connected, a desktop-only source in a browser). `sparkTasks` is Spark's tasks as they are
   * now, which a Spark-task trigger starts out knowing.
   */
  triggers?: { unavailable: Partial<Record<DotTriggerType, string>>; sparkTasks: () => WatchedTask[] };
  /** Discord, when the user made the bot a Discord bot of its own. */
  discord?: DotDiscordAccess;
}

/** The bot's own Discord account, as its `discord` tool reaches it. */
export interface DotDiscordAccess {
  /** Its name on Discord. */
  botName: string;
  /** Discord lets it read whole channels, not only what mentions it. */
  content: boolean;
  /** The servers it is in, with their channels, as its gateway last said. */
  guilds: () => DiscordGuild[];
  /** Its DM with the user, when open. */
  dmChannelId?: string;
  /** Opens the DM with the user if need be. */
  dm: () => Promise<{ channelId: string } | { problem: string }>;
  read: (channelId: string, limit: number, before?: string) => Promise<DiscordMessage[] | { problem: string }>;
  /** A message as the bot reads it. */
  describe: (message: DiscordMessage) => string;
  react: (channelId: string, messageId: string, emoji: string) => Promise<true | { problem: string }>;
  /** Channels the user is writing to the bot from this turn, where its answers go anyway. */
  talking: () => ReadonlySet<string>;
  /** How a post goes out — `post` — and the bot hears about one the user decides on. */
  deps: DotMailDeps;
}

export interface DotToolEntry {
  doc: DotToolDoc;
  handler: DotToolHandler;
}

/** The bot's Permissions at this moment: the user can change them while it works, and a tool honours the change. */
export const permissionsNow = (env: Pick<DotToolEnv, 'dotId' | 'permissions'>): DotPermissionMode =>
  getDotThread(env.dotId)?.runtime.permissions ?? env.permissions ?? 'auto';

export const ok = (observation: string) => ({ observation });
export const fail = (observation: string) => ({ observation, failed: true });

export const stringArg = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};
