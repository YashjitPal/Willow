import React from 'react';
import { useStore } from '@nanostores/react';
import { hasUnsavedChanges, saveVisualChanges, discardVisualChanges, isSaving } from '../../lib/visual-editor';
import { Info, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export const UnsavedChangesBar: React.FC = () => {
  const hasUnsaved = useStore(hasUnsavedChanges);
  const saving = useStore(isSaving);

  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-in-out relative z-[100] -mb-1 ${hasUnsaved ? 'grid-rows-[1fr] pointer-events-auto' : 'grid-rows-[0fr] pointer-events-none'}`}
      style={{ willChange: 'grid-template-rows' }}
    >
      <div className="overflow-hidden">
        <div
          className={`relative transition-opacity duration-300 ease-in-out ${hasUnsaved ? 'opacity-100' : 'opacity-0'}`}
          style={{ willChange: 'opacity' }}
        >
          <div className="px-2">
            <div className="flex items-center justify-between px-4 py-2 bg-[#27272a] border border-white/5 rounded-full shadow-lg">
              <div className="flex items-center gap-2.5 text-[13px] font-medium text-white h-5 overflow-hidden relative min-w-[140px]">
                {/* Icons switch instantly */}
                <div className="flex-shrink-0 relative z-10 bg-[#27272a]">
                  {saving ? (
                    <Loader2 size={14} className="text-gray-200 animate-spin" />
                  ) : (
                    <Info size={14} className="text-gray-400" />
                  )}
                </div>

                {/* Only text animates */}
                <div className="relative flex-grow h-full">
                  <AnimatePresence mode="wait" initial={false}>
                    {saving ? (
                      <motion.div
                        key="saving"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="absolute inset-0 flex items-center"
                      >
                        <span>Saving changes...</span>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="unsaved"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="absolute inset-0 flex items-center"
                      >
                        <span>Unsaved changes</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <button
                  onClick={discardVisualChanges}
                  disabled={saving}
                  className={`text-[13px] font-medium transition-colors ${saving ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 hover:text-white'}`}
                >
                  Discard
                </button>
                <button
                  onClick={saveVisualChanges}
                  disabled={saving}
                  className={`rounded-full px-4 py-1.5 text-[13px] font-semibold text-white transition-all flex items-center gap-2 ${saving ? 'bg-[#2563eb]/30 text-white/50 cursor-not-allowed scale-[0.98]' : 'bg-[#2563eb] hover:bg-[#1d4ed8] active:scale-95'}`}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
