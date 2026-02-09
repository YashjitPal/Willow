import React from 'react';
import { useStore } from '@nanostores/react';
import { hasUnsavedChanges, saveVisualChanges, discardVisualChanges } from '../../lib/visual-editor';
import { Info } from 'lucide-react';

export const UnsavedChangesBar: React.FC = () => {
  const hasUnsaved = useStore(hasUnsavedChanges);

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
              <div className="flex items-center gap-2.5 text-[13px] font-medium text-white">
                <Info size={14} className="text-gray-400" />
                Unsaved changes
              </div>
              
              <div className="flex items-center gap-3">
                <button
                  onClick={discardVisualChanges}
                  className="text-[13px] font-medium text-gray-300 hover:text-white transition-colors"
                >
                  Discard
                </button>
                <button
                  onClick={saveVisualChanges}
                  className="rounded-full px-4 py-1.5 text-[13px] font-semibold text-white bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors"
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
