
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
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
  CornerLeftUp
} from 'lucide-react';
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
import { BOLT_SYSTEM_PROMPT } from '../../lib/sandpack/system-prompt';
import { testStore } from '../../lib/test-store';
import { TestingIndicator, TestResultIndicator } from './TestingIndicator';
import { ColorPickerMenu } from './ColorPickerMenu';
import { VisualEditorSelectMenu } from './VisualEditorSelectMenu';
import { UnsavedChangesBar } from './UnsavedChangesBar';
import { UnsavedChangesModal } from './UnsavedChangesModal';


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


interface SidebarProps {
  width: number;
  isCollapsed: boolean;
  onToggle: () => void;
  prompt?: string;
  activeTab: string;
  onTabChange: (id: string) => void;
  isChatMode?: boolean;
  modelConfig: any;
  setModelConfig: React.Dispatch<React.SetStateAction<any>>;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  isResizing?: boolean;
  projectName?: string;
  isGeneratingName?: boolean;
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

  // Show loading during scan or init or saving
  const showLoading = scanning || !isReady || !hasApp || saving;

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

const Sidebar: React.FC<SidebarProps> = ({ width, isCollapsed, onToggle, prompt, activeTab, onTabChange, isChatMode, modelConfig, setModelConfig, selectedModelId, setSelectedModelId, isResizing, projectName, isGeneratingName }) => {
  const navigate = useNavigate();
  console.log('🔵🔵🔵 [Sidebar] COMPONENT RENDERING 🔵🔵🔵');
  const isCompact = width < 405;
  const [sidebarView, setSidebarViewRaw] = useState<'chat' | 'visual-edit'>('chat');
  const hasUnsaved = useStore(hasUnsavedChanges);
  const [showExitModal, setShowExitModal] = useState(false);

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
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const streamingContentRef = useRef<HTMLDivElement>(null);
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
  
  // Debug: Log test mode changes
  useEffect(() => {
    console.log('[Sidebar] isTestMode changed to:', isTestMode);
  }, [isTestMode]);
  
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

  // Check if any attachments are visible (not all being removed)
  const hasVisibleAttachments = attachments.length > 0 && !attachments.every(att => removingIds.has(att.id));
  const [showRightGradient, setShowRightGradient] = useState(true);

  // Chat/Messaging State
  interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    thinkingTime?: number;
    isGenerating?: boolean;
    isThinking?: boolean;

    timestamp: number;
    attachments?: { type: 'image' | 'text' | 'file'; mimeType: string; data: string; name?: string }[];
  }
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStreamingResponse, setCurrentStreamingResponse] = useState('');
  const [currentThinkingTime, setCurrentThinkingTime] = useState(0);
  const thinkingTimeRef = useRef(0); // Ref to capture accurate final thinking time
  const thinkingStartTimeRef = useRef<number | null>(null); // Timestamp when thinking started
  const [isCurrentlyGenerating, setIsCurrentlyGenerating] = useState(false);
  const [isCurrentlyThinking, setIsCurrentlyThinking] = useState(false);
  const isCurrentlyThinkingRef = useRef(false); // Ref to avoid stale closure in streaming callback
  const { apiKeys, loading: userDataLoading } = useUserDataContext();
  const thinkingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Prompt Suggestions State
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false); // Start hidden
  const suggestionsGeneratedRef = useRef(false);
  const prevGeneratingRef = useRef(false);
  const initialLoadCompleteRef = useRef(false); // Track if first generation from dashboard is done

  // Generate prompt suggestions based on conversation
  const generateSuggestions = useCallback(async () => {
    if (!apiKeys.gemini?.[0]) return;

    try {
      const genAI = new GoogleGenerativeAI(apiKeys.gemini[0]);
      const model = genAI.getGenerativeModel({ model: PROJECT_NAME_MODEL });

      // Build context from recent messages
      const recentMessages = messages.slice(-4).map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 200)}`
      ).join('\n');

      const result = await model.generateContent(
        `Based on this conversation about building an app, suggest 5 short follow-up prompts (2-4 words each) the user might want to ask next. Return ONLY the suggestions, one per line. No numbers, no bullets, no question marks.\n\nConversation:\n${recentMessages}`
      );

      const text = result.response.text().trim();
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
  useEffect(() => {
    if (prompt && !initialPromptDisplayed.current) {
      initialPromptDisplayed.current = true;

      // Reset stores for fresh session (in case user navigated back and returned)
      sandpackStore.reset();
      testStore.reset();

      // Clear animation tracking refs
      animatedContentRef.current.clear();
      completedMessagesRef.current.clear();
      introShownRef.current.clear();

      // Show user message immediately
      const userMessage: ChatMessage = {
        id: 'initial-prompt',
        role: 'user',
        content: prompt,
        timestamp: Date.now()
      };
      setMessages([userMessage]);

      // Set generating/thinking status immediately
      setIsCurrentlyGenerating(true);
      setIsCurrentlyThinking(true);
      isCurrentlyThinkingRef.current = true; // Set ref directly to avoid timing issues
      setCurrentThinkingTime(0);
      thinkingTimeRef.current = 0;
      thinkingStartTimeRef.current = Date.now(); // Track when thinking started

      // Start timer immediately
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = setInterval(() => {
        thinkingTimeRef.current += 1;
        setCurrentThinkingTime(thinkingTimeRef.current);
      }, 1000);
    }
  }, [prompt]);

  // Handle Initial AI Generation - Fire immediately since keys are loaded synchronously
  const initialAiTriggered = useRef(false);
  useEffect(() => {
    if (prompt && !initialAiTriggered.current && messages.length > 0) {
      initialAiTriggered.current = true;
      startAiGeneration(prompt, [], true, []); // true = UI already started
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
      setMessages(prev => [...prev, userMessage]);
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

    // Route based on selectedToolId or isTestMode
    if (selectedToolId === 'test' || isTestMode) {
      // In test mode, run the test
      await startTestGeneration(text);
    } else {
      // Normal code generation - Trigger generation with history
      const history: AiChatMessage[] = messages.map(m => ({
          role: m.role,
          content: m.content
          // Don't pass attachments in history yet as AiChatMessage might mismatch? 
          // Actually we should mapping attachments too if we want memory.
          // For now, let's keep history simple or update it.
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

      const fullHistory = [
          systemMessage,
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

      workbenchStore.isGenerating.set(false);

    } catch (error: any) {
      console.error('Chat error:', error);

      const errorMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: `Error: ${error.message || 'Failed to get response.'}`,
        thinkingTime: thinkingTimeRef.current,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
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
      isGenerating: true  // Mark as generating to hide action buttons
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
              ? { ...msg, content: updatedContent, thinkingTime: thinkingTimeRef.current, isGenerating: true }
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
          ? { ...msg, content: finalContent, thinkingTime: thinkingTimeRef.current, isGenerating: false }
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
              isGenerating: false
            }
          : msg
      ));

      setIsCurrentlyGenerating(false);
      setIsCurrentlyThinking(false);
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
  const lastPromptId = useRef<string | null>(null);
  const isScrollingToTop = useRef(false);

  React.useLayoutEffect(() => {
    if (chatScrollRef.current) {
        const container = chatScrollRef.current;
        const userMessages = messages.filter(m => m.role === 'user');
        const lastUserMessage = userMessages[userMessages.length - 1];

        if (lastUserMessage && lastUserMessage.id !== lastPromptId.current) {
            lastPromptId.current = lastUserMessage.id;
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
                    const targetVisualOffset = isChatMode ? 76 : 20;
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
                        }
                    };

                    // Start animation immediately (no additional frame delay)
                    animateScroll(startTime);
                }
            });
        }
    }
  }, [messages, isChatMode]);

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
          <div className="absolute inset-x-0 top-14 z-20 h-[52px] bg-[#1c1c1c] pointer-events-none">
             {/* Gradient Fade at the bottom of the background */}
             <div className="absolute -bottom-6 left-0 right-0 h-6 bg-gradient-to-b from-[#1c1c1c] to-transparent" />
          </div>

          {/* Content layer: sits at z-40, above the scrolling menu (z-30) to keep header text always on top */}
          <div className="absolute inset-x-0 top-14 z-40 px-6 pt-0 pb-3.5 flex items-center justify-between h-[52px] pointer-events-none">
             {/* Left side: Breadcrumbs */}
             <div className="flex items-center h-[32px] pointer-events-auto overflow-hidden">
                <button 
                  className={`text-base transition-colors duration-300 ${sidebarView === 'visual-edit' ? 'text-[#81888f] hover:text-white cursor-pointer' : 'text-white cursor-default'}`}
                  onClick={() => sidebarView === 'visual-edit' && handleExitVisualEdit()}
                >
                  Design
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
      {/* Header - Hidden in Chat Mode since StagingView renders it at root level */}
      {!isChatMode && (
        <div className={`h-14 flex items-center justify-between z-20 flex-shrink-0 bg-[#1c1c1c]`}>
          <div className="flex items-center min-w-0 h-full" style={{ paddingLeft: '10px' }}>
            {/* Logo Button - Squircle hover background, Dashboard link */}
            <button 
              onClick={() => navigate('/')}
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
              <button className="p-1.5 hover:text-white transition-colors"><Clock size={16} /></button>
              <button onClick={() => sidebarView === 'visual-edit' ? handleExitVisualEdit(onToggle) : onToggle()} className="p-1.5 hover:text-white transition-colors"><PanelLeftClose size={16} /></button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={chatScrollRef}
        className={`flex-1 space-y-8 min-h-0 hover-scrollbar overflow-y-auto
          ${showContextHeader ? 'pb-[290px]' : 'pb-[210px]'}
          ${isChatMode
            ? 'pl-0 pr-0 pt-[76px] scroll-pt-[76px]' // Scrollbar at far right in Chat Mode
            : activeTab === 'design'
              ? 'pl-[8px] pr-[2px] mr-[8.5px] pt-0 scroll-pt-0' // Zero padding-top to align header perfectly with absolute overlays
              : 'pl-[27px] pr-[18.5px] mr-[8.5px] pt-5 scroll-pt-5'
          }`}
        style={{
          // During resize: let browser maintain scroll position as text reflows (auto)
          // Otherwise: disable scroll anchoring so our animation works correctly (none)
          overflowAnchor: isResizing ? 'auto' : 'none'
        }}
      >
        <div className={isChatMode ? 'max-w-[800px] mx-auto px-[27px] pr-[40px]' : ''}>
          {activeTab === 'design' && !isChatMode ? (
            <div className="space-y-4">
               {/* Spacer to maintain vertical position of cards after removing "Design" text header */}
               <div className="h-[52px]" />

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
            </div>
          ) : (
          <div className="space-y-12">
            {messages.map((msg, msgIndex) => {
              // Check if this is the last assistant message (needs min-height to prevent snap)
              const isLastAssistantMessage = msg.role === 'assistant' &&
                msgIndex === messages.length - 1;

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
                      // Min-height on last assistant message prevents snap when streaming ends
                      minHeight: isLastAssistantMessage ? 'calc(100vh - 200px)' : undefined
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

            {/* Current Streaming / Thinking UI - Only for NORMAL messages (not test mode) */}
            {isCurrentlyGenerating && !testStore.isTestMode.get() && (
              <div
                ref={streamingContentRef}
                className="space-y-4"
                style={{
                  // Min-height on response area ensures scroll works and prevents snap
                  minHeight: 'calc(100vh - 200px)'
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

                {currentStreamingResponse && (
                  <div className="text-gray-300 text-[15px] leading-[1.65]">
                    {renderFormattedContent(currentStreamingResponse, true, 'streaming')}
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
      <div className="absolute bottom-0 left-0 w-full z-30 pointer-events-none">
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

          {/* Grid collapses when either: design tab is active OR suggestions are hidden */}
          {/* Uses deferredActiveTab to stagger animation and avoid layout thrashing */}
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${deferredActiveTab !== 'design' && suggestionsVisible ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            style={{ willChange: 'grid-template-rows' }}
          >
            <div className="overflow-hidden">
              <div
                className={`relative transition-opacity duration-300 ease-in-out ${deferredActiveTab !== 'design' && suggestionsVisible ? 'opacity-100' : 'opacity-0'}`}
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

               {/* Attachments Area */}
               <div className={`grid transition-[grid-template-rows] duration-[250ms] ease-in-out ${hasVisibleAttachments ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                 <div className="overflow-hidden">
                   <div className={`flex gap-3 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1 transition-[padding] duration-[250ms] ease-in-out ${showContextHeader ? 'pt-2' : 'pt-0'}`}>
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
                          <div className={`absolute bottom-full left-0 mb-2 w-40 bg-[#1c1c1c] border border-[#2e2e2e] rounded-xl shadow-2xl overflow-hidden z-50 ${isClosingToolsMenu ? 'settings-fade-out' : 'settings-fade-in'}`}>
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
                     <button 
                        disabled={hasUnsaved}
                        className={`flex items-center gap-2 rounded-full bg-[#3f3f46]/60 text-gray-300 hover:bg-[#3f3f46] hover:text-white transition-all text-[13px] font-medium flex-shrink-0 h-[36px]
                          ${isCompact ? 'px-2.5 justify-center' : 'px-4'}
                          ${hasUnsaved ? 'opacity-40 pointer-events-none' : ''}
                        `}
                        title="Chat"
                     >
                        <MessageSquare size={16} />
                        {!isCompact && <span>Chat</span>}
                     </button>
                      <div className="relative" ref={modelsMenuRef}>
                        {shouldRenderModelsMenu && (
                          <div className={`absolute bottom-full right-0 mb-2 w-44 bg-[#1c1c1c] border border-[#2e2e2e] rounded-xl shadow-2xl overflow-hidden z-50 ${isClosingModelsMenu ? 'settings-fade-out' : 'settings-fade-in'}`}>
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
    </>
  );
};

export default Sidebar;
