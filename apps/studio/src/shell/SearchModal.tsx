import React, { useEffect, useState } from 'react';
import './SearchModal.css';
import { SearchChatsDialog } from './SearchChats';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelConfig: any;
}

export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, modelConfig }) => {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 150); // Match CSS duration
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!shouldRender) return null;

  return (
    <div className="willow-search-modal fixed inset-0 z-[500] flex items-center justify-center px-4">
      {/* Backdrop */}
      <div 
        className={`absolute inset-0 bg-black/60 ${isClosing ? 'backdrop-fade-out' : 'backdrop-fade-in'}`} 
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className={`${isClosing ? 'modal-scale-out' : 'modal-scale-in'}`}>
        <SearchChatsDialog autoFocus onClose={onClose} modelConfig={modelConfig} />
      </div>
    </div>
  );
};
