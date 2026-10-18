import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { launchMaterialRipple } from '@willow/chat/material-ripple';
import {
  $chatStatusFilter,
  CHAT_STATUS_FILTERS,
  chatStatusFilterLabel,
  type ChatStatusFilter as Filter,
} from '@willow/chat/chat-status';
import { useCompactViewport } from '@willow/chat/use-compact-viewport';
import './ChatStatusFilter.css';

/**
 * Gemini's chat filter: the funnel at the end of the chat section's heading
 * (`conversation-status-filter-button`) and the `gem-menu` it opens, measured in
 * tools/ui-research/captures/gemini/sort/.
 *
 * The menu hangs from the funnel's left edge 4px down, or sits 4px above it when there is no room
 * below, pushed inside the window, as wide as its longest label. It neither animates in nor out:
 * Gemini's appears and goes in one frame. It has no backdrop either, so a click outside closes it
 * and still lands where it was aimed. Opening focuses the chosen row; the arrows wrap, Home and
 * End jump, Enter or Space chooses and hands focus back to the funnel, as Escape does, and Tab
 * closes it and moves on from the funnel.
 */
const GAP = 4;

/** The row's leading mark, as Gemini draws each filter. */
const Lead: React.FC<{ filter: Filter; compact: boolean }> = ({ filter, compact }) => {
  const size = compact ? 24 : 16;
  const weight = compact ? 300 : 330;
  if (filter === 'READY') return <span className="chat-status-filter-dot" aria-hidden="true" />;
  return (
    <MaterialSymbol
      name={filter === 'ALL' ? 'filter_list' : filter === 'NEEDS_ATTENTION' ? 'flag' : 'progress_activity'}
      family={filter === 'ALL' ? 'google-symbols' : 'luminous'}
      size={size}
      weight={weight}
      roundness={100}
      opticalSize={size}
      className={filter === 'NEEDS_ATTENTION' ? 'chat-status-filter-flag' : undefined}
    />
  );
};

export const ChatStatusFilterButton: React.FC = () => {
  const filter = useStore($chatStatusFilter);
  const compact = useCompactViewport();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const ripplesRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const releaseRippleRef = useRef<(() => void) | null>(null);
  const menuId = React.useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setPlace(null);
    if (refocus) buttonRef.current?.focus();
  }, []);

  const choose = useCallback((next: Filter) => {
    $chatStatusFilter.set(next);
    close(true);
  }, [close]);

  // Placed once the menu has a size: below the funnel, else above it, inside the window.
  const placeMenu = useCallback(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const anchor = button.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const below = anchor.bottom + GAP;
    const top = below + height <= window.innerHeight ? below : Math.max(0, anchor.top - GAP - height);
    const left = Math.max(0, Math.min(anchor.left, window.innerWidth - width));
    setPlace({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
  }, [open, compact, placeMenu]);

  useEffect(() => {
    if (!open || !place) return;
    itemsRef.current[active]?.focus({ preventScroll: true });
  }, [open, place, active]);

  useEffect(() => {
    if (!open) return undefined;
    // No backdrop: a press anywhere else closes the menu and carries on to what it hit.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(false);
    };
    const onMove = () => placeMenu();
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close, placeMenu]);

  const openMenu = () => {
    setActive(Math.max(0, CHAT_STATUS_FILTERS.indexOf(filter)));
    setOpen(true);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const last = CHAT_STATUS_FILTERS.length - 1;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => (i === last ? 0 : i + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i === 0 ? last : i - 1)); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(last); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    // Focus goes back to the funnel first, so the browser's own Tab moves on from there.
    else if (event.key === 'Tab') close(true);
  };

  const pressStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !ripplesRef.current) return;
    releaseRippleRef.current?.();
    // Gemini's icon buttons ripple from their centre (`mat-ripple-loader-centered`).
    const box = ripplesRef.current.getBoundingClientRect();
    releaseRippleRef.current = launchMaterialRipple(ripplesRef.current, 'chat-status-filter-ripple', box.left + box.width / 2, box.top + box.height / 2);
  };
  const pressEnd = () => {
    releaseRippleRef.current?.();
    releaseRippleRef.current = null;
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Filter"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="chat-status-filter-button"
        onClick={() => (open ? close(false) : openMenu())}
        onPointerDown={pressStart}
        onPointerUp={pressEnd}
        onPointerCancel={pressEnd}
        onPointerLeave={pressEnd}
      >
        <span ref={ripplesRef} className="chat-status-filter-ripples" aria-hidden="true" />
        <MaterialSymbol
          name="filter_alt"
          family="luminous"
          size={compact ? 24 : 20}
          weight={compact ? 300 : 320}
          roundness={100}
          opticalSize={compact ? 24 : 20}
          className="chat-status-filter-icon"
        />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Filter"
          className="chat-status-filter-menu"
          style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
          onKeyDown={onMenuKeyDown}
        >
          <div role="none" className="chat-status-filter-list">
            {CHAT_STATUS_FILTERS.map((option, index) => {
              const selected = option === filter;
              return (
                <button
                  key={option}
                  ref={(el) => { itemsRef.current[index] = el; }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  tabIndex={index === active ? 0 : -1}
                  className="chat-status-filter-item"
                  onClick={() => choose(option)}
                  onPointerEnter={() => setActive(index)}
                >
                  <span className="chat-status-filter-lead"><Lead filter={option} compact={compact} /></span>
                  <span className="chat-status-filter-label-box">
                    <span className="chat-status-filter-label">{chatStatusFilterLabel(option)}</span>
                  </span>
                  <span className="chat-status-filter-trail">
                    {selected && (
                      <MaterialSymbol
                        name="check"
                        family="luminous"
                        size={compact ? 24 : 16}
                        weight={compact ? 300 : 330}
                        roundness={100}
                        opticalSize={compact ? 24 : 16}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
