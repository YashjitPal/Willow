/**
 * Media's header below 961px (`media-responsive.css`). The desktop header is Flow's, measured; this
 * one is Willow's own, laid out the way Willow's narrow pages lay out their top bar: round 44px
 * buttons 4px in from each edge, the title between them, the account avatar last.
 *
 * - A phone leads with the menu button, which opens the rail as a drawer (the drawer starts with
 *   Home). Search, Add and More stay in the bar; View settings and Filters move into More.
 * - A tablet keeps the icon rail, so it leads with Home, and has room for Filters and View settings.
 *   A phone on its side has that room too, but its rail is the drawer, so it leads with the menu.
 * - Inside a collection the leading button goes back, as the desktop's does.
 * - The chevron after the name opens the project menu, as the desktop's three dots there do.
 * - Search covers the whole bar while it is open: back, the field, clear.
 *
 * The buttons take the refs the desktop header's do, so the menus they open are the same menus;
 * below 961px those draw as bottom sheets.
 */
import React from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { Avatar } from '@willow/ui/Avatar';

export type CompactHeaderMenu = 'add' | 'filter' | 'settings' | 'more' | 'project';

export interface MediaCompactHeaderProps {
  viewport: 'phone' | 'tablet';
  /** The rail is a drawer (`useRailDrawer`), opened from the leading menu button. */
  railAsDrawer: boolean;
  /** Hidden while the gallery scrolls down, as the desktop header is. */
  visible: boolean;
  transition?: string;
  inCollection: boolean;
  onBack: () => void;
  onHome: () => void;
  onOpenDrawer: () => void;
  /** The project's (or collection's) editable name, the desktop header's own input. */
  title: React.ReactNode;
  searchOpen: boolean;
  searchQuery: string;
  onSearchQuery: (query: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchFormRef: React.RefObject<HTMLFormElement | null>;
  projectRef: React.RefObject<HTMLButtonElement | null>;
  addRef: React.RefObject<HTMLButtonElement | null>;
  filterRef: React.RefObject<HTMLButtonElement | null>;
  settingsRef: React.RefObject<HTMLButtonElement | null>;
  moreRef: React.RefObject<HTMLButtonElement | null>;
  accountRef: React.RefObject<HTMLButtonElement | null>;
  openMenu: string | null;
  onMenu: (menu: CompactHeaderMenu) => void;
  onAccount: () => void;
  accountName?: string | null;
  accountPhoto?: string | null;
}

const AXES = '"FILL" 0, "wght" 300';

const HeaderButton = React.forwardRef<HTMLButtonElement, {
  glyph: string;
  label: string;
  onClick: () => void;
  expanded?: boolean;
}>(({ glyph, label, onClick, expanded }, ref) => (
  <button
    ref={ref}
    type="button"
    className="mch-button"
    onClick={onClick}
    aria-label={label}
    title={label}
    aria-expanded={expanded}
  >
    <MaterialSymbol name={glyph} family="google-symbols" size={24} weight={400} variationSettings={AXES} />
  </button>
));
HeaderButton.displayName = 'HeaderButton';

export const MediaCompactHeader: React.FC<MediaCompactHeaderProps> = ({
  viewport,
  railAsDrawer,
  visible,
  transition,
  inCollection,
  onBack,
  onHome,
  onOpenDrawer,
  title,
  searchOpen,
  searchQuery,
  onSearchQuery,
  onOpenSearch,
  onCloseSearch,
  searchInputRef,
  searchFormRef,
  projectRef,
  addRef,
  filterRef,
  settingsRef,
  moreRef,
  accountRef,
  openMenu,
  onMenu,
  onAccount,
  accountName,
  accountPhoto,
}) => {
  const tablet = viewport === 'tablet';
  return (
    <header
      className="media-compact-header"
      data-viewport={viewport}
      style={{
        opacity: visible ? 1 : 0,
        visibility: visible ? 'visible' : 'hidden',
        transition,
      }}
    >
      <div className={`mch-bar${searchOpen ? ' is-searching' : ''}`} aria-hidden={searchOpen || undefined}>
        {inCollection ? (
          <HeaderButton glyph="arrow_back" label="Back button to go to previous page" onClick={onBack} />
        ) : railAsDrawer ? (
          <HeaderButton glyph="menu" label="Open menu" onClick={onOpenDrawer} />
        ) : (
          <HeaderButton glyph="home" label="Home" onClick={onHome} />
        )}
        <div className="mch-title">
          {title}
          <HeaderButton ref={projectRef} glyph="keyboard_arrow_down" label="More options for the project" onClick={() => onMenu('project')} expanded={openMenu === 'project'} />
        </div>
        <div className="mch-actions">
          <HeaderButton glyph="search" label="Search" onClick={onOpenSearch} />
          {tablet && (
            <HeaderButton ref={filterRef} glyph="filter_list" label="Filtering and sorting options" onClick={() => onMenu('filter')} expanded={openMenu === 'filter'} />
          )}
          <HeaderButton ref={addRef} glyph="add" label="Add media menu" onClick={() => onMenu('add')} expanded={openMenu === 'add'} />
          {tablet && (
            <HeaderButton ref={settingsRef} glyph="settings_2" label="Tile grid settings" onClick={() => onMenu('settings')} expanded={openMenu === 'settings'} />
          )}
          <HeaderButton ref={moreRef} glyph="more_vert" label="More options" onClick={() => onMenu('more')} expanded={openMenu === 'more'} />
          <button ref={accountRef} type="button" className="mch-avatar" onClick={onAccount} aria-label="Open account menu">
            <Avatar src={accountPhoto ?? undefined} name={accountName ?? undefined} size={32} />
          </button>
        </div>
      </div>
      {searchOpen && (
        <form ref={searchFormRef} className="mch-search" role="search" onSubmit={(e) => e.preventDefault()}>
          <HeaderButton glyph="arrow_back" label="Close search" onClick={onCloseSearch} />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchQuery(e.target.value)}
            placeholder="Search your media"
            aria-label="Search your media"
            enterKeyHint="search"
          />
          {searchQuery && (
            <HeaderButton glyph="close" label="Clear search" onClick={() => { onSearchQuery(''); searchInputRef.current?.focus(); }} />
          )}
          {!tablet && (
            <HeaderButton glyph="filter_list" label="Filtering and sorting options" onClick={() => onMenu('filter')} expanded={openMenu === 'filter'} />
          )}
        </form>
      )}
    </header>
  );
};
