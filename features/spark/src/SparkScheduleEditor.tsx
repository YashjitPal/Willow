import React, { useEffect, useId, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import './SparkScheduleEditor.css';

export const SPARK_SCHEDULE_WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type SparkScheduleWeekday = (typeof SPARK_SCHEDULE_WEEKDAYS)[number];
export type SparkScheduleFrequency = 'Daily' | 'Weekly';

export interface SparkScheduleDraft {
  title: string;
  frequency: SparkScheduleFrequency;
  weekdays: SparkScheduleWeekday[];
  time: string;
  instructions: string;
  enabled: boolean;
}

export interface SparkScheduleEditorProps {
  className?: string;
  initialDraft?: Partial<SparkScheduleDraft>;
  isEditing?: boolean;
  recordKey?: string;
  onAskGemini?: (
    draft: SparkScheduleDraft,
  ) => Promise<Partial<SparkScheduleDraft> | void> | Partial<SparkScheduleDraft> | void;
  onBack?: () => void;
  onDelete?: () => void;
  onLearnMore?: () => void;
  onSubmit?: (draft: SparkScheduleDraft) => void;
}

const DEFAULT_DRAFT: SparkScheduleDraft = {
  title: '',
  frequency: 'Weekly',
  /* Gemini's new weekly schedule arrives with Monday–Friday selected. */
  weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  time: '09:00',
  instructions: '',
  enabled: true,
};

const DAY_LABELS: Record<SparkScheduleWeekday, string> = {
  Sunday: 'S',
  Monday: 'M',
  Tuesday: 'T',
  Wednesday: 'W',
  Thursday: 'T',
  Friday: 'F',
  Saturday: 'S',
};

const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2).toString().padStart(2, '0');
  const minutes = index % 2 === 0 ? '00' : '30';
  return `${hour}:${minutes}`;
});

/**
 * Gemini labels the time as "9:00 am". The stored value stays 24-hour ("09:00")
 * because `spark-store` parses it when computing the next run — only the label is
 * localised.
 */
export const formatSparkScheduleTime = (value: string): string => {
  const [rawHour, rawMinute] = value.split(':');
  const hour = Number(rawHour);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour < 12 ? 'am' : 'pm';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${rawMinute ?? '00'} ${suffix}`;
};

const createInitialDraft = (
  initialDraft: Partial<SparkScheduleDraft> | undefined,
): SparkScheduleDraft => ({
  ...DEFAULT_DRAFT,
  ...initialDraft,
  weekdays: initialDraft?.weekdays
    ? [...initialDraft.weekdays]
    : [...DEFAULT_DRAFT.weekdays],
});

const normalizeScheduleDraft = (draft: SparkScheduleDraft): SparkScheduleDraft => ({
  title: draft.title.trim(),
  frequency: draft.frequency,
  weekdays: draft.frequency === 'Weekly'
    ? SPARK_SCHEDULE_WEEKDAYS.filter((weekday) => draft.weekdays.includes(weekday))
    : [],
  time: draft.time.trim(),
  instructions: draft.instructions.replace(/\r\n?/g, '\n').trim(),
  enabled: Boolean(draft.enabled),
});

const serializeScheduleDraft = (draft: SparkScheduleDraft): string =>
  JSON.stringify(normalizeScheduleDraft(draft));

export const SparkScheduleEditor: React.FC<SparkScheduleEditorProps> = ({
  className = '',
  initialDraft,
  isEditing = false,
  recordKey,
  onAskGemini,
  onBack,
  onDelete,
  onLearnMore,
  onSubmit,
}) => {
  const [draft, setDraft] = useState<SparkScheduleDraft>(() => createInitialDraft(initialDraft));
  const headingId = useId();
  const titleId = useId();
  const whenId = useId();
  const instructionsId = useId();
  const deleteHeadingId = useId();
  const discardHeadingId = useId();
  const discardDescriptionId = useId();
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const allowNavigationRef = useRef(false);
  const [isAskingGemini, setIsAskingGemini] = useState(false);
  const [assistError, setAssistError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [initialDraftSnapshot, setInitialDraftSnapshot] = useState(() =>
    serializeScheduleDraft(createInitialDraft(initialDraft)),
  );
  const draftIdentity = recordKey ?? [
    initialDraft?.title ?? '',
    initialDraft?.frequency ?? '',
    initialDraft?.weekdays?.join('|') ?? '',
    initialDraft?.time ?? '',
    initialDraft?.instructions ?? '',
    String(initialDraft?.enabled ?? ''),
  ].join('\u0001');
  const normalizedDraft = normalizeScheduleDraft(draft);
  const isDirty = serializeScheduleDraft(draft) !== initialDraftSnapshot;

  useEffect(() => {
    const nextDraft = createInitialDraft(initialDraft);
    setDraft(nextDraft);
    setInitialDraftSnapshot(serializeScheduleDraft(nextDraft));
    setAssistError('');
    setDeleteOpen(false);
    setDiscardOpen(false);
    allowNavigationRef.current = false;
  }, [draftIdentity]);

  useEffect(() => {
    if (!deleteOpen && !discardOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (discardOpen) {
        setDiscardOpen(false);
      } else {
        setDeleteOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [deleteOpen, discardOpen]);

  useEffect(() => {
    if (!isDirty) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowNavigationRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;

    const editorHistoryState = window.history.state;
    const editorUrl = window.location.href;
    const interceptHistoryNavigation = (event: PopStateEvent) => {
      if (allowNavigationRef.current) return;

      try {
        window.history.pushState(editorHistoryState, '', editorUrl);
      } catch {
        return;
      }

      event.stopImmediatePropagation();
      setDeleteOpen(false);
      setDiscardOpen(true);
    };

    window.addEventListener('popstate', interceptHistoryNavigation, true);
    return () => window.removeEventListener('popstate', interceptHistoryNavigation, true);
  }, [isDirty]);

  const canSubmit = Boolean(
    normalizedDraft.title
      && normalizedDraft.instructions
      && normalizedDraft.time
      && (normalizedDraft.frequency !== 'Weekly' || normalizedDraft.weekdays.length > 0),
  );

  const requestBack = () => {
    if (!onBack) return;
    if (!isDirty || allowNavigationRef.current) {
      onBack();
      return;
    }

    setDeleteOpen(false);
    setDiscardOpen(true);
  };

  const discardAndLeave = () => {
    if (!onBack) return;

    allowNavigationRef.current = true;
    setDiscardOpen(false);
    try {
      onBack();
    } catch (error) {
      allowNavigationRef.current = false;
      setDiscardOpen(true);
      throw error;
    }
  };

  const toggleWeekday = (weekday: SparkScheduleWeekday) => {
    setDraft((current) => ({
      ...current,
      weekdays: current.weekdays.includes(weekday)
        ? current.weekdays.filter((item) => item !== weekday)
        : SPARK_SCHEDULE_WEEKDAYS.filter(
            (item) => current.weekdays.includes(item) || item === weekday,
          ),
    }));
  };

  const submitSchedule = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !onSubmit) return;

    allowNavigationRef.current = true;
    try {
      onSubmit({
        ...normalizedDraft,
        weekdays: [...normalizedDraft.weekdays],
      });
    } catch (error) {
      allowNavigationRef.current = false;
      throw error;
    }
  };

  const confirmDelete = () => {
    if (!onDelete) return;

    allowNavigationRef.current = true;
    try {
      onDelete();
    } catch (error) {
      allowNavigationRef.current = false;
      throw error;
    }
  };

  const askGemini = async () => {
    if (!onAskGemini) {
      instructionsRef.current?.focus();
      return;
    }

    setIsAskingGemini(true);
    setAssistError('');
    try {
      const suggestion = await onAskGemini({
        ...draft,
        weekdays: [...draft.weekdays],
      });
      if (!suggestion) return;
      setDraft((current) => ({
        ...current,
        ...suggestion,
        weekdays: suggestion.weekdays ? [...suggestion.weekdays] : current.weekdays,
      }));
    } catch (error) {
      setAssistError(error instanceof Error
        ? error.message
        : 'Gemini could not update these instructions. Try again.');
    } finally {
      setIsAskingGemini(false);
    }
  };

  return (
    <main
      className={`spark-schedule-editor ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <form className="spark-schedule-editor__content" onSubmit={submitSchedule}>
        <header className="spark-schedule-editor__header">
          <button
            type="button"
            className="spark-schedule-editor__back"
            onClick={requestBack}
          >
            {/* Gemini's back glyph is 28px at weight 260 (`lm-icon-xl`). */}
            <MaterialSymbol
              family="luminous"
              name="arrow_back"
              size={28}
              weight={260}
              roundness={100}
              opticalSize={24}
            />
            <span id={headingId}>Schedules</span>
          </button>

          <div className="spark-schedule-editor__header-actions">
            {isEditing && onDelete && (
              <button
                type="button"
                className="spark-schedule-editor__delete"
                aria-label="Delete schedule"
                title="Delete schedule"
                onClick={() => {
                  setDiscardOpen(false);
                  setDeleteOpen(true);
                }}
              >
                <MaterialSymbol family="luminous" name="delete" size={20} weight={320} roundness={100} />
              </button>
            )}
            <button
              type="submit"
              className="spark-schedule-editor__create"
              disabled={!canSubmit}
            >
              {isEditing ? 'Save' : 'Create'}
            </button>
          </div>
        </header>

        <section className="spark-schedule-editor__panel" aria-label="Schedule details">
          {/* Gemini's `.schedule-title-section` is the bare input — no label above it.
            * The accessible name moves onto the field itself. */}
          <div className="spark-schedule-editor__field">
            <input
              id={titleId}
              type="text"
              value={draft.title}
              placeholder="Name your schedule"
              aria-label="Schedule title"
              autoComplete="off"
              onChange={(event) => setDraft((current) => ({
                ...current,
                title: event.target.value,
              }))}
            />
          </div>

          {/* Gemini's create form has no enabled switch — a schedule is on once it
            * exists. Kept for editing, where pausing an existing schedule matters. */}
          {isEditing && (
            <div className="spark-schedule-editor__enabled-row">
              <span className="spark-schedule-editor__enabled-copy">
                <strong>Enabled</strong>
                <span>Run this schedule automatically</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.enabled}
                aria-label={`${draft.enabled ? 'Pause' : 'Resume'} schedule`}
                className={`spark-schedule-editor__toggle${draft.enabled ? ' is-checked' : ''}`}
                onClick={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))}
              >
                <span />
              </button>
            </div>
          )}

          <fieldset className="spark-schedule-editor__when" aria-labelledby={whenId}>
            <legend id={whenId}>When to run</legend>

            <div className="spark-schedule-editor__run-grid">
              <label className="spark-schedule-editor__select">
                <span className="sr-only">Frequency</span>
                <select
                  aria-label="Frequency"
                  value={draft.frequency}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    frequency: event.target.value as SparkScheduleFrequency,
                  }))}
                >
                  <option value="Daily">Daily</option>
                  <option value="Weekly">Weekly</option>
                </select>
                <MaterialSymbol
                  family="luminous"
                  name="expand_more"
                  size={20}
                  weight={320}
                  roundness={100}
                  opticalSize={20}
                />
              </label>

              {/* Gemini spells the row out: "Weekly on S M T W T F S around 9:00 am". */}
              {draft.frequency === 'Weekly' && (
                <span className="spark-schedule-editor__inline-word">on</span>
              )}

              {draft.frequency === 'Weekly' && (
                <div className="spark-schedule-editor__weekdays" aria-label="Days of the week">
                  {SPARK_SCHEDULE_WEEKDAYS.map((weekday) => {
                    const isSelected = draft.weekdays.includes(weekday);
                    return (
                      <button
                        key={weekday}
                        type="button"
                        className={isSelected ? 'is-selected' : ''}
                        aria-label={weekday}
                        aria-pressed={isSelected}
                        title={weekday}
                        onClick={() => toggleWeekday(weekday)}
                      >
                        {DAY_LABELS[weekday]}
                      </button>
                    );
                  })}
                </div>
              )}

              <span className="spark-schedule-editor__inline-word">around</span>

              <label className="spark-schedule-editor__select spark-schedule-editor__time">
                <span className="sr-only">Time</span>
                <select
                  aria-label="Time"
                  value={draft.time}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    time: event.target.value,
                  }))}
                >
                  {TIME_OPTIONS.map((time) => (
                    <option key={time} value={time}>{formatSparkScheduleTime(time)}</option>
                  ))}
                </select>
                <MaterialSymbol
                  family="luminous"
                  name="expand_more"
                  size={20}
                  weight={320}
                  roundness={100}
                  opticalSize={20}
                />
              </label>
            </div>

            {/*
              * Gemini's `.ask-gemini-note` sits directly under the when-to-run row as
              * a sentence, with "Ask Gemini" as the only interactive part:
              * "Ask Gemini to create and edit event-based schedules and monitors".
              * Willow's version generates the instructions rather than navigating, so
              * it stays a button — styled as the inline link Gemini uses.
              */}
            <p className="spark-schedule-editor__ask-note">
              <button
                type="button"
                className="spark-schedule-editor__ask-link"
                disabled={isAskingGemini}
                onClick={() => void askGemini()}
              >
                {isAskingGemini ? 'Asking Gemini' : 'Ask Gemini'}
              </button>
              {' to create and edit event-based schedules and monitors'}
            </p>
          </fieldset>

          <div className="spark-schedule-editor__instructions-heading">
            <label htmlFor={instructionsId}>Instructions</label>
          </div>

          {assistError && <p className="spark-schedule-editor__assist-error" role="alert">{assistError}</p>}

          <textarea
            ref={instructionsRef}
            id={instructionsId}
            value={draft.instructions}
            placeholder="Give your schedule some instructions"
            onChange={(event) => setDraft((current) => ({
              ...current,
              instructions: event.target.value,
            }))}
          />

          {/* Gemini's copy, verbatim. */}
          <p className="spark-schedule-editor__disclaimer">
            Schedules run at approximate times and use more of your limit at peak hours. They
            won&apos;t run if you reach your limit.{' '}
            <button type="button" onClick={onLearnMore}>Learn more</button>
          </p>
        </section>
      </form>
      {deleteOpen && onDelete && (
        <div
          className="spark-schedule-editor__dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDeleteOpen(false);
          }}
        >
          <div className="spark-schedule-editor__delete-dialog" role="dialog" aria-modal="true" aria-labelledby={deleteHeadingId}>
            <h2 id={deleteHeadingId}>Delete schedule?</h2>
            <p>This schedule will be permanently removed.</p>
            <div>
              <button type="button" autoFocus onClick={() => setDeleteOpen(false)}>Cancel</button>
              <button type="button" className="is-danger" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
      {discardOpen && (
        <div
          className="spark-schedule-editor__dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDiscardOpen(false);
          }}
        >
          <div
            className="spark-schedule-editor__discard-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={discardHeadingId}
            aria-describedby={discardDescriptionId}
          >
            <h2 id={discardHeadingId}>Discard changes?</h2>
            <p id={discardDescriptionId}>
              If you leave now, your changes to this schedule won't be saved.
            </p>
            <div>
              <button type="button" autoFocus onClick={() => setDiscardOpen(false)}>
                Keep editing
              </button>
              <button type="button" className="is-primary" onClick={discardAndLeave}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
