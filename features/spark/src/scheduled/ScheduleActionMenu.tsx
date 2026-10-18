import React, { useRef, useState } from 'react';
import type { SparkSchedule } from '../spark-types';
import { scheduleSection } from './scheduled-model';
import { deleteSchedule, pauseSchedule, resumeSchedule, runScheduleNow } from './schedule-actions';
import { GemMenu, type GemMenuEntry, type PopoverPlacement } from './ScheduledPopover';
import { SchedIcon } from './ScheduledIcons';

/** A row's menu opens start-aligned 10px under its button; the pane's sits 52px right of its button's end. */
export const ROW_MENU_PLACEMENT: PopoverPlacement = { align: 'start', offsetY: 10 };
export const PANE_MENU_PLACEMENT: PopoverPlacement = { align: 'end', offsetX: 52, offsetY: 10 };

interface ScheduleActionMenuProps {
  schedule: SparkSchedule;
  placement: PopoverPlacement;
  iconSize: 20 | 24;
  className: string;
  onOpenChange?: (open: boolean) => void;
  onDeleted?: () => void;
}

/**
 * Gemini's `schedule-action-menu` as the Scheduled tab configures it: Pause (or Resume), Run now
 * and Delete, and Delete alone once a schedule has completed. Each acts at once, as Gemini's do.
 */
export const ScheduleActionMenu: React.FC<ScheduleActionMenuProps> = ({ schedule, placement, iconSize, className, onOpenChange, onDeleted }) => {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [openedBy, setOpenedBy] = useState<'pointer' | 'keyboard'>('pointer');
  const section = scheduleSection(schedule);

  const setMenuOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  const entries: GemMenuEntry[] = [];
  if (section === 'active') {
    entries.push({ key: 'pause', label: 'Pause', icon: <SchedIcon name="pause_circle" className="sched-menu-item-icon" />, onSelect: () => { pauseSchedule(schedule.id); } });
  } else if (section === 'paused') {
    entries.push({ key: 'resume', label: 'Resume', icon: <SchedIcon name="play_circle" className="sched-menu-item-icon" />, onSelect: () => { resumeSchedule(schedule.id); } });
  }
  if (section !== 'completed') {
    entries.push({ key: 'run-now', label: 'Run now', icon: <SchedIcon name="refresh" className="sched-menu-item-icon" />, onSelect: () => { void runScheduleNow(schedule.id); } });
  }
  entries.push({
    key: 'delete',
    label: 'Delete',
    icon: <SchedIcon name="delete" className="sched-menu-item-icon" />,
    onSelect: () => {
      if (deleteSchedule(schedule.id)) onDeleted?.();
    },
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${className}${open ? ' is-open' : ''}`}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          if (open) { setMenuOpen(false); return; }
          setOpenedBy(event.detail === 0 ? 'keyboard' : 'pointer');
          setMenuOpen(true);
        }}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
      >
        <SchedIcon name="more_vert" size={iconSize} />
      </button>
      <GemMenu
        anchor={triggerRef.current}
        open={open}
        entries={entries}
        placement={placement}
        openedBy={openedBy}
        ariaLabel="More options"
        onClose={(reason) => {
          setMenuOpen(false);
          if (reason === 'escape' || reason === 'select') {
            triggerRef.current?.focus({ preventScroll: true, focusVisible: reason === 'escape' } as FocusOptions);
          }
        }}
      />
    </>
  );
};
