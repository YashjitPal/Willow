import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { formatSparkRelativeTime, type SparkTask } from './spark-types';
import { useSparkNow } from './useSparkNow';
import { useSparkTaskWindow } from './use-spark-task-window';
import './SparkTaskDetail.css';
import './SparkAllTasks.css';

type TaskFilter = 'Recent' | 'Scheduled' | 'Needs input' | 'In progress' | 'Completed';

const TASK_FILTERS: readonly TaskFilter[] = [
  'Recent',
  'Scheduled',
  'Needs input',
  'In progress',
  'Completed',
];

const SYMBOL_PROPS = {
  family: 'luminous' as const,
  weight: 320,
  roundness: 100,
};

export interface SparkAllTasksProps {
  tasks: readonly SparkTask[];
  onOpenTask: (taskId: string) => void;
  onRenameTask: (taskId: string, title: string) => void;
  onTogglePin: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
}

const matchesFilter = (task: SparkTask, filter: TaskFilter): boolean => {
  switch (filter) {
    case 'Scheduled':
      return Boolean(task.scheduledLabel);
    case 'Needs input':
      return task.status === 'needs-input';
    case 'In progress':
      return task.status === 'queued' || task.status === 'running';
    case 'Completed':
      return task.status === 'complete';
    default:
      return true;
  }
};

export const SparkAllTasks: React.FC<SparkAllTasksProps> = ({
  tasks,
  onOpenTask,
  onRenameTask,
  onTogglePin,
  onDeleteTask,
}) => {
  const [filter, setFilter] = useState<TaskFilter>('Recent');
  const [filterOpen, setFilterOpen] = useState(false);
  const [openTaskMenuId, setOpenTaskMenuId] = useState<string | null>(null);
  const [renameTaskId, setRenameTaskId] = useState<string | null>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const taskMenuRef = useRef<HTMLDivElement>(null);
  const taskMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const renameDialogRef = useRef<HTMLFormElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteCancelButtonRef = useRef<HTMLButtonElement>(null);
  const deleteReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const taskOpenButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const taskListRef = useRef<HTMLDivElement>(null);
  const filterMenuId = useId();
  const taskMenuId = useId();
  const renameTitleId = useId();
  const deleteTitleId = useId();
  const deleteDescriptionId = useId();
  const now = useSparkNow();
  const renameTask = renameTaskId
    ? tasks.find((task) => task.id === renameTaskId)
    : undefined;
  const deleteTask = deleteTaskId
    ? tasks.find((task) => task.id === deleteTaskId)
    : undefined;

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    return matchesFilter(task, filter);
  }), [filter, tasks]);
  const windowedTasks = useSparkTaskWindow({
    items: visibleTasks,
    scrollRef: taskListRef,
    forcedIds: [openTaskMenuId ?? '', renameTaskId ?? '', deleteTaskId ?? ''],
    estimatedRowHeight: 64,
    chunkSize: 24,
  });

  useEffect(() => {
    if (!filterOpen) return;

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (filterButtonRef.current?.contains(target) || filterMenuRef.current?.contains(target)) return;
      setFilterOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setFilterOpen(false);
      window.requestAnimationFrame(() => filterButtonRef.current?.focus());
    };

    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    window.requestAnimationFrame(() => {
      filterMenuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
        ?.focus();
    });
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [filterOpen]);

  useEffect(() => {
    if (!openTaskMenuId) return;

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        taskMenuButtonRef.current?.contains(target)
        || taskMenuRef.current?.contains(target)
      ) {
        return;
      }
      setOpenTaskMenuId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const returnFocus = taskMenuButtonRef.current;
      setOpenTaskMenuId(null);
      window.requestAnimationFrame(() => returnFocus?.focus());
    };

    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    window.requestAnimationFrame(() => {
      taskMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [openTaskMenuId]);

  useEffect(() => {
    if (!openTaskMenuId || tasks.some((task) => task.id === openTaskMenuId)) return;
    setOpenTaskMenuId(null);
  }, [openTaskMenuId, tasks]);

  useEffect(() => {
    if (!renameTaskId) return;
    if (!renameTask) {
      setRenameTaskId(null);
      window.requestAnimationFrame(() => {
        const returnFocus = renameReturnFocusRef.current;
        if (returnFocus?.isConnected) returnFocus.focus();
        else filterButtonRef.current?.focus();
      });
      return;
    }
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renameTask, renameTaskId]);

  useEffect(() => {
    if (!deleteTaskId) return;
    if (!deleteTask) {
      setDeleteTaskId(null);
      window.requestAnimationFrame(() => {
        const returnFocus = deleteReturnFocusRef.current;
        if (returnFocus?.isConnected) returnFocus.focus();
        else filterButtonRef.current?.focus();
      });
      return;
    }
    window.requestAnimationFrame(() => deleteCancelButtonRef.current?.focus());
  }, [deleteTask, deleteTaskId]);

  useEffect(() => {
    if (!renameTaskId && !deleteTaskId) return;

    const dialog = renameTaskId ? renameDialogRef.current : deleteDialogRef.current;
    if (!dialog) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeRenameDialog = () => {
      setRenameTaskId(null);
      window.requestAnimationFrame(() => renameReturnFocusRef.current?.focus());
    };
    const closeDeleteDialog = () => {
      setDeleteTaskId(null);
      window.requestAnimationFrame(() => deleteReturnFocusRef.current?.focus());
    };
    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (renameTaskId) closeRenameDialog();
        else closeDeleteDialog();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('hidden'));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [deleteTaskId, renameTaskId]);

  const restoreDialogFocus = (returnFocus: HTMLButtonElement | null) => {
    window.requestAnimationFrame(() => {
      if (returnFocus?.isConnected) returnFocus.focus();
      else filterButtonRef.current?.focus();
    });
  };

  const closeRenameDialog = () => {
    setRenameTaskId(null);
    restoreDialogFocus(renameReturnFocusRef.current);
  };

  const closeDeleteDialog = () => {
    setDeleteTaskId(null);
    restoreDialogFocus(deleteReturnFocusRef.current);
  };

  const handleFilterMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    );
    if (!items.length) return;

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Home') items[0].focus();
    else if (event.key === 'End') items[items.length - 1].focus();
    else if (event.key === 'ArrowDown') items[(currentIndex + 1 + items.length) % items.length].focus();
    else items[currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length].focus();
  };

  const handleTaskMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    if (!items.length) return;

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Home') items[0].focus();
    else if (event.key === 'End') items[items.length - 1].focus();
    else if (event.key === 'ArrowDown') items[(currentIndex + 1 + items.length) % items.length].focus();
    else items[currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length].focus();
  };

  return (
    <section className="spark-all-tasks" aria-label="Spark tasks">
      <div className="spark-all-tasks__content">
        <div
          className="spark-task-detail__new-composer spark-all-tasks__composer-anchor"
          data-spark-glow-anchor
        >
          <div
            className="spark-all-tasks__composer-slot"
            data-spark-new-composer-anchor
            aria-hidden="true"
          />
        </div>

        <section className="spark-all-tasks__library" aria-label="Spark task list">
          <div className="spark-all-tasks__toolbar">
            <div className="spark-all-tasks__filter-control">
              <button
                ref={filterButtonRef}
                type="button"
                className="spark-task-detail__filter-button"
                data-spark-task-filter
                aria-label={`Filter tasks: ${filter}`}
                aria-haspopup="menu"
                aria-expanded={filterOpen}
                aria-controls={filterOpen ? filterMenuId : undefined}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  event.preventDefault();
                  setOpenTaskMenuId(null);
                  setFilterOpen(true);
                }}
                onClick={() => {
                  setOpenTaskMenuId(null);
                  setFilterOpen((open) => !open);
                }}
              >
                <span>{filter}</span>
                {/* Gemini's chevron is a 24px Luminous glyph at weight 300, roundness 100. */}
                <MaterialSymbol
                  {...SYMBOL_PROPS}
                  name="keyboard_arrow_down"
                  size={20}
                  opticalSize={20}
                />
              </button>

              {filterOpen && (
                <div
                  ref={filterMenuRef}
                  id={filterMenuId}
                  className="spark-all-tasks__filter-menu"
                  role="menu"
                  aria-label="Task filters"
                  onKeyDown={handleFilterMenuKeyDown}
                >
                  {TASK_FILTERS.map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      role="menuitemradio"
                      aria-checked={filter === candidate}
                      onClick={() => {
                        setFilter(candidate);
                        setFilterOpen(false);
                        window.requestAnimationFrame(() => filterButtonRef.current?.focus());
                      }}
                    >
                      <span className="spark-all-tasks__filter-check">
                        {filter === candidate && (
                          <MaterialSymbol {...SYMBOL_PROPS} name="check" size={18} opticalSize={18} />
                        )}
                      </span>
                      <span>{candidate}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>

          <span className="spark-all-tasks__results-status" aria-live="polite">
            {`${visibleTasks.length} ${visibleTasks.length === 1 ? 'task' : 'tasks'} shown`}
          </span>

          <div ref={taskListRef} className="spark-task-detail__recent-list" role="list" aria-label="Task list">
            {windowedTasks.map((task) => {
              const menuOpen = openTaskMenuId === task.id;
              return (
                <div
                  key={task.id}
                  role="listitem"
                  className={`spark-task-detail__task-row${task.hasUnreadCompletion ? ' is-unread' : ''}${menuOpen ? ' is-menu-open' : ''}`}
                >
                  <button
                    ref={(node) => {
                      if (node) taskOpenButtonRefs.current.set(task.id, node);
                      else taskOpenButtonRefs.current.delete(task.id);
                    }}
                    type="button"
                    className="spark-task-detail__task-open"
                    aria-label={`Open task: ${task.title}`}
                    onClick={() => {
                      setFilterOpen(false);
                      setOpenTaskMenuId(null);
                      onOpenTask(task.id);
                    }}
                  >
                    <span className="spark-task-detail__task-copy">
                      <span className="spark-task-detail__task-title">{task.title}</span>
                      <span className="spark-task-detail__task-description">
                        {task.scheduledLabel && (
                          <MaterialSymbol {...SYMBOL_PROPS} name="schedule" size={16} opticalSize={16} />
                        )}
                        <span>{task.description || task.progressLabel || 'Spark task'}</span>
                      </span>
                    </span>
                  </button>
                  <span className="spark-task-detail__task-meta">
                    <span className="spark-task-detail__task-time">
                      {formatSparkRelativeTime(task.updatedAt, now) || task.time}
                    </span>
                    {task.status === 'needs-input' && (
                      <span className="spark-task-detail__needs-input-badge">Needs input</span>
                    )}
                    {task.isPinned && (
                      <MaterialSymbol
                        {...SYMBOL_PROPS}
                        name="push_pin"
                        size={16}
                        opticalSize={16}
                        className="spark-task-detail__pinned-icon"
                      />
                    )}
                    <button
                      ref={menuOpen ? taskMenuButtonRef : undefined}
                      type="button"
                      className="spark-task-detail__row-menu-button"
                      aria-label={`Open actions for ${task.title}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      aria-controls={menuOpen ? taskMenuId : undefined}
                      title="Task actions"
                      onClick={(event) => {
                        event.stopPropagation();
                        taskMenuButtonRef.current = event.currentTarget;
                        setFilterOpen(false);
                        setOpenTaskMenuId((current) => current === task.id ? null : task.id);
                      }}
                    >
                      <MaterialSymbol
                        {...SYMBOL_PROPS}
                        name="more_vert"
                        size={20}
                        opticalSize={20}
                      />
                    </button>
                  </span>
                  {menuOpen && (
                    <div
                      ref={taskMenuRef}
                      id={taskMenuId}
                      className="spark-task-detail__list-task-menu"
                      role="menu"
                      aria-label={`Actions for ${task.title}`}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={handleTaskMenuKeyDown}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          renameReturnFocusRef.current = taskMenuButtonRef.current;
                          setOpenTaskMenuId(null);
                          setRenameDraft(task.title);
                          setRenameTaskId(task.id);
                        }}
                      >
                        <MaterialSymbol {...SYMBOL_PROPS} name="edit" size={20} opticalSize={20} />
                        <span>Rename</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          const returnFocus = taskMenuButtonRef.current;
                          setOpenTaskMenuId(null);
                          onTogglePin(task.id);
                          window.requestAnimationFrame(() => returnFocus?.focus());
                        }}
                      >
                        <MaterialSymbol {...SYMBOL_PROPS} name="push_pin" size={20} opticalSize={20} />
                        <span>{task.isPinned ? 'Unpin' : 'Pin'}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="is-danger"
                        onClick={() => {
                          deleteReturnFocusRef.current = taskMenuButtonRef.current;
                          setOpenTaskMenuId(null);
                          setDeleteTaskId(task.id);
                        }}
                      >
                        <MaterialSymbol {...SYMBOL_PROPS} name="delete" size={20} opticalSize={20} />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {/* Gemini's `.no-tasks-container` is a bordered card holding only a
              * title and a subtitle — no icon. */}
            {visibleTasks.length === 0 && (
              <div className="spark-all-tasks__empty" role="status">
                <h2>
                    {tasks.length === 0 ? 'No tasks yet' : `No ${filter.toLocaleLowerCase()} tasks`}
                </h2>
                <p>
                  {tasks.length === 0
                    ? 'Describe a task above and Spark will keep it here.'
                    : 'Try switching back to Recent.'}
                  </p>
                  {tasks.length > 0 && filter !== 'Recent' && (
                    <button
                      type="button"
                      onClick={() => {
                        setFilter('Recent');
                      window.requestAnimationFrame(() => filterButtonRef.current?.focus());
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {renameTask && (
        <div
          className="spark-all-tasks__dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeRenameDialog();
          }}
        >
          <form
            ref={renameDialogRef}
            className="spark-all-tasks__rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={renameTitleId}
            onSubmit={(event) => {
              event.preventDefault();
              const title = renameDraft.trim();
              if (!title) return;
              setRenameTaskId(null);
              onRenameTask(renameTask.id, title);
              restoreDialogFocus(renameReturnFocusRef.current);
            }}
          >
            <h2 id={renameTitleId}>Rename this thread</h2>
            <input
              ref={renameInputRef}
              value={renameDraft}
              aria-label="Task name"
              maxLength={120}
              onChange={(event) => setRenameDraft(event.target.value)}
            />
            <div className="spark-all-tasks__dialog-actions">
              <button type="button" onClick={closeRenameDialog}>Cancel</button>
              <button
                type="submit"
                disabled={!renameDraft.trim() || renameDraft.trim() === renameTask.title}
              >
                Rename
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteTask && (
        <div
          className="spark-all-tasks__dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeDeleteDialog();
          }}
        >
          <div
            ref={deleteDialogRef}
            className="spark-all-tasks__delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={deleteTitleId}
            aria-describedby={deleteDescriptionId}
          >
            {/* Gemini's copy, verbatim from its own delete dialog. */}
            <h2 id={deleteTitleId}>Delete this thread?</h2>
            <p id={deleteDescriptionId}>
              All prompts, responses and feedback will be deleted from your Willow activity, along
              with any schedules created.
            </p>
            <div className="spark-all-tasks__dialog-actions">
              <button ref={deleteCancelButtonRef} type="button" onClick={closeDeleteDialog}>Cancel</button>
              <button
                type="button"
                className="is-danger"
                onClick={() => {
                  const deletedTaskIndex = visibleTasks.findIndex((task) => task.id === deleteTask.id);
                  const nextTaskId = visibleTasks[deletedTaskIndex + 1]?.id
                    ?? visibleTasks[deletedTaskIndex - 1]?.id
                    ?? null;
                  setDeleteTaskId(null);
                  onDeleteTask(deleteTask.id);
                  window.requestAnimationFrame(() => {
                    window.requestAnimationFrame(() => {
                      const nextTaskButton = nextTaskId
                        ? taskOpenButtonRefs.current.get(nextTaskId)
                        : null;
                      if (nextTaskButton?.isConnected) nextTaskButton.focus();
                      else filterButtonRef.current?.focus();
                    });
                  });
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default SparkAllTasks;
