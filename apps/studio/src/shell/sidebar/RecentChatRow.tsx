import React from 'react';
import { Terminal } from 'lucide-react';
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
 * Renaming no longer happens in the row. Gemini's Recents menu raises a modal
 * "Rename this chat" dialog, so the row lost its inline `<input>` and the
 * per-keystroke re-render that came with it.
 */
export interface RecentChatRowProps {
  chatId: string;
  displayName: string;
  isCollapsed: boolean;
  isActive: boolean;
  isPinned: boolean;
  startedInCode: boolean;
  isMenuOpen: boolean;
  onSelect: (chatId: string) => void;
  onMenuClick: (event: React.MouseEvent, chatId: string) => void;
}

const RecentChatRowImpl: React.FC<RecentChatRowProps> = ({
  chatId,
  displayName,
  isCollapsed,
  isActive,
  isPinned,
  startedInCode,
  isMenuOpen,
  onSelect,
  onMenuClick,
}) => (
  <SidebarItem
    flushRight
    label={displayName}
    isCollapsed={isCollapsed}
    active={isActive}
    onClick={() => onSelect(chatId)}
    keepActionsVisible={isPinned || isMenuOpen || startedInCode}
    actions={
      <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
        {/*
         * Gemini's pinned marker, measured off its own Recents row: `push_pin`
         * in Luminous Symbols, 16px glyph, `"FILL" 0, "GRAD" 0, "ROND" 100,
         * "opsz" 16, "wght" 330`, in `rgb(230,230,230)` — the row's own text
         * colour, not an accent. It sits in the exact same 24x24 trailing box
         * flush with the row's right padding as the three-dots menu button.
         *
         * The pin and the three-dot menu share one trailing slot: the pin is
         * the resting state and the menu replaces it, so the row never shows
         * both and the icon does not shift between states.
         */}
        {isPinned && (
          <span
            className={`absolute inset-0 flex items-center justify-center pointer-events-none ${
              isMenuOpen || startedInCode ? 'hidden' : 'group-hover/item:hidden'
            }`}
          >
            <MaterialSymbol
              name="push_pin"
              family="luminous"
              size={16}
              weight={330}
              roundness={100}
              opticalSize={16}
              className="text-[#e6e6e6]"
            />
          </span>
        )}
        <button
          onClick={(e) => onMenuClick(e, chatId)}
          aria-label={`More options for ${displayName}`}
          className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 text-[#e6e6e6] before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 before:content-[''] hover:before:opacity-[0.08] ${
            isMenuOpen || startedInCode
              ? 'visible'
              : 'invisible group-hover/item:visible'
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
      </div>
    }
  />
);

export const RecentChatRow = React.memo(RecentChatRowImpl);
