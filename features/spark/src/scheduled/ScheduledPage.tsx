import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { Tooltip } from '@willow/ui/Tooltip';
import { sparkHydrationScope, sparkSchedules, sparkState } from '../spark-store';
import type { SparkSchedule, SparkTask } from '../spark-types';
import { useSparkNow } from '../useSparkNow';
import {
  SCHEDULED_SUGGESTIONS,
  SCHEDULE_BADGE_TOOLTIPS,
  SECTION_TITLES,
  blankScheduleForm,
  canSaveForm,
  formFromSchedule,
  isFormChanged,
  partitionSchedules,
  scheduleBadge,
  scheduleInputFromForm,
  scheduleSection,
  scheduleSubtitle,
  scheduledEmptyText,
  visibleSections,
  type ScheduleForm,
  type ScheduledFilter,
} from './scheduled-model';
import {
  createScheduleFromForm,
  openScheduleChat,
  saveScheduleFromForm,
  scheduledPaneRequest,
  startScheduledTask,
} from './schedule-actions';
import { ScheduledFilterMenu } from './ScheduledFilterMenu';
import { ScheduledComposer } from './ScheduledComposer';
import { ScheduledPane } from './ScheduledPane';
import { ScheduledDialog } from './ScheduledDialog';
import { ScheduledSpinner } from './ScheduledSpinner';
import { ScheduleActionMenu, ROW_MENU_PLACEMENT } from './ScheduleActionMenu';
import { SchedIcon } from './ScheduledIcons';
import { useScheduledNarrow } from './use-scheduled-narrow';
import './scheduled.css';

const LEARN_MORE = 'https://support.google.com/gemini/answer/17094710?p=lm_schedules&rd=1';
/** The pane's sheet below 960px leaves with its 300ms slide. */
const SHEET_EXIT_MS = 300;

type PaneState =
  | { mode: 'closed' }
  | { mode: 'edit'; scheduleId: string }
  | { mode: 'create' };

type LinkedTask = Pick<SparkTask, 'status' | 'hasUnreadCompletion'>;

/**
 * The tasks the schedules last ran in, as far as their badges go. Spark's state changes on every
 * streamed token of every run; this re-renders the page only when a badge would change.
 */
const useLinkedTasks = (schedules: readonly SparkSchedule[]): Map<string, LinkedTask> => {
  const ids = useMemo(() => [...new Set(schedules.map((schedule) => schedule.taskId).filter((id): id is string => Boolean(id)))], [schedules]);
  const read = useCallback(() => {
    const byId = new Map(sparkState.get().tasks.map((task) => [task.id, task]));
    return ids.map((id) => {
      const task = byId.get(id);
      return task ? `${id}\u0000${task.status}\u0000${task.hasUnreadCompletion ? 1 : 0}` : '';
    }).filter(Boolean).join('\u0001');
  }, [ids]);
  const key = useSyncExternalStore((listener) => sparkState.listen(listener), read, read);
  return useMemo(() => new Map(key ? key.split('\u0001').map((entry) => {
    const [id, status, unread] = entry.split('\u0000');
    return [id!, { status: status as SparkTask['status'], hasUnreadCompletion: unread === '1' }];
  }) : []), [key]);
};

const StatusBadge: React.FC<{ task: LinkedTask | undefined }> = ({ task }) => {
  const badge = scheduleBadge(task);
  if (!badge) return null;
  const tooltip = SCHEDULE_BADGE_TOOLTIPS[badge];
  if (badge === 'unread') {
    return <Tooltip content={tooltip} className="sched-tooltip"><span className="sched-badge-unread" aria-hidden="true" /></Tooltip>;
  }
  return (
    <Tooltip content={tooltip} className="sched-tooltip">
      <span className="sched-badge-icon" aria-hidden="true">
        <SchedIcon name={badge === 'in-progress' ? 'progress_activity' : 'flag'} size={16} className={badge === 'in-progress' ? 'sched-badge-progress' : 'sched-badge-flag'} />
      </span>
    </Tooltip>
  );
};

interface ScheduleRowProps {
  schedule: SparkSchedule;
  task: LinkedTask | undefined;
  now: number;
  onOpen: (schedule: SparkSchedule) => void;
  onDeleted: (scheduleId: string) => void;
}

const ScheduleRow: React.FC<ScheduleRowProps> = ({ schedule, task, now, onOpen, onDeleted }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const hasChat = Boolean(schedule.taskId && task);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`sched-row${menuOpen ? ' is-menu-open' : ''}`}
      onClick={() => onOpen(schedule)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) onOpen(schedule);
        if (event.key === ' ' && event.target === event.currentTarget) event.preventDefault();
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' && event.target === event.currentTarget) onOpen(schedule);
      }}
    >
      <div className="sched-row-content">
        <div className="sched-row-title sched-body-l">{schedule.title}</div>
        <div className="sched-row-subtitle sched-body-m">{scheduleSubtitle(schedule, now)}</div>
      </div>
      {schedule.taskId && (
        <div className="sched-row-status">
          <StatusBadge task={task} />
        </div>
      )}
      <div className="sched-row-actions" onClick={(event) => event.stopPropagation()}>
        <Tooltip content={hasChat ? 'Go to chat' : 'Available when schedule runs'} className="sched-tooltip">
          <button
            type="button"
            className="sched-row-button sched-go-to-chat"
            aria-label={hasChat ? 'Go to chat' : 'Available when schedule runs'}
            aria-disabled={!hasChat || undefined}
            onClick={(event) => {
              event.stopPropagation();
              if (hasChat) openScheduleChat(schedule);
            }}
          >
            <SchedIcon name="chat_bubble" />
          </button>
        </Tooltip>
        <ScheduleActionMenu
          schedule={schedule}
          placement={ROW_MENU_PLACEMENT}
          iconSize={20}
          className="sched-row-button sched-more-button"
          onOpenChange={setMenuOpen}
          onDeleted={() => onDeleted(schedule.id)}
        />
      </div>
    </div>
  );
};

interface ScheduledPageProps {
  /** The provider settings dictation transcribes with. */
  modelConfig?: unknown;
}

/**
 * Gemini's Scheduled tab (`/scheduled`): the schedules Spark runs, in Active, Paused and
 * Completed sections with a status filter, a composer that asks Spark for a new one, Gemini's
 * suggestions, and the side pane that creates and edits them.
 */
const ScheduledPage: React.FC<ScheduledPageProps> = ({ modelConfig }) => {
  const schedules = useStore(sparkSchedules);
  const linkedTasks = useLinkedTasks(schedules);
  const hydrated = useStore(sparkHydrationScope) !== null;
  const paneRequest = useStore(scheduledPaneRequest);
  const now = useSparkNow();
  const narrow = useScheduledNarrow();
  const [filter, setFilter] = useState<ScheduledFilter>('ALL');
  const [pane, setPane] = useState<PaneState>({ mode: 'closed' });
  const [form, setForm] = useState<ScheduleForm>(() => blankScheduleForm(new Date()));
  const [base, setBase] = useState<ScheduleForm>(() => blankScheduleForm(new Date()));
  const [shownSchedule, setShownSchedule] = useState<SparkSchedule | undefined>(undefined);
  const [shownMode, setShownMode] = useState<'edit' | 'create'>('create');
  const [sheetClosing, setSheetClosing] = useState(false);
  const [discard, setDiscard] = useState<'new' | 'changes' | null>(null);
  const sheetTimer = useRef<number | null>(null);
  const tasksPaneRef = useRef<HTMLDivElement | null>(null);

  const sections = useMemo(() => partitionSchedules(schedules), [schedules]);
  const editing = pane.mode === 'edit' ? schedules.find((schedule) => schedule.id === pane.scheduleId) : undefined;
  const isOpen = pane.mode !== 'closed';
  const readOnly = shownMode === 'edit' && Boolean(shownSchedule && scheduleSection(shownSchedule) === 'completed');

  const openSchedule = useCallback((schedule: SparkSchedule) => {
    if (sheetTimer.current) { window.clearTimeout(sheetTimer.current); sheetTimer.current = null; }
    setSheetClosing(false);
    const saved = formFromSchedule(schedule, new Date());
    setPane({ mode: 'edit', scheduleId: schedule.id });
    setShownMode('edit');
    setShownSchedule(schedule);
    setBase(saved);
    setForm(saved);
  }, []);

  const openCreate = useCallback(() => {
    if (sheetTimer.current) { window.clearTimeout(sheetTimer.current); sheetTimer.current = null; }
    setSheetClosing(false);
    const blank = blankScheduleForm(new Date());
    setPane({ mode: 'create' });
    setShownMode('create');
    setShownSchedule(undefined);
    setBase(blank);
    setForm(blank);
  }, []);

  const closePane = useCallback(() => {
    setPane({ mode: 'closed' });
    if (narrow) {
      setSheetClosing(true);
      sheetTimer.current = window.setTimeout(() => {
        sheetTimer.current = null;
        setSheetClosing(false);
      }, SHEET_EXIT_MS);
    }
  }, [narrow]);

  useEffect(() => () => {
    if (sheetTimer.current) window.clearTimeout(sheetTimer.current);
  }, []);

  // Chat's schedule card Edit lands here with its schedule.
  useEffect(() => {
    if (!paneRequest || !hydrated) return;
    const schedule = schedules.find((candidate) => candidate.id === paneRequest);
    scheduledPaneRequest.set(null);
    if (schedule) openSchedule(schedule);
  }, [paneRequest, hydrated, schedules, openSchedule]);

  // The open schedule changed under the pane (a run, a pause, an edit elsewhere): the saved form
  // follows it, and so does the form unless the user has changed it. Deleted, the pane closes.
  useEffect(() => {
    if (pane.mode !== 'edit') return;
    if (!editing) {
      if (hydrated) closePane();
      return;
    }
    if (editing === shownSchedule) return;
    const saved = formFromSchedule(editing, new Date());
    setShownSchedule(editing);
    setForm((current) => (isFormChanged(current, base) ? current : saved));
    setBase(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, pane.mode, hydrated]);

  const changed = !readOnly && isFormChanged(form, base);
  const footer: 'go_to_chat' | 'edit_actions' = readOnly ? 'go_to_chat' : shownMode === 'create' || changed ? 'edit_actions' : 'go_to_chat';
  const canSave = !readOnly && canSaveForm(form, base, shownMode === 'create');

  const requestClose = () => {
    if (changed) setDiscard(shownMode === 'create' ? 'new' : 'changes');
    else closePane();
  };

  const cancelEdits = () => {
    setForm(base);
    if (shownMode === 'create') closePane();
  };

  const save = () => {
    if (!canSave) return;
    const input = scheduleInputFromForm(form);
    if (shownMode === 'create') {
      if (createScheduleFromForm(input)) closePane();
      return;
    }
    if (pane.mode === 'edit' && saveScheduleFromForm(pane.scheduleId, input)) setBase(form);
  };

  const paneNode = (isOpen || sheetClosing || !narrow) && (shownMode === 'create' || shownSchedule) ? (
    <ScheduledPane
      mode={shownMode}
      schedule={shownSchedule}
      form={form}
      base={base}
      readOnly={readOnly}
      saving={false}
      footer={footer}
      canSave={canSave}
      onChange={setForm}
      onClose={requestClose}
      onCancel={cancelEdits}
      onSave={save}
      onGoToChat={() => { if (shownSchedule) openScheduleChat(shownSchedule); }}
      onDeleted={closePane}
    />
  ) : null;

  const rowsOf = (list: readonly SparkSchedule[]) => list.map((schedule) => (
    <ScheduleRow
      key={schedule.id}
      schedule={schedule}
      task={schedule.taskId ? linkedTasks.get(schedule.taskId) : undefined}
      now={now}
      onOpen={openSchedule}
      onDeleted={(id) => { if (pane.mode === 'edit' && pane.scheduleId === id) closePane(); }}
    />
  ));

  return (
    <div className="sched-scope sched-page">
      <div className="sched-layout">
        <div ref={tasksPaneRef} className={`sched-tasks-pane sched-scroll${isOpen ? ' is-editor-open' : ''}`}>
          <div className="sched-container">
            <header className="sched-header">
              <div className="sched-title-row">
                <h1 className="sched-title">Scheduled</h1>
                <ScheduledFilterMenu value={filter} onChange={setFilter} />
              </div>
              <p className="sched-subtitle sched-body-m">
                Let Willow handle routines, track updates and take action for you.{' '}
                <a className="sched-link" href={LEARN_MORE} target="_blank" rel="noreferrer">
                  Learn more<span className="sched-visually-hidden">Opens in a new window</span>
                </a>
              </p>
            </header>
            <div className="sched-input-row">
              <div className="sched-input-anchor">
                <ScheduledComposer modelConfig={modelConfig} onSubmit={startScheduledTask} />
              </div>
              <button type="button" className="sched-icon-button sched-create-button" aria-label="Create a scheduled task" onClick={openCreate}>
                <SchedIcon name="edit_rectangle" size={24} />
              </button>
            </div>
            {!hydrated ? (
              <ScheduledSpinner size={32} label="Loading spinner for scheduled tasks" className="sched-loading-spinner" />
            ) : (
              <>
                {visibleSections(filter, sections).map(({ section, empty }) => (
                  <section key={section} className={`sched-section sched-section--${section}`}>
                    {empty ? (
                      <p className="sched-empty sched-body-m">{scheduledEmptyText(filter)}</p>
                    ) : (
                      <>
                        <h2 className="sched-section-title sched-body-m">{SECTION_TITLES[section]}</h2>
                        <div className="sched-list">{rowsOf(sections[section])}</div>
                      </>
                    )}
                  </section>
                ))}
                {filter === 'ALL' && (
                  <section className="sched-section sched-section--suggested">
                    <h2 className="sched-section-title sched-body-m">Suggested</h2>
                    <div className="sched-list">
                      {SCHEDULED_SUGGESTIONS.map((suggestion) => (
                        <div
                          key={suggestion.id}
                          role="button"
                          tabIndex={0}
                          className="sched-row sched-suggestion"
                          onClick={() => { void startScheduledTask(suggestion.description); }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void startScheduledTask(suggestion.description);
                            if (event.key === ' ') event.preventDefault();
                          }}
                          onKeyUp={(event) => { if (event.key === ' ') void startScheduledTask(suggestion.description); }}
                        >
                          <div className="sched-row-content">
                            <div className="sched-row-title sched-body-l">{suggestion.title}</div>
                            <div className="sched-row-subtitle sched-body-m">{suggestion.description}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
        {!narrow && (
          <div className={`sched-pane-host${isOpen ? ' is-open' : ''}`} inert={!isOpen}>
            {paneNode}
          </div>
        )}
      </div>
      {narrow && (isOpen || sheetClosing) && paneNode && createPortal(
        <div className={`sched-scope sched-pane-layer${sheetClosing ? ' is-closing' : ''}`}>{paneNode}</div>,
        document.body,
      )}
      {discard && (
        <ScheduledDialog
          title={discard === 'new' ? 'Discard new task?' : 'Discard changes?'}
          message={discard === 'new' ? 'Finish creating this task to save your progress.' : "You'll lose the changes that you've made to this task."}
          confirmLabel="Discard"
          onCancel={() => setDiscard(null)}
          onConfirm={() => {
            setDiscard(null);
            setForm(base);
            closePane();
          }}
        />
      )}
    </div>
  );
};

export default ScheduledPage;
