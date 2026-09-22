import React, { useState, useMemo, useRef, useLayoutEffect } from 'react';
import { CustomizeIcon } from './CustomizeIcon';
import { CustomizeCard } from './CustomizeCard';
import type { CustomizeItem } from './customize-data';

interface CustomizeCategoryViewProps {
  categoryTitle: string;
  items: CustomizeItem[];
  fromTab: 'discover' | 'connectors' | 'skills';
  onBack: () => void;
  onSelect: (item: CustomizeItem) => void;
  onActionClick?: (e: React.MouseEvent, item: CustomizeItem) => void;
}

export const CustomizeCategoryView: React.FC<CustomizeCategoryViewProps> = ({
  categoryTitle,
  items,
  fromTab,
  onBack,
  onSelect,
  onActionClick,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (rootRef.current) {
      rootRef.current.scrollTop = 0;
    }
  }, [categoryTitle]);

  const backLabel =
    fromTab === 'skills'
      ? 'Skills'
      : fromTab === 'connectors'
        ? 'Connectors'
        : 'Discover';

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.subtitle.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.category?.toLowerCase().includes(query),
    );
  }, [items, searchQuery]);

  return (
    <div
      key={`category-${categoryTitle}`}
      ref={rootRef}
      className="customize-page-root gemini-chat-scrollbar"
    >
      <div className="customize-category-top-nav">
        <button
          type="button"
          className="customize-category-back-button"
          onClick={onBack}
          aria-label={`Back to ${backLabel}`}
        >
          <CustomizeIcon name="arrow_back" size={16} className="back-icon" />
          <span className="back-button-text">{backLabel}</span>
        </button>
      </div>

      <div className="customize-window">
        <header className="customize-category-page-header">
          <h1 className="customize-category-page-title">{categoryTitle}</h1>

          <div className="customize-search-container" role="search">
            <CustomizeIcon
              name="search"
              size={20}
              className="customize-search-icon"
            />
            <input
              type="text"
              className="customize-search-input"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search"
            />
            {searchQuery && (
              <button
                type="button"
                className="customize-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <CustomizeIcon name="close" size={16} />
              </button>
            )}
          </div>
        </header>

        {filteredItems.length > 0 ? (
          <div className="cards-grid">
            {filteredItems.map((item) => (
              <CustomizeCard
                key={item.id}
                item={fromTab === 'skills' && item.type === 'skill' ? { ...item, symbol: 'edit_note' } : item}
                onSelect={(selected) => onSelect(selected)}
                onActionClick={onActionClick}
              />
            ))}
          </div>
        ) : (
          <div className="customize-empty-category">
            <p className="customize-empty-text">
              No results found for &ldquo;{searchQuery}&rdquo;
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomizeCategoryView;
