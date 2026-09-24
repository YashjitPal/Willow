import React from 'react';
import { useThemeMode } from '@willow/core/theme-mode';
import { CustomizeIcon } from './CustomizeIcon';
import type { CustomizeItem } from './customize-data';

interface CustomizeCardProps {
  item: CustomizeItem;
  onSelect: (item: CustomizeItem) => void;
  onActionClick?: (e: React.MouseEvent, item: CustomizeItem) => void;
}

export const CustomizeCard: React.FC<CustomizeCardProps> = ({
  item,
  onSelect,
  onActionClick,
}) => {
  const { isLight } = useThemeMode();
  return (
    <div
      className="customize-card group"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(item);
        }
      }}
    >
      <div className={`icon-wrapper ${item.symbol || !item.logoSrc ? 'has-icon' : ''}`}>
        {item.logoSrc ? (
          <img
            src={item.logoSrc}
            alt=""
            aria-hidden="true"
            className="card-icon"
            loading="lazy"
          />
        ) : item.symbol ? (
          <CustomizeIcon
            name={item.symbol}
            size={20}
            className={isLight ? 'text-[#1f1f1f]' : 'text-[#e6e6e6]'}
          />
        ) : (
          <CustomizeIcon
            name="edit_note"
            size={20}
            className={isLight ? 'text-[#1f1f1f]' : 'text-[#e6e6e6]'}
          />
        )}
      </div>

      <div className="content">
        <div className="title gds-body-l">
          {item.title}
        </div>
        <div className="subtitle gds-body-s">
          {item.subtitle}
        </div>
      </div>

      {item.hasAddButton ? (
        <button
          type="button"
          className="add-button"
          aria-label={`Add ${item.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onActionClick?.(e, item);
          }}
        >
          <CustomizeIcon name="add" size={24} />
        </button>
      ) : (
        <button
          type="button"
          className="more-button"
          aria-label={`More options for ${item.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onActionClick?.(e, item);
          }}
        >
          <CustomizeIcon name="more_horiz" size={24} />
        </button>
      )}
    </div>
  );
};
