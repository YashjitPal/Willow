
import React from 'react';
import TopBar from './TopBar';
import { Loader2, ChevronUp, ChevronDown } from 'lucide-react';

interface MainPreviewProps {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

const MainPreview: React.FC<MainPreviewProps> = ({ isSidebarCollapsed, onToggleSidebar }) => {
  return (
    <div className="flex-1 flex flex-col h-full bg-main overflow-hidden">
      {/* TopBar sitting at the top, using the #1c1c1c main theme */}
      <div className="flex-shrink-0">
        <TopBar isSidebarCollapsed={isSidebarCollapsed} onToggleSidebar={onToggleSidebar} />
      </div>

      {/* Preview Area */}
      <div className={`flex-1 pr-4 pb-4 pt-0 transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'pl-4' : 'pl-0'}`}>
        <div className="w-full h-full bg-canvas border border-border rounded-[12px] relative flex items-center justify-center overflow-hidden">
          
          {/* Status Pill */}
          <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10">
            <div className="bg-[#121212]/50 backdrop-blur-md border border-border rounded-full px-4 py-1.5 flex items-center gap-2 shadow-xl">
               <Loader2 size={14} className="animate-spin text-gray-400" />
               <span className="text-sm font-medium text-gray-300">Getting ready...</span>
            </div>
          </div>

          {/* Left Pagination Dots */}
          <div className="absolute left-6 flex flex-col gap-2 z-10 top-1/2 -translate-y-1/2">
             {[...Array(6)].map((_, i) => (
               <div key={i} className={`w-1.5 h-1.5 rounded-full ${i === 2 ? 'bg-white h-6' : 'bg-[#2e2e2e]'}`}></div>
             ))}
          </div>

          {/* Right Navigation Arrows */}
          <div className="absolute right-6 flex flex-col gap-2 z-10 top-1/2 -translate-y-1/2">
              <button className="p-3 rounded-full bg-[#121212]/40 border border-border text-gray-400 hover:text-white hover:border-gray-500 transition-all">
                  <ChevronUp size={18} />
              </button>
              <div className="p-3 rounded-full bg-[#121212]/40 border border-border text-gray-500 flex items-center justify-center font-mono text-xs">
                  00
              </div>
              <button className="p-3 rounded-full bg-[#121212]/40 border border-border text-gray-400 hover:text-white hover:border-gray-500 transition-all">
                  <ChevronDown size={18} />
              </button>
          </div>

          {/* Empty Preview State Background */}
          <div className="flex flex-col items-center gap-6 opacity-30">
            <div className="w-24 h-24 text-gray-500">
               <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
               </svg>
            </div>
            <p className="text-gray-400 text-center max-w-md px-12 text-sm">
               No preview deploy found for the project. This can likely be fixed by making an edit to the project.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MainPreview;
