/**
 * `trigger`: the bot's standing "when this happens, do that" — a time (once, or on a schedule) or something in the
 * user's world it watches for (new mail, a coming meeting, GitHub activity, a Spark task, a web page, a folder, the
 * user coming back). The runtime fires it (triggers/trigger-engine.ts); this is how the bot makes, changes and
 * lists them. Creating or changing one puts its card in the conversation, where the user can see and pause it.
 */
import { appendDotItem, getDotThread } from '../thread/thread-store';
import type { DotTriggerType } from '../thread/thread-types';
import { describeTrigger, describeWhen, isTimeTrigger, parseNotify, parseUntil, parseWhen } from '../triggers/trigger-spec';
import { createTrigger, deleteTrigger, findTrigger, setTriggerPaused, triggersOf, updateTrigger, type TriggerPatch } from '../triggers/trigger-store';
import { sparkTaskKeys } from '../triggers/trigger-watch';
import { locatePath, shownPath } from './computer-tools';
import { fail, ok, stringArg, type DotToolEntry, type DotToolEnv } from './tool-env';

const TYPE_NAMES: Record<DotTriggerType, string> = {
  once: 'once',
  schedule: 'schedule',
  email: 'email',
  calendar: 'calendar',
  github: 'github',
  spark_task: 'spark_task',
  web_page: 'web_page',
  folder: 'folder',
  user_returns: 'user_returns',
  discord: 'discord',
};

const ALL_TYPES = Object.keys(TYPE_NAMES) as DotTriggerType[];

/** The kinds this window can watch, and a sentence for each kind it cannot. */
const availability = (env: DotToolEnv) => {
  const unavailable = env.triggers?.unavailable ?? {};
  return { available: ALL_TYPES.filter((type) => !unavailable[type]), unavailable };
};

const docFor = (env: DotToolEnv) => {
  const { available, unavailable } = availability(env);
  const missing = Object.entries(unavailable).map(([type, reason]) => `${type} (${reason})`);
  return {
    name: 'trigger',
    args: '{"action": "create", "name": "…", "when": {"type": "schedule", "every": "weekday", "at": "08:30"}, "condition": "…", "instruction": "…", "notify": "important", "until": "2026-12-31", "max_runs": 10} · {"action": "update", "id": "t1", …fields to change} · {"action": "pause" | "resume" | "delete", "id": "t1"} · {"action": "list"}',
    description: [
      'Standing "when this happens, do that" instructions. At each firing you wake with what happened and the instruction. Kinds of "when":',
      '"once" {"at": "2026-10-08 09:00"} or {"in_minutes": 90};',
      '"schedule" {"every": "minutes" (with "interval", 5 or more) | "hours" ("interval", "minute") | "day" | "weekday" | "week" ("days": ["Mon"]) | "month" ("day_of_month") | "year" ("date": "MM-DD"), "at": "HH:MM"};',
      '"heartbeat" — a schedule for keeping watch where no event fires {"interval": minutes, 60 if omitted};',
      '"email" {"query": Gmail search};',
      '"calendar" {"minutes_before": 15, "match": words in the title};',
      '"github" {"watch": "pull_requests" | "issues", "repo": "owner/name", "match": words};',
      '"spark_task" {"status": "complete" | "failed" | "needs-input" | "any", "match": words in the title};',
      '"web_page" {"url": …, "contains": text to wait for, "every_minutes": 60};',
      '"folder" {"path": inside the connected folder};',
      '"user_returns" {"away_hours": 8};',
      '"discord" {"channel": an id or name, or "dm", "server": …, "from": who, "match": words, "mentions": true}.',
      `Times are the user's local time (${env.timeZone}). "condition", for event kinds only, is what an event must also be for you to wake, in plain words: each event is checked against it cheaply first and the rest never reach you. "notify" is how the user wants to hear about runs: "always", "important" (only when a run finds something that matters; the default) or "never". "until" and "max_runs" end it.`,
      `Available here: ${available.join(', ')}.${missing.length ? ` Not available here: ${missing.join('; ')}.` : ''}`,
      'Change an existing trigger rather than making a near-duplicate.',
    ].join(' '),
  };
};

const intArg = (args: Record<string, unknown>, key: string): number | undefined => {
  const value = typeof args[key] === 'number' ? args[key] : typeof args[key] === 'string' ? Number(args[key]) : NaN;
  return Number.isFinite(value) ? Math.round(value as number) : undefined;
};

export const triggerTool = (env: DotToolEnv): DotToolEntry => ({
  doc: docFor(env),
  handler: {
    id: 'trigger',
    async run(args, context) {
      const thread = getDotThread(env.dotId);
      if (!thread) return fail('Your triggers are not loaded.');
      const action = (stringArg(args, 'action') ?? 'list').toLowerCase();
      const now = env.now();
      const triggers = triggersOf(thread.runtime);

      if (action === 'list') {
        if (triggers.length === 0) return ok('You have no triggers.');
        return ok(triggers.map((trigger) => describeTrigger(trigger)).join('\n'));
      }

      const id = stringArg(args, 'id');
      if (action === 'pause' || action === 'resume') {
        if (!id) return fail('Give the trigger\'s "id".');
        const change = setTriggerPaused(env.dotId, id, action === 'pause', now);
        if ('error' in change) return fail(change.error);
        return ok(`${action === 'pause' ? 'Paused' : 'Resumed'} ${describeTrigger(change.trigger)}`);
      }
      if (action === 'delete' || action === 'remove') {
        if (!id) return fail('Give the trigger\'s "id".');
        const trigger = findTrigger(env.dotId, id);
        if (!trigger || !deleteTrigger(env.dotId, id)) return fail(`No trigger with id "${id}".`);
        return ok(`Deleted ${id} “${trigger.name}”.`);
      }
      if (action === 'run_now') {
        return fail('Only the user can run a trigger ahead of its condition. To do its work now, just do it.');
      }

      // create and update share how fields are read.
      const fields: TriggerPatch = {};
      const { unavailable } = availability(env);
      if (args.when !== undefined) {
        const parsed = parseWhen(args.when, now, env.timeZone);
        if ('error' in parsed) return fail(parsed.error);
        const reason = unavailable[parsed.when.type];
        if (reason) return fail(`A ${parsed.when.type} trigger is not available here: ${reason}. Tell the user what it would take, if it matters to them.`);
        fields.when = parsed.when;
        // With the whole computer connected, a folder is named in full, on the drive the user's home is on.
        if (parsed.when.type === 'folder' && env.computer?.whole) {
          const raw = (args.when as { path?: unknown }).path;
          const at = locatePath(env.computer, typeof raw === 'string' ? raw : '~');
          if (!at || at.root !== env.computer.root) return fail(`A folder trigger watches a folder on ${env.computer.root}: give its full path, or one relative to the user's home folder.`);
          fields.when = { type: 'folder', ...(at.path === '.' ? {} : { path: shownPath(env.computer, at.root, at.path) }) };
        }
        if (String((args.when as { type?: unknown }).type ?? '').toLowerCase() === 'heartbeat') fields.heartbeat = true;
      }
      const conditionText = stringArg(args, 'condition');
      if (conditionText) {
        const kind = fields.when ?? (id ? findTrigger(env.dotId, id)?.when : undefined);
        if (kind && isTimeTrigger(kind)) return fail('A time trigger has no event to check a condition against: put the check in its instruction.');
        fields.condition = conditionText.slice(0, 600);
      } else if (args.condition === null) fields.clearCondition = true;
      const name = stringArg(args, 'name');
      if (name) fields.name = name.length > 60 ? `${name.slice(0, 59).trimEnd()}…` : name;
      const instruction = stringArg(args, 'instruction');
      if (instruction) fields.instruction = instruction.slice(0, 6_000);
      if (args.notify !== undefined) {
        const notify = parseNotify(args.notify);
        if (!notify) return fail('"notify" must be always, important or never.');
        fields.notify = notify;
      }
      const untilText = stringArg(args, 'until');
      if (untilText) {
        const until = parseUntil(untilText, now, env.timeZone);
        if (until === null) return fail('"until" must be a date like 2026-12-31 or a local date and time.');
        if (until <= now) return fail('"until" has already passed.');
        fields.until = until;
      } else if (args.until === null) fields.clearUntil = true;
      const maxRuns = intArg(args, 'max_runs');
      if (maxRuns !== undefined) {
        if (maxRuns < 1) return fail('"max_runs" must be at least 1.');
        fields.maxRuns = maxRuns;
      } else if (args.max_runs === null) fields.clearMaxRuns = true;

      if (action === 'create' || action === 'add') {
        if (!fields.when) return fail('Give "when": what makes it fire.');
        if (!fields.instruction) return fail('Give "instruction": what you will do each time it fires, written so it stands on its own.');
        const created = createTrigger(env.dotId, {
          name: fields.name ?? `${fields.heartbeat ? 'Heartbeat: ' : ''}${describeWhen(fields.when, env.timeZone)}`,
          when: fields.when,
          instruction: fields.instruction,
          notify: fields.notify ?? 'important',
          timeZone: env.timeZone,
          condition: fields.condition,
          heartbeat: fields.heartbeat,
          until: fields.until,
          maxRuns: fields.maxRuns,
          ...(fields.when.type === 'spark_task' ? { seen: sparkTaskKeys(env.triggers?.sparkTasks() ?? []) } : {}),
        }, now);
        if ('error' in created) return fail(created.error);
        appendDotItem(env.dotId, { kind: 'trigger-card', ref: created.trigger.id, text: describeTrigger(created.trigger), turnId: context.turnId });
        return ok(`Created ${describeTrigger(created.trigger)} The user sees it as a card in the conversation and in your profile. Confirm it in a sentence — what will happen, when, and how they will hear — without repeating its instruction.`);
      }

      if (action === 'update' || action === 'edit') {
        if (!id) return fail('Give the trigger\'s "id".');
        if (Object.keys(fields).length === 0) return fail('Nothing to change: give the fields to update.');
        const updated = updateTrigger(env.dotId, id, fields, now);
        if ('error' in updated) return fail(updated.error);
        appendDotItem(env.dotId, { kind: 'trigger-card', ref: updated.trigger.id, text: describeTrigger(updated.trigger), turnId: context.turnId });
        return ok(`Updated ${describeTrigger(updated.trigger)}`);
      }

      return fail(`Unknown action "${action}". Use create, update, pause, resume, delete or list.`);
    },
  },
});
