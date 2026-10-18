/**
 * Gemini's Scheduled tab (`/scheduled`), cloned onto Spark's schedules
 * (features/spark/src/scheduled/). Measured off gemini.google.com at 1536x826, 800x1280 and 390x844
 * in both themes and read out of its `scheduled-tasks-tab` / `scheduled-tasks-side-pane` chunk
 * (tools/ui-research/captures/gemini/scheduled/), and walked in Willow by the `w-*.cjs` scripts beside
 * the captures' scrapers.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const load = (file) => importTs(path.join(ROOT, file));

const model = await load('features/spark/src/scheduled/scheduled-model.ts');
const time = await load('features/spark/src/spark-schedule-time.ts');
const library = await load('platform/core/src/spark-library.ts');
const css = read('features/spark/src/scheduled/scheduled.css');

const at = (...parts) => new Date(...parts);
const iso = (...parts) => new Date(...parts).toISOString();

describe('Scheduled: when a schedule runs next', () => {
  const base = { weekdays: [], time: '09:00' };

  it('keeps daily and weekly as they were', () => {
    assert.equal(time.getNextScheduleRunAt({ ...base, frequency: 'Daily' }, at(2026, 9, 15, 8, 0)), iso(2026, 9, 15, 9, 0));
    assert.equal(time.getNextScheduleRunAt({ ...base, frequency: 'Daily' }, at(2026, 9, 15, 9, 30)), iso(2026, 9, 16, 9, 0));
    assert.equal(time.getNextScheduleRunAt({ frequency: 'Weekly', weekdays: ['Sunday'], time: '19:00' }, at(2026, 9, 15, 12, 0)), iso(2026, 9, 18, 19, 0));
  });

  it('runs hourly at its minute past the hour', () => {
    assert.equal(time.getNextScheduleRunAt({ ...base, frequency: 'Hourly', minute: 15 }, at(2026, 9, 15, 10, 10)), iso(2026, 9, 15, 10, 15));
    assert.equal(time.getNextScheduleRunAt({ ...base, frequency: 'Hourly', minute: 15 }, at(2026, 9, 15, 10, 20)), iso(2026, 9, 15, 11, 15));
    assert.equal(time.getNextScheduleRunAt({ ...base, frequency: 'Hourly' }, at(2026, 9, 15, 10, 0, 30)), iso(2026, 9, 15, 11, 0));
  });

  it('runs monthly and yearly on the day, or the month’s last when it is shorter', () => {
    assert.equal(time.getNextScheduleRunAt({ ...base, frequency: 'Monthly', dayOfMonth: 1 }, at(2026, 9, 15)), iso(2026, 10, 1, 9, 0));
    assert.equal(time.getNextScheduleRunAt({ ...base, frequency: 'Monthly', dayOfMonth: 31 }, at(2027, 1, 10)), iso(2027, 1, 28, 9, 0));
    assert.equal(time.getNextScheduleRunAt({ ...base, frequency: 'Yearly', month: 9, dayOfMonth: 15 }, at(2026, 9, 15, 10, 0)), iso(2027, 9, 15, 9, 0));
    assert.equal(time.getNextScheduleRunAt({ ...base, frequency: 'Yearly', month: 1, dayOfMonth: 29 }, at(2026, 9, 15)), iso(2027, 1, 28, 9, 0));
  });

  it('runs once, and never again after; a moment just passed still runs when saved', () => {
    const once = { ...base, frequency: 'Once', date: '2026-10-20' };
    assert.equal(time.getNextScheduleRunAt(once, at(2026, 9, 15)), iso(2026, 9, 20, 9, 0));
    assert.equal(time.getNextScheduleRunAt(once, at(2026, 9, 21)), undefined);
    assert.equal(time.getFirstScheduleRunAt(once, at(2026, 9, 21)), iso(2026, 9, 20, 9, 0));
  });

  it('stops at its end', () => {
    const daily = { ...base, frequency: 'Daily', endsAt: iso(2026, 9, 16, 8, 0) };
    assert.equal(time.getNextScheduleRunAt(daily, at(2026, 9, 15, 8, 0)), iso(2026, 9, 15, 9, 0));
    assert.equal(time.getNextScheduleRunAt(daily, at(2026, 9, 15, 10, 0)), undefined);
  });
});

describe('Scheduled: how the list reads', () => {
  const narrow = new Intl.RelativeTimeFormat('en-IN', { numeric: 'always', style: 'narrow' });

  it("reads Gemini's subtitle: the repeat, then the last run or Waiting to run", () => {
    const now = at(2026, 9, 15, 16, 0).getTime();
    assert.equal(model.scheduleSubtitle({ frequency: 'Daily', lastRunAt: new Date(now - (6 * 60 + 10) * 60_000).toISOString() }, now), `Daily \u00b7 Last run ${narrow.format(-6, 'hour')}`);
    assert.equal(model.scheduleSubtitle({ frequency: 'Weekly' }, now), 'Weekly \u00b7 Waiting to run');
  });

  it("steps up Gemini's units at its thresholds", () => {
    assert.equal(model.formatScheduledAgo(0), 'Just now');
    assert.equal(model.formatScheduledAgo(59), narrow.format(-59, 'minute'));
    assert.equal(model.formatScheduledAgo(60), narrow.format(-1, 'hour'));
    assert.equal(model.formatScheduledAgo(1440), narrow.format(-1, 'day'));
    assert.equal(model.formatScheduledAgo(10080), narrow.format(-1, 'week'));
    assert.equal(model.formatScheduledAgo(43200), narrow.format(-1, 'month'));
    assert.equal(model.formatScheduledAgo(525960), narrow.format(-1, 'year'));
    assert.equal(model.formatScheduledAgo(-1), undefined);
  });

  it('shows a section under All only with rows, and under its own filter always', () => {
    const sections = model.partitionSchedules([
      { id: 'a', enabled: true }, { id: 'p', enabled: false }, { id: 'c', enabled: true, completedAt: '2026-10-01T00:00:00.000Z' },
    ]);
    assert.deepEqual([sections.active.length, sections.paused.length, sections.completed.length], [1, 1, 1]);
    assert.deepEqual(model.visibleSections('ALL', { active: [1], paused: [], completed: [] }), [{ section: 'active', empty: false }]);
    assert.deepEqual(model.visibleSections('COMPLETED', { active: [1], paused: [], completed: [] }), [{ section: 'completed', empty: true }]);
    assert.equal(model.scheduledEmptyText('PAUSED'), "You don't have any paused tasks");
    assert.deepEqual(model.SCHEDULED_FILTERS.map((f) => `${f.label}:${f.icon}`), ['All:filter_list', 'Active:play_circle', 'Paused:pause_circle', 'Completed:check_circle']);
  });

  it("badges a schedule's chat as Gemini's goal badge does", () => {
    assert.equal(model.scheduleBadge({ status: 'needs-input' }), 'needs-input');
    assert.equal(model.scheduleBadge({ status: 'running' }), 'in-progress');
    assert.equal(model.scheduleBadge({ status: 'complete', hasUnreadCompletion: true }), 'unread');
    assert.equal(model.scheduleBadge({ status: 'complete' }), null);
    assert.equal(model.scheduleBadge(undefined), null);
  });
});

describe('Scheduled: the editor', () => {
  const now = at(2026, 9, 15, 16, 0);

  it("starts a new schedule as Gemini's does: daily at 5:00 PM, never ending", () => {
    const blank = model.blankScheduleForm(now);
    assert.deepEqual([blank.frequency, blank.time, blank.days, blank.ends, blank.endTime, blank.date], ['Daily', '17:00', [1, 3, 5], 'never', '08:00', '2026-10-15']);
  });

  it('counts only what the repeat uses as a change', () => {
    const base = model.blankScheduleForm(now);
    const roundTrip = model.withFrequency(model.withFrequency(base, 'Monthly'), 'Daily');
    assert.equal(model.isFormChanged(roundTrip, base), false);
    assert.equal(model.isFormChanged({ ...base, title: 'x' }, base), true);
    assert.equal(model.isFormChanged({ ...base, minute: 30 }, base), false);
    const weekly = model.withFrequency({ ...base, frequency: 'Weekly', days: [0] }, 'Daily');
    assert.deepEqual(model.withFrequency(weekly, 'Weekly').days, [1, 3, 5]);
  });

  it('asks for a name and a plan to create, and a change to save', () => {
    const base = model.blankScheduleForm(now);
    assert.equal(model.canSaveForm({ ...base, title: 'x' }, base, true), false);
    assert.equal(model.canSaveForm({ ...base, title: 'x', plan: 'y' }, base, true), true);
    const saved = { ...base, title: 'x', plan: 'y' };
    assert.equal(model.canSaveForm(saved, saved, false), false);
    assert.equal(model.canSaveForm({ ...saved, time: '18:00' }, saved, false), true);
  });

  it('stores only what the repeat uses', () => {
    const base = { ...model.blankScheduleForm(now), title: ' Fact ', plan: ' Plan ' };
    assert.deepEqual(model.scheduleInputFromForm({ ...base, frequency: 'Weekly', days: [5, 0] }).weekdays, ['Sunday', 'Friday']);
    const monthly = model.scheduleInputFromForm({ ...base, frequency: 'Monthly', dayOfMonth: 31 });
    assert.deepEqual([monthly.title, monthly.dayOfMonth, monthly.month, monthly.weekdays], ['Fact', 31, undefined, []]);
    const yearly = model.scheduleInputFromForm({ ...base, frequency: 'Yearly', month: 1, yearDay: 29 });
    assert.deepEqual([yearly.month, yearly.dayOfMonth], [1, 29]);
    const ends = model.scheduleInputFromForm(model.withEnds(base, 'specific', now));
    assert.equal(ends.endsAt, iso(2026, 10, 15, 8, 0));
    assert.equal(model.scheduleInputFromForm({ ...model.withEnds(base, 'specific', now), frequency: 'Once' }).endsAt, undefined);
    assert.equal(model.defaultEndDate(at(2027, 0, 31)), '2027-02-28');
  });

  it("offers Gemini's options", () => {
    assert.deepEqual(model.REPEAT_OPTIONS.map((o) => o.label), ['Hourly', 'Daily', 'Weekly', 'Monthly', 'Yearly', 'Once']);
    assert.deepEqual(model.ENDS_OPTIONS.map((o) => o.label), ['Never', 'On date']);
    assert.deepEqual(model.WEEKDAY_OPTIONS.map((o) => o.label), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    assert.deepEqual(model.minuteOptions(0).map((o) => o.label), [':00', ':15', ':30', ':45']);
    assert.equal(model.minuteOptions(20).length, 5);
    const times = model.timeOptions('19:00');
    assert.deepEqual([times.length, times[0].label, times[23].label], [24, '12:00 AM', '11:00 PM']);
    const between = model.timeOptions('19:30').map((o) => o.label);
    assert.deepEqual(between.slice(19, 22), ['7:00 PM', '7:30 PM', '8:00 PM']);
    assert.equal(model.yearDayOptions(1).length, 29);
    assert.equal(model.clampYearDay(3, 31), 30);
  });

  it('sums the days up as Gemini does', () => {
    assert.equal(model.daysSummary([1, 3, 5]), 'M, W, F');
    assert.equal(model.daysSummary([0, 1, 2, 3, 4, 5, 6]), 'Every day');
    assert.equal(model.daysSummary([1, 2, 3, 4, 5]), 'Weekdays');
    assert.equal(model.daysSummary([0, 6]), 'Weekends');
    assert.equal(model.daysSummary([0]), 'Sun');
    assert.equal(model.daysSummary([2, 4]), 'Tu, Th');
    assert.equal(model.daysSummary([]), 'Select days');
    assert.equal(model.monthDaySummary(22), '22nd');
    assert.equal(model.formatPaneDate('2026-10-15'), '15 Oct 2026');
  });

  it("lays out Material's month view from today", () => {
    const month = model.calendarMonth(2026, 9, now);
    assert.deepEqual([month.label, month.offset, month.cells.length], ['OCT 2026', 4, 31]);
    assert.deepEqual(month.cells.filter((cell) => cell.disabled).map((cell) => cell.day), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    assert.equal(month.cells.find((cell) => cell.today).day, 15);
  });
});

describe('Scheduled: how other surfaces read the new repeats', () => {
  const at9 = { weekdays: [], time: '09:00' };
  it('says when each runs', () => {
    assert.equal(library.formatScheduleWhen({ ...at9, frequency: 'Hourly', minute: 15 }), 'Hourly around the 15-min mark');
    assert.equal(library.formatScheduleWhen({ ...at9, frequency: 'Hourly' }), 'Hourly around the top of the hour');
    assert.equal(library.formatScheduleWhen({ ...at9, frequency: 'Monthly', dayOfMonth: 1 }), 'Monthly on 1st around 9:00 AM');
    assert.equal(library.formatScheduleWhen({ ...at9, frequency: 'Yearly', month: 9, dayOfMonth: 15 }), 'Yearly on 15 Oct around 9:00 AM');
    assert.equal(library.formatScheduleWhen({ ...at9, frequency: 'Once', date: '2026-10-20' }), 'Will run once on 20 Oct 2026 around 9:00 AM');
    assert.equal(library.formatScheduleDue({ ...at9, frequency: 'Monthly', dayOfMonth: 2 }), '2nd of each month by 9 AM');
    assert.equal(library.formatScheduleDue({ ...at9, frequency: 'Once', date: '2026-10-20' }), '20 Oct 2026 by 9 AM');
  });
});

describe('Scheduled: measured styles', () => {
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(css);
    assert.ok(match, `no rule for ${selector}`);
    return match[1];
  };

  it('keeps the page column, rows and lists', () => {
    assert.match(rule('.sched-container'), /max-width: 708px;[\s\S]*padding-block: 40px;/);
    assert.match(rule('.sched-row'), /min-height: 88px;\s*padding: 20px 28px;/);
    assert.match(rule('.sched-list'), /border-radius: 28px;/);
    assert.match(rule('.sched-title'), /font-size: 24px;[\s\S]*"ROND" 20, "slnt" 0, "wdth" 100, "wght" 380/);
  });

  it("opens the pane with Gemini's 300ms on its standard easing, 400px with 40px corners", () => {
    assert.match(css, /--sched-easing: cubic-bezier\(0\.2, 0, 0, 1\);/);
    assert.match(rule('.sched-pane-host'), /flex 300ms var\(--sched-easing\),\s*width 300ms var\(--sched-easing\),\s*margin-inline 300ms var\(--sched-easing\),\s*opacity 300ms var\(--sched-easing\);/);
    assert.match(rule('.sched-pane-host.is-open'), /flex: 0 0 400px;\s*width: 400px;\s*margin-inline: 16px;/);
    assert.match(rule('.sched-pane'), /border-radius: 40px;/);
  });

  it('switches to the narrow palette below 960px and keeps the light one', () => {
    assert.match(css, /@media \(max-width: 959\.98px\) \{\s*\.sched-scope \{\s*--sched-surface: #000;\s*--sched-surface-dim: #141414;\s*--sched-surface-bright: #1c1c1c;/);
    assert.match(css, /--sched-surface: #faf9f9;\s*--sched-surface-dim: #f2f0f0;\s*--sched-surface-bright: #fff;/);
  });

  it("animates the filter's Material menu and the discard dialog as Material does", () => {
    assert.match(rule('.sched-mat-menu'), /animation: sched-mat-menu-enter 120ms cubic-bezier\(0, 0, 0\.2, 1\);/);
    assert.match(rule('.sched-mat-menu.is-closing'), /animation: sched-mat-menu-exit 100ms linear 25ms forwards;/);
    assert.match(rule('.sched-dialog'), /width: 420px;[\s\S]*border-radius: 40px;[\s\S]*transform 150ms cubic-bezier\(0, 0, 0\.2, 1\);/);
    assert.match(rule('.sched-dialog-backdrop'), /opacity 400ms cubic-bezier\(0\.25, 0\.8, 0\.25, 1\);/);
  });
});

describe('Scheduled: wiring', () => {
  it('has an address, a lazy route and a sidebar row', () => {
    const app = read('apps/studio/src/app/App.tsx');
    assert.match(app, /React\.lazy\(\(\) => import\('@willow\/spark\/scheduled\/ScheduledPage'\)\)/);
    assert.match(app, /if \(location\.pathname === '\/scheduled'\) return 'scheduled';/);
    assert.match(app, /else if \(view === 'scheduled'\) navigate\('\/scheduled'\);/);
    assert.match(app, /<Route path="\/scheduled" element=\{null\} \/>/);
    const sidebar = read('apps/studio/src/shell/sidebar/Sidebar.tsx');
    assert.match(sidebar, /\| 'scheduled' \|/);
    assert.match(sidebar, /symbol="schedule"\s*label="Scheduled"[\s\S]{0,120}active=\{currentView === 'scheduled'\}/);
  });

  it("sends Chat's card Edit here unless the old pages are on", () => {
    const handler = read('apps/studio/src/app/ShellRequestHandler.tsx');
    assert.match(handler, /location\.page === 'schedule-editor' && !isExperimentEnabled\('old-skills-schedules'\)/);
    assert.match(handler, /requestScheduledPane\(location\.scheduleId\);\s*void shell\.onViewChange\('scheduled'\);/);
  });

  it("puts its full-window layers on the desktop app's page", () => {
    assert.match(read('apps/studio/src/shell/rail/AppRail.css'), /\.sched-pane-layer, \.sched-dialog-host, \.sched-dialog-backdrop,/);
  });

  it('keeps the new timing fields when a schedule is read back', () => {
    const store = read('features/spark/src/spark-store.ts');
    for (const field of ['minute: wholeNumberIn', 'dayOfMonth: wholeNumberIn', 'month: wholeNumberIn', 'endsAt: asString', 'completedAt: asString']) assert.ok(store.includes(field), field);
  });
});
