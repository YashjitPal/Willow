import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', 'dots', 'harness', ...parts);

const store = await importTs(harness('thread', 'thread-store.ts'));
const { memoryPersistence } = await importTs(harness('thread', 'thread-persistence.ts'));
const spec = await importTs(harness('triggers', 'trigger-spec.ts'));
const triggers = await importTs(harness('triggers', 'trigger-store.ts'));
const watch = await importTs(harness('triggers', 'trigger-watch.ts'));
const engine = await importTs(harness('triggers', 'trigger-engine.ts'));
const { triggerTool } = await importTs(harness('tools', 'trigger-tools.ts'));
const { buildDotContext } = await importTs(harness('memory', 'context-builder.ts'));
const { budgetsForWindow } = await importTs(harness('memory', 'budgets.ts'));
const { createDotSystemPrompt } = await importTs(harness('overlay', 'dot-profile.ts'));
const { renderOutput } = await importTs(harness('memory', 'render.ts'));
const proactive = await importTs(harness('runtime', 'proactive.ts'));

store.setDotThreadPersistence(memoryPersistence());

let counter = 0;
const newDot = async () => {
  counter += 1;
  const dotId = `dot-trigger-${counter}`;
  await store.loadDotThread(dotId);
  return dotId;
};
const runtime = (dotId) => store.getDotThread(dotId).runtime;
const items = (dotId, kind) => store.getDotThread(dotId).items.filter((item) => !kind || item.kind === kind);

const TZ = 'Europe/Lisbon';
// Tue 6 Oct 2026, 10:00 in Lisbon (UTC+1).
const NOW = Date.UTC(2026, 9, 6, 9, 0);
const local = (iso) => {
  const [date, time] = iso.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh - 1, mm);
};

const draft = (when, extra = {}) => ({ name: 'Test', when, instruction: 'Do the thing.', notify: 'important', timeZone: TZ, ...extra });

/* ------------------------------------------------------------------------ */
/* Conditions                                                               */
/* ------------------------------------------------------------------------ */

it('reads every kind of condition, in the spellings models reach for', () => {
  const read = (when) => spec.parseWhen(when, NOW, TZ);
  assert.deepEqual(read({ type: 'schedule', every: 'weekdays', at: '08:30' }), { when: { type: 'schedule', every: 'weekday', at: '08:30' } });
  assert.deepEqual(read({ every: '15 minutes' }), { when: { type: 'schedule', every: 'minutes', interval: 15 } });
  assert.deepEqual(read({ type: 'schedule', every: 'weekly', days: ['Mon', 'thursday'], at: '09:00' }), { when: { type: 'schedule', every: 'week', at: '09:00', days: [1, 4] } });
  assert.deepEqual(read({ type: 'schedule', every: 'monthly', day_of_month: 31, at: '07:00' }), { when: { type: 'schedule', every: 'month', at: '07:00', dayOfMonth: 31 } });
  assert.deepEqual(read({ type: 'once', at: '2026-10-08 09:00' }), { when: { type: 'once', at: local('2026-10-08 09:00') } });
  assert.deepEqual(read({ type: 'reminder', in_minutes: 90 }), { when: { type: 'once', at: NOW + 90 * 60_000 } });
  assert.deepEqual(read({ type: 'gmail', query: 'from:alex subject:invoice' }), { when: { type: 'email', query: 'from:alex subject:invoice' } });
  assert.deepEqual(read({ type: 'calendar', minutes_before: 15, match: 'interview' }), { when: { type: 'calendar', minutesBefore: 15, match: 'interview' } });
  assert.deepEqual(read({ type: 'issues', repo: 'acme/site' }), { when: { type: 'github', watch: 'issues', repo: 'acme/site' } });
  assert.deepEqual(read({ type: 'spark_task', status: 'done' }), { when: { type: 'spark_task', status: 'complete' } });
  assert.deepEqual(read({ type: 'website', url: 'https://example.org/tickets', contains: 'On sale' }), { when: { type: 'web_page', url: 'https://example.org/tickets', everyMinutes: 60, contains: 'On sale' } });
  assert.deepEqual(read({ type: 'folder', path: '/reports' }), { when: { type: 'folder', path: 'reports' } });
  assert.deepEqual(read({ type: 'back', away_hours: 12 }), { when: { type: 'user_returns', awayHours: 12 } });
});

it('answers a condition it cannot honour with what to send instead', () => {
  const error = (when) => spec.parseWhen(when, NOW, TZ).error;
  assert.match(error({ type: 'schedule', every: 'minutes', interval: 1 }), /at most every 5 minutes/);
  assert.match(error({ type: 'schedule', every: 'day' }), /"at"/);
  assert.match(error({ type: 'once', at: '2026-10-05 09:00' }), /passed/);
  assert.match(error({ type: 'web_page', url: 'https://example.org', every_minutes: 5 }), /at most every 15 minutes/);
  assert.match(error({ type: 'web_page', url: 'file:///etc/passwd' }), /http or https/);
  assert.match(error({ type: 'folder', path: '../secrets' }), /inside the connected folder/);
  assert.match(error({ type: 'github', repo: 'not a repo' }), /owner\/name/);
  assert.match(error({ type: 'telepathy' }), /"type" must be one of/);
});

it('plans schedules on the user\'s wall clock', () => {
  const next = (when, after = NOW) => spec.nextScheduleAt(when, after, TZ);
  assert.equal(next({ type: 'schedule', every: 'day', at: '08:30' }), local('2026-10-07 08:30'), 'today\'s 08:30 has passed');
  assert.equal(next({ type: 'schedule', every: 'day', at: '18:00' }), local('2026-10-06 18:00'));
  // Fri 9 Oct after 09:00 → Mon 12 Oct.
  assert.equal(next({ type: 'schedule', every: 'weekday', at: '09:00' }, local('2026-10-09 09:30')), local('2026-10-12 09:00'));
  assert.equal(next({ type: 'schedule', every: 'week', days: [4], at: '09:00' }), local('2026-10-08 09:00'));
  assert.equal(next({ type: 'schedule', every: 'month', dayOfMonth: 31, at: '07:00' }), Date.UTC(2026, 9, 31, 7, 0), 'Lisbon leaves summer time on 25 October, so 07:00 on the 31st is 07:00 UTC');
  assert.equal(next({ type: 'schedule', every: 'month', dayOfMonth: 31, at: '07:00' }, local('2026-10-31 08:00')), Date.UTC(2026, 10, 30, 7, 0), 'November has no 31st, so its last day (and Lisbon is back on UTC)');
  assert.equal(next({ type: 'schedule', every: 'minutes', interval: 30 }), NOW + 30 * 60_000);
  assert.equal(next({ type: 'schedule', every: 'hours', interval: 1, minute: 15 }), local('2026-10-06 10:15'));
  assert.equal(spec.describeWhen({ type: 'schedule', every: 'week', days: [1, 4], at: '09:00' }, TZ), 'Every Mon and Thu at 09:00');
  assert.equal(spec.describeWhen({ type: 'github', watch: 'pull_requests' }, TZ, 'user'), 'When a GitHub pull request involving you is opened or updated');
  assert.equal(spec.describeWhen({ type: 'user_returns', awayHours: 8 }, TZ), 'When the user comes back to Willow after 8 hours away');
});

it('keeps a yearly day, a birthday or an anniversary, however the day is written', () => {
  const read = (when) => spec.parseWhen(when, NOW, TZ);
  const birthday = { when: { type: 'schedule', every: 'year', at: '09:00', month: 10, dayOfMonth: 19 } };
  assert.deepEqual(read({ type: 'schedule', every: 'yearly', date: '10-19', at: '09:00' }), birthday);
  assert.deepEqual(read({ type: 'schedule', every: 'year', date: '19 Oct', at: '09:00' }), birthday);
  assert.deepEqual(read({ type: 'schedule', every: 'annually', date: 'October 19th', at: '09:00' }), birthday);
  assert.deepEqual(read({ type: 'schedule', every: 'year', month: 'October', day_of_month: 19, at: '09:00' }), birthday);
  assert.match(read({ type: 'schedule', every: 'year', at: '09:00' }).error, /"date" like 10-19/);
  assert.match(read({ type: 'schedule', every: 'year', date: '02-30', at: '09:00' }).error, /Feb has no day 30/);
  assert.match(read({ type: 'schedule', every: 'year', date: '10-19' }).error, /"at"/);

  const next = (when, after = NOW) => spec.nextScheduleAt(when, after, TZ);
  assert.equal(next(birthday.when), local('2026-10-19 09:00'), 'still to come this year');
  assert.equal(next(birthday.when, local('2026-10-19 09:30')), Date.UTC(2027, 9, 19, 8, 0), 'next year once this one has passed');
  const leap = { type: 'schedule', every: 'year', at: '08:00', month: 2, dayOfMonth: 29 };
  assert.equal(next(leap), Date.UTC(2027, 1, 28, 8, 0), 'a 29 February falls on the 28th in other years');
  assert.equal(next(leap, Date.UTC(2027, 2, 1)), Date.UTC(2028, 1, 29, 8, 0), 'and on the day itself in a leap year');
  assert.equal(spec.describeWhen(birthday.when, TZ, 'user'), 'Every year on 19 Oct at 09:00');
});

/* ------------------------------------------------------------------------ */
/* Keeping triggers                                                          */
/* ------------------------------------------------------------------------ */

it('keeps triggers: creates, changes, pauses, resumes and ends them', async () => {
  const dotId = await newDot();
  const { trigger } = triggers.createTrigger(dotId, draft({ type: 'schedule', every: 'day', at: '08:30' }, { maxRuns: 2 }), NOW);
  assert.equal(trigger.id, 't1');
  assert.equal(trigger.nextAt, local('2026-10-07 08:30'));

  const changed = triggers.updateTrigger(dotId, 't1', { when: { type: 'schedule', every: 'day', at: '18:00' } }, NOW).trigger;
  assert.equal(changed.nextAt, local('2026-10-06 18:00'), 'a new condition is planned afresh');

  triggers.setTriggerPaused(dotId, 't1', true, NOW);
  assert.equal(triggers.findTrigger(dotId, 't1').status, 'paused');
  triggers.setTriggerPaused(dotId, 't1', false, local('2026-10-06 19:00'));
  assert.equal(triggers.findTrigger(dotId, 't1').nextAt, local('2026-10-07 18:00'), 'resuming plans from now, skipping what passed');

  triggers.recordRun(dotId, 't1', local('2026-10-07 18:00'));
  const last = triggers.recordRun(dotId, 't1', local('2026-10-08 18:00'));
  assert.equal(last.status, 'ended');
  assert.match(last.endedBecause, /ran 2 times/);

  const watcher = triggers.createTrigger(dotId, draft({ type: 'email', query: 'from:alex' }), NOW).trigger;
  triggers.patchTrigger(dotId, watcher.id, { primed: true, seen: ['m1'] });
  triggers.setTriggerPaused(dotId, watcher.id, true, NOW);
  triggers.setTriggerPaused(dotId, watcher.id, false, NOW);
  assert.equal(triggers.findTrigger(dotId, watcher.id).primed, false, 'a resumed watcher looks again before it fires, so a pause is never followed by a flood');
  assert.equal(triggers.deleteTrigger(dotId, watcher.id), true);
  assert.equal(triggers.findTrigger(dotId, watcher.id), undefined);
});

it('turns routines from before triggers into schedule triggers', async () => {
  const dotId = await newDot();
  store.updateDotRuntime(dotId, (state) => ({
    ...state,
    routines: [
      { id: 'r1', every: 'weekday', at: '08:00', instruction: 'Brief me on the day ahead', nextAt: local('2026-10-07 08:00'), createdAt: NOW - 1_000 },
      { id: 'r2', every: 'hour', minute: 30, instruction: 'Check the build', nextAt: local('2026-10-06 10:30'), until: local('2026-10-10 23:59'), createdAt: NOW - 1_000 },
    ],
  }));
  triggers.migrateRoutines(dotId, TZ, NOW);
  assert.deepEqual(runtime(dotId).routines, []);
  const [brief, build] = runtime(dotId).triggers;
  assert.deepEqual(brief.when, { type: 'schedule', every: 'weekday', at: '08:00' });
  assert.equal(brief.nextAt, local('2026-10-07 08:00'));
  assert.deepEqual(build.when, { type: 'schedule', every: 'hours', interval: 1, minute: 30 });
  assert.equal(build.until, local('2026-10-10 23:59'));
});

/* ------------------------------------------------------------------------ */
/* Looking                                                                   */
/* ------------------------------------------------------------------------ */

const sources = (overrides = {}) => ({
  mail: async () => ({ ids: [], fresh: [], more: 0, contents: false }),
  calendar: async () => ({ items: [] }),
  github: async () => ({ items: [] }),
  page: async () => ({ text: '' }),
  folder: async () => ({ entries: [], truncated: false }),
  ...overrides,
});

it('fires an email trigger only for mail that arrived after it was made', async () => {
  const dotId = await newDot();
  const { trigger } = triggers.createTrigger(dotId, draft({ type: 'email', query: 'from:alex subject:invoice' }), NOW);
  let ids = ['old-1', 'old-2'];
  const headersAsked = [];
  const fake = sources({
    mail: async (_search, known) => {
      const fresh = ids.filter((id) => !known(id)).map((id) => {
        headersAsked.push(id);
        return { id, from: 'Alex Kim', domain: 'acme.com', subject: `Invoice ${id}`, date: 'Tue, 6 Oct 2026 11:02', unread: true };
      });
      return { ids, fresh, more: 0, contents: false };
    },
  });
  const first = await watch.look(trigger, fake, { now: NOW });
  assert.equal(first.fired, undefined, 'the first look only learns what is there');
  assert.deepEqual(headersAsked, [], 'and reads no headers to do it');
  triggers.patchTrigger(dotId, trigger.id, first.patch);

  ids = ['new-1', 'old-1', 'old-2'];
  const second = await watch.look(triggers.findTrigger(dotId, trigger.id), fake, { now: NOW + 180_000 });
  assert.match(second.fired, /A new email matches “from:alex subject:invoice”:\n- Alex Kim \(acme\.com\): “Invoice new-1”/);
  assert.match(second.fired, /senders and subjects only/);
  assert.deepEqual(headersAsked, ['new-1']);
  assert.equal(second.patch.nextAt, NOW + 180_000 + 3 * 60_000);

  const failing = await watch.look(triggers.findTrigger(dotId, trigger.id), sources({ mail: async () => ({ problem: 'Gmail is not connected.' }) }), { now: NOW });
  assert.equal(failing.patch.problem, 'Gmail is not connected.');
  assert.ok(failing.patch.nextAt >= NOW + 15 * 60_000, 'a failed look backs off');
});

it('reminds before calendar events once each, and plans its next look for the reminder', async () => {
  const dotId = await newDot();
  const { trigger } = triggers.createTrigger(dotId, draft({ type: 'calendar', minutesBefore: 15, match: 'review' }), NOW);
  const events = [
    { title: 'Design review', start: new Date(NOW + 10 * 60_000).toISOString(), allDay: false, location: 'Room 4', attendees: ['Ana'] },
    { title: 'Budget review', start: new Date(NOW + 2 * 3_600_000).toISOString(), allDay: false, attendees: [] },
    { title: 'Lunch', start: new Date(NOW + 5 * 60_000).toISOString(), allDay: false, attendees: [] },
  ];
  const fake = sources({ calendar: async () => ({ items: events }) });
  const result = await watch.look(trigger, fake, { now: NOW });
  assert.match(result.fired, /“Design review” starts at 10:10 \(in 10 minutes\), at Room 4, with Ana\./);
  assert.doesNotMatch(result.fired, /Lunch|Budget/);
  assert.equal(result.patch.nextAt, NOW + 10 * 60_000, 'the next look is the usual interval, sooner than Budget review\'s reminder');
  triggers.patchTrigger(dotId, trigger.id, result.patch);
  const again = await watch.look(triggers.findTrigger(dotId, trigger.id), fake, { now: NOW + 60_000 });
  assert.equal(again.fired, undefined, 'each event is reminded once');
});

it('watches a page for new lines, or for text to appear', async () => {
  const dotId = await newDot();
  const changes = triggers.createTrigger(dotId, draft({ type: 'web_page', url: 'https://example.org/news', everyMinutes: 60 }), NOW).trigger;
  let text = 'Welcome to the example news page\nOld story about the harbour opening\n12:00';
  const fake = sources({ page: async () => ({ text, title: 'News' }) });
  const primed = await watch.look(changes, fake, { now: NOW });
  assert.equal(primed.fired, undefined);
  triggers.patchTrigger(dotId, changes.id, primed.patch);
  text = 'Welcome to the example news page\nOld story about the harbour opening\n12:05';
  assert.equal((await watch.look(triggers.findTrigger(dotId, changes.id), fake, { now: NOW })).fired, undefined, 'a changed clock is not news');
  text += '\nNew story: the bridge reopens on Friday after repairs';
  const changed = await watch.look(triggers.findTrigger(dotId, changes.id), fake, { now: NOW });
  assert.match(changed.fired, /https:\/\/example\.org\/news \(“News”\) has changed since it was last checked\. New on the page:\n- New story: the bridge reopens/);

  const tickets = triggers.createTrigger(dotId, draft({ type: 'web_page', url: 'https://example.org/tickets', contains: 'on sale', everyMinutes: 60 }), NOW).trigger;
  text = 'Tickets for the summer festival are coming soon';
  triggers.patchTrigger(dotId, tickets.id, (await watch.look(tickets, fake, { now: NOW })).patch);
  text = 'Tickets for the summer festival are ON SALE now from 40 euros';
  const sale = await watch.look(triggers.findTrigger(dotId, tickets.id), fake, { now: NOW });
  assert.match(sale.fired, /now shows “on sale”:\n…Tickets for the summer festival are ON SALE now/);
  triggers.patchTrigger(dotId, tickets.id, sale.patch);
  assert.equal((await watch.look(triggers.findTrigger(dotId, tickets.id), fake, { now: NOW })).fired, undefined, 'it fires when the text appears, not on every look after');
});

it('reports what changed in a watched folder', async () => {
  const dotId = await newDot();
  const { trigger } = triggers.createTrigger(dotId, draft({ type: 'folder', path: 'reports' }), NOW);
  let entries = [
    { path: 'reports/q1.csv', type: 'file', size: 10, modifiedAt: 1 },
    { path: 'reports/q2.csv', type: 'file', size: 20, modifiedAt: 2 },
    { path: 'reports/old', type: 'dir' },
  ];
  const fake = sources({ folder: async () => ({ entries, truncated: false }) });
  assert.match((await watch.look(trigger, fake, { now: NOW })).patch.problem, /no longer connected/, 'without a connected folder it says so');
  triggers.patchTrigger(dotId, trigger.id, (await watch.look(trigger, fake, { now: NOW, root: '/home/me/work' })).patch);
  entries = [
    { path: 'reports/q2.csv', type: 'file', size: 25, modifiedAt: 3 },
    { path: 'reports/q3.csv', type: 'file', size: 5, modifiedAt: 4 },
  ];
  const result = await watch.look(triggers.findTrigger(dotId, trigger.id), fake, { now: NOW, root: '/home/me/work' });
  assert.equal(result.fired, 'Files changed in reports in the connected folder (/home/me/work) — added: reports/q3.csv; changed: reports/q2.csv; removed: reports/q1.csv.');
});

it('hears Spark tasks and the user coming back', async () => {
  const dotId = await newDot();
  const tasks = [{ id: 'task-1', title: 'Weekly report', status: 'complete' }, { id: 'task-2', title: 'Fix the tests', status: 'running' }];
  const { trigger } = triggers.createTrigger(dotId, draft({ type: 'spark_task', status: 'complete' }, { seen: watch.sparkTaskKeys(tasks) }), NOW);
  const options = { excluded: new Set(['task-3']), latestResponse: (id) => (id === 'task-2' ? 'All 212 tests pass now.' : '') };
  assert.equal(watch.lookAtSparkTasks(trigger, tasks, options).fired, undefined, 'tasks already finished when it was made do not fire it');
  const later = [tasks[0], { ...tasks[1], status: 'complete' }, { id: 'task-3', title: 'The dot\'s own', status: 'complete' }];
  const result = watch.lookAtSparkTasks(trigger, later, options);
  assert.match(result.fired, /“Fix the tests” \(task-2\) has finished\.\n {2}Latest response \(start\): All 212 tests pass now\./);
  assert.doesNotMatch(result.fired, /dot's own/, 'tasks the bot assigned itself are reported to it already');

  const back = triggers.createTrigger(dotId, draft({ type: 'user_returns', awayHours: 8 }), NOW).trigger;
  assert.equal(watch.lookAtReturn(back, 3 * 3_600_000, NOW).fired, undefined);
  assert.match(watch.lookAtReturn(back, 9 * 3_600_000, NOW).fired, /back in Willow after being away 9 hours/);
});

/* ------------------------------------------------------------------------ */
/* Firing                                                                    */
/* ------------------------------------------------------------------------ */

it('fires due time triggers with what they are for, and says when one ran late or for the last time', async () => {
  const dotId = await newDot();
  triggers.createTrigger(dotId, draft({ type: 'schedule', every: 'day', at: '08:30' }, { name: 'Morning brief', instruction: 'Brief the user on today.' }), NOW);
  triggers.createTrigger(dotId, draft({ type: 'once', at: local('2026-10-06 11:00') }, { name: 'Call the bank', notify: 'always' }), NOW);
  const fired = [];
  const fire = (id, trigger, text) => fired.push({ id, trigger: trigger.id, text });
  assert.equal(engine.fireTimeTriggers(dotId, NOW, fire), false);
  assert.equal(engine.nextTimeTriggerAt(runtime(dotId)), local('2026-10-06 11:00'));

  assert.equal(engine.fireTimeTriggers(dotId, local('2026-10-07 09:30'), fire), true);
  assert.equal(fired.length, 2);
  const brief = fired.find((entry) => entry.trigger === 't1').text;
  assert.match(brief, /^Trigger t1 “Morning brief” fired\. It is due: Every day at 08:30\. It was due .+, 1 hour ago, while Willow was closed or you were paused\.\nWhat you set it up to do: Brief the user on today\.\nHow the user wants to hear about it: tell the user only when a run finds something that matters\.$/);
  const call = fired.find((entry) => entry.trigger === 't2').text;
  assert.match(call, /tell the user about every run\.\nThat was its last run: it ran once, as planned\.$/);
  assert.equal(triggers.findTrigger(dotId, 't1').nextAt, local('2026-10-08 08:30'), 'missed runs are not replayed, one late run is enough');
});

it('looks at due watchers, and drops a look whose trigger changed while it ran', async () => {
  const dotId = await newDot();
  const { trigger } = triggers.createTrigger(dotId, draft({ type: 'github', watch: 'pull_requests', repo: 'acme/site' }), NOW);
  let items = [{ number: 7, title: 'Old PR', url: 'https://github.com/acme/site/pull/7', repo: 'acme/site', author: 'ana', updated: '2026-10-05T10:00:00Z', draft: false }];
  let now = NOW;
  const fired = [];
  const deps = {
    now: () => now,
    sources: sources({ github: async () => ({ items }) }),
    dotIds: () => [dotId],
    fire: (id, fired_, text) => fired.push(text),
    folderRoot: () => undefined,
  };
  await engine.lookAtDueTriggers(dotId, deps);
  assert.equal(fired.length, 0);
  assert.equal(triggers.findTrigger(dotId, trigger.id).primed, true);

  now += 6 * 60_000;
  items = [{ ...items[0], updated: '2026-10-06T09:03:00Z' }, { number: 9, title: 'Elsewhere', url: '', repo: 'acme/other', author: 'bo', updated: '2026-10-06T09:04:00Z', draft: false }];
  await engine.lookAtDueTriggers(dotId, deps);
  assert.equal(fired.length, 1);
  assert.match(fired[0], /1 GitHub pull request opened or updated:\n- acme\/site#7 “Old PR” by ana, updated 2026-10-06 09:03/);
  assert.doesNotMatch(fired[0], /Elsewhere/);
  assert.equal(triggers.findTrigger(dotId, trigger.id).runs, 1);

  now += 6 * 60_000;
  items = [{ ...items[0], updated: '2026-10-06T09:20:00Z' }];
  deps.sources = sources({
    github: async () => {
      triggers.updateTrigger(dotId, trigger.id, { name: 'Renamed' }, now);
      return { items };
    },
  });
  await engine.lookAtDueTriggers(dotId, deps);
  assert.equal(fired.length, 1, 'what a look saw no longer applies once the trigger has changed');
});

/* ------------------------------------------------------------------------ */
/* The tool, the context and the prompt                                     */
/* ------------------------------------------------------------------------ */

const toolEnv = (dotId, unavailable = {}) => ({
  dotId,
  dotName: 'Ada',
  timeZone: TZ,
  now: () => NOW,
  host: null,
  personalData: true,
  triggers: { unavailable, sparkTasks: () => [{ id: 'task-1', title: 'Report', status: 'complete' }] },
});

it('lets the bot make, change and list triggers, with a card for the user', async () => {
  const dotId = await newDot();
  const tool = triggerTool(toolEnv(dotId, { email: 'Gmail is not connected (Settings → Connected Apps)' }));
  assert.match(tool.doc.description, /Not available here: email \(Gmail is not connected/);

  const refused = await tool.handler.run({ action: 'create', when: { type: 'email', query: 'from:alex' }, instruction: 'Tell me.' }, { turnId: 't' });
  assert.equal(refused.failed, true);
  assert.match(refused.observation, /not available here: Gmail is not connected/);

  const created = await tool.handler.run({ action: 'create', name: 'Morning brief', when: { type: 'schedule', every: 'weekday', at: '08:30' }, instruction: 'Brief the user on the day ahead.', until: '2026-12-31' }, { turnId: 'turn-1' });
  assert.equal(created.failed, undefined);
  assert.match(created.observation, /^Created t1 “Morning brief”: Weekdays at 08:30 \(Europe\/Lisbon\); next Wed 7 Oct 08:30; until Thu 31 Dec 23:59; tell the user only when a run finds something that matters\. Does: Brief the user on the day ahead\./);
  const [card] = items(dotId, 'trigger-card');
  assert.equal(card.ref, 't1');
  assert.equal(card.turnId, 'turn-1');
  assert.equal(renderOutput(card), '', 'the card never enters the transcript; the call and its result tell the story');

  const tasks = await tool.handler.run({ action: 'create', when: { type: 'spark_task', status: 'complete' }, instruction: 'Review what it made.' }, { turnId: 't' });
  assert.match(tasks.observation, /Created t2 “When a Spark task finishes”/, 'an unnamed trigger is named for its condition');
  assert.deepEqual(triggers.findTrigger(dotId, 't2').seen, ['task-1:complete'], 'it starts out knowing the tasks there are');

  const updated = await tool.handler.run({ action: 'update', id: 't1', notify: 'never', when: { type: 'schedule', every: 'day', at: '07:45' } }, { turnId: 't' });
  assert.match(updated.observation, /Updated t1 “Morning brief”: Every day at 07:45 .*do not message the user about runs unless something is urgent/);
  assert.equal(items(dotId, 'trigger-card').length, 3);

  assert.match((await tool.handler.run({ action: 'pause', id: 't1' }, { turnId: 't' })).observation, /^Paused t1/);
  const listed = (await tool.handler.run({ action: 'list' }, { turnId: 't' })).observation.split('\n');
  assert.equal(listed.length, 2);
  assert.match(listed[0], /^t1 “Morning brief”: .*; paused;/);
  assert.equal((await tool.handler.run({ action: 'run_now', id: 't1' }, { turnId: 't' })).failed, true, 'running ahead of the condition is the user\'s call');
  assert.match((await tool.handler.run({ action: 'delete', id: 't2' }, { turnId: 't' })).observation, /^Deleted t2/);
});

it('shows the bot its triggers every time it acts, and teaches triggers as principles', async () => {
  const dotId = await newDot();
  triggers.createTrigger(dotId, draft({ type: 'web_page', url: 'https://example.org', everyMinutes: 120 }, { name: 'Watch the site', instruction: 'x'.repeat(400) }), NOW);
  const context = buildDotContext({
    thread: store.getDotThread(dotId),
    systemPrompt: 'SYSTEM',
    about: '',
    budgets: budgetsForWindow(128_000),
    now: NOW,
    timeZone: TZ,
    seenSeq: 0,
    delegations: [],
  });
  const now = context.messages.at(-1).content;
  assert.match(now, /Your triggers:\n- t1 “Watch the site”: When https:\/\/example\.org changes, checked every 2 hours \(Europe\/Lisbon\); watching;/);
  assert.match(now, /x{100,}…/);
  assert.doesNotMatch(now, /x{200}/, 'instructions are cut short in the block that changes every request');

  const prompt = createDotSystemPrompt({ dotName: 'Ada', tools: [], skills: [] });
  assert.match(prompt, /# Triggers\n\nA trigger is a standing instruction with a condition: when this happens, do that\./);
  assert.doesNotMatch(prompt, /`routine`/);
  assert.doesNotMatch(prompt.slice(0, prompt.indexOf('# Protocol')), /for example|for instance|e\.g\.|such as/i);
});

/* ------------------------------------------------------------------------ */
/* Pacing, quiet hours and research                                          */
/* ------------------------------------------------------------------------ */

it('keeps quiet hours across midnight, and counts what the bot said without an answer', async () => {
  const quiet = { from: '22:00', to: '08:00' };
  assert.equal(proactive.inQuietHours(quiet, local('2026-10-06 23:30'), TZ), true);
  assert.equal(proactive.inQuietHours(quiet, local('2026-10-07 07:59'), TZ), true);
  assert.equal(proactive.inQuietHours(quiet, local('2026-10-07 08:00'), TZ), false);
  assert.equal(proactive.inQuietHours({ from: '13:00', to: '14:00' }, local('2026-10-06 13:30'), TZ), true);
  assert.equal(proactive.inQuietHours({ ...quiet, off: true }, local('2026-10-06 23:30'), TZ), false);

  const dotId = await newDot();
  store.appendDotItem(dotId, { kind: 'user', text: 'Keep an eye on it', at: NOW - 3_600_000 });
  assert.equal(proactive.pacingLine(store.getDotThread(dotId), NOW), null);
  store.appendDotItem(dotId, { kind: 'dot', text: 'Will do.', at: NOW - 3_500_000 });
  store.appendDotItem(dotId, { kind: 'dot', text: 'Prices moved.', at: NOW - 20 * 60_000 });
  assert.equal(proactive.pacingLine(store.getDotThread(dotId), NOW), 'You have sent 2 messages since the user last wrote or reacted (the latest 20 minutes ago).');
  store.appendDotItem(dotId, { kind: 'user-reaction', target: 'i3', emoji: '👍', text: 'Prices moved.', at: NOW - 60_000 });
  assert.equal(proactive.pacingLine(store.getDotThread(dotId), NOW), null, 'a reaction is an answer');

  const context = buildDotContext({ thread: store.getDotThread(dotId), systemPrompt: 'S', about: '', budgets: budgetsForWindow(128_000), now: local('2026-10-06 23:30'), timeZone: TZ, seenSeq: 99, delegations: [] });
  assert.match(context.messages.at(-1).content, /It is the user's quiet hours \(22:00–08:00\): hold anything that can wait until 08:00\./);
});

it('takes a research moment only when it is quiet, due, and there is something to look at', async () => {
  const dotId = await newDot();
  store.appendDotItem(dotId, { kind: 'user', text: 'Thanks!', at: local('2026-10-06 08:00') });
  store.updateDotRuntime(dotId, (state) => ({ ...state, introduced: true, lastActedSeq: 1 }));
  const thread = () => store.getDotThread(dotId);
  const at = local('2026-10-06 11:30');
  assert.equal(proactive.researchSlot(dotId, at, TZ), '2026-10-06 11:00', 'a moment belongs to its hour');
  assert.equal(proactive.researchDue(thread(), at, TZ, { hasApps: false }), null, 'nothing to look at: no apps, no notes');
  const slot = proactive.researchDue(thread(), at, TZ, { hasApps: true });
  assert.equal(slot, '2026-10-06 11:00');

  store.updateDotRuntime(dotId, (state) => ({ ...state, research: { lastAt: at, lastSlot: slot } }));
  assert.equal(proactive.researchDue(thread(), at + 60_000, TZ, { hasApps: true }), null, 'a slot is used once');
  assert.equal(proactive.researchDue(thread(), at + 2 * 3_600_000, TZ, { hasApps: true }), null, 'not again within two and a half hours');
  assert.equal(proactive.researchDue(thread(), at + 3 * 3_600_000, TZ, { hasApps: true }), '2026-10-06 14:00', 'and again after, all through the user\'s day');
  assert.equal(proactive.researchDue(thread(), local('2026-10-06 23:30'), TZ, { hasApps: true }), null, 'never in quiet hours');
  store.updateDotRuntime(dotId, (state) => ({ ...state, research: { off: true } }));
  assert.equal(proactive.researchDue(thread(), at, TZ, { hasApps: true }), null, 'the user can turn it off');
  store.updateDotRuntime(dotId, (state) => ({ ...state, research: undefined }));
  store.appendDotItem(dotId, { kind: 'user', text: 'One more thing', at: at - 5 * 60_000 });
  assert.equal(proactive.researchDue(thread(), at, TZ, { hasApps: true }), null, 'not while the user is around or something waits');

  const research = store.appendDotItem(dotId, { kind: 'event', event: 'research', text: proactive.RESEARCH_EVENT });
  store.updateDotRuntime(dotId, (state) => ({ ...state, lastActedSeq: research.seq - 1 }));
  assert.equal(proactive.isResearchTurn(thread()), true);
  const reads = new Set(['list_recent_emails', 'list_calendar_events']);
  assert.equal(proactive.allowedInResearch('app:list_recent_emails', reads), true);
  assert.equal(proactive.allowedInResearch('app:create_calendar_event', reads), false, 'nothing that changes an app');
  for (const tool of ['user_run_command', 'computer_navigate', 'assign_spark_task', 'start_helper', 'trigger', 'create_skill', 'sleep', 'mcp:anything']) {
    assert.equal(proactive.allowedInResearch(tool, reads), false, `${tool} is not for a research moment`);
  }
  assert.equal(proactive.allowedInResearch('memory', reads), true, 'notes are what research leaves behind');
  assert.doesNotMatch(proactive.RESEARCH_EVENT, /for example|for instance|e\.g\.|such as/i);
});

/* ------------------------------------------------------------------------ */
/* Conditions and heartbeats                                                 */
/* ------------------------------------------------------------------------ */

const screen = await importTs(harness('triggers', 'trigger-screen.ts'));

it('reads a screen\'s answer, erring towards waking', () => {
  for (const answer of ['NO — it is about dinner plans.', 'No.', '**NO**', '  no, a newsletter']) assert.equal(screen.screenPasses(answer), false, answer);
  for (const answer of ['YES — she asks to borrow it.', '', 'Not sure: the subject is vague.', 'Nothing in it says either way.']) assert.equal(screen.screenPasses(answer), true, answer);
  assert.match(screen.screeningPrompt('it asks the user for something', 'x'.repeat(5_000)), /^Condition: it asks the user for something\n\nEvent:\nx{4000}…$/);
  assert.doesNotMatch(screen.SCREEN_SYSTEM, /for example|for instance|e\.g\.|such as/i);
});

it('screens events against a trigger\'s condition before waking the bot, and counts the ones it skips', async () => {
  const dotId = await newDot();
  const { trigger } = triggers.createTrigger(dotId, draft({ type: 'email', query: 'from:someone@example.com' }, { condition: 'it asks the user for something' }), NOW);
  let ids = ['m1'];
  let verdict = false;
  const asked = [];
  const fired = [];
  const deps = {
    now: () => NOW,
    sources: sources({ mail: async (_search, known) => ({ ids, fresh: ids.filter((id) => !known(id)).map((id) => ({ id, from: 'Someone', domain: 'example.com', subject: `Subject ${id}`, date: '', unread: true })), more: 0, contents: false }) }),
    dotIds: () => [dotId],
    fire: (_id, _trigger, text) => fired.push(text),
    folderRoot: () => undefined,
    screen: async (condition, happened) => {
      asked.push({ condition, happened });
      return verdict;
    },
  };
  await engine.lookAtDueTriggers(dotId, deps);
  assert.equal(asked.length, 0, 'the first look only learns what is there');

  ids = ['m2', 'm1'];
  triggers.patchTrigger(dotId, trigger.id, { nextAt: NOW });
  await engine.lookAtDueTriggers(dotId, deps);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].condition, 'it asks the user for something');
  assert.match(asked[0].happened, /“Subject m2”/);
  assert.equal(fired.length, 0, 'screened out: nobody is woken');
  let stored = triggers.findTrigger(dotId, trigger.id);
  assert.equal(stored.screened, 1);
  assert.equal(stored.runs, 0, 'a screened-out event is not a run');
  assert.ok(stored.seen.includes('m2'), 'and is not judged again');

  ids = ['m3', 'm2', 'm1'];
  verdict = true;
  triggers.patchTrigger(dotId, trigger.id, { nextAt: NOW });
  await engine.lookAtDueTriggers(dotId, deps);
  assert.equal(fired.length, 1);
  stored = triggers.findTrigger(dotId, trigger.id);
  assert.equal(stored.runs, 1);
  assert.match(spec.describeTrigger(stored), /; only when: it asks the user for something; watching; .*, ran 1 time, last .*, 1 screened out\./);

  const tasks = [{ id: 'task-1', title: 'Report', status: 'running' }];
  const watcher = triggers.createTrigger(dotId, draft({ type: 'spark_task', status: 'complete' }, { condition: 'it found a bug', seen: watch.sparkTaskKeys(tasks) }), NOW).trigger;
  verdict = false;
  await engine.hearSparkTasks(dotId, [{ id: 'task-1', title: 'Report', status: 'complete' }], { excluded: new Set(), latestResponse: () => 'All clear.', now: NOW, screen: deps.screen }, deps.fire);
  assert.equal(fired.length, 1, 'Spark tasks are screened too');
  assert.equal(triggers.findTrigger(dotId, watcher.id).screened, 1);
});

it('keeps conditions for events, and heartbeats as schedules that check in', async () => {
  const dotId = await newDot();
  const tool = triggerTool(toolEnv(dotId));
  const refused = await tool.handler.run({ action: 'create', when: { type: 'schedule', every: 'day', at: '09:00' }, condition: 'something changed', instruction: 'Check.' }, { turnId: 't' });
  assert.equal(refused.failed, true);
  assert.match(refused.observation, /no event to check a condition against/);

  const beat = await tool.handler.run({ action: 'create', when: { type: 'heartbeat' }, instruction: 'Look at the build; tell the user only if it broke.' }, { turnId: 't' });
  assert.match(beat.observation, /^Created t1 “Heartbeat: Every 60 minutes”: Heartbeat, Every 60 minutes/);
  const stored = triggers.findTrigger(dotId, 't1');
  assert.equal(stored.heartbeat, true);
  assert.deepEqual(stored.when, { type: 'schedule', every: 'minutes', interval: 60 });

  const mail = await tool.handler.run({ action: 'create', when: { type: 'email', query: 'from:someone@example.com' }, condition: 'it asks for a reply', instruction: 'Draft a reply.' }, { turnId: 't' });
  assert.match(mail.observation, /only when: it asks for a reply/);
  const cleared = await tool.handler.run({ action: 'update', id: 't2', condition: null }, { turnId: 't' });
  assert.doesNotMatch(cleared.observation, /only when: /);
});
