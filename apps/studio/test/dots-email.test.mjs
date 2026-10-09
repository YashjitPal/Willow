import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', 'dots', 'harness', ...parts);
const personal = (...parts) => path.join(repoRoot, 'platform', 'personal', 'src', ...parts);

const gmail = await importTs(personal('connectors', 'google', 'gmail.ts'));
const options = await importTs(personal('connectors', 'connector-options.ts'));
const registry = await importTs(personal('connectors', 'registry.ts'));
const store = await importTs(harness('thread', 'thread-store.ts'));
const { memoryPersistence } = await importTs(harness('thread', 'thread-persistence.ts'));
const { wakesDot } = await importTs(harness('thread', 'thread-types.ts'));
const outgoing = await importTs(harness('runtime', 'outgoing.ts'));
const { emailTools, parseRecipients } = await importTs(harness('tools', 'email-tools.ts'));

store.setDotThreadPersistence(memoryPersistence());

const NOW = Date.now();
const DAY = 86_400_000;
const header = (name, value) => ({ name, value });

/** A Gmail API stand-in: the list, and metadata for each message, recording every URL asked for. */
const fakeGmail = (messages) => {
  const urls = [];
  const fetchJson = async (url) => {
    urls.push(url);
    const parsed = new URL(url);
    const id = parsed.pathname.split('/messages/')[1];
    if (!id) return { messages: messages.map((message) => ({ id: message.id })) };
    const message = messages.find((entry) => entry.id === decodeURIComponent(id));
    if (!message) return null;
    return {
      id: message.id,
      threadId: `t-${message.id}`,
      labelIds: message.labels ?? ['INBOX'],
      internalDate: String(message.at ?? NOW),
      payload: { headers: [header('From', message.from), header('To', 'me@example.com'), header('Subject', message.subject), header('Date', 'Tue, 6 Oct 2026 10:00:00 +0100'), header('Message-ID', `<${message.id}@mail>`)] },
    };
  };
  return { urls, fetchJson };
};

const INBOX = [
  { id: 'a', from: 'Mom <mom@example.com>', subject: 'Car on Saturday?', labels: ['INBOX', 'UNREAD'] },
  { id: 'b', from: 'Shop <news@shop.example>', subject: 'Autumn sale' },
  { id: 'c', from: 'Mom <mom@example.com>', subject: 'Old news', at: NOW - 90 * DAY },
];

it('reads Gmail without search under metadata access, filtering headers itself, and searches only with email contents', async () => {
  options.setGmailContentsAllowed(false);
  assert.deepEqual(registry.readScopesFor('gmail'), ['https://www.googleapis.com/auth/gmail.metadata']);
  const metadata = fakeGmail(INBOX);
  const found = await gmail.listRecentMail(metadata.fetchJson, { search: 'from:mom@example.com' });
  assert.deepEqual(found.map((mail) => mail.id), ['a'], 'the match, and nothing older than the window');
  assert.ok(metadata.urls.every((url) => !url.includes('q=')), 'metadata access never sends a search, which Gmail refuses');

  options.setGmailContentsAllowed(true);
  try {
    assert.deepEqual(registry.readScopesFor('gmail'), ['https://www.googleapis.com/auth/gmail.readonly'], 'contents replace metadata rather than joining it');
    const contents = fakeGmail(INBOX);
    await gmail.listRecentMail(contents.fetchJson, { search: 'from:mom@example.com', limit: 2 });
    assert.equal(new URL(contents.urls[0]).searchParams.get('q'), 'newer_than:60d -in:spam -in:trash from:mom@example.com');
  } finally {
    options.setGmailContentsAllowed(false);
  }
  assert.deepEqual(registry.writeScopesFor('gmail'), ['https://www.googleapis.com/auth/gmail.send']);
});

it('applies the Gmail search terms it can, and widens rather than guesses on the rest', () => {
  const filter = gmail.parseMailSearch('from:mom@example.com subject:"the car" is:unread has:attachment newer_than:2d');
  assert.deepEqual(filter.from, ['mom@example.com']);
  assert.deepEqual(filter.subject, ['the car']);
  assert.equal(filter.unread, true);
  assert.equal(filter.within, 2 * DAY);
  assert.deepEqual(filter.skipped, ['has:attachment']);

  const mail = { from: 'mom <mom@example.com>', to: 'me@example.com', subject: 'about the car', unread: true, inbox: true, at: NOW };
  assert.equal(gmail.mailMatches(mail, filter, NOW), true);
  assert.equal(gmail.mailMatches({ ...mail, unread: false }, filter, NOW), false);
  assert.equal(gmail.mailMatches({ ...mail, at: NOW - 3 * DAY }, filter, NOW), false);
  const either = gmail.parseMailSearch('from:dad@example.com OR from:mom@example.com');
  assert.equal(either.any, true);
  assert.equal(gmail.mailMatches(mail, either, NOW), true);
  assert.equal(gmail.mailMatches(mail, gmail.parseMailSearch('from:dad@example.com from:mom@example.com'), NOW), false);
});

it('reads a message as its own words and writes mail that survives any character', () => {
  const encode = (text) => Buffer.from(text, 'utf8').toString('base64url');
  const { body, attachments } = gmail.messageText({
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', body: { data: encode('Can I borrow the car on Saturday? — Mum') } },
        { mimeType: 'text/html', body: { data: encode('<p>Can I borrow the car?</p>') } },
      ] },
      { mimeType: 'application/pdf', filename: 'insurance.pdf', body: { size: 10 } },
    ],
  });
  assert.equal(body, 'Can I borrow the car on Saturday? — Mum');
  assert.deepEqual(attachments, ['insurance.pdf']);
  assert.equal(gmail.textFromHtml('<style>p{}</style><p>Hello&nbsp;<b>there</b></p><p>Bye &amp; thanks</p>'), 'Hello there\nBye & thanks');

  const raw = gmail.composeMail({ to: ['Mum <mum@example.com>'], subject: 'Re: Car ✓', body: 'Yes — take it.\nLove', inReplyTo: '<m1@mail>', references: '<m0@mail>' });
  assert.match(raw, /^To: Mum <mum@example\.com>\r\n/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
  assert.match(raw, /In-Reply-To: <m1@mail>\r\nReferences: <m0@mail> <m1@mail>\r\n/);
  const encodedBody = raw.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(encodedBody, 'base64').toString('utf8'), 'Yes — take it.\nLove');
});

it('fires an email trigger with what new mail says when email contents are on, counting matches it left unread', async () => {
  const triggers = await importTs(harness('triggers', 'trigger-store.ts'));
  const watch = await importTs(harness('triggers', 'trigger-watch.ts'));
  const { mailExcerpt } = await importTs(personal('tools', 'watch.ts'));
  assert.equal(mailExcerpt('Can I have the car on Saturday?\n\nOn Tue, 6 Oct 2026 at 10:00, Me <me@example.com> wrote:\n> old message'), 'Can I have the car on Saturday?');

  const dotId = await newDot();
  const { trigger } = triggers.createTrigger(dotId, { name: 'Mum', when: { type: 'email', query: 'from:mum@example.com' }, instruction: 'Tell the user.', notify: 'important', timeZone: 'UTC' }, NOW);
  const primed = { ...trigger, primed: true, seen: ['old'] };
  const sources = {
    mail: async () => ({
      ids: ['new', 'old'],
      fresh: [{ id: 'new', from: 'Mum', domain: 'example.com', address: 'mum@example.com', subject: 'Saturday', date: 'Tue', unread: true, excerpt: 'Can I borrow the car?' }],
      more: 2,
      contents: true,
    }),
  };
  const result = await watch.look(primed, sources, { now: NOW });
  assert.match(result.fired, /^3 new emails match “from:mum@example\.com”:/);
  assert.match(result.fired, /- Mum <mum@example\.com>: “Saturday” — Tue \[id new\]\n {2}Can I borrow the car\?/);
  assert.match(result.fired, /\(and 2 more\)\nRead a whole message with read_email and its id\.$/);
});

it('reaches the user\'s phone through ntfy, on a topic nobody would guess, in any script', async () => {
  const push = await importTs(harness('runtime', 'phone-push.ts'));
  const topic = push.newPhoneTopic();
  assert.match(topic, /^willow-[a-z0-9]{15}$/);
  assert.notEqual(push.newPhoneTopic(), topic);
  push.setPhonePush({ server: push.DEFAULT_PUSH_SERVER, topic });
  assert.equal(push.phoneTopicUrl(push.phonePush.get()), `https://ntfy.sh/${topic}`);
  const sent = [];
  const ok = await push.pushToPhone(push.phonePush.get(), 'Pípa 🌱', 'Your mum asked about the car.', async (url, init) => {
    sent.push({ url, init });
    return { ok: true };
  });
  assert.equal(ok, true);
  assert.equal(sent[0].url, 'https://ntfy.sh/');
  assert.deepEqual(JSON.parse(sent[0].init.body), { topic, title: 'Pípa 🌱', message: 'Your mum asked about the car.', tags: ['speech_balloon'] });
  assert.equal(await push.pushToPhone(push.phonePush.get(), 'Pip', 'x', async () => { throw new Error('offline'); }), false);
  push.setPhonePush(null);
  assert.equal(push.phonePush.get(), null);
});

it('talks to the user on Telegram: pairs only the chat that sends the code, then routes it to its bot and back', async () => {
  const telegram = await importTs(harness('runtime', 'telegram.ts'));
  const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';
  assert.equal(telegram.isTelegramToken(token), true);
  assert.equal(telegram.isTelegramToken('hunter2'), false);
  const code = telegram.newPairingCode();
  assert.match(code, /^[A-Z2-9]{6}$/);

  const sent = [];
  let updates = [];
  const relay = {
    call: async (_token, method, params) => {
      if (method === 'getUpdates') return { ok: true, result: updates.filter((update) => update.update_id >= (params.offset ?? 0)) };
      sent.push({ method, params });
      return { ok: true };
    },
  };
  const delivered = [];
  const ids = [];
  const deliver = (dotId, text, messageId) => {
    delivered.push({ dotId, text });
    ids.push(messageId);
  };
  const message = (id, chat, text, name = 'Sam') => ({ update_id: id, message: { message_id: 500 + id, text, chat: { id: chat }, from: { first_name: name } } });

  let link = { token, dotId: 'dot-pip', code };
  updates = [message(1, 900, 'hello?', 'Stranger'), message(2, 777, `/start ${code}`), message(3, 777, 'Can you check my calendar?')];
  link = await telegram.readTelegram(link, relay, deliver, 0);
  assert.equal(link.chatId, 777, 'the chat that sent the code is paired');
  assert.equal(link.chatName, 'Sam');
  assert.equal(link.offset, 4);
  assert.deepEqual(delivered, [{ dotId: 'dot-pip', text: 'Can you check my calendar?' }], 'what came before pairing, from anyone, is not delivered');
  assert.equal(sent[0].params.chat_id, 777);

  updates = [message(4, 900, 'let me in', 'Stranger'), message(5, 777, '/start'), message(6, 777, 'Thanks!')];
  link = await telegram.readTelegram(link, relay, deliver, 0);
  assert.deepEqual(delivered.slice(1), [{ dotId: 'dot-pip', text: 'Thanks!' }], 'only the paired chat reaches the bot');
  assert.equal(link.offset, 7);

  assert.equal(await telegram.sendTelegram(link, relay, 'All clear for Friday.'), true);
  assert.deepEqual(sent.at(-1), { method: 'sendMessage', params: { chat_id: 777, text: 'All clear for Friday.' } });
  await telegram.sendTelegram(link, relay, 'x'.repeat(5_000));
  assert.equal(sent.at(-1).params.text.length, 4_000, 'long messages fit Telegram');
  assert.equal(await telegram.sendTelegram({ ...link, chatId: undefined }, relay, 'nobody yet'), false);
  await assert.rejects(telegram.readTelegram(link, { call: async () => ({ ok: false, description: 'Unauthorized' }) }, deliver, 0), /Unauthorized/);

  // Each message keeps its id there, so the bot's reaction on it shows in Telegram too, in an emoji Telegram allows.
  assert.deepEqual(ids, [503, 506]);
  assert.equal(await telegram.reactOnTelegram(link, relay, 506, '✅'), true);
  assert.deepEqual(sent.at(-1), { method: 'setMessageReaction', params: { chat_id: 777, message_id: 506, reaction: [{ type: 'emoji', emoji: '👌' }] } });
  assert.equal(telegram.telegramReaction('👀'), '👀');
  assert.equal(telegram.telegramReaction('❤️'), '❤');
  assert.equal(telegram.telegramReaction('🫡'), '🫡', 'any emoji Telegram allows goes as it is');
  assert.equal(telegram.telegramReaction('😂'), '🤣', 'one it lacks goes as the nearest it has');
  assert.equal(telegram.telegramReaction('🍕'), undefined, 'and one with nothing near stays off Telegram rather than changing meaning');
  assert.equal(await telegram.reactOnTelegram({ ...link, chatId: undefined }, relay, 506, '👍'), false);
});

let counter = 0;
const newDot = async () => {
  counter += 1;
  const dotId = `dot-email-${counter}`;
  await store.loadDotThread(dotId);
  return dotId;
};

const mailEnv = (dotId, overrides = {}) => {
  const sent = [];
  const woken = [];
  const deps = { send: async (mail) => { sent.push(mail); return { id: `g${sent.length}` }; }, wake: (id) => woken.push(id), now: () => NOW };
  const env = {
    dotId,
    dotName: 'Pip',
    timeZone: 'UTC',
    now: () => NOW,
    host: null,
    personalData: true,
    mail: {
      canSend: true,
      deps,
      replyContext: async (id) => ({ threadId: `t-${id}`, messageId: `<${id}@mail>`, references: '', subject: 'Car on Saturday?', replyTo: 'Mom <mom@example.com>' }),
      ...overrides,
    },
  };
  const tool = emailTools(env)[0];
  return { env, deps, sent, woken, send: (args) => tool.handler.run(args, { dotId, turnId: 'turn-1' }) };
};

it('asks before sending, then sends exactly the message approved, once', async () => {
  const dotId = await newDot();
  const { deps, sent, woken, send } = mailEnv(dotId);
  const asked = await send({ reply_to: 'a', body: 'Yes, it is yours on Saturday.', reason: 'You said she can have it this weekend.' });
  assert.ok(!asked.failed, asked.observation);
  assert.match(asked.observation, /Asked the user to approve sending “Re: Car on Saturday\?” to Mom <mom@example\.com>/);
  assert.equal(sent.length, 0, 'nothing goes before the user decides');

  const thread = store.getDotThread(dotId);
  const [card] = outgoing.pendingOutgoing(thread);
  assert.deepEqual(card.outgoing.to, ['Mom <mom@example.com>'], 'a reply goes to whoever the message came from');
  assert.equal(card.outgoing.threadId, 't-a');
  assert.equal(card.outgoing.inReplyTo, '<a@mail>');

  await Promise.all([outgoing.sendOutgoing(dotId, card.id, {}, deps), outgoing.sendOutgoing(dotId, card.id, {}, deps)]);
  assert.equal(sent.length, 1, 'two taps, or two windows, still send it once');
  assert.deepEqual(sent[0], { to: ['Mom <mom@example.com>'], subject: 'Re: Car on Saturday?', body: 'Yes, it is yours on Saturday.', threadId: 't-a', inReplyTo: '<a@mail>', references: '' });
  const events = store.getDotThread(dotId).items.filter((item) => item.event === 'outgoing');
  assert.deepEqual(events.map((event) => event.outgoingStep), ['sending', 'sent']);
  assert.equal(wakesDot(events[0]), false, 'the bot is not woken just to hear it is sending');
  assert.equal(wakesDot(events[1]), true);
  assert.equal(outgoing.outgoingState(store.getDotThread(dotId), card), 'sent');
  assert.deepEqual(woken, [dotId]);
});

it('declines, lets the user allow a recipient for good, and asks again once they take that back', async () => {
  const dotId = await newDot();
  const { deps, sent, send } = mailEnv(dotId);
  await send({ to: 'mom@example.com', subject: 'Saturday', body: 'The car is free.' });
  const first = outgoing.pendingOutgoing(store.getDotThread(dotId))[0];
  outgoing.declineOutgoing(dotId, first.id, deps);
  assert.equal(outgoing.outgoingState(store.getDotThread(dotId), first), 'declined');
  assert.equal(sent.length, 0);

  await send({ to: 'Mom <MOM@example.com>', subject: 'Saturday', body: 'The car is free after all.' });
  const second = outgoing.pendingOutgoing(store.getDotThread(dotId))[0];
  await outgoing.sendOutgoing(dotId, second.id, { always: true }, deps);
  assert.deepEqual(store.getDotThread(dotId).runtime.sendTo.map((entry) => entry.address), ['mom@example.com']);

  const standing = await send({ to: 'mom@example.com', subject: 'Keys', body: 'Keys are on the hook.' });
  assert.match(standing.observation, /^Sent “Keys” to mom@example\.com/);
  assert.equal(sent.length, 2);
  const record = store.getDotThread(dotId).items.at(-1);
  assert.equal(record.kind, 'outgoing');
  assert.equal(record.outgoingStep, 'sent');
  assert.equal(record.outgoing.standing, true);
  assert.equal(outgoing.pendingOutgoing(store.getDotThread(dotId)).length, 0);

  outgoing.stopEmailingWithoutAsking(dotId, 'MOM@example.com');
  const again = await send({ to: 'mom@example.com', subject: 'Fuel', body: 'Tank is full.' });
  assert.match(again.observation, /^Asked the user to approve/);
  assert.equal(sent.length, 2);
});

it('refuses to send before the user allows it, and refuses what is not an address or is bulk mail', async () => {
  const dotId = await newDot();
  const blocked = mailEnv(dotId, { canSend: false });
  assert.match(emailTools(blocked.env)[0].doc.description, /Not allowed yet/);
  const refused = await blocked.send({ to: 'mom@example.com', subject: 'Hi', body: 'Hello' });
  assert.equal(refused.failed, true);
  assert.match(refused.observation, /not allowed to send email yet/);

  const { send } = mailEnv(dotId);
  assert.match((await send({ to: 'mom at home', subject: 'Hi', body: 'Hello' })).observation, /is not an email address/);
  assert.match((await send({ to: 'mom@example.com', body: 'Hello' })).observation, /Give a "subject"/);
  const many = Array.from({ length: 21 }, (_, index) => `p${index}@example.com`);
  assert.match((await send({ to: many, subject: 'Hi', body: 'Hello' })).observation, /does not send bulk mail/);
  assert.deepEqual(parseRecipients('A <a@example.com>, b@example.com'), { addresses: ['A <a@example.com>', 'b@example.com'] });
  assert.equal(store.getDotThread(dotId).items.filter((item) => item.kind === 'outgoing').length, 0);
});
