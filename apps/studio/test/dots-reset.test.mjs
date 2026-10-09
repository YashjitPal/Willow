/**
 * Starting a bot's conversation over (thread-store.ts `resetDotThreadConversation`): its messages and their summaries
 * go, what the bot keeps for itself stays, and what was written before the reset — a summary finishing late, the bots
 * folder's file — cannot bring the old conversation back.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const dotsDir = path.join(repo, 'features', 'spark', 'src', 'dots');
const store = await importTs(path.join(dotsDir, 'harness', 'thread', 'thread-store.ts'));
const { memoryPersistence } = await importTs(path.join(dotsDir, 'harness', 'thread', 'thread-persistence.ts'));
const { planDotsApply, threadRelation } = await importTs(path.join(dotsDir, 'dots-folder-plan.ts'));

const persistence = memoryPersistence();
store.setDotThreadPersistence(persistence);

const episode = (id, fromSeq, toSeq) => ({ id, level: 1, fromSeq, toSeq, fromAt: 0, toAt: 0, text: `messages ${fromSeq} to ${toSeq}`, tokens: 4, createdAt: 0 });

it('clears the messages and their summaries, and keeps the notebook, instructions and the rest', async () => {
  const dotId = 'dot-reset-keeps';
  await store.loadDotThread(dotId);
  store.appendDotItems(dotId, [{ kind: 'user', text: 'I love ramen' }, { kind: 'dot', text: 'Noted!' }]);
  store.recordDotEpisodes(dotId, { add: [episode('e1', 1, 2)], lastCompactedSeq: 2 });
  store.writeDotNotebookFile(dotId, 'user.md', 'Loves ramen');
  store.updateDotRuntime(dotId, { instructions: 'Keep it short' });
  const lastSeq = store.getDotThread(dotId).nextSeq - 1;

  await store.resetDotThreadConversation(dotId);

  const thread = store.getDotThread(dotId);
  assert.deepEqual(thread.items, []);
  assert.deepEqual(thread.episodes, []);
  assert.equal(thread.notebook['user.md'].text, 'Loves ramen');
  assert.equal(thread.runtime.instructions, 'Keep it short');
  assert.equal(thread.runtime.lastActedSeq, lastSeq);
  assert.equal(thread.runtime.conversationReset.seq, lastSeq);

  const stored = await persistence.load(dotId);
  assert.deepEqual(stored.items, []);
  assert.deepEqual(stored.meta.episodes, []);
  assert.equal(stored.meta.notebook['user.md'].text, 'Loves ramen');
  assert.equal(stored.meta.runtime.conversationReset.seq, lastSeq);
});

it('takes no late summary of the old messages, and numbers new messages after them', async () => {
  const dotId = 'dot-reset-late';
  await store.loadDotThread(dotId);
  store.appendDotItems(dotId, [{ kind: 'user', text: 'one' }, { kind: 'dot', text: 'two' }]);
  await store.resetDotThreadConversation(dotId);

  store.recordDotEpisodes(dotId, { add: [episode('late', 1, 2)], lastCompactedSeq: 2 });
  assert.deepEqual(store.getDotThread(dotId).episodes, []);

  const fresh = store.appendDotItem(dotId, { kind: 'user', text: 'fresh start' });
  assert.ok(fresh.seq > 2);
  assert.deepEqual(store.getDotThread(dotId).items.map((item) => item.text), ['fresh start']);
});

const item = (seq) => ({ id: `i${seq}`, seq, kind: 'user', at: 1000 + seq, text: `message ${seq}` });
const thread = (dotId, items, runtime = {}) => ({
  version: 1,
  dotId,
  items,
  nextSeq: (items.at(-1)?.seq ?? 0) + 1,
  episodes: [],
  notebook: {},
  runtime: { status: 'idle', lastActedSeq: 0, lastCompactedSeq: 0, routines: [], delegations: [], usage: { inputTokens: 0, outputTokens: 0, turns: 0 }, ...runtime },
});

it('counts a conversation started over as further along than any copy from before it', () => {
  const before = thread('d', [item(1), item(2), item(3)]);
  const restarted = { ...thread('d', [], { conversationReset: { at: 5000, seq: 3 } }), nextSeq: 4 };
  // Disk still holds the old conversation: this copy's reset is written over it.
  assert.equal(threadRelation(restarted, before), 'behind');
  // Disk holds a reset made in another copy: this copy takes it.
  assert.equal(threadRelation(before, restarted), 'ahead');
  // The same reset on both sides compares message by message again.
  assert.equal(threadRelation(restarted, { ...restarted, items: [item(4)], nextSeq: 5 }), 'ahead');
});

it('brings in a conversation another copy started over, though it holds fewer messages', () => {
  const dot = { id: 'd', name: null, presetId: 'blue_beret', appearance: null, petId: null, status: 'ready', category: null, createdAt: 1, updatedAt: 1, messages: [] };
  const local = thread('d', [item(1), item(2)]);
  const file = { version: 1, dot, thread: { ...thread('d', [], { conversationReset: { at: 9000, seq: 2 } }), nextSeq: 3 } };
  const plan = planDotsApply({ dots: [dot], thread: () => local }, [file], new Set(['d']));
  assert.deepEqual(plan.threads.map((entry) => entry.dotId), ['d']);
  assert.deepEqual(plan.held, []);
});
