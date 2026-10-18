import React, { useRef, useState } from 'react';
import type { DropdownOption } from './scheduled-model';
import { GemMenu, type GemMenuEntry, type PopoverPlacement } from './ScheduledPopover';
import { SchedIcon } from './ScheduledIcons';

/** Gemini's `scheduled-dropdown` positions: end-aligned 4px below, else 4px above. */
const DROPDOWN_PLACEMENT: PopoverPlacement = { align: 'end', offsetY: 4 };

interface ScheduledDropdownProps<T> {
  ariaLabel: string;
  options: readonly DropdownOption<T>[];
  value?: T;
  /** A multi-select: its ticked values. */
  values?: readonly T[];
  multiple?: boolean;
  /** What the trigger reads, when it is not the chosen option's label. */
  summary?: string;
  disabled?: boolean;
  onChange?: (value: T) => void;
  onValuesChange?: (values: T[]) => void;
}

/**
 * Gemini's `scheduled-dropdown`: a pill that reads its value with a 16px caret, opening a
 * 160px menu of pill options that scrolls past 280px. One option is filled and ticked; a
 * multi-select ticks checkboxes instead and stays open.
 */
export function ScheduledDropdown<T>({
  ariaLabel,
  options,
  value,
  values = [],
  multiple = false,
  summary,
  disabled = false,
  onChange,
  onValuesChange,
}: ScheduledDropdownProps<T>): React.ReactElement {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [openedBy, setOpenedBy] = useState<'pointer' | 'keyboard'>('pointer');

  const chosen = options.find((option) => option.value === value);
  const label = summary ?? chosen?.label ?? (value === undefined ? '' : String(value));

  const entries: GemMenuEntry[] = options.map((option) => {
    const ticked = multiple && values.includes(option.value);
    return {
      key: String(option.value),
      label: option.label,
      selected: !multiple && option.value === value,
      checked: ticked,
      keepOpen: multiple,
      trailing: multiple
        ? <SchedIcon name={ticked ? 'check_box' : 'check_box_outline_blank'} family="google-symbols" className="sched-menu-checkbox" />
        : option.value === value ? <SchedIcon name="check" className="sched-menu-check" /> : null,
      onSelect: () => {
        if (multiple) {
          onValuesChange?.(ticked ? values.filter((entry) => entry !== option.value) : [...values, option.value]);
        } else {
          onChange?.(option.value);
        }
      },
    };
  });

  const close = (reason: 'select' | 'escape' | 'outside' | 'tab') => {
    setOpen(false);
    if (reason === 'escape' || reason === 'select') {
      triggerRef.current?.focus({ preventScroll: true, focusVisible: reason === 'escape' } as FocusOptions);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`sched-dropdown-trigger sched-body-m${open ? ' is-expanded' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          if (open) { setOpen(false); return; }
          setOpenedBy(event.detail === 0 ? 'keyboard' : 'pointer');
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpenedBy('keyboard');
            setOpen(true);
          }
        }}
      >
        <span className="sched-dropdown-label">{label}</span>
        <SchedIcon name="keyboard_arrow_down" size={16} className="sched-dropdown-caret" />
      </button>
      <GemMenu
        anchor={triggerRef.current}
        open={open}
        entries={entries}
        placement={DROPDOWN_PLACEMENT}
        openedBy={openedBy}
        onClose={close}
        className="sched-menu--dropdown"
        maxHeight={280}
        ariaLabel={ariaLabel}
      />
    </>
  );
}
