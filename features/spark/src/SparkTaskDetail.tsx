import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import type {
  SparkReaction,
  SparkSchedule,
  SparkTask,
  SparkActivityPhase,
  SparkActivityEntry,
  SparkTaskAttachment,
  SparkGeneratedFile,
  SparkPlanStep,
  SparkSubAgent,
} from './spark-store';
import { getActiveSparkStorageScope } from './spark-store';
import {
  createSparkTaskAttachments,
  deleteSparkAttachmentPayloads,
  validateSparkAttachmentFiles,
} from './attachment-storage';
import { PlusDropdownMenu } from '@willow/chat/composer/PlusDropdownMenu';
import { GeminiThinkingVisualizer } from '@willow/chat/GeminiThinkingVisualizer';
import { useAuth } from '@willow/auth/AuthContext';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { StreamingMarkdown } from '@willow/ui/StreamingMarkdown';
import { SparkComposer } from './SparkComposer';
import { SparkMicPulseOverlay } from './SparkDictationWaveform';
import { formatSparkRelativeTime } from './spark-types';
import { useSparkDictation } from './useSparkDictation';
import { useSparkNow } from './useSparkNow';
import './SparkTaskDetail.css';
import { SYMBOL_PROPS, mergeSelectedFiles, SparkComposerContextChip, SparkAttachmentPills } from './spark-composer-chips';
import workingAnimationTemplate from './gemini-working-animation/template.svg?raw';
import workingAnimationData from './gemini-working-animation/frames.json';
import {
  hasSparkResponseStarted,
  isSparkRootResponseStreaming,
  isSparkTurnResponseStreaming,
} from './spark-response-lifecycle';

type SparkTaskFilter = 'Recent' | 'Scheduled' | 'Needs input' | 'In progress' | 'Completed';

const TASK_FILTERS: readonly SparkTaskFilter[] = [
  'Recent',
  'Scheduled',
  'Needs input',
  'In progress',
  'Completed',
];

const updateScrollFade = (list: HTMLDivElement) => {
  list.style.setProperty('--fade-progress', list.scrollTop > 0 ? '1' : '0');
  list.style.setProperty(
    '--fade-bottom',
    list.scrollTop + list.clientHeight < list.scrollHeight ? '1' : '0',
  );
};

export interface SparkTaskDetailProps {
  task: SparkTask;
  tasks: SparkTask[];
  schedule?: SparkSchedule;
  onOpenTask: (id: string) => void;
  onCreateTask: (prompt: string, attachments?: SparkTaskAttachment[], tools?: string[]) => void;
  onBack: () => void;
  onRenameTask: (id: string, title: string) => void;
  onDeleteTask: (id: string) => void;
  onTogglePin: (id: string) => void;
  onEditMessage?: (taskId: string, turnId: string | null, prompt: string) => void;
  onSubmitFollowUp: (
    taskId: string,
    prompt: string,
    attachments?: SparkTaskAttachment[],
    tools?: string[],
  ) => boolean;
  onRespondToApproval?: (taskId: string, allowed: boolean) => void;
  onResponseReactionChange: (
    taskId: string,
    turnId: string | null,
    reaction: SparkResponseReaction,
  ) => void;
  onRetryTask: (taskId: string) => void;
  onRetryTurn: (taskId: string, turnId: string) => void;
  computerUse?: React.ReactNode;
  /** Forwarded to the composer so its model pill and task execution agree. */
  modelConfig?: any;
  selectedModelId?: string;
  setSelectedModelId?: (id: string) => void;
}

const SparkSentMessage: React.FC<{
  text: string;
  attachments?: readonly SparkTaskAttachment[];
  onEdit?: (text: string) => void;
}> = ({ text, attachments, onEdit }) => {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!editing) setDraft(text);
  }, [editing, text]);

  useEffect(() => () => {
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
  }, []);

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="spark-task-detail__sent-message">
      <SparkAttachmentPills attachments={attachments} />
      {editing ? (
        <div className="spark-task-detail__user-editor">
          <textarea
            autoFocus
            value={draft}
            aria-label="Edit message"
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setDraft(text);
                setEditing(false);
              }
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && draft.trim()) {
                event.preventDefault();
                onEdit?.(draft.trim());
                setEditing(false);
              }
            }}
          />
          <div className="spark-task-detail__user-editor-actions">
            <button
              type="button"
              onClick={() => {
                setDraft(text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="is-primary"
              disabled={!draft.trim()}
              onClick={() => {
                const nextText = draft.trim();
                if (!nextText) return;
                onEdit?.(nextText);
                setEditing(false);
              }}
            >
              Update
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="spark-task-detail__user-bubble">{text}</div>
          <div className="spark-task-detail__user-actions" aria-label="Message actions">
            <button type="button" aria-label={copied ? 'Copied' : 'Copy message'} title={copied ? 'Copied' : 'Copy'} onClick={() => void copyMessage()}>
              <MaterialSymbol {...SYMBOL_PROPS} name={copied ? 'check' : 'content_copy'} size={18} opticalSize={18} />
            </button>
            <button
              type="button"
              aria-label="Edit message"
              title="Edit"
              onClick={() => setEditing(true)}
              disabled={!onEdit}
            >
              <MaterialSymbol {...SYMBOL_PROPS} name="edit" size={18} opticalSize={18} />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const SparkAssistantResponse: React.FC<{
  text: string;
  isStreaming: boolean;
}> = ({ text, isStreaming }) => (
  <StreamingMarkdown
    text={text}
    isStreaming={isStreaming}
    animate={isStreaming}
    reveal={isStreaming}
  />
);

const GEMINI_DOCS_LOGO = 'https://www.gstatic.com/images/branding/productlogos/docs_2026/v2/web-96dp/logo_docs_2026_color_2x_web_96dp.png';

const getGeneratedFileIcon = (file: SparkGeneratedFile) => {
  const lower = file.name.toLowerCase();
  if (file.mimeType.startsWith('text/') || file.mimeType === 'application/vnd.google-apps.document' || /\.(doc|docx)$/.test(lower)) {
    return <img src={GEMINI_DOCS_LOGO} alt="" aria-hidden="true" className="spark-task-detail__generated-file-icon" />;
  }
  return (
    <span className="spark-task-detail__generated-file-icon spark-task-detail__generated-file-icon--generic" aria-hidden="true">
      <MaterialSymbol family="google-symbols" name="description" size={24} weight={320} roundness={100} opticalSize={24} />
    </span>
  );
};

const SparkGeneratedFileCard: React.FC<{
  file: SparkGeneratedFile;
  onClose: (id: string) => void;
}> = ({ file, onClose }) => (
  <div className="spark-task-detail__generated-file-wrapper">
    <div className="spark-task-detail__generated-file-card" data-test-id="spark-generated-file-card">
      <div className="spark-task-detail__generated-file-icon-container">
        {getGeneratedFileIcon(file)}
      </div>
      <div className="spark-task-detail__generated-file-text-container">
        <span className="spark-task-detail__generated-file-title" title={file.name}>{file.name}</span>
        <span className="spark-task-detail__generated-file-subtitle">
          Created {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(file.createdAt))}
        </span>
      </div>
      <button
        type="button"
        className="spark-task-detail__generated-file-close"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose(file.id);
        }}
      >
        Close
      </button>
    </div>
  </div>
);

const SparkProgressMarker: React.FC<{ complete: boolean }> = ({ complete }) => complete ? (
  <MaterialSymbol family="google-symbols" name="check" size={12} weight={400} opticalSize={12} className="spark-task-detail__progress-marker is-complete" />
) : (
  <span className="spark-task-detail__progress-marker" aria-hidden="true" />
);

const SparkProgressPlan: React.FC<{ steps: readonly SparkPlanStep[] }> = ({ steps }) => (
  <div className="spark-task-detail__progress-plan">
    {steps.map((step, index) => (
      <div key={`${index}-${step.text}`} className="spark-task-detail__progress-plan-step">
        <SparkProgressMarker complete={step.status === 'completed'} />
        <span className={step.status === 'in_progress' ? 'is-current' : undefined}>
          {step.text}
        </span>
      </div>
    ))}
  </div>
);

const taskStatus = (task: SparkTask) => task.status;

const isTaskComplete = (task: SparkTask) => taskStatus(task) === 'complete';

const needsApproval = (task: SparkTask) => taskStatus(task) === 'needs-input';

const getStatusLabel = (task: SparkTask) => {
  switch (taskStatus(task)) {
    case 'complete':
      return 'Complete';
    case 'needs-input':
      return 'Needs input';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'running':
      return 'In progress';
    case 'queued':
      return 'Queued';
    default:
      return 'Getting started';
  }
};

const isTaskActive = (task: SparkTask) =>
  taskStatus(task) === 'queued' || taskStatus(task) === 'running';

const getStatusSymbol = (task: SparkTask) => {
  switch (taskStatus(task)) {
    case 'complete':
      return 'check_circle';
    case 'needs-input':
      return 'error';
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'block';
    case 'running':
      return 'progress_activity';
    case 'queued':
      return 'schedule';
    default:
      return 'circle';
  }
};

const getTerminalResponseFallback = (task: SparkTask, isFollowUp = false) => {
  switch (taskStatus(task)) {
    case 'failed':
      return isFollowUp
        ? 'Something went wrong while working on this follow-up. You can retry it.'
        : 'Something went wrong while running this task. You can retry it.';
    case 'cancelled':
      return isFollowUp ? 'This follow-up was cancelled.' : 'This task was cancelled.';
    case 'complete':
      return isFollowUp
        ? 'This follow-up finished without returning a response.'
        : 'This task finished without returning a response.';
    default:
      return '';
  }
};

const TEXTAREA_MIN_HEIGHT = 24;
const TEXTAREA_MAX_HEIGHT = 144;

const resizeTextarea = (textarea: HTMLTextAreaElement) => {
  textarea.style.height = 'auto';
  const contentHeight = textarea.scrollHeight;
  const nextHeight = Math.min(
    TEXTAREA_MAX_HEIGHT,
    Math.max(TEXTAREA_MIN_HEIGHT, contentHeight),
  );
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = contentHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
};

const AutoSizeTextarea: React.FC<{
  value: string;
  placeholder: string;
  ariaLabel: string;
  ariaDescribedBy?: string;
  className?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  hiddenForDictation?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}> = ({
  value,
  placeholder,
  ariaLabel,
  ariaDescribedBy,
  className = '',
  inputRef,
  hiddenForDictation = false,
  disabled = false,
  onChange,
  onSubmit,
}) => {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? localRef;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    resizeTextarea(textarea);
  }, [textareaRef, value]);

  useEffect(() => {
    const resize = () => {
      if (textareaRef.current) resizeTextarea(textareaRef.current);
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [textareaRef]);

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      className={`${className}${hiddenForDictation ? ' is-dictating' : ''}`.trim()}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-hidden={hiddenForDictation || undefined}
      tabIndex={hiddenForDictation ? -1 : undefined}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck
      disabled={disabled}
      onChange={(event) => {
        resizeTextarea(event.currentTarget);
        onChange(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        onSubmit();
      }}
    />
  );
};

export type SparkResponseReaction = SparkReaction;

interface ResponseMenuPosition {
  left: number;
  top?: number;
  bottom?: number;
  placement: 'above' | 'below';
}

const LEGAL_REPORT_URL = 'https://support.google.com/legal/troubleshooter/1114905';

interface SparkThinkingPanelTarget {
  id: string;
  title: string;
  steps: string[];
  modelLabel?: string;
}

const SparkThinkingStepsPanel: React.FC<{
  target: SparkThinkingPanelTarget;
  onClose: () => void;
}> = ({ target, onClose }) => {
  const [visible, setVisible] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const dismiss = () => {
    if (closeTimerRef.current !== null) return;
    setVisible(false);
    closeTimerRef.current = window.setTimeout(onClose, 220);
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true));
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      dismiss();
    };
    document.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  return (
    <aside
      className={`spark-task-detail__thinking-panel${visible ? ' is-visible' : ''}`}
      aria-label={`Thinking steps for ${target.title}`}
    >
      <header className="spark-task-detail__thinking-header">
        <span className="spark-task-detail__thinking-header-copy">
          <strong>Thinking steps</strong>
        </span>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close thinking steps"
          title="Close"
          onClick={dismiss}
        >
          <MaterialSymbol {...SYMBOL_PROPS} name="close" size={22} opticalSize={22} />
        </button>
      </header>

      <div className="spark-task-detail__thinking-scroll">
        <ol className="spark-task-detail__thinking-timeline">
          {target.steps.map((step, index) => (
            <li key={`${target.id}-${index}-${step.slice(0, 24)}`}>
              <span className="spark-task-detail__thinking-node" aria-hidden="true" />
              <div className="spark-task-detail__thinking-step">
                <ReactMarkdown>{step}</ReactMarkdown>
              </div>
            </li>
          ))}
          <li className="is-done">
            <span className="spark-task-detail__thinking-node" aria-hidden="true">
              <MaterialSymbol
                {...SYMBOL_PROPS}
                name="check"
                size={14}
                opticalSize={14}
                weight={500}
              />
            </span>
            <div className="spark-task-detail__thinking-step">
              <strong>Done</strong>
            </div>
          </li>
          <li className="is-model-used">
            <span className="spark-task-detail__thinking-node" aria-hidden="true">
              <MaterialSymbol
                family="luminous"
                name="spark_outline"
                size={24}
                weight={300}
                roundness={100}
                opticalSize={24}
                style={{ width: 20 }}
              />
            </span>
            <div className="spark-task-detail__thinking-step">
              <strong>Used {target.modelLabel || 'Gemini'}</strong>
            </div>
          </li>
        </ol>
      </div>
    </aside>
  );
};

/**
 * Gemini's `remy-processing-state`: the collapsible step row that sits above a
 * response in the thread. Its trigger is a stable heading for the overall job;
 * expanded content contains the changing narration and tool rows.
 *
 * Measured off the live element: the trigger is 32px tall and fully rounded with
 * `padding: 0 8px`, its label is gds-body-s (13px/17px) in
 * `--lumi-sys-color--on-surface-variant`, the chevron is `expand_more` at 20px
 * weight 320, and the host carries `padding: 0 8px 8px`. Gemini's own trigger
 * computes `cursor: default`, so the affordance is the chevron rather than a
 * pointer.
 */
const SparkProcessingState: React.FC<{
  title?: string;
  activity?: readonly SparkActivityEntry[];
  phase?: SparkActivityPhase;
  subagents?: readonly SparkSubAgent[];
}> = ({ title, activity = [], phase, subagents = [] }) => {
  const timelineActivity = activity.some((entry) => entry.kind === 'subagents') || subagents.length === 0
    ? activity
    : [...activity, { id: 'spark-subagents-fallback', kind: 'subagents' as const }];
  const hasTimelineDetails = timelineActivity.length > 0;
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [isTimelineOverflowing, setIsTimelineOverflowing] = useState(false);
  const [parallelResetVersion, setParallelResetVersion] = useState(0);
  const detailsId = useId();
  const wasActiveRef = useRef(false);
  const baselineMeasuredRef = useRef(false);
  const timelineCapRef = useRef<HTMLDivElement>(null);
  const activityGroups = groupSparkActivity(timelineActivity);

  useLayoutEffect(() => {
    const active = Boolean(phase && (title || hasTimelineDetails));
    if (!active) {
      if (wasActiveRef.current) {
        setParallelResetVersion((version) => version + 1);
      }
      setIsExpanded(false);
    } else if (!wasActiveRef.current) {
      setIsExpanded(true);
    }
    wasActiveRef.current = active;
  }, [hasTimelineDetails, phase, title]);

  useLayoutEffect(() => {
    const cap = timelineCapRef.current;
    if (!cap) return;
    if (phase) {
      baselineMeasuredRef.current = false;
      setIsTimelineOverflowing(false);
      return;
    }
    if (baselineMeasuredRef.current) return;

    // Wait until the completion reset has collapsed the parallel group and its
    // children. The result is intentionally frozen so manual expansion cannot
    // make the parent timeline gain a Show all button later.
    // Subagent panels use a 200ms grid-row collapse. Measure after that
    // transition has settled so an expanded child cannot inflate the baseline.
    const timer = window.setTimeout(() => {
      setIsTimelineOverflowing(cap.scrollHeight > 272);
      baselineMeasuredRef.current = true;
    }, 240);
    return () => window.clearTimeout(timer);
  }, [activityGroups, phase, subagents]);

  useEffect(() => {
    if (phase) setShowAll(false);
  }, [phase]);

  if (!activity.length && !phase && !title && !subagents.length) return null;

  if (phase === 'queued' && subagents.length === 0) {
    return (
      <div className="spark-task-detail__pending-dots" aria-live="polite" aria-label="Starting task">
        <GeminiThinkingVisualizer />
      </div>
    );
  }

  const heading = title || 'Thinking it through…';
  const showAgentWorking = phase === 'thinking' || phase === 'planning' || phase === 'working';

  return (
    <div className="spark-task-detail__processing-state">
      {(title || hasTimelineDetails) && (
        <React.Fragment key="processing-timeline">
          <button
            type="button"
            className="spark-task-detail__processing-trigger"
            aria-expanded={isExpanded}
            aria-controls={detailsId}
            onClick={() => setIsExpanded((open) => !open)}
          >
            <span className="spark-task-detail__processing-label">{heading}</span>
            {hasTimelineDetails && <MaterialSymbol
              family="luminous"
              name="expand_more"
              size={20}
              weight={320}
              roundness={100}
              opticalSize={20}
              className={`spark-task-detail__processing-chevron${isExpanded ? ' is-expanded' : ''}`}
            />}
          </button>

          <div
            id={detailsId}
            className={`spark-task-detail__processing-details-wrapper${isExpanded ? ' is-expanded' : ''}`}
            aria-hidden={!isExpanded}
          >
            <div className="spark-task-detail__processing-details-inner">
              <div
                ref={timelineCapRef}
                className={`spark-task-detail__processing-details-cap${showAll ? ' is-expanded' : ''}${isTimelineOverflowing ? ' is-overflowing' : ''}`}
              >
                <div className="spark-task-detail__processing-details">
              {activityGroups.map((group, index) => group.kind === 'narration' ? (
                <SparkNarrationGroup
                  key={group.id}
                  entries={group.entries}
                  isFirst={index === 0}
                  isLast={index === activityGroups.length - 1}
                />
              ) : group.kind === 'subagents' ? (
                <SparkSubagentGroup
                  key={group.id}
                  agents={subagents}
                  active={Boolean(phase) || subagents.some((agent) => agent.status === 'running' || agent.status === 'queued')}
                  resetVersion={parallelResetVersion}
                  hasLeadingGap={index > 0}
                  isLast={index === activityGroups.length - 1}
                />
              ) : (
                <div
                  key={group.entry.id}
                  className={`spark-task-detail__processing-tool${index > 0 ? ' has-leading-gap' : ''}${index === activityGroups.length - 1 ? ' is-last-activity' : ''}`}
                >
                  <span className="spark-task-detail__processing-node"><SparkToolIcon tool={group.entry.tool} /></span>
                  <span>{getToolCapabilityLabel(group.entry.tool).label}</span>
                </div>
              ))}
                </div>
              </div>
              {!phase && isTimelineOverflowing && !showAll && (
                <button
                  type="button"
                  className="spark-task-detail__processing-show-more"
                  aria-expanded="false"
                  aria-controls={detailsId}
                  onClick={() => setShowAll(true)}
                >
                  Show all
                </button>
              )}
            </div>
          </div>
        </React.Fragment>
      )}
      {showAgentWorking && (
        <div
          key="agent-working"
          className={`spark-task-detail__agent-working${phase === 'thinking' ? ' is-thinking' : ''}`}
          aria-live="polite"
        >
          <SparkAgentWorkingAnimation />
          <span>{phase === 'planning' ? 'Planning…' : phase === 'working' ? 'Working on it…' : 'Thinking it through…'}</span>
        </div>
      )}
    </div>
  );
};

const SparkSubagentGroup: React.FC<{
  agents: readonly SparkSubAgent[];
  active: boolean;
  resetVersion: number;
  hasLeadingGap: boolean;
  isLast: boolean;
}> = ({ agents, active, resetVersion, hasLeadingGap, isLast }) => {
  const [expanded, setExpanded] = useState(active);
  const detailsId = useId();
  const wasActiveRef = useRef(active);
  const previousResetVersionRef = useRef(resetVersion);
  useEffect(() => {
    if (active) setExpanded(true);
    else if (wasActiveRef.current) setExpanded(false);
    wasActiveRef.current = active;
  }, [active]);

  useEffect(() => {
    if (previousResetVersionRef.current !== resetVersion) {
      setExpanded(false);
      previousResetVersionRef.current = resetVersion;
    }
  }, [resetVersion]);

  return (
    <div className={`spark-task-detail__subagent-group${hasLeadingGap ? ' has-leading-gap' : ''}${isLast ? ' is-last-activity' : ''}`}>
      <button
        type="button"
        className="spark-task-detail__subagent-header"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="spark-task-detail__subagent-header-content">
          <MaterialSymbol family="luminous" name="arrow_split" size={24} weight={320} roundness={100} opticalSize={24} />
          <span>Running tasks in parallel</span>
          <MaterialSymbol
            family="luminous"
            name="expand_more"
            size={20}
            weight={320}
            roundness={100}
            opticalSize={20}
            className={`spark-task-detail__subagent-chevron${expanded ? ' is-expanded' : ''}`}
          />
        </span>
      </button>
      <div
        id={detailsId}
        className={`spark-task-detail__subagent-content-wrapper${expanded ? ' is-expanded' : ''}`}
        aria-hidden={!expanded}
      >
        <div className="spark-task-detail__subagent-content synthetic-group">
          {agents.map((agent) => (
            <SparkSubagentItem
              key={agent.id}
              agent={agent}
              resetVersion={resetVersion}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

type SparkSubagentTimelineGroup =
  | { id: string; kind: 'narration'; entries: Extract<SparkSubAgent['timeline'][number], { kind: 'narration' }>[] }
  | { id: string; kind: 'tool'; entry: Extract<SparkSubAgent['timeline'][number], { kind: 'tool' }> };

const groupSparkSubagentTimeline = (
  timeline: readonly SparkSubAgent['timeline'][number][],
): SparkSubagentTimelineGroup[] => {
  const groups: SparkSubagentTimelineGroup[] = [];
  timeline.forEach((entry) => {
    const previous = groups.at(-1);
    if (entry.kind === 'narration') {
      if (previous?.kind === 'narration') previous.entries.push(entry);
      else groups.push({ id: entry.id, kind: 'narration', entries: [entry] });
    } else {
      groups.push({ id: entry.id, kind: 'tool', entry });
    }
  });
  return groups;
};

const SparkSubagentItem: React.FC<{
  agent: SparkSubAgent;
  resetVersion: number;
}> = ({ agent, resetVersion }) => {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [showMoreVisible, setShowMoreVisible] = useState(false);
  const detailsId = useId();
  const contentId = useId();
    const capRef = useRef<HTMLDivElement>(null);
  const previousResetVersionRef = useRef(resetVersion);
  const callsById = new Map(agent.calls.map((call) => [call.id, call]));
  const timeline = agent.timeline.length > 0
    ? agent.timeline
    : agent.calls.map((call) => ({ id: `legacy-${call.id}`, kind: 'tool' as const, callId: call.id }));
  const timelineGroups = groupSparkSubagentTimeline(timeline);

  useEffect(() => {
    if (previousResetVersionRef.current !== resetVersion) {
      setExpanded(false);
      setShowAll(false);
      previousResetVersionRef.current = resetVersion;
    }
  }, [resetVersion]);

  useLayoutEffect(() => {
    const cap = capRef.current;
    if (!cap) return;
    const update = () => {
      cap.style.setProperty('--subagent-full-height', `${cap.scrollHeight}px`);
      setIsOverflowing(cap.scrollHeight > 110);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(cap);
    Array.from(cap.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [timeline]);

  useEffect(() => {
    if (!isOverflowing) {
      setShowMoreVisible(false);
      return;
    }
    setShowMoreVisible(true);
  }, [isOverflowing]);
  return (
    <div className={`spark-task-detail__subagent-item${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="spark-task-detail__subagent-header spark-task-detail__subagent-child-header"
        aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((open) => !open)}
        >
          <span className="spark-task-detail__subagent-header-content">
            <span className="spark-task-detail__subagent-child-icon">
              <span className="spark-task-detail__subagent-bullet" />
            </span>
          <span className="spark-task-detail__subagent-title">{agent.name || agent.objective}</span>
          <MaterialSymbol
            family="luminous"
            name="expand_more"
            size={20}
            weight={320}
            roundness={100}
            opticalSize={20}
            className={`spark-task-detail__subagent-chevron${expanded ? ' is-expanded' : ''}`}
          />
        </span>
      </button>
      <div
        id={detailsId}
        className={`spark-task-detail__subagent-content-wrapper spark-task-detail__subagent-child-content${expanded ? ' is-expanded' : ''}`}
        aria-hidden={!expanded}
      >
        <div className="spark-task-detail__subagent-content group-child">
          <div className={`spark-task-detail__subagent-thought${isOverflowing ? ' is-overflowing' : ''}`}>
            <div
              ref={capRef}
              className={`spark-task-detail__subagent-thought-cap${showAll ? ' is-expanded' : ''}`}
            >
              <div id={contentId} className="spark-task-detail__subagent-details">
                {timelineGroups.map((group) => {
                  if (group.kind === 'narration') {
                    return <div className="spark-task-detail__subagent-line spark-task-detail__subagent-narration" key={group.id}>
                      <span className="spark-task-detail__subagent-line-icon" aria-hidden="true"><SparkActivityClock /></span>
                      <span className="spark-task-detail__subagent-narration-text">
                        {group.entries.map((entry) => <span key={entry.id}>{entry.text}</span>)}
                      </span>
                    </div>;
                  }
                  const call = callsById.get(group.entry.callId);
                  if (!call) return null;
                  return <div className="spark-task-detail__subagent-line" key={group.id}>
                    <span className="spark-task-detail__subagent-line-icon" aria-hidden="true"><SparkToolIcon tool={call.kind} /></span>
                    <span>{getToolCapabilityLabel(call.kind).label}</span>
                  </div>;
                })}
              </div>
            </div>
            {isOverflowing && <button
              type="button"
              className={`spark-task-detail__subagent-show-more${showMoreVisible ? ' is-visible' : ''}`}
              aria-expanded={showAll}
              aria-controls={contentId}
              onClick={() => setShowAll((open) => !open)}
            >
              {showAll ? 'Show less' : 'Show all'}
            </button>}
          </div>
        </div>
      </div>
    </div>
  );
};

const getProgressSummary = (workTitle?: string) =>
  workTitle || 'No plan available yet.';

type SparkNarrationEntry = Extract<SparkActivityEntry, { kind: 'narration' }>;
type SparkGroupedActivity =
  | { id: string; kind: 'narration'; entries: SparkNarrationEntry[] }
  | { id: string; kind: 'tool'; entry: Extract<SparkActivityEntry, { kind: 'tool' }> }
  | { id: string; kind: 'subagents' };

const groupSparkActivity = (activity: readonly SparkActivityEntry[]): SparkGroupedActivity[] => {
  const groups: SparkGroupedActivity[] = [];
  activity.forEach((entry) => {
    const last = groups.at(-1);
    if (entry.kind === 'narration') {
      if (last?.kind === 'narration') last.entries.push(entry);
      else groups.push({ id: entry.id, kind: 'narration', entries: [entry] });
      return;
    }
    if (entry.kind === 'subagents') {
      groups.push({ id: entry.id, kind: 'subagents' });
      return;
    }
    groups.push({ id: entry.id, kind: 'tool', entry });
  });
  return groups;
};

const SparkNarrationGroup: React.FC<{
  entries: readonly SparkNarrationEntry[];
  isFirst: boolean;
  isLast: boolean;
}> = ({ entries, isFirst, isLast }) => {
  return (
    <div className={`spark-task-detail__processing-thought${isFirst ? '' : ' has-leading-gap'}${isLast ? ' is-last-activity' : ''}`}>
      <div className="spark-task-detail__processing-thought-header">
        <span className="spark-task-detail__processing-node"><SparkActivityClock /></span>
        <div className="spark-task-detail__processing-thought-content">
          {entries.map((entry) => <div key={entry.id} className="spark-task-detail__processing-thought-item">{entry.text}</div>)}
        </div>
      </div>
    </div>
  );
};

const SparkAgentWorkingAnimation: React.FC = () => {
  const instanceId = useId().replaceAll(':', '');
  const rootRef = useRef<HTMLSpanElement>(null);
  const instanceTemplate = useMemo(
    () => workingAnimationTemplate.replaceAll('willow_', `willow_${instanceId}_`),
    [instanceId],
  );

  useEffect(() => {
    const svg = rootRef.current?.firstElementChild;
    if (!svg) return;
    const elements: Element[] = [];
    const visit = (element: Element) => {
      elements.push(element);
      Array.from(element.children).forEach(visit);
    };
    visit(svg);

    let animationFrame = 0;
    let intervalId: number | undefined;
    const startedAt = performance.now();
    const applyFrame = (frameIndex: number) => {
      const frame = workingAnimationData.frames[frameIndex];
      workingAnimationData.attributes.forEach(([elementIndex, name], attributeIndex) => {
        const element = elements[elementIndex];
        if (!element) return;
        const rawValue = workingAnimationData.values[frame[attributeIndex]];
        const value = rawValue === null ? null : rawValue.replaceAll('willow_', `willow_${instanceId}_`);
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
      });
    };
    let appliedFrameIndex = -1;
    const drawFrameAt = (now: number) => {
      const elapsed = (now - startedAt) % workingAnimationData.durationMs;
      let low = 0;
      let high = workingAnimationData.times.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (workingAnimationData.times[middle] <= elapsed) low = middle;
        else high = middle - 1;
      }
      if (low !== appliedFrameIndex) {
        applyFrame(low);
        appliedFrameIndex = low;
      }
    };
    const tick = (now: number) => {
      drawFrameAt(now);
      animationFrame = window.requestAnimationFrame(tick);
    };
    applyFrame(0);
    appliedFrameIndex = 0;
    animationFrame = window.requestAnimationFrame(tick);
    // Keep a timer alongside rAF. A phase label update can briefly interrupt
    // compositing; the timer advances the SVG to the next frame immediately
    // after that transition instead of leaving the first working frame static.
    intervalId = window.setInterval(() => drawFrameAt(performance.now()), 32);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [instanceId]);

  return (
    <span
      ref={rootRef}
      className="spark-task-detail__agent-working-animation"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: instanceTemplate }}
    />
  );
};

const TASK_CAPABILITY_LABELS: Record<string, { icon: string; label: string }> = {
  read: { icon: 'description', label: 'Read' },
  list: { icon: 'folder_open', label: 'List files' },
  search: { icon: 'search', label: 'Search files' },
  edit: { icon: 'edit_note', label: 'Edit file' },
  create: { icon: 'description', label: 'Create file' },
  delete: { icon: 'delete', label: 'Delete file' },
  command: { icon: 'terminal', label: 'Run command' },
  app: { icon: 'apps', label: 'Connected app' },
  mcp: { icon: 'extension', label: 'MCP tool' },
  images: { icon: 'add_photo_alternate', label: 'Create image' },
  thinking: { icon: 'lightbulb', label: 'Thinking' },
  research: { icon: 'travel_explore', label: 'Deep research' },
  /* `language` resolves in none of Willow's icon fonts; `public` is the Google
   * Symbols equivalent. */
  web: { icon: 'public', label: 'Web search' },
  learn: { icon: 'school', label: 'Study and learn' },
  canvas: { icon: 'draw', label: 'Canvas' },
  github: { icon: 'code', label: 'GitHub' },
  quizzes: { icon: 'quiz', label: 'Quizzes' },
  spotify: { icon: 'music_note', label: 'Spotify' },
  computer: { icon: 'computer', label: 'Computer' },
  web_search: { icon: 'public', label: 'Google Search' },
  code_execution: { icon: 'code', label: 'Code execution' },
};

const APP_TOOL_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  'google-calendar': 'Google Calendar',
  'google-drive': 'Google Drive',
  'google-docs': 'Google Docs',
  'google-keep': 'Google Keep',
  'google-chat': 'Google Chat',
  youtube: 'YouTube',
  spotify: 'Spotify',
  github: 'GitHub',
  contacts: 'Contacts',
  opentable: 'OpenTable',
  'google-tasks': 'Google Tasks',
};

const APP_TOOL_ICONS: Record<string, string> = {
  gmail: 'mail',
  'google-calendar': 'calendar_month',
  'google-drive': 'add_to_drive',
  'google-docs': 'description',
  youtube: 'play_circle',
  spotify: 'music_note',
  github: 'code',
  contacts: 'contacts',
  opentable: 'restaurant',
  'google-tasks': 'task_alt',
};

/* Product-logo sources captured from Gemini Spark's live tool-row DOM. Keep this
 * map limited to assets we have actually observed there; unknown/custom apps
 * continue to use the verified generic Connected-app glyph below. */
const GEMINI_APP_TOOL_LOGOS: Record<string, string> = {
  gmail: 'https://www.gstatic.com/images/branding/productlogos/gmail_2026/v2/web-96dp/logo_gmail_2026_color_2x_web_96dp.png',
  'google-docs': 'https://www.gstatic.com/images/branding/productlogos/docs_2026/v2/web-96dp/logo_docs_2026_color_2x_web_96dp.png',
  'google-drive': 'https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-96dp/logo_drive_2026_color_2x_web_96dp.png',
  'google-keep': 'https://www.gstatic.com/images/branding/productlogos/keep_2026/v2/web-96dp/logo_keep_2026_color_2x_web_96dp.png',
  contacts: 'https://www.gstatic.com/images/branding/productlogos/contacts_2022/v2/192px.svg',
  'google-chat': 'https://www.gstatic.com/images/branding/productlogos/chat_2026/v2/web-96dp/logo_chat_2026_color_2x_web_96dp.png',
};

const getToolCapabilityLabel = (tool: string): { icon: string; label: string } => {
  if (tool === 'computer') return { icon: 'monitor', label: 'Computer' };
  if (tool.startsWith('skill:')) return { icon: 'build', label: tool.slice(6) || 'Skill' };
  if (tool.startsWith('mcp:')) return { icon: 'extension', label: tool.slice(4) || 'MCP tool' };
  const known = TASK_CAPABILITY_LABELS[tool];
  if (known) return known;
  if (tool.startsWith('app:')) {
    const appId = tool.slice(4);
    const label = APP_TOOL_LABELS[appId]
      ?? appId.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    return { icon: APP_TOOL_ICONS[appId] ?? 'apps', label: label || 'App' };
  }
  const label = tool.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  return { icon: 'extension', label: label || 'Tool' };
};

const SparkActivityClock: React.FC = () => (
  <MaterialSymbol
    family="luminous"
    name="search_activity"
    size={20}
    weight={320}
    roundness={100}
    opticalSize={20}
    className="spark-task-detail__processing-clock"
  />
);

const SparkToolIcon: React.FC<{ tool: string }> = ({ tool }) => {
  const meta = getToolCapabilityLabel(tool);
  if (tool === 'web_search') {
    return (
      <img
        src="https://www.gstatic.com/images/branding/productlogos/google_search_round/v8/web-48dp/logo_google_search_round_color_1x_web_48dp.png"
        alt=""
        aria-hidden="true"
        className="spark-task-detail__google-search-icon"
      />
    );
  }
  if (tool === 'create') {
    return (
      <span className="spark-task-detail__create-file-icon" aria-hidden="true">
        <MaterialSymbol family="google-symbols" name="description" size={20} weight={320} roundness={100} opticalSize={20} />
      </span>
    );
  }
  if (tool.startsWith('app:')) {
    const appId = tool.slice(4);
    const logo = GEMINI_APP_TOOL_LOGOS[appId];
    if (logo) {
      return <img src={logo} alt="" aria-hidden="true" className="spark-task-detail__app-tool-icon" />;
    }
  }
  return <MaterialSymbol family={tool === 'list' ? 'material-rounded' : 'google-symbols'} name={meta.icon} size={20} weight={320} roundness={100} opticalSize={20} className="spark-task-detail__processing-tool-icon" />;
};

const SparkCapabilityIcon: React.FC<{ tool: string; icon: string }> = ({ tool, icon }) => {
  const logo = tool.startsWith('app:') ? GEMINI_APP_TOOL_LOGOS[tool.slice(4)] : undefined;
  if (logo) {
    return <img src={logo} alt="" aria-hidden="true" className="spark-task-detail__capability-logo" />;
  }
  return (
    <MaterialSymbol
      family="google-symbols"
      name={icon}
      size={24}
      weight={320}
      roundness={100}
      opticalSize={24}
      className="spark-task-detail__capability-icon"
    />
  );
};

const SparkResponseActions: React.FC<{
  responseText: string;
  needsInput?: boolean;
  reaction: SparkResponseReaction;
  onReactionChange: (reaction: SparkResponseReaction) => void;
  onRetry: () => void;
}> = ({
  responseText,
  needsInput = false,
  reaction,
  onReactionChange,
  onRetry,
}) => {
  const [copied, setCopied] = useState(false);
  const [menuPhase, setMenuPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const [menuPosition, setMenuPosition] = useState<ResponseMenuPosition>({
    left: 0,
    top: 0,
    placement: 'below',
  });
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const menuCloseTimerRef = useRef<number | null>(null);
  const menuId = useId();
  const menuOpen = menuPhase !== 'closed';

  const closeMenu = (restoreTriggerFocus = false) => {
    if (menuPhase === 'closed' || menuPhase === 'closing') return;
    setMenuPhase('closing');
    if (menuCloseTimerRef.current !== null) window.clearTimeout(menuCloseTimerRef.current);
    menuCloseTimerRef.current = window.setTimeout(() => {
      setMenuPhase('closed');
      menuCloseTimerRef.current = null;
    }, 125);
    if (restoreTriggerFocus) {
      window.requestAnimationFrame(() => menuTriggerRef.current?.focus());
    }
  };

  const openMenu = () => {
    const trigger = menuTriggerRef.current;
    if (!trigger) return;

    if (menuCloseTimerRef.current !== null) {
      window.clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }

    const rect = trigger.getBoundingClientRect();
    const menuWidth = 240;
    const menuHeight = 88;
    const left = Math.min(
      Math.max(8, rect.left - 8),
      Math.max(8, window.innerWidth - menuWidth - 8),
    );
    const opensAbove = rect.top >= menuHeight + 16;
    setMenuPosition(opensAbove
      ? {
          left,
          bottom: window.innerHeight - rect.top + 4,
          placement: 'above',
        }
      : {
          left,
          top: rect.bottom + 4,
          placement: 'below',
        });
    setMenuPhase('open');
  };

  useEffect(() => {
    if (menuPhase !== 'open') return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu(true);
    };
    const closeOnViewportChange = () => closeMenu();

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [menuPhase]);

  useEffect(() => () => {
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    if (menuCloseTimerRef.current !== null) window.clearTimeout(menuCloseTimerRef.current);
  }, []);

  const copyResponse = async () => {
    if (!responseText) return;
    try {
      await navigator.clipboard.writeText(responseText);
      setCopied(true);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, 1600);
    } catch {
      setCopied(false);
    }
  };

  const runMenuAction = (action: () => void) => {
    closeMenu(true);
    action();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
    <>
      <div
        className={`spark-task-detail__response-actions${needsInput ? ' is-needs-input' : ''}`}
        role="group"
        aria-label="Response actions"
      >
        <button
          type="button"
          className={reaction === 'like' ? 'is-selected' : undefined}
          aria-label="Good response"
          aria-pressed={reaction === 'like'}
          title="Good response"
          onClick={() => onReactionChange(reaction === 'like' ? null : 'like')}
        >
          <MaterialSymbol
            {...SYMBOL_PROPS}
            name="thumb_up"
            size={20}
            opticalSize={20}
            fill={reaction === 'like'}
          />
        </button>
        <button
          type="button"
          className={reaction === 'dislike' ? 'is-selected' : undefined}
          aria-label="Bad response"
          aria-pressed={reaction === 'dislike'}
          title="Bad response"
          onClick={() => onReactionChange(reaction === 'dislike' ? null : 'dislike')}
        >
          <MaterialSymbol
            {...SYMBOL_PROPS}
            name="thumb_down"
            size={20}
            opticalSize={20}
            fill={reaction === 'dislike'}
          />
        </button>
        <button
          type="button"
          aria-label={copied ? 'Copied' : 'Copy response'}
          title={copied ? 'Copied' : 'Copy'}
          onClick={() => void copyResponse()}
        >
          <MaterialSymbol
            {...SYMBOL_PROPS}
            name={copied ? 'check' : 'copy'}
            size={20}
            opticalSize={20}
            weight={copied ? 400 : SYMBOL_PROPS.weight}
          />
        </button>
        <button
          ref={menuTriggerRef}
          type="button"
          className={menuPhase === 'open' ? 'is-selected' : undefined}
          aria-label="More response options"
          aria-haspopup="menu"
          aria-expanded={menuPhase === 'open'}
          aria-controls={menuOpen ? menuId : undefined}
          title="More"
          onClick={() => menuPhase === 'open' ? closeMenu() : openMenu()}
        >
          <MaterialSymbol {...SYMBOL_PROPS} name="more_horiz" size={20} opticalSize={20} />
        </button>
      </div>

      <span className="spark-task-detail__sr-only" aria-live="polite">
        {copied ? 'Response copied' : ''}
      </span>

      {typeof document !== 'undefined' && menuOpen && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className={`spark-task-detail__response-menu opens-${menuPosition.placement}${menuPhase === 'closing' ? ' is-closing' : ''}`}
          role="menu"
          aria-label="More response options"
          style={{
            left: menuPosition.left,
            top: menuPosition.top,
            bottom: menuPosition.bottom,
          }}
          onKeyDown={handleMenuKeyDown}
        >
          <button type="button" role="menuitem" onClick={() => runMenuAction(onRetry)}>
            <span className="spark-task-detail__response-menu-icon">
              <MaterialSymbol {...SYMBOL_PROPS} name="refresh" size={20} opticalSize={20} />
            </span>
            <span>Retry</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runMenuAction(() => {
              window.open(LEGAL_REPORT_URL, '_blank', 'noopener,noreferrer');
            })}
          >
            <span className="spark-task-detail__response-menu-icon">
              <MaterialSymbol {...SYMBOL_PROPS} name="flag" size={20} opticalSize={20} />
            </span>
            <span>Report legal issue</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
};

export const SparkTaskDetail: React.FC<SparkTaskDetailProps> = ({
  task,
  tasks,
  schedule,
  onOpenTask,
  onCreateTask,
  onBack,
  onRenameTask,
  onDeleteTask,
  onTogglePin,
  onEditMessage,
  onSubmitFollowUp,
  onRespondToApproval,
  onResponseReactionChange,
  onRetryTask,
  onRetryTurn,
  computerUse,
  modelConfig,
  selectedModelId,
  setSelectedModelId,
}) => {
  const { userProfile } = useAuth();
  const taskDetailGlowAccent = getWorkspaceTheme(userProfile?.workspaceColor || 'blue').glowAccent;
  const currentTask = task;
  const followUpBlocked = isTaskActive(currentTask)
    || needsApproval(currentTask)
    || Boolean(currentTask.approval && currentTask.approvalDecision !== 'allowed');
  const recentTasks = tasks;
  const [newTaskDraft, setNewTaskDraft] = useState('');
  const [followUpDraft, setFollowUpDraft] = useState('');
  const [newTaskPlusOpen, setNewTaskPlusOpen] = useState(false);
  const [followUpPlusOpen, setFollowUpPlusOpen] = useState(false);
  const [newTaskFiles, setNewTaskFiles] = useState<File[]>([]);
  const [followUpFiles, setFollowUpFiles] = useState<File[]>([]);
  const [newTaskAttachmentError, setNewTaskAttachmentError] = useState('');
  const [followUpAttachmentError, setFollowUpAttachmentError] = useState('');
  const [isNewTaskSubmitting, setIsNewTaskSubmitting] = useState(false);
  const [isFollowUpSubmitting, setIsFollowUpSubmitting] = useState(false);
  const [newTaskTool, setNewTaskTool] = useState<string | null>(null);
  const [followUpTool, setFollowUpTool] = useState<string | null>(null);
  const [dismissedGeneratedFileIds, setDismissedGeneratedFileIds] = useState<Set<string>>(new Set());
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [thinkingPanelTarget, setThinkingPanelTarget] = useState<SparkThinkingPanelTarget | null>(null);
  const [taskFilter, setTaskFilter] = useState<SparkTaskFilter>('Recent');
  const [taskFilterOpen, setTaskFilterOpen] = useState(false);
  const [listTaskMenuTaskId, setListTaskMenuTaskId] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dialogTaskId, setDialogTaskId] = useState(currentTask.id);
  const [renameDraft, setRenameDraft] = useState(currentTask.title);
  const [displayTitle, setDisplayTitle] = useState(currentTask.title);
  const [approvalResponse, setApprovalResponse] = useState<boolean | null>(() => (
    currentTask.approvalDecision === 'allowed'
      ? true
      : currentTask.approvalDecision === 'denied'
        ? false
        : null
  ));
  const statusPanelRef = useRef<HTMLElement>(null);
  const statusPopoverRef = useRef<HTMLDivElement>(null);
  const statusButtonRef = useRef<HTMLButtonElement>(null);
  const taskFilterMenuRef = useRef<HTMLDivElement>(null);
  const taskFilterButtonRef = useRef<HTMLButtonElement>(null);
  const listTaskMenuRef = useRef<HTMLDivElement>(null);
  const listTaskMenuButtonRef = useRef<HTMLButtonElement>(null);
  const taskMenuRef = useRef<HTMLDivElement>(null);
  const taskMenuButtonRef = useRef<HTMLButtonElement>(null);
  const newTaskPlusButtonRef = useRef<HTMLButtonElement>(null);
  const followUpPlusButtonRef = useRef<HTMLButtonElement>(null);
  const newTaskSubmitInFlightRef = useRef(false);
  const followUpSubmitInFlightRef = useRef(false);
  const taskDetailActiveRef = useRef(true);
  const currentTaskIdRef = useRef(currentTask.id);
  const newTaskFileInputRef = useRef<HTMLInputElement>(null);
  const followUpFileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const followUpZoneRef = useRef<HTMLDivElement>(null);
  const recentListRef = useRef<HTMLDivElement>(null);
  const renameDialogRef = useRef<HTMLFormElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteCancelButtonRef = useRef<HTMLButtonElement>(null);
  const deleteReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const statusPanelId = useId();
  const statusPopoverId = useId();
  const taskFilterMenuId = useId();
  const listTaskMenuId = useId();
  const taskMenuId = useId();
  const statusPanelHeadingId = useId();
  const statusPopoverHeadingId = useId();
  const approvalTitleId = useId();
  /* The remote-browser pane is open by default whenever there is one, matching Gemini,
   * and the header's monitor glyph toggles it. */
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(true);
  const newTaskErrorId = useId();
  const followUpErrorId = useId();
  const renameTitleId = useId();
  const deleteTitleId = useId();
  const deleteDescriptionId = useId();
  const now = useSparkNow();
  currentTaskIdRef.current = currentTask.id;
  const newTaskDictation = useSparkDictation({ value: newTaskDraft, onChange: setNewTaskDraft });
  const followUpDictation = useSparkDictation({ value: followUpDraft, onChange: setFollowUpDraft });
  const dialogTask = recentTasks.find((candidate) => candidate.id === dialogTaskId) ?? currentTask;

  const restoreFocus = (element: HTMLButtonElement | null) => {
    window.requestAnimationFrame(() => element?.focus());
  };

  const closeRenameDialog = () => {
    setRenameOpen(false);
    restoreFocus(renameReturnFocusRef.current);
  };

  const openRenameDialog = (targetTask: SparkTask, returnFocus: HTMLButtonElement | null) => {
    renameReturnFocusRef.current = returnFocus;
    setTaskMenuOpen(false);
    setListTaskMenuTaskId(null);
    setDialogTaskId(targetTask.id);
    setRenameDraft(targetTask.title);
    setRenameOpen(true);
  };

  const closeDeleteDialog = () => {
    setDeleteOpen(false);
    restoreFocus(deleteReturnFocusRef.current);
  };

  const openDeleteDialog = (targetTask: SparkTask, returnFocus: HTMLButtonElement | null) => {
    deleteReturnFocusRef.current = returnFocus;
    setTaskMenuOpen(false);
    setListTaskMenuTaskId(null);
    setDialogTaskId(targetTask.id);
    setDeleteOpen(true);
  };

  useEffect(() => {
    taskDetailActiveRef.current = true;
    return () => {
      taskDetailActiveRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const followUpZone = followUpZoneRef.current;
    if (!panel || !followUpZone) return;

    const updateConversationInset = () => {
      const inset = Math.ceil(followUpZone.getBoundingClientRect().height + 20);
      panel.style.setProperty('--spark-followup-inset', `${inset}px`);
    };

    updateConversationInset();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateConversationInset);
      return () => {
        window.removeEventListener('resize', updateConversationInset);
        panel.style.removeProperty('--spark-followup-inset');
      };
    }

    const observer = new ResizeObserver(updateConversationInset);
    observer.observe(followUpZone);
    return () => {
      observer.disconnect();
      panel.style.removeProperty('--spark-followup-inset');
    };
  }, []);

  useEffect(() => {
    newTaskDictation.stopDictation();
    followUpDictation.stopDictation();
    setFollowUpDraft('');
    setNewTaskPlusOpen(false);
    setFollowUpPlusOpen(false);
    setFollowUpFiles([]);
    setNewTaskAttachmentError('');
    setFollowUpAttachmentError('');
    setFollowUpTool(null);
    setDismissedGeneratedFileIds(new Set());
    setStatusOpen(false);
    setTaskMenuOpen(false);
    setThinkingPanelTarget(null);
    setTaskFilterOpen(false);
    setListTaskMenuTaskId(null);
    setRenameOpen(false);
    setDeleteOpen(false);
    setDialogTaskId(currentTask.id);
    setRenameDraft(currentTask.title);
    setDisplayTitle(currentTask.title);
    setApprovalResponse(
      currentTask.approvalDecision === 'allowed'
        ? true
        : currentTask.approvalDecision === 'denied'
          ? false
          : null,
    );
  }, [currentTask.id, followUpDictation.stopDictation, newTaskDictation.stopDictation]);

  useEffect(() => {
    setRenameDraft(currentTask.title);
    setDisplayTitle(currentTask.title);
  }, [currentTask.title]);

  useEffect(() => {
    setApprovalResponse(
      currentTask.approvalDecision === 'allowed'
        ? true
        : currentTask.approvalDecision === 'denied'
          ? false
          : null,
    );
  }, [currentTask.approvalDecision, currentTask.status]);

  useEffect(() => {
    const isStatusPopoverOpen = !libraryCollapsed && statusOpen;
    if (!isStatusPopoverOpen && !taskMenuOpen && !taskFilterOpen && !listTaskMenuTaskId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        statusPopoverRef.current?.contains(target)
        || statusButtonRef.current?.contains(target)
        || taskFilterMenuRef.current?.contains(target)
        || taskFilterButtonRef.current?.contains(target)
        || listTaskMenuRef.current?.contains(target)
        || listTaskMenuButtonRef.current?.contains(target)
        || taskMenuRef.current?.contains(target)
        || taskMenuButtonRef.current?.contains(target)
      ) {
        return;
      }
      setStatusOpen(false);
      setTaskMenuOpen(false);
      setTaskFilterOpen(false);
      setListTaskMenuTaskId(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const returnFocus = listTaskMenuTaskId
        ? listTaskMenuButtonRef.current
        : taskFilterOpen
          ? taskFilterButtonRef.current
          : taskMenuOpen
            ? taskMenuButtonRef.current
            : statusButtonRef.current;
      setStatusOpen(false);
      setTaskMenuOpen(false);
      setTaskFilterOpen(false);
      setListTaskMenuTaskId(null);
      restoreFocus(returnFocus);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [libraryCollapsed, statusOpen, taskMenuOpen, taskFilterOpen, listTaskMenuTaskId]);

  useEffect(() => {
    if (libraryCollapsed || !statusOpen) return;
    const frame = window.requestAnimationFrame(() => {
      statusPopoverRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [libraryCollapsed, statusOpen]);

  useEffect(() => {
    if (!listTaskMenuTaskId) return;
    if (recentTasks.some((candidate) => candidate.id === listTaskMenuTaskId)) return;
    setListTaskMenuTaskId(null);
  }, [listTaskMenuTaskId, recentTasks]);

  useEffect(() => {
    const menu = listTaskMenuTaskId
      ? listTaskMenuRef.current
      : taskFilterOpen
        ? taskFilterMenuRef.current
        : taskMenuOpen
          ? taskMenuRef.current
          : null;
    if (!menu) return;
    const frame = window.requestAnimationFrame(() => {
      menu.querySelector<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [listTaskMenuTaskId, taskFilterOpen, taskMenuOpen]);

  useEffect(() => {
    if (!renameOpen) return;
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renameOpen]);

  useEffect(() => {
    if (!deleteOpen) return;
    window.requestAnimationFrame(() => deleteCancelButtonRef.current?.focus());
  }, [deleteOpen]);

  useEffect(() => {
    if (!renameOpen && !deleteOpen) return;

    const dialog = renameOpen ? renameDialogRef.current : deleteDialogRef.current;
    if (!dialog) return;

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (renameOpen) closeRenameDialog();
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
    return () => document.removeEventListener('keydown', handleDialogKeyDown, true);
  }, [renameOpen, deleteOpen]);

  useEffect(() => {
    if (!currentTask.turns?.length) return;
    window.requestAnimationFrame(() => {
      conversationRef.current?.scrollTo({
        top: conversationRef.current.scrollHeight,
        behavior: 'smooth',
      });
    });
  }, [currentTask.id, currentTask.turns?.length]);

  useEffect(() => {
    if (!followUpBlocked) return;
    followUpDictation.stopDictation();
    setFollowUpPlusOpen(false);
  }, [followUpBlocked, followUpDictation.stopDictation]);

  const handleTaskMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"], [role="menuitemradio"]',
    ));
    if (!items.length) return;

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Home') items[0].focus();
    else if (event.key === 'End') items[items.length - 1].focus();
    else if (event.key === 'ArrowDown') items[(currentIndex + 1 + items.length) % items.length].focus();
    else items[currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length].focus();
  };

  const toggleNewTaskDictation = () => {
    followUpDictation.stopDictation();
    newTaskDictation.toggleDictation();
  };

  const toggleFollowUpDictation = () => {
    newTaskDictation.stopDictation();
    followUpDictation.toggleDictation();
  };

  /* Takes its inputs as arguments, like `submitFollowUp` — the draft lives in the
   * composer's own state now. The scope and task guards below are unchanged. */
  const submitNewTask = async (rawPrompt: string, files: File[], tools: string[]) => {
    const prompt = rawPrompt.trim();
    if (!prompt || newTaskSubmitInFlightRef.current) return;
    newTaskSubmitInFlightRef.current = true;
    setIsNewTaskSubmitting(true);
    setNewTaskAttachmentError('');
    const submissionScope = getActiveSparkStorageScope();
    const submissionTaskId = currentTask.id;
    let attachments: SparkTaskAttachment[] = [];
    try {
      validateSparkAttachmentFiles(files);
      attachments = await createSparkTaskAttachments(files, submissionScope);
      const accountChanged = getActiveSparkStorageScope() !== submissionScope;
      const taskChanged = !taskDetailActiveRef.current
        || currentTaskIdRef.current !== submissionTaskId;
      if (accountChanged || taskChanged) {
        await deleteSparkAttachmentPayloads(
          attachments.map((attachment) => attachment.id),
          submissionScope,
        ).catch(() => undefined);
        if (!taskChanged) {
          setNewTaskAttachmentError('Your account changed before the task could be created. Please try again.');
        }
        return;
      }
      onCreateTask(prompt, attachments, tools);
      // The composer clears its own draft, attachments and tool chip on submit.
    } catch (error) {
      if (attachments.length) {
        await deleteSparkAttachmentPayloads(
          attachments.map((attachment) => attachment.id),
          submissionScope,
        ).catch(() => undefined);
      }
      if (taskDetailActiveRef.current && currentTaskIdRef.current === submissionTaskId) {
        setNewTaskAttachmentError(error instanceof Error
          ? error.message
          : 'One or more files could not be prepared.');
      }
    } finally {
      newTaskSubmitInFlightRef.current = false;
      if (taskDetailActiveRef.current) setIsNewTaskSubmitting(false);
    }
  };

  /* Takes its inputs as arguments because the draft now lives in the composer's own state —
   * see `SparkComposer`. Everything below is unchanged: the scope and task guards, the
   * `accepted` check, and the payload cleanup on every failure path. */
  const submitFollowUp = async (rawPrompt: string, files: File[], tools: string[]) => {
    const prompt = rawPrompt.trim();
    if (!prompt || followUpBlocked || followUpSubmitInFlightRef.current) return;
    followUpSubmitInFlightRef.current = true;
    setIsFollowUpSubmitting(true);
    setFollowUpAttachmentError('');
    const submissionScope = getActiveSparkStorageScope();
    const submissionTaskId = currentTask.id;
    let attachments: SparkTaskAttachment[] = [];
    try {
      validateSparkAttachmentFiles(files);
      attachments = await createSparkTaskAttachments(files, submissionScope);
      const accountChanged = getActiveSparkStorageScope() !== submissionScope;
      const taskChanged = !taskDetailActiveRef.current
        || currentTaskIdRef.current !== submissionTaskId;
      if (accountChanged || taskChanged) {
        await deleteSparkAttachmentPayloads(
          attachments.map((attachment) => attachment.id),
          submissionScope,
        ).catch(() => undefined);
        if (!taskChanged) {
          setFollowUpAttachmentError('Your account changed before the follow-up could be sent. Please try again.');
        }
        return;
      }
      const accepted = onSubmitFollowUp(
        submissionTaskId,
        prompt,
        attachments,
        tools,
      );
      if (!accepted) {
        await deleteSparkAttachmentPayloads(
          attachments.map((attachment) => attachment.id),
          submissionScope,
        ).catch(() => undefined);
        if (taskDetailActiveRef.current && currentTaskIdRef.current === submissionTaskId) {
          setFollowUpAttachmentError('The follow-up could not be started. Please try again.');
        }
        return;
      }
      // The composer clears its own draft, attachments and tool chip on submit.
    } catch (error) {
      if (attachments.length) {
        await deleteSparkAttachmentPayloads(
          attachments.map((attachment) => attachment.id),
          submissionScope,
        ).catch(() => undefined);
      }
      if (taskDetailActiveRef.current && currentTaskIdRef.current === submissionTaskId) {
        setFollowUpAttachmentError(error instanceof Error
          ? error.message
          : 'One or more files could not be prepared.');
      }
    } finally {
      followUpSubmitInFlightRef.current = false;
      if (taskDetailActiveRef.current) setIsFollowUpSubmitting(false);
    }
  };

  const saveRename = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = renameDraft.trim();
    if (!title) return;
    if (dialogTask.id === currentTask.id) setDisplayTitle(title);
    setRenameOpen(false);
    onRenameTask(dialogTask.id, title);
    restoreFocus(renameReturnFocusRef.current);
  };

  const respondToApproval = (allowed: boolean) => {
    if (!onRespondToApproval) return;
    onRespondToApproval(currentTask.id, allowed);
    setApprovalResponse(allowed);
  };

  const scheduledHeading = schedule?.title || currentTask.scheduledLabel || 'Scheduled run';
  const scheduledTime = currentTask.scheduledTime || currentTask.time || 'Today';
  const approval = currentTask.approval;
  const approvalTitle = approval?.title || 'Let Gemini interact with websites for you?';
  const approvalDescription = approval?.description
    || 'To work on your tasks, Gemini will need to use a browser:';
  const approvalPlan = approval?.prompt || currentTask.prompt || 'Continue this task using a browser.';
  const terminalResponseFallback = getTerminalResponseFallback(currentTask);
  const response = currentTask.response
    || (needsApproval(currentTask)
      ? 'I need your approval before I can continue with this task.'
      : terminalResponseFallback);
  const hasVisibleResponse = Boolean(response);
  const rootResponseStreaming = isSparkRootResponseStreaming(currentTask);
  const currentProcessingTools = (currentTask.usedTools ?? currentTask.tools ?? [])
    .filter((tool) => tool !== 'thinking')
    .map(getToolCapabilityLabel)
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.label === entry.label) === index);
  const hasProcessingState = Boolean(currentTask.activityTitle || currentTask.activityPhase)
    || (currentTask.activityLog?.length ?? 0) > 0
    || (currentTask.subagents?.length ?? 0) > 0
    || currentProcessingTools.length > 0;
  const hasRootResponseActions = needsApproval(currentTask) || (
    Boolean(response) && ['complete', 'failed', 'cancelled'].includes(taskStatus(currentTask))
  );
  const generatedFiles = Array.from(new Map([
    ...(currentTask.generatedFiles ?? []),
    ...(currentTask.turns ?? []).flatMap((turn) => turn.generatedFiles ?? []),
  ].map((file) => [file.path, file])).values());
  const rootGeneratedFiles = (currentTask.generatedFiles ?? [])
    .filter((file) => !dismissedGeneratedFileIds.has(file.id));
  const latestWorkTitle = [...(currentTask.turns ?? [])]
    .reverse()
    .find((turn) => turn.activityTitle)?.activityTitle
    || currentTask.activityTitle;
  const latestPlan = currentTask.plan?.length
    ? currentTask.plan
    : [...(currentTask.turns ?? [])].reverse().find((turn) => turn.plan?.length)?.plan ?? [];
  const usedCapabilityTools = Array.from(new Set([
    ...(currentTask.usedTools ?? []),
    ...(currentTask.turns ?? []).flatMap((turn) => turn.usedTools ?? []),
  ])).filter((tool) => tool === 'computer'
    || tool.startsWith('app:')
    || tool.startsWith('mcp:')
    || tool.startsWith('skill:'));
  const taskCapabilities = usedCapabilityTools
    .map((tool) => ({ tool, ...getToolCapabilityLabel(tool) }))
    .filter((capability) => capability.label !== 'Tool');
  const uniqueTaskCapabilities = Array.from(
    new Map(taskCapabilities.map((capability) => [capability.label, capability])).values(),
  );
  const followUpPlaceholder = needsApproval(currentTask)
    ? 'Respond above to continue'
    : isTaskActive(currentTask)
      ? 'Wait for Spark to finish'
      : currentTask.approval && currentTask.approvalDecision !== 'allowed'
        ? 'Browser access is required to continue'
        : 'What can we do next?';
  const filteredTasks = useMemo(() => recentTasks.filter((recentTask) => {
    switch (taskFilter) {
      case 'Scheduled':
        return Boolean(recentTask.scheduledLabel);
      case 'Needs input':
        return needsApproval(recentTask);
      case 'In progress':
        return isTaskActive(recentTask);
      case 'Completed':
        return isTaskComplete(recentTask);
      default:
        return true;
    }
  }), [recentTasks, taskFilter]);

  useLayoutEffect(() => {
    const list = recentListRef.current;
    if (!list) return;

    const updateFade = () => updateScrollFade(list);
    updateFade();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateFade);
      return () => window.removeEventListener('resize', updateFade);
    }

    const observer = new ResizeObserver(updateFade);
    observer.observe(list);
    return () => observer.disconnect();
  }, [filteredTasks, libraryCollapsed]);

  useLayoutEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;

    const updateFade = () => updateScrollFade(conversation);
    updateFade();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateFade);
      return () => window.removeEventListener('resize', updateFade);
    }

    const observer = new ResizeObserver(updateFade);
    observer.observe(conversation);
    const content = conversation.firstElementChild;
    if (content instanceof HTMLElement) observer.observe(content);
    return () => observer.disconnect();
  }, [
    currentTask.id,
    currentTask.response,
    currentTask.status,
    currentTask.activityLog?.length,
    currentTask.subagents?.length,
    currentTask.turns?.length,
    currentTask.generatedFiles?.length,
    libraryCollapsed,
  ]);

  const isLibraryCollapsed = libraryCollapsed;
  const isProgressPanelOpen = isLibraryCollapsed;
  const isStatusPopoverOpen = !isLibraryCollapsed && statusOpen;

  return (
    <div
      className={`spark-task-detail${isLibraryCollapsed ? ' is-library-collapsed' : ''}${isProgressPanelOpen ? ' is-progress-open' : ''}${computerUse ? ' has-computer-use' : ''}`}
      style={{ '--spark-task-detail-accent': taskDetailGlowAccent } as React.CSSProperties}
    >
      <aside
        className="spark-task-detail__library"
        aria-label="Spark tasks"
        aria-hidden={isLibraryCollapsed || undefined}
        inert={isLibraryCollapsed || undefined}
      >
        <div className="spark-task-detail__library-inner">
          <div className="spark-task-detail__new-composer">
            <SparkComposer
              onSubmitFiles={submitNewTask}
              disabled={isNewTaskSubmitting}
              modelConfig={modelConfig}
              selectedModelId={selectedModelId}
              setSelectedModelId={setSelectedModelId}
            />
            {newTaskAttachmentError && (
              <p id={newTaskErrorId} className="spark-task-detail__composer-error" role="alert">
                {newTaskAttachmentError}
              </p>
            )}
          </div>

          <section className="spark-task-detail__recent" aria-label="Spark task list">
            <button
              ref={taskFilterButtonRef}
              type="button"
              className="spark-task-detail__filter-button"
              aria-haspopup="menu"
              aria-expanded={taskFilterOpen}
              aria-controls={taskFilterMenuId}
              onClick={() => {
                setStatusOpen(false);
                setTaskMenuOpen(false);
                setListTaskMenuTaskId(null);
                setNewTaskPlusOpen(false);
                setTaskFilterOpen((open) => !open);
              }}
            >
              <span>{taskFilter}</span>
              <MaterialSymbol {...SYMBOL_PROPS} name="keyboard_arrow_down" size={20} opticalSize={20} />
            </button>
            {taskFilterOpen && (
              <div
                ref={taskFilterMenuRef}
                id={taskFilterMenuId}
                className="spark-task-detail__filter-menu"
                role="menu"
                onKeyDown={handleTaskMenuKeyDown}
              >
                {TASK_FILTERS.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    role="menuitemradio"
                    aria-checked={taskFilter === filter}
                    onClick={() => {
                      setTaskFilter(filter);
                      setTaskFilterOpen(false);
                      restoreFocus(taskFilterButtonRef.current);
                    }}
                  >
                    <span className="spark-task-detail__filter-check">
                      {taskFilter === filter && (
                        <MaterialSymbol {...SYMBOL_PROPS} name="check" size={18} opticalSize={18} />
                      )}
                    </span>
                    <span>{filter}</span>
                  </button>
                ))}
              </div>
            )}
            <div
              ref={recentListRef}
              className="spark-task-detail__recent-list"
              role="list"
              aria-label="Task list"
              onScroll={(event) => updateScrollFade(event.currentTarget)}
            >
              {filteredTasks.map((recentTask) => {
                const selected = recentTask.id === currentTask.id;
                const menuOpen = listTaskMenuTaskId === recentTask.id;
                return (
                  <div
                    key={recentTask.id}
                    role="listitem"
                    className={`spark-task-detail__task-row${selected ? ' is-selected' : ''}${recentTask.hasUnreadCompletion ? ' is-unread' : ''}${menuOpen ? ' is-menu-open' : ''}`}
                  >
                    <button
                      type="button"
                      className="spark-task-detail__task-open"
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => onOpenTask(recentTask.id)}
                    >
                      <span className="spark-task-detail__task-copy">
                        <span className="spark-task-detail__task-title">{recentTask.title}</span>
                        <span className="spark-task-detail__task-description">
                          {recentTask.scheduledLabel && (
                            <MaterialSymbol {...SYMBOL_PROPS} name="schedule" size={16} opticalSize={16} />
                          )}
                          <span>{recentTask.description || recentTask.progressLabel || 'Spark task'}</span>
                        </span>
                      </span>
                    </button>
                    <span className="spark-task-detail__task-meta">
                      <span className="spark-task-detail__task-time">
                        {formatSparkRelativeTime(recentTask.updatedAt, now) || recentTask.time}
                      </span>
                      {needsApproval(recentTask) && (
                        <span className="spark-task-detail__needs-input-badge">Needs input</span>
                      )}
                      {recentTask.isPinned && (
                        <MaterialSymbol
                          {...SYMBOL_PROPS}
                          name="push_pin"
                          size={16}
                          opticalSize={16}
                          className="spark-task-detail__pinned-icon"
                        />
                      )}
                      <button
                        type="button"
                        className="spark-task-detail__row-menu-button"
                        aria-label={`Open actions for ${recentTask.title}`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-controls={menuOpen ? listTaskMenuId : undefined}
                        onClick={(event) => {
                          listTaskMenuButtonRef.current = event.currentTarget;
                          setTaskFilterOpen(false);
                          setStatusOpen(false);
                          setTaskMenuOpen(false);
                          setListTaskMenuTaskId((openTaskId) => (
                            openTaskId === recentTask.id ? null : recentTask.id
                          ));
                        }}
                      >
                        <MaterialSymbol {...SYMBOL_PROPS} name="more_vert" size={20} opticalSize={20} />
                      </button>
                    </span>
                    {menuOpen && (
                      <div
                        ref={listTaskMenuRef}
                        id={listTaskMenuId}
                        className="spark-task-detail__list-task-menu"
                        role="menu"
                        aria-label={`Actions for ${recentTask.title}`}
                        onKeyDown={handleTaskMenuKeyDown}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => openRenameDialog(recentTask, listTaskMenuButtonRef.current)}
                        >
                          <MaterialSymbol {...SYMBOL_PROPS} name="edit" size={20} opticalSize={20} />
                          <span>Rename</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            const returnFocus = listTaskMenuButtonRef.current;
                            setListTaskMenuTaskId(null);
                            onTogglePin(recentTask.id);
                            restoreFocus(returnFocus);
                          }}
                        >
                          <MaterialSymbol {...SYMBOL_PROPS} name="push_pin" size={20} opticalSize={20} />
                          <span>{recentTask.isPinned ? 'Unpin' : 'Pin'}</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="is-danger"
                          onClick={() => openDeleteDialog(recentTask, listTaskMenuButtonRef.current)}
                        >
                          <MaterialSymbol {...SYMBOL_PROPS} name="delete" size={20} opticalSize={20} />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {!filteredTasks.length && (
                <p className="spark-task-detail__empty-list">
                  No {taskFilter === 'Recent' ? '' : `${taskFilter.toLowerCase()} `}tasks yet.
                </p>
              )}
            </div>
          </section>
        </div>
      </aside>

      <main className="spark-task-detail__workspace">
        <div className="spark-task-detail__library-divider">
          <button
            type="button"
            aria-label={isLibraryCollapsed ? 'Show task list' : 'Hide task list'}
            aria-expanded={!isLibraryCollapsed}
            title=""
            onClick={() => {
              setStatusOpen(false);
              setLibraryCollapsed((collapsed) => !collapsed);
            }}
          >
            <MaterialSymbol
              family="google-symbols"
              name={isLibraryCollapsed ? 'keyboard_arrow_right' : 'keyboard_arrow_left'}
              size={16}
              weight={400}
              opticalSize={20}
            />
          </button>
        </div>

        <section ref={panelRef} className="spark-task-detail__panel" aria-label={`Task: ${displayTitle}`}>
          <header className="spark-task-detail__header">
            <button
              type="button"
              className="spark-task-detail__header-icon spark-task-detail__mobile-back"
              aria-label="Back to Spark"
              title="Back"
              onClick={onBack}
            >
              <MaterialSymbol {...SYMBOL_PROPS} name="arrow_back" size={20} opticalSize={20} />
            </button>
            <h1 className="spark-task-detail__header-title" title={displayTitle}>{displayTitle}</h1>
            <div className="spark-task-detail__header-actions">
              <span className="spark-task-detail__beta-pill">Beta</span>

              {/* Gemini puts a `monitor` glyph here (16px, weight 330, #c4c7c5) that
                * shows and hides the remote-browser pane. */}
              {computerUse && (
                <button
                  type="button"
                  className={`spark-task-detail__header-icon${isSidePanelOpen ? ' is-open' : ''}`}
                  aria-label={isSidePanelOpen ? 'Hide remote browser' : 'Show remote browser'}
                  aria-pressed={isSidePanelOpen}
                  title={isSidePanelOpen ? 'Hide remote browser' : 'Show remote browser'}
                  onClick={() => setIsSidePanelOpen((open) => !open)}
                >
                  {/* `monitor` is absent from Willow's Luminous subset (probed: 140px
                    * advance at 20px, i.e. the ligature fails); Google Symbols has it. */}
                  <MaterialSymbol
                    family="google-symbols"
                    name="monitor"
                    size={16}
                    weight={330}
                    roundness={100}
                    opticalSize={16}
                  />
                </button>
              )}
              <span className={`spark-task-detail__status-pill-wrapper${isProgressPanelOpen ? ' is-hidden' : ''}`}>
                <button
                  ref={statusButtonRef}
                  type="button"
                  className={`spark-task-detail__status-pill${isStatusPopoverOpen ? ' is-open' : ''}`}
                  aria-label={getStatusLabel(currentTask)}
                  aria-haspopup="dialog"
                  aria-expanded={isStatusPopoverOpen}
                  aria-controls={isStatusPopoverOpen ? statusPopoverId : undefined}
                  onClick={() => {
                    setTaskMenuOpen(false);
                    setTaskFilterOpen(false);
                    setListTaskMenuTaskId(null);
                    setNewTaskPlusOpen(false);
                    setFollowUpPlusOpen(false);
                    setStatusOpen((open) => !open);
                  }}
                >
                  <MaterialSymbol
                    {...SYMBOL_PROPS}
                    name={getStatusSymbol(currentTask)}
                    size={16}
                    opticalSize={16}
                    className={`spark-task-detail__status-symbol${isTaskActive(currentTask) ? ' is-running' : ''}`}
                  />
                  <span>{getStatusLabel(currentTask)}</span>
                  <MaterialSymbol {...SYMBOL_PROPS} name="expand_more" size={18} opticalSize={18} />
                </button>
              </span>
              <button
                ref={taskMenuButtonRef}
                type="button"
                className={`spark-task-detail__header-icon${taskMenuOpen ? ' is-open' : ''}`}
                aria-label="Task options"
                title="More"
                aria-haspopup="menu"
                aria-expanded={taskMenuOpen}
                aria-controls={taskMenuOpen ? taskMenuId : undefined}
                onClick={() => {
                  setStatusOpen(false);
                  setTaskFilterOpen(false);
                  setListTaskMenuTaskId(null);
                  setNewTaskPlusOpen(false);
                  setFollowUpPlusOpen(false);
                  setTaskMenuOpen((open) => !open);
                }}
              >
                <MaterialSymbol {...SYMBOL_PROPS} name="more_vert" size={20} opticalSize={20} />
              </button>
            </div>
          </header>

          {isStatusPopoverOpen && (
            <div
              ref={statusPopoverRef}
              id={statusPopoverId}
              className="spark-task-detail__progress-popover"
              role="dialog"
              aria-label="Task progress"
              aria-labelledby={statusPopoverHeadingId}
              tabIndex={-1}
            >
              <h2 id={statusPopoverHeadingId} className="spark-task-detail__popover-heading">Progress</h2>
              <div className="spark-task-detail__progress-summary">
                {latestPlan.length ? <SparkProgressPlan steps={latestPlan} /> : (
                  <>
                    {latestWorkTitle && <SparkProgressMarker complete={isTaskComplete(currentTask)} />}
                    <span>{getProgressSummary(latestWorkTitle)}</span>
                  </>
                )}
              </div>

              <section className="spark-task-detail__popover-group spark-task-detail__popover-files">
                <h2>Files</h2>
                {generatedFiles.length ? (
                  <div className="spark-task-detail__popover-file-list">
                    {generatedFiles.map((file) => (
                      <div key={file.id} className="spark-task-detail__popover-file">
                        {getGeneratedFileIcon(file)}
                        <span>{file.name}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="spark-task-detail__popover-group spark-task-detail__popover-capabilities">
                <h2>Skills and apps</h2>
                {uniqueTaskCapabilities.map((capability) => (
                  <div key={capability.label} className="spark-task-detail__popover-capability">
                    <SparkCapabilityIcon tool={capability.tool} icon={capability.icon} />
                    <span>{capability.label}</span>
                  </div>
                ))}
              </section>
            </div>
          )}

          {taskMenuOpen && (
            <div
              ref={taskMenuRef}
              id={taskMenuId}
              className="spark-task-detail__task-menu"
              role="menu"
              aria-label={`Actions for ${currentTask.title}`}
              onKeyDown={handleTaskMenuKeyDown}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => openRenameDialog(currentTask, taskMenuButtonRef.current)}
              >
                <MaterialSymbol {...SYMBOL_PROPS} name="edit" size={20} opticalSize={20} />
                <span>Rename</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const returnFocus = taskMenuButtonRef.current;
                  setTaskMenuOpen(false);
                  onTogglePin(currentTask.id);
                  restoreFocus(returnFocus);
                }}
              >
                <MaterialSymbol {...SYMBOL_PROPS} name="push_pin" size={20} opticalSize={20} />
                <span>{currentTask.isPinned ? 'Unpin' : 'Pin'}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => openDeleteDialog(currentTask, taskMenuButtonRef.current)}
              >
                <MaterialSymbol {...SYMBOL_PROPS} name="delete" size={20} opticalSize={20} />
                <span>Delete</span>
              </button>
              <div className="spark-task-detail__menu-divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setTaskMenuOpen(false);
                  onBack();
                }}
              >
                <MaterialSymbol {...SYMBOL_PROPS} name="close" size={20} opticalSize={20} />
                <span>Close</span>
              </button>
            </div>
          )}

          <div
            ref={conversationRef}
            className="spark-task-detail__conversation-scroll gemini-chat-scrollbar"
            onScroll={(event) => updateScrollFade(event.currentTarget)}
          >
            <div className="spark-task-detail__conversation">
              {!!currentTask.prompt && (!needsApproval(currentTask) || !currentTask.scheduledLabel) && (
                <div className="spark-task-detail__user-row">
                  <SparkSentMessage
                    text={currentTask.prompt}
                    attachments={currentTask.attachments}
                    onEdit={onEditMessage
                      ? (prompt) => onEditMessage(currentTask.id, null, prompt)
                      : undefined}
                  />
                </div>
              )}

              <article
                className={`spark-task-detail__assistant-turn${needsApproval(currentTask) ? ' is-needs-input' : ''}${isTaskActive(currentTask) ? ' is-active' : ''}`}
                aria-label="Spark response"
                aria-busy={isTaskActive(currentTask)}
              >
                {needsApproval(currentTask) && (schedule || currentTask.scheduledLabel || currentTask.scheduledTime) && (
                  <div className="spark-task-detail__schedule-label">
                    <MaterialSymbol {...SYMBOL_PROPS} name="schedule" size={16} opticalSize={16} />
                    <span>{scheduledHeading}</span>
                    <span aria-hidden="true">&middot;</span>
                    <span>{scheduledTime}</span>
                  </div>
                )}

                {(((isTaskActive(currentTask) && !currentTask.response) && !hasProcessingState) || needsApproval(currentTask)) && (
                  <div className="spark-task-detail__working-row" aria-live="polite">
                    {!needsApproval(currentTask) && (
                      <MaterialSymbol
                        {...SYMBOL_PROPS}
                        name="progress_activity"
                        size={20}
                        opticalSize={20}
                      />
                    )}
                    <span>{currentTask.progressLabel || (needsApproval(currentTask) ? 'Waiting for your approval' : 'Working on your task')}</span>
                    {needsApproval(currentTask) && (
                      <MaterialSymbol {...SYMBOL_PROPS} name="chevron_right" size={18} opticalSize={18} />
                    )}
                  </div>
                )}

                {/* Gemini shows the processing state inline above the response, not
                  * behind an overflow menu. */}
                {hasProcessingState && (
                  <SparkProcessingState
                    key={`task-processing-${currentTask.id}`}
                    title={currentTask.activityTitle}
                    activity={currentTask.activityLog ?? []}
                    subagents={currentTask.subagents ?? []}
                    phase={hasSparkResponseStarted(currentTask.response) ? undefined : currentTask.activityPhase}
                  />
                )}

                {(hasVisibleResponse || rootResponseStreaming) && (
                  <div
                    className="spark-task-detail__assistant-response"
                    aria-live={rootResponseStreaming ? 'polite' : undefined}
                  >
                    <SparkAssistantResponse
                      text={response}
                      isStreaming={rootResponseStreaming}
                    />
                  </div>
                )}

                {rootGeneratedFiles.map((file) => (
                  <SparkGeneratedFileCard
                    key={file.id}
                    file={file}
                    onClose={(id) => setDismissedGeneratedFileIds((ids) => new Set([...ids, id]))}
                  />
                ))}

                {needsApproval(currentTask) && approvalResponse === null && (
                  <section className="spark-task-detail__approval-card" aria-labelledby={approvalTitleId}>
                    <h3 id={approvalTitleId}>{approvalTitle}</h3>
                    <div className="spark-task-detail__approval-body">
                      <p>{approvalDescription}</p>
                      <ul>
                        <li>Gemini may make mistakes, including unexpected data sharing. Supervise sensitive tasks.</li>
                        <li>
                          <a
                            href="https://support.google.com/gemini/answer/16596215"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Review risks
                          </a>{' '}
                          and manage browser data in Willow Spark Settings.
                        </li>
                      </ul>
                      <p className="spark-task-detail__approval-plan-heading">
                        <strong>Review the plan based on your task and context</strong>
                      </p>
                    </div>
                    <div className="spark-task-detail__approval-plan">
                      <p>{approvalPlan}</p>
                    </div>
                    <div className="spark-task-detail__approval-actions">
                      <button
                        type="button"
                        disabled={!onRespondToApproval}
                        onClick={() => respondToApproval(false)}
                      >
                        Don&apos;t allow
                      </button>
                      <button
                        type="button"
                        className="is-primary"
                        disabled={!onRespondToApproval}
                        onClick={() => respondToApproval(true)}
                      >
                        Allow
                      </button>
                    </div>
                  </section>
                )}

                {approvalResponse !== null && (
                  <div className="spark-task-detail__approval-result" aria-live="polite">
                    <MaterialSymbol
                      {...SYMBOL_PROPS}
                      name={approvalResponse ? 'check_circle' : 'block'}
                      size={20}
                      opticalSize={20}
                    />
                    <span>{approvalResponse ? 'Allowed. Spark can continue this task.' : 'Action not allowed.'}</span>
                  </div>
                )}

                {hasRootResponseActions && (
                  <SparkResponseActions
                    key={`task-response-${currentTask.id}`}
                    responseText={response}
                    needsInput={needsApproval(currentTask)}
                    reaction={currentTask.reaction ?? null}
                    onReactionChange={(reaction) => {
                      onResponseReactionChange(currentTask.id, null, reaction);
                    }}
                    onRetry={() => onRetryTask(currentTask.id)}
                  />
                )}
              </article>

              {(currentTask.turns ?? []).map((turn, index, turns) => {
                const isLatestTurn = index === turns.length - 1;
                const turnIsStreaming = isSparkTurnResponseStreaming(currentTask, turn);
                const turnIsPending = isLatestTurn
                  && (turnIsStreaming || needsApproval(currentTask));
                const turnFallback = turnIsPending ? '' : getTerminalResponseFallback(currentTask, true);
                const turnResponse = turn.response || turnFallback;
                return (
                  <React.Fragment key={turn.id}>
                    <div className="spark-task-detail__user-row spark-task-detail__local-turn">
                      <SparkSentMessage
                        text={turn.prompt}
                        attachments={turn.attachments}
                        onEdit={onEditMessage
                          ? (prompt) => onEditMessage(currentTask.id, turn.id, prompt)
                          : undefined}
                      />
                    </div>
                    <article
                      className={`spark-task-detail__assistant-turn spark-task-detail__local-response${turnIsPending ? ' is-active' : ''}`}
                      aria-label="Spark follow-up response"
                      aria-busy={turnIsPending}
                    >
                      {((turn.activityLog?.length ?? 0) > 0 || (turn.subagents?.length ?? 0) > 0 || turn.activityPhase || turn.activityTitle || turnIsPending) && (
                        <SparkProcessingState
                          key={`turn-processing-${turn.id}`}
                          title={turn.activityTitle}
                          activity={turn.activityLog ?? []}
                          subagents={turn.subagents ?? []}
                          phase={hasSparkResponseStarted(turn.response)
                            ? undefined
                            : turn.activityPhase ?? (turnIsStreaming ? 'queued' : undefined)}
                        />
                      )}
                      {(turnResponse || turnIsStreaming) && (
                        <div
                          className="spark-task-detail__assistant-response"
                          aria-live={turnIsStreaming ? 'polite' : undefined}
                        >
                          <SparkAssistantResponse
                            text={turnResponse}
                            isStreaming={turnIsStreaming}
                          />
                        </div>
                      )}
                      {(turn.generatedFiles ?? [])
                        .filter((file) => !dismissedGeneratedFileIds.has(file.id))
                        .map((file) => (
                          <SparkGeneratedFileCard
                            key={file.id}
                            file={file}
                            onClose={(id) => setDismissedGeneratedFileIds((ids) => new Set([...ids, id]))}
                          />
                        ))}
                      {turnResponse && !turnIsPending && (
                        <SparkResponseActions
                          responseText={turnResponse}
                          reaction={turn.reaction ?? null}
                          onReactionChange={(reaction) => {
                            onResponseReactionChange(currentTask.id, turn.id, reaction);
                          }}
                          onRetry={() => onRetryTurn(currentTask.id, turn.id)}
                        />
                      )}
                      {!turnResponse && needsApproval(currentTask) && (
                        <div className="spark-task-detail__working-row" aria-live="polite">
                          <span>Waiting for your approval</span>
                        </div>
                      )}
                    </article>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div ref={followUpZoneRef} className="spark-task-detail__followup-zone">
            <div className="spark-task-detail__followup-composer">
              <SparkComposer
                onSubmitFiles={submitFollowUp}
                // Gemini will not take a follow-up while the task is still working, so the
                // whole box locks rather than the send button alone.
                disabled={isFollowUpSubmitting || followUpBlocked}
                placeholder={followUpPlaceholder}
                modelConfig={modelConfig}
                selectedModelId={selectedModelId}
                setSelectedModelId={setSelectedModelId}
              />
              {followUpAttachmentError && (
                <p id={followUpErrorId} className="spark-task-detail__composer-error" role="alert">
                  {followUpAttachmentError}
                </p>
              )}
            </div>
            <p className="spark-task-detail__disclaimer">Gemini is AI and can make mistakes.</p>
          </div>

          {thinkingPanelTarget && (
            <SparkThinkingStepsPanel
              key={thinkingPanelTarget.id}
              target={thinkingPanelTarget}
              onClose={() => setThinkingPanelTarget(null)}
            />
          )}

          {renameOpen && (
            <div
              className="spark-task-detail__dialog-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) closeRenameDialog();
              }}
            >
              <form
                ref={renameDialogRef}
                className="spark-task-detail__rename-dialog"
                onSubmit={saveRename}
                role="dialog"
                aria-modal="true"
                aria-labelledby={renameTitleId}
              >
                <h2 id={renameTitleId}>Rename this thread</h2>
                <input
                  ref={renameInputRef}
                  value={renameDraft}
                  aria-label="Thread name"
                  onChange={(event) => setRenameDraft(event.target.value)}
                />
                <div className="spark-task-detail__rename-actions">
                  <button type="button" onClick={closeRenameDialog}>Cancel</button>
                  <button type="submit" disabled={!renameDraft.trim()}>Rename</button>
                </div>
              </form>
            </div>
          )}

          {deleteOpen && (
            <div
              className="spark-task-detail__dialog-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) closeDeleteDialog();
              }}
            >
              <div
                ref={deleteDialogRef}
                className="spark-task-detail__delete-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={deleteTitleId}
                aria-describedby={deleteDescriptionId}
              >
                {/* Gemini's copy, verbatim from its own delete dialog. */}
                <h2 id={deleteTitleId}>Delete this thread?</h2>
                <p id={deleteDescriptionId}>
                  All prompts, responses and feedback will be deleted from your Willow activity,
                  along with any schedules created.
                </p>
                <div className="spark-task-detail__delete-actions">
                  <button ref={deleteCancelButtonRef} type="button" onClick={closeDeleteDialog}>Cancel</button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => {
                      setDeleteOpen(false);
                      onDeleteTask(dialogTask.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside
          ref={statusPanelRef}
          id={statusPanelId}
          className={`spark-task-detail__progress-panel${isProgressPanelOpen ? ' is-open' : ''}`}
          aria-hidden={!isProgressPanelOpen}
          aria-labelledby={statusPanelHeadingId}
          inert={!isProgressPanelOpen || undefined}
          tabIndex={-1}
        >
          <div className="spark-task-detail__progress-panel-scroll">
            <section className="spark-task-detail__progress-panel-section">
              <div className="spark-task-detail__progress-panel-header is-static">
                <span className="spark-task-detail__progress-panel-title-wrapper">
                  <span id={statusPanelHeadingId} className="spark-task-detail__progress-panel-title">Progress</span>
                </span>
              </div>
              <div className="spark-task-detail__progress-panel-content">
                <div className="spark-task-detail__progress-panel-summary">
                  {latestPlan.length ? <SparkProgressPlan steps={latestPlan} /> : (
                    <>
                      {latestWorkTitle && <SparkProgressMarker complete={isTaskComplete(currentTask)} />}
                      <span>{getProgressSummary(latestWorkTitle)}</span>
                    </>
                  )}
                </div>
              </div>
            </section>

            <section className="spark-task-detail__progress-panel-section">
              <div className="spark-task-detail__progress-panel-header is-empty">
                <span className="spark-task-detail__progress-panel-title-wrapper">
                  <span className="spark-task-detail__progress-panel-title">Files</span>
                </span>
              </div>
              {generatedFiles.length > 0 && (
                <div className="spark-task-detail__progress-panel-content">
                  <div className="spark-task-detail__progress-panel-file-list">
                    {generatedFiles.map((file) => (
                      <div key={file.id} className="spark-task-detail__progress-panel-file">
                        {getGeneratedFileIcon(file)}
                        <span>{file.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="spark-task-detail__progress-panel-section">
              <div className="spark-task-detail__progress-panel-header is-empty">
                <span className="spark-task-detail__progress-panel-title-wrapper">
                  <span className="spark-task-detail__progress-panel-title">Skills &amp; apps</span>
                </span>
              </div>
              {uniqueTaskCapabilities.length > 0 && (
                <div className="spark-task-detail__progress-panel-content">
                  {uniqueTaskCapabilities.map((capability) => (
                    <div key={capability.label} className="spark-task-detail__progress-panel-capability">
                      <SparkCapabilityIcon tool={capability.tool} icon={capability.icon} />
                      <span>{capability.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </aside>

        {/*
          * Gemini's `remy-side-panel`: a second rounded card beside the chat pane
          * rather than a block inside the thread. Measured in the split view at
          * 567.1×809.6 against a 285.1px chat pane, both #1f1f1f at 28px corners with
          * an 8px gutter between them.
          */}
        {computerUse && isSidePanelOpen && !isProgressPanelOpen && (
          <section className="spark-task-detail__side-panel" aria-label="Remote browser">
            {computerUse}
          </section>
        )}
      </main>
    </div>
  );
};

export default SparkTaskDetail;
