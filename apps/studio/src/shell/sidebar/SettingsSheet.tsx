import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

/*
 * The settings pane at <=960px. Gemini swaps its desktop menu for a draggable bottom
 * sheet there; every number below was read off the live one at 390x844 and 800x1280.
 *
 * It opens at half the viewport with its list clipped, not scrolled. Dragging the handle
 * moves the sheet one detent: up to 80% of the viewport (where the list scrolls), or down
 * from there back to half, or down from half to dismissed. A drag counts once it covers
 * 20% of the height it started from (measured: 70px of 422 stays, 85px goes; 100px of 640
 * stays). Short of that it springs back.
 *
 * Theme opens a second sheet rather than a flyout: the first slides away, then the second
 * slides in, over one backdrop.
 */

export type SettingsSheetRow = {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** Gemini's trailing `arrow_right`. */
  trailingArrow?: boolean;
  /** Swaps this sheet for the Theme sheet instead of calling `onSelect`. */
  opensTheme?: boolean;
  /** For the one row Gemini sets in a different type style than the rest. */
  labelStyle?: React.CSSProperties;
  onSelect?: () => void;
};

type ThemeSheetProps = {
  value: string;
  options: { id: string; label: string }[];
  onSelect: (id: string) => void;
  colors: readonly { id: string; label: string; hex: string }[];
  activeColor: string;
  onSelectColor: (id: string) => void;
};

type LocationProps = {
  title: string;
  detail: string;
  action: string;
  actionDisabled: boolean;
  onAction: () => void;
};

type SettingsSheetProps = {
  isOpen: boolean;
  isLight: boolean;
  /** Asks the owner to close. The sheet plays its own exit once `isOpen` drops. */
  onClose: () => void;
  groups: SettingsSheetRow[][];
  theme: ThemeSheetProps;
  location: LocationProps;
};

const HALF = 0.5;
const EXPANDED = 0.8;
const DRAG_THRESHOLD = 0.2;
/* Matches `willow-settings-sheet-exit` in Sidebar.css. */
const EXIT_MS = 150;
/* Gemini's overlay leaves the DOM ~188ms after a close: the exit plus a frame or two. */
const UNMOUNT_MS = 180;

type Phase = 'closed' | 'open' | 'switching' | 'closing';

const rowPosition = (index: number, count: number) =>
  `${index === 0 ? ' is-first' : ''}${index === count - 1 ? ' is-last' : ''}`;

export const SettingsSheet: React.FC<SettingsSheetProps> = ({ isOpen, isLight, onClose, groups, theme, location }) => {
  const [phase, setPhase] = useState<Phase>('closed');
  const [view, setView] = useState<'settings' | 'theme'>('settings');
  const [detent, setDetent] = useState<'half' | 'expanded'>('half');
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [heightTransition, setHeightTransition] = useState<string | undefined>(undefined);
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === 'undefined' ? 0 : window.innerHeight));
  const sheetRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const wasOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const resetGeometry = () => {
    setDetent('half');
    setDragHeight(null);
    setHeightTransition(undefined);
  };

  useEffect(() => {
    clearTimer();
    if (isOpen) {
      wasOpenRef.current = true;
      setView('settings');
      resetGeometry();
      setPhase('open');
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    setPhase('closing');
    timerRef.current = window.setTimeout(() => {
      setPhase('closed');
      setView('settings');
      resetGeometry();
      timerRef.current = null;
    }, UNMOUNT_MS);
  }, [isOpen]);

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (phase === 'closed') return;
    const onResize = () => setViewportHeight(window.innerHeight);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    onResize();
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [phase === 'closed']);

  if (phase === 'closed' || typeof document === 'undefined') return null;

  const openTheme = () => {
    if (phase !== 'open') return;
    setPhase('switching');
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      setView('theme');
      resetGeometry();
      setPhase('open');
      timerRef.current = null;
    }, EXIT_MS);
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const sheet = sheetRef.current;
    if (phase !== 'open' || !sheet || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = sheet.getBoundingClientRect().height;
    const from = detent;
    const ceiling = viewportHeight * EXPANDED;
    setHeightTransition('none');
    setDragHeight(startHeight);

    const move = (moveEvent: PointerEvent) => {
      setDragHeight(Math.min(ceiling, Math.max(0, startHeight - (moveEvent.clientY - startY))));
    };
    const end = (endEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const delta = endEvent.type === 'pointercancel' ? 0 : endEvent.clientY - startY;
      const threshold = startHeight * DRAG_THRESHOLD;
      if (from === 'half' && delta >= threshold) {
        // Dismissed from where the finger left it: the exit runs from the dragged height.
        setHeightTransition('height 0.3s ease-out');
        onCloseRef.current();
        return;
      }
      const next = from === 'half'
        ? (delta <= -threshold ? 'expanded' : 'half')
        : (delta >= threshold ? 'half' : 'expanded');
      setHeightTransition(from === 'half' && next === 'expanded' ? 'height 0.1s ease-out' : 'height 0.08s ease-out');
      setDetent(next);
      setDragHeight(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const dragging = dragHeight !== null && heightTransition === 'none';
  const height = dragHeight ?? viewportHeight * (detent === 'expanded' ? EXPANDED : HALF);
  const scrolls = detent === 'expanded' && !dragging;
  const leaving = phase === 'switching' || phase === 'closing';

  const renderRow = (row: SettingsSheetRow, position: string) => (
    <button
      key={row.id}
      type="button"
      aria-label={row.label}
      onClick={() => {
        if (row.opensTheme) openTheme();
        else row.onSelect?.();
      }}
      className={`willow-settings-sheet-row${position}`}
      style={row.trailingArrow ? undefined : { paddingRight: 16 }}
    >
      <span className="willow-settings-sheet-row-icon">{row.icon}</span>
      <span className="willow-settings-sheet-row-label" style={row.labelStyle}>{row.label}</span>
      {row.trailingArrow && (
        <span className="willow-settings-sheet-row-trailing">
          <MaterialSymbol family="luminous" name="arrow_right" size={28} weight={260} roundness={100} opticalSize={28} />
        </span>
      )}
    </button>
  );

  const settingsList = (
    <div className="willow-settings-sheet-list">
      {groups.map((group, groupIndex) => (
        <React.Fragment key={groupIndex}>
          {groupIndex > 0 && <div className="willow-settings-sheet-gap" aria-hidden="true" />}
          {group.map((row, index) => renderRow(row, rowPosition(index, group.length)))}
        </React.Fragment>
      ))}
      <div className="willow-settings-sheet-gap" aria-hidden="true" />
      <div className="willow-settings-sheet-location">
        <div className="willow-settings-sheet-location-name">
          <span className="willow-settings-sheet-location-dot" aria-hidden="true">circle</span>
          <span className="min-w-0 truncate">{location.title}</span>
        </div>
        <span className="willow-settings-sheet-location-detail">{location.detail}</span>
        <button
          type="button"
          disabled={location.actionDisabled}
          onClick={location.onAction}
          className="willow-settings-sheet-location-action"
        >
          {location.action}
        </button>
      </div>
    </div>
  );

  const themeList = (
    <div className="willow-settings-sheet-list" role="radiogroup" aria-label="Theme">
      <div className="willow-settings-sheet-subheader">Select a theme</div>
      {theme.options.map((option, index) => {
        const selected = option.id === theme.value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => theme.onSelect(option.id)}
            className={`willow-settings-sheet-row${rowPosition(index, theme.options.length)}`}
            style={{ paddingLeft: 16, paddingRight: selected ? 0 : 16 }}
          >
            <span className="willow-settings-sheet-row-label">{option.label}</span>
            {selected && (
              <span className="willow-settings-sheet-row-trailing">
                <MaterialSymbol family="luminous" name="check" size={24} weight={300} roundness={100} opticalSize={24} />
              </span>
            )}
          </button>
        );
      })}
      <div className="willow-settings-sheet-gap" aria-hidden="true" />
      <div className="willow-settings-sheet-row willow-settings-sheet-swatches is-first is-last" role="radiogroup" aria-label="Accent colour">
        {theme.colors.map((color) => {
          const selected = theme.activeColor === color.id;
          return (
            <button
              key={color.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={color.label}
              title={color.label}
              onClick={() => theme.onSelectColor(color.id)}
              style={{ backgroundColor: color.hex }}
              className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform duration-150 active:scale-95 ${selected ? 'scale-105' : ''}`}
            >
              {selected && <span className={`h-3 w-3 rounded-full ${isLight ? 'bg-[#ffffff]' : 'bg-[#1c1c1c]'}`} />}
            </button>
          );
        })}
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[1000]">
      <div
        className={`willow-settings-sheet-backdrop absolute inset-0${phase === 'closing' ? ' is-leaving' : ''}`}
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
      />
      <div
        key={view}
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={view === 'theme' ? 'Theme' : 'Settings'}
        className={`willow-settings-sheet absolute inset-x-0 bottom-0${leaving ? ' is-leaving' : ''}${isLight ? ' is-light' : ''}`}
        style={{
          height,
          maxHeight: 'fit-content',
          transition: heightTransition,
          pointerEvents: leaving ? 'none' : undefined,
        }}
      >
        <div className="willow-settings-sheet-handle-area" onPointerDown={startDrag}>
          <div className="willow-settings-sheet-handle" />
        </div>
        <div
          className="willow-settings-sheet-content"
          style={{ overflowY: scrolls ? 'auto' : 'hidden', pointerEvents: dragging ? 'none' : undefined }}
        >
          {view === 'theme' ? themeList : settingsList}
        </div>
      </div>
    </div>,
    document.body,
  );
};
