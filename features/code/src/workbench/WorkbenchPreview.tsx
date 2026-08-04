import React, { useEffect, useState, useRef, useCallback, useLayoutEffect } from "react";
import { X, Trash2, MousePointer2, Pencil, Hand, Palette, Image as ImageIcon, Star } from "lucide-react";
import { ReactFlow, ReactFlowProvider, Background, Panel, useStore as useRFStore } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore } from "@nanostores/react";
import TopBar from "./WorkbenchTopBar";
import CodePanel from "./CodePanel";
import { AgentBuilder } from "@willow/agent-builder/AgentBuilder";
// ScanningOverlay import removed - component not yet created
import VisualEditingOverlay from "../visual-editing/VisualEditingOverlay";
import { CpuArchitecture } from "@willow/ui/cpu-architecture";
import "@willow/ui/cpu-architecture.css";
import { DesignCanvas } from "@willow/design/DesignCanvas";
import { sandpackStore } from "../runtime/sandpack/sandpack-store";
import { createPreviewURL, initBundler, bundleForHotUpdate } from "../runtime/preview/index";
import { testStore } from "@willow/ai/computer-use/test-store";
import { isVisualEditMode, isScanning, isVisualEditing, visualEditorStore, codeNavigationRequest, previewRefreshRequest, requestInspectorReinit, immediateInspectorReinit, exitVisualEdit } from "../visual-editing/engine/index";
import { previewErrors, isErrorPanelOpen, addPreviewError, clearPreviewErrors, removePreviewError } from "@willow/core/error-store";
import { saveProjectCover } from "@willow/storage/media-storage";
import { readProjectRegistry, writeProjectRegistry } from "@willow/projects/registry";

// Import cursor image from cursor folder
import cursorImage from "@willow/assets/cursors/arrow.cur";

// Visual cursor overlay for Computer Use testing
const TestCursor: React.FC<{ iframeRef: React.RefObject<HTMLIFrameElement> }> = React.memo(({ iframeRef }) => {
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
      {/* Click Ripple Effect - Elegant expanding rings */}
      {isClicking && (
        <>
          {/* Inner ring - faster, smaller */}
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: 6,
              height: 6,
              top: -3,
              left: -3,
              border: '1.5px solid rgba(255, 255, 255, 0.8)',
              animation: 'rippleExpand 0.5s cubic-bezier(0.2, 0.6, 0.3, 1) forwards',
            }}
          />
          {/* Outer ring - slower, larger */}
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: 6,
              height: 6,
              top: -3,
              left: -3,
              border: '1px solid rgba(255, 255, 255, 0.4)',
              animation: 'rippleExpand 0.6s cubic-bezier(0.2, 0.6, 0.3, 1) 0.05s forwards',
            }}
          />
        </>
      )}
      
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

        @keyframes rippleExpand {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(8);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
});

// Pulsing blue glow overlay for testing mode with smooth fade in/out
const TestModeGlow: React.FC<{ isActive: boolean }> = React.memo(({ isActive }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  
  useEffect(() => {
    if (isActive) {
      // Always reset isVisible to false first to ensure animation plays
      if (!shouldRender) {
        setIsVisible(false);
        setShouldRender(true);
        // Small delay to trigger CSS transition (ensures opacity starts at 0)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setIsVisible(true);
          });
        });
      } else {
        setIsVisible(true);
      }
    } else {
      setIsVisible(false);
      // Wait for fade out animation to complete before unmounting
      const timeout = setTimeout(() => {
        setShouldRender(false);
      }, 1000); // Match the 1s fade duration
      return () => clearTimeout(timeout);
    }
  }, [isActive, shouldRender]);
  
  if (!shouldRender) return null;
  
  return (
    <div 
      className="absolute inset-0 pointer-events-none"
      style={{
        zIndex: 30,
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 1s ease-in-out',
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          boxShadow: 'inset 0 0 120px 30px rgba(59, 130, 246, 0.3), inset 0 0 60px rgba(59, 130, 246, 0.5)',
          animation: 'pulseGlowOpacity 3s ease-in-out infinite',
          willChange: 'opacity',
        }}
      />
    </div>
  );
});

// Floating status indicator for active testing
const TestStatusIndicator: React.FC<{ isActive: boolean }> = React.memo(({ isActive }) => {
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
      className="absolute bottom-8 inset-x-0 flex justify-center z-[35] pointer-events-none"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div className="flex items-center gap-2.5 pl-2.5 pr-2.5 py-2 bg-[#18181b]/80 backdrop-blur-md rounded-xl shadow-xl border border-white/5 text-gray-200 pointer-events-auto cursor-default select-none">
        {/* SVG Cursor Icon in blue - negative margins to not affect container height */}
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 flex-shrink-0 -mt-[15px] -mb-[11px] -ml-[12px]">
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
    </div>
  );
});

interface MainPreviewProps {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  activeTab: string;
  onTabChange: (id: string) => void;
  onSettingsClick?: () => void;
  isResizing?: boolean;
  isTransitioning?: boolean;
  selectedModelId: string;
  modelConfig: any;
  projectName?: string;
}

// Zoom percentage indicator (must be rendered inside ReactFlow)
const ZoomDisplay: React.FC = () => {
  const zoom = useRFStore((s) => s.transform[2]);
  const zoomPercentage = Math.round(zoom * 100);
  return (
    <Panel position="bottom-right" className="mb-6 mr-6">
      <div className="flex items-center justify-center px-3 py-1.5 h-8 bg-black/40 backdrop-blur-md rounded-xl text-white text-xs font-semibold shadow-xl">
        {zoomPercentage}%
      </div>
    </Panel>
  );
};

// Inner canvas component (must be inside ReactFlowProvider)
const CanvasEmptyStateInner: React.FC = () => {
  const [activeTool, setActiveTool] = useState<'cursor' | 'edit' | 'hand' | 'palette' | 'image' | 'star'>('hand');

  return (
    <div className="w-full h-full bg-[#0c0c0c]">
      <ReactFlow
        nodes={[]}
        edges={[]}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="xyflow-dark"
      >
        <Background gap={28} size={2} color="#27272a" />
        <ZoomDisplay />
        <Panel position="top-right" className="mt-6 mr-6 flex items-center h-full">
          <div className="flex flex-col items-center gap-2.5 px-2 py-2.5 bg-[#171717]/80 backdrop-blur-md rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all">
            {/* Cursor Button */}
            <button
              className={`w-[33px] h-[33px] rounded-full transition-colors flex items-center justify-center shrink-0 ${activeTool === 'cursor' ? 'bg-[#32323e] text-white' : 'text-[#a1a1aa] hover:bg-[#2b2b2b] hover:text-white'}`}
              title="Cursor (V)"
              onClick={() => setActiveTool('cursor')}
            >
              <MousePointer2 size={16} strokeWidth={2} />
            </button>

            {/* Edit Button */}
            <button
              className={`w-[33px] h-[33px] rounded-full transition-colors flex items-center justify-center shrink-0 ${activeTool === 'edit' ? 'bg-[#32323e] text-white' : 'text-[#a1a1aa] hover:bg-[#2b2b2b] hover:text-white'}`}
              title="Edit"
              onClick={() => setActiveTool('edit')}
            >
              <Pencil size={16} strokeWidth={2} className="relative left-[1px] top-[1px]" />
            </button>

            {/* Hand Tool */}
            <button
              className={`w-[33px] h-[33px] rounded-full transition-colors flex items-center justify-center shrink-0 ${activeTool === 'hand' ? 'bg-[#32323e] text-white' : 'text-[#a1a1aa] hover:bg-[#2b2b2b] hover:text-white'}`}
              title="Hand tool (H)"
              onClick={() => setActiveTool('hand')}
            >
              <Hand size={18} strokeWidth={2} />
            </button>

            {/* Divider */}
            <div className="w-5 h-[1px] bg-[#333333] my-1" />

            {/* Palette Tool */}
            <button
              className={`w-[33px] h-[33px] rounded-full transition-colors flex items-center justify-center shrink-0 ${activeTool === 'palette' ? 'bg-[#32323e] text-white' : 'text-[#a1a1aa] hover:bg-[#2b2b2b] hover:text-white'}`}
              title="Color Palette"
              onClick={() => setActiveTool('palette')}
            >
              <Palette size={18} strokeWidth={2} />
            </button>

            {/* Image Tool */}
            <button
              className={`w-[33px] h-[33px] rounded-full transition-colors flex items-center justify-center shrink-0 ${activeTool === 'image' ? 'bg-[#32323e] text-white' : 'text-[#a1a1aa] hover:bg-[#2b2b2b] hover:text-white'}`}
              title="Image"
              onClick={() => setActiveTool('image')}
            >
              <ImageIcon size={18} strokeWidth={2} />
            </button>

            {/* Divider */}
            <div className="w-5 h-[1px] bg-[#333333] my-1" />

            {/* Star Tool */}
            <button
              className={`w-[33px] h-[33px] rounded-full transition-colors flex items-center justify-center shrink-0 ${activeTool === 'star' ? 'bg-[#32323e] text-white' : 'text-[#a1a1aa] hover:bg-[#2b2b2b] hover:text-white'}`}
              title="Star"
              onClick={() => setActiveTool('star')}
            >
              <Star size={18} strokeWidth={2} />
            </button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
};

// Dedicated empty state for Canvas - wrapped in ReactFlowProvider like AgentBuilder
const CanvasEmptyState: React.FC = () => (
  <ReactFlowProvider>
    <CanvasEmptyStateInner />
  </ReactFlowProvider>
);

const MainPreview: React.FC<MainPreviewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  activeTab,
  onTabChange,
  onSettingsClick,
  isResizing,
  isTransitioning,
  selectedModelId,
  modelConfig,
  projectName = '',
}) => {
  // States
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isVisualEditReloading, setIsVisualEditReloading] = useState(false); // Brief overlay during visual edit reload
  const [bundlerReady, setBundlerReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previousUrlRef = useRef<string | null>(null);
  // ✨ Tracks the latest blob URL for "Open Externally" after hot updates
  // Hot updates don't change previewUrl (to avoid iframe reload), so this ref
  // holds the up-to-date blob URL for external opens
  const latestExternalUrlRef = useRef<string | null>(null);

  const filesMap = useStore(sandpackStore.files);
  const previewSnapshot = useStore(sandpackStore.previewSnapshot);
  const activeSnapshotId = useStore(sandpackStore.activeSnapshotId);
  const hasUserCode = useStore(sandpackStore.hasUserCode);
  const currentEditingFile = useStore(sandpackStore.currentEditingFile);
  const isGenerating = useStore(sandpackStore.isGenerating);
  const isTestMode = useStore(testStore.isTestMode);
  
  // Visual editor state
  const isVisualEdit = useStore(isVisualEditMode);
  const isScanningProject = useStore(isScanning);
  const isDoingVisualEdit = useStore(isVisualEditing);
  const refreshRequest = useStore(previewRefreshRequest);
  const wasVisualEditModeRef = useRef(false);
  const lastBuildHadSourceLocationsRef = useRef(false); // Track if we already have source locations

  // Error panel state
  const errors = useStore(previewErrors);
  const errorPanelOpen = useStore(isErrorPanelOpen);

  // Listen for PREVIEW_ERROR messages from the iframe and add to error store
  useEffect(() => {
    const handlePreviewError = (event: MessageEvent) => {
      if (event.data?.type === 'PREVIEW_ERROR' && event.data.message) {
        addPreviewError(event.data.errorType || 'Build Error', event.data.message);
      }
    };
    window.addEventListener('message', handlePreviewError);
    return () => window.removeEventListener('message', handlePreviewError);
  }, []);

  // Listen for code navigation requests and switch to code tab
  useEffect(() => {
    const unsubscribe = codeNavigationRequest.subscribe((request) => {
      if (request) {
        console.log('[MainPreview] Code navigation requested, switching to code tab');
        onTabChange('code');
      }
    });
    return unsubscribe;
  }, [onTabChange]);

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

  // Listen for preview errors and exit visual edit mode when they occur
  useEffect(() => {
    const handlePreviewError = (event: MessageEvent) => {
      if (event.data?.type === 'PREVIEW_ERROR') {
        console.log('[MainPreview] Preview error detected, exiting visual edit mode');
        // Exit visual edit mode when there's a build/runtime error
        if (isVisualEdit) {
          exitVisualEdit();
        }
      }
    };

    window.addEventListener('message', handlePreviewError);
    return () => window.removeEventListener('message', handlePreviewError);
  }, [isVisualEdit]);

  // Convert files to the format bundler expects
  const getFilesForBundler = useCallback(() => {
    if (previewSnapshot) {
      console.log('[MainPreview] Using preview snapshot files');
      return previewSnapshot;
    }
    const files: Record<string, string> = {};
    for (const [path, file] of Object.entries(filesMap)) {
      files[path] = (file as { content: string }).content;
    }
    console.log('[MainPreview] Files in store:', Object.keys(files));
    return files;
  }, [filesMap, previewSnapshot]);

  // ✨ CRITICAL: Rebuild preview with source locations when entering visual edit mode
  // Skip rebuild if we already have source locations from a previous build
  useEffect(() => {
    const justEnteredVisualEdit = isVisualEdit && !wasVisualEditModeRef.current;
    wasVisualEditModeRef.current = isVisualEdit;

    if (justEnteredVisualEdit && bundlerReady && hasUserCode) {
      // Check if we already have source locations in the current preview
      if (lastBuildHadSourceLocationsRef.current) {
        console.log('[MainPreview] Entering visual edit mode - source locations already present, skipping rebuild');
        return;
      }

      console.log('[MainPreview] Entering visual edit mode - rebuilding with source locations');

      const files = getFilesForBundler();
      const appFileKey = Object.keys(files).find(key =>
        key.includes('App.tsx') || key.includes('App.js') || key.includes('App.jsx')
      );

      if (appFileKey) {
        (async () => {
          try {
            // Rebuild with source location injection enabled
            const url = await createPreviewURL(files, { injectSourceLocations: true });
            if (previousUrlRef.current) {
              URL.revokeObjectURL(previousUrlRef.current);
            }
            previousUrlRef.current = url;
            lastBuildHadSourceLocationsRef.current = true;
            setPreviewUrl(url);
            console.log('[MainPreview] Preview rebuilt with source locations');
          } catch (error) {
            console.error('[MainPreview] Failed to rebuild with source locations:', error);
          }
        })();
      }
    }
  }, [isVisualEdit, bundlerReady, hasUserCode, getFilesForBundler]);

  // Track previous isGenerating state to detect completion
  const wasGeneratingRef = useRef(false);
  const isFirstBuild = useRef(true);
  const wasSnapshotRef = useRef(false);
  const wasActiveSnapshotIdRef = useRef(activeSnapshotId);

  // Update preview only when generation COMPLETES (not during)
  useEffect(() => {
    // Detect when generation just finished
    const justFinishedGenerating = wasGeneratingRef.current && !isGenerating;
    wasGeneratingRef.current = isGenerating;
    
    // Detect when user reverted to a snapshot
    const justReverted = wasActiveSnapshotIdRef.current !== activeSnapshotId;
    wasActiveSnapshotIdRef.current = activeSnapshotId;
    
    console.log('[MainPreview] Effect - bundlerReady:', bundlerReady, 'hasUserCode:', hasUserCode, 'isGenerating:', isGenerating, 'justFinished:', justFinishedGenerating, 'justReverted:', justReverted);
    
    if (!bundlerReady || !hasUserCode) return;
    
    // Only rebuild in four cases:
    // 1. First build (no preview URL yet)
    // 2. Generation just completed
    // 3. We are viewing a snapshot and it just changed, or we just exited snapshot mode
    // 4. We just reverted to a past snapshot state
    const isSnapshotMode = previewSnapshot !== null;
    const shouldBuild = !previewUrl || justFinishedGenerating || previewSnapshot !== null || wasSnapshotRef.current || justReverted;
    
    if (!shouldBuild) {
      console.log('[MainPreview] Skipping rebuild - generation in progress or no change');
      return;
    }

    wasSnapshotRef.current = isSnapshotMode;
    
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
        // ✨ NEW: Enable source location injection when in visual edit mode
        const isVisualEdit = isVisualEditMode.get();

        // ✨ HOT UPDATE: Try to hot update the preview if we already have a running iframe
        // This prevents the iframe from flickering white when switching to/from snapshots
        if (!isFirstBuild.current && previewUrl && iframeRef.current?.contentWindow) {
          try {
            const scriptCode = await bundleForHotUpdate(files, { injectSourceLocations: isVisualEdit });
            
            iframeRef.current.contentWindow.postMessage({
              type: 'HOT_UPDATE',
              scriptCode,
            }, '*');

            // Generate new blob URL in background for "Open Externally" feature
            const newExternalUrl = await createPreviewURL(files, { injectSourceLocations: isVisualEdit });
            if (latestExternalUrlRef.current) {
              URL.revokeObjectURL(latestExternalUrlRef.current);
            }
            latestExternalUrlRef.current = newExternalUrl;
            
            clearPreviewErrors();
            console.log('[MainPreview] Preview hot updated successfully');
            return; // Skip the full reload below
          } catch (hotUpdateError) {
            console.warn('[MainPreview] Hot update failed, falling back to full reload:', hotUpdateError);
          }
        }

        const url = await createPreviewURL(files, { injectSourceLocations: isVisualEdit });

        // Check if the build returned an error fallback page
        const isBuildError = url.includes('#build-error');

        if (isBuildError) {
          // Build failed — if we already have a working preview, keep it
          if (previewUrl && !previewUrl.includes('#build-error')) {
            URL.revokeObjectURL(url); // Discard the error fallback
            setIsPreviewLoading(false);
            console.log('[MainPreview] Build failed, keeping last good preview');
            return;
          }
          // First build ever — use the fallback so preview isn't gray
          if (previousUrlRef.current) {
            URL.revokeObjectURL(previousUrlRef.current);
          }
          previousUrlRef.current = url;
          setPreviewUrl(url);
          setIsPreviewLoading(false);
          isFirstBuild.current = false;
          console.log('[MainPreview] First build failed, showing blank fallback');
          return;
        }

        // Build succeeded — update normally
        if (previousUrlRef.current) {
          URL.revokeObjectURL(previousUrlRef.current);
        }
        previousUrlRef.current = url;
        lastBuildHadSourceLocationsRef.current = isVisualEdit;

        setPreviewUrl(url);
        setIsPreviewLoading(false);
        isFirstBuild.current = false;
        clearPreviewErrors();
        console.log('[MainPreview] Preview built successfully');
      } catch (error) {
        console.error('[MainPreview] Preview build failed:', error);
        setIsPreviewLoading(false);
      }
    };

    // Small delay to let files settle
    const timer = setTimeout(buildPreview, 150);
    return () => clearTimeout(timer);
  }, [bundlerReady, hasUserCode, isGenerating, getFilesForBundler, previewUrl, activeSnapshotId]);

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
      if (latestExternalUrlRef.current) {
        URL.revokeObjectURL(latestExternalUrlRef.current);
      }
    };
  }, []);

  // When previewUrl changes (full reload), clear the external URL ref
  // This ensures "Open Externally" uses the fresh previewUrl, not a stale hot-update URL
  useEffect(() => {
    if (previewUrl && latestExternalUrlRef.current) {
      URL.revokeObjectURL(latestExternalUrlRef.current);
      latestExternalUrlRef.current = null;
    }
  }, [previewUrl]);

  // Track visual edit completion for seamless preview refresh
  const wasDoingVisualEditRef = useRef(false);
  const savedScrollPositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastFilesHashRef = useRef<string>('');

  // ✨ CRITICAL: Save scroll position SYNCHRONOUSLY when files change in visual edit mode
  // This runs before async effects, ensuring scroll is captured before any rebuild
  useLayoutEffect(() => {
    if (!isVisualEdit || !iframeRef.current?.contentWindow) return;

    // Create a simple hash of file keys + content lengths to detect changes
    const filesHash = Object.entries(filesMap).map(([k, v]) => `${k}:${(v as { content: string }).content.length}`).sort().join(',');
    if (filesHash === lastFilesHashRef.current) return;
    lastFilesHashRef.current = filesHash;

    // Save current scroll position immediately (synchronously)
    // Always save, even if at (0, 0), so we can restore to top if needed
    if (!savedScrollPositionRef.current) {
      savedScrollPositionRef.current = {
        x: iframeRef.current.contentWindow.scrollX || 0,
        y: iframeRef.current.contentWindow.scrollY || 0,
      };
      console.log('[MainPreview] Pre-saved scroll position (layout):', savedScrollPositionRef.current);
    }
  }, [filesMap, isVisualEdit]);

  useEffect(() => {
    // Detect when visual edit just completed
    const justFinishedVisualEdit = wasDoingVisualEditRef.current && !isDoingVisualEdit;
    wasDoingVisualEditRef.current = isDoingVisualEdit;

    if (justFinishedVisualEdit && bundlerReady && hasUserCode) {
      const files = getFilesForBundler();
      const appFileKey = Object.keys(files).find(key =>
        key.includes('App.tsx') || key.includes('App.js') || key.includes('App.jsx')
      );

      if (appFileKey) {
        (async () => {
          try {
            // ✨ HOT UPDATE: Bundle and send via postMessage instead of changing blob URL
            const scriptCode = await bundleForHotUpdate(files, { injectSourceLocations: true });

            if (iframeRef.current?.contentWindow) {
              // Send the new code to the iframe - it will re-render in place
              iframeRef.current.contentWindow.postMessage({
                type: 'HOT_UPDATE',
                scriptCode,
              }, '*');

              console.log('[MainPreview] Visual edit hot update sent');
              clearPreviewErrors();

              // Re-inject inspector after a brief moment for the DOM to settle
              setTimeout(() => {
                if (isVisualEdit as boolean) {
                  immediateInspectorReinit();
                }
              }, 50);

              // ✨ Generate new blob URL in background for "Open Externally" feature
              // This doesn't change the iframe src (no reload), just updates the URL for external opens
              const newExternalUrl = await createPreviewURL(files, { injectSourceLocations: true });
              if (latestExternalUrlRef.current) {
                URL.revokeObjectURL(latestExternalUrlRef.current);
              }
              latestExternalUrlRef.current = newExternalUrl;
              console.log('[MainPreview] External URL updated for "Open in new tab"');
            } else {
              // Fallback: if iframe not accessible, do a full reload
              console.warn('[MainPreview] iframe not accessible, falling back to full reload');
              const url = await createPreviewURL(files, { injectSourceLocations: true });
              if (previousUrlRef.current) {
                URL.revokeObjectURL(previousUrlRef.current);
              }
              previousUrlRef.current = url;
              lastBuildHadSourceLocationsRef.current = true;
              setPreviewUrl(url);
            }
          } catch (error) {
            console.error('[MainPreview] Visual edit update failed:', error);
          }
        })();
      }
    }
  }, [isDoingVisualEdit, bundlerReady, hasUserCode, getFilesForBundler]);

  // Listen for manual refresh requests (e.g., after undo)
  const lastRefreshRequestRef = useRef(0);
  useEffect(() => {
    // Skip if no refresh requested or same as last handled
    if (refreshRequest === 0 || refreshRequest === lastRefreshRequestRef.current) return;
    lastRefreshRequestRef.current = refreshRequest;

    if (!bundlerReady || !hasUserCode) return;

    console.log('[MainPreview] Refresh requested (undo), using hot update');

    const files = getFilesForBundler();
    const appFileKey = Object.keys(files).find(key =>
      key.includes('App.tsx') || key.includes('App.js') || key.includes('App.jsx')
    );

    if (appFileKey) {
      (async () => {
        try {
          const isVisualEditActive = isVisualEditMode.get();

          // ✨ HOT UPDATE for undo: send via postMessage if possible
          if (isVisualEditActive && iframeRef.current?.contentWindow) {
            const scriptCode = await bundleForHotUpdate(files, { injectSourceLocations: true });
            iframeRef.current.contentWindow.postMessage({
              type: 'HOT_UPDATE',
              scriptCode,
            }, '*');

            console.log('[MainPreview] Undo hot update sent');
            clearPreviewErrors();

            // Re-inject inspector after DOM settles
            setTimeout(() => {
              if (isVisualEditMode.get()) {
                immediateInspectorReinit();
              }
            }, 50);

            // ✨ Generate new blob URL in background for "Open Externally" feature
            const newExternalUrl = await createPreviewURL(files, { injectSourceLocations: true });
            if (latestExternalUrlRef.current) {
              URL.revokeObjectURL(latestExternalUrlRef.current);
            }
            latestExternalUrlRef.current = newExternalUrl;
            console.log('[MainPreview] External URL updated after undo');
          } else {
            // Not in visual edit mode or no iframe access - full reload
            const url = await createPreviewURL(files, { injectSourceLocations: isVisualEditActive });
            if (previousUrlRef.current) {
              URL.revokeObjectURL(previousUrlRef.current);
            }
            previousUrlRef.current = url;
            lastBuildHadSourceLocationsRef.current = isVisualEditActive;
            setPreviewUrl(url);
            console.log('[MainPreview] Preview refreshed after undo (full reload)');
          }
        } catch (error) {
          console.error('[MainPreview] Refresh after undo failed:', error);
        }
      })();
    }
  }, [refreshRequest, bundlerReady, hasUserCode, getFilesForBundler]);

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
      // ✨ NEW: Enable source location injection when in visual edit mode
      const isVisualEdit = isVisualEditMode.get();
      const url = await createPreviewURL(files, { injectSourceLocations: isVisualEdit });

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
  // Uses latestExternalUrlRef if available (updated after hot updates), otherwise falls back to previewUrl
  const handleOpenInNewTab = useCallback(() => {
    const urlToOpen = latestExternalUrlRef.current || previewUrl;
    if (urlToOpen) {
      window.open(urlToOpen, '_blank');
    }
  }, [previewUrl]);

  // Capture snapshot of preview and save as project cover in IndexedDB
  const captureAndSaveCover = useCallback(async () => {
    if (!projectName || !iframeRef.current) return;
    
    // Resolve project ID from projectName in localStorage
    let projectId = null;
    try {
      const list = readProjectRegistry() as any[];
      const found = list.find((p: any) => p.name.toLowerCase() === projectName.toLowerCase());
      if (found) {
        projectId = found.id;
      }
    } catch (e) {
      return;
    }
    
    if (!projectId) return;

    try {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
      const body = doc?.body;
      if (!body) return;

      const { default: html2canvas } = await import('html2canvas');
      
      // Measure actual dimensions
      const rect = iframeRef.current.getBoundingClientRect();
      const actualWidth = rect.width || 800;
      const actualHeight = rect.height || 450;

      const canvas = await html2canvas(body, {
        width: actualWidth,
        height: actualHeight,
        scale: 0.3, // Scale down to keep cover lightweight (JPEG)
        useCORS: true,
        backgroundColor: '#1c1c1c',
        logging: false,
      });

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85); // JPEG 85% is extremely lightweight
      
      // Save project cover in IndexedDB
      await saveProjectCover(projectId, dataUrl);
      
      // Save hasCover = true in localStorage project list to keep metadata synced
      try {
          const list = readProjectRegistry() as any[];
          const idx = list.findIndex((p: any) => p.id === projectId);
          if (idx !== -1 && !list[idx].hasCover) {
            list[idx].hasCover = true;
            writeProjectRegistry(list);
            window.dispatchEvent(new Event('willow_projects_updated'));
          }
      } catch (e) {}

    } catch (err) {
      // Fail silently
    }
  }, [projectName]);

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
        className={`flex-1 flex flex-col min-h-0 pr-4 pb-4 pt-0 ${isSidebarCollapsed ? "pl-4" : "pl-0"}`}
        style={{
          ...(!isResizing && {
            transitionProperty: 'padding',
            transitionDuration: '500ms',
            transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)'
          })
        }}
      >
        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Snapshot Banner */}
          <div 
            className={`grid transition-[grid-template-rows,margin] duration-300 ease-in-out ${previewSnapshot ? 'grid-rows-[1fr] mb-3' : 'grid-rows-[0fr] mb-0'}`}
          >
            <div className="overflow-hidden">
              <div className={`bg-[#27272a] text-[13px] px-3 py-2.5 flex items-center justify-between rounded-[12px] shrink-0 transition-[opacity,transform,box-shadow] duration-300 ${previewSnapshot ? 'opacity-100 translate-y-0 shadow-lg' : 'opacity-0 -translate-y-4 shadow-none'}`}>
                <div className="flex items-center gap-2 pl-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-gray-400">
                    <path d="M12 8V12L15 15M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="font-medium text-gray-200">Time Travel Preview</span>
                  <span className="text-gray-500 hidden sm:inline">— Viewing a past state of your code</span>
                </div>
                <button 
                  onClick={() => sandpackStore.setPreviewSnapshot(null)}
                  className="bg-white/10 hover:bg-white/20 text-white font-medium px-4 py-1.5 rounded-full transition-colors text-[12px]"
                >
                  Back to Live Code
                </button>
              </div>
            </div>
          </div>

          {/* Main Panel Area */}
          <div className="relative flex-1 min-h-0 overflow-hidden rounded-[12px]">
            {/* Code Panel */}
            <div
              className={`absolute inset-0 transition-opacity duration-150 flex flex-col overflow-hidden ${
                activeTab === "code"
                  ? "opacity-100 z-10"
                  : "opacity-0 z-0 pointer-events-none"
              }`}
            >
              <div className="flex-1 min-h-0 w-full overflow-hidden">
                <CodePanel />
              </div>
            </div>

            {/* Agent Builder Panel */}
            <div
              className={`absolute inset-0 transition-opacity duration-150 flex flex-col overflow-hidden bg-[#141414] rounded-[12px] border border-[#27272a] ${
                activeTab === "agent-builder"
                  ? "opacity-100 z-10"
                  : "opacity-0 z-0 pointer-events-none"
              }`}
            >
              <AgentBuilder isSidebarCollapsed={isSidebarCollapsed} />
            </div>

            {/* Canvas Panel - dedicated container like Agent Builder */}
            <div
              className={`absolute inset-0 transition-opacity duration-150 overflow-hidden bg-[#0c0c0c] rounded-[12px] border border-[#27272a] ${
                activeTab === "canvas-screens" || activeTab === "canvas-elements"
                  ? "opacity-100 z-10"
                  : "opacity-0 z-0 pointer-events-none"
              }`}
            >
              <DesignCanvas />
            </div>

            {/* Preview Panel */}
            <div
              className={`absolute inset-0 bg-[#1c1c1c] rounded-[12px] overflow-hidden transition-opacity duration-150 ${
                (!(previewUrl && hasUserCode) || errors.length > 0) && activeTab !== 'canvas-screens' && activeTab !== 'canvas-elements' ? 'border border-[#27272a]' : ''
              } ${
                activeTab !== "code" && activeTab !== "agent-builder" && activeTab !== "canvas-screens" && activeTab !== "canvas-elements"
                  ? "opacity-100 z-10"
                  : "opacity-0 z-0 pointer-events-none"
              }`}
            >
              {/* Preview iframe */}
              {previewUrl && hasUserCode && (
                <div className="absolute inset-0 rounded-[12px]" style={{ clipPath: 'inset(0.5px round 12px)' }}>
                  <iframe
                    src={previewUrl}
                    className="w-full h-full border-0 rounded-[12px]"
                    title="Preview"
                    sandbox="allow-scripts allow-same-origin"
                    ref={(el) => {
                      // @ts-ignore - Store locally and in stores
                      iframeRef.current = el;
                      testStore.setIframeRef(el);
                      visualEditorStore.setIframeRef(el);
                    }}
                    onLoad={() => {
                      // ✨ Inject persistent theme color listener
                      // This allows ColorPicker to request colors even without Visual Edit mode
                      try {
                        const doc = iframeRef.current?.contentDocument;
                        if (doc && !doc.querySelector('#theme-listener-script')) {
                          const script = doc.createElement('script');
                          script.id = 'theme-listener-script';
                          script.textContent = `
                            (function() {
                              if (window.__themeColorListenerInjected) return;
                              window.__themeColorListenerInjected = true;
                              
                              function readColors() {
                                const semanticColors = [
                                  'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
                                  'destructive', 'destructive-foreground', 'muted', 'muted-foreground',
                                  'accent', 'accent-foreground', 'popover', 'popover-foreground',
                                  'card', 'card-foreground', 'warning', 'warning-foreground',
                                  'success', 'success-foreground', 'sidebar', 'sidebar-foreground',
                                  'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-accent',
                                  'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
                                  'border', 'input', 'ring', 'background', 'foreground'
                                ];
                                
                                const colors = {};
                                
                                // Find the best element to read from (deepest active container)
                                const candidates = [
                                  document.getElementById('root'),
                                  document.getElementById('app'),
                                  document.querySelector('main'),
                                  document.body,
                                  document.documentElement
                                ];
                                
                                // Use the first candidate that exists
                                const target = candidates.find(c => c);
                                
                                if (!target) return colors;
                                
                                const style = getComputedStyle(target);
                                console.log('[ThemeListener] Reading colors from:', target.tagName, target.id, target.className);

                                for (const name of semanticColors) {
                                  const value = style.getPropertyValue('--' + name).trim();
                                  if (value) {
                                    colors[name] = value;
                                  }
                                }
                                return colors;
                              }

                              window.addEventListener('message', (e) => {
                                if (e.data?.type === 'GET_THEME_COLORS') {
                                  try {
                                    const colors = readColors();
                                    console.log('[ThemeListener] Read ' + Object.keys(colors).length + ' colors');
                                    window.parent.postMessage({ type: 'THEME_COLORS_RESPONSE', colors }, '*');
                                  } catch (err) {
                                    console.error('[ThemeListener] Error reading colors:', err);
                                  }
                                }
                              });
                              
                              // Also automatically send initially after a short delay (for auto-sync)
                              setTimeout(() => {
                                 const colors = readColors();
                                 if (Object.keys(colors).length > 0) {
                                   try {
                                      window.parent.postMessage({ type: 'THEME_COLORS_RESPONSE', colors }, '*');
                                   } catch(e) {}
                                 }
                              }, 1000);
                            })();
                          `;
                          
                          // Ensure head exists, fallback to body
                          const target = doc.head || doc.body;
                          if (target) {
                             target.appendChild(script);
                             console.log('[MainPreview] Injected theme color listener');
                          } else {
                             console.error('[MainPreview] Could not find head or body to inject script');
                          }
                        }
                      } catch (e) {
                        console.error('[MainPreview] Failed to inject theme listener:', e);
                      }

                      // Restore scroll position after visual edit rebuild
                      if (savedScrollPositionRef.current && iframeRef.current?.contentWindow) {
                        const { x, y } = savedScrollPositionRef.current;
                        console.log('[MainPreview] Restoring scroll position:', x, y);
                        // Small delay to ensure content is rendered
                        setTimeout(() => {
                          iframeRef.current?.contentWindow?.scrollTo(x, y);
                          // Clear the reload overlay after scroll is restored
                          setIsVisualEditReloading(false);
                        }, 10);
                        savedScrollPositionRef.current = null;
                      } else {
                        // No scroll to restore, just clear the overlay
                        setIsVisualEditReloading(false);
                      }

                      // ✨ Re-inject inspector script if in visual edit mode
                      // This ensures tools like "Select Parent" work after an Undo/Reload
                      if (isVisualEdit as boolean) {
                          // USE IMMEDIATE REINIT: fast, silent, no delays
                          immediateInspectorReinit();
                      }

                      // Take a screenshot of the preview for project cover after rendering settles
                      setTimeout(() => {
                        captureAndSaveCover();
                      }, 1800);
                    }}
                    style={{
                      pointerEvents: (isResizing || isTransitioning || isTestMode || isVisualEdit) ? "none" : "auto",
                      opacity: isRefreshing ? 0 : 1,
                      transform: isRefreshing ? 'scale(0.995)' : 'scale(1)',
                      filter: isRefreshing ? 'blur(4px)' : 'blur(0px)',
                      transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  />

                  {/* Visual Edit Reload Overlay - Masks the brief flash during iframe reload */}
                  <div
                    className="absolute inset-0 z-[40] pointer-events-none transition-opacity duration-75 ease-out"
                    style={{
                      backgroundColor: '#1c1c1c',
                      opacity: isVisualEditReloading ? 0.95 : 0,
                    }}
                  />

                  {/* Visual Cursor Overlay for Computer Use Testing */}
                  <TestCursor iframeRef={iframeRef} />

                  {/* Computer Use Test Active Animation - Pulsing Blue Glow */}
                  <TestModeGlow isActive={isTestMode} />
                  
                  {/* Floating Status Indicator */}
                  <TestStatusIndicator isActive={isTestMode} />
                  
                  {/* Visual Editing Overlays */}
                  {isVisualEdit && (
                    <VisualEditingOverlay
                      iframeRef={iframeRef}
                      selectedModelId={selectedModelId}
                      modelConfig={modelConfig}
                      isReloading={isVisualEditReloading || isRefreshing}
                    />
                  )}
                  
                  {/* Resize Overlay - Prevents iframe from capturing mouse events and causing lag during drag */}
                  {(isResizing || isTransitioning) && (
                    <div className="absolute inset-0 z-[100] bg-transparent cursor-[ew-resize]" />
                  )}
                </div>
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
                
                @keyframes pulseGlowOpacity {
                  0%, 100% { 
                    opacity: 0.8;
                  }
                  50% { 
                    opacity: 1;
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
              {!hasUserCode && !isGenerating && activeTab !== 'canvas-screens' && activeTab !== 'canvas-elements' && (
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

          {/* Error Panel - appears below preview when toggled */}
          <div
            className="overflow-hidden transition-all duration-300 ease-in-out flex-shrink-0"
            style={{
              maxHeight: errorPanelOpen ? '240px' : '0px',
              opacity: errorPanelOpen ? 1 : 0,
            }}
          >
            <div className="border border-[#27272a] rounded-[12px] h-[224px] flex flex-col mt-3 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 h-9 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-white">Problems</span>
                  {errors.length > 0 && (
                    <span className="text-[11px] text-gray-500 bg-[#27272a] rounded px-1.5 py-px">{errors.length}</span>
                  )}
                </div>
                {errors.length > 0 && (
                  <button
                    onClick={clearPreviewErrors}
                    className="text-[12px] text-black bg-white hover:bg-gray-200 transition-colors rounded-full px-3 py-0.5 font-medium"
                  >
                    Fix
                  </button>
                )}
              </div>

              {/* Error list */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {errors.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-[13px] text-gray-600">
                    No problems
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {errors.map((err, i) => (
                      <div
                        key={err.id}
                        className={`group flex items-start gap-2.5 px-4 py-2 hover:bg-[#ffffff05] cursor-default ${i > 0 ? 'border-t border-[#27272a]/50' : ''}`}
                      >
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-red-500/70 flex-shrink-0 mt-[3px]" />
                        <div className="flex-1 min-w-0">
                          <span className="text-[12px] text-gray-300 leading-snug break-all">{err.message}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-gray-600">{err.type}</span>
                            <span className="text-[11px] text-gray-700">{new Date(err.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => removePreviewError(err.id)}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-gray-300 transition-opacity mt-0.5"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(MainPreview);
