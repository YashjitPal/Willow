
import React from 'react';
import { 
  Palette, 
  Code2, 
  Plus, 
  Monitor,
  RefreshCw,
  Pencil,
  Github,
  Clock,
  PanelLeftOpen
} from 'lucide-react';

interface TopBarProps {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

const TopBar: React.FC<TopBarProps> = ({ isSidebarCollapsed, onToggleSidebar }) => {
  return (
    <div className="h-14 flex items-center justify-between pl-0 pr-6 w-full flex-shrink-0 bg-main">
      {/* Left Group */}
      <div className="flex items-center gap-4">
        {isSidebarCollapsed && (
          <div className="flex items-center gap-1.5 text-gray-400 mr-2 transition-all duration-300 animate-in fade-in slide-in-from-left-4">
            <button className="p-1.5 hover:text-white transition-colors" title="New Chat">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button className="p-1.5 hover:text-white transition-colors">
              <Clock size={16} />
            </button>
            <button onClick={onToggleSidebar} className="p-1.5 hover:text-white transition-colors">
              <PanelLeftOpen size={16} />
            </button>
          </div>
        )}
        
        {/* Aesthetic Preview Button - Dot style, taller (h-10) and wider (px-6) */}
        <button className="group flex items-center gap-2 h-10 px-6 bg-[#18181b] hover:bg-[#27272a] text-[#a1a1aa] hover:text-white rounded-full text-sm font-medium border border-[#27272a] hover:border-[#3f3f46] transition-all duration-200">
          <div className="w-2 h-2 rounded-full bg-[#a1a1aa] group-hover:bg-white transition-colors" />
          <span>Preview</span>
        </button>

        <div className="flex items-center gap-3.5 text-gray-400">
           <Code2 size={18} className="hover:text-gray-200 cursor-pointer transition-colors" />
           <Palette size={18} className="hover:text-gray-200 cursor-pointer transition-colors" />
           <Plus size={18} className="hover:text-gray-200 cursor-pointer transition-colors" />
        </div>
      </div>

      {/* Center Address Bar */}
      <div className="flex-1 max-w-xl px-8">
        <div className="bg-[#1c1c1c] border border-[#383838] rounded-full flex items-center h-10 px-4 gap-2 group focus-within:border-gray-500 transition-all duration-200 shadow-sm">
          <div className="text-gray-500 flex items-center">
            <Monitor size={15} className="text-gray-500" />
          </div>
          <span className="text-gray-500 text-sm">/</span>
          <input 
            className="bg-transparent border-none outline-none text-sm text-gray-300 w-full font-normal" 
            defaultValue="localhost:3000"
            readOnly 
          />
          <div className="flex items-center gap-3 text-gray-500 pl-2">
            <button className="hover:text-white transition-colors p-1">
               <Pencil size={14} />
            </button>
            <button className="hover:text-white transition-colors p-1">
               <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Right Group */}
      <div className="flex items-center gap-3">
        <button className="p-1.5 text-gray-400 hover:text-white transition-colors">
          <Github size={18} />
        </button>
        
        {/* Aesthetic Publish Button - Matching Height h-10 */}
        <button className="flex items-center gap-2 h-10 px-6 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-sm font-semibold transition-all duration-200 shadow-lg shadow-blue-600/20 hover:shadow-blue-600/40 active:scale-95">
          <span className="relative top-[0.5px] tracking-wide">Publish</span>
        </button>
      </div>
    </div>
  );
};

export default TopBar;