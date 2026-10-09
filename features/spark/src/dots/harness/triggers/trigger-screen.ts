/**
 * Screening: whether an event a trigger caught meets its condition, decided by one small request before the bot is
 * woken. The source's own filter has already narrowed what was looked at; the condition is the judgement left over,
 * and checking it costs a few hundred tokens — the condition and what happened, with no conversation, tools or
 * memory — where waking the bot costs its whole context.
 *
 * It errs towards waking. An event it cannot judge, an answer it cannot read, a request that fails: each wakes the
 * bot, which decides with everything it knows. Missing what the user asked to hear about costs more than one turn.
 */

export const SCREEN_SYSTEM = 'You screen events for an assistant before it is woken. Decide whether the event meets the condition. Answer YES or NO on the first line, then one short sentence saying why. Judge only from what the event says. When it holds several items, answer YES if any of them meets the condition. When it does not say enough to decide, answer YES.';

/** Events beyond this length are cut for screening; the bot still reads them whole. */
const SCREEN_EVENT_CHARS = 4_000;

export const screeningPrompt = (condition: string, happened: string): string =>
  `Condition: ${condition}\n\nEvent:\n${happened.length > SCREEN_EVENT_CHARS ? `${happened.slice(0, SCREEN_EVENT_CHARS)}…` : happened}`;

/** Reads the screen's answer: a NO screens the event out; anything else, no answer included, lets it through. */
export const screenPasses = (answer: string): boolean => !/^[\s*_#>"'`]*no\b/i.test(answer);

/** Decides whether an event meets a trigger's condition. Resolves true to wake the bot. */
export type ScreenEvent = (condition: string, happened: string) => Promise<boolean>;
