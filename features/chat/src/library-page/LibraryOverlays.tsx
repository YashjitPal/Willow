/**
 * The Library's overlays, as Luminous draws them on Base UI: its tooltip (inverted, 6px under
 * the control, growing in from 0.8), icon buttons with that tooltip, the delete confirmation
 * and the phones' item sheet. Each overlay is portalled into its own `.gm-library-layer` so they
 * stack in the order they open, Escape closes the top one, and focus goes back to what opened it.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type OverlayPhase = 'entering' | 'open' | 'leaving';

/**
 * Mount on open, one frame in `entering` so the CSS transition has a start, then `open`;
 * on close `leaving` for `leaveMs`, then unmounted.
 */
export const useOverlayPhase = (open: boolean, leaveMs: number): OverlayPhase | null => {
  const [phase, setPhase] = useState<OverlayPhase | null>(open ? 'entering' : null);
  useEffect(() => {
    if (open) {
      setPhase('entering');
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setPhase('open'));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    setPhase((current) => (current ? 'leaving' : null));
    const timer = window.setTimeout(() => setPhase(null), leaveMs);
    return () => window.clearTimeout(timer);
  }, [open, leaveMs]);
  return phase;
};

/** Escape closes the overlay on top, and only that one. */
const escapeStack: Array<() => void> = [];
const onEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !escapeStack.length) return;
  event.preventDefault();
  event.stopPropagation();
  escapeStack[escapeStack.length - 1]();
};

export const useEscape = (active: boolean, close: () => void): void => {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return undefined;
    const entry = () => closeRef.current();
    escapeStack.push(entry);
    if (escapeStack.length === 1) window.addEventListener('keydown', onEscape, true);
    return () => {
      const at = escapeStack.lastIndexOf(entry);
      if (at >= 0) escapeStack.splice(at, 1);
      if (!escapeStack.length) window.removeEventListener('keydown', onEscape, true);
    };
  }, [active]);
};

/** Focus moves into the overlay as it opens and back to the opener once it is gone. */
export const useFocusReturn = (active: boolean, into: React.RefObject<HTMLElement | null>): void => {
  useEffect(() => {
    if (!active) return undefined;
    const opener = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => into.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [active, into]);
};

export const OverlayPortal: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) =>
  createPortal(<div className={`gm-library-layer ${className}`.trim()}>{children}</div>, document.body);

/** Luminous's tooltip under a control: centred, 6px down, kept 8px inside the window. */
export const LibraryTooltip: React.FC<{ anchor: HTMLElement | null; label: string }> = ({ anchor, label }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const t = ref.current.getBoundingClientRect();
    const left = Math.min(Math.max(8, a.left + a.width / 2 - t.width / 2), window.innerWidth - 8 - t.width);
    const below = a.bottom + 6;
    const top = below + t.height > window.innerHeight - 8 ? a.top - 6 - t.height : below;
    setPlace({ left, top });
  }, [anchor, label]);
  if (!anchor) return null;
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="gm-library-tooltip"
      style={place ? { left: place.left, top: place.top } : { left: -9999, top: -9999, animation: 'none' }}
    >
      <span>{label}</span>
    </div>,
    document.body,
  );
};

/** Shows the tooltip while the control is hovered or keyboard-focused, and never once it is disabled. */
export const useTooltip = (disabled = false) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (disabled) setAnchor(null);
  }, [disabled]);
  const handlers = {
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' && !disabled) setAnchor(event.currentTarget);
    },
    onPointerLeave: () => setAnchor(null),
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      if (!disabled && event.currentTarget.matches(':focus-visible')) setAnchor(event.currentTarget);
    },
    onBlur: () => setAnchor(null),
    onPointerDown: () => setAnchor(null),
  };
  return { anchor, handlers, hide: () => setAnchor(null) };
};

export const Icon: React.FC<{ name: string; size?: 20 | 24 | 32 | 40; className?: string }> = ({ name, size = 24, className = '' }) => {
  // Luminous's weights per size: s 320, m 300, l and xl 240.
  const weight = size === 20 ? 320 : size === 24 ? 300 : 240;
  return (
    <span
      aria-hidden="true"
      className={`gm-library-icon ${className}`.trim()}
      style={{
        width: size,
        height: size,
        fontSize: size,
        lineHeight: `${size}px`,
        fontVariationSettings: `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" ${weight}`,
      }}
    >
      {name}
    </span>
  );
};

type IconButtonProps = {
  icon: string;
  label: string;
  size?: 's' | 'm';
  variant?: 'plain' | 'tonal' | 'translucent' | 'variant';
  tooltip?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  href?: string;
};

/** Luminous's IconButton: 36px (s, a 20px glyph) or 48px (m, 24px), with an optional tooltip. */
export const IconButton: React.FC<IconButtonProps> = ({ icon, label, size = 's', variant = 'plain', tooltip = true, disabled = false, className = '', onClick, href }) => {
  const tip = useTooltip(disabled || !tooltip);
  const classes = `gm-library-icon-button gm-library-icon-button--${size} ${variant === 'plain' ? '' : `gm-library-icon-button--${variant}`} gm-library-press ${className}`.replace(/\s+/g, ' ').trim();
  const glyph = <Icon name={icon} size={size === 's' ? 20 : 24} />;
  return (
    <>
      {href ? (
        <a href={href} aria-label={label} className={classes} onClick={onClick} {...tip.handlers}>{glyph}</a>
      ) : (
        <button type="button" aria-label={label} className={classes} disabled={disabled} onClick={onClick} {...tip.handlers}>{glyph}</button>
      )}
      {tooltip && tip.anchor && <LibraryTooltip anchor={tip.anchor} label={label} />}
    </>
  );
};

/** "Delete item?": Gemini's confirmation, with its words. */
export const DeleteDialog: React.FC<{ open: boolean; onCancel: () => void; onConfirm: () => void }> = ({ open, onCancel, onConfirm }) => {
  const phase = useOverlayPhase(open, 200);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  useEscape(open, onCancel);
  useFocusReturn(open, dialogRef);
  if (!phase) return null;
  return (
    <OverlayPortal className="gm-library-dialog-layer">
      <div className="gm-library-scrim" data-state={phase} onClick={onCancel} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="gm-library-dialog" data-state={phase} onClick={(event) => event.stopPropagation()}>
        <div className="gm-library-dialog-body">
          <h2 id={titleId} className="gm-library-dialog-title">Delete item?</h2>
          <div><span className="gm-library-body">This action cannot be undone. The item will be deleted from the chat where it was created.</span></div>
        </div>
        <div className="gm-library-dialog-actions">
          <button type="button" className="gm-library-button gm-library-press" onClick={onCancel}><span className="gm-library-body">Cancel</span></button>
          <button type="button" className="gm-library-button gm-library-button--tonal gm-library-press" onClick={onConfirm}><span className="gm-library-body">Delete</span></button>
        </div>
      </div>
    </OverlayPortal>
  );
};

export interface SheetAction {
  icon: string;
  label: string;
  onSelect: () => void;
}

/** Base UI's drawer swipe: its start distance, release speed (px/ms) and speed window (ms). */
const SWIPE_START = 10;
const SWIPE_VELOCITY = 0.5;
const SWIPE_VELOCITY_WINDOW = 80;

/**
 * Drag the sheet down to close it, as Base UI's drawer does: past 10px the sheet follows the
 * pointer; letting go beyond half its height, or moving at 0.5px/ms or faster, closes it, and
 * anything less springs back. The scrim stays as it is meanwhile.
 */
const useSwipeToClose = (sheetRef: React.RefObject<HTMLElement | null>, active: boolean, onClose: () => void): void => {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!active || !sheet) return undefined;
    let start: { id: number; y: number } | null = null;
    let swiping = false;
    let swallowClick = false;
    let samples: Array<{ y: number; t: number }> = [];
    const setOffset = (px: number) => sheet.style.setProperty('--gm-lib-sheet-drag', `${px}px`);
    const stopSwiping = () => {
      swiping = false;
      delete sheet.dataset.swiping;
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || start) return;
      start = { id: event.pointerId, y: event.clientY };
      swallowClick = false;
      samples = [{ y: event.clientY, t: event.timeStamp }];
    };
    const onMove = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      const dy = event.clientY - start.y;
      if (!swiping) {
        if (dy < -SWIPE_START) start = null;
        if (dy < SWIPE_START) return;
        swiping = true;
        sheet.dataset.swiping = '';
        try {
          sheet.setPointerCapture(event.pointerId);
        } catch {
          // The pointer is already gone; its pointerup or pointercancel still ends the swipe.
        }
      }
      samples.push({ y: event.clientY, t: event.timeStamp });
      while (samples.length > 2 && event.timeStamp - samples[0].t > SWIPE_VELOCITY_WINDOW) samples.shift();
      setOffset(Math.max(0, dy));
    };
    const onUp = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      const dy = event.clientY - start.y;
      start = null;
      if (!swiping) return;
      stopSwiping();
      swallowClick = true;
      const recent = samples.find((sample) => event.timeStamp - sample.t <= SWIPE_VELOCITY_WINDOW);
      const velocity = recent ? (event.clientY - recent.y) / Math.max(event.timeStamp - recent.t, 16) : 0;
      if (dy > 0 && (velocity >= SWIPE_VELOCITY || dy > Math.max(sheet.offsetHeight * 0.5, SWIPE_START))) closeRef.current();
      else setOffset(0);
    };
    const onCancel = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      start = null;
      if (!swiping) return;
      stopSwiping();
      setOffset(0);
    };
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    sheet.addEventListener('pointerdown', onDown);
    sheet.addEventListener('pointermove', onMove);
    sheet.addEventListener('pointerup', onUp);
    sheet.addEventListener('pointercancel', onCancel);
    sheet.addEventListener('click', onClick, true);
    return () => {
      sheet.removeEventListener('pointerdown', onDown);
      sheet.removeEventListener('pointermove', onMove);
      sheet.removeEventListener('pointerup', onUp);
      sheet.removeEventListener('pointercancel', onCancel);
      sheet.removeEventListener('click', onClick, true);
    };
  }, [active, sheetRef]);
};

/** Below 769px a tile's More options is a bottom sheet: a handle, then one row per action. */
export const ItemSheet: React.FC<{ open: boolean; title: string; actions: SheetAction[]; onClose: () => void }> = ({ open, title, actions, onClose }) => {
  const phase = useOverlayPhase(open, 300);
  const sheetRef = useRef<HTMLDivElement>(null);
  useEscape(open, onClose);
  useFocusReturn(open, sheetRef);
  useSwipeToClose(sheetRef, open && phase !== null, onClose);
  const choose = useCallback((action: SheetAction) => {
    onClose();
    action.onSelect();
  }, [onClose]);
  if (!phase) return null;
  return (
    <OverlayPortal className="gm-library-sheet-layer">
      <div className="gm-library-scrim" data-state={phase} onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-label={`Options for ${title}`} tabIndex={-1} className="gm-library-sheet" data-state={phase}>
        <div className="gm-library-sheet-handle"><span /></div>
        <div className="gm-library-sheet-content">
          <ul aria-label="Item options" className="gm-library-list" style={{ gap: 0 }}>
            {actions.map((action) => (
              <li key={action.label}>
                <button type="button" className="gm-library-sheet-item gm-library-press" onClick={() => choose(action)}>
                  <Icon name={action.icon} size={24} />
                  <span className="gm-library-body gm-library-truncate" style={{ flex: '1 1 auto' }}>{action.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </OverlayPortal>
  );
};
