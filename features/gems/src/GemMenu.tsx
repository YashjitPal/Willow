import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

/** A trigger's viewport box, captured when it is pressed. */
export interface GemAnchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const anchorOf = (el: Element): GemAnchor => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};

export interface GemMenuItem {
  label: string;
  icon: string;
  family?: 'google-symbols' | 'luminous';
  onSelect: () => void;
  /** Draws the primary `check_circle` after the label — the chosen default tool. */
  checked?: boolean;
  /** Gemini tints some upload glyphs on-surface rather than on-surface-variant. */
  strongIcon?: boolean;
}

/** Marks a trigger so pressing it toggles the menu rather than counting as an outside press. */
export const GEM_MENU_TRIGGER = { 'data-gem-menu-trigger': '' } as const;

const EXIT_MS = 100;

/**
 * Gemini's `mat-menu` on these pages.
 *
 * `below` hangs the panel from the trigger's bottom-left corner with no gap, as the row
 * and card menus open; `above` stands it 8px over the trigger's top-left, as the Default
 * tool menu opens. Either way it is pushed back inside the viewport. `wide` is the 320px
 * tool menu, padded 16 with a 16px gap; the rest size to their labels.
 *
 * `upload` is a different component on Gemini's side, the knowledge uploader's
 * `upload-file-card-container`: a 216px card of 36px rows with 20px glyphs and 13px
 * labels, its right edge on the trigger's and its bottom 12px over the trigger's top.
 */
export const GemMenu: React.FC<{
  anchor: GemAnchor;
  items: readonly GemMenuItem[];
  onClose: () => void;
  placement?: 'below' | 'above';
  wide?: boolean;
  variant?: 'menu' | 'upload';
  label: string;
}> = ({ anchor, items, onClose, placement = 'below', wide = false, variant = 'menu', label }) => {
  const isUpload = variant === 'upload';
  const panelRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const requestClose = React.useCallback(() => {
    if (timerRef.current !== undefined) return;
    setClosing(true);
    timerRef.current = window.setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
  }, []);

  // Measured before paint; `offset*` because the entrance animation scales the panel.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const start = isUpload ? anchor.x + anchor.w - width : anchor.x;
    const left = Math.max(8, Math.min(start, window.innerWidth - width - 8));
    const below = anchor.y + anchor.h;
    const top = placement === 'above'
      ? Math.max(8, anchor.y - (isUpload ? 12 : 8) - height)
      : (below + height > window.innerHeight - 8 ? Math.max(8, anchor.y - height) : below);
    setPosition({ left, top });
  }, [anchor, placement, isUpload]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose(); };
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (panelRef.current?.contains(event.target)) return;
      if (event.target.closest('[data-gem-menu-trigger]')) return;
      requestClose();
    };
    const onScroll = () => requestClose();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [requestClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      className={`gems-surface gems-menu${wide ? ' is-wide' : ''}${isUpload ? ' is-upload' : ''}${closing ? ' is-closing' : ''}`}
      style={{
        left: position?.left ?? anchor.x,
        top: position?.top ?? anchor.y + anchor.h,
        visibility: position ? 'visible' : 'hidden',
        transformOrigin: `${isUpload ? 'right' : 'left'} ${placement === 'above' ? 'bottom' : 'top'}`,
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="gems-menu-item"
          onClick={() => {
            requestClose();
            item.onSelect();
          }}
        >
          {isUpload ? (
            <span className={`gems-menu-glyph${item.strongIcon ? ' is-strong' : ''}`}>
              <MaterialSymbol
                name={item.icon}
                family={item.family ?? 'google-symbols'}
                size={20}
                variationSettings={item.family === 'luminous'
                  ? '"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320'
                  : '"ROND" 0, "slnt" 0, "wght" 330'}
              />
            </span>
          ) : (
            <MaterialSymbol
              name={item.icon}
              family={item.family ?? 'google-symbols'}
              size={24}
              weight={item.family === 'luminous' ? 300 : 400}
              roundness={item.family === 'luminous' ? 100 : undefined}
              opticalSize={24}
            />
          )}
          <span>{item.label}</span>
          {item.checked && (
            <MaterialSymbol name="check_circle" family="google-symbols" size={20} weight={400} fill className="gems-menu-check" variationSettings={'"FILL" 1, "ROND" 0, "slnt" 0, "wght" 400'} />
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
};
