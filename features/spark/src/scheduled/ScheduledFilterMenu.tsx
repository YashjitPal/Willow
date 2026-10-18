import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SCHEDULED_FILTERS, scheduledFilterLabel, type ScheduledFilter } from './scheduled-model';
import { placePopover } from './ScheduledPopover';
import { SchedIcon } from './ScheduledIcons';

/** Material's exit: 100ms after a 25ms hold. */
const EXIT_MS = 125;

/**
 * The status filter: Gemini's pill (icon-only on a phone) and its `mat-menu`. Unlike the page's
 * gem-menus this one has Material's transparent backdrop, so a press outside only closes it,
 * and Material's 120ms grow-in from the trigger's corner and 100ms fade-out.
 */
export const ScheduledFilterMenu: React.FC<{ value: ScheduledFilter; onChange: (value: ScheduledFilter) => void }> = ({ value, onChange }) => {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const [openedBy, setOpenedBy] = useState<'pointer' | 'keyboard'>('pointer');
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const closeTimer = useRef<number | null>(null);

  const open = (by: 'pointer' | 'keyboard') => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setOpenedBy(by);
    setPosition(null);
    setPhase('open');
  };

  const close = (refocus: 'none' | 'quiet' | 'visible') => {
    if (phase !== 'open') return;
    setPhase('closing');
    setActive(-1);
    if (refocus !== 'none') triggerRef.current?.focus({ preventScroll: true, focusVisible: refocus === 'visible' } as FocusOptions);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPhase('closed');
    }, EXIT_MS);
  };

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (phase !== 'open' || position || !panelRef.current || !triggerRef.current) return;
    setPosition(placePopover(
      triggerRef.current.getBoundingClientRect(),
      { width: panelRef.current.offsetWidth, height: panelRef.current.offsetHeight },
      { align: 'end', offsetY: 0 },
      { width: window.innerWidth, height: window.innerHeight },
    ));
  }, [phase, position]);

  // Material moves focus into the menu: onto the first item, painted only when the keyboard opened it.
  useEffect(() => {
    if (phase !== 'open' || !position) return;
    const first = itemRefs.current[0];
    first?.focus({ preventScroll: true, focusVisible: openedBy === 'keyboard' } as FocusOptions);
    setActive(openedBy === 'keyboard' ? 0 : -1);
  }, [phase, position, openedBy]);

  useEffect(() => {
    if (phase !== 'open') return;
    const onResize = () => close('none');
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const count = SCHEDULED_FILTERS.length;
    const move = (to: number) => {
      event.preventDefault();
      setActive(to);
      itemRefs.current[to]?.focus({ preventScroll: true });
    };
    if (event.key === 'ArrowDown') move((active + 1 + count) % count);
    else if (event.key === 'ArrowUp') move((active - 1 + count) % count);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(count - 1);
    else if (event.key === 'Escape') { event.preventDefault(); close('visible'); }
    else if (event.key === 'Tab') { event.preventDefault(); close('visible'); }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="sched-filter-button sched-body-m"
        aria-label="Filter scheduled tasks by status"
        aria-haspopup="menu"
        aria-expanded={phase === 'open'}
        onClick={(event) => (phase === 'open' ? close('quiet') : open(event.detail === 0 ? 'keyboard' : 'pointer'))}
        onKeyDown={(event) => {
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && phase !== 'open') {
            event.preventDefault();
            open('keyboard');
          }
        }}
      >
        <SchedIcon name="filter_alt" size={24} />
        <span className="sched-filter-label">{scheduledFilterLabel(value)}</span>
      </button>
      {phase !== 'closed' && createPortal(
        <div className="sched-scope">
          <div className="sched-menu-backdrop" onClick={() => close('quiet')} onContextMenu={(event) => { event.preventDefault(); close('quiet'); }} />
          <div
            ref={panelRef}
            role="menu"
            aria-label="Filter scheduled tasks by status"
            className={`sched-popover sched-mat-menu${phase === 'closing' ? ' is-closing' : ''}`}
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              visibility: position ? 'visible' : 'hidden',
              transformOrigin: position?.above ? 'right bottom' : 'right top',
            }}
            onKeyDown={onMenuKeyDown}
          >
            {SCHEDULED_FILTERS.map((filter, index) => (
              <button
                key={filter.value}
                ref={(node) => { itemRefs.current[index] = node; }}
                type="button"
                role="menuitem"
                tabIndex={index === 0 ? 0 : -1}
                className={`sched-mat-menu-item sched-body-s${active === index ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(-1)}
                onClick={() => {
                  onChange(filter.value);
                  close('quiet');
                }}
              >
                <span className="sched-mat-menu-icon"><SchedIcon name={filter.icon} family={filter.family} /></span>
                <span>{filter.label}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
