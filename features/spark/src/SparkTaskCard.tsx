import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import './SparkTaskCard.css';

/**
 * Gemini's `remy-task-list` row (`.goal-card`) and its `remy-goal-action-menu`.
 * Shared by the Spark home page, the full task list and the task detail rail,
 * which all render the same row — Gemini uses one component for all three.
 *
 * The row is a `div[role="option"]` rather than a `<button>` because it contains
 * the actions button, and a button may not nest a button. That also matches
 * Gemini's own listbox/option semantics.
 */

export interface SparkTaskCardAction {
  id: string;
  label: string;
  /** Luminous Symbols glyph name, e.g. `edit`, `push_pin`, `delete`. */
  icon: string;
  onSelect: () => void;
}

export interface SparkTaskCardProps {
  title: string;
  description: string;
  /** Already-formatted relative time, e.g. "2 wk ago". */
  timeLabel: string;
  /** Shown as a pill beside the timestamp, e.g. "Needs input". */
  statusLabel?: string;
  /**
   * Gemini has three pill modes: `status-blocked` (default) and `status-failed` are
   * labelled pills; `pulse` replaces the label with an animated 6px dot while a task
   * is running, and settles solid once it completes.
   */
  statusTone?: 'blocked' | 'failed' | 'pulse' | 'pulse-complete';
  /** Leading glyph on the description line, used for scheduled tasks. */
  descriptionIcon?: string;
  isUnread?: boolean;
  isSelected?: boolean;
  isPinned?: boolean;
  /** Only the active row is tabbable, per the listbox roving-tabindex pattern. */
  isTabbable?: boolean;
  actions?: SparkTaskCardAction[];
  onOpen?: () => void;
}

const MENU_GAP = 0;

export const SparkTaskCard: React.FC<SparkTaskCardProps> = ({
  title,
  description,
  timeLabel,
  statusLabel,
  statusTone = 'blocked',
  descriptionIcon,
  isUnread = false,
  isSelected = false,
  isPinned = false,
  isTabbable = false,
  actions,
  onOpen,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPosition, setPanelPosition] = useState<{ top: number; right: number } | null>(null);

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false);
    setPanelPosition(null);
  }, []);

  /*
   * `xposition="before"` on Gemini's menu means the panel's right edge lines up
   * with the trigger's right edge and it drops straight below. Positioned from the
   * right so a 240–280px panel never has to be measured before it is placed.
   */
  useLayoutEffect(() => {
    if (!isMenuOpen) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const place = () => {
      const rect = trigger.getBoundingClientRect();
      setPanelPosition({
        top: rect.bottom + MENU_GAP,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeMenu();
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isMenuOpen, closeMenu]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('.spark-goal-menu-item')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isMenuOpen]);

  const hasActions = Boolean(actions?.length);
  const isPulse = statusTone === 'pulse' || statusTone === 'pulse-complete';

  return (
    <div
      role="option"
      aria-selected={isSelected}
      aria-label={`Open task: ${title}`}
      tabIndex={isTabbable ? 0 : -1}
      className={`spark-goal-card${isSelected ? ' is-selected' : ''}`}
      onClick={() => onOpen?.()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen?.();
      }}
    >
      <div className="spark-goal-card-header">
        <div className="spark-goal-titles">
          <span className={`spark-goal-description${isUnread ? ' is-unread' : ''}`}>{title}</span>
          <div className="spark-goal-secondary-text">
            {descriptionIcon && (
              <MaterialSymbol
                family="luminous"
                name={descriptionIcon}
                size={16}
                weight={320}
                roundness={100}
                opticalSize={16}
                className="spark-goal-secondary-icon"
              />
            )}
            <span className="spark-goal-secondary-content">{description}</span>
          </div>
        </div>

        <div className="spark-goal-card-actions">
          <span className="spark-goal-time-ago">{timeLabel}</span>
          {isPulse ? (
            <span className="spark-status-pill spark-status-pill--pulse" aria-label={statusLabel || 'Running'}>
              <span
                className={`spark-status-pulse-dot${statusTone === 'pulse-complete' ? ' is-complete' : ''}`}
                aria-hidden="true"
              />
            </span>
          ) : (
            statusLabel && (
              <span
                className={`spark-status-pill${statusTone === 'failed' ? ' spark-status-pill--failed' : ''}`}
              >
                {statusLabel}
              </span>
            )
          )}

          {hasActions && (
            <div
              className={`spark-goal-action-menu${isMenuOpen ? ' is-open' : ''}${isPinned ? ' is-pinned' : ''}`}
            >
              <button
                ref={triggerRef}
                type="button"
                className="spark-goal-actions-button"
                aria-label="Button to open the task actions menu"
                aria-haspopup="menu"
                aria-expanded={isMenuOpen}
                tabIndex={isTabbable ? 0 : -1}
                onClick={(event) => {
                  event.stopPropagation();
                  setIsMenuOpen((open) => !open);
                }}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <MaterialSymbol
                  family="luminous"
                  name={isPinned ? 'push_pin' : 'more_vert'}
                  size={20}
                  weight={320}
                  roundness={100}
                  opticalSize={20}
                />
              </button>
            </div>
          )}
        </div>
      </div>

      {isMenuOpen && panelPosition
        && createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="Task actions"
            className="spark-goal-menu-panel"
            style={{ top: panelPosition.top, right: panelPosition.right }}
            onClick={(event) => event.stopPropagation()}
          >
            {actions?.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className="spark-goal-menu-item"
                onClick={(event) => {
                  event.stopPropagation();
                  closeMenu();
                  action.onSelect();
                }}
              >
                <MaterialSymbol
                  family="luminous"
                  name={action.icon}
                  size={20}
                  weight={320}
                  roundness={100}
                  opticalSize={20}
                  style={{ width: 24, height: 24 }}
                />
                <span>{action.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
};

export default SparkTaskCard;
