import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const pets = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', 'pets', ...parts);

const {
  activityOf,
  dismissEntry,
  entriesFrom,
  formatActivityDetail,
  greetingFor,
  GREETING_KEY,
  PetSensorMemory,
  readSparkTasks,
  signatureOf,
  toolDetail,
} = await importTs(pets('pet-sensor.ts'));
const { hatchPetSkill } = await importTs(pets('pet-skill.ts'));

const HOUR = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const task = (id, status, extra = {}, at = Date.now()) => ({
  id,
  title: `Task ${id}`,
  description: '',
  time: '',
  status,
  prompt: '',
  response: '',
  turns: [],
  isPinned: false,
  createdAt: iso(at),
  updatedAt: iso(at),
  ...extra,
});

const tray = (memory, tasks, now, questions = {}) =>
  activityOf(entriesFrom(memory, readSparkTasks(tasks, questions, now), now), memory, null, true, now);

it('treats unread replies already there when the pet arrives as the baseline', () => {
  const now = Date.now();
  const memory = new PetSensorMemory();
  const { entries } = tray(memory, [task('a', 'complete', { hasUnreadCompletion: true }, now - 60_000)], now);
  assert.deepEqual(entries, []);
});

it('always reports work, questions and failures', () => {
  const now = Date.now();
  const memory = new PetSensorMemory();
  const { entries, working } = tray(memory, [
    task('run', 'running', {}, now - 1000),
    task('ask', 'needs-input', {}, now - 2000),
    task('bad', 'failed', {}, now - 3000),
  ], now);
  assert.equal(working, true);
  assert.deepEqual(entries.map((entry) => [entry.key, entry.status]), [['run', 'running'], ['ask', 'waiting'], ['bad', 'failed']]);
  assert.equal(entries.find((entry) => entry.key === 'ask').subtitle, 'Needs input');
});

it('turns a task that finished while watched into a Ready card', () => {
  const start = Date.now();
  const memory = new PetSensorMemory();
  tray(memory, [task('a', 'running', {}, start)], start);
  const later = start + 5000;
  const { entries, working } = tray(memory, [task('a', 'complete', { hasUnreadCompletion: true }, later)], later);
  assert.equal(working, false);
  assert.deepEqual(entries.map((entry) => [entry.key, entry.status]), [['a', 'review']]);
});

it('lets a stale failure expire, by the age the task itself gives', () => {
  const now = Date.now();
  const memory = new PetSensorMemory();
  const { entries } = tray(memory, [task('old', 'failed', {}, now - 2 * HOUR)], now);
  assert.deepEqual(entries, []);
});

it('keeps a dismissed card away until its task does something new', () => {
  const start = Date.now();
  const memory = new PetSensorMemory();
  let { entries } = tray(memory, [task('a', 'needs-input', {}, start)], start);
  const remaining = dismissEntry(memory, entries, 'a');
  assert.deepEqual(remaining, []);
  ({ entries } = tray(memory, [task('a', 'needs-input', {}, start)], start + 1000));
  assert.deepEqual(entries, []);
  ({ entries } = tray(memory, [task('a', 'failed', {}, start + 2000)], start + 2000));
  assert.deepEqual(entries.map((entry) => entry.status), ['failed']);
});

it('reports work even when its card was sent away, and hides cards when asked', () => {
  const now = Date.now();
  const memory = new PetSensorMemory();
  const all = entriesFrom(memory, readSparkTasks([task('a', 'running', {}, now)], {}, now), now);
  dismissEntry(memory, all, 'a');
  const dismissed = activityOf(all, memory, null, true, now);
  assert.equal(dismissed.working, true);
  assert.deepEqual(dismissed.entries, []);
  const hidden = activityOf(entriesFrom(new PetSensorMemory(), readSparkTasks([task('b', 'running', {}, now)], {}, now), now), new PetSensorMemory(), null, false, now);
  assert.equal(hidden.working, true);
  assert.deepEqual(hidden.entries, []);
});

it('sorts the greeting after every task, and drops it when it expires', () => {
  const now = Date.now();
  const memory = new PetSensorMemory();
  const greeting = greetingFor('Rocky', now);
  assert.equal(greeting.title, "Hi, I'm Rocky");
  const all = entriesFrom(memory, readSparkTasks([task('a', 'running', {}, now)], {}, now), now);
  const shown = activityOf(all, memory, greeting, true, now);
  assert.deepEqual(shown.entries.map((entry) => entry.key), ['a', GREETING_KEY]);
  const gone = activityOf(all, memory, greeting, true, now + 9000);
  assert.equal(gone.greeting, null);
  assert.deepEqual(gone.entries.map((entry) => entry.key), ['a']);
});

it('puts the most recent activity first', () => {
  const now = Date.now();
  const memory = new PetSensorMemory();
  const { entries } = tray(memory, [task('older', 'running', {}, now - 50_000), task('newer', 'running', {}, now - 1000)], now);
  assert.deepEqual(entries.map((entry) => entry.key), ['newer', 'older']);
});

it('says what a task is doing in the plugin\'s words', () => {
  const now = Date.now();
  const running = task('a', 'running', { activityLog: [{ id: '1', kind: 'tool', tool: 'command', label: 'npm test' }] }, now);
  assert.equal(readSparkTasks([running], {}, now)[0].detail, 'Running tests');
  const following = task('b', 'running', { turns: [{ id: 't', prompt: '', response: '', createdAt: iso(now), activityLog: [{ id: '2', kind: 'subagents' }] }] }, now);
  assert.equal(readSparkTasks([following], {}, now)[0].detail, 'Running subagent');
  const asked = task('c', 'needs-input', {}, now);
  const question = { taskId: 'c', questions: [{ id: 'q', header: 'Pick', question: 'Which colour?', options: [] }], blocking: true, index: 0, drafts: [] };
  assert.equal(readSparkTasks([asked], { c: question }, now)[0].detail, 'Waiting for input: Which colour?');
  assert.equal(toolDetail('computer:Find a flight'), 'Using browser');
  assert.equal(toolDetail('web_search'), 'Using browser');
  assert.equal(toolDetail('request_user_input:asking:1'), 'Waiting for input');
  assert.equal(formatActivityDetail('Running: npm run build', 'run_command'), 'Building project');
  assert.equal(formatActivityDetail('Thinking about it'), 'Thinking');
});

it('changes its signature with the words on a card, and only then', () => {
  const entry = { key: 'a', status: 'running', title: 'A', subtitle: 'Thinking', place: 1, sortAtMs: 1, updatedAtMs: 1 };
  assert.equal(signatureOf([entry], true), signatureOf([{ ...entry, sortAtMs: 99 }], true));
  assert.notEqual(signatureOf([entry], true), signatureOf([{ ...entry, title: 'Renamed' }], true));
});

it('hands its memory to the next tab intact', () => {
  const now = Date.now();
  const memory = new PetSensorMemory();
  const all = entriesFrom(memory, readSparkTasks([task('a', 'running', {}, now)], {}, now), now);
  dismissEntry(memory, all, 'a');
  const copy = PetSensorMemory.fromJSON(JSON.parse(JSON.stringify(memory)));
  assert.deepEqual([...copy.seen.keys()], ['a']);
  assert.equal(copy.dismissed.get('a'), memory.dismissed.get('a'));
});

it('makes a Spark skill of the Hatch Pet SKILL.md, with real paths in it', () => {
  const text = fs.readFileSync(pets('hatch-pet', 'SKILL.md'), 'utf8');
  const skill = hatchPetSkill(text, 'C:/Willow/hatch-pet', 'C:/Users/Me/AppData/Roaming/com.willow.studio/pets');
  assert.equal(skill.name, 'hatch-pet');
  assert.match(skill.description, /desktop pet for Willow's Pets/);
  assert.match(skill.instructions, /python "C:\/Willow\/hatch-pet\/scripts\/pet_bridge\.py" --library "C:\/Users\/Me\/AppData\/Roaming\/com\.willow\.studio\/pets" begin/);
  assert.doesNotMatch(skill.instructions, /<skill>|<library>|^---/);
});
