import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { PlusDropdownMenu } from '@willow/chat/composer/PlusDropdownMenu';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  createSparkTaskAttachments,
  deleteSparkAttachmentPayloads,
  validateSparkAttachmentFiles,
} from './attachment-storage';
import { getActiveSparkStorageScope } from './spark-store';
import { SparkMicPulseOverlay } from './SparkDictationWaveform';
import {
  formatSparkRelativeTime,
  type SparkTask,
  type SparkTaskAttachment,
  type SparkTaskStatus,
  type SuggestedTask,
} from './spark-types';
import { SparkTaskCard } from './SparkTaskCard';
import { SparkTaskDeleteDialog, SparkTaskRenameDialog } from './SparkTaskDialogs';
import { useSparkDictation } from './useSparkDictation';
import { useSparkNow } from './useSparkNow';
import { useAuth } from '@willow/auth/AuthContext';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';
import './SparkHome.css';
import { mergeSelectedFiles } from './spark-composer-chips';

export interface SparkHomeProps {
  className?: string;
  tasks?: readonly SparkTask[];
  workspaceColor?: string;
  onSubmitTask?: (prompt: string, attachments?: SparkTaskAttachment[], tools?: string[]) => void;
  onOpenTask?: (taskId: string) => void;
  onViewAllTasks?: () => void;
  onOpenWhatsNew?: () => void;
  onPlusClick?: () => void;
  onMicClick?: () => void;
  onSuggestedSelect?: (task: SuggestedTask) => void;
  onRenameTask?: (taskId: string, title: string) => void;
  onTogglePinTask?: (taskId: string) => void;
  onDeleteTask?: (taskId: string) => void;
}

const SPARK_HOME_GLOW: Record<string, string> = {
  green: 'rgb(6, 78, 59)',
  blue: 'rgb(20, 32, 79)',
  pink: 'rgb(76, 9, 35)',
  yellow: 'rgb(66, 54, 0)',
  orange: 'rgb(72, 34, 0)',
  purple: 'rgb(45, 17, 75)',
  lilac: 'rgb(62, 32, 76)',
  coral: 'rgb(78, 7, 10)',
  teal: 'rgb(0, 53, 52)',
};

export const getSparkSubmitColorClass = (color?: string) => {
  switch (color) {
    case 'blue':
      return 'bg-[#1b3f95] hover:bg-[#153277]';
    case 'pink':
      return 'bg-[#8c064b] hover:bg-[#70053c]';
    case 'yellow':
      return 'bg-[#7c6100] hover:bg-[#634e00]';
    case 'orange':
      return 'bg-[#863e00] hover:bg-[#6b3200]';
    case 'purple':
      return 'bg-[#512192] hover:bg-[#450e83]';
    case 'lilac':
      return 'bg-[#6f3c92] hover:bg-[#5f2c81]';
    case 'coral':
      return 'bg-[#900021] hover:bg-[#78001a]';
    case 'teal':
      return 'bg-[#00625c] hover:bg-[#00514c]';
    case 'green':
    default:
      return 'bg-[#127352] hover:bg-[#0d5c41]';
  }
};

/* Copy transcribed from Gemini's `remy-task-discovery`, trailing full stops and all
 * — none of the three descriptions carries one. */
const SUGGESTED_TASKS: SuggestedTask[] = [
  {
    title: 'Declutter your inbox',
    description: 'Summarise or archive newsletters and unsubscribe from email lists',
  },
  {
    title: 'Deep dive on topics',
    description: 'Pull research formatted to fit your goal, complete with cited sources',
  },
  {
    title: 'Get a custom news digest',
    description: 'Go deep on the stories that you care about and follow how they evolve',
  },
];

/**
 * How each task status presents in the row's status slot. `complete` and `cancelled`
 * deliberately map to nothing: Gemini marks those rows' pills `status-pill-hidden`,
 * which is `display: none`.
 */
const SPARK_STATUS_LABELS: Partial<Record<SparkTaskStatus, string>> = {
  queued: 'Queued',
  running: 'Running',
  'needs-input': 'Needs input',
  failed: 'Failed',
};

const SPARK_STATUS_TONES: Partial<Record<SparkTaskStatus, 'blocked' | 'failed' | 'pulse'>> = {
  queued: 'pulse',
  running: 'pulse',
  'needs-input': 'blocked',
  failed: 'failed',
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

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

export const SparkHome: React.FC<SparkHomeProps> = ({
  className = '',
  tasks = [],
  workspaceColor,
  onSubmitTask,
  onOpenTask,
  onViewAllTasks,
  onOpenWhatsNew,
  onPlusClick,
  onMicClick,
  onSuggestedSelect,
  onRenameTask,
  onTogglePinTask,
  onDeleteTask,
}) => {
  const { userProfile } = useAuth();
  const effectiveWorkspaceColor = workspaceColor || userProfile?.workspaceColor || 'green';
  const theme = getWorkspaceTheme(effectiveWorkspaceColor);
  const glowAccent = theme.glowAccent;
  const [prompt, setPrompt] = useState('');
  const [plusOpen, setPlusOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageHeadingId = useId();
  const recentHeadingId = useId();
  const suggestedHeadingId = useId();
  const now = useSparkNow();
  const {
    error: dictationError,
    isDictating,
    stopDictation,
    toggleDictation,
  } = useSparkDictation({ value: prompt, onChange: setPrompt });
  const composerError = dictationError || attachmentError;
  const hasContent = Boolean(prompt.trim() || attachedFiles.length > 0 || selectedTool);
  const previousHasContent = usePrevious(hasContent);
  const [isSubmitControlContentGated, setIsSubmitControlContentGated] = useState(false);
  const [renameTaskId, setRenameTaskId] = useState<string | null>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const renameTask = tasks.find((task) => task.id === renameTaskId) ?? null;
  const deleteTask = tasks.find((task) => task.id === deleteTaskId) ?? null;

  useEffect(() => {
    if (hasContent && !previousHasContent) {
      setIsSubmitControlContentGated(true);
    } else if (!hasContent) {
      setIsSubmitControlContentGated(false);
    }
  }, [hasContent, previousHasContent]);

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
      if (!onSubmitTask) throw new Error('Spark is not ready to create this task yet.');
      const tools = selectedTool ? [selectedTool] : [];
      onSubmitTask(nextPrompt, attachments, tools);
      setPrompt('');
      setAttachedFiles([]);
      setSelectedTool(null);
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

  const selectSuggestedTask = (task: SuggestedTask) => {
    setPrompt(task.description);
    onSuggestedSelect?.(task);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className={`spark-home ${className}`.trim()} aria-labelledby={pageHeadingId}>
      <div className="spark-top-controls" aria-label="Spark release information">
        <span className="spark-beta-label">Beta</span>
      </div>

      <div className="spark-content">
        <div className="spark-heading-block select-none">
          <h1 id={pageHeadingId} className="select-none">Put Willow Spark to work for you</h1>
        </div>

        <div
          className={`spark-composer-anchor${composerError ? ' has-error' : ''}`}
          style={{ '--spark-home-glow': glowAccent } as React.CSSProperties}
        >
          <form className="spark-composer" aria-busy={isSubmitting} onSubmit={submitPrompt}>
            <button
              ref={plusButtonRef}
              type="button"
              className="spark-composer-icon-button"
              aria-label="Upload and tools"
              title="Upload and tools"
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              disabled={isSubmitting}
              onClick={() => {
                onPlusClick?.();
                setPlusOpen((open) => !open);
              }}
            >
              <MaterialSymbol
                family="luminous"
                name="plus"
                size={24}
                weight={320}
                roundness={100}
                opticalSize={24}
              />
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

            <div className="spark-composer__input-stack">
              {(attachedFiles.length > 0 || selectedTool) && !isDictating && (
                <div className="spark-composer__context-row" aria-label="Task context">
                  {attachedFiles.length > 0 && (
                    <span className="spark-composer__context-chip">
                      <MaterialSymbol
                        family="luminous"
                        name="attach_file"
                        size={16}
                        weight={320}
                        roundness={100}
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
                        <MaterialSymbol family="luminous" name="close" size={14} weight={320} roundness={100} />
                      </button>
                    </span>
                  )}

                  {selectedTool && (
                    <span className="spark-composer__context-chip spark-composer__context-chip--tool">
                      <MaterialSymbol
                        family="luminous"
                        name="auto_awesome"
                        size={16}
                        weight={320}
                        roundness={100}
                        opticalSize={16}
                      />
                      <span>{SPARK_TOOL_LABELS[selectedTool] ?? selectedTool}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${SPARK_TOOL_LABELS[selectedTool] ?? selectedTool}`}
                        disabled={isSubmitting}
                        onClick={() => setSelectedTool(null)}
                      >
                        <MaterialSymbol family="luminous" name="close" size={14} weight={320} roundness={100} />
                      </button>
                    </span>
                  )}
                </div>
              )}

              <textarea
                ref={textareaRef}
                rows={1}
                value={prompt}
                aria-label="Enter a prompt for Gemini"
                placeholder={isDictating ? "Listening..." : "Describe a task"}
                autoComplete="off"
                spellCheck
                disabled={isSubmitting}
                aria-hidden={isDictating || undefined}
                tabIndex={isDictating ? -1 : undefined}
                className={isDictating ? 'is-dictating' : ''}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
              />
            </div>

            {hasContent && !isDictating ? (
              <button
                type="submit"
                className={`spark-composer-send-button is-${effectiveWorkspaceColor} ${isSubmitControlContentGated ? 'spark-composer-send-enter' : ''}`}
                style={{
                  '--spark-send-bg': theme.sendButton.bg,
                  '--spark-send-hover': theme.sendButton.hover,
                } as React.CSSProperties}
                aria-label="Create task"
                title={isSubmitting ? 'Preparing files' : 'Create task'}
                disabled={isSubmitting}
              >
                <MaterialSymbol
                  family="luminous"
                  name="arrow_upward"
                  size={24}
                  weight={300}
                  roundness={100}
                  opticalSize={24}
                  className="text-white"
                />
              </button>
            ) : (
              <button
                type="button"
                className={`spark-composer-icon-button spark-mic-button ${isDictating ? 'is-dictating' : ''}`}
                aria-label={isDictating ? "Stop listening" : "Microphone"}
                title={isDictating ? "Stop voice dictation" : "Microphone"}
                onClick={() => {
                  if (isDictating) {
                    stopDictation();
                  } else {
                    onMicClick?.();
                    toggleDictation();
                  }
                }}
              >
                {isDictating && <SparkMicPulseOverlay />}
                <MaterialSymbol
                  family="luminous"
                  name="mic"
                  size={24}
                  weight={300}
                  roundness={100}
                  opticalSize={24}
                />
              </button>
            )}
          </form>
          {composerError && (
            <p className="spark-composer__voice-error" role="status">{composerError}</p>
          )}
        </div>

        {tasks.length > 0 && (
          <section className="spark-recent-section" aria-labelledby={recentHeadingId}>
            {/* Gemini's `remy-task-list .section-header` is a 32px-tall row; the
              * discovery section below uses a bare 20px label instead. */}
            <div className="spark-section-heading">
              <h2 id={recentHeadingId}>Recent</h2>
            </div>

            <div className="spark-goal-list" role="listbox" aria-label="Task list">
              {tasks.map((task, index) => (
                <SparkTaskCard
                  key={task.id}
                  title={task.title}
                  description={task.description}
                  timeLabel={formatSparkRelativeTime(task.updatedAt, now) || task.time}
                  /* Gemini pulses a dot while a task runs, shows a labelled pill when
                   * it is blocked or failed, and shows nothing once it settles. */
                  statusLabel={SPARK_STATUS_LABELS[task.status]}
                  statusTone={SPARK_STATUS_TONES[task.status]}
                  descriptionIcon={task.scheduledLabel ? 'schedule' : undefined}
                  isPinned={task.isPinned}
                  isTabbable={index === 0}
                  onOpen={() => onOpenTask?.(task.id)}
                  actions={[
                    { id: 'rename', label: 'Rename', icon: 'edit', onSelect: () => setRenameTaskId(task.id) },
                    {
                      id: 'pin',
                      label: task.isPinned ? 'Unpin' : 'Pin',
                      icon: 'push_pin',
                      onSelect: () => onTogglePinTask?.(task.id),
                    },
                    { id: 'delete', label: 'Delete', icon: 'delete', onSelect: () => setDeleteTaskId(task.id) },
                  ]}
                />
              ))}
            </div>

            <button type="button" className="spark-all-tasks-button" onClick={onViewAllTasks}>
              <span>All tasks</span>
              <MaterialSymbol
                family="luminous"
                name="chevron_right"
                size={24}
                weight={300}
                roundness={100}
                opticalSize={24}
              />
            </button>
          </section>
        )}

        <section className="spark-suggested-section" aria-labelledby={suggestedHeadingId}>
          <h2 id={suggestedHeadingId} className="spark-suggested-heading">Suggested</h2>

          <div className="spark-suggested-list">
            {SUGGESTED_TASKS.map((task) => (
              <button
                key={task.title}
                type="button"
                className="spark-suggested-row"
                aria-label={`Use task: ${task.title}`}
                onClick={() => selectSuggestedTask(task)}
              >
                <span className="spark-suggested-indicator" aria-hidden="true" />
                <span className="spark-suggested-copy">
                  <span className="spark-suggested-title">{task.title}</span>
                  <span className="spark-suggested-description">{task.description}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {renameTask && (
        <SparkTaskRenameDialog
          currentTitle={renameTask.title}
          onCancel={() => setRenameTaskId(null)}
          onConfirm={(title) => {
            setRenameTaskId(null);
            onRenameTask?.(renameTask.id, title);
          }}
        />
      )}

      {deleteTask && (
        <SparkTaskDeleteDialog
          onCancel={() => setDeleteTaskId(null)}
          onConfirm={() => {
            setDeleteTaskId(null);
            onDeleteTask?.(deleteTask.id);
          }}
        />
      )}
    </div>
  );
};

export default SparkHome;
