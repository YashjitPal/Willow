import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', 'dots', 'harness', ...parts);

const store = await importTs(harness('thread', 'thread-store.ts'));
const { memoryPersistence } = await importTs(harness('thread', 'thread-persistence.ts'));
const learning = await importTs(harness('memory', 'learning.ts'));
const { budgetsForWindow } = await importTs(harness('memory', 'budgets.ts'));
const { buildDotContext } = await importTs(harness('memory', 'context-builder.ts'));

store.setDotThreadPersistence(memoryPersistence());

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 7, 12, 0);
let counter = 0;
const newDot = async () => {
  counter += 1;
  const dotId = `dot-learn-${counter}`;
  await store.loadDotThread(dotId);
  return dotId;
};
const say = (dotId, text, kind = 'user') => store.appendDotItem(dotId, { kind, text, at: NOW, ...(kind === 'dot' ? { turnId: 't1' } : {}) });

it('compacts three quarters of the way into the window and keeps the latest fifth word for word', () => {
  const large = budgetsForWindow(1_000_000);
  assert.equal(large.verbatimHigh, 750_000);
  assert.equal(large.verbatimLow, 200_000);
  assert.ok(large.hardCap >= 900_000 && large.hardCap < 1_000_000, 'a full window still fits a request');
  const medium = budgetsForWindow(200_000);
  assert.equal(medium.verbatimHigh, 150_000);
  assert.equal(medium.verbatimLow, 40_000);
  assert.ok(medium.verbatimLow < medium.verbatimHigh && medium.verbatimHigh < medium.hardCap);
});

it('learns once something new comes from the user, often enough to keep up and seldom enough to be cheap', async () => {
  const dotId = await newDot();
  const thread = () => store.getDotThread(dotId);
  assert.equal(learning.learningDue(thread(), NOW), false, 'nothing from the user yet');
  say(dotId, 'I run the design team at a small studio.');
  assert.equal(learning.learningDue(thread(), NOW), true, 'the first message is worth learning from at once');
  store.updateDotRuntime(dotId, (runtime) => ({ ...runtime, learned: { facts: [], throughSeq: thread().items.at(-1).seq, learnedAt: NOW } }));
  say(dotId, 'Thanks!');
  assert.equal(learning.learningDue(thread(), NOW + HOUR), false, 'one message, an hour later, waits');
  assert.equal(learning.learningDue(thread(), NOW + 7 * HOUR), true, 'but not for ever');
  for (let index = 0; index < 5; index += 1) say(dotId, `Message ${index}`);
  assert.equal(learning.learningDue(thread(), NOW + HOUR), true, 'enough new messages are learned from soon');
  learning.setLearning(dotId, false);
  assert.equal(learning.learningDue(thread(), NOW + 7 * HOUR), false, 'the user can turn it off');
});

it('keeps only checked changes: real sections, one sentence each, no secrets, no duplicates, sources that exist', () => {
  const known = new Set(['i3', 'i4']);
  const profile = { facts: [{ id: 'f1', section: 'work', text: 'Runs the design team at a small studio.', sources: ['i1'], learnedAt: 1, updatedAt: 1 }], throughSeq: 2 };
  const next = learning.applyLearning(profile, {
    add: [
      { section: 'people', text: 'Works closely with Ana,\u200B who leads engineering.', sources: ['i3', 'i99'] },
      { section: 'work', text: 'runs the design team at a small studio' },
      { section: 'mood', text: 'Was tired on Tuesday.' },
      { section: 'facts', text: 'Their password is hunter2.' },
      { section: 'preferences', text: 'x'.repeat(400) },
    ],
    update: [{ id: 'f1', text: 'Runs the design team and its hiring at a small studio.', sources: ['i4'] }],
    remove: [],
  }, NOW, known);
  const texts = next.facts.map((fact) => fact.text);
  assert.ok(texts.includes('Works closely with Ana, who leads engineering.'), 'hidden characters dropped');
  assert.deepEqual(next.facts.find((fact) => fact.section === 'people').sources, ['i3'], 'only sources that exist');
  assert.equal(texts.filter((text) => /design team/.test(text)).length, 1, 'a near-copy of a kept fact is not added');
  assert.ok(!texts.some((text) => /tired|hunter2/.test(text)), 'unknown sections and secrets are refused');
  assert.ok(texts.some((text) => text.length === 240 && text.endsWith('…')), 'long facts are cut to one sentence');
  const updated = next.facts.find((fact) => fact.id === 'f1');
  assert.equal(updated.text, 'Runs the design team and its hiring at a small studio.');
  assert.deepEqual(updated.sources, ['i1', 'i4']);
  assert.equal(learning.applyLearning(next, { add: [], update: [], remove: ['f1'] }, NOW, known).facts.some((fact) => fact.id === 'f1'), false);

  const crowded = { facts: Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, section: 'people', text: `Person number ${index} is a friend.`, sources: [], learnedAt: index, updatedAt: index })), throughSeq: 0 };
  const capped = learning.applyLearning(crowded, { add: [], update: [], remove: [] }, NOW, known);
  assert.equal(capped.facts.length, 16, 'a section keeps its sixteen most recently confirmed');
  assert.ok(!capped.facts.some((fact) => fact.id === 'p0'));
});

it('learns from the conversation in the background, and never brings back what the user removed meanwhile', async () => {
  const dotId = await newDot();
  store.updateDotRuntime(dotId, (runtime) => ({ ...runtime, learned: { facts: [{ id: 'f1', section: 'facts', text: 'Lives in Lisbon.', sources: [], learnedAt: 1, updatedAt: 1 }], throughSeq: 0 } }));
  const first = say(dotId, 'I moved to Porto last month, and I am planning the studio launch for March.');
  say(dotId, 'Noted — I will keep the launch in mind.', 'dot');
  const asked = [];
  const changed = await learning.learnAboutUser({
    dotId,
    dotName: 'Pip',
    purpose: 'Keep the studio launch on track.',
    about: 'Name: Sam.',
    timeZone: 'UTC',
    now: () => NOW,
    summarize: async (request) => {
      asked.push(request);
      learning.forgetLearnedFact(dotId, 'f1');
      return `Here you go:\n{"add": [{"section": "projects", "text": "Is planning the studio launch for March.", "sources": ["${first.id}"]}], "update": [{"id": "f1", "text": "Lives in Porto."}], "remove": []}`;
    },
  });
  const learned = store.getDotThread(dotId).runtime.learned;
  assert.equal(changed, 1);
  assert.deepEqual(learned.facts.map((fact) => fact.text), ['Is planning the studio launch for March.'], 'the removed fact stays removed');
  assert.equal(learned.throughSeq, store.getDotThread(dotId).items.at(-1).seq);
  assert.match(asked[0].systemPrompt, /Keep the studio launch on track\./);
  assert.match(asked[0].prompt, /<willow_knows>\nName: Sam\.\n<\/willow_knows>/);
  assert.match(asked[0].prompt, /moved to Porto/);
  assert.doesNotMatch(asked[0].systemPrompt, /e\.g\.|for example|such as "/i, 'principles, not examples');
  assert.equal(await learning.learnAboutUser({ dotId, dotName: 'Pip', about: '', timeZone: 'UTC', now: () => NOW, summarize: async () => { throw new Error('nothing new to read'); } }), 0);
});

it('shows the bot what it learned, by section, beside what Willow knows', async () => {
  const dotId = await newDot();
  say(dotId, 'Hi');
  const profile = { facts: [
    { id: 'a', section: 'work', text: 'Runs the design team.', sources: [], learnedAt: 1, updatedAt: 1 },
    { id: 'b', section: 'preferences', text: 'Likes short updates.', sources: [], learnedAt: 1, updatedAt: 1 },
  ], throughSeq: 1 };
  const block = learning.learnedBlock(profile, 'Pip');
  assert.match(block, /^<learned_about_user source="Pip's own conversations">/);
  assert.match(block, /## Their work\n- Runs the design team\./);
  assert.match(block, /## How they like things done\n- Likes short updates\./);
  assert.equal(learning.learnedBlock({ ...profile, off: true }, 'Pip'), '');
  const context = buildDotContext({
    thread: store.getDotThread(dotId),
    systemPrompt: 'system',
    about: 'Name: Sam.',
    learned: block,
    budgets: budgetsForWindow(200_000),
    now: NOW,
    timeZone: 'UTC',
    seenSeq: 0,
    delegations: [],
  });
  const memory = context.messages.map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content))).join('\n');
  assert.ok(memory.indexOf('<about_user source="Willow">') < memory.indexOf('<learned_about_user'), 'after what Willow knows');
  assert.match(memory, /Runs the design team\./);
});
