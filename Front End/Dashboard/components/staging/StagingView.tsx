
import React, { useState, useCallback, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Sidebar from './StagingSidebar';
import MainPreview from './StagingMainPreview';
import logoG from '../../src/assets/logog.png';
import { useAutoSave } from '../../hooks/useAutoSave';
import { useAuth } from '../../context/AuthContext';
import { testStore } from '../../lib/test-store';

interface StagingViewProps {
  prompt?: string;
  onSettingsClick?: () => void;
  modelConfig: any;
  setModelConfig: React.Dispatch<React.SetStateAction<any>>;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
}

const StagingView: React.FC<StagingViewProps> = ({ prompt: propPrompt, onSettingsClick, modelConfig, setModelConfig, selectedModelId, setSelectedModelId }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlPrompt = searchParams.get('prompt') || '';
  const urlMode = searchParams.get('mode') || 'ship';
  const prompt = propPrompt || urlPrompt;
  
  // Auth context for Drive integration
  const { user, accessToken } = useAuth();
  
  // Project name - defaults to "Untitled Project" but can be changed
  const [projectName, setProjectName] = useState('Melody Maker Studio');
  
  // Auto-save to Google Drive when user is logged in and has access token
  const { isSaving, saveNow } = useAutoSave(projectName, !!accessToken);

  // Initialize chat mode if URL mode is 'chat'
  const [isChatMode, setIsChatMode] = useState(urlMode === 'chat');

  // If user enters via chat mode, we start centered. 
  // We can manage layout state: 'centered' vs 'sidebar'
  // When isChatMode is true: Sidebar is centered, width is constrained but visually centered, Preview is hidden (or off-screen).
  // When isChatMode is false: Standard resizing logic applies.

  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [lastSidebarWidth, setLastSidebarWidth] = useState(400);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const toggleSidebar = useCallback(() => {
    // Set transitioning flag to disable iframe interactions during animation
    setIsTransitioning(true);
    setIsSidebarCollapsed(prev => {
      if (!prev) {
        setLastSidebarWidth(sidebarWidth);
      }
      return !prev;
    });
    // Clear transitioning after animation duration (500ms)
    setTimeout(() => setIsTransitioning(false), 500);
  }, [sidebarWidth]);

  const startResizing = useCallback(() => {
    setIsDragging(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Use refs to avoid stale closure issues in resize callback
  const isDraggingRef = React.useRef(isDragging);
  const isSidebarCollapsedRef = React.useRef(isSidebarCollapsed);
  
  // Keep refs in sync with state
  React.useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);
  
  React.useEffect(() => {
    isSidebarCollapsedRef.current = isSidebarCollapsed;
  }, [isSidebarCollapsed]);

  // Use ref to store pending width for RAF throttling
  const pendingWidthRef = React.useRef<number | null>(null);
  const rafRef = React.useRef<number | null>(null);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      // Use refs to get current values
      if (isDraggingRef.current) {
        const newWidth = mouseMoveEvent.clientX;
        const totalWidth = document.body.clientWidth;
        
        // Constraints
        const minWidth = totalWidth / 5;
        const maxWidth = totalWidth * 0.37;
        const collapseThreshold = minWidth * 0.5;

        if (isSidebarCollapsedRef.current) {
          if (newWidth > collapseThreshold) {
            setIsTransitioning(true);
            setIsSidebarCollapsed(false);
            setSidebarWidth(minWidth);
            setIsDragging(false);
            setTimeout(() => setIsTransitioning(false), 500);
          }
        } else {
          if (newWidth < collapseThreshold) {
            setIsTransitioning(true);
            setIsSidebarCollapsed(true);
            setIsDragging(false);
            setTimeout(() => setIsTransitioning(false), 500);
            return;
          }

          // Calculate target width
          let targetWidth = newWidth;
          if (newWidth < minWidth && newWidth >= collapseThreshold) {
            targetWidth = minWidth;
          } else if (newWidth > maxWidth) {
            targetWidth = maxWidth;
          } else if (newWidth < minWidth) {
            return;
          }

          // Use requestAnimationFrame for smooth updates
          pendingWidthRef.current = targetWidth;
          if (!rafRef.current) {
            rafRef.current = requestAnimationFrame(() => {
              if (pendingWidthRef.current !== null) {
                setSidebarWidth(pendingWidthRef.current);
              }
              rafRef.current = null;
            });
          }
        }
      }
    },
    [] // No dependencies - uses refs for current values
  );

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [resize, stopResizing]);

  const [activeTab, setActiveTab] = useState('preview');
  
  // Note: Test mode is no longer tied to activeTab
  // testStore.enterTestMode() is called when test starts in StagingSidebar.startTestGeneration()
  // testStore.exitTestMode() is called when test completes
  
  // Calculate effective layout based on chat mode
  const containerStyle = isChatMode 
    ? { width: '100%' } 
    : { width: `${isSidebarCollapsed ? 0 : sidebarWidth}px` };

  const minimizeChat = useCallback(() => {
    setIsChatMode(false);
  }, []);

  return (
    <div className={`flex h-full w-full bg-[#1c1c1c] overflow-hidden text-sm relative ${isDragging ? 'cursor-[ew-resize] select-none' : ''}`}>
      
      {/* Header - Rendered at root level in Chat Mode for true left-edge positioning */}
      {isChatMode && (
        <div className="absolute top-0 left-0 right-0 h-14 flex items-center justify-between z-30 bg-[#1c1c1c]">
          <div className="flex items-center min-w-0 h-full" style={{ paddingLeft: '21px' }}>
            {/* Logo Button - Squircle hover background, Dashboard link */}
            <button 
              onClick={() => navigate('/')}
              className="flex items-center justify-center p-1.5 hover:bg-white/5 transition-colors rounded-xl flex-shrink-0"
              title="Back to Dashboard"
            >
              <img src={logoG} alt="Logo" className="h-[24px] w-auto flex-shrink-0" />
            </button>
            
            <div className="flex-shrink-0 w-[1px]" />
            
            {/* Project Title and Toggle - Separate squircle hover */}
            <div 
              className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-2 py-1.5 rounded-xl transition-colors min-w-0"
              title="Project Settings"
            >
              <span className="font-semibold text-gray-200 truncate">Melody Maker Studio</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </div>
          </div>
          
          {/* Exit Fullscreen Button */}
          <div className="flex items-center px-[27px]">
            <button 
              onClick={minimizeChat}
              className="p-1.5 rounded-lg bg-transparent text-gray-500 hover:text-white transition-colors hover:bg-white/5"
              title="Exit Fullscreen"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      <div 
        style={{
          ...containerStyle,
          willChange: isDragging ? 'width' : 'auto'
        }} 
        className={`flex-shrink-0 transition-all duration-500 ease-out overflow-hidden relative z-10 
          bg-[#1c1c1c] 
          ${isDragging ? 'transition-none' : ''}`}
      >
        <div 
          className={`h-full ${isDragging ? '' : 'transition-all duration-500 ease-out'}`}
          style={{ 
            position: 'relative',
            left: isChatMode ? '50%' : '0',
            transform: isChatMode ? 'translateX(-50%)' : 'translateX(0)',
            width: isChatMode ? '800px' : '100%'
          }}
        >
          <Sidebar 
            width={isChatMode ? 800 : sidebarWidth} 
            isCollapsed={isSidebarCollapsed} 
            onToggle={toggleSidebar} 
            prompt={prompt}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isChatMode={isChatMode} 
            modelConfig={modelConfig}
            setModelConfig={setModelConfig}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
          />
        </div>
      </div>
      
      {/* Resizer Handle - Always rendered but hidden in Chat Mode */}
      <div 
        className={`w-0 relative z-50 group flex-shrink-0 transition-opacity duration-300 ${isChatMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        onMouseDown={startResizing}
      >
          <div 
            className={`absolute w-[2px] left-0 rounded-full ${isDragging ? '' : 'transition-all duration-300 ease-in-out'} 
              bg-gradient-to-b from-transparent via-[#3b82f6] to-transparent
              ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
            `}
             style={{ 
               top: '56px', 
               bottom: '16px', 
               transform: isSidebarCollapsed ? 'translate3d(15px, 0, 0)' : 'translate3d(-1px, 0, 0)',
               willChange: 'transform',
               maskImage: 'linear-gradient(to bottom, transparent, black 128px, black calc(100% - 128px), transparent)',
               WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 128px, black calc(100% - 128px), transparent)'
             }}
          />
         
         <div 
            className={`absolute top-14 bottom-4 -left-1 bg-transparent cursor-[ew-resize] hover:bg-transparent ${isSidebarCollapsed ? '-right-4' : '-right-1'}`} 
         />
      </div>

      {/* Main Preview - Slides in from right */}
      <div 
        className={`flex-1 min-w-0 ${isDragging ? '' : 'transition-all duration-500 ease-out'}
          ${isChatMode ? 'opacity-0 translate-x-[100px] pointer-events-none' : 'opacity-100 translate-x-0'}`}
      >
        <MainPreview 
            isSidebarCollapsed={isSidebarCollapsed} 
            onToggleSidebar={toggleSidebar} 
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onSettingsClick={onSettingsClick}
            isResizing={isDragging || isTransitioning}
        />
      </div>
    </div>
  );
};

export default StagingView;
