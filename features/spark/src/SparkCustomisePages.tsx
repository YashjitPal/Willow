import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import type {
  SparkConnectedAppId,
  SparkCustomApp,
  SparkSchedule,
  SparkSkill,
} from './spark-types';
import { formatSparkRelativeTime } from './spark-types';
import { formatSparkScheduleTime } from './SparkScheduleEditor';
import { useSparkNow } from './useSparkNow';
import { useSparkAccentVars } from './spark-accent';
import type { RecommendedSkill } from './spark-recommended-skills';
import { SparkMcpSection } from './SparkMcpSection';
import './SparkCustomisePages.css';

const formatScheduleRunLabel = (schedule: SparkSchedule, now: number): string | undefined => {
  if (schedule.lastRunLabel === 'Running...' || schedule.lastRunLabel === 'Waiting for approval') {
    return schedule.lastRunLabel;
  }
  if (!schedule.lastRunAt) return schedule.lastRunLabel;
  const relativeTime = formatSparkRelativeTime(schedule.lastRunAt, now);
  if (schedule.lastRunLabel === 'Failed' || schedule.lastRunLabel === 'Skipped') {
    return `${schedule.lastRunLabel} \u00b7 ${relativeTime}`;
  }
  return `Last run ${relativeTime}`;
};

/** Mount one viewport of user-owned rows, then append another viewport as the
 * user scrolls. The full records remain in Spark's store, so opening a row can
 * still resolve its complete editor without another UI-wide render. */
const useIncrementalRows = (
  total: number,
  rowHeight: number,
): [number, React.RefCallback<HTMLDivElement>, React.RefObject<HTMLDivElement | null>] => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const viewportBatch = useCallback(() => {
    if (typeof window === 'undefined') return 8;
    const listTop = container?.getBoundingClientRect().top ?? 0;
    const availableHeight = Math.max(rowHeight, window.innerHeight - Math.max(0, listTop));
    return Math.max(1, Math.ceil(availableHeight / rowHeight) + 1);
  }, [container, rowHeight]);
  const [visibleCount, setVisibleCount] = useState(1);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    setVisibleCount((current) => Math.min(total, Math.max(current, viewportBatch())));
  }, [total, viewportBatch]);

  useEffect(() => {
    const resize = () => setVisibleCount((current) => Math.min(total, Math.max(current, viewportBatch())));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [total, viewportBatch]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= total || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisibleCount((current) => Math.min(total, current + viewportBatch()));
    }, { root: null, rootMargin: '0px 0px 240px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [total, visibleCount, viewportBatch]);

  return [visibleCount, setContainer, sentinelRef];
};

interface SparkToggleProps {
  checked: boolean;
  className?: string;
  label: string;
  onChange: () => void;
}

const SparkToggle: React.FC<SparkToggleProps> = ({ checked, className = '', label, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={`spark-app-toggle${checked ? ' spark-app-toggle--checked' : ''} ${className}`.trim()}
    onClick={onChange}
  >
    <span className="spark-app-toggle__thumb" />
  </button>
);

interface SparkPreferenceControlProps {
  appName: string;
  checked: boolean;
  className?: string;
  onChange: () => void;
}

/* Gemini's `.opt-in-container` holds the logo and a bare `mat-slide-toggle` — no visible
 * caption. The switch's accessible name carries what the caption used to say. */
const SparkPreferenceControl: React.FC<SparkPreferenceControlProps> = ({
  appName,
  checked,
  className = '',
  onChange,
}) => (
  <SparkToggle
    checked={checked}
    className={className}
    label={`${checked ? 'Stop using' : 'Use'} ${appName} as preference context`}
    onChange={onChange}
  />
);

interface SparkRowActionMenuProps {
  deleteLabel: string;
  menuLabel: string;
  onDelete: () => void;
  onSecondaryAction?: () => void;
  secondaryIcon?: string;
  secondaryLabel?: string;
  items?: readonly SparkRowActionMenuItem[];
}

interface SparkRowActionMenuItem {
  dividerBefore?: boolean;
  icon: string;
  iconFamily?: 'luminous' | 'google-symbols';
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

const SparkRowActionMenu: React.FC<SparkRowActionMenuProps> = ({
  deleteLabel,
  menuLabel,
  onDelete,
  onSecondaryAction,
  secondaryIcon,
  secondaryLabel,
  items: customItems,
}) => {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties>();
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const hasSecondaryAction = Boolean(onSecondaryAction && secondaryIcon && secondaryLabel);
  const defaultItems: readonly SparkRowActionMenuItem[] = [
    ...(hasSecondaryAction ? [{
      icon: secondaryIcon!,
      label: secondaryLabel!,
      onSelect: onSecondaryAction!,
    }] : []),
    { icon: 'delete', label: deleteLabel, onSelect: onDelete, danger: true },
  ];
  const items = customItems ?? defaultItems;
  const menuItemCount = items.length;

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = 186.538;
    setMenuPosition({
      top: rect.bottom + 10,
      left: Math.max(8, rect.left),
      width,
    });
  }, []);

  const finishClose = useCallback((restoreFocus = false) => {
    closeTimerRef.current = null;
    setOpen(false);
    setClosing(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const requestClose = useCallback((restoreFocus = false) => {
    if (!open || closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => finishClose(restoreFocus), 125);
  }, [closing, finishClose, open]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;

    const positionFrame = window.requestAnimationFrame(positionMenu);
    const focusFrame = window.requestAnimationFrame(() => menuItemRefs.current[0]?.focus());

    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !popoverRef.current?.contains(target)) requestClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      requestClose(true);
    };

    document.addEventListener('pointerdown', closeOnOutsidePress);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.cancelAnimationFrame(positionFrame);
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open, positionMenu, requestClose]);

  const handleMenuItemKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Tab') {
      requestClose();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? menuItemCount - 1
        : event.key === 'ArrowDown'
          ? (index + 1) % menuItemCount
          : (index - 1 + menuItemCount) % menuItemCount;
    menuItemRefs.current[nextIndex]?.focus();
  };

  return (
    <div ref={menuRef} className="spark-row-action-menu">
      <button
        ref={triggerRef}
        type="button"
        className="spark-row-action-menu__trigger"
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) requestClose();
          else {
            positionMenu();
            setClosing(false);
            setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          positionMenu();
          setClosing(false);
          setOpen(true);
        }}
      >
        <MaterialSymbol family="luminous" name="more_horiz" size={20} weight={320} roundness={100} />
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          id={menuId}
          className={`spark-row-action-menu__popover${closing ? ' is-closing' : ''}`}
          role="menu"
          aria-label={menuLabel}
          style={menuPosition}
        >
          {items.map((item, index) => (
            <React.Fragment key={`${item.label}-${index}`}>
              {item.dividerBefore && <div className="spark-row-action-menu__divider" role="separator" />}
              <button
                ref={(element) => { menuItemRefs.current[index] = element; }}
                type="button"
                role="menuitem"
                className={item.danger ? 'is-danger' : undefined}
                onKeyDown={(event) => handleMenuItemKeyDown(event, index)}
                onClick={() => {
                  requestClose();
                  item.onSelect();
                }}
              >
                <MaterialSymbol
                  family={item.iconFamily ?? 'luminous'}
                  name={item.icon}
                  size={20}
                  weight={320}
                  roundness={100}
                />
                <span>{item.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
};

interface SparkDeleteDialogProps {
  itemName: string;
  itemType: 'custom app' | 'schedule' | 'skill';
  onCancel: () => void;
  onConfirm: () => void;
}

const SparkDeleteDialog: React.FC<SparkDeleteDialogProps> = ({ itemName, itemType, onCancel, onConfirm }) => {
  const headingId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKeys);
    return () => {
      window.removeEventListener('keydown', handleDialogKeys);
      window.requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, []);

  return (
    <div
      className="spark-customise-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="spark-customise-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <h2 id={headingId}>Delete {itemType}?</h2>
        <p id={descriptionId}>&ldquo;{itemName}&rdquo; will be permanently removed.</p>
        <div className="spark-customise-delete-dialog__actions">
          <button type="button" autoFocus onClick={onCancel}>Cancel</button>
          <button type="button" className="is-danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
};

interface SparkPageBaseProps {
  className?: string;
  onLearnMore?: () => void;
  onCreateWithGemini?: () => void;
  onCreateManually?: () => void;
}

interface SparkListSkeletonProps {
  heading: string;
  className: string;
}

const SparkListSkeleton: React.FC<SparkListSkeletonProps> = ({ className, heading }) => (
  <section className={`spark-customise-loading-section ${className}`.trim()} aria-busy="true">
    <h2>{heading}</h2>
    <div className="spark-customise-loading-list" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <span key={row} className="spark-customise-loading-row">
          <span className="spark-customise-loading-row-content">
            <span className="spark-customise-loading-bar spark-customise-loading-bar--short">
              <span className="spark-customise-loading-bar-fill" />
            </span>
            <span className="spark-customise-loading-bar">
              <span className="spark-customise-loading-bar-fill" />
            </span>
          </span>
        </span>
      ))}
    </div>
  </section>
);

interface SparkPageHeaderProps {
  description: string;
  headingId: string;
  onLearnMore?: () => void;
  title: string;
}

const SparkPageHeader: React.FC<SparkPageHeaderProps> = ({
  description,
  headingId,
  onLearnMore,
  title,
}) => (
  <header className="spark-customise-header">
    <h1 id={headingId}>{title}</h1>
    <p>
      {description}
      {onLearnMore && (
        <>
          {' '}
          <button type="button" className="spark-inline-link" onClick={onLearnMore}>
            Learn more
          </button>
        </>
      )}
    </p>
  </header>
);

interface SparkActionButtonProps {
  children: React.ReactNode;
  icon: string;
  onClick?: () => void;
  primary?: boolean;
}

/**
 * Which icon font a glyph comes from is per-glyph, not guessable from the name.
 * Gemini serves `edit_rectangle` from Luminous Symbols and `edit_note` from Google
 * Symbols — both at 24px, weight 300. A `startsWith('edit_')` heuristic sent both to
 * Material Symbols Rounded, which has neither glyph, so the ligature never formed
 * and the literal string painted instead, clipped to the icon box ("ec", "t r").
 */
const SPARK_ACTION_ICON_FAMILY: Record<string, 'luminous' | 'google-symbols'> = {
  edit_rectangle: 'luminous',
  edit_note: 'google-symbols',
};

const SparkActionButton: React.FC<SparkActionButtonProps> = ({
  children,
  icon,
  onClick,
  primary = false,
}) => (
  <button
    type="button"
    className={`spark-page-action${primary ? ' spark-page-action--primary' : ''}`}
    disabled={!onClick}
    onClick={onClick}
  >
    <MaterialSymbol
      family={SPARK_ACTION_ICON_FAMILY[icon] ?? 'luminous'}
      name={icon}
      size={24}
      weight={300}
      roundness={100}
      opticalSize={24}
    />
    <span>{children}</span>
  </button>
);

export interface SchedulesPageProps extends SparkPageBaseProps {
  isLoading?: boolean;
  schedules: readonly SparkSchedule[];
  onDeleteSchedule: (scheduleId: string) => void;
  onOpenSchedule: (scheduleId: string) => void;
  onScheduleEnabledChange: (scheduleId: string, enabled: boolean) => void;
}

export const SchedulesPage: React.FC<SchedulesPageProps> = ({
  className = '',
  onCreateManually,
  onCreateWithGemini,
  onDeleteSchedule,
  onLearnMore,
  onOpenSchedule,
  onScheduleEnabledChange,
  schedules,
  isLoading = false,
}) => {
  const headingId = useId();
  const ongoingHeadingId = useId();
  const now = useSparkNow();
  const accentVars = useSparkAccentVars();
  const [scheduleToDelete, setScheduleToDelete] = useState<SparkSchedule | null>(null);
  const [visibleScheduleCount, scheduleListRef, scheduleSentinelRef] = useIncrementalRows(schedules.length, 88);

  return (
    <main
      className={`spark-customise-page spark-customise-page--narrow ${className}`.trim()}
      aria-labelledby={headingId}
      style={accentVars}
    >
      <div className="spark-customise-page__narrow-inner">
        <SparkPageHeader
          headingId={headingId}
          title="Schedules"
          description="Get proactive help with tasks scheduled to run on repeat, respond to events or continuously monitor and react."
          onLearnMore={onLearnMore}
        />

        <div className="spark-page-actions" aria-label="Create a schedule">
          <SparkActionButton icon="edit_rectangle" primary onClick={onCreateWithGemini}>
            Create with Gemini
          </SparkActionButton>
          <SparkActionButton icon="edit_note" onClick={onCreateManually}>
            Create manually
          </SparkActionButton>
        </div>

        {isLoading ? (
          <SparkListSkeleton heading="Ongoing" className="spark-customise-loading-section--schedules" />
        ) : schedules.length > 0 && (
          <section className="spark-schedules-section" aria-labelledby={ongoingHeadingId}>
              <h2 id={ongoingHeadingId}>Ongoing</h2>
              <div ref={scheduleListRef} className="spark-schedule-list">
                {schedules.slice(0, visibleScheduleCount).map((schedule) => {
                  const runLabel = formatScheduleRunLabel(schedule, now);
                  return (
                    <div key={schedule.id} className="spark-schedule-row">
                      <button
                        type="button"
                        className="spark-schedule-card"
                        aria-label={`Open schedule: ${schedule.title}`}
                        onClick={() => onOpenSchedule(schedule.id)}
                      >
                        <span className="spark-schedule-card__icon" aria-hidden="true">
                          <MaterialSymbol
                            family="luminous"
                            name="chat_bubble"
                            size={24}
                            weight={330}
                            roundness={100}
                            opticalSize={24}
                          />
                        </span>
                        <span className="spark-schedule-card__copy">
                          <span className="spark-schedule-card__title">{schedule.title}</span>
                          {/* The stored time stays 24-hour because `spark-store` parses it to
                            * work out the next run; only the label is localised. */}
                          <span className="spark-schedule-card__detail">
                            {schedule.frequency}{schedule.frequency === 'Weekly' && schedule.weekdays.length
                              ? ` on ${schedule.weekdays.join(', ')}`
                              : ''}{` around ${formatSparkScheduleTime(schedule.time)}`}
                          </span>
                        </span>
                        {runLabel && <span className="spark-schedule-card__last-run">{runLabel}</span>}
                        {!schedule.enabled && <span className="spark-schedule-card__paused">Paused</span>}
                      </button>
                      <div className="spark-schedule-row__actions">
                        <SparkRowActionMenu
                          menuLabel={`Schedule options for ${schedule.title}`}
                          deleteLabel="Delete"
                          secondaryIcon={schedule.enabled ? 'pause_circle' : 'play_circle'}
                          secondaryLabel={schedule.enabled ? 'Pause' : 'Resume'}
                          onSecondaryAction={() => onScheduleEnabledChange(schedule.id, !schedule.enabled)}
                          onDelete={() => setScheduleToDelete(schedule)}
                        />
                      </div>
                    </div>
                  );
                })}
                {visibleScheduleCount < schedules.length && (
                  <div ref={scheduleSentinelRef} className="spark-customise-page__load-sentinel" aria-hidden="true" />
                )}
              </div>
          </section>
        )}
        {!isLoading && schedules.length === 0 && (
          <div className="spark-schedules-empty">
            <h2 className="spark-schedules-empty__title">Add your first schedule</h2>
            <p className="spark-schedules-empty__subtitle">
              Schedules created from your tasks appear automatically
            </p>
          </div>
        )}
      </div>
      {scheduleToDelete && (
        <SparkDeleteDialog
          itemName={scheduleToDelete.title}
          itemType="schedule"
          onCancel={() => setScheduleToDelete(null)}
          onConfirm={() => {
            onDeleteSchedule(scheduleToDelete.id);
            setScheduleToDelete(null);
          }}
        />
      )}
    </main>
  );
};

export interface SkillsPageProps extends SparkPageBaseProps {
  isLoading?: boolean;
  skills: readonly SparkSkill[];
  onDeleteSkill: (skillId: string) => void;
  onOpenSkill: (skillId: string) => void;
  onEditSkillWithGemini?: (skillId: string) => void;
  onUseSkill?: (skill: SparkSkill) => void;
  onReplaceSkill?: (skillId: string, files: File[], onStatus?: (status: string) => void) => Promise<void> | void;
  onToggleSkill?: (skillId: string, enabled: boolean) => void;
  onRecommendedSkillSelect?: (title: string) => void;
  onUploadSkill?: (files: File[], onStatus?: (status: string) => void) => Promise<void> | void;
}

interface SparkUploadDialogProps {
  error: string;
  isUploading: boolean;
  status: string;
  onClose: () => void;
  onFiles: (files: File[]) => void;
}

const SparkUploadDialog: React.FC<SparkUploadDialogProps> = ({ error, isUploading, onClose, onFiles, status }) => {
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);

  const requestClose = () => {
    if (isUploading || closing) return;
    setClosing(true);
    window.setTimeout(onClose, 400);
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  });

  const acceptFiles = (list: FileList | File[]) => {
    const files = Array.from(list);
    if (files.length) onFiles(files);
  };

  return (
    <div
      className={`spark-upload-dialog-backdrop${closing ? ' is-closing' : ''}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) requestClose();
      }}
    >
      <div
        className="spark-upload-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spark-upload-dialog-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') requestClose();
        }}
      >
        <h2 id="spark-upload-dialog-title">Upload a skill</h2>
        <section className="spark-upload-dialog__requirements">
          <p>Make sure that your files meet these requirements:</p>
          <ul>
            <li>Use kebab case for the skill name in SKILL.md</li>
            <li>Include a SKILL.md file in the main folder</li>
          </ul>
        </section>
        <p className="spark-upload-dialog__guidelines">
          Follow Gemini&apos;s <a href="https://support.google.com/gemini?p=pn_skills" target="_blank" rel="noreferrer">content guidelines</a> and only upload files from trusted sources. <a href="https://support.google.com/gemini?p=pn_skills" target="_blank" rel="noreferrer">Learn more</a>
        </p>
        {error && (
          <div className="spark-upload-dialog__error" role="alert">
            <MaterialSymbol family="google-symbols" name="error_outline" size={28} weight={400} roundness={100} />
            <span>{error}</span>
          </div>
        )}
        <div
          className={`spark-upload-dialog__dropzone${dragging ? ' is-dragging' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault();
            dragDepthRef.current += 1;
            setDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (!dragDepthRef.current) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragDepthRef.current = 0;
            setDragging(false);
            acceptFiles(event.dataTransfer.files);
          }}
        >
          {status && !error ? (
            <div className="spark-upload-dialog__status" role="status" aria-live="polite">
              <div
                className={`spark-upload-dialog__progress${status === 'Zipping files…' ? ' is-indeterminate' : ' is-complete'}`}
                role="progressbar"
                aria-label={status}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={status === 'Zipping files…' ? undefined : 100}
              >
                <span className="spark-upload-dialog__progress-track" />
                <span className="spark-upload-dialog__progress-bar spark-upload-dialog__progress-bar--primary" />
                <span className="spark-upload-dialog__progress-bar spark-upload-dialog__progress-bar--secondary" />
              </div>
              <span>{status}</span>
            </div>
          ) : (
            <div className="spark-upload-dialog__drop-content">
              <div>
                <span>Drag or select </span>
                <button type="button" className="spark-upload-dialog__link" onClick={() => filesInputRef.current?.click()} disabled={isUploading}>files</button>
                <span> or a </span>
                <button type="button" className="spark-upload-dialog__link" onClick={() => folderInputRef.current?.click()} disabled={isUploading}>folder</button>
                <span> to upload</span>
              </div>
              <span className="spark-upload-dialog__formats">CSV, PY, TXT and MD files</span>
            </div>
          )}
          <input ref={filesInputRef} type="file" hidden multiple accept=".zip,.md,.txt,.py,.csv" disabled={isUploading} onChange={(event) => { acceptFiles(event.target.files ?? []); event.target.value = ''; }} />
          <input ref={folderInputRef} type="file" hidden multiple accept=".zip,.md,.txt,.py,.csv" disabled={isUploading} {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(event) => { acceptFiles(event.target.files ?? []); event.target.value = ''; }} />
        </div>
      </div>
    </div>
  );
};

export const SkillsPage: React.FC<SkillsPageProps> = ({
  className = '',
  onCreateManually,
  onCreateWithGemini,
  onDeleteSkill,
  onEditSkillWithGemini,
  onLearnMore,
  onOpenSkill,
  onReplaceSkill,
  onRecommendedSkillSelect,
  onUploadSkill,
  onToggleSkill,
  onUseSkill,
  skills,
  isLoading = false,
}) => {
  const headingId = useId();
  const activeHeadingId = useId();
  const recommendedHeadingId = useId();
  const accentVars = useSparkAccentVars();
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const [recommendedSkills, setRecommendedSkills] = useState<readonly RecommendedSkill[] | null>(null);
  const [skillToDelete, setSkillToDelete] = useState<SparkSkill | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTargetSkillId, setUploadTargetSkillId] = useState<string | null>(null);
  const uploadInFlightRef = useRef(false);
  const activeSkills = skills.filter((skill) => skill.enabled !== false);
  const [visibleSkillCount, skillListRef, skillSentinelRef] = useIncrementalRows(activeSkills.length, 73);

  useEffect(() => {
    let current = true;
    setRecommendedSkills(null);
    void import('./spark-recommended-skills').then(({ RECOMMENDED_SKILLS }) => {
      if (current) setRecommendedSkills(RECOMMENDED_SKILLS);
    });
    return () => {
      current = false;
    };
  }, []);

  const selectUpload = async (files: File[]) => {
    if (!files.length || uploadInFlightRef.current) return;

    uploadInFlightRef.current = true;
    setIsUploading(true);
    setUploadError('');
    setUploadStatus('');
    try {
      if (uploadTargetSkillId && onReplaceSkill) {
        await onReplaceSkill(uploadTargetSkillId, files, setUploadStatus);
      } else {
        if (!onUploadSkill) throw new Error('Skill import is unavailable');
        await onUploadSkill(files, setUploadStatus);
      }
      setUploadOpen(false);
      setUploadTargetSkillId(null);
    } catch (error) {
      setUploadError(error instanceof Error && error.message
        ? error.message
        : `Couldn't import ${files[0].name}`);
      setUploadStatus('');
    } finally {
      uploadInFlightRef.current = false;
      setIsUploading(false);
    }
  };

  const downloadSkill = (skill: SparkSkill) => {
    const frontmatter = [
      '---',
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      '---',
      '',
      skill.instructions.trim(),
      '',
    ].join('\n');
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([frontmatter], { type: 'text/markdown;charset=utf-8' }));
    anchor.download = skill.fileName || `${skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skill'}.md`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
  };

  return (
    <main
      className={`spark-customise-page spark-customise-page--skills ${className}`.trim()}
      aria-labelledby={headingId}
      style={accentVars}
    >
      <div className="spark-customise-page__narrow-inner">
        <SparkPageHeader
          headingId={headingId}
          title="Skills"
          description="Create custom, reusable instructions for more helpful responses. Gemini uses relevant skills automatically, or you can apply them using /."
          onLearnMore={onLearnMore}
        />

        <div className="spark-page-actions spark-skills-actions" aria-label="Add a skill">
          <SparkActionButton icon="edit_rectangle" primary onClick={onCreateWithGemini}>
            Create with Gemini
          </SparkActionButton>
          <SparkActionButton icon="edit_note" onClick={onCreateManually}>
            Create manually
          </SparkActionButton>
          <button
            type="button"
            className="spark-page-action spark-page-action--icon-only"
            aria-label="Upload skill"
            aria-busy={isUploading}
            title={!onUploadSkill ? 'Skill upload is unavailable' : isUploading ? 'Importing skill' : 'Upload skill'}
            disabled={isUploading || (!onUploadSkill && !onReplaceSkill)}
            onClick={() => {
              setUploadError('');
              setUploadStatus('');
              setUploadTargetSkillId(null);
              setUploadOpen(true);
            }}
          >
            <MaterialSymbol
              family="luminous"
              name={isUploading ? 'progress_activity' : 'upload'}
              size={24}
              weight={330}
              roundness={100}
              opticalSize={24}
            />
          </button>
        </div>
        {uploadOpen && (onUploadSkill || onReplaceSkill) && (
          <SparkUploadDialog
            error={uploadError}
            isUploading={isUploading}
            status={uploadStatus}
            onClose={() => {
              setUploadOpen(false);
              setUploadTargetSkillId(null);
            }}
            onFiles={(files) => { void selectUpload(files); }}
          />
        )}

        {isLoading ? (
          <SparkListSkeleton heading="Active" className="spark-customise-loading-section--skills" />
        ) : skills.length === 0 && (
          <div className="spark-skills-empty">
            <h2>Add your first skill</h2>
            <p>
              Select <span>Create with Gemini</span>, write custom instructions or upload a skill
            </p>
          </div>
        )}
      </div>

      {!isLoading && skills.length > 0 && (
        <section className="spark-skills-library" aria-labelledby={activeHeadingId}>
          <h2 id={activeHeadingId}>Active</h2>
          <div ref={skillListRef} className="spark-skills-library__list">
            {activeSkills.slice(0, visibleSkillCount).map((skill) => (
              <div key={skill.id} className="spark-skill-row">
                <button
                  type="button"
                  className="spark-skill-card"
                  onClick={() => onOpenSkill(skill.id)}
                >
                  {/* Gemini's `skill-card` holds only the name and description — no
                    * leading icon and no trailing chevron. */}
                  <span className="spark-skill-card__copy">
                    <span className="spark-skill-card__title">{skill.name}</span>
                    <span className="spark-skill-card__description">
                      {skill.description || 'Custom reusable instructions'}
                    </span>
                  </span>
                </button>
                <div className="spark-skill-row__actions">
                  <SparkRowActionMenu
                    menuLabel={`Skill options for ${skill.name}`}
                    deleteLabel="Delete"
                    items={[
                      {
                        icon: 'contract',
                        label: 'Use now',
                        onSelect: () => onUseSkill?.(skill),
                      },
                      {
                        icon: 'chat_spark',
                        label: 'Edit with Gemini',
                        onSelect: () => onEditSkillWithGemini?.(skill.id),
                      },
                      {
                        icon: 'edit_note',
                        iconFamily: 'google-symbols',
                        label: 'Edit manually',
                        onSelect: () => onOpenSkill(skill.id),
                      },
                      {
                        dividerBefore: true,
                        icon: 'download',
                        iconFamily: 'google-symbols',
                        label: 'Download',
                        onSelect: () => downloadSkill(skill),
                      },
                      {
                        icon: 'upload',
                        label: 'Replace skill',
                        onSelect: () => {
                          setUploadError('');
                          setUploadStatus('');
                          setUploadTargetSkillId(skill.id);
                          setUploadOpen(true);
                        },
                      },
                      {
                        dividerBefore: true,
                        icon: 'block',
                        iconFamily: 'google-symbols',
                        label: 'Deactivate',
                        onSelect: () => onToggleSkill?.(skill.id, false),
                      },
                      {
                        icon: 'delete',
                        label: 'Delete',
                        onSelect: () => setSkillToDelete(skill),
                      },
                    ]}
                    onDelete={() => setSkillToDelete(skill)}
                  />
                </div>
              </div>
            ))}
            {visibleSkillCount < activeSkills.length && (
              <div ref={skillSentinelRef} className="spark-customise-page__load-sentinel" aria-hidden="true" />
            )}
          </div>
        </section>
      )}

      {recommendedSkills && <section className="spark-recommended-skills" aria-labelledby={recommendedHeadingId}>
          <h2 id={recommendedHeadingId}>Recommended</h2>
          <div className="spark-recommended-skills__grid">
            {recommendedSkills.slice(0, showAllRecommendations ? undefined : 4).map((skill) => (
              <button
                key={skill.title}
                type="button"
                className="spark-recommended-skill"
                disabled={!onRecommendedSkillSelect}
                onClick={() => onRecommendedSkillSelect?.(skill.title)}
              >
                <span className="spark-recommended-skill__copy">
                  <h3 className="spark-recommended-skill__title">{skill.title}</h3>
                  <p className="spark-recommended-skill__description">{skill.description}</p>
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="spark-show-more"
            aria-expanded={showAllRecommendations}
            onClick={() => setShowAllRecommendations((visible) => !visible)}
          >
            <span>{showAllRecommendations ? 'Show less' : 'Show more'}</span>
            <MaterialSymbol
            family="luminous"
            name={showAllRecommendations ? 'expand_less' : 'expand_more'}
            size={28}
            weight={260}
            roundness={100}
            opticalSize={28}
            />
          </button>
      </section>}
      {skillToDelete && (
        <SparkDeleteDialog
          itemName={skillToDelete.name}
          itemType="skill"
          onCancel={() => setSkillToDelete(null)}
          onConfirm={() => {
            onDeleteSkill(skillToDelete.id);
            setSkillToDelete(null);
          }}
        />
      )}
    </main>
  );
};

type ConnectedAppId = SparkConnectedAppId;

interface ConnectedAppDefinition {
  description: string;
  handle?: string;
  icon: string;
  id: Exclude<ConnectedAppId, 'workspace'>;
  name: string;
  prompt?: string;
}

const GOOGLE_PRODUCT_ICONS = {
  workspace: 'https://www.gstatic.com/lamda/images/logo_workspace_2026_844db1cfe6c6bb65dd11a.png',
  gmail:
    'https://www.gstatic.com/images/branding/productlogos/gmail_2026/v2/web-96dp/logo_gmail_2026_color_2x_web_96dp.png',
  docs:
    'https://www.gstatic.com/images/branding/productlogos/docs_2026/v2/web-96dp/logo_docs_2026_color_2x_web_96dp.png',
  drive:
    'https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-96dp/logo_drive_2026_color_2x_web_96dp.png',
  keep:
    'https://www.gstatic.com/images/branding/productlogos/keep_2026/v2/web-96dp/logo_keep_2026_color_2x_web_96dp.png',
  youtubeMusic: 'https://www.gstatic.com/chromecast/thirdparty/yt_music_icon.png',
  contacts: 'https://www.gstatic.com/images/branding/productlogos/contacts_2022/v2/192px.svg',
  openTable: 'https://www.gstatic.com/lamda/images/tools/logo_opentable_b1bb46b2fc3d4d4c69217.svg',
} as const;

const WORKSPACE_APPS = [
  { name: 'Gmail', icon: GOOGLE_PRODUCT_ICONS.gmail },
  { name: 'Google Docs', icon: GOOGLE_PRODUCT_ICONS.docs },
  { name: 'Google Drive', icon: GOOGLE_PRODUCT_ICONS.drive },
  { name: 'Google Keep', icon: GOOGLE_PRODUCT_ICONS.keep },
] as const;

const GOOGLE_CONNECTED_APPS: readonly ConnectedAppDefinition[] = [
  {
    id: 'youtube-music',
    name: 'YouTube Music',
    handle: '@YouTube Music',
    icon: GOOGLE_PRODUCT_ICONS.youtubeMusic,
    description: 'Play, search, and discover your favorite songs, artists, playlists and more',
    prompt: 'Play songs where Beyonc\u00e9 and Jay-Z feature together.',
  },
] as const;

const OTHER_CONNECTED_APPS: readonly ConnectedAppDefinition[] = [
  {
    id: 'contacts',
    name: 'Contacts',
    icon: GOOGLE_PRODUCT_ICONS.contacts,
    description:
      'Get personalized insights and responses based on your contacts. Add or find people in your contacts, and more.',
  },
  {
    id: 'opentable',
    name: 'OpenTable',
    handle: '@OpenTable',
    icon: GOOGLE_PRODUCT_ICONS.openTable,
    description: 'Discover and book a reservation at the best restaurants for every occasion.',
    prompt: 'Reserve a table for 2 at La Pecora Bianca SoHo on Friday at 7:30 PM.',
  },
] as const;

interface ConnectedAppCardProps {
  app: ConnectedAppDefinition;
  checked: boolean;
  onPromptSelect: (prompt: string, appId: SparkConnectedAppId) => void;
  onToggle: () => void;
}

const ConnectedAppCard: React.FC<ConnectedAppCardProps> = ({ app, checked, onPromptSelect, onToggle }) => (
  <article className="spark-connected-app-card">
    <div className="spark-connected-app-card__opt-in">
      <img src={app.icon} alt="" aria-hidden="true" />
      <SparkPreferenceControl
        appName={app.name}
        checked={checked}
        onChange={onToggle}
      />
    </div>

    <div>
      <h3>{app.name}</h3>
      {app.handle && <p className="spark-connected-app-card__handle">{app.handle}</p>}
    </div>

    {/* The name and handle sit above this block so only the copy competes for the
        leftover height, which is what lets the prompt tile below pin itself to the
        card's floor and line up across the row. */}
    <div className="spark-connected-app-card__body">
      <p className="spark-connected-app-card__description">{app.description}</p>
      <a
        className="spark-connected-app-card__learn-more"
        href="https://support.google.com/gemini?p=lm_gpi_apps"
        target="_blank"
        rel="noreferrer"
      >
        Learn more
      </a>

      {app.prompt && (
        <div className="spark-connected-app-card__prompt-slot">
          <button
            type="button"
            className="spark-connected-app-card__prompt"
            disabled={!checked}
            title={checked ? undefined : `Connect ${app.name} to use this prompt`}
            onClick={() => onPromptSelect(app.prompt!, app.id)}
          >
            <span>{app.prompt}</span>
          </button>
        </div>
      )}
    </div>
  </article>
);

export interface ConnectedAppsPageProps {
  className?: string;
  connections: Record<ConnectedAppId, boolean>;
  customApps: readonly SparkCustomApp[];
  onAddCustomApp: (url: string) => boolean;
  onConnectionChange: (appId: ConnectedAppId, connected: boolean) => void;
  onCustomAppConnectionChange: (appId: string, connected: boolean) => void;
  onDeleteCustomApp: (appId: string) => void;
  onPhotosSettings?: () => void;
  onPromptSelect: (prompt: string, appId: SparkConnectedAppId) => void;
}

export const ConnectedAppsPage: React.FC<ConnectedAppsPageProps> = ({
  className = '',
  connections,
  customApps,
  onAddCustomApp,
  onConnectionChange,
  onCustomAppConnectionChange,
  onDeleteCustomApp,
  onPhotosSettings,
  onPromptSelect,
}) => {
  const headingId = useId();
  const customAppUrlId = useId();
  const customAppErrorId = useId();
  const accentVars = useSparkAccentVars();
  const [customAppUrl, setCustomAppUrl] = useState('');
  const [customAppError, setCustomAppError] = useState('');
  const [customAppToDelete, setCustomAppToDelete] = useState<SparkCustomApp | null>(null);

  const toggleConnection = (appId: ConnectedAppId) => {
    const connected = !connections[appId];
    onConnectionChange(appId, connected);
  };

  const submitCustomApp = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onAddCustomApp(customAppUrl)) {
      setCustomAppError('Enter a valid app link');
      return;
    }
    setCustomAppUrl('');
    setCustomAppError('');
  };

  return (
    <main
      className={`spark-customise-page spark-customise-page--apps ${className}`.trim()}
      aria-labelledby={headingId}
      style={accentVars}
    >
      <div className="spark-connected-page__inner">
        <header className="spark-connected-header">
          <h1 id={headingId}>Connected apps</h1>
          <p>
            Choose which apps Spark may consider as preference context. Willow does not sign in to or read app
            data unless a supported integration supplies it.{' '}
            <a href="https://support.google.com/gemini?p=lm_gpi_apps" target="_blank" rel="noreferrer">
              Learn more
            </a>
          </p>
        </header>

        <div className="spark-photos-notice" role="status">
          <MaterialSymbol
            family="luminous"
            name="info"
            size={24}
            weight={350}
            roundness={100}
            opticalSize={24}
            className="spark-photos-notice__icon"
          />
          <span className="spark-photos-notice__copy">
            Google Photos is not connected through Willow.{' '}
            {onPhotosSettings ? (
              <button type="button" onClick={onPhotosSettings}>
                Review your settings in Photos
              </button>
            ) : (
              <span>Photos settings are unavailable here.</span>
            )}
          </span>
        </div>

        <nav className="spark-app-categories" aria-label="App categories">
          {([
            ['spark-apps-from-google', 'From Google'],
            ['spark-apps-other', 'Other'],
            ['spark-apps-custom', 'Custom apps'],
            ['spark-apps-mcp', 'MCP servers'],
          ] as const).map(([category, label]) => (
            <a
              key={category}
              className="spark-app-category"
              href={`#${category}`}
            >
              {label}
            </a>
          ))}
        </nav>

        <section
            id="spark-apps-from-google"
            className="spark-connected-app-section"
            aria-labelledby="spark-apps-from-google-heading"
          >
            <header className="spark-connected-app-section__header">
              <h2 id="spark-apps-from-google-heading">From Google</h2>
            </header>

            <div className="spark-connected-app-grid">
              <article className="spark-workspace-card">
                <div className="spark-workspace-card__opt-in">
                  <img src={GOOGLE_PRODUCT_ICONS.workspace} alt="" aria-hidden="true" />
                  <SparkPreferenceControl
                    appName="Google Workspace"
                    checked={connections.workspace}
                    onChange={() => toggleConnection('workspace')}
                  />
                </div>

                <div className="spark-workspace-card__content">
                  <div className="spark-workspace-card__summary">
                    <h3>Google Workspace</h3>
                    <p>Use authorised Workspace content when a supported integration is available.</p>
                  </div>

                  <div className="spark-workspace-card__products" aria-label="Google Workspace apps">
                    {WORKSPACE_APPS.map((app) => (
                      <article key={app.name} className="spark-workspace-product">
                        <img src={app.icon} alt="" aria-hidden="true" />
                        <div>
                          <h4>{app.name}</h4>
                          <a
                            href="https://support.google.com/gemini?p=lm_gpi_apps"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Learn more
                          </a>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </article>

              {GOOGLE_CONNECTED_APPS.map((app) => (
                <ConnectedAppCard
                  key={app.id}
                  app={app}
                  checked={connections[app.id]}
                  onPromptSelect={onPromptSelect}
                  onToggle={() => toggleConnection(app.id)}
                />
              ))}
            </div>
        </section>

        <section
            id="spark-apps-other"
            className="spark-connected-app-section"
            aria-labelledby="spark-apps-other-heading"
          >
            <header className="spark-connected-app-section__header">
              <h2 id="spark-apps-other-heading">Other</h2>
            </header>

            <div className="spark-connected-app-grid">
              {OTHER_CONNECTED_APPS.map((app) => (
                <ConnectedAppCard
                  key={app.id}
                  app={app}
                  checked={connections[app.id]}
                  onPromptSelect={onPromptSelect}
                  onToggle={() => toggleConnection(app.id)}
                />
              ))}
            </div>
        </section>

        <section
            id="spark-apps-custom"
            className="spark-connected-app-section spark-connected-app-section--custom"
            aria-labelledby="spark-apps-custom-heading"
          >
            <header className="spark-connected-app-section__header">
              <h2 id="spark-apps-custom-heading">Custom apps for Spark</h2>
            </header>

            {customApps.length === 0 ? (
              <div className="spark-custom-app-empty">
                <span className="spark-custom-app-empty__icon" aria-hidden="true">
                  <MaterialSymbol family="luminous" name="extension" size={28} weight={320} roundness={100} />
                </span>
                <span className="spark-custom-app-empty__copy">
                  <strong>No custom apps yet</strong>
                  <span>Save an app link to make it available as preference context.</span>
                </span>
              </div>
            ) : (
              <div className="spark-custom-app-list">
                {customApps.map((app) => (
                  <article key={app.id} className="spark-custom-app-row">
                    <span className="spark-custom-app-row__icon" aria-hidden="true">
                      <MaterialSymbol family="luminous" name="language" size={22} weight={320} roundness={100} />
                    </span>
                    <span className="spark-custom-app-row__copy">
                      <strong>{app.name}</strong>
                      <span>{app.url}</span>
                      <span className="spark-custom-app-row__status">
                        {app.connected ? 'Preference context enabled' : 'Saved link · Off'}
                      </span>
                    </span>
                    <SparkPreferenceControl
                      appName={app.name}
                      checked={app.connected}
                      className="spark-custom-app-row__toggle"
                      onChange={() => onCustomAppConnectionChange(app.id, !app.connected)}
                    />
                    <button
                      type="button"
                      className="spark-custom-app-row__remove"
                      aria-label={`Remove ${app.name}`}
                      title="Remove app"
                      onClick={() => setCustomAppToDelete(app)}
                    >
                      <MaterialSymbol family="luminous" name="delete" size={20} weight={320} roundness={100} />
                    </button>
                  </article>
                ))}
              </div>
            )}

            <form className="spark-custom-app-card" onSubmit={submitCustomApp}>
              <label htmlFor={customAppUrlId}>Save a custom app link</label>
              <div className="spark-custom-app-card__row">
                <input
                  id={customAppUrlId}
                  type="url"
                  aria-label="Custom app link"
                  aria-describedby={customAppError ? customAppErrorId : undefined}
                  value={customAppUrl}
                  aria-invalid={Boolean(customAppError)}
                  placeholder="https://example.com"
                  onChange={(event) => {
                    setCustomAppUrl(event.target.value);
                    setCustomAppError('');
                  }}
                />
                <button type="submit" disabled={!customAppUrl.trim()}>Add</button>
              </div>
              {customAppError && (
                <p id={customAppErrorId} className="spark-custom-app-card__error" role="alert">
                  {customAppError}
                </p>
              )}
            </form>
        </section>

        {/*
          * MCP servers.
          *
          * Its own component because it carries a form, a status list and a
          * callout, and this file is already five pages long. It reads
          * `@willow/ai/mcp/mcp-store` directly rather than taking props:
          * MCP servers are app-level state shared with the Code tab's Agent,
          * not Spark task state, so threading them through this page's
          * task-shaped props would make Spark their owner.
          */}
        <SparkMcpSection />

        <aside className="spark-premium-content" aria-labelledby="spark-premium-content-heading">
          <MaterialSymbol
            family="luminous"
            name="extension"
            size={24}
            weight={300}
            roundness={100}
            opticalSize={24}
          />
          <div>
            <h2 id="spark-premium-content-heading">Your premium content</h2>
            <p>
              Subscription settings are managed by your Google Account. Willow does not currently read or prioritise
              paid subscription content.
            </p>
            <a href="https://myaccount.google.com/subscriptions" target="_blank" rel="noreferrer">
              Manage subscriptions linked to your Google Account
            </a>
          </div>
        </aside>

        <aside className="spark-apps-privacy-note">
          <MaterialSymbol
            family="luminous"
            name="info"
            size={24}
            weight={350}
            roundness={100}
            opticalSize={24}
          />
          <p>
            Learn how Gemini apps use data and communicate with supported integrations in the{' '}
            <a href="https://support.google.com/gemini?p=privacy_help" target="_blank" rel="noreferrer">
              Gemini Apps Privacy Hub
            </a>
          </p>
        </aside>
      </div>
      {customAppToDelete && (
        <SparkDeleteDialog
          itemName={customAppToDelete.name}
          itemType="custom app"
          onCancel={() => setCustomAppToDelete(null)}
          onConfirm={() => {
            onDeleteCustomApp(customAppToDelete.id);
            setCustomAppToDelete(null);
          }}
        />
      )}
    </main>
  );
};
