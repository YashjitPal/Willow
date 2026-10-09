/**
 * Discord, for a bot the user made a Discord bot of its own: its REST API, a fixed set of routes for that bot's
 * token (`discord.call`), and its gateway — the WebSocket Discord delivers messages over — held here while a window
 * wants it, which takes what arrived since it last asked (`discord.next`). Discord's API sends no CORS headers, and
 * a page cannot keep a gateway's heartbeat while it is hidden, so neither can live in the window.
 *
 * Never a proxy: one host, the routes below, the token's own bot. Tokens are kept in memory only, while a gateway
 * is open; a gateway nobody has asked about for a few minutes closes.
 */
import crypto from 'node:crypto';
import { WebSocket } from 'ws';

const API = 'https://discord.com/api/v10';
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const USER_AGENT = 'DiscordBot (https://discord.com/developers/docs, 1) Willow';
const MAX_BODY = 64_000;
const MAX_ANSWER = 4 * 1024 * 1024;
const MAX_WAIT_MS = 25_000;
const KEPT_EVENTS = 300;
const KEPT_CHANNELS = 500;
const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

const TOKEN = /^[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$/;

export const botToken = (value) => {
  const token = String(value || '').trim().replace(/^Bot\s+/i, '');
  if (!TOKEN.test(token)) throw new Error('That is not a Discord bot token.');
  return token;
};

const ID = '\\d{5,22}';
const route = (method, pattern) => ({ method, pattern: new RegExp(`^${pattern}$`) });
const ROUTES = [
  route('GET', '/users/@me'),
  route('GET', '/oauth2/applications/@me'),
  route('GET', '/users/@me/guilds'),
  route('GET', `/guilds/${ID}/channels`),
  route('GET', `/guilds/${ID}/threads/active`),
  route('GET', `/channels/${ID}`),
  route('GET', `/channels/${ID}/messages`),
  route('POST', `/channels/${ID}/messages`),
  route('POST', `/channels/${ID}/typing`),
  route('PUT', `/channels/${ID}/messages/${ID}/reactions/[^/?#]{1,120}/@me`),
  route('DELETE', `/channels/${ID}/messages/${ID}/reactions/[^/?#]{1,120}/@me`),
  route('POST', '/users/@me/channels'),
];
const QUERY_KEYS = ['limit', 'before', 'after', 'around'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readCapped = async (response) => {
  if (!response.body) return typeof response.text === 'function' ? response.text() : '';
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_ANSWER) throw new Error('Discord answered with more than Willow relays.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

/** One request to Discord's REST API, for routes on the list only. A short rate limit is waited out once or twice. */
export async function discordCall(payload, { api = API, fetchImpl = (...args) => fetch(...args) } = {}) {
  const token = botToken(payload.token);
  const method = String(payload.method || 'GET').toUpperCase();
  const path = String(payload.path || '');
  if (!ROUTES.some((entry) => entry.method === method && entry.pattern.test(path))) throw new Error('That Discord request is not allowed.');
  const query = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const value = payload.query?.[key];
    if (value !== undefined && value !== null && /^\d{1,22}$/.test(String(value))) query.set(key, String(value));
  }
  const body = payload.body === undefined || method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(payload.body);
  if (body && body.length > MAX_BODY) throw new Error('That is too much to send to Discord at once.');
  const url = `${api}${path}${query.toString() ? `?${query}` : ''}`;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, {
      method,
      headers: { authorization: `Bot ${token}`, 'user-agent': USER_AGENT, ...(body ? { 'content-type': 'application/json' } : {}) },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await readCapped(response);
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (response.status === 429 && attempt < 2) {
      const wait = Number(parsed?.retry_after ?? response.headers?.get?.('retry-after') ?? 1);
      if (Number.isFinite(wait) && wait <= 10) {
        await sleep(Math.ceil(wait * 1_000) + 50);
        continue;
      }
    }
    return { status: response.status, body: parsed };
  }
}

/* ------------------------------------------------------------------------ */
/* The gateway                                                               */
/* ------------------------------------------------------------------------ */

const INTENTS = {
  guilds: 1 << 0,
  guildMessages: 1 << 9,
  guildReactions: 1 << 10,
  directMessages: 1 << 12,
  directReactions: 1 << 13,
  messageContent: 1 << 15,
};
const BASE_INTENTS = INTENTS.guilds | INTENTS.guildMessages | INTENTS.guildReactions | INTENTS.directMessages | INTENTS.directReactions;

/** Close codes after which connecting again cannot help, each with what the user can do. */
const FATAL = new Map([
  [4004, 'Discord refused the bot token. Reset it on the Bot page of the Discord application and connect again.'],
  [4010, 'Discord refused the connection (shard).'],
  [4011, 'This bot is in too many servers for Willow to connect it.'],
  [4012, 'Discord refused the connection (API version).'],
  [4013, 'Discord refused the connection (intents).'],
  [4014, 'Discord refused the permissions Willow asked for.'],
]);
/** Categories, stages and directories hold no messages. */
const SKIPPED_CHANNELS = new Set([4, 13, 14]);

class Gateway {
  constructor({ token, content, url, log }) {
    this.token = token;
    /** Asked for Message Content: the window says the application has it on. */
    this.content = content;
    this.url = url;
    this.log = log;
    this.epoch = crypto.randomUUID();
    this.state = 'connecting';
    this.problem = undefined;
    this.contentRefused = false;
    this.user = null;
    this.guilds = new Map();
    this.guildsVersion = 0;
    this.events = [];
    this.lastSeq = 0;
    this.waiters = new Set();
    this.wantedAt = Date.now();
    this.socket = null;
    this.session = null;
    this.sequence = null;
    this.heartbeat = null;
    this.firstBeat = null;
    this.acked = true;
    this.attempt = 0;
    this.closed = false;
    this.timer = null;
  }

  start() {
    this.connect(false);
  }

  connect(resume) {
    if (this.closed) return;
    clearTimeout(this.timer);
    const resuming = resume && Boolean(this.session);
    const base = resuming && this.session.resumeUrl ? this.session.resumeUrl : this.url;
    const url = base.includes('?') ? base : `${base.replace(/\/$/, '')}/?v=10&encoding=json`;
    let socket;
    try {
      socket = new WebSocket(url, { headers: { 'user-agent': USER_AGENT } });
    } catch (error) {
      this.log?.('discord gateway could not open', error?.message);
      this.retry();
      return;
    }
    this.socket = socket;
    socket.on('message', (raw) => this.receive(socket, raw, resuming));
    socket.on('close', (code) => this.onClose(socket, code));
    // A failed socket closes too, and the close decides what happens next.
    socket.on('error', (error) => this.log?.('discord gateway error', error?.message));
  }

  intents() {
    return BASE_INTENTS | (this.content && !this.contentRefused ? INTENTS.messageContent : 0);
  }

  send(socket, packet) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(packet));
  }

  receive(socket, raw, resuming) {
    if (socket !== this.socket) return;
    let packet;
    try {
      packet = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (packet.s !== undefined && packet.s !== null) this.sequence = packet.s;
    switch (packet.op) {
      case 10:
        this.beat(socket, Number(packet.d?.heartbeat_interval) || 41_250);
        if (resuming && this.session) this.send(socket, { op: 6, d: { token: this.token, session_id: this.session.id, seq: this.sequence } });
        else this.send(socket, { op: 2, d: { token: this.token, intents: this.intents(), properties: { os: process.platform, browser: 'Willow', device: 'Willow' } } });
        return;
      case 11:
        this.acked = true;
        return;
      case 1:
        this.send(socket, { op: 1, d: this.sequence });
        return;
      case 7:
        socket.close(4900, 'reconnect');
        return;
      case 9:
        if (!packet.d) {
          this.session = null;
          this.sequence = null;
        }
        socket.close(4901, 'invalid session');
        return;
      case 0:
        this.dispatch(packet.t, packet.d ?? {});
        return;
      default:
    }
  }

  beat(socket, interval) {
    clearInterval(this.heartbeat);
    clearTimeout(this.firstBeat);
    this.acked = true;
    const tick = () => {
      if (socket !== this.socket) return;
      // No answer to the last heartbeat: the connection is dead without having closed. Close it, and resume.
      if (!this.acked) {
        socket.terminate();
        return;
      }
      this.acked = false;
      this.send(socket, { op: 1, d: this.sequence });
    };
    this.firstBeat = setTimeout(() => {
      tick();
      this.heartbeat = setInterval(tick, interval);
    }, Math.floor(interval * Math.random()));
  }

  onClose(socket, code) {
    if (socket !== this.socket) return;
    clearInterval(this.heartbeat);
    clearTimeout(this.firstBeat);
    this.socket = null;
    if (this.closed) return;
    // Message Content is off for the application after all: carry on without it, reading what mentions the bot.
    if (code === 4014 && this.content && !this.contentRefused) {
      this.contentRefused = true;
      this.session = null;
      this.sequence = null;
      this.timer = setTimeout(() => this.connect(false), 1_000);
      return;
    }
    const fatal = FATAL.get(code);
    if (fatal) {
      this.session = null;
      this.setState('error', fatal);
      return;
    }
    if (code === 4007 || code === 4009) {
      this.session = null;
      this.sequence = null;
    }
    this.retry();
  }

  retry() {
    if (this.closed) return;
    const delay = RECONNECT_DELAYS[Math.min(this.attempt, RECONNECT_DELAYS.length - 1)];
    this.attempt += 1;
    if (this.attempt >= 3) this.setState('offline', 'Willow cannot reach Discord right now; it keeps trying.');
    else if (this.state === 'online') this.setState('connecting');
    this.timer = setTimeout(() => this.connect(true), delay);
  }

  dispatch(type, data) {
    switch (type) {
      case 'READY':
        this.session = { id: data.session_id, resumeUrl: data.resume_gateway_url };
        this.user = data.user?.id ? { id: data.user.id, username: data.user.username ?? '' } : null;
        this.attempt = 0;
        this.guilds.clear();
        for (const guild of data.guilds ?? []) if (guild?.id) this.guilds.set(guild.id, { id: guild.id, name: '', channels: new Map() });
        this.changedGuilds();
        this.setState('online');
        return;
      case 'RESUMED':
        this.attempt = 0;
        this.setState('online');
        return;
      case 'GUILD_CREATE':
      case 'GUILD_UPDATE': {
        if (data.unavailable || !data.id) return;
        const existing = this.guilds.get(data.id);
        const channels = type === 'GUILD_CREATE' ? new Map() : existing?.channels ?? new Map();
        if (type === 'GUILD_CREATE') for (const channel of [...(data.channels ?? []), ...(data.threads ?? [])]) this.keepChannel(channels, channel);
        this.guilds.set(data.id, { id: data.id, name: data.name ?? existing?.name ?? '', channels });
        this.changedGuilds();
        return;
      }
      case 'GUILD_DELETE':
        // Unavailable is an outage, not the bot leaving.
        if (data.unavailable) return;
        if (this.guilds.delete(data.id)) this.changedGuilds();
        return;
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE':
      case 'THREAD_CREATE':
      case 'THREAD_UPDATE': {
        const guild = data.guild_id ? this.guilds.get(data.guild_id) : undefined;
        if (!guild) return;
        this.keepChannel(guild.channels, data);
        this.changedGuilds();
        return;
      }
      case 'CHANNEL_DELETE':
      case 'THREAD_DELETE': {
        const guild = data.guild_id ? this.guilds.get(data.guild_id) : undefined;
        if (guild?.channels.delete(data.id)) this.changedGuilds();
        return;
      }
      case 'MESSAGE_CREATE':
        if (data.author?.id && data.author.id === this.user?.id) return;
        this.push('message', this.slimMessage(data));
        return;
      case 'MESSAGE_REACTION_ADD':
      case 'MESSAGE_REACTION_REMOVE':
        if (data.user_id === this.user?.id) return;
        this.push('reaction', {
          added: type === 'MESSAGE_REACTION_ADD',
          userId: data.user_id ?? '',
          channelId: data.channel_id ?? '',
          messageId: data.message_id ?? '',
          guildId: data.guild_id ?? null,
          emoji: data.emoji?.id ? `:${data.emoji.name ?? 'emoji'}:` : data.emoji?.name ?? '',
        });
        return;
      default:
    }
  }

  keepChannel(channels, channel) {
    if (!channel?.id || SKIPPED_CHANNELS.has(channel.type)) return;
    channels.set(channel.id, { id: channel.id, name: channel.name ?? '', type: channel.type ?? 0, ...(channel.parent_id ? { parentId: channel.parent_id } : {}) });
    if (channels.size > KEPT_CHANNELS) channels.delete(channels.keys().next().value);
  }

  slimMessage(data) {
    const guild = data.guild_id ? this.guilds.get(data.guild_id) : undefined;
    const channel = guild?.channels.get(data.channel_id);
    const parent = channel?.parentId ? guild.channels.get(channel.parentId) : undefined;
    return {
      id: data.id,
      channelId: data.channel_id,
      guildId: data.guild_id ?? null,
      ...(guild?.name ? { guildName: guild.name } : {}),
      ...(channel?.name ? { channelName: channel.name } : {}),
      ...(parent?.name ? { parentName: parent.name } : {}),
      author: {
        id: data.author?.id ?? '',
        username: data.author?.username ?? '',
        name: data.member?.nick || data.author?.global_name || data.author?.username || '',
        bot: Boolean(data.author?.bot),
      },
      content: String(data.content ?? '').slice(0, 6_000),
      at: Date.parse(data.timestamp) || Date.now(),
      mentions: (data.mentions ?? []).map((user) => user?.id).filter(Boolean).slice(0, 50),
      everyone: Boolean(data.mention_everyone),
      ...(data.type === 19 && data.message_reference?.message_id
        ? { replyTo: { id: data.message_reference.message_id, ...(data.referenced_message?.author?.id ? { authorId: data.referenced_message.author.id } : {}) } }
        : {}),
      attachments: (data.attachments ?? []).slice(0, 10).map((file) => ({ name: file.filename ?? 'file', url: file.url ?? '', ...(file.content_type ? { type: file.content_type } : {}), ...(file.size ? { size: file.size } : {}) })),
      webhook: Boolean(data.webhook_id),
      type: data.type ?? 0,
    };
  }

  push(type, data) {
    this.lastSeq += 1;
    this.events.push({ seq: this.lastSeq, type, data });
    if (this.events.length > KEPT_EVENTS) this.events.splice(0, this.events.length - KEPT_EVENTS);
    this.wake();
  }

  wake() {
    for (const waiter of [...this.waiters]) waiter();
  }

  setState(state, problem) {
    if (this.state === state && this.problem === problem) return;
    this.state = state;
    this.problem = problem;
    this.wake();
  }

  changedGuilds() {
    this.guildsVersion += 1;
    this.wake();
  }

  guildList() {
    return [...this.guilds.values()].filter((guild) => guild.name).map((guild) => ({ id: guild.id, name: guild.name, channels: [...guild.channels.values()] }));
  }

  /** What arrived after `after`, waiting up to `waitMs` for something; servers only when the window's copy is old. */
  async next({ after, epoch, guildsVersion, waitMs }) {
    this.wantedAt = Date.now();
    const since = epoch === this.epoch ? Math.max(0, Number(after) || 0) : 0;
    const guildsCurrent = () => epoch === this.epoch && Number(guildsVersion) === this.guildsVersion;
    const pending = () => this.events.some((event) => event.seq > since) || !guildsCurrent();
    if (!pending() && waitMs > 0 && !this.closed) {
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, waitMs);
        this.waiters.add(done);
      });
    }
    this.wantedAt = Date.now();
    return {
      epoch: this.epoch,
      after: this.lastSeq,
      events: this.events.filter((event) => event.seq > since),
      state: this.state,
      ...(this.problem ? { problem: this.problem } : {}),
      user: this.user,
      content: this.content && !this.contentRefused,
      contentRefused: this.contentRefused,
      guildsVersion: this.guildsVersion,
      ...(guildsCurrent() ? {} : { guilds: this.guildList() }),
    };
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    clearTimeout(this.firstBeat);
    try {
      this.socket?.close(1000);
    } catch {
      // Already gone.
    }
    this.socket = null;
    this.wake();
  }
}

/**
 * The companion's Discord: requests it answers and the gateways it holds, one per bot token. A gateway opens on the
 * first `discord.next` for its token and closes after `idleMs` without one, or on `discord.close`.
 */
export function createDiscord({ api = API, gateway = GATEWAY, fetchImpl, log = () => undefined, idleMs = 3 * 60_000 } = {}) {
  const gateways = new Map();
  const keyOf = (token) => crypto.createHash('sha256').update(token).digest('base64url').slice(0, 22);
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of gateways) {
      if (entry.waiters.size === 0 && now - entry.wantedAt > idleMs) {
        entry.close();
        gateways.delete(key);
      }
    }
  }, Math.min(30_000, Math.max(1_000, idleMs / 2)));
  sweep.unref?.();

  const gatewayFor = (token, content) => {
    const key = keyOf(token);
    let entry = gateways.get(key);
    // The application's Message Content setting changed: identify again with or without it.
    if (entry && entry.content !== content) {
      entry.close();
      gateways.delete(key);
      entry = undefined;
    }
    if (!entry) {
      entry = new Gateway({ token, content, url: gateway, log });
      gateways.set(key, entry);
      entry.start();
    }
    return entry;
  };

  return {
    requests: ['discord.call', 'discord.next', 'discord.close'],
    handles: (type) => type === 'discord.call' || type === 'discord.next' || type === 'discord.close',
    async handle(type, payload) {
      if (type === 'discord.call') return discordCall(payload, { api, ...(fetchImpl ? { fetchImpl } : {}) });
      const token = botToken(payload.token);
      if (type === 'discord.next') {
        const waitMs = Math.min(Math.max(Number(payload.waitMs) || 0, 0), MAX_WAIT_MS);
        return gatewayFor(token, Boolean(payload.content)).next({ after: payload.after, epoch: payload.epoch, guildsVersion: payload.guildsVersion, waitMs });
      }
      const key = keyOf(token);
      gateways.get(key)?.close();
      gateways.delete(key);
      return { closed: true };
    },
    dispose() {
      clearInterval(sweep);
      for (const entry of gateways.values()) entry.close();
      gateways.clear();
    },
  };
}
