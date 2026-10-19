import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { CustomizeIcon } from './CustomizeIcon';
import type { CustomizeItem } from './customize-data';

/** How long a closing menu stays mounted: the dropdown's 125ms exit. */
export const cardMenuExitMs = (_isCompact?: boolean) => 125;

interface CardMenuAction {
  label: string;
  icon: string;
  iconSize?: number;
  /** Drawn as Gemini draws a connector's: Luminous `lm-icon-s`, 16px at weight 330. */
  luminous?: boolean;
  onSelect: () => void;
}

/** Each row is 36px inside the panel's 8px padding. */
const MENU_ROW = 36;
const MENU_PAD = 16;

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
  /** A custom app's Delete, which removes it rather than switching it off. */
  onDeleteApp?: (item: CustomizeItem) => void;
  isInactive?: boolean;
}

/**
 * A card's actions: Gemini's `customize-card-menu`, a mat-menu hung from the trigger's bottom right at every
 * size (`mat-menu-before`) and turned upwards where it would run off the screen.
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
  onDeleteApp,
  isInactive = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
          ? [{ label: 'Edit with Willow', icon: 'chat_spark', onSelect: run(() => onEditWithGemini(item)) }]
          : []),
        ...(onEditManually
          ? [{ label: 'Edit manually', icon: 'edit_note', onSelect: run(() => onEditManually(item)) }]
          : []),
        ...(onDownloadSkill
          ? [{ label: 'Download', icon: 'download', onSelect: run(() => onDownloadSkill(item)) }]
          : []),
        // Stays open behind the file picker; choosing a file closes it.
        { label: 'Replace skill', icon: 'upload', onSelect: () => fileInputRef.current?.click() },
        ...(onToggleActiveSkill
          ? [{
              label: isInactive ? 'Activate' : 'Deactivate',
              icon: isInactive ? 'check_circle' : 'block',
              onSelect: run(() => onToggleActiveSkill(item)),
            }]
          : []),
        ...(onDeleteSkill
          ? [{ label: 'Delete', icon: 'delete', onSelect: run(() => onDeleteSkill(item)) }]
          : []),
      ]
    : [
        ...(onUseNow ? [{ label: 'Use now', icon: 'chat_bubble', luminous: true, onSelect: run(() => onUseNow(item)) }] : []),
        ...(onDisconnect
          ? [{ label: 'Disconnect', icon: 'do_not_disturb_on', luminous: true, onSelect: run(() => onDisconnect(item)) }]
          : []),
        ...(onDeleteApp ? [{ label: 'Delete', icon: 'delete', luminous: true, onSelect: run(() => onDeleteApp(item)) }] : []),
      ];

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

  const menuHeight = actions.length * MENU_ROW + MENU_PAD;
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
          minWidth: item.type === 'skill' ? '162px' : undefined,
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
              {action.luminous ? (
                <MaterialSymbol family="luminous" name={action.icon} size={16} weight={330} roundness={100} />
              ) : (
                <CustomizeIcon name={action.icon} size={action.iconSize ?? 16} />
              )}
            </span>
            <span className="customize-card-menu-item-label">{action.label}</span>
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
};
