import React, { useEffect, useRef, useState } from 'react';
import { AnchoredLayer, useOutsidePress, type PopoverPlacement } from './ScheduledPopover';
import { CALENDAR_WEEKDAYS, calendarMonth, isoDay, parseIsoDay } from './scheduled-model';

const PLACEMENT: PopoverPlacement = { align: 'end', offsetY: 4 };
const YEARS_PER_PAGE = 24;
const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEPT', 'OCT', 'NOV', 'DEC'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Material's chevrons, as its calendar header draws them. */
const Chevron: React.FC<{ direction: 'previous' | 'next' }> = ({ direction }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" focusable="false" aria-hidden="true">
    <path fill="currentColor" d={direction === 'previous' ? 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z' : 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z'} />
  </svg>
);

interface ScheduledCalendarProps {
  anchor: HTMLElement | null;
  open: boolean;
  value: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
}

/**
 * Material's `mat-calendar` as Gemini restyles it in a popover: the month view from today on,
 * and the 24-year and month grids its period button steps through. Past days are not drawn
 * any differently — Gemini's ink overrides Material's disabled colour — they just cannot be picked.
 */
export const ScheduledCalendar: React.FC<ScheduledCalendarProps> = ({ anchor, open, value, onSelect, onClose }) => {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(anchor);
  anchorRef.current = anchor;
  const pressRefs = useRef([layerRef, anchorRef]).current;
  const today = new Date();
  const minYear = today.getFullYear();
  const selected = parseIsoDay(value) ?? today;
  const [view, setView] = useState<'month' | 'multi-year' | 'year'>('month');
  const [cursor, setCursor] = useState({ year: selected.getFullYear(), month: selected.getMonth() });

  useEffect(() => {
    if (!open) return;
    setView('month');
    setCursor({ year: selected.getFullYear(), month: selected.getMonth() });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useOutsidePress(open, pressRefs, onClose);

  if (!open) return null;

  const pageStart = minYear + Math.floor((cursor.year - minYear) / YEARS_PER_PAGE) * YEARS_PER_PAGE;
  const monthIsPast = (year: number, month: number) => year < today.getFullYear() || (year === today.getFullYear() && month < today.getMonth());

  let periodLabel: string;
  let periodAria: string;
  let previousLabel: string;
  let nextLabel: string;
  let canGoBack: boolean;
  if (view === 'month') {
    periodLabel = `${MONTH_LABELS[cursor.month]!.slice(0, 3)} ${cursor.year}`;
    periodAria = 'Choose month and year';
    previousLabel = 'Previous month';
    nextLabel = 'Next month';
    canGoBack = !monthIsPast(cursor.month === 0 ? cursor.year - 1 : cursor.year, cursor.month === 0 ? 11 : cursor.month - 1);
  } else if (view === 'year') {
    periodLabel = String(cursor.year);
    periodAria = 'Choose date';
    previousLabel = 'Previous year';
    nextLabel = 'Next year';
    canGoBack = cursor.year - 1 >= minYear;
  } else {
    periodLabel = `${pageStart} \u2013 ${pageStart + YEARS_PER_PAGE - 1}`;
    periodAria = 'Choose date';
    previousLabel = `Previous ${YEARS_PER_PAGE} years`;
    nextLabel = `Next ${YEARS_PER_PAGE} years`;
    canGoBack = pageStart - YEARS_PER_PAGE >= minYear;
  }

  const step = (by: number) => {
    if (by < 0 && !canGoBack) return;
    setCursor((current) => {
      if (view === 'month') {
        const next = new Date(current.year, current.month + by, 1);
        return { year: next.getFullYear(), month: next.getMonth() };
      }
      if (view === 'year') return { ...current, year: current.year + by };
      return { ...current, year: current.year + by * YEARS_PER_PAGE };
    });
  };

  const month = calendarMonth(cursor.year, cursor.month, today);
  const selectedIso = isoDay(selected);

  return (
    <AnchoredLayer
      anchor={anchor}
      placement={PLACEMENT}
      layerRef={layerRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="sched-calendar" role="dialog" aria-label="Calendar">
        <div className="sched-calendar-header">
          <span className="sched-visually-hidden" aria-live="polite">{view === 'multi-year' ? `${pageStart} to ${pageStart + YEARS_PER_PAGE - 1}` : periodLabel}</span>
          <button
            type="button"
            className="sched-calendar-period sched-body-m"
            aria-label={periodAria}
            onClick={() => setView(view === 'month' ? 'multi-year' : 'month')}
          >
            <span className="sched-calendar-period-label">
              {periodLabel}
              <svg className={`sched-calendar-arrow${view === 'month' ? '' : ' is-inverted'}`} viewBox="0 0 10 5" width="10" height="5" focusable="false" aria-hidden="true">
                <polygon points="0,0 5,5 10,0" />
              </svg>
            </span>
          </button>
          <div className="sched-calendar-nav">
            <button type="button" className="sched-calendar-step" aria-label={previousLabel} aria-disabled={!canGoBack || undefined} onClick={() => step(-1)}>
              <Chevron direction="previous" />
            </button>
            <button type="button" className="sched-calendar-step" aria-label={nextLabel} onClick={() => step(1)}>
              <Chevron direction="next" />
            </button>
          </div>
        </div>
        {view === 'month' && (
          <div className="sched-calendar-grid" role="grid">
            {CALENDAR_WEEKDAYS.map((day) => (
              <span key={day.long} className="sched-calendar-weekday sched-body-s" role="columnheader" aria-label={day.long}>{day.short}</span>
            ))}
            {month.cells.map((cell, index) => (
              <button
                key={cell.iso}
                type="button"
                role="gridcell"
                className="sched-calendar-cell"
                style={index === 0 ? { gridColumnStart: month.offset + 1 } : undefined}
                aria-label={`${cell.day} ${MONTH_NAMES[cursor.month]} ${cursor.year}`}
                aria-disabled={cell.disabled || undefined}
                aria-pressed={cell.iso === selectedIso}
                aria-current={cell.today ? 'date' : undefined}
                onClick={() => { if (!cell.disabled) onSelect(cell.iso); }}
              >
                <span className={`sched-calendar-day sched-body-s${cell.iso === selectedIso ? ' is-selected' : ''}${cell.today ? ' is-today' : ''}`}>{cell.day}</span>
              </button>
            ))}
          </div>
        )}
        {view === 'multi-year' && (
          <div className="sched-calendar-grid sched-calendar-grid--wide" role="grid">
            {Array.from({ length: YEARS_PER_PAGE }, (_, index) => pageStart + index).map((year) => (
              <button
                key={year}
                type="button"
                role="gridcell"
                className="sched-calendar-cell"
                aria-label={String(year)}
                aria-disabled={year < minYear || undefined}
                aria-pressed={year === selected.getFullYear()}
                aria-current={year === today.getFullYear() ? 'date' : undefined}
                onClick={() => {
                  if (year < minYear) return;
                  setCursor((current) => ({ ...current, year }));
                  setView('year');
                }}
              >
                <span className={`sched-calendar-day sched-body-s${year === selected.getFullYear() ? ' is-selected' : ''}${year === today.getFullYear() ? ' is-today' : ''}`} style={{ fontWeight: 500 }}>{year}</span>
              </button>
            ))}
          </div>
        )}
        {view === 'year' && (
          <div className="sched-calendar-grid sched-calendar-grid--wide" role="grid">
            {MONTH_LABELS.map((label, index) => {
              const past = monthIsPast(cursor.year, index);
              const isSelected = cursor.year === selected.getFullYear() && index === selected.getMonth();
              const isToday = cursor.year === today.getFullYear() && index === today.getMonth();
              return (
                <button
                  key={label}
                  type="button"
                  role="gridcell"
                  className="sched-calendar-cell"
                  aria-label={`${MONTH_NAMES[index]} ${cursor.year}`}
                  aria-disabled={past || undefined}
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (past) return;
                    setCursor((current) => ({ ...current, month: index }));
                    setView('month');
                  }}
                >
                  <span className={`sched-calendar-day sched-body-s${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`} style={{ fontWeight: 500 }}>{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </AnchoredLayer>
  );
};
