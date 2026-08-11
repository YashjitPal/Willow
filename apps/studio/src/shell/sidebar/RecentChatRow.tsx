import React from 'react';
import { Pin, Terminal } from 'lucide-react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { SidebarItem } from './SidebarPrimitives';

/**
 * One Recents row.
 *
 * Extracted and memoized because the Recents list renders one of these per chat,
 * and the sidebar redraws often — on scroll (`isScrolled`/`isAtScrollEnd`), on
 * hover-driven menu state, on every keystroke while renaming, and on every
 * LocalFSContext change (its provider value is a bare object literal).
 *
 * Memoizing `SidebarItem` alone did nothing, which is why this exists: the list
 * used to build `actions`, `onClick` and `customLabel` inline per row, so React
 * saw new props on every render regardless. Every prop here is therefore a
 * primitive or a callback that must be identity-stable across renders — the
 * caller wraps its handlers in `useEventCallback` for exactly this reason. Adding
 * an object/array/inline-arrow prop silently un-memoizes the whole list.
 *
 * `editValue` is deliberately NOT hoisted into a shared object: only the row
 * being renamed reads it, so a keystroke re-renders that one row.
 */
export interface RecentChatRowProps {
  chatId: string;
  displayName: string;
  isCollapsed: boolean;
  isActive: boolean;
  isPinned: boolean;
  startedInCode: boolean;
  isEditing: boolean;
  isMenuOpen: boolean;
  editValue: string;
  onSelect: (chatId: string) => void;
  onMenuClick: (event: React.MouseEvent, chatId: string) => void;
  onEditValueChange: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
}

const RecentChatRowImpl: React.FC<RecentChatRowProps> = ({
  chatId,
  displayName,
  isCollapsed,
  isActive,
  isPinned,
  startedInCode,
  isEditing,
  isMenuOpen,
  editValue,
  onSelect,
  onMenuClick,
  onEditValueChange,
  onEditCommit,
  onEditCancel,
}) => (
  <SidebarItem
    flushRight
    label={displayName}
    customLabel={
      isEditing ? (
        <input
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onBlur={onEditCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEditCommit();
            if (e.key === 'Escape') onEditCancel();
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          className="w-full bg-transparent border-b border-white/20 text-white font-medium text-[13.5px] outline-none px-1 py-0.5 min-w-0"
        />
      ) : (
        <div className="flex items-center gap-1.5 min-w-0 w-full">
          <span className="truncate flex-1">{displayName}</span>
          {isPinned && <Pin size={10} className="text-amber-400 shrink-0 transform rotate-45" />}
        </div>
      )
    }
    isCollapsed={isCollapsed}
    active={isActive}
    onClick={() => onSelect(chatId)}
    keepActionsVisible={isMenuOpen || startedInCode}
    actions={
      /*
       * Measured on Gemini's Recents row: BUTTON 24x24, `dxFromRowRight: 8`,
       * `dyFromRowTop: 4`, background transparent with `border-radius: 9999px`,
       * padding 0. It is revealed by `visibility: hidden -> visible` with
       * `opacity: 1` in BOTH states, so there is no fade. The hover tint comes
       * from a `.mat-mdc-button-persistent-ripple` child at rgb(196, 199, 197)
       * opacity 0.08 — the button's own background never changes.
       *
       * The Terminal overlay is Willow's own "started in Code mode" marker and
       * has no Gemini counterpart; it is left as it was.
       */
      <button
        onClick={(e) => onMenuClick(e, chatId)}
        aria-label={`More options for ${displayName}`}
        className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 text-[#e6e6e6] before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 before:content-[''] hover:before:opacity-[0.08] ${
          isMenuOpen || startedInCode ? 'visible' : 'invisible group-hover/item:visible'
        }`}
      >
        {startedInCode && !isMenuOpen && (
          <span
            title="Started in Code mode"
            className="absolute inset-0 z-10 flex items-center justify-center rounded-full bg-white/10 transition-opacity group-hover/item:pointer-events-none group-hover/item:opacity-0"
          >
            <Terminal size={14} strokeWidth={2} aria-hidden="true" />
          </span>
        )}
        <MaterialSymbol
          name="more_vert"
          family="luminous"
          size={20}
          weight={320}
          roundness={100}
          opticalSize={20}
          className={`relative ${
            startedInCode && !isMenuOpen ? 'opacity-0 transition-opacity group-hover/item:opacity-100' : ''
          }`}
        />
      </button>
    }
  />
);

export const RecentChatRow = React.memo(RecentChatRowImpl);
