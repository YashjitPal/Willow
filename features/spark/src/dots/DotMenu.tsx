import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { goToSparkDots } from '../spark-store';
import { DotDeleteDialog, DotRenameDialog, DotResetDialog } from './DotDialogs';
import { transitionDotNavigation } from './dot-transition';
import { deleteSparkDot, resetSparkDotConversation, sparkDotName, toggleSparkDotPin, type SparkDot } from './dots-store';

const SYMBOL_PROPS = { family: 'luminous' as const, weight: 320, roundness: 100 };
/** The row menu's height with its four actions: less room than this below a row and it opens above it. */
const ROW_MENU_ROOM = 184;

type DotAction = 'rename' | 'pin' | 'reset' | 'delete';

const restoreFocus = (element: HTMLElement | null) => {
  window.requestAnimationFrame(() => element?.focus());
};

/** Arrow keys, Home and End move between a menu's items. */
const moveMenuFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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

/** An open menu closes on a press outside it or on Escape, and its first item takes the focus as it opens. */
function useMenuDismiss(open: boolean, menuRef: RefObject<HTMLDivElement | null>, buttonRef: RefObject<HTMLButtonElement | null>, onOpenChange: (open: boolean) => void) {
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
  }, [open, menuRef, buttonRef]);
}

/**
 * What a bot's ⋮ menus do: Pin at once, the rest through their dialogs. `isOpenBot` is whether the bot is the one on
 * screen, which deleting leaves first.
 */
function useDotActions(dot: SparkDot, isOpenBot: boolean, buttonRef: RefObject<HTMLButtonElement | null>) {
  const [dialog, setDialog] = useState<Exclude<DotAction, 'pin'> | null>(null);
  const closeDialog = () => {
    setDialog(null);
    restoreFocus(buttonRef.current);
  };
  const run = (action: DotAction) => {
    if (action !== 'pin') {
      setDialog(action);
      return;
    }
    toggleSparkDotPin(dot.id);
    restoreFocus(buttonRef.current);
  };
  const dialogs = (
    <>
      {dialog === 'rename' && <DotRenameDialog dot={dot} onClose={closeDialog} />}
      {dialog === 'reset' && (
        <DotResetDialog
          dot={dot}
          onClose={closeDialog}
          onReset={() => {
            closeDialog();
            void resetSparkDotConversation(dot.id);
          }}
        />
      )}
      {dialog === 'delete' && (
        <DotDeleteDialog
          dot={dot}
          onClose={closeDialog}
          onDelete={() => {
            setDialog(null);
            if (!isOpenBot) {
              deleteSparkDot(dot.id);
              return;
            }
            transitionDotNavigation(() => {
              goToSparkDots();
              deleteSparkDot(dot.id);
            });
          }}
        />
      )}
    </>
  );
  return { run, dialogs };
}

/** Rename, Pin, Reset conversation and Delete: the actions both of a bot's ⋮ menus list. */
function DotActionItems({ dot, onChoose }: { dot: SparkDot; onChoose: (action: DotAction) => void }) {
  return (
    <>
      <button type="button" role="menuitem" onClick={() => onChoose('rename')}>
        <MaterialSymbol {...SYMBOL_PROPS} name="edit" size={20} opticalSize={20} />
        <span>Rename</span>
      </button>
      <button type="button" role="menuitem" onClick={() => onChoose('pin')}>
        <MaterialSymbol {...SYMBOL_PROPS} name="push_pin" size={20} opticalSize={20} />
        <span>{dot.pinned ? 'Unpin' : 'Pin'}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => onChoose('reset')}>
        <MaterialSymbol {...SYMBOL_PROPS} name="refresh" size={20} opticalSize={20} />
        <span>Reset conversation</span>
      </button>
      <button type="button" role="menuitem" className="is-danger" onClick={() => onChoose('delete')}>
        <MaterialSymbol {...SYMBOL_PROPS} name="delete" size={20} opticalSize={20} />
        <span>Delete</span>
      </button>
    </>
  );
}

export interface DotMenuProps {
  dot: SparkDot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** An open bot's ⋮ menu, as a Spark task's (SparkTaskDetail.tsx): its actions, then Close. */
export function DotMenu({ dot, open, onOpenChange }: DotMenuProps) {
  const name = sparkDotName(dot);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(open, menuRef, buttonRef, onOpenChange);
  const actions = useDotActions(dot, true, buttonRef);

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
        <div ref={menuRef} id={menuId} className="spark-task-detail__task-menu" role="menu" aria-label={`Actions for ${name}`} onKeyDown={moveMenuFocus}>
          <DotActionItems
            dot={dot}
            onChoose={(action) => {
              onOpenChange(false);
              actions.run(action);
            }}
          />
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

      {actions.dialogs}
    </>
  );
}

export interface DotRowMenuProps extends DotMenuProps {
  /** The row is the bot on screen. */
  selected: boolean;
}

/** A bots list row's ⋮, as a Spark task row's: it shows while the row is hovered, and opens under the row, or above it near the list's foot. */
export function DotRowMenu({ dot, open, selected, onOpenChange }: DotRowMenuProps) {
  const name = sparkDotName(dot);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [opensUp, setOpensUp] = useState(false);
  useMenuDismiss(open, menuRef, buttonRef, onOpenChange);
  const actions = useDotActions(dot, selected, buttonRef);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="spark-task-detail__row-menu-button"
        aria-label={`Open actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          if (!open) {
            const list = event.currentTarget.closest('.spark-dots');
            const bottom = Math.min(list?.getBoundingClientRect().bottom ?? window.innerHeight, window.innerHeight);
            setOpensUp(bottom - event.currentTarget.getBoundingClientRect().bottom < ROW_MENU_ROOM);
          }
          onOpenChange(!open);
        }}
      >
        <MaterialSymbol {...SYMBOL_PROPS} name="more_vert" size={20} opticalSize={20} />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className={`spark-task-detail__list-task-menu${opensUp ? ' opens-up' : ''}`}
          role="menu"
          aria-label={`Actions for ${name}`}
          onKeyDown={moveMenuFocus}
        >
          <DotActionItems
            dot={dot}
            onChoose={(action) => {
              onOpenChange(false);
              actions.run(action);
            }}
          />
        </div>
      )}

      {actions.dialogs}
    </>
  );
}
