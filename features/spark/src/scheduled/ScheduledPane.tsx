import React, { useLayoutEffect, useRef, useState } from 'react';
import type { SparkSchedule } from '../spark-types';
import {
  ENDS_OPTIONS,
  MONTH_DAY_OPTIONS,
  MONTH_OPTIONS,
  REPEAT_OPTIONS,
  WEEKDAY_OPTIONS,
  clampYearDay,
  daysSummary,
  formatPaneDate,
  minuteOptions,
  monthDaySummary,
  showsEnds,
  timeOptions,
  withEnds,
  withFrequency,
  yearDayOptions,
  type ScheduleForm,
} from './scheduled-model';
import { ScheduledDropdown } from './ScheduledDropdown';
import { ScheduledCalendar } from './ScheduledCalendar';
import { ScheduleActionMenu, PANE_MENU_PLACEMENT } from './ScheduleActionMenu';
import { SchedIcon } from './ScheduledIcons';
import { ScheduledSpinner } from './ScheduledSpinner';

const DISCLAIMER_LINK = 'https://support.google.com/gemini?p=lm_schedule_editor_rs';

export type ScheduledPaneMode = 'edit' | 'create';

interface ScheduledPaneProps {
  mode: ScheduledPaneMode;
  /** The schedule being edited; the last one shown stays while the pane closes. */
  schedule?: SparkSchedule;
  form: ScheduleForm;
  /** The form as saved: what Cancel goes back to and what "changed" is measured against. */
  base: ScheduleForm;
  readOnly: boolean;
  saving: boolean;
  footer: 'go_to_chat' | 'edit_actions';
  canSave: boolean;
  onChange: (form: ScheduleForm) => void;
  onClose: () => void;
  onCancel: () => void;
  onSave: () => void;
  onGoToChat: () => void;
  onDeleted: () => void;
}

/** A row of the Frequency card: its label, then its control at the far end. */
const FrequencyRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="sched-frequency-row">
    <span className="sched-row-label sched-body-m">{label}</span>
    {children}
  </div>
);

const Divider: React.FC = () => <div className="sched-row-divider" />;

/** The Date buttons: a dropdown-looking pill that opens the calendar. */
const DateButton: React.FC<{ ariaLabel: string; value: string; disabled: boolean; onChange: (iso: string) => void }> = ({ ariaLabel, value, disabled, onChange }) => {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`sched-dropdown-trigger sched-body-m${open ? ' is-expanded' : ''}`}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="sched-dropdown-label">{formatPaneDate(value)}</span>
        <SchedIcon name="keyboard_arrow_down" size={16} />
      </button>
      <ScheduledCalendar
        anchor={ref.current}
        open={open}
        value={value}
        onSelect={(iso) => { onChange(iso); setOpen(false); }}
        onClose={() => setOpen(false)}
      />
    </>
  );
};

/**
 * Gemini's `scheduled-tasks-side-pane`: the schedule's name and plan, its Frequency card (the
 * rows each Repeat needs) and its Ends card, a disclaimer, and a footer that is "Go to chat"
 * until something changes and Cancel with Create or Save after.
 */
export const ScheduledPane: React.FC<ScheduledPaneProps> = ({
  mode,
  schedule,
  form,
  base,
  readOnly,
  saving,
  footer,
  canSave,
  onChange,
  onClose,
  onCancel,
  onSave,
  onGoToChat,
  onDeleted,
}) => {
  const planRef = useRef<HTMLTextAreaElement | null>(null);
  const now = new Date();
  const f = form.frequency;

  useLayoutEffect(() => {
    const plan = planRef.current;
    if (!plan) return;
    plan.style.height = '0px';
    plan.style.height = `${Math.min(240, Math.max(100, plan.scrollHeight))}px`;
  }, [form.plan]);

  const set = (patch: Partial<ScheduleForm>) => onChange({ ...form, ...patch });

  return (
    <div className="sched-pane" data-mode={mode}>
      <div className="sched-pane-header">
        {mode === 'edit' && schedule && (
          <ScheduleActionMenu schedule={schedule} placement={PANE_MENU_PLACEMENT} iconSize={24} className="sched-icon-button sched-pane-more" onDeleted={onDeleted} />
        )}
        <button type="button" className="sched-icon-button sched-pane-close" aria-label="Close task panel" onClick={onClose}>
          <SchedIcon name="close" size={24} />
        </button>
      </div>
      <div className="sched-pane-content sched-scroll">
        <div className="sched-pane-section">
          <input
            className="sched-pane-input sched-body-m"
            type="text"
            aria-label="Schedule title"
            placeholder="Name your schedule"
            value={form.title}
            disabled={readOnly}
            onChange={(event) => set({ title: event.target.value })}
          />
        </div>
        <div className="sched-pane-section">
          <span className="sched-pane-label">Plan</span>
          <div className="sched-pane-plan-box">
            <textarea
              ref={planRef}
              className="sched-pane-plan"
              aria-label="Schedule plan"
              placeholder="Describe the plan"
              value={form.plan}
              disabled={readOnly}
              onChange={(event) => set({ plan: event.target.value })}
            />
          </div>
        </div>
        <div className="sched-pane-section">
          <span className="sched-pane-label">Frequency</span>
          <div className="sched-frequency-card">
            <FrequencyRow label="Repeat">
              <ScheduledDropdown ariaLabel="Schedule frequency" options={REPEAT_OPTIONS} value={f} disabled={readOnly} onChange={(value) => onChange(withFrequency(form, value))} />
            </FrequencyRow>
            {f === 'Hourly' && (
              <>
                <Divider />
                <FrequencyRow label="Every">
                  <ScheduledDropdown ariaLabel="Schedule run minute" options={minuteOptions(form.minute)} value={form.minute} disabled={readOnly} onChange={(minute) => set({ minute })} />
                </FrequencyRow>
              </>
            )}
            {f === 'Monthly' && (
              <>
                <Divider />
                <FrequencyRow label="Day">
                  <ScheduledDropdown ariaLabel="Schedule run day" options={MONTH_DAY_OPTIONS} value={form.dayOfMonth} summary={monthDaySummary(form.dayOfMonth)} disabled={readOnly} onChange={(dayOfMonth) => set({ dayOfMonth })} />
                </FrequencyRow>
              </>
            )}
            {f === 'Once' && (
              <>
                <Divider />
                <FrequencyRow label="Date">
                  <DateButton ariaLabel="Select date" value={form.date} disabled={readOnly} onChange={(date) => set({ date })} />
                </FrequencyRow>
              </>
            )}
            {f === 'Yearly' && (
              <>
                <Divider />
                <FrequencyRow label="Month">
                  <ScheduledDropdown ariaLabel="Schedule run month" options={MONTH_OPTIONS} value={form.month} disabled={readOnly} onChange={(month) => set({ month, yearDay: clampYearDay(month, form.yearDay) })} />
                </FrequencyRow>
                <Divider />
                <FrequencyRow label="Day">
                  <ScheduledDropdown ariaLabel="Schedule run day" options={yearDayOptions(form.month)} value={form.yearDay} disabled={readOnly} onChange={(yearDay) => set({ yearDay })} />
                </FrequencyRow>
              </>
            )}
            {f === 'Weekly' && (
              <>
                <Divider />
                <FrequencyRow label="Days">
                  <ScheduledDropdown
                    ariaLabel="Schedule run days"
                    options={WEEKDAY_OPTIONS}
                    multiple
                    values={form.days}
                    summary={daysSummary(form.days)}
                    disabled={readOnly}
                    onValuesChange={(days) => { if (days.length) set({ days: [...days].sort((a, b) => a - b) }); }}
                  />
                </FrequencyRow>
              </>
            )}
            {f !== 'Hourly' && (
              <>
                <Divider />
                <FrequencyRow label="Time">
                  <ScheduledDropdown ariaLabel="Schedule run time" options={timeOptions(form.time)} value={form.time} disabled={readOnly} onChange={(time) => set({ time })} />
                </FrequencyRow>
              </>
            )}
          </div>
          {showsEnds(f) && (
            <div className="sched-frequency-card sched-ends-card">
              <FrequencyRow label="Ends">
                <ScheduledDropdown ariaLabel="Schedule end date" options={ENDS_OPTIONS} value={form.ends} disabled={readOnly} onChange={(ends) => onChange(withEnds(form, ends, now, base.endTime))} />
              </FrequencyRow>
              {form.ends === 'specific' && (
                <>
                  <Divider />
                  <FrequencyRow label="Date">
                    <DateButton ariaLabel="Select end date" value={form.endDate} disabled={readOnly} onChange={(endDate) => set({ endDate })} />
                  </FrequencyRow>
                  <Divider />
                  <FrequencyRow label="Time">
                    <ScheduledDropdown ariaLabel="Schedule end time" options={timeOptions(form.endTime)} value={form.endTime} disabled={readOnly} onChange={(endTime) => set({ endTime })} />
                  </FrequencyRow>
                </>
              )}
            </div>
          )}
        </div>
        <p className="sched-pane-disclaimer sched-body-s">
          Scheduled tasks run at approximate times and use more of your limit at peak hours. They won&apos;t run if you&apos;ve reached your limit.{' '}
          <a className="sched-link" href={DISCLAIMER_LINK} target="_blank" rel="noreferrer">
            Learn more<span className="sched-visually-hidden">Opens in a new window</span>
          </a>
        </p>
      </div>
      <div className="sched-pane-footer">
        {footer === 'go_to_chat' ? (
          <div key="go" className="sched-go-to-chat-wide">
            <button type="button" className="sched-button sched-button--accent sched-body-m" aria-label="Go to chat" disabled={!schedule?.taskId} onClick={onGoToChat}>
              <span>Go to chat</span>
            </button>
          </div>
        ) : (
          <div key="edit" className="sched-pane-actions">
            <button type="button" className="sched-button sched-body-m" aria-label="Cancel edits" onClick={onCancel}>
              <span>Cancel</span>
            </button>
            <button type="button" className="sched-button sched-button--accent sched-body-m" aria-label="Save changes" disabled={!canSave || saving} onClick={onSave}>
              {saving ? <ScheduledSpinner size={18} label="Saving" /> : <span>{mode === 'create' ? 'Create' : 'Save'}</span>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
