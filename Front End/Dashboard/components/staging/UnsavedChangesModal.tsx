import React from 'react';
import { X } from 'lucide-react';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({ isOpen, onCancel, onConfirm }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      
      <div className="relative bg-[#18181b] border border-[#27272a] rounded-xl w-full max-w-sm p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <button 
          onClick={onCancel}
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
        
        <h3 className="text-lg font-semibold text-white mb-2">You have unsaved changes</h3>
        <p className="text-gray-400 text-sm leading-relaxed mb-6">
          Are you sure you want to exit the visual editor? You will lose your unsaved changes.
        </p>
        
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors border border-transparent hover:border-white/10"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};
