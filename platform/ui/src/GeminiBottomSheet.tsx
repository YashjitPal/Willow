import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from './MaterialSymbol';
import './GeminiBottomSheet.css';

/*
 * Gemini's `gem-bottom-sheet` in its content-height form: what Gemini opens at 960px and
 * below where the desktop shows a menu (the Spark task-list filter, a saved instruction's
 * actions). Measured at 390x844 and 800x1280; see GeminiBottomSheet.css for the surface.
 *
 * Dragging the handle down past 20% of the sheet's height dismisses it from wherever the
 * finger left it; a shorter drag springs back.
 */
const DRAG_THRESHOLD = 0.2;
/* Gemini's overlay leaves the DOM ~188ms after a close: the 150ms exit plus a frame or two. */
const UNMOUNT_MS = 180;
const SPRING_BACK_MS = 80;

type Phase = 'closed' | 'open' | 'closing';

export const GeminiBottomSheet: React.FC<{
  isOpen: boolean;
  /** Asks the owner to close. The sheet plays its own exit once `isOpen` drops. */
  onClose: () => void;
  label: string;
  isLight?: boolean;
  /** On the layer, e.g. to lift the sheet over a dialog that opened it. */
  className?: string;
  children: React.ReactNode;
}> = ({ isOpen, onClose, label, isLight = false, className, children }) => {
  const [phase, setPhase] = useState<Phase>('closed');
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [heightTransition, setHeightTransition] = useState<string | undefined>(undefined);
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

  useEffect(() => {
    clearTimer();
    if (isOpen) {
      wasOpenRef.current = true;
      setDragHeight(null);
      setHeightTransition(undefined);
      setPhase('open');
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    setPhase('closing');
    timerRef.current = window.setTimeout(() => {
      setPhase('closed');
      setDragHeight(null);
      setHeightTransition(undefined);
      timerRef.current = null;
    }, UNMOUNT_MS);
  }, [isOpen]);

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (phase !== 'open') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [phase]);

  if (phase === 'closed' || typeof document === 'undefined') return null;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const sheet = sheetRef.current;
    if (phase !== 'open' || !sheet || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = sheet.getBoundingClientRect().height;
    setHeightTransition('none');
    setDragHeight(startHeight);

    const move = (moveEvent: PointerEvent) => {
      setDragHeight(Math.min(startHeight, Math.max(0, startHeight - (moveEvent.clientY - startY))));
    };
    const end = (endEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const delta = endEvent.type === 'pointercancel' ? 0 : endEvent.clientY - startY;
      if (delta >= startHeight * DRAG_THRESHOLD) {
        setHeightTransition('height 0.3s ease-out');
        onCloseRef.current();
        return;
      }
      setHeightTransition(`height ${SPRING_BACK_MS}ms ease-out`);
      setDragHeight(startHeight);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        setDragHeight(null);
        setHeightTransition(undefined);
        timerRef.current = null;
      }, SPRING_BACK_MS);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const leaving = phase === 'closing';
  return createPortal(
    <div className={`gemini-bottom-sheet-layer${className ? ` ${className}` : ''}`}>
      <div
        className={`gemini-bottom-sheet-backdrop${leaving ? ' is-leaving' : ''}`}
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`gemini-bottom-sheet${leaving ? ' is-leaving' : ''}${isLight ? ' is-light' : ''}`}
        style={{
          height: dragHeight ?? undefined,
          transition: heightTransition,
          pointerEvents: leaving ? 'none' : undefined,
        }}
      >
        <div className="gemini-bottom-sheet-handle-area" onPointerDown={startDrag}>
          <div className="gemini-bottom-sheet-handle" />
        </div>
        <div className="gemini-bottom-sheet-content">{children}</div>
      </div>
    </div>,
    document.body,
  );
};

/** The `gem-list` card a sheet of actions holds: rows of a glyph and a label. */
export const GeminiSheetList: React.FC<{ label?: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="gemini-sheet-list" role="menu" aria-label={label}>
    {children}
  </div>
);

export const GeminiSheetItem: React.FC<{
  /** A Luminous Symbols ligature. */
  icon?: string;
  /** Drawn in the 24px icon slot instead of `icon`, for another face or a logo. */
  glyph?: React.ReactNode;
  label: string;
  onSelect: () => void;
}> = ({ icon, glyph, label, onSelect }) => (
  <button type="button" role="menuitem" className="gemini-sheet-item" onClick={onSelect}>
    <span className="gemini-sheet-item-icon" aria-hidden="true">
      {glyph ?? (icon && (
        <MaterialSymbol family="luminous" name={icon} size={24} weight={300} roundness={100} opticalSize={24} />
      ))}
    </span>
    <span className="gemini-sheet-item-label">{label}</span>
  </button>
);
