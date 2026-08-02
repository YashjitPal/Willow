
import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import MainPreview from './components/MainPreview';

const App: React.FC = () => {
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [lastSidebarWidth, setLastSidebarWidth] = useState(400);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed(prev => {
      if (!prev) {
        setLastSidebarWidth(sidebarWidth);
      }
      return !prev;
    });
  }, [sidebarWidth]);

  const startResizing = useCallback(() => {
    setIsDragging(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsDragging(false);
  }, []);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isDragging) {
        const newWidth = mouseMoveEvent.clientX;
        const totalWidth = document.body.clientWidth;
        
        // Constraints: Min 1/5th of total width, Max 37% of total width
        const minWidth = totalWidth / 5;
        const maxWidth = totalWidth * 0.37;
        
        // Auto-collapse threshold: 50% of the minimum width
        const collapseThreshold = minWidth * 0.5;

        if (isSidebarCollapsed) {
          // Unsqueeze logic: If dragging past threshold from collapsed state
          if (newWidth > collapseThreshold) {
            setIsSidebarCollapsed(false);
            setSidebarWidth(minWidth);
            // End dragging to trigger the smooth open animation
            setIsDragging(false);
          }
        } else {
          // Squeeze logic
          if (newWidth < collapseThreshold) {
            setIsSidebarCollapsed(true);
            setIsDragging(false); // End dragging to trigger the smooth close animation
            return;
          }

          if (newWidth >= minWidth && newWidth <= maxWidth) {
            setSidebarWidth(newWidth);
          } else if (newWidth < minWidth && newWidth >= collapseThreshold) {
            // Dead zone behavior: Keep sidebar visually at minWidth while cursor moves
            setSidebarWidth(minWidth);
          }
        }
      }
    },
    [isDragging, isSidebarCollapsed]
  );

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  // Determine the effective width to render
  const effectiveWidth = isSidebarCollapsed ? 0 : sidebarWidth;

  return (
    <div className={`flex h-screen w-full bg-main overflow-hidden text-sm ${isDragging ? 'cursor-[ew-resize] select-none' : ''}`}>
      <div 
        style={{ width: `${effectiveWidth}px` }} 
        className={`flex-shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${isDragging ? 'transition-none' : ''}`}
      >
        <Sidebar 
          width={sidebarWidth} 
          isCollapsed={isSidebarCollapsed} 
          onToggle={toggleSidebar} 
        />
      </div>
      
      {/* Resizer Handle - Always visible to allow dragging from collapsed state */}
      <div 
        className="w-0 relative z-50 group flex-shrink-0"
        onMouseDown={startResizing}
      >
         {/* Visible Blue Line (The "left bar" of preview panel) */}
         <div 
           className={`absolute w-[1.5px] left-0 rounded-full transition-all duration-300 ease-in-out 
             bg-gradient-to-b from-transparent via-[#3b82f6] to-transparent
             ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
           `}
           style={{ 
             top: '56px', 
             bottom: '16px', 
             transform: isSidebarCollapsed ? 'translateX(15.25px)' : 'translateX(-0.75px)' 
           }}
         />
         
         {/* Invisible Hit Area - Increased width when collapsed to cover the gap */}
         <div 
            className={`absolute top-0 bottom-0 -left-1 bg-transparent cursor-[ew-resize] hover:bg-transparent ${isSidebarCollapsed ? '-right-4' : '-right-1'}`} 
         />
      </div>

      <MainPreview 
        isSidebarCollapsed={isSidebarCollapsed} 
        onToggleSidebar={toggleSidebar} 
      />
    </div>
  );
};

export default App;
