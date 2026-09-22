import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CustomizeIcon } from './CustomizeIcon';
import type { CustomizeItem } from './customize-data';

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

  const menuHeight = item.type === 'skill' ? (isInactive ? 232 : 268) : 52;
  const openUpwards = triggerRect.bottom + menuHeight > window.innerHeight;
  const top = openUpwards ? undefined : triggerRect.bottom;
  const bottom = openUpwards ? window.innerHeight - triggerRect.top : undefined;
  const right = Math.max(8, window.innerWidth - triggerRect.right);

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

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="customize-card-menu-backdrop"
        onClick={onClose}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.md,.txt"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <div
        role="menu"
        tabIndex={-1}
        aria-label={`Options for ${item.title}`}
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
        {item.type === 'skill' ? (
          <>
            {!isInactive && onUseNow && (
              <button
                type="button"
                role="menuitem"
                className="customize-card-menu-item"
                onClick={() => {
                  onUseNow(item);
                  onClose();
                }}
              >
                <span className="customize-card-menu-item-icon">
                  <CustomizeIcon name="contract" size={16} />
                </span>
                <span className="customize-card-menu-item-label">Use now</span>
              </button>
            )}

            {onEditWithGemini && (
              <button
                type="button"
                role="menuitem"
                className="customize-card-menu-item"
                onClick={() => {
                  onEditWithGemini(item);
                  onClose();
                }}
              >
                <span className="customize-card-menu-item-icon">
                  <CustomizeIcon name="chat_spark" size={16} />
                </span>
                <span className="customize-card-menu-item-label">Edit with Gemini</span>
              </button>
            )}

            {onEditManually && (
              <button
                type="button"
                role="menuitem"
                className="customize-card-menu-item"
                onClick={() => {
                  onEditManually(item);
                  onClose();
                }}
              >
                <span className="customize-card-menu-item-icon">
                  <CustomizeIcon name="edit_note" size={16} />
                </span>
                <span className="customize-card-menu-item-label">Edit manually</span>
              </button>
            )}

            {onDownloadSkill && (
              <button
                type="button"
                role="menuitem"
                className="customize-card-menu-item"
                onClick={() => {
                  onDownloadSkill(item);
                  onClose();
                }}
              >
                <span className="customize-card-menu-item-icon">
                  <CustomizeIcon name="download" size={16} />
                </span>
                <span className="customize-card-menu-item-label">Download</span>
              </button>
            )}

            <button
              type="button"
              role="menuitem"
              className="customize-card-menu-item"
              onClick={() => {
                fileInputRef.current?.click();
              }}
            >
              <span className="customize-card-menu-item-icon">
                <CustomizeIcon name="upload" size={16} />
              </span>
              <span className="customize-card-menu-item-label">Replace skill</span>
            </button>

            {onToggleActiveSkill && (
              <button
                type="button"
                role="menuitem"
                className="customize-card-menu-item"
                onClick={() => {
                  onToggleActiveSkill(item);
                  onClose();
                }}
              >
                <span className="customize-card-menu-item-icon">
                  <CustomizeIcon name={isInactive ? 'check_circle' : 'block'} size={16} />
                </span>
                <span className="customize-card-menu-item-label">
                  {isInactive ? 'Activate' : 'Deactivate'}
                </span>
              </button>
            )}

            {onDeleteSkill && (
              <button
                type="button"
                role="menuitem"
                className="customize-card-menu-item"
                onClick={() => {
                  onDeleteSkill(item);
                  onClose();
                }}
              >
                <span className="customize-card-menu-item-icon">
                  <CustomizeIcon name="delete" size={16} />
                </span>
                <span className="customize-card-menu-item-label">Delete</span>
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            role="menuitem"
            className="customize-card-menu-item"
            onClick={() => {
              onDisconnect?.(item);
              onClose();
            }}
          >
            <span className="customize-card-menu-item-icon">
              <CustomizeIcon name="block" size={18} />
            </span>
            <span className="customize-card-menu-item-label">Disconnect</span>
          </button>
        )}
      </div>
    </>,
    document.body,
  );
};
