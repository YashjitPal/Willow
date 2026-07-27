import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { PlusDropdownMenu } from '../PlusDropdownMenu';
import { MaterialSymbol } from '../ui/MaterialSymbol';
import {
  createSparkTaskAttachments,
  deleteSparkAttachmentPayloads,
  validateSparkAttachmentFiles,
} from '../../lib/spark-attachment-storage';
import { getActiveSparkStorageScope } from '../../lib/stores/spark-store';
import { SparkDictationWaveform } from './SparkDictationWaveform';
import {
  formatSparkRelativeTime,
  type SparkTask,
  type SparkTaskAttachment,
  type TrendingTask,
} from './spark-types';
import { useSparkDictation } from './useSparkDictation';
import { useSparkNow } from './useSparkNow';
import './SparkHome.css';

export interface SparkHomeProps {
  className?: string;
  tasks?: readonly SparkTask[];
  onSubmitTask?: (prompt: string, attachments?: SparkTaskAttachment[], tools?: string[]) => void;
  onOpenTask?: (taskId: string) => void;
  onViewAllTasks?: () => void;
  onOpenWhatsNew?: () => void;
  onPlusClick?: () => void;
  onMicClick?: () => void;
  onTrendingSelect?: (task: TrendingTask) => void;
}

const TRENDING_TASKS: TrendingTask[] = [
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
    description: 'Go deep on the stories that you care about and follow how they evolve.',
  },
];

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

const mergeSelectedFiles = (current: readonly File[], incoming: readonly File[]): File[] => {
  const merged = [...current];
  const knownFiles = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
  incoming.forEach((file) => {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (knownFiles.has(key)) return;
    knownFiles.add(key);
    merged.push(file);
  });
  return merged;
};

export const SparkHome: React.FC<SparkHomeProps> = ({
  className = '',
  tasks = [],
  onSubmitTask,
  onOpenTask,
  onViewAllTasks,
  onOpenWhatsNew,
  onPlusClick,
  onMicClick,
  onTrendingSelect,
}) => {
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
  const trendingHeadingId = useId();
  const now = useSparkNow();
  const {
    error: dictationError,
    isDictating,
    stopDictation,
    toggleDictation,
  } = useSparkDictation({ value: prompt, onChange: setPrompt });
  const composerError = dictationError || attachmentError;

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

  const selectTrendingTask = (task: TrendingTask) => {
    setPrompt(task.description);
    onTrendingSelect?.(task);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className={`spark-home ${className}`.trim()} aria-labelledby={pageHeadingId}>
      <div className="spark-top-controls" aria-label="Spark release information">
        <button type="button" className="spark-release-button spark-whats-new" onClick={onOpenWhatsNew}>
          <span>What's new</span>
          <span className="spark-release-dot" aria-hidden="true" />
        </button>
        <span className="spark-beta-label">Beta</span>
      </div>

      <div className="spark-content">
        <div className="spark-heading-block">
          <h1 id={pageHeadingId}>Put Gemini Spark to work for you</h1>
        </div>

        <div className={`spark-composer-anchor${composerError ? ' has-error' : ''}`}>
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
                placeholder="Describe a task"
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

            {isDictating && <SparkDictationWaveform className="spark-composer__waveform" />}

            {isDictating ? (
              <button
                type="button"
                className="spark-composer-stop-button"
                aria-label="Stop listening"
                title="Stop voice dictation"
                onClick={stopDictation}
              >
                <span aria-hidden="true" />
              </button>
            ) : prompt.trim() ? (
              <button
                type="submit"
                className="spark-composer-send-button"
                aria-label="Create task"
                title={isSubmitting ? 'Preparing files' : 'Create task'}
                disabled={isSubmitting}
              >
                <MaterialSymbol
                  family="luminous"
                  name="arrow_upward"
                  size={20}
                  weight={320}
                  roundness={100}
                  opticalSize={20}
                />
              </button>
            ) : (
              <button
                type="button"
                className="spark-composer-icon-button spark-mic-button"
                aria-label="Microphone"
                title="Microphone"
                onClick={() => {
                  onMicClick?.();
                  toggleDictation();
                }}
              >
                <MaterialSymbol
                  family="luminous"
                  name="mic"
                  size={24}
                  weight={320}
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
            <div className="spark-section-heading">
              <h2 id={recentHeadingId}>Recent</h2>
            </div>

            <div className="spark-recent-list" role="listbox" aria-label="Task list">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="spark-task-row"
                  role="option"
                  aria-selected="false"
                  aria-label={`Open task: ${task.title}`}
                  onClick={() => onOpenTask?.(task.id)}
                >
                  <span className="spark-task-copy">
                    <span className="spark-task-title">{task.title}</span>
                    <span className="spark-task-description-line">
                      {task.status === 'needs-input' && (
                        <MaterialSymbol
                          family="luminous"
                          name="schedule"
                          size={16}
                          weight={330}
                          roundness={100}
                          opticalSize={16}
                        />
                      )}
                      <span className="spark-task-description">{task.description}</span>
                    </span>
                  </span>
                  <span className="spark-task-meta">
                    <span>{formatSparkRelativeTime(task.updatedAt, now) || task.time}</span>
                  </span>
                  {task.status === 'needs-input' && (
                    <span className="spark-task-status-pill">Needs input</span>
                  )}
                </button>
              ))}
            </div>

            <button type="button" className="spark-all-tasks-button" onClick={onViewAllTasks}>
              <span>All tasks</span>
              <MaterialSymbol
                family="luminous"
                name="chevron_right"
                size={24}
                weight={320}
                roundness={100}
                opticalSize={24}
              />
            </button>
          </section>
        )}

        <section className="spark-trending-section" aria-labelledby={trendingHeadingId}>
          <div className="spark-section-heading">
            <h2 id={trendingHeadingId}>Trending</h2>
          </div>

          <div className="spark-trending-list">
            {TRENDING_TASKS.map((task) => (
              <button
                key={task.title}
                type="button"
                className="spark-trending-row"
                aria-label={`Use task: ${task.title}`}
                onClick={() => selectTrendingTask(task)}
              >
                <span className="spark-trending-indicator" aria-hidden="true" />
                <span className="spark-trending-copy">
                  <span className="spark-trending-title">{task.title}</span>
                  <span className="spark-trending-description">{task.description}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default SparkHome;
