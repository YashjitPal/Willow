import React, { useEffect, useState, useRef, useCallback, useLayoutEffect } from "react";
import { X } from "lucide-react";
import { useStore } from "@nanostores/react";
import TopBar from "./StagingTopBar";
import StagingCodePanel from "./StagingCodePanel";
// ScanningOverlay import removed - component not yet created
import VisualEditingOverlay from "./VisualEditingOverlay";
import { sandpackStore } from "../../lib/sandpack";
import { CpuArchitecture } from "../ui/cpu-architecture";
import "../ui/cpu-architecture.css";
import { createPreviewURL, initBundler, bundleForHotUpdate } from "../../lib/preview";
import { testStore } from "../../lib/test-store";
import { isVisualEditMode, isScanning, isVisualEditing, visualEditorStore, codeNavigationRequest, previewRefreshRequest, requestInspectorReinit, immediateInspectorReinit, exitVisualEdit } from "../../lib/visual-editor";

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
};

interface MainPreviewProps {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  activeTab: string;
  onTabChange: (id: string) => void;
  onSettingsClick?: () => void;
  isResizing?: boolean;
  selectedModelId: string;
  modelConfig: any;
}

const MainPreview: React.FC<MainPreviewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  activeTab,
  onTabChange,
  onSettingsClick,
  isResizing,
  selectedModelId,
  modelConfig,
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

  // Use sandpack store - subscribe to file changes
  const filesMap = useStore(sandpackStore.files);
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
    const files: Record<string, string> = {};
    for (const [path, file] of Object.entries(filesMap)) {
      files[path] = (file as { content: string }).content;
    }
    console.log('[MainPreview] Files in store:', Object.keys(files));
    return files;
  }, [filesMap]);

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
        // ✨ NEW: Enable source location injection when in visual edit mode
        const isVisualEdit = isVisualEditMode.get();
        const url = await createPreviewURL(files, { injectSourceLocations: isVisualEdit });

        // Revoke previous URL
        if (previousUrlRef.current) {
          URL.revokeObjectURL(previousUrlRef.current);
        }
        previousUrlRef.current = url;
        lastBuildHadSourceLocationsRef.current = isVisualEdit;

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
        className={`flex-1 flex flex-col min-h-0 pr-4 pb-4 pt-0 ${isResizing ? '' : 'transition-[padding] duration-300 ease-in-out'} ${isSidebarCollapsed ? "pl-4" : "pl-0"}`}
      >
        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          {/* Main Panel Area */}
          <div className="relative flex-1 min-h-0">
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
              className={`absolute inset-0 bg-[#1c1c1c] rounded-[12px] overflow-hidden transition-opacity duration-150 ${
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
                    }}
                    style={{
                      pointerEvents: (isResizing || isTestMode || isVisualEdit) ? "none" : "auto",
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
