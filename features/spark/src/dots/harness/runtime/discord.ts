/**
 * A bot on Discord. The user makes it a Discord bot of its own — an application in Discord's Developer Portal, added
 * to a server they are in — and talks to it there: in a DM, or by mentioning it in a server. It answers where they
 * wrote, as the same bot with the same memory. Only the application's owner directs it; what anyone else writes
 * reaches it as information, through its triggers and its `discord` tool.
 *
 * Discord's API refuses browsers and its gateway has to stay connected, so both go through Willow's companion
 * (`discord.call`, `discord.next`). One window runs each bot's gateway, holding a lock; how far it has read is kept
 * here, in this computer's storage with the token, so another window carries on where it stopped. Neither is ever
 * written into the bot's thread, which a connected folder keeps a copy of.
 */
import { atom } from 'nanostores';
import { formatStamp } from '../memory/render';
import type { DotDiscordSource, DotItem } from '../thread/thread-types';

export interface DiscordLink {
  token: string;
  appId: string;
  botId: string;
  botName: string;
  botAvatar?: string;
  /** The user's own Discord account: the application's owner. Only they direct the bot there. */
  ownerId: string;
  ownerName?: string;
  /** Discord lets the bot read whole channels: Message Content Intent is on for the application. */
  content: boolean;
  /** Anyone with its invite link can add it to a server: Public Bot is on for the application. */
  public?: boolean;
  /** The DM between the bot and the user, once Discord lets it open (they share a server). */
  dmChannelId?: string;
  /** How its picture and name there follow the bot's look here. */
  look?: DiscordLook;
  linkedAt: number;
}

/** The Discord bot wearing the bot's own look: what it was last given, and what stopped it, when something did. */
export interface DiscordLook {
  /** The user turned it off: whatever the bot wears on Discord stays as it is. */
  off?: boolean;
  /** The look its picture was last made from, or tried and refused for. */
  avatarKey?: string;
  /** The wallpaper its banner was last made from, or tried and refused for. */
  bannerKey?: string;
  /** The name last given it, or tried and refused. */
  name?: string;
  /** Discord asked to wait: nothing more is sent before then. */
  waitUntil?: number;
  problem?: string;
  /** When it last took a change. */
  at?: number;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parentId?: string;
}

export interface DiscordGuild {
  id: string;
  name: string;
  channels: DiscordChannel[];
}

export interface DiscordMessage {
  id: string;
  channelId: string;
  /** Null in a DM. */
  guildId: string | null;
  guildName?: string;
  channelName?: string;
  /** A thread's channel. */
  parentName?: string;
  author: { id: string; username: string; name: string; bot: boolean };
  content: string;
  at: number;
  mentions: string[];
  everyone: boolean;
  replyTo?: { id: string; authorId?: string };
  attachments: { name: string; url: string; type?: string; size?: number }[];
  webhook: boolean;
  type: number;
}

export interface DiscordReaction {
  added: boolean;
  userId: string;
  channelId: string;
  messageId: string;
  guildId: string | null;
  emoji: string;
}

export type DiscordEvent = { seq: number; type: 'message'; data: DiscordMessage } | { seq: number; type: 'reaction'; data: DiscordReaction };

export type DiscordConnection = 'connecting' | 'online' | 'offline' | 'error';

/** What the companion's gateway says when asked what arrived. */
export interface DiscordNext {
  epoch: string;
  after: number;
  events: DiscordEvent[];
  state: DiscordConnection;
  problem?: string;
  user: { id: string; username: string } | null;
  content: boolean;
  contentRefused: boolean;
  guildsVersion: number;
  /** Only when the servers changed since the copy the window has. */
  guilds?: DiscordGuild[];
}

export type DiscordMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Discord's API, as Willow's companion relays it. */
export interface DiscordRelay {
  call: <T>(token: string, method: DiscordMethod, path: string, options?: { body?: unknown; query?: Record<string, string | number> }) => Promise<{ status: number; body: T }>;
  next: (token: string, options: { after?: number; epoch?: string; guildsVersion?: number; content: boolean; waitMs: number }) => Promise<DiscordNext>;
  close: (token: string) => Promise<void>;
}

/** How far one window's gateway run got, what it last heard of the connection, and where the bot's messages went. */
export interface DiscordGatewayState {
  epoch?: string;
  after?: number;
  guildsVersion?: number;
  status: DiscordConnection;
  problem?: string;
  guilds: DiscordGuild[];
  contentRefused?: boolean;
  /** The bot's messages on Discord, newest last, each with the item it mirrors: how a reaction there finds its message. */
  sent: [string, string][];
  /** What the user wrote elsewhere, quoted in the DM: each item with its quote, for the bot's reactions to land on. */
  quoted?: [string, string][];
  updatedAt: number;
}

/* ------------------------------------------------------------------------ */
/* Storage                                                                   */
/* ------------------------------------------------------------------------ */

const LINKS_KEY = 'willow:dots:discord';
const STATE_KEY = 'willow:dots:discord-state';
const KEPT_SENT = 200;
const TOKEN = /^[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$/;

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null') as T | null;
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown): void => {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private or embedded contexts; the link lasts for the session.
  }
};

const readLinks = (): Record<string, DiscordLink> => {
  const saved = readJson<Record<string, DiscordLink>>(LINKS_KEY, {});
  return Object.fromEntries(Object.entries(saved).filter(([, link]) => link && TOKEN.test(link.token) && typeof link.ownerId === 'string' && typeof link.botId === 'string'));
};

/** Each bot's Discord bot, by bot id. */
export const discordLinks = atom<Record<string, DiscordLink>>(readLinks());
/** Each linked bot's gateway, as the window running it last heard. */
export const discordStates = atom<Record<string, DiscordGatewayState>>(readJson(STATE_KEY, {}));

// Another window linking a bot, or the window running a gateway hearing from it, shows here too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === LINKS_KEY) discordLinks.set(readLinks());
    if (event.key === STATE_KEY) discordStates.set(readJson(STATE_KEY, {}));
  });
}

export const discordLinkFor = (dotId: string): DiscordLink | undefined => discordLinks.get()[dotId];

/*
 * Every window may change these — the one reading a bot's gateway, the one running its turn, the one the user types
 * in — so a change is made to what storage holds now, not to this window's copy, which another may have moved on.
 */
const storedLinks = (): Record<string, DiscordLink> => (globalThis.localStorage ? readLinks() : discordLinks.get());
const storedStates = (): Record<string, DiscordGatewayState> => (globalThis.localStorage ? readJson(STATE_KEY, {}) : discordStates.get());

export const setDiscordLink = (dotId: string, link: DiscordLink | null): void => {
  const { [dotId]: _old, ...rest } = storedLinks();
  const next = link ? { ...rest, [dotId]: link } : rest;
  discordLinks.set(next);
  writeJson(LINKS_KEY, next);
  if (!link) {
    const { [dotId]: _state, ...states } = storedStates();
    discordStates.set(states);
    writeJson(STATE_KEY, states);
  }
};

/** Changes a bot's link as storage holds it now, if it still has one. */
export const updateDiscordLink = (dotId: string, change: (link: DiscordLink) => DiscordLink): DiscordLink | null => {
  const link = storedLinks()[dotId];
  if (!link) return null;
  const next = change(link);
  setDiscordLink(dotId, next);
  return next;
};

const EMPTY_STATE: DiscordGatewayState = { status: 'connecting', guilds: [], sent: [], updatedAt: 0 };

export const discordStateFor = (dotId: string): DiscordGatewayState => discordStates.get()[dotId] ?? EMPTY_STATE;

export const patchDiscordState = (dotId: string, patch: Partial<DiscordGatewayState> | ((state: DiscordGatewayState) => Partial<DiscordGatewayState>), now = Date.now()): void => {
  const states = storedStates();
  const current = states[dotId] ?? EMPTY_STATE;
  const next = { ...states, [dotId]: { ...current, ...(typeof patch === 'function' ? patch(current) : patch), updatedAt: now } };
  discordStates.set(next);
  writeJson(STATE_KEY, next);
};

/** Remembers which item the bot's Discord messages mirror. */
export const rememberSent = (dotId: string, messageIds: string[], itemId: string): void => {
  if (!messageIds.length) return;
  patchDiscordState(dotId, (state) => ({ sent: [...state.sent, ...messageIds.map((id): [string, string] => [id, itemId])].slice(-KEPT_SENT) }));
};

/** Remembers the DM's quote of something the user wrote elsewhere. */
export const rememberQuoted = (dotId: string, itemId: string, messageId: string): void => {
  patchDiscordState(dotId, (state) => ({ quoted: [...(state.quoted ?? []), [itemId, messageId] as [string, string]].slice(-KEPT_SENT) }));
};

/* ------------------------------------------------------------------------ */
/* Setting it up                                                             */
/* ------------------------------------------------------------------------ */

export const DISCORD_PORTAL = 'https://discord.com/developers/applications';

/**
 * What the bot asks for when it is added to a server: to see channels and their history, write, reply in threads,
 * embed links, attach files and react — and nothing that manages a server.
 */
export const DISCORD_PERMISSIONS = String([6, 10, 11, 14, 15, 16].reduce((sum, bit) => sum + 2 ** bit, 0) + 2 ** 38);

export const normalizeDiscordToken = (value: string): string => value.trim().replace(/^["']|["']$/g, '').replace(/^Bot\s+/i, '');

export const isDiscordToken = (value: string): boolean => TOKEN.test(normalizeDiscordToken(value));

export const discordInviteUrl = (link: Pick<DiscordLink, 'appId'>): string =>
  `https://discord.com/oauth2/authorize?client_id=${link.appId}&scope=bot&permissions=${DISCORD_PERMISSIONS}`;

export const discordBotPageUrl = (link: Pick<DiscordLink, 'appId'>): string => `${DISCORD_PORTAL}/${link.appId}/bot`;

/** The DM with the bot, or its profile, from which Discord offers one, until the DM is open. */
export const discordDmUrl = (link: Pick<DiscordLink, 'dmChannelId' | 'botId'>): string =>
  link.dmChannelId ? `https://discord.com/channels/@me/${link.dmChannelId}` : `https://discord.com/users/${link.botId}`;

export const discordAvatarUrl = (link: Pick<DiscordLink, 'botId' | 'botAvatar'>): string => {
  if (link.botAvatar) return `https://cdn.discordapp.com/avatars/${link.botId}/${link.botAvatar}.png?size=96`;
  let index = 0;
  try {
    index = Number((BigInt(link.botId) >> BigInt(22)) % BigInt(6));
  } catch {
    index = 0;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
};

interface ApiUser {
  id?: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
}

interface ApiApplication {
  id?: string;
  name?: string;
  flags?: number;
  bot_public?: boolean;
  owner?: ApiUser;
  team?: { owner_user_id?: string; members?: { user?: ApiUser }[] } | null;
}

/** GATEWAY_MESSAGE_CONTENT, and its _LIMITED twin that an application in fewer than 100 servers gets from the switch. */
const CONTENT_FLAGS = 2 ** 18 + 2 ** 19;

export const contentAllowed = (flags: unknown): boolean => typeof flags === 'number' && (flags & CONTENT_FLAGS) !== 0;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A failure to reach the companion, in words the user can act on. */
export const discordUnreachable = (error: unknown): string => {
  const message = errorText(error);
  if (/not running|unavailable|disconnected|timed out/i.test(message)) return 'Willow can’t reach Discord from here. Discord works in the Willow desktop app.';
  if (/Unknown companion request/i.test(message)) return 'This computer’s Willow companion is out of date. Update Willow, then try again.';
  return message;
};

/** Reads a token's bot and application: who the bot is, who owns it (the user), and what it may read. */
export const verifyDiscordToken = async (raw: string, relay: DiscordRelay, now: number): Promise<DiscordLink | { problem: string }> => {
  const token = normalizeDiscordToken(raw);
  if (!TOKEN.test(token)) return { problem: 'That isn’t a bot token. On the Bot page of the Discord application, choose Reset Token and copy what it shows.' };
  try {
    const [me, app] = await Promise.all([
      relay.call<ApiUser>(token, 'GET', '/users/@me'),
      relay.call<ApiApplication>(token, 'GET', '/oauth2/applications/@me'),
    ]);
    if (me.status === 401 || app.status === 401) return { problem: 'Discord didn’t accept that token. Reset it on the Bot page and paste the new one.' };
    if (me.status !== 200 || app.status !== 200 || !me.body?.id || !app.body?.id) return { problem: `Discord didn’t answer as expected (${me.status === 200 ? app.status : me.status}). Try again in a minute.` };
    const team = app.body.team;
    const owner = team?.owner_user_id
      ? { id: team.owner_user_id, name: team.members?.find((member) => member.user?.id === team.owner_user_id)?.user }
      : { id: app.body.owner?.id, name: app.body.owner };
    if (!owner.id) return { problem: 'Discord didn’t say who owns this application, so Willow can’t tell which account is yours.' };
    return {
      token,
      appId: app.body.id,
      botId: me.body.id,
      botName: me.body.username || app.body.name || 'bot',
      ...(me.body.avatar ? { botAvatar: me.body.avatar } : {}),
      ownerId: owner.id,
      ...(owner.name?.global_name || owner.name?.username ? { ownerName: owner.name.global_name || owner.name.username } : {}),
      content: contentAllowed(app.body.flags),
      ...(app.body.bot_public ? { public: true } : {}),
      linkedAt: now,
    };
  } catch (error) {
    return { problem: discordUnreachable(error) };
  }
};

/** The application's switches as they are now — the user may have changed them in Discord since it was linked. */
export const readAppSettings = async (link: DiscordLink, relay: DiscordRelay): Promise<Pick<DiscordLink, 'content' | 'public'> | null> => {
  try {
    const app = await relay.call<ApiApplication>(link.token, 'GET', '/oauth2/applications/@me');
    return app.status === 200 ? { content: contentAllowed(app.body?.flags), public: Boolean(app.body?.bot_public) } : null;
  } catch {
    return null;
  }
};

interface ApiError {
  code?: number;
  message?: string;
  retry_after?: number;
}

/** Why Discord refused, in a sentence the bot can pass on. */
export const discordProblem = (reply: { status: number; body: unknown }): string => {
  const body = (reply.body && typeof reply.body === 'object' ? reply.body : {}) as ApiError;
  if (body.code === 50007 || body.code === 50278) return 'Discord won’t deliver it: the bot can message only people it shares a server with, who haven’t turned off messages from it.';
  if (body.code === 50001 || reply.status === 404 || body.code === 10003) return 'The bot can’t see that channel: it isn’t in it, or the channel is gone.';
  if (body.code === 50013) return 'The bot isn’t allowed to do that in that channel. The server’s settings decide what it may do there.';
  if (reply.status === 401) return 'Discord no longer accepts the bot’s token. The user can connect it again from the Discord button in the bot’s profile.';
  if (reply.status === 429) return `Discord is limiting how fast the bot acts${body.retry_after ? `; try again in ${Math.ceil(body.retry_after)} seconds` : ''}.`;
  return body.message ? `Discord refused: ${body.message}` : `Discord refused (${reply.status}).`;
};

/* ------------------------------------------------------------------------ */
/* Its look                                                                  */
/* ------------------------------------------------------------------------ */

/** The bot's name as Discord takes a bot's: 2 to 32 characters, none of the few it keeps for itself. Else null. */
export const discordUsername = (name: string | null | undefined): string | null => {
  const value = (name ?? '').trim().replace(/\s+/g, ' ');
  if (value.length < 2 || value.length > 32) return null;
  if (/[@#:]|```|discord|clyde/i.test(value) || /^(everyone|here)$/i.test(value)) return null;
  return value;
};

export interface DiscordLookWanted {
  /** The bot's character and colour, as a fingerprint; null when it has none to draw. */
  avatarKey: string | null;
  /** Its wallpaper, as a fingerprint. */
  bannerKey: string | null;
  /** Its name as Discord takes it, or null when Discord would not take it. */
  name: string | null;
}

/**
 * What has to change on Discord for the bot to look there as it does here — its picture, its banner, its name — or null
 * when nothing does, the user turned it off, or Discord asked to wait. A change already tried and refused is not tried
 * again until the look changes once more.
 */
export const discordLookPlan = (link: DiscordLink, wanted: DiscordLookWanted, now: number): { avatar: boolean; banner: boolean; name: string | null } | null => {
  const look = link.look ?? {};
  if (look.off || (look.waitUntil ?? 0) > now) return null;
  const avatar = Boolean(wanted.avatarKey) && wanted.avatarKey !== look.avatarKey;
  const banner = Boolean(wanted.bannerKey) && wanted.bannerKey !== look.bannerKey;
  const name = wanted.name && wanted.name !== link.botName && wanted.name !== look.name ? wanted.name : null;
  return avatar || banner || name ? { avatar, banner, name } : null;
};

/** The line under "Looks like {name}" on the bot's Discord page. */
export const describeDiscordLook = (link: DiscordLink, name: string, busy: boolean, now: number): string => {
  const look = link.look ?? {};
  if (look.off) return 'Its picture, banner and name on Discord stay as they are';
  if (busy) return 'Updating it on Discord…';
  if ((look.waitUntil ?? 0) > now) {
    const at = new Date(look.waitUntil!).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${look.problem ?? 'Discord asked Willow to wait.'} Willow tries again at ${at}.`;
  }
  if (look.problem) return look.problem;
  return `Its picture, banner and name on Discord follow ${name}’s here`;
};

interface ProfileError extends ApiError {
  errors?: unknown;
}

/** How long to wait when Discord says a bot is changing its picture or name too often, without saying for how long. */
export const LOOK_RATE_WAIT_MS = 30 * 60_000;

/** What the bot wears on Discord once a change has gone through. */
export interface DiscordProfile {
  avatar: string | null;
  banner: string | null;
  username: string;
}

/** Why Discord refused a change to the bot's look, with when to try again when it asked to wait, and what it refused. */
export interface DiscordProfileRefusal {
  problem: string;
  waitUntil?: number;
  /** Discord would not take the banner, though the rest may go without it. */
  banner?: boolean;
}

/**
 * Gives the bot a new picture or banner (data URLs) or name on Discord. Resolves to what it wears now, or to why not —
 * with when to try again, when Discord asked to wait.
 */
export const setDiscordProfile = async (
  link: DiscordLink,
  relay: DiscordRelay,
  change: { avatar?: string; banner?: string; username?: string },
  now: number,
): Promise<DiscordProfile | DiscordProfileRefusal> => {
  const reply = await relay.call<ApiUser & ProfileError & { banner?: string | null }>(link.token, 'PATCH', '/users/@me', { body: change });
  if (reply.status === 200 && reply.body?.id) return { avatar: reply.body.avatar ?? null, banner: reply.body.banner ?? null, username: reply.body.username || link.botName };
  const body = (reply.body && typeof reply.body === 'object' ? reply.body : {}) as ProfileError;
  const what = change.avatar ? 'picture' : change.banner ? 'banner' : 'name';
  if (reply.status === 429) {
    return { problem: `Discord is limiting how often the bot can change its ${what}.`, waitUntil: now + Math.ceil(Math.max(body.retry_after ?? 60, 1) * 1_000) };
  }
  const reasons = JSON.stringify(body.errors ?? '');
  if (/RATE_LIMIT/.test(reasons)) return { problem: `Discord limits how often a bot’s ${what} changes.`, waitUntil: now + LOOK_RATE_WAIT_MS };
  if (/USERNAME_TOO_MANY_USERS/.test(reasons)) return { problem: 'Too many accounts on Discord have that name for the bot to take it.' };
  if (/USERNAME|BASE_TYPE_BAD_LENGTH/.test(reasons)) return { problem: 'Discord doesn’t allow that name for a bot.' };
  if (change.banner && /"banner"|BANNER/.test(reasons)) return { problem: 'Discord didn’t take the banner.', banner: true };
  if (/AVATAR|IMAGE|FILE/.test(reasons)) return { problem: 'Discord didn’t take the picture.' };
  return { problem: discordProblem(reply) };
};

/** Opens the DM between the bot and the user, which Discord allows once they share a server. */
export const openDiscordDm = async (link: DiscordLink, relay: DiscordRelay): Promise<{ channelId: string } | { problem: string }> => {
  const reply = await relay.call<{ id?: string } & ApiError>(link.token, 'POST', '/users/@me/channels', { body: { recipient_id: link.ownerId } });
  return reply.status === 200 && reply.body?.id ? { channelId: reply.body.id } : { problem: discordProblem(reply) };
};

/* ------------------------------------------------------------------------ */
/* What arrives                                                              */
/* ------------------------------------------------------------------------ */

/** "#general in Willow Club"; a thread with its channel. Nothing for a DM. */
export const whereOf = (message: Pick<DiscordMessage, 'guildId' | 'guildName' | 'channelName' | 'parentName'>): string | undefined => {
  if (!message.guildId) return undefined;
  const channel = message.channelName ? `#${message.channelName}` : 'a channel';
  const place = message.parentName ? `${channel} (a thread in #${message.parentName})` : channel;
  return message.guildName ? `${place} in ${message.guildName}` : place;
};

export type DiscordInbound =
  /** The user wrote to the bot: in its DM, or mentioning or answering it in a server. */
  | { kind: 'user'; text: string; source: DotDiscordSource }
  /** Anything else the bot can see, for its triggers. */
  | { kind: 'heard'; message: DiscordMessage; mentionsBot: boolean }
  /** The user reacted to one of the bot's messages there. */
  | { kind: 'reaction'; itemId: string; emoji: string; added: boolean }
  | { kind: 'ignore' };

const withAttachments = (text: string, message: DiscordMessage): string =>
  message.attachments.length ? `${text}${text ? '\n' : ''}(attached on Discord: ${message.attachments.map((file) => file.name).join(', ')})` : text;

/** Sorts one gateway event: the user's words for the bot, a reaction of theirs, or something for its triggers. */
export const classifyDiscordEvent = (link: DiscordLink, event: DiscordEvent, sent: ReadonlyMap<string, string>): DiscordInbound => {
  if (event.type === 'reaction') {
    const itemId = sent.get(event.data.messageId);
    return event.data.userId === link.ownerId && itemId && event.data.emoji ? { kind: 'reaction', itemId, emoji: event.data.emoji, added: event.data.added } : { kind: 'ignore' };
  }
  const message = event.data;
  if (message.author.id === link.botId) return { kind: 'ignore' };
  const mentionsBot = message.mentions.includes(link.botId) || message.replyTo?.authorId === link.botId;
  if (message.author.id === link.ownerId && !message.webhook && (!message.guildId || mentionsBot)) {
    const said = message.content.replace(new RegExp(`<@!?${link.botId}>`, 'g'), ' ').replace(/[ \t]{2,}/g, ' ').trim();
    const text = withAttachments(said, message);
    if (!text) return { kind: 'ignore' };
    const where = whereOf(message);
    return { kind: 'user', text, source: { channelId: message.channelId, messageId: message.id, ...(message.guildId ? { guildId: message.guildId } : {}), ...(where ? { where } : {}) } };
  }
  return { kind: 'heard', message, mentionsBot };
};

/** One message as the bot reads it, in the channel's order: id, time, who, what. */
export const describeDiscordMessage = (message: DiscordMessage, link: Pick<DiscordLink, 'ownerId' | 'botId'>, timeZone: string): string => {
  const who = message.author.id === link.botId
    ? 'you'
    : `${message.author.name || message.author.username}${message.author.id === link.ownerId ? ' (the user)' : message.author.bot ? ' [bot]' : ''}`;
  const reply = message.replyTo ? ` replying to ${message.replyTo.id}` : '';
  const text = message.content.replace(/\s+/g, ' ').trim();
  const shown = text.length > 800 ? `${text.slice(0, 799)}…` : text;
  const files = message.attachments.length ? ` [attached: ${message.attachments.map((file) => file.name).join(', ')}]` : '';
  return `[${message.id}] ${formatStamp(message.at, timeZone)} ${who}${reply}: ${shown || (files ? '' : '(nothing Willow can read)')}${files}`;
};

interface ApiMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author?: ApiUser;
  content?: string;
  timestamp?: string;
  mentions?: ApiUser[];
  mention_everyone?: boolean;
  type?: number;
  message_reference?: { message_id?: string };
  referenced_message?: { author?: ApiUser } | null;
  attachments?: { filename?: string; url?: string; content_type?: string; size?: number }[];
  webhook_id?: string;
}

/** A message from Discord's REST API, in the gateway's shape. */
export const messageFromApi = (data: ApiMessage, place: Pick<DiscordMessage, 'guildId' | 'guildName' | 'channelName' | 'parentName'>): DiscordMessage => ({
  id: data.id,
  channelId: data.channel_id,
  ...place,
  author: { id: data.author?.id ?? '', username: data.author?.username ?? '', name: data.author?.global_name || data.author?.username || '', bot: Boolean(data.author?.bot) },
  content: String(data.content ?? ''),
  at: Date.parse(data.timestamp ?? '') || 0,
  mentions: (data.mentions ?? []).map((user) => user.id ?? '').filter(Boolean),
  everyone: Boolean(data.mention_everyone),
  ...(data.type === 19 && data.message_reference?.message_id ? { replyTo: { id: data.message_reference.message_id, ...(data.referenced_message?.author?.id ? { authorId: data.referenced_message.author.id } : {}) } } : {}),
  attachments: (data.attachments ?? []).map((file) => ({ name: file.filename ?? 'file', url: file.url ?? '', ...(file.content_type ? { type: file.content_type } : {}), ...(file.size ? { size: file.size } : {}) })),
  webhook: Boolean(data.webhook_id),
  type: data.type ?? 0,
});

/** Where a channel is, from the servers the gateway knows: its name, its thread's channel, its server. */
export const placeOf = (guilds: readonly DiscordGuild[], channelId: string): Pick<DiscordMessage, 'guildId' | 'guildName' | 'channelName' | 'parentName'> => {
  for (const guild of guilds) {
    const channel = guild.channels.find((entry) => entry.id === channelId);
    if (!channel) continue;
    const parent = channel.parentId ? guild.channels.find((entry) => entry.id === channel.parentId) : undefined;
    return { guildId: guild.id, guildName: guild.name, channelName: channel.name, ...(parent ? { parentName: parent.name } : {}) };
  }
  return { guildId: null };
};

/* ------------------------------------------------------------------------ */
/* What goes out                                                             */
/* ------------------------------------------------------------------------ */

export const DISCORD_LIMIT = 2_000;
const MAX_PIECES = 10;
const FENCE = /^\s*(```+|~~~+)/;

/** The code fence still open at the end of `text`, given the one open at its start. */
const openFenceAfter = (open: string | null, text: string): string | null => {
  let fence = open;
  for (const line of text.split('\n')) {
    const match = FENCE.exec(line);
    if (!match) continue;
    fence = fence ? null : line.trim();
  }
  return fence;
};

/**
 * A message in pieces Discord takes: broken at a paragraph, else a line, else a word, never mid-word when a break is
 * near — and a code block cut in two is closed at the end of one piece and opened again at the start of the next.
 */
export const splitDiscordMessage = (text: string, limit = DISCORD_LIMIT): string[] => {
  const pieces: string[] = [];
  let rest = text.trim();
  let fence: string | null = null;
  while (rest) {
    const opener = fence ? `${fence}\n` : '';
    if (opener.length + rest.length <= limit) {
      pieces.push(opener + rest);
      break;
    }
    const room = Math.max(limit - opener.length - 4, Math.floor(limit / 2));
    let cut = rest.lastIndexOf('\n\n', room);
    if (cut < room / 2) cut = rest.lastIndexOf('\n', room);
    if (cut < room / 2) cut = rest.lastIndexOf(' ', room);
    if (cut < room / 2) cut = room;
    const piece = rest.slice(0, cut).trimEnd();
    const open = openFenceAfter(fence, piece);
    pieces.push(`${opener}${piece}${open ? '\n```' : ''}`);
    fence = open;
    rest = rest.slice(cut).replace(/^(?:\n+| )/, '');
  }
  return pieces;
};

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const tableCells = (line: string): string[] => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim().replace(/\*\*|__|`/g, ''));

/** A table's rows as columns lined up for a monospace block, a rule under the header. */
const alignedTable = (rows: string[][]): string[] => {
  const columns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length)));
  const line = (row: string[]) => widths.map((width, column) => (row[column] ?? '').padEnd(width)).join('  ').trimEnd();
  return [line(rows[0]!), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.slice(1).map(line)];
};

/** Markdown as Discord shows it: a table, which Discord would leave as raw pipes, becomes lined-up columns in a code block. */
export const discordMarkdown = (text: string): string => {
  const lines = text.split('\n');
  const out: string[] = [];
  let inCode = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (FENCE.test(line)) inCode = !inCode;
    if (!inCode && TABLE_ROW.test(line) && TABLE_RULE.test(lines[index + 1] ?? '')) {
      const rows: string[][] = [];
      let end = index;
      while (end < lines.length && TABLE_ROW.test(lines[end]!)) {
        if (!TABLE_RULE.test(lines[end]!)) rows.push(tableCells(lines[end]!));
        end += 1;
      }
      out.push('```', ...alignedTable(rows), '```');
      index = end - 1;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
};

const QUOTE_LIMIT = 1_800;

/** Something the user wrote outside Discord (`from`: "in Willow"), for the bot's DM: marked as theirs, then quoted. */
export const quoteForDiscord = (text: string, from: string): string => {
  const body = text.trim();
  const shown = body.length > QUOTE_LIMIT ? `${body.slice(0, QUOTE_LIMIT - 1).trimEnd()}…` : body;
  return `-# You, ${from}\n>>> ${shown}`;
};

/**
 * Where the bot's messages in a turn go on Discord. When the user's latest message in the turn was written in a
 * server channel, there, answering it; otherwise its DM, which mirrors the whole conversation.
 */
export const discordReplyTarget = (items: readonly DotItem[], sinceSeq: number, dmChannelId: string | undefined): { channelId: string; replyTo?: string; inputId?: string } | null => {
  for (let index = items.length - 1; index >= 0 && items[index]!.seq > sinceSeq; index -= 1) {
    const item = items[index]!;
    if (item.kind !== 'user') continue;
    if (item.discord?.guildId) return { channelId: item.discord.channelId, replyTo: item.discord.messageId, inputId: item.id };
    if (item.discord) return { channelId: item.discord.channelId };
    break;
  }
  return dmChannelId ? { channelId: dmChannelId } : null;
};

/**
 * Posts a message, in as many pieces as it needs; the first answers `replyTo`. Only people named in it are pinged:
 * never everyone, here or a role. Resolves to the messages Discord made, or why it refused.
 */
export const sendToDiscord = async (link: DiscordLink, relay: DiscordRelay, channelId: string, text: string, replyTo?: string): Promise<{ ids: string[] } | { problem: string }> => {
  const ids: string[] = [];
  const pieces = splitDiscordMessage(discordMarkdown(text));
  if (!pieces.length) return { problem: 'There is nothing to post.' };
  for (const [index, piece] of pieces.slice(0, MAX_PIECES).entries()) {
    const reply = await relay.call<{ id?: string } & ApiError>(link.token, 'POST', `/channels/${channelId}/messages`, {
      body: {
        content: index === MAX_PIECES - 1 && pieces.length > MAX_PIECES ? `${piece.slice(0, DISCORD_LIMIT - 40)}\n… (the rest is in Willow)` : piece,
        allowed_mentions: { parse: ['users'], replied_user: false },
        ...(index === 0 && replyTo ? { message_reference: { message_id: replyTo, channel_id: channelId, fail_if_not_exists: false } } : {}),
      },
    });
    if (reply.status !== 200 || !reply.body?.id) return ids.length ? { ids } : { problem: discordProblem(reply) };
    ids.push(reply.body.id);
  }
  return { ids };
};

export const reactOnDiscord = async (link: DiscordLink, relay: DiscordRelay, channelId: string, messageId: string, emoji: string): Promise<true | { problem: string }> => {
  const reply = await relay.call(link.token, 'PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`);
  return reply.status === 204 || reply.status === 200 ? true : { problem: discordProblem(reply) };
};

/** Takes the bot's own reaction off a message: a new one on the same message replaces it, as a person's does. */
export const unreactOnDiscord = async (link: DiscordLink, relay: DiscordRelay, channelId: string, messageId: string, emoji: string): Promise<true | { problem: string }> => {
  const reply = await relay.call(link.token, 'DELETE', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`);
  return reply.status === 204 || reply.status === 200 || reply.status === 404 ? true : { problem: discordProblem(reply) };
};

/** "Typing…" under the bot's name for ten seconds, or until its message arrives. */
export const showDiscordTyping = (link: DiscordLink, relay: DiscordRelay, channelId: string): Promise<void> =>
  relay.call(link.token, 'POST', `/channels/${channelId}/typing`).then(() => undefined, () => undefined);

/** Recent messages in a channel, oldest first. */
export const readDiscordChannel = async (
  link: DiscordLink,
  relay: DiscordRelay,
  channelId: string,
  options: { limit: number; before?: string; guilds: readonly DiscordGuild[] },
): Promise<DiscordMessage[] | { problem: string }> => {
  const reply = await relay.call<ApiMessage[]>(link.token, 'GET', `/channels/${channelId}/messages`, {
    query: { limit: Math.min(Math.max(Math.round(options.limit), 1), 100), ...(options.before ? { before: options.before } : {}) },
  });
  if (reply.status !== 200 || !Array.isArray(reply.body)) return { problem: discordProblem(reply) };
  const place = placeOf(options.guilds, channelId);
  return reply.body.map((message) => messageFromApi(message, place)).reverse();
};

export const textChannels = (guild: DiscordGuild): DiscordChannel[] => guild.channels.filter((channel) => channel.type !== 15 && channel.type !== 16);
