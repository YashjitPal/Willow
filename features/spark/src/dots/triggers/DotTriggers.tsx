import { useEffect, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { deleteDotTrigger, runDotTriggerNow, setDotTriggerPaused } from '../harness/dot-runtime';
import type { DotItem, DotThread, DotTrigger, DotTriggerType } from '../harness/thread/thread-types';
import { describeNotify, describeWhen, isTimeTrigger } from '../harness/triggers/trigger-spec';
import { triggersOf } from '../harness/triggers/trigger-store';
import { M3Switch } from '../m3/M3Switch';
import { M3_SCOPE } from '../m3/m3';
import './DotTriggers.css';

export const ICONS: Record<DotTriggerType, string> = {
  once: 'alarm',
  schedule: 'schedule',
  email: 'mail',
  calendar: 'event',
  github: 'code',
  spark_task: 'bolt',
  web_page: 'language',
  folder: 'folder',
  user_returns: 'waving_hand',
  discord: 'forum',
};

const DAY = 86_400_000;

/** "Today 08:30", "Tomorrow 08:30", "Tue 08:30", or a date: when a trigger runs or ran, in the user's own words for days. */
export const triggerTime = (at: number, now: number): string => {
  const start = (value: number) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((start(at) - start(now)) / DAY);
  const time = new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  if (days > 1 && days < 7) return `${new Date(at).toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(new Date(at).getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }) });
};

/** The state line under a trigger: when it runs next, or what it is doing, or why it stopped. */
const stateLine = (trigger: DotTrigger, now: number): string => {
  if (trigger.status === 'ended') return `Ended${trigger.endedBecause ? ` — ${trigger.endedBecause}` : ''}`;
  if (trigger.status === 'paused') return 'Paused';
  const last = trigger.lastRunAt ? ` · Last ran ${triggerTime(trigger.lastRunAt, now)}` : '';
  if (isTimeTrigger(trigger.when)) return trigger.nextAt ? `Next ${triggerTime(trigger.nextAt, now)}${last}` : `Waiting${last}`;
  const skipped = trigger.screened ? ` · Skipped ${trigger.screened} that didn't match` : '';
  return `Watching${last}${skipped}`;
};

/** Run now and delete, under a trigger's description; an ended one can only be removed. Deleting asks once more. */
function TriggerActions({ dotId, trigger }: { dotId: string; trigger: DotTrigger }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return undefined;
    const timer = window.setTimeout(() => setConfirming(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  const ended = trigger.status === 'ended';
  return (
    <span className="dot-trigger__actions">
      {!ended && (
        <md-text-button data-action="run" hasIcon aria-label={`Run ${trigger.name} now`} onClick={() => runDotTriggerNow(dotId, trigger.id)}>
          <span slot="icon" className="dot-trigger__action-icon">
            <MaterialSymbol name="play_arrow" size={18} opticalSize={20} weight={350} />
          </span>
          Run now
        </md-text-button>
      )}
      {confirming ? (
        <md-text-button data-action="confirm-delete" className="dot-trigger__confirm" onClick={() => deleteDotTrigger(dotId, trigger.id)}>
          {ended ? 'Remove from the list' : 'Delete for good'}
        </md-text-button>
      ) : (
        <md-text-button data-action="delete" hasIcon aria-label={`${ended ? 'Remove' : 'Delete'} ${trigger.name}`} onClick={() => setConfirming(true)}>
          <span slot="icon" className="dot-trigger__action-icon">
            <MaterialSymbol name={ended ? 'close' : 'delete'} size={18} opticalSize={20} weight={350} />
          </span>
          {ended ? 'Remove' : 'Delete'}
        </md-text-button>
      )}
    </span>
  );
}

export function TriggerRow({ dotId, trigger, now }: { dotId: string; trigger: DotTrigger; now: number }) {
  return (
    <div className={`dot-trigger is-${trigger.status}`}>
      <span className="dot-trigger__icon" aria-hidden="true">
        <MaterialSymbol name={ICONS[trigger.when.type]} size={20} opticalSize={20} weight={350} />
      </span>
      <span className="dot-trigger__copy">
        <span className="dot-trigger__name">{trigger.name}</span>
        <span className="dot-trigger__when">{describeWhen(trigger.when, trigger.timeZone, 'user')}</span>
        {trigger.condition && <span className="dot-trigger__when">Only when {trigger.condition}</span>}
        <span className="dot-trigger__state">{stateLine(trigger, now)}</span>
        {trigger.problem && trigger.status === 'active' && (
          <span className="dot-trigger__problem" role="status">
            <MaterialSymbol name="error" size={16} opticalSize={20} weight={350} />
            {trigger.problem}
          </span>
        )}
        <TriggerActions dotId={dotId} trigger={trigger} />
      </span>
      {trigger.status !== 'ended' && (
        <span className="dot-trigger__switch">
          <M3Switch selected={trigger.status === 'active'} label={trigger.status === 'active' ? `Pause ${trigger.name}` : `Resume ${trigger.name}`} onToggle={(on) => setDotTriggerPaused(dotId, trigger.id, !on)} />
        </span>
      )}
    </div>
  );
}

/**
 * The profile's "Scheduled": the bot's triggers, as OpenAI's bot profile lists its scheduled work and Gemini
 * Spark its schedules — each with what fires it, when it runs next, and controls to run, pause or delete it.
 */
export function DotScheduledSection({ dotId, thread, name }: { dotId: string; thread: DotThread | undefined; name: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [showEnded, setShowEnded] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const triggers = triggersOf(thread?.runtime);
  const live = triggers.filter((trigger) => trigger.status !== 'ended');
  const ended = triggers.filter((trigger) => trigger.status === 'ended').sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <section className={`spark-task-detail__progress-panel-section ${M3_SCOPE}`}>
      <div className="spark-task-detail__progress-panel-header is-static">
        <span className="spark-task-detail__progress-panel-title-wrapper">
          <span className="spark-task-detail__progress-panel-title">Scheduled</span>
        </span>
      </div>
      <div className="spark-task-detail__progress-panel-content dot-triggers">
        {live.length === 0 && (
          <div className="spark-dots-profile__activity">
            <MaterialSymbol name="schedule" size={20} opticalSize={20} weight={320} className="spark-dots-profile__row-icon" />
            <span className="spark-dots-profile__muted">Nothing scheduled. Ask {name} to do something on a schedule, or whenever something happens.</span>
          </div>
        )}
        {live.map((trigger) => <TriggerRow key={trigger.id} dotId={dotId} trigger={trigger} now={now} />)}
        {ended.length > 0 && (
          <>
            <md-text-button className="dot-triggers__ended-toggle" onClick={() => setShowEnded((open) => !open)}>
              {showEnded ? 'Hide completed' : `Completed (${ended.length})`}
            </md-text-button>
            {showEnded && ended.map((trigger) => <TriggerRow key={trigger.id} dotId={dotId} trigger={trigger} now={now} />)}
          </>
        )}
      </div>
    </section>
  );
}

/** A trigger's card in the conversation, where the bot set it up: the trigger as it is now, pausable from here. */
export function DotTriggerCard({ dotId, item, thread }: { dotId: string; item: DotItem; thread: DotThread }) {
  const trigger = triggersOf(thread.runtime).find((candidate) => candidate.id === item.ref);
  const now = Date.now();
  if (!trigger) {
    return (
      <article className={`dot-trigger-card is-removed ${M3_SCOPE}`} aria-label="Removed trigger">
        <md-outlined-card>
          <div className="dot-trigger-card__body">
            <MaterialSymbol name="event_busy" size={20} opticalSize={20} weight={350} />
            <span className="dot-trigger-card__copy">
              <span className="dot-trigger-card__title">Removed</span>
              <span className="dot-trigger-card__line">{item.text.replace(/^t\d+ /, '').split(';')[0]}</span>
            </span>
          </div>
        </md-outlined-card>
      </article>
    );
  }
  return (
    <article className={`dot-trigger-card is-${trigger.status} ${M3_SCOPE}`} aria-label={`Scheduled: ${trigger.name}`}>
      <md-outlined-card>
        <div className="dot-trigger-card__body">
          <span className="dot-trigger-card__icon" aria-hidden="true">
            <MaterialSymbol name={ICONS[trigger.when.type]} size={20} opticalSize={20} weight={350} />
          </span>
          <span className="dot-trigger-card__copy">
            <span className="dot-trigger-card__title">{trigger.name}</span>
            <span className="dot-trigger-card__line">{describeWhen(trigger.when, trigger.timeZone, 'user')}</span>
            {trigger.condition && <span className="dot-trigger-card__line">Only when {trigger.condition}</span>}
            <span className="dot-trigger-card__line is-muted">
              {stateLine(trigger, now)} · {describeNotify(trigger.notify, 'user')}
            </span>
          </span>
          {trigger.status !== 'ended' && (
            <M3Switch selected={trigger.status === 'active'} label={trigger.status === 'active' ? `Pause ${trigger.name}` : `Resume ${trigger.name}`} onToggle={(on) => setDotTriggerPaused(dotId, trigger.id, !on)} />
          )}
        </div>
      </md-outlined-card>
    </article>
  );
}
