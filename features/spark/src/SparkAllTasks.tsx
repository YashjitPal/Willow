import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PlusDropdownMenu } from '@willow/chat/composer/PlusDropdownMenu';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  createSparkTaskAttachments,
  deleteSparkAttachmentPayloads,
  validateSparkAttachmentFiles,
} from './attachment-storage';
import { getActiveSparkStorageScope } from './spark-store';
import { SparkMicPulseOverlay } from './SparkDictationWaveform';
import { formatSparkRelativeTime, type SparkTask, type SparkTaskAttachment } from './spark-types';
import { useSparkDictation } from './useSparkDictation';
import { useSparkNow } from './useSparkNow';
import './SparkAllTasks.css';
import { mergeSelectedFiles } from './spark-composer-chips';

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

const SPARK_TOOL_LABELS: Record<string, string> = {
  images: 'Create image',
  thinking: 'Thinking',
  research: 'Deep research',
  web: 'Web search',
  learn: 'Study and learn',
  canvas: 'Canvas',
  github: 'GitHub',
  quizzes: 'Quizzes',
  spotify: 'Spotify',
};

export interface SparkAllTasksProps {
  tasks: readonly SparkTask[];
  onSubmit: (prompt: string, attachments?: SparkTaskAttachment[], tools?: string[]) => void;
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
  onSubmit,
  onOpenTask,
  onRenameTask,
  onTogglePin,
  onDeleteTask,
}) => {
  const [prompt, setPrompt] = useState('');
  const [plusOpen, setPlusOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('Recent');
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [openTaskMenuId, setOpenTaskMenuId] = useState<string | null>(null);
  const [renameTaskId, setRenameTaskId] = useState<string | null>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const submitInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
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
  const headingId = useId();
  const filterMenuId = useId();
  const composerErrorId = useId();
  const {
    error: dictationError,
    isDictating,
    stopDictation,
    toggleDictation,
  } = useSparkDictation({ value: prompt, onChange: setPrompt });
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

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    if (!matchesFilter(task, filter)) return false;
    if (!normalizedSearchQuery) return true;
    return [
      task.title,
      task.description,
      task.prompt,
      task.progressLabel,
      task.scheduledLabel,
      ...(task.tools ?? []).map((tool) => SPARK_TOOL_LABELS[tool] ?? tool),
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedSearchQuery));
  }), [filter, normalizedSearchQuery, tasks]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '24px';
    const nextHeight = Math.min(120, Math.max(24, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 120 ? 'auto' : 'hidden';
  }, [prompt]);

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

  const submitPrompt = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || submitInFlightRef.current) return;

    submitInFlightRef.current = true;
    setIsSubmitting(true);
    stopDictation();
    setPlusOpen(false);
    setAttachmentError('');
    const submissionScope = getActiveSparkStorageScope();
    let attachments: SparkTaskAttachment[] = [];
    try {
      attachments = await createSparkTaskAttachments(attachedFiles, submissionScope);
      const scopeChanged = getActiveSparkStorageScope() !== submissionScope;
      if (!mountedRef.current || scopeChanged) {
        await deleteSparkAttachmentPayloads(
          attachments.map((attachment) => attachment.id),
          submissionScope,
        ).catch(() => undefined);
        if (mountedRef.current) {
          setAttachmentError('Your account changed before the task could be created. Please try again.');
        }
        return;
      }
      const tools = selectedTool ? [selectedTool] : [];
      onSubmit(nextPrompt, attachments, tools);
      setPrompt('');
      setAttachedFiles([]);
      setSelectedTool(null);
      window.requestAnimationFrame(() => {
        if (mountedRef.current) textareaRef.current?.focus();
      });
    } catch (error) {
      if (attachments.length) {
        await deleteSparkAttachmentPayloads(
          attachments.map((attachment) => attachment.id),
          submissionScope,
        ).catch(() => undefined);
      }
      if (mountedRef.current) {
        setAttachmentError(error instanceof Error
          ? error.message
          : 'One or more files could not be prepared.');
      }
    } finally {
      submitInFlightRef.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    }
  };

  return (
    <section className="spark-all-tasks" aria-labelledby={headingId}>
      <div className="spark-all-tasks__content">
        <h1 id={headingId}>Put Willow Spark to work for you</h1>

        <div className="spark-all-tasks__composer-anchor">
          <form className="spark-all-tasks__composer" aria-busy={isSubmitting} onSubmit={submitPrompt}>
            <button
              ref={plusButtonRef}
              type="button"
              className="spark-all-tasks__icon-button"
              aria-label="Add files and context"
              title="Add files and context"
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              disabled={isSubmitting}
              onClick={() => {
                setFilterOpen(false);
                setOpenTaskMenuId(null);
                setPlusOpen((open) => !open);
              }}
            >
              <MaterialSymbol {...SYMBOL_PROPS} name="plus" size={24} opticalSize={24} />
            </button>
            <PlusDropdownMenu
              isOpen={plusOpen}
              onClose={() => setPlusOpen(false)}
              onFileSelect={() => fileInputRef.current?.click()}
              buttonRef={plusButtonRef}
              onToolSelect={setSelectedTool}
              geminiStyle
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              disabled={isSubmitting}
              onChange={(event) => {
                const incoming = Array.from(event.target.files ?? []);
                const merged = mergeSelectedFiles(attachedFiles, incoming);
                try {
                  validateSparkAttachmentFiles(merged);
                  setAttachedFiles(merged);
                  setAttachmentError('');
                } catch (error) {
                  setAttachmentError(error instanceof Error
                    ? error.message
                    : 'These files could not be attached.');
                }
                event.target.value = '';
              }}
            />

            <div className="spark-all-tasks__input-stack">
              {(attachedFiles.length > 0 || selectedTool) && !isDictating && (
                <div className="spark-all-tasks__context-row" aria-label="Task context">
                  {attachedFiles.length > 0 && (
                    <span className="spark-all-tasks__context-chip">
                      <MaterialSymbol
                        {...SYMBOL_PROPS}
                        name="attach_file"
                        size={16}
                        opticalSize={16}
                      />
                      <span>
                        {`${attachedFiles[0].name}${attachedFiles.length > 1 ? ` +${attachedFiles.length - 1}` : ''}`}
                      </span>
                      <button
                        type="button"
                        aria-label="Remove attached files"
                        disabled={isSubmitting}
                        onClick={() => {
                          setAttachedFiles([]);
                          setAttachmentError('');
                        }}
                      >
                        <MaterialSymbol {...SYMBOL_PROPS} name="close" size={14} opticalSize={14} />
                      </button>
                    </span>
                  )}

                  {selectedTool && (
                    <span className="spark-all-tasks__context-chip spark-all-tasks__context-chip--tool">
                      <MaterialSymbol
                        {...SYMBOL_PROPS}
                        name="auto_awesome"
                        size={16}
                        opticalSize={16}
                      />
                      <span>{SPARK_TOOL_LABELS[selectedTool] ?? selectedTool}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${SPARK_TOOL_LABELS[selectedTool] ?? selectedTool}`}
                        disabled={isSubmitting}
                        onClick={() => setSelectedTool(null)}
                      >
                        <MaterialSymbol {...SYMBOL_PROPS} name="close" size={14} opticalSize={14} />
                      </button>
                    </span>
                  )}
                </div>
              )}

              <textarea
                ref={textareaRef}
                rows={1}
                value={prompt}
                aria-label="Describe a task for Willow Spark"
                aria-describedby={(dictationError || attachmentError) ? composerErrorId : undefined}
                placeholder={isDictating ? "Listening..." : "Describe a task"}
                autoComplete="off"
                spellCheck
                disabled={isSubmitting}
                aria-hidden={isDictating || undefined}
                tabIndex={isDictating ? -1 : undefined}
                className={isDictating ? 'is-dictating' : ''}
                onFocus={() => {
                  setFilterOpen(false);
                  setOpenTaskMenuId(null);
                }}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
              />
            </div>
            {prompt.trim() && !isDictating ? (
              <button
                type="submit"
                className="spark-all-tasks__send-button"
                aria-label="Create task"
                title={isSubmitting ? 'Preparing files' : 'Create task'}
                disabled={isSubmitting}
              >
                <MaterialSymbol {...SYMBOL_PROPS} name="arrow_upward" size={20} opticalSize={20} />
              </button>
            ) : (
              <button
                type="button"
                className={`spark-all-tasks__icon-button ${isDictating ? 'is-dictating' : ''} spark-mic-button`}
                aria-label={isDictating ? "Stop listening" : "Use voice input"}
                title={isDictating ? "Stop voice dictation" : "Use voice input"}
                disabled={isSubmitting}
                onClick={toggleDictation}
              >
                {isDictating && <SparkMicPulseOverlay />}
                <MaterialSymbol {...SYMBOL_PROPS} name="mic" size={24} opticalSize={24} />
              </button>
            )}
          </form>
        </div>
        {(dictationError || attachmentError) && (
          <p id={composerErrorId} className="spark-all-tasks__voice-error" role="alert">
            {dictationError || attachmentError}
          </p>
        )}

        <section className="spark-all-tasks__library" aria-label="Spark task list">
          <div className="spark-all-tasks__toolbar">
            <div className="spark-all-tasks__filter-control">
              <button
                ref={filterButtonRef}
                type="button"
                className="spark-all-tasks__filter-button"
                aria-label={`Filter tasks: ${filter}`}
                aria-haspopup="menu"
                aria-expanded={filterOpen}
                aria-controls={filterOpen ? filterMenuId : undefined}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  event.preventDefault();
                  setPlusOpen(false);
                  setOpenTaskMenuId(null);
                  setFilterOpen(true);
                }}
                onClick={() => {
                  setPlusOpen(false);
                  setOpenTaskMenuId(null);
                  setFilterOpen((open) => !open);
                }}
              >
                <span>{filter}</span>
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

            <div className="spark-all-tasks__search" role="search">
              <MaterialSymbol {...SYMBOL_PROPS} name="search" size={20} opticalSize={20} />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                aria-label="Search tasks"
                placeholder="Search tasks"
                autoComplete="off"
                onFocus={() => {
                  setPlusOpen(false);
                  setFilterOpen(false);
                  setOpenTaskMenuId(null);
                }}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape' || !searchQuery) return;
                  event.preventDefault();
                  setSearchQuery('');
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear task search"
                  title="Clear search"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                >
                  <MaterialSymbol {...SYMBOL_PROPS} name="close" size={18} opticalSize={18} />
                </button>
              )}
            </div>
          </div>

          <span className="spark-all-tasks__results-status" aria-live="polite">
            {`${visibleTasks.length} ${visibleTasks.length === 1 ? 'task' : 'tasks'} shown`}
          </span>

          <div className="spark-all-tasks__list" role="list" aria-label="Task list">
            {visibleTasks.map((task) => {
              const menuOpen = openTaskMenuId === task.id;
              return (
                <article
                  key={task.id}
                  role="listitem"
                  className={`spark-all-tasks__task-row${menuOpen ? ' is-menu-open' : ''}`}
                >
                  <button
                    ref={(node) => {
                      if (node) taskOpenButtonRefs.current.set(task.id, node);
                      else taskOpenButtonRefs.current.delete(task.id);
                    }}
                    type="button"
                    className="spark-all-tasks__task-open"
                    aria-label={`Open task: ${task.title}`}
                    onClick={() => {
                      setFilterOpen(false);
                      setOpenTaskMenuId(null);
                      onOpenTask(task.id);
                    }}
                  >
                    <span className="spark-all-tasks__task-copy">
                      <span className="spark-all-tasks__task-title">{task.title}</span>
                      <span className="spark-all-tasks__task-description">
                        {task.scheduledLabel && (
                          <MaterialSymbol {...SYMBOL_PROPS} name="schedule" size={16} opticalSize={16} />
                        )}
                        <span>{task.description || task.progressLabel || 'Spark task'}</span>
                      </span>
                    </span>
                    <span className="spark-all-tasks__task-meta">
                    <span className="spark-all-tasks__task-time">
                      {formatSparkRelativeTime(task.updatedAt, now) || task.time}
                    </span>
                      {task.status === 'needs-input' && (
                        <span className="spark-all-tasks__needs-input-badge">Needs input</span>
                      )}
                      {task.isPinned && (
                        <MaterialSymbol
                          {...SYMBOL_PROPS}
                          name="push_pin"
                          size={16}
                          opticalSize={16}
                          className="spark-all-tasks__pinned-icon"
                        />
                      )}
                    </span>
                  </button>
                  <button
                    ref={menuOpen ? taskMenuButtonRef : undefined}
                    type="button"
                    className="spark-all-tasks__row-menu-button"
                    aria-label={`Open actions for ${task.title}`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-controls={menuOpen ? taskMenuId : undefined}
                    title="Task actions"
                    onClick={(event) => {
                      event.stopPropagation();
                      taskMenuButtonRef.current = event.currentTarget;
                      setPlusOpen(false);
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
                  {menuOpen && (
                    <div
                      ref={taskMenuRef}
                      id={taskMenuId}
                      className="spark-all-tasks__row-menu"
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
                </article>
              );
            })}
            {/* Gemini's `.no-tasks-container` is a bordered card holding only a
              * title and a subtitle — no icon. */}
            {visibleTasks.length === 0 && (
              <div className="spark-all-tasks__empty" role="status">
                <h2>
                  {tasks.length === 0
                    ? 'No tasks yet'
                    : normalizedSearchQuery
                      ? 'No matching tasks'
                      : `No ${filter.toLocaleLowerCase()} tasks`}
                </h2>
                <p>
                  {tasks.length === 0
                    ? 'Describe a task above and Spark will keep it here.'
                    : 'Try another search or switch back to Recent.'}
                </p>
                {tasks.length > 0 && (normalizedSearchQuery || filter !== 'Recent') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
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
