import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import type { DotItem, DotPlanStep, DotThread } from '../harness/thread/thread-types';
import { M3_SCOPE } from '../m3/m3';
import './DotPlanCard.css';

const STEP_ICONS: Record<DotPlanStep['status'], string> = {
  completed: 'check_circle',
  in_progress: 'radio_button_partial',
  waiting: 'hourglass_top',
  pending: 'radio_button_unchecked',
};

/** A bot's plan as it is now; once the bot has moved on to another plan, the steps as they were when it was made. */
export function DotPlanCard({ item, thread }: { item: DotItem; thread: DotThread }) {
  const plan = thread.runtime.plan?.id === item.ref ? thread.runtime.plan : undefined;
  const steps: DotPlanStep[] = plan?.steps ?? item.text.split('\n').filter(Boolean).map((line) => ({
    step: line.replace(/^\[[x ]\]\s*/, ''),
    status: line.startsWith('[x]') ? 'completed' : 'pending',
  }));
  const done = steps.filter((step) => step.status === 'completed').length;
  const state = !plan ? 'is-past' : plan.stalledAt ? 'is-stalled' : done === steps.length ? 'is-done' : 'is-active';
  const status = !plan
    ? 'Earlier plan'
    : plan.stalledAt
      ? 'Stopped: it stopped moving. Write to carry on.'
      : done === steps.length
        ? 'Done'
        : `${done} of ${steps.length} done`;

  return (
    <article className={`dot-plan-card ${state} ${M3_SCOPE}`} aria-label={`Plan: ${status}`}>
      <md-outlined-card>
        <div className="dot-plan-card__body">
          <div className="dot-plan-card__head">
            <MaterialSymbol name="checklist" size={18} opticalSize={20} weight={350} />
            <span className="dot-plan-card__title">{plan?.goal ? `Plan: ${plan.goal}` : 'Plan'}</span>
          </div>
          <ol className="dot-plan-card__steps">
            {steps.map((step, index) => (
              <li key={`${index}-${step.step}`} className={`is-${step.status}`}>
                <MaterialSymbol name={STEP_ICONS[step.status]} size={18} opticalSize={20} weight={350} />
                <span>{step.step}</span>
              </li>
            ))}
          </ol>
          <p className="dot-plan-card__status">{status}</p>
        </div>
      </md-outlined-card>
    </article>
  );
}
