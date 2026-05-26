import React, { useEffect, useState, useRef, useCallback } from "react";
import { X } from "lucide-react";
import { useStore } from "@nanostores/react";
import TopBar from "./StagingTopBar";
import StagingCodePanel from "./StagingCodePanel";
import { sandpackStore } from "~/lib/sandpack";
import { CpuArchitecture } from "../ui/cpu-architecture";
import "../ui/cpu-architecture.css";
import { createPreviewURL, initBundler } from "~/lib/preview";
import { testStore } from "../../lib/test-store";

// Import cursor image from cursor folder
import cursorImage from "../../../cursor/arrow.cur";

// Visual cursor overlay for Computer Use testing
const TestCursor: React.FC<{ iframeRef: React.RefObject<HTMLIFrameElement> }> = ({ iframeRef }) => {
  const cursorPosition = useStore(testStore.cursorPosition);
  const isClicking = useStore(testStore.isClicking);
  const currentThought = useStore(testStore.currentThought);
  
  // State for fade in/out animation
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  
  // Store last known position for fade-out animation (so cursor doesn't fly away)
  const [lastPosition, setLastPosition] = useState<{ x: number; y: number } | null>(null);
  
  // Ref to measure thought bubble content width
  const thoughtContainerRef = useRef<HTMLDivElement>(null);
  const [thoughtWidth, setThoughtWidth] = useState<number>(0);
  
  // Update last position when cursor moves
  useEffect(() => {
    if (cursorPosition) {
      setLastPosition(cursorPosition);
    }
    // Don't clear lastPosition when cursorPosition becomes null - we need it for fade out
  }, [cursorPosition]);
  
  // Handle cursor visibility with fade animation
  useEffect(() => {
    if (cursorPosition) {
      setShouldRender(true);
      // Small delay to trigger CSS transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    } else {
      setIsVisible(false);
      // Wait for fade out animation to complete before unmounting
      const timeout = setTimeout(() => {
        setShouldRender(false);
        setLastPosition(null); // Clear last position after fade out completes
      }, 400); // Match fade duration
      return () => clearTimeout(timeout);
    }
  }, [cursorPosition]);
  
  // Measure thought width when content changes - use RAF for smooth updates
  useEffect(() => {
    if (thoughtContainerRef.current && currentThought) {
      requestAnimationFrame(() => {
        if (thoughtContainerRef.current) {
          const newWidth = thoughtContainerRef.current.scrollWidth;
          setThoughtWidth(newWidth);
        }
      });
    } else {
      setThoughtWidth(0);
    }
  }, [currentThought]);
  
  if (!shouldRender || !iframeRef.current) return null;
  
  // Get iframe dimensions to convert normalized coords (0-1000) to pixels
  // Use lastPosition during fade-out so cursor stays in place
  const rect = iframeRef.current.getBoundingClientRect();
  const activePosition = cursorPosition || lastPosition;
  const x = activePosition ? (activePosition.x / 1000) * rect.width : 0;
  const y = activePosition ? (activePosition.y / 1000) * rect.height : 0;
  
  // Symmetric padding value (same on both sides)
  const bubblePadding = 10;
  // No dot, just text now
  
  return (
    <div 
      className="absolute pointer-events-none z-50"
      style={{
        left: x,
        top: y,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'scale(1)' : 'scale(0.9)',
        transition: 'left 0.4s cubic-bezier(0.16, 1, 0.3, 1), top 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease-out, transform 0.4s ease-out',
        willChange: 'transform, opacity, left, top',
      }}
    >
      {/* Click Ripple Effect - Centered on cursor tip */}
      <div 
        className={`absolute rounded-full border border-blue-400/40 pointer-events-none transition-all duration-500 ease-out ${
          isClicking ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
        }`}
        style={{
          width: 48,
          height: 48,
          // Center the 48px ripple on the cursor tip (0,0)
          top: -24,
          left: -24,
          background: 'radial-gradient(circle, rgba(96, 165, 250, 0.15) 0%, transparent 70%)',
          boxShadow: '0 0 20px rgba(96, 165, 250, 0.3)',
        }}
      />
      
      {/* Main Cursor Image with Floating Animation */}
      <div 
        className="relative"
        style={{
          transform: isClicking ? 'scale(0.9) rotate(-5deg)' : 'scale(1) rotate(0deg)',
          transition: 'transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)',
          animation: isClicking ? 'none' : 'cursorFloat 2.5s ease-in-out infinite',
        }}
      >
        <img 
          src={cursorImage}
          alt="Cursor"
          width={32}
          height={32}
          style={{ 
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
          }}
        />
      </div>

      {/* Thought Signature Bubble with Floating Animation & Smooth Width */}
      {currentThought && (
        <div 
          className="absolute left-4 top-8 bg-[#181818] text-white text-[12px] font-medium rounded-full shadow-xl border border-white/10 flex items-center z-50 pointer-events-auto"
          style={{
            animation: 'thoughtFloat 3s ease-in-out infinite',
            // Calculate total width: padding + text + padding (no dot anymore)
            width: thoughtWidth > 0 ? bubblePadding + thoughtWidth + bubblePadding : 'auto',
            transition: 'width 0.15s cubic-bezier(0, 0.4, 0.2, 1)',
            willChange: 'width',
            paddingTop: 6,
            paddingBottom: 6,
            paddingLeft: bubblePadding,
            paddingRight: bubblePadding,
            overflow: 'hidden',
          }}
        >
          {/* Text span with ref for measurement */}
          <span 
            ref={thoughtContainerRef}
            style={{ 
              whiteSpace: 'nowrap',
              display: 'inline-block',
            }}
          >
            {currentThought}
          </span>
        </div>
      )}
      
      <style>{`
        @keyframes cursorFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
        }
        
        @keyframes thoughtFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
};

// Pulsing blue glow overlay for testing mode with smooth fade in/out
const TestModeGlow: React.FC<{ isActive: boolean }> = ({ isActive }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  
  useEffect(() => {
    if (isActive) {
      // Always reset isVisible to false first to ensure animation plays
      setIsVisible(false);
      setShouldRender(true);
      // Small delay to trigger CSS transition (ensures opacity starts at 0)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    } else {
      setIsVisible(false);
      // Wait for fade out animation to complete before unmounting
      const timeout = setTimeout(() => {
        setShouldRender(false);
      }, 1000); // Match the 1s fade duration
      return () => clearTimeout(timeout);
    }
  }, [isActive]);
  
  if (!shouldRender) return null;
  
  return (
    <div 
      className="absolute inset-0 pointer-events-none"
      style={{
        zIndex: 30,
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 1s ease-in-out',
        animation: 'pulseGlow 3s ease-in-out infinite',
      }}
    />
  );
};

// Floating status indicator for active testing
const TestStatusIndicator: React.FC<{ isActive: boolean }> = ({ isActive }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  
  useEffect(() => {
    if (isActive) {
      setIsVisible(false);
      setShouldRender(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    } else {
      setIsVisible(false);
      const timeout = setTimeout(() => {
        setShouldRender(false);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [isActive]);

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    testStore.cancelTest(); // Properly cancel the running test
  };
  
  if (!shouldRender) return null;
  
  return (
    <div 
      className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2.5 pl-2.5 pr-2.5 py-2 bg-[#18181b]/80 backdrop-blur-md rounded-xl shadow-xl border border-white/5 text-gray-200 z-[35] pointer-events-auto cursor-default select-none"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translate(-50%, 0)' : 'translate(-50%, 20px)',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* SVG Cursor Icon in blue - negative margins to not affect container height */}
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 flex-shrink-0 -mt-[15px] -mb-[11px]">
        <g transform="rotate(-45, 100, 100)">
          <path d="M100 95 L125 145 Q 100 130 75 145 Z" 
                fill="#3B82F6" 
                stroke="#3B82F6" 
                strokeWidth="12" 
                strokeLinejoin="round" 
                strokeLinecap="round"/>
          <g stroke="#3B82F6" strokeWidth="3" strokeLinecap="round">
            <line x1="82" y1="87" x2="65" y2="70" />
            <line x1="94" y1="80" x2="88" y2="55" />
            <line x1="106" y1="80" x2="112" y2="55" />
            <line x1="118" y1="87" x2="135" y2="70" />
          </g>
        </g>
      </svg>
      <span className="text-[13px] font-medium tracking-wide">AI Testing in progress...</span>
      <div className="w-[1px] h-3.5 bg-white/10" />
      <button 
        onClick={handleStop}
        className="w-[26px] h-[26px] rounded-lg bg-[#3b82f6]/20 text-[#3b82f6] hover:bg-[#3b82f6]/30 transition-colors flex items-center justify-center flex-shrink-0 -my-1"
        title="Stop Testing"
      >
        <div className="w-[10px] h-[10px] bg-current rounded-[2px]" />
      </button>
    </div>
  );
};

interface MainPreviewProps {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  activeTab: string;
  onTabChange: (id: string) => void;
  onSettingsClick?: () => void;
  isResizing?: boolean;
}

const MainPreview: React.FC<MainPreviewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  activeTab,
  onTabChange,
  onSettingsClick,
  isResizing,
}) => {
  // States
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [bundlerReady, setBundlerReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previousUrlRef = useRef<string | null>(null);

  // Use sandpack store - subscribe to file changes
  const filesMap = useStore(sandpackStore.files);
  const hasUserCode = useStore(sandpackStore.hasUserCode);
  const currentEditingFile = useStore(sandpackStore.currentEditingFile);
  const isGenerating = useStore(sandpackStore.isGenerating);
  const isTestMode = useStore(testStore.isTestMode);

  // Initialize esbuild bundler on mount
  useEffect(() => {
    initBundler()
      .then(() => {
        console.log('[MainPreview] Bundler initialized');
        setBundlerReady(true);
      })
      .catch((err) => {
        console.error('[MainPreview] Failed to initialize bundler:', err);
      });
  }, []);

  // Convert files to the format bundler expects
  const getFilesForBundler = useCallback(() => {
    const files: Record<string, string> = {};
    for (const [path, file] of Object.entries(filesMap)) {
      files[path] = file.content;
    }
    console.log('[MainPreview] Files in store:', Object.keys(files));
    return files;
  }, [filesMap]);

  // Track previous isGenerating state to detect completion
  const wasGeneratingRef = useRef(false);
  const isFirstBuild = useRef(true);

  // Update preview only when generation COMPLETES (not during)
  useEffect(() => {
    // Detect when generation just finished
    const justFinishedGenerating = wasGeneratingRef.current && !isGenerating;
    wasGeneratingRef.current = isGenerating;
    
    console.log('[MainPreview] Effect - bundlerReady:', bundlerReady, 'hasUserCode:', hasUserCode, 'isGenerating:', isGenerating, 'justFinished:', justFinishedGenerating);
    
    if (!bundlerReady || !hasUserCode) return;
    
    // Only rebuild in two cases:
    // 1. First build (no preview URL yet)
    // 2. Generation just completed
    const shouldBuild = !previewUrl || justFinishedGenerating;
    
    if (!shouldBuild) {
      console.log('[MainPreview] Skipping rebuild - generation in progress or no change');
      return;
    }
    
    const files = getFilesForBundler();
    
    // Find any App file
    const appFileKey = Object.keys(files).find(key => 
      key.includes('App.tsx') || key.includes('App.js') || key.includes('App.jsx')
    );
    
    if (!appFileKey) {
      console.log('[MainPreview] No App file found in:', Object.keys(files));
      return;
    }
    
    console.log('[MainPreview] Building preview - first:', isFirstBuild.current, 'files:', Object.keys(files).length);
    
    // Show loading only for first build, subtle indicator for updates
    if (isFirstBuild.current) {
      setIsPreviewLoading(true);
    }

    const buildPreview = async () => {
      try {
        const url = await createPreviewURL(files);
        
        // Revoke previous URL
        if (previousUrlRef.current) {
          URL.revokeObjectURL(previousUrlRef.current);
        }
        previousUrlRef.current = url;
        
        setPreviewUrl(url);
        setIsPreviewLoading(false);
        isFirstBuild.current = false;
        console.log('[MainPreview] Preview built successfully');
      } catch (error) {
        console.error('[MainPreview] Preview build failed:', error);
        setIsPreviewLoading(false);
      }
    };

    // Small delay to let files settle
    const timer = setTimeout(buildPreview, 150);
    return () => clearTimeout(timer);
  }, [bundlerReady, hasUserCode, isGenerating, getFilesForBundler, previewUrl]);

  // Update generation status when editing file changes
  useEffect(() => {
    if (currentEditingFile) {
      setGenerationStatus(`Editing ${currentEditingFile}...`);
    } else {
      setGenerationStatus(null);
    }
  }, [currentEditingFile]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (previousUrlRef.current) {
        URL.revokeObjectURL(previousUrlRef.current);
      }
    };
  }, []);

  // Determine what to show in preview
  const showFullLoading = (isGenerating && !hasUserCode) || (!bundlerReady && hasUserCode);
  // Loading bar only shows during actual rebuild (not during AI generation)
  const showLoadingBar = hasUserCode && isPreviewLoading && !isGenerating;

  // Handle manual refresh with smooth fade
  const handleRefreshPreview = useCallback(async () => {
    if (!bundlerReady || !hasUserCode) return;
    
    const files = getFilesForBundler();
    const appFileKey = Object.keys(files).find(key => 
      key.includes('App.tsx') || key.includes('App.js') || key.includes('App.jsx')
    );
    
    if (!appFileKey) return;
    
    // Start fade out
    setIsRefreshing(true);
    
    // Wait for fade out animation
    await new Promise(resolve => setTimeout(resolve, 150));
    
    try {
      const url = await createPreviewURL(files);
      
      if (previousUrlRef.current) {
        URL.revokeObjectURL(previousUrlRef.current);
      }
      previousUrlRef.current = url;
      
      setPreviewUrl(url);
      
      // Small delay to let iframe start loading, then fade in
      setTimeout(() => {
        setIsRefreshing(false);
      }, 50);
      
      console.log('[MainPreview] Manual refresh completed');
    } catch (error) {
      console.error('[MainPreview] Manual refresh failed:', error);
      setIsRefreshing(false);
    }
  }, [bundlerReady, hasUserCode, getFilesForBundler]);

  // Handle opening preview in new tab
  const handleOpenInNewTab = useCallback(() => {
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    }
  }, [previewUrl]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1c1c1c] overflow-hidden">
      {/* TopBar - without terminal toggle */}
      <div className="flex-shrink-0">
        <TopBar
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          activeTab={activeTab}
          onTabChange={onTabChange}
          onSettingsClick={onSettingsClick}
          onRefreshPreview={handleRefreshPreview}
          onOpenInNewTab={handleOpenInNewTab}
        />
      </div>

      {/* Content Area */}
      <div
        className={`flex-1 flex flex-col min-h-0 pr-4 pb-4 pt-0 ${isResizing ? '' : 'transition-all duration-300 ease-in-out'} ${isSidebarCollapsed ? "pl-4" : "pl-0"}`}
      >
        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          {/* Main Panel Area */}
          <div className={`relative flex-1 min-h-0 ${isResizing ? '' : 'transition-all duration-300'}`}>
            {/* Code Panel */}
            <div
              className={`absolute inset-0 transition-opacity duration-150 flex flex-col overflow-hidden ${
                activeTab === "code"
                  ? "opacity-100 z-10"
                  : "opacity-0 z-0 pointer-events-none"
              }`}
            >
              <div className="flex-1 min-h-0 w-full overflow-hidden">
                <StagingCodePanel />
              </div>
            </div>

            {/* Preview Panel */}
            <div
              className={`absolute inset-0 bg-[#1c1c1c] border border-[#27272a] rounded-[12px] overflow-hidden transition-opacity duration-150 ${
                activeTab !== "code"
                  ? "opacity-100 z-10"
                  : "opacity-0 z-0 pointer-events-none"
              }`}
            >
              {/* Preview iframe */}
              {previewUrl && hasUserCode && (
                <>
                  <iframe
                    src={previewUrl}
                    className="w-full h-full border-0"
                    title="Preview"
                    sandbox="allow-scripts allow-same-origin"
                    ref={(el) => {
                      // @ts-ignore - Store locally and in testStore
                      iframeRef.current = el;
                      testStore.setIframeRef(el);
                    }}
                    style={{ 
                      pointerEvents: (isResizing || isTestMode) ? "none" : "auto",
                      opacity: isRefreshing ? 0 : 1,
                      transform: isRefreshing ? 'scale(0.995)' : 'scale(1)',
                      filter: isRefreshing ? 'blur(4px)' : 'blur(0px)',
                      transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  />
                  {/* Visual Cursor Overlay for Computer Use Testing */}
                  <TestCursor iframeRef={iframeRef} />

                  {/* Computer Use Test Active Animation - Pulsing Blue Glow */}
                  <TestModeGlow isActive={isTestMode} />
                  
                  {/* Floating Status Indicator */}
                  <TestStatusIndicator isActive={isTestMode} />
                  
                  {/* Resize Overlay - Prevents iframe from capturing mouse events and causing lag during drag */}
                  {isResizing && (
                    <div className="absolute inset-0 z-[100] bg-transparent cursor-[ew-resize]" />
                  )}
                </>
              )}

              {/* Premium Loading Bar */}
              {showLoadingBar && (
                <div className="absolute top-0 left-0 right-0 z-20 h-[2px] overflow-hidden">
                  <div className="h-full w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                  <div className="absolute inset-0 h-full w-1/4 animate-loading-bar">
                    <div className="h-full w-full bg-gradient-to-r from-transparent via-blue-400 to-transparent opacity-90 blur-[1px]" />
                    <div className="absolute inset-0 h-full w-full bg-gradient-to-r from-transparent via-blue-300 to-transparent" />
                  </div>
                </div>
              )}

              {/* Full Loading Overlay - when no visible preview yet */}
              {showFullLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#1c1c1c]">
                  <div className="flex flex-col items-center gap-8">
                    <div className="w-[400px] h-[200px]">
                      <CpuArchitecture className="text-gray-600" />
                    </div>
                    <div className="relative h-6 overflow-hidden">
                      <p
                        key={generationStatus || "default"}
                        className="text-[15px] font-medium animate-status-text"
                        style={{ color: "#81888f" }}
                      >
                        {!bundlerReady ? "Initializing bundler..." : generationStatus || "Generating code..."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Status text animation & Test Glow Animation */}
              <style>{`
                @keyframes statusFadeSlide {
                  0% {
                    opacity: 0;
                    transform: translateY(10px);
                    filter: blur(4px);
                  }
                  20% {
                    opacity: 1;
                    transform: translateY(0);
                    filter: blur(0);
                  }
                  80% {
                    opacity: 1;
                    transform: translateY(0);
                    filter: blur(0);
                  }
                  100% {
                    opacity: 1;
                    transform: translateY(0);
                    filter: blur(0);
                  }
                }
                
                @keyframes pulseGlow {
                  0%, 100% { 
                    box-shadow: inset 0 0 100px 25px rgba(59, 130, 246, 0.25), inset 0 0 50px rgba(59, 130, 246, 0.4);
                  }
                  50% { 
                    box-shadow: inset 0 0 120px 30px rgba(59, 130, 246, 0.3), inset 0 0 60px rgba(59, 130, 246, 0.5); 
                  }
                }

                .animate-status-text {
                  animation: statusFadeSlide 0.4s ease-out forwards;
                }
                @keyframes loadingBar {
                  0% {
                    transform: translateX(-100%);
                    opacity: 0;
                  }
                  10% {
                    opacity: 1;
                  }
                  90% {
                    opacity: 1;
                  }
                  100% {
                    transform: translateX(500%);
                    opacity: 0;
                  }
                }
                .animate-loading-bar {
                  animation: loadingBar 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
                }
              `}</style>

              {/* Empty State - only when no user code yet */}
              {!hasUserCode && !isGenerating && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-6 opacity-30">
                    <div className="w-24 h-24 text-gray-500">
                      <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="w-full h-full"
                      >
                        <path d="M11.96 0c0 6.6-5.36 11.96-11.96 11.96 6.6 0 11.96 5.36 11.96 11.96 0-6.6 5.36-11.96 11.96-11.96-6.6 0-11.96-5.36-11.96-11.96z" />
                      </svg>
                    </div>
                    <p className="text-gray-400 text-center max-w-md px-12 text-sm">
                      No preview available. Generate code to see a live preview
                      here.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MainPreview;
