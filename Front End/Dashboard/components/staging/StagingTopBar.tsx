import React, { useState } from 'react';
import { 
  Palette, 
  Code2, 
  Plus, 
  Monitor,
  RefreshCw,
  ArrowUpRight,
  Github,
  Clock,
  PanelLeftOpen,
  Globe,
  Cloud,
  Pin,
  Beaker,
  FlaskConical,
  Settings
} from 'lucide-react';
import { useRef, useEffect } from 'react';
import { ShimmerButton } from '../ui/shimmer-button';

interface TopBarProps {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  activeTab: string;
  onTabChange: (id: string) => void;
  onSettingsClick?: () => void;
  onRefreshPreview?: () => void;
  onOpenInNewTab?: () => void;
}

export const ALL_TOOLS = [
  { id: 'preview', label: 'Preview', icon: Globe },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'test', label: 'Test', icon: FlaskConical },
  { id: 'design', label: 'Design', icon: Palette },
  { id: 'cloud', label: 'Cloud', icon: Cloud },
  { id: 'prototype', label: 'Prototype', icon: Beaker },
];

const TopBar: React.FC<TopBarProps> = ({ isSidebarCollapsed, onToggleSidebar, activeTab, onTabChange, onSettingsClick, onRefreshPreview, onOpenInNewTab }) => {
  const [pinnedIds, setPinnedIds] = useState(['preview', 'code', 'design']);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [shouldRenderMenu, setShouldRenderMenu] = useState(false);
  const [isClosingMenu, setIsClosingMenu] = useState(false);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleTabChange = (id: string) => {
    if (id === activeTab) return;
    
    // If the tool we're leaving isn't pinned, it should animate out
    if (!pinnedIds.includes(activeTab)) {
      setLeavingId(activeTab);
      setTimeout(() => setLeavingId(null), 300);
    }
    
    onTabChange(id);
  };

  useEffect(() => {
    if (isAddMenuOpen) {
      setShouldRenderMenu(true);
      setIsClosingMenu(false);
    } else if (shouldRenderMenu) {
      setIsClosingMenu(true);
      const timer = setTimeout(() => {
        setShouldRenderMenu(false);
        setIsClosingMenu(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isAddMenuOpen, shouldRenderMenu]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current && 
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsAddMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const togglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinnedIds(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const visibleTools = ALL_TOOLS.filter(tool => 
    pinnedIds.includes(tool.id) || tool.id === activeTab || tool.id === leavingId
  );
  const menuTools = ALL_TOOLS;

  return (
    <div className={`h-14 flex items-center justify-between w-full flex-shrink-0 bg-[#1c1c1c] pr-4 transition-all duration-300 ease-in-out relative ${isSidebarCollapsed ? 'pl-4' : 'pl-0'}`}>
      {/* Left Group */}
      <div className="flex items-center gap-4">
        {isSidebarCollapsed && (
          <div className="flex items-center gap-1.5 text-gray-400 mr-2 transition-all duration-300 animate-in fade-in slide-in-from-left-4">
            <button className="p-1.5 hover:text-white transition-colors">
              <Clock size={16} />
            </button>
            <button onClick={onToggleSidebar} className="p-1.5 hover:text-white transition-colors">
              <PanelLeftOpen size={16} />
            </button>
          </div>
        )}
        
      {/* Navigation Group - Single flat container to prevent layout jitters */}
      <div className="flex items-center gap-1">
        {visibleTools.map((item) => {
          const isActive = activeTab === item.id;
          const isLeaving = leavingId === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              style={{ 
                width: isLeaving ? '0px' : (isActive ? '112px' : '40px'),
                opacity: isLeaving ? 0 : 1,
                borderWidth: isLeaving ? 0 : '1px',
                padding: isLeaving ? 0 : undefined,
                margin: isLeaving ? 0 : undefined,
              }}
              className={`
                group flex items-center justify-center h-10 rounded-full text-sm font-medium transition-[width,opacity,background-color,border-color,color] duration-300 ease-in-out border overflow-hidden
                ${isActive 
                  ? 'bg-[#18181b] border-[#27272a] text-white shadow-sm' 
                  : 'bg-transparent border-transparent text-[#a1a1aa] hover:text-white hover:bg-[#27272a]/30'
                }
              `}
            >
              <div className={`flex items-center justify-center transition-all duration-300 ${isLeaving ? 'scale-50 opacity-0' : 'scale-100 opacity-100'}`}>
                <item.icon 
                  size={16} 
                  className={`transition-colors duration-300 flex-shrink-0 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'}`} 
                />
                
                <div 
                  className={`overflow-hidden transition-all duration-300 ease-in-out flex items-center ${isActive ? 'max-w-[80px] opacity-100 ml-2' : 'max-w-0 opacity-0 ml-0'}`}
                >
                  <span className="whitespace-nowrap">
                    {item.id === 'prototype' ? 'Proto' : item.label}
                  </span>
                </div>
              </div>
            </button>
          );
        })}

        {/* Separated Add Button with Dropdown */}
        <div className="relative">
          <button
            ref={buttonRef}
            onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
            className={`
              flex items-center justify-center w-10 h-10 rounded-full text-[#a1a1aa] hover:text-white hover:bg-[#27272a]/30 transition-all duration-200 border border-transparent
              ${isAddMenuOpen ? 'bg-[#27272a]/30 text-white' : ''}
            `}
          >
            <Plus size={18} />
          </button>

          {shouldRenderMenu && (
            <div 
              ref={menuRef}
              className={`absolute left-0 mt-2 w-52 bg-[#1c1c1c] border border-[#2e2e2e] rounded-xl shadow-2xl py-1 z-[100] ${isClosingMenu ? 'settings-fade-out' : 'settings-fade-in'}`}
            >
              {menuTools.map((item, index) => {
                const isPinned = pinnedIds.includes(item.id);
                return (
                  <button
                    key={index}
                    className="w-full px-1.5"
                    onClick={() => {
                      handleTabChange(item.id);
                      setIsAddMenuOpen(false);
                    }}
                  >
                    <div className="group flex items-center justify-between w-full p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-[#20293a] hover:border-[#3b82f6]/50 transition-all duration-200 border border-transparent">
                      <div className="flex items-center gap-2.5">
                        <item.icon size={16} className="text-gray-400 group-hover:text-[#3b82f6] transition-colors" />
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                      <div 
                        onClick={(e) => togglePin(item.id, e)}
                        className={`p-1 rounded-md transition-all duration-200 ${isPinned ? 'opacity-100 bg-[#3b82f6]/20' : 'opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-gray-700'}`}
                      >
                        <Pin size={13} className={`rotate-45 transition-colors ${isPinned ? 'text-[#3b82f6] fill-[#3b82f6]' : 'text-gray-500'}`} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Center Address Bar - Absolutely centered */}
      <div className="absolute left-1/2 -translate-x-1/2 w-[280px]">
        <div className="bg-[#1c1c1c] border border-[#383838] rounded-full flex items-center h-10 px-4 gap-2 shadow-sm">
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
            <button 
              onClick={onOpenInNewTab}
              className="hover:text-white transition-colors p-1"
              title="Open in new tab"
            >
               <ArrowUpRight size={14} />
            </button>
            <button 
              onClick={onRefreshPreview}
              className="hover:text-white transition-colors p-1"
              title="Refresh preview"
            >
               <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Right Group */}
      <div className="flex items-center gap-3">
        <button 
          onClick={onSettingsClick}
          className="flex items-center justify-center w-10 h-10 bg-[#1c1c1c] hover:bg-[#27272a] border border-[#27272a] rounded-xl text-white transition-all duration-200"
        >
          <Settings size={20} />
        </button>
        <button className="flex items-center justify-center w-10 h-10 bg-[#1c1c1c] hover:bg-[#27272a] border border-[#27272a] rounded-xl text-white transition-all duration-200">
          <Github size={20} />
        </button>
        
        {/* Shimmer Publish Button */}
        <ShimmerButton 
          className="h-10 text-sm"
          shimmerColor="#ffffff"
          background="rgba(28, 28, 28, 1)"
        >
          <span className="text-white font-medium">Publish</span>
        </ShimmerButton>
      </div>
    </div>
  );
};

export default TopBar;
