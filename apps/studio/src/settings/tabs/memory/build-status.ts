/**
 * The sentences under the Memory page's buttons.
 *
 * Split out of the component because they are the part most likely to be wrong,
 * and a pure function is the part that can be checked. Every one of these takes
 * plain values and returns a string — no store reads, no clock reads except the
 * `now` the caller passes in, which is what makes them testable.
 *
 * The reason these exist at all: `buildProfileNow` returns the same
 * `nothing-to-do` for "there is no folder", "there is no API key" and "nothing
 * has changed since last time". A button that says "Nothing to update" in all
 * three cases is lying in two of them — the user with no key would keep pressing
 * it forever. The tab therefore asks `buildDecision` *first* and reports what it
 * actually found.
 */

import {
  CHANGE_THRESHOLD,
  FIRST_BUILD_THRESHOLD,
  type RebuildOutcome,
  type ScheduleDecision,
} from '@willow/personal';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "Updated 3 days ago." — or an honest sentence when it has never run. */
export const formatLastBuilt = (iso: string | undefined, now = Date.now()): string => {
  if (!iso) return 'Willow has not written anything here yet.';
  const at = Date.parse(iso);
  // A damaged timestamp still proves a build happened; claiming "never" would be
  // a worse answer than declining to say when.
  if (!Number.isFinite(at)) return 'Willow has updated this before.';

  const ago = now - at;
  if (ago < 2 * MINUTE) return 'Updated just now.';
  if (ago < HOUR) return `Updated ${plural(Math.round(ago / MINUTE), 'minute')} ago.`;
  if (ago < DAY) return `Updated ${plural(Math.round(ago / HOUR), 'hour')} ago.`;
  if (ago < 2 * DAY) return 'Updated yesterday.';
  if (ago < 30 * DAY) return `Updated ${plural(Math.floor(ago / DAY), 'day')} ago.`;
  return `Updated on ${new Date(at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })}.`;
};

/**
 * What the app will do next, left alone.
 *
 * `hasBuilt` picks which threshold to quote: the first build runs on a much
 * lower bar than every later one, and quoting the wrong number would send a new
 * user off to have five conversations they did not need.
 */
export const describeSchedule = (
  decision: ScheduleDecision,
  { hasFolder, hasBuilt }: { hasFolder: boolean; hasBuilt: boolean },
): string => {
  if (!hasFolder) {
    return 'Connect a folder in Settings so Willow has somewhere to read your chats from and somewhere to keep this.';
  }
  if (decision.run) return 'An update is due, and will run while the app is sitting idle.';

  switch (decision.reason) {
    case 'disabled':
      return 'Memory is off, so nothing new is being added.';
    case 'no-model':
      return 'Add an API key in Settings so Willow can read your chats and update this on its own.';
    case 'nothing-pending':
      return 'Every saved chat has already been read.';
    case 'below-threshold':
      return hasBuilt
        ? `Willow updates this on its own once about ${CHANGE_THRESHOLD} chats have changed.`
        : `Willow writes this for the first time once you have about ${FIRST_BUILD_THRESHOLD} saved chats.`;
    case 'cooling-down':
      return 'Willow updated this recently, and leaves it alone for a few hours in between.';
    default:
      return '';
  }
};

/** What just happened when the user pressed Refresh now. */
export const describeOutcome = (
  outcome: RebuildOutcome,
  { hasFolder, decisionReason }: { hasFolder: boolean; decisionReason?: ScheduleDecision['reason'] },
): string => {
  switch (outcome.status) {
    case 'built': {
      const read = `Read ${plural(outcome.chatsRead, 'chat')}.`;
      const accepted = outcome.stats?.accepted ?? 0;
      // Deliberately only `accepted`. The other counters are the merge's own
      // bookkeeping — a bullet skipped as a duplicate, as too sensitive to keep,
      // or as over the cap is not a thing that happened *to the user*, and
      // reporting seven numbers would read as an error report for a run that
      // worked exactly as intended.
      return accepted > 0 ? `${read} Added ${plural(accepted, 'note')}.` : `${read} Nothing new to add.`;
    }
    case 'cancelled':
      return 'Update stopped.';
    case 'disabled':
      return 'Turn Memory on first.';
    case 'nothing-to-do':
    default:
      if (!hasFolder) return 'Connect a folder first — there are no chats to read.';
      if (decisionReason === 'no-model') {
        return 'Add an API key in Settings first — Willow needs a model to read your chats.';
      }
      return 'Nothing new to read.';
  }
};
