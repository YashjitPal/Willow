import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useThemeMode } from '@willow/core/theme-mode';
import { useCompactViewport } from '@willow/chat/use-compact-viewport';
import { GeminiBottomSheet, GeminiSheetItem, GeminiSheetList } from '@willow/ui/GeminiBottomSheet';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { CustomizeIcon } from './CustomizeIcon';
import type { CustomizeItem } from './customize-data';

/**
 * How long a closing menu has to stay mounted: the dropdown's 125ms exit, or below
 * 961px the bottom sheet's, which leaves the DOM 180ms after it is told to close.
 */
export const cardMenuExitMs = (isCompact: boolean) => (isCompact ? 200 : 125);

interface CardMenuAction {
  label: string;
  /** The CustomizeIcon in the dropdown, and the same ligature in the sheet. */
  icon: string;
  iconSize?: number;
  /** Luminous Symbols lacks `edit_note`, `download` and `block`; the sheet draws those from Google Symbols. */
  sheetFamily?: 'luminous' | 'google-symbols';
  onSelect: () => void;
}

interface CustomizeCardMenuProps {
  item: CustomizeItem;
  triggerRect: DOMRect;
  isOpen: boolean;
  isClosing: boolean;
  onClose: () => void;
  onDisconnect?: (item: CustomizeItem) => void;
  onDeleteSkill?: (item: CustomizeItem) => void;
  onUseNow?: (item: CustomizeItem) => void;
  onEditWithGemini?: (item: CustomizeItem) => void;
  onEditManually?: (item: CustomizeItem) => void;
  onDownloadSkill?: (item: CustomizeItem) => void;
  onReplaceSkill?: (item: CustomizeItem, fileContent?: string) => void;
  onToggleActiveSkill?: (item: CustomizeItem) => void;
  isInactive?: boolean;
}

/**
 * A card's actions. Above 960px a dropdown hung from the trigger; below it a bottom
 * sheet, as Saved Info's and Memory's row actions are on a phone or tablet.
 */
export const CustomizeCardMenu: React.FC<CustomizeCardMenuProps> = ({
  item,
  triggerRect,
  isOpen,
  isClosing,
  onClose,
  onDisconnect,
  onDeleteSkill,
  onUseNow,
  onEditWithGemini,
  onEditManually,
  onDownloadSkill,
  onReplaceSkill,
  onToggleActiveSkill,
  isInactive = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isCompact = useCompactViewport();
  const { isLight } = useThemeMode();

  useEffect(() => {
    // The sheet takes Escape itself.
    if (isCompact) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isCompact]);

  if (!isOpen && !isClosing) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        onReplaceSkill?.(item, content);
      }
    };
    reader.readAsText(file);
    onClose();
  };

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  const actions: CardMenuAction[] = item.type === 'skill'
    ? [
        ...(!isInactive && onUseNow
          ? [{ label: 'Use now', icon: 'contract', onSelect: run(() => onUseNow(item)) }]
          : []),
        ...(onEditWithGemini
          ? [{ label: 'Edit with Gemini', icon: 'chat_spark', onSelect: run(() => onEditWithGemini(item)) }]
          : []),
        ...(onEditManually
          ? [{ label: 'Edit manually', icon: 'edit_note', sheetFamily: 'google-symbols' as const, onSelect: run(() => onEditManually(item)) }]
          : []),
        ...(onDownloadSkill
          ? [{ label: 'Download', icon: 'download', sheetFamily: 'google-symbols' as const, onSelect: run(() => onDownloadSkill(item)) }]
          : []),
        // Stays open behind the file picker; choosing a file closes it.
        { label: 'Replace skill', icon: 'upload', onSelect: () => fileInputRef.current?.click() },
        ...(onToggleActiveSkill
          ? [{
              label: isInactive ? 'Activate' : 'Deactivate',
              icon: isInactive ? 'check_circle' : 'block',
              sheetFamily: isInactive ? ('luminous' as const) : ('google-symbols' as const),
              onSelect: run(() => onToggleActiveSkill(item)),
            }]
          : []),
        ...(onDeleteSkill
          ? [{ label: 'Delete', icon: 'delete', onSelect: run(() => onDeleteSkill(item)) }]
          : []),
      ]
    : [{ label: 'Disconnect', icon: 'block', iconSize: 18, sheetFamily: 'google-symbols', onSelect: run(() => onDisconnect?.(item)) }];

  const label = `Options for ${item.title}`;
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".json,.md,.txt"
      style={{ display: 'none' }}
      onChange={handleFileChange}
    />
  );

  if (isCompact) {
    return (
      <>
        {fileInput}
        <GeminiBottomSheet isOpen={isOpen} onClose={onClose} label={label} isLight={isLight}>
          <GeminiSheetList label={label}>
            {actions.map((action) => (
              action.sheetFamily === 'google-symbols' ? (
                <GeminiSheetItem
                  key={action.label}
                  glyph={<MaterialSymbol family="google-symbols" name={action.icon} size={24} weight={300} />}
                  label={action.label}
                  onSelect={action.onSelect}
                />
              ) : (
                <GeminiSheetItem key={action.label} icon={action.icon} label={action.label} onSelect={action.onSelect} />
              )
            ))}
          </GeminiSheetList>
        </GeminiBottomSheet>
      </>
    );
  }

  const menuHeight = item.type === 'skill' ? (isInactive ? 232 : 268) : 52;
  const openUpwards = triggerRect.bottom + menuHeight > window.innerHeight;
  const top = openUpwards ? undefined : triggerRect.bottom;
  const bottom = openUpwards ? window.innerHeight - triggerRect.top : undefined;
  const right = Math.max(8, window.innerWidth - triggerRect.right);

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="customize-card-menu-backdrop"
        onClick={onClose}
      />
      {fileInput}
      <div
        role="menu"
        tabIndex={-1}
        aria-label={label}
        className={`customize-card-menu-panel ${isClosing ? 'is-closing' : 'is-open'}`}
        style={{
          top: top !== undefined ? `${top}px` : undefined,
          bottom: bottom !== undefined ? `${bottom}px` : undefined,
          right: `${right}px`,
          transformOrigin: openUpwards ? 'right bottom' : 'right top',
          minWidth: item.type === 'skill' ? '162px' : '132px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            className="customize-card-menu-item"
            onClick={action.onSelect}
          >
            <span className="customize-card-menu-item-icon">
              <CustomizeIcon name={action.icon} size={action.iconSize ?? 16} />
            </span>
            <span className="customize-card-menu-item-label">{action.label}</span>
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
};
