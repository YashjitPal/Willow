/**
 * Dots in the user's folder (features/spark/src/dots/dots-folder-plan.ts): what a dot's file holds,
 * what a file from disk is taken for, and what a pass does with disk's files — a copy of Willow
 * never loses what it has.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const dotsDir = path.join(repo, 'features', 'spark', 'src', 'dots');
const { DOTS_FOLDER, parseDotFile, planDotsApply, serializeDotFile, threadRelation } = await importTs(path.join(dotsDir, 'dots-folder-plan.ts'));

const dot = (id, extra = {}) => ({
  id,
  name: null,
  presetId: 'blue_beret',
  appearance: null,
  petId: null,
  status: 'ready',
  category: null,
  createdAt: 1,
  updatedAt: 1,
  messages: [],
  ...extra,
});
const item = (seq, extra = {}) => ({ id: `i${seq}`, seq, kind: 'user', at: 1000 + seq, text: `message ${seq}`, ...extra });
const thread = (dotId, items, extra = {}) => ({
  version: 1,
  dotId,
  items,
  nextSeq: items.length + 1,
  episodes: [],
  notebook: {},
  runtime: { status: 'idle', lastActedSeq: 0, lastCompactedSeq: 0, routines: [], delegations: [], usage: { inputTokens: 0, outputTokens: 0, turns: 0 } },
  ...extra,
});

it('keeps each dot in Spark/Dots, with its whole conversation and nothing only this session knows', () => {
  assert.equal(DOTS_FOLDER, 'Spark/Dots');
  const contents = serializeDotFile(
    dot('dot-1', { status: 'creating', isReplying: true, name: 'Ada' }),
    thread('dot-1', [item(1), item(2, { kind: 'dot', streaming: true })], { notebook: { 'plan.md': { text: 'x', updatedAt: 3 } } }),
  );
  const file = parseDotFile('dot-1', contents);
  assert.equal(file.dot.name, 'Ada');
  assert.equal(file.dot.status, 'ready');
  assert.equal('isReplying' in file.dot, false);
  assert.deepEqual(file.thread.items.map((entry) => entry.seq), [1], 'a message still streaming is written once it closes');
  assert.equal(file.thread.notebook['plan.md'].text, 'x');
  assert.equal(parseDotFile('dot-1', serializeDotFile(dot('dot-1'), null)).thread, null);
});

it('writes the same file however the conversation was read', () => {
  const loaded = thread('dot-1', [item(1)]);
  const { items, ...meta } = loaded;
  const fromIndexedDb = { ...meta, items };
  assert.equal(serializeDotFile(dot('dot-1'), fromIndexedDb), serializeDotFile(dot('dot-1'), loaded));
});

it('takes nothing from disk but a dot file under its own name', () => {
  const good = serializeDotFile(dot('dot-1'), thread('dot-1', [item(1)]));
  assert.equal(parseDotFile('dot-1 (Disk conflict 2026-10-07)', good), null, "the engine's conflict copies are not dots");
  assert.equal(parseDotFile('dot-1', '{ not json'), null);
  assert.equal(parseDotFile('dot-1', JSON.stringify({ version: 2, dot: dot('dot-1'), thread: null })), null);
  assert.equal(parseDotFile('dot-1', JSON.stringify({ version: 1, dot: dot('dot-1'), thread: { ...thread('dot-1', []), items: [{ seq: 'one' }] } })), null);
  assert.equal(parseDotFile('dot-1', JSON.stringify({ version: 1, dot: dot('dot-1'), thread: thread('dot-2', []) })), null);
});

it('tells a conversation further along on disk from one that went its own way', () => {
  const here = thread('d', [item(1), item(2)]);
  assert.equal(threadRelation(here, thread('d', [item(1), item(2)])), 'same');
  assert.equal(threadRelation(here, thread('d', [item(1), item(2), item(3)])), 'ahead');
  assert.equal(threadRelation(here, thread('d', [item(1), item(2)], { notebook: { a: { text: 'new', updatedAt: 9 } } })), 'ahead');
  assert.equal(threadRelation(here, thread('d', [item(1)])), 'behind');
  assert.equal(threadRelation(here, thread('d', [item(1), item(2, { at: 5 }), item(3)])), 'diverged', 'another copy gave seq 2 to another message');
  assert.equal(threadRelation(here, thread('d', [item(1), item(2, { text: 'said elsewhere' })])), 'diverged', 'even in the same millisecond');
  assert.equal(threadRelation(null, here), 'ahead');
  assert.equal(threadRelation(here, null), 'behind');
  assert.equal(threadRelation(thread('d', [item(1), item(2, { kind: 'dot', streaming: true })]), thread('d', [item(1)])), 'behind', 'a message streaming here is one disk lacks');
});

it('adds the dots another copy made, with their conversations', () => {
  const plan = planDotsApply(
    { dots: [], thread: () => null },
    [
      { version: 1, dot: dot('dot-old', { createdAt: 1 }), thread: thread('dot-old', [item(1)]) },
      { version: 1, dot: dot('dot-new', { createdAt: 5 }), thread: null },
    ],
    new Set(),
  );
  assert.deepEqual(plan.added.map((entry) => entry.id), ['dot-new', 'dot-old']);
  assert.deepEqual(plan.threads.map((entry) => entry.dotId), ['dot-old'], 'a dot without a conversation yet keeps its old messages on the dot');
  assert.deepEqual([plan.updated, plan.held, plan.removed], [[], [], []]);
});

it('brings a conversation up to date only when disk carries it further', () => {
  const local = { dots: [dot('a', { name: 'Here' }), dot('b')], thread: (id) => thread(id, [item(1), item(2)]) };
  const files = [
    { version: 1, dot: dot('a', { name: 'Renamed there', updatedAt: 9 }), thread: thread('a', [item(1), item(2), item(3)]) },
    { version: 1, dot: dot('b', { name: 'Lost' }), thread: thread('b', [item(1), item(2, { at: 7 })]) },
  ];
  const plan = planDotsApply(local, files, new Set(['a', 'b']));
  assert.deepEqual(plan.updated.map((entry) => [entry.id, entry.name]), [['a', 'Renamed there']]);
  assert.deepEqual(plan.threads.map((entry) => [entry.dotId, entry.thread.items.length]), [['a', 3]]);
  assert.deepEqual(plan.held, ['b'], 'a conversation that went its own way here is kept, with the dot as it is');
});

it('lets a dot deleted in another copy go here, but never one made while the pass ran', () => {
  const plan = planDotsApply(
    { dots: [dot('deleted-there'), dot('made-mid-pass')], thread: () => null },
    [],
    new Set(['deleted-there']),
  );
  assert.deepEqual(plan.removed, ['deleted-there']);
  assert.deepEqual([plan.updated, plan.added, plan.held], [[], [], []]);
});

it('is registered with the Spark folders, and asks for a pass when a dot changes', () => {
  const folder = fs.readFileSync(path.join(dotsDir, 'dots-folder.ts'), 'utf8');
  assert.match(folder, /registerSyncedFolder\('spark-dots', \{\s*folder: DOTS_FOLDER,\s*extension: '\.json',/);
  assert.match(folder, /reviveLocal: true/);
  assert.match(folder, /sparkDots\.listen\(passSoon\);\s*dotThreads\.listen\(passSoon\);/);
  assert.match(fs.readFileSync(path.join(repo, 'features', 'spark', 'src', 'register.ts'), 'utf8'), /import '\.\/dots\/dots-folder';/);
});
