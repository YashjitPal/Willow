/**
 * Saving a schedule or a skill from a conversation, as Gemini does — in a chat and in a Spark
 * task — and "Create with Gemini" on Spark's Schedules and Skills pages. Recorded against
 * Gemini on 2026-10-06 (`tools/ui-research/captures/spark/137-create-with-gemini/`), and
 * walked end to end by `tools/scratch/create-with-verify.cjs`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const load = (file) => importTs(path.join(ROOT, file));

const library = await load('platform/core/src/spark-library.ts');
const skills = await load('platform/core/src/skill-library.ts');
const shell = await load('platform/core/src/shell-request.ts');
const chatTools = await load('features/chat/src/library/library-tools.ts');
const chatMessage = await load('features/chat/src/chat-message.ts');
const sparkTools = await load('features/spark/src/harness/spark-tools.ts');
const policy = await load('features/spark/src/harness/overlay/tool-policy.ts');
const modes = await load('features/spark/src/harness/overlay/collaboration-mode.ts');
const profile = await load('features/spark/src/harness/overlay/spark-profile.ts');
const seeds = await load('features/spark/src/spark-create-with.ts');

const GARDENING = {
  title: 'Indoor gardening tip',
  frequency: 'Weekly',
  weekdays: ['Saturday'],
  time: '10:00',
  instructions: 'Give me one short gardening tip for indoor plants.',
};
const TAKEAWAYS = {
  name: 'article-key-takeaways',
  description: 'Turn any pasted article into three key takeaways and one open question.',
  instructions: '# Article Key Takeaways\n\n## Workflow\n\n1. Read the text.',
};

/** Spark's writer, as the tools see it, recording what it was asked to do. */
const fakeWriter = () => {
  const calls = [];
  let next = 0;
  return {
    calls,
    writes: () => calls.filter(([kind]) => kind !== 'hydrate'),
    hydrate: (scopeId) => { calls.push(['hydrate', scopeId]); },
    createSchedule: (scopeId, input) => {
      calls.push(['createSchedule', scopeId, input]);
      return { ...input, id: `schedule-${++next}`, enabled: true };
    },
    setScheduleEnabled: () => null,
    deleteSchedule: () => true,
    createSkill: (scopeId, input) => {
      calls.push(['createSkill', scopeId, input]);
      return { ...input, id: `skill-${++next}` };
    },
  };
};

beforeEach(() => {
  library.librarySchedules.set([]);
  skills.resetSkillHydration();
});

describe('reading what a model asked for', () => {
  it('reads a time the ways a model writes one', () => {
    assert.equal(library.normalizeScheduleTime('19:00'), '19:00');
    assert.equal(library.normalizeScheduleTime('7 PM'), '19:00');
    assert.equal(library.normalizeScheduleTime('7:30pm'), '19:30');
    assert.equal(library.normalizeScheduleTime('12 AM'), '00:00');
    assert.equal(library.normalizeScheduleTime('12pm'), '12:00');
    assert.equal(library.normalizeScheduleTime('9'), '09:00');
    assert.equal(library.normalizeScheduleTime('25:00'), null);
    assert.equal(library.normalizeScheduleTime('13 PM'), null);
    assert.equal(library.normalizeScheduleTime('soon'), null);
  });

  it('turns a create_schedule call into the schedule Spark stores', () => {
    assert.deepEqual(library.scheduleInputFrom({
      title: '  Send   weekly science fact ',
      frequency: 'Weekly',
      weekdays: ['sun'],
      time: '7 PM',
      instructions: 'Send me one fun science fact.',
    }).input, {
      title: 'Send weekly science fact',
      frequency: 'Weekly',
      weekdays: ['Sunday'],
      time: '19:00',
      instructions: 'Send me one fun science fact.',
    });
  });

  it('reads weekly with no days, or with all seven, as daily', () => {
    const base = { title: 'Digest', time: '08:00', instructions: 'Summarize the news.' };
    assert.deepEqual(library.scheduleInputFrom({ ...base, frequency: 'Weekly' }).input.frequency, 'Daily');
    const everyDay = library.scheduleInputFrom({ ...base, frequency: 'Weekly', weekdays: [...library.LIBRARY_WEEKDAYS] }).input;
    assert.deepEqual([everyDay.frequency, everyDay.weekdays], ['Daily', []]);
    const weekdays = library.scheduleInputFrom({ ...base, weekdays: ['Mon', 'tue', 'WEDNESDAY'] }).input;
    assert.deepEqual([weekdays.frequency, weekdays.weekdays], ['Weekly', ['Monday', 'Tuesday', 'Wednesday']]);
  });

  it('says what is wrong in words the model can act on, and saves nothing', () => {
    assert.match(library.scheduleInputFrom({ frequency: 'Daily', time: '8:00', instructions: 'x' }).error, /needs a "title"/);
    assert.match(library.scheduleInputFrom({ title: 'x', time: '8:00' }).error, /needs "instructions"/);
    assert.match(library.scheduleInputFrom({ title: 'x', instructions: 'y', time: 'later' }).error, /"time" of day as 24-hour HH:mm/);
    assert.match(library.scheduleInputFrom({ title: 'x', instructions: 'y', time: '8:00', weekdays: ['Funday'] }).error, /could not read the days/);
  });

  it("names a skill in kebab-case, as Gemini does, and refuses one the library already has", () => {
    assert.equal(library.normalizeSkillName('/Article Key Takeaways!'), 'article-key-takeaways');
    assert.equal(library.skillInputFrom({ ...TAKEAWAYS, name: 'Article key takeaways' }).input.name, 'article-key-takeaways');
    assert.match(library.skillInputFrom(TAKEAWAYS, ['Article Key Takeaways']).error, /already exists/);
    assert.match(library.skillInputFrom({ ...TAKEAWAYS, description: ' ' }).error, /needs a "description"/);
  });
});

describe('how a schedule reads', () => {
  it("on Spark's card: Gemini's \"When to run\"", () => {
    assert.equal(library.formatScheduleWhen({ frequency: 'Weekly', weekdays: ['Sunday'], time: '19:00' }), 'Weekly on Sun around 7:00 PM');
    assert.equal(library.formatScheduleWhen({ frequency: 'Daily', weekdays: [], time: '08:00' }), 'Daily around 8:00 AM');
    assert.equal(library.formatScheduleWhen({ frequency: 'Weekly', weekdays: ['Wednesday', 'Monday'], time: '12:30' }), 'Weekly on Mon, Wed around 12:30 PM');
  });

  it("on the chat's card: Gemini's \"Saturday by 10 AM\"", () => {
    assert.equal(library.formatScheduleDue({ frequency: 'Weekly', weekdays: ['Saturday'], time: '10:00' }), 'Saturday by 10 AM');
    assert.equal(library.formatScheduleDue({ frequency: 'Weekly', weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], time: '09:00' }), 'Weekdays by 9 AM');
    assert.equal(library.formatScheduleDue({ frequency: 'Daily', weekdays: [], time: '08:00' }), 'Daily by 8 AM');
    assert.equal(library.formatScheduleDue({ frequency: 'Weekly', weekdays: ['Wednesday', 'Monday'], time: '19:30' }), 'Mon, Wed by 7:30 PM');
  });

  it("writes each card's body as Gemini lays it out", () => {
    assert.equal(
      library.scheduleCardBody({ frequency: 'Weekly', weekdays: ['Sunday'], time: '19:00', instructions: 'Send me a fact.' }),
      '#### When to run:\n\nWeekly on Sun around 7:00 PM\n\n#### What to do:\n\nSend me a fact.',
    );
    assert.equal(library.skillCardBody({ description: 'Takeaways.', instructions: '# Steps' }), 'Takeaways.\n\n#### Instructions\n\n# Steps');
    assert.match(library.SCHEDULE_CARD_DISCLAIMER, /while Willow is open/, 'Willow runs schedules in the open app, not on a server');
  });

  it('mirrors Spark’s schedules, waking readers only on a real change', () => {
    const woke = [];
    const stop = library.librarySchedules.listen((value) => woke.push(value));
    const one = { ...GARDENING, id: 's1', enabled: true };
    library.publishSchedules([one]);
    library.publishSchedules([{ ...one, weekdays: ['Saturday'] }]);
    library.publishSchedules([{ ...one, enabled: false }]);
    stop();
    assert.equal(woke.length, 2, 'Spark publishes on every state change, run progress included');
  });
});

describe("the chat's tools", () => {
  it('are offered, and explained, only when the turn can save', () => {
    assert.deepEqual(chatTools.libraryChatTools(false), []);
    assert.equal(chatTools.libraryInstructions(false), '');
    const [{ functionDeclarations }] = chatTools.libraryChatTools(true);
    assert.deepEqual(functionDeclarations.map((declaration) => declaration.name), ['create_schedule', 'create_skill']);
    const instructions = chatTools.libraryInstructions(true);
    assert.match(instructions, /I'll have that indoor gardening tip ready for you by 10 AM every Saturday\./);
    assert.match(instructions, /Done\. The skill is saved and active\./);
    assert.match(instructions, /never on your own initiative/);
    assert.match(instructions, /There are no one-time reminders/, 'a one-off would otherwise be saved as a daily schedule');
  });

  it('save a schedule through Spark, under the chat’s scope, and put its card on the turn', async () => {
    const writer = fakeWriter();
    const published = [];
    const run = chatTools.createLibraryToolExecutor({ scopeId: 'scope-a', writer, publish: (item) => published.push(item), newId: () => 'card-1' });
    const result = await run('create_schedule', GARDENING);
    assert.equal(result.status, 'ok');
    assert.match(result.result, /Saturday by 10 AM/);
    assert.deepEqual(writer.calls[0], ['hydrate', 'scope-a'], 'an unread Spark state would publish over the saved schedules');
    assert.deepEqual(writer.writes(), [['createSchedule', 'scope-a', GARDENING]]);
    assert.equal(published.length, 1);
    const { createdAt, ...card } = published[0];
    assert.equal(typeof createdAt, 'number');
    assert.deepEqual(card, { id: 'card-1', kind: 'schedule', recordId: 'schedule-1', ...GARDENING });
  });

  it('never save a schedule twice', async () => {
    const writer = fakeWriter();
    const published = [];
    const host = { scopeId: 's', writer, publish: (item) => published.push(item) };
    const run = chatTools.createLibraryToolExecutor(host);
    const first = await run('create_schedule', GARDENING);
    const again = await run('create_schedule', { ...GARDENING });
    assert.deepEqual(again, first, 'a turn retried after its stream dropped calls again');
    assert.equal(writer.writes().length, 1);
    assert.equal(published.length, 1);

    // A turn another tab takes over starts a new executor; the schedule is in Spark already.
    library.librarySchedules.set([{ ...GARDENING, id: 'existing', enabled: true }]);
    const takeover = chatTools.createLibraryToolExecutor(host);
    assert.equal((await takeover('create_schedule', GARDENING)).status, 'ok');
    assert.equal(writer.writes().length, 1);
    assert.equal(published.at(-1).recordId, 'existing');

    // One the user switched off is not "the same": the card would say it is on.
    library.librarySchedules.set([{ ...GARDENING, id: 'existing', enabled: false }]);
    await chatTools.createLibraryToolExecutor(host)('create_schedule', GARDENING);
    assert.equal(writer.writes().length, 2);
  });

  it('save a skill once, and refuse another skill under a name the library has', async () => {
    const writer = fakeWriter();
    const published = [];
    const host = { scopeId: 's', writer, publish: (item) => published.push(item) };
    const run = chatTools.createLibraryToolExecutor(host);
    const first = await run('create_skill', TAKEAWAYS);
    assert.match(first.result, /\/article-key-takeaways/);
    assert.deepEqual(await run('create_skill', TAKEAWAYS), first);
    assert.equal(writer.writes().length, 1);

    // A retried turn rewords its skill; the name is what it already saved.
    assert.deepEqual(await run('create_skill', { ...TAKEAWAYS, instructions: 'Reworded.' }), first);

    skills.publishSkills([{ id: 'saved', ...TAKEAWAYS, enabled: true }], 'test');
    const later = chatTools.createLibraryToolExecutor(host);
    assert.equal((await later('create_skill', TAKEAWAYS)).status, 'ok', 'the same skill again is shown, not refused');
    assert.equal(published.at(-1).recordId, 'saved');
    const clash = await chatTools.createLibraryToolExecutor(host)('create_skill', { ...TAKEAWAYS, instructions: 'Something else.' });
    assert.equal(clash.status, 'error');
    assert.match(clash.error, /already exists/);
    assert.equal(writer.writes().length, 1);
  });

  it('hand a bad call back instead of saving it', async () => {
    const writer = fakeWriter();
    const run = chatTools.createLibraryToolExecutor({ scopeId: 's', writer, publish: () => assert.fail('nothing to show') });
    assert.equal((await run('create_schedule', { title: 'No time', instructions: 'x' })).status, 'error');
    assert.equal((await run('create_skill', { name: 'x' })).status, 'error');
    assert.equal((await run('delete_everything', {})).status, 'error');
    assert.equal(writer.writes().length, 0);
  });

  it('keep what a turn saved through a save and a reload', () => {
    const created = [{ id: 'card-1', kind: 'schedule', recordId: 's1', ...GARDENING, createdAt: 1 }];
    const message = { id: 'm1', role: 'assistant', content: '', created };
    assert.equal(chatMessage.hasSavedMessageContent(message), true, 'a turn whose only output is a card is still a turn');
    const saved = JSON.parse(JSON.stringify(chatMessage.serializeChatMessage(message)));
    assert.deepEqual(chatMessage.restoreSavedChatMessage(saved, undefined).created, created);
    assert.equal(chatTools.sanitizeChatCreatedItems([{ kind: 'schedule' }, null, 'x', { id: 'a', recordId: 'b', kind: 'spell' }]), undefined);
  });
});

describe('the wiring in Chat', () => {
  it('declares the tools on a turn that can keep them, and nowhere else', () => {
    const setup = read('features/chat/src/chat-turn-setup.ts');
    assert.match(setup, /const libraryEnabled = !isIncognito && toolPolicy !== 'disabled' && !!libraryWriter && !!libraryScopeId && !researchEnabled;/);
    assert.match(setup, /libraryTools: libraryChatTools\(libraryEnabled\)/);
    assert.match(setup, /libraryInstructions\(libraryEnabled\)/);
    assert.match(read('features/chat/src/ChatView.tsx'), /libraryScopeId: chatScopeIdRef\.current \|\| 'guest'/);
    assert.match(read('features/chat/src/chat-turn-takeover.ts'), /libraryScopeId: env\.scopeId\(\) \|\| 'guest'/);
  });

  it('runs a call only when its declarations went out, and keeps the card across a retry', () => {
    const runner = read('features/chat/src/chat-turn-runner.ts');
    assert.match(runner, /if \(runLibraryTool && isLibraryToolCall\(name\)\)/);
    assert.match(runner, /\.\.\.\(deps\.libraryTools \?\? \[\]\)/);
    assert.match(runner, /created: record\.created\?\.length \? record\.created : undefined/);
    const reset = runner.slice(runner.indexOf('const resetForRetry'), runner.indexOf('const waitForRetry'));
    assert.doesNotMatch(reset, /record\.created = undefined/, 'what was saved stays saved, so its card stays too');
  });

  it('shows the card as the save lands, and keeps it when the turn settles', () => {
    const view = read('features/chat/src/ChatView.tsx');
    assert.match(view, /m\.id === record\.assistantId && m\.created !== created/);
    const settle = view.match(/\? \{ \.\.\.m, content, thinkingTime, isError, isGenerating: false[^}]*\}/)?.[0] ?? '';
    assert.ok(settle && !/\bcreated\b/.test(settle), 'finalizeAssistant assigns its list unconditionally; listing `created` would need every caller to pass it');
    assert.match(view, /created: record\.created\?\.length \? record\.created : undefined,\r?\n\s*\};/, 'a chat reopened mid-turn shows what was already saved');
    assert.match(view, /<ChatCreatedCard key=\{item\.id\} item=\{item\} scopeId=\{chatScopeId \|\| 'guest'\} \/>/);
    assert.match(view, /marginTop: msg\.created\[0\]!\.kind === 'skill' \? 24 : 16/);
    assert.match(view, /paddingBottom: msg\.created\[msg\.created\.length - 1\]!\.kind === 'skill' \? 16 : 8/);
  });
});

describe("the chat's scheduled-action card", () => {
  const css = read('features/chat/src/library/ChatCreatedCards.css');
  const card = read('features/chat/src/library/ChatCreatedCards.tsx');
  const block = (selector) => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `${selector} is gone`);
    return css.slice(start, css.indexOf('}', start));
  };

  it('is Gemini’s measured card', () => {
    assert.match(block('.chat-scheduled-action'), /padding: 24px;[\s\S]*border: 1px solid #444746;[\s\S]*border-radius: 16px;[\s\S]*background: rgba\(68, 71, 70, 0\.16\);/);
    assert.match(block('.chat-scheduled-action__icon'), /width: 32px;[\s\S]*background: var\(--sync-003d64, #003d64\);[\s\S]*color: var\(--sync-60a9ed, #60a9ed\);/);
    assert.match(block('.chat-scheduled-action__when'), /font-size: 13px;\s*line-height: 17px;\s*color: #c4c7c5;/);
    assert.match(block('.chat-scheduled-action__switch'), /width: 52px;\s*height: 32px;/);
    assert.match(block('.chat-scheduled-action-menu'), /width: 208px;[\s\S]*padding: 4px 0;[\s\S]*background: #1e1f20;/);
    assert.match(block('.chat-scheduled-action-info'), /max-width: min\(420px, calc\(100vw - 16px\)\);[\s\S]*padding: 12px 16px;[\s\S]*background: var\(--sync-1f3760, #1f3760\);/);
  });

  it('draws its clock from the one face that has it', () => {
    // Google Symbols is a subset without `schedule_auto`; a missing ligature paints as its name.
    assert.match(card, /<MaterialSymbol name="schedule_auto" family="luminous"/);
  });

  it('switches, edits and deletes the Spark schedule itself', () => {
    assert.match(card, /writer\.setScheduleEnabled\(scopeId, live\.id, !live\.enabled\)/);
    assert.match(card, /requestSparkLocation\(\{ page: 'schedule-editor', scheduleId: item\.recordId \}\)/);
    assert.match(card, /title="Delete scheduled action\?"/);
    assert.match(card, /writer\?\.deleteSchedule\(scopeId, item\.recordId\)/);
    assert.match(card, /const deleted = loaded && !live;/, 'an unloaded mirror must not read as deleted');
  });

  it('places its popups by layout size, not by a mid-animation rect', () => {
    assert.equal(card.match(/const \{ offsetWidth: width, offsetHeight: height \} = (popup|menu);/g)?.length, 2);
  });
});

describe('the Spark agent', () => {
  it('may call both, and Plan mode refuses both', () => {
    for (const name of ['create_schedule', 'create_skill']) {
      assert.equal(policy.isAllowed(name), true, name);
      assert.equal(modes.isMutatingTool(name), true, name);
    }
    assert.match(policy.refusalFor('set_reminder') ?? '', /create_schedule/);
    assert.match(policy.refusalFor('save_skill') ?? '', /create_skill/);
  });

  it("saves a schedule with the step's title as its timeline row, once per run", async () => {
    const saved = [];
    const tools = sparkTools.createSparkCapabilityTools({
      skills: [],
      connectedApps: [],
      library: {
        createSchedule: (input, label) => { saved.push([input, label]); return { title: input.title, when: library.formatScheduleWhen(input) }; },
        createSkill: () => null,
      },
    });
    const tool = tools.find((candidate) => candidate.id === 'create_schedule');
    const args = { _title: 'Created weekly science fact schedule', title: 'Send weekly science fact', frequency: 'Weekly', weekdays: ['Sunday'], time: '19:00', instructions: 'Send me one fun science fact.' };
    const first = await tool.run(args, {});
    assert.match(first.observation, /Saved the schedule "Send weekly science fact": Weekly on Sun around 7:00 PM/);
    assert.deepEqual(await tool.run({ ...args }, {}), first);
    assert.equal(saved.length, 1);
    assert.equal(saved[0][1], 'Created weekly science fact schedule');
    assert.equal('_title' in saved[0][0], false);
  });

  it('registers neither without somewhere to save, and says so in the prompt only when it can', () => {
    const ids = sparkTools.createSparkCapabilityTools({ skills: [], connectedApps: [] }).map((tool) => tool.id);
    assert.equal(ids.includes('create_schedule') || ids.includes('create_skill'), false);
    const bare = profile.createSparkHarnessProfile({ skills: [], connectedApps: [] }).systemPrompt;
    assert.doesNotMatch(bare, /## Schedules and skills/);
    const able = profile.createSparkHarnessProfile({ skills: [], connectedApps: [], library: {} }).systemPrompt;
    assert.match(able, /## Schedules and skills/);
    assert.match(able, /\*\*\* Call: create_schedule/);
    assert.match(able, /I have scheduled this task for you\./);
    assert.match(able, /There are no one-time reminders/);
  });

  it('puts the card and the "Created …" row on the turn', () => {
    const detail = read('features/spark/src/SparkTaskDetail.tsx');
    assert.match(detail, /data-test-id="spark-created-schedule">\s*<ConfirmationCard title=\{schedule\.title\} body=\{scheduleCardBody\(schedule\)\} disclaimer=\{SCHEDULE_CARD_DISCLAIMER\} \/>/);
    assert.match(detail, /data-test-id="spark-created-skill"/);
    assert.match(detail, /if \(tool\.startsWith\(CREATED_TOOL_PREFIX\)\) return \{ icon: 'build', label: /);
  });
});

describe('Create with Gemini', () => {
  const workspace = read('features/spark/src/SparkWorkspace.tsx');

  it("on Schedules, opens a Spark task that already asks, as Gemini's does", () => {
    assert.match(workspace, /onCreateWithGemini=\{\(\) => createSeededTask\(SCHEDULE_SEED_PROMPT, SCHEDULE_SEED_REPLY, SCHEDULE_SEED_TITLE\)\}/);
    assert.equal(seeds.SCHEDULE_SEED_TITLE, 'Creating a schedule');
    assert.equal(seeds.SCHEDULE_SEED_PROMPT, 'Help me schedule a task.');
    assert.match(seeds.SCHEDULE_SEED_REPLY, /^Let's get started! I can run recurring tasks across your Gmail, Calendar, Drive, and the web\./);
    assert.doesNotMatch(seeds.SCHEDULE_SEED_REPLY, /react to specific updates/, 'Willow has no event triggers to offer');
    assert.match(workspace, /requestSparkTaskListCollapsed\(task\.id\);/);
    assert.match(workspace, /if \(!current \|\| current\.turns\.length > 0\) return;/, 'a follow-up sent while it streams owns the task');
  });

  it('on Skills, leaves for a new chat holding Gemini’s question', () => {
    assert.match(workspace, /onCreateWithGemini=\{\(\) => requestSeededChat\(\{ prompt: SKILL_SEED_PROMPT, reply: SKILL_SEED_REPLY \}\)\}/);
    assert.equal(seeds.SKILL_SEED_PROMPT, 'Create a skill');
    assert.equal(seeds.SKILL_SEED_REPLY, "What do you want the skill to do? Give me a brief idea of the workflow or task, and I'll build it.");
  });

  it('asks the shell once per request, and hands the seed to one chat', () => {
    shell.requestSeededChat({ prompt: 'Create a skill', reply: 'What?' });
    const request = shell.pendingShellRequest.get();
    assert.equal(request.surface, 'chat');
    shell.clearShellRequest(request.id + 1);
    assert.equal(shell.pendingShellRequest.get(), request, 'a newer request is not cleared by an older id');
    shell.clearShellRequest(request.id);
    assert.equal(shell.pendingShellRequest.get(), null);
    shell.pendingChatSeed.set({ prompt: 'p', reply: 'r' });
    assert.deepEqual(shell.takeChatSeed(), { prompt: 'p', reply: 'r' });
    assert.equal(shell.takeChatSeed(), null);
  });

  it('is carried out by the shell, and played by the new chat without a model', () => {
    assert.match(read('apps/studio/src/app/App.tsx'), /<ShellRequestHandler\s+onStudioExperienceChange=\{handleStudioExperienceChange\}/);
    const handler = read('apps/studio/src/app/ShellRequestHandler.tsx');
    const seedAt = handler.indexOf('pendingChatSeed.set(request.seed)');
    assert.ok(seedAt > 0 && seedAt < handler.indexOf('shell.onNewChat()'), 'the seed has to be waiting before the chat remounts');
    assert.match(handler, /navigateSpark\(request\.sparkLocation as SparkLocation\)/);
    const view = read('features/chat/src/ChatView.tsx');
    assert.match(view, /const seed = takeChatSeed\(\);/);
    assert.match(view, /\{ id: assistantId, role: 'assistant', content: '', isGenerating: true, isNew: true \}/);
    assert.match(view, /pendingSeedReplyRef\.current = \{ assistantId, reply: seed\.reply \};/, 'StrictMode’s second run must re-arm the reply');
    assert.match(view, /animate=\{generating \|\| playsSeed \|\| /);
  });
});
