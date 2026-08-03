/**
 * The two streaming progress indicators the chat transcript renders inline:
 * files being edited, and computer-use actions being performed.
 *
 * They are deliberate twins — same shimmer treatment, same collapse behaviour,
 * same dropdown for prior entries — so they live together and should be changed
 * together. Both animate with CSS transitions and the global animate-shimmer /
 * animate-textFadeIn keyframes, not framer-motion.
 */

import React, { useEffect, useState } from 'react';
import { ChevronDown, FileCode2, FlaskConical } from 'lucide-react';

// Collapsible Test Indicator Component - Matches CollapsibleFileIndicator exactly
// Shows: "Performing <action>" with shimmer animation while active, dropdown for action history
export const CollapsibleTestIndicator: React.FC<{ 
  actions: string[];  // List of actions performed (e.g., ["Analysis", "Click", "Type"])
  currentAction: string;
  isGenerating?: boolean;
  isStreaming?: boolean;
}> = ({ actions, currentAction, isGenerating = false, isStreaming = false }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [displayedAction, setDisplayedAction] = useState(currentAction);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  // Animate action name changes during streaming
  useEffect(() => {
    if (currentAction !== displayedAction) {
      if (isStreaming) {
        setIsTransitioning(true);
        const timer = setTimeout(() => {
          setDisplayedAction(currentAction);
          setIsTransitioning(false);
        }, 150);
        return () => clearTimeout(timer);
      } else {
        setDisplayedAction(currentAction);
      }
    }
  }, [currentAction, displayedAction, isStreaming]);
  
  // Status text: "Performing" while active, "Performed" when done
  const statusText = isGenerating ? 'Performing' : 'Performed';
  
  // Shimmer only when actively streaming AND generating
  const shouldShimmer = isStreaming && isGenerating;
  
  // Render status text with shimmer (exactly like CollapsibleFileIndicator)
  const renderStatusText = () => {
    const shimmerClass = shouldShimmer ? "animate-shimmer bg-clip-text text-transparent bg-[length:200%_100%]" : "";
    const shimmerStyle = shouldShimmer ? { backgroundImage: 'linear-gradient(90deg, #81888f 0%, #ffffff 50%, #81888f 100%)', animationDuration: '1.5s' } : {};
    
    return (
      <span className="text-[15.15px] inline-flex items-center gap-1">
        <span className={shimmerClass} style={shimmerStyle}>
          {statusText}
        </span>
        <span className="relative inline-block">
          <span 
            className="font-mono bg-white/5 px-1.5 py-0.5 rounded inline-block transition-opacity duration-300 ease-out"
            style={{ opacity: isTransitioning ? 0 : 1 }}
          >
            <span 
              className={shouldShimmer ? shimmerClass : ""}
              style={shouldShimmer ? shimmerStyle : { color: '#81888f' }}
            >
              {displayedAction}
            </span>
          </span>
        </span>
      </span>
    );
  };
  
  // Single action - show directly (no dropdown)
  if (actions.length <= 1) {
    return (
      <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
        <FlaskConical size={18} />
        {renderStatusText()}
      </div>
    );
  }
  
  // Multiple actions - show with dropdown
  return (
    <div className="space-y-0">
      {/* Header row with chevron pushed to far right */}
      <div className="flex items-center justify-between" style={{ color: '#81888f' }}>
        <div className="flex items-center gap-2.5">
          <FlaskConical size={18} />
          {renderStatusText()}
        </div>
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 hover:bg-white/10 rounded transition-colors"
        >
          <ChevronDown 
            size={16} 
            className={`transition-transform duration-300 ease-out ${isExpanded ? 'rotate-180' : ''}`} 
          />
        </button>
      </div>
      
      {/* Expanded actions list with smooth animation */}
      <div 
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="pt-4 space-y-4">
          {actions.slice(0, -1).map((action, i) => (
            <div 
              key={i} 
              className="flex items-center gap-2.5 transition-all duration-200"
              style={{ 
                color: '#81888f',
                opacity: isExpanded ? 1 : 0,
                transform: isExpanded ? 'translateY(0)' : 'translateY(-8px)',
                transitionDelay: `${i * 30}ms`
              }}
            >
              <FlaskConical size={18} />
              <span className="text-[15.15px]">Performed <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded" style={{ color: '#81888f' }}>{action}</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Collapsible File Indicator Component
export const CollapsibleFileIndicator: React.FC<{ 
  files: any[], 
  lastFileName: string, 
  isGenerating?: boolean, 
  isStreaming?: boolean,
  isExpanded?: boolean,
  setIsExpanded?: (expanded: boolean) => void 
}> = ({ files, lastFileName, isGenerating = false, isStreaming = false, isExpanded: externalExpanded, setIsExpanded: externalSetExpanded }) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [displayedFileName, setDisplayedFileName] = useState(lastFileName);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  // Use external state if provided, otherwise use internal
  const isExpanded = externalExpanded !== undefined ? externalExpanded : internalExpanded;
  const setIsExpanded = externalSetExpanded || setInternalExpanded;
  
  // Only animate file name changes during streaming
  useEffect(() => {
    if (lastFileName !== displayedFileName) {
      if (isStreaming) {
        // Start fade out
        setIsTransitioning(true);
        // After fade out, update displayed name and fade in
        const timer = setTimeout(() => {
          setDisplayedFileName(lastFileName);
          setIsTransitioning(false);
        }, 150); // Half of the transition duration
        return () => clearTimeout(timer);
      } else {
        // Not streaming, just update immediately
        setDisplayedFileName(lastFileName);
      }
    }
  }, [lastFileName, displayedFileName, isStreaming]);
  
  // Determine the status text for the current (top) file
  const statusText = isGenerating ? 'Editing' : 'Edited';
  
  // Animation class - only during streaming
  const animClass = isStreaming ? ' animate-textFadeIn' : '';
  
  // Shimmer only when actively streaming AND generating (prevents glow in saved messages)
  const shouldShimmer = isStreaming && isGenerating;
  
  // Render the status text with or without shimmer animation
  const renderStatusText = () => {
    const shimmerClass = shouldShimmer ? "animate-shimmer bg-clip-text text-transparent bg-[length:200%_100%]" : "";
    const shimmerStyle = shouldShimmer ? { backgroundImage: 'linear-gradient(90deg, #81888f 0%, #ffffff 50%, #81888f 100%)', animationDuration: '1.5s' } : {};
    
    return (
      <span className="text-[15.15px] inline-flex items-center gap-1">
        <span className={shimmerClass} style={shimmerStyle}>
          {statusText}
        </span>
        <span className="relative inline-block">
          {/* Background box - always visible */}
          <span 
            className="font-mono bg-white/5 px-1.5 py-0.5 rounded inline-block transition-opacity duration-300 ease-out"
            style={{ opacity: isTransitioning ? 0 : 1 }}
          >
            {/* Text with optional shimmer */}
            <span 
              className={shouldShimmer ? shimmerClass : ""}
              style={shouldShimmer ? shimmerStyle : { color: '#81888f' }}
            >
              {displayedFileName}
            </span>
          </span>
        </span>
      </span>
    );
  };
  
  if (files.length === 1) {
    // Single file - just show it directly
    return (
      <div className={`flex items-center gap-2.5${animClass}`} style={{ color: '#81888f' }}>
        <FileCode2 size={18} />
        {renderStatusText()}
      </div>
    );
  }
  
  return (
    <div className={`space-y-0${animClass}`}>
      {/* Header row with chevron pushed to far right */}
      <div className="flex items-center justify-between" style={{ color: '#81888f' }}>
        <div className="flex items-center gap-2.5">
          <FileCode2 size={18} />
          {renderStatusText()}
        </div>
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 hover:bg-white/10 rounded transition-colors"
        >
          <ChevronDown 
            size={16} 
            className={`transition-transform duration-300 ease-out ${isExpanded ? 'rotate-180' : ''}`} 
          />
        </button>
      </div>
      
      {/* Expanded files list with smooth animation */}
      <div 
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="pt-4 space-y-4">
          {files.slice(0, -1).map((file, i) => {
            const fileName = file.filePath?.split('/').pop() || file.content;
            return (
              <div 
                key={i} 
                className="flex items-center gap-2.5 transition-all duration-200"
                style={{ 
                  color: '#81888f',
                  opacity: isExpanded ? 1 : 0,
                  transform: isExpanded ? 'translateY(0)' : 'translateY(-8px)',
                  transitionDelay: `${i * 30}ms`
                }}
              >
                <FileCode2 size={18} />
                <span className="text-[15.15px]">Edited <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded" style={{ color: '#81888f' }}>{fileName}</span></span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
