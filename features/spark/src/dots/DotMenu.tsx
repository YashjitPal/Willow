import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { goToSparkDots } from '../spark-store';
import { DotDeleteDialog, DotRenameDialog } from './DotDialogs';
import { transitionDotNavigation } from './dot-transition';
import { deleteSparkDot, sparkDotName, toggleSparkDotPin, type SparkDot } from './dots-store';

const SYMBOL_PROPS = { family: 'luminous' as const, weight: 320, roundness: 100 };

const restoreFocus = (element: HTMLElement | null) => {
  window.requestAnimationFrame(() => element?.focus());
};

export interface DotMenuProps {
  dot: SparkDot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** An open bot's ⋮ menu, as a Spark task's (SparkTaskDetail.tsx): Rename, Pin, Delete and Close. */
export function DotMenu({ dot, open, onOpenChange }: DotMenuProps) {
  const name = sparkDotName(dot);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  // The conversation re-renders as the bot works; the menu's listeners and first focus belong to it opening.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      onOpenChangeRef.current(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onOpenChangeRef.current(false);
      restoreFocus(buttonRef.current);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Home') items[0].focus();
    else if (event.key === 'End') items[items.length - 1].focus();
    else if (event.key === 'ArrowDown') items[(current + 1 + items.length) % items.length].focus();
    else items[current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length].focus();
  };

  const closeDialog = () => {
    setDialog(null);
    restoreFocus(buttonRef.current);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`spark-task-detail__header-icon${open ? ' is-open' : ''}`}
        aria-label="Bot options"
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => onOpenChange(!open)}
      >
        <MaterialSymbol {...SYMBOL_PROPS} name="more_vert" size={20} opticalSize={20} />
      </button>

      {open && (
        <div ref={menuRef} id={menuId} className="spark-task-detail__task-menu" role="menu" aria-label={`Actions for ${name}`} onKeyDown={handleMenuKeyDown}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenChange(false);
              setDialog('rename');
            }}
          >
            <MaterialSymbol {...SYMBOL_PROPS} name="edit" size={20} opticalSize={20} />
            <span>Rename</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenChange(false);
              toggleSparkDotPin(dot.id);
              restoreFocus(buttonRef.current);
            }}
          >
            <MaterialSymbol {...SYMBOL_PROPS} name="push_pin" size={20} opticalSize={20} />
            <span>{dot.pinned ? 'Unpin' : 'Pin'}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              onOpenChange(false);
              setDialog('delete');
            }}
          >
            <MaterialSymbol {...SYMBOL_PROPS} name="delete" size={20} opticalSize={20} />
            <span>Delete</span>
          </button>
          <div className="spark-task-detail__menu-divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenChange(false);
              transitionDotNavigation(goToSparkDots);
            }}
          >
            <MaterialSymbol {...SYMBOL_PROPS} name="close" size={20} opticalSize={20} />
            <span>Close</span>
          </button>
        </div>
      )}

      {dialog === 'rename' && <DotRenameDialog dot={dot} onClose={closeDialog} />}
      {dialog === 'delete' && (
        <DotDeleteDialog
          dot={dot}
          onClose={closeDialog}
          onDelete={() => {
            setDialog(null);
            transitionDotNavigation(() => {
              goToSparkDots();
              deleteSparkDot(dot.id);
            });
          }}
        />
      )}
    </>
  );
}
