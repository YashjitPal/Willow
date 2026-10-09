/**
 * `sleep`: how a bot spends time between things to do.
 *
 * A sleep ends the turn and sets a wake-up; the runtime wakes the bot then, or
 * earlier if the user writes, delegated work changes or a trigger fires. It
 * lives in the thread's runtime state, so it survives reloads and is honoured as
 * soon as Willow is open again. Standing "when this happens, do that" wake-ups
 * are triggers (trigger-tools.ts).
 */
import { formatStamp } from '../memory/render';
import { updateDotRuntime } from '../thread/thread-store';
import { fail, ok, stringArg, type DotToolEntry, type DotToolEnv } from './tool-env';
import { nextLocalTime, parseClock } from './zoned-time';

const MIN_SLEEP_MS = 60_000;
const MAX_SLEEP_MS = 30 * 86_400_000;

const resolveWake = (args: Record<string, unknown>, now: number, timeZone: string): number | string => {
  const minutes = typeof args.minutes === 'number' ? args.minutes : typeof args.minutes === 'string' ? Number(args.minutes) : undefined;
  const until = stringArg(args, 'until');
  let wakeAt: number;
  if (until) {
    const clock = parseClock(until);
    if (clock) wakeAt = nextLocalTime(now, clock, timeZone);
    else {
      const parsed = Date.parse(until);
      if (!Number.isFinite(parsed)) return `"until" must be a local time like 17:30 or an ISO date-time.`;
      wakeAt = parsed;
    }
  } else if (minutes !== undefined && Number.isFinite(minutes)) {
    wakeAt = now + minutes * 60_000;
  } else {
    return 'Give "minutes" or "until".';
  }
  if (wakeAt - now < MIN_SLEEP_MS) return 'A sleep must last at least a minute. To wait for the user or for delegated work, end your turn instead: you will be woken.';
  if (wakeAt - now > MAX_SLEEP_MS) return 'A sleep can last at most 30 days. For something further out, set a trigger or note it in your notebook.';
  return wakeAt;
};

export const sleepTool = (env: DotToolEnv): DotToolEntry => ({
  doc: {
    name: 'sleep',
    args: '{"minutes": 90} or {"until": "17:30"}, plus {"reason": "…", "up_next": "…"}',
    description: 'Pause until a time, ending your turn. You wake early if the user writes, delegated work changes or a trigger fires, so never sleep to wait for those. "until" takes a local time or an ISO date-time; "up_next" is the first-person line the user sees while you sleep.',
  },
  handler: {
    id: 'sleep',
    async run(args, context) {
      const now = env.now();
      const wakeAt = resolveWake(args, now, env.timeZone);
      if (typeof wakeAt === 'string') return fail(wakeAt);
      const reason = stringArg(args, 'reason') ?? 'a planned wake-up';
      const upNext = stringArg(args, 'up_next');
      updateDotRuntime(env.dotId, (runtime) => ({
        ...runtime,
        status: 'sleeping',
        wakeAt,
        wakeReason: reason,
        upNext: upNext ?? runtime.upNext,
      }));
      context.stopTurn('sleeping');
      return ok(`Sleeping until ${formatStamp(wakeAt, env.timeZone)} (${env.timeZone}). You will wake then, or sooner if the user writes, delegated work changes or a trigger fires.`);
    },
  },
});
