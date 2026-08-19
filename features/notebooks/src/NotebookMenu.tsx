import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

import './notebooks.css';

/**
 * Gemini's `gem-menu` — the three-dot popup used by both the notebook header and
 * each past-chat row.
 *
 * Recorded from the live app while a human clicked through it, so every number here
 * is measured rather than inferred:
 *
 *   panel        bg `rgb(31,31,31)`, radius **20px**, padding 8px,
 *                shadow `0 0 20px rgba(0,0,0,0.28)`, z-index 1000
 *   item         36px tall, radius **12px**, padding 8px, gap 8px, full panel width
 *   item pitch   36px (rows at dy 8 / 44 / 80 / 116 inside the panel)
 *   icon         20px Luminous, `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320`
 *   label        13px/17px w400 `rgb(230,230,230)`, ink 44px from the panel edge
 *   ink          `rgb(227,227,227)` on the item (the icon inherits it)
 *   hover        `rgba(230,230,230,0.08)` at radius 12px  (real-mouse measured)
 *
 * Both menus are identical apart from width, and width is purely content-driven —
 * each item carries an EMPTY 20px trailing slot beside the label, so the panel comes
 * out at exactly `longest label + 88px`:
 *
 *   8 (panel) + 8 (item) + 20 (icon) + 8 (gap) + label + 8 (gap) + 20 (trailing) + 8 + 8
 *
 * which checks out on both: 111.1 + 88 = 199.1 (notebook) and 142.3 + 88 = 230.3
 * (chat row). So the trailing spacer is load-bearing, not decoration — drop it and
 * both panels come out 28px narrow.
 *
 * ── The open/close animation is Willow's, not Gemini's ─────────────────────
 *
 * Gemini has none: a 49-frame trace of the entrance showed `opacity: 1` from the
 * first frame and a *static* `translateY(4px)` throughout, with no entry in
 * `getAnimations()`. That static 4px is also where the 44px vertical offset comes
 * from — 40px trigger + 4px.
 *
 * It animates anyway, DELIBERATELY, because Willow's chat surface menu does and
 * the two sit in the same corner of the same app — asked for by name. The curves
 * are copied from `ConversationActionsMenu.css` so the two are one behaviour:
 * 120ms `scale(0.8)` in from the top right, 100ms linear out after a 25ms hold.
 * Do not "restore" this to no animation against the Gemini trace.
 *
 * Anchoring, measured on both menus: the panel's RIGHT edge aligns with the
 * trigger's right edge, and its top sits 4px below the trigger's bottom.
 */
export interface NotebookMenuItem {
  label: string;
  icon: string;
  onSelect: () => void;
  /**
   * Gemini tints only the NOTEBOOK menu's Delete (`.project-delete-button`, ink
   * `rgb(242,184,181)` on both glyph and label). The chat-row menu's Delete is
   * measured as ordinary `rgb(230,230,230)` — so this is opt-in per menu, not
   * something keyed off the label text.
   */
  danger?: boolean;
}

export interface NotebookMenuProps {
  /** The trigger's viewport rect — the panel is right-aligned and hung below it. */
  anchor: AnchorRect;
  items: readonly NotebookMenuItem[];
  onClose: () => void;
}

/** A trigger's viewport box, captured at click time. */
export interface AnchorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Snapshot a trigger's box for `anchor`. */
export const rectOf = (el: HTMLElement): AnchorRect => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};

/** Measured: trigger bottom + 4px. */
const ANCHOR_GAP = 4;

/**
 * Marks a three-dot button so the open menu does not treat pressing it as an
 * outside-click. Spread onto the trigger: `<button {...MENU_TRIGGER_ATTR}>`.
 *
 * Without this the toggle cannot close: the document listener below runs on the
 * CAPTURE phase, so it fires before the trigger's own `onClick`, closing the menu a
 * moment before the click re-opens it — and `stopPropagation` on the trigger cannot
 * help, because a document capture listener is the first thing in the path, not the
 * last.
 */
export const MENU_TRIGGER_ATTR = { 'data-nb-menu-trigger': '' } as const;

/**
 * Exit animation plus its 25ms delay. The panel is unmounted by its parent, so
 * this component has to hold the parent off for exactly as long as the animation
 * runs — hence one constant rather than a duration in the CSS and a guess here.
 */
const MENU_EXIT_MS = 125;

export const NotebookMenu: React.FC<NotebookMenuProps> = ({ anchor, items, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | undefined>(undefined);

  /*
   * Every close goes through here so the exit animation is never skipped.
   *
   * The parent owns the mount (`{isHeaderMenuOpen && <NotebookMenu …>}`), so the
   * panel cannot outlive a bare `onClose()` — calling it directly removes the node
   * in the same frame and the animation has nothing to play on. This plays first
   * and reports the close afterwards.
   */
  const requestClose = React.useCallback(() => {
    if (closeTimerRef.current !== undefined) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, MENU_EXIT_MS);
  }, [onClose]);

  useEffect(() => () => {
    if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose(); };
    /*
     * Close on a pointerdown outside the panel. Capture phase, so a click on some
     * other control closes this menu before that control acts on it.
     */
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (panelRef.current?.contains(event.target)) return;
      // A trigger press is a toggle, handled by the trigger itself.
      if (event.target.closest('[data-nb-menu-trigger]')) return;
      requestClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [requestClose]);

  /*
   * Portalled to <body>: the notebook page sits inside the studio shell, whose
   * stacking contexts otherwise paint over a fixed-position panel — the same trap
   * the Sources dialog's scrim hit.
   */
  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      className={`nb-surface nb-menu ${isClosing ? 'nb-menu-exit' : 'nb-menu-enter'}`}
      style={{
        // Right-aligned to the trigger; `right` avoids needing the panel's own width.
        right: Math.max(8, window.innerWidth - (anchor.x + anchor.w)),
        top: anchor.y + anchor.h + ANCHOR_GAP,
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            // The action runs now and the panel fades out behind it, as the chat
            // surface's menu does — waiting for the animation would delay a
            // dialog by the length of a fade.
            requestClose();
            item.onSelect();
          }}
          className={`nb-menu-item ${item.danger ? 'is-danger' : ''}`}
        >
          <MaterialSymbol
            name={item.icon}
            family="luminous"
            size={20}
            weight={320}
            roundness={100}
            opticalSize={20}
          />
          <span className="nb-menu-label">{item.label}</span>
          {/* Empty 20px trailing slot — see the width arithmetic in the header. */}
          <span className="nb-menu-trailing" aria-hidden="true" />
        </button>
      ))}
    </div>,
    document.body,
  );
};
