import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import './MenuPanel.css';

/*
 * Willow's menu, for the desktop app's own: the strip's File, Edit and View (AppMenu), the
 * right-click menu (ContextMenu) and the rail's. It is the pane Willow's menus are drawn in —
 * the Recents row's and the settings menu's, Gemini's `mat-menu` as measured (Sidebar.tsx,
 * `GEMINI_MENU_ITEM_CLASS`) — and moves as they do (`willow-mat-menu-enter` / `-exit`). See
 * MenuPanel.css for what it adds that those menus have no row for.
 */

export type MenuIconFamily = 'luminous' | 'google-symbols' | 'material-rounded';

export interface MenuIcon {
  name: string;
  /** The face that has the glyph: Luminous wherever it does, as Willow's menus draw them. */
  family: MenuIconFamily;
}

export interface MenuPanelItem {
  label: string;
  icon?: MenuIcon;
  shortcut?: string;
  disabled?: boolean;
  /** A check box's state; on, a check is drawn at the row's end. */
  checked?: boolean;
  run: () => void;
}

export type MenuPanelEntry = MenuPanelItem | 'separator';

export interface MenuPanelProps {
  entries: MenuPanelEntry[];
  label: string;
  isLight: boolean;
  /** Where the pane's corner goes: under the strip's button, or at the pointer. */
  at: { x: number; y: number };
  /**
   * `button`: the pane hangs from its button, slides to stay on screen and takes the keyboard.
   * `pointer`: it opens from the pointer toward whichever side has room, and leaves the keyboard
   * where it was, since its commands act on what has it.
   */
  from: 'button' | 'pointer';
  closing: boolean;
  /** `byKey`: Escape or Tab, after which the keyboard goes back where it was. */
  onClose: (byKey: boolean) => void;
  /** Keys the pane has no use for itself (the strip's arrows between its menus). */
  onOtherKey?: (key: string) => boolean;
}

/** How near the pane comes to the window's edges. */
const MARGIN = 8;

const glyph = (icon: MenuIcon, className?: string) => (
  <MaterialSymbol
    name={icon.name}
    family={icon.family}
    size={20}
    weight={320}
    roundness={icon.family === 'material-rounded' ? undefined : 100}
    opticalSize={20}
    className={className}
  />
);

export function MenuPanel({ entries, label, isLight, at, from, closing, onClose, onOtherKey }: MenuPanelProps) {
  const pane = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const [place, setPlace] = useState<{ left: number; top: number; origin: string } | null>(null);
  const usable = entries.flatMap((entry, index) => (entry !== 'separator' && !entry.disabled ? [index] : []));

  useLayoutEffect(() => {
    const element = pane.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const right = window.innerWidth - MARGIN;
    const bottom = window.innerHeight - MARGIN;
    let left = at.x;
    let top = at.y;
    let originX = 'left';
    let originY = 'top';
    if (left + width > right) {
      if (from === 'pointer' && at.x - width >= MARGIN) {
        left = at.x - width;
        originX = 'right';
      } else {
        left = Math.max(MARGIN, right - width);
      }
    }
    if (top + height > bottom) {
      if (from === 'pointer' && at.y - height >= MARGIN) {
        top = at.y - height;
        originY = 'bottom';
      } else {
        top = Math.max(from === 'button' ? 0 : MARGIN, bottom - height);
      }
    }
    setPlace({ left, top, origin: `${originX} ${originY}` });
    setHighlighted(-1);
  }, [at.x, at.y, from, entries.length]);

  // Once placed: hidden while it is measured, the pane cannot take the keyboard before.
  const placed = place !== null;
  useLayoutEffect(() => {
    if (placed && from === 'button') pane.current?.focus({ preventScroll: true });
  }, [placed, from]);

  const run = (index: number) => {
    const entry = entries[index];
    if (closing || entry === undefined || entry === 'separator' || entry.disabled) return;
    entry.run();
  };

  const onKey = (key: string): boolean => {
    if (closing) return false;
    const at = usable.indexOf(highlighted);
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      if (usable.length === 0) return true;
      if (key === 'ArrowDown') setHighlighted(usable[(at + 1) % usable.length]);
      else if (key === 'ArrowUp') setHighlighted(usable[(at <= 0 ? usable.length : at) - 1]);
      else setHighlighted(key === 'Home' ? usable[0] : usable[usable.length - 1]);
    } else if (key === 'Enter' || key === ' ') {
      if (highlighted >= 0) run(highlighted);
    } else if (key === 'Escape' || key === 'Tab') {
      onClose(true);
    } else {
      return onOtherKey?.(key) ?? false;
    }
    return true;
  };

  // The latest handlers, for listeners added once while the pane is up.
  const handlers = useRef({ onClose, onKey });
  handlers.current = { onClose, onKey };

  useEffect(() => {
    const outside = (event: Event) => {
      if (!pane.current?.contains(event.target as Node)) handlers.current.onClose(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (handlers.current.onKey(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const close = () => handlers.current.onClose(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('wheel', outside, { capture: true, passive: true });
    // A strip menu stays while the strip takes the keyboard to switch menus; the strip closes it
    // when the window goes behind another.
    if (from === 'pointer') {
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('blur', close);
    }
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('wheel', outside, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [from]);

  return createPortal(
    <div
      ref={pane}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className={`willow-menu${isLight ? ' willow-menu--light' : ''} ${closing ? 'willow-mat-menu-exit' : 'willow-mat-menu-enter'}`}
      style={
        place
          ? { left: place.left, top: place.top, transformOrigin: place.origin, pointerEvents: closing ? 'none' : undefined }
          : { left: at.x, top: at.y, visibility: 'hidden' }
      }
      onKeyDown={from === 'button' ? (event) => { if (onKey(event.key)) event.preventDefault(); } : undefined}
      // A press in the pane moves neither the keyboard nor a selection in the page.
      onPointerDown={(event) => event.preventDefault()}
      onPointerLeave={() => setHighlighted(-1)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entries.map((entry, index) =>
        entry === 'separator' ? (
          <div key={`separator-${index}`} className="willow-menu__separator" role="separator" />
        ) : (
          <div
            key={`${index}-${entry.label}`}
            role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={entry.checked}
            aria-disabled={entry.disabled || undefined}
            className="willow-menu__item"
            data-highlighted={index === highlighted ? '' : undefined}
            onPointerMove={() => setHighlighted(entry.disabled ? -1 : index)}
            onClick={() => run(index)}
          >
            <span className="willow-menu__icon">{entry.icon && glyph(entry.icon)}</span>
            <span className="willow-menu__label">{entry.label}</span>
            {entry.shortcut && <span className="willow-menu__shortcut">{entry.shortcut}</span>}
            {entry.checked && glyph({ name: 'check', family: 'luminous' }, 'willow-menu__check')}
          </div>
        ),
      )}
    </div>,
    document.body,
  );
}
