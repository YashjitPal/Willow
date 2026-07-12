
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  ChevronDown, 
  ChevronRight,
  MousePointer2,
  Clock, 
  PanelLeftClose, 
  Lightbulb, 
  FileCode2, 
  Plus, 
  MessageSquare, 
  MoreHorizontal,
  ThumbsUp,
  ThumbsDown,
  Copy,
  AudioLines,
  ArrowUp,
  ArrowLeft,
  Sparkles,
  Check,
  Wrench,
  Palette,
  Beaker,
  Image as ImageIcon,
  FlaskConical,
  X,
  Globe,
  FileCode,
  Terminal,
  Loader2,
  Square,
  Play,
  CornerUpLeft,
  ArrowUpFromLine,
  AlignVerticalSpaceAround,
  AlignHorizontalSpaceAround,
  Scan,
  Type,
  Maximize2,

  CodeXml,
  CornerLeftUp,
  AlertTriangle,
  MessagesSquare,
  Library,
  Layout,
  Component,
  FileText
} from 'lucide-react';
import { AgentIcon } from '../ui/AgentIcon';
import { CanvasIcon } from '../ui/CanvasIcon';
import { enterVisualEdit, exitVisualEdit, isVisualEditMode, inspectorReady, isScanning, isSaving, selectedElement, selectedElements, type SelectedElement, hoveredElement, isVisualEditing, visualEditQueue, canUndo, undoLastVisualEdit, selectParentElement, setSelectedElements, navigateToCode, applyDirectStyle, getCurrentStyles, getFreshComputedStyles, formatColorForDisplay, isTransparent, isAtRootLevel, tailwindColorToCss, TAILWIND_SPACING, hasUnsavedChanges, discardVisualChanges, requestSelectionBoundsRefresh, selectionStyleRefreshRequest } from '../../lib/visual-editor';
import { useStore } from '@nanostores/react';
import { TextShimmer } from '../ui/text-shimmer';
import { MessageLoading } from '../ui/message-loading';
import logoG from '../../src/assets/logog.png';
import { ALL_TOOLS } from './StagingTopBar';
import '../SettingsModal.css';
import { useUserDataContext } from '../../context/UserDataContext';
import { streamChat, ChatMessage as AiChatMessage, prewarmClient } from '../../lib/ai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PROJECT_NAME_MODEL } from '@models';
import { runComputerUseTest, type TestUpdate, type ConversationMessage } from '../../lib/computer-use';
import { sandpackStore } from '../../lib/sandpack/sandpack-store';
import { workbenchStore, parseAIResponse, parseResponseForDisplay, type ChatSegment } from '../../lib/sandpack';
import { saveCodeSessions, loadCodeSessions } from '../../lib/willowDB';
import { BOLT_SYSTEM_PROMPT } from '../../lib/sandpack/system-prompt';
import { testStore } from '../../lib/test-store';
import { TestingIndicator, TestResultIndicator } from './TestingIndicator';
import { ColorPickerMenu } from './ColorPickerMenu';
import { VisualEditorSelectMenu } from './VisualEditorSelectMenu';
import { UnsavedChangesBar } from './UnsavedChangesBar';
import { UnsavedChangesModal } from './UnsavedChangesModal';
import { isSwarmRunning as swarmRunningAtom, swarmAgents as swarmAgentsAtom } from '../../lib/agent-swarm/swarm-store';
import { workflowList as agentWorkflowList, requestedWorkflowId, backendStatus as abBackendStatus } from '../../lib/stores/agent-builder-store';
import { newChatSignal } from '../../lib/stores/chat-store';
import { addDesignNode, focusDesignNode, selectedDesignNodeIds, designNodesStore } from '../../lib/stores/design-store';
import { useLocalFS } from '../../context/LocalFSContext';


// Collapsible Test Indicator Component - Matches CollapsibleFileIndicator exactly
// Shows: "Performing <action>" with shimmer animation while active, dropdown for action history
const CollapsibleTestIndicator: React.FC<{ 
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

const GeminiLogo = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 512 512" 
    fill="currentColor" 
    className={className}
  >
    <path d="M256 0C256 0 292 200 512 256C292 312 256 512 256 512C256 512 220 312 0 256C220 200 256 0 256 0Z" />
  </svg>
);

const AnnotateIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2.2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M4 12c0-4 4-7 8-7s8 3 8 7-4 7-8 7-8-3-8-7Z" className="opacity-40" strokeWidth="1.5" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const VisualEditsIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg" 
    className={className}
  >
    <path d="M3 9V6C3 4.344 4.344 3 6 3H9" 
          stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/>
    <path d="M15 3H18C20.1 3 21 3.9 21 6V9" 
          stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/>
    <path d="M3 15V18C3 20.1 3.9 21 6 21H9" 
          stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/>
    <path d="M11.25 11.25L15.75 22.5Q17.25 17.25 22.5 15.75L11.25 11.25Z" 
          stroke="currentColor" strokeWidth="2.1" fill="none"
          strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const MarginLeftIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="6" height="10" x="9" y="7" rx="2" />
    <path d="M4 21V3" />
  </svg>
);

const MarginRightIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="6" height="10" x="9" y="7" rx="2" />
    <path d="M20 21V3" />
  </svg>
);

const MarginTopIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="10" height="6" x="7" y="9" rx="2" />
    <path d="M3 4H21" />
  </svg>
);

const MarginBottomIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="10" height="6" x="7" y="9" rx="2" />
    <path d="M3 20H21" />
  </svg>
);

const PaddingHorizontalIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <rect width="18" height="18" x="3" y="3" rx="5" ry="5" />
    <path d="M9 8v8" />
    <path d="M15 8v8" />
  </svg>
);

const PaddingVerticalIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <rect width="18" height="18" x="3" y="3" rx="5" ry="5" />
    <path d="M8 9h8" />
    <path d="M8 15h8" />
  </svg>
);

const PaddingLeftIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="18" height="18" x="3" y="3" rx="5" ry="5" />
    <path d="M9 8v8" />
  </svg>
);

const PaddingRightIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="18" height="18" x="3" y="3" rx="5" ry="5" />
    <path d="M15 8v8" />
  </svg>
);

const PaddingTopIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="18" height="18" x="3" y="3" rx="5" ry="5" />
    <path d="M8 9h8" />
  </svg>
);

const PaddingBottomIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect width="18" height="18" x="3" y="3" rx="5" ry="5" />
    <path d="M8 15h8" />
  </svg>
);

// Collapsible File Indicator Component
const CollapsibleFileIndicator: React.FC<{ 
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

// Helper to strip code blocks and bolt artifact tags for clean text copying
const stripCodeAndIndicators = (content: string): string => {
  let text = content;
  // Remove boltArtifact and boltAction tags and their contents
  text = text.replace(/<boltArtifact[^>]*>[\s\S]*?<\/boltArtifact>/gi, '');
  text = text.replace(/<boltAction[^>]*>[\s\S]*?<\/boltAction>/gi, '');
  // Remove markdown code blocks
  text = text.replace(/```[\s\S]*?```/g, '');
  // Remove inline code
  text = text.replace(/`[^`]+`/g, '');
  // Clean up extra whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
};

// Agent Swarm Status Panel — shows per-agent status during swarm execution
const SwarmStatusPanel: React.FC = () => {
  const swarmRunning = useStore(swarmRunningAtom);
  const agents = useStore(swarmAgentsAtom);

  if (!swarmRunning) return null;

  const agentEntries = Object.entries(agents) as [string, { status: string; statusMessage: string; streamingText: string }][];

  return (
    <div className="mx-0 mb-4 bg-[#1e1e2e] border border-purple-500/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-purple-400 text-[13px] font-semibold">
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="text-purple-400">
          <circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/>
          <line x1="7" y1="7" x2="10" y2="10"/><line x1="17" y1="7" x2="14" y2="10"/><line x1="7" y1="17" x2="10" y2="14"/>
        </svg>
        <span>Agent Swarm Active</span>
      </div>
      {agentEntries.map(([id, agent]) => (
        <div key={id} className="flex items-center gap-3 text-[12px]">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            agent.status === 'coding' || agent.status === 'thinking' || agent.status === 'assessing' || agent.status === 'synthesizing'
              ? 'bg-green-400 animate-pulse'
              : agent.status === 'waiting' || agent.status === 'distributing'
              ? 'bg-yellow-400'
              : agent.status === 'done'
              ? 'bg-zinc-500'
              : agent.status === 'error'
              ? 'bg-red-400'
              : 'bg-zinc-600'
          }`} />
          <span className="text-zinc-300 font-medium w-[70px]">{id.charAt(0).toUpperCase() + id.slice(1)}</span>
          <span className="text-zinc-500 truncate flex-1">{agent.statusMessage || 'Idle'}</span>
        </div>
      ))}
    </div>
  );
};


interface SidebarProps {
  width: number;
  isCollapsed: boolean;
  onToggle: () => void;
  prompt?: string;
  initialAttachments?: any[];
  activeTab: string;
  onTabChange: (id: string) => void;
  isChatMode?: boolean;
  onHomeClick?: () => void;
  modelConfig: any;
  setModelConfig: React.Dispatch<React.SetStateAction<any>>;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  isResizing?: boolean;
  projectName?: string;
  isGeneratingName?: boolean;
  onSettingsClick?: (tab?: string) => void;
  agentSwarmEnabled?: boolean;
  onSwarmToggle?: (enabled: boolean) => void;
}

const VisualEditLoader = ({ 
  title = "Starting live preview...", 
  subtitle = "Hang on while we get everything set up" 
}: { 
  title?: string; 
  subtitle?: string; 
}) => (
  <div className="flex flex-col items-center justify-center">
    <div className="relative w-5 h-5 flex items-center justify-center mb-6">
      <div className="absolute w-full h-full rounded-full border-2 border-white opacity-0 animate-ripple ring-wait" />
      <div className="absolute w-full h-full rounded-full border-2 border-white opacity-0 animate-ripple" />
    </div>
    <div className="text-center space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150">
      <h3 className="text-white font-medium text-lg">{title}</h3>
      <p className="text-[#81888f] text-sm">{subtitle}</p>
    </div>
    <style>{`
      @keyframes ripple {
        0% {
          transform: scale(0);
          opacity: 1;
          border-width: 5px;
        }
        100% {
          transform: scale(1.5);
          opacity: 0;
          border-width: 0px;
        }
      }
      .animate-ripple {
        animation: ripple 2s cubic-bezier(0, 0.2, 0.8, 1) infinite;
      }
      .ring-wait {
        animation-delay: -1s;
      }
    `}</style>
  </div>
);

// Warning shown for elements with dynamic/inline styles (Centered UI)
const DynamicStylingWarning = () => (
  <div className="relative flex flex-col items-center">
    <div className="mb-6">
       <CodeXml size={20} className="text-white" strokeWidth={1.5} />
    </div>
    
    <h2 className="text-lg font-semibold text-white mb-2">Element with dynamic styling</h2>
    
    <p className="text-[#81888f] leading-relaxed mb-0 max-w-[280px] text-center">
      This element has dynamic styling that can't be edited directly. Ask Lovable AI to modify it, or reset to static classes.
    </p>
    
    <div className="absolute top-full pt-4">
      <button className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-white rounded-md text-[13px] font-medium transition-colors">
        Reset styling
      </button>
    </div>
  </div>
);



const OPACITY_OPTIONS = Array.from({ length: 11 }, (_, i) => `${(10 - i) * 10}%`); // 100% down to 0%
const BORDER_RADIUS_OPTIONS = ['None', 'Small', 'Default', 'Medium', 'Large', 'Extra Large', '2XL', '3XL', 'Full'];
const SHADOW_OPTIONS = ['None', 'Small', 'Default', 'Medium', 'Large', 'Extra Large', '2XL', 'Inner shadow'];
const FONT_SIZE_OPTIONS = ['Extra Small', 'Small', 'Base', 'Large', 'Extra Large', '2XL', '3XL', '4XL', '5XL'];
const FONT_WEIGHT_OPTIONS = ['Thin', 'Extra Light', 'Light', 'Normal', 'Medium', 'Semibold', 'Bold', 'Extra Bold', 'Black'];
const TEXT_ALIGN_OPTIONS = ['Left', 'Center', 'Right', 'Justify'];
const BORDER_WIDTH_OPTIONS = ['None', '1px', '2px', '4px', '8px'];
const BORDER_STYLE_OPTIONS = ['Solid', 'Dashed', 'Dotted', 'Double', 'None'];

const VisualEditMenu = ({ onBack, isCompact = false }: { onBack: () => void; isCompact?: boolean }) => {
  const isReady = useStore(inspectorReady);
  const scanning = useStore(isScanning);
  const saving = useStore(isSaving);
  const files = useStore(sandpackStore.files);
  const selection = useStore(selectedElement);
  const selectedEls = useStore(selectedElements);
  const isEditing = useStore(isVisualEditing); // Track visual edit state
  const editQueue = useStore(visualEditQueue); // Track visual edit queue
  const hasUndo = useStore(canUndo); // Track undo history availability
  const styleRefresh = useStore(selectionStyleRefreshRequest); // Track undo/discard style refresh
  const [expandMargin, setExpandMargin] = useState(false);
  const [expandPadding, setExpandPadding] = useState(false);
  const [activeColorMenu, setActiveColorMenu] = useState<'text' | 'bg' | 'border' | null>(null);
  const [activeEffectMenu, setActiveEffectMenu] = useState<'opacity' | 'radius' | 'shadow' | null>(null);
  const [activeTypographyMenu, setActiveTypographyMenu] = useState<'fontSize' | 'fontWeight' | 'textAlign' | null>(null);
  const [activeBorderMenu, setActiveBorderMenu] = useState<'borderWidth' | 'borderStyle' | null>(null);
  const textInheritRef = useRef<HTMLDivElement>(null);
  const bgInheritRef = useRef<HTMLDivElement>(null);
  const borderColorRef = useRef<HTMLDivElement>(null);
  const opacityRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const borderRadiusRef = useRef<HTMLDivElement>(null);
  const fontSizeRef = useRef<HTMLDivElement>(null);
  const fontWeightRef = useRef<HTMLDivElement>(null);
  const textAlignRef = useRef<HTMLDivElement>(null);
  const borderWidthRef = useRef<HTMLDivElement>(null);
  const borderStyleRef = useRef<HTMLDivElement>(null);

  // Spacing input values - derived from selection's computed/class styles
  const [marginX, setMarginX] = useState('0');
  const [marginY, setMarginY] = useState('0');
  const [marginTop, setMarginTop] = useState('0');
  const [marginRight, setMarginRight] = useState('0');
  const [marginBottom, setMarginBottom] = useState('0');
  const [marginLeft, setMarginLeft] = useState('0');
  const [paddingX, setPaddingX] = useState('0');
  const [paddingY, setPaddingY] = useState('0');
  const [paddingTop, setPaddingTop] = useState('0');
  const [paddingRight, setPaddingRight] = useState('0');
  const [paddingBottom, setPaddingBottom] = useState('0');
  const [paddingLeft, setPaddingLeft] = useState('0');

  // Current style values for display
  const [currentStyles, setCurrentStyles] = useState<Record<string, string>>({});

  // Helper to check if a string contains only emojis (and whitespace)
  // Emojis include: emoticons, symbols, dingbats, and extended pictographics
  const isEmojiOnly = (text: string): boolean => {
    // Remove all emoji characters and whitespace, check if anything remains
    // This regex matches most common emoji ranges including:
    // - Emoticons (1F600-1F64F)
    // - Misc Symbols & Pictographs (1F300-1F5FF)
    // - Transport & Map Symbols (1F680-1F6FF)
    // - Supplemental Symbols (1F900-1F9FF)
    // - Symbols & Pictographs Extended-A (1FA00-1FAFF)
    // - Regional Indicators (1F1E0-1F1FF)
    // - Various common symbols (2600-26FF, 2700-27BF)
    // - Variation selectors and ZWJ sequences
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;
    const withoutEmojis = text.replace(emojiRegex, '').trim();
    return withoutEmojis.length === 0 && text.trim().length > 0;
  };

  // Determine if the selected element has text content (for showing/hiding text-related options)
  // Excludes emoji-only content since emojis don't benefit from text styling
  // TODO: To properly check for DIRECT text nodes only (not descendant text), we need to add
  // a `hasDirectText` property to SelectedElement computed in the iframe
  const NON_TEXT_TAGS = ['img', 'svg', 'hr', 'br', 'video', 'audio', 'iframe', 'canvas'];
  const hasText = selection && (
    !NON_TEXT_TAGS.includes(selection.tagName) &&
    selection.textContent.trim().length > 0 &&
    !isEmojiOnly(selection.textContent)
  );

  // Elements that don't meaningfully support box styling (void elements)
  const VOID_ELEMENTS = ['br', 'hr', 'wbr', 'col', 'embed', 'source', 'track'];
  // Inline text elements where border/effects don't make visual sense
  const INLINE_TEXT_ELEMENTS = ['span', 'a', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'sub', 'sup', 'code', 'kbd', 'samp', 'var', 'cite', 'q', 'abbr', 'time', 'dfn', 'label'];

  // Check if element supports box model styling
  const hasBoxModel = selection && !VOID_ELEMENTS.includes(selection.tagName);

  // Check if the element can have border/effects
  // Hide for void elements AND inline text elements (they don't benefit visually)
  const isInlineText = selection && INLINE_TEXT_ELEMENTS.includes(selection.tagName);
  const canHaveBorder = hasBoxModel && !isInlineText;
  const canHaveEffects = hasBoxModel && !isInlineText;

  // Track the UID of the last selected element to avoid overwriting user input
  const lastSelectedUidRef = useRef<string | null>(null);
  // Track the last style refresh to detect undo/discard changes
  const lastStyleRefreshRef = useRef<number>(0);

  // Update current styles when selection changes - but only sync spacing when element changes
  useEffect(() => {
    if (selection) {
      const styles = getCurrentStyles(selection);

      // On style refresh (undo/discard), re-derive computed color values from the
      // Tailwind class names (already read from source by getCurrentStyles above).
      // We can't use getFreshComputedStyles here because the iframe is mid-HMR reload.
      const isStyleRefresh = styleRefresh !== lastStyleRefreshRef.current;
      if (isStyleRefresh) {
        lastStyleRefreshRef.current = styleRefresh;
        // Derive _computedBgColor from bgColor class name
        if (styles.bgColor) {
          const cssColor = tailwindColorToCss(styles.bgColor);
          if (cssColor) styles._computedBgColor = cssColor;
        } else {
          styles._computedBgColor = 'rgba(0, 0, 0, 0)';
        }
        // Derive _computedColor from textColor class name
        if (styles.textColor) {
          const cssColor = tailwindColorToCss(styles.textColor);
          if (cssColor) styles._computedColor = cssColor;
        }
      }

      setCurrentStyles(styles);

      // Update spacing inputs when a DIFFERENT element is selected OR when a style refresh
      // is triggered (undo/discard). This prevents overwriting user input during preview
      // refresh, but ensures spacing values are re-synced after undo/discard.
      const currentUid = selection.uid;

      if (lastSelectedUidRef.current !== currentUid || isStyleRefresh) {
        lastSelectedUidRef.current = currentUid;

        // Convert Tailwind spacing keys to pixel values for display
        // If the value is a Tailwind key like "4", convert to pixel "16"
        // If it's already a pixel value like "[14px]", extract just the number
        const toPx = (val: string | undefined): string => {
          if (!val) return '0';
          // Handle arbitrary value syntax like "[14px]"
          if (val.startsWith('[') && val.endsWith(']')) {
            return val.slice(1, -1).replace('px', '');
          }
          // Check if it's a Tailwind key
          const px = TAILWIND_SPACING[val];
          return px || val;
        };

        // Parse computed CSS margin/padding values (e.g., "16px" or "16px 8px 16px 8px")
        // Returns [top, right, bottom, left] as strings
        const parseComputedSpacing = (computed: string | undefined): [string, string, string, string] => {
          if (!computed) return ['0', '0', '0', '0'];
          const parts = computed.split(' ').map(p => p.replace('px', '').trim());
          if (parts.length === 1) {
            return [parts[0], parts[0], parts[0], parts[0]];
          } else if (parts.length === 2) {
            return [parts[0], parts[1], parts[0], parts[1]];
          } else if (parts.length === 3) {
            return [parts[0], parts[1], parts[2], parts[1]];
          } else if (parts.length >= 4) {
            return [parts[0], parts[1], parts[2], parts[3]];
          }
          return ['0', '0', '0', '0'];
        };

        // Get computed margins as fallback
        const [computedMarginTop, computedMarginRight, computedMarginBottom, computedMarginLeft] = parseComputedSpacing(styles._computedMargin);
        const [computedPaddingTop, computedPaddingRight, computedPaddingBottom, computedPaddingLeft] = parseComputedSpacing(styles._computedPadding);

        // Update margin inputs - use Tailwind class values if available, else computed values
        setMarginX(toPx(styles.marginX) || computedMarginLeft);
        setMarginY(toPx(styles.marginY) || computedMarginTop);
        setMarginTop(toPx(styles.marginTop) || computedMarginTop);
        setMarginRight(toPx(styles.marginRight) || computedMarginRight);
        setMarginBottom(toPx(styles.marginBottom) || computedMarginBottom);
        setMarginLeft(toPx(styles.marginLeft) || computedMarginLeft);

        // Update padding inputs - use Tailwind class values if available, else computed values
        setPaddingX(toPx(styles.paddingX) || computedPaddingLeft);
        setPaddingY(toPx(styles.paddingY) || computedPaddingTop);
        setPaddingTop(toPx(styles.paddingTop) || computedPaddingTop);
        setPaddingRight(toPx(styles.paddingRight) || computedPaddingRight);
        setPaddingBottom(toPx(styles.paddingBottom) || computedPaddingBottom);
        setPaddingLeft(toPx(styles.paddingLeft) || computedPaddingLeft);
      }
    } else {
      // Reset tracking when no selection
      lastSelectedUidRef.current = null;
    }
  }, [selection, styleRefresh]);

  // Text-related style types that should be applied to the text source element
  const TEXT_STYLE_TYPES = ['textColor', 'fontSize', 'fontWeight', 'fontFamily', 'textAlign', 'lineHeight', 'letterSpacing'];

  // Helper to apply a style change
  const handleStyleChange = async (type: string, value: string) => {
    if (!selection) {
      return;
    }

    // For text-related styles, use textSourceElement if available
    const isTextStyle = TEXT_STYLE_TYPES.includes(type);
    const targetElement = isTextStyle && selection.textSourceElement
      ? {
          ...selection,
          uid: selection.textSourceElement.uid,
          tagName: selection.textSourceElement.tagName,
          classNames: selection.textSourceElement.classNames,
          sourceLocation: selection.textSourceElement.sourceLocation
        }
      : selection;

    if (!targetElement.sourceLocation) {
      return;
    }
    try {
      const result = await applyDirectStyle(targetElement, { type: type as any, value });
      if (result.success) {
        // IMMEDIATELY update the state with the value we just set
        // Don't wait for file re-read - we already know the value
        const updates: Record<string, string> = { [type]: value };

        // Also update computed color preview for color types
        if (type === 'textColor') {
          const cssColor = tailwindColorToCss(value);
          if (cssColor) {
            updates._computedColor = cssColor;
          }
        } else if (type === 'bgColor') {
          const cssColor = tailwindColorToCss(value);
          if (cssColor) {
            updates._computedBgColor = cssColor;
          }
        } else if (type === 'borderColor') {
          const cssColor = tailwindColorToCss(value);
          if (cssColor) {
            updates._computedBorderColor = cssColor;
          }
        }

        setCurrentStyles(prev => ({
          ...prev,
          ...updates
        }));
        // Note: Spacing input state is already set by handleSpacingChange before calling this function,
        // so we don't update it again here to avoid overwriting user's typed input

        // Trigger selection bounds refresh after a small delay to let the preview re-layout
        // This makes the selection overlay follow the element when margin/padding shifts it
        setTimeout(() => {
          requestSelectionBoundsRefresh();
        }, 50);
      }
    } catch (error) {
      // Style application failed silently
    }
  };

  // Ordered pixel values for stepping (corresponding to Tailwind spacing scale)
  const SPACING_STEPS = ['0', '2', '4', '6', '8', '10', '12', '14', '16', '20', '24', '28', '32', '36', '40', '44', '48', '56', '64', '80', '96'];

  // Convert Tailwind spacing key to display value (px) - kept for backward compatibility
  const spacingToDisplay = (key: string): string => {
    if (!key || key === '0') return '0';
    const px = TAILWIND_SPACING[key];
    return px || key;
  };

  // Step spacing up/down through pixel values
  const stepSpacing = (type: string, currentValue: string, direction: 1 | -1, setter: (v: string) => void) => {
    const currentPx = parseInt(currentValue, 10) || 0;
    
    // Find the nearest step
    let currentIndex = SPACING_STEPS.findIndex(s => parseInt(s, 10) >= currentPx);
    if (currentIndex === -1) currentIndex = SPACING_STEPS.length - 1;
    
    // If current value is exactly a step, use that index; otherwise we're between steps
    if (SPACING_STEPS[currentIndex] !== currentValue && direction === -1 && currentIndex > 0) {
      // Going down from a non-standard value: go to the step below
      currentIndex = currentIndex;
    }
    
    let newIndex = Math.max(0, Math.min(SPACING_STEPS.length - 1, currentIndex + direction));
    const newValue = SPACING_STEPS[newIndex];
    setter(newValue);
    handleStyleChange(type, newValue);
  };


  // Spacing change handler for manual text input - NO DEBOUNCE for immediate feedback
  const handleSpacingChange = (type: string, value: string, setter: (v: string) => void) => {
    setter(value);
    // Apply immediately like color changes
    handleStyleChange(type, value);
  };

  // Normalize empty spacing inputs to "0" on blur
  const handleSpacingBlur = (value: string, setter: (v: string) => void, type: string) => {
    if (value.trim() === '') {
      setter('0');
      handleStyleChange(type, '0');
    }
  };

  // Toggle margin expand with value synchronization
  // When expanding: Copy X to Left/Right, Y to Top/Bottom
  // When collapsing: Copy Left to X, Top to Y (consistent with which inputs are visible first)
  const toggleExpandMargin = () => {
    if (!expandMargin) {
      // Expanding: 2-option → 4-option
      // Copy X (horizontal) to Left and Right
      setMarginLeft(marginX);
      setMarginRight(marginX);
      // Copy Y (vertical) to Top and Bottom
      setMarginTop(marginY);
      setMarginBottom(marginY);
    } else {
      // Collapsing: 4-option → 2-option
      // Use Left for X (it's the first horizontal input shown)
      setMarginX(marginLeft);
      // Use Top for Y (it's the first vertical input shown)
      setMarginY(marginTop);
    }
    setExpandMargin(!expandMargin);
  };

  // Toggle padding expand with value synchronization
  const toggleExpandPadding = () => {
    if (!expandPadding) {
      // Expanding: 2-option → 4-option
      setPaddingLeft(paddingX);
      setPaddingRight(paddingX);
      setPaddingTop(paddingY);
      setPaddingBottom(paddingY);
    } else {
      // Collapsing: 4-option → 2-option
      setPaddingX(paddingLeft);
      setPaddingY(paddingTop);
    }
    setExpandPadding(!expandPadding);
  };

  // Track if user has ever selected something in this visual edit session
  // This persists even after selection is cleared (when prompt is submitted)
  const [hasEverSelected, setHasEverSelected] = useState(false);

  // Update hasEverSelected when selection changes
  useEffect(() => {
    if (selection) {
      setHasEverSelected(true);
    }
  }, [selection]);

  const handleBack = () => {
     onBack();
  };

  // Check if there's an actual app in the codebase (files beyond just initial empty state)
  const hasApp = Object.keys(files).length > 0;

  // Minimum loader display time so the entrance animation always plays fully
  const [minLoaderActive, setMinLoaderActive] = useState(true);
  useEffect(() => {
    // Reset minimum loader on each mount (re-entering visual edit)
    setMinLoaderActive(true);
    const timer = setTimeout(() => setMinLoaderActive(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Show loading during scan or init or saving, with minimum display time
  const showLoading = scanning || !isReady || !hasApp || saving || minLoaderActive;

  // Handle undo button click
  const handleUndo = () => {
    undoLastVisualEdit();
  };

  // Handle select parent button click
  const handleSelectParent = () => {
    selectParentElement();
  };

  // Show buttons if user has ever selected something (not just current selection)
  const showButtons = hasEverSelected;

  return (
    // Add top padding of 40px to account for the persistent Design Header
    // Use z-30 to sit above header background but below header text
    <div className="flex flex-col bg-[#1c1c1c] absolute inset-x-0 bottom-0 top-14 z-30 pt-[40px] animate-in fade-in zoom-in-95 duration-200">
      
      {showLoading ? (
         <div className="flex-1 flex flex-col items-center justify-center -mt-72">
            {saving ? (
              <VisualEditLoader 
                title="Saving edits..." 
                subtitle="Hang tight while we save your changes" 
              />
            ) : (
              <VisualEditLoader />
            )}
         </div>
      ) : isEditing ? (
             <div className="flex-1 flex flex-col relative select-none">
                 {/* New Ripple Indicator - Positioned absolutely at top, independent of content center */}
                 {/* Positioned at top-14px to sit closer to header text, with z-40 to float above opaque header background */}
                 <div className="absolute top-[14px] inset-x-0 flex justify-center z-40">
                 <div className="flex items-center gap-3 px-4 py-2 bg-[#27272a]/50 rounded-full backdrop-blur-sm">
                    <div className="relative w-4 h-4 flex items-center justify-center">
                        <div className="absolute w-full h-full rounded-full border-[1.5px] border-white opacity-0 animate-ripple ring-wait" />
                        <div className="absolute w-full h-full rounded-full border-[1.5px] border-white opacity-0 animate-ripple" />
                    </div>
                    <span className="text-sm text-gray-200 font-medium tracking-wide">AI is working...</span>
                 </div>
             </div>

             {/* Centered Content - Matches "Visual edits" empty state exact position (-mt-72) */}
             <div className="flex-1 flex flex-col items-center justify-center -mt-72">
                 <div className="mb-6 relative">
                     <VisualEditsIcon size={20} className="text-white" />
                 </div>
                 <h2 className="text-white text-xl font-medium mb-3">Agent is working</h2>
                 <p className="text-[#81888f] max-w-[280px] leading-relaxed text-center text-sm">
                     You can still select elements and queue visual edit requests using the floating panel in the preview
                 </p>
             </div>
             
             {/* Ensure ripple styles are available specifically for this view if not global */}
             <style>{`
              @keyframes ripple {
                0% { transform: scale(0); opacity: 1; border-width: 1.5px; }
                100% { transform: scale(1.5); opacity: 0; border-width: 0px; }
              }
              .animate-ripple { animation: ripple 2s cubic-bezier(0, 0.2, 0.8, 1) infinite; }
              .ring-wait { animation-delay: -1s; }
             `}</style>
         </div>
      ) : selection ? (
        selection.hasDynamicStyles ? (
            <div className="flex-1 flex flex-col items-center justify-center -mt-72 select-none">
                <DynamicStylingWarning />
            </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0 no-scrollbar pb-64">
             <div className="p-6 space-y-8">
                
                {/* Colors Section */}
                <div className="space-y-3">
                   <h3 className="text-white font-medium text-[15px]">Colors</h3>
                   <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
                      {hasText && (
                      <div className="space-y-1.5 relative">
                         <label className="text-[13px] text-gray-400">Text color</label>
                         <div
                           tabIndex={0}
                           ref={textInheritRef}
                           onClick={() => setActiveColorMenu(activeColorMenu === 'text' ? null : 'text')}
                           className={`flex items-center gap-2 p-2 bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors ${activeColorMenu === 'text' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                         >
                             <div
                               className="w-5 h-5 rounded-full border border-white/10 relative overflow-hidden flex-shrink-0"
                               style={{
                                 backgroundColor: currentStyles.textColor ? currentStyles._computedColor || '#ffffff' : 'transparent',
                                 backgroundImage: !currentStyles.textColor
                                   ? 'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)'
                                   : 'none',
                                 backgroundSize: '8px 8px',
                                 backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
                               }}
                             />
                             <span className="text-white text-[13px] truncate">{formatColorForDisplay(currentStyles.textColor)}</span>
                         </div>
                         <ColorPickerMenu
                            isOpen={activeColorMenu === 'text'}
                            onClose={() => setActiveColorMenu(null)}
                            triggerRef={textInheritRef}
                            currentColor={currentStyles._computedColor}
                            onSelect={(color) => {
                                handleStyleChange('textColor', color);
                                setActiveColorMenu(null);
                            }}
                         />
                      </div>
                      )}
                      <div className="space-y-1.5 relative">
                         <label className="text-[13px] text-gray-400">Background color</label>
                         <div
                           tabIndex={0}
                           ref={bgInheritRef}
                           onClick={() => setActiveColorMenu(activeColorMenu === 'bg' ? null : 'bg')}
                           className={`flex items-center gap-2 p-2 bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors ${activeColorMenu === 'bg' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                         >
                             <div
                               className="w-5 h-5 rounded-full border border-white/10 relative overflow-hidden flex-shrink-0"
                               style={{
                                 backgroundColor: (!currentStyles.bgColor || isTransparent(currentStyles._computedBgColor)) ? 'transparent' : currentStyles._computedBgColor,
                                 backgroundImage: (!currentStyles.bgColor || isTransparent(currentStyles._computedBgColor))
                                   ? 'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)'
                                   : 'none',
                                 backgroundSize: '8px 8px',
                                 backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
                               }}
                             />
                             <span className="text-white text-[13px] truncate">
                               {currentStyles.bgColor === 'transparent'
                                 ? 'Transparent'
                                 : formatColorForDisplay(currentStyles.bgColor)}
                             </span>
                         </div>
                         <ColorPickerMenu
                            isOpen={activeColorMenu === 'bg'}
                            onClose={() => setActiveColorMenu(null)}
                            triggerRef={bgInheritRef}
                            currentColor={currentStyles._computedBgColor}
                            onSelect={(color) => {
                                handleStyleChange('bgColor', color);
                                setActiveColorMenu(null);
                            }}
                         />
                      </div>
                   </div>

                </div>

                {/* Spacing Section */}
                <div className="space-y-3">
                   <h3 className="text-white font-medium text-[15px]">Spacing</h3>
                   <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
                      {/* Margin */}
                      <div className="space-y-1.5">
                         <div className="flex justify-between items-center mb-1.5">
                            <label className="text-[13px] text-gray-400">Margin</label>
                         </div>
                         <div className="space-y-2">
                             <div className="grid grid-cols-[1fr_1fr_32px] gap-3">
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing(expandMargin ? 'marginLeft' : 'marginX', expandMargin ? marginLeft : marginX, 1, expandMargin ? setMarginLeft : setMarginX)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        {expandMargin ? <MarginLeftIcon size={14} /> : <AlignHorizontalSpaceAround size={14} />}
                                     </button>
                                     <input
                                       type="text"
                                       value={expandMargin ? marginLeft : marginX}
                                       onChange={(e) => handleSpacingChange(expandMargin ? 'marginLeft' : 'marginX', e.target.value, expandMargin ? setMarginLeft : setMarginX)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, expandMargin ? setMarginLeft : setMarginX, expandMargin ? 'marginLeft' : 'marginX')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing(expandMargin ? 'marginTop' : 'marginY', expandMargin ? marginTop : marginY, 1, expandMargin ? setMarginTop : setMarginY)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        {expandMargin ? <MarginTopIcon size={14} /> : <AlignVerticalSpaceAround size={14} />}
                                     </button>
                                     <input
                                       type="text"
                                       value={expandMargin ? marginTop : marginY}
                                       onChange={(e) => handleSpacingChange(expandMargin ? 'marginTop' : 'marginY', e.target.value, expandMargin ? setMarginTop : setMarginY)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, expandMargin ? setMarginTop : setMarginY, expandMargin ? 'marginTop' : 'marginY')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <button
                                    onClick={toggleExpandMargin}
                                    className={`w-8 h-8 flex items-center justify-center transition-colors rounded-md ${expandMargin ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'}`}
                                 >
                                    <Maximize2 size={14} />
                                 </button>
                             </div>

                             {/* Expanded Margin Inputs */}
                             <div className={`overflow-hidden transition-all duration-300 ease-out grid grid-cols-[1fr_1fr_32px] gap-3 ${expandMargin ? 'max-h-[40px] opacity-100' : 'max-h-0 opacity-0'}`}>
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing('marginRight', marginRight, 1, setMarginRight)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        <MarginRightIcon size={14} />
                                     </button>
                                     <input
                                       type="text"
                                       value={marginRight}
                                       onChange={(e) => handleSpacingChange('marginRight', e.target.value, setMarginRight)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, setMarginRight, 'marginRight')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing('marginBottom', marginBottom, 1, setMarginBottom)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        <MarginBottomIcon size={14} />
                                     </button>
                                     <input
                                       type="text"
                                       value={marginBottom}
                                       onChange={(e) => handleSpacingChange('marginBottom', e.target.value, setMarginBottom)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, setMarginBottom, 'marginBottom')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <div /> {/* Spacer to align with button above */}
                             </div>
                         </div>
                      </div>

                      {/* Padding */}
                      <div className="space-y-1.5">
                         <div className="flex justify-between items-center mb-1.5">
                            <label className="text-[13px] text-gray-400">Padding</label>
                         </div>
                         <div className="space-y-2">
                             <div className="grid grid-cols-[1fr_1fr_32px] gap-3">
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing(expandPadding ? 'paddingLeft' : 'paddingX', expandPadding ? paddingLeft : paddingX, 1, expandPadding ? setPaddingLeft : setPaddingX)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        {expandPadding ? <PaddingLeftIcon size={14} /> : <PaddingHorizontalIcon size={14} />}
                                     </button>
                                     <input
                                       type="text"
                                       value={expandPadding ? paddingLeft : paddingX}
                                       onChange={(e) => handleSpacingChange(expandPadding ? 'paddingLeft' : 'paddingX', e.target.value, expandPadding ? setPaddingLeft : setPaddingX)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, expandPadding ? setPaddingLeft : setPaddingX, expandPadding ? 'paddingLeft' : 'paddingX')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing(expandPadding ? 'paddingTop' : 'paddingY', expandPadding ? paddingTop : paddingY, 1, expandPadding ? setPaddingTop : setPaddingY)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        {expandPadding ? <PaddingTopIcon size={14} /> : <PaddingVerticalIcon size={14} />}
                                     </button>
                                     <input
                                       type="text"
                                       value={expandPadding ? paddingTop : paddingY}
                                       onChange={(e) => handleSpacingChange(expandPadding ? 'paddingTop' : 'paddingY', e.target.value, expandPadding ? setPaddingTop : setPaddingY)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, expandPadding ? setPaddingTop : setPaddingY, expandPadding ? 'paddingTop' : 'paddingY')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <button
                                    onClick={toggleExpandPadding}
                                    className={`w-8 h-8 flex items-center justify-center transition-colors rounded-md ${expandPadding ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'}`}
                                 >
                                    <Maximize2 size={14} />
                                 </button>
                             </div>

                             {/* Expanded Padding Inputs */}
                             <div className={`overflow-hidden transition-all duration-300 ease-out grid grid-cols-[1fr_1fr_32px] gap-3 ${expandPadding ? 'max-h-[40px] opacity-100' : 'max-h-0 opacity-0'}`}>
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing('paddingRight', paddingRight, 1, setPaddingRight)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        <PaddingRightIcon size={14} />
                                     </button>
                                     <input
                                       type="text"
                                       value={paddingRight}
                                       onChange={(e) => handleSpacingChange('paddingRight', e.target.value, setPaddingRight)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, setPaddingRight, 'paddingRight')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <div className="flex items-center bg-[#27272a] rounded-lg border border-transparent overflow-hidden group focus-within:border-white/20 transition-colors">
                                     <button 
                                        onClick={() => stepSpacing('paddingBottom', paddingBottom, 1, setPaddingBottom)}
                                        className="pl-1.5 pr-0.5 text-gray-500 hover:text-white h-8 flex items-center justify-center transition-colors outline-none cursor-pointer"
                                     >
                                        <PaddingBottomIcon size={14} />
                                     </button>
                                     <input
                                       type="text"
                                       value={paddingBottom}
                                       onChange={(e) => handleSpacingChange('paddingBottom', e.target.value, setPaddingBottom)}
                                       onBlur={(e) => handleSpacingBlur(e.target.value, setPaddingBottom, 'paddingBottom')}
                                       className="w-full bg-transparent text-white text-[13px] px-1 h-8 outline-none text-center cursor-ns-resize"
                                     />
                                 </div>
                                 <div /> {/* Spacer */}
                             </div>
                         </div>
                      </div>
                   </div>
                </div>

                {/* Typography Section - only shown for elements with text */}
                {hasText && (
                <div className="space-y-3">
                   <h3 className="text-white font-medium text-[15px]">Typography</h3>
                   <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
                       <div className="space-y-1.5 min-w-[140px] flex-1">
                           <label className="text-[13px] text-gray-400">Font size</label>
                           <div
                                tabIndex={0}
                                ref={fontSizeRef}
                                onClick={() => setActiveTypographyMenu(activeTypographyMenu === 'fontSize' ? null : 'fontSize')}
                                className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeTypographyMenu === 'fontSize' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                           >
                               <span className="text-gray-300 text-[13px]">{currentStyles.fontSize || 'Select size'}</span>
                               <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                           </div>
                           <VisualEditorSelectMenu
                                isOpen={activeTypographyMenu === 'fontSize'}
                                onClose={() => setActiveTypographyMenu(null)}
                                triggerRef={fontSizeRef}
                                options={FONT_SIZE_OPTIONS}
                                selected={currentStyles.fontSize}
                                onSelect={(val) => {
                                    handleStyleChange('fontSize', val);
                                    setActiveTypographyMenu(null);
                                }}
                                label="Select font size"
                                width={160}
                           />
                       </div>
                       <div className="space-y-1.5 min-w-[140px] flex-1">
                           <label className="text-[13px] text-gray-400">Font weight</label>
                           <div
                                tabIndex={0}
                                ref={fontWeightRef}
                                onClick={() => setActiveTypographyMenu(activeTypographyMenu === 'fontWeight' ? null : 'fontWeight')}
                                className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeTypographyMenu === 'fontWeight' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                           >
                               <span className="text-gray-300 text-[13px]">{currentStyles.fontWeight || 'Select weight'}</span>
                               <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                           </div>
                           <VisualEditorSelectMenu
                                isOpen={activeTypographyMenu === 'fontWeight'}
                                onClose={() => setActiveTypographyMenu(null)}
                                triggerRef={fontWeightRef}
                                options={FONT_WEIGHT_OPTIONS}
                                selected={currentStyles.fontWeight}
                                onSelect={(val) => {
                                    handleStyleChange('fontWeight', val);
                                    setActiveTypographyMenu(null);
                                }}
                                label="Select font weight"
                                width={160}
                           />
                       </div>
                       <div className="space-y-1.5 min-w-[140px] flex-1">
                           <label className="text-[13px] text-gray-400">Text align</label>
                           <div
                                tabIndex={0}
                                ref={textAlignRef}
                                onClick={() => setActiveTypographyMenu(activeTypographyMenu === 'textAlign' ? null : 'textAlign')}
                                className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeTypographyMenu === 'textAlign' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                           >
                               <span className="text-gray-300 text-[13px]">{currentStyles.textAlign || 'Select align'}</span>
                               <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                           </div>
                           <VisualEditorSelectMenu
                                isOpen={activeTypographyMenu === 'textAlign'}
                                onClose={() => setActiveTypographyMenu(null)}
                                triggerRef={textAlignRef}
                                options={TEXT_ALIGN_OPTIONS}
                                selected={currentStyles.textAlign}
                                onSelect={(val) => {
                                    handleStyleChange('textAlign', val);
                                    setActiveTypographyMenu(null);
                                }}
                                label="Select alignment"
                                width={160}
                           />
                       </div>
                   </div>
                </div>
                )}

                {/* Border Section - hidden for void elements */}
                {canHaveBorder && (
                <div className="space-y-3">
                   <h3 className="text-white font-medium text-[15px]">Border</h3>
                   <div className="space-y-3">
                       <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
                           <div className="space-y-1.5 min-w-[140px] flex-1">
                               <label className="text-[13px] text-gray-400">Border width</label>
                               <div
                                 tabIndex={0}
                                 ref={borderWidthRef}
                                 onClick={() => setActiveBorderMenu(activeBorderMenu === 'borderWidth' ? null : 'borderWidth')}
                                 className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeBorderMenu === 'borderWidth' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                               >
                                   <span className="text-gray-300 text-[13px] whitespace-nowrap">{currentStyles.borderWidth || 'Select width'}</span>
                                   <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                               </div>
                               <VisualEditorSelectMenu
                                    isOpen={activeBorderMenu === 'borderWidth'}
                                    onClose={() => setActiveBorderMenu(null)}
                                    triggerRef={borderWidthRef}
                                    options={BORDER_WIDTH_OPTIONS}
                                    selected={currentStyles.borderWidth}
                                    onSelect={(val) => {
                                        handleStyleChange('borderWidth', val);
                                        setActiveBorderMenu(null);
                                    }}
                                    label="Select border width"
                                    width={160}
                               />
                           </div>
                           <div className="space-y-1.5 min-w-[140px] flex-1">
                               <label className="text-[13px] text-gray-400">Border color</label>
                               <div
                                 tabIndex={0}
                                 ref={borderColorRef}
                                 onClick={() => setActiveColorMenu(activeColorMenu === 'border' ? null : 'border')}
                                 className={`flex items-center gap-2 p-2 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors ${activeColorMenu === 'border' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                               >
                                   <div
                                     className="w-5 h-5 rounded-full border border-white/10 relative overflow-hidden flex-shrink-0"
                                     style={{
                                       backgroundColor: currentStyles.borderColor ? (tailwindColorToCss(currentStyles.borderColor) || 'transparent') : 'transparent',
                                       backgroundImage: !currentStyles.borderColor
                                         ? 'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)'
                                         : 'none',
                                       backgroundSize: '8px 8px',
                                       backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
                                     }}
                                   />
                                   <span className="text-white text-[13px] truncate">{formatColorForDisplay(currentStyles.borderColor)}</span>
                               </div>
                               <ColorPickerMenu
                                  isOpen={activeColorMenu === 'border'}
                                  onClose={() => setActiveColorMenu(null)}
                                  triggerRef={borderColorRef}
                                  currentColor={undefined}
                                  onSelect={(color) => {
                                      handleStyleChange('borderColor', color);
                                      setActiveColorMenu(null);
                                  }}
                               />
                           </div>
                       </div>

                       <div className="flex flex-wrap gap-4">
                           <div className="space-y-1.5 w-full">
                               <label className="text-[13px] text-gray-400">Border style</label>
                               <div
                                 tabIndex={0}
                                 ref={borderStyleRef}
                                 onClick={() => setActiveBorderMenu(activeBorderMenu === 'borderStyle' ? null : 'borderStyle')}
                                 className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeBorderMenu === 'borderStyle' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                               >
                                   <span className="text-gray-300 text-[13px] whitespace-nowrap">{currentStyles.borderStyle || 'Select style'}</span>
                                   <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                               </div>
                               <VisualEditorSelectMenu
                                    isOpen={activeBorderMenu === 'borderStyle'}
                                    onClose={() => setActiveBorderMenu(null)}
                                    triggerRef={borderStyleRef}
                                    options={BORDER_STYLE_OPTIONS}
                                    selected={currentStyles.borderStyle}
                                    onSelect={(val) => {
                                        handleStyleChange('borderStyle', val);
                                        setActiveBorderMenu(null);
                                    }}
                                    label="Select border style"
                                    width={160}
                               />
                           </div>
                       </div>
                   </div>
                </div>
                )}

                   {/* Effects Section - hidden for void elements */}
                {canHaveEffects && (
                <div className="space-y-3">
                   <h3 className="text-white font-medium text-[15px]">Effects</h3>
                   <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
                       <div className="space-y-1.5 min-w-[140px] flex-1">
                           <div className="flex items-center gap-1">
                               <label className="text-[13px] text-gray-400">Border radius</label>
                           </div>
                           <div
                                tabIndex={0}
                                ref={borderRadiusRef}
                                onClick={() => setActiveEffectMenu(activeEffectMenu === 'radius' ? null : 'radius')}
                                className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeEffectMenu === 'radius' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                           >
                               <span className="text-gray-300 text-[13px]">{currentStyles.borderRadius || 'Select radius'}</span>
                               <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                           </div>
                           <VisualEditorSelectMenu
                                isOpen={activeEffectMenu === 'radius'}
                                onClose={() => setActiveEffectMenu(null)}
                                triggerRef={borderRadiusRef}
                                options={BORDER_RADIUS_OPTIONS}
                                selected={currentStyles.borderRadius}
                                onSelect={(val) => {
                                    handleStyleChange('borderRadius', val);
                                    setActiveEffectMenu(null);
                                }}
                                label="Select border radius"
                                width={160}
                           />
                       </div>
                       <div className="space-y-1.5 min-w-[140px] flex-1">
                           <label className="text-[13px] text-gray-400">Shadow</label>
                           <div
                                tabIndex={0}
                                ref={shadowRef}
                                onClick={() => setActiveEffectMenu(activeEffectMenu === 'shadow' ? null : 'shadow')}
                                className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeEffectMenu === 'shadow' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                           >
                               <span className="text-gray-300 text-[13px]">{currentStyles.shadow || 'Select shadow'}</span>
                               <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                           </div>
                           <VisualEditorSelectMenu
                                isOpen={activeEffectMenu === 'shadow'}
                                onClose={() => setActiveEffectMenu(null)}
                                triggerRef={shadowRef}
                                options={SHADOW_OPTIONS}
                                selected={currentStyles.shadow}
                                onSelect={(val) => {
                                    handleStyleChange('shadow', val);
                                    setActiveEffectMenu(null);
                                }}
                                label="Select shadow"
                                width={160}
                           />
                       </div>
                       <div className="space-y-1.5 min-w-[140px] flex-1">
                           <label className="text-[13px] text-gray-400">Opacity</label>
                           <div
                                tabIndex={0}
                                ref={opacityRef}
                                onClick={() => setActiveEffectMenu(activeEffectMenu === 'opacity' ? null : 'opacity')}
                                className={`flex items-center justify-between px-3 h-[38px] bg-[#27272a] rounded-lg border cursor-pointer outline-none transition-colors group ${activeEffectMenu === 'opacity' ? 'border-blue-500/50' : 'border-transparent focus:border-white/20'}`}
                           >
                               <span className="text-gray-300 text-[13px] whitespace-nowrap">{currentStyles.opacity || 'Select opacity'}</span>
                               <ChevronDown size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                           </div>
                            <VisualEditorSelectMenu
                                isOpen={activeEffectMenu === 'opacity'}
                                onClose={() => setActiveEffectMenu(null)}
                                triggerRef={opacityRef}
                                options={OPACITY_OPTIONS}
                                selected={currentStyles.opacity}
                                onSelect={(val) => {
                                    handleStyleChange('opacity', val);
                                    setActiveEffectMenu(null);
                                }}
                                label="Select opacity"
                                width={160}
                           />
                       </div>
                   </div>
                </div>
                )}


             </div>
          </div>
        )
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center -mt-72 select-none">
           <div className="mb-6 relative">
              <VisualEditsIcon size={20} className="text-white" />
           </div>
           <h2 className="text-xl font-semibold text-white mb-2">Visual edits</h2>
           <p className="text-[#81888f] mb-8">Select an element to edit it</p>
           
           <p className="text-[#52525b] text-sm">
             Hold <span className="bg-[#27272a] px-1.5 py-0.5 rounded text-gray-400 font-mono border border-white/5 mx-1">Ctrl</span> to select multiple elements
           </p>
         </div>
       )}

       {/* Footer - shown when element is selected */}
       {selection && (
         <div className="absolute bottom-0 left-0 right-0 bg-[#1c1c1c] border-t border-white/5 p-4 space-y-3">
            <button onClick={onBack} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
               <CornerUpLeft size={14} />
               Back to Chat
            </button>
            
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 bg-[#27272a] rounded-xl px-3 h-[36px] py-0 border border-white/5">
                  <Palette size={14} className="text-gray-400" />
                  <span className="text-white text-sm font-medium">Design</span>
                  <div className="flex items-center justify-center gap-1.5 px-2 h-[21px] bg-[#1e40af] text-white rounded-full text-[11px] font-medium font-mono leading-none select-none flex-shrink-0">
                     <Scan size={12} className="stroke-dashed opacity-90 text-white" />
                     <span className="translate-y-[0.5px]">{selection.tagName.toLowerCase()}</span>
                  </div>
               </div>
            </div>

            <div className="w-full bg-[#27272a] rounded-xl border border-white/5 p-3">
               <input 
                  type="text" 
                  placeholder="Ask Lovable to modify the selected element..." 
                  className="w-full bg-transparent text-gray-300 placeholder-gray-500 text-sm outline-none"
               />
            </div>
         </div>
       )}
    </div>
  );
};

const Sidebar: React.FC<SidebarProps> = ({ width, isCollapsed, onToggle, prompt, initialAttachments, activeTab, onTabChange, isChatMode, onHomeClick, modelConfig, setModelConfig, selectedModelId, setSelectedModelId, isResizing, projectName, isGeneratingName, onSettingsClick, agentSwarmEnabled, onSwarmToggle }) => {
  const navigate = useNavigate();
  const location = useLocation();
  console.log('🔵🔵🔵 [Sidebar] COMPONENT RENDERING 🔵🔵🔵');
  const isCompact = width < 405;
  const [sidebarView, setSidebarViewRaw] = useState<'chat' | 'visual-edit'>('chat');
  const hasUnsaved = useStore(hasUnsavedChanges);
  const [showExitModal, setShowExitModal] = useState(false);
  // Agent Builder: saved-workflow list + backend status for the Library card
  const abWorkflows = useStore(agentWorkflowList);
  const abStatus = useStore(abBackendStatus);
  const [showAgentLibrary, setShowAgentLibrary] = useState(false);

  const [pendingExitAction, setPendingExitAction] = useState<(() => void) | null>(null);

  // Guarded setSidebarView: prevent any view switch while the exit modal is open
  const showExitModalRef = useRef(showExitModal);
  useEffect(() => { showExitModalRef.current = showExitModal; }, [showExitModal]);
  const setSidebarView = useCallback((view: 'chat' | 'visual-edit') => {
    if (showExitModalRef.current) return; // Block state changes while modal is open
    setSidebarViewRaw(view);
  }, []);

  const handleExitVisualEdit = (action?: () => void) => {
    if (hasUnsaved) {
      if (action) setPendingExitAction(() => action);
      setShowExitModal(true);
    } else {
      setSidebarViewRaw('chat');
      exitVisualEdit();
      action?.();
    }
  };


  const [promptValue, setPromptValue] = useState('');

  // Visual edit queue subscription
  const editQueue = useStore(visualEditQueue);

  // Deferred activeTab state - updates one frame after activeTab changes
  // This staggers the suggestions grid animation to avoid layout thrashing
  const [deferredActiveTab, setDeferredActiveTab] = useState(activeTab);
  useEffect(() => {
    if (activeTab !== deferredActiveTab) {
      requestAnimationFrame(() => {
        setDeferredActiveTab(activeTab);
      });
    }
  }, [activeTab, deferredActiveTab]);

  // Automatically exit visual edit view when navigating away from design tab
  // Use requestAnimationFrame to defer state change and avoid interrupting CSS animations
  // Automatically exit visual edit view when navigating away from design tab
  // Use requestAnimationFrame to defer state change and avoid interrupting CSS animations
  useEffect(() => {
    if (activeTab !== 'design' && sidebarView === 'visual-edit') {
      if (hasUnsaved) {
        // Intercept tab switch if there are unsaved changes
        const targetTab = activeTab; // Capture the intended destination
        setPendingExitAction(() => () => onTabChange(targetTab));
        // IMMEDIATELY revert to design tab to preserve the view
        onTabChange('design');
        setShowExitModal(true);
      } else {
        requestAnimationFrame(() => {
          setSidebarViewRaw('chat');
          exitVisualEdit();
        });
      }
    }
  }, [activeTab, sidebarView, hasUnsaved, onTabChange]);

  // Robust Visual Edit Exit: Ensure we exit mode whenever sidebar view changes OR on unmount
  useEffect(() => {
    // Skip if the exit modal is open - we don't want to exit while confirming
    if (showExitModal) return;
    // If we are NOT in visual edit view, force exit mode
    // This catches cases like switching tools, clicking "Design" text, etc.
    if (sidebarView !== 'visual-edit') {
       if (isVisualEditMode.get()) {
         exitVisualEdit();
       }
    }
  }, [sidebarView, showExitModal]);

  // Cleanup on unmount to ensure mode doesn't persist if component destroyed
  useEffect(() => {
    return () => {
       if (isVisualEditMode.get()) {
         exitVisualEdit();
       }
    };
  }, []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const streamingContentRef = useRef<HTMLDivElement>(null);
  const [responseAreaMinHeight, setResponseAreaMinHeight] = useState<number | undefined>(undefined);
  const [needsScrollPadding, setNeedsScrollPadding] = useState(false);
  const [showLeftGradient, setShowLeftGradient] = useState(false);
  const [messageReactions, setMessageReactions] = useState<{ [key: string]: 'like' | 'dislike' | null }>({});
  const [fileListExpanded, setFileListExpanded] = useState(false); // Lifted state for file list expansion
  
  // Test mode state
  const isTestMode = useStore(testStore.isTestMode);
  const testStatus = useStore(testStore.status);
  const $hoveredElement = useStore(hoveredElement);
  const $selectedElement = useStore(selectedElement);
  const selectedEls = useStore(selectedElements);
  
  // Selected tool state (independent from tabs)
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [globalErrors, setGlobalErrors] = useState<{id: string; message: string; isClosing: boolean; action?: 'set-api-key'}[]>([]);

  const addGlobalError = useCallback((message: string, action?: 'set-api-key') => {
    setGlobalErrors(prev => [...prev, { id: Date.now().toString(), message, isClosing: false, action }]);
  }, []);

  const dismissGlobalError = useCallback((id: string) => {
    setGlobalErrors(prev => prev.map(e => e.id === id ? { ...e, isClosing: true } : e));
    setTimeout(() => {
      setGlobalErrors(prev => prev.filter(e => e.id !== id));
    }, 250);
  }, []);
  
  // Debug: Log test mode changes
  useEffect(() => {
    console.log('[Sidebar] isTestMode changed to:', isTestMode);
  }, [isTestMode]);

  // Listen for build/runtime errors from the preview iframe and show as popup
  const lastPreviewErrorRef = useRef<string>('');
  useEffect(() => {
    const handlePreviewError = (event: MessageEvent) => {
      if (event.data?.type === 'PREVIEW_ERROR' && event.data.message) {
        if (event.data.message === lastPreviewErrorRef.current) return;
        lastPreviewErrorRef.current = event.data.message;
        addGlobalError(`${event.data.errorType || 'Build Error'}: ${event.data.message}`);
        setTimeout(() => { lastPreviewErrorRef.current = ''; }, 3000);
      }
    };
    window.addEventListener('message', handlePreviewError);
    return () => window.removeEventListener('message', handlePreviewError);
  }, [addGlobalError]);
  
  // Attachments State
  interface Attachment {
    id: string;
    type: 'image' | 'file';
    url?: string;
    name: string;
    extension?: string;
    file?: File;
  }

  // Visual Editor State
  const selection = useStore(selectedElement);
  const hasUndo = useStore(canUndo);
  const atRoot = useStore(isAtRootLevel);

  // Enable select parent when there's a selection and we're not at root
  const canSelectParent = !!selection && !atRoot;

  // Design canvas screen selection (for screen attachments in prompt)
  const selectedDesignIds = useStore(selectedDesignNodeIds);
  const allDesignNodes = useStore(designNodesStore);
  const selectedScreens = allDesignNodes.filter(n => selectedDesignIds.includes(n.id));

  // Track displayed screen attachments with animated removal for ALL deselect paths
  const [displayedScreenIds, setDisplayedScreenIds] = useState<string[]>([]);
  const [fadingOutScreenIds, setFadingOutScreenIds] = useState<Set<string>>(new Set());
  const fadingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const displayedScreenIdsRef = useRef<string[]>([]);
  displayedScreenIdsRef.current = displayedScreenIds;

  useEffect(() => {
    const currentIds = activeTab === 'canvas-screens' ? selectedDesignIds : [];
    const prevIds = displayedScreenIdsRef.current;
    const added = currentIds.filter(id => !prevIds.includes(id));
    const removed = prevIds.filter(id => !currentIds.includes(id));

    if (removed.length > 0) {
      // Start fade-out for removed items
      setFadingOutScreenIds(prev => {
        const next = new Set(prev);
        removed.forEach(id => next.add(id));
        return next;
      });
      // After animation, remove them from displayed list
      removed.forEach(id => {
        const existing = fadingTimersRef.current.get(id);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
          setDisplayedScreenIds(prev => prev.filter(x => x !== id));
          setFadingOutScreenIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          fadingTimersRef.current.delete(id);
        }, 200);
        fadingTimersRef.current.set(id, timer);
      });
    }

    if (added.length > 0) {
      // Cancel any pending fade-out for items being re-added
      added.forEach(id => {
        const existing = fadingTimersRef.current.get(id);
        if (existing) {
          clearTimeout(existing);
          fadingTimersRef.current.delete(id);
        }
      });
      setFadingOutScreenIds(prev => {
        const next = new Set(prev);
        added.forEach(id => next.delete(id));
        return next;
      });
      setDisplayedScreenIds(prev => [...prev.filter(id => !added.includes(id)), ...added]);
    }
  }, [selectedDesignIds, activeTab]);

  // The screens to render = currently displayed (includes fading-out ones)
  const displayedScreens = allDesignNodes.filter(n => displayedScreenIds.includes(n.id));

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newAttachments: Attachment[] = Array.from(e.target.files).map(file => {
        const isImage = file.type.startsWith('image/');
        return {
          id: Math.random().toString(36).substring(7),
          type: isImage ? 'image' : 'file',
          url: isImage ? URL.createObjectURL(file) : undefined,
          name: file.name,
          extension: file.name.split('.').pop() || 'FILE',
          file
        };
      });
      setAttachments(prev => [...prev, ...newAttachments]);
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    // Mark as removing first (triggers fade-out animation)
    setRemovingIds(prev => new Set(prev).add(id));
    
    // Remove from DOM after animation completes
    setTimeout(() => {
      setAttachments(prev => prev.filter(att => att.id !== id));
      setRemovingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }, 200); // Match animation duration
  };

  // Check if any attachments are visible — includes screen selections
  // hasVisibleScreens stays true while items are fading out so the grid container doesn't collapse mid-animation
  // Only true when at least one screen is NOT fading out — mirrors file attachment logic
  // so the last screen removal lets the grid collapse directly instead of squeeze-then-collapse
  const hasVisibleScreens = activeTab === 'canvas-screens' && displayedScreenIds.some(id => !fadingOutScreenIds.has(id));
  const hasVisibleAttachments = (attachments.length > 0 && !attachments.every(att => removingIds.has(att.id))) || hasVisibleScreens;
  const [showRightGradient, setShowRightGradient] = useState(true);

  const activeSnapshotId = useStore(workbenchStore.activeSnapshotId);
  const previewSnapshot = useStore(workbenchStore.previewSnapshot);

  // Chat/Messaging State
  interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    thinkingTime?: number;
    isGenerating?: boolean;
    isThinking?: boolean;
    hasCodeChanges?: boolean;
    filesSnapshot?: Record<string, string>; // State of codebase immediately after this message

    timestamp: number;
    attachments?: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[];
    designNodeId?: string; // Links to a design node on the canvas
  }
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStreamingResponse, setCurrentStreamingResponse] = useState('');

  // Design mode (canvas-screens) — separate chat state
  const [designMessages, setDesignMessages] = useState<ChatMessage[]>([]);
  const [designStreamingResponse, setDesignStreamingResponse] = useState('');

  // Session IDs for local file system auto-saving
  const [codeChatSessionId] = useState(() => {
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    return `${dateStr}_${Math.random().toString(36).slice(2, 8)}`;
  });
  const [designChatSessionId] = useState(() => {
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    return `${dateStr}_${Math.random().toString(36).slice(2, 8)}`;
  });

  // Project-specific Multi-Session Chat History
  interface ChatSession {
    id: string;                 // Unique UUID for the session
    name: string;               // Summarized session name (defaults to 'New Chat')
    messages: ChatMessage[];    // Chat messages list
    filesSnapshot: any; // Files snapshot state for this session
    activeSnapshotId: string | null;       // Active snapshot ID
    createdAt: number;          // Creation timestamp
    updatedAt: number;          // Last updated timestamp
  }

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [namingSessionIds, setNamingSessionIds] = useState<Set<string>>(new Set());
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [shouldRenderHistory, setShouldRenderHistory] = useState(false);
  const [isClosingHistory, setIsClosingHistory] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const [codeChatTitle, setCodeChatTitle] = useState<string | null>(null);
  const [designChatTitle, setDesignChatTitle] = useState<string | null>(null);

  const { isLocalFolderConnected, saveLocalFSProjectChat, generateChatTitle } = useLocalFS();

  // Generate chat title using Gemini 3.1 Flash Lite once we have user and assistant responses (Code Chat)
  useEffect(() => {
    if (isLocalFolderConnected && messages.length >= 2 && !codeChatTitle) {
      const userMsg = messages[0].content;
      const assistantMsg = messages[1].content;
      
      const fetchTitle = async () => {
        try {
          const title = await generateChatTitle(userMsg, assistantMsg);
          if (title) {
            let uniqueTitle = title;
            let counter = 1;
            while (sessions.some(s => s.name.toLowerCase() === uniqueTitle.toLowerCase())) {
              uniqueTitle = `${title} (${counter})`;
              counter++;
            }
            setCodeChatTitle(uniqueTitle);
          }
        } catch {}
      };
      void fetchTitle();
    }
  }, [messages, codeChatTitle, isLocalFolderConnected, generateChatTitle, sessions]);

  // Auto-save code chat sessions
  useEffect(() => {
    if (isLocalFolderConnected && messages.length > 0 && projectName) {
      const activeId = codeChatTitle || codeChatSessionId;
      void saveLocalFSProjectChat(projectName, activeId, messages, codeChatTitle ? codeChatSessionId : null);
    }
  }, [messages, codeChatTitle, codeChatSessionId, isLocalFolderConnected, projectName, saveLocalFSProjectChat]);

  // Generate chat title using Gemini 3.1 Flash Lite once we have user and assistant responses (Design Chat)
  useEffect(() => {
    if (isLocalFolderConnected && designMessages.length >= 2 && !designChatTitle) {
      const userMsg = designMessages[0].content;
      const assistantMsg = designMessages[1].content;
      
      const fetchTitle = async () => {
        try {
          const title = await generateChatTitle(userMsg, assistantMsg);
          if (title) {
            let uniqueTitle = title;
            let counter = 1;
            while (sessions.some(s => s.name.toLowerCase() === uniqueTitle.toLowerCase())) {
              uniqueTitle = `${title} (${counter})`;
              counter++;
            }
            setDesignChatTitle(uniqueTitle);
          }
        } catch {}
      };
      void fetchTitle();
    }
  }, [designMessages, designChatTitle, isLocalFolderConnected, generateChatTitle, sessions]);

  // Auto-save design chat sessions
  useEffect(() => {
    if (isLocalFolderConnected && designMessages.length > 0 && projectName) {
      const activeId = designChatTitle || designChatSessionId;
      void saveLocalFSProjectChat(projectName, activeId, designMessages, designChatTitle ? designChatSessionId : null);
    }
  }, [designMessages, designChatTitle, designChatSessionId, isLocalFolderConnected, projectName, saveLocalFSProjectChat]);

  const [currentThinkingTime, setCurrentThinkingTime] = useState(0);
  const thinkingTimeRef = useRef(0); // Ref to capture accurate final thinking time
  const thinkingStartTimeRef = useRef<number | null>(null); // Timestamp when thinking started
  const [isCurrentlyGenerating, setIsCurrentlyGenerating] = useState(!!prompt);
  const [isCurrentlyThinking, setIsCurrentlyThinking] = useState(!!prompt);
  const isCurrentlyThinkingRef = useRef(false); // Ref to avoid stale closure in streaming callback
  const { apiKeys, loading: userDataLoading } = useUserDataContext();
  const thinkingTimerRef = useRef<NodeJS.Timeout | null>(null);



  // Prompt Suggestions State
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false); // Start hidden
  const suggestionsGeneratedRef = useRef(false);
  const prevGeneratingRef = useRef(false);
  const initialLoadCompleteRef = useRef(false); // Track if first generation from dashboard is done

  // Helper to extract a clean serializable snapshot of the sandpack files
  const getFilesSnapshot = useCallback(() => {
    const snapshot: Record<string, string> = {};
    const filesMap = workbenchStore.files.get();
    Object.entries(filesMap).forEach(([path, file]: [string, any]) => {
      snapshot[path] = file.content;
    });
    return snapshot;
  }, []);

  // Helper to format human-readable relative dates
  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 60000) return 'Just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(diff / 86400000);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  // Manage delayed unmount for fade-out transitions
  useEffect(() => {
    if (isHistoryOpen) {
      setShouldRenderHistory(true);
      setIsClosingHistory(false);
    } else if (shouldRenderHistory) {
      setIsClosingHistory(true);
      const timer = setTimeout(() => {
        setShouldRenderHistory(false);
        setIsClosingHistory(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isHistoryOpen, shouldRenderHistory]);

  // Recalculate popover screen position dynamically
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPopoverPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
      });
    }
  }, []);

  useEffect(() => {
    if (!shouldRenderHistory) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [shouldRenderHistory, updatePosition]);

  // Close history popover when clicking outside (Portal compatible)
  useEffect(() => {
    if (!isHistoryOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const popover = document.getElementById('history-popover-portal');
      const isInsideTrigger = triggerRef.current?.contains(e.target as Node);
      const isInsidePopover = popover?.contains(e.target as Node);
      if (!isInsideTrigger && !isInsidePopover) {
        setIsHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isHistoryOpen]);

  // Load sessions from localStorage whenever projectName changes
  useEffect(() => {
    // If a prompt is present in the URL and we are on initial mount (projectName is empty),
    // we are starting a brand new project. We must skip loading any saved sessions (like willow_chat_sessions_default)
    // so that we start with a clean slate (empty messages, reset stores, etc.).
    if (prompt && !projectName) {
      setSessions([]);
      const initialId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setCurrentSessionId(initialId);
      return;
    }

    let cancelled = false;
    const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';

    (async () => {
      // loadCodeSessions migrates any legacy localStorage value into IndexedDB on first read.
      const parsed = (await loadCodeSessions(storageKey)) as ChatSession[] | null;
      if (cancelled) return;

      if (parsed && parsed.length > 0) {
        setSessions(parsed);
        const sorted = [...parsed].sort((a, b) => b.updatedAt - a.updatedAt);
        setCurrentSessionId(sorted[0].id);
        setMessages(sorted[0].messages);
        if (sorted[0].filesSnapshot && Object.keys(sorted[0].filesSnapshot).length > 0) {
          workbenchStore.restoreFromSnapshot(sorted[0].activeSnapshotId || '', sorted[0].filesSnapshot);
        }
        return;
      }

      // No sessions found, create an initial one only if we already have messages
      const initialId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (messages && messages.length > 0) {
        const currentFiles = getFilesSnapshot();
        const initialSession: ChatSession = {
          id: initialId,
          name: 'Initial Chat',
          messages: messages,
          filesSnapshot: Object.keys(currentFiles).length > 0 ? currentFiles : {},
          activeSnapshotId: activeSnapshotId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setSessions([initialSession]);
      } else {
        setSessions([]);
      }
      setCurrentSessionId(initialId);
    })();

    return () => { cancelled = true; };
  }, [projectName, prompt]);

  // Auto-save current session state when messages or activeSnapshotId change
  useEffect(() => {
    if (!currentSessionId) return;

    const currentFiles = getFilesSnapshot();

    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === currentSessionId);
      if (idx === -1) return prev;

      const session = prev[idx];
      const hasMessagesChanged = JSON.stringify(session.messages) !== JSON.stringify(messages);
      const hasActiveSnapshotChanged = session.activeSnapshotId !== activeSnapshotId;
      
      if (!hasMessagesChanged && !hasActiveSnapshotChanged) {
        return prev;
      }

      const updatedSession = {
        ...session,
        messages,
        filesSnapshot: Object.keys(currentFiles).length > 0 ? currentFiles : session.filesSnapshot,
        activeSnapshotId: activeSnapshotId,
        updatedAt: Date.now(),
      };

      const next = [...prev];
      next[idx] = updatedSession;

      const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';
      void saveCodeSessions(storageKey, next);

      return next;
    });
  }, [messages, activeSnapshotId, currentSessionId, projectName, getFilesSnapshot]);

  // Automated Session Naming with Gemini Flash
  useEffect(() => {
    if (!currentSessionId || !apiKeys.gemini?.[0]) return;

    const currentSession = sessions.find(s => s.id === currentSessionId);
    if (!currentSession) return;

    const hasDefaultName = currentSession.name === 'New Chat' || currentSession.name === 'Initial Chat';
    if (hasDefaultName && messages.length >= 1) {
      const userMessage = messages.find(m => m.role === 'user');
      if (!userMessage) return;

      const userPrompt = userMessage.content;

      const nameSession = async () => {
        try {
          setNamingSessionIds(prev => {
            const next = new Set(prev);
            next.add(currentSessionId);
            return next;
          });

          const chatNamingSelectionId = modelConfig?.systemDefaults?.chatRenaming || 'gemini-3.1-flash-lite';
          
          const allModels = [
            ...(modelConfig?.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' as const })),
            ...(modelConfig?.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' as const })),
            ...(modelConfig?.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' as const })),
          ];
          
          let targetProvider = 'gemini';
          let targetModelId = 'gemini-3.1-flash-lite';
          
          if (chatNamingSelectionId === 'gemini-3.1-flash-lite') {
            targetProvider = 'gemini';
            targetModelId = 'gemini-3.1-flash-lite';
          } else if (chatNamingSelectionId === 'claude-sonnet-4.5') {
              targetProvider = 'anthropic';
              targetModelId = 'claude-sonnet-4.5';
          } else {
              const sel = allModels.find((m: any) => m.modelId === chatNamingSelectionId);
              if (sel) {
                targetProvider = sel.provider;
                targetModelId = sel.modelId;
              }
          }
          
          const apiKey = apiKeys?.[targetProvider]?.[0];
          if (!apiKey) throw new Error('No API key for configured chat naming provider');

          const promptText = `You are an AI assistant. Analyze this initial user prompt for a coding session and summarize it into a very short, creative title of 2 to 4 words. The title should describe what the user wants to build or achieve (e.g., "Create Button Component", "Fix Table Alignment", "Add Search Filter"). Do NOT use any quotes, punctuation, markdown, numbers, or bullet points. Return ONLY the title text.

User Prompt:
"${userPrompt}"`;

          let summaryTitle = '';

          if (targetProvider === 'gemini') {
              const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${targetModelId}:generateContent?key=${apiKey}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [{ parts: [{ text: promptText }] }]
                  })
                }
              );
              if (response.ok) {
                const data = await response.json();
                summaryTitle = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
              }
          } else if (targetProvider === 'openai') {
              const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                  model: targetModelId,
                  messages: [{ role: 'user', content: promptText }]
                })
              });
              if (response.ok) {
                  const data = await response.json();
                  summaryTitle = data?.choices?.[0]?.message?.content?.trim() || '';
              }
          } else if (targetProvider === 'anthropic') {
              const response = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-cors-bypass': 'true'
                  },
                  body: JSON.stringify({
                    model: targetModelId,
                    max_tokens: 50,
                    messages: [{ role: 'user', content: promptText }]
                  })
                });
                if (response.ok) {
                    const data = await response.json();
                    summaryTitle = data?.content?.[0]?.text?.trim() || '';
                }
          }
          
          summaryTitle = summaryTitle
            .replace(/^["'-\s•]+|["'-\s•]+$/g, '')
            .replace(/[\n\r]+/g, ' ')
            .trim();

          if (summaryTitle.length > 0 && summaryTitle.length < 40) {
            setSessions(prev => {
              const idx = prev.findIndex(s => s.id === currentSessionId);
              if (idx === -1) return prev;

              // Ensure name is unique among other sessions in the same project list
              let uniqueTitle = summaryTitle;
              let counter = 1;
              while (prev.some((s, sIdx) => sIdx !== idx && s.name.toLowerCase() === uniqueTitle.toLowerCase())) {
                uniqueTitle = `${summaryTitle} (${counter})`;
                counter++;
              }

              const updated = {
                ...prev[idx],
                name: uniqueTitle,
                updatedAt: Date.now(),
              };
              const next = [...prev];
              next[idx] = updated;
              const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';
              void saveCodeSessions(storageKey, next);
              return next;
            });
          }
        } catch (error) {
          console.error('[Sessions] Failed to auto-name session:', error);
        } finally {
          setNamingSessionIds(prev => {
            const next = new Set(prev);
            next.delete(currentSessionId);
            return next;
          });
        }
      };

      void nameSession();
    }
  }, [messages, currentSessionId, apiKeys.gemini, projectName]);

  // Switch to a different chat session
  const handleSwitchSession = useCallback((sessionId: string) => {
    if (isCurrentlyGenerating) return;

    const currentFiles = getFilesSnapshot();
    if (currentSessionId) {
      setSessions(prev => {
        const idx = prev.findIndex(s => s.id === currentSessionId);
        if (idx === -1) return prev;
        const updated = {
          ...prev[idx],
          messages,
          filesSnapshot: Object.keys(currentFiles).length > 0 ? currentFiles : prev[idx].filesSnapshot,
          activeSnapshotId: activeSnapshotId,
          updatedAt: Date.now(),
        };
        const next = [...prev];
        next[idx] = updated;
        const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';
        void saveCodeSessions(storageKey, next);
        return next;
      });
    }

    const targetSession = sessions.find(s => s.id === sessionId);
    if (targetSession) {
      setCurrentSessionId(sessionId);
      setMessages(targetSession.messages);
      
      setCurrentStreamingResponse('');
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      isCurrentlyThinkingRef.current = false;
      setCurrentThinkingTime(0);
      thinkingTimeRef.current = 0;
      thinkingStartTimeRef.current = null;
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      
      animatedContentRef.current.clear();
      completedMessagesRef.current.clear();
      introShownRef.current.clear();
    }
    
    setIsHistoryOpen(false);
  }, [currentSessionId, messages, activeSnapshotId, sessions, isCurrentlyGenerating, projectName, getFilesSnapshot]);

  // Delete a chat session
  const handleDeleteSession = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    setSessions(prev => {
      const next = prev.filter(s => s.id !== sessionId);
      const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';
      void saveCodeSessions(storageKey, next);
      
      if (currentSessionId === sessionId) {
        if (next.length > 0) {
          const sorted = [...next].sort((a, b) => b.updatedAt - a.updatedAt);
          setTimeout(() => {
            setCurrentSessionId(sorted[0].id);
            setMessages(sorted[0].messages);
          }, 0);
        } else {
          const newId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const newSession: ChatSession = {
            id: newId,
            name: 'Initial Chat',
            messages: [],
            filesSnapshot: getFilesSnapshot(),
            activeSnapshotId: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          setTimeout(() => {
            setSessions([newSession]);
            setCurrentSessionId(newId);
            setMessages([]);
            workbenchStore.reset();
          }, 0);
        }
      }
      return next;
    });
  }, [currentSessionId, projectName, getFilesSnapshot]);

  const activeConversationMode = activeTab === 'canvas-screens' ? 'design' : 'default';
  const activeConversationMessages = activeConversationMode === 'design' ? designMessages : messages;
  const currentTargetVisualOffset = isChatMode
    ? 76
    : (activeTab === 'agent-builder' ||
       sidebarView === 'visual-edit' ||
       activeTab === 'canvas-screens' ||
       activeTab === 'canvas-elements')
      ? 56
      : 20;

  const LAST_RESPONSE_PREVIEW_GAP_COMPENSATION = 48;
  const responseHasCodeChanges = (response: string) => parseAIResponse(response).length > 0;

  // Generate prompt suggestions based on conversation
  const generateSuggestions = useCallback(async () => {
    if (!apiKeys.gemini?.[0]) return;

    try {
      const chatNamingSelectionId = modelConfig?.systemDefaults?.chatRenaming || 'gemini-3.1-flash-lite';
      
      const allModels = [
        ...(modelConfig?.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' as const })),
        ...(modelConfig?.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' as const })),
        ...(modelConfig?.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' as const })),
      ];
      
      let targetProvider = 'gemini';
      let targetModelId = 'gemini-3.1-flash-lite';
      
      if (chatNamingSelectionId === 'gemini-3.1-flash-lite') {
        targetProvider = 'gemini';
        targetModelId = 'gemini-3.1-flash-lite';
      } else if (chatNamingSelectionId === 'claude-sonnet-4.5') {
          targetProvider = 'anthropic';
          targetModelId = 'claude-sonnet-4.5';
      } else {
          const sel = allModels.find((m: any) => m.modelId === chatNamingSelectionId);
          if (sel) {
            targetProvider = sel.provider;
            targetModelId = sel.modelId;
          }
      }
      
      const apiKey = apiKeys?.[targetProvider]?.[0];
      if (!apiKey) throw new Error('No API key for configured chat naming provider');

      // Build context from recent messages
      const recentMessages = messages.slice(-4).map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 200)}`
      ).join('\n');

      const promptText = `Based on this conversation about building an app, suggest 5 short follow-up prompts (2-4 words each) the user might want to ask next. Return ONLY the suggestions, one per line. No numbers, no bullets, no question marks.\n\nConversation:\n${recentMessages}`;

      let text = '';

      if (targetProvider === 'gemini') {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${targetModelId}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }]
              })
            }
          );
          if (response.ok) {
            const data = await response.json();
            text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          }
      } else if (targetProvider === 'openai') {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: targetModelId,
              messages: [{ role: 'user', content: promptText }]
            })
          });
          if (response.ok) {
              const data = await response.json();
              text = data?.choices?.[0]?.message?.content?.trim() || '';
          }
      } else if (targetProvider === 'anthropic') {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-cors-bypass': 'true'
              },
              body: JSON.stringify({
                model: targetModelId,
                max_tokens: 150,
                messages: [{ role: 'user', content: promptText }]
              })
            });
            if (response.ok) {
                const data = await response.json();
                text = data?.content?.[0]?.text?.trim() || '';
            }
      }
      const newSuggestions = text.split('\n')
        .map(s => s.trim().replace(/\?+$/, '')) // Remove trailing question marks
        .filter(s => s.length > 0 && s.length <= 30)
        .slice(0, 5);

      if (newSuggestions.length > 0) {
        setSuggestions(newSuggestions);
      }
    } catch (error) {
      console.error('[Sidebar] Failed to generate suggestions:', error);
    }
  }, [apiKeys.gemini, messages]);

  // Handle suggestion generation when AI completes
  useEffect(() => {
    // Detect transition from generating → not generating
    if (prevGeneratingRef.current && !isCurrentlyGenerating) {
      // AI just finished generating
      // Mark initial load as complete (first generation done)
      const wasInitialLoad = !initialLoadCompleteRef.current;
      initialLoadCompleteRef.current = true;

      // Generate new suggestions then show
      generateSuggestions().then(() => {
        // Reset scroll position to leftmost before showing
        if (tabsScrollRef.current) {
          tabsScrollRef.current.scrollLeft = 0;
        }
        // Small delay to let suggestions update, then slide up
        setTimeout(() => setSuggestionsVisible(true), 50);
      });
    } else if (!prevGeneratingRef.current && isCurrentlyGenerating) {
      // AI just started generating - hide suggestions only if initial load is complete
      // (don't hide on initial load since they're already hidden)
      if (initialLoadCompleteRef.current) {
        setSuggestionsVisible(false);
      }
    }
    prevGeneratingRef.current = isCurrentlyGenerating;
  }, [isCurrentlyGenerating, generateSuggestions]);

  // Generate initial suggestions when first message is sent
  useEffect(() => {
    if (messages.length >= 2 && !suggestionsGeneratedRef.current) {
      suggestionsGeneratedRef.current = true;
      generateSuggestions();
    }
  }, [messages, generateSuggestions]);

  // Keep thinking ref in sync with state
  useEffect(() => {
    isCurrentlyThinkingRef.current = isCurrentlyThinking;
  }, [isCurrentlyThinking]);
  
  // Pre-warm SDK clients as soon as API keys are available
  useEffect(() => {
    if (apiKeys.gemini?.[0]) prewarmClient('gemini', apiKeys.gemini[0]);
    if (apiKeys.openai?.[0]) prewarmClient('openai', apiKeys.openai[0]);
    if (apiKeys.anthropic?.[0]) prewarmClient('anthropic', apiKeys.anthropic[0]);
  }, [apiKeys]);

  // Inject animation CSS once on mount to prevent animation restarts on re-render
  useEffect(() => {
    const styleId = 'char-reveal-animation-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes reveal {
          0% { opacity: 0; transform: translateY(10px) scale(0.95); filter: blur(10px); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        .char-reveal {
          display: inline-block;
          animation: reveal 0.4s cubic-bezier(0.2, 0.65, 0.3, 0.9) forwards;
          opacity: 0;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Helper to process bold text
  // Process inline formatting: bold (**text**) and inline code (`code`)
  const processInlineFormatting = (text: string): React.ReactNode[] => {
    // 1. Extract code blocks and replace with unique placeholders
    const codeBlocks: string[] = [];
    const placeholderPrefix = '___CODE_BLOCK_';
    const placeholderSuffix = '___';
    
    const textWithPlaceholders = text.replace(/(`[^`]+`)/g, (match) => {
      const index = codeBlocks.length;
      codeBlocks.push(match);
      return `${placeholderPrefix}${index}${placeholderSuffix}`;
    });

    // 2. Split by bold markers
    const parts = textWithPlaceholders.split(/(\*\*.*?\*\*)/g);

    // 3. Render parts and restore code blocks
    return parts.map((part, partIdx) => {
      const restoreCode = (content: string) => {
        // Split by placeholders to find where code codes go
        const subParts = content.split(new RegExp(`(${placeholderPrefix}\\d+${placeholderSuffix})`, 'g'));
        
        return subParts.map((subPart, subIdx) => {
          if (subPart.startsWith(placeholderPrefix) && subPart.endsWith(placeholderSuffix)) {
            const indexStr = subPart.substring(placeholderPrefix.length, subPart.length - placeholderSuffix.length);
            const index = parseInt(indexStr, 10);
            if (!isNaN(index) && codeBlocks[index]) {
              // Render the code block
              return (
                <code key={`code-${partIdx}-${subIdx}`} className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-[13px] text-gray-200">
                  {codeBlocks[index].slice(1, -1)}
                </code>
              );
            }
          }
          // Return plain text
          return subPart;
        });
      };

      // Check if this part is a bold block
      if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        return (
          <strong key={`bold-${partIdx}`} className="text-white font-semibold">
            {restoreCode(part.slice(2, -2))}
          </strong>
        );
      }
      
      // Normal text
      return <React.Fragment key={`text-${partIdx}`}>{restoreCode(part)}</React.Fragment>;
    });
  };

  // Keep processBold as alias for backward compatibility
  const processBold = processInlineFormatting;

  // Track which content has been animated and their assigned delays
  const animatedContentRef = useRef<Map<string, string>>(new Map());
  
  // Track message IDs that have fully completed generation (should never re-animate)
  const completedMessagesRef = useRef<Set<string>>(new Set());
  
  // Track message IDs whose intro text has been shown (to prevent re-animation when indicator appears)
  const introShownRef = useRef<Set<string>>(new Set());

  // New Chat — clears all chat context while preserving the codebase
  const handleNewChat = useCallback(() => {
    // Don't allow new chat while generating
    if (isCurrentlyGenerating) return;

    // Save outgoing session state first
    const currentFiles = getFilesSnapshot();
    if (currentSessionId) {
      setSessions(prev => {
        const idx = prev.findIndex(s => s.id === currentSessionId);
        if (idx === -1) return prev;
        const updated = {
          ...prev[idx],
          messages,
          filesSnapshot: Object.keys(currentFiles).length > 0 ? currentFiles : prev[idx].filesSnapshot,
          activeSnapshotId: activeSnapshotId,
          updatedAt: Date.now(),
        };
        const next = [...prev];
        next[idx] = updated;
        const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';
        void saveCodeSessions(storageKey, next);
        return next;
      });
    }

    // Clear chat messages
    setMessages([]);
    setCurrentStreamingResponse('');
    setPromptValue('');

    // Clear thinking state
    setIsCurrentlyGenerating(false);
    setIsCurrentlyThinking(false);
    isCurrentlyThinkingRef.current = false;
    setCurrentThinkingTime(0);
    thinkingTimeRef.current = 0;
    thinkingStartTimeRef.current = null;
    if (thinkingTimerRef.current) {
      clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }

    // Keep suggestions (do not clear them)
    // Removed: setSuggestions([]);
    // Removed: setSuggestionsVisible(false);
    suggestionsGeneratedRef.current = false;
    prevGeneratingRef.current = false;
    initialLoadCompleteRef.current = false;

    // Clear animation tracking
    animatedContentRef.current.clear();
    completedMessagesRef.current.clear();
    introShownRef.current.clear();

    // Clear file list expansion state
    setFileListExpanded(false);

    // Reset attachments
    setAttachments([]);
    setRemovingIds(new Set());

    // Switch to chat view if in visual edit
    if (sidebarView === 'visual-edit') {
      setSidebarViewRaw('chat');
      exitVisualEdit();
    }

    // Just generate a temporary new session ID and set it as active, but do not create a blank session in sessions list yet
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setCurrentSessionId(newSessionId);

    // Switch to preview tab
    onTabChange('preview');
  }, [isCurrentlyGenerating, sidebarView, onTabChange, currentSessionId, messages, activeSnapshotId, projectName, getFilesSnapshot]);

  // Listen for new chat signal from collapsed TopBar
  useEffect(() => {
    const unsub = newChatSignal.listen(() => {
      handleNewChat();
    });
    return unsub;
  }, [handleNewChat]);

  // Helper to render plain text with word-by-word staggered animation
  // isAnimating: true for streaming content that should animate
  // For completed messages (in completedMessagesRef), always render without animation
  const renderTextContent = (text: string, isAnimating: boolean = false, contentKey?: string) => {
    if (!text) return null;
    
    // Extract messageId from contentKey (format: "messageId-suffix-...")
    const messageId = contentKey?.split('-')[0];
    const isCompletedMessage = messageId && completedMessagesRef.current.has(messageId);
    
    const blockLines = text.split('\n').filter(line => line.trim());
    let globalWordCounter = 0;

    // Wrap words - animate new content, skip already-animated content
    // For completed messages, always render plain (no animation)
    // For test mode conclusions (not marked complete), animate genuinely new content
    const wrapWords = (nodes: React.ReactNode[], baseKey: string) => {
      return nodes.map((node, nodeIdx) => {
        if (typeof node === 'string') {
          const words = node.split(/(\s+)/);
          return words.map((word, wordIdx) => {
            if (!word) return null;
            
            // Completed messages NEVER animate - render plain immediately
            if (isCompletedMessage) {
              return (
                <span key={wordIdx} className="inline-block whitespace-pre-wrap">
                  {word}
                </span>
              );
            }
            
            const wordKey = `${baseKey}-n${nodeIdx}-w${wordIdx}`;
            const existingEntry = animatedContentRef.current.get(wordKey);
            
            // Already fully animated - render as plain visible text
            if (existingEntry === 'done') {
              return (
                <span key={wordIdx} className="inline-block whitespace-pre-wrap">
                  {word}
                </span>
              );
            }
            
            // Currently animating - keep animation with saved delay
            if (existingEntry) {
              return (
                <span key={wordIdx} className="inline-block whitespace-pre-wrap char-reveal" style={{ animationDelay: existingEntry }}>
                  {word}
                </span>
              );
            }
            
            // NEW word - animate if we have a contentKey (streaming or test mode)
            if (contentKey) {
              const delay = `${globalWordCounter * 50}ms`;
              animatedContentRef.current.set(wordKey, delay);
              globalWordCounter++;
              
              // Mark as done after animation completes
              const totalDelay = globalWordCounter * 50 + 400;
              setTimeout(() => {
                animatedContentRef.current.set(wordKey, 'done');
              }, totalDelay);
              
              return (
                <span key={wordIdx} className="inline-block whitespace-pre-wrap char-reveal" style={{ animationDelay: delay }}>
                  {word}
                </span>
              );
            }
            
            // No contentKey - render plain
            return (
              <span key={wordIdx} className="inline-block whitespace-pre-wrap">
                {word}
              </span>
            );
          });
        }

        // Non-string nodes (formatted content)
        // Completed messages NEVER animate
        if (isCompletedMessage) {
          return <span key={nodeIdx} className="inline-block">{node}</span>;
        }
        
        const itemKey = `${baseKey}-n${nodeIdx}`;
        const existingEntry = animatedContentRef.current.get(itemKey);
        
        if (existingEntry === 'done') {
          return <span key={nodeIdx} className="inline-block">{node}</span>;
        }
        
        if (existingEntry) {
          return <span key={nodeIdx} className="inline-block char-reveal" style={{ animationDelay: existingEntry }}>{node}</span>;
        }
        
        if (contentKey) {
          const delay = `${globalWordCounter * 50}ms`;
          animatedContentRef.current.set(itemKey, delay);
          globalWordCounter++;
          
          const totalDelay = globalWordCounter * 50 + 400;
          setTimeout(() => {
            animatedContentRef.current.set(itemKey, 'done');
          }, totalDelay);
          
          return <span key={nodeIdx} className="inline-block char-reveal" style={{ animationDelay: delay }}>{node}</span>;
        }
        
        return <span key={nodeIdx} className="inline-block">{node}</span>;
      });
    };
    
    return (
      <>
        {blockLines.map((line, idx) => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return null;
          
          const lineBaseKey = contentKey ? `${contentKey}-l${idx}` : `raw-${idx}`;

          if (trimmedLine.startsWith('#')) {
            const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
            if (headerMatch) {
              const level = headerMatch[1].length;
              const headerText = headerMatch[2];
              const baseHeaderClasses = {
                1: "text-[22px] font-bold text-white mt-6 mb-2",
                2: "text-[19px] font-bold text-white mt-5 mb-1",
                3: "text-[17px] font-bold text-white mt-4 mb-1",
                4: "text-[15px] font-bold text-white mt-3",
                5: "text-[15px] font-bold text-white mt-3",
                6: "text-[15px] font-bold text-white mt-3",
              }[level as 1|2|3|4|5|6];
              return (
                <div key={idx} className={baseHeaderClasses}>
                  {wrapWords(processBold(headerText), lineBaseKey)}
                </div>
              );
            }
          }

          if ((trimmedLine.startsWith('*') && !trimmedLine.startsWith('**')) || trimmedLine.startsWith('-')) {
            const bulletContent = trimmedLine.replace(/^[\*\-]\s*/, '');
            return (
              <div key={idx} className="flex gap-3 pl-4 items-start">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 mt-[9px] shrink-0" />
                <div className="text-gray-400 text-[15px] leading-relaxed">
                  {wrapWords(processBold(bulletContent), lineBaseKey)}
                </div>
              </div>
            );
          }

          return (
            <p key={idx} className="text-gray-300 text-[15px] leading-[1.65]">
              {wrapWords(processBold(line), lineBaseKey)}
            </p>
          );
        })}
      </>
    );
  };

  // Helper to render conversational AI content with file indicators
  // isStreaming: when true, applies fade animation to text
  // messageId: unique message identifier for tracking animated content
  const renderFormattedContent = (content: string, isStreaming: boolean = false, messageId?: string) => {
    // Check for <test-indicator> block (format: <test-indicator>{"actions":["A","B"],"current":"B"}</test-indicator>)
    if (content.includes('<test-indicator>')) {
      const match = content.match(/<test-indicator>([^<]+)<\/test-indicator>/);
      let actions: string[] = ['Analysis'];
      let currentAction = 'Analysis';
      
      try {
        if (match && match[1]) {
          const data = JSON.parse(match[1]);
          actions = data.actions || ['Analysis'];
          currentAction = data.current || actions[actions.length - 1] || 'Analysis';
        }
      } catch (e) {
        console.error('Failed to parse test indicator', e);
      }
      
      // Get text before and after the tag
      const parts = content.split(/<test-indicator>[^<]+<\/test-indicator>/);
      const beforeText = parts[0] || '';
      const afterText = parts[1] || '';
      
      // Create unique keys for each text section
      // If intro was already shown before (plain text phase), don't animate it again
      const introAlreadyShown = messageId ? introShownRef.current.has(messageId) : false;
      const introKey = (messageId && !introAlreadyShown) ? `${messageId}-intro` : undefined;
      const conclusionKey = messageId ? `${messageId}-conclusion` : undefined;
      
      // Mark intro as shown for future renders (content now has indicator)
      if (messageId && beforeText.trim()) {
        introShownRef.current.add(messageId);
      }
      
      return (
        <div className="space-y-4">
          {/* Intro text - skip animation if already shown before indicator appeared */}
          {beforeText.trim() && renderTextContent(beforeText.trim(), isStreaming, introKey)}
          
          {/* Test Action Indicator (matches file indicator exactly) */}
          <CollapsibleTestIndicator 
            actions={actions} 
            currentAction={currentAction} 
            isGenerating={isStreaming}  // Use message's own state, not global
            isStreaming={isStreaming}
          />
          
          {/* Conclusion text (if any) */}
          {afterText.trim() && renderTextContent(afterText.trim(), isStreaming, conclusionKey)}
        </div>
      );
    }

    

    if (!content) return null;
    
    try {
      // Parse response into segments (text + file indicators)
      const segments = parseResponseForDisplay(content);
      console.log('[Render] Segments parsed:', segments.length, 'segments, types:', segments.map(s => s.type).join(', '));
      
      // If no segments found (plain text response), render normally
      // Use "-intro" key to match the key used when test-indicator is present
      // This prevents double animation when content transitions from plain text to having a test indicator
      if (!segments || segments.length === 0) {
        console.log('[Render] No segments, rendering as plain text');
        const textKey = messageId ? `${messageId}-intro` : undefined;
        // Mark intro as shown so it won't re-animate when test-indicator appears later
        if (messageId) {
          introShownRef.current.add(messageId);
        }
        return <div className="space-y-4">{renderTextContent(content, isStreaming, textKey)}</div>;
      }
      
    // Group consecutive file indicators together
    const groupedSegments: (ChatSegment | { type: 'file-group', files: ChatSegment[] })[] = [];
    let currentFileGroup: ChatSegment[] = [];
    
    segments.forEach((seg, i) => {
      if (seg.type === 'file-indicator') {
        currentFileGroup.push(seg);
      } else {
        if (currentFileGroup.length > 0) {
          groupedSegments.push({ type: 'file-group', files: [...currentFileGroup] });
          currentFileGroup = [];
        }
        groupedSegments.push(seg);
      }
    });
    // Handle remaining file group
    if (currentFileGroup.length > 0) {
      groupedSegments.push({ type: 'file-group', files: currentFileGroup });
    }
    
    return (
      <div className="space-y-4">
        {groupedSegments.map((segment, idx) => {
          if (segment.type === 'text') {
            const textKey = messageId ? `${messageId}-text-${idx}` : undefined;
            return (
              <div key={idx} className="space-y-2">
                {renderTextContent(segment.content, isStreaming, textKey)}
              </div>
            );
          }
          
          if (segment.type === 'file-group') {
            const files = segment.files;
            const lastFile = files[files.length - 1];
            const lastFileName = lastFile.filePath?.split('/').pop() || lastFile.content;
            
            // Only show as "Editing" (with shimmer) if this is the last segment and still generating
            const isLastSegment = idx === groupedSegments.length - 1;
            const isActivelyEditing = isCurrentlyGenerating && isLastSegment;
            
            // Collapsible file indicator component - uses internal state for independent expand/collapse
            return (
              <CollapsibleFileIndicator 
                key={idx} 
                files={files} 
                lastFileName={lastFileName} 
                isGenerating={isActivelyEditing} 
                isStreaming={isStreaming}
              />
            );
          }
          
          if (segment.type === 'shell-indicator') {
            // Only show "Running" if this is the last segment and still generating
            const isLastSegment = idx === groupedSegments.length - 1;
            const isRunning = isCurrentlyGenerating && isLastSegment;
            const shimmerClass = isRunning ? "animate-shimmer bg-clip-text text-transparent bg-[length:200%_100%]" : "";
            const shimmerStyle = isRunning ? { backgroundImage: 'linear-gradient(90deg, #81888f 0%, #ffffff 50%, #81888f 100%)', animationDuration: '1.5s' } : { color: '#81888f' };
            return (
              <div key={idx} className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                <Terminal size={18} />
                <span className={`text-[15.15px] ${shimmerClass}`} style={shimmerStyle}>
                  {isRunning ? 'Running' : 'Ran'}{' '}
                  <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded">npm install</span>
                </span>
              </div>
            );
          }
          
          if (segment.type === 'start-indicator') {
            // Only show "Starting" if this is the last segment and still generating
            const isLastSegment = idx === groupedSegments.length - 1;
            const isStarting = isCurrentlyGenerating && isLastSegment;
            const shimmerClass = isStarting ? "animate-shimmer bg-clip-text text-transparent bg-[length:200%_100%]" : "";
            const shimmerStyle = isStarting ? { backgroundImage: 'linear-gradient(90deg, #81888f 0%, #ffffff 50%, #81888f 100%)', animationDuration: '1.5s' } : { color: '#81888f' };
            return (
              <div key={idx} className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                <Terminal size={18} />
                <span className={`text-[15.15px] ${shimmerClass}`} style={shimmerStyle}>
                  {isStarting ? 'Starting' : 'Started'}{' '}
                  <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded">npm run dev</span>
                </span>
              </div>
            );
          }
          
          return null;
        })}
      </div>
    );
    } catch (error) {
      console.error('[Sidebar] Error parsing AI response for display:', error);
      // Fallback: just render as plain text without parsing
      return <div className="space-y-4">{renderTextContent(content)}</div>;
    }
  };

  // Handle Initial Prompt Display & UI Status (both chat mode and staging mode)
  const initialPromptDisplayed = useRef(false);
  // True only when THIS mount is starting a genuinely fresh generation (a brand
  // new project). Stays false when we're merely returning to an existing project
  // from another page (e.g. /media) with ?prompt= still in the URL — which must
  // NOT re-trigger generation. Guards the fire-generation effect below so the
  // preview never re-enters the generation animation on back-navigation.
  const shouldFireInitialGenRef = useRef(false);
  useEffect(() => {
    if (prompt && !initialPromptDisplayed.current) {
      initialPromptDisplayed.current = true;

      const isNewProject = location.state?.isNewProject;
      
      // If we are returning from another page (like /media) to an existing session,
      // don't reset the stores and don't re-trigger the initial generation.
      if (isNewProject === false) {
        return;
      }

      // If it is a new project, clear the state flag so navigating away/back later doesn't reset it again
      if (isNewProject) {
        navigate(location.pathname + location.search, { replace: true, state: { ...location.state, isNewProject: false } });
      }

      // This mount is performing a genuine fresh generation (not a return to an
      // existing project) — allow the fire-generation effect below to run once.
      shouldFireInitialGenRef.current = true;

      // Reset stores for fresh session
      sandpackStore.reset();
      testStore.reset();

      // Clear animation tracking refs
      animatedContentRef.current.clear();
      completedMessagesRef.current.clear();
      introShownRef.current.clear();

      // Process initial attachments for display in user message
      const processInitialAttachments = async () => {
        const processedAttachments: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[] = [];

        if (initialAttachments && initialAttachments.length > 0) {
          for (const att of initialAttachments) {
            if (!att.file) continue;
            try {
              if (att.type === 'image') {
                const base64 = await fileToBase64(att.file);
                processedAttachments.push({
                  type: 'image',
                  mimeType: att.file.type,
                  data: base64,
                  name: att.name
                });
              } else {
                const content = await readFileText(att.file);
                processedAttachments.push({
                  type: 'text',
                  mimeType: att.file.type || 'text/plain',
                  data: content,
                  name: att.name
                });
              }
            } catch (e) {
              // Skip failed attachment
            }
          }
        }

        // Show user message immediately (with attachments if any)
        const userMessage: ChatMessage = {
          id: 'initial-prompt',
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
          attachments: processedAttachments.length > 0 ? processedAttachments : undefined
        };
        setMessages([userMessage]);

        // Clear attachments from the input area since they've been sent
        setAttachments([]);

        // Set generating/thinking status immediately
        setIsCurrentlyGenerating(true);
        setIsCurrentlyThinking(true);
        isCurrentlyThinkingRef.current = true;
        setCurrentThinkingTime(0);
        thinkingTimeRef.current = 0;
        thinkingStartTimeRef.current = Date.now();

        // Start timer immediately
        if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = setInterval(() => {
          thinkingTimeRef.current += 1;
          setCurrentThinkingTime(thinkingTimeRef.current);
        }, 1000);
      };

      processInitialAttachments();
    }
  }, [prompt]);

  // Handle Initial AI Generation - Fire immediately since keys are loaded synchronously
  const initialAiTriggered = useRef(false);
  useEffect(() => {
    // shouldFireInitialGenRef gates out back-navigation returns: on a return to an
    // existing project the display effect above early-returns without setting it,
    // so we must not re-fire generation (which would show the stuck animation).
    if (prompt && !initialAiTriggered.current && messages.length > 0 && shouldFireInitialGenRef.current) {
      initialAiTriggered.current = true;

      // Process initial attachments for sending to AI
      const fireInitialGeneration = async () => {
        const processedAttachments: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[] = [];

        if (initialAttachments && initialAttachments.length > 0) {
          for (const att of initialAttachments) {
            if (!att.file) continue;
            try {
              if (att.type === 'image') {
                const base64 = await fileToBase64(att.file);
                processedAttachments.push({
                  type: 'image',
                  mimeType: att.file.type,
                  data: base64,
                  name: att.name
                });
              } else {
                const content = await readFileText(att.file);
                processedAttachments.push({
                  type: 'text',
                  mimeType: att.file.type || 'text/plain',
                  data: content,
                  name: att.name
                });
              }
            } catch (e) {
              // Skip failed attachment
            }
          }
        }

        startAiGeneration(prompt, [], true, processedAttachments); // true = UI already started
      };

      fireInitialGeneration();
    }
  }, [prompt, messages]);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          // Remove data:image/png;base64, prefix
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        } else {
          reject(new Error('Failed to read file'));
        }
      };
      reader.onerror = error => reject(error);
    });
  };

  const readFileText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsText(file);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to read file'));
        }
      };
      reader.onerror = error => reject(error);
    });
  };

  const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

  const sanitizeFileName = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const getUniqueImagePath = (name: string, existingFiles: Record<string, any>): string => {
    const sanitized = sanitizeFileName(name);
    const basePath = `/public/uploads/${sanitized}`;
    if (!existingFiles[basePath]) return basePath;

    const dotIndex = sanitized.lastIndexOf('.');
    const stem = dotIndex > 0 ? sanitized.substring(0, dotIndex) : sanitized;
    const ext = dotIndex > 0 ? sanitized.substring(dotIndex) : '';

    let counter = 1;
    let candidate: string;
    do {
      candidate = `/public/uploads/${stem}-${counter}${ext}`;
      counter++;
    } while (existingFiles[candidate]);

    return candidate;
  };

  const handleSendMessage = async (text: string) => {
    if (hasUnsaved) return; // Block sending when unsaved changes exist
    if (!text.trim() && attachments.length === 0) return;

    // Process attachments
    const processedAttachments: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[] = [];
    
    for (const att of attachments) {
        if (!att.file) continue;
        
        try {
            if (att.type === 'image') {
                const base64 = await fileToBase64(att.file);
                processedAttachments.push({
                    type: 'image',
                    mimeType: att.file.type,
                    data: base64,
                    name: att.name
                });
            } else {
                // For text files
                const content = await readFileText(att.file);
                 processedAttachments.push({
                    type: 'text',
                    mimeType: att.file.type || 'text/plain',
                    data: content,
                    name: att.name
                });
            }
        } catch (e) {
            console.error('Failed to process file:', att.name, e);
        }
    }

    // Prepare image asset paths (don't store yet - only store if AI uses them in code)
    const imageAssetPaths: { name: string; path: string; dataUrl: string }[] = [];
    const currentFiles = workbenchStore.files.get();

    for (const att of processedAttachments) {
      if (att.type === 'image' && att.data) {
        const approxBytes = att.data.length * 0.75;
        if (approxBytes > MAX_IMAGE_SIZE_BYTES) {
          console.warn(`[Sidebar] Image ${att.name} too large (${(approxBytes / 1024 / 1024).toFixed(1)} MB), skipping`);
          continue;
        }

        const dataUrl = `data:${att.mimeType};base64,${att.data}`;
        const imagePath = getUniqueImagePath(att.name || 'image.png', currentFiles);
        imageAssetPaths.push({ name: att.name || 'image.png', path: imagePath, dataUrl });
        console.log(`[Sidebar] Prepared image asset path: ${att.name} -> ${imagePath}`);
      }
    }

    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachments: processedAttachments
    };

    // Batch ALL state updates in flushSync to prevent multiple re-renders
    // that would interfere with the scroll animation
    flushSync(() => {
      // In design mode, user message is added via startDesignGeneration instead
      if (activeTab !== 'canvas-screens') {
        setMessages(prev => [...prev, userMessage]);
      }

      // If the current session doesn't exist in sessions yet, create it on the first message
      if (currentSessionId && !sessions.some(s => s.id === currentSessionId)) {
        const newSession: ChatSession = {
          id: currentSessionId,
          name: 'New Chat',
          messages: [userMessage],
          filesSnapshot: currentFiles,
          activeSnapshotId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setSessions(prev => {
          const next = [newSession, ...prev];
          const storageKey = projectName ? `willow_chat_sessions_${projectName}` : 'willow_chat_sessions_default';
          void saveCodeSessions(storageKey, next);
          return next;
        });
      }

      setPromptValue('');
      setAttachments([]); // Clear attachments
      setRemovingIds(new Set());
      setIsCurrentlyGenerating(true);
      setIsCurrentlyThinking(true);
      setCurrentThinkingTime(0);
      setCurrentStreamingResponse('');
    });

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Set refs directly (these don't cause re-renders)
    isCurrentlyThinkingRef.current = true;
    thinkingTimeRef.current = 0;
    thinkingStartTimeRef.current = Date.now();

    if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    thinkingTimerRef.current = setInterval(() => {
      thinkingTimeRef.current += 1;
      setCurrentThinkingTime(thinkingTimeRef.current);
    }, 1000);

    // Route based on activeTab, selectedToolId, isTestMode, or Agent Swarm
    if (activeTab === 'canvas-screens') {
      // Design mode — isolated design generation
      await startDesignGeneration(text);
    } else if (selectedToolId === 'test' || isTestMode) {
      // In test mode, run the test
      await startTestGeneration(text);
    } else if (agentSwarmEnabled && selectedToolId === null) {
      // Agent Swarm mode — only when no tools are selected
      const history: AiChatMessage[] = messages.map(m => ({
          role: m.role,
          content: m.content
      }));
      await startSwarmGeneration(text, history, processedAttachments, imageAssetPaths);
    } else {
      // Normal code generation - Trigger generation with history
      const history: AiChatMessage[] = messages.map(m => ({
          role: m.role,
          content: m.content
      }));
      // Pass processedAttachments for the NEW message
      await startAiGeneration(text, history, true, processedAttachments, imageAssetPaths);
    }
  };

  const startAiGeneration = async (text: string, history: AiChatMessage[], uiAlreadyStarted: boolean, currentAttachments: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[] = [], imageAssetPaths: { name: string; path: string; dataUrl: string }[] = []) => {
    // Clear previously animated content tracking to allow fresh animations
    animatedContentRef.current.clear();

    if (!uiAlreadyStarted) {
      setIsCurrentlyGenerating(true);
      setIsCurrentlyThinking(true);
      setCurrentThinkingTime(0);
      thinkingTimeRef.current = 0;
      setCurrentStreamingResponse('');

      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = setInterval(() => {
        thinkingTimeRef.current += 1;
        setCurrentThinkingTime(thinkingTimeRef.current);
      }, 1000);
    }

    try {
      // Find selected provider and model
      let provider: 'gemini' | 'openai' | 'anthropic' = 'gemini';
      let modelId = '';

      const allSavedModels = [
        ...(modelConfig.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' })),
        ...(modelConfig.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' })),
        ...(modelConfig.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' }))
      ];

      const selected = allSavedModels.find(m => m.id === selectedModelId);
      if (selected) {
        provider = selected.provider as 'gemini' | 'openai' | 'anthropic';
        modelId = selected.modelId;
      } else {
        // Fallback to default
        provider = 'gemini';
        modelId = (modelConfig.gemini?.model) || 'gemini-3-pro-preview';
      }

      console.log(`Starting AI generation with ${provider} (${modelId})`);

      const apiKey = apiKeys[provider]?.[0];
      if (!apiKey) {
        console.error(`Missing API key for provider ${provider}. Available keys:`, apiKeys);
        throw new Error(`API Key for ${provider} is missing. Please add it in settings.`);
      }

      // Add system prompt for Ship mode to get boltArtifact format
      const systemMessage: AiChatMessage = {
        role: 'user',
        content: `<system>${BOLT_SYSTEM_PROMPT}</system>\n\nRemember: Always respond with <boltArtifact> tags containing <boltAction> tags for files and commands.`
      };
      
      // Update history to match new AiChatMessage structure if needed, but for now just casting/passing
      // effectively, we want to construct the FINAL history that streamChat uses.
      
      // Build user content with image asset context if images were stored
      let userContent = text;
      if (imageAssetPaths.length > 0) {
        const imageLines = imageAssetPaths.map(img =>
          `- "${img.name}" is available at import path "${img.path}"`
        ).join('\n');
        userContent += `\n\n[Available image assets in the project - use these import paths to reference the attached images in code:\n${imageLines}\nUsage: import variableName from '${imageAssetPaths[0].path}'; then use variableName as the src value or in url().]`;
      }

      // Build codebase context from current project files so AI knows existing code
      const currentFiles = workbenchStore.files.get();
      const fileEntries = Object.entries(currentFiles);
      let codebaseContext = '';
      if (fileEntries.length > 0) {
        const fileContents = fileEntries
          .filter(([, file]: [string, any]) => file?.content !== undefined)
          .map(([path, file]: [string, any]) => `### ${path}\n\`\`\`\n${file.content}\n\`\`\``)
          .join('\n\n');
        if (fileContents) {
          codebaseContext = `\n\nHere is the current project codebase. When the user asks for changes, ONLY modify the files and sections they mention. Do NOT rewrite or re-output files that don't need changes.\n\n${fileContents}`;
        }
      }

      const fullHistory = [
          systemMessage,
          // Inject codebase context so AI always knows existing code (even after "new chat")
          ...(codebaseContext ? [{
            role: 'user' as const,
            content: `[EXISTING PROJECT FILES — for reference only, do not rewrite unless asked]${codebaseContext}`
          }, {
            role: 'assistant' as const,
            content: 'I can see the existing project files. I\'ll only modify what you ask for and keep everything else intact. What would you like me to change?'
          }] : []),
          ...history,
          {
              role: 'user' as const,
              content: userContent,
              attachments: currentAttachments
          }
      ];

      let responseText = '';
      
      // Create streaming parser for realtime file creation
      const messageParser = workbenchStore.createMessageParser();
      workbenchStore.isGenerating.set(true);
      
      await streamChat(
        fullHistory,
        { provider, model: modelId, apiKey, thinkingLevel: selected?.thinkingLevel || 0 },
        (token) => {
          // Use ref to avoid stale closure - state may not be updated yet
          if (isCurrentlyThinkingRef.current) {
            // Calculate actual elapsed time from start timestamp (more accurate than interval)
            const elapsedMs = thinkingStartTimeRef.current ? Date.now() - thinkingStartTimeRef.current : 0;
            const elapsedSeconds = Math.ceil(elapsedMs / 1000); // Round up to nearest second
            thinkingTimeRef.current = elapsedSeconds;
            setCurrentThinkingTime(elapsedSeconds);

            // Update ref and state
            isCurrentlyThinkingRef.current = false;
            setIsCurrentlyThinking(false);
            if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
          }
          responseText += token;
          setCurrentStreamingResponse(responseText);

          // Parse streaming content - this triggers file creation in realtime
          messageParser.parse(token);
        },
        () => {
          // onStart logic handled above
        }
      );

      const assistantMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: responseText,
        thinkingTime: thinkingTimeRef.current, // Use ref for accurate value
        hasCodeChanges: responseHasCodeChanges(responseText),
        timestamp: Date.now()
      };

      // Transfer animation state from 'streaming' keys to the new message ID
      // This prevents re-animation when the final message renders
      const newMessageId = assistantMessage.id;
      const keysToTransfer: [string, string][] = [];
      animatedContentRef.current.forEach((value, key) => {
        if (key.startsWith('streaming-')) {
          const newKey = key.replace('streaming-', `${newMessageId}-`);
          keysToTransfer.push([newKey, 'done']); // Mark as done so it won't re-animate
        }
      });
      keysToTransfer.forEach(([key, value]) => {
        animatedContentRef.current.set(key, value);
      });
      // Clear streaming keys
      const streamingKeys = Array.from(animatedContentRef.current.keys()).filter(k => k.startsWith('streaming-'));
      streamingKeys.forEach(k => animatedContentRef.current.delete(k));
      
      // Mark this message as completed - it should NEVER re-animate
      completedMessagesRef.current.add(newMessageId);

      setMessages(prev => [...prev, assistantMessage]);
      setCurrentStreamingResponse('');
      setCurrentThinkingTime(0);
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);

      // Store only images that the AI actually referenced in its code
      if (imageAssetPaths.length > 0) {
        for (const img of imageAssetPaths) {
          if (responseText.includes(img.path)) {
            workbenchStore.setFile(img.path, img.dataUrl);
            console.log(`[Sidebar] Stored referenced image asset: ${img.path}`);
          }
        }
      }

      // Process AI response with bolt.diy workbench
      workbenchStore.isGenerating.set(true);
      try {
        await workbenchStore.processAIResponse(responseText);
        console.log('[Sidebar] Processed AI response with workbenchStore');
      } catch (err) {
        console.error('[Sidebar] Error processing response:', err);
      }

      // Flush any pending file edits (for batched edits during subsequent generations)
      await workbenchStore.flushPendingEdits();

      if (assistantMessage.hasCodeChanges) {
        const snapshot: Record<string, string> = {};
        Object.entries(workbenchStore.files.get()).forEach(([path, file]: [string, any]) => {
          snapshot[path] = file.content;
        });
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id ? { ...msg, filesSnapshot: snapshot } : msg
        ));
        workbenchStore.activeSnapshotId.set(assistantMessage.id);
      }

      workbenchStore.isGenerating.set(false);

    } catch (error: any) {
      console.error('Chat error:', error);
      const errMsg = error.message || 'An error occurred during generation';
      const isApiKeyError = /api.?key/i.test(errMsg) && /missing/i.test(errMsg);
      addGlobalError(errMsg, isApiKeyError ? 'set-api-key' : undefined);
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      setNeedsScrollPadding(true);
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    } finally {
      // Always clear the global generating flag so the preview can never get
      // stuck on the loading animation after a stream error/abort. Without this,
      // a failed generation left isGenerating=true forever (showFullLoading).
      workbenchStore.isGenerating.set(false);
    }
  };

  // === DESIGN GENERATION (canvas-screens mode) ===

  const extractDesignCode = (content: string): string | null => {
    const match = content.match(/```(?:jsx|tsx|react|javascript|typescript)?\n([\s\S]*?)```/i);
    return match ? match[1].trim() : null;
  };

  const generateDesignFileName = (prompt: string): string => {
    // Extract max 4 meaningful words from prompt to generate PascalCase filename
    const words = prompt
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !['design', 'create', 'make', 'build'].includes(w.toLowerCase()))
      .slice(0, 4);
    
    if (words.length === 0) return `Design${Math.floor(Math.random() * 1000)}`;
    
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('') + 'Design';
  };

  const startDesignGeneration = async (text: string) => {
    // Build screen context from selected screens on the canvas
    let screenContext = '';
    if (selectedScreens.length > 0) {
      const screenParts = selectedScreens.map(s =>
        `Screen: "${s.fileName || 'App'}.tsx"\n\`\`\`tsx\n${s.code}\n\`\`\``
      );
      screenContext = `[The user has attached the following screen(s) from the canvas — they want to edit, reference, or build upon them:]\n${screenParts.join('\n\n')}\n\n`;
    }

    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content: text,
      timestamp: Date.now()
    };

    flushSync(() => {
      setDesignMessages(prev => [...prev, userMessage]);
      setDesignStreamingResponse('');
    });

    const assistantId = Math.random().toString(36).substring(7);
    let fullResponse = '';

    const aiMessages: AiChatMessage[] = designMessages.concat(userMessage).map(m => {
      let contentForAI = m.content;
      
      // If this was a past assistant message where we stripped the code, 
      // explicitly inject a massive fake code block to prove to the LLM that it generated code.
      // Otherwise, the LLM looks at its history, sees no code, and stops generating code!
      if (m.role === 'assistant' && m.designNodeId) {
        contentForAI = `\`\`\`tsx\n// Code generated successfully\n\`\`\`\n${m.content}`;
      } else {
        // Strip out any real code blocks from user/other to just a placeholder to save context
        contentForAI = contentForAI.replace(/```[\s\S]*?```/g, '```tsx\n// Code generated successfully\n```');
      }

      return {
        role: m.role,
        content: contentForAI
      };
    });

    // Prepend screen context to the last user message so the AI knows which screens are attached
    if (screenContext && aiMessages.length > 0) {
      const lastMsg = aiMessages[aiMessages.length - 1];
      if (lastMsg.role === 'user') {
        lastMsg.content = screenContext + lastMsg.content;
      }
    }

    try {
      let provider: 'gemini' | 'openai' | 'anthropic' = 'gemini';
      let modelId = '';

      const allSavedModels = [
        ...(modelConfig.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'gemini' })),
        ...(modelConfig.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'openai' })),
        ...(modelConfig.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'anthropic' }))
      ];

      const selected = allSavedModels.find((m: any) => m.id === selectedModelId);
      if (selected) {
        provider = selected.provider as 'gemini' | 'openai' | 'anthropic';
        modelId = selected.modelId;
      } else {
        provider = 'gemini';
        modelId = (modelConfig.gemini?.model) || 'gemini-2.5-pro';
      }

      const apiKey = apiKeys[provider]?.[0];
      if (!apiKey) {
        throw new Error(`API Key for ${provider} is missing. Please add it in settings.`);
      }

      // Stream silently — don't show streaming response in the chat.
      // User will only see a thinking indicator until generation completes.
      await streamChat(
        aiMessages,
        {
          provider: provider as any,
          model: modelId,
          apiKey: apiKey,
          thinkingLevel: selected?.thinkingLevel || 1
        },
        (token) => {
          if (isCurrentlyThinkingRef.current) {
            const elapsedMs = thinkingStartTimeRef.current ? Date.now() - thinkingStartTimeRef.current : 0;
            const elapsedSeconds = Math.ceil(elapsedMs / 1000);
            thinkingTimeRef.current = elapsedSeconds;
            setCurrentThinkingTime(elapsedSeconds);

            isCurrentlyThinkingRef.current = false;
            setIsCurrentlyThinking(false);
            if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
          }
          fullResponse += token;
          // Don't update designStreamingResponse — we show the response only once complete
        },
        () => { /* onStart */ },
        `You are a world-class UI/UX designer who writes production-quality React code. You ALWAYS generate REAL, COMPLETE, WORKING code — never pseudocode, never descriptions, never placeholders.

CRITICAL INSTRUCTION:
DO NOT output ANY introductory text, thoughts, or explanations before the code.
Your response MUST START IMMEDIATELY with the \`\`\`tsx code block.

RESPONSE FORMAT MUST BE EXACTLY THIS STRUCTURE:
\`\`\`tsx
import React from 'react';
// ... complete actual working React component code here ...
// Must use Tailwind CSS and Lucide React
export default function Design() { ... }
\`\`\`
I've designed... [1-2 short conversational sentences]
- **Feature**: Detail
- **Feature**: Detail

CODING RULES:
- Write a single, self-contained React component that uses Tailwind CSS for ALL styling and Lucide React for icons.
- Export the component as default export.
- The component must be COMPLETE — include all state, handlers, styling, layout, and visual details inline. No lazy "add more here" comments.
- Make the design stunning — use gradients, shadows, rounded corners, hover effects, smooth transitions, and a cohesive dark color palette.
- NEVER describe what you would build. ALWAYS write the actual code.
- NEVER output multiple code blocks. ONE code block only.`
      );

      // Extract code and add to canvas
      const code = extractDesignCode(fullResponse);
      let designNodeId: string | null = null;
      if (code) {
        // Save to codebase
        const fileName = generateDesignFileName(text);
        sandpackStore.setFile(`/Designs/${fileName}.tsx`, code);

        const node = addDesignNode({ prompt: text, code, fileName });
        designNodeId = node.id;
      }

      // Strip code blocks from the displayed message — only show the summary
      const summaryContent = fullResponse.replace(/```[\s\S]*?```/g, '').trim();

      // Add completed response to design messages with the linked design node ID
      flushSync(() => {
        setDesignMessages(prev => [...prev, {
          id: assistantId,
          role: 'assistant',
          content: summaryContent,
          thinkingTime: thinkingTimeRef.current,
          hasCodeChanges: !!code,
          timestamp: Date.now(),
          // Store the design node ID so we can render a clickable indicator
          designNodeId: designNodeId ?? undefined
        }]);
        setDesignStreamingResponse('');
        setCurrentThinkingTime(0);
        setIsCurrentlyGenerating(false);
        setIsCurrentlyThinking(false);
        if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
      });

    } catch (error: any) {
      const errMsg = error.message || 'Design generation failed';
      addGlobalError(errMsg);
      setCurrentThinkingTime(0);
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      setNeedsScrollPadding(true);
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    }
  };

  // === AGENT SWARM GENERATION ===
  const swarmAbortControllerRef = useRef<AbortController | null>(null);

  const startSwarmGeneration = async (
    text: string,
    history: AiChatMessage[],
    currentAttachments: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[] = [],
    imageAssetPaths: { name: string; path: string; dataUrl: string }[] = []
  ) => {
    // Dynamic import to keep bundle small when not used
    const { SwarmOrchestrator, isSwarmRunning, swarmAgents, appendChatroomMessage, resetSwarmState } = await import('../../lib/agent-swarm');

    resetSwarmState();
    isSwarmRunning.set(true);

    const abortController = new AbortController();
    swarmAbortControllerRef.current = abortController;

    // Clear previously animated content tracking
    animatedContentRef.current.clear();

    // Set up streaming parser BEFORE execute so synthesis tokens stream live
    const messageParser = workbenchStore.createMessageParser();
    workbenchStore.isGenerating.set(true);
    let synthesisResponseText = '';

    try {
      const projectFiles = sandpackStore.files.get();

      const orchestrator = new SwarmOrchestrator({
        apiKeys,
        modelConfig,
        selectedModelId,
        projectFiles: projectFiles as any,
        chatHistory: history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        onAgentStatusChange: (agentId, status, message) => {
          const current = swarmAgents.get()[agentId];
          swarmAgents.setKey(agentId, { ...current, status, statusMessage: message });
        },
        onToken: (agentId, token) => {
          const current = swarmAgents.get()[agentId];
          swarmAgents.setKey(agentId, { ...current, streamingText: current.streamingText + token });
        },
        onChatroomMessage: (message) => {
          appendChatroomMessage(message);
        },
        // Stream Willow's final synthesis live — shows file indicators + streaming text
        onSynthesisToken: (token) => {
          synthesisResponseText += token;
          setCurrentStreamingResponse(synthesisResponseText);
          // Feed to the parser so "Editing <file>" indicators appear in real-time
          messageParser.parse(token);
        },
        onComplete: () => {
          isSwarmRunning.set(false);
        },
        onError: (error) => {
          console.error('[Swarm] Error:', error);
          isSwarmRunning.set(false);
        },
        abortSignal: abortController.signal,
      });

      const result = await orchestrator.execute(text);

      const assistantMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: result.finalResponse,
        thinkingTime: Math.ceil(result.totalDuration / 1000),
        hasCodeChanges: responseHasCodeChanges(result.finalResponse),
        timestamp: Date.now(),
      };

      // Mark as completed so it won't re-animate
      completedMessagesRef.current.add(assistantMessage.id);

      setMessages(prev => [...prev, assistantMessage]);
      setCurrentStreamingResponse('');
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);

      // Process the full response through workbench for preview rendering
      try {
        await workbenchStore.processAIResponse(result.finalResponse);
        console.log('[Swarm] Processed final response with workbenchStore');
      } catch (err) {
        console.error('[Swarm] Error processing response:', err);
      }

      // Flush any pending file edits
      await workbenchStore.flushPendingEdits();

      if (assistantMessage.hasCodeChanges) {
        const snapshot: Record<string, string> = {};
        Object.entries(workbenchStore.files.get()).forEach(([path, file]: [string, any]) => {
          snapshot[path] = file.content;
        });
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id ? { ...msg, filesSnapshot: snapshot } : msg
        ));
        workbenchStore.activeSnapshotId.set(assistantMessage.id);
      }

      workbenchStore.isGenerating.set(false);
      isSwarmRunning.set(false);
    } catch (error: any) {
      console.error('[Swarm] Execution error:', error);
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      setNeedsScrollPadding(true);
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
      isSwarmRunning.set(false);
      // Clear the global generating flag so the preview never sticks on the
      // loading animation after a swarm error/abort.
      workbenchStore.isGenerating.set(false);

      // Add error as assistant message
      const errorMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: `Agent Swarm encountered an error: ${error.message || 'Unknown error'}`,
        hasCodeChanges: false,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
      setCurrentStreamingResponse('');
    }
  };

  // === TEST MODE FUNCTIONS ===
  const startTestGeneration = async (testPrompt: string) => {
    // Clear previously animated content tracking to allow fresh animations
    animatedContentRef.current.clear();

    console.log('Starting Test Mode generation with:', testPrompt);
    const iframe = testStore.getIframeRef();
    if (!iframe) {
      // Add error message - no preview available
      const errorMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        hasCodeChanges: false,
        content: '⚠️ Cannot run test: Preview not available. Please generate some code first, then try testing again.',
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
      return;
    }

    // Create the assistant message immediately with a unique ID
    const messageId = Math.random().toString(36).substring(7);
    
    // Track plan text (shown first, before indicators)
    let planText = '';
    
    // Track whether testing has started (after plan is complete)
    let testingStarted = false;
    
    // Track actions for the indicator (starts empty, populated when testing begins)
    const actionsLog: string[] = [];
    let currentAction = '';
    
    // Helper to build the indicator JSON (only shown after testing starts)
    const buildIndicator = () => {
      if (!testingStarted || actionsLog.length === 0) return '';
      return `<test-indicator>${JSON.stringify({ actions: actionsLog, current: currentAction })}</test-indicator>`;
    };
    
    // Initial message is empty - plan text will be added
    const initialMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: '',  // Will be populated by plan
      timestamp: Date.now(),
      isGenerating: true,  // Mark as generating to hide action buttons
      hasCodeChanges: false
    };
    
    // Smoothly add the assistant message without waiting (states already handled in handleSendMessage)
    setMessages(prev => [...prev, initialMessage]);

    // Start test state
    testStore.enterTestMode();
    testStore.startTest();

    try {
      if (!apiKeys?.gemini?.[0]) {
        throw new Error('Gemini API Key missing. Please add it in Settings -> Models & API.');
      }
      const apiKey = apiKeys.gemini[0];

      testStore.setStatus('testing');
      console.log('[Test] Starting Computer Use agent loop...');
      
      // Run the Computer Use agent loop
      const result = await runComputerUseTest(
        apiKey,
        testPrompt,
        iframe,
        (update: TestUpdate) => {
          console.log('[Test] Update:', update.type, update.message);
          
          // NOTE: Don't stop thinking animation here - keep it running until test is complete
          
          // Update action based on update type
          switch (update.type) {
            case 'plan':
              // Intro text received - show it WITHOUT indicator
              planText = update.message;
              // Keep thinking animation running!
              break;
              
            case 'thinking':
              // Only update indicator if testing has started
              if (testingStarted) {
                if (currentAction !== 'Analysis') {
                  currentAction = 'Analysis';
                  if (actionsLog[actionsLog.length - 1] !== 'Analysis') {
                    actionsLog.push('Analysis');
                  }
                }
              }
              break;
              
            case 'screenshot':
              // Screenshot means testing has started
              if (!testingStarted) {
                testingStarted = true;
                currentAction = 'Analysis';
                actionsLog.push('Analysis');
                
                // Mark all intro text as 'done' to prevent re-animation when indicator appears
                // The DOM structure changes when indicator is added, which could cause React to remount elements
                const introPrefix = `${messageId}-intro-`;
                animatedContentRef.current.forEach((value, key) => {
                  if (key.startsWith(introPrefix) && value !== 'done') {
                    animatedContentRef.current.set(key, 'done');
                  }
                });
              }
              testStore.setStatus('capturing');
              currentAction = 'Capture';
              if (actionsLog[actionsLog.length - 1] !== 'Capture') {
                actionsLog.push('Capture');
              }
              break;
              
            case 'action':
              // If this is the first action, mark intro text as 'done' to prevent re-animation
              if (!testingStarted) {
                const introPrefix = `${messageId}-intro-`;
                animatedContentRef.current.forEach((value, key) => {
                  if (key.startsWith(introPrefix) && value !== 'done') {
                    animatedContentRef.current.set(key, 'done');
                  }
                });
              }
              testingStarted = true;
              testStore.setStatus('executing-action');
              testStore.setCurrentAction(update.actionName || update.message);
              currentAction = update.actionType || 'Action';
              actionsLog.push(currentAction);
              break;
              
            case 'complete':
              testStore.setStatus('complete');
              testStore.setThought(null);
              break;
              
            case 'error':
              currentAction = 'Error';
              actionsLog.push('Error');
              testStore.setThought('Error!');
              break;
              
            case 'text':
              // AI commentary during testing - ignore for now
              break;
          }
          
          // Update message: Plan text + indicator (if testing started)
          const updatedContent = planText + (testingStarted ? '\n\n' + buildIndicator() : '');
          
          setMessages(prev => prev.map(msg =>
            msg.id === messageId
              ? { ...msg, content: updatedContent, thinkingTime: thinkingTimeRef.current, isGenerating: true, hasCodeChanges: false }
              : msg
          ));
        },
        // Pass conversation history for context (exclude the current message being built)
        messages.map(msg => ({ role: msg.role, content: msg.content })) as ConversationMessage[],
        () => testStore.isCancelled.get(),
        testStore.getAbortSignal()
      );

      console.log('[Test] Agent loop complete:', result);

      // Build final message: Intro + Indicator (persists!) + Conclusion
      // Just use the AI's natural explanation (it already states pass/fail)
      
      // Strip emojis from the model's explanation to keep it clean
      const cleanExplanation = (result.explanation || 'Test completed.')
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

      const conclusionText = '\n\n' + cleanExplanation.trim();

      // Set result in store
      testStore.setResult({
        passed: result.passed,
        summary: result.explanation.substring(0, 200) + '...',
        suggestion: result.passed ? undefined : 'Review the test output for details.',
      });

      // Final message: Plan + Indicator (stays visible!) + Conclusion
      const finalContent = planText + '\n\n' + buildIndicator() + conclusionText;
      
      // Update message with isGenerating: false to show action buttons
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, content: finalContent, thinkingTime: thinkingTimeRef.current, isGenerating: false, hasCodeChanges: false }
          : msg
      ));
      
      // Mark test message as completed after conclusion animation finishes
      // This prevents re-animation if user sends new prompts
      setTimeout(() => {
        completedMessagesRef.current.add(messageId);
      }, 2500); // Allow ~2.5s for conclusion animation to complete
      
      setCurrentStreamingResponse('');
      setIsCurrentlyGenerating(false);
      
      // Stop thinking animation now that test is complete
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
      }
      setIsCurrentlyThinking(false);
      
      testStore.setStatus('complete');
      testStore.setCurrentAction(null);
      testStore.exitTestMode();
      
    } catch (error: any) {
      console.error('[Test] Error:', error);
      
      // Check if this was an abort/cancellation
      const wasCancelled = error.name === 'AbortError' || testStore.isCancelled.get();
      
      // Update the message with error state (same pattern as successful completion)
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { 
              ...msg, 
              content: wasCancelled 
                ? '*Test cancelled by user.*' 
                : `❌ Test Error: ${error.message || 'Failed to run test.'}`,
              thinkingTime: thinkingTimeRef.current,
              isGenerating: false,
              hasCodeChanges: false
            }
          : msg
      ));

      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      setNeedsScrollPadding(true);
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
      testStore.setStatus('idle');
      testStore.setCurrentAction(null);
      testStore.exitTestMode(); // Disable test mode on error too
    }
  };


  useEffect(() => {
    return () => {
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    };
  }, []);

  // Scroll logic - useLayoutEffect runs BEFORE browser paint, eliminating flash
  const lastPromptIds = useRef<{ default: string | null; design: string | null }>({ default: null, design: null });
  const isScrollingToTop = useRef(false);


  useEffect(() => {
    if (activeConversationMessages.length === 0) {
      setResponseAreaMinHeight(undefined);
      setNeedsScrollPadding(false);
      lastPromptIds.current[activeConversationMode] = null;
    }
  }, [activeConversationMessages.length, activeConversationMode]);

  React.useLayoutEffect(() => {
    if (chatScrollRef.current) {
        const container = chatScrollRef.current;
        const userMessages = activeConversationMessages.filter(m => m.role === 'user');
        const lastUserMessage = userMessages[userMessages.length - 1];

        if (lastUserMessage && lastUserMessage.id !== lastPromptIds.current[activeConversationMode]) {
            lastPromptIds.current[activeConversationMode] = lastUserMessage.id;
            isScrollingToTop.current = true;

            // CRITICAL: Temporarily force overflow to auto so scroll can work
            container.style.overflow = 'auto';

            // Wait one frame for DOM to fully settle after state changes
            // (streaming div, suggestions collapse, etc.)
            requestAnimationFrame(() => {
                const msgEl = messageRefs.current[lastUserMessage.id];

                if (msgEl && container) {
                    // Capture initial state AFTER DOM has settled
                    const containerRect = container.getBoundingClientRect();
                    const msgRect = msgEl.getBoundingClientRect();
                    const targetVisualOffset = currentTargetVisualOffset;
                    const initialOffset = msgRect.top - containerRect.top;
                    const totalScrollNeeded = initialOffset - targetVisualOffset;

                    // Calculate the FINAL target position first (this never changes)
                    const startScrollTop = container.scrollTop;
                    const targetScrollTop = startScrollTop + totalScrollNeeded;

                    // INSTANT JUMP: Skip 85% of the journey immediately
                    const instantJumpRatio = 0.85;
                    const instantScrollAmount = totalScrollNeeded * instantJumpRatio;
                    container.scrollTop = startScrollTop + instantScrollAmount;

                    // Capture position after jump for animation start
                    const animationStartScrollTop = container.scrollTop;

                    // Calculate remaining distance to the FINAL target
                    const remainingScroll = targetScrollTop - animationStartScrollTop;

                    const startTime = performance.now();
                    const duration = 200; // Shorter since we jump most of the way

                    // Ease-out cubic for smooth deceleration
                    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

                    const animateScroll = (currentTime: number) => {
                        if (!container) return;

                        // Keep overflow auto during scroll
                        container.style.overflow = 'auto';

                        const elapsed = currentTime - startTime;
                        const progress = Math.min(elapsed / duration, 1);
                        const easedProgress = easeOutCubic(progress);

                        // Smoothly interpolate scroll position to FINAL target
                        container.scrollTop = animationStartScrollTop + (remainingScroll * easedProgress);

                        if (progress < 1) {
                            requestAnimationFrame(animateScroll);
                        } else {
                            // Ensure we land exactly on FINAL target
                            container.scrollTop = targetScrollTop;
                            isScrollingToTop.current = false;

                            // Calculate dynamic min-height for response area:
                            // Fill the full remaining visible space below the user message.
                            // This keeps enough scrollable height for the animation to work.
                            // Footer overlap is handled by paddingBottom on the response container.
                            const gap = 48; // space-y-12 between message groups
                            const minH = container.clientHeight - targetVisualOffset - msgEl.offsetHeight - gap;
                            setResponseAreaMinHeight(Math.max(0, minH));
                            setNeedsScrollPadding(false);
                        }
                    };

                    // Start animation immediately (no additional frame delay)
                    animateScroll(startTime);
                }
            });
        }
    }
  }, [activeConversationMessages, activeConversationMode, currentTargetVisualOffset]);

  // Recalculate response area min-height when container resizes
  useEffect(() => {
    if (!chatScrollRef.current) return;
    const container = chatScrollRef.current;

    const observer = new ResizeObserver(() => {
      // Only recalculate if we have a previous value (scroll animation has run)
      if (responseAreaMinHeight === undefined) return;

      const userMessages = activeConversationMessages.filter(m => m.role === 'user');
      const lastUserMsg = userMessages[userMessages.length - 1];
      if (!lastUserMsg) return;

      const msgEl = messageRefs.current[lastUserMsg.id];
      if (!msgEl) return;

      const targetVisualOffset = currentTargetVisualOffset;

      const gap = 48;
      const minH = container.clientHeight - targetVisualOffset - msgEl.offsetHeight - gap;
      setResponseAreaMinHeight(Math.max(0, minH));
    });

    observer.observe(container);
    if (footerRef.current) observer.observe(footerRef.current);
    return () => observer.disconnect();
  }, [activeConversationMessages, currentTargetVisualOffset, responseAreaMinHeight]);

  // Detect when response content overflows the allocated min-height.
  // When it does, re-enable bottom padding so the user can scroll past the input box.
  useEffect(() => {
    if (responseAreaMinHeight === undefined || needsScrollPadding) return;

    const checkOverflow = () => {
      // Check streaming content during generation
      const streamingEl = streamingContentRef.current;
      if (streamingEl && streamingEl.scrollHeight > responseAreaMinHeight + 5) {
        setNeedsScrollPadding(true);
        return;
      }

      // Check last assistant message after generation completes
      const lastMsg = activeConversationMessages[activeConversationMessages.length - 1];
      if (lastMsg?.role === 'assistant') {
        const el = messageRefs.current[lastMsg.id];
        const effectiveMinHeight = Math.max(
          0,
          responseAreaMinHeight - (
            !lastMsg.isGenerating && !lastMsg.designNodeId && !lastMsg.hasCodeChanges
              ? LAST_RESPONSE_PREVIEW_GAP_COMPENSATION
              : 0
          )
        );
        if (el && el.scrollHeight > effectiveMinHeight + 5) {
          setNeedsScrollPadding(true);
        }
      }
    };

    const observer = new ResizeObserver(checkOverflow);

    if (streamingContentRef.current) {
      observer.observe(streamingContentRef.current);
    }

    const lastMsg = activeConversationMessages[activeConversationMessages.length - 1];
    if (lastMsg?.role === 'assistant' && messageRefs.current[lastMsg.id]) {
      observer.observe(messageRefs.current[lastMsg.id]!);
    }

    // Initial check
    checkOverflow();

    return () => observer.disconnect();
  }, [responseAreaMinHeight, needsScrollPadding, activeConversationMessages, isCurrentlyGenerating]);

  // Tabs scroll check (renamed from scrollContainerRef)
  const handleScroll = () => {
    if (tabsScrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabsScrollRef.current;
      setShowLeftGradient(scrollLeft > 5);
      setShowRightGradient(scrollLeft < scrollWidth - clientWidth - 5);
    }
  };

  // Tools Menu State
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const [shouldRenderToolsMenu, setShouldRenderToolsMenu] = useState(false);
  const [isClosingToolsMenu, setIsClosingToolsMenu] = useState(false);
  // selectedToolId is declared at top of component (near line 260)
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  // Models Menu State
  const [isModelsMenuOpen, setIsModelsMenuOpen] = useState(false);
  const [shouldRenderModelsMenu, setShouldRenderModelsMenu] = useState(false);
  const [isClosingModelsMenu, setIsClosingModelsMenu] = useState(false);
  const modelsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isModelsMenuOpen) {
      setShouldRenderModelsMenu(true);
      setIsClosingModelsMenu(false);
    } else if (shouldRenderModelsMenu) {
      setIsClosingModelsMenu(true);
      const timer = setTimeout(() => {
        setShouldRenderModelsMenu(false);
        setIsClosingModelsMenu(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isModelsMenuOpen, shouldRenderModelsMenu]);

  // Sync selection with available models on refresh/load
  useEffect(() => {
    const allSavedModels = [
      ...(modelConfig.gemini?.savedModels || []),
      ...(modelConfig.openai?.savedModels || []),
      ...(modelConfig.anthropic?.savedModels || [])
    ];
    
    if (allSavedModels.length > 0 && !selectedModelId) {
      setSelectedModelId(allSavedModels[0].id);
    }
  }, [modelConfig, selectedModelId, setSelectedModelId]);

  useEffect(() => {
    if (isToolsMenuOpen) {
      setShouldRenderToolsMenu(true);
      setIsClosingToolsMenu(false);
    } else if (shouldRenderToolsMenu) {
      setIsClosingToolsMenu(true);
      const timer = setTimeout(() => {
        setShouldRenderToolsMenu(false);
        setIsClosingToolsMenu(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isToolsMenuOpen, shouldRenderToolsMenu]);

  const TOOLS = [
    { id: 'plan', label: 'Plan', icon: FileText },
    { id: 'image', label: 'Image', icon: ImageIcon },
    { id: 'design', label: 'Design', icon: Palette },
    { id: 'annotate', label: 'Annotate', icon: AnnotateIcon },
    { id: 'prototype', label: 'Visual Edits', icon: VisualEditsIcon },
    { id: 'test', label: 'Test', icon: FlaskConical }
  ];

  const currentTool = selectedToolId ? TOOLS.find(t => t.id === selectedToolId) : null;

  const handleToolSelect = (toolId: string) => {
    console.log('[Sidebar] handleToolSelect called with:', toolId);
    setSelectedToolId(toolId);
    setIsToolsMenuOpen(false);
    // Note: Tools are now independent from tabs - no onTabChange calls
    // Design and Prototype still change tabs since they have dedicated panels
    if (toolId === 'design') onTabChange('design');
    if (toolId === 'prototype') onTabChange('design');
    // Test tool: test mode activates when AI starts analyzing (not on tool select)
    // So we don't call enterTestMode() here
  };

  const handleToolReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    // If test is actively running, cancel it properly
    if (testStore.isTestMode.get()) {
      testStore.cancelTest(); // This sets isCancelled flag and exits test mode
    }
    setSelectedToolId(null);
    // Don't change tabs - tools are independent from tabs
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(event.target as Node)) {
        setIsToolsMenuOpen(false);
      }
    };
    if (isToolsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isToolsMenuOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelsMenuRef.current && !modelsMenuRef.current.contains(event.target as Node)) {
        setIsModelsMenuOpen(false);
      }
    };
    if (isModelsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isModelsMenuOpen]);

  // Display tool for the context header - strictly keeps the last non-preview tool to prevent "Preview" text during close animation
  const headerTool = React.useMemo(() => {
    const tool = ALL_TOOLS.find(t => t.id === activeTab);
    return tool && tool.id !== 'preview' ? tool : null;
  }, [activeTab]);

  // Use a ref to persist the tool info even when headerTool becomes null (during closing)
  const lastHeaderToolRef = useRef(headerTool);
  useEffect(() => {
    if (headerTool) {
      lastHeaderToolRef.current = headerTool;
    }
  }, [headerTool]);

  const showContextHeader = !!headerTool;
  const displayTool = headerTool || lastHeaderToolRef.current;


  const handleTabsScroll = () => {
    if (tabsScrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabsScrollRef.current;
      setShowLeftGradient(scrollLeft > 5);
      setShowRightGradient(scrollLeft < scrollWidth - clientWidth - 5);
    }
  };

  useEffect(() => {
    // Small timeout to allow layout transitions to complete
    const timer = setTimeout(handleTabsScroll, 100);
    handleTabsScroll();
    return () => clearTimeout(timer);
  }, [width, isChatMode]);

  // Cancel pending exit action if modal is closed via cancel
  useEffect(() => {
    if (!showExitModal) {
      setPendingExitAction(null);
    }
  }, [showExitModal]);

  // Auto-expand textarea upwards - throttled with RAF to prevent lag
  const textareaResizeRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (textareaRef.current) {
      // Cancel any pending resize to avoid stacking
      if (textareaResizeRafRef.current) {
        cancelAnimationFrame(textareaResizeRafRef.current);
      }

      // Throttle resize to once per frame
      textareaResizeRafRef.current = requestAnimationFrame(() => {
        if (textareaRef.current) {
          // Batch reads first, then writes (avoid layout thrashing)
          textareaRef.current.style.height = 'auto';
          const scrollHeight = textareaRef.current.scrollHeight;
          const targetHeight = Math.max(44, Math.min(scrollHeight, 270));
          textareaRef.current.style.height = `${targetHeight}px`;
        }
        textareaResizeRafRef.current = null;
      });
    }

    return () => {
      if (textareaResizeRafRef.current) {
        cancelAnimationFrame(textareaResizeRafRef.current);
      }
    };
  }, [promptValue]);

  // Focus textarea on mount to keep keyboard/glowing ring active during swap
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  return (
    <>
      <UnsavedChangesModal 
        isOpen={showExitModal}
        onCancel={() => {
          setShowExitModal(false);
          setPendingExitAction(null);
          // Only revert if we are somehow not in design tab (failsafe)
          if (activeTab !== 'design' && sidebarView === 'visual-edit') {
            onTabChange('design');
          }
        }}
        onConfirm={() => {
          discardVisualChanges();
          setShowExitModal(false);
          setSidebarViewRaw('chat');
          exitVisualEdit();
          if (pendingExitAction) {
            // Execute the stored action (e.g. switch tab or toggle sidebar)
            // Use setTimeout to allow state updates to flush and prevent state clashes
            setTimeout(() => {
               pendingExitAction();
            }, 0);
            setPendingExitAction(null);
          }
        }}
      />
    <div 
      style={{ width: isChatMode ? '100%' : `${width}px` }} 
      className="flex flex-col h-full overflow-hidden relative bg-[#1c1c1c]"
    >
      {/* Design Header - Persistent across Design Tab and Visual Edit Mode */}
      {/* Renders when in Design tab OR within visual edit mode */}
      {(activeTab === 'design' || sidebarView === 'visual-edit') && !isChatMode && (
        <>
          {/* Background layer: sits at z-20, behind the scrolling menu (z-30) */}
          <div className="absolute inset-x-0 top-14 z-20 h-[40px] bg-[#1c1c1c] pointer-events-none">
          </div>

          {/* Content layer: sits at z-40, above the scrolling menu (z-30) to keep header text always on top */}
          <div className="absolute inset-x-0 top-14 z-40 px-6 pt-0 pb-3.5 flex items-center justify-between h-[52px] pointer-events-none">
             {/* Left side: Breadcrumbs */}
             <div className="flex items-center h-[32px] pointer-events-auto overflow-hidden">
                <button 
                  className={`text-base transition-colors duration-300 ${sidebarView === 'visual-edit' ? 'text-[#81888f] hover:text-white cursor-pointer' : 'text-white cursor-default'}`}
                  onClick={() => sidebarView === 'visual-edit' && handleExitVisualEdit()}
                >
                  Edit
                </button>
                
                <div className={`flex items-center transition-all duration-300 ease-out origin-left ${sidebarView === 'visual-edit' ? 'w-[105px] opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-4'}`}>
                   <span className="text-[#81888f] mx-2">/</span>
                   <span className="text-white font-medium whitespace-nowrap">Visual edits</span>
                </div>
             </div>

             {/* Right side: Action Buttons (Only visible in Visual Edit) */}
             <div className={`flex items-center gap-2 pointer-events-auto transition-opacity duration-300 ${sidebarView === 'visual-edit' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                 <button
                   className={`flex items-center gap-2 h-[32px] rounded-lg transition-colors text-[13px] font-medium ${isCompact ? 'w-[32px] justify-center' : 'px-3'} ${
                     canSelectParent
                       ? 'bg-[#27272a] hover:bg-[#3f3f46] text-gray-300 hover:text-white cursor-pointer'
                       : 'bg-[#27272a]/50 text-gray-500 cursor-not-allowed'
                   }`}
                   onClick={selectParentElement}
                   disabled={!canSelectParent}
                 >
                    <CornerLeftUp size={14} className="flex-shrink-0" />
                    {!isCompact && <span>Select parent</span>}
                 </button>
                 <button
                   className={`w-[32px] h-[32px] flex items-center justify-center rounded-lg transition-colors ${
                     hasUndo
                       ? 'bg-[#27272a] hover:bg-[#3f3f46] text-gray-300 hover:text-white cursor-pointer'
                       : 'bg-[#27272a]/50 text-gray-500 cursor-not-allowed'
                   }`}
                   onClick={undoLastVisualEdit}
                   disabled={!hasUndo}
                 >
                    <CornerUpLeft size={16} />
                 </button>
             </div>
          </div>
        </>
      )}

      {/* Agents Header - Persistent across Agents Tab and Agent Builder Mode */}
      {(activeTab === 'agents' || activeTab === 'agent-builder') && !isChatMode && (
        <>
          {/* Background layer: sits at z-20, behind the scrolling menu (z-30) */}
          <div className="absolute inset-x-0 top-14 z-20 h-[40px] bg-[#1c1c1c] pointer-events-none">
          </div>

          {/* Content layer: sits at z-40, above the scrolling menu (z-30) to keep header text always on top */}
          <div className="absolute inset-x-0 top-14 z-40 px-6 pt-0 pb-3.5 flex items-center justify-between h-[52px] pointer-events-none">
             {/* Left side: Breadcrumbs */}
             <div className="flex items-center h-[32px] pointer-events-auto overflow-hidden">
                <button 
                  className={`text-base transition-colors duration-300 ${activeTab === 'agent-builder' ? 'text-[#81888f] hover:text-white cursor-pointer' : 'text-white cursor-default'}`}
                  onClick={() => activeTab === 'agent-builder' && onTabChange('agents')}
                >
                  Agents
                </button>
                
                <div className={`flex items-center transition-all duration-300 ease-out origin-left ${activeTab === 'agent-builder' ? 'w-[105px] opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-4'}`}>
                   <span className="text-[#81888f] mx-2">/</span>
                   <span className="text-white font-medium whitespace-nowrap">Builder</span>
                </div>
             </div>
          </div>
        </>
      )}

      {/* Canvas Header - Persistent across Canvas Tab and its sub-modes */}
      {(activeTab === 'canvas' || activeTab === 'canvas-screens' || activeTab === 'canvas-elements') && !isChatMode && (
        <>
          {/* Background layer: sits at z-20, behind the scrolling menu (z-30) */}
          <div className="absolute inset-x-0 top-14 z-20 h-[40px] bg-[#1c1c1c] pointer-events-none">
          </div>

          {/* Content layer: sits at z-40, above the scrolling menu (z-30) to keep header text always on top */}
          <div className="absolute inset-x-0 top-14 z-40 px-6 pt-0 pb-3.5 flex items-center justify-between h-[52px] pointer-events-none">
             {/* Left side: Breadcrumbs */}
             <div className="flex items-center h-[32px] pointer-events-auto overflow-hidden">
                <button 
                  className={`text-base transition-colors duration-300 ${(activeTab === 'canvas-screens' || activeTab === 'canvas-elements') ? 'text-[#81888f] hover:text-white cursor-pointer' : 'text-white cursor-default'}`}
                  onClick={() => (activeTab === 'canvas-screens' || activeTab === 'canvas-elements') && onTabChange('canvas')}
                >
                  Design
                </button>
                
                <div className={`flex items-center transition-all duration-300 ease-out origin-left ${(activeTab === 'canvas-screens' || activeTab === 'canvas-elements') ? 'w-[105px] opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-4'}`}>
                   <span className="text-[#81888f] mx-2">/</span>
                   <span className="text-white font-medium whitespace-nowrap">
                     {activeTab === 'canvas-screens' ? 'Screens' : 'Elements'}
                   </span>
                </div>
             </div>
          </div>
        </>
      )}

      {/* Header - Hidden in Chat Mode since StagingView renders it at root level */}
      {!isChatMode && (
        <div className={`h-14 flex items-center justify-between z-20 flex-shrink-0 bg-[#1c1c1c]`}>
          <div className="flex items-center min-w-0 h-full" style={{ paddingLeft: '10px' }}>
            {/* Logo Button - Squircle hover background, Dashboard link */}
            <button 
              onClick={() => onHomeClick ? onHomeClick() : navigate('/')}
              className="flex items-center justify-center p-1.5 hover:bg-white/5 transition-colors rounded-xl flex-shrink-0"
              title="Back to Dashboard"
            >
              <img src={logoG} alt="Logo" className="h-[24px] w-auto flex-shrink-0" />
            </button>
            
            <div className="flex-shrink-0" style={{ width: '1px' }} />
            
            {/* Project Title and Toggle - Separate squircle hover */}
            <div
              className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-2 py-1.5 rounded-xl transition-colors min-w-0"
              title="Project Settings"
            >
              {isGeneratingName ? (
                <MessageLoading className="scale-75" />
              ) : (
                <span className="font-semibold text-gray-200 truncate">{projectName || 'New Project'}</span>
              )}
              <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />
            </div>
          </div>
          <div className="flex items-center gap-3 text-gray-400 flex-shrink-0" style={{ paddingRight: '16px' }}>
            <div className="flex items-center gap-1">
              <button onClick={handleNewChat} className="p-1.5 hover:text-white transition-colors" title="New Chat">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <div className="relative flex items-center">
                <button 
                  ref={triggerRef}
                  onClick={() => setIsHistoryOpen(!isHistoryOpen)} 
                  className={`p-1.5 transition-colors relative flex items-center justify-center rounded-lg ${isHistoryOpen ? 'text-white bg-white/10' : 'hover:text-white'}`}
                  title="Chat History"
                >
                  <Clock size={16} />
                </button>
                {shouldRenderHistory && createPortal(
                  <div 
                    id="history-popover-portal"
                    style={{
                      position: 'fixed',
                      top: `${popoverPosition.top + 8}px`,
                      left: `${popoverPosition.left}px`,
                      boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 40px -10px rgba(0, 0, 0, 0.8), 0 1px 0 0 rgba(255, 255, 255, 0.05) inset',
                    }}
                    className={`w-72 max-h-[400px] z-[1000] bg-[#1c1c1c] rounded-xl p-2 flex flex-col gap-1 ${isClosingHistory ? 'settings-fade-out' : 'settings-fade-in'}`}
                  >
                    <div className="px-3 py-2 flex items-center justify-between text-zinc-400">
                      <span className="text-[11px] font-semibold tracking-wider uppercase">History</span>
                      <span className="text-[10px] bg-[#27272a] px-1.5 py-0.5 rounded-full text-zinc-300 font-medium">{sessions.length} sessions</span>
                    </div>
                    <div className="flex flex-col gap-0.5 max-h-[300px] overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                      {sessions.length === 0 ? (
                        <div className="p-4 text-center text-xs text-zinc-500 italic">
                          No history sessions
                        </div>
                      ) : (
                        [...sessions]
                          .sort((a, b) => b.updatedAt - a.updatedAt)
                          .map((session) => (
                            <div 
                              key={session.id}
                              onClick={() => handleSwitchSession(session.id)}
                              className={`group relative flex items-center justify-between p-2.5 rounded-lg transition-all duration-200 cursor-pointer select-none
                                ${session.id === currentSessionId 
                                  ? 'bg-[#27272a] text-white' 
                                  : 'hover:bg-[#27272a]/55 text-zinc-400 hover:text-white'
                                }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                                <div className="w-3 flex items-center justify-center shrink-0 transition-all duration-300">
                                  {session.id === currentSessionId ? (
                                    <span className="text-[#2563eb] font-bold text-[14px] select-none leading-none">›</span>
                                  ) : (
                                    <div className="w-3 shrink-0" />
                                  )}
                                </div>
                                <div className="flex flex-col min-w-0">
                                  {namingSessionIds.has(session.id) ? (
                                    <div className="flex flex-col gap-1 w-28 py-0.5">
                                      <div className="h-3 bg-white/10 rounded animate-pulse w-full" />
                                      <div className="h-2 bg-white/5 rounded animate-pulse w-2/3" />
                                    </div>
                                  ) : (
                                    <span className="text-[13px] font-medium truncate">
                                      {session.name || 'New Chat'}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-zinc-500 mt-0.5">
                                    {formatRelativeTime(session.updatedAt)}
                                  </span>
                                </div>
                              </div>
                              <button
                                onClick={(e) => handleDeleteSession(session.id, e)}
                                className="p-1 text-zinc-500 hover:text-red-400 rounded-lg hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all duration-200 shrink-0"
                                title="Delete Session"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 6h18"></path>
                                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                </svg>
                              </button>
                            </div>
                          ))
                      )}
                    </div>
                  </div>,
                  document.body
                )}
              </div>
              <button onClick={() => sidebarView === 'visual-edit' ? handleExitVisualEdit(onToggle) : onToggle()} className="p-1.5 hover:text-white transition-colors"><PanelLeftClose size={16} /></button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={chatScrollRef}
        className={`flex-1 space-y-8 min-h-0 hover-scrollbar overflow-y-auto
          ${responseAreaMinHeight !== undefined && !needsScrollPadding
            ? 'pb-0'
            : (showContextHeader ? 'pb-[290px]' : 'pb-[210px]')
          }
          ${isChatMode
            ? 'pl-0 pr-0 pt-[76px] scroll-pt-[76px]' // Scrollbar at far right in Chat Mode
            : (activeTab === 'design' || activeTab === 'agents' || activeTab === 'canvas')
              ? 'pl-[8px] pr-[2px] mr-[8.5px] pt-0 scroll-pt-0' // Zero padding-top to align header perfectly with absolute overlays
              : (activeTab === 'agent-builder' || sidebarView === 'visual-edit' || activeTab === 'canvas-screens' || activeTab === 'canvas-elements')
                ? 'pl-[27px] pr-[18.5px] mr-[8.5px] pt-[56px] scroll-pt-[56px]' // Standard chat padding, 56px pt to clear 40px header + 16px gap
                : 'pl-[27px] pr-[18.5px] mr-[8.5px] pt-5 scroll-pt-5'
          }`}
        style={{
          // During resize or when not generating: let browser maintain scroll position (auto)
          // During active scroll animation or when generating: disable anchoring (none)
          overflowAnchor: (isResizing || !isCurrentlyGenerating) ? 'auto' : 'none'
        }}
      >
        <div className={isChatMode ? 'max-w-[800px] mx-auto px-[27px] pr-[40px]' : ''}>
          {activeTab === 'design' && !isChatMode ? (
            <div className="space-y-4">
               {/* Spacer to maintain vertical position of cards precisely matching Visual Edits header height */}
               <div className="h-[40px]" />

               {/* Visual Edits Card */}
                <div
                  onClick={() => {
                    enterVisualEdit();
                    setSidebarView('visual-edit');
                    // onTabChange('preview'); // Keep preview switch to ensure elements are visible
                  }}
                  className="group bg-[#27272a] rounded-2xl p-[18px] cursor-pointer hover:ring-1 hover:ring-white/20 transition-shadow duration-200"
                >
                  <div className="flex flex-col gap-[14px]">
                     <div className="text-white">
                        <VisualEditsIcon size={20} />
                     </div>
                     <div className="flex items-end justify-between">
                        <div>
                           <div className="text-[16px] font-semibold text-white mb-1">Visual edits</div>
                           <div className="text-[14px] text-gray-400 font-medium">Select elements to edit and style visually</div>
                        </div>
                        <ChevronRight size={20} className="text-gray-500 group-hover:text-white transition-colors translate-y-[1px]" />
                     </div>
                  </div>
               </div>

               {/* Themes Card */}
               <div className="group bg-[#27272a] rounded-2xl p-[18px] cursor-pointer hover:ring-1 hover:ring-white/20 transition-shadow duration-200">
                  <div className="flex flex-col gap-[14px]">
                     <div className="text-white">
                        <Palette size={20} strokeWidth={1.5} />
                     </div>
                     <div className="flex items-end justify-between">
                        <div>
                           <div className="text-[16px] font-semibold text-white mb-1">Themes</div>
                           <div className="text-[14px] text-gray-400 font-medium">Browse and apply themes to your project</div>
                        </div>
                        <ChevronRight size={20} className="text-gray-500 group-hover:text-white transition-colors translate-y-[1px]" />
                     </div>
                  </div>
               </div>
            </div>
          ) : activeTab === 'agents' && !isChatMode ? (
            <div className="space-y-4">
               {/* Spacer to maintain vertical position of cards precisely matching Visual Edits header height */}
               <div className="h-[40px]" />

               {/* Builder Card */}
               <div
                 onClick={() => onTabChange('agent-builder')}
                 className="group bg-[#27272a] rounded-2xl p-[18px] cursor-pointer hover:ring-1 hover:ring-white/20 transition-shadow duration-200"
               >
                  <div className="flex flex-col gap-[14px]">
                     <div className="text-white flex items-center justify-between">
                        <AgentIcon size={20} />
                        <button
                          onClick={(e) => { e.stopPropagation(); requestedWorkflowId.set('__new__'); onTabChange('agent-builder'); }}
                          className="text-[12px] font-medium text-gray-400 hover:text-white transition-colors flex items-center gap-1"
                          title="Create a new workflow"
                        >
                          <Plus size={14} /> New
                        </button>
                     </div>
                     <div className="flex items-end justify-between">
                        <div>
                           <div className="text-[16px] font-semibold text-white mb-1">Builder</div>
                           <div className="text-[14px] text-gray-400 font-medium">Create and manage your AI Agents</div>
                        </div>
                        <ChevronRight size={20} className="text-gray-500 group-hover:text-white transition-colors translate-y-[1px]" />
                     </div>
                  </div>
               </div>

               {/* Library Card */}
               <div
                 onClick={() => setShowAgentLibrary((v) => !v)}
                 className="group bg-[#27272a] rounded-2xl p-[18px] cursor-pointer hover:ring-1 hover:ring-white/20 transition-shadow duration-200">
                  <div className="flex flex-col gap-[14px]">
                     <div className="text-white flex items-center justify-between">
                        <Library size={20} strokeWidth={1.5} />
                        <span className={`w-2 h-2 rounded-full ${abStatus === 'up' ? 'bg-green-400' : abStatus === 'down' ? 'bg-red-400' : 'bg-yellow-400'}`} title={`Backend ${abStatus}`} />
                     </div>
                     <div className="flex items-end justify-between">
                        <div>
                           <div className="text-[16px] font-semibold text-white mb-1">Library</div>
                           <div className="text-[14px] text-gray-400 font-medium">
                             {abStatus === 'down' ? 'Backend offline — start it to load agents' : `${abWorkflows.length} saved workflow${abWorkflows.length === 1 ? '' : 's'}`}
                           </div>
                        </div>
                        <ChevronRight size={20} className={`text-gray-500 group-hover:text-white transition-transform translate-y-[1px] ${showAgentLibrary ? 'rotate-90' : ''}`} />
                     </div>
                  </div>
               </div>

               {/* Saved workflows list */}
               {showAgentLibrary && (
                 <div className="flex flex-col gap-2 pl-1">
                   {abWorkflows.length === 0 && (
                     <div className="text-[13px] text-gray-500 px-2 py-1">
                       {abStatus === 'up' ? 'No saved workflows yet. Open the Builder to create one.' : 'Start the Agent Builder backend to see your workflows.'}
                     </div>
                   )}
                   {abWorkflows.map((w) => (
                     <div
                       key={w.id}
                       onClick={() => { requestedWorkflowId.set(w.id); onTabChange('agent-builder'); }}
                       className="group flex items-center justify-between bg-[#232326] hover:bg-[#2c2c30] rounded-xl px-3.5 py-2.5 cursor-pointer transition-colors"
                     >
                       <div className="min-w-0">
                         <div className="text-[14px] font-medium text-white truncate">{w.name}</div>
                         <div className="text-[12px] text-gray-500">{w.nodeCount} nodes · {w.latestVersion > 0 ? `v${w.latestVersion}` : 'draft'}</div>
                       </div>
                       <ChevronRight size={16} className="text-gray-600 group-hover:text-white transition-colors shrink-0" />
                     </div>
                   ))}
                 </div>
               )}
            </div>
          ) : activeTab === 'canvas' && !isChatMode ? (
            <div className="space-y-4">
               {/* Spacer to maintain vertical position of cards precisely matching Visual Edits header height */}
               <div className="h-[40px]" />

               {/* Screens Card */}
               <div 
                 onClick={() => onTabChange('canvas-screens')}
                 className="group bg-[#27272a] rounded-2xl p-[18px] cursor-pointer hover:ring-1 hover:ring-white/20 transition-shadow duration-200"
               >
                  <div className="flex flex-col gap-[14px]">
                     <div className="text-white">
                        <Layout size={20} strokeWidth={1.5} />
                     </div>
                     <div className="flex items-end justify-between">
                        <div>
                           <div className="text-[16px] font-semibold text-white mb-1">Screens</div>
                           <div className="text-[14px] text-gray-400 font-medium">View and manage all your app screens</div>
                        </div>
                        <ChevronRight size={20} className="text-gray-500 group-hover:text-white transition-colors translate-y-[1px]" />
                     </div>
                  </div>
               </div>

               {/* Elements Card */}
               <div 
                 onClick={() => onTabChange('canvas-elements')}
                 className="group bg-[#27272a] rounded-2xl p-[18px] cursor-pointer hover:ring-1 hover:ring-white/20 transition-shadow duration-200"
               >
                  <div className="flex flex-col gap-[14px]">
                     <div className="text-white">
                        <Component size={20} strokeWidth={1.5} />
                     </div>
                     <div className="flex items-end justify-between">
                        <div>
                           <div className="text-[16px] font-semibold text-white mb-1">Elements</div>
                           <div className="text-[14px] text-gray-400 font-medium">View and manage all your app elements</div>
                        </div>
                        <ChevronRight size={20} className="text-gray-500 group-hover:text-white transition-colors translate-y-[1px]" />
                     </div>
                  </div>
               </div>
            </div>
           ) : (
          <div className="space-y-12">
            {activeConversationMessages.length === 0 && !prompt && (
              <div className="flex flex-col items-center justify-center text-center mt-12 mb-8">
                <div className="text-[#3f3f46] mb-6">
                  <GeminiLogo size={48} />
                </div>
                <h2 className="text-[19px] font-semibold text-gray-200 mb-10 text-center leading-snug">
                  What do you want to<br />build
                </h2>
                
                {suggestions && suggestions.length > 0 && (
                  <div className="flex flex-col items-center gap-4 w-full mx-auto">
                    {suggestions.slice(0, 3).map((promptText, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          if (isCurrentlyGenerating || !promptText) return;
                          handleSendMessage(promptText);
                        }}
                        className="text-center bg-[#27272a] hover:bg-[#3f3f46] px-5 py-2.5 rounded-full transition-all duration-200 group max-w-[90%]"
                      >
                        <div className="text-[14px] text-gray-300 font-medium leading-relaxed group-hover:text-white transition-colors">
                          {promptText}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {activeConversationMessages.map((msg, msgIndex) => {
              // Check if this is the last assistant message (needs min-height to prevent snap)
              const isLastAssistantMessage = msg.role === 'assistant' &&
                msgIndex === activeConversationMessages.length - 1;
              const lastAssistantMinHeight = isLastAssistantMessage && responseAreaMinHeight !== undefined
                ? Math.max(
                    0,
                    responseAreaMinHeight - (
                      !msg.isGenerating && !msg.designNodeId && !msg.hasCodeChanges
                        ? LAST_RESPONSE_PREVIEW_GAP_COMPENSATION
                        : 0
                    )
                  )
                : undefined;

              return (
              <div
                key={msg.id}
                ref={el => { messageRefs.current[msg.id] = el; }}
                className="space-y-8"
              >
                {msg.role === 'user' ? (
                  <div className="flex justify-end -mr-[6px]">
                    <div className="flex flex-col items-end gap-2 max-w-[78%]">
                        {/* Attachments */}
                        {msg.attachments && msg.attachments.length > 0 && (
                            <div className="flex gap-2 flex-wrap justify-end">
                                {msg.attachments.map((att, idx) => (
                                    <div key={idx} className="shrink-0">
                                        {att.type === 'image' ? (
                                            <div className="w-16 h-16 rounded-xl overflow-hidden border border-white/10 bg-[#1c1c1c]">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img 
                                                    src={`data:${att.mimeType};base64,${att.data}`} 
                                                    alt="Attachment" 
                                                    className="w-full h-full object-cover"
                                                />
                                            </div>
                                        ) : (
                                            <div className="h-[58px] bg-[#1c1c1c] rounded-xl flex items-center px-4 gap-3.5 border border-white/5 min-w-[180px]">
                                                <div className="text-gray-400 flex-shrink-0">
                                                    <Globe size={20} strokeWidth={1.5} />
                                                </div>
                                                <div className="flex flex-col justify-center min-w-0 h-full">
                                                    <span className="text-[13px] font-semibold text-gray-200 truncate max-w-[140px] leading-none mb-1">
                                                        {att.name || 'File'}
                                                    </span>
                                                    <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide leading-none">
                                                        {(att.name?.split('.').pop() || att.mimeType.split('/').pop() || 'FILE')}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="bg-[#27272a] text-gray-200 px-4 py-3 rounded-2xl text-[15px] leading-relaxed shadow-sm">
                           {msg.content}
                        </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className="space-y-4"
                    style={{
                      // Dynamic min-height fills the full remaining visible space for scroll.
                      // paddingBottom pushes content above the footer overlay so buttons stay visible.
                      // When needsScrollPadding is true (long response), pb on the scroll container handles it instead.
                      minHeight: lastAssistantMinHeight !== undefined
                        ? `${lastAssistantMinHeight}px`
                        : undefined,
                      paddingBottom: isLastAssistantMessage && responseAreaMinHeight !== undefined && !needsScrollPadding
                        ? `${footerRef.current?.offsetHeight || 210}px`
                        : undefined
                    }}
                  >
                    {/* Thinking indicator - show shimmer while generating, static when done */}
                    {msg.isGenerating ? (
                      <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                        <Lightbulb size={18} />
                        <TextShimmer className="text-[15.15px] font-medium" duration={1.5}>
                          Thinking
                        </TextShimmer>
                      </div>
                    ) : msg.thinkingTime !== undefined ? (
                      <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                        <Lightbulb size={18} />
                        <span className="text-[15.15px] font-medium">
                          Thought for {Math.round(msg.thinkingTime)}s
                        </span>
                      </div>
                    ) : null}

                    <div className="text-gray-300 text-[15px] leading-[1.65]">
                      {renderFormattedContent(msg.content, msg.isGenerating, msg.id)}
                    </div>

                    {/* Design Indicator - clickable design card for design mode messages */}
                    {msg.designNodeId && !msg.isGenerating && (
                      <div className="pt-3">
                        <button
                          onClick={() => focusDesignNode(msg.designNodeId!)}
                          className="group flex items-center gap-3 w-full px-4 py-3 rounded-2xl bg-gradient-to-r from-[#1e1e2e] to-[#252535] border border-white/[0.08] hover:border-white/20 transition-all duration-200 text-left"
                        >
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center shrink-0">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-blue-400">
                              <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.5"/>
                              <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium text-gray-200 group-hover:text-white transition-colors truncate">View Design</div>
                            <div className="text-[11px] text-gray-500">Click to highlight on canvas</div>
                          </div>
                          <ChevronRight size={16} className="text-gray-500 group-hover:text-gray-300 transition-colors shrink-0" />
                        </button>
                      </div>
                    )}

                    {/* Snapshot Action Buttons - Only show when message is fully generated and has a snapshot AND is not the current active state */}
                    <div className={`grid transition-[grid-template-rows,margin] duration-300 ease-in-out ${!msg.isGenerating && !msg.designNodeId && msg.hasCodeChanges && msg.filesSnapshot && activeSnapshotId !== msg.id ? 'grid-rows-[1fr] mt-2 mb-2' : 'grid-rows-[0fr] mt-0 mb-0'}`}>
                      <div className="overflow-hidden">
                        <div className={`w-[95%] max-w-[420px] mx-auto px-5 py-2.5 bg-[#27272a] rounded-[12px] flex justify-center items-center gap-5 flex-wrap transition-[opacity,transform] duration-300 ease-in-out ${!msg.isGenerating && !msg.designNodeId && msg.hasCodeChanges && msg.filesSnapshot && activeSnapshotId !== msg.id ? 'opacity-100 translate-y-0 shadow-lg' : 'opacity-0 -translate-y-4 shadow-none'}`}>
                          <button 
                            onClick={() => {
                              if (msg.filesSnapshot) {
                                workbenchStore.restoreFromSnapshot(msg.id, msg.filesSnapshot);
                              }
                            }}
                            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-black/25 text-[13px] font-medium select-none group transition-all duration-200 flex-1 max-w-[160px] min-w-0 text-gray-200 hover:text-white hover:bg-black/40"
                          >
                            {width >= 330 && (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-gray-400 group-hover:text-white transition-colors shrink-0">
                                <path d="M3 10H13C17.4183 10 21 13.5817 21 18V20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M8 15L3 10L8 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                            Revert
                          </button>

                          <button 
                            disabled={previewSnapshot === msg.filesSnapshot}
                            onClick={() => {
                              if (msg.filesSnapshot) {
                                workbenchStore.setPreviewSnapshot(msg.filesSnapshot);
                              }
                            }}
                            className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium select-none group transition-all duration-200 flex-1 max-w-[160px] min-w-0 ${previewSnapshot === msg.filesSnapshot ? 'bg-black/10 text-gray-500 cursor-default' : 'bg-black/25 text-gray-200 hover:text-white hover:bg-black/40'}`}
                          >
                            {width >= 330 && (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={`${previewSnapshot === msg.filesSnapshot ? 'text-gray-500' : 'text-gray-400 group-hover:text-white transition-colors'} shrink-0`}>
                                <rect x="5.5" y="5.5" width="13" height="13" rx="4" transform="rotate(45 12 12)" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M10.5 9.5L14.5 12L10.5 14.5V9.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                            Preview
                          </button>
                        </div>
                      </div>
                    </div>


                    {/* Fallback for older messages that have code changes but no snapshot yet */}
                    {!msg.isGenerating && !msg.designNodeId && msg.hasCodeChanges && !msg.filesSnapshot && (
                      <div className="pt-2 pb-1 flex justify-center">
                        <button 
                          disabled
                          className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/10 text-gray-500 cursor-not-allowed text-[13px] font-medium select-none opacity-60"
                          title="This message was generated before Time Travel was enabled."
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-gray-500">
                            <rect x="5.5" y="5.5" width="13" height="13" rx="4" transform="rotate(45 12 12)" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M10.5 9.5L14.5 12L10.5 14.5V9.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          Preview
                        </button>
                      </div>
                    )}

                    {/* Action buttons - only show when message is fully generated */}
                    {!msg.isGenerating && (
                      <div className="flex items-center gap-3 pt-4 border-t border-white/5 flex-wrap shrink-0">
                        <div className="flex items-center gap-1 shrink-0">
                          <button 
                            onClick={() => setMessageReactions(prev => ({ ...prev, [msg.id]: prev[msg.id] === 'like' ? null : 'like' }))}
                            className={`p-1.5 transition-colors flex-shrink-0 ${messageReactions[msg.id] === 'like' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                          >
                            <ThumbsUp size={14} fill={messageReactions[msg.id] === 'like' ? 'currentColor' : 'none'} />
                          </button>
                          <button 
                            onClick={() => setMessageReactions(prev => ({ ...prev, [msg.id]: prev[msg.id] === 'dislike' ? null : 'dislike' }))}
                            className={`p-1.5 transition-colors flex-shrink-0 ${messageReactions[msg.id] === 'dislike' ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                          >
                            <ThumbsDown size={14} fill={messageReactions[msg.id] === 'dislike' ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                        <button 
                          onClick={() => navigator.clipboard.writeText(stripCodeAndIndicators(msg.content))}
                          className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
            })}

            {/* Agent Swarm Status Panel */}
            <SwarmStatusPanel />

            {/* Current Streaming / Thinking UI - Only for NORMAL messages (not test mode) */}
            {isCurrentlyGenerating && !testStore.isTestMode.get() && (
              <div
                ref={streamingContentRef}
                className="space-y-4"
                style={{
                  // Dynamic min-height fills the full remaining visible space for scroll.
                  // paddingBottom pushes content above the footer overlay.
                  minHeight: responseAreaMinHeight !== undefined
                    ? `${responseAreaMinHeight}px`
                    : undefined,
                  paddingBottom: responseAreaMinHeight !== undefined && !needsScrollPadding
                    ? `${footerRef.current?.offsetHeight || 210}px`
                    : undefined
                }}
              >
                <div className="flex items-center gap-2.5" style={{ color: '#81888f' }}>
                  <Lightbulb size={18} />
                  {isCurrentlyThinking ? (
                    <TextShimmer className="text-[15.15px] font-medium" duration={1.5}>
                      Thinking
                    </TextShimmer>
                  ) : (
                    <span className="text-[15.15px] font-medium">
                      Thought for {Math.round(currentThinkingTime)}s
                    </span>
                  )}
                </div>

                {(activeConversationMode === 'design' ? designStreamingResponse : currentStreamingResponse) && (
                  <div className="text-gray-300 text-[15px] leading-[1.65]">
                    {renderFormattedContent(activeConversationMode === 'design' ? designStreamingResponse : currentStreamingResponse, true, 'streaming')}
                  </div>
                )}
              </div>
            )}
          </div>
          )}
        </div>
    </div>

      {/* Visual Edit Menu Overlay */}
      {sidebarView === 'visual-edit' && (
        <VisualEditMenu 
          isCompact={isCompact}
          onBack={() => {
            handleExitVisualEdit();
          }} 
        />
      )}

      {/* Footer Container */}
      <div ref={footerRef} className="absolute bottom-0 left-0 w-full z-30 pointer-events-none">
        {/* Gradient overlay - fades out when unsaved changes bar is visible */}
        <div className={`h-8 w-full bg-gradient-to-t from-[#1c1c1c] to-transparent transition-opacity duration-300 ${hasUnsaved ? 'opacity-0' : 'opacity-100'}`} />
        <div className="bg-[#1c1c1c] pointer-events-auto">
          {/* Unsaved Changes Bar - Only show in visual edit mode */}
          {/* Unsaved Changes Bar - Only show in visual edit mode */}
          {sidebarView === 'visual-edit' && (
            <>
              {/* Queue Bar - Stacked above Unsaved Changes */}
              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${editQueue.length > 0 ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                style={{ willChange: 'grid-template-rows' }}
              >
                <div className="overflow-hidden">
                  <div
                    className={`transition-opacity duration-300 ease-in-out ${editQueue.length > 0 ? 'opacity-100' : 'opacity-0'}`}
                    style={{ willChange: 'opacity' }}
                  >
                   <div className="px-2"> 
                    <div className="flex items-center justify-between px-4 bg-[#27272a] border border-white/5 rounded-full shadow-lg h-[46px]">
                      <div className="flex items-center gap-2.5 text-[13px] font-medium text-white">
                        <span>
                          {editQueue.length} {editQueue.length === 1 ? 'Prompt' : 'Prompts'} in queue
                        </span>
                      </div>
                    </div>
                   </div>
                  </div>
                </div>
              </div>
              
              <UnsavedChangesBar />
            </>
          )}

          {/* Grid collapses unless the preview tab is active */}
          {/* Uses deferredActiveTab to stagger animation and avoid layout thrashing */}
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${messages.length > 0 && activeTab === 'preview' && suggestionsVisible && !isCurrentlyGenerating ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            style={{ willChange: 'grid-template-rows' }}
          >
            <div className="overflow-hidden">
              <div
                className={`relative transition-opacity duration-300 ease-in-out ${messages.length > 0 && activeTab === 'preview' && suggestionsVisible && !isCurrentlyGenerating ? 'opacity-100' : 'opacity-0'}`}
                style={{ willChange: 'opacity' }}
              >
                <div
                  ref={tabsScrollRef}
                  onScroll={handleTabsScroll}
                  className="flex gap-2 overflow-x-auto no-scrollbar px-[14px] scroll-smooth"
                >
                   {suggestions.length > 0 ? (
                     suggestions.map((text, i) => (
                       <button
                         key={i}
                         onClick={() => handleSendMessage(text)}
                         className="whitespace-nowrap px-4 py-2 rounded-xl bg-[#27272a] text-sm text-gray-200 hover:bg-[#3f3f46] transition-colors font-medium"
                       >
                         {text}
                       </button>
                     ))
                   ) : (
                     // Show placeholder buttons while no suggestions (maintains layout)
                     Array.from({ length: 5 }).map((_, i) => (
                       <div key={i} className="whitespace-nowrap px-4 py-2 rounded-xl bg-[#27272a] text-sm text-transparent font-medium select-none">
                         Loading...
                       </div>
                     ))
                   )}
                </div>
                <div className={`absolute top-0 right-0 w-12 h-full bg-gradient-to-l from-[#1c1c1c] to-transparent pointer-events-none transition-opacity duration-200 ${showRightGradient ? 'opacity-100' : 'opacity-0'}`} />
                <div className={`absolute top-0 left-0 w-12 h-full bg-gradient-to-r from-[#1c1c1c] to-transparent pointer-events-none transition-opacity duration-200 ${showLeftGradient ? 'opacity-100' : 'opacity-0'}`} />
              </div>
            </div>
          </div>

          <div className="px-[14px] pb-4 pt-4">

            <div className="bg-[#27272a] rounded-[26px] p-3.5 relative flex flex-col shadow-lg border border-white/5">
               <div
                 className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${showContextHeader ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                 style={{ willChange: 'grid-template-rows' }}
               >
                 <div className="overflow-hidden">
                    <div className={`flex flex-col gap-3 pb-2 transition-opacity duration-300 ${showContextHeader ? 'opacity-100' : 'opacity-0'}`}>
                     {displayTool && (
                       <>
                          <button
                            onClick={() => {
                               // Intercept if in visual edit mode with unsaved changes
                               if (sidebarView === 'visual-edit') {
                                 handleExitVisualEdit(() => {
                                   if (testStore.isTestMode.get()) {
                                     testStore.cancelTest();
                                   }
                                   onTabChange('preview');
                                   setSelectedToolId(null);
                                 });
                                 return;
                               }
                               // Normal path (not in visual edit)
                               exitVisualEdit();
                               if (testStore.isTestMode.get()) {
                                 testStore.cancelTest();
                               }
                               setSidebarView('chat');
                               onTabChange('preview');
                               setSelectedToolId(null);
                             }}
                           className="flex items-center gap-2 text-[#a1a1aa] hover:text-white transition-colors text-sm font-medium self-start ml-1"
                         >
                           <ArrowLeft size={14} />
                           <span>Back to Chat</span>
                         </button>
                         
                         <div className="flex items-center gap-2 bg-[#3f3f46]/50 rounded-xl px-4 h-[44px] py-0 text-white flex-shrink-0 overflow-x-auto no-scrollbar max-w-full">
                             <div className="flex-shrink-0"><displayTool.icon size={18} /></div>
                             <span className="font-medium whitespace-nowrap flex-shrink-0">{displayTool.label}</span>
                             
                             {/* Visual Editor Element Indicator */}
                             {/* Visual Editor Element Indicator (Multi-selection support) */}
                             {sidebarView === 'visual-edit' && selectedEls.length > 0 && (
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                   {(() => {
                                      // Group elements by selection transaction (GroupId)
                                      // This ensures that a single click (selecting a stack) gets ONE pill,
                                      // but separate Ctrl+Clicks get separate pills even if same tag.
                                      const groups = selectedEls.reduce((acc, el, index) => {
                                        // Use selectionGroupId if available, otherwise fallback to unique index to separate
                                        const key = el.selectionGroupId || `legacy-${index}`;
                                        if (!acc[key]) {
                                          acc[key] = [];
                                        }
                                        acc[key].push(el);
                                        return acc;
                                      }, {} as Record<string, SelectedElement[]>);

                                      return Object.entries(groups).map(([key, groupEls]) => {
                                         // Use the tag name of the first element in the group
                                         const primaryEl = groupEls[0];
                                         const label = primaryEl.tagName.toLowerCase();
                                         
                                         return (
                                            <div 
                                              key={key} 
                                              onClick={(e) => {
                                                  e.stopPropagation(); // Prevent bubbling just in case
                                                  // Open the code for this family (using the primary element)
                                                  const el = groupEls[0];
                                                  if (el.sourceLocation) {
                                                      navigateToCode(
                                                          el.sourceLocation.fileName,
                                                          el.sourceLocation.line,
                                                          el.sourceLocation.column
                                                      );
                                                  } else if (el.componentFile) {
                                                      // Fallback to component file if specific location missing
                                                      navigateToCode(
                                                          el.componentFile.filePath,
                                                          1 // Default to top of file
                                                      );
                                                  }
                                              }}
                                              title="Click to open code, Hover icon to remove"
                                              className="group flex items-center justify-center gap-1.5 px-2 h-[21px] bg-[#1e40af] hover:bg-[#1e3a8a] cursor-pointer text-white rounded-full text-[11px] font-medium font-mono leading-none select-none flex-shrink-0 animate-in fade-in zoom-in-95 duration-200 transition-colors"
                                            >
                                              <div className="group-hover:hidden">
                                                <Scan size={12} className="stroke-dashed opacity-90 text-white" />
                                              </div>
                                              <div 
                                                className="hidden group-hover:block hover:bg-white/20 rounded-full"
                                                onClick={(e) => {
                                                  e.stopPropagation(); // Don't trigger navigation
                                                  const newSelection = selectedEls.filter(el => !groupEls.includes(el));
                                                  setSelectedElements(newSelection);
                                                }}
                                              >
                                                <X size={12} className="text-white" />
                                              </div>
                                              <span className="translate-y-[0.5px]">
                                                 {label}
                                              </span>
                                            </div>
                                         );
                                      });
                                   })()}
                                </div>
                             )}
                           </div>
                       </>
                     )}
                   </div>
                 </div>
               </div>

               {/* Attachments Area (includes screen selections + file/image attachments in one row) */}
               <div className={`grid transition-[grid-template-rows] duration-[250ms] ease-in-out ${hasVisibleAttachments ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                 <div className="overflow-hidden">
                   <div className={`flex gap-3 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1 transition-[padding] duration-[250ms] ease-in-out ${showContextHeader ? 'pt-2' : 'pt-2'}`}>
                     {/* Screen attachments from canvas selection */}
                     {activeTab === 'canvas-screens' && displayedScreens.map((screen) => (
                       <div key={`screen-${screen.id}`} className={`relative group flex-shrink-0 transition-[opacity,transform] duration-200 ${fadingOutScreenIds.has(screen.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100'}`}>
                         <div className="relative">
                           <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#0a0a0a]">
                             {screen.thumbnailUrl ? (
                               <img src={screen.thumbnailUrl} alt={screen.fileName || 'Screen'} className="w-full h-full object-cover object-top" />
                             ) : (
                               <div className="w-full h-full bg-[#0a0a0a] animate-pulse" />
                             )}
                           </div>
                           <button
                             onClick={() => {
                               selectedDesignNodeIds.set(selectedDesignIds.filter(id => id !== screen.id));
                             }}
                             className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10"
                           >
                             <X size={12} />
                           </button>
                         </div>
                       </div>
                     ))}
                     {/* File / image attachments */}
                     {attachments.map((att) => (
                       <div key={att.id} className={`relative group flex-shrink-0 transition-all duration-200 ${removingIds.has(att.id) ? 'opacity-0 scale-90' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}>
                         {att.type === 'image' ? (
                           <div className="relative">
                             <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/5 bg-[#1c1c1c]">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={att.url} alt={att.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                             </div>
                             <button 
                               onClick={() => removeAttachment(att.id)}
                               className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10"
                             >
                                 <X size={12} />
                             </button>
                           </div>
                         ) : (
                           <div className="h-16 min-w-[180px] bg-[#1c1c1c] rounded-2xl flex items-center px-4 gap-3.5 relative border border-white/5 hover:border-white/10 transition-colors">
                              <div className="text-gray-400">
                                 <Globe size={24} strokeWidth={1.5} />
                              </div>
                              <div className="flex flex-col min-w-0">
                                 <span className="text-[13px] font-semibold text-gray-200 truncate max-w-[120px] leading-tight">{att.name}</span>
                                 <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">{att.extension}</span>
                              </div>
                              <button 
                                onClick={() => removeAttachment(att.id)}
                                className="absolute -top-1.5 -right-1.5 bg-[#27272a] text-gray-400 hover:text-white border border-white/10 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-xl z-10"
                              >
                                 <X size={12} />
                              </button>
                           </div>
                         )}
                       </div>
                     ))}
                   </div>
                 </div>
               </div>

               <textarea
                  ref={textareaRef}
                  placeholder={hasUnsaved ? "Save or discard changes first..." : "Ask Willow..."}
                  className={`w-full bg-transparent text-gray-100 placeholder-gray-400 resize-none outline-none min-h-[44px] px-3 py-1.5 text-[16px] leading-relaxed font-normal overflow-y-auto transition-opacity duration-200 ${isChatMode ? 'text-lg' : ''} ${hasUnsaved ? 'opacity-40 pointer-events-none' : ''}`}
                  style={{ scrollbarGutter: 'stable' }}
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(promptValue);
                    }
                  }}
                  onPaste={(e) => {
                    const items = e.clipboardData?.items;
                    if (!items) return;

                    const imageFiles: File[] = [];
                    for (let i = 0; i < items.length; i++) {
                      if (items[i].type.startsWith('image/')) {
                        const file = items[i].getAsFile();
                        if (file) imageFiles.push(file);
                      }
                    }

                    if (imageFiles.length > 0) {
                      e.preventDefault();
                      const newAttachments: Attachment[] = imageFiles.map(file => ({
                        id: Math.random().toString(36).substring(7),
                        type: 'image' as const,
                        url: URL.createObjectURL(file),
                        name: file.name || `pasted-image.${file.type.split('/')[1] || 'png'}`,
                        extension: file.name?.split('.').pop() || file.type.split('/')[1] || 'png',
                        file
                      }));
                      setAttachments(prev => [...prev, ...newAttachments]);
                    }
                  }}
                  rows={1}
                  disabled={hasUnsaved}
               />
               <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                     <input 
                        type="file" 
                        multiple 
                        className="hidden" 
                        ref={fileInputRef} 
                        onChange={handleFileSelect} 
                     />
                     <button 
                        onClick={() => fileInputRef.current?.click()}
                        disabled={hasUnsaved}
                        className={`p-2.5 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-all flex-shrink-0 ${hasUnsaved ? 'opacity-40 pointer-events-none' : ''}`}
                     >
                        <Plus size={18} />
                     </button>
                     <div className="relative" ref={toolsMenuRef}>
                        {shouldRenderToolsMenu && (
                          <div 
                             style={{
                               boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 40px -10px rgba(0, 0, 0, 0.8), 0 1px 0 0 rgba(255, 255, 255, 0.05) inset',
                             }}
                             className={`absolute bottom-full left-0 mb-2 w-40 bg-[#1c1c1c] rounded-xl overflow-hidden z-50 ${isClosingToolsMenu ? 'settings-fade-out' : 'settings-fade-in'}`}
                          >
                             {TOOLS.map((tool) => (
                               <button 
                                  key={tool.id}
                                  onClick={() => handleToolSelect(tool.id)}
                                  className="flex items-center gap-2.5 w-full px-3 py-2.5 hover:bg-[#27272a] text-gray-300 hover:text-white transition-colors text-[13px] font-medium text-left"
                               >
                                  <tool.icon size={16} className={tool.id === 'design' || tool.id === 'prototype' ? 'text-gray-400' : ''} />
                                  <span>{tool.label}</span>
                               </button>
                             ))}
                          </div>
                        )}
                        <button
                           onClick={() => !currentTool && setIsToolsMenuOpen(!isToolsMenuOpen)}
                           disabled={hasUnsaved}
                           className={`flex items-center rounded-full transition-all text-[13px] font-medium flex-shrink-0 h-[36px]
                             ${currentTool
                                ? 'bg-[#3b82f6]/20 text-[#3b82f6] hover:bg-[#3b82f6]/30'
                                : 'bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white'
                             }
                             ${isCompact
                                ? (currentTool ? 'px-2.5 gap-2.5' : 'px-2.5')
                                : (currentTool ? 'pl-4 pr-2.5 gap-2.5' : 'px-4 gap-2')
                             }
                             ${isToolsMenuOpen ? 'bg-[#3f3f46] text-white' : ''}
                             ${hasUnsaved ? 'opacity-40 pointer-events-none' : ''}
                           `}
                           title="Tools"
                        >
                           {currentTool ? (
                             <>
                               <div className="flex items-center gap-2">
                                 <currentTool.icon size={16} />
                                 {!isCompact && <span>{currentTool.label}</span>}
                               </div>
                               <div
                                  onClick={handleToolReset}
                                  className="p-0.5 hover:bg-[#3b82f6]/30 rounded-full transition-colors cursor-pointer flex items-center justify-center"
                               >
                                 <X size={12} />
                               </div>
                             </>
                           ) : (
                             <>
                               <Wrench size={16} />
                               {!isCompact && <span className="ml-2">Tools</span>}
                             </>
                           )}
                        </button>
                     </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                      <div className="relative" ref={modelsMenuRef}>
                        {shouldRenderModelsMenu && (
                          <div 
                             style={{
                               boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 40px -10px rgba(0, 0, 0, 0.8), 0 1px 0 0 rgba(255, 255, 255, 0.05) inset',
                             }}
                             className={`absolute bottom-full right-0 mb-2 w-44 bg-[#1c1c1c] rounded-xl overflow-hidden z-50 ${isClosingModelsMenu ? 'settings-fade-out' : 'settings-fade-in'}`}
                          >
                             {/* Provider Groups */}
                             {['gemini', 'openai', 'anthropic'].map((provider) => {
                               const providerModels = modelConfig[provider]?.savedModels || [];
                               if (providerModels.length === 0) return null;
                               
                               return (
                                 <div key={provider} className="border-b border-white/5 last:border-0">
                                   <div className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-white/[0.02]">
                                     MODELS
                                   </div>
                                   {providerModels.map((model: any) => {
                                     const shortenName = (name: string) => {
                                       return name
                                         .replace(/Gemini\s+/i, '')
                                         .replace(/flash\s+lite/i, 'Lite')
                                         .replace(/gpt-/i, '')
                                         .replace(/claude\s+/i, '');
                                     };
                                     
                                     const isSelected = selectedModelId === model.id;
                                     
                                     return (
                                       <button 
                                          key={model.id}
                                          onClick={() => {
                                            setSelectedModelId(model.id);
                                            setModelConfig((prev: any) => ({
                                              ...prev,
                                              [provider]: { ...prev[provider], model: model.modelId, thinkingLevel: model.thinkingLevel }
                                            }));
                                            setIsModelsMenuOpen(false);
                                          }}
                                          className={`flex items-center justify-between w-full px-3 py-2.5 transition-colors text-[13px] font-medium text-left
                                            ${isSelected ? 'bg-[#1e2b48] text-[#58a1ff]' : 'hover:bg-[#27272a] text-gray-300 hover:text-white'}
                                          `}
                                       >
                                          <div className="flex items-center gap-2.5">
                                            <GeminiLogo size={14} className={isSelected ? 'text-[#58a1ff]' : (provider === 'gemini' ? 'text-blue-400' : provider === 'openai' ? 'text-green-400' : 'text-orange-400')} />
                                            <span className="truncate max-w-[110px]">{shortenName(model.name)}</span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1">
                                               {Array.from({ length: model.thinkingLevel }).map((_, i) => (
                                                 <div key={i} className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-[#58a1ff]' : 'bg-[#fbbf24]'}`} />
                                               ))}
                                            </div>
                                            {isSelected && <Check size={14} className="text-[#58a1ff]" />}
                                          </div>
                                       </button>
                                     );
                                   })}
                                 </div>
                               );
                             })}
                             
                             {/* If no models saved, show a placeholder or link to settings */}
                             {!(modelConfig.gemini.savedModels.length || modelConfig.openai.savedModels.length || modelConfig.anthropic.savedModels.length) && (
                               <div className="px-4 py-6 text-center text-gray-500">
                                  <Sparkles size={24} className="mx-auto mb-2 opacity-20" />
                                  <p className="text-[12px]">No model presets added.</p>
                                  <button 
                                    onClick={() => {
                                      setIsModelsMenuOpen(false);
                                      // Trigger settings opening logic if possible, or just guide user
                                    }}
                                    className="mt-2 text-[#58a1ff] hover:underline text-[11px]"
                                  >
                                    Configure in Settings
                                  </button>
                               </div>
                             )}
                             {/* Agent Swarm Toggle */}
                             <div className="px-3 py-2.5 border-t border-white/5 flex items-center justify-between">
                               <div className="flex items-center gap-2">
                                 <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="text-purple-400">
                                   <circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/>
                                   <line x1="7" y1="7" x2="10" y2="10"/><line x1="17" y1="7" x2="14" y2="10"/><line x1="7" y1="17" x2="10" y2="14"/>
                                 </svg>
                                 <span className="text-[12px] font-medium text-zinc-400">Swarm</span>
                               </div>
                               <button
                                 onClick={(e) => { e.stopPropagation(); onSwarmToggle?.(!agentSwarmEnabled); }}
                                 className={`relative w-7 h-[16px] rounded-full transition-colors ${agentSwarmEnabled ? 'bg-purple-500' : 'bg-zinc-700'}`}
                               >
                                 <div className={`absolute top-[1.5px] w-[13px] h-[13px] rounded-full bg-white transition-transform ${agentSwarmEnabled ? 'translate-x-[13px]' : 'translate-x-[1.5px]'}`} />
                               </button>
                             </div>
                          </div>
                        )}
                        <button 
                           onClick={() => setIsModelsMenuOpen(!isModelsMenuOpen)}
                           disabled={hasUnsaved}
                           className={`p-2.5 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-all flex-shrink-0 ${isModelsMenuOpen ? 'bg-[#3f3f46] text-white' : ''} ${hasUnsaved ? 'opacity-40 pointer-events-none' : ''}`}
                        >
                           <GeminiLogo size={18} />
                        </button>
                      </div>
                       {isCurrentlyGenerating ? (
                         <button 
                           onClick={() => {
                             // TODO: Add stop generation logic here
                              sandpackStore.isGenerating.set(false);
                           }}
                           className="w-[38px] h-[38px] rounded-full bg-[#3b82f6]/20 text-[#3b82f6] hover:bg-[#3b82f6]/30 transition-colors flex items-center justify-center shadow-md flex-shrink-0"
                         >
                           <div className="w-[14px] h-[14px] bg-current rounded-[3px]" />
                         </button>
                       ) : (
                         <button 
                            onClick={() => handleSendMessage(promptValue)}
                            disabled={hasUnsaved}
                            className={`w-[38px] h-[38px] rounded-full bg-[#d4d4d8] text-black hover:bg-white transition-all flex items-center justify-center shadow-md flex-shrink-0 ${hasUnsaved ? 'opacity-40 pointer-events-none' : ''}`}
                          >
                           {(promptValue.trim().length > 0 || attachments.length > 0) ? (
                              <ArrowUp size={18} strokeWidth={2.5} />
                           ) : (
                              <AudioLines size={18} />
                           )}
                         </button>
                       )}
                  </div>
               </div>
          </div>
        </div>
      </div>
    </div>
    </div>

      {/* Global Error Popups - rendered via portal to escape sidebar stacking context */}
      {globalErrors.length > 0 && createPortal(
        <>
          <style>{`
            @keyframes errorSlideDown {
              from { opacity: 0; transform: translateY(-12px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes errorFadeOut {
              from { opacity: 1; }
              to { opacity: 0; }
            }
          `}</style>
          <div className="fixed top-20 bottom-4 right-6 z-50 flex flex-col overflow-y-auto no-scrollbar">
            {globalErrors.map((err) => {
              const isLastOne = globalErrors.length === 1;
              return isLastOne && err.isClosing ? (
                <div
                  key={err.id}
                  className="flex items-center gap-4 px-4 py-5 bg-[#18181b]/80 backdrop-blur-md border border-white/10 rounded-xl"
                  style={{ animation: 'errorFadeOut 0.2s ease-out forwards' }}
                >
                  <div className="flex-shrink-0">
                    <AlertTriangle className="text-red-400" size={20} />
                  </div>
                  <div className="flex-1 min-w-[200px] max-w-[400px]">
                    <p className="text-sm font-medium text-gray-200 leading-snug">
                      {err.message}
                    </p>
                  </div>
                  {err.action === 'set-api-key' ? (
                    <button 
                      className="flex-shrink-0 text-red-400 text-sm font-medium"
                    >
                      Set
                    </button>
                  ) : (
                    <button 
                      className="flex-shrink-0 text-red-400 text-sm font-medium"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              ) : (
                <div
                  key={err.id}
                  className="grid transition-[grid-template-rows] duration-[250ms] ease-in-out"
                  style={{ gridTemplateRows: err.isClosing ? '0fr' : '1fr' }}
                >
                  <div className="overflow-hidden">
                    <div className="pb-3">
                      <div 
                        className="flex items-center gap-4 px-4 py-5 bg-[#18181b]/80 backdrop-blur-md border border-white/10 rounded-xl transition-opacity duration-[250ms] ease-out"
                        style={{
                          animation: !err.isClosing ? 'errorSlideDown 0.25s ease-out forwards' : undefined,
                          opacity: err.isClosing ? 0 : undefined
                        }}
                      >
                        <div className="flex-shrink-0">
                          <AlertTriangle className="text-red-400" size={20} />
                        </div>
                        <div className="flex-1 min-w-[200px] max-w-[400px]">
                          <p className="text-sm font-medium text-gray-200 leading-snug">
                            {err.message}
                          </p>
                        </div>
                        {err.action === 'set-api-key' ? (
                          <button 
                            onClick={() => {
                              dismissGlobalError(err.id);
                              onSettingsClick?.('models');
                            }}
                            className="flex-shrink-0 text-red-400 hover:text-red-300 text-sm font-medium transition-colors cursor-pointer"
                          >
                            Set
                          </button>
                        ) : (
                          <button 
                            onClick={() => dismissGlobalError(err.id)}
                            className="flex-shrink-0 text-red-400 hover:text-red-300 text-sm font-medium transition-colors cursor-pointer"
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </>
  );
};

export default Sidebar;
