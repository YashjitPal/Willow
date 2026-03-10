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
  MessagesSquare,
  Beaker,
  FlaskConical,
  Settings,
  MousePointer2,
  AlertTriangle,
  Bot,
  Play,
  Compass,
  CodeXml
} from 'lucide-react';
import { AgentIcon } from '../ui/AgentIcon';
import { CanvasIcon } from '../ui/CanvasIcon';
import { useRef, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { ShimmerButton } from '../ui/shimmer-button';
import { isVisualEditMode, enterVisualEdit, exitVisualEdit, hasUnsavedChanges, discardVisualChanges } from '../../lib/visual-editor';
import { UnsavedChangesModal } from './UnsavedChangesModal';
import { previewErrors, toggleErrorPanel, isErrorPanelOpen } from '../../lib/stores/error-store';
import { triggerNewChat } from '../../lib/stores/chat-store';

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
  { id: 'design', label: 'Design', icon: Palette },
  { id: 'cloud', label: 'Cloud', icon: Cloud },
  { id: 'swarm', label: 'Swarm', icon: MessagesSquare },
  { id: 'agents', label: 'Agents', icon: AgentIcon },
  { id: 'canvas', label: 'Canvas', icon: CanvasIcon },
];

const TopBar: React.FC<TopBarProps> = ({ isSidebarCollapsed, onToggleSidebar, activeTab, onTabChange, onSettingsClick, onRefreshPreview, onOpenInNewTab }) => {
  const isVisualEdit = useStore(isVisualEditMode);
  const hasUnsaved = useStore(hasUnsavedChanges);
  const errors = useStore(previewErrors);
  const errorPanelOpen = useStore(isErrorPanelOpen);
  const [showExitModal, setShowExitModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [pinnedIds, setPinnedIds] = useState(['preview', 'code', 'design']);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [shouldRenderMenu, setShouldRenderMenu] = useState(false);
  const [isClosingMenu, setIsClosingMenu] = useState(false);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleExitWithCheck = (action?: () => void) => {
    if (hasUnsaved) {
      if (action) setPendingAction(() => action);
      setShowExitModal(true);
    } else {
      exitVisualEdit();
      action?.();
    }
  };

  const handleTabChange = (id: string) => {
    if (id === activeTab) return;

    // Map agent-builder back to agents for the leaving animation check
    const leavingTab = activeTab === 'agent-builder' ? 'agents' : activeTab;
    // If the tool we're leaving isn't pinned, it should animate out
    if (!pinnedIds.includes(leavingTab)) {
      setLeavingId(leavingTab);
      setTimeout(() => setLeavingId(null), 300);
    }

    // Use requestAnimationFrame to prevent layout thrashing from iframe
    requestAnimationFrame(() => {
      onTabChange(id);
    });
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
    <>
      <UnsavedChangesModal 
        isOpen={showExitModal}
        onCancel={() => {
          setShowExitModal(false);
          setPendingAction(null);
        }}
        onConfirm={() => {
          discardVisualChanges();
          setShowExitModal(false);
          exitVisualEdit();
          if (pendingAction) {
            pendingAction();
            setPendingAction(null);
          }
        }}
      />
    <div className={`h-14 flex items-center justify-between w-full flex-shrink-0 bg-[#1c1c1c] pr-4 relative ${isSidebarCollapsed ? 'pl-4' : 'pl-0'}`}
      style={{
        transitionProperty: 'padding',
        transitionDuration: '500ms',
        transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)'
      }}
    >
      {/* Left Group */}
      <div className="flex items-center gap-4">
        {isSidebarCollapsed && (
          <div className="flex items-center gap-1.5 text-gray-400 mr-2 transition-opacity duration-300 animate-in fade-in slide-in-from-left-4">
            <button onClick={triggerNewChat} className="p-1.5 hover:text-white transition-colors" title="New Chat">
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
        
      {/* Navigation Group - Single flat container to prevent layout jitters */}
      <div className="flex items-center gap-1">
        {visibleTools.map((item) => {
          const isActive = activeTab === item.id || (activeTab === 'agent-builder' && item.id === 'agents');
          const isLeaving = !pinnedIds.includes(item.id) && (leavingId === item.id || (leavingId === 'agent-builder' && item.id === 'agents'));
          
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
                group flex items-center justify-center h-10 rounded-full text-sm font-medium transition-[width,opacity,background-color,color] duration-300 ease-in-out overflow-hidden
                ${isActive
                  ? 'bg-[#18181b] border border-[#27272a] text-white shadow-sm'
                  : 'bg-transparent border border-[#1c1c1c] text-[#a1a1aa] hover:text-white hover:bg-[#27272a]/30'
                }
              `}
            >
              <div className={`flex items-center justify-center transition-[transform,opacity] duration-300 ${isLeaving ? 'scale-50 opacity-0' : 'scale-100 opacity-100'}`}>
                <item.icon
                  size={16}
                  className={`transition-colors duration-300 flex-shrink-0 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'}`}
                />

                <div
                  className={`overflow-hidden transition-[max-width,opacity,margin] duration-300 ease-in-out flex items-center ${isActive ? 'max-w-[80px] opacity-100 ml-2' : 'max-w-0 opacity-0 ml-0'}`}
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
              flex items-center justify-center w-10 h-10 rounded-full text-[#a1a1aa] hover:text-white hover:bg-[#27272a]/30 transition-colors duration-200 border border-[#1c1c1c]
              ${isAddMenuOpen ? 'bg-[#27272a]/30 text-white' : ''}
            `}
          >
            <Plus size={18} />
          </button>

          {isAddMenuOpen && (
            <div 
              className="fixed inset-0 z-[90]" 
              onClick={(e) => {
                e.stopPropagation();
                setIsAddMenuOpen(false);
              }} 
            />
          )}

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
                    <div className="group flex items-center justify-between w-full p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-[#20293a] hover:border-[#3b82f6]/50 transition-colors duration-200 border border-[#1c1c1c]">
                      <div className="flex items-center gap-2.5">
                        <item.icon size={16} className="text-gray-400 group-hover:text-[#3b82f6] transition-colors" />
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                      <div
                        onClick={(e) => togglePin(item.id, e)}
                        className={`p-1 rounded-md transition-[opacity,background-color] duration-200 ${isPinned ? 'opacity-100 bg-[#3b82f6]/20' : 'opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-gray-700'}`}
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
      {activeTab !== 'agent-builder' && (
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
      )}

      {/* Right Group */}
      <div className="flex items-center gap-3">
        {isVisualEdit ? (
          <button
            onClick={() => {
              handleExitWithCheck(() => onTabChange('preview'));
            }}
            className="flex items-center justify-center h-8 px-5 bg-[#272729] hover:bg-[#3f3f46] rounded-xl text-white font-medium text-sm transition-colors duration-200 border-none outline-none"
          >
            Close
          </button>
        ) : activeTab === 'agent-builder' ? (
          <>
            <button className="flex items-center gap-2 h-8 px-4 bg-[#272729] hover:bg-[#3f3f46] rounded-xl text-white font-medium text-sm transition-colors duration-200 border-none outline-none">
              <Compass size={14} className="text-white" />
              <span>Evaluate</span>
            </button>
            <button className="flex items-center gap-2 h-8 px-4 bg-[#272729] hover:bg-[#3f3f46] rounded-xl text-white font-medium text-sm transition-colors duration-200 border-none outline-none">
              <CodeXml size={14} className="text-white" />
              <span>Code</span>
            </button>
            <button className="flex items-center gap-2 h-8 px-4 bg-[#272729] hover:bg-[#3f3f46] rounded-xl text-white font-medium text-sm transition-colors duration-200 border-none outline-none">
              <Play size={14} className="fill-white" />
              <span>Preview</span>
            </button>
            <button
              onClick={() => onTabChange('agents')}
              className="flex items-center justify-center h-8 px-5 bg-[#272729] hover:bg-[#3f3f46] rounded-xl text-white font-medium text-sm transition-colors duration-200 border-none outline-none"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <button
              onClick={toggleErrorPanel}
              className={`relative flex items-center justify-center w-10 h-10 border rounded-xl text-white transition-[background-color] duration-200 ${
                errorPanelOpen
                  ? 'bg-[#27272a] border-[#3b3b3b]'
                  : 'bg-[#1c1c1c] hover:bg-[#27272a] border-[#27272a]'
              }`}
            >
              <AlertTriangle size={18} />
              {errors.length > 0 && (
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-white leading-none">{errors.length > 9 ? '9+' : errors.length}</span>
                </div>
              )}
            </button>
            <button
              onClick={() => onSettingsClick?.()}
              className="flex items-center justify-center w-10 h-10 bg-[#1c1c1c] hover:bg-[#27272a] border border-[#27272a] rounded-xl text-white transition-[background-color] duration-200"
            >
              <Settings size={20} />
            </button>
            <button className="flex items-center justify-center w-10 h-10 bg-[#1c1c1c] hover:bg-[#27272a] border border-[#27272a] rounded-xl text-white transition-[background-color] duration-200">
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
          </>
        )}
      </div>
    </div>
    </>
  );
};

// Visual Edit Button Component - Toggle visual editing mode
const VisualEditButton: React.FC = () => {
  const isActive = useStore(isVisualEditMode);
  const hasUnsavedBtn = useStore(hasUnsavedChanges);
  const [showModal, setShowModal] = useState(false);

  const handleClick = () => {
    if (isActive) {
      if (hasUnsavedBtn) {
        setShowModal(true);
      } else {
        exitVisualEdit();
      }
    } else {
      enterVisualEdit();
    }
  };

  return (
    <>
      <UnsavedChangesModal 
        isOpen={showModal}
        onCancel={() => setShowModal(false)}
        onConfirm={() => {
          discardVisualChanges();
          setShowModal(false);
          exitVisualEdit();
        }}
      />
    <button
      onClick={handleClick}
      className={`
        flex items-center gap-2 h-10 px-4 rounded-full text-sm font-medium transition-all duration-200 border ml-2
        ${isActive 
          ? 'bg-[#3b82f6]/20 border-[#3b82f6]/50 text-[#3b82f6]' 
          : 'bg-transparent border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a]/30 hover:border-[#3b3b3b]'
        }
      `}
    >
      <MousePointer2 size={15} className={isActive ? 'text-[#3b82f6]' : ''} />
      <span>Visual Edit</span>
      {isActive && (
        <div className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-pulse" />
      )}
    </button>
    </>
  );
};

export default TopBar;

