import assert from 'node:assert/strict';
import { once } from 'node:events';
import { it } from 'node:test';
import { WebSocketServer } from 'ws';
import { botToken, createDiscord, discordCall } from '../src/discord.mjs';

// A made-up bot token, joined at run time so secret scanners don't take the source for a real one.
const TOKEN = ['MTA5ODc2NTQzMjEwOTg3NjU0Mw', 'GaBcDe', 'abcdefghijklmnopqrstuvwxyz0123456789AB'].join('.');
const CONTENT = 1 << 15;

const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

it('relays the routes on its list for a bot token, and nothing else', async () => {
  assert.equal(botToken(`Bot ${TOKEN}`), TOKEN, 'a pasted "Bot " prefix is dropped');
  assert.throws(() => botToken('123456:telegram-token'), /not a Discord bot token/);

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return json(200, { id: '42' });
  };
  const sent = await discordCall({ token: TOKEN, method: 'POST', path: '/channels/123456789012/messages', body: { content: 'hi' } }, { fetchImpl });
  assert.deepEqual(sent, { status: 200, body: { id: '42' } });
  assert.equal(calls[0].url, 'https://discord.com/api/v10/channels/123456789012/messages');
  assert.equal(calls[0].init.headers.authorization, `Bot ${TOKEN}`);
  assert.match(calls[0].init.headers['user-agent'], /^DiscordBot \(/);
  assert.equal(calls[0].init.redirect, 'error');

  await discordCall({ token: TOKEN, path: '/channels/123456789012/messages', query: { limit: 30, before: '99999', around: 'x', evil: '1' } }, { fetchImpl });
  assert.equal(calls[1].url, 'https://discord.com/api/v10/channels/123456789012/messages?limit=30&before=99999', 'only known query keys, and only numbers');
  assert.equal(calls[1].init.body, undefined, 'a GET carries no body');

  const refused = [
    { method: 'GET', path: '/guilds/123456/members' },
    { method: 'DELETE', path: '/channels/123456789012' },
    { method: 'POST', path: '/guilds/123456/bans/987654' },
    { method: 'GET', path: '/channels/123456789012/../../users/@me' },
    { method: 'PATCH', path: '/users/@me' },
  ];
  for (const request of refused) {
    await assert.rejects(discordCall({ token: TOKEN, ...request }, { fetchImpl }), /not allowed/, `${request.method} ${request.path}`);
  }
  assert.equal(calls.length, 2, 'nothing refused reached the network');
  await assert.rejects(discordCall({ token: TOKEN, method: 'POST', path: '/channels/123456789012/messages', body: { content: 'x'.repeat(70_000) } }, { fetchImpl }), /too much/);

  let attempts = 0;
  const limited = await discordCall({ token: TOKEN, method: 'PUT', path: `/channels/123456789012/messages/123456789013/reactions/${encodeURIComponent('👍')}/@me` }, {
    fetchImpl: async () => (attempts++ === 0 ? json(429, { retry_after: 0.01 }) : new Response(null, { status: 204 })),
  });
  assert.equal(limited.status, 204, 'a short rate limit is waited out');
  assert.equal(attempts, 2);
});

/** A stand-in for Discord's gateway: Hello on connect, then whatever the test does with each packet. */
const fakeGateway = async (onPacket) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}`;
  const packets = [];
  const sockets = new Set();
  let connections = 0;
  server.on('connection', (socket) => {
    connections += 1;
    const connection = connections;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45_000 } }));
    socket.on('message', (raw) => {
      const packet = JSON.parse(raw.toString());
      if (packet.op === 1) {
        socket.send(JSON.stringify({ op: 11 }));
        return;
      }
      packets.push({ connection, ...packet });
      onPacket(socket, packet, connection, url);
    });
  });
  return {
    url: `${url}/?v=10&encoding=json`,
    packets,
    /** The open connection, from the server's side. */
    socket: () => [...sockets].at(-1),
    connections: () => connections,
    close: () => new Promise((resolve) => {
      for (const client of server.clients) client.terminate();
      server.close(resolve);
    }),
  };
};

let sequence = 0;
const dispatch = (socket, t, d) => socket.send(JSON.stringify({ op: 0, t, d, s: (sequence += 1) }));

const ready = (socket, url) => {
  dispatch(socket, 'READY', { session_id: 'session-1', resume_gateway_url: url, user: { id: '500', username: 'Ada' }, guilds: [{ id: '700', unavailable: true }] });
  dispatch(socket, 'GUILD_CREATE', {
    id: '700',
    name: 'Willow Club',
    channels: [{ id: '701', name: 'general', type: 0 }, { id: '702', name: 'Text channels', type: 4 }],
    threads: [{ id: '703', name: 'launch', type: 11, parent_id: '701' }],
  });
};

const waitFor = async (check, label) => {
  for (let tries = 0; tries < 100; tries += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for ${label}`);
};

it('holds a gateway: identifies, keeps servers and channels, buffers messages and reactions, and resumes', async () => {
  const gateway = await fakeGateway((socket, packet, connection, url) => {
    if (packet.op === 2) {
      ready(socket, url);
      dispatch(socket, 'MESSAGE_CREATE', {
        id: '801', channel_id: '703', guild_id: '700', type: 19, content: '<@500> what changed?', timestamp: '2026-10-07T14:02:00.000Z',
        author: { id: '600', username: 'yash', global_name: 'Yash' }, member: { nick: 'Yashjit' }, mentions: [{ id: '500' }],
        message_reference: { message_id: '799' }, referenced_message: { author: { id: '500' } },
        attachments: [{ filename: 'plan.png', url: 'https://cdn.discordapp.com/x/plan.png', content_type: 'image/png', size: 10 }],
      });
      dispatch(socket, 'MESSAGE_CREATE', { id: '802', channel_id: '701', guild_id: '700', content: 'my own words', author: { id: '500', username: 'Ada', bot: true } });
      dispatch(socket, 'MESSAGE_REACTION_ADD', { user_id: '600', channel_id: '900', message_id: '799', emoji: { name: '👍' } });
    }
    if (packet.op === 6) dispatch(socket, 'RESUMED', {});
  });
  const discord = createDiscord({ gateway: gateway.url, idleMs: 60_000 });
  try {
    const first = await waitFor(async () => {
      const reply = await discord.handle('discord.next', { token: TOKEN, content: false, waitMs: 200 });
      return reply.events.length >= 2 && reply.guilds ? reply : null;
    }, 'the first messages');
    const identify = gateway.packets.find((packet) => packet.op === 2);
    assert.equal(identify.d.token, TOKEN);
    assert.equal(identify.d.intents & CONTENT, 0, 'no Message Content unless the application has it');
    assert.ok(identify.d.intents & (1 << 12), 'direct messages');
    assert.equal(first.state, 'online');
    assert.deepEqual(first.user, { id: '500', username: 'Ada' });
    assert.deepEqual(first.guilds, [{ id: '700', name: 'Willow Club', channels: [{ id: '701', name: 'general', type: 0 }, { id: '703', name: 'launch', type: 11, parentId: '701' }] }], 'categories are left out');
    const [message, reaction] = first.events;
    assert.equal(first.events.length, 2, "the bot's own message is not passed on");
    assert.equal(message.type, 'message');
    assert.deepEqual(
      { ...message.data, at: undefined },
      {
        id: '801', channelId: '703', guildId: '700', guildName: 'Willow Club', channelName: 'launch', parentName: 'general',
        author: { id: '600', username: 'yash', name: 'Yashjit', bot: false }, content: '<@500> what changed?', at: undefined,
        mentions: ['500'], everyone: false, replyTo: { id: '799', authorId: '500' },
        attachments: [{ name: 'plan.png', url: 'https://cdn.discordapp.com/x/plan.png', type: 'image/png', size: 10 }], webhook: false, type: 19,
      },
    );
    assert.deepEqual(reaction, { seq: reaction.seq, type: 'reaction', data: { added: true, userId: '600', channelId: '900', messageId: '799', guildId: null, emoji: '👍' } });

    // Caught up, a window waits; what arrives next ends the wait.
    const waiting = discord.handle('discord.next', { token: TOKEN, content: false, waitMs: 5_000, after: first.after, epoch: first.epoch, guildsVersion: first.guildsVersion });
    const started = Date.now();
    setTimeout(() => {
      dispatch(gateway.socket(), 'MESSAGE_CREATE', { id: '803', channel_id: '900', content: 'hi from my phone', author: { id: '600', username: 'yash' } });
    }, 100);
    const second = await waiting;
    assert.ok(Date.now() - started < 4_000, 'the wait ended when the message came');
    assert.deepEqual(second.events.map((event) => event.data.id), ['803']);
    assert.equal(second.events[0].data.guildId, null, 'a DM has no server');
    assert.equal(second.guilds, undefined, 'servers are sent only when they changed');

    // Discord asks for a reconnect: the gateway resumes the session rather than identifying again.
    gateway.socket().send(JSON.stringify({ op: 7, d: null }));
    const resume = await waitFor(() => gateway.packets.find((packet) => packet.op === 6), 'a resume');
    assert.equal(resume.d.session_id, 'session-1');
    assert.equal(typeof resume.d.seq, 'number');
    assert.equal(gateway.packets.filter((packet) => packet.op === 2).length, 1, 'one identify for the whole run');
  } finally {
    discord.dispose();
    await gateway.close();
  }
});

it('carries on without Message Content when Discord refuses it, and stops on a refused token', async () => {
  const gateway = await fakeGateway((socket, packet, connection, url) => {
    if (packet.op !== 2) return;
    if (packet.d.token !== TOKEN) {
      socket.close(4004, 'Authentication failed.');
      return;
    }
    if (packet.d.intents & CONTENT) {
      socket.close(4014, 'Disallowed intent(s).');
      return;
    }
    ready(socket, url);
  });
  const discord = createDiscord({ gateway: gateway.url, idleMs: 60_000 });
  try {
    const online = await waitFor(async () => {
      const reply = await discord.handle('discord.next', { token: TOKEN, content: true, waitMs: 200 });
      return reply.state === 'online' ? reply : null;
    }, 'a connection without Message Content');
    assert.equal(online.contentRefused, true);
    assert.equal(online.content, false);
    const identifies = gateway.packets.filter((packet) => packet.op === 2);
    assert.deepEqual(identifies.map((packet) => Boolean(packet.d.intents & CONTENT)), [true, false]);

    const other = ['MTExMTExMTExMTExMTExMTExMQ', 'GaBcDe', 'zyxwvutsrqponmlkjihgfedcba9876543210ZY'].join('.');
    const refused = await waitFor(async () => {
      const reply = await discord.handle('discord.next', { token: other, content: false, waitMs: 200 });
      return reply.state === 'error' ? reply : null;
    }, 'a refused token');
    assert.match(refused.problem, /refused the bot token/);
    const before = gateway.connections();
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    assert.equal(gateway.connections(), before, 'a refused token is not tried again');

    assert.deepEqual(await discord.handle('discord.close', { token: TOKEN }), { closed: true });
  } finally {
    discord.dispose();
    await gateway.close();
  }
});
