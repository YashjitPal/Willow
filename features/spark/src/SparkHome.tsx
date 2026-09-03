import React, { useId, useMemo, useRef, useState } from 'react';
import type { ComposerHandle } from '@willow/chat/composer/Composer';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  formatSparkRelativeTime,
  type SparkTask,
  type SparkTaskAttachment,
  type SparkTaskStatus,
  type SuggestedTask,
} from './spark-types';
import { SparkComposer } from './SparkComposer';
import { SparkTaskCard } from './SparkTaskCard';
import { SparkTaskDeleteDialog, SparkTaskRenameDialog } from './SparkTaskDialogs';
import { useSparkNow } from './useSparkNow';
import { useSparkTaskWindow } from './use-spark-task-window';
import { useAuth } from '@willow/auth/AuthContext';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';
import { sparkAccentVars } from './spark-accent';
import './SparkHome.css';

export interface SparkHomeProps {
  className?: string;
  tasks?: readonly SparkTask[];
  workspaceColor?: string;
  onSubmitTask?: (prompt: string, attachments?: SparkTaskAttachment[], tools?: string[]) => void;
  onOpenTask?: (taskId: string) => void;
  onViewAllTasks?: () => void;
  onOpenWhatsNew?: () => void;
  onSuggestedSelect?: (task: SuggestedTask) => void;
  /** Forwarded to the composer so the model picker and task execution agree. */
  modelConfig?: any;
  selectedModelId?: string;
  setSelectedModelId?: (id: string) => void;
  onRenameTask?: (taskId: string, title: string) => void;
  onTogglePinTask?: (taskId: string) => void;
  onDeleteTask?: (taskId: string) => void;
}

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

export const SparkHome: React.FC<SparkHomeProps> = ({
  className = '',
  tasks = [],
  workspaceColor,
  onSubmitTask,
  onOpenTask,
  onViewAllTasks,
  onOpenWhatsNew,
  onSuggestedSelect,
  modelConfig,
  selectedModelId,
  setSelectedModelId,
  onRenameTask,
  onTogglePinTask,
  onDeleteTask,
}) => {
  const { userProfile } = useAuth();
  const effectiveWorkspaceColor = workspaceColor || userProfile?.workspaceColor || 'green';
  const theme = getWorkspaceTheme(effectiveWorkspaceColor);
  const glowAccent = theme.glowAccent;
  const pageHeadingId = useId();
  const recentHeadingId = useId();
  const suggestedHeadingId = useId();
  const now = useSparkNow();
  const composerRef = useRef<ComposerHandle | null>(null);
  const [renameTaskId, setRenameTaskId] = useState<string | null>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const renameTask = tasks.find((task) => task.id === renameTaskId) ?? null;
  const deleteTask = tasks.find((task) => task.id === deleteTaskId) ?? null;
  const recentTasks = useMemo(() => [...tasks], [tasks]);
  const windowedTasks = useSparkTaskWindow({
    items: recentTasks,
    forcedIds: [renameTaskId ?? '', deleteTaskId ?? ''],
    estimatedRowHeight: 72,
    chunkSize: 12,
  });

  const selectSuggestedTask = (task: SuggestedTask) => {
    composerRef.current?.setPrompt(task.description);
    onSuggestedSelect?.(task);
  };

  return (
    <div
      className={`spark-home ${className}`.trim()}
      aria-labelledby={pageHeadingId}
      /* The suggested rows sit outside `.spark-composer-anchor`, so the glow
         variable declared there never reached their indicators. */
      style={sparkAccentVars(effectiveWorkspaceColor)}
    >
      <div className="spark-top-controls" aria-label="Spark release information">
        {/* `button.whats-new-badge` sits left of the Beta label in Gemini's `remy-badges`
          * row: the label, then a 4px dot. */}
        {onOpenWhatsNew && (
          <button
            type="button"
            className="spark-release-button spark-whats-new"
            onClick={onOpenWhatsNew}
          >
            <span>What&rsquo;s new</span>
            <span className="spark-release-dot" aria-hidden="true" />
          </button>
        )}
        <span className="spark-beta-label">Beta</span>
      </div>

      <div className="spark-content">
        <div className="spark-heading-block select-none">
          <h1 id={pageHeadingId} className="select-none">Put Willow Spark to work for you</h1>
        </div>

        <div
          className="spark-composer-anchor"
          style={{ '--spark-home-glow': glowAccent } as React.CSSProperties}
        >
          <SparkComposer
            composerRef={composerRef}
            onSubmitTask={onSubmitTask}
            modelConfig={modelConfig}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            workspaceColor={workspaceColor}
          />
        </div>

        {tasks.length > 0 && (
          <section className="spark-recent-section" aria-labelledby={recentHeadingId}>
            {/* Gemini's `remy-task-list .section-header` is a 32px-tall row; the
              * discovery section below uses a bare 20px label instead. */}
            <div className="spark-section-heading">
              <h2 id={recentHeadingId}>Recent</h2>
            </div>

            <div className="spark-goal-list" role="listbox" aria-label="Task list">
              {windowedTasks.map((task, index) => (
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
                  isUnread={task.hasUnreadCompletion === true}
                  isPinned={task.isPinned}
                  isNaming={task.isNaming}
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
