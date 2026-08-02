import React from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({ isOpen, onCancel, onConfirm }) => {
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4 font-sans">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/80" 
            onClick={onCancel} 
          />
          
          {/* Modal Content */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ 
              type: "spring",
              duration: 0.3,
              bounce: 0.3
            }}
            className="relative bg-[#151517] border border-white/10 rounded-[14px] w-full max-w-[480px] px-6 py-5 shadow-2xl"
          >
            <button 
              onClick={onCancel}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
            
            <h3 className="text-[17px] font-semibold text-white mb-2">You have unsaved changes</h3>
            <p className="text-[#a1a1aa] text-[14px] leading-normal mb-6">
              Are you sure you want to exit the visual editor? You will lose your unsaved changes.
            </p>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={onCancel}
                className="px-4 h-9 text-[14px] font-medium text-white hover:bg-white/5 rounded-md transition-colors border border-white/10"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="px-4 h-9 text-[14px] font-medium text-black bg-white hover:bg-gray-200 rounded-md transition-colors"
              >
                Confirm
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

