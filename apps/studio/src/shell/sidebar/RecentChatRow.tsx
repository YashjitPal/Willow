import React from 'react';
import { MoreVertical, Pin, Terminal } from 'lucide-react';
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
      <button
        onClick={(e) => onMenuClick(e, chatId)}
        aria-label={`More options for ${displayName}`}
        className={`relative flex h-[22px] w-[22px] items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white transition-colors shrink-0 ${
          isMenuOpen || startedInCode ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'
        }`}
      >
        {startedInCode && !isMenuOpen && (
          <span
            title="Started in Code mode"
            className="absolute inset-0 flex items-center justify-center rounded-md bg-white/10 group-hover/item:opacity-0 group-hover/item:pointer-events-none transition-opacity"
          >
            <Terminal size={14} strokeWidth={2} aria-hidden="true" />
          </span>
        )}
        <MoreVertical
          size={14}
          aria-hidden="true"
          className={startedInCode && !isMenuOpen ? 'opacity-0 group-hover/item:opacity-100 transition-opacity' : undefined}
        />
      </button>
    }
  />
);

export const RecentChatRow = React.memo(RecentChatRowImpl);
