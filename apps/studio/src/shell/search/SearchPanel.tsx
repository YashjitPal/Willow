import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCompactViewport } from '@willow/chat/use-compact-viewport';
import { chatDisplayName } from '@willow/storage/local-fs/chat-metadata';
import { isTempChatId, useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { shellPathFor } from '../../app/shell-routes';
import { readPinnedChats } from '../chat-actions';
import { openFoundChat, useChatSearch, type ChatSearchResult } from '../SearchChats';
import { IslandButton, useIslandInteraction } from './IslandButton';
import {
  highlightSegments,
  matchRanges,
  readSearchQuery,
  recentChatIds,
  RECENTS_PAGE_SIZE,
  searchDateLabel,
  SEARCH_DEBOUNCE_COMPACT_MS,
  SEARCH_DEBOUNCE_MS,
  sortSearchResults,
  writeSearchQuery,
  type SearchSortOrder,
  type TextRange,
} from './search-format';
import './search-panel.css';

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** A chat was chosen, before it opens: the drawer closes for it. */
  onChooseChat?: () => void;
  /** A chat (not a Code chat, which opens in Code) has been selected: put Chat on show. */
  onOpenChat?: (chatId: string) => void;
  modelConfig: any;
}

/**
 * Gemini's "Search chats" panel (its `SearchModalDialog` island): a 660px card over a 32% backdrop
 * above 960px, the whole screen below it. It opens and closes in one frame, as Gemini's does.
 */
export const SearchPanel: React.FC<SearchPanelProps> = ({ isOpen, ...props }) => {
  if (!isOpen || typeof document === 'undefined') return null;
  return createPortal(<SearchDialog {...props} />, document.body);
};

const Glyph: React.FC<{ name: string; size: 20 | 24 }> = ({ name, size }) => (
  <MaterialSymbol
    family="luminous"
    name={name}
    size={size}
    weight={size === 24 ? 300 : 320}
    opticalSize={size}
    roundness={100}
    className="willow-search-glyph"
  />
);

const Highlighted: React.FC<{ text: string; ranges: readonly TextRange[] }> = ({ text, ranges }) => (
  <bdi>
    {highlightSegments(text, ranges).map((segment, index) => (segment.highlighted
      ? <span key={index} className="willow-search-match">{segment.text}</span>
      : <React.Fragment key={index}>{segment.text}</React.Fragment>))}
  </bdi>
);

const SKELETONS = {
  recents: [{ height: 16, width: '62%' }, { height: 16, width: '78%' }, { height: 16, width: '54%' }],
  results: [{ height: 20, width: '48%' }, { height: 16, width: '84%' }, { height: 16, width: '64%' }],
};

const Skeleton: React.FC<{ variant: keyof typeof SKELETONS }> = ({ variant }) => (
  <div role="status" aria-label={variant === 'recents' ? 'Loading recent chats' : 'Searching chats'} className="willow-search-skeleton">
    {SKELETONS[variant].map((bar, index) => (
      <span key={index} className="willow-search-skeleton-bar" style={{ height: bar.height, width: bar.width }} />
    ))}
  </div>
);

interface RowProps {
  chatId: string;
  updatedAt: number;
  query: string;
  snippet?: ChatSearchResult['snippet'];
  onChoose: (chatId: string) => void;
}

const ResultRow: React.FC<RowProps> = ({ chatId, updatedAt, query, snippet, onChoose }) => {
  const title = chatDisplayName(chatId);
  return (
    <li className="willow-search-item">
      <a
        className={`willow-search-row${snippet ? ' willow-search-row--snippet' : ''}`}
        href={shellPathFor({ surface: 'chat', chatId })}
        onClick={(event) => {
          // Gemini lets a modified or middle click open the chat in a new tab.
          if (event.button !== 0 || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onChoose(chatId);
        }}
      >
        <span className="willow-search-row-icon" aria-hidden="true"><Glyph name="chat_bubble" size={24} /></span>
        <div className="willow-search-row-text">
          <span className="willow-search-row-title"><Highlighted text={title} ranges={query ? matchRanges(title, query) : []} /></span>
          {snippet && <span className="willow-search-row-snippet"><Highlighted text={snippet.text} ranges={snippet.ranges} /></span>}
        </div>
        <span className="willow-search-row-end"><span className="willow-search-row-date">{searchDateLabel(updatedAt)}</span></span>
      </a>
    </li>
  );
};

const SORT_ORDERS: readonly SearchSortOrder[] = ['relevant', 'recent'];
const SORT_LABELS: Record<SearchSortOrder, string> = { relevant: 'Most relevant', recent: 'Most recent' };
const TYPEAHEAD_RESET_MS = 750;

/** Focus with no keyboard ring, as Base UI hands focus back after a pointer press. */
const focusQuietly = (element: HTMLElement) => element.focus({ preventScroll: true, focusVisible: false } as FocusOptions);

/** Base UI's popups sit on whole device pixels. */
const toDevicePixel = (value: number) => {
  const ratio = window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
};

/** How the sort menu was opened: a click focuses the menu itself, the keys an item at one end. */
type SortMenuOpening = 'pointer' | 'first' | 'last';
type SortMenuClose = 'outside' | 'tab' | 'shift-tab';

const SortMenuItem: React.FC<{
  label: string;
  selected: boolean;
  highlighted: boolean;
  itemRef: (node: HTMLDivElement | null) => void;
  onHover: () => void;
  onLeave: (to: EventTarget | null) => void;
  onChoose: (viaPointer: boolean) => void;
}> = ({ label, selected, highlighted, itemRef, onHover, onLeave, onChoose }) => {
  const interaction = useIslandInteraction<HTMLDivElement>();
  return (
    <div
      ref={itemRef}
      role="menuitem"
      tabIndex={highlighted ? 0 : -1}
      aria-selected={selected ? 'true' : undefined}
      data-highlighted={highlighted ? '' : undefined}
      className="willow-search-menu-item"
      {...interaction}
      onPointerMove={(event) => { if (event.pointerType !== 'touch') onHover(); }}
      onPointerLeave={(event) => { if (event.pointerType !== 'touch') onLeave(event.relatedTarget); }}
      onClick={(event) => onChoose(event.detail !== 0)}
    >
      <div className="willow-search-menu-item-row">
        <span className="willow-search-menu-item-label">{label}</span>
        {selected && <span className="willow-search-menu-item-check" aria-hidden="true"><Glyph name="check" size={20} /></span>}
      </div>
    </div>
  );
};

/**
 * Gemini's sort menu (Base UI): under its button, right edges aligned, 4px between them, opened
 * and closed in one frame. Opened with a click it focuses itself and highlights nothing; from the
 * keys it highlights the first item (the last with ArrowUp). The pointer highlights and focuses
 * the item under it, the arrows wrap, letters jump to an item, and the chosen order keeps its
 * fill and check whatever is highlighted.
 */
const SortMenu: React.FC<{
  anchor: HTMLElement;
  value: SearchSortOrder;
  opening: SortMenuOpening;
  onChoose: (value: SearchSortOrder, viaPointer: boolean) => void;
  onClose: (how: SortMenuClose) => void;
}> = ({ anchor, value, opening, onChoose, onClose }) => {
  const last = SORT_ORDERS.length - 1;
  const [highlighted, setHighlighted] = useState<number | null>(opening === 'pointer' ? null : opening === 'first' ? 0 : last);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const typeahead = useRef({ text: '', timer: 0 });
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const placeUnder = () => {
      const box = anchor.getBoundingClientRect();
      const width = menuRef.current?.getBoundingClientRect().width ?? 0;
      setPlace({ top: toDevicePixel(box.bottom + 4), left: toDevicePixel(box.right - width) });
    };
    placeUnder();
    window.addEventListener('resize', placeUnder);
    return () => window.removeEventListener('resize', placeUnder);
  }, [anchor]);

  useEffect(() => {
    if (!place) return;
    const target = highlighted === null ? menuRef.current : itemRefs.current[highlighted];
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [highlighted, place]);

  useEffect(() => {
    const typed = typeahead.current;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchor.contains(target)) return;
      onCloseRef.current('outside');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.clearTimeout(typed.timer);
    };
  }, [anchor]);

  const typeTo = (char: string) => {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.text += char.toLowerCase();
    state.timer = window.setTimeout(() => { state.text = ''; }, TYPEAHEAD_RESET_MS);
    // One letter again and again steps through the items it starts; more letters narrow in place.
    const repeated = [...state.text].every((c) => c === state.text[0]);
    const needle = repeated ? state.text[0] : state.text;
    const from = (highlighted ?? -1) + (repeated ? 1 : 0);
    for (let step = 0; step < SORT_ORDERS.length; step += 1) {
      const index = (((from + step) % SORT_ORDERS.length) + SORT_ORDERS.length) % SORT_ORDERS.length;
      if (SORT_LABELS[SORT_ORDERS[index]].toLowerCase().startsWith(needle)) {
        setHighlighted(index);
        return;
      }
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label="Sort search results"
      aria-orientation="vertical"
      className="willow-search-menu"
      style={place ? { top: place.top, left: place.left } : { visibility: 'hidden' }}
      onKeyDown={(event) => {
        const typing = typeahead.current.text !== '';
        if (event.key === 'ArrowDown') { event.preventDefault(); setHighlighted((i) => (i === null || i === last ? 0 : i + 1)); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlighted((i) => (i === null || i === 0 ? last : i - 1)); }
        else if (event.key === 'Home') { event.preventDefault(); setHighlighted(0); }
        else if (event.key === 'End') { event.preventDefault(); setHighlighted(last); }
        else if (event.key === 'Tab') { event.preventDefault(); onClose(event.shiftKey ? 'shift-tab' : 'tab'); }
        else if ((event.key === 'Enter' || (event.key === ' ' && !typing)) && highlighted !== null) { event.preventDefault(); onChoose(SORT_ORDERS[highlighted], false); }
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); typeTo(event.key); }
      }}
    >
      {SORT_ORDERS.map((order, index) => (
        <SortMenuItem
          key={order}
          label={SORT_LABELS[order]}
          selected={order === value}
          highlighted={highlighted === index}
          itemRef={(node) => { itemRefs.current[index] = node; }}
          onHover={() => setHighlighted(index)}
          onLeave={(to) => {
            if (to instanceof Node && itemRefs.current.some((item) => item?.contains(to))) return;
            setHighlighted(null);
          }}
          onChoose={(viaPointer) => onChoose(order, viaPointer)}
        />
      ))}
    </div>
  );
};

const SearchDialog: React.FC<Omit<SearchPanelProps, 'isOpen'>> = ({ onClose, onChooseChat, onOpenChat, modelConfig }) => {
  const compact = useCompactViewport();
  const { localChats, getChatTimestamp, chatScopeId, isChatListHydrated, selectLocalFSInboxChat, loadLocalFSChat } = useLocalFS();
  const [value, setValue] = useState(readSearchQuery);
  // What shows follows the query the search has taken up, not the field: Recents or the last
  // results stay through the debounce, as Gemini's do.
  const { query: searched, results, isSearching } = useChatSearch(value, modelConfig, compact ? SEARCH_DEBOUNCE_COMPACT_MS : SEARCH_DEBOUNCE_MS);
  const [sortOrder, setSortOrder] = useState<SearchSortOrder>('relevant');
  const [sortMenu, setSortMenu] = useState<SortMenuOpening | null>(null);
  const [recentsShown, setRecentsShown] = useState(RECENTS_PAGE_SIZE);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const choseChatRef = useRef(false);
  const sortMenuOpenRef = useRef(false);
  sortMenuOpenRef.current = sortMenu !== null;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const recents = useMemo(() => {
    const pinned = readPinnedChats(chatScopeId) ?? [];
    return recentChatIds(localChats.filter((chatId) => !isTempChatId(chatId)), pinned);
  }, [chatScopeId, localChats]);
  const sortedResults = useMemo(() => sortSearchResults(results, sortOrder), [results, sortOrder]);

  const updateValue = useCallback((next: string) => {
    setValue(next);
    writeSearchQuery(next);
    if (!next.trim()) {
      setSortOrder('relevant');
      setSortMenu(null);
    }
  }, []);

  /** The panel's Tab stops in order, the sort menu's items left out. */
  const tabStops = useCallback(() => (dialogRef.current
    ? [...dialogRef.current.querySelectorAll<HTMLElement>('input, button, a[href], [tabindex="0"]')]
      .filter((el) => el.getClientRects().length > 0 && !el.closest('[role="menu"]'))
    : []), []);

  // Focus starts in the field and goes back to the button that opened the panel, as Base UI's dialog
  // does. The button shows keyboard focus as the control that had focus in the panel did; the field
  // always counts as showing it, so from there the browser decides.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus({ preventScroll: true });
    return () => {
      if (choseChatRef.current || !opener?.isConnected) return;
      const last = document.activeElement;
      const quiet = last instanceof HTMLElement && last !== inputRef.current && Boolean(last.closest('.willow-search-panel')) && !last.matches(':focus-visible');
      if (quiet) focusQuietly(opener);
      else opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (sortMenuOpenRef.current) {
          setSortMenu(null);
          sortButtonRef.current?.focus({ preventScroll: true });
        } else {
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== 'Tab' || sortMenuOpenRef.current) return;
      const stops = tabStops();
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [tabStops]);

  const closeSortMenu = useCallback((how: SortMenuClose) => {
    setSortMenu(null);
    const button = sortButtonRef.current;
    if (!button) return;
    if (how === 'tab' || how === 'shift-tab') {
      // Tab leaves the menu for the stop after (or before) its button, as Base UI's does.
      const stops = tabStops();
      const at = stops.indexOf(button);
      const next = stops[(at + (how === 'tab' ? 1 : -1) + stops.length) % stops.length];
      (next ?? button).focus({ preventScroll: true });
    } else {
      // After the press has moved focus where it goes: back to the button unless it went somewhere.
      window.setTimeout(() => {
        const active = document.activeElement;
        if ((!active || active === document.body) && button.isConnected) focusQuietly(button);
      });
    }
  }, [tabStops]);

  // Recents arrive 13 at a time as the list scrolls to its end, as Gemini's pages do.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scroller = scrollerRef.current;
    if (!sentinel || !scroller || searched) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setRecentsShown((shown) => shown + RECENTS_PAGE_SIZE);
    }, { root: scroller });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [searched, recentsShown, isChatListHydrated]);

  const chooseChat = useCallback((chatId: string) => {
    choseChatRef.current = true;
    onChooseChat?.();
    openFoundChat(chatScopeId, chatId, selectLocalFSInboxChat, loadLocalFSChat, onOpenChat);
    onCloseRef.current();
  }, [chatScopeId, loadLocalFSChat, onChooseChat, onOpenChat, selectLocalFSInboxChat]);

  let body: React.ReactNode;
  if (!searched) {
    body = !isChatListHydrated ? <Skeleton variant="recents" /> : (
      <>
        <h2 className="willow-search-heading">Recents</h2>
        <div className="willow-search-scroll">
          <div ref={scrollerRef} className="willow-search-viewport" tabIndex={0}>
            <ul className="willow-search-list">
              {recents.slice(0, recentsShown).map((chatId) => (
                <ResultRow key={chatId} chatId={chatId} updatedAt={getChatTimestamp(chatId)} query="" onChoose={chooseChat} />
              ))}
              {recentsShown < recents.length && <li ref={sentinelRef} className="willow-search-sentinel" aria-hidden="true" />}
            </ul>
          </div>
        </div>
      </>
    );
  } else if (isSearching) {
    body = <Skeleton variant="results" />;
  } else if (sortedResults.length === 0) {
    body = <p className="willow-search-empty">No results found</p>;
  } else {
    body = (
      <>
        <div className="willow-search-heading-row">
          <h2 className="willow-search-heading willow-search-heading--inline">Results</h2>
          <IslandButton
            ref={sortButtonRef}
            aria-haspopup="menu"
            aria-expanded={sortMenu !== null}
            className="willow-search-pill willow-search-pill--sort"
            // Enter and Space click with no detail: those open on the first item, as the arrows do.
            onClick={(event) => setSortMenu((open) => (open ? null : event.detail === 0 ? 'first' : 'pointer'))}
            onKeyDown={(event) => {
              if (sortMenu !== null || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
              event.preventDefault();
              setSortMenu(event.key === 'ArrowDown' ? 'first' : 'last');
            }}
          >
            <span className="willow-search-pill-icon" aria-hidden="true"><Glyph name="sort" size={20} /></span>
            <span className="willow-search-pill-label">{SORT_LABELS[sortOrder]}</span>
          </IslandButton>
        </div>
        <div className="willow-search-scroll">
          <div ref={scrollerRef} className="willow-search-viewport" tabIndex={0}>
            <ul className="willow-search-list">
              {sortedResults.map((result) => (
                <ResultRow key={result.chatId} chatId={result.chatId} updatedAt={result.updatedAt} query={searched} snippet={result.snippet} onChoose={chooseChat} />
              ))}
            </ul>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="willow-search-backdrop" aria-hidden="true" />
      <div
        className="willow-search-positioner"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.dataset.pressedOutside = 'true';
        }}
        onClick={(event) => {
          const pressedOutside = event.currentTarget.dataset.pressedOutside === 'true';
          delete event.currentTarget.dataset.pressedOutside;
          if (pressedOutside && event.target === event.currentTarget) onClose();
        }}
      >
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Search chats" className="willow-search-panel">
          <section role="search" aria-label="Search chats" className="willow-search-section">
            <div className="willow-search-header">
              <div
                className="willow-search-field"
                onMouseDown={(event) => {
                  // A press anywhere on the row but its buttons puts the caret in the field.
                  const target = event.target as HTMLElement;
                  if (target !== inputRef.current && !target.closest('button')) {
                    event.preventDefault();
                    inputRef.current?.focus();
                  }
                }}
              >
                <span className="willow-search-field-icon"><span role="img" aria-label="Search chats icon"><Glyph name="search" size={24} /></span></span>
                <input
                  ref={inputRef}
                  className="willow-search-input"
                  type="text"
                  value={value}
                  placeholder="Search chats"
                  aria-label="Search chats"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => updateValue(event.target.value)}
                />
                {value && (
                  <IslandButton
                    aria-label="Clear search"
                    className="willow-search-pill willow-search-pill--clear"
                    onClick={() => {
                      updateValue('');
                      inputRef.current?.focus();
                    }}
                  >
                    <span className="willow-search-pill-label">Clear</span>
                  </IslandButton>
                )}
                <IslandButton aria-label="Close" className="willow-search-close" onClick={onClose}>
                  <Glyph name="close" size={20} />
                </IslandButton>
              </div>
            </div>
            <section className="willow-search-body">{body}</section>
          </section>
          {sortMenu !== null && sortButtonRef.current && (
            <SortMenu
              anchor={sortButtonRef.current}
              value={sortOrder}
              opening={sortMenu}
              onChoose={(order, viaPointer) => {
                setSortOrder(order);
                setSortMenu(null);
                const button = sortButtonRef.current;
                if (!button) return;
                if (viaPointer) focusQuietly(button);
                else button.focus({ preventScroll: true });
              }}
              onClose={closeSortMenu}
            />
          )}
        </div>
      </div>
    </>
  );
};

export default SearchPanel;
