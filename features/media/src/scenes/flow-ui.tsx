// Flow's current Material primitives for the Scenebuilder: icon, spinner, menu, snackbar.
// Styling lives in `flow-ui.css`; the geometry here (menu placement, submenu offsets) is
// measured off flow.google.com — see the comments at each number.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { useCompactViewport } from '@willow/chat/use-compact-viewport';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { $snack, dismissSnack, type SnackState } from './scene-store';
import './flow-ui.css';

/** A Google Symbols glyph with Flow's two axes. Flow's default weight is 400; menus use 300. */
export const FlowIcon: React.FC<{
  name: string;
  size?: number;
  weight?: number;
  fill?: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({ name, size = 18, weight = 400, fill = false, className, style }) => (
  <MaterialSymbol
    name={name}
    family="google-symbols"
    size={size}
    weight={weight}
    variationSettings={`"FILL" ${fill ? 1 : 0}, "wght" ${weight}`}
    className={className}
    style={style}
  />
);

/** Material's indeterminate spinner, sized by `size`. Colour comes from `currentColor`. */
export const FlowSpinner: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => {
  const graphic = (
    <svg className="sb-spinner__graphic" viewBox="0 0 7.6 7.6" focusable="false" aria-hidden="true">
      <circle cx="50%" cy="50%" r="3" />
    </svg>
  );
  return (
    <span role="progressbar" aria-label="Loading…" className={`sb-spinner ${className ?? ''}`} style={{ width: size, height: size }}>
      <span className="sb-spinner__container">
        <span className="sb-spinner__layer">
          <span className="sb-spinner__clipper sb-spinner__clipper--left">{graphic}</span>
          <span className="sb-spinner__gap">{graphic}</span>
          <span className="sb-spinner__clipper sb-spinner__clipper--right">{graphic}</span>
        </span>
      </span>
    </span>
  );
};

/** Material's exit is 100ms after a 25ms delay; the menu unmounts when it ends. */
export const MENU_EXIT_TOTAL_MS = 125;

/** Keeps something mounted through its exit animation. */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    if (!mounted) return undefined;
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, mounted, exitMs]);
  return { mounted, closing: mounted && !open };
}

export type MenuAnchor =
  /** Under a trigger, left edges aligned; flips to right-aligned and/or above when it must. */
  | { kind: 'below'; rect: DOMRect }
  /** A context menu: top-left corner at the pointer. */
  | { kind: 'point'; x: number; y: number }
  /** A submenu beside its trigger row. */
  | { kind: 'submenu'; rect: DOMRect }
  /** Above a trigger, left edges aligned — the Add clip popover (button top 596 → panel bottom 587.6). */
  | { kind: 'above'; rect: DOMRect };

/** CDK fits overlays against the bare viewport: Flow's clip menu ends at y 824 in an 825px window. */
const VIEWPORT_MARGIN = 0;

function place(anchor: MenuAnchor, w: number, h: number): { left: number; top: number; origin: string } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (anchor.kind === 'point') {
    const left = anchor.x + w > vw - VIEWPORT_MARGIN ? Math.max(VIEWPORT_MARGIN, anchor.x - w) : anchor.x;
    const top = anchor.y + h > vh - VIEWPORT_MARGIN ? Math.max(VIEWPORT_MARGIN, anchor.y - h) : anchor.y;
    return { left, top, origin: `${left < anchor.x ? 'right' : 'left'} ${top < anchor.y ? 'bottom' : 'top'}` };
  }
  const r = anchor.rect;
  if (anchor.kind === 'above') {
    const left = Math.min(Math.max(VIEWPORT_MARGIN, r.left), vw - VIEWPORT_MARGIN - w);
    const above = r.top - 8.4 - h;
    const top = above >= VIEWPORT_MARGIN ? above : r.bottom + 8.4;
    return { left, top, origin: `left ${above >= VIEWPORT_MARGIN ? 'bottom' : 'top'}` };
  }
  if (anchor.kind === 'submenu') {
    // Measured on Flow's tile menu: a submenu that opens to the right starts 16px inside its
    // trigger row; one that opens to the left ends 12px inside it. Both sit 8px below the row's
    // top edge (row top 220.8 → panel top 228.8).
    const after = r.right - 16;
    const before = r.left + 12 - w;
    const fitsAfter = after + w <= vw - VIEWPORT_MARGIN;
    const left = fitsAfter ? after : Math.max(VIEWPORT_MARGIN, before);
    let top = r.top + 8;
    if (top + h > vh - VIEWPORT_MARGIN) top = Math.max(VIEWPORT_MARGIN, vh - VIEWPORT_MARGIN - h);
    return { left, top, origin: `${fitsAfter ? 'left' : 'right'} top` };
  }
  // A trigger menu sits flush under the trigger (more_vert at y 88..116 → panel at 116), its left
  // edge on the trigger's ("after"), or its right edge on the trigger's ("before") when the
  // panel would run off the right of the window.
  const fitsAfter = r.left + w <= vw - VIEWPORT_MARGIN;
  const left = fitsAfter ? r.left : Math.max(VIEWPORT_MARGIN, r.right - w);
  const fitsBelow = r.bottom + h <= vh - VIEWPORT_MARGIN;
  const top = fitsBelow ? r.bottom : Math.max(VIEWPORT_MARGIN, r.top - h);
  return { left, top, origin: `${fitsAfter ? 'left' : 'right'} ${fitsBelow ? 'top' : 'bottom'}` };
}

interface MenuCtx {
  closeAll: () => void;
  openSub: string | null;
  setOpenSub: (id: string | null) => void;
}
const MenuContext = React.createContext<MenuCtx | null>(null);

/**
 * Flow's `mat-menu` panel. Portals to <body>, positions itself before paint, and closes on
 * Escape (stopping it, so the Scenebuilder behind stays open) or a press outside.
 *
 * Outside means two things, as in CDK. A menu opened from a trigger sits on a transparent
 * full-window backdrop: the trigger loses hover (so its tooltip drops), nothing behind reacts
 * to the pointer, and a click outside only closes the menu. A context menu (a `point` anchor)
 * has no backdrop and closes on any press elsewhere, which then goes through.
 *
 * Below 961px every menu is a bottom sheet over a dimmed backdrop, as Willow's narrow menus are
 * (`media-responsive.css`): a context menu included, and a submenu as a sheet over its parent,
 * whose own backdrop goes back to the parent.
 */
export const FlowMatMenu: React.FC<{
  open: boolean;
  onClose: () => void;
  anchor: MenuAnchor | null;
  /** `popover` is the Add clip panel's styling rather than a mat-menu's. */
  variant?: 'menu' | 'popover';
  ariaLabel?: string;
  /** Elements that toggle the menu themselves, so a press on them is not an outside press. */
  ignoreRefs?: React.RefObject<HTMLElement | null>[];
  children: React.ReactNode;
}> = ({ open, onClose, anchor, variant = 'menu', ariaLabel, ignoreRefs, children }) => {
  const { mounted, closing } = usePresence(open, MENU_EXIT_TOTAL_MS);
  const sheet = useCompactViewport();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const parent = React.useContext(MenuContext);
  const lastAnchor = useRef(anchor);
  if (anchor) lastAnchor.current = anchor;

  useLayoutEffect(() => {
    if (!mounted || !panelRef.current) return;
    // A sheet is placed by its stylesheet, docked to the bottom of the window, so it needs no
    // anchor: a phone opens some menus from More, without their header trigger.
    if (sheet) {
      setPos({ left: 0, top: 0, origin: 'bottom center' });
      return;
    }
    if (!lastAnchor.current) return;
    const el = panelRef.current;
    setPos(place(lastAnchor.current, el.offsetWidth, el.offsetHeight));
  }, [mounted, anchor, sheet]);

  useEffect(() => { if (!open) setOpenSub(null); }, [open]);

  const backdrop = sheet || (!parent && lastAnchor.current?.kind !== 'point');

  useEffect(() => {
    if (!open || parent) return undefined;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (target instanceof Element && target.closest('[data-sb-menu]')) return;
      if (ignoreRefs?.some((r) => r.current?.contains(target))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    if (!backdrop) document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, parent, ignoreRefs, backdrop]);

  const closeAll = useCallback(() => { if (parent) parent.closeAll(); else onClose(); }, [parent, onClose]);
  const ctx = React.useMemo<MenuCtx>(() => ({ closeAll, openSub, setOpenSub }), [closeAll, openSub]);

  if (!mounted) return null;
  const style: React.CSSProperties = {
    left: pos?.left ?? -9999,
    top: pos?.top ?? -9999,
    transformOrigin: pos?.origin,
    visibility: pos ? 'visible' : 'hidden',
  };
  return createPortal(
    <MenuContext.Provider value={ctx}>
      {backdrop && open && (
        <div
          className={`sb-menu-backdrop${sheet ? ' is-sheet' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
        />
      )}
      <div
        ref={panelRef}
        role="menu"
        aria-label={ariaLabel}
        data-sb-menu=""
        className={`${variant === 'popover' ? 'sb-popover' : 'sb-menu'}${sheet ? ' is-sheet' : ''}${closing ? ' sb-menu--closing' : ''}`}
        style={style}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {variant === 'popover' ? children : <div className="sb-menu__content">{children}</div>}
      </div>
    </MenuContext.Provider>,
    document.body,
  );
};

let subSeq = 0;

/** A `flow-menu-item` row. A row with `submenu` opens it on hover, the way Material does. */
export const FlowMatMenuItem: React.FC<{
  /** A Google Symbols name, or a 24px element for an icon that is a picture (Flow Music's). */
  icon?: React.ReactNode;
  /** Flow's menus set glyphs at weight 300; filled for a state row such as Favorite. */
  iconFill?: boolean;
  thumb?: string;
  label: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** Keeps the menu open after selecting (the caller closes it). */
  keepOpen?: boolean;
  submenu?: React.ReactNode;
  ariaLabel?: string;
  className?: string;
}> = ({ icon, iconFill, thumb, label, danger, disabled, onSelect, keepOpen, submenu, ariaLabel, className }) => {
  const ctx = React.useContext(MenuContext);
  const rowRef = useRef<HTMLDivElement>(null);
  const [subId] = useState(() => `sub-${++subSeq}`);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const subOpen = !!submenu && ctx?.openSub === subId;

  const openSubmenu = () => {
    if (!submenu || !rowRef.current) return;
    setRect(rowRef.current.getBoundingClientRect());
    ctx?.setOpenSub(subId);
  };

  return (
    <>
      <div
        ref={rowRef}
        role="menuitem"
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        aria-haspopup={submenu ? 'menu' : undefined}
        aria-expanded={submenu ? subOpen : undefined}
        tabIndex={disabled ? -1 : 0}
        className={[
          'sb-menu-item',
          icon ? 'sb-menu-item--icon' : '',
          thumb ? 'sb-menu-item--thumb' : '',
          danger ? 'sb-menu-item--danger' : '',
          disabled ? 'is-disabled' : '',
          subOpen ? 'is-highlighted' : '',
          className ?? '',
        ].filter(Boolean).join(' ')}
        onMouseEnter={() => {
          if (submenu) openSubmenu();
          else ctx?.setOpenSub(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          if (submenu) { openSubmenu(); return; }
          onSelect?.();
          if (!keepOpen) ctx?.closeAll();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            (e.currentTarget as HTMLElement).click();
          }
        }}
      >
        <span className="sb-menu-item__inner">
          <span className="sb-menu-item__left">
            {thumb && <img src={thumb} alt="" style={{ width: 40, height: 40, borderRadius: 12, objectFit: 'cover' }} />}
            {typeof icon === 'string' ? <FlowIcon name={icon} size={24} weight={300} fill={iconFill} /> : icon}
            <span className="sb-menu-item__label">{label}</span>
          </span>
          {submenu && (
            <svg className="sb-menu-item__submenu" viewBox="0 0 5 10" focusable="false" aria-hidden="true">
              <polygon points="0,0 5,5 0,10" />
            </svg>
          )}
        </span>
      </div>
      {submenu && (
        <FlowMatMenu open={subOpen} onClose={() => ctx?.setOpenSub(null)} anchor={rect ? { kind: 'submenu', rect } : null}>
          {submenu}
        </FlowMatMenu>
      )}
    </>
  );
};

export const FlowMatDivider: React.FC = () => <div role="separator" className="sb-menu-divider" />;

/* ------------------------------------------------------------------ *
 * Editable text — `flow-editable-text`: the editor's title and the tile Rename overlay.
 * ------------------------------------------------------------------ */

/**
 * A text input that reads as plain text until pressed. Editing shows Done and Cancel; Enter
 * commits, and Escape or losing focus cancels — Flow reverts a title that is clicked away from.
 * The input is sized to its text plus one character, as Flow's is.
 */
export const FlowEditableText: React.FC<{
  value: string;
  onCommit: (value: string) => void;
  /** Opens already editing, caret at the end. */
  autoEdit?: boolean;
  /** After a commit or a cancel. */
  onDone?: () => void;
}> = ({ value, onCommit, autoEdit = false, onDone }) => {
  const [editing, setEditing] = useState(autoEdit);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useLayoutEffect(() => {
    if (!autoEdit) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoEdit]);
  const finish = (next: string | null) => {
    if (next !== null && next && next !== value) onCommit(next);
    setDraft(value);
    setEditing(false);
    inputRef.current?.blur();
    onDone?.();
  };
  return (
    <span className="sb-editable">
      <input
        ref={inputRef}
        className={`sb-editable__input${editing ? ' is-editing' : ''}`}
        type="text"
        aria-label="Editable text"
        size={Math.max(1, (editing ? draft : value).length + 1)}
        value={editing ? draft : value}
        readOnly={!editing}
        onMouseDown={() => { if (!editing) setEditing(true); }}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(draft.trim());
          else if (e.key === 'Escape') finish(null);
        }}
        onBlur={(e) => {
          const next = e.relatedTarget as HTMLElement | null;
          if (next?.closest('.sb-edit-buttons')) return;
          if (editing) finish(null);
        }}
      />
      {editing && (
        <span className="sb-edit-buttons">
          <button type="button" aria-label="Done" className="sb-icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => finish(draft.trim())}>
            <FlowIcon name="done" size={18} />
          </button>
          <button type="button" aria-label="Cancel" className="sb-icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => finish(null)}>
            <FlowIcon name="close" size={18} />
          </button>
        </span>
      )}
    </span>
  );
};

/**
 * Flow's `rename-tile-overlay`: the tile's name in an editable field, on a dimmed page. It is
 * centred on the tile, straddling its bottom edge. The backdrop fades in over 400ms; a press on
 * it closes without saving, and everything leaves at once.
 */
export const FlowRenameOverlay: React.FC<{
  open: boolean;
  /** The tile being renamed. */
  anchor: DOMRect | null;
  value: string;
  onCommit: (value: string) => void;
  onClose: () => void;
}> = ({ open, anchor, value, onCommit, onClose }) => {
  const paneRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!open || !anchor || !el) { setPos(null); return; }
    setPos({ left: anchor.left + anchor.width / 2 - el.offsetWidth / 2, top: anchor.bottom - el.offsetHeight / 2 });
  }, [open, anchor]);
  if (!open || !anchor) return null;
  return createPortal(
    <>
      <div
        className="sb-rename-backdrop"
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
      />
      <div
        ref={paneRef}
        className="sb-rename"
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <FlowEditableText value={value} autoEdit onCommit={onCommit} onDone={onClose} />
      </div>
    </>,
    document.body,
  );
};

/* ------------------------------------------------------------------ *
 * Snackbar host — mount once; every scene action reports through `showSnack`.
 * ------------------------------------------------------------------ */

const SNACK_EXIT_MS = 75;

export const SceneSnackbarHost: React.FC = () => {
  const snack = useStore($snack);
  const [shown, setShown] = useState<SnackState | null>(snack);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (snack) {
      setShown(snack);
      setClosing(false);
      return undefined;
    }
    if (!shown) return undefined;
    setClosing(true);
    const timer = window.setTimeout(() => { setShown(null); setClosing(false); }, SNACK_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [snack]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown) return null;
  return createPortal(
    <div
      key={shown.id}
      role="status"
      aria-live="polite"
      className={`sb-snackbar${closing ? ' sb-snackbar--closing' : ''}${shown.tone && shown.tone !== 'accent' ? ` sb-snackbar--${shown.tone}` : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="sb-snackbar__surface">
        <div className="sb-snackbar__content">
          <div className="sb-snackbar__label">
            {shown.icon === 'spinner'
              ? <FlowSpinner size={20} />
              : <FlowIcon name={shown.icon} size={24} weight={300} className="sb-snackbar__icon" />}
            <span>{shown.text}</span>
          </div>
          <div className="sb-snackbar__actions">
            {shown.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className="sb-btn sb-btn--text"
                onClick={() => {
                  a.run?.();
                  dismissSnack(shown.id);
                }}
              >
                <span>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
