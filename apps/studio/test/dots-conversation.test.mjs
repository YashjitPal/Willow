import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', 'dots', 'harness', ...parts);

const store = await importTs(harness('thread', 'thread-store.ts'));
const { memoryPersistence } = await importTs(harness('thread', 'thread-persistence.ts'));
const { buildDotContext } = await importTs(harness('memory', 'context-builder.ts'));
const { budgetsForWindow } = await importTs(harness('memory', 'budgets.ts'));
const { renderInput } = await importTs(harness('memory', 'render.ts'));
const { createDotSystemPrompt } = await importTs(harness('overlay', 'dot-profile.ts'));
const { computerTools, approvalDecision, pendingApprovals, unfinishedApprovals } = await importTs(harness('tools', 'computer-tools.ts'));
const access = await importTs(harness('runtime', 'computer-access.ts'));
const edits = await importTs(harness('runtime', 'edits.ts'));
const { emailTools } = await importTs(harness('tools', 'email-tools.ts'));
const { discordTools } = await importTs(harness('tools', 'discord-tools.ts'));
const { wakesDot } = await importTs(harness('thread', 'thread-types.ts'));
const { normalizeReactionEmoji } = await importTs(harness('runtime', 'protocol.ts'));

store.setDotThreadPersistence(memoryPersistence());

const ROOT = 'C:\\work';

let counter = 0;
const newDot = async () => {
  counter += 1;
  const dotId = `dot-conversation-${counter}`;
  await store.loadDotThread(dotId);
  return dotId;
};

const say = (dotId, text) => store.appendDotItem(dotId, { kind: 'user', text });

/** A computer with one project, which remembers what it ran. */
const fakeComputer = () => {
  const files = new Map([[`${ROOT}|src/app.ts`, { text: 'export const app = 1;\n', modifiedAt: 1_000 }]]);
  const ran = [];
  const bridge = {
    authorize: async (root) => root,
    execute: async (request) => {
      ran.push(request.command);
      return { code: 0, signal: null, stdout: 'all good\n', stderr: '' };
    },
    startJob: async ({ root, cwd, command }) => {
      ran.push(command);
      return { jobId: `job-${ran.length}`, running: true, code: null, signal: null, startedAt: Date.now(), endedAt: null, root, cwd, command };
    },
    readJob: async () => ({ running: true, code: null, signal: null, startedAt: 0, endedAt: null, text: '', next: 0, truncated: false }),
    stopJob: async () => undefined,
    writeJob: async () => undefined,
    listFiles: async (_root, at) => ({ path: at, entries: [], truncated: false }),
    readFile: async (root, at) => {
      const file = files.get(`${root}|${at}`);
      if (!file) throw new Error(`ENOENT: no such file or directory '${at}'`);
      return { path: at, size: file.text.length, modifiedAt: file.modifiedAt, binary: false, text: file.text, offset: 0, next: null };
    },
    searchFiles: async () => ({ matches: [], truncated: false }),
    writeFile: async (root, at, text, modifiedAt) => {
      const current = files.get(`${root}|${at}`);
      if (current && modifiedAt !== undefined && current.modifiedAt !== modifiedAt) throw new Error(`${at} changed since it was read`);
      files.set(`${root}|${at}`, { text, modifiedAt: (current?.modifiedAt ?? 0) + 1 });
      return { path: at, size: text.length, modifiedAt: 2_000, created: !current };
    },
    shell: () => 'PowerShell on Windows',
  };
  const woken = [];
  return { bridge, files, ran, woken, deps: { computer: bridge, now: () => Date.now(), wake: (id) => woken.push(id) } };
};

const connected = async (permissions) => {
  const dotId = await newDot();
  const computer = fakeComputer();
  if (permissions) store.updateDotRuntime(dotId, { permissions });
  await access.connectComputer(dotId, ROOT, computer.deps);
  const env = { dotId, dotName: 'Pip', timeZone: 'UTC', now: () => Date.now(), host: null, personalData: true, permissions, computer: { root: ROOT, shell: computer.bridge.shell(), bridge: computer.bridge } };
  const toolset = Object.fromEntries(computerTools(env).map((entry) => [entry.handler.id, entry]));
  return { dotId, ...computer, toolset, run: (id, args) => toolset[id].handler.run(args, { dotId, turnId: 't1' }) };
};

const nowBlock = (dotId, turn, seenSeq = 0) => buildDotContext({
  thread: store.getDotThread(dotId),
  systemPrompt: 'S',
  about: '',
  budgets: budgetsForWindow(128_000),
  now: Date.now(),
  timeZone: 'UTC',
  seenSeq,
  delegations: [],
  turn,
}).messages.at(-1).content;

/* ------------------------------------------------------------------------ */
/* Conversation                                                              */
/* ------------------------------------------------------------------------ */

it('shows the bot how long it has been at a turn, and what the user has had no word about', async () => {
  const dotId = await newDot();
  const asked = say(dotId, 'Find me a flight to Lisbon.');
  const turn = { id: 't1', startedAt: Date.now() - 95_000, sinceSeq: asked.seq - 1 };
  assert.doesNotMatch(nowBlock(dotId, turn), /into this turn/, 'nothing before the first step: the turn has only begun');

  store.appendDotItem(dotId, { kind: 'call', tool: 'web_search', args: {}, text: '', turnId: 't1' });
  store.appendDotItem(dotId, { kind: 'result', tool: 'web_search', text: 'three fares', turnId: 't1' });
  store.appendDotItem(dotId, { kind: 'call', tool: 'web_read', args: {}, text: '', turnId: 't1' });
  const busy = nowBlock(dotId, turn);
  assert.match(busy, /You are 2 minutes and 2 steps into this turn\./);
  assert.match(busy, new RegExp(`${asked.id} has had no word from you yet; the user wrote it \\d+ seconds? ago\\.`));

  const later = say(dotId, 'Window seat if you can.');
  assert.match(nowBlock(dotId, turn), new RegExp(`${asked.id} and ${later.id} have had no word from you yet; the user wrote the first`));

  store.appendDotItem(dotId, { kind: 'reaction', target: asked.id, emoji: '👀', label: 'Looking into it', text: '', turnId: 't1' });
  assert.match(nowBlock(dotId, turn), new RegExp(`^${later.id} has had no word`, 'm'), 'a reaction is word enough for its message');
  store.appendDotItem(dotId, { kind: 'dot', text: 'Two good options so far.', turnId: 't1' });
  assert.doesNotMatch(nowBlock(dotId, turn), /no word from you/, 'a message answers everything before it');
  assert.doesNotMatch(nowBlock(dotId, turn), /last heard from you/, 'a word just now needs no reminding');
  for (let step = 0; step < 3; step += 1) store.appendDotItem(dotId, { kind: 'call', tool: 'web_read', args: {}, text: '', turnId: 't1' });
  assert.match(nowBlock(dotId, turn), /The user last heard from you \d+ seconds? ago, in a message, 3 steps back\./, 'after a run of work, how long since they heard anything');
  assert.doesNotMatch(nowBlock(dotId), /into this turn/, 'outside a turn there is nothing to say');
});

it('lets the bot react with any emoji, and gives none of them a meaning of the harness\'s own', async () => {
  for (const emoji of ['👍', '🫡', '🍕', '👍🏽', '👩‍💻', '🇯🇵', '🏳️‍🌈']) assert.equal(normalizeReactionEmoji(emoji), emoji, emoji);
  assert.equal(normalizeReactionEmoji('❤'), '❤️', 'a symbol shown as text comes back as the emoji');
  assert.equal(normalizeReactionEmoji(' 🔥 '), '🔥');
  for (const notOne of ['ok', '👍👍', '', 'yes 👍']) assert.equal(normalizeReactionEmoji(notOne), null, JSON.stringify(notOne));

  const dotId = await newDot();
  const asked = say(dotId, 'Book the dentist for next week.');
  store.appendDotItem(dotId, { kind: 'reaction', target: asked.id, emoji: '👀', label: 'On it', text: '', turnId: 't1' });
  assert.doesNotMatch(nowBlock(dotId), /still say you are on something|👀/, 'its view reports no reaction back as a promise to keep');
});

it('teaches when to acknowledge, write and ask while working, as principles with no samples, in every mode', () => {
  const base = { dotName: 'Pip', tools: [], skills: [], computer: { root: ROOT, shell: 'PowerShell on Windows' } };
  for (const permissions of ['ask', 'auto', 'act']) {
    const prompt = createDotSystemPrompt({ ...base, permissions });
    for (const heading of ['# Your conversation', '# Deciding how to respond', '# While you work', '# How you work', '# Doing the work well', '# Protocol']) {
      assert.ok(prompt.includes(heading), `${permissions}: missing ${heading}`);
    }
    assert.match(prompt, /not one reply that must hold everything/);
    assert.match(prompt, /The answer is the acknowledgement: nothing comes before it/);
    assert.match(prompt, /Let them know you are on it before you start, in the same response as your first step — a reaction or a message, whichever fits/);
    assert.match(prompt, /Messages and reactions are both yours to use, as in any messenger, and neither is the default: use whichever fits the moment, both when each does a different job, and neither when nothing is needed/);
    assert.match(prompt, /When the request just needed doing and the result speaks for itself, a reaction can be the whole answer/);
    assert.match(prompt, /saying you are on something is a promise, so never end a turn on it with the work not started/);
    assert.match(prompt, /Reacting again to a message replaces your earlier reaction on it/);
    assert.match(prompt, /Never answer a question with a reaction alone/);
    assert.match(prompt, /A question always gets an answer\./);
    assert.match(prompt, /never when the user asked you something, or on work they are waiting for/);
    assert.match(prompt, /Any single emoji works: use the one that fits that message\./);
    assert.doesNotMatch(prompt, /lighter way|carries the state|still say you are on something|must be one of|never the automatic one/, `${permissions}: no lean towards reacting, and no list of emoji`);
    assert.doesNotMatch(prompt, /\p{Extended_Pictographic}/u, `${permissions}: not one emoji named anywhere in the prompt`);
    assert.match(prompt, /Write while you work at the moments a person would: when the plan is settled/);
    assert.match(prompt, /Each update says, in a sentence or two, what changed and what you are doing next/);
    assert.match(prompt, /Never narrate each step, repeat the plan, or write only to say you are still at it/);
    assert.match(prompt, /then what you could not do or check/);
    assert.match(prompt, /keep doing everything that does not depend on the answer/);
    assert.match(prompt, /time passing is never consent/);
    assert.match(prompt, /When the user writes while you work, they come first/);
    assert.match(prompt, /a message before your first call arrives while you work, and you can write again between calls/);
    const behaviour = prompt.slice(0, prompt.indexOf('# Protocol'));
    assert.doesNotMatch(behaviour, /for example|for instance|e\.g\.|such as/i, `${permissions}: principles, never samples`);
    assert.doesNotMatch(behaviour, /[“"](?:on it|got it|sure|will do|done|working on it|looking into it)[.!]?[”"]/i, `${permissions}: no sample acknowledgements`);
  }
});

it('gives each Permissions mode its own instructions, and keeps questions about the work open in all of them', () => {
  const base = { dotName: 'Pip', tools: [], skills: [], computer: { root: ROOT, shell: 'PowerShell on Windows' } };
  const ask = createDotSystemPrompt({ ...base, permissions: 'ask' });
  const auto = createDotSystemPrompt(base);
  const act = createDotSystemPrompt({ ...base, permissions: 'act' });
  assert.equal(createDotSystemPrompt({ ...base, permissions: 'auto' }), auto, 'asking when it matters is the default');

  assert.match(ask, /the user has asked you to check with them before you act/);
  assert.match(ask, /Ask once for a piece of work/);
  assert.match(ask, /The card is the asking; do not ask again in a message/);
  assert.match(ask, /Editing asks: `user_apply_patch` puts the change on a card/);
  assert.match(ask, /Running asks: every command waits until the user approves it/);

  assert.match(auto, /act on your own judgement, and ask when it matters/);
  assert.match(auto, /So is editing: `user_apply_patch` changes files there at once/);
  assert.match(auto, /Running asks/);

  assert.match(act, /the user has asked you to act without asking first/);
  assert.match(act, /Never stop to ask for permission\. Ask only for what you need to know to do the work well/);
  assert.match(act, /Acting at once is not acting beyond the request/);
  assert.match(act, /So is running: every command runs at once/);
  assert.doesNotMatch(act, /prefix_rule|A declined command stays declined|Running asks/);

  for (const prompt of [ask, auto, act]) assert.match(prompt, /A request to draft is not (permission|a request) to send/);
});

/* ------------------------------------------------------------------------ */
/* Do it right away                                                          */
/* ------------------------------------------------------------------------ */

it('runs commands at once when the user lets the bot act without asking, with a card that never wakes it', async () => {
  const { dotId, ran, toolset, run } = await connected('act');
  assert.match(store.getDotThread(dotId).items.at(-1).text, /changes and commands happen at once/, 'the bot hears how it may work there');
  assert.match(toolset.user_run_command.doc.description, /It runs at once, exactly as written/);
  assert.doesNotMatch(toolset.user_run_command.doc.args, /prefix_rule/);
  const seen = store.getDotThread(dotId).items.at(-1).seq;

  const result = await run('user_run_command', { command: 'npm test', reason: 'Check the fix' });
  assert.ok(!result.failed, result.observation);
  assert.match(result.observation, /^`npm test` \(i\d+\) exited with code 0\.\nOutput:\nall good/);
  assert.deepEqual(ran, ['npm test']);
  const thread = store.getDotThread(dotId);
  const card = thread.items.find((item) => item.kind === 'approval');
  assert.equal(card.approval.command, 'npm test');
  const steps = thread.items.filter((item) => item.ref === card.id);
  assert.deepEqual(steps.map((step) => step.approvalStep), ['approved', 'finished']);
  assert.ok(steps.every((step) => step.quiet && !wakesDot(step)), 'the call already told the bot');
  assert.ok(steps.every((step) => renderInput(step, { timeZone: 'UTC' }) === ''), 'and it never reads the output twice');
  assert.equal(pendingApprovals(thread).length, 0);
  assert.equal(unfinishedApprovals(thread).length, 0);
  assert.match(nowBlock(dotId, undefined, seen), /Nothing new has arrived since you last acted/);

  const job = await run('user_start_job', { command: 'npm run dev', reason: 'Serve it' });
  assert.match(job.observation, /^Started `npm run dev` in the background in C:\\work \(i\d+\)/);
  const jobCard = store.getDotThread(dotId).items.filter((item) => item.kind === 'approval').at(-1);
  assert.equal(approvalDecision(store.getDotThread(dotId), jobCard.id).approvalStep, 'started');
  assert.equal(store.getDotThread(dotId).runtime.jobs.at(-1).id, jobCard.id, 'a job it started is watched like any other');

  store.updateDotRuntime(dotId, { permissions: 'auto' });
  const asked = await run('user_run_command', { command: 'npm run lint', reason: 'Lint it' });
  assert.match(asked.observation, /Asked the user to approve/, 'a change of mind reaches a turn already running');
  assert.deepEqual(ran, ['npm test', 'npm run dev']);
});

it('sends email and posts on Discord at once when the user lets the bot act without asking', async () => {
  const dotId = await newDot();
  store.updateDotRuntime(dotId, { permissions: 'act' });
  const sent = [];
  const posted = [];
  const reacted = [];
  const deps = { send: async (mail) => { sent.push(mail); return { id: `g${sent.length}` }; }, post: async (post) => { posted.push(post); return { id: `m${posted.length}` }; }, wake: () => undefined, now: () => Date.now() };
  const env = {
    dotId,
    dotName: 'Pip',
    timeZone: 'UTC',
    now: () => Date.now(),
    host: null,
    personalData: true,
    permissions: 'act',
    mail: { canSend: true, deps, replyContext: async () => ({ problem: 'none' }) },
    discord: {
      botName: 'Pip',
      content: true,
      guilds: () => [{ id: '700000', name: 'Club', channels: [{ id: '700001', name: 'general', type: 0 }] }],
      dmChannelId: '900000',
      dm: async () => ({ channelId: '900000' }),
      read: async () => [],
      describe: () => '',
      react: async (channelId, messageId, emoji) => { reacted.push(emoji); return true; },
      talking: () => new Set(),
      deps,
    },
  };
  const [email] = emailTools(env);
  const [discord] = discordTools(env);
  assert.match(email.doc.description, /It goes at once/);
  assert.match(discord.doc.description, /it goes at once/);

  const mailed = await email.handler.run({ to: 'sam@example.com', subject: 'Notes', body: 'Here they are.', reason: 'They asked' }, { dotId, turnId: 't1' });
  assert.match(mailed.observation, /^Sent “Notes” to sam@example.com \(i\d+\)\. The user lets you act without asking\./);
  assert.equal(sent.length, 1);
  const mailCard = store.getDotThread(dotId).items.find((item) => item.kind === 'outgoing' && item.outgoing);
  assert.equal(mailCard.outgoing.standing, 'mode', 'the card says why it went without asking');
  assert.equal(mailCard.outgoingStep, 'sent');

  const post = await discord.handler.run({ action: 'post', channel: '#general', text: 'Launch at five.', reason: 'The team asked' }, { dotId, turnId: 't1' });
  assert.match(post.observation, /^Posted in #general in Club \(i\d+\)\. The user lets you act without asking\./);
  assert.equal(posted.length, 1);
  assert.equal(store.getDotThread(dotId).items.at(-1).discordPost.standing, 'mode');
  const reaction = await discord.handler.run({ action: 'react', channel: '#general', message: '100001', emoji: '👍' }, { dotId, turnId: 't1' });
  assert.ok(!reaction.failed, reaction.observation);
  assert.deepEqual(reacted, ['👍']);

  store.updateDotRuntime(dotId, { permissions: 'auto' });
  const held = await email.handler.run({ to: 'sam@example.com', subject: 'More notes', body: 'And these.', reason: 'Follow-up' }, { dotId, turnId: 't1' });
  assert.match(held.observation, /Asked the user to approve sending/);
  assert.equal(sent.length, 1);
  assert.equal((await discord.handler.run({ action: 'react', channel: '#general', message: '100001', emoji: '🎉' }, { dotId, turnId: 't1' })).failed, true);
});

/* ------------------------------------------------------------------------ */
/* Ask before doing anything                                                 */
/* ------------------------------------------------------------------------ */

const PATCH = (from, to) => `*** Begin Patch\n*** Update File: src/app.ts\n@@\n-export const app = ${from};\n+export const app = ${to};\n*** End Patch`;

it('proposes edits on a card while the bot asks first, and writes them only once the user applies them', async () => {
  const { dotId, files, woken, deps, toolset, run } = await connected('ask');
  assert.match(toolset.user_apply_patch.doc.description, /it reaches the user as a card, and the files change once they apply it/);

  const proposed = await run('user_apply_patch', { patch: PATCH(1, 2) });
  assert.match(proposed.observation, /^Asked the user to apply this change to C:\\work \(i\d+\): updated src\/app\.ts \(\+1 −1\)\. Nothing has changed yet/);
  assert.equal(files.get(`${ROOT}|src/app.ts`).text, 'export const app = 1;\n', 'nothing is written yet');
  const card = store.getDotThread(dotId).items.at(-1);
  assert.equal(card.kind, 'edit');
  assert.deepEqual(card.edit.proposed.scope, { root: ROOT });
  assert.equal(edits.editState(store.getDotThread(dotId), card), 'pending');
  assert.deepEqual(edits.pendingEdits(store.getDotThread(dotId)).map((item) => item.id), [card.id]);

  woken.length = 0;
  await edits.applyProposedEdit(dotId, card.id, deps);
  assert.equal(files.get(`${ROOT}|src/app.ts`).text, 'export const app = 2;\n');
  let thread = store.getDotThread(dotId);
  assert.equal(edits.editState(thread, card), 'applied');
  const steps = thread.items.filter((item) => item.ref === card.id);
  assert.deepEqual(steps.map((step) => step.editStep), ['applying', 'applied']);
  assert.equal(wakesDot(steps[0]), false, 'applying is only a record');
  assert.equal(wakesDot(steps[1]), true, 'the bot hears that it went in');
  assert.match(steps[1].text, /^The user applied your change to C:\\work \(i\d+\): updated src\/app\.ts/);
  assert.deepEqual(woken, [dotId]);
  await edits.applyProposedEdit(dotId, card.id, deps);
  assert.equal(store.getDotThread(dotId).items.filter((item) => item.ref === card.id).length, 2, 'applied once, however often it is tapped');

  await run('user_apply_patch', { patch: '*** Begin Patch\n*** Add File: notes.md\n+hello\n*** End Patch' });
  const declined = store.getDotThread(dotId).items.at(-1);
  edits.declineProposedEdit(dotId, declined.id, deps);
  assert.equal(edits.editState(store.getDotThread(dotId), declined), 'declined');
  assert.equal(files.has(`${ROOT}|notes.md`), false);

  await run('user_apply_patch', { patch: PATCH(2, 3) });
  const stale = store.getDotThread(dotId).items.at(-1);
  files.set(`${ROOT}|src/app.ts`, { text: 'export const app = 9;\n', modifiedAt: 5_000 });
  await edits.applyProposedEdit(dotId, stale.id, deps);
  thread = store.getDotThread(dotId);
  assert.equal(edits.editState(thread, stale), 'failed');
  assert.ok(edits.editProblem(thread, stale), 'the card says why');
  assert.match(thread.items.at(-1).text, /no longer fits the files, so nothing changed/);
  assert.equal(files.get(`${ROOT}|src/app.ts`).text, 'export const app = 9;\n', 'what the user changed meanwhile is left alone');

  await run('user_apply_patch', { patch: PATCH(9, 10) });
  const waiting = store.getDotThread(dotId).items.at(-1);
  await access.connectComputer(dotId, 'C:\\elsewhere', deps);
  thread = store.getDotThread(dotId);
  assert.equal(edits.editState(thread, waiting), 'failed', 'a new folder withdraws what waited on the old one');
  assert.match(edits.editProblem(thread, waiting), /^Withdrawn: the user connected a different folder/);
  assert.equal(edits.pendingEdits(thread).length, 0);
});

it('settles a proposal whose window closed while applying it', async () => {
  const { dotId, deps, run } = await connected('ask');
  await run('user_apply_patch', { patch: PATCH(1, 2) });
  const card = store.getDotThread(dotId).items.at(-1);
  store.appendDotItem(dotId, { kind: 'event', event: 'edit', ref: card.id, editStep: 'applying', quiet: true, text: 'Applying.' });
  edits.settleInterruptedEdits(dotId, deps);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const thread = store.getDotThread(dotId);
  assert.equal(edits.editState(thread, card), 'failed');
  assert.match(thread.items.at(-1).text, /was being applied when Willow closed/);
});
