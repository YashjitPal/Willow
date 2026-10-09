import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', 'dots', 'harness', ...parts);

const store = await importTs(harness('thread', 'thread-store.ts'));
const { memoryPersistence } = await importTs(harness('thread', 'thread-persistence.ts'));
const plans = await importTs(harness('runtime', 'plan.ts'));
const { planTool } = await importTs(harness('tools', 'plan-tools.ts'));
const { createDotSystemPrompt } = await importTs(harness('overlay', 'dot-profile.ts'));
const { wakesDot } = await importTs(harness('thread', 'thread-types.ts'));

store.setDotThreadPersistence(memoryPersistence());

let clock = Date.UTC(2026, 9, 7, 9, 0);
let counter = 0;
const newDot = async () => {
  counter += 1;
  const dotId = `dot-plan-${counter}`;
  await store.loadDotThread(dotId);
  return dotId;
};
const toolFor = (dotId) => planTool({ dotId, dotName: 'Pip', timeZone: 'UTC', now: () => (clock += 1_000), host: null, personalData: false }).handler;
const cards = (dotId) => store.getDotThread(dotId).items.filter((item) => item.kind === 'plan-card');

it('reads plans in the shape Codex uses, with one step in progress at a time', () => {
  assert.deepEqual(plans.parsePlanSteps([{ step: 'Read the spec', status: 'completed' }, { step: 'Write the parser', status: 'in progress' }, { step: 'Wait for review', status: 'waiting' }, { step: 'Ship' }]), [
    { step: 'Read the spec', status: 'completed' },
    { step: 'Write the parser', status: 'in_progress' },
    { step: 'Wait for review', status: 'waiting' },
    { step: 'Ship', status: 'pending' },
  ]);
  assert.match(plans.parsePlanSteps([{ step: 'A', status: 'in_progress' }, { step: 'B', status: 'in_progress' }]), /Only one step can be in progress/);
  assert.match(plans.parsePlanSteps([{ step: '', status: 'pending' }]), /needs its "step"/);
  assert.match(plans.parsePlanSteps([{ step: 'A', status: 'maybe' }]), /not a status/);
  assert.match(plans.parsePlanSteps('do things'), /Give "plan"/);
  assert.match(plans.parsePlanSteps(Array.from({ length: 30 }, (_, index) => ({ step: `Step ${index}` }))), /at most 24 steps/);
});

it('keeps one live plan with a card, updates it in place, and starts a new one once it is done', async () => {
  const dotId = await newDot();
  const update = toolFor(dotId);
  const context = { turnId: 't1' };
  const set = await update.run({ goal: 'the report is in the user\'s folder', plan: [{ step: 'Gather figures', status: 'in_progress' }, { step: 'Write the report' }] }, context);
  assert.match(set.observation, /^Plan set \(p[a-z0-9]+\): 0 of 2 done; in progress: Gather figures\.$/);
  const plan = store.getDotThread(dotId).runtime.plan;
  assert.equal(plan.goal, 'the report is in the user\'s folder');
  assert.equal(cards(dotId).length, 1);
  assert.equal(cards(dotId)[0].ref, plan.id);

  store.updateDotRuntime(dotId, (runtime) => ({ ...runtime, plan: { ...runtime.plan, stillTurns: 2, stalledAt: clock } }));
  const moved = await update.run({ plan: [{ step: 'Gather figures', status: 'completed' }, { step: 'Write the report', status: 'in_progress' }] }, context);
  assert.match(moved.observation, /^Plan updated .*1 of 2 done/);
  const updated = store.getDotThread(dotId).runtime.plan;
  assert.equal(updated.id, plan.id, 'the same plan, changed');
  assert.equal(updated.goal, plan.goal, 'its goal carries over');
  assert.equal(updated.stillTurns, 0);
  assert.equal(updated.stalledAt, undefined, 'a change starts it moving again');
  assert.equal(cards(dotId).length, 1, 'no second card for the same plan');

  assert.match((await update.run({ plan: [{ step: 'Gather figures', status: 'completed' }, { step: 'Write the report', status: 'completed' }] }, context)).observation, /Plan complete/);
  await update.run({ plan: [{ step: 'Book the venue', status: 'in_progress' }] }, context);
  assert.notEqual(store.getDotThread(dotId).runtime.plan.id, plan.id, 'a finished plan is followed by a new one');
  assert.equal(cards(dotId).length, 2);
  assert.match((await update.run({ plan: [] }, context)).observation, /Plan cleared/);
  assert.equal(store.getDotThread(dotId).runtime.plan, undefined);
});

it('carries a plan on while it has steps to move, waits for whoever holds it up, looks back once when done, and stops a loop', () => {
  const plan = (steps, extra = {}) => ({ id: 'p1', steps, createdAt: 0, updatedAt: 0, ...extra });
  const moving = plan([{ step: 'A', status: 'completed' }, { step: 'B', status: 'in_progress' }]);
  assert.equal(plans.planNext(moving, false), 'continue');
  assert.equal(plans.planNext(moving, true), null, 'an approval, a card or delegated work wakes the bot by itself');
  assert.equal(plans.planNext(plan([{ step: 'A', status: 'completed' }, { step: 'Reply from the bank', status: 'waiting' }]), false), null, 'everything left is waiting');
  assert.equal(plans.planNext({ ...moving, stillTurns: plans.STALL_TURNS - 1 }, false), 'continue');
  assert.equal(plans.planNext({ ...moving, stillTurns: plans.STALL_TURNS }, false), 'stall', 'continuations that move nothing stop');
  assert.equal(plans.planNext({ ...moving, stalledAt: 1 }, false), null);
  const done = plan([{ step: 'A', status: 'completed' }]);
  assert.equal(plans.planNext(done, true), 'reflect', 'looking back waits on nobody');
  assert.equal(plans.planNext({ ...done, reflectedAt: 1 }, false), null, 'once');
  assert.equal(plans.planNext(undefined, false), null);
  assert.equal(wakesDot({ kind: 'event', event: 'continue', text: plans.CONTINUE_EVENT }), true);
  assert.match(plans.reflectEvent({ ...done, goal: 'the trip is booked' }), /^Your plan is finished \(the trip is booked\)\. .*create_skill.*notebook/);
});

it('reads a whole web page as text, in pages, and keeps reading pages and planning to research moments', async () => {
  const { webTools } = await importTs(harness('tools', 'web-tools.ts'));
  const { allowedInResearch } = await importTs(harness('runtime', 'proactive.ts'));
  const asked = [];
  const long = `${'Intro paragraph. '.repeat(900)}\n\n\n\nThe end.`;
  const env = { dotId: 'dot-web', dotName: 'Pip', timeZone: 'UTC', now: () => clock, host: null, personalData: false, web: { read: async (url) => (asked.push(url), url.includes('broken') ? { problem: 'The page could not be read (HTTP 404).' } : { text: long, title: 'A long read' }) } };
  const read = webTools(env)[0].handler;
  const first = await read.run({ url: 'https://example.com/article' });
  assert.match(first.observation, /^A long read — https:\/\/example\.com\/article:\n\n/);
  assert.match(first.observation, /\[[\d,]+ more characters: read on with "offset": 12000\.\]$/);
  const rest = await read.run({ url: 'https://example.com/article', offset: 12_000 });
  assert.match(rest.observation, /from character 12000/);
  assert.match(rest.observation, /The end\.$/, 'blank runs folded, the last page has no continuation');
  assert.equal((await read.run({ url: 'ftp://example.com/x' })).failed, true);
  assert.equal((await read.run({ url: 'not a url' })).failed, true);
  assert.match((await read.run({ url: 'https://example.com/broken' })).observation, /HTTP 404/);
  assert.equal(asked.length, 3, 'nothing is fetched for an address that is not a web page');
  assert.deepEqual(webTools({ ...env, web: undefined }), [], 'no tool where the window cannot read pages');
  assert.equal(allowedInResearch('read_web_page', new Set()), true);
  assert.equal(allowedInResearch('update_plan', new Set()), true);
  assert.equal(allowedInResearch('send_email', new Set()), false);
});

it('improves a skill saved in Willow in place, by one exact passage or whole, and leaves others alone', async () => {
  const { improveSkillTool } = await importTs(harness('tools', 'skill-tools.ts'));
  const skills = [{ id: 's1', name: 'weekly-report', description: 'Writing the weekly report', instructions: '1. Gather the numbers.\n2. Write it up.' }];
  const sparkStore = { sparkSkills: { get: () => skills } };
  const skill = skills[0];
  const improve = improveSkillTool({
    skills: () => skills,
    update: (id, patch) => {
      const index = skills.findIndex((entry) => entry.id === id);
      skills[index] = { ...skills[index], ...patch };
      return skills[index];
    },
  }).handler;
  const swapped = await improve.run({ skill: '/weekly-report', replace: '2. Write it up.', with: '2. Check last week\'s figures first.\n3. Write it up.' });
  assert.equal(swapped.failed, undefined, swapped.observation);
  assert.equal(sparkStore.sparkSkills.get().find((entry) => entry.id === skill.id).instructions, '1. Gather the numbers.\n2. Check last week\'s figures first.\n3. Write it up.');
  assert.match((await improve.run({ skill: 'weekly-report', replace: 'not in it', with: 'x' })).observation, /not in the skill/);
  assert.match((await improve.run({ skill: 'weekly-report', replace: '. ', with: 'x' })).observation, /appears more than once/);
  assert.match((await improve.run({ skill: 'someone-elses', instructions: 'x' })).observation, /No skill saved in Willow/);
  const whole = await improve.run({ skill: 'weekly-report', instructions: 'Gather, check, write.', description: 'The Friday report' });
  assert.equal(whole.failed, undefined);
  const saved = sparkStore.sparkSkills.get().find((entry) => entry.id === skill.id);
  assert.equal(saved.instructions, 'Gather, check, write.');
  assert.equal(saved.description, 'The Friday report');
});

it('shows the plan in the dot\'s context and states how plans carry on, in principles', () => {
  const text = plans.describePlan({ id: 'p1', goal: 'tests pass', steps: [{ step: 'Fix the parser', status: 'completed' }, { step: 'Run the tests', status: 'in_progress' }, { step: 'Hear from Ana', status: 'waiting' }], createdAt: 0, updatedAt: 0 });
  assert.equal(text, 'Your plan, done when tests pass (1 of 3 done):\n[x] Fix the parser\n[>] Run the tests\n[~] Hear from Ana (waiting)');
  const prompt = createDotSystemPrompt({ dotName: 'Pip', tools: [], skills: [] });
  assert.match(prompt, /# Plans\n\nFor work that takes several steps or more than one sitting, keep a plan with `update_plan`/);
  assert.match(prompt, /Willow wakes you to carry on, so the work continues in the background until it is done/);
  assert.doesNotMatch(prompt, /daily allowance|turns per day/i);
});
