/** `update_plan`: Codex's plan tool, kept in the bot's runtime and carried through by it (runtime/plan.ts). */
import { parsePlanSteps, planDone } from '../runtime/plan';
import { appendDotItem, getDotThread, updateDotRuntime } from '../thread/thread-store';
import type { DotPlan, DotPlanStep } from '../thread/thread-types';
import { fail, ok, stringArg, type DotToolEntry, type DotToolEnv } from './tool-env';

const stepsText = (steps: DotPlanStep[]): string => steps.map((step) => `${step.status === 'completed' ? '[x]' : '[ ]'} ${step.step}`).join('\n');

export const planTool = (env: DotToolEnv): DotToolEntry => ({
  doc: {
    name: 'update_plan',
    args: '{"goal": "…", "plan": [{"step": "…", "status": "pending" | "in_progress" | "waiting" | "completed"}]}',
    description: 'Keep your plan for work that takes several steps: the whole list each time, one step in progress at a time, "waiting" for a step that waits on someone or something else, and "goal" saying how you will know the work is done. While it has steps you can move and nothing waits on the user, Willow wakes you to carry on. An empty "plan" clears it.',
  },
  handler: {
    id: 'update_plan',
    async run(args, context) {
      const steps = parsePlanSteps(args.plan);
      if (typeof steps === 'string') return fail(steps);
      const current = getDotThread(env.dotId)?.runtime.plan;
      if (steps.length === 0) {
        updateDotRuntime(env.dotId, (runtime) => ({ ...runtime, plan: undefined }));
        return ok('Plan cleared.');
      }
      const now = env.now();
      const fresh = !current || planDone(current);
      const goal = (stringArg(args, 'goal') ?? (fresh ? undefined : current.goal))?.slice(0, 300);
      const plan: DotPlan = fresh
        ? { id: `p${now.toString(36)}`, ...(goal ? { goal } : {}), steps, createdAt: now, updatedAt: now }
        : { ...current, ...(goal ? { goal } : {}), steps, updatedAt: now, stillTurns: 0, stalledAt: undefined, reflectedAt: undefined };
      updateDotRuntime(env.dotId, (runtime) => ({ ...runtime, plan }));
      if (fresh) appendDotItem(env.dotId, { kind: 'plan-card', ref: plan.id, text: stepsText(steps), turnId: context.turnId });
      const done = steps.filter((step) => step.status === 'completed').length;
      const doing = steps.find((step) => step.status === 'in_progress');
      if (planDone(plan)) return ok(`Plan complete: all ${steps.length} steps done.`);
      return ok(`Plan ${fresh ? 'set' : 'updated'} (${plan.id}): ${done} of ${steps.length} done${doing ? `; in progress: ${doing.step}` : ''}.`);
    },
  },
});
