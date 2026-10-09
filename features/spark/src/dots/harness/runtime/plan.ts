/**
 * The bot's plan, and carrying it through.
 *
 * `update_plan` is Codex's tool with one more state — `waiting`, for a step that waits on someone or something
 * else — and an optional `goal`: how the bot will know the work is done. The plan is in view every turn. After a
 * turn, a plan with steps the bot can move, and nothing it waits on, wakes it again (`continue`): long work goes on
 * in the background, turn after turn, with nobody asking. A finished plan wakes it once to look back (`reflect`),
 * Hermes's learning loop: a way of working worth repeating becomes a skill, a lasting lesson goes in the notebook.
 *
 * The one brake is for a loop, not for work: when `STALL_TURNS` continuations in a row leave the plan as it was,
 * Willow stops waking the bot for it until the plan changes or the user writes.
 */
import type { DotPlan, DotPlanStep } from '../thread/thread-types';

export const MAX_PLAN_STEPS = 24;
export const STALL_TURNS = 3;

const STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'waiting', 'completed']);

/** The steps of an `update_plan` call, or what is wrong with them. */
export const parsePlanSteps = (raw: unknown): DotPlanStep[] | string => {
  if (!Array.isArray(raw)) return 'Give "plan": the list of steps, each {"step": "…", "status": "pending" | "in_progress" | "waiting" | "completed"}.';
  if (raw.length > MAX_PLAN_STEPS) return `A plan has at most ${MAX_PLAN_STEPS} steps: fold the small ones together.`;
  const steps: DotPlanStep[] = [];
  for (const entry of raw as { step?: unknown; status?: unknown }[]) {
    const step = typeof entry?.step === 'string' ? entry.step.trim() : '';
    const status = typeof entry?.status === 'string' ? entry.status.trim().toLowerCase().replace(/[\s-]+/g, '_') : 'pending';
    if (!step) return 'Every step needs its "step": what it is, in a few words.';
    if (!STATUSES.has(status)) return `"${String(entry.status)}" is not a status: use pending, in_progress, waiting or completed.`;
    steps.push({ step: step.slice(0, 240), status: status as DotPlanStep['status'] });
  }
  if (steps.filter((step) => step.status === 'in_progress').length > 1) return 'Only one step can be in progress at a time.';
  return steps;
};

export const planDone = (plan: DotPlan): boolean => plan.steps.length > 0 && plan.steps.every((step) => step.status === 'completed');

/** Steps the bot can move by itself: neither done nor waiting on anyone. */
export const movableSteps = (plan: DotPlan): DotPlanStep[] => plan.steps.filter((step) => step.status === 'pending' || step.status === 'in_progress');

const MARKS: Record<DotPlanStep['status'], string> = { completed: '[x]', in_progress: '[>]', waiting: '[~]', pending: '[ ]' };

/** The plan as the bot reads it in its context. */
export const describePlan = (plan: DotPlan): string => {
  const done = plan.steps.filter((step) => step.status === 'completed').length;
  const state = plan.stalledAt ? '; Willow stopped waking you for it because it stopped moving' : '';
  return [
    `Your plan${plan.goal ? `, done when ${plan.goal}` : ''} (${done} of ${plan.steps.length} done${state}):`,
    ...plan.steps.map((step) => `${MARKS[step.status]} ${step.step}${step.status === 'waiting' ? ' (waiting)' : ''}`),
  ].join('\n');
};

export const CONTINUE_EVENT = 'Your plan has steps you can move, and nothing is waiting on the user. Carry on: take the next step, or change the plan if the work has changed.';

export const reflectEvent = (plan: DotPlan): string =>
  `Your plan is finished${plan.goal ? ` (${plan.goal})` : ''}. Look back on it once: if the work taught you a way of doing something that you or Spark will need again, save it with create_skill — or, if you followed a skill, improve it with improve_skill where it fell short; keep lasting lessons and facts in your notebook. Tell the user how it ended, if you have not. Then clear the plan.`;

/**
 * What a plan asks for once a turn is over: carry on, look back, stop waking the bot for it, or nothing. `waiting`
 * is whether the bot is held up by someone — the user deciding on a card, a Spark task or helper still working,
 * a sleep it chose — which wakes it by itself when it moves.
 */
export const planNext = (plan: DotPlan | undefined, waiting: boolean): 'continue' | 'reflect' | 'stall' | null => {
  if (!plan || plan.steps.length === 0) return null;
  if (planDone(plan)) return plan.reflectedAt ? null : 'reflect';
  if (plan.stalledAt || waiting || movableSteps(plan).length === 0) return null;
  return (plan.stillTurns ?? 0) >= STALL_TURNS ? 'stall' : 'continue';
};
