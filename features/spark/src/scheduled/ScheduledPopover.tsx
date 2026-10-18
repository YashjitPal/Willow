import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Where an overlay sits against its trigger, as the CDK positions Gemini's `gem-popover`s: its
 * start or end edge on the trigger's, `offsetY` below, and above instead when below would run
 * off the window. `offsetX` moves it along (the pane's More options sits 52px right).
 */
export interface PopoverPlacement {
  align: 'start' | 'end';
  offsetX?: number;
  offsetY: number;
}

export const placePopover = (
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>,
  size: { width: number; height: number },
  placement: PopoverPlacement,
  viewport: { width: number; height: number },
): { left: number; top: number; above: boolean } => {
  const x = placement.align === 'start'
    ? anchor.left + (placement.offsetX ?? 0)
    : anchor.right + (placement.offsetX ?? 0) - size.width;
  const below = anchor.bottom + placement.offsetY;
  const above = anchor.top - placement.offsetY - size.height;
  const fitsBelow = below + size.height <= viewport.height;
  const useAbove = !fitsBelow && above >= 0;
  return {
    left: Math.max(0, Math.min(x, viewport.width - size.width)),
    top: useAbove ? above : below,
    above: useAbove,
  };
};

interface AnchoredLayerProps {
  anchor: HTMLElement | null;
  placement: PopoverPlacement;
  className?: string;
  children: React.ReactNode;
  layerRef?: React.Ref<HTMLDivElement>;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  role?: string;
  ariaLabel?: string;
}

/** A layer on `<body>` at the trigger, measured before it paints and kept there on scroll and resize. */
export const AnchoredLayer: React.FC<AnchoredLayerProps> = ({
  anchor,
  placement,
  className = '',
  children,
  layerRef,
  onKeyDown,
  role,
  ariaLabel,
}) => {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const placementRef = useRef(placement);
  placementRef.current = placement;

  const measure = useCallback(() => {
    const layer = ownRef.current;
    if (!layer || !anchor) return;
    const next = placePopover(
      anchor.getBoundingClientRect(),
      { width: layer.offsetWidth, height: layer.offsetHeight },
      placementRef.current,
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPosition((current) => (current && current.left === next.left && current.top === next.top ? current : { left: next.left, top: next.top }));
  }, [anchor]);

  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  const setRefs = useCallback((node: HTMLDivElement | null) => {
    ownRef.current = node;
    if (typeof layerRef === 'function') layerRef(node);
    else if (layerRef) (layerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [layerRef]);

  return createPortal(
    <div
      ref={setRefs}
      role={role}
      aria-label={ariaLabel}
      tabIndex={-1}
      className={`sched-scope sched-popover ${className}`.trim()}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
};

/** Closes on a press outside both the layer and its trigger, and lets that press through. */
export const useOutsidePress = (open: boolean, refs: React.RefObject<HTMLElement | null>[], onOutside: () => void): void => {
  const handler = useRef(onOutside);
  handler.current = onOutside;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (refs.some((ref) => ref.current && target && ref.current.contains(target))) return;
      handler.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, refs]);
};

export interface GemMenuEntry {
  key: string;
  label: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  /** A single-select's chosen option: filled. */
  selected?: boolean;
  /** A multi-select's ticked option: its checkbox only. */
  checked?: boolean;
  disabled?: boolean;
  /** Keeps the menu open: a multi-select's checkboxes. */
  keepOpen?: boolean;
  onSelect: () => void;
}

interface GemMenuProps {
  anchor: HTMLElement | null;
  open: boolean;
  entries: readonly (GemMenuEntry | 'divider')[];
  placement: PopoverPlacement;
  /** How it opened: a keyboard opening starts on the first item, a pointer one on none. */
  openedBy: 'pointer' | 'keyboard';
  onClose: (reason: 'select' | 'escape' | 'outside' | 'tab') => void;
  className?: string;
  maxHeight?: number;
  ariaLabel?: string;
}

/**
 * Gemini's `gem-menu` in a `gem-popover`: it opens and closes in one frame, has no backdrop (a
 * press outside closes it and still reaches what it lands on), and is driven like a menu by
 * the arrow keys, Home/End, Enter and Space, Escape and Tab.
 */
export const GemMenu: React.FC<GemMenuProps> = ({
  anchor,
  open,
  entries,
  placement,
  openedBy,
  onClose,
  className = '',
  maxHeight,
  ariaLabel,
}) => {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(anchor);
  anchorRef.current = anchor;
  const pressRefs = useRef([layerRef, anchorRef]).current;
  const items = entries.filter((entry): entry is GemMenuEntry => entry !== 'divider');
  const firstEnabled = items.findIndex((item) => !item.disabled);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!open) return;
    setActive(openedBy === 'keyboard' ? firstEnabled : -1);
    const frame = requestAnimationFrame(() => layerRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useOutsidePress(open, pressRefs, () => onClose('outside'));

  if (!open) return null;

  const step = (from: number, by: number): number => {
    for (let index = 1; index <= items.length; index += 1) {
      const next = (from + by * index + items.length * 2) % items.length;
      if (!items[next]!.disabled) return next;
    }
    return from;
  };

  const choose = (item: GemMenuEntry) => {
    if (item.disabled) return;
    item.onSelect();
    if (!item.keepOpen) onClose('select');
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((current) => step(current < 0 ? -1 : current, 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => step(current < 0 ? items.length : current, -1)); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(step(-1, 1)); }
    else if (event.key === 'End') { event.preventDefault(); setActive(step(items.length, -1)); }
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = items[active];
      if (item) choose(item);
    } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose('escape'); }
    else if (event.key === 'Tab') { onClose('tab'); }
  };

  let itemIndex = -1;
  return (
    <AnchoredLayer anchor={anchor} placement={placement} layerRef={layerRef} onKeyDown={onKeyDown} role="menu" ariaLabel={ariaLabel}>
      <div className={`sched-menu ${className}`.trim()} style={maxHeight ? { maxHeight } : undefined}>
        {entries.map((entry, index) => {
          if (entry === 'divider') return <div key={`divider-${index}`} className="sched-menu-divider" role="separator" />;
          itemIndex += 1;
          const position = itemIndex;
          return (
            <div
              key={entry.key}
              role={entry.keepOpen ? 'menuitemcheckbox' : 'menuitem'}
              aria-disabled={entry.disabled || undefined}
              aria-checked={entry.keepOpen ? Boolean(entry.checked) : undefined}
              className={`sched-menu-item${entry.selected ? ' is-selected' : ''}${active === position ? ' is-active' : ''}`}
              onMouseEnter={() => { if (!entry.disabled) setActive(position); }}
              onMouseLeave={() => setActive((current) => (current === position ? -1 : current))}
              onClick={() => choose(entry)}
            >
              {entry.icon}
              <span className="sched-menu-item-label"><span className="sched-body-s">{entry.label}</span></span>
              <span className="sched-menu-item-trailing">{entry.trailing}</span>
            </div>
          );
        })}
      </div>
    </AnchoredLayer>
  );
};
