/**
 * InstructionsModal — the full-screen editor for an Agent node's instructions.
 *
 * Portalled to document.body so the canvas transform cannot clip it. The
 * AnimatePresence tree moves as one unit: its two motion.div children (backdrop
 * and panel) must stay direct children of the presence boundary or their exit
 * animations stop running.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

export const InstructionsModal = ({ 
  isOpen, 
  onClose, 
  initialValue, 
  onSave 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  initialValue: string; 
  onSave: (val: string) => void; 
}) => {
  const [value, setValue] = useState(initialValue);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (isOpen) {
      setValue(initialValue);
    }
  }, [isOpen, initialValue]);

  // Keep keyboard users from getting trapped in the editor when it is dismissed.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12" role="presentation">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
          />
          
          {/* Modal Content */}
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="relative w-full max-w-3xl h-[65vh] max-h-[700px] bg-[#222222] rounded-[12px] shadow-2xl flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-instructions-title"
          >
            {/* Header Area inside Modal */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0 border-b border-[#333]">
              <h2 id="edit-instructions-title" className="text-white text-[16px] font-semibold tracking-wide">Edit instructions</h2>
              <button type="button" aria-label="Add context" className="flex items-center gap-1.5 text-[#a1a1aa] hover:text-white transition-colors">
                <span className="text-[13px] font-medium">Add context</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>
              </button>
            </div>

            {/* Text Area */}
            <div className="flex-1 p-6 pt-2 pb-0 flex flex-col">
              <textarea 
                className="w-full h-full bg-transparent text-white text-[15px] resize-none border-none outline-none leading-relaxed placeholder:text-[#6a6a6a]"
                placeholder="Describe desired model behavior (tone, tool usage, response style)"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end px-6 py-4 gap-3 shrink-0">
              <button 
                type="button"
                aria-label="Cancel editing instructions"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-[#333333] hover:bg-[#404040] text-white text-[14px] font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                type="button"
                aria-label="Save instructions"
                onClick={() => {
                  onSave(value);
                  onClose();
                }}
                className="px-4 py-2 rounded-xl bg-white hover:bg-gray-100 text-black text-[14px] font-medium transition-colors"
              >
                Save
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};
