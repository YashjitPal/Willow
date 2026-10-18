import React, { useEffect, useRef, useState } from 'react';
import { LmIcon } from './custom-app/LmIcon';
import './CustomizeMobileActions.css';

/*
 * Gemini's `.mobile-header-actions` and `.mobile-search-container` (customize-page, at 768px and below): fixed in
 * the top bar's right corner, 16px in and 12px down. Discover has the search button alone; Connectors and Skills a
 * pill of search and "+" (Create custom app, or the Create menu). Search opens a bar across the top bar, from 64px
 * to 16px short of the right edge, with Close search beside it; closing it clears the query. Hidden above 768px,
 * where the header holds the search field and the buttons.
 */
export const CustomizeMobileActions: React.FC<{
  /** `search`: the lone search button (Discover, a category page); `custom`/`create`: the pill with that "+". */
  variant: 'search' | 'custom' | 'create';
  query: string;
  onQuery: (query: string) => void;
  createOpen?: boolean;
  onCreate?: (trigger: HTMLElement) => void;
  onCustom?: () => void;
}> = ({ variant, query, onQuery, createOpen = false, onCreate, onCustom }) => {
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (searching) inputRef.current?.focus();
  }, [searching]);
  useEffect(() => {
    setSearching(false);
  }, [variant]);
  const close = () => {
    setSearching(false);
    onQuery('');
    requestAnimationFrame(() => searchButtonRef.current?.focus({ preventScroll: true }));
  };

  if (searching) {
    return (
      <div className="customize-mobile-search">
        <div className="customize-mobile-search-bar" role="search">
          <LmIcon name="search" size={24} className="customize-mobile-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="customize-mobile-search-input"
            placeholder="Search"
            aria-label="Search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
            }}
          />
        </div>
        <button type="button" className="customize-mobile-icon-button" aria-label="Close search" onClick={close}>
          <LmIcon name="close" size={24} />
        </button>
      </div>
    );
  }

  const search = (
    <button ref={searchButtonRef} type="button" className="customize-mobile-icon-button" aria-label="Search" onClick={() => setSearching(true)}>
      <LmIcon name="search" size={24} />
    </button>
  );
  return (
    <div className="customize-mobile-actions">
      {variant === 'search' ? (
        <span className="customize-mobile-search-button">{search}</span>
      ) : (
        <div className="customize-mobile-pill">
          {search}
          {variant === 'custom' ? (
            <button type="button" className="customize-mobile-icon-button" aria-label="Create custom app" onClick={onCustom}>
              <LmIcon name="add" size={24} />
            </button>
          ) : (
            <button
              type="button"
              className="customize-mobile-icon-button"
              aria-label="Create"
              aria-haspopup="menu"
              aria-expanded={createOpen}
              onClick={(event) => onCreate?.(event.currentTarget)}
            >
              <LmIcon name="add" size={24} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
