/**
 * The Language row's combobox and its dropdown.
 *
 * Upstream is a Radix Select; Willow has no `@radix-ui/react-select` dependency
 * (only checkbox, label and slot are installed), so the behaviour that was
 * measured is reproduced directly rather than pulling in a package whose
 * defaults would then need overriding back to the captured values.
 *
 * What was measured, and is reproduced here:
 *
 *   - the popover is item-aligned, not edge-aligned: the selected row's centre
 *     lands on the trigger's centre, so the list opens over its own trigger
 *   - a fixed -7.2px horizontal offset, with min-width = triggerWidth + 7.2
 *   - a 10px viewport margin the height is clamped to
 *   - resting background transparent on every row, including the selected one;
 *     the tick is the only selected affordance
 *
 * See `voice-settings-constants.ts` for the capture each number came from.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { CheckSmIcon, ChevronDownSmIcon } from './voice-settings-icons';
import type { LanguageOption } from './voice-providers';
import {
  COMBOBOX_MAX_WIDTH,
  LISTBOX_MAX_HEIGHT_VH,
  LISTBOX_MAX_WIDTH,
  LISTBOX_MIN_HEIGHT,
  LISTBOX_MIN_WIDTH,
  LISTBOX_OFFSET_X,
  LISTBOX_PADDING_Y,
  LISTBOX_VIEWPORT_MARGIN,
  LISTBOX_Z_INDEX,
  OPTION_HEIGHT,
} from './voice-settings-constants';
import './voice-settings.css';

type Placement = {
  left: number;
  top: number;
  minWidth: number;
  maxHeight: number;
};

/**
 * Where the popover goes, from the measured algorithm.
 *
 * `left` and `minWidth` are the trigger's, shifted by the captured 7.2px.
 * Vertically the selected row is aligned to the trigger's centre, then the whole
 * box is clamped into the viewport's 10px margins — which is where the captured
 * height of 283.2 came from (826 − 10 − 532.4 = 283.6, the 0.4 being the
 * trigger rect's sub-pixel rounding).
 */
const resolvePlacement = (
  trigger: DOMRect,
  selectedIndex: number,
  optionCount: number,
  viewportHeight: number,
): Placement => {
  const margin = LISTBOX_VIEWPORT_MARGIN;
  const available = viewportHeight - margin * 2;

  // Selected row's centre onto the trigger's centre.
  const selectedCentreFromTop =
    LISTBOX_PADDING_Y + selectedIndex * OPTION_HEIGHT + OPTION_HEIGHT / 2;
  const triggerCentre = trigger.top + trigger.height / 2;

  // Clamped into the margins, leaving at least the captured 180px min-height —
  // or the whole available strip, when the viewport is shorter than that.
  const floor = Math.min(LISTBOX_MIN_HEIGHT, available);
  const top = Math.min(
    Math.max(triggerCentre - selectedCentreFromTop, margin),
    viewportHeight - margin - floor,
  );

  const contentHeight = optionCount * OPTION_HEIGHT + LISTBOX_PADDING_Y * 2;
  const maxHeight = Math.min(
    contentHeight,
    viewportHeight - margin - top,
    (viewportHeight * LISTBOX_MAX_HEIGHT_VH) / 100,
  );

  return {
    left: trigger.left + LISTBOX_OFFSET_X,
    top,
    // The wrapper's min-width was captured as trigger + 7.2 — the same 7.2 as
    // the horizontal offset, mirrored. The 220px floor is the listbox's own
    // `min-w-[220px]` and is applied there, not here.
    minWidth: trigger.width - LISTBOX_OFFSET_X,
    maxHeight,
  };
};

export type LanguageSelectProps = {
  options: LanguageOption[];
  value: string;
  onChange: (code: string) => void;
  /** Id of the row's label, wired to the trigger the way the capture has it. */
  labelId: string;
};

export const LanguageSelect: React.FC<LanguageSelectProps> = ({
  options,
  value,
  onChange,
  labelId,
}) => {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selectedIndex = Math.max(
    options.findIndex((o) => o.code === value),
    0,
  );
  const selected = options[selectedIndex];

  // Keyboard highlight, seeded to the selection each time the list opens — which
  // is what the captured `data-highlighted` on the checked row shows.
  const [highlighted, setHighlighted] = useState(selectedIndex);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPlacement(
      resolvePlacement(
        trigger.getBoundingClientRect(),
        selectedIndex,
        options.length,
        window.innerHeight,
      ),
    );
  }, [options.length, selectedIndex]);

  // Before paint, so the list never shows at a stale position for a frame.
  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [measure, open]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => measure();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [measure, open]);

  // Scroll the selected row into view when the list is taller than its clamp —
  // with 98 languages it always is, and without this the list opens at the top
  // rather than on the current value.
  useEffect(() => {
    if (!open || !placement) return;
    const list = listRef.current;
    if (!list) return;
    const rowTop = LISTBOX_PADDING_Y + selectedIndex * OPTION_HEIGHT;
    const target = rowTop - (placement.maxHeight - OPTION_HEIGHT) / 2;
    list.scrollTop = Math.max(target, 0);
  }, [open, placement, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (listRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.code);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const openList = () => {
    setHighlighted(selectedIndex);
    setOpen(true);
  };

  const moveHighlight = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), options.length - 1);
    setHighlighted(clamped);
    const list = listRef.current;
    if (!list) return;
    const rowTop = LISTBOX_PADDING_Y + clamped * OPTION_HEIGHT;
    if (rowTop < list.scrollTop) list.scrollTop = rowTop;
    else if (rowTop + OPTION_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = rowTop + OPTION_HEIGHT - list.clientHeight;
    }
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (open) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openList();
    }
  };

  // Arrow/Home/End/Enter/Escape are the listbox keys Radix binds; the
  // single-character jump is its typeahead. Neither is a captured visual detail —
  // they are the interaction contract of the control being cloned, kept so a
  // 98-row list stays usable from the keyboard.
  const onListKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveHighlight(highlighted + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveHighlight(highlighted - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveHighlight(0);
        break;
      case 'End':
        event.preventDefault();
        moveHighlight(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(highlighted);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setOpen(false);
        break;
      default: {
        if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
        const needle = event.key.toLowerCase();
        const from = highlighted + 1;
        const order = [...options.slice(from), ...options.slice(0, from)];
        const hit = order.find((o) => o.label.toLowerCase().startsWith(needle));
        if (hit) moveHighlight(options.indexOf(hit));
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="none"
        aria-labelledby={labelId}
        aria-controls={open ? 'willow-vs-language-listbox' : undefined}
        data-state={open ? 'open' : 'closed'}
        dir="ltr"
        // Measured: h-9 (36), px-2/py-1 (8/4), gap-1 (4), rounded-lg (8),
        // max-w-60 (240), text-sm/leading-none (14/14), transparent background
        // with a transparent 1px border, hover #414141, text #fff, right-aligned.
        className="inline-flex h-9 max-w-60 cursor-pointer items-center justify-end gap-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-right text-sm leading-none text-white outline-none hover:bg-[#414141] active:bg-[#414141]"
        style={{ maxWidth: COMBOBOX_MAX_WIDTH }}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onTriggerKeyDown}
      >
        <span style={{ pointerEvents: 'none' }}>{selected?.label}</span>
        <span aria-hidden="true">
          <ChevronDownSmIcon />
        </span>
      </button>

      {open && placement && (
        // The popper wrapper carries only position and box constraints, exactly as
        // the captured inline style does; the surface below it carries the paint.
        <div
          className="fixed flex flex-col"
          style={{
            left: placement.left,
            top: placement.top,
            minWidth: placement.minWidth,
            maxHeight: placement.maxHeight,
            zIndex: LISTBOX_Z_INDEX,
          }}
        >
          <div
            className="willow-vs-shadow-long flex select-none flex-col overflow-hidden rounded-2xl bg-[#353535]"
            style={{ maxHeight: '100%', minWidth: LISTBOX_MIN_WIDTH, maxWidth: LISTBOX_MAX_WIDTH }}
          >
            <div
              ref={listRef}
              id="willow-vs-language-listbox"
              role="listbox"
              aria-labelledby={labelId}
              tabIndex={-1}
              autoFocus
              className="relative outline-none"
              style={{
                flex: '1 1 0%',
                overflowX: 'hidden',
                overflowY: 'auto',
                paddingTop: LISTBOX_PADDING_Y,
                paddingBottom: LISTBOX_PADDING_Y,
              }}
              onKeyDown={onListKeyDown}
            >
              {options.map((option, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <div
                    key={option.code}
                    role="option"
                    aria-selected={isSelected}
                    data-state={isSelected ? 'checked' : 'unchecked'}
                    data-highlighted={index === highlighted ? '' : undefined}
                    tabIndex={-1}
                    className="willow-vs-menu-item"
                    onPointerMove={() => setHighlighted(index)}
                    onClick={() => commit(index)}
                  >
                    <span>{option.label}</span>
                    {isSelected && (
                      <span aria-hidden="true" className="willow-vs-menu-item-trailing">
                        <CheckSmIcon />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LanguageSelect;

